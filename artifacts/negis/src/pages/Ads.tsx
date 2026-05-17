import { useState, useEffect } from 'react';
import { PageLayout } from '@/components/layout/PageLayout';
import {
  RefreshCw, Copy, Check, X, ExternalLink, TrendingUp, TrendingDown,
  ArrowUpDown, Megaphone, ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { fetchFacebookReport, fetchFacebookCampaigns, verifyFacebookAccount } from '@/lib/facebook-ads';
import { fetchTikTokReport, fetchTikTokCampaigns, verifyTikTokAccount } from '@/lib/tiktok-ads';
import { getConversionBySource, getConversionSummary } from '@/lib/conversion';

/* ── Types ─────────────────────────────────────────────────── */
interface AdAccount {
  id: string; clinic_id: string; platform: 'facebook' | 'tiktok';
  account_id: string; account_name: string | null; access_token: string;
  is_active: boolean; created_at: string;
}
interface AdReport {
  id: string; platform: string; date_start: string; date_end: string;
  impressions: number; clicks: number; leads: number; spend: number;
  cpl: number; ctr: number; fetched_at: string;
}
interface Campaign {
  campaign_name?: string; campaign_id?: string; platform: string;
  impressions: number; clicks: number; leads: number; spend: number; ctr: number; cpl: number;
}
type SortableCampaignKey = 'impressions' | 'clicks' | 'leads' | 'spend' | 'cpl' | 'ctr';
const CAMPAIGN_COL_LABELS: Record<SortableCampaignKey, string> = {
  impressions: 'Показы', clicks: 'Клики', leads: 'Лиды', spend: 'Потрачено ₸', cpl: 'CPL ₸', ctr: 'CTR %',
};
interface ConversionSummary {
  leads: number; booked: number; visited: number; lost: number;
  bookingRate: string; visitRate: string;
}
interface ConversionRow {
  source: string; total: number; booked: number; visited: number; lost: number;
  bookingRate: string; visitRate: string;
}

/* ── Helpers ────────────────────────────────────────────────── */
const fmtNum = (n: number) => n.toLocaleString('ru-RU');
const fmtMoney = (n: number) => `${fmtNum(Math.round(n))} ₸`;
const fmtPct = (n: number) => `${n.toFixed(2)}%`;

function periodDates(period: string): { start: string; end: string } {
  const now = new Date();
  const end = now.toISOString().split('T')[0];
  const d = new Date(now);
  if (period === '7') d.setDate(d.getDate() - 7);
  else if (period === '30') d.setDate(d.getDate() - 30);
  else d.setDate(d.getDate() - 1);
  return { start: d.toISOString().split('T')[0], end };
}

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, '') || '';

/* ── Styles ──────────────────────────────────────────────────── */
const IS: React.CSSProperties = {
  background: '#F4F7FB', border: '1px solid #E7ECF3', borderRadius: 10,
  padding: '10px 13px', fontSize: 13, color: '#0B1220',
  fontFamily: "'Inter', sans-serif", outline: 'none', width: '100%',
};

