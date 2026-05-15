import { useState, useEffect } from 'react';
import { PageLayout } from '@/components/layout/PageLayout';
import { Check, X, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

interface Booking {
  id: string; name: string; phone: string | null; age: number | null;
  time: string; date: string; visited: boolean | null;
  service_id: string | null; agent_id: string | null;
}
interface Service { id: string; name: string }
interface Agent   { id: string; name: string }

export default function Reception() {
  const { clinicId } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [agents,   setAgents]   = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const today = new Date().toISOString().split('T')[0];

  useEffect(() => { if (clinicId) load(); }, [clinicId]);

  const load = async () => {
    if (!clinicId) return;
    setLoading(true);
    const [{ data, error }, { data: svc }, { data: agt }] = await Promise.all([
      supabase.from('bookings').select('id, name, phone, age, time, date, visited, service_id, agent_id').eq('clinic_id', clinicId).eq('date', today).order('time'),
      supabase.from('services').select('id, name').eq('clinic_id', clinicId),
      supabase.from('agents').select('id, name').eq('clinic_id', clinicId),
    ]);
    if (error) toast.error(error.message);
    setBookings(data ?? []);
    setServices(svc ?? []);
    setAgents(agt ?? []);
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

  const todayLabel = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <PageLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">Приём клиентов</h2>
          <div className="neu-sm px-4 py-2 font-bold text-[#1A56DB] text-sm">{todayLabel}</div>
        </div>

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
                  <tr><td colSpan={8} className="py-16 text-center text-[#94A3B8] text-sm">
                    Записей на сегодня нет
                  </td></tr>
                ) : bookings.map(b => (
                  <tr key={b.id} className="border-b border-[#F1F5F9] hover:bg-[#F8FAFC] transition-colors">
                    <td className="p-5 font-bold text-[#1E293B] text-lg">{b.time}</td>
                    <td className="p-5 font-semibold text-[#1E293B]">{b.name}</td>
                    <td className="p-5 text-sm text-[#64748B]">{b.phone ?? '—'}</td>
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
