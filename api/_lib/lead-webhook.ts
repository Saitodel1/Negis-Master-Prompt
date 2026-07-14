import { timingSafeEqual } from 'node:crypto'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('SUPABASE_URL/VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
}

const supabase = createClient(supabaseUrl, serviceRoleKey)

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function secretsMatch(received: string | undefined, expected: string | null | undefined) {
  if (!received || !expected) return false
  const receivedBuffer = Buffer.from(received)
  const expectedBuffer = Buffer.from(expected)
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer)
}

async function readBody(req: VercelRequest): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body
  if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
    const raw = req.body.toString()
    return raw ? JSON.parse(raw) : {}
  }

  let raw = ''
  for await (const chunk of req as any) raw += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
  return raw ? JSON.parse(raw) : {}
}

function nullableText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized ? normalized.slice(0, maxLength) : null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const clinicId = headerValue(req.query.clinicId)
  if (!clinicId) return res.status(400).json({ error: 'clinic_id is required' })

  const { data: organization, error: organizationError } = await supabase
    .from('clinics')
    .select('webhook_secret')
    .eq('id', clinicId)
    .maybeSingle()

  if (organizationError) return res.status(500).json({ error: organizationError.message })

  const suppliedSecret = headerValue(req.headers['x-negis-webhook-secret']) ?? headerValue(req.headers['x-webhook-secret'])
  if (!secretsMatch(suppliedSecret, organization?.webhook_secret)) {
    return res.status(401).json({ error: 'Invalid webhook secret' })
  }

  let body: Record<string, unknown>
  try {
    body = await readBody(req)
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' })
  }

  const phone = nullableText(body.phone, 40)
  const normalizedPhone = phone?.replace(/\D/g, '') ?? ''
  if (normalizedPhone.length < 7 || normalizedPhone.length > 20) {
    return res.status(400).json({ error: 'A valid phone number is required' })
  }

  const fullName = nullableText(body.full_name, 200)
  const email = nullableText(body.email, 320)
  const source = nullableText(body.source, 100) ?? 'webhook'
  const pipeline = body.pipeline === 'sales' ? 'sales' : 'booking'

  let { data: defaultStatus, error: statusError } = await supabase
    .from('lead_statuses')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('pipeline', pipeline)
    .order('sort_order', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (statusError) return res.status(500).json({ error: statusError.message })

  if (!defaultStatus?.id) {
    const { data, error } = await supabase
      .from('lead_statuses')
      .insert({ clinic_id: clinicId, pipeline, name: 'Новый', color: '#3B82F6', sort_order: 0 })
      .select('id')
      .single()
    if (error) return res.status(500).json({ error: error.message })
    defaultStatus = data
  }

  const { data, error } = await supabase
    .from('leads')
    .insert({
      clinic_id: clinicId,
      pipeline,
      full_name: fullName,
      phone,
      email,
      source,
      status_id: defaultStatus.id,
      phone_normalized: normalizedPhone,
    })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ success: true, lead: data })
}
