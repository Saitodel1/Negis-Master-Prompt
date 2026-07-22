# Wazzup Label integration

Each organization connects its own Wazzup account from Negis Marketplace. Tokens and channels are isolated by `clinic_id`; no Wazzup credential is exposed to the browser.

## 1. Callback allowlist

The Wazzup partner account must allow this exact redirect URI:

```text
https://crm.negis.online/api/integrations/wazzup/oauth/callback
```

## 2. Apply database migrations

Apply these migrations in order:

```text
migrations/014_external_integrations.sql
migrations/020_wazzup_crm_intake.sql
migrations/021_fix_wazzup_crm_intake_ambiguity.sql
migrations/024_wazzup_attachments.sql
migrations/025_wazzup_oauth_lifecycle.sql
migrations/026_wazzup_refresh_schedule.sql
```

Migration `026` expects two encrypted Supabase Vault secrets:

```sql
select vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'project_url');
select vault.create_secret('YOUR_SERVICE_ROLE_KEY', 'service_role_key');
```

The scheduled job runs every minute. The refresh RPC only claims access tokens inside Wazzup's final three-minute refresh window.

## 3. Vercel environment

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
WAZZUP_OAUTH_CLIENT_ID
WAZZUP_OAUTH_REDIRECT_URI
WAZZUP_OAUTH_STATE_SECRET
WAZZUP_CREDENTIALS_ENCRYPTION_KEY
WAZZUP_PARTNER_EMAIL
WAZZUP_PARTNER_PASSWORD
WAZZUP_OAUTH_CRM_KEY
WAZZUP_REFRESH_SECRET
```

Use the callback URI from section 1 as `WAZZUP_OAUTH_REDIRECT_URI`. Use separate random values for the state and credential encryption secrets.

`WAZZUP_WEBHOOK_URL` is optional. Without it, the OAuth callback uses the current Supabase project URL and `/functions/v1/wazzup-webhook`.

## 4. Supabase Edge Function secrets

Set the same server-side Wazzup values for Edge Functions:

```text
WAZZUP_OAUTH_CLIENT_ID
WAZZUP_OAUTH_STATE_SECRET
WAZZUP_CREDENTIALS_ENCRYPTION_KEY
WAZZUP_PARTNER_EMAIL
WAZZUP_PARTNER_PASSWORD
WAZZUP_OAUTH_CRM_KEY
WAZZUP_REFRESH_SECRET
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are normally provided by Supabase at runtime.

## 5. Deploy Edge Functions

```powershell
npx supabase functions deploy wazzup-iframe-url --project-ref YOUR_PROJECT_REF
npx supabase functions deploy wazzup-send --project-ref YOUR_PROJECT_REF
npx supabase functions deploy wazzup-refresh --project-ref YOUR_PROJECT_REF
npx supabase functions deploy wazzup-webhook --no-verify-jwt --project-ref YOUR_PROJECT_REF
```

Only the external Wazzup webhook is deployed without JWT verification. It validates `WAZZUP_OAUTH_CRM_KEY` itself and accepts only Label OAuth events bound to an explicit organization. User-facing functions require a valid Supabase session; the refresh function requires the service-role bearer token.

There is no global Wazzup API key or default organization fallback. Every organization, including older workspaces, must complete the same Label OAuth flow before its channels can be used in Negis.

## 6. Customer flow

1. An organization owner or manager clicks `Подключить` on the Wazzup card.
2. Negis starts OAuth with PKCE and an encrypted, expiring state bound to the current organization.
3. Wazzup returns access and refresh tokens to the Vercel callback.
4. Negis encrypts the tokens, subscribes that organization to Label webhooks and loads its channels.
5. If no active WhatsApp channel exists, Negis opens Wazzup's channel iframe so the customer can scan the QR code.
6. The integration becomes `Подключено` only after an active channel and webhook subscription are confirmed.
7. Incoming messages create or match a contact using the normalized phone number and remain inside that organization's client card.
8. Before OAuth, Negis warns that Wazzup may reuse the account already open in the browser and provides a direct link for switching accounts.
9. `Отключить` removes the organization's server-side tokens and Negis webhook subscriptions, disables local channels, and preserves the existing CRM message history.

## 7. Verification

Check all of these before calling the connection complete:

- `wazzup_connections.verified_at` is not null;
- `clinic_integrations.status = 'connected'` for `integration_id = 'wazzup'`;
- at least one `wz_channels.is_active = true` exists for the organization;
- a test incoming message appears in `wz_messages` and in the matched client card;
- a text message and an attachment can be sent from Negis;
- the cron job `negis-wazzup-token-refresh` exists in `cron.job`.
