# Wazzup integration setup

## 0. Partner link for Marketplace

Add your Wazzup partner/referral URL to the frontend environment:

```powershell
VITE_WAZZUP_PARTNER_URL="https://wazzup24.ru/?utm_p=5sFySX"
```

When this variable is set, the Wazzup card in `Маркет` opens the partner link from the `Подключить` button.

Development client id received from Wazzup:

```powershell
VITE_WAZZUP_CLIENT_ID="a287e21e-b169-4c28-9470-9846a13fede2"
```

This id is not enough for production OAuth by itself. Use it only when Wazzup provides the full partner/OAuth flow: redirect URI, client secret, and token exchange rules.

## 0.1. Ready without Wazzup API key

These parts can work before Wazzup gives the production API key:

- `Маркет` opens the Wazzup partner link from the `Подключить` button.
- Vercel webhook `/api/leads/webhook/{clinicId}` can receive leads from forms, bots, ads, or automation tools.
- The webhook puts leads into the `booking` pipeline by default and fills the default status automatically.
- The Sales client card already has the `WhatsApp` tab and shows a friendly "API key is still needed" state until `WAZZUP_API_KEY` is configured.

Lead webhook example:

```bash
curl -X POST "https://crm.negis.online/api/leads/webhook/<clinic_id>" \
  -H "Content-Type: application/json" \
  -d '{"full_name":"Laura","phone":"+77000000000","source":"wazzup-partner","pipeline":"booking"}'
```

Use `"pipeline":"sales"` only when the lead must go directly into `Клиенты`.

## 1. Apply database migration

Run `supabase/migrations/20260612_wazzup.sql` in Supabase SQL Editor.

After that, bind the Wazzup channel to a clinic:

```sql
insert into wz_channels (clinic_id, channel_id, chat_type, name)
values ('<clinic_id>', '<wazzup_channel_id>', 'whatsapp', 'Main WhatsApp')
on conflict (channel_id) do update set
  clinic_id = excluded.clinic_id,
  chat_type = excluded.chat_type,
  name = excluded.name,
  is_active = true,
  updated_at = now();
```

For a single-clinic setup you can also set `WAZZUP_DEFAULT_CLINIC_ID` as a Supabase secret.

## 2. Set Supabase secrets

These secrets are safe to configure now:

```powershell
npx supabase secrets set WAZZUP_CRM_KEY="<random_webhook_secret>" --project-ref dhsiloxpqwshlezgbodc
npx supabase secrets set WAZZUP_DEFAULT_CLINIC_ID="<clinic_id>" --project-ref dhsiloxpqwshlezgbodc
```

Configure this one only after Wazzup gives the production API key:

```powershell
npx supabase secrets set WAZZUP_API_KEY="<wazzup_api_key>" --project-ref dhsiloxpqwshlezgbodc
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are required by Edge Functions. Supabase usually provides them in the function runtime, but set them manually if your project requires it.

## 3. Deploy Edge Functions

```powershell
npx supabase functions deploy wazzup-iframe-url --project-ref dhsiloxpqwshlezgbodc
npx supabase functions deploy wazzup-send --project-ref dhsiloxpqwshlezgbodc
npx supabase functions deploy wazzup-webhook --no-verify-jwt --project-ref dhsiloxpqwshlezgbodc
```

`wazzup-webhook` must be deployed with `--no-verify-jwt`, because Wazzup is an external service and does not send a Supabase Auth JWT. The function checks `WAZZUP_CRM_KEY` by itself.

## 4. Register Wazzup webhook

This step requires `WAZZUP_API_KEY`, so do it only after the API key is issued.

Use the same `WAZZUP_CRM_KEY` in the webhook URL query string:

```powershell
$apiKey = "<wazzup_api_key>"
$crmKey = "<random_webhook_secret>"
$projectRef = "dhsiloxpqwshlezgbodc"
$uri = "https://$projectRef.supabase.co/functions/v1/wazzup-webhook?key=$crmKey"

Invoke-RestMethod `
  -Method Patch `
  -Uri "https://api.wazzup24.com/v3/webhooks" `
  -Headers @{ Authorization = "Bearer $apiKey"; "Content-Type" = "application/json" } `
  -Body (@{
    webhooksUri = $uri
    subscriptions = @{
      messagesAndStatuses = $true
      contactsAndDealsCreation = $true
      channelsUpdates = $false
      templateStatus = $false
    }
  } | ConvertTo-Json -Depth 5)
```

Wazzup sends a test POST `{ "test": true }`; the function returns `200 OK`.

## 5. Frontend

The Sales client card has a `WhatsApp` tab. It calls `wazzup-iframe-url` and renders Wazzup iFrame with:

```tsx
allow="microphone *; clipboard-write *"
```

The Wazzup API key is never exposed to the browser.
