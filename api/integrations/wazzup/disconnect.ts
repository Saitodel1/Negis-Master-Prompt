import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createDecipheriv, createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

type AuthUserResponse = { ok: boolean; json(): Promise<unknown> }
type StoredConnection = {
  api_key_ciphertext: string | null
  api_key_iv: string | null
  api_key_tag: string | null
  webhook_subscriptions: Array<{ url?: string }> | null
}
type WazzupWebhook = { id?: string; url?: string }

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const credentialSecret = process.env.WAZZUP_CREDENTIALS_ENCRYPTION_KEY || process.env.WAZZUP_OAUTH_STATE_SECRET

const admin = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey)
  : null

function bearerToken(request: VercelRequest) {
  const header = request.headers.authorization || ''
  return header.startsWith('Bearer ') ? header.slice(7) : ''
}

function decrypt(ciphertext: string, iv: string, tag: string, secret: string) {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    createHash('sha256').update(secret).digest(),
    Buffer.from(iv, 'base64'),
  )
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

async function canManageClinic(clinicId: string, userId: string) {
  if (!admin) return false
  const [clinicResult, roleResult] = await Promise.all([
    admin.from('clinics').select('id').eq('id', clinicId).eq('owner_id', userId).maybeSingle(),
    admin
      .from('user_roles')
      .select('clinic_id')
      .eq('clinic_id', clinicId)
      .eq('user_id', userId)
      .in('role', ['owner', 'manager'])
      .limit(1)
      .maybeSingle(),
  ])
  if (clinicResult.error) throw clinicResult.error
  if (roleResult.error) throw roleResult.error
  return Boolean(clinicResult.data || roleResult.data)
}

async function removeWazzupWebhooks(connection: StoredConnection) {
  if (!credentialSecret || !connection.api_key_ciphertext || !connection.api_key_iv || !connection.api_key_tag) {
    return null
  }

  const accessToken = decrypt(
    connection.api_key_ciphertext,
    connection.api_key_iv,
    connection.api_key_tag,
    credentialSecret,
  )
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
  const listResponse = await fetch('https://tech.wazzup24.com/v2/webhooks', {
    headers,
    signal: AbortSignal.timeout(15_000),
  })
  if (!listResponse.ok) return `Wazzup webhook list returned ${listResponse.status}`

  const payload = await listResponse.json().catch(() => ({})) as { data?: WazzupWebhook[] }
  const managedUrls = new Set((connection.webhook_subscriptions || []).map(item => item.url).filter(Boolean))
  const subscriptions = (payload.data || [])
    .filter(item => item.id && item.url && managedUrls.has(item.url))
    .map(item => ({ id: item.id as string }))
  if (subscriptions.length === 0) return null

  const deleteResponse = await fetch('https://tech.wazzup24.com/v2/webhooks', {
    method: 'DELETE',
    headers,
    body: JSON.stringify({ data: subscriptions }),
    signal: AbortSignal.timeout(15_000),
  })
  return deleteResponse.ok ? null : `Wazzup webhook delete returned ${deleteResponse.status}`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' })
  if (!admin || !supabaseUrl || !serviceRoleKey) {
    return res.status(503).json({ error: 'Wazzup integration is not configured on the server' })
  }

  const accessToken = bearerToken(req)
  if (!accessToken) return res.status(401).json({ error: 'Authorization is required' })

  let userResponse: AuthUserResponse
  try {
    userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    }) as unknown as AuthUserResponse
  } catch {
    return res.status(503).json({ error: 'Authentication service is unavailable' })
  }
  const user = await userResponse.json().catch(() => null) as { id?: string } | null
  if (!userResponse.ok || !user?.id) return res.status(401).json({ error: 'Session is invalid' })

  const clinicId = typeof req.body?.clinicId === 'string' ? req.body.clinicId : ''
  if (!clinicId) return res.status(400).json({ error: 'clinicId is required' })

  try {
    if (!await canManageClinic(clinicId, user.id)) {
      return res.status(403).json({ error: 'Отключать Wazzup может только владелец или руководитель этой организации' })
    }
  } catch {
    return res.status(503).json({ error: 'Не удалось проверить права на рабочее пространство' })
  }

  const { data: connection, error: connectionReadError } = await admin
    .from('wazzup_connections')
    .select('api_key_ciphertext,api_key_iv,api_key_tag,webhook_subscriptions')
    .eq('clinic_id', clinicId)
    .maybeSingle()
  if (connectionReadError) return res.status(500).json({ error: connectionReadError.message })

  let warning: string | null = null
  if (connection) {
    try {
      warning = await removeWazzupWebhooks(connection as StoredConnection)
    } catch (error) {
      warning = error instanceof Error ? error.message : 'Не удалось удалить подписки Wazzup'
    }
  }

  const now = new Date().toISOString()
  const [connectionDelete, channelUpdate, integrationUpdate, requestUpdate] = await Promise.all([
    admin.from('wazzup_connections').delete().eq('clinic_id', clinicId),
    admin.from('wz_channels').update({ is_active: false, updated_at: now }).eq('clinic_id', clinicId),
    admin.from('clinic_integrations').upsert({
      clinic_id: clinicId,
      integration_id: 'wazzup',
      status: 'disabled',
      verified_at: null,
      updated_at: now,
    }, { onConflict: 'clinic_id,integration_id' }),
    admin.from('integration_requests').update({
      status: 'cancelled',
      admin_note: 'Wazzup disconnected by workspace owner or manager.',
      reviewed_at: now,
      updated_at: now,
    }).eq('clinic_id', clinicId).eq('integration_id', 'wazzup'),
  ])

  const databaseError = connectionDelete.error || channelUpdate.error || integrationUpdate.error || requestUpdate.error
  if (databaseError) return res.status(500).json({ error: databaseError.message })

  return res.status(200).json({ success: true, warning })
}
