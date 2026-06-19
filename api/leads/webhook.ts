import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('SUPABASE_URL/VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
}

const supabase = createClient(supabaseUrl, serviceRoleKey)

async function readBody(req: VercelRequest): Promise<Record<string, any>> {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body
  }

  if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
    const value = req.body.toString()
    return value ? JSON.parse(value) : {}
  }

  let raw = ''
  for await (const chunk of req as any) {
    raw += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
  }

  return raw ? JSON.parse(raw) : {}
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { clinicId } = req.query
  let body: Record<string, any>
  try {
    body = await readBody(req)
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' })
  }

  const { full_name, phone, email, source, pipeline } = body
  const clinicIdValue = Array.isArray(clinicId) ? clinicId[0] : clinicId
  const leadPipeline = pipeline === 'sales' ? 'sales' : 'booking'
  const normalizedPhone = String(phone || '').replace(/\D/g, '')

  if (!clinicIdValue || !normalizedPhone) {
    return res.status(400).json({ error: 'clinic_id and phone are required' })
  }

  let { data: defaultStatus, error: statusError } = await supabase
    .from('lead_statuses')
    .select('id')
    .eq('clinic_id', clinicIdValue)
    .eq('pipeline', leadPipeline)
    .order('sort_order', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (statusError) {
    return res.status(500).json({ error: statusError.message })
  }

  if (!defaultStatus?.id) {
    const { data: createdStatus, error: createStatusError } = await supabase
      .from('lead_statuses')
      .insert({
        clinic_id: clinicIdValue,
        pipeline: leadPipeline,
        name: '\u041d\u043e\u0432\u044b\u0439',
        color: '#3B82F6',
        sort_order: 0,
      })
      .select('id')
      .single()

    if (createStatusError) {
      return res.status(500).json({ error: createStatusError.message })
    }

    defaultStatus = createdStatus
  }

  const { data, error } = await supabase
    .from('leads')
    .insert({
      clinic_id: clinicIdValue,
      pipeline: leadPipeline,
      full_name: full_name || null,
      phone,
      email: email || null,
      source: source || 'webhook',
      status_id: defaultStatus.id,
      phone_normalized: normalizedPhone,
    })
    .select()
    .single()

  if (error) {
    return res.status(500).json({ error: error.message })
  }

  return res.status(200).json({ success: true, lead: data })
}
