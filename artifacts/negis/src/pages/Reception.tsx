import { useState, useEffect, useRef } from 'react';
import { PageLayout } from '@/components/layout/PageLayout';
import { Check, X, Trash2, ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/dist/style.css';
import { ru } from 'date-fns/locale';

interface Booking {
  id: string; patient_name: string; patient_phone: string | null; age: number | null;
  time: string; date: string; visited: boolean | null;
  service_id: string | null; agent_id: string | null;
}
interface Service { id: string; name: string }
interface Agent   { id: string; name: string }

const fmtDate = (d: Date) => d.toISOString().split('T')[0];

const dateLabel = (d: Date) => {
  const today = fmtDate(new Date());
  const tomorrow = fmtDate(new Date(Date.now() + 86400000));
  const iso = fmtDate(d);
  const base = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  if (iso === today) return `Сегодня, ${base}`;
  if (iso === tomorrow) return `Завтра, ${base}`;
  return base;
};

export default function Reception() {
  const { clinicId } = useAuth();
  const [bookings, setBookings]     = useState<Booking[]>([]);
  const [services, setServices]     = useState<Service[]>([]);
  const [agents,   setAgents]       = useState<Agent[]>([]);
  const [loading, setLoading]       = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [calOpen, setCalOpen]           = useState(false);
  const calRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (calRef.current && !calRef.current.contains(e.target as Node)) setCalOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => { if (clinicId) loadMeta(); }, [clinicId]);
  useEffect(() => { if (clinicId) loadBookings(); }, [clinicId, selectedDate]);

  const loadMeta = async () => {
    if (!clinicId) return;
    const [{ data: svc }, { data: agt }] = await Promise.all([
      supabase.from('services').select('id, name').eq('clinic_id', clinicId),
      supabase.from('agents').select('id, name').eq('clinic_id', clinicId),
    ]);
    setServices(svc ?? []);
    setAgents(agt ?? []);
  };

  const loadBookings = async () => {
    if (!clinicId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('bookings')
      .select('id, patient_name, patient_phone, age, time, date, visited, service_id, agent_id')
      .eq('clinic_id', clinicId)
      .eq('date', fmtDate(selectedDate))
      .order('time');
    if (error) toast.error(error.message);
    setBookings(data ?? []);
    setLoading(false);
  };

  const setVisited = async (id: string, visited: boolean) => {
    const { error } = await supabase.from('bookings').update({ visited }).eq('id', id);
    if (error) { toast.error(error.message); return; }
    setBookings(b => b.map(x => x.id === id ? { ...x, visited } : x));
    toast.success(visited ? 'Отмечен: Пришёл' : 'Отмечен: Не пришёл');
  };

  const deleteBooking = async (id: string) => {
    const { error } = await supabase.from('bookings').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    setBookings(b => b.filter(x => x.id !== id));
    toast.success('Запись удалена');
    setDeletingId(null);
  };

  const svcName = (id: string | null) => id ? (services.find(s => s.id === id)?.name ?? '—') : '—';
  const agtName = (id: string | null) => id ? (agents.find(a => a.id === id)?.name   ?? '—') : '—';

  const shiftDay = (n: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + n);
    setSelectedDate(d);
  };

  const emptyMsg = `Записей на ${dateLabel(selectedDate).toLowerCase()} нет`;

  return (
    <PageLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">Приём клиентов</h2>

          {/* Date nav */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => shiftDay(-1)}
              className="neu-btn p-2 text-[#64748B] hover:text-[#1A56DB]"
              title="Предыдущий день"
            >
              <ChevronLeft size={16} />
            </button>

            <div className="relative" ref={calRef}>
              <button
                onClick={() => setCalOpen(v => !v)}
                className="neu-sm flex items-center gap-2 px-4 py-2 font-semibold text-sm text-[#1A56DB] hover:text-[#1340B8] transition-colors"
              >
                <CalendarDays size={15} strokeWidth={2} />
                {dateLabel(selectedDate)}
              </button>

              {calOpen && (
                <div className="absolute right-0 top-full mt-2 z-50 neu-lg p-4" style={{ minWidth: 300 }}>
                  <style>{`
                    .rdp { --rdp-cell-size: 38px; margin: 0; font-family: 'Inter', sans-serif; }
                    .rdp-caption_label { font-size: 15px; font-weight: 600; color: #0B1220; letter-spacing: 0.01em; }
                    .rdp-head_cell { font-size: 11px; font-weight: 500; color: #94A3B8; letter-spacing: 0.08em; text-transform: uppercase; }
                    .rdp-day { font-size: 13px; font-weight: 400; color: #475569; border-radius: 10px; }
                    .rdp-day:hover:not([disabled]):not(.rdp-day_selected) {
                      background: #EEF2F6 !important; color: #0B1220 !important;
                    }
                    .rdp-day_selected, .rdp-day_selected:hover {
                      background: #1A56DB !important; color: #fff !important; font-weight: 700;
                    }
                    .rdp-day_today:not(.rdp-day_selected) {
                      color: #1A56DB; font-weight: 700;
                    }
                    .rdp-nav_button { color: #94A3B8; border-radius: 8px; }
                    .rdp-nav_button:hover { background: #EEF2F6; color: #0B1220; }
                  `}</style>
                  <DayPicker
                    mode="single"
                    selected={selectedDate}
                    onSelect={(d) => { if (d) { setSelectedDate(d); setCalOpen(false); } }}
                    locale={ru}
                    weekStartsOn={1}
                  />
                </div>
              )}
            </div>

            <button
              onClick={() => shiftDay(1)}
              className="neu-btn p-2 text-[#64748B] hover:text-[#1A56DB]"
              title="Следующий день"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="neu-card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[1000px]">
              <thead>
                <tr className="border-b border-[#E7ECF3] text-[#64748B] text-sm">
                  <th className="p-5 font-semibold w-24">Время</th>
                  <th className="p-5 font-semibold">Имя</th>
                  <th className="p-5 font-semibold">Телефон</th>
                  <th className="p-5 font-semibold">Возраст</th>
                  <th className="p-5 font-semibold">Услуга</th>
                  <th className="p-5 font-semibold">Агент</th>
                  <th className="p-5 font-semibold text-center w-72">Статус визита</th>
                  <th className="p-5 font-semibold w-16"></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="py-16 text-center text-[#94A3B8] text-sm">Загрузка...</td></tr>
                ) : bookings.length === 0 ? (
                  <tr><td colSpan={8} className="py-16 text-center text-[#94A3B8] text-sm">{emptyMsg}</td></tr>
                ) : bookings.map(b => (
                  <tr key={b.id} className="border-b border-[#F1F5F9] hover:bg-[#F8FAFC] transition-colors">
                    <td className="p-5 font-bold text-[#1E293B] text-lg">{b.time}</td>
                    <td className="p-5 font-semibold text-[#1E293B]">{b.patient_name}</td>
                    <td className="p-5 text-sm text-[#64748B]">{b.patient_phone ?? '—'}</td>
                    <td className="p-5 text-sm text-[#64748B]">{b.age ?? '—'}</td>
                    <td className="p-5 text-sm text-[#64748B]">{svcName(b.service_id)}</td>
                    <td className="p-5 text-sm text-[#64748B]">{agtName(b.agent_id)}</td>
                    <td className="p-5">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => setVisited(b.id, true)}
                          className={`px-4 py-2 rounded-full font-semibold text-xs flex items-center gap-1.5 transition-all ${
                            b.visited === true
                              ? 'bg-green-100 text-green-700 border border-green-200'
                              : 'neu-sm text-[#64748B] hover:text-green-600'
                          }`}
                        >
                          <Check size={14} strokeWidth={2.5} /> Пришёл
                        </button>
                        <button
                          onClick={() => setVisited(b.id, false)}
                          className={`px-4 py-2 rounded-full font-semibold text-xs flex items-center gap-1.5 transition-all ${
                            b.visited === false
                              ? 'bg-red-100 text-red-600 border border-red-200'
                              : 'neu-sm text-[#64748B] hover:text-red-500'
                          }`}
                        >
                          <X size={14} strokeWidth={2.5} /> Не пришёл
                        </button>
                      </div>
                    </td>
                    <td className="p-5">
                      <button
                        onClick={() => setDeletingId(b.id)}
                        title="Удалить запись"
                        className="neu-btn p-1.5 text-[#94A3B8] hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Confirm delete */}
        {deletingId && (
          <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="neu-lg p-8 max-w-sm w-full text-center space-y-5">
              <p className="font-semibold text-[#1E293B]">Удалить эту запись?</p>
              <p className="text-sm text-[#64748B]">Действие нельзя отменить</p>
              <div className="flex gap-3 justify-center">
                <button onClick={() => setDeletingId(null)} className="neu-btn px-6">Отмена</button>
                <button onClick={() => deleteBooking(deletingId)} className="neu-btn-danger px-6">Удалить</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </PageLayout>
  );
}
