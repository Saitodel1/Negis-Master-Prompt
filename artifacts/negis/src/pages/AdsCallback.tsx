import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';

/* ── Types ────────────────────────────────────────────────── */
type Status = 'processing' | 'success' | 'error';

/* ── Styles ───────────────────────────────────────────────── */
const Wrap: React.CSSProperties = {
  minHeight: '100vh',
  background: '#F4F7FB',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: "'Inter', sans-serif",
  padding: 24,
};

const Card: React.CSSProperties = {
  background: '#F4F7FB',
  borderRadius: 24,
  boxShadow: '8px 8px 20px #D1D9E6, -8px -8px 20px #FFFFFF',
  padding: '48px 40px',
  maxWidth: 440,
  width: '100%',
  textAlign: 'center',
};

const LinkBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  marginTop: 20,
  padding: '10px 22px',
  borderRadius: 12,
  background: '#1E325C',
  color: '#FFF',
  fontSize: 14,
  fontWeight: 600,
  border: 'none',
  cursor: 'pointer',
  textDecoration: 'none',
};

/* ═══════════════════════════════════════════════════════════
   AdsCallback
═══════════════════════════════════════════════════════════ */
export default function AdsCallback() {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<Status>('processing');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    handleCallback();
  }, []);

  const handleCallback = async () => {
    /* 1. Parse URL params */
    const params = new URLSearchParams(window.location.search);
    const code      = params.get('code');
    const state     = params.get('state'); // contains clinic_id
    const errorCode = params.get('error');

    if (errorCode) {
      setErrorMsg(`TikTok вернул ошибку: ${errorCode}`);
      setStatus('error');
      return;
    }

    if (!code) {
      setErrorMsg('Параметр "code" не найден в URL');
      setStatus('error');
      return;
    }

    const clinicId = state;
    if (!clinicId) {
      setErrorMsg('Параметр "state" (clinic_id) не найден в URL');
      setStatus('error');
      return;
    }

    /* 2. Exchange code for access token via TikTok API */
    const appId     = import.meta.env.VITE_TIKTOK_APP_ID as string | undefined;
    const appSecret = import.meta.env.VITE_TIKTOK_APP_SECRET as string | undefined;

    if (!appId || !appSecret) {
      setErrorMsg('VITE_TIKTOK_APP_ID или VITE_TIKTOK_APP_SECRET не настроены');
      setStatus('error');
      return;
    }

    let accessToken = '';
    let advertiserId = '';
    let accountName = '';

    try {
      const tokenRes = await fetch(
        'https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            app_id:    appId,
            secret:    appSecret,
            auth_code: code,
          }),
        },
      );

      if (!tokenRes.ok) {
        throw new Error(`HTTP ${tokenRes.status}: ${tokenRes.statusText}`);
      }

      const tokenData = await tokenRes.json();

      if (tokenData.code !== 0) {
        throw new Error(tokenData.message || `TikTok error code ${tokenData.code}`);
      }

      accessToken  = tokenData.data?.access_token ?? '';
      const ids: string[] = tokenData.data?.advertiser_ids ?? [];
      advertiserId = ids[0] ?? '';

      if (!accessToken || !advertiserId) {
        throw new Error('Не удалось получить access_token или advertiser_id из ответа TikTok');
      }

      /* 3. Try to fetch account name from TikTok */
      try {
        const infoRes = await fetch(
          `https://business-api.tiktok.com/open_api/v1.3/oauth2/advertiser/get/?advertiser_ids=["${advertiserId}"]&fields=["advertiser_id","advertiser_name","status"]`,
          { headers: { 'Access-Token': accessToken } },
        );
        const infoData = await infoRes.json();
        const list: any[] = infoData.data?.list ?? [];
        accountName = list[0]?.advertiser_name ?? advertiserId;
      } catch {
        accountName = advertiserId;
      }
    } catch (e: any) {
      setErrorMsg(e.message || 'Ошибка при обмене кода на токен');
      setStatus('error');
      return;
    }

    /* 4. Save access token to ad_accounts table */
    try {
      const { error: dbError } = await supabase.from('ad_accounts').insert({
        clinic_id:    clinicId,
        platform:     'tiktok',
        account_id:   advertiserId,
        account_name: accountName,
        access_token: accessToken,
        is_active:    true,
      });

      if (dbError) {
        throw new Error(dbError.message);
      }
    } catch (e: any) {
      setErrorMsg(`Ошибка сохранения в базу данных: ${e.message}`);
      setStatus('error');
      return;
    }

    /* 5. Redirect to /ads with success message */
    setStatus('success');
    toast.success(`TikTok Ads подключён: ${accountName}`);
    setTimeout(() => setLocation('/ads'), 1500);
  };

  /* ── Render ──────────────────────────────────────────────── */
  return (
    <div style={Wrap}>
      <div style={Card}>
        {status === 'processing' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
              <Loader2
                size={48}
                color="#1E325C"
                style={{ animation: 'spin 1s linear infinite' }}
              />
            </div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0B1220', marginBottom: 8 }}>
              Подключение TikTok Ads...
            </h2>
            <p style={{ fontSize: 14, color: '#64748B', lineHeight: 1.6 }}>
              Обмениваем код авторизации на токен доступа
            </p>
          </>
        )}

        {status === 'success' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
              <CheckCircle2 size={48} color="#16A34A" />
            </div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0B1220', marginBottom: 8 }}>
              TikTok Ads подключён
            </h2>
            <p style={{ fontSize: 14, color: '#64748B' }}>
              Перенаправляем на страницу рекламы...
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
              <AlertCircle size={48} color="#DC2626" />
            </div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0B1220', marginBottom: 8 }}>
              Ошибка подключения
            </h2>
            <p style={{ fontSize: 14, color: '#64748B', lineHeight: 1.6, marginBottom: 4 }}>
              {errorMsg}
            </p>
            <button
              style={LinkBtn}
              onClick={() => setLocation('/ads')}
            >
              Вернуться в Рекламу
            </button>
          </>
        )}
      </div>

      {/* Spinner keyframes */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
