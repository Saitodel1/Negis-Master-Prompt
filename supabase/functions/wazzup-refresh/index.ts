import { bearerToken } from '../_shared/auth.ts';
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { refreshNextDueWazzupConnection } from '../_shared/wazzup.ts';

Deno.serve(async req => {
  const options = handleOptions(req);
  if (options) return options;

  try {
    if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 });
    const refreshSecret = Deno.env.get('WAZZUP_REFRESH_SECRET');
    if (!refreshSecret || bearerToken(req) !== refreshSecret) {
      return jsonResponse({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(Number(body.limit || 25), 100));
    const refreshed: string[] = [];
    const errors: Array<{ clinicId?: string; error: string }> = [];

    for (let index = 0; index < limit; index += 1) {
      try {
        const clinicId = await refreshNextDueWazzupConnection();
        if (!clinicId) break;
        refreshed.push(clinicId);
      } catch (error) {
        errors.push({ error: error instanceof Error ? error.message : String(error) });
        break;
      }
    }

    return jsonResponse({ ok: errors.length === 0, refreshed, errors });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
});
