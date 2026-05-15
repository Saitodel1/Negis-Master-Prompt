import { useState, useEffect } from 'react';
import { PageLayout } from '@/components/layout/PageLayout';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/dist/style.css';
import { format, startOfDay } from 'date-fns';
import { ru } from 'date-fns/locale';
import { CalendarDays, X, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

/* ── Constants ────────────────────────────────────────────── */
const SLOT_HOURS = [10, 11, 12, 13, 14, 15, 16, 17]; // 10:00–17:00, each 1h, max 3
const MAX_PER_SLOT = 3;

/* ── Types ────────────────────────────────────────────────── */
interface Booking {
  id: string;
  patient_name: string;
  patient_phone: string | null;
  age: number | null;
  service_id: string | null;
  agent_id: string | null;
  time: string;   // "HH:00"
  date: string;   // YYYY-MM-DD
}
interface Service { id: string; name: string; price: number }
interface Agent   { id: string; name: string }

/* ── Helpers ──────────────────────────────────────────────── */
const fmtDate = (d: Date) => format(d, 'yyyy-MM-dd');
const slotLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

export default function Booking() {
  const { clinicId } = useAuth();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [agents,   setAgents]   = useState<Agent[]>([]);
  const [loading, setLoading]   = useState(false);
  const [now, setNow]             = useState<Date>(new Date());

  /* Sync clock every minute so past-slot detection stays fresh */
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const today = startOfDay(now);
  const isToday = startOfDay(selectedDate).getTime() === today.getTime();
  const isPast = startOfDay(selectedDate).getTime() < today.getTime();

  /* A slot is in the past when the selected day is today and the hour has already passed */
  const slotIsPast = (h: number) => isToday && h <= now.getHours();

  /* Modal state */
  const [modal, setModal] = useState<{ hour: number } | null>(null);
  const [form, setForm] = useState({ patient_name: '', patient_phone: '', age: '', service_id: '', agent_id: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (clinicId) {
      loadBookings();
      loadMeta();
    }
  }, [clinicId, selectedDate]);

  const loadBookings = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('bookings')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('date', fmtDate(selectedDate));
    setBookings(data || []);
    setLoading(false);
  };

  const loadMeta = async () => {
    const [s, a] = await Promise.all([
      supabase.from('services').select('id, name, price').eq('clinic_id', clinicId),
      supabase.from('agents').select('id, name').eq('clinic_id', clinicId),
    ]);
    setServices(s.data || []);
    setAgents(a.data || []);
  };

  const slotBookings = (h: number) => bookings.filter(b => parseInt(b.time) === h);

  const openSlot = (h: number) => {
    if (isPast) { toast.error('Нельзя записывать на прошедшую дату'); return; }
    if (slotIsPast(h)) { toast.error('Это время уже прошло'); return; }
    const count = slotBookings(h).length;
    if (count >= MAX_PER_SLOT) { toast.error('Слот заполнен'); return; }
    setForm({ patient_name: '', patient_phone: '', age: '', service_id: services[0]?.id || '', agent_id: '' });
    setModal({ hour: h });
  };

  const saveBooking = async () => {
    const nameVal = (form.patient_name ?? '').trim();
    if (!nameVal) { toast.error('Введите имя клиента'); return; }
    const phoneVal = (form.patient_phone ?? '').trim();
    if (!phoneVal) { toast.error('Введите телефон клиента'); return; }
    if (services.length > 0 && !form.service_id) { toast.error('Выберите услугу'); return; }
    if (!modal) return;
    setSaving(true);
    const { error } = await supabase.from('bookings').insert({
      clinic_id: clinicId,
      patient_name: nameVal,
      patient_phone: (form.patient_phone ?? '').trim() || null,
      age: (form.age ?? '') ? Number(form.age) : null,
      service_id: form.service_id || null,
      agent_id: form.agent_id || null,
      duration_minutes: 0,
      time: slotLabel(modal.hour),
      date: fmtDate(selectedDate),
    });
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Запись добавлена');
      setModal(null);
      loadBookings();
    }
    setSaving(false);
  };

  const dayLabel = selectedDate
    ? format(selectedDate, 'EEEE, d MMMM yyyy', { locale: ru })
    : '';

  return (
    <PageLayout>
      <div className="flex flex-col lg:flex-row gap-6 h-full" style={{ minHeight: 0 }}>

        {/* ── Calendar ──────────────────────────────────────── */}
        <div style={{
          background: '#FFFFFF',
          border: '1px solid #E7ECF3',
          borderRadius: 16,
          padding: '20px 16px',
          boxShadow: '0 4px 20px rgba(15,23,42,0.04)',
          flexShrink: 0,
          alignSelf: 'flex-start',
        }}>
          <style>{`
            .rdp { --rdp-cell-size: 38px; margin: 0; font-family: 'Inter', sans-serif; }
            .rdp-caption_label { font-size: 15px; font-weight: 600; color: #0B1220; letter-spacing: 0.01em; }
            .rdp-head_cell { font-size: 11px; font-weight: 500; color: #94A3B8; letter-spacing: 0.08em; text-transform: uppercase; }
            .rdp-day { font-size: 13px; font-weight: 400; color: #475569; border-radius: 10px; }
            .rdp-day:hover:not([disabled]):not(.rdp-day_selected) {
              background: #EEF2F6 !important;
              color: #0B1220;
            }
            .rdp-day_selected, .rdp-day_selected:hover {
              background: #1E325C !important;
              color: white !important;
              border-radius: 10px;
              font-weight: 600;
            }
            .rdp-day_today:not(.rdp-day_selected) {
              color: #2859C5;
              font-weight: 600;
            }
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

        {/* ── Slots panel ───────────────────────────────────── */}
        <div style={{
          background: '#FFFFFF',
          border: '1px solid #E7ECF3',
          borderRadius: 16,
          boxShadow: '0 4px 20px rgba(15,23,42,0.04)',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minHeight: 0,
        }}>
          {/* Header */}
          <div style={{
            padding: '18px 24px',
            borderBottom: '1px solid #E7ECF3',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}>
            <CalendarDays size={16} color="#2859C5" strokeWidth={1.75} />
            <span style={{ fontSize: 14, fontWeight: 600, color: '#0B1220', fontFamily: "'Inter', sans-serif" }}>
              {dayLabel}
            </span>
            {loading && (
              <span style={{ fontSize: 12, color: '#94A3B8', marginLeft: 6, fontFamily: "'Inter', sans-serif" }}>
                загрузка...
              </span>
            )}
          </div>

          {/* Slot grid */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '24px',
          }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: 12,
            }}>
              {SLOT_HOURS.map(h => {
                const list = slotBookings(h);
                const count = list.length;
                const full  = count >= MAX_PER_SLOT;
                const partial = count > 0 && !full;
                const past = isPast || slotIsPast(h);
                const blocked = full || past;

                let bg = '#F4F7FB';
                let borderColor = '#E7ECF3';
                let countColor = '#94A3B8';

                if (past)    { bg = '#F1F5F9'; borderColor = '#E2E8F0'; countColor = '#CBD5E1'; }
                if (full && !past) { bg = '#FEF2F2'; borderColor = '#FCA5A5'; countColor = '#DC2626'; }
                if (partial && !past) { bg = '#FFFBEB'; borderColor = '#FCD34D'; countColor = '#D97706'; }

                return (
                  <button
                    key={h}
                    onClick={() => openSlot(h)}
                    disabled={blocked}
                    style={{
                      background: bg,
                      border: `1px solid ${borderColor}`,
                      borderRadius: 14,
                      padding: '18px 12px',
                      cursor: blocked ? 'not-allowed' : 'pointer',
                      textAlign: 'center',
                      transition: 'all 0.15s ease',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 6,
                      fontFamily: "'Inter', sans-serif",
                      opacity: blocked ? 0.55 : 1,
                    }}
                    onMouseEnter={e => {
                      if (!full) {
                        (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)';
                        (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 6px 20px rgba(15,23,42,0.09)';
                      }
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
                      (e.currentTarget as HTMLButtonElement).style.boxShadow = 'none';
                    }}
                    data-testid={`slot-${h}`}
                  >
                    <span style={{ fontSize: 20, fontWeight: 600, color: '#0B1220', letterSpacing: '0.01em' }}>
                      {slotLabel(h)}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 500, color: countColor }}>
                      {count} / {MAX_PER_SLOT}
                    </span>
                    {/* Mini booking dots */}
                    <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                      {Array.from({ length: MAX_PER_SLOT }).map((_, i) => (
                        <div key={i} style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: i < count
                            ? (full ? '#DC2626' : partial ? '#D97706' : '#2859C5')
                            : '#DDE5EE',
                          transition: 'background 0.2s',
                        }} />
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Legend */}
            <div style={{
              display: 'flex',
              gap: 20,
              marginTop: 28,
              paddingTop: 20,
              borderTop: '1px solid #F4F7FB',
              fontFamily: "'Inter', sans-serif",
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

      {/* ── New Booking Modal ────────────────────────────────── */}
      {modal && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50 p-4"
          style={{ background: 'rgba(11,18,32,0.18)', backdropFilter: 'blur(8px)' }}
          onClick={e => { if (e.target === e.currentTarget) setModal(null); }}
        >
          <div style={{
            background: '#FFFFFF',
            border: '1px solid #E7ECF3',
            borderRadius: 20,
            boxShadow: '0 24px 64px rgba(15,23,42,0.14)',
            width: '100%',
            maxWidth: 420,
            padding: '32px 28px',
            fontFamily: "'Inter', sans-serif",
          }}>
            {/* Modal header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#0B1220' }}>Новая запись</div>
                <div style={{ fontSize: 13, color: '#94A3B8', marginTop: 3 }}>
                  {slotLabel(modal.hour)} — {format(selectedDate, 'd MMMM', { locale: ru })}
                </div>
              </div>
              <button
                onClick={() => setModal(null)}
                style={{
                  background: '#F4F7FB', border: '1px solid #E7ECF3', borderRadius: 10,
                  width: 32, height: 32, cursor: 'pointer', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', color: '#94A3B8',
                  transition: 'all 0.15s ease',
                }}
              >
                <X size={15} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <FieldGroup label="Имя клиента">
                <input
                  className="neu-input"
                  placeholder="Иван Иванов"
                  value={form.patient_name}
                  onChange={e => setForm(f => ({ ...f, patient_name: e.target.value }))}
                  data-testid="input-client-name"
                  autoFocus
                />
              </FieldGroup>

              <FieldGroup label="Телефон">
                <input
                  className="neu-input"
                  placeholder="+7 XXX XXX XXXX"
                  value={form.patient_phone}
                  onChange={e => setForm(f => ({ ...f, patient_phone: e.target.value }))}
                  data-testid="input-client-phone"
                />
              </FieldGroup>

              <FieldGroup label="Возраст">
                <input
                  className="neu-input"
                  placeholder="30"
                  type="number"
                  min={1}
                  max={120}
                  value={form.age}
                  onChange={e => setForm(f => ({ ...f, age: e.target.value }))}
                />
              </FieldGroup>

              {services.length > 0 && (
                <FieldGroup label="Услуга">
                  <select
                    className="neu-input"
                    value={form.service_id}
                    onChange={e => setForm(f => ({ ...f, service_id: e.target.value }))}
                  >
                    <option value="">— не выбрано —</option>
                    {services.map(s => (
                      <option key={s.id} value={s.id}>{s.name} — {s.price} ₸</option>
                    ))}
                  </select>
                </FieldGroup>
              )}

              {agents.length > 0 && (
                <FieldGroup label="Агент">
                  <select
                    className="neu-input"
                    value={form.agent_id}
                    onChange={e => setForm(f => ({ ...f, agent_id: e.target.value }))}
                  >
                    <option value="">— не выбрано —</option>
                    {agents.map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </FieldGroup>
              )}

            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
              <button
                onClick={() => setModal(null)}
                style={{
                  flex: 1, background: '#F4F7FB', border: '1px solid #E7ECF3', borderRadius: 12,
                  padding: '11px 0', fontSize: 14, fontWeight: 500, color: '#475569',
                  cursor: 'pointer', fontFamily: "'Inter', sans-serif", transition: 'background 0.15s',
                }}
                onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = '#EEF2F6')}
                onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = '#F4F7FB')}
              >
                Отмена
              </button>
              <button
                onClick={saveBooking}
                disabled={saving}
                style={{
                  flex: 2, background: '#1E325C', border: '1px solid #1E325C', borderRadius: 12,
                  padding: '11px 0', fontSize: 14, fontWeight: 500, color: 'white',
                  cursor: saving ? 'not-allowed' : 'pointer', fontFamily: "'Inter', sans-serif",
                  opacity: saving ? 0.65 : 1, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', gap: 8, transition: 'background 0.15s',
                }}
                onMouseEnter={e => { if (!saving) (e.currentTarget as HTMLButtonElement).style.background = '#162748'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#1E325C'; }}
                data-testid="button-save-booking"
              >
                {saving ? 'Сохранение...' : <><Plus size={15} /> Записать</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
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
