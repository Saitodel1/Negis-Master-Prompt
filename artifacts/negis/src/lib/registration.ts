export type RegistrationResponse = {
  ok?: boolean
  userId?: string
  clinicId?: string
  welcomeEmailSent?: boolean
  code?: string
  error?: string
  field?: string
}

export async function readRegistrationResponse(response: Response): Promise<RegistrationResponse> {
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    return { error: response.ok ? undefined : 'Сервер регистрации вернул неверный ответ. Обновите страницу и попробуйте снова.' }
  }

  try {
    return await response.json() as RegistrationResponse
  } catch {
    return { error: 'Не удалось прочитать ответ сервера. Проверьте интернет и попробуйте снова.' }
  }
}

export function registrationNetworkError(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') return 'Регистрация заняла слишком много времени. Проверьте интернет и попробуйте снова.'
  if (error instanceof TypeError) return 'Не удалось связаться с сервером. Проверьте интернет и повторите попытку.'
  if (error instanceof Error && error.message.toLowerCase().includes('unauthorized')) return 'Сервер регистрации отклонил запрос. Обновите страницу и попробуйте снова или напишите в negissupport@negis.online.'
  return error instanceof Error && error.message ? error.message : 'Не удалось создать кабинет. Попробуйте ещё раз.'
}
