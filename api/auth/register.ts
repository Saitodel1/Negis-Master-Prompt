import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

type Industry = 'clinic' | 'beauty' | 'fitness' | 'education' | 'custom'

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = supabaseUrl && serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : null
type AuthApiResponse = { ok: boolean; json(): Promise<unknown> }

const industryByBusinessType: Record<string, Industry> = {
  private_clinic: 'clinic', dentistry: 'clinic', medcenter: 'clinic',
  cosmetology: 'beauty', beauty_salon: 'beauty', barbershop: 'beauty', spa_massage: 'beauty',
  fitness_wellness: 'fitness', education_courses: 'education', other: 'custom',
}

const defaultStatuses: Record<Industry, string[]> = {
  clinic: ['Новый', 'Консультация', 'Записан', 'Пришел', 'Оплатил', 'Потерян'],
  beauty: ['Новый', 'Консультация', 'Записан', 'Пришел', 'Купил услугу', 'Потерян'],
  fitness: ['Новый', 'Пробная тренировка', 'Купил абонемент', 'Активный', 'Ушел'],
  education: ['Новый', 'Консультация', 'Пробный урок', 'Оплатил курс', 'Учится', 'Потерян'],
  custom: ['Новый', 'В работе', 'Записан', 'Оплатил', 'Повторный контакт', 'Потерян'],
}

const bookingStatuses = ['Новый', 'Нужно записать', 'Записан', 'Недозвон', 'Отмена']
const statusColors = ['#3B82F6', '#F59E0B', '#22C55E', '#8B5CF6', '#06B6D4', '#EF4444']

function slugify(value: string) {
  const base = value.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  return `${base || 'business'}-${Math.random().toString(36).slice(2, 7)}`
}

async function createAuthUser(email: string, password: string, ownerName: string) {
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey!,
      Authorization: `Bearer ${serviceRoleKey!}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: ownerName } }),
    signal: AbortSignal.timeout(15_000),
  }) as unknown as AuthApiResponse
  const payload = await response.json().catch(() => null) as { id?: string; message?: string; msg?: string } | null
  if (!response.ok || !payload?.id) throw new Error(payload?.message || payload?.msg || 'Failed to create user')
  return payload.id
}

async function deleteAuthUser(userId: string) {
  await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: { apikey: serviceRoleKey!, Authorization: `Bearer ${serviceRoleKey!}` },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined)
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Registration failed'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!supabase) return res.status(503).json({ error: 'Registration is not configured on the server' })

  const body = typeof req.body === 'object' && req.body ? req.body : {}
  const ownerName = String(body.ownerName || '').trim()
  const clinicName = String(body.clinicName || '').trim()
  const email = String(body.email || '').trim().toLowerCase()
  const password = String(body.password || '')
  const businessType = String(body.businessType || 'private_clinic')
  const industry = industryByBusinessType[businessType] || 'clinic'
  const country = body.country === 'KG' ? 'KG' : 'KZ'

  if (!ownerName || !clinicName || !email || !password) return res.status(400).json({ error: 'ownerName, clinicName, email and password are required' })
  if (!email.includes('@') || password.length < 8) return res.status(400).json({ error: 'Invalid email or password' })

  let userId: string | null = null
  let clinicId: string | null = null
  try {
    userId = await createAuthUser(email, password, ownerName)

    const { data: clinic, error: clinicError } = await supabase
      .from('clinics')
      .insert({ name: clinicName, owner_id: userId, slug: slugify(clinicName), industry, business_type: businessType, country })
      .select('id')
      .single()
    if (clinicError || !clinic?.id) throw clinicError || new Error('Failed to create workspace')
    clinicId = clinic.id

    const { error: roleError } = await supabase.from('user_roles').insert({ user_id: userId, clinic_id: clinicId, role: 'owner' })
    if (roleError) throw roleError

    const rows = [
      ...defaultStatuses[industry].map((name, sort_order) => ({
        clinic_id: clinicId, name, sort_order, pipeline: 'sales', color: statusColors[sort_order % statusColors.length],
      })),
      ...bookingStatuses.map((name, sort_order) => ({
        clinic_id: clinicId, name, sort_order, pipeline: 'booking', color: statusColors[sort_order % statusColors.length],
      })),
    ]
    const { error: statusesError } = await supabase.from('lead_statuses').insert(rows)
    if (statusesError) throw statusesError

    return res.status(201).json({ ok: true, userId, clinicId })
  } catch (error: unknown) {
    if (clinicId) {
      await supabase.from('lead_statuses').delete().eq('clinic_id', clinicId)
      await supabase.from('user_roles').delete().eq('clinic_id', clinicId)
      await supabase.from('clinics').delete().eq('id', clinicId)
    }
    if (userId) await deleteAuthUser(userId)
    return res.status(500).json({ error: errorMessage(error) })
  }
}
