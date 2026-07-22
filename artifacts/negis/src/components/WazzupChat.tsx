import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileAudio, FileText, FileVideo, Image as ImageIcon, Loader2, MessageCircle, Paperclip, RefreshCw, Send, X } from 'lucide-react';
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
  storage_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  file_size: number | null;
  created_at: string;
}

const ATTACHMENT_BUCKET = 'wazzup-attachments';
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const MAX_FILES_PER_SEND = 10;

function formatFileSize(value: number | null | undefined) {
  if (!value) return '';
  if (value < 1024) return `${value} Б`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} КБ`;
  return `${(value / 1024 / 1024).toFixed(1)} МБ`;
}

function attachmentType(file: File) {
  if (file.type.startsWith('image/')) return 'image' as const;
  if (file.type.startsWith('audio/')) return 'audio' as const;
  if (file.type.startsWith('video/')) return 'video' as const;
  return 'document' as const;
}

function safeStorageName(value: string) {
  return value.normalize('NFKD').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').slice(-180) || 'attachment';
}

function safeMediaUrl(value: string | null | undefined) {
  if (!value) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function attachmentTitle(message: StoredMessage) {
  if (message.file_name) return message.file_name;
  if (message.msg_type === 'image') return 'Изображение';
  if (message.msg_type === 'audio') return 'Аудио';
  if (message.msg_type === 'video') return 'Видео';
  if (message.msg_type === 'vcard') return 'Контакт';
  if (message.msg_type === 'geo') return 'Геолокация';
  return 'Вложение';
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
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const endRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatId = useMemo(() => normalizeWazzupChatId(contactPhone), [contactPhone]);
  const storagePaths = useMemo(
    () => Array.from(new Set(messages.map(message => message.storage_path).filter((value): value is string => Boolean(value)))).sort(),
    [messages],
  );
  const storagePathsKey = storagePaths.join('|');

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
          .select('id, message_id, channel_id, chat_type, chat_id, text, content_uri, msg_type, is_echo, status, author_name, storage_path, file_name, mime_type, file_size, created_at')
          .eq('clinic_id', clinicId)
          .eq('chat_type', chatType)
          .eq('chat_id', chatId)
          .order('created_at', { ascending: false })
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
      const nextMessages = ((messageResult.data ?? []) as StoredMessage[]).reverse();
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

  useEffect(() => {
    let cancelled = false;
    if (!storagePaths.length) {
      setSignedUrls({});
      return;
    }

    void supabase.storage
      .from(ATTACHMENT_BUCKET)
      .createSignedUrls(storagePaths, 3600)
      .then(({ data }) => {
        if (cancelled) return;
        const next: Record<string, string> = {};
        for (const item of data ?? []) {
          if (item.path && item.signedUrl) next[item.path] = item.signedUrl;
        }
        setSignedUrls(next);
      });

    return () => {
      cancelled = true;
    };
  }, [storagePathsKey]);

  const addFiles = (files: FileList | File[]) => {
    const incoming = Array.from(files);
    const valid: File[] = [];
    for (const file of incoming) {
      if (file.size <= 0) {
        toast.error(`Файл «${file.name}» пустой`);
        continue;
      }
      if (file.size > MAX_ATTACHMENT_SIZE) {
        toast.error(`«${file.name}» больше 10 МБ`);
        continue;
      }
      valid.push(file);
    }
    setPendingFiles(current => {
      const available = Math.max(0, MAX_FILES_PER_SEND - current.length);
      if (valid.length > available) toast.error(`За один раз можно отправить не больше ${MAX_FILES_PER_SEND} файлов`);
      return [...current, ...valid.slice(0, available)];
    });
  };

  const sendMessage = async () => {
    const text = draft.trim();
    if ((!text && pendingFiles.length === 0) || sending || !chatId) return;
    if (!channelId) {
      toast.error('У организации нет активного канала Wazzup. Переподключите WhatsApp в Маркете.');
      return;
    }

    setSending(true);
    try {
      for (const file of [...pendingFiles]) {
        const storagePath = `${clinicId}/${chatType}/${chatId}/${crypto.randomUUID()}-${safeStorageName(file.name)}`;
        const { error: uploadError } = await supabase.storage
          .from(ATTACHMENT_BUCKET)
          .upload(storagePath, file, {
            contentType: file.type || 'application/octet-stream',
            upsert: false,
          });
        if (uploadError) throw uploadError;

        try {
          await sendWazzupMessage({
            clinicId,
            channelId,
            chatId,
            chatType,
            attachment: {
              storagePath,
              fileName: file.name,
              mimeType: file.type || 'application/octet-stream',
              fileSize: file.size,
              messageType: attachmentType(file),
            },
          });
        } catch (cause) {
          await supabase.storage.from(ATTACHMENT_BUCKET).remove([storagePath]);
          throw cause;
        }
        setPendingFiles(current => current.filter(item => item !== file));
      }

      if (text) {
        await sendWazzupMessage({ clinicId, channelId, chatId, chatType, text });
        setDraft('');
      }
      await loadMessages();
    } catch (cause: unknown) {
      toast.error(cause instanceof Error ? cause.message : 'Сообщение или файл не отправлены');
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
                  {(() => {
                    const mediaUrl = safeMediaUrl((message.storage_path && signedUrls[message.storage_path]) || message.content_uri);
                    if (!mediaUrl) return null;
                    const title = attachmentTitle(message);
                    const isImage = message.msg_type === 'image' || message.mime_type?.startsWith('image/');
                    const isAudio = message.msg_type === 'audio' || message.mime_type?.startsWith('audio/');
                    const isVideo = message.msg_type === 'video' || message.mime_type?.startsWith('video/');

                    if (isImage) {
                      return (
                        <a href={mediaUrl} target="_blank" rel="noreferrer" className="mt-1 block overflow-hidden rounded-xl">
                          <img src={mediaUrl} alt={title} loading="lazy" className="max-h-64 w-full object-contain" />
                        </a>
                      );
                    }
                    if (isAudio) {
                      return <audio src={mediaUrl} controls preload="metadata" className="mt-1 max-w-full" />;
                    }
                    if (isVideo) {
                      return <video src={mediaUrl} controls preload="metadata" className="mt-1 max-h-64 max-w-full rounded-xl" />;
                    }
                    return (
                      <a href={mediaUrl} target="_blank" rel="noreferrer" className={`mt-1 flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm ${message.is_echo ? 'border-white/25 text-white' : 'border-[#DCE4EE] text-[#3157DE]'}`}>
                        <FileText size={18} className="shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{title}</span>
                          {message.file_size ? <span className={`block text-xs ${message.is_echo ? 'text-white/70' : 'text-[#94A3B8]'}`}>{formatFileSize(message.file_size)}</span> : null}
                        </span>
                        <Download size={16} className="shrink-0" />
                      </a>
                    );
                  })()}
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

      <div
        className="border-t border-[#E7ECF3] bg-white p-3"
        onDragOver={event => event.preventDefault()}
        onDrop={event => {
          event.preventDefault();
          addFiles(event.dataTransfer.files);
        }}
      >
        {pendingFiles.length > 0 && (
          <div className="mb-2 flex max-h-24 flex-wrap gap-2 overflow-y-auto">
            {pendingFiles.map((file, index) => {
              const type = attachmentType(file);
              const Icon = type === 'image' ? ImageIcon : type === 'audio' ? FileAudio : type === 'video' ? FileVideo : FileText;
              return (
                <div key={`${file.name}-${file.size}-${index}`} className="flex max-w-full items-center gap-2 rounded-xl border border-[#DCE4EE] bg-[#F8FAFC] px-2.5 py-2 text-xs text-[#10264B]">
                  <Icon size={15} className="shrink-0 text-[#3157DE]" />
                  <span className="max-w-48 truncate">{file.name}</span>
                  <span className="shrink-0 text-[#94A3B8]">{formatFileSize(file.size)}</span>
                  <button type="button" onClick={() => setPendingFiles(current => current.filter((_, itemIndex) => itemIndex !== index))} disabled={sending} className="grid h-5 w-5 place-items-center rounded text-[#64748B] hover:text-[#DC2626]" title="Убрать файл" aria-label={`Убрать ${file.name}`}>
                    <X size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={event => {
              if (event.target.files) addFiles(event.target.files);
              event.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending || !channelId}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[#DCE4EE] bg-white text-[#64748B] transition hover:border-[#3157DE] hover:text-[#3157DE] disabled:cursor-not-allowed disabled:opacity-40"
            title="Прикрепить файлы до 10 МБ"
            aria-label="Прикрепить файлы"
          >
            <Paperclip size={18} />
          </button>
          <textarea
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void sendMessage();
              }
            }}
            onPaste={event => {
              const files = Array.from(event.clipboardData.items)
                .filter(item => item.kind === 'file')
                .map(item => item.getAsFile())
                .filter((file): file is File => Boolean(file));
              if (files.length) addFiles(files);
            }}
            maxLength={4000}
            rows={1}
            placeholder="Напишите сообщение..."
            className="min-h-11 max-h-28 flex-1 resize-y rounded-xl border border-[#DCE4EE] bg-[#F8FAFC] px-3.5 py-2.5 text-sm text-[#10264B] outline-none transition focus:border-[#3157DE] focus:ring-2 focus:ring-[#3157DE]/10"
          />
          <button
            type="button"
            onClick={() => void sendMessage()}
            disabled={(!draft.trim() && pendingFiles.length === 0) || sending || !channelId}
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
