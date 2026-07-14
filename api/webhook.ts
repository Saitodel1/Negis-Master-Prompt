import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

type ChatRole = 'user' | 'assistant'
type ChatMessage = { role: ChatRole; content: string }

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN
const PHONE_ID = process.env.WHATSAPP_PHONE_ID
const VERIFY_TOKEN = process.env.VERIFY_TOKEN
const META_APP_SECRET = process.env.META_APP_SECRET
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null

export const config = {
  api: { bodyParser: false },
}

async function readRawBody(req: VercelRequest) {
  let raw = ''
  for await (const chunk of req as any) {
    raw += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
    if (raw.length > 1_000_000) throw new Error('Payload too large')
  }
  return raw
}

function validMetaSignature(raw: string, signature: string | string[] | undefined) {
  if (!META_APP_SECRET || typeof signature !== 'string') return false
  const expected = `sha256=${createHmac('sha256', META_APP_SECRET).update(raw).digest('hex')}`
  const received = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  return received.length === expectedBuffer.length && timingSafeEqual(received, expectedBuffer)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode']
    const challenge = req.query['hub.challenge']
    const token = req.query['hub.verify_token']
    const tokenValue = Array.isArray(token) ? token[0] : token
    const challengeValue = Array.isArray(challenge) ? challenge[0] : challenge

    if (mode === 'subscribe' && VERIFY_TOKEN && tokenValue === VERIFY_TOKEN) {
      return res.status(200).send(challengeValue || '')
    }

    return res.status(403).send('Forbidden')
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!META_APP_SECRET) {
    console.error('META_APP_SECRET is required to verify WhatsApp webhooks')
    return res.status(503).json({ error: 'Webhook verification is not configured' })
  }

  let rawBody: string
  let body: Record<string, any>
  try {
    rawBody = await readRawBody(req)
    body = rawBody ? JSON.parse(rawBody) : {}
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' })
  }

  if (!validMetaSignature(rawBody, req.headers['x-hub-signature-256'])) {
    return res.status(401).json({ error: 'Invalid webhook signature' })
  }

  if (body.object !== 'whatsapp') {
    return res.status(200).json({ ok: true })
  }

  const jobs: Promise<void>[] = []

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const messages = change.value?.messages
      if (!messages) continue

      for (const msg of messages) {
        const from = msg.from
        const text = msg.text?.body
        if (from && text) {
          jobs.push(handleMessage(from, text).catch(error => {
            console.error('whatsapp handleMessage error', error)
          }))
        }
      }
    }
  }

  if (jobs.length > 0) {
    await Promise.allSettled(jobs)
  }

  return res.status(200).json({ ok: true })
}

async function handleMessage(from: string, text: string) {
  const settings = await loadBotSettings()
  const history = await loadMessageHistory(from)
  await saveMessage(from, 'incoming', text)

  const reply = await callAI(
    settings.aiProvider,
    settings.aiModel,
    settings.aiApiKey,
    settings.systemPrompt,
    [...history, { role: 'user', content: text }],
  )

  await sendWhatsApp(from, reply)
  await saveMessage(from, 'outgoing', reply)
}

async function loadBotSettings() {
  const fallback = {
    systemPrompt: process.env.SYSTEM_PROMPT || 'Ты ассистент клиники. Отвечай кратко, уточняй услугу, имя, телефон и удобное время записи. Не ставь диагнозы.',
    aiProvider: process.env.AI_PROVIDER || 'deepseek',
    aiModel: process.env.AI_MODEL || 'deepseek-chat',
    aiApiKey: process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.AI_API_KEY || '',
  }

  if (!supabase) return fallback

  const { data, error } = await supabase
    .from('bot_settings')
    .select('key, value')
    .in('key', ['system_prompt', 'ai_provider', 'ai_model', 'ai_api_key'])

  if (error || !data) {
    if (error) console.error('bot_settings load error', error.message)
    return fallback
  }

  const values = Object.fromEntries((data as Array<{ key: string; value: string }>).map(row => [row.key, row.value]))

  return {
    systemPrompt: values.system_prompt || fallback.systemPrompt,
    aiProvider: values.ai_provider || fallback.aiProvider,
    aiModel: values.ai_model || fallback.aiModel,
    aiApiKey: values.ai_api_key || fallback.aiApiKey,
  }
}

async function loadMessageHistory(phone: string): Promise<ChatMessage[]> {
  if (!supabase) return []

  const { data, error } = await supabase
    .from('bot_messages')
    .select('direction, content')
    .eq('wa_phone', phone)
    .order('created_at', { ascending: false })
    .limit(10)

  if (error || !data) {
    if (error) console.error('bot_messages load error', error.message)
    return []
  }

  return data
    .reverse()
    .map((row: { direction: string; content: string }) => ({
      role: row.direction === 'outgoing' ? 'assistant' : 'user',
      content: row.content,
    }))
}

async function saveMessage(phone: string, direction: 'incoming' | 'outgoing', content: string) {
  if (!supabase) return

  const { error } = await supabase
    .from('bot_messages')
    .insert({
      wa_phone: phone,
      direction,
      content,
    })

  if (error) {
    console.error('bot_messages insert error', error.message)
  }
}

async function callAI(
  provider: string,
  model: string,
  apiKey: string,
  systemPrompt: string,
  messages: ChatMessage[],
) {
  if (!apiKey) {
    return 'Бот почти подключён. Администратору нужно добавить AI API ключ в настройках.'
  }

  if (provider === 'anthropic') {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 500,
        system: systemPrompt,
        messages,
      }),
    })

    const data = await (response as any).json()
    if (!(response as any).ok) {
      console.error('anthropic error', data)
      return 'Сейчас не удалось получить ответ ассистента. Менеджер скоро подключится.'
    }
    return data.content?.[0]?.text || 'Менеджер скоро ответит.'
  }

  const endpoint = provider === 'openai'
    ? 'https://api.openai.com/v1/chat/completions'
    : 'https://api.deepseek.com/v1/chat/completions'

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
      temperature: 0.7,
    }),
  })

  const data = await (response as any).json()
  if (!(response as any).ok) {
    console.error(`${provider} error`, data)
    return 'Сейчас не удалось получить ответ ассистента. Менеджер скоро подключится.'
  }

  return data.choices?.[0]?.message?.content || 'Менеджер скоро ответит.'
}

async function sendWhatsApp(to: string, text: string) {
  if (!WHATSAPP_TOKEN || !PHONE_ID) {
    console.error('WHATSAPP_TOKEN and WHATSAPP_PHONE_ID are required')
    return
  }

  const response = await fetch(`https://graph.facebook.com/v25.0/${PHONE_ID}/messages`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${WHATSAPP_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    }),
  })

  const data = await (response as any).json()
  if (!(response as any).ok) {
    console.error('whatsapp send error', data)
  }
}
