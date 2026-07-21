import { supabase } from '@/lib/supabase';
import type {
  WazzupChannelSetupRequest,
  WazzupIframeUrlRequest,
  WazzupSendMessageRequest,
} from '@/types/wazzup';

export function normalizeWazzupChatId(value: string | null | undefined) {
  return (value ?? '').replace(/\D/g, '');
}

async function invokeWazzupFunction<T>(name: string, body: Record<string, any>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (error) throw new Error(formatWazzupError(await readFunctionError(error)));
  return data as T;
}

async function readFunctionError(error: any) {
  const response = error?.context;
  if (response instanceof Response) {
    try {
      const payload = await response.clone().json();
      if (typeof payload?.error === 'string') return payload.error;
      if (typeof payload?.message === 'string') return payload.message;
    } catch {
      try {
        const text = await response.clone().text();
        if (text) return text;
      } catch {
        // Fall through to the SDK error below.
      }
    }
  }
  return error?.message || 'Не удалось выполнить запрос Wazzup';
}

function formatWazzupError(message: string) {
  if (message.includes('SIZE_EXCEEDED') || message.includes('10 MB') || message.includes('10 МБ')) {
    return 'Файл слишком большой. Wazzup принимает вложения до 10 МБ.';
  }
  if (message.includes('WRONG_CONTENT_TYPE') || message.includes('UNSUPPORTED_CONTENT_TYPE')) {
    return 'WhatsApp или Wazzup не поддерживает этот формат файла.';
  }
  if (message.includes('DOWNLOAD_CONTENT_ERROR') || message.includes('download content')) {
    return 'Wazzup не смог скачать файл. Попробуйте отправить его ещё раз.';
  }
  if (message.includes('CHANNEL_BLOCKED') || message.includes('CHANNEL_UNAVAILABLE')) {
    return 'Канал WhatsApp сейчас недоступен. Проверьте подключение Wazzup.';
  }
  if (message.includes('WAZZUP_API_KEY')) {
    return 'Wazzup почти готов. Осталось добавить API-ключ Wazzup на сервере.';
  }
  if (message.includes('FunctionsHttpError') || message.includes('Edge Function')) {
    return 'Wazzup почти готов. Нужно проверить Supabase Edge Function для Wazzup.';
  }
  if (message.includes('not found') || message.includes('Function not found')) {
    return 'Wazzup почти готов. Нужно задеплоить Supabase Edge Functions.';
  }
  return message;
}

export async function fetchWazzupIframeUrl(request: WazzupIframeUrlRequest) {
  const payload = {
    ...request,
    contactPhone: normalizeWazzupChatId(request.contactPhone),
    chatType: request.chatType ?? 'whatsapp',
    scope: request.scope ?? 'card',
  };
  const data = await invokeWazzupFunction<{ url: string }>('wazzup-iframe-url', payload);
  if (!data?.url) throw new Error('Wazzup не вернул ссылку на чат');
  return data.url;
}

export async function fetchWazzupChannelSetupUrl(request: WazzupChannelSetupRequest) {
  const data = await invokeWazzupFunction<{ url: string }>('wazzup-iframe-url', {
    ...request,
    purpose: 'channel',
    transport: request.transport ?? 'whatsapp',
  });
  if (!data?.url) throw new Error('Wazzup не вернул ссылку для подключения канала');
  return data.url;
}

export async function sendWazzupMessage(request: WazzupSendMessageRequest) {
  return invokeWazzupFunction<{ success: boolean; messageId?: string }>('wazzup-send', {
    ...request,
    chatId: normalizeWazzupChatId(request.chatId),
    chatType: request.chatType ?? 'whatsapp',
  });
}
