import { adminClient, bearerToken } from '../_shared/auth.ts';
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { wazzupTechFetch } from '../_shared/wazzup.ts';

type AdminClient = ReturnType<typeof adminClient>;

type NormalizedMessage = {
  messageId: string;
  channelId: string;
  chatType: string;
  chatId: string;
  contactName: string;
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
  const expected = [
    Deno.env.get('WAZZUP_CRM_KEY'),
    Deno.env.get('WAZZUP_OAUTH_CRM_KEY'),
  ].filter((value): value is string => Boolean(value));
  if (expected.length === 0) return false;
  const url = new URL(req.url);
  const provided = [
    bearerToken(req),
    req.headers.get('x-wazzup-crm-key'),
    url.searchParams.get('key'),
  ].filter((value): value is string => Boolean(value));
  return provided.some(value => expected.includes(value));
}

function fallbackClinicId(req: Request) {
  return new URL(req.url).searchParams.get('clinic_id') || Deno.env.get('WAZZUP_DEFAULT_CLINIC_ID') || null;
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

function normalizeLegacyMessage(message: any): NormalizedMessage {
  const attachment = message.attachment || {};
  const mimeType = attachment.mimetype || message.mimeType || null;
  const chatId = String(message.chatId || '');
  return {
    messageId: String(message.messageId || ''),
    channelId: String(message.channelId || ''),
    chatType: String(message.chatType || 'whatsapp'),
    chatId,
    contactName: String(message.contact?.name || message.contact?.phone || chatId),
    contactPhone: message.contact?.phone || null,
    avatarUri: message.contact?.avatarUri || null,
    text: message.text || null,
    contentUri: message.contentUri || attachment.url || null,
    fileName: message.fileName || attachment.name || null,
    mimeType,
    fileSize: Number(message.fileSize || attachment.size) || null,
    messageType: messageType(mimeType, message.type),
    isEcho: Boolean(message.isEcho),
    status: message.status || (message.isEcho ? 'sent' : 'inbound'),
    authorId: message.authorId || null,
    authorName: message.authorName || null,
    error: message.error || null,
    createdAt: timestampToIso(message.dateTime),
    rawPayload: message,
  };
}

function normalizeLabelMessage(message: any): NormalizedMessage {
  const recipient = message.recipient || {};
  const sender = message.sender || {};
  const attachment = message.attachment || {};
  const mimeType = attachment.mimetype || null;
  const chatId = String(recipient.chat_id || message.chat_id || recipient.phone || '');
  const isEcho = message.direction === 'outbound';
  return {
    messageId: String(message.message_id || ''),
    channelId: String(message.channel_id || ''),
    chatType: String(recipient.chat_type || message.chat_type || 'whatsapp'),
    chatId,
    contactName: String(recipient.name || recipient.phone || chatId),
    contactPhone: recipient.phone || null,
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

async function saveMessage(supabase: AdminClient, message: NormalizedMessage, fallback: string | null) {
  if (!message.messageId || !message.channelId || !message.chatId) {
    return { saved: false as const, reason: 'missing messageId/channelId/chatId' };
  }

  const clinicId = await clinicIdForChannel(supabase, message.channelId, fallback);
  if (!clinicId) return { saved: false as const, reason: 'workspace not resolved for channelId' };

  const now = new Date().toISOString();
  const { data: contact, error: contactError } = await supabase
    .from('wz_contacts')
    .upsert({
      clinic_id: clinicId,
      chat_type: message.chatType,
      chat_id: message.chatId,
      name: message.contactName,
      avatar_uri: message.avatarUri,
      updated_at: now,
    }, { onConflict: 'clinic_id,chat_type,chat_id' })
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

  let crmLink: any = null;
  let crmError: string | null = null;
  if (!message.isEcho) {
    const result = await supabase.rpc('negis_ingest_wazzup_contact', {
      target_clinic_id: clinicId,
      target_wz_contact_id: contact.id,
      target_chat_type: message.chatType,
      target_chat_id: message.chatId,
      target_name: message.contactName,
      target_phone: message.contactPhone,
    });
    crmLink = result.data;
    crmError = result.error?.message || null;
  }

  return { saved: true as const, clinicId, crmLink, crmError };
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

  if (event === 'message.add') {
    for (const item of items) {
      const message = normalizeLabelMessage(item);
      const result = await saveMessage(supabase, message, fallback);
      if (!result.saved) {
        skippedMessages.push({ messageId: message.messageId, reason: result.reason });
        continue;
      }
      savedMessages.push(message.messageId);
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

  return { event, savedMessages, skippedMessages, crmLinks };
}

async function handleLegacyPayload(supabase: AdminClient, body: any, fallback: string | null) {
  const savedMessages: string[] = [];
  const skippedMessages: Array<{ messageId?: string; reason: string }> = [];
  const crmLinks: Array<{ messageId: string; contactId: string | null; dealId: string | null; duplicateMatched: boolean }> = [];

  if (Array.isArray(body?.messages)) {
    for (const item of body.messages) {
      const message = normalizeLegacyMessage(item);
      const result = await saveMessage(supabase, message, fallback);
      if (!result.saved) {
        skippedMessages.push({ messageId: message.messageId, reason: result.reason });
        continue;
      }
      savedMessages.push(message.messageId);
      if (result.crmError) skippedMessages.push({ messageId: message.messageId, reason: `CRM intake: ${result.crmError}` });
      if (result.crmLink) crmLinks.push({
        messageId: message.messageId,
        contactId: result.crmLink.contact_id || null,
        dealId: result.crmLink.deal_id || null,
        duplicateMatched: Boolean(result.crmLink.duplicate_matched),
      });
    }
  }

  if (body?.createContact) {
    const contact = body.createContact;
    const clinicId = await clinicIdForChannel(supabase, String(contact.channelId || body.channelId || ''), fallback);
    if (clinicId) {
      const { data, error } = await supabase.from('wz_contacts').upsert({
        clinic_id: clinicId,
        chat_type: contact.chatType || 'whatsapp',
        chat_id: String(contact.chatId || contact.phone || ''),
        name: contact.name || contact.phone || contact.chatId || null,
        avatar_uri: contact.avatarUri || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'clinic_id,chat_type,chat_id' })
        .select('id, clinic_id, chat_type, chat_id, name, avatar_uri, contact_id, deal_id')
        .single();
      if (error || !data?.id) throw new Error(error?.message || 'Wazzup contact was not saved');
      const { data: crm, error: crmError } = await supabase.rpc('negis_ingest_wazzup_contact', {
        target_clinic_id: clinicId,
        target_wz_contact_id: data.id,
        target_chat_type: data.chat_type,
        target_chat_id: data.chat_id,
        target_name: data.name,
        target_phone: contact.phone || null,
      });
      if (crmError) throw crmError;
      return { savedMessages, skippedMessages, crmLinks, contact: data, crm };
    }
  }

  if (body?.createDeal) {
    const deal = body.createDeal;
    const clinicId = await clinicIdForChannel(supabase, String(deal.channelId || body.channelId || ''), fallback);
    if (clinicId) {
      const { data, error } = await supabase.from('wz_deals').insert({
        clinic_id: clinicId,
        wz_contact_id: deal.wzContactId || null,
        crm_deal_id: deal.crmDealId || null,
        title: deal.title || 'WhatsApp',
        status: deal.status || 'open',
      }).select().single();
      if (error) throw error;
      return { savedMessages, skippedMessages, crmLinks, deal: data };
    }
  }

  return { savedMessages, skippedMessages, crmLinks };
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

    const fallback = fallbackClinicId(req);
    const result = body?.event
      ? await handleLabelEvent(supabase, body, fallback)
      : await handleLegacyPayload(supabase, body, fallback);
    return jsonResponse({ ok: true, ...result });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
});
