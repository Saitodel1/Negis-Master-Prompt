import { adminClient } from './auth.ts';

export const WAZZUP_API_BASE = 'https://api.wazzup24.com/v3';
export const WAZZUP_TECH_API_BASE = 'https://tech.wazzup24.com/v2';

type EncryptedValue = {
  ciphertext: string;
  iv: string;
  tag: string;
};

type WazzupConnection = {
  clinic_id: string;
  api_key_ciphertext: string | null;
  api_key_iv: string | null;
  api_key_tag: string | null;
  access_token_expires_at: string | null;
};

type RefreshClaim = {
  clinic_id: string;
  refresh_token_ciphertext: string;
  refresh_token_iv: string;
  refresh_token_tag: string;
  refresh_token_expires_at: string | null;
  refresh_lease_id: string;
};

type RefreshPayload = {
  data?: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    refresh_expires_in?: number;
  };
  error?: string;
  description?: string;
};

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function credentialSecret() {
  return Deno.env.get('WAZZUP_CREDENTIALS_ENCRYPTION_KEY') || requiredEnv('WAZZUP_OAUTH_STATE_SECRET');
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function encryptionKey() {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(credentialSecret()));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function decryptValue(value: EncryptedValue) {
  const ciphertext = base64ToBytes(value.ciphertext);
  const tag = base64ToBytes(value.tag);
  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext);
  combined.set(tag, ciphertext.length);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(value.iv), tagLength: 128 },
    await encryptionKey(),
    combined,
  );
  return new TextDecoder().decode(plaintext);
}

async function encryptValue(value: string): Promise<EncryptedValue> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    await encryptionKey(),
    new TextEncoder().encode(value),
  ));
  const tag = encrypted.slice(encrypted.length - 16);
  const ciphertext = encrypted.slice(0, encrypted.length - 16);
  return {
    ciphertext: bytesToBase64(ciphertext),
    iv: bytesToBase64(iv),
    tag: bytesToBase64(tag),
  };
}

async function parseResponse(response: Response) {
  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    throw new Error(data?.description || data?.error || data?.message || `Wazzup API error ${response.status}`);
  }
  return data;
}

async function readConnection(clinicId: string) {
  const { data, error } = await adminClient()
    .from('wazzup_connections')
    .select('clinic_id,api_key_ciphertext,api_key_iv,api_key_tag,access_token_expires_at')
    .eq('clinic_id', clinicId)
    .maybeSingle();
  if (error) throw error;
  return data as WazzupConnection | null;
}

function tokenIsUsable(connection: WazzupConnection | null) {
  if (!connection?.api_key_ciphertext || !connection.api_key_iv || !connection.api_key_tag) return false;
  if (!connection.access_token_expires_at) return false;
  return new Date(connection.access_token_expires_at).getTime() > Date.now() + 3 * 60 * 1000;
}

function tokenIsUnexpired(connection: WazzupConnection | null) {
  if (!connection?.api_key_ciphertext || !connection.api_key_iv || !connection.api_key_tag) return false;
  if (!connection.access_token_expires_at) return false;
  return new Date(connection.access_token_expires_at).getTime() > Date.now();
}

async function connectionToken(connection: WazzupConnection) {
  if (!connection.api_key_ciphertext || !connection.api_key_iv || !connection.api_key_tag) {
    throw new Error('Wazzup OAuth token is missing for this workspace');
  }
  return decryptValue({
    ciphertext: connection.api_key_ciphertext,
    iv: connection.api_key_iv,
    tag: connection.api_key_tag,
  });
}

