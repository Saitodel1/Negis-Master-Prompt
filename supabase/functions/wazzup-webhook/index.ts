import { adminClient, bearerToken } from '../_shared/auth.ts';
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { wazzupTechFetch } from '../_shared/wazzup.ts';
import {
  cleanWazzupContactName,
  isPhoneLikeContactName,
  WAZZUP_FALLBACK_CONTACT_NAME,
} from '../_shared/wazzup-contact.ts';

type AdminClient = ReturnType<typeof adminClient>;

const ATTACHMENT_BUCKET = 'wazzup-attachments';
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

type NormalizedMessage = {
  messageId: string;
  channelId: string;
  chatType: string;
  chatId: string;
  contactName: string | null;
  contactPhone: string | null;
  avatarUri: string | null;
  text: string | null;
  contentUri: string | null;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  messageType: string;
  isEcho: boolean;
  status: string;
  authorId: string | null;
  authorName: string | null;
  error: unknown;
  createdAt: string;
  rawPayload: unknown;
};

function webhookKeyMatches(req: Request) {
  const expected = Deno.env.get('WAZZUP_OAUTH_CRM_KEY');
  if (!expected) return false;
  const url = new URL(req.url);
  const provided = [
    bearerToken(req),
    req.headers.get('x-wazzup-crm-key'),
    url.searchParams.get('key'),
  ].filter((value): value is string => Boolean(value));
  return provided.includes(expected);
}

function fallbackClinicId(req: Request) {
  return new URL(req.url).searchParams.get('clinic_id');
}

async function clinicIdForChannel(supabase: AdminClient, channelId: string, fallback: string | null) {
  if (channelId) {
    const { data } = await supabase
      .from('wz_channels')
      .select('clinic_id')
      .eq('channel_id', channelId)
      .maybeSingle();
    if (data?.clinic_id) return data.clinic_id as string;
  }
  return fallback;
}

function eventItems(body: any) {
  if (Array.isArray(body?.data)) return body.data;
  return body?.data ? [body.data] : [];
}

