import { assertClinicAccess, requireUser } from '../_shared/auth.ts';
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { normalizeChatId, wazzupFetch } from '../_shared/wazzup.ts';

const ATTACHMENT_BUCKET = 'wazzup-attachments';
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const MESSAGE_TYPES = new Set(['image', 'audio', 'video', 'document']);

Deno.serve(async req => {
  const options = handleOptions(req);
  if (options) return options;

  try {
    if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 });
    const { supabase, user } = await requireUser(req);
    const body = await req.json();
    const clinicId = String(body.clinicId || '');
    const channelId = String(body.channelId || '');
    const chatType = String(body.chatType || 'whatsapp');
    const chatId = normalizeChatId(body.chatId);
    const text = String(body.text || '').trim();
    const attachment = body.attachment && typeof body.attachment === 'object' ? body.attachment : null;

    if (!clinicId || !channelId || !chatId) {
      return jsonResponse({ error: 'clinicId, channelId and chatId are required' }, { status: 400 });
    }
    if ((!text && !attachment) || (text && attachment)) {
      return jsonResponse({ error: 'Send either text or one attachment' }, { status: 400 });
    }
    await assertClinicAccess(supabase, user.id, clinicId);

    const { data: channel, error: channelError } = await supabase
      .from('wz_channels')
      .select('channel_id')
      .eq('clinic_id', clinicId)
      .eq('channel_id', channelId)
      .eq('is_active', true)
      .maybeSingle();
    if (channelError) throw channelError;
    if (!channel) return jsonResponse({ error: 'Wazzup channel is not available for this workspace' }, { status: 403 });

    let contentUri: string | null = null;
    let storagePath: string | null = null;
    let fileName: string | null = null;
    let mimeType: string | null = null;
    let fileSize: number | null = null;
    let messageType = 'text';

    if (attachment) {
      storagePath = String(attachment.storagePath || '');
      fileName = String(attachment.fileName || '').trim().slice(0, 255);
      mimeType = String(attachment.mimeType || 'application/octet-stream').trim().slice(0, 255);
      fileSize = Number(attachment.fileSize || 0);
      messageType = String(attachment.messageType || 'document');

      if (!storagePath.startsWith(`${clinicId}/`) || storagePath.includes('..')) {
        return jsonResponse({ error: 'Invalid attachment path' }, { status: 400 });
      }
      if (!fileName || !Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_ATTACHMENT_SIZE) {
        return jsonResponse({ error: 'Attachment must be between 1 byte and 10 MB' }, { status: 400 });
      }
      if (!MESSAGE_TYPES.has(messageType)) {
        return jsonResponse({ error: 'Unsupported attachment type' }, { status: 400 });
      }

      const { data: signed, error: signedError } = await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .createSignedUrl(storagePath, 300, { download: fileName });
      if (signedError || !signed?.signedUrl) {
        throw signedError || new Error('Could not create attachment link');
      }
      contentUri = signed.signedUrl;
    }

    const crmMessageId = crypto.randomUUID();
    const messagePayload = {
      channelId,
      crmUserId: user.id,
      crmMessageId,
      chatId,
      chatType,
      ...(text ? { text } : { contentUri }),
    };
    const data = await wazzupFetch(clinicId, '/message', {
      method: 'POST',
      body: JSON.stringify(messagePayload),
    });

    const messageId = data?.messageId || data?.id || crmMessageId;
    await supabase.from('wz_messages').upsert({
      clinic_id: clinicId,
      message_id: messageId,
      channel_id: channelId,
      chat_type: chatType,
      chat_id: chatId,
      text: text || null,
      content_uri: contentUri,
      storage_path: storagePath,
      file_name: fileName,
      mime_type: mimeType,
      file_size: fileSize,
      msg_type: messageType,
      is_echo: true,
      status: 'sent',
      author_id: user.id,
      raw_payload: { ...(data ?? {}), negisAttachment: attachment || null },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'message_id' });

    return jsonResponse({ success: true, messageId });
  } catch (err) {
    if (err instanceof Response) return err;
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
});
