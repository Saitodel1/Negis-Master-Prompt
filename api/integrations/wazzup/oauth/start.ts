import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

type OAuthState = {
  clinicId: string
  userId: string
  codeVerifier: string
  expiresAt: number
}
type AuthUserResponse = { ok: boolean; json(): Promise<unknown> }

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const clientId = process.env.WAZZUP_OAUTH_CLIENT_ID
const redirectUri = process.env.WAZZUP_OAUTH_REDIRECT_URI
const secret = process.env.WAZZUP_OAUTH_STATE_SECRET || process.env.WAZZUP_CREDENTIALS_ENCRYPTION_KEY

const admin = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey)
  : null

function toBase64Url(value: Buffer) {
  return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function encryptState(value: OAuthState, keySecret: string) {
  const key = createHash('sha256').update(keySecret).digest()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return [toBase64Url(iv), toBase64Url(cipher.getAuthTag()), toBase64Url(ciphertext)].join('.')
}

function bearerToken(request: VercelRequest) {
  const header = request.headers.authorization || ''
  return header.startsWith('Bearer ') ? header.slice(7) : ''
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!admin || !supabaseUrl || !serviceRoleKey || !clientId || !redirectUri || !secret) {
    return res.status(503).json({ error: 'Wazzup OAuth is not configured on the server' })
  }

  const accessToken = bearerToken(req)
  if (!accessToken) return res.status(401).json({ error: 'Authorization is required' })

  let userResponse: AuthUserResponse
  try {
    userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(10_000),
    }) as unknown as AuthUserResponse
  } catch {
    return res.status(503).json({ error: 'Authentication service is unavailable' })
  }
  const user = await userResponse.json().catch(() => null) as { id?: string } | null
  if (!userResponse.ok || !user?.id) return res.status(401).json({ error: 'Session is invalid' })

  const requestedClinicId = typeof req.body?.clinicId === 'string' ? req.body.clinicId : ''
  if (!requestedClinicId) return res.status(400).json({ error: 'clinicId is required' })

  let canManage = false
  try {
    canManage = await canManageClinic(requestedClinicId, user.id)
  } catch {
    return res.status(503).json({ error: 'Не удалось проверить права на рабочее пространство' })
  }
  if (!canManage) {
    return res.status(403).json({ error: 'Подключать Wazzup может только владелец или руководитель этой организации' })
  }

  const codeVerifier = toBase64Url(randomBytes(64))
  const codeChallenge = toBase64Url(createHash('sha256').update(codeVerifier).digest())
  const state = encryptState({
    clinicId: requestedClinicId,
    userId: user.id,
    codeVerifier,
    expiresAt: Date.now() + 10 * 60 * 1000,
  }, secret)

  const authorizeUrl = new URL('https://tech.wazzup24.com/v2/oauth/authorize')
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('client_id', clientId)
  authorizeUrl.searchParams.set('redirect_uri', redirectUri)
  authorizeUrl.searchParams.set('scope', 'transport,crm')
  authorizeUrl.searchParams.set('state', state)
  authorizeUrl.searchParams.set('code_challenge', codeChallenge)
  authorizeUrl.searchParams.set('code_challenge_method', 'S256')

  const now = new Date().toISOString()
  await Promise.all([
    admin.from('clinic_integrations').upsert({
      clinic_id: requestedClinicId,
      integration_id: 'wazzup',
      status: 'pending',
      verified_at: null,
      updated_at: now,
    }, { onConflict: 'clinic_id,integration_id' }),
    admin.from('integration_requests').upsert({
      clinic_id: requestedClinicId,
      integration_id: 'wazzup',
      requested_by: user.id,
      status: 'in_review',
      admin_note: 'Wazzup OAuth started by workspace owner or manager.',
      reviewed_at: null,
      updated_at: now,
    }, { onConflict: 'clinic_id,integration_id' }),
  ])

  return res.status(200).json({ authorizeUrl: authorizeUrl.toString() })
}