function timestampToIso(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(milliseconds);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  if (typeof value === 'string' && value) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

function messageType(mimeType: string | null, explicitType?: unknown) {
  const explicit = typeof explicitType === 'string' ? explicitType : '';
  if (explicit && explicit !== 'file') return explicit;
  if (mimeType?.startsWith('image/')) return 'image';
  if (mimeType?.startsWith('audio/')) return 'audio';
  if (mimeType?.startsWith('video/')) return 'video';
  return mimeType ? 'document' : 'text';
}

function safeStorageSegment(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(-180) || 'attachment';
}

function extensionForMimeType(mimeType: string | null) {
  const normalized = mimeType?.split(';', 1)[0]?.trim().toLowerCase();
  const extensions: Record<string, string> = {
    'audio/aac': '.aac',
    'audio/m4a': '.m4a',
    'audio/mp4': '.m4a',
    'audio/mpeg': '.mp3',
    'audio/ogg': '.ogg',
    'audio/opus': '.opus',
    'audio/webm': '.webm',
    'image/gif': '.gif',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
  };
  return normalized ? extensions[normalized] || '' : '';
}

async function archiveIncomingAttachment(
  supabase: AdminClient,
  clinicId: string,
  message: NormalizedMessage,
) {
  if (!message.contentUri || message.isEcho || message.messageType === 'text') return null;

  let sourceUrl: URL;
  try {
    sourceUrl = new URL(message.contentUri);
  } catch {
    return 'attachment URL is invalid';
  }
  if (sourceUrl.protocol !== 'https:') return 'attachment URL must use HTTPS';

  try {
    const response = await fetch(sourceUrl, { redirect: 'follow' });
    if (!response.ok) return `attachment download failed with HTTP ${response.status}`;

    const declaredSize = Number(response.headers.get('content-length') || message.fileSize || 0);
    if (declaredSize > MAX_ATTACHMENT_SIZE) return 'attachment exceeds the 10 MB limit';

    const content = await response.arrayBuffer();
    if (content.byteLength <= 0) return 'attachment is empty';
    if (content.byteLength > MAX_ATTACHMENT_SIZE) return 'attachment exceeds the 10 MB limit';

    const mimeType = message.mimeType || response.headers.get('content-type')?.split(';', 1)[0] || 'application/octet-stream';
    const fallbackName = `${message.messageType}-${message.messageId}${extensionForMimeType(mimeType)}`;
    const fileName = safeStorageSegment(message.fileName || fallbackName);
    const storagePath = [
      safeStorageSegment(clinicId),
      safeStorageSegment(message.chatType),
      safeStorageSegment(message.chatId),
      `${safeStorageSegment(message.messageId)}-${fileName}`,
    ].join('/');

    const { error: uploadError } = await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .upload(storagePath, content, { contentType: mimeType, upsert: true });
    if (uploadError) return `attachment upload failed: ${uploadError.message}`;

    const { error: updateError } = await supabase
      .from('wz_messages')
      .update({
        storage_path: storagePath,
        file_name: message.fileName || fileName,
        mime_type: mimeType,
        file_size: content.byteLength,
        updated_at: new Date().toISOString(),
      })
      .eq('message_id', message.messageId);
    return updateError ? `attachment metadata update failed: ${updateError.message}` : null;
  } catch (cause) {
    return cause instanceof Error ? `attachment archive failed: ${cause.message}` : 'attachment archive failed';
  }
}

function normalizeLabelMessage(message: any): NormalizedMessage {
  const recipient = message.recipient || {};
  const sender = message.sender || {};
  const attachment = message.attachment || {};
  const mimeType = attachment.mimetype || null;
  const chatId = String(recipient.chat_id || message.chat_id || recipient.phone || '');
  const chatType = String(recipient.chat_type || message.chat_type || 'whatsapp');
  const contactPhone = recipient.phone || (['whatsapp', 'whatsgroup'].includes(chatType) ? chatId : null);
  const contactName = cleanWazzupContactName([
    recipient.name,
    recipient.crm_contact_name,
    message.contact_name,
    message.contactName,
  ], [contactPhone, chatId]);
  const isEcho = message.direction === 'outbound';
  return {
    messageId: String(message.message_id || ''),
    channelId: String(message.channel_id || ''),
    chatType,
    chatId,
    contactName,
    contactPhone,
    avatarUri: recipient.avatar || recipient.avatar_uri || null,
    text: message.text || null,
    contentUri: attachment.url || null,
    fileName: attachment.name || null,
    mimeType,
    fileSize: Number(attachment.size) || null,
    messageType: messageType(mimeType, message.type),
    isEcho,
    status: message.status || (isEcho ? 'sent' : 'inbound'),
    authorId: message.crm_user_id || sender.id || null,
    authorName: sender.name || null,
    error: message.reason ? { reason: message.reason } : null,
    createdAt: timestampToIso(message.timestamp),
    rawPayload: message,
  };
}

async function applyProfileNameToCrm(
  supabase: AdminClient,
  clinicId: string,
  wzContactId: string,
  chatType: string,
  chatId: string,
  phone: string | null,
  profileName: string | null,
  crmLink: any,
) {
  if (!profileName) return;

  const [contactUpdate, messageUpdate] = await Promise.all([
    supabase
      .from('wz_contacts')
      .update({ name: profileName, updated_at: new Date().toISOString() })
      .eq('id', wzContactId)
      .eq('clinic_id', clinicId),
    supabase
      .from('wz_messages')
      .update({ contact_name: profileName, updated_at: new Date().toISOString() })
      .eq('clinic_id', clinicId)
      .eq('chat_type', chatType)
      .eq('chat_id', chatId),
  ]);
  if (contactUpdate.error) throw contactUpdate.error;
  if (messageUpdate.error) throw messageUpdate.error;

  const contactId = crmLink?.contact_id ? String(crmLink.contact_id) : '';
  if (!contactId) return;

  const { data: crmContact, error: contactError } = await supabase
    .from('contacts')
    .select('first_name, phone')
    .eq('id', contactId)
    .eq('clinic_id', clinicId)
    .maybeSingle();
  if (contactError) throw contactError;

  const currentName = String(crmContact?.first_name || '').trim();
  const shouldReplace = !currentName
    || currentName === 'Без имени'
    || currentName === WAZZUP_FALLBACK_CONTACT_NAME
    || isPhoneLikeContactName(currentName, [crmContact?.phone, phone, chatId]);

  if (shouldReplace && currentName !== profileName) {
    const { error } = await supabase
      .from('contacts')
      .update({ first_name: profileName, updated_at: new Date().toISOString() })
      .eq('id', contactId)
      .eq('clinic_id', clinicId);
    if (error) throw error;
  }

  const dealId = crmLink?.deal_id ? String(crmLink.deal_id) : '';
  if (!dealId) return;

  const { data: deal, error: dealError } = await supabase
    .from('deals')
    .select('title, source')
    .eq('id', dealId)
    .eq('clinic_id', clinicId)
    .maybeSingle();
  if (dealError) throw dealError;

  const title = String(deal?.title || '').trim();
  const titleBase = title.replace(/\s+[—-]\s+Wazzup$/i, '').trim();
  const placeholderTitle = deal?.source === 'Wazzup'
    && (titleBase === WAZZUP_FALLBACK_CONTACT_NAME || isPhoneLikeContactName(titleBase, [phone, chatId]));
  if (placeholderTitle) {
    const { error } = await supabase
      .from('deals')
      .update({ title: `${profileName} — Wazzup`, updated_at: new Date().toISOString() })
      .eq('id', dealId)
      .eq('clinic_id', clinicId);
    if (error) throw error;
  }
}

async function saveMessage(supabase: AdminClient, message: NormalizedMessage, fallback: string | null) {
  if (!message.messageId || !message.channelId || !message.chatId) {
    return { saved: false as const, reason: 'missing messageId/channelId/chatId' };
  }

  const clinicId = await clinicIdForChannel(supabase, message.channelId, fallback);
  if (!clinicId) return { saved: false as const, reason: 'workspace not resolved for channelId' };

  const now = new Date().toISOString();
  const contactPayload: Record<string, unknown> = {
    clinic_id: clinicId,
    chat_type: message.chatType,
    chat_id: message.chatId,
    updated_at: now,
  };
  if (message.contactName) contactPayload.name = message.contactName;
  if (message.avatarUri) contactPayload.avatar_uri = message.avatarUri;

  const { data: contact, error: contactError } = await supabase
    .from('wz_contacts')
    .upsert(contactPayload, { onConflict: 'clinic_id,chat_type,chat_id' })
    .select('id, contact_id, deal_id')
    .single();

  if (contactError || !contact?.id) {
    return { saved: false as const, reason: contactError?.message || 'Wazzup contact was not saved' };
  }

  const { error: messageError } = await supabase
    .from('wz_messages')
    .upsert({
      clinic_id: clinicId,
      wz_contact_id: contact.id,
      message_id: message.messageId,
      channel_id: message.channelId,
      chat_type: message.chatType,
      chat_id: message.chatId,
      contact_name: message.contactName,
      text: message.text,
      content_uri: message.contentUri,
      file_name: message.fileName,
      mime_type: message.mimeType,
      file_size: message.fileSize,
      msg_type: message.messageType,
      is_echo: message.isEcho,
      status: message.status,
      author_id: message.authorId,
      author_name: message.authorName,
      error: message.error,
      raw_payload: message.rawPayload,
      created_at: message.createdAt,
      updated_at: now,
    }, { onConflict: 'message_id' });

  if (messageError) return { saved: false as const, reason: messageError.message };

  const archiveError = await archiveIncomingAttachment(supabase, clinicId, message);

  let crmLink: any = null;
  let crmError: string | null = null;
  if (!message.isEcho) {
    const result = await supabase.rpc('negis_ingest_wazzup_contact', {
      target_clinic_id: clinicId,
      target_wz_contact_id: contact.id,
      target_chat_type: message.chatType,
      target_chat_id: message.chatId,
      target_name: message.contactName || WAZZUP_FALLBACK_CONTACT_NAME,
      target_phone: message.contactPhone,
    });
    crmLink = result.data;
    crmError = result.error?.message || null;
    if (!crmError) {
      await applyProfileNameToCrm(
        supabase,
        clinicId,
        contact.id,
        message.chatType,
        message.chatId,
        message.contactPhone,
        message.contactName,
        crmLink,
      );
    }
  }

  return { saved: true as const, clinicId, crmLink, crmError, archiveError };
}

function normalizeContactRecipients(value: unknown) {
  const recipients = Array.isArray(value) ? value : value ? [value] : [];
  return recipients
    .filter(recipient => recipient && typeof recipient === 'object')
    .map((recipient: any) => ({
      chat_type: String(recipient.chat_type || 'whatsapp'),
      chat_id: String(recipient.chat_id || recipient.phone || recipient.username || ''),
      username: recipient.username ? String(recipient.username) : '',
      phone: recipient.phone ? String(recipient.phone) : '',
    }))
    .filter(recipient => recipient.chat_id);
}

async function saveRequestedContact(supabase: AdminClient, item: any, clinicId: string) {
  const recipients = normalizeContactRecipients(item?.recipient);
  const primary = recipients[0];
  if (!primary) throw new Error('Wazzup contact does not contain a recipient');

  const phone = primary.phone || (['whatsapp', 'whatsgroup'].includes(primary.chat_type) ? primary.chat_id : '');
  const profileName = cleanWazzupContactName([item?.name], [phone, primary.chat_id]);
  const now = new Date().toISOString();
  const contactPayload: Record<string, unknown> = {
    clinic_id: clinicId,
    chat_type: primary.chat_type,
    chat_id: primary.chat_id,
    updated_at: now,
  };
  if (profileName) contactPayload.name = profileName;

  const { data: wzContact, error: contactError } = await supabase
    .from('wz_contacts')
    .upsert(contactPayload, { onConflict: 'clinic_id,chat_type,chat_id' })
    .select('id, contact_id, deal_id')
    .single();
  if (contactError || !wzContact?.id) {
    throw contactError || new Error('Wazzup contact was not saved');
  }

  const { data: crmLink, error: crmError } = await supabase.rpc('negis_ingest_wazzup_contact', {
    target_clinic_id: clinicId,
    target_wz_contact_id: wzContact.id,
    target_chat_type: primary.chat_type,
    target_chat_id: primary.chat_id,
    target_name: profileName || WAZZUP_FALLBACK_CONTACT_NAME,
    target_phone: phone || null,
  });
  if (crmError) throw crmError;

  await applyProfileNameToCrm(
    supabase,
    clinicId,
    wzContact.id,
    primary.chat_type,
    primary.chat_id,
    phone || null,
    profileName,
    crmLink,
  );

  const crmContactId = String(crmLink?.contact_id || wzContact.contact_id || '');
  if (!crmContactId) throw new Error('CRM contact was not created');
  const appUrl = (Deno.env.get('APP_URL') || 'https://crm.negis.online').replace(/\/+$/, '');

  return {
    id: crmContactId,
    responsible_user_id: String(item?.responsible_user_id || ''),
    name: profileName || WAZZUP_FALLBACK_CONTACT_NAME,
    recipient: recipients,
    uri: `${appUrl}/sales?tab=contacts&contact=${encodeURIComponent(crmContactId)}`,
  };
}

async function syncChannels(supabase: AdminClient, clinicId: string) {
  const payload = await wazzupTechFetch(clinicId, '/channels', { method: 'GET' }) as { data?: any[] };
  const channels = Array.isArray(payload?.data) ? payload.data : [];
  const now = new Date().toISOString();
  await supabase.from('wz_channels').update({ is_active: false, updated_at: now }).eq('clinic_id', clinicId);
  if (channels.length === 0) return;
  const { error } = await supabase.from('wz_channels').upsert(channels
    .filter(channel => channel?.channel_id)
    .map(channel => ({
      clinic_id: clinicId,
      channel_id: channel.channel_id,
      chat_type: channel.transport === 'tgapi' ? 'telegram' : 'whatsapp',
      name: channel.name || channel.phone || channel.username || channel.channel_id,
      is_active: channel.status === 'active' || channel.state === 'active',
      updated_at: now,
    })), { onConflict: 'channel_id' });
  if (error) throw error;
}

async function refreshIntegrationStatus(supabase: AdminClient, clinicId: string) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('wz_channels')
    .select('channel_id')
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .limit(1);
  if (error) throw error;
  const connected = Boolean(data?.length);

  const { error: connectionError } = await supabase
    .from('wazzup_connections')
    .update({
      verified_at: connected ? now : null,
      channel_sync_at: now,
      updated_at: now,
    })
    .eq('clinic_id', clinicId);
  if (connectionError) throw connectionError;

  const { error: integrationError } = await supabase.from('clinic_integrations').upsert({
    clinic_id: clinicId,
    integration_id: 'wazzup',
    status: connected ? 'connected' : 'pending',
    verified_at: connected ? now : null,
    updated_at: now,
  }, { onConflict: 'clinic_id,integration_id' });
  if (integrationError) throw integrationError;
}