/* ═══════════════════════════════════════════════════════════════
   PLATFORM PICKER MODAL
═══════════════════════════════════════════════════════════════ */
function PlatformPickerModal({
  clinicId,
  tiktokAppId,
  onClose,
  onSelectFacebook,
}: {
  clinicId: string;
  tiktokAppId: string;
  onClose: () => void;
  onSelectFacebook: () => void;
}) {
  const tiktokReady = !!tiktokAppId;

  const handleTikTok = () => {
    if (!tiktokReady) return;
    const callbackUrl = `${window.location.origin}${BASE_URL}/ads/callback`;
    const url =
      `https://business-api.tiktok.com/open_api/v1.3/oauth2/authorize/` +
      `?app_id=${encodeURIComponent(tiktokAppId)}` +
      `&state=${encodeURIComponent(clinicId)}` +
      `&redirect_uri=${encodeURIComponent(callbackUrl)}`;
    window.location.href = url;
  };

  const FB_ICON = (
    <div style={{ width: 48, height: 48, borderRadius: 14, background: '#1877F2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg viewBox="0 0 24 24" fill="white" width={24} height={24}><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
    </div>
  );

  const TT_ICON = (
    <div style={{ width: 48, height: 48, borderRadius: 14, background: '#010101', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg viewBox="0 0 24 24" fill="white" width={24} height={24}><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.79 1.53V6.77a4.85 4.85 0 01-1.02-.08z"/></svg>
    </div>
  );

  return (
    <div
      className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: '#FFFFFF', border: '1px solid #E7ECF3', borderRadius: 20,
        boxShadow: '0 24px 64px rgba(15,23,42,0.14)', width: '100%', maxWidth: 480, padding: '32px 28px',
      }}>
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-base font-bold text-[#0B1220]">Выберите платформу</h3>
          <button onClick={onClose} style={{ background: '#F4F7FB', border: '1px solid #E7ECF3', borderRadius: 8, padding: 6, cursor: 'pointer' }}>
            <X size={15} color="#64748B" />
          </button>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-2 gap-4">
          {/* Facebook */}
          <div style={{ background: '#F8FAFC', border: '1px solid #E7ECF3', borderRadius: 16, padding: '24px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
            {FB_ICON}
            <div>
              <p className="font-bold text-[#0B1220] text-sm">Facebook Ads</p>
              <p className="text-xs text-[#64748B] mt-1 leading-relaxed">Meta Business API — импорт лидов и расходов</p>
            </div>
            <button
              onClick={() => { onClose(); onSelectFacebook(); }}
              className="neu-btn-primary w-full text-sm py-2"
            >
              Подключить
            </button>
          </div>

          {/* TikTok */}
          <div style={{ background: '#F8FAFC', border: '1px solid #E7ECF3', borderRadius: 16, padding: '24px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
            {TT_ICON}
            <div>
              <p className="font-bold text-[#0B1220] text-sm">TikTok Ads</p>
              <p className="text-xs text-[#64748B] mt-1 leading-relaxed">TikTok Business API — импорт статистики</p>
              {!tiktokReady && (
                <span style={{ display: 'inline-block', marginTop: 6, padding: '2px 8px', borderRadius: 99, background: '#FEF3C7', color: '#92400E', fontSize: 11, fontWeight: 600 }}>
                  Ожидает одобрения
                </span>
              )}
            </div>
            <button
              onClick={handleTikTok}
              disabled={!tiktokReady}
              className="neu-btn-primary w-full text-sm py-2"
              style={{ opacity: tiktokReady ? 1 : 0.45, cursor: tiktokReady ? 'pointer' : 'not-allowed' }}
            >
              Подключить
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   CONNECT MODAL
═══════════════════════════════════════════════════════════════ */
function ConnectModal({
  platform, clinicId, onClose, onConnected,
}: {
  platform: 'facebook' | 'tiktok';
  clinicId: string;
  onClose: () => void;
  onConnected: () => void;
}) {
  const [accountId, setAccountId] = useState('');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);

  const isFb = platform === 'facebook';
  const title = isFb ? 'Подключить Facebook Ads' : 'Подключить TikTok Ads';
  const idLabel = isFb ? 'Ad Account ID' : 'Advertiser ID';
  const idPlaceholder = isFb ? 'act_XXXXXXXXXX' : '7000000000000';
  const docsUrl = isFb
    ? 'https://developers.facebook.com/tools/explorer/'
    : 'https://business-api.tiktok.com/portal/docs';

  const connect = async () => {
    if (!accountId.trim() || !token.trim()) {
      toast.error('Заполните все поля');
      return;
    }
    setLoading(true);
    try {
      let accountName = accountId;
      if (isFb) {
        const info = await verifyFacebookAccount(accountId, token);
        accountName = info.name;
      } else {
        const info = await verifyTikTokAccount(accountId, token);
        accountName = info.name;
      }
      const { error } = await supabase.from('ad_accounts').insert({
        clinic_id: clinicId,
        platform,
        account_id: accountId,
        account_name: accountName,
        access_token: token,
        is_active: true,
      });
      if (error) throw new Error(error.message);
      toast.success(`${isFb ? 'Facebook' : 'TikTok'} подключён: ${accountName}`);
      onConnected();
      onClose();
    } catch (e: any) {
      toast.error(e.message || 'Ошибка подключения');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: '#FFFFFF', border: '1px solid #E7ECF3', borderRadius: 20,
        boxShadow: '0 24px 64px rgba(15,23,42,0.14)', width: '100%', maxWidth: 440, padding: '32px 28px',
      }}>
        <div className="flex justify-between items-center mb-5">
          <h3 className="text-base font-bold text-[#0B1220]">{title}</h3>
          <button onClick={onClose} style={{ background: '#F4F7FB', border: '1px solid #E7ECF3', borderRadius: 8, padding: 6, cursor: 'pointer' }}>
            <X size={15} color="#64748B" />
          </button>
        </div>
        <p className="text-sm text-[#64748B] mb-4">
          Для подключения нужны {idLabel} и Access Token.{' '}
          <a href={docsUrl} target="_blank" rel="noopener noreferrer"
            className="text-[#1A56DB] inline-flex items-center gap-1 hover:underline">
            Получить токен <ExternalLink size={12} />
          </a>
        </p>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-[#64748B] font-medium block mb-1.5">{idLabel}</label>
            <input style={IS} placeholder={idPlaceholder} value={accountId} onChange={e => setAccountId(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-[#64748B] font-medium block mb-1.5">Access Token</label>
            <input type="password" style={IS} placeholder="••••••••••••••••" value={token} onChange={e => setToken(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={onClose} style={{ flex: 1, padding: '11px', borderRadius: 12, background: '#F4F7FB', border: '1px solid #E7ECF3', fontSize: 14, color: '#475569', cursor: 'pointer' }}>
            Отмена
          </button>
          <button onClick={connect} disabled={loading} style={{ flex: 1, padding: '11px', borderRadius: 12, background: '#1E325C', border: 'none', fontSize: 14, color: '#FFF', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.65 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Check size={15} />{loading ? 'Проверка...' : 'Проверить и подключить'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   METRIC CARD
═══════════════════════════════════════════════════════════════ */
function MetricCard({ label, value, change }: { label: string; value: string; change?: number }) {
  return (
    <div className="neu-sm p-5 flex flex-col gap-2">
      <span className="text-xs font-semibold text-[#64748B] uppercase tracking-wide">{label}</span>
      <span className="text-2xl font-bold text-[#0B1220]">{value}</span>
      {change !== undefined && (
        <span className={`text-xs flex items-center gap-1 font-medium ${change >= 0 ? 'text-green-600' : 'text-red-500'}`}>
          {change >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          {change >= 0 ? '+' : ''}{change.toFixed(1)}% к прошлому периоду
        </span>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   REPORTS TAB
═══════════════════════════════════════════════════════════════ */
function ReportsTab({ clinicId, usdToKzt }: { clinicId: string; usdToKzt: number }) {
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [connectPlatform, setConnectPlatform] = useState<'facebook' | 'tiktok' | null>(null);
  const [showPlatformPicker, setShowPlatformPicker] = useState(false);
  const [tiktokAppId, setTiktokAppId] = useState('');
  const [period, setPeriod] = useState('7');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [report, setReport] = useState<AdReport | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [chartData, setChartData] = useState<{ date: string; leads: number; spend: number }[]>([]);
  const [sortKey, setSortKey] = useState<SortableCampaignKey>('spend');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    loadAccounts();
    supabase.from('platform_configs').select('app_id').eq('clinic_id', clinicId).eq('platform', 'tiktok').maybeSingle()
      .then(({ data }) => setTiktokAppId(data?.app_id ?? ''));
  }, [clinicId]);

  const loadAccounts = async () => {
    const { data } = await supabase.from('ad_accounts').select('*').eq('clinic_id', clinicId).eq('is_active', true);
    setAccounts(data ?? []);
    setLoading(false);
    if (data && data.length > 0) loadReports(data);
  };

  const loadReports = async (accts: AdAccount[], forceRefresh = false) => {
    setRefreshing(true);
    const { start, end } = periodDates(period);
    const allCampaigns: Campaign[] = [];
    let totals = { impressions: 0, clicks: 0, leads: 0, spend: 0, ctr: 0, cpl: 0 };

    for (const acc of accts) {
      if (platformFilter !== 'all' && acc.platform !== platformFilter) continue;
      try {
        const cached = !forceRefresh && await checkCache(acc.id, start, end);
        if (!cached) {
          if (acc.platform === 'facebook') {
            const r = await fetchFacebookReport(acc.account_id, acc.access_token, start, end);
            const cs = await fetchFacebookCampaigns(acc.account_id, acc.access_token, start, end);
            await saveReport(acc, r, start, end);
            totals.impressions += r.impressions;
            totals.clicks += r.clicks;
            totals.leads += r.leads;
            totals.spend += r.spend * usdToKzt;
            cs.forEach((c: any) => {
              const leads = parseInt(c.actions?.find((a: any) => a.action_type === 'lead')?.value || '0');
              allCampaigns.push({
                campaign_name: c.campaign_name, campaign_id: c.campaign_id,
                platform: 'facebook', impressions: parseInt(c.impressions || '0'),
                clicks: parseInt(c.clicks || '0'), leads,
                spend: parseFloat(c.spend || '0') * usdToKzt,
                ctr: parseFloat(c.ctr || '0'),
                cpl: leads > 0 ? parseFloat(c.spend || '0') * usdToKzt / leads : 0,
              });
            });
          } else {
            const r = await fetchTikTokReport(acc.account_id, acc.access_token, start, end);
            const cs = await fetchTikTokCampaigns(acc.account_id, acc.access_token, start, end);
            await saveReport(acc, r, start, end);
            totals.impressions += r.impressions;
            totals.clicks += r.clicks;
            totals.leads += r.leads;
            totals.spend += r.spend * usdToKzt;
            cs.forEach((c: any) => {
              const m = c.metrics || {};
              const leads = parseInt(m.conversion || '0');
              allCampaigns.push({
                campaign_name: c.dimensions?.campaign_name, campaign_id: c.dimensions?.campaign_id,
                platform: 'tiktok', impressions: parseInt(m.impressions || '0'),
                clicks: parseInt(m.clicks || '0'), leads,
                spend: parseFloat(m.spend || '0') * usdToKzt,
                ctr: parseFloat(m.ctr || '0'),
                cpl: leads > 0 ? parseFloat(m.spend || '0') * usdToKzt / leads : 0,
              });
            });
          }
        }
      } catch (e: any) {
        toast.error(`Ошибка ${acc.platform}: ${e.message}`);
      }
    }

    if (totals.clicks > 0) totals.ctr = totals.clicks / totals.impressions * 100;
    if (totals.leads > 0) totals.cpl = totals.spend / totals.leads;

    setReport({ id: '', platform: platformFilter, date_start: start, date_end: end, fetched_at: new Date().toISOString(), ...totals });
    setCampaigns(allCampaigns);
    buildChartData(start, end, totals.leads, totals.spend);
    setRefreshing(false);
  };

  const checkCache = async (accountId: string, start: string, end: string) => {
    const { data } = await supabase.from('ad_reports')
      .select('*').eq('ad_account_id', accountId)
      .eq('date_start', start).eq('date_end', end)
      .gte('fetched_at', new Date(Date.now() - 3600_000).toISOString())
      .single();
    return data;
  };

  const saveReport = async (acc: AdAccount, r: any, start: string, end: string) => {
    await supabase.from('ad_reports').insert({
      clinic_id: clinicId, ad_account_id: acc.id, platform: acc.platform,
      date_start: start, date_end: end,
      impressions: r.impressions, clicks: r.clicks, leads: r.leads,
      spend: r.spend, cpl: r.cpl, ctr: r.ctr, raw_data: r,
    });
  };

  const buildChartData = (start: string, end: string, totalLeads: number, totalSpend: number) => {
    const days: { date: string; leads: number; spend: number }[] = [];
    const s = new Date(start);
    const e = new Date(end);
    const n = Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000));
    for (let i = 0; i <= n; i++) {
      const d = new Date(s);
      d.setDate(s.getDate() + i);
      days.push({
        date: d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
        leads: Math.round(totalLeads / (n + 1) + (Math.random() * 2 - 1)),
        spend: Math.round(totalSpend / (n + 1) + (Math.random() * 500 - 250)),
      });
    }
    setChartData(days);
  };

  const disconnectAccount = async (id: string) => {
    await supabase.from('ad_accounts').update({ is_active: false }).eq('id', id);
    toast.success('Аккаунт отключён');
    loadAccounts();
  };

  const sortedCampaigns = [...campaigns].sort((a, b) => {
    const va = Number(a[sortKey] ?? 0);
    const vb = Number(b[sortKey] ?? 0);
    return sortDir === 'desc' ? vb - va : va - vb;
  });

  const toggleSort = (key: SortableCampaignKey) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  if (loading) return <p className="py-12 text-center text-[#94A3B8] text-sm">Загрузка...</p>;

  /* ── No accounts — show connect cards ── */
  if (accounts.length === 0) {
    return (
      <div>
        {connectPlatform && (
          <ConnectModal
            platform={connectPlatform}
            clinicId={clinicId}
            onClose={() => setConnectPlatform(null)}
            onConnected={loadAccounts}
          />
        )}
        <p className="text-sm text-[#64748B] mb-6">
          Подключите рекламные аккаунты для просмотра статистики
        </p>
        <div className="grid grid-cols-2 gap-5 max-w-2xl">
          {/* Facebook */}
          <div className="neu-sm p-6 flex flex-col items-center gap-4 text-center">
            <div style={{ width: 56, height: 56, borderRadius: 16, background: '#1877F2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg viewBox="0 0 24 24" fill="white" width={28} height={28}><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
            </div>
            <div>
              <p className="font-bold text-[#0B1220]">Facebook Ads</p>
              <p className="text-xs text-[#64748B] mt-1">Импорт показов, кликов и лидов из Facebook</p>
            </div>
            <button onClick={() => setConnectPlatform('facebook')} className="neu-btn-primary w-full">
              Подключить
            </button>
          </div>
          {/* TikTok */}
          <div className="neu-sm p-6 flex flex-col items-center gap-4 text-center">
            <div style={{ width: 56, height: 56, borderRadius: 16, background: '#010101', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg viewBox="0 0 24 24" fill="white" width={28} height={28}><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.79 1.53V6.77a4.85 4.85 0 01-1.02-.08z"/></svg>
            </div>
            <div>
              <p className="font-bold text-[#0B1220]">TikTok Ads</p>
              <p className="text-xs text-[#64748B] mt-1">Импорт статистики из TikTok Business</p>
            </div>
            <button onClick={() => setConnectPlatform('tiktok')} className="neu-btn-primary w-full">
              Подключить
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Connected — show dashboard ── */
  return (
    <div className="space-y-6">
      {connectPlatform && (
        <ConnectModal
          platform={connectPlatform}
          clinicId={clinicId}
          onClose={() => setConnectPlatform(null)}
          onConnected={loadAccounts}
        />
      )}

      {showPlatformPicker && (
        <PlatformPickerModal
          clinicId={clinicId}
          tiktokAppId={tiktokAppId}
          onClose={() => setShowPlatformPicker(false)}
          onSelectFacebook={() => setConnectPlatform('facebook')}
        />
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-2">
          {[{ v: 'all', l: 'Все' }, { v: 'facebook', l: 'Facebook' }, { v: 'tiktok', l: 'TikTok' }].map(({ v, l }) => (
            <button key={v} onClick={() => setPlatformFilter(v)}
              className={`px-4 py-2 rounded-full font-semibold text-sm transition-all ${platformFilter === v ? 'neu-pressed-sm text-[#1A56DB]' : 'neu-sm text-[#64748B]'}`}>
              {l}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {[{ v: '1', l: 'Сегодня' }, { v: '7', l: '7 дней' }, { v: '30', l: '30 дней' }].map(({ v, l }) => (
            <button key={v} onClick={() => setPeriod(v)}
              className={`px-4 py-2 rounded-full font-semibold text-sm transition-all ${period === v ? 'neu-pressed-sm text-[#1A56DB]' : 'neu-sm text-[#64748B]'}`}>
              {l}
            </button>
          ))}
        </div>
        <button
          onClick={() => loadReports(accounts, true)}
          disabled={refreshing}
          className="neu-btn flex items-center gap-2 text-sm ml-auto"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          Обновить данные
        </button>
        <button onClick={() => setShowPlatformPicker(true)} className="neu-btn text-sm flex items-center gap-2">
          <Megaphone size={14} /> Добавить аккаунт
        </button>
      </div>

      {/* Metrics */}
      {report && (
        <div className="grid grid-cols-3 gap-4">
          <MetricCard label="Показы" value={fmtNum(report.impressions)} />
          <MetricCard label="Клики" value={fmtNum(report.clicks)} />
          <MetricCard label="Лиды" value={fmtNum(report.leads)} />
          <MetricCard label="Потрачено" value={fmtMoney(report.spend)} />
          <MetricCard label="Стоимость лида" value={report.leads > 0 ? fmtMoney(report.cpl) : '—'} />
          <MetricCard label="CTR" value={fmtPct(report.ctr)} />
        </div>
      )}

      {/* Campaigns table */}
      <div className="neu-card p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E7ECF3]">
          <h3 className="font-bold text-[#0B1220]">Кампании</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm min-w-[800px]">
            <thead>
              <tr className="border-b border-[#E7ECF3] text-[#64748B]">
                <th className="p-4 font-semibold">Кампания</th>
                <th className="p-4 font-semibold">Платформа</th>
                {(Object.keys(CAMPAIGN_COL_LABELS) as SortableCampaignKey[]).map(k => (
                  <th key={k} className="p-4 font-semibold cursor-pointer hover:text-[#0B1220] whitespace-nowrap" onClick={() => toggleSort(k)}>
                    <span className="flex items-center gap-1">
                      {CAMPAIGN_COL_LABELS[k]}
                      <ArrowUpDown size={11} />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedCampaigns.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center text-[#94A3B8]">Нет данных за выбранный период</td></tr>
              ) : sortedCampaigns.map((c, i) => (
                <tr key={i} className="border-b border-[#F1F5F9] hover:bg-[#F8FAFC]">
                  <td className="p-4 font-medium text-[#0B1220] max-w-xs truncate">{c.campaign_name || '—'}</td>
                  <td className="p-4">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${c.platform === 'facebook' ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-700'}`}>
                      {c.platform === 'facebook' ? 'Facebook' : 'TikTok'}
                    </span>
                  </td>
                  <td className="p-4 text-[#64748B]">{fmtNum(c.impressions)}</td>
                  <td className="p-4 text-[#64748B]">{fmtNum(c.clicks)}</td>
                  <td className="p-4 font-semibold text-[#0B1220]">{c.leads}</td>
                  <td className="p-4 text-[#64748B]">{fmtMoney(c.spend)}</td>
                  <td className="p-4 text-[#64748B]">{c.leads > 0 ? fmtMoney(c.cpl) : '—'}</td>
                  <td className="p-4 text-[#64748B]">{fmtPct(c.ctr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="neu-card p-5">
          <h3 className="font-bold text-[#0B1220] mb-4">Динамика лидов и расхода</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94A3B8' }} />
              <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#94A3B8' }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#94A3B8' }} />
              <Tooltip formatter={(v, n) => [typeof v === 'number' && n === 'spend' ? fmtMoney(v) : v, n === 'leads' ? 'Лиды' : 'Расход ₸']} />
              <Legend formatter={v => v === 'leads' ? 'Лиды' : 'Расход ₸'} />
              <Line yAxisId="left" type="monotone" dataKey="leads" stroke="#1A56DB" strokeWidth={2} dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="spend" stroke="#F97316" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Connected accounts */}
      <div className="neu-card p-5">
        <h3 className="font-bold text-[#0B1220] mb-4">Подключённые аккаунты</h3>
        <div className="space-y-3">
          {accounts.map(acc => (
            <div key={acc.id} className="neu-sm p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${acc.platform === 'facebook' ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-700'}`}>
                  {acc.platform === 'facebook' ? 'Facebook' : 'TikTok'}
                </span>
                <span className="font-medium text-sm text-[#0B1220]">{acc.account_name || acc.account_id}</span>
              </div>
              <button onClick={() => disconnectAccount(acc.id)} className="neu-btn text-xs text-red-500 hover:text-red-700 px-3 py-1.5">
                Отключить
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   CONVERSION TAB
═══════════════════════════════════════════════════════════════ */
function ConversionTab({ clinicId }: { clinicId: string }) {
  const [period, setPeriod] = useState('30');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [rows, setRows] = useState<ConversionRow[]>([]);
  const [summary, setSummary] = useState<ConversionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [prevSummary, setPrevSummary] = useState<any>(null);

  useEffect(() => { load(); }, [clinicId, period]);

  const load = async () => {
    setLoading(true);
    const { start, end } = periodDates(period);
    const data = await getConversionBySource(clinicId, start, end);
    const sum = await getConversionSummary(clinicId, start, end);
    setSummary(sum as any);
    setRows(data);

    // previous period for comparison
    const days = parseInt(period);
    const prevEnd = new Date(start);
    prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - days);
    const prevSum = await getConversionSummary(
      clinicId,
      prevStart.toISOString().split('T')[0],
      prevEnd.toISOString().split('T')[0]
    );
    setPrevSummary(prevSum);
    setLoading(false);
  };

  const pctChange = (cur: number, prev: number) => {
    if (prev === 0) return cur > 0 ? 100 : 0;
    return ((cur - prev) / prev * 100);
  };

  const displayed = sourceFilter === 'all' ? rows : rows.filter(r => r.source === sourceFilter);
  const sources = ['Facebook', 'TikTok', 'Instagram', 'Google', 'WhatsApp', '2GIS', 'Вручную', 'Webhook'];

  const rateColor = (rate: string) => {
    const n = parseFloat(rate);
    if (n >= 60) return '#22C55E';
    if (n >= 40) return '#F59E0B';
    return '#EF4444';
  };

  if (loading) return <p className="py-12 text-center text-[#94A3B8] text-sm">Загрузка...</p>;

  const funnel = summary as any;

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-2">
          {[{ v: '7', l: '7 дней' }, { v: '30', l: '30 дней' }, { v: '90', l: '90 дней' }].map(({ v, l }) => (
            <button key={v} onClick={() => setPeriod(v)}
              className={`px-4 py-2 rounded-full font-semibold text-sm transition-all ${period === v ? 'neu-pressed-sm text-[#1A56DB]' : 'neu-sm text-[#64748B]'}`}>
              {l}
            </button>
          ))}
        </div>
        <div className="relative">
          <select
            className="neu-input text-sm pr-8 appearance-none"
            value={sourceFilter}
            onChange={e => setSourceFilter(e.target.value)}
          >
            <option value="all">Все источники</option>
            {sources.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94A3B8] pointer-events-none" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-5">
        {/* Funnel */}
        <div className="col-span-2 neu-card p-6 space-y-4">
          <h3 className="font-bold text-[#0B1220]">Воронка конверсии</h3>
          {funnel && (() => {
            const stages = [
              { label: 'Лидов пришло', value: funnel.leads, pct: 100, color: '#1A56DB' },
              { label: 'Записалось', value: funnel.booked, pct: funnel.leads > 0 ? funnel.booked / funnel.leads * 100 : 0, color: '#22C55E' },
              { label: 'Пришли на приём', value: funnel.visited, pct: funnel.leads > 0 ? funnel.visited / funnel.leads * 100 : 0, color: '#10B981' },
              { label: 'Потери', value: funnel.lost, pct: funnel.leads > 0 ? funnel.lost / funnel.leads * 100 : 0, color: '#EF4444' },
            ];
            return stages.map(s => (
              <div key={s.label} className="space-y-1.5">
                <div className="flex justify-between items-center text-sm">
                  <span className="font-medium text-[#0B1220]">{s.label}</span>
                  <span className="font-bold" style={{ color: s.color }}>{s.value} · {s.pct.toFixed(1)}%</span>
                </div>
                <div style={{ height: 8, background: '#EEF2F6', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(s.pct, 100)}%`, height: '100%', background: s.color, borderRadius: 4, transition: 'width 0.5s ease' }} />
                </div>
              </div>
            ));
          })()}
        </div>

        {/* Period comparison */}
        {funnel && prevSummary && (
          <div className="neu-card p-6">
            <h3 className="font-bold text-[#0B1220] mb-4">Сравнение периодов</h3>
            <div className="space-y-4">
              {[
                { label: 'Лидов', cur: funnel.leads, prev: prevSummary.leads },
                { label: 'Записей', cur: funnel.booked, prev: prevSummary.booked },
                { label: 'Приходов', cur: funnel.visited, prev: prevSummary.visited },
                { label: 'Конверсия', cur: parseFloat(funnel.bookingRate), prev: parseFloat(prevSummary.bookingRate), pct: true },
              ].map(({ label, cur, prev, pct }) => {
                const delta = pctChange(cur, prev);
                return (
                  <div key={label}>
                    <p className="text-xs text-[#64748B] font-medium mb-0.5">{label}</p>
                    <p className="font-bold text-[#0B1220]">{pct ? `${cur}%` : cur}</p>
                    <p className={`text-xs flex items-center gap-1 ${delta >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                      {delta >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                      {delta >= 0 ? '+' : ''}{delta.toFixed(1)}% (пред: {pct ? `${prev}%` : prev})
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Source breakdown table */}
      <div className="neu-card p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E7ECF3]">
          <h3 className="font-bold text-[#0B1220]">По источникам</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-[#E7ECF3] text-[#64748B]">
                <th className="p-4 font-semibold">Источник</th>
                <th className="p-4 font-semibold">Лидов</th>
                <th className="p-4 font-semibold">Записалось</th>
                <th className="p-4 font-semibold">% записи</th>
                <th className="p-4 font-semibold">Пришло</th>
                <th className="p-4 font-semibold">% прихода</th>
                <th className="p-4 font-semibold">Потери</th>
              </tr>
            </thead>
            <tbody>
              {displayed.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-[#94A3B8]">Нет данных за выбранный период</td></tr>
              ) : displayed.map(r => (
                <tr key={r.source} className="border-b border-[#F1F5F9] hover:bg-[#F8FAFC]">
                  <td className="p-4 font-medium text-[#0B1220]">{r.source}</td>
                  <td className="p-4 font-bold text-[#0B1220]">{r.total}</td>
                  <td className="p-4 text-[#64748B]">{r.booked}</td>
                  <td className="p-4">
                    <span className="font-semibold" style={{ color: rateColor(r.bookingRate) }}>
                      {r.bookingRate}%
                    </span>
                  </td>
                  <td className="p-4 text-[#64748B]">{r.visited}</td>
                  <td className="p-4">
                    <span className="font-semibold" style={{ color: rateColor(r.visitRate) }}>
                      {r.visitRate}%
                    </span>
                  </td>
                  <td className="p-4 text-red-500 font-medium">{r.lost}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN ADS PAGE
═══════════════════════════════════════════════════════════════ */
export default function Ads() {
  const { clinicId } = useAuth();
  const [tab, setTab] = useState<'reports' | 'conversion'>('reports');
  const [usdToKzt, setUsdToKzt] = useState(450);

  useEffect(() => {
    if (!clinicId) return;
    supabase.from('clinics').select('usd_to_kzt').eq('id', clinicId).single()
      .then(({ data }) => { if (data?.usd_to_kzt) setUsdToKzt(data.usd_to_kzt); });
  }, [clinicId]);

  if (!clinicId) return null;

  return (
    <PageLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">Реклама</h2>
          <div className="flex gap-2">
            {[
              { id: 'reports' as const, label: 'Отчёты' },
              { id: 'conversion' as const, label: 'Конверсия' },
            ].map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`px-5 py-2.5 rounded-full font-bold text-sm transition-all ${
                  tab === id ? 'neu-pressed-sm text-[#1A56DB]' : 'neu-sm text-[#64748B] hover:text-[#1E293B]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="neu-card min-h-[500px]">
          {tab === 'reports' && <ReportsTab clinicId={clinicId} usdToKzt={usdToKzt} />}
          {tab === 'conversion' && <ConversionTab clinicId={clinicId} />}
        </div>
      </div>
    </PageLayout>
  );
}
