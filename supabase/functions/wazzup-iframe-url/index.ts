import { assertClinicAccess, assertClinicManagerAccess, requireUser } from '../_shared/auth.ts';
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { normalizeChatId, wazzupFetch, wazzupTechFetch } from '../_shared/wazzup.ts';

Deno.serve(async req => {
  const options = handleOptions(req);
  if (options) return options;

  try {
    if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 });
    const { supabase, user } = await requireUser(req);
    const body = await req.json();
    const clinicId = String(body.clinicId || '');
    const chatType = String(body.chatType || 'whatsapp');
    const chatId = normalizeChatId(body.contactPhone || body.chatId);
    const contactName = String(body.contactName || chatId);
    const scope = body.scope === 'global' ? 'global' : 'card';
    const purpose = body.purpose === 'channel' ? 'channel' : 'chat';

    if (!clinicId) return jsonResponse({ error: 'clinicId is required' }, { status: 400 });

    if (purpose === 'channel') {
      await assertClinicManagerAccess(supabase, user.id, clinicId);

      const { data: connection, error: connectionError } = await supabase
        .from('wazzup_connections')
        .select('api_key_ciphertext,refresh_token_ciphertext')
        .eq('clinic_id', clinicId)
        .maybeSingle();
      if (connectionError) throw connectionError;
      if (!connection?.api_key_ciphertext && !connection?.refresh_token_ciphertext) {
        return jsonResponse({ error: 'WAZZUP_AUTHORIZATION_REQUIRED' }, { status: 409 });
      }

      const transport = String(body.transport || 'whatsapp');
      const options: Record<string, string> = { transport };
      if (body.channelId) options.channel_id = String(body.channelId);
      const data = await wazzupTechFetch(clinicId, '/iframe-links/channels', {
        method: 'POST',
        body: JSON.stringify({ options }),
      });
      const url = data?.data?.link || data?.link;
      if (!url) return jsonResponse({ error: 'Wazzup channel setup URL is missing', data }, { status: 502 });
      return jsonResponse({ url });
    }

    await assertClinicAccess(supabase, user.id, clinicId);

    if (scope === 'card' && !chatId) {
      return jsonResponse({ error: 'contactPhone/chatId is required' }, { status: 400 });
    }

    const payload: Record<string, unknown> = {
      user: {
        id: String(body.userId || user.id),
        name: body.userName || user.email || user.id,
      },
      scope,
      options: {
        useDealsEvents: true,
        useMessageEvents: true,
        clientType: 'Negis CRM',
      },
    };

    if (scope === 'card') {
      payload.filter = [{ chatType, chatId, name: contactName }];
      payload.activeChat = { chatType, chatId };
    }

    const data = await wazzupFetch(clinicId, '/iframe', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const url = data?.url || data?.iframeUrl || data?.link;
    if (!url) return jsonResponse({ error: 'Wazzup iframe URL is missing', data }, { status: 502 });

    if (chatId) {
      await supabase
        .from('wz_contacts')
        .upsert({
          clinic_id: clinicId,
          chat_type: chatType,
          chat_id: chatId,
          name: contactName,
          crm_contact_id: body.leadId || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'clinic_id,chat_type,chat_id' });
    }

    return jsonResponse({ url });
  } catch (err) {
    if (err instanceof Response) return err;
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
});
