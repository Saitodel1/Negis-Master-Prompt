import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Loader2, MessageCircle, RefreshCw, Send } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { normalizeWazzupChatId, sendWazzupMessage } from '@/lib/wazzup';
import type { WazzupChatType, WazzupIframeEvent } from '@/types/wazzup';

interface WazzupChatProps {
  clinicId: string;
  userId: string;
  userName?: string;
  contactPhone: string | null;
  contactName: string;
  leadId?: string;
  chatType?: WazzupChatType;
  onDealCreate?: (data: WazzupIframeEvent) => void;
  onDealOpen?: (data: WazzupIframeEvent) => void;
}

interface StoredMessage {
  id: string;
  message_id: string;
  channel_id: string;
  chat_type: string;
  chat_id: string;
  text: string | null;
  content_uri: string | null;
  msg_type: string;
  is_echo: boolean;
  status: string | null;
  author_name: string | null;
  created_at: string;
}

function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function mergeMessage(current: StoredMessage[], incoming: StoredMessage) {
  const existingIndex = current.findIndex(message => message.id === incoming.id || message.message_id === incoming.message_id);
  if (existingIndex === -1) return [...current, incoming].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const next = [...current];
  next[existingIndex] = incoming;
  return next.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export function WazzupChat({
  clinicId,
  contactPhone,
  contactName,
  chatType = 'whatsapp',
}: WazzupChatProps) {
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [channelId, setChannelId] = useState('');
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);
  const chatId = useMemo(() => normalizeWazzupChatId(contactPhone), [contactPhone]);

  const loadMessages = useCallback(async () => {
    if (!chatId) {
      setMessages([]);
      setChannelId('');
      setError('У контакта не указан номер WhatsApp.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const [messageResult, channelResult] = await Promise.all([
        supabase
          .from('wz_messages')
          .select('id, message_id, channel_id, chat_type, chat_id, text, content_uri, msg_type, is_echo, status, author_name, created_at')
          .eq('clinic_id', clinicId)
          .eq('chat_type', chatType)
          .eq('chat_id', chatId)
          .order('created_at', { ascending: true })
          .limit(200),
        supabase
          .from('wz_channels')
          .select('channel_id')
          .eq('clinic_id', clinicId)
          .eq('chat_type', chatType)
          .eq('is_active', true)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (messageResult.error) throw messageResult.error;
      const nextMessages = (messageResult.data ?? []) as StoredMessage[];
      setMessages(nextMessages);
      setChannelId(nextMessages.at(-1)?.channel_id || channelResult.data?.channel_id || '');
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Не удалось загрузить переписку WhatsApp.');
    } finally {
      setLoading(false);
    }
  }, [chatId, chatType, clinicId]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    if (!chatId) return;
    const realtime = supabase
      .channel(`wazzup-card:${clinicId}:${chatType}:${chatId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'wz_messages', filter: `clinic_id=eq.${clinicId}` },
        payload => {
          const incoming = payload.new as StoredMessage;
          if (incoming.chat_type !== chatType || normalizeWazzupChatId(incoming.chat_id) !== chatId) return;
          setMessages(current => mergeMessage(current, incoming));
          setChannelId(current => current || incoming.channel_id);
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'wz_messages', filter: `clinic_id=eq.${clinicId}` },
        payload => {
          const incoming = payload.new as StoredMessage;
          if (incoming.chat_type !== chatType || normalizeWazzupChatId(incoming.chat_id) !== chatId) return;
          setMessages(current => mergeMessage(current, incoming));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(realtime);
    };
  }, [chatId, chatType, clinicId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const sendMessage = async () => {
    const text = draft.trim();
    if (!text || sending || !chatId) return;
    if (!channelId) {
      toast.error('У организации нет активного канала Wazzup. Переподключите WhatsApp в Маркете.');
      return;
    }

    setSending(true);
    try {
      await sendWazzupMessage({ clinicId, channelId, chatId, chatType, text });
      setDraft('');
      await loadMessages();
    } catch (cause: unknown) {
      toast.error(cause instanceof Error ? cause.message : 'Сообщение не отправлено');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-[560px] flex-col overflow-hidden rounded-xl border border-[#E7ECF3] bg-[#F8FAFC]">
      <div className="flex items-center justify-between border-b border-[#E7ECF3] bg-white px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[#10264B]">{contactName}</p>
          <p className="text-xs text-[#71829D]">+{chatId}</p>
        </div>
        <button
          type="button"
          onClick={() => void loadMessages()}
          disabled={loading}
          className="grid h-9 w-9 place-items-center rounded-xl border border-[#E3EAF2] bg-white text-[#64748B] transition-colors hover:text-[#3157DE] disabled:opacity-50"
          title="Обновить переписку"
          aria-label="Обновить переписку"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-[#64748B]">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Загружаем переписку...
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <MessageCircle className="h-8 w-8 text-[#94A3B8]" />
            <p className="text-sm font-semibold text-[#10264B]">Переписка не загрузилась</p>
            <p className="max-w-md text-sm text-[#64748B]">{error}</p>
            <button type="button" onClick={() => void loadMessages()} className="rounded-xl bg-[#1E325C] px-4 py-2 text-sm font-semibold text-white">
              Повторить
            </button>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <MessageCircle className="h-8 w-8 text-[#94A3B8]" />
            <p className="text-sm font-semibold text-[#10264B]">Сообщений пока нет</p>
            <p className="max-w-sm text-sm text-[#71829D]">Первое сообщение появится здесь сразу после получения или отправки.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map(message => (
              <div key={message.id} className={`flex ${message.is_echo ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 shadow-sm ${message.is_echo ? 'rounded-br-md bg-[#3157DE] text-white' : 'rounded-bl-md border border-[#E3EAF2] bg-white text-[#10264B]'}`}>
                  {message.text && <p className="whitespace-pre-wrap break-words text-sm leading-5">{message.text}</p>}
                  {message.content_uri && (
                    <a href={message.content_uri} target="_blank" rel="noreferrer" className={`mt-1 flex items-center gap-1.5 text-sm underline ${message.is_echo ? 'text-white' : 'text-[#3157DE]'}`}>
                      <FileText size={14} />
                      Открыть вложение
                    </a>
                  )}
                  <div className={`mt-1 flex items-center justify-end gap-2 text-[11px] ${message.is_echo ? 'text-white/75' : 'text-[#94A3B8]'}`}>
                    <span>{formatMessageTime(message.created_at)}</span>
                    {message.is_echo && message.status && <span>{message.status}</span>}
                  </div>
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <div className="border-t border-[#E7ECF3] bg-white p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void sendMessage();
              }
            }}
            maxLength={4000}
            rows={1}
            placeholder="Напишите сообщение..."
            className="min-h-11 max-h-28 flex-1 resize-y rounded-xl border border-[#DCE4EE] bg-[#F8FAFC] px-3.5 py-2.5 text-sm text-[#10264B] outline-none transition focus:border-[#3157DE] focus:ring-2 focus:ring-[#3157DE]/10"
          />
          <button
            type="button"
            onClick={() => void sendMessage()}
            disabled={!draft.trim() || sending || !channelId}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#3157DE] text-white transition hover:bg-[#264BC7] disabled:cursor-not-allowed disabled:opacity-40"
            title="Отправить"
            aria-label="Отправить сообщение"
          >
            {sending ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
          </button>
        </div>
      </div>
    </div>
  );
}
