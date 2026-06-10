import { useState, useEffect, useRef } from 'react';
import { PageLayout } from '@/components/layout/PageLayout';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/dist/style.css';
import { format, startOfDay } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  CalendarDays, X, Plus, Search, Check, ChevronLeft,
  ArrowUpDown, Upload, Trash2, CalendarPlus,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { trackEvent } from '@/lib/fbpixel';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

/* ── Constants ──────────────────────────────────────────── */
const SLOT_HOURS   = [10, 11, 12, 13, 14, 15, 16, 17];
const MAX_PER_SLOT = 3;
const SOURCES = ['Instagram', 'Google', 'WhatsApp', '2GIS', 'Вручную', 'Webhook', 'Import'];

/* ── Types ──────────────────────────────────────────────── */
interface Booking {
  id: string; patient_name: string; patient_phone: string | null;
  age: number | null; service_id: string | null; agent_id: string | null;
  time: string; date: string;
}
interface Service    { id: string; name: string; price: number }
interface Agent      { id: string; name: string; user_id: string | null }
interface Lead {
  id: string; clinic_id: string;
  full_name: string | null; phone: string | null; email: string | null;
  source: string | null; status_id: string | null; comment: string | null;
  assigned_to: string | null; created_at: string;
  lead_statuses?: { name: string; color: string } | null;
}
interface LeadStatus { id: string; name: string; color: string }

/* ── Helpers ────────────────────────────────────────────── */
const fmtDate  = (d: Date) => format(d, 'yyyy-MM-dd');
const slotLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

const normalizePhone = (s: string) =>
  s.replace(/\s+/g, '').replace(/[()-]/g, '');

const pickField = (row: Record<string, string>, keys: string[]) => {
  for (const k of keys) {
    const found = Object.keys(row).find(rk => rk.toLowerCase() === k.toLowerCase());
    if (found && row[found]?.trim()) return row[found].trim();
  }
  return '';
};

function safeAgentIdFn(id: string | null | undefined, agents: Agent[]): string | null {
  if (!id) return null;
  if (agents.some(a => a.id === id)) return id;
  const byUser = agents.find(a => a.user_id === id);
  return byUser?.id ?? null;
}

function IndeterminateCheckbox({ checked, indeterminate, onChange }: {
  checked: boolean; indeterminate: boolean; onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate; }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#1E325C' }}
      onClick={e => e.stopPropagation()}
    />
  );
}

/* ── Inline style helpers ────────────────────────────────── */
const IS: React.CSSProperties = {
  background: '#F4F7FB', border: '1px solid #E7ECF3', borderRadius: 10,
  padding: '9px 13px', fontSize: 13, color: '#0B1220',
  fontFamily: "'Inter', sans-serif", outline: 'none', width: '100%',
};
const BkIS: React.CSSProperties = {
  background: '#FFFFFF', border: '1px solid #E7ECF3', borderRadius: 8,
  padding: '8px 11px', fontSize: 13, color: '#0B1220',
  fontFamily: "'Inter', sans-serif", outline: 'none', width: '100%',
};

