import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

type OAuthState = { clinicId: string; userId: string; codeVerifier: string; expiresAt: number }
type Channel = {
  channel_id?: string
  transport?: string
  status?: string
  state?: string
  reason?: string
  phone?: string
  username?: string
  name?: string
}
type WebhookSubscription = { url?: string; event?: string }
type HttpResponse = {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}

const WEBHOOK_EVENTS = [
  'message.add',
  'message.status_update',
  'message.delete',
  'message.edit',
  'channel.status_update',
  'channel.create',
  'channel.delete',
  'channel.qr_update',
]

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const clientId = process.env.WAZZUP_OAUTH_CLIENT_ID
const redirectUri = process.env.WAZZUP_OAUTH_REDIRECT_URI
const partnerEmail = process.env.WAZZUP_PARTNER_EMAIL
const partnerPassword = process.env.WAZZUP_PARTNER_PASSWORD
const stateSecret = process.env.WAZZUP_OAUTH_STATE_SECRET || process.env.WAZZUP_CREDENTIALS_ENCRYPTION_KEY
const credentialSecret = process.env.WAZZUP_CREDENTIALS_ENCRYPTION_KEY || process.env.WAZZUP_OAUTH_STATE_SECRET

const admin = supabaseUrl && serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : null

async function httpRequest(url: string, init?: Parameters<typeof fetch>[1]): Promise<HttpResponse> {
  return await fetch(url, init) as unknown as HttpResponse
}

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

function isActiveChannel(channel: Channel) {
  const values = [channel.status, channel.state].filter(Boolean).map(value => String(value).toLowerCase())
  return values.some(value => ['active', 'ready', 'connected'].includes(value))
    && !values.some(value => ['blocked', 'disabled', 'error', 'deleted'].includes(value))
}

function chatTypeForTransport(transport: string | undefined) {
  if (transport === 'wapi' || transport === 'whatsapp') return 'whatsapp'
  if (transport === 'tgapi' || transport === 'telegram') return 'telegram'
  return transport || 'whatsapp'
}

function webhookUrl(clinicId: string) {
  const configured = process.env.WAZZUP_WEBHOOK_URL
  const crmKey = process.env.WAZZUP_OAUTH_CRM_KEY || process.env.WAZZUP_CRM_KEY
  const base = configured || (supabaseUrl ? `${supabaseUrl}/functions/v1/wazzup-webhook` : '')
  if (!base || !crmKey) return null
  const url = new URL(base)
  if (!url.searchParams.has('key')) url.searchParams.set('key', crmKey)
  url.searchParams.set('clinic_id', clinicId)
  return url.toString()
}

async function fetchChannels(accessToken: string) {
  const response = await httpRequest('https://tech.wazzup24.com/v2/channels', {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  })
  const payload = await response.json().catch(() => ({})) as { data?: Channel[]; error?: string; description?: string }
  if (!response.ok) throw new Error(payload.description || payload.error || `Wazzup channels error ${response.status}`)
  return Array.isArray(payload.data) ? payload.data : []
}

async function syncChannels(clinicId: string, channels: Channel[]) {
  if (!admin) throw new Error('Supabase admin client is not configured')
  const now = new Date().toISOString()
  const relevant = channels.filter(channel => channel.channel_id && channel.transport)
  const { error: deactivateError } = await admin
    .from('wz_channels')
    .update({ is_active: false, updated_at: now })
    .eq('clinic_id', clinicId)
  if (deactivateError) throw deactivateError
  if (relevant.length === 0) return

  const { error } = await admin.from('wz_channels').upsert(relevant.map(channel => ({
    clinic_id: clinicId,
    channel_id: channel.channel_id,
    chat_type: chatTypeForTransport(channel.transport),
    name: channel.name || channel.phone || channel.username || channel.channel_id,
    is_active: isActiveChannel(channel),
    updated_at: now,
  })), { onConflict: 'channel_id' })
  if (error) throw error
}

