import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'wouter';
import { Bell, CalendarDays, Check, ChevronDown, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { agentDisplayName, agentInitials, loadAgentRoleMaps, type AgentDisplayInfo } from '@/lib/agentDisplay';
import { TopNav } from './TopNav';

interface Notif {
  id: string;
  kind: 'booking' | 'task' | 'automation' | 'wazzup';
  taskId?: string;
  leadId?: string;
  contactId?: string;
  title?: string;
  body?: string;
  clientName: string;
  agentName: string;
  date: string;
  time: string;
  createdAt: string;
  read: boolean;
}

let notificationAudioContext: AudioContext | null = null;

function getNotificationAudioContext() {
  if (typeof window === 'undefined') return null;
  notificationAudioContext ??= new AudioContext();
  return notificationAudioContext;
}

function unlockNotificationSound() {
  const ctx = getNotificationAudioContext();
  if (ctx?.state === 'suspended') void ctx.resume();
}

function playNotificationSound() {
  try {
    const ctx = getNotificationAudioContext();
    if (!ctx || ctx.state !== 'running') return;

    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.42);

    [784, 1046].forEach((frequency, index) => {
      const oscillator = ctx.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, ctx.currentTime + index * 0.11);
      oscillator.connect(gain);
      oscillator.start(ctx.currentTime + index * 0.11);
      oscillator.stop(ctx.currentTime + 0.25 + index * 0.11);
    });
  } catch {
    // The browser can deny audio until the user interacts with the app.
  }
}

const readKey = (clinicId: string | null) => `negis_notifications_read_${clinicId ?? 'default'}`;
const deletedKey = (clinicId: string | null) => `negis_notifications_deleted_${clinicId ?? 'default'}`;

function readStoredIds(key: string) {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(key) || '[]'));
  } catch {
    return new Set<string>();
  }
}

function writeStoredIds(key: string, ids: Set<string>) {
  localStorage.setItem(key, JSON.stringify(Array.from(ids)));
}