async function handleChannelEvent(supabase: AdminClient, event: string, item: any, fallback: string | null) {
  const channelId = String(item.channel_id || '');
  const clinicId = await clinicIdForChannel(supabase, channelId, fallback);
  if (!clinicId) return;

  if (event === 'channel.create') {
    await syncChannels(supabase, clinicId);
    await refreshIntegrationStatus(supabase, clinicId);
    return;
  }

  const now = new Date().toISOString();
  const status = String(item.status || '');
  const active = event !== 'channel.delete' && status === 'active';
  const { error } = await supabase.from('wz_channels').upsert({
    clinic_id: clinicId,
    channel_id: channelId,
    chat_type: item.transport === 'tgapi' ? 'telegram' : 'whatsapp',
    name: item.name || item.phone || item.username || channelId,
    is_active: active,
    updated_at: now,
  }, { onConflict: 'channel_id' });
  if (error) throw error;

  await refreshIntegrationStatus(supabase, clinicId);
}

async function handleLabelEvent(supabase: AdminClient, body: any, fallback: string | null) {
  const event = String(body?.event || '');
  const items = eventItems(body);
  const savedMessages: string[] = [];
  const skippedMessages: Array<{ messageId?: string; reason: string }> = [];
  const crmLinks: Array<{ messageId: string; contactId: string | null; dealId: string | null; duplicateMatched: boolean }> = [];
  const contacts: Array<Record<string, unknown>> = [];

  if (event === 'crm_entities.contact_add') {
    if (!fallback) throw new Error('clinic_id is required for Wazzup contact creation');
    for (const item of items) contacts.push(await saveRequestedContact(supabase, item, fallback));
  } else if (event === 'message.add') {
    for (const item of items) {
      const message = normalizeLabelMessage(item);
      const result = await saveMessage(supabase, message, fallback);
      if (!result.saved) {
        skippedMessages.push({ messageId: message.messageId, reason: result.reason });
        continue;
      }
      savedMessages.push(message.messageId);
      if (result.archiveError) skippedMessages.push({ messageId: message.messageId, reason: result.archiveError });
      if (result.crmError) skippedMessages.push({ messageId: message.messageId, reason: `CRM intake: ${result.crmError}` });
      if (result.crmLink) crmLinks.push({
        messageId: message.messageId,
        contactId: result.crmLink.contact_id || null,
        dealId: result.crmLink.deal_id || null,
        duplicateMatched: Boolean(result.crmLink.duplicate_matched),
      });
    }
  } else if (event === 'message.status_update') {
    for (const item of items) {
      const messageId = String(item.message_id || '');
      const { error } = await supabase.from('wz_messages').update({
        status: item.status || null,
        error: item.reason ? { reason: item.reason } : null,
        updated_at: new Date().toISOString(),
      }).eq('message_id', messageId);
      if (error) skippedMessages.push({ messageId, reason: error.message });
    }
  } else if (event === 'message.delete') {
    for (const item of items) {
      const messageId = String(item.message_id || '');
      const { error } = await supabase.from('wz_messages').update({
        status: 'deleted',
        text: null,
        content_uri: null,
        updated_at: new Date().toISOString(),
      }).eq('message_id', messageId);
      if (error) skippedMessages.push({ messageId, reason: error.message });
    }
  } else if (event === 'message.edit') {
    for (const item of items) {
      const messageId = String(item.message_id || '');
      const attachment = item.attachment || {};
      const mimeType = attachment.mimetype || null;
      const { error } = await supabase.from('wz_messages').update({
        text: item.text || null,
        content_uri: attachment.url || null,
        file_name: attachment.name || null,
        mime_type: mimeType,
        file_size: Number(attachment.size) || null,
        msg_type: messageType(mimeType),
        raw_payload: item,
        updated_at: new Date().toISOString(),
      }).eq('message_id', messageId);
      if (error) skippedMessages.push({ messageId, reason: error.message });
    }
  } else if (['channel.status_update', 'channel.create', 'channel.delete'].includes(event)) {
    for (const item of items) await handleChannelEvent(supabase, event, item, fallback);
  }

  return { event, savedMessages, skippedMessages, crmLinks, contacts };
}

Deno.serve(async req => {
  const options = handleOptions(req);
  if (options) return options;

  try {
    if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 });
    if (!webhookKeyMatches(req)) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const supabase = adminClient();
    const body = await req.json();
    if (body?.test === true) return jsonResponse({ ok: true });
    if (!body?.event) return jsonResponse({ error: 'Unsupported Wazzup webhook payload' }, { status: 400 });

    const fallback = fallbackClinicId(req);
    if (!fallback) return jsonResponse({ error: 'clinic_id is required' }, { status: 400 });
    const { data: integration } = await supabase
      .from('clinic_integrations')
      .select('status')
      .eq('clinic_id', fallback)
      .eq('integration_id', 'wazzup')
      .in('status', ['pending', 'connected'])
      .maybeSingle();
    if (!integration) return jsonResponse({ ok: true, ignored: 'Wazzup integration is disabled' });
    const result = await handleLabelEvent(supabase, body, fallback);
    if (body.event === 'crm_entities.contact_add') {
      const contact = result.contacts[0];
      if (!contact) return jsonResponse({ error: 'Wazzup contact was not created' }, { status: 422 });
      return jsonResponse(contact);
    }
    return jsonResponse({ ok: true, ...result });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
});
