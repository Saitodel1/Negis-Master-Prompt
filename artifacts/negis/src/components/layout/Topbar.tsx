import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'wouter';
import { Bell } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

const PAGE_LABELS: Record<string, string> = {
  '/dashboard': 'DASHBOARD',
  '/booking':   'BOOKING',
  '/reception': 'RECEPTION',
  '/sales':     'CRM',
  '/agent':     'AGENT',
  '/admin':     'ADMIN',
};

interface Notif {
  id: string;
  clientName: string;
  agentName: string;
  date: string;
  time: string;
  createdAt: string;
  isNew?: boolean;
}

function playBeep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 520;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.15);
    osc.onended = () => ctx.close();
  } catch {
    // AudioContext not available
  }
}

export function Topbar() {
  const [location] = useLocation();
  const { clinicId } = useAuth();
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const agentsRef = useRef<Record<string, string>>({});

  const pageLabel = PAGE_LABELS[location] ?? 'NEGIS';

  const today = new Date().toLocaleDateString('ru', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const fmtDate = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });

  const buildNotif = useCallback((r: any): Notif => ({
    id: r.id,
    clientName: r.patient_name ?? r.name ?? r.client_name ?? 'Клиент',
    agentName: r.agent_id ? (agentsRef.current[r.agent_id] ?? '—') : '—',
    date: r.date,
    time: r.time ?? (r.slot_hour != null ? `${r.slot_hour}:00` : '—'),
    createdAt: r.created_at,
  }), []);

  useEffect(() => {
    if (!clinicId) return;

    const load = async () => {
      const [{ data: agentsData }, { data: bookings }] = await Promise.all([
        supabase.from('agents').select('id, name').eq('clinic_id', clinicId),
        supabase
          .from('bookings')
          .select('id, patient_name, date, time, created_at')
          .eq('clinic_id', clinicId)
          .order('created_at', { ascending: false })
          .limit(15),
      ]);

      agentsRef.current = Object.fromEntries((agentsData ?? []).map(a => [a.id, a.name]));
      setNotifs((bookings ?? []).map(buildNotif));
    };

    load();

    const channel = supabase
      .channel(`bookings-notify-${clinicId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'bookings', filter: `clinic_id=eq.${clinicId}` },
        (payload) => {
          const row = payload.new as any;
          const notif: Notif = {
            id: row.id,
            clientName: row.patient_name ?? row.name ?? row.client_name ?? 'Клиент',
            agentName: row.agent_id ? (agentsRef.current[row.agent_id] ?? '—') : '—',
            date: row.date,
            time: row.time ?? (row.slot_hour != null ? `${String(row.slot_hour).padStart(2, '0')}:00` : '—'),
            createdAt: row.created_at,
            isNew: true,
          };
          setNotifs(prev => [notif, ...prev.slice(0, 14)]);
          setUnread(prev => prev + 1);
          playBeep();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [clinicId, buildNotif]);

  const handleOpen = (v: boolean) => {
    setOpen(v);
    if (v) setUnread(0);
  };

  return (
    <header
      className="flex items-center justify-between shrink-0 sticky top-0 z-10 px-8"
      style={{
        height: 56,
        background: 'rgba(244,247,251,0.9)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid #E7ECF3',
      }}
    >
      {/* Left — breadcrumb label */}
      <div className="flex items-center gap-2">
        <span
          style={{
            fontSize: 12,
            fontWeight: 500,
            letterSpacing: '0.14em',
            color: '#94A3B8',
            fontFamily: "'Inter', sans-serif",
            userSelect: 'none',
          }}
        >
          NEGIS
        </span>
        <span style={{ color: '#DDE5EE', fontSize: 14 }}>/</span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.14em',
            color: '#475569',
            fontFamily: "'Inter', sans-serif",
            userSelect: 'none',
          }}
        >
          {pageLabel}
        </span>
      </div>

      {/* Right */}
      <div className="flex items-center gap-4">
        <span
          style={{
            fontSize: 12,
            color: '#94A3B8',
            fontFamily: "'Inter', sans-serif",
            letterSpacing: '0.01em',
            display: 'flex',
            alignItems: 'center',
            gap: 7,
          }}
        >
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
          </span>
          {today}
        </span>

        <Popover open={open} onOpenChange={handleOpen}>
          <PopoverTrigger asChild>
            <button
              className="neu-icon-btn relative"
              style={{ width: 36, height: 36, borderRadius: 10 }}
            >
              <Bell size={16} strokeWidth={1.75} />
              {unread > 0 && (
                <span
                  className="absolute -top-0.5 -right-0.5 flex items-center justify-center rounded-full text-white font-bold"
                  style={{
                    background: '#DC2626',
                    fontSize: 9,
                    width: 14,
                    height: 14,
                    fontFamily: "'Inter', sans-serif",
                  }}
                >
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-80 p-0"
            align="end"
            style={{
              background: '#FFFFFF',
              border: '1px solid #E7ECF3',
              borderRadius: 14,
              boxShadow: '0 12px 32px rgba(15,23,42,0.1)',
            }}
          >
            <div
              className="px-5 py-4 font-semibold text-sm flex items-center justify-between"
              style={{ borderBottom: '1px solid #E7ECF3', color: '#0B1220', letterSpacing: '0.01em' }}
            >
              <span>Уведомления</span>
              {notifs.length > 0 && (
                <span style={{ fontSize: 11, color: '#94A3B8', fontWeight: 400 }}>
                  {notifs.length} записей
                </span>
              )}
            </div>
            <div className="max-h-72 overflow-y-auto">
              {notifs.length === 0 ? (
                <div className="px-5 py-8 text-center" style={{ color: '#94A3B8', fontSize: 13 }}>
                  Нет уведомлений
                </div>
              ) : notifs.map(n => (
                <div
                  key={n.id}
                  className="px-5 py-4 cursor-default transition-colors"
                  style={{
                    borderBottom: '1px solid #F4F7FB',
                    background: n.isNew ? '#F0F6FF' : 'transparent',
                  }}
                  onMouseEnter={e => ((e.currentTarget as HTMLDivElement).style.background = '#F4F7FB')}
                  onMouseLeave={e => ((e.currentTarget as HTMLDivElement).style.background = n.isNew ? '#F0F6FF' : 'transparent')}
                >
                  <p className="text-sm font-medium" style={{ color: '#0B1220' }}>
                    Новая запись — {n.clientName}
                  </p>
                  <p className="text-xs mt-1" style={{ color: '#64748B' }}>
                    {fmtDate(n.date)} в {n.time}
                    {n.agentName !== '—' && <> · {n.agentName}</>}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: '#CBD5E1' }}>
                    {new Date(n.createdAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </header>
  );
}
