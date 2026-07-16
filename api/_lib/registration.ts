import nodemailer from 'nodemailer'

export type RegistrationError = {
  status: number
  code: string
  message: string
  field?: 'ownerName' | 'clinicName' | 'email' | 'password' | 'country' | 'businessType'
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateRegistration(input: {
  ownerName: string
  clinicName: string
  email: string
  password: string
  country: string
  businessType: string
}): RegistrationError | null {
  if (input.ownerName.length < 2) return { status: 400, code: 'INVALID_OWNER_NAME', field: 'ownerName', message: 'Укажите имя: минимум 2 символа.' }
  if (input.ownerName.length > 100) return { status: 400, code: 'INVALID_OWNER_NAME', field: 'ownerName', message: 'Имя слишком длинное: максимум 100 символов.' }
  if (input.clinicName.length < 2) return { status: 400, code: 'INVALID_BUSINESS_NAME', field: 'clinicName', message: 'Укажите название бизнеса: минимум 2 символа.' }
  if (input.clinicName.length > 160) return { status: 400, code: 'INVALID_BUSINESS_NAME', field: 'clinicName', message: 'Название бизнеса слишком длинное: максимум 160 символов.' }
  if (!emailPattern.test(input.email)) return { status: 400, code: 'INVALID_EMAIL', field: 'email', message: 'Проверьте email: адрес указан в неверном формате.' }
  if (input.email.length > 254) return { status: 400, code: 'INVALID_EMAIL', field: 'email', message: 'Email слишком длинный.' }
  if (input.password.length < 8) return { status: 400, code: 'WEAK_PASSWORD', field: 'password', message: 'Пароль должен содержать минимум 8 символов.' }
  if (input.password.length > 128) return { status: 400, code: 'INVALID_PASSWORD', field: 'password', message: 'Пароль слишком длинный: максимум 128 символов.' }
  if (!['KZ', 'KG'].includes(input.country)) return { status: 400, code: 'INVALID_COUNTRY', field: 'country', message: 'Выберите страну: Казахстан или Кыргызстан.' }
  if (!input.businessType) return { status: 400, code: 'INVALID_BUSINESS_TYPE', field: 'businessType', message: 'Выберите сферу бизнеса.' }
  return null
}

export function normalizeRegistrationError(error: unknown): RegistrationError {
  const raw = error instanceof Error ? error.message : String(error || '')
  const message = raw.toLowerCase()

  if (message.includes('already') || message.includes('duplicate') || message.includes('registered')) {
    return { status: 409, code: 'EMAIL_ALREADY_EXISTS', field: 'email', message: 'Аккаунт с таким email уже существует. Войдите или восстановите пароль.' }
  }
  if (message.includes('invalid email') || message.includes('email address')) {
    return { status: 400, code: 'INVALID_EMAIL', field: 'email', message: 'Проверьте email: адрес указан в неверном формате.' }
  }
  if (message.includes('password')) {
    return { status: 400, code: 'WEAK_PASSWORD', field: 'password', message: 'Пароль не соответствует требованиям. Используйте минимум 8 символов.' }
  }
  if (message.includes('rate limit') || message.includes('too many')) {
    return { status: 429, code: 'RATE_LIMITED', message: 'Слишком много попыток регистрации. Подождите несколько минут и попробуйте снова.' }
  }
  if (message.includes('timeout') || message.includes('aborted')) {
    return { status: 504, code: 'REGISTRATION_TIMEOUT', message: 'Сервер не успел завершить регистрацию. Попробуйте ещё раз через минуту.' }
  }

  return { status: 500, code: 'REGISTRATION_FAILED', message: 'Не удалось создать кабинет. Данные не потеряны: попробуйте ещё раз или напишите в negissupport@negis.online.' }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]!)
}

export async function sendWelcomeEmail(input: { ownerName: string; businessName: string; email: string }) {
  const password = process.env.ZOHO_SMTP_PASSWORD || process.env.SMTP_PASSWORD
  if (!password) return { sent: false, reason: 'SMTP_NOT_CONFIGURED' as const }

  const host = process.env.SMTP_HOST || 'smtp.zoho.com'
  const port = Number(process.env.SMTP_PORT || 465)
  const user = process.env.SMTP_USER || 'negissupport@negis.online'
  const from = process.env.SMTP_FROM || `Negis <${user}>`
  const ownerName = escapeHtml(input.ownerName)
  const businessName = escapeHtml(input.businessName)

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass: password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  })

  await transporter.sendMail({
    from,
    to: input.email,
    replyTo: 'negissupport@negis.online',
    subject: `${input.ownerName}, ваш кабинет Negis открыт`,
    text: `${input.ownerName}, поздравляем! Кабинет «${input.businessName}» в Negis успешно создан. Войти: https://crm.negis.online. Если понадобится помощь, ответьте на это письмо.`,
    html: `
      <div style="background:#f6f8fc;padding:32px;font-family:Inter,Arial,sans-serif;color:#17233f">
        <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e7ebf3;border-radius:20px;padding:32px">
          <div style="font-size:12px;font-weight:700;letter-spacing:.16em;color:#4f7bff">NEGIS</div>
          <h1 style="font-size:28px;line-height:1.2;margin:20px 0 12px">${ownerName}, кабинет открыт</h1>
          <p style="font-size:16px;line-height:1.65;color:#56627a">Поздравляем с созданием рабочего пространства <strong>«${businessName}»</strong> в Negis.</p>
          <a href="https://crm.negis.online" style="display:inline-block;margin-top:16px;padding:13px 20px;border-radius:10px;background:#315efb;color:#fff;text-decoration:none;font-weight:700">Открыть Negis</a>
          <p style="margin-top:28px;font-size:14px;line-height:1.6;color:#7a869d">Если понадобится помощь, просто ответьте на это письмо.<br>Команда Negis</p>
        </div>
      </div>`,
  })

  return { sent: true as const }
}