async function ensureWebhookSubscriptions(clinicId: string, accessToken: string) {
  const url = webhookUrl(clinicId)
  if (!url) throw new Error('WAZZUP_WEBHOOK_URL or WAZZUP_CRM_KEY is not configured')
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
  const listResponse = await httpRequest('https://tech.wazzup24.com/v2/webhooks', {
    headers,
    signal: AbortSignal.timeout(15_000),
  })
  const listPayload = await listResponse.json().catch(() => ({})) as { data?: WebhookSubscription[] }
  if (!listResponse.ok) throw new Error(`Wazzup webhook list error ${listResponse.status}`)
  const current = Array.isArray(listPayload.data) ? listPayload.data : []
  const existing = new Set(current.filter(item => item.url === url).map(item => item.event))
  const missing = WEBHOOK_EVENTS.filter(event => !existing.has(event))

  if (missing.length > 0) {
    const response = await httpRequest('https://tech.wazzup24.com/v2/webhooks', {
      method: 'POST',
      headers,
      body: JSON.stringify({ data: missing.map(event => ({ url, event })) }),
      signal: AbortSignal.timeout(15_000),
    })
    const payload = await response.json().catch(() => ({})) as { error?: string; description?: string }
    if (!response.ok) throw new Error(payload.description || payload.error || `Wazzup webhook create error ${response.status}`)
  }

  return WEBHOOK_EVENTS.map(event => ({ url, event }))
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!admin || !clientId || !redirectUri || !partnerEmail || !partnerPassword || !stateSecret || !credentialSecret) {
    return redirect(res, req, 'oauth-not-configured')
  }

  const code = typeof req.query.code === 'string' ? req.query.code : ''
  const state = typeof req.query.state === 'string' ? decryptState(req.query.state, stateSecret) : null
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

  let tokenResponse: HttpResponse
  try {
    tokenResponse = await httpRequest('https://tech.wazzup24.com/v2/oauth/token', {
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
    })
  } catch {
    return redirect(res, req, 'oauth-unavailable')
  }

  const tokenPayload = await tokenResponse.json().catch(() => ({})) as {
    data?: { access_token?: string; refresh_token?: string; expires_in?: number; refresh_expires_in?: number }
  }
  const tokens = tokenPayload.data
  if (!tokenResponse.ok || !tokens?.access_token || !tokens.refresh_token) return redirect(res, req, 'oauth-failed')

  let channels: Channel[] = []
  let channelSyncError: string | null = null
  try {
    channels = await fetchChannels(tokens.access_token)
    await syncChannels(state.clinicId, channels)
  } catch (error) {
    channelSyncError = error instanceof Error ? error.message : String(error)
  }

  let subscriptions: WebhookSubscription[] = []
  let webhookError: string | null = null
  try {
    subscriptions = await ensureWebhookSubscriptions(state.clinicId, tokens.access_token)
  } catch (error) {
    webhookError = error instanceof Error ? error.message : String(error)
  }

  const activeChannels = channels.filter(isActiveChannel)
  const now = new Date().toISOString()
  const access = encrypt(tokens.access_token, credentialSecret)
  const refresh = encrypt(tokens.refresh_token, credentialSecret)
  const safeChannels = channels.map(channel => ({
    channelId: channel.channel_id ?? null,
    transport: channel.transport ?? null,
    status: channel.status ?? channel.state ?? null,
    reason: channel.reason ?? null,
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
    access_token_expires_at: new Date(Date.now() + Number(tokens.expires_in || 86_400) * 1000).toISOString(),
    refresh_token_expires_at: new Date(Date.now() + Number(tokens.refresh_expires_in || 180 * 24 * 60 * 60) * 1000).toISOString(),
    channels: safeChannels,
    webhook_subscriptions: subscriptions,
    channel_sync_at: channelSyncError ? null : now,
    verified_at: activeChannels.length > 0 && !channelSyncError && !webhookError ? now : null,
    last_refresh_error: [channelSyncError, webhookError].filter(Boolean).join('; ') || null,
    updated_at: now,
  }, { onConflict: 'clinic_id' })
  if (connectionError) return redirect(res, req, 'oauth-save-failed')

  const connected = activeChannels.length > 0 && !channelSyncError && !webhookError
  const { error: integrationError } = await admin.from('clinic_integrations').upsert({
    clinic_id: state.clinicId,
    integration_id: 'wazzup',
    status: connected ? 'connected' : 'pending',
    verified_at: connected ? now : null,
    updated_at: now,
  }, { onConflict: 'clinic_id,integration_id' })
  if (integrationError) return redirect(res, req, 'oauth-save-failed')

  const note = connected
    ? 'Wazzup OAuth, channels and webhooks verified.'
    : [
        activeChannels.length === 0 ? 'OAuth completed without an active channel.' : null,
        channelSyncError ? `Channel sync failed: ${channelSyncError}` : null,
        webhookError ? `Webhook setup failed: ${webhookError}` : null,
      ].filter(Boolean).join(' ')

  await admin.from('integration_requests').update({
    status: connected ? 'approved' : 'in_review',
    admin_note: note,
    reviewed_at: now,
    updated_at: now,
  }).eq('clinic_id', state.clinicId).eq('integration_id', 'wazzup').in('status', ['requested', 'in_review'])

  if (connected) return redirect(res, req, 'connected')
  if (webhookError) return redirect(res, req, 'webhook-required')
  if (channelSyncError) return redirect(res, req, 'channel-sync-failed')
  return redirect(res, req, 'channel-required')
}