async function refreshClaim(targetClinicId?: string) {
  const { data, error } = await adminClient().rpc('negis_claim_wazzup_refresh', {
    target_clinic_id: targetClinicId || null,
    lease_seconds: 90,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : null) as RefreshClaim | null;
}

async function failRefresh(claim: RefreshClaim, error: unknown) {
  await adminClient().rpc('negis_fail_wazzup_refresh', {
    target_clinic_id: claim.clinic_id,
    target_lease_id: claim.refresh_lease_id,
    failure_message: error instanceof Error ? error.message : String(error),
  });
}

async function executeRefresh(claim: RefreshClaim) {
  if (claim.refresh_token_expires_at && new Date(claim.refresh_token_expires_at).getTime() <= Date.now()) {
    throw new Error('Wazzup refresh token has expired; reconnect the workspace');
  }

  const refreshToken = await decryptValue({
    ciphertext: claim.refresh_token_ciphertext,
    iv: claim.refresh_token_iv,
    tag: claim.refresh_token_tag,
  });
  const partnerCredentials = new TextEncoder().encode(
    `${requiredEnv('WAZZUP_PARTNER_EMAIL')}:${requiredEnv('WAZZUP_PARTNER_PASSWORD')}`,
  );
  const response = await fetch(`${WAZZUP_TECH_API_BASE}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${bytesToBase64(partnerCredentials)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token_data: {
        refresh_token: refreshToken,
        client_id: requiredEnv('WAZZUP_OAUTH_CLIENT_ID'),
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await parseResponse(response) as RefreshPayload;
  const tokens = payload.data;
  if (!tokens?.access_token) throw new Error('Wazzup did not return a refreshed access token');

  const access = await encryptValue(tokens.access_token);
  const nextRefresh = tokens.refresh_token ? await encryptValue(tokens.refresh_token) : null;
  const expiresIn = Number(tokens.expires_in || 86_400);
  const refreshExpiresIn = Number(tokens.refresh_expires_in || 180 * 24 * 60 * 60);
  const { data: completed, error } = await adminClient().rpc('negis_complete_wazzup_refresh', {
    target_clinic_id: claim.clinic_id,
    target_lease_id: claim.refresh_lease_id,
    next_access_token_ciphertext: access.ciphertext,
    next_access_token_iv: access.iv,
    next_access_token_tag: access.tag,
    next_access_token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    next_refresh_token_ciphertext: nextRefresh?.ciphertext || null,
    next_refresh_token_iv: nextRefresh?.iv || null,
    next_refresh_token_tag: nextRefresh?.tag || null,
    next_refresh_token_expires_at: nextRefresh
      ? new Date(Date.now() + refreshExpiresIn * 1000).toISOString()
      : null,
  });
  if (error) throw error;
  if (!completed) throw new Error('Wazzup token refresh lease was lost');
  return tokens.access_token;
}

export async function refreshNextDueWazzupConnection(targetClinicId?: string) {
  const claim = await refreshClaim(targetClinicId);
  if (!claim) return null;
  try {
    await executeRefresh(claim);
    return claim.clinic_id;
  } catch (error) {
    await failRefresh(claim, error);
    throw error;
  }
}

export async function tenantAccessToken(clinicId: string) {
  let connection = await readConnection(clinicId);
  if (tokenIsUsable(connection)) return connectionToken(connection!);

  const refreshedClinicId = await refreshNextDueWazzupConnection(clinicId);
  if (refreshedClinicId) {
    connection = await readConnection(clinicId);
    if (tokenIsUsable(connection)) return connectionToken(connection!);
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 500));
    connection = await readConnection(clinicId);
    if (tokenIsUsable(connection)) return connectionToken(connection!);
  }
  if (tokenIsUnexpired(connection)) return connectionToken(connection!);
  throw new Error('Wazzup OAuth token is unavailable; reconnect this workspace');
}

async function tenantFetch(baseUrl: string, clinicId: string, path: string, init: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await tenantAccessToken(clinicId)}`,
      ...(init.headers ?? {}),
    },
  });
  return parseResponse(response);
}

export function wazzupFetch(clinicId: string, path: string, init: RequestInit) {
  return tenantFetch(WAZZUP_API_BASE, clinicId, path, init);
}

export function wazzupTechFetch(clinicId: string, path: string, init: RequestInit) {
  return tenantFetch(WAZZUP_TECH_API_BASE, clinicId, path, init);
}

export function normalizeChatId(value: string | null | undefined) {
  return (value ?? '').replace(/\D/g, '');
}