export function Topbar() {
  const [location, setLocation] = useLocation();
  const { clinicId, user, userRole } = useAuth();
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [open, setOpen] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const [profileAgent, setProfileAgent] = useState<AgentDisplayInfo | null>(null);
  const agentsRef = useRef<Record<string, string>>({});
  const myAgentIdRef = useRef<string | null>(null);
  const readIdsRef = useRef<Set<string>>(new Set());
  const deletedIdsRef = useRef<Set<string>>(new Set());

  const unread = notifs.filter(n => !n.read).length;
  const avatarSrc = profileAgent?.avatar_url || user?.user_metadata?.avatar_url || '';
  const avatarIcon = profileAgent?.avatar_icon || user?.user_metadata?.avatar_icon || '';
  const avatarBg = profileAgent?.avatar_color || user?.user_metadata?.avatar_color || '#17233A';
  const displayName = user?.user_metadata?.full_name || profileAgent?.name || user?.email || 'Профиль';
  const initials = agentInitials(profileAgent, displayName);
  const isDashboard = location.split('?')[0] === '/dashboard';
  const dashboardDate = clock.toLocaleDateString('ru-RU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  useEffect(() => {
    const unlock = () => unlockNotificationSound();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setClock(new Date()), 30000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!clinicId || !user?.id) return;
    const loadProfileAgent = async () => {
      const { data } = await supabase
        .from('agents')
        .select('id, name, user_id, role_id, avatar_url, avatar_icon, avatar_color')
        .eq('clinic_id', clinicId)
        .eq('user_id', user.id)
        .maybeSingle();
      setProfileAgent((data as AgentDisplayInfo | null) ?? null);
    };
    loadProfileAgent();
  }, [clinicId, user?.id]);

  const fmtDate = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });

  const buildNotif = useCallback((r: any): Notif => ({
    id: r.id,
    kind: 'booking',
    clientName: r.patient_name ?? r.name ?? r.client_name ?? 'Клиент',
    agentName: r.agent_id ? (agentsRef.current[r.agent_id] ?? '—') : '—',
    date: r.date,
    time: r.time ?? (r.slot_hour != null ? `${String(r.slot_hour).padStart(2, '0')}:00` : '—'),
    createdAt: r.created_at,
    read: readIdsRef.current.has(r.id),
  }), []);

  const buildTaskNotif = useCallback((r: any): Notif => ({
    id: r.id,
    kind: 'task',
    taskId: r.task_id,
    title: r.title || 'Задача',
    body: r.body || '',
    clientName: r.title || 'Задача',
    agentName: '—',
    date: r.created_at?.slice(0, 10) || new Date().toISOString().slice(0, 10),
    time: r.created_at ? new Date(r.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—',
    createdAt: r.created_at,
    read: Boolean(r.is_read) || readIdsRef.current.has(r.id),
  }), []);

  const buildAutomationNotif = useCallback((r: any): Notif => ({
    id: r.id,
    kind: 'automation',
    taskId: r.task_id || undefined,
    leadId: r.lead_id || undefined,
    title: r.title || 'Автоматизация',
    body: r.body || '',
    clientName: r.title || 'Автоматизация',
    agentName: '—',
    date: r.created_at?.slice(0, 10) || new Date().toISOString().slice(0, 10),
    time: r.created_at ? new Date(r.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—',
    createdAt: r.created_at,
    read: Boolean(r.is_read) || readIdsRef.current.has(r.id),
  }), []);

  const buildWazzupNotif = useCallback((r: any): Notif => {
    const createdAt = r.created_at || new Date().toISOString();
    const linkedContact = Array.isArray(r.wz_contacts) ? r.wz_contacts[0] : r.wz_contacts;
    return {
      id: r.id,
      kind: 'wazzup',
      contactId: linkedContact?.contact_id || r.contact_id || undefined,
      title: 'Новое сообщение WhatsApp',
      body: r.text || 'Новое входящее сообщение',
      clientName: r.contact_name || r.chat_id || 'WhatsApp',
      agentName: '—',
      date: createdAt.slice(0, 10),
      time: new Date(createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
      createdAt,
      read: readIdsRef.current.has(r.id),
    };
  }, []);

  useEffect(() => {
    if (!clinicId) return;
    readIdsRef.current = readStoredIds(readKey(clinicId));
    deletedIdsRef.current = readStoredIds(deletedKey(clinicId));

    const load = async () => {
      const [{ data: agentsData }, { data: bookings }, { data: taskRows }, { data: automationRows }, { data: wazzupRows }] = await Promise.all([
        supabase.from('agents').select('id, name, user_id, role_id').eq('clinic_id', clinicId),
        supabase
          .from('bookings')
          .select('id, patient_name, agent_id, date, time, created_at')
          .eq('clinic_id', clinicId)
          .order('created_at', { ascending: false })
          .limit(15),
        supabase
          .from('task_notifications')
          .select('id, recipient_agent_id, task_id, title, body, is_read, created_at')
          .eq('clinic_id', clinicId)
          .order('created_at', { ascending: false })
          .limit(15),
        supabase
          .from('automation_notifications')
          .select('id, recipient_agent_id, kind, title, body, lead_id, task_id, is_read, created_at')
          .eq('clinic_id', clinicId)
          .order('created_at', { ascending: false })
          .limit(15),
        supabase
          .from('wz_messages')
          .select('id, wz_contact_id, chat_id, contact_name, text, is_echo, created_at, wz_contacts(contact_id)')
          .eq('clinic_id', clinicId)
          .eq('is_echo', false)
          .order('created_at', { ascending: false })
          .limit(15),
      ]);

      const agentRows = (agentsData ?? []) as AgentDisplayInfo[];
      const maps = await loadAgentRoleMaps(supabase, clinicId, agentRows);
      agentsRef.current = Object.fromEntries(agentRows.map(a => [a.id, agentDisplayName(a, maps.customRoleMap, maps.userRoleMap)]));
      const myAgentId = agentRows.find(agent => agent.user_id === user?.id)?.id;
      myAgentIdRef.current = myAgentId ?? null;
      const bookingNotifs = (bookings ?? [])
        .filter(row => !deletedIdsRef.current.has(row.id))
        .map(buildNotif);
      const taskNotifs = (taskRows ?? [])
        .filter(row => row.recipient_agent_id === myAgentId && !deletedIdsRef.current.has(row.id))
        .map(buildTaskNotif);
      const automationNotifs = (automationRows ?? [])
        .filter(row => !deletedIdsRef.current.has(row.id))
        .map(buildAutomationNotif);
      const wazzupNotifs = (wazzupRows ?? [])
        .filter(row => !deletedIdsRef.current.has(row.id))
        .map(buildWazzupNotif);
      setNotifs([...wazzupNotifs, ...automationNotifs, ...taskNotifs, ...bookingNotifs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30));
    };

    load();

    const channel = supabase
      .channel(`bookings-notify-${clinicId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'bookings', filter: `clinic_id=eq.${clinicId}` },
        (payload) => {
          const row = payload.new as any;
          if (deletedIdsRef.current.has(row.id)) return;
          const notif = buildNotif(row);
          setNotifs(prev => [notif, ...prev.filter(n => n.id !== notif.id).slice(0, 14)]);
          playNotificationSound();
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'task_notifications', filter: `clinic_id=eq.${clinicId}` },
        (payload) => {
          const row = payload.new as any;
          if (deletedIdsRef.current.has(row.id)) return;
          if (row.recipient_agent_id !== myAgentIdRef.current) return;
          const notif = buildTaskNotif(row);
          setNotifs(prev => [notif, ...prev.filter(n => n.id !== notif.id).slice(0, 29)]);
          playNotificationSound();
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'automation_notifications', filter: `clinic_id=eq.${clinicId}` },
        (payload) => {
          const row = payload.new as any;
          if (deletedIdsRef.current.has(row.id)) return;
          const notif = buildAutomationNotif(row);
          setNotifs(prev => [notif, ...prev.filter(n => n.id !== notif.id).slice(0, 29)]);
          playNotificationSound();
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'wz_messages', filter: `clinic_id=eq.${clinicId}` },
        async (payload) => {
          const row = payload.new as any;
          if (row.is_echo || deletedIdsRef.current.has(row.id)) return;
          let linkedContact: { contact_id: string | null } | null = null;
          for (let attempt = 0; attempt < 4 && !linkedContact?.contact_id; attempt += 1) {
            if (attempt > 0) await new Promise(resolve => window.setTimeout(resolve, 250));
            const { data } = await supabase
              .from('wz_contacts')
              .select('contact_id')
              .eq('id', row.wz_contact_id)
              .maybeSingle();
            linkedContact = data;
          }
          const notif = buildWazzupNotif({ ...row, wz_contacts: linkedContact });
          setNotifs(prev => [notif, ...prev.filter(n => n.id !== notif.id).slice(0, 29)]);
          toast.message(`WhatsApp — ${notif.clientName}`, { description: notif.body });
          playNotificationSound();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [clinicId, user?.id, buildNotif, buildTaskNotif, buildAutomationNotif, buildWazzupNotif]);

  const markRead = (id: string) => {
    const notification = notifs.find(item => item.id === id);
    if (notification?.kind === 'task') {
      void supabase.from('task_notifications').update({ is_read: true }).eq('id', id);
    }
    if (notification?.kind === 'automation') {
      void supabase.from('automation_notifications').update({ is_read: true }).eq('id', id);
    }
    readIdsRef.current.add(id);
    writeStoredIds(readKey(clinicId), readIdsRef.current);
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const deleteNotif = (id: string) => {
    deletedIdsRef.current.add(id);
    writeStoredIds(deletedKey(clinicId), deletedIdsRef.current);
    setNotifs(prev => prev.filter(n => n.id !== id));
  };

  const openEvent = (n: Notif) => {
    markRead(n.id);
    if (n.kind === 'wazzup') {
      setOpen(false);
      setLocation(n.contactId ? `/sales?tab=contacts&contact=${n.contactId}` : '/sales?tab=contacts');
      return;
    }
    if ((n.kind === 'task' || n.kind === 'automation') && n.taskId) {
      setOpen(false);
      setLocation(`/tasks?task=${n.taskId}`);
      return;
    }
    if (n.kind === 'automation') {
      setOpen(false);
      if (n.leadId) {
        sessionStorage.setItem('negis_focus_lead', n.leadId);
        setLocation('/sales');
      } else {
        setLocation('/dashboard');
      }
      return;
    }
    sessionStorage.setItem('negis_focus_booking', JSON.stringify({ id: n.id, date: n.date }));
    setOpen(false);
    setLocation('/reception');
  };

  return (
    <>
      <TopNav />
      <header
        className={`ng-topbar ${isDashboard ? 'dashboard-topbar' : ''} grid shrink-0 sticky top-0 z-30 items-center gap-4 px-7`}
        style={{
          gridTemplateColumns: 'minmax(420px, 1fr) minmax(440px, auto)',
          height: 88,
          background: 'rgba(238, 247, 250, 0.62)',
          backdropFilter: 'blur(24px) saturate(120%)',
          WebkitBackdropFilter: 'blur(24px) saturate(120%)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.68)',
          boxShadow: '0 12px 30px rgba(68, 93, 105, 0.08)',
        }}
      >
      {isDashboard ? (
        <div className="dashboard-topbar-welcome">
          <h1>Продуктивного дня, {displayName}</h1>
          <p><CalendarDays size={13} />{dashboardDate}</p>
        </div>
      ) : (
        <div className="topbar-search">
          <Search size={18} />
          <input placeholder="Поиск по клиентам, тегам, задачам..." />
        </div>
      )}

      <div className="flex items-center justify-end gap-4">
        {!isDashboard && <span
          style={{
            fontSize: 12,
            color: '#607089',
            fontFamily: "'Inter', sans-serif",
            letterSpacing: '0.08em',
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            textTransform: 'uppercase',
            fontWeight: 800,
          }}
        >
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
          </span>
          Online
        </span>}

        {!isDashboard && <span
          className="hidden sm:inline-flex items-center gap-2 text-xs font-bold text-[#607089]"
          style={{ letterSpacing: '0.04em' }}
        >
          {clock.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
        </span>}

        {isDashboard && (
          <button type="button" className="dashboard-branch" onClick={() => setLocation('/admin')}>
            <span>Основной филиал</span>
            <ChevronDown size={14} />
          </button>
        )}

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              className="neu-icon-btn relative"
              style={{ width: 36, height: 36, borderRadius: 12 }}
            >
              <Bell size={16} strokeWidth={1.75} />
              {unread > 0 && (
                <span
                  className="absolute -top-1 -right-1 flex items-center justify-center rounded-full text-white font-bold"
                  style={{
                    background: '#DC2626',
                    fontSize: 9,
                    minWidth: 16,
                    height: 16,
                    padding: '0 4px',
                    fontFamily: "'Inter', sans-serif",
                  }}
                >
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-96 p-0"
            align="end"
            style={{
              background: 'rgba(255,255,255,0.94)',
              border: '1px solid #E3EAF2',
              borderRadius: 18,
              boxShadow: '0 16px 40px rgba(15,23,42,0.12)',
              overflow: 'hidden',
            }}
          >
            <div
              className="px-5 py-4 font-semibold text-sm flex items-center justify-between"
              style={{ borderBottom: '1px solid #E7ECF3', color: '#0B1220', letterSpacing: '0.01em' }}
            >
              <span>Уведомления</span>
              {notifs.length > 0 && (
                <span style={{ fontSize: 11, color: '#94A3B8', fontWeight: 400 }}>
                  {unread} непрочитанных
                </span>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {notifs.length === 0 ? (
                <div className="px-5 py-8 text-center" style={{ color: '#94A3B8', fontSize: 13 }}>
                  Нет уведомлений
                </div>
              ) : notifs.map(n => (
                <div
                  key={n.id}
                  className="px-5 py-4 transition-colors"
                  style={{
                    borderBottom: '1px solid #F1F5F9',
                    background: n.read ? 'transparent' : '#F0F6FF',
                    cursor: 'pointer',
                  }}
                  onClick={() => openEvent(n)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold" style={{ color: '#0B1220' }}>
                        {n.kind === 'wazzup' ? `WhatsApp — ${n.clientName}` : `Новая запись — ${n.clientName}`}
                      </p>
                      {n.body && <p className="mt-1 line-clamp-2 text-xs" style={{ color: '#52657F' }}>{n.body}</p>}
                      <p className="text-xs mt-1" style={{ color: '#64748B' }}>
                        {fmtDate(n.date)} в {n.time}
                        {n.agentName !== '—' && <> · {n.agentName}</>}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: '#CBD5E1' }}>
                        {new Date(n.createdAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    {!n.read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#4F7BFF]" />}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      className="neu-btn"
                      style={{ padding: '6px 10px', borderRadius: 12, fontSize: 12 }}
                      onClick={e => {
                        e.stopPropagation();
                        markRead(n.id);
                      }}
                    >
                      <Check size={13} />
                      Прочитано
                    </button>
                    <button
                      type="button"
                      className="neu-btn"
                      style={{ padding: '6px 10px', borderRadius: 12, fontSize: 12, color: '#DC2626' }}
                      onClick={e => {
                        e.stopPropagation();
                        deleteNotif(n.id);
                      }}
                    >
                      <Trash2 size={13} />
                      Удалить
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {!isDashboard && <button
          type="button"
          className="neu-icon-btn"
          style={{ width: 34, height: 34, borderRadius: 11 }}
          title="Календарь"
          onClick={() => setLocation('/booking')}
        >
          <CalendarDays size={15} strokeWidth={1.8} />
        </button>}

        {!isDashboard && <>
        <button
          type="button"
          className="topbar-add-btn"
          title="Добавить"
          onClick={() => setLocation('/tasks?create=1')}
        >
          <Plus size={18} />
        </button>

        <button
          type="button"
          className="neu-icon-btn"
          style={{ width: 34, height: 34, borderRadius: 11 }}
          title="Обновить"
          onClick={() => window.location.reload()}
        >
          <RefreshCw size={15} strokeWidth={1.8} />
        </button></>}

        <button
          type="button"
          className={`topbar-profile ${isDashboard ? 'dashboard-profile-trigger' : ''}`}
          onClick={event => {
            const rect = event.currentTarget.getBoundingClientRect();
            window.dispatchEvent(new CustomEvent('negis:open-profile', {
              detail: { left: rect.left, top: rect.bottom + 14 },
            }));
          }}
        >
          <span className="topbar-profile-avatar" style={{ background: avatarBg }}>
            {avatarSrc ? (
              <img src={avatarSrc} alt="Профиль" />
            ) : avatarIcon ? (
              <span>{avatarIcon}</span>
            ) : (
              initials
            )}
          </span>
          {!isDashboard && <>
            <span className="topbar-profile-text">
              <strong>{displayName}</strong>
              <small>{userRole === 'owner' ? 'Руководитель' : userRole || 'Сотрудник'}</small>
            </span>
            <ChevronDown size={16} />
          </>}
        </button>
      </div>
      </header>
    </>
  );
}
