import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

type OAuthState = { clinicId: string; userId: string; codeVerifier: string; expiresAt: number }
type Channel = { channel_id?: string; transport?: string; status?: string; state?: string; phone?: string; name?: string }
type ExternalFetchResponse = { ok: boolean; json(): Promise<unknown> }

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const clientId = process.env.WAZZUP_OAUTH_CLIENT_ID
const redirectUri = process.env.WAZZUP_OAUTH_REDIRECT_URI
const partnerEmail = process.env.WAZZUP_PARTNER_EMAIL
const partnerPassword = process.env.WAZZUP_PARTNER_PASSWORD
const secret = process.env.WAZZUP_OAUTH_STATE_SECRET || process.env.WAZZUP_CREDENTIALS_ENCRYPTION_KEY

const admin = supabaseUrl && serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : null

function fromBase64Url(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  return Buffer.from(base64, 'base64')
}

function decryptState(value: string, keySecret: string): OAuthState | null {
  try {
    const [iv, tag, ciphertext] = value.split('.')
    if (!iv || !tag || !ciphertext) return null
    const decipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(keySecret).digest(), fromBase64Url(iv))
    decipher.setAuthTag(fromBase64Url(tag))
    const data = Buffer.concat([decipher.update(fromBase64Url(ciphertext)), decipher.final()])
    const state = JSON.parse(data.toString('utf8')) as OAuthState
    return state.expiresAt > Date.now() ? state : null
  } catch {
    return null
  }
}

function encrypt(value: string, keySecret: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(keySecret).digest(), iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') }
}

function redirect(res: VercelResponse, req: VercelRequest, result: string) {
  const origin = process.env.APP_URL || `https://${req.headers.host}`
  return res.redirect(302, `${origin}/marketplace?wazzup=${encodeURIComponent(result)}`)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!admin || !clientId || !redirectUri || !partnerEmail || !partnerPassword || !secret) {
    return redirect(res, req, 'oauth-not-configured')
  }

  const code = typeof req.query.code === 'string' ? req.query.code : ''
  const state = typeof req.query.state === 'string' ? decryptState(req.query.state, secret) : null
  if (typeof req.query.error === 'string' || !code) return redirect(res, req, 'oauth-cancelled')
  if (!state) return redirect(res, req, 'oauth-expired')

  const { data: membership } = await admin
    .from('user_roles')
    .select('role')
    .eq('clinic_id', state.clinicId)
    .eq('user_id', state.userId)
    .in('role', ['owner', 'manager'])
    .maybeSingle()
  if (!membership) return redirect(res, req, 'oauth-forbidden')

  let tokenResponse: ExternalFetchResponse
  try {
    tokenResponse = await fetch('https://tech.wazzup24.com/v2/oauth/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${partnerEmail}:${partnerPassword}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        authorize_code_data: { code, redirect_uri: redirectUri, client_id: clientId, code_verifier: state.codeVerifier },
      }),
      signal: AbortSignal.timeout(15_000),
    }) as unknown as ExternalFetchResponse
  } catch {
    return redirect(res, req, 'oauth-unavailable')
  }

  const tokenPayload = await tokenResponse.json().catch(() => ({})) as { data?: { access_token?: string; refresh_token?: string; expires_in?: number } }
  const tokens = tokenPayload.data
  if (!tokenResponse.ok || !tokens?.access_token || !tokens.refresh_token) return redirect(res, req, 'oauth-failed')

  let channels: Channel[] = []
  try {
    const channelResponse = await fetch('https://tech.wazzup24.com/v2/channels', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(15_000),
    }) as unknown as ExternalFetchResponse
    const payload = await channelResponse.json().catch(() => ({})) as { data?: Channel[] }
    channels = Array.isArray(payload.data) ? payload.data : []
  } catch {
    return redirect(res, req, 'oauth-unavailable')
  }

  const activeChannels = channels.filter(channel =>
    ['whatsapp', 'wapi', 'instagram'].includes(channel.transport ?? '')
      && (channel.status === 'active' || channel.state === 'active'),
  )
  const now = new Date().toISOString()
  const access = encrypt(tokens.access_token, secret)
  const refresh = encrypt(tokens.refresh_token, secret)
  const safeChannels = activeChannels.map(channel => ({
    channelId: channel.channel_id ?? null,
    transport: channel.transport ?? null,
    status: channel.status ?? channel.state ?? null,
    phone: channel.phone ?? null,
    name: channel.name ?? null,
  }))

  const { error: connectionError } = await admin.from('wazzup_connections').upsert({
    clinic_id: state.clinicId,
    api_key_ciphertext: access.ciphertext,
    api_key_iv: access.iv,
    api_key_tag: access.tag,
    refresh_token_ciphertext: refresh.ciphertext,
    refresh_token_iv: refresh.iv,
    refresh_token_tag: refresh.tag,
    connection_mode: 'oauth',
    access_token_expires_at: typeof tokens.expires_in === 'number' ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null,
    channels: safeChannels,
    verified_at: now,
    updated_at: now,
  }, { onConflict: 'clinic_id' })
  if (connectionError) return redirect(res, req, 'oauth-save-failed')

  const connected = activeChannels.length > 0
  const { error: integrationError } = await admin.from('clinic_integrations').upsert({
    clinic_id: state.clinicId,
    integration_id: 'wazzup',
    status: connected ? 'connected' : 'pending',
    verified_at: connected ? now : null,
    updated_at: now,
  }, { onConflict: 'clinic_id,integration_id' })
  if (integrationError) return redirect(res, req, 'oauth-save-failed')

  await admin.from('integration_requests').update({
    status: connected ? 'approved' : 'in_review',
    admin_note: connected ? 'Wazzup verified by server-side OAuth.' : 'OAuth completed without an active channel.',
    reviewed_at: now,
    updated_at: now,
  }).eq('clinic_id', state.clinicId).eq('integration_id', 'wazzup').in('status', ['requested', 'in_review'])

  return redirect(res, req, connected ? 'connected' : 'channel-required')
}
