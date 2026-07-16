import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { normalizeRegistrationError, sendWelcomeEmail, validateRegistration } from '../_lib/registration'

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ code: 'METHOD_NOT_ALLOWED', error: 'Метод не поддерживается.' })
  if (!supabase) return res.status(503).json({ code: 'REGISTRATION_NOT_CONFIGURED', error: 'Регистрация временно недоступна: сервер не настроен. Напишите в negissupport@negis.online.' })

  const body = typeof req.body === 'object' && req.body ? req.body : {}
  const ownerName = String(body.ownerName || '').trim()
  const clinicName = String(body.clinicName || '').trim()
  const email = String(body.email || '').trim().toLowerCase()
  const password = String(body.password || '')
  const businessType = String(body.businessType || '')
  const industry = industryByBusinessType[businessType] || 'custom'
  const country = String(body.country || '')

  const validationError = validateRegistration({ ownerName, clinicName, email, password, country, businessType })
  if (validationError) return res.status(validationError.status).json({ code: validationError.code, error: validationError.message, field: validationError.field })

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

    let welcomeEmailSent = false
    try {
      welcomeEmailSent = (await sendWelcomeEmail({ ownerName, businessName: clinicName, email })).sent
    } catch (emailError) {
      console.error('Welcome email failed', { userId, clinicId, message: emailError instanceof Error ? emailError.message : String(emailError) })
    }

    return res.status(201).json({ ok: true, userId, clinicId, welcomeEmailSent })
  } catch (error: unknown) {
    if (clinicId) {
      await supabase.from('lead_statuses').delete().eq('clinic_id', clinicId)
      await supabase.from('user_roles').delete().eq('clinic_id', clinicId)
      await supabase.from('clinics').delete().eq('id', clinicId)
    }
    if (userId) await deleteAuthUser(userId)
    const normalized = normalizeRegistrationError(error)
    console.error('Registration failed', { code: normalized.code, message: error instanceof Error ? error.message : String(error) })
    return res.status(normalized.status).json({ code: normalized.code, error: normalized.message, field: normalized.field })
  }
}
