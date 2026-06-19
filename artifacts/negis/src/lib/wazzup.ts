import { supabase } from '@/lib/supabase';
import type { WazzupIframeUrlRequest, WazzupSendMessageRequest } from '@/types/wazzup';

export function normalizeWazzupChatId(value: string | null | undefined) {
  return (value ?? '').replace(/\D/g, '');
}

async function invokeWazzupFunction<T>(name: string, body: Record<string, any>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (error) throw new Error(formatWazzupError(error.message));
  return data as T;
}

function formatWazzupError(message: string) {
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

export async function sendWazzupMessage(request: WazzupSendMessageRequest) {
  return invokeWazzupFunction<{ success: boolean; messageId?: string }>('wazzup-send', {
    ...request,
    chatId: normalizeWazzupChatId(request.chatId),
    chatType: request.chatType ?? 'whatsapp',
  });
}