/* ══════════════════════════════════════════════════════════ */
export default function Booking() {
  const { clinicId, user, userRole } = useAuth();

  /* ── Active tab ── */
  const [activeTab, setActiveTab] = useState<'calendar' | 'leads'>('calendar');

  /* ── Calendar state ── */
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [bookings, setBookings]   = useState<Booking[]>([]);
  const [services, setServices]   = useState<Service[]>([]);
  const [agents,   setAgents]     = useState<Agent[]>([]);
  const [myAgentId, setMyAgentId] = useState<string | null>(null);
  const [calLoading, setCalLoading] = useState(false);
  const [now, setNow] = useState<Date>(new Date());

  const [modal, setModal] = useState<{ hour: number } | null>(null);
  const [calForm, setCalForm] = useState({
    patient_name: '', patient_phone: '', age: '', service_id: '', agent_id: '',
  });
  const [calSaving, setCalSaving] = useState(false);

  /* ── Leads tab state ── */
  const [bkLeads, setBkLeads]       = useState<Lead[]>([]);
  const [bkStatuses, setBkStatuses] = useState<LeadStatus[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [bkSearch, setBkSearch]       = useState('');
  const [bkFilterStatus, setBkFilterStatus] = useState('');
  const [bkFilterAgent, setBkFilterAgent]   = useState('');
  const [bkSortBy, setBkSortBy]       = useState('created_at_desc');
  const [bkPerPage, setBkPerPage]     = useState<number>(20);
  const [bkPage, setBkPage]           = useState(0);
  const [selectedBkLeadIds, setSelectedBkLeadIds] = useState<Set<string>>(new Set());

  /* ── New lead modal ── */
  const [showNewLead, setShowNewLead] = useState(false);
  const emptyLeadForm = {
    full_name: '', phone: '', email: '', source: 'Вручную', status_id: '', assigned_to: '', comment: '',
  };
  const [leadForm, setLeadForm]   = useState(emptyLeadForm);
  const [leadSaving, setLeadSaving] = useState(false);

  /* ── Lead detail modal ── */
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [detailSaving, setDetailSaving] = useState(false);

  /* ── Booking from lead sub-modal ── */
  const [showBfl, setShowBfl]       = useState(false);
  const [bflDate, setBflDate]       = useState<Date>(new Date());
  const [bflSlots, setBflSlots]     = useState<{ time: string }[]>([]);
  const [bflLoading, setBflLoading] = useState(false);
  const [bflHour, setBflHour]       = useState<number | null>(null);
  const [bflForm, setBflForm]       = useState({ service_id: '', agent_id: '', comment: '' });
  const [bflSaving, setBflSaving]   = useState(false);

  /* ── Import state ── */
  const importRef = useRef<HTMLInputElement>(null);
  const [importLoading, setImportLoading] = useState(false);

  /* ── Clock tick ── */
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  /* ── Initial load ── */
  useEffect(() => {
    if (clinicId) {
      loadMeta();
      loadBookings();
    }
  }, [clinicId]);

  useEffect(() => {
    if (clinicId) loadBookings();
  }, [selectedDate]);

  useEffect(() => {
    if (clinicId) loadBkLeads();
  }, [clinicId, bkSortBy, myAgentId, userRole, user?.id]);

  useEffect(() => {
    setBkPage(0);
    setSelectedBkLeadIds(new Set());
  }, [bkSearch, bkFilterStatus, bkFilterAgent, bkSortBy, bkPerPage]);

  useEffect(() => {
    if (showBfl && clinicId) loadBflSlots(bflDate);
  }, [showBfl, bflDate, clinicId]);

  /* ── Calendar helpers ── */
  const today   = startOfDay(now);
  const isToday = startOfDay(selectedDate).getTime() === today.getTime();
  const isPast  = startOfDay(selectedDate).getTime() < today.getTime();
  const slotIsPast = (h: number) => isToday && h <= now.getHours();

  /* ── Loaders ── */
  const loadMeta = async () => {
    const [s, a, me] = await Promise.all([
      supabase.from('services').select('id, name, price').eq('clinic_id', clinicId),
      supabase.from('agents').select('id, name, user_id').eq('clinic_id', clinicId).order('name'),
      supabase.from('agents').select('id').eq('clinic_id', clinicId).eq('user_id', user?.id ?? '').single(),
    ]);
    setServices(s.data || []);
    setAgents(a.data || []);
    if (me.data) setMyAgentId(me.data.id);
  };

  const loadBookings = async () => {
    setCalLoading(true);
    const { data } = await supabase
      .from('bookings').select('*')
      .eq('clinic_id', clinicId).eq('date', fmtDate(selectedDate));
    setBookings(data || []);
    setCalLoading(false);
  };

  const loadBkLeads = async () => {
    if (!clinicId) return;
    setLeadsLoading(true);
    const [field, asc] = bkSortBy === 'created_at_desc' ? ['created_at', false]
      : bkSortBy === 'created_at_asc' ? ['created_at', true]
      : ['full_name', true];
    let q = supabase
      .from('leads').select('*, lead_statuses(name, color)')
      .eq('clinic_id', clinicId).eq('pipeline', 'booking');
    if (userRole === 'agent') {
      const responsibleIds = [myAgentId, user?.id].filter(Boolean) as string[];
      if (responsibleIds.length === 0) {
        setBkLeads([]);
        setSelectedBkLeadIds(new Set());
        const { data: st } = await supabase
          .from('lead_statuses').select('id, name, color')
          .eq('clinic_id', clinicId).eq('pipeline', 'booking').order('sort_order');
        setBkStatuses(st ?? []);
        setLeadsLoading(false);
        return;
      }
      q = q.in('assigned_to', responsibleIds);
    }
    const { data, error } = await q.order(field, { ascending: asc });
    if (error) toast.error(error.message);
    setBkLeads(data ?? []);
    setSelectedBkLeadIds(new Set());

    const { data: st } = await supabase
      .from('lead_statuses').select('id, name, color')
      .eq('clinic_id', clinicId).eq('pipeline', 'booking').order('sort_order');
    setBkStatuses(st ?? []);
    setLeadsLoading(false);
  };

  const loadBflSlots = async (date: Date) => {
    if (!clinicId) return;
    setBflLoading(true);
    const { data } = await supabase.from('bookings')
      .select('time').eq('clinic_id', clinicId).eq('date', format(date, 'yyyy-MM-dd'));
    setBflSlots(data ?? []);
    setBflLoading(false);
  };

  /* ── Calendar slot actions ── */
  const slotBookings = (h: number) => bookings.filter(b => parseInt(b.time) === h);

  const openSlot = (h: number) => {
    if (isPast) { toast.error('Нельзя записывать на прошедшую дату'); return; }
    if (slotIsPast(h)) { toast.error('Это время уже прошло'); return; }
    if (slotBookings(h).length >= MAX_PER_SLOT) { toast.error('Слот заполнен'); return; }
    setCalForm({
      patient_name: '', patient_phone: '', age: '',
      service_id: services[0]?.id || '', agent_id: myAgentId || '',
    });
    setModal({ hour: h });
  };

  const saveCalBooking = async () => {
    const nameVal = (calForm.patient_name ?? '').trim();
    if (!nameVal) { toast.error('Введите имя клиента'); return; }
    if (!(calForm.patient_phone ?? '').trim()) { toast.error('Введите телефон клиента'); return; }
    if (!modal) return;
    setCalSaving(true);
    const { error } = await supabase.from('bookings').insert({
      clinic_id: clinicId,
      patient_name: nameVal,
      patient_phone: calForm.patient_phone.trim() || null,
      age: calForm.age ? Number(calForm.age) : null,
      service_id: calForm.service_id || null,
      agent_id: calForm.agent_id || null,
      duration_minutes: 0,
      time: slotLabel(modal.hour),
      date: fmtDate(selectedDate),
    });
    if (error) { toast.error(error.message); } else {
      toast.success('Запись добавлена'); trackEvent('Schedule'); setModal(null); loadBookings();
    }
    setCalSaving(false);
  };

  /* ── Leads CRUD ── */
  const createLead = async () => {
    const name = leadForm.full_name.trim() || (leadForm.phone ? `Клиент ${leadForm.phone}` : '');
    if (!name) { toast.error('Введите имя или телефон'); return; }
    setLeadSaving(true);
    const assignedTo = safeAgentIdFn(leadForm.assigned_to || (userRole === 'agent' ? myAgentId : null), agents);
    const { error } = await supabase.from('leads').insert({
      clinic_id: clinicId,
      pipeline: 'booking',
      full_name: name,
      phone: leadForm.phone || null,
      email: leadForm.email || null,
      source: leadForm.source,
      status_id: leadForm.status_id || bkStatuses[0]?.id || null,
      assigned_to: assignedTo,
      comment: leadForm.comment || null,
    });
    setLeadSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Лид создан');
    setShowNewLead(false); setLeadForm(emptyLeadForm); loadBkLeads();
  };

  const updateLead = async () => {
    if (!selectedLead) return;
    setDetailSaving(true);
    const assignedTo = safeAgentIdFn(selectedLead.assigned_to || (userRole === 'agent' ? myAgentId : null), agents);
    const { error } = await supabase.from('leads').update({
      full_name: selectedLead.full_name,
      phone: selectedLead.phone,
      email: selectedLead.email || null,
      source: selectedLead.source,
      status_id: selectedLead.status_id || null,
      assigned_to: assignedTo,
      comment: selectedLead.comment || null,
    }).eq('id', selectedLead.id);
    setDetailSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Лид обновлён'); setSelectedLead(null); loadBkLeads();
  };

  const deleteLead = async (id: string) => {
    const { error } = await supabase.from('leads').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('Лид удалён'); setSelectedLead(null); loadBkLeads();
  };

  /* ── Booking from lead ── */
  const openBookFromLead = () => {
    setBflDate(new Date()); setBflHour(null);
    setBflForm({ service_id: services[0]?.id ?? '', agent_id: myAgentId ?? '', comment: '' });
    setShowBfl(true);
  };

  const bflSlotCount = (h: number) => bflSlots.filter(b => parseInt(b.time) === h).length;

  const saveBookFromLead = async () => {
    if (!selectedLead || bflHour === null) return;
    const name = (selectedLead.full_name ?? '').trim();
    if (!name) { toast.error('У лида нет имени'); return; }
    setBflSaving(true);
    const { error } = await supabase.from('bookings').insert({
      clinic_id:       clinicId,
      lead_id:         selectedLead.id,
      patient_name:    name,
      patient_phone:   selectedLead.phone ?? null,
      service_id:      bflForm.service_id || null,
      agent_id:        safeAgentIdFn(bflForm.agent_id, agents),
      time:            slotLabel(bflHour),
      date:            format(bflDate, 'yyyy-MM-dd'),
      duration_minutes: 0,
      comment:         bflForm.comment || null,
    });
    setBflSaving(false);
    if (error) { toast.error(error.message); return; }
    // Try to set status to "Записан"
    const zapisanStatus = bkStatuses.find(s => s.name.toLowerCase().includes('записан'));
    if (zapisanStatus) {
      await supabase.from('leads').update({ status_id: zapisanStatus.id }).eq('id', selectedLead.id);
    }
    toast.success(`Записано на ${format(bflDate, 'd MMM', { locale: ru })} в ${slotLabel(bflHour)}`);
    setShowBfl(false); setBflHour(null); loadBkLeads();
  };

  /* ── CSV/Excel import ── */
  const handleImportFile = async (file: File) => {
    if (!clinicId) return;
    setImportLoading(true);
    try {
      let rows: Record<string, string>[] = [];
      if (file.name.toLowerCase().endsWith('.csv')) {
        const text = await file.text();
        const result = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
        rows = result.data;
      } else {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf);
        rows = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      }

      const { data: st } = await supabase.from('lead_statuses').select('id')
        .eq('clinic_id', clinicId).eq('pipeline', 'booking').order('sort_order').limit(1);
      const defaultStatusId = st?.[0]?.id ?? null;

      const NAME_KEYS  = ['full_name','name','имя','фио','клиент','пациент'];
      const PHONE_KEYS = ['phone','телефон','номер','whatsapp','contact','mobile'];
      const EMAIL_KEYS = ['email','e-mail','почта'];
      const SOURCE_KEYS = ['source','источник'];
      const COMMENT_KEYS = ['comment','комментарий','примечание'];

      const ready: Record<string, unknown>[] = [];
      const errors: string[] = [];
      const importAssignedTo = userRole === 'agent' ? safeAgentIdFn(myAgentId, agents) : null;

      rows.forEach((r, idx) => {
        let fullName = pickField(r, NAME_KEYS);
        const rawPhone = pickField(r, PHONE_KEYS);
        const phone = rawPhone ? normalizePhone(rawPhone) || null : null;
        if (!fullName && phone) fullName = `Клиент ${phone}`;
        if (!fullName.trim()) { errors.push(`Строка ${idx + 2}: нет имени и телефона`); return; }
        ready.push({
          clinic_id: clinicId, pipeline: 'booking',
          full_name: fullName.trim(), phone,
          email: pickField(r, EMAIL_KEYS) || null,
          source: pickField(r, SOURCE_KEYS) || 'Import',
          comment: pickField(r, COMMENT_KEYS) || null,
          status_id: defaultStatusId,
          assigned_to: importAssignedTo,
        });
      });

      if (errors.length) toast.error(`Пропущено строк: ${errors.length}`);
      if (!ready.length) { toast.error('Нет данных для импорта'); return; }

      const CHUNK = 100;
      let imported = 0;
      for (let i = 0; i < ready.length; i += CHUNK) {
        const { error } = await supabase.from('leads').insert(ready.slice(i, i + CHUNK));
        if (error) { toast.error(error.message); return; }
        imported += ready.slice(i, i + CHUNK).length;
      }
      toast.success(`Импортировано ${imported} лидов`);
      loadBkLeads();
    } catch (e: any) {
      toast.error(e.message || 'Ошибка при импорте');
    } finally {
      setImportLoading(false);
      if (importRef.current) importRef.current.value = '';
    }
  };

  /* ── Filtered leads ── */
  const displayedLeads = bkLeads.filter(l => {
    if (bkSearch && !(l.full_name ?? '').toLowerCase().includes(bkSearch.toLowerCase()) && !(l.phone ?? '').includes(bkSearch)) return false;
    if (bkFilterStatus && l.status_id !== bkFilterStatus) return false;
    if (bkFilterAgent) {
      const rowAgent = agents.find(a => a.id === l.assigned_to) ?? agents.find(a => a.user_id === l.assigned_to);
      if ((rowAgent?.id ?? l.assigned_to) !== bkFilterAgent) return false;
    }
    return true;
  });
  const totalBkFiltered = displayedLeads.length;
  const bkPageCount = bkPerPage === 0 ? 1 : Math.max(1, Math.ceil(totalBkFiltered / bkPerPage));
  const safeBkPage = Math.min(bkPage, bkPageCount - 1);
  const bkPageItems = bkPerPage === 0
    ? displayedLeads
    : displayedLeads.slice(safeBkPage * bkPerPage, safeBkPage * bkPerPage + bkPerPage);
  const bkRangeFrom = totalBkFiltered === 0 ? 0 : safeBkPage * (bkPerPage || totalBkFiltered) + 1;
  const bkRangeTo = bkPerPage === 0 ? totalBkFiltered : Math.min(safeBkPage * bkPerPage + bkPerPage, totalBkFiltered);
  const allBkPageSelected = bkPageItems.length > 0 && bkPageItems.every(l => selectedBkLeadIds.has(l.id));
  const someBkPageSelected = bkPageItems.some(l => selectedBkLeadIds.has(l.id));
  const bkPageIndeterminate = someBkPageSelected && !allBkPageSelected;
  const allBkFilteredSelected = totalBkFiltered > 0 && displayedLeads.every(l => selectedBkLeadIds.has(l.id));
  const bkColSpan = 8;

  const toggleBkPageSelection = () => {
    setSelectedBkLeadIds(prev => {
      const next = new Set(prev);
      if (allBkPageSelected) {
        bkPageItems.forEach(l => next.delete(l.id));
      } else {
        bkPageItems.forEach(l => next.add(l.id));
      }
      return next;
    });
  };

  const toggleBkLeadSelection = (id: string) => {
    setSelectedBkLeadIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAllBkLeads = () => {
    setSelectedBkLeadIds(new Set(displayedLeads.map(l => l.id)));
  };

  const clearBkSelection = () => setSelectedBkLeadIds(new Set());

  const agentForLead = (lead: Lead) =>
    agents.find(a => a.id === lead.assigned_to) ??
    agents.find(a => a.user_id === lead.assigned_to) ?? null;
  const agentName = (lead: Lead) => agentForLead(lead)?.name ?? '—';

  const statusColor = (lead: Lead) => lead.lead_statuses?.color ?? '#94A3B8';
  const statusName  = (lead: Lead) => lead.lead_statuses?.name  ?? '—';

  const dayLabel = format(selectedDate, 'EEEE, d MMMM yyyy', { locale: ru });

  /* ══════════════════════════════════════════════════════════ */
  return (
    <PageLayout>
      {/* ── Tab switcher ───────────────────────────────────── */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 20,
        background: '#FFFFFF', border: '1px solid #E7ECF3', borderRadius: 12,
        padding: 4, width: 'fit-content',
        boxShadow: '0 2px 8px rgba(15,23,42,0.04)',
      }}>
        {([
          { key: 'calendar', label: 'Календарь' },
          { key: 'leads',    label: 'Лиды на запись' },
        ] as const).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '8px 20px', borderRadius: 9, fontSize: 13, fontWeight: 500,
              fontFamily: "'Inter', sans-serif", cursor: 'pointer', border: 'none',
              background: activeTab === tab.key ? '#1E325C' : 'transparent',
              color: activeTab === tab.key ? '#FFFFFF' : '#64748B',
              transition: 'all 0.15s ease',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ══════════ CALENDAR TAB ══════════ */}
      {activeTab === 'calendar' && (
        <div className="flex flex-col lg:flex-row gap-6 h-full" style={{ minHeight: 0 }}>

          {/* Calendar picker */}
          <div style={{
            background: '#FFFFFF', border: '1px solid #E7ECF3', borderRadius: 16,
            padding: '20px 16px', boxShadow: '0 4px 20px rgba(15,23,42,0.04)',
            flexShrink: 0, alignSelf: 'flex-start',
          }}>
            <style>{`
              .rdp { --rdp-cell-size: 38px; margin: 0; font-family: 'Inter', sans-serif; }
              .rdp-caption_label { font-size: 15px; font-weight: 600; color: #0B1220; }
              .rdp-head_cell { font-size: 11px; font-weight: 500; color: #94A3B8; letter-spacing: 0.08em; text-transform: uppercase; }
              .rdp-day { font-size: 13px; color: #475569; border-radius: 10px; }
              .rdp-day:hover:not([disabled]):not(.rdp-day_selected) { background: #EEF2F6 !important; color: #0B1220; }
              .rdp-day_selected, .rdp-day_selected:hover { background: #1E325C !important; color: white !important; border-radius: 10px; font-weight: 600; }
              .rdp-day_today:not(.rdp-day_selected) { color: #2859C5; font-weight: 600; }
              .rdp-nav_button { color: #94A3B8; border-radius: 8px; }
              .rdp-nav_button:hover { background: #EEF2F6; color: #0B1220; }
            `}</style>
            <DayPicker
              mode="single"
              selected={selectedDate}
              onSelect={d => d && setSelectedDate(d)}
              locale={ru}
              showOutsideDays
              disabled={{ before: today }}
            />
          </div>

          {/* Slots panel */}
          <div style={{
            background: '#FFFFFF', border: '1px solid #E7ECF3', borderRadius: 16,
            boxShadow: '0 4px 20px rgba(15,23,42,0.04)',
            flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0,
          }}>
            <div style={{
              padding: '18px 24px', borderBottom: '1px solid #E7ECF3',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <CalendarDays size={16} color="#2859C5" strokeWidth={1.75} />
              <span style={{ fontSize: 14, fontWeight: 600, color: '#0B1220', fontFamily: "'Inter', sans-serif" }}>
                {dayLabel}
              </span>
              {calLoading && <span style={{ fontSize: 12, color: '#94A3B8', fontFamily: "'Inter', sans-serif" }}>загрузка...</span>}
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
                {SLOT_HOURS.map(h => {
                  const list = slotBookings(h);
                  const count = list.length;
                  const full    = count >= MAX_PER_SLOT;
                  const partial = count > 0 && !full;
                  const past    = isPast || slotIsPast(h);
                  const blocked = full || past;

                  let bg = '#F4F7FB', borderColor = '#E7ECF3', countColor = '#94A3B8';
                  if (past)              { bg = '#F1F5F9'; borderColor = '#E2E8F0'; countColor = '#CBD5E1'; }
                  if (full && !past)     { bg = '#FEF2F2'; borderColor = '#FCA5A5'; countColor = '#DC2626'; }
                  if (partial && !past)  { bg = '#FFFBEB'; borderColor = '#FCD34D'; countColor = '#D97706'; }

                  return (
                    <button
                      key={h}
                      onClick={() => openSlot(h)}
                      disabled={blocked}
                      style={{
                        background: bg, border: `1px solid ${borderColor}`, borderRadius: 14,
                        padding: '18px 12px', cursor: blocked ? 'not-allowed' : 'pointer',
                        textAlign: 'center', transition: 'all 0.15s ease',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                        fontFamily: "'Inter', sans-serif", opacity: blocked ? 0.55 : 1,
                      }}
                      onMouseEnter={e => {
                        if (!blocked) {
                          (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)';
                          (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 6px 20px rgba(15,23,42,0.09)';
                        }
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
                        (e.currentTarget as HTMLButtonElement).style.boxShadow = 'none';
                      }}
                    >
                      <span style={{ fontSize: 20, fontWeight: 600, color: '#0B1220' }}>{slotLabel(h)}</span>
                      <span style={{ fontSize: 12, fontWeight: 500, color: countColor }}>{count} / {MAX_PER_SLOT}</span>
                      <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                        {Array.from({ length: MAX_PER_SLOT }).map((_, i) => (
                          <div key={i} style={{
                            width: 6, height: 6, borderRadius: '50%',
                            background: i < count
                              ? (full ? '#DC2626' : partial ? '#D97706' : '#2859C5')
                              : '#DDE5EE',
                          }} />
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div style={{
                display: 'flex', gap: 20, marginTop: 28, paddingTop: 20,
                borderTop: '1px solid #F4F7FB', fontFamily: "'Inter', sans-serif",
              }}>
                {[
                  { color: '#DDE5EE', label: 'Свободно' },
                  { color: '#D97706', label: 'Частично занято' },
                  { color: '#DC2626', label: 'Заполнено' },
                ].map(({ color, label }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
                    <span style={{ fontSize: 12, color: '#94A3B8' }}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ LEADS TAB ══════════ */}
      {activeTab === 'leads' && (
        <div className="space-y-4 flex flex-col" style={{ flex: 1, minHeight: 0 }}>

          {/* Header */}
          <div className="flex justify-between items-center">
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0B1220', fontFamily: "'Inter', sans-serif" }}>
              Лиды на запись
            </h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="file"
                ref={importRef}
                accept=".csv,.xlsx,.xls"
                style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleImportFile(f); }}
              />
              <button
                onClick={() => importRef.current?.click()}
                disabled={importLoading}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '9px 16px', borderRadius: 10,
                  background: '#F4F7FB', border: '1px solid #E7ECF3',
                  fontSize: 13, fontWeight: 500, color: '#475569',
                  cursor: importLoading ? 'not-allowed' : 'pointer',
                  fontFamily: "'Inter', sans-serif",
                }}
              >
                <Upload size={14} />{importLoading ? 'Импорт...' : 'Импорт CSV'}
              </button>
              <button
                onClick={() => { setLeadForm(emptyLeadForm); setShowNewLead(true); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '9px 16px', borderRadius: 10,
                  background: '#1E325C', border: 'none',
                  fontSize: 13, fontWeight: 500, color: '#FFFFFF',
                  cursor: 'pointer', fontFamily: "'Inter', sans-serif",
                }}
              >
                <Plus size={14} /> Новый лид
              </button>
            </div>
          </div>

          {/* Filters */}
          <div style={{
            background: '#FFFFFF', border: '1px solid #E7ECF3', borderRadius: 12,
            padding: '12px 16px', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
          }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 160 }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
              <input
                type="text" placeholder="Имя или телефон"
                style={{ ...IS, paddingLeft: 32 }}
                value={bkSearch} onChange={e => setBkSearch(e.target.value)}
              />
            </div>
            <select style={{ ...IS, width: 160 }} value={bkFilterStatus} onChange={e => setBkFilterStatus(e.target.value)}>
              <option value="">Все статусы</option>
              {bkStatuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {(userRole === 'owner' || userRole === 'manager') && (
              <select style={{ ...IS, width: 160 }} value={bkFilterAgent} onChange={e => setBkFilterAgent(e.target.value)}>
                <option value="">Все агенты</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <ArrowUpDown size={13} color="#94A3B8" />
              <select style={{ ...IS, width: 160 }} value={bkSortBy} onChange={e => setBkSortBy(e.target.value)}>
                <option value="created_at_desc">Дата (новые)</option>
                <option value="created_at_asc">Дата (старые)</option>
                <option value="name_asc">Имя (А→Я)</option>
              </select>
            </div>
          </div>

          <div style={{
            background: '#FFFFFF', border: '1px solid #E7ECF3', borderRadius: 12,
            padding: '10px 16px', display: 'flex', flexWrap: 'wrap',
            alignItems: 'center', gap: 10, fontFamily: "'Inter', sans-serif",
          }}>
            <button
              type="button"
              onClick={allBkFilteredSelected ? clearBkSelection : selectAllBkLeads}
              disabled={totalBkFiltered === 0}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 12px', borderRadius: 9, border: '1px solid #DDE5EE',
                background: totalBkFiltered === 0 ? '#F8FAFC' : '#F4F7FB',
                color: totalBkFiltered === 0 ? '#CBD5E1' : '#475569',
                fontSize: 13, fontWeight: 500, cursor: totalBkFiltered === 0 ? 'default' : 'pointer',
                fontFamily: "'Inter', sans-serif",
              }}
            >
              <Check size={14} />{allBkFilteredSelected ? 'Снять выбор' : 'Выбрать все'}
            </button>
            <span style={{ fontSize: 13, fontWeight: 600, color: selectedBkLeadIds.size > 0 ? '#1E325C' : '#94A3B8' }}>
              Выбрано: {selectedBkLeadIds.size}
            </span>
            <span style={{ fontSize: 12, color: '#94A3B8' }}>
              {totalBkFiltered === 0 ? 'Нет результатов' : `Показано ${bkRangeFrom}-${bkRangeTo} из ${totalBkFiltered}`}
            </span>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: '#94A3B8', whiteSpace: 'nowrap' }}>На странице:</span>
              <select
                style={{ ...IS, width: 92 }}
                value={bkPerPage}
                onChange={e => setBkPerPage(Number(e.target.value))}
              >
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={0}>Все</option>
              </select>
            </div>
          </div>

          {/* Table */}
          <div style={{
            background: '#FFFFFF', border: '1px solid #E7ECF3', borderRadius: 12,
            flex: 1, overflow: 'hidden',
          }}>
            <div style={{ overflowX: 'auto', height: '100%' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: "'Inter', sans-serif" }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #E7ECF3', background: '#FAFBFD' }}>
                    <th style={{ padding: '12px 16px', width: 48, textAlign: 'left' }}>
                      <IndeterminateCheckbox
                        checked={allBkPageSelected}
                        indeterminate={bkPageIndeterminate}
                        onChange={toggleBkPageSelection}
                      />
                    </th>
                    {['Имя', 'Телефон', 'Источник', 'Статус', 'Ответственный', 'Дата', ''].map(h => (
                      <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#64748B', whiteSpace: 'nowrap' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {leadsLoading ? (
                    <tr><td colSpan={bkColSpan} style={{ padding: '48px', textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>Загрузка...</td></tr>
                  ) : bkPageItems.length === 0 ? (
                    <tr><td colSpan={bkColSpan} style={{ padding: '48px', textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
                      Нет лидов. Нажмите "Новый лид" или импортируйте из CSV.
                    </td></tr>
                  ) : bkPageItems.map(lead => {
                    const isSelected = selectedBkLeadIds.has(lead.id);
                    return (
                    <tr
                      key={lead.id}
                      onClick={() => setSelectedLead({ ...lead, assigned_to: safeAgentIdFn(lead.assigned_to, agents) })}
                      style={{
                        borderBottom: '1px solid #F1F5F9', cursor: 'pointer',
                        transition: 'background 0.12s',
                        background: isSelected ? '#EFF6FF' : 'transparent',
                      }}
                      onMouseEnter={e => (e.currentTarget as HTMLTableRowElement).style.background = isSelected ? '#DBEAFE' : '#F8FAFC'}
                      onMouseLeave={e => (e.currentTarget as HTMLTableRowElement).style.background = isSelected ? '#EFF6FF' : 'transparent'}
                    >
                      <td
                        style={{ padding: '12px 16px', width: 48 }}
                        onClick={e => { e.stopPropagation(); toggleBkLeadSelection(lead.id); }}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleBkLeadSelection(lead.id)}
                          style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#1E325C' }}
                          onClick={e => e.stopPropagation()}
                        />
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 500, color: '#0B1220' }}>
                        {lead.full_name || '—'}
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 13, color: '#64748B' }}>{lead.phone ?? '—'}</td>
                      <td style={{ padding: '12px 16px', fontSize: 13, color: '#64748B' }}>{lead.source ?? '—'}</td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500,
                          background: statusColor(lead) + '18', color: statusColor(lead),
                        }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor(lead), flexShrink: 0 }} />
                          {statusName(lead)}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 13, color: '#64748B' }}>{agentName(lead)}</td>
                      <td style={{ padding: '12px 16px', fontSize: 12, color: '#94A3B8' }}>
                        {new Date(lead.created_at).toLocaleDateString('ru-RU')}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        <button
                          onClick={e => { e.stopPropagation(); setSelectedLead({ ...lead, assigned_to: safeAgentIdFn(lead.assigned_to, agents) }); }}
                          style={{
                            padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 500,
                            background: '#F4F7FB', border: '1px solid #E7ECF3', color: '#475569',
                            cursor: 'pointer', fontFamily: "'Inter', sans-serif",
                          }}
                        >
                          Открыть
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {!leadsLoading && bkPerPage > 0 && bkPageCount > 1 && (
            <div style={{
              background: '#FFFFFF', border: '1px solid #E7ECF3', borderRadius: 12,
              padding: '10px 12px', display: 'flex', alignItems: 'center',
              justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
              fontFamily: "'Inter', sans-serif",
            }}>
              <span style={{ fontSize: 12, color: '#94A3B8' }}>
                Страница {safeBkPage + 1} из {bkPageCount}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <PagBtn disabled={safeBkPage === 0} onClick={() => setBkPage(0)}>{"<<"}</PagBtn>
                <PagBtn disabled={safeBkPage === 0} onClick={() => setBkPage(p => Math.max(0, p - 1))}>{"<"}</PagBtn>
                {Array.from({ length: bkPageCount }, (_, i) => i)
                  .filter(i => Math.abs(i - safeBkPage) <= 2)
                  .map(i => (
                    <PagBtn key={i} active={i === safeBkPage} onClick={() => setBkPage(i)}>
                      {i + 1}
                    </PagBtn>
                  ))}
                <PagBtn disabled={safeBkPage >= bkPageCount - 1} onClick={() => setBkPage(p => Math.min(bkPageCount - 1, p + 1))}>{">"}</PagBtn>
                <PagBtn disabled={safeBkPage >= bkPageCount - 1} onClick={() => setBkPage(bkPageCount - 1)}>{">>"}</PagBtn>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════ CALENDAR BOOKING MODAL ══════════ */}
      {modal && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50 p-4"
          style={{ background: 'rgba(11,18,32,0.18)', backdropFilter: 'blur(8px)' }}
          onClick={e => { if (e.target === e.currentTarget) setModal(null); }}
        >
          <div style={{
            background: '#FFFFFF', border: '1px solid #E7ECF3', borderRadius: 20,
            boxShadow: '0 24px 64px rgba(15,23,42,0.14)', width: '100%', maxWidth: 420,
            padding: '32px 28px', fontFamily: "'Inter', sans-serif",
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#0B1220' }}>Новая запись</div>
                <div style={{ fontSize: 13, color: '#94A3B8', marginTop: 3 }}>
                  {slotLabel(modal.hour)} — {format(selectedDate, 'd MMMM', { locale: ru })}
                </div>
              </div>
              <button onClick={() => setModal(null)} style={{ background: '#F4F7FB', border: '1px solid #E7ECF3', borderRadius: 10, width: 32, height: 32, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8' }}>
                <X size={15} />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <FieldGroup label="Имя клиента">
                <input className="neu-input" placeholder="Иван Иванов" value={calForm.patient_name}
                  onChange={e => setCalForm(f => ({ ...f, patient_name: e.target.value }))} autoFocus />
              </FieldGroup>
              <FieldGroup label="Телефон">
                <input className="neu-input" placeholder="+7 XXX XXX XXXX" value={calForm.patient_phone}
                  onChange={e => setCalForm(f => ({ ...f, patient_phone: e.target.value }))} />
              </FieldGroup>
              <FieldGroup label="Возраст">
                <input className="neu-input" placeholder="30" type="number" min={1} max={120} value={calForm.age}
                  onChange={e => setCalForm(f => ({ ...f, age: e.target.value }))} />
              </FieldGroup>
              {services.length > 0 && (
                <FieldGroup label="Услуга">
                  <select className="neu-input" value={calForm.service_id}
                    onChange={e => setCalForm(f => ({ ...f, service_id: e.target.value }))}>
                    <option value="">— не выбрано —</option>
                    {services.map(s => <option key={s.id} value={s.id}>{s.name} — {s.price} ₸</option>)}
                  </select>
                </FieldGroup>
              )}
              {agents.length > 0 && (
                <FieldGroup label="Агент">
                  <select className="neu-input" value={calForm.agent_id}
                    onChange={e => setCalForm(f => ({ ...f, agent_id: e.target.value }))}>
                    <option value="">— не выбрано —</option>
                    {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </FieldGroup>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
              <button onClick={() => setModal(null)} style={{ flex: 1, background: '#F4F7FB', border: '1px solid #E7ECF3', borderRadius: 12, padding: '11px 0', fontSize: 14, color: '#475569', cursor: 'pointer', fontFamily: "'Inter', sans-serif" }}>
                Отмена
              </button>
              <button onClick={saveCalBooking} disabled={calSaving} style={{ flex: 2, background: '#1E325C', border: 'none', borderRadius: 12, padding: '11px 0', fontSize: 14, fontWeight: 500, color: 'white', cursor: calSaving ? 'not-allowed' : 'pointer', fontFamily: "'Inter', sans-serif", opacity: calSaving ? 0.65 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                {calSaving ? 'Сохранение...' : <><Plus size={15} /> Записать</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ NEW LEAD MODAL ══════════ */}
      {showNewLead && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4"
          style={{ background: 'rgba(11,18,32,0.18)', backdropFilter: 'blur(8px)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowNewLead(false); }}>
          <div style={{ background: '#FFFFFF', border: '1px solid #E7ECF3', borderRadius: 20, boxShadow: '0 24px 64px rgba(15,23,42,0.14)', width: '100%', maxWidth: 440, padding: '32px 28px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: '#0B1220', fontFamily: "'Inter', sans-serif" }}>Новый лид на запись</h3>
              <button onClick={() => setShowNewLead(false)} style={{ background: '#F4F7FB', border: '1px solid #E7ECF3', borderRadius: 8, padding: 6, cursor: 'pointer', display: 'flex' }}>
                <X size={15} color="#64748B" />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { label: 'Полное имя', key: 'full_name', placeholder: 'Иванов Иван', type: 'text' },
                { label: 'Телефон', key: 'phone', placeholder: '+7 700 000 0000', type: 'text' },
                { label: 'Email', key: 'email', placeholder: 'email@example.com', type: 'email' },
              ].map(({ label, key, placeholder, type }) => (
                <div key={key}>
                  <label style={{ fontSize: 11, fontWeight: 500, color: '#64748B', display: 'block', marginBottom: 5 }}>{label}</label>
                  <input type={type} style={IS} placeholder={placeholder}
                    value={(leadForm as any)[key]}
                    onChange={e => setLeadForm(f => ({ ...f, [key]: e.target.value }))} />
                </div>
              ))}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 500, color: '#64748B', display: 'block', marginBottom: 5 }}>Источник</label>
                  <select style={IS} value={leadForm.source} onChange={e => setLeadForm(f => ({ ...f, source: e.target.value }))}>
                    {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 500, color: '#64748B', display: 'block', marginBottom: 5 }}>Статус</label>
                  <select style={IS} value={leadForm.status_id} onChange={e => setLeadForm(f => ({ ...f, status_id: e.target.value }))}>
                    <option value="">— выбрать —</option>
                    {bkStatuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>
              {(userRole === 'owner' || userRole === 'manager') && (
                <div>
                  <label style={{ fontSize: 11, fontWeight: 500, color: '#64748B', display: 'block', marginBottom: 5 }}>Ответственный</label>
                  <select style={IS} value={leadForm.assigned_to} onChange={e => setLeadForm(f => ({ ...f, assigned_to: e.target.value }))}>
                    <option value="">— выбрать —</option>
                    {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label style={{ fontSize: 11, fontWeight: 500, color: '#64748B', display: 'block', marginBottom: 5 }}>Комментарий</label>
                <textarea style={{ ...IS, minHeight: 70, resize: 'vertical' } as React.CSSProperties}
                  placeholder="Заметки..." value={leadForm.comment}
                  onChange={e => setLeadForm(f => ({ ...f, comment: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button onClick={() => setShowNewLead(false)} style={{ flex: 1, padding: 11, borderRadius: 12, background: '#F4F7FB', border: '1px solid #E7ECF3', fontSize: 14, color: '#475569', cursor: 'pointer', fontFamily: "'Inter', sans-serif" }}>Отмена</button>
              <button onClick={createLead} disabled={leadSaving} style={{ flex: 1, padding: 11, borderRadius: 12, background: '#1E325C', border: 'none', fontSize: 14, color: '#FFF', cursor: 'pointer', fontFamily: "'Inter', sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Check size={15} />{leadSaving ? 'Создание...' : 'Создать'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ LEAD DETAIL MODAL ══════════ */}
      {selectedLead && !showBfl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(11,18,32,0.22)', backdropFilter: 'blur(8px)' }}
          onClick={e => { if (e.target === e.currentTarget) setSelectedLead(null); }}>
          <div style={{
            background: '#FFFFFF', border: '1px solid #E7ECF3', borderRadius: 20,
            boxShadow: '0 24px 64px rgba(15,23,42,0.14)', width: '100%', maxWidth: 520,
            maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #E7ECF3' }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0B1220', fontFamily: "'Inter', sans-serif" }}>
                {selectedLead.full_name || 'Лид'}
              </h3>
              <button onClick={() => setSelectedLead(null)} style={{ background: '#F4F7FB', border: '1px solid #E7ECF3', borderRadius: 8, padding: 6, cursor: 'pointer', display: 'flex' }}>
                <X size={15} color="#64748B" />
              </button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, padding: '20px 24px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: 11, fontWeight: 500, color: '#64748B', display: 'block', marginBottom: 5 }}>Полное имя</label>
                  <input style={IS} value={selectedLead.full_name ?? ''}
                    onChange={e => setSelectedLead(l => l ? { ...l, full_name: e.target.value || null } : l)} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 500, color: '#64748B', display: 'block', marginBottom: 5 }}>Телефон</label>
                  <input style={IS} value={selectedLead.phone ?? ''}
                    onChange={e => setSelectedLead(l => l ? { ...l, phone: e.target.value || null } : l)} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 500, color: '#64748B', display: 'block', marginBottom: 5 }}>Email</label>
                  <input style={IS} value={selectedLead.email ?? ''}
                    onChange={e => setSelectedLead(l => l ? { ...l, email: e.target.value || null } : l)} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 500, color: '#64748B', display: 'block', marginBottom: 5 }}>Источник</label>
                  <select style={IS} value={selectedLead.source ?? ''} onChange={e => setSelectedLead(l => l ? { ...l, source: e.target.value } : l)}>
                    {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 500, color: '#64748B', display: 'block', marginBottom: 5 }}>Статус</label>
                  <select style={IS} value={selectedLead.status_id ?? ''} onChange={e => setSelectedLead(l => l ? { ...l, status_id: e.target.value } : l)}>
                    <option value="">— выбрать —</option>
                    {bkStatuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                {(userRole === 'owner' || userRole === 'manager') && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ fontSize: 11, fontWeight: 500, color: '#64748B', display: 'block', marginBottom: 5 }}>Ответственный</label>
                    <select style={IS} value={selectedLead.assigned_to ?? ''} onChange={e => setSelectedLead(l => l ? { ...l, assigned_to: e.target.value || null } : l)}>
                      <option value="">— выбрать —</option>
                      {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                )}
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: 11, fontWeight: 500, color: '#64748B', display: 'block', marginBottom: 5 }}>Комментарий</label>
                  <textarea style={{ ...IS, minHeight: 80, resize: 'vertical' } as React.CSSProperties}
                    value={selectedLead.comment ?? ''}
                    onChange={e => setSelectedLead(l => l ? { ...l, comment: e.target.value } : l)} />
                </div>
              </div>
            </div>
            <div style={{ padding: '16px 24px', borderTop: '1px solid #E7ECF3', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button onClick={() => deleteLead(selectedLead.id)} style={{ padding: '9px 14px', borderRadius: 10, background: '#FEF2F2', border: '1px solid #FEE2E2', fontSize: 13, color: '#DC2626', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                <Trash2 size={13} /> Удалить
              </button>
              <button onClick={openBookFromLead} style={{ padding: '9px 14px', borderRadius: 10, background: '#EFF6FF', border: '1px solid #BFDBFE', fontSize: 13, color: '#2859C5', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                <CalendarPlus size={14} /> Создать запись
              </button>
              <div style={{ flex: 1 }} />
              <button onClick={() => setSelectedLead(null)} style={{ padding: '9px 14px', borderRadius: 10, background: '#F4F7FB', border: '1px solid #E7ECF3', fontSize: 13, color: '#475569', cursor: 'pointer', fontFamily: "'Inter', sans-serif" }}>Отмена</button>
              <button onClick={updateLead} disabled={detailSaving} style={{ padding: '9px 18px', borderRadius: 10, background: '#1E325C', border: 'none', fontSize: 13, color: '#FFF', cursor: 'pointer', fontFamily: "'Inter', sans-serif", display: 'flex', alignItems: 'center', gap: 6 }}>
                <Check size={14} />{detailSaving ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ BOOKING FROM LEAD SUB-MODAL ══════════ */}
      {showBfl && selectedLead && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{ background: 'rgba(11,18,32,0.30)', backdropFilter: 'blur(8px)' }}>
          <div style={{
            background: '#FFFFFF', borderRadius: 20, boxShadow: '0 24px 64px rgba(15,23,42,0.18)',
            width: '100%', maxWidth: 780, maxHeight: '90vh',
            display: 'flex', flexDirection: 'column', border: '1px solid #E7ECF3', overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 24px', borderBottom: '1px solid #E7ECF3' }}>
              <button onClick={() => setShowBfl(false)} style={{ background: '#F4F7FB', border: '1px solid #E7ECF3', borderRadius: 8, padding: 6, cursor: 'pointer', display: 'flex' }}>
                <ChevronLeft size={15} color="#64748B" />
              </button>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, color: '#0B1220', fontFamily: "'Inter', sans-serif" }}>
                  Записать: {selectedLead.full_name || '—'}
                </div>
                <div style={{ fontSize: 12, color: '#94A3B8' }}>{selectedLead.phone}</div>
              </div>
              <button onClick={() => setShowBfl(false)} style={{ marginLeft: 'auto', background: '#F4F7FB', border: '1px solid #E7ECF3', borderRadius: 8, padding: 6, cursor: 'pointer', display: 'flex' }}>
                <X size={15} color="#64748B" />
              </button>
            </div>

            {/* Body */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
              {/* Calendar column */}
              <div style={{ padding: '20px 16px', borderRight: '1px solid #E7ECF3', flexShrink: 0 }}>
                <style>{`
                  .bfl-rdp { --rdp-cell-size: 36px; margin: 0; font-family: 'Inter', sans-serif; }
                  .bfl-rdp .rdp-caption_label { font-size: 14px; font-weight: 600; color: #0B1220; }
                  .bfl-rdp .rdp-head_cell { font-size: 10px; font-weight: 500; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.06em; }
                  .bfl-rdp .rdp-day { font-size: 12px; color: #475569; border-radius: 8px; }
                  .bfl-rdp .rdp-day:hover:not([disabled]):not(.rdp-day_selected) { background: #EEF2F6 !important; color: #0B1220; }
                  .bfl-rdp .rdp-day_selected, .bfl-rdp .rdp-day_selected:hover { background: #1E325C !important; color: white !important; border-radius: 8px; font-weight: 600; }
                  .bfl-rdp .rdp-day_today:not(.rdp-day_selected) { color: #2859C5; font-weight: 600; }
                  .bfl-rdp .rdp-nav_button { color: #94A3B8; border-radius: 7px; }
                  .bfl-rdp .rdp-nav_button:hover { background: #EEF2F6; }
                `}</style>
                <DayPicker
                  className="bfl-rdp"
                  mode="single"
                  selected={bflDate}
                  onSelect={d => { if (d) { setBflDate(d); setBflHour(null); } }}
                  locale={ru}
                  showOutsideDays
                  disabled={{ before: startOfDay(new Date()) }}
                />
              </div>

              {/* Slots + form column */}
              <div style={{ flex: 1, padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#0B1220', textTransform: 'capitalize', fontFamily: "'Inter', sans-serif" }}>
                  {format(bflDate, 'EEEE, d MMMM yyyy', { locale: ru })}
                </div>

                {bflLoading ? (
                  <div style={{ fontSize: 13, color: '#94A3B8' }}>Загрузка слотов...</div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                    {SLOT_HOURS.map(h => {
                      const cnt  = bflSlotCount(h);
                      const full = cnt >= MAX_PER_SLOT;
                      const n    = new Date();
                      const past = startOfDay(bflDate).getTime() === startOfDay(n).getTime() && h <= n.getHours();
                      const sel  = bflHour === h;
                      const avail = !full && !past;
                      return (
                        <button
                          key={h}
                          disabled={!avail}
                          onClick={() => setBflHour(sel ? null : h)}
                          style={{
                            padding: '10px 6px', borderRadius: 10, border: '1.5px solid',
                            borderColor: sel ? '#1E325C' : full || past ? '#E7ECF3' : '#BFDBFE',
                            background: sel ? '#1E325C' : full || past ? '#F8FAFC' : '#EFF6FF',
                            color: sel ? '#FFF' : full || past ? '#CBD5E1' : '#1E325C',
                            fontSize: 12, fontWeight: 500, cursor: avail ? 'pointer' : 'default',
                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                            fontFamily: "'Inter', sans-serif",
                          }}
                        >
                          <span style={{ fontWeight: 600, fontSize: 13 }}>{slotLabel(h)}</span>
                          <span style={{ fontSize: 10, opacity: 0.75 }}>
                            {past ? 'прошло' : full ? 'занято' : `${cnt}/${MAX_PER_SLOT}`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {bflHour !== null && (
                  <div style={{ background: '#F8FAFC', borderRadius: 12, padding: 16, border: '1px solid #E7ECF3', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#0B1220', fontFamily: "'Inter', sans-serif" }}>
                      Запись на {slotLabel(bflHour)}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div>
                        <label style={{ fontSize: 11, color: '#64748B', fontWeight: 500, display: 'block', marginBottom: 5 }}>Услуга</label>
                        <select style={BkIS} value={bflForm.service_id} onChange={e => setBflForm(f => ({ ...f, service_id: e.target.value }))}>
                          <option value="">— выбрать —</option>
                          {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: 11, color: '#64748B', fontWeight: 500, display: 'block', marginBottom: 5 }}>Агент</label>
                        <select style={BkIS} value={bflForm.agent_id} onChange={e => setBflForm(f => ({ ...f, agent_id: e.target.value }))}>
                          <option value="">— выбрать —</option>
                          {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                      </div>
                      <div style={{ gridColumn: '1 / -1' }}>
                        <label style={{ fontSize: 11, color: '#64748B', fontWeight: 500, display: 'block', marginBottom: 5 }}>Комментарий</label>
                        <input type="text" style={BkIS} placeholder="Необязательно"
                          value={bflForm.comment} onChange={e => setBflForm(f => ({ ...f, comment: e.target.value }))} />
                      </div>
                    </div>
                    <button
                      onClick={saveBookFromLead}
                      disabled={bflSaving}
                      style={{
                        padding: '11px 20px', borderRadius: 10, background: '#1E325C', border: 'none',
                        fontSize: 13, fontWeight: 600, color: '#FFF',
                        cursor: bflSaving ? 'default' : 'pointer', fontFamily: "'Inter', sans-serif",
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        opacity: bflSaving ? 0.7 : 1,
                      }}
                    >
                      <Check size={14} />{bflSaving ? 'Запись...' : 'Подтвердить запись'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  );
}

function PagBtn({ children, onClick, disabled, active }: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean; active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        minWidth: 30, height: 30, borderRadius: 7, border: '1px solid',
        borderColor: active ? '#1E325C' : '#E7ECF3',
        background: active ? '#1E325C' : disabled ? 'transparent' : '#F4F7FB',
        color: active ? '#FFFFFF' : disabled ? '#CBD5E1' : '#475569',
        fontSize: 12, fontWeight: active ? 600 : 400,
        cursor: disabled ? 'default' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '0 6px',
        fontFamily: "'Inter', sans-serif",
      }}
    >
      {children}
    </button>
  );
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{
        display: 'block', fontSize: 12, fontWeight: 500, color: '#94A3B8',
        marginBottom: 5, letterSpacing: '0.05em', textTransform: 'uppercase',
        fontFamily: "'Inter', sans-serif",
      }}>
        {label}
      </label>
      {children}
    </div>
  );
}
