import React, { useState, useEffect } from 'react';
import { PageLayout } from '@/components/layout/PageLayout';
import { Calendar, TrendingUp, DollarSign, Users, ArrowUpRight, CalendarClock, CircleAlert } from 'lucide-react';
import { useGetDashboardMetrics } from '@workspace/api-client-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { agentDisplayName, loadAgentRoleMaps } from '@/lib/agentDisplay';

const SLOT_HOURS = [10, 11, 12, 13, 14, 15, 16, 17];
const MAX_PER_SLOT = 3;

interface AgentRace {
  id: string;
  name: string;
  displayName: string;
  initials: string;
  bookings: number;
  weekly_target: number;
}

interface SlotLoad {
  time: string;
  booked: number;
}

export default function Dashboard() {
  const { clinicId } = useAuth();
  const { data: metrics, isLoading } = useGetDashboardMetrics();
  const [agents, setAgents] = useState<AgentRace[]>([]);
  const [slots, setSlots] = useState<SlotLoad[]>(
    SLOT_HOURS.map(h => ({ time: `${String(h).padStart(2, '0')}:00`, booked: 0 }))
  );
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (clinicId) loadDashboardData();
  }, [clinicId]);

  const loadDashboardData = async () => {
    if (!clinicId) return;
    setLoadingData(true);

    const today = new Date().toISOString().split('T')[0];
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    const weekStartStr = weekStart.toISOString().split('T')[0];

    const [{ data: agentsData }, { data: todayBookings }, { data: weekBookings }] = await Promise.all([
      supabase.from('agents').select('id, name, user_id, role_id, weekly_target').eq('clinic_id', clinicId).order('name'),
      supabase.from('bookings').select('time, agent_id').eq('clinic_id', clinicId).eq('date', today),
      supabase.from('bookings').select('agent_id').eq('clinic_id', clinicId).gte('date', weekStartStr),
    ]);

    if (todayBookings) {
      const countMap: Record<string, number> = {};
      for (const b of todayBookings) {
        const hour = parseInt(b.time ?? '0');
        const key = `${String(hour).padStart(2, '0')}:00`;
        countMap[key] = (countMap[key] ?? 0) + 1;
      }
      setSlots(SLOT_HOURS.map(h => {
        const key = `${String(h).padStart(2, '0')}:00`;
        return { time: key, booked: countMap[key] ?? 0 };
      }));
    }

    if (agentsData) {
      const maps = await loadAgentRoleMaps(supabase, clinicId, agentsData as any);
      const weekMap: Record<string, number> = {};
      for (const b of (weekBookings ?? [])) {
        if (b.agent_id) weekMap[b.agent_id] = (weekMap[b.agent_id] ?? 0) + 1;
      }
      const bookingAgents = agentsData.filter(a => {
        const customRole = (maps.customRoleMap[(a as any).role_id] ?? '').toLowerCase();
        const systemRole = maps.userRoleMap[(a as any).user_id] ?? '';
        return systemRole === 'booking_agent' || /booking|book|запис/i.test(customRole);
      });
      const race: AgentRace[] = bookingAgents.map(a => {
        const parts = a.name.trim().split(' ');
        const initials = parts.map((p: string) => p[0]?.toUpperCase() ?? '').slice(0, 2).join('');
        return {
          id: a.id, name: a.name, displayName: agentDisplayName(a as any, maps.customRoleMap, maps.userRoleMap), initials,
          bookings: weekMap[a.id] ?? 0,
          weekly_target: a.weekly_target ?? 20,
        };
      }).sort((a, b) => (b.bookings / b.weekly_target) - (a.bookings / a.weekly_target));
      setAgents(race);
    }

    setLoadingData(false);
  };

  const getLoadColor = (booked: number) => {
    const pct = booked / MAX_PER_SLOT;
    if (pct >= 1) return 'bg-destructive shadow-[0_0_8px_rgba(239,68,68,0.5)]';
    if (pct >= 0.5) return 'bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.5)]';
    if (pct > 0) return 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]';
    return 'bg-[#CBD5E1]';
  };

  const bookingsToday = metrics?.bookingsToday ?? slots.reduce((sum, slot) => sum + slot.booked, 0);
  const loadPercent = metrics?.loadPercent != null
    ? metrics.loadPercent
    : Math.round((slots.reduce((sum, slot) => sum + slot.booked, 0) / (SLOT_HOURS.length * MAX_PER_SLOT)) * 100);
  const revenueToday = metrics?.revenueToday ?? 0;
  const visitedToday = metrics?.visitedToday ?? 0;
  const maxSlotLoad = Math.max(...slots.map(slot => slot.booked), 1);

  return (
    <PageLayout>
      <div className="dashboard-workspace">
        <div className="dashboard-overview">
          <section className="dashboard-attention">
            <div className="dashboard-section-heading">
              <div>
                <p>Операционный центр</p>
                <h2>Требует внимания</h2>
              </div>
              <span>{isLoading ? '...' : bookingsToday + agents.length}</span>
            </div>
            <div className="dashboard-attention-list">
              <div className="dashboard-attention-card">
                <div className="dashboard-attention-icon"><CalendarClock size={19} /></div>
                <div><strong>Записи на сегодня</strong><small>{isLoading ? 'Загрузка данных' : `${bookingsToday} записей в расписании`}</small></div>
                <ArrowUpRight size={18} />
              </div>
              <div className="dashboard-attention-card">
                <div className="dashboard-attention-icon"><TrendingUp size={19} /></div>
                <div><strong>Загрузка дня</strong><small>{isLoading ? 'Загрузка данных' : `${loadPercent}% от доступных слотов`}</small></div>
                <ArrowUpRight size={18} />
              </div>
              <div className="dashboard-attention-card is-alert">
                <div className="dashboard-attention-icon"><CircleAlert size={19} /></div>
                <div><strong>Контроль задач</strong><small>{agents.length ? `${agents.length} сотрудников в работе` : 'Назначьте ответственных сотрудникам'}</small></div>
                <ArrowUpRight size={18} />
              </div>
            </div>
          </section>

          <section className="dashboard-kpi-grid">
            <article className="dashboard-kpi-card">
              <div className="dashboard-kpi-title"><span><Calendar size={18} /></span><p>Записи на сегодня</p></div>
              <div className="dashboard-kpi-value">{isLoading ? '...' : bookingsToday}</div>
              <div className="dashboard-kpi-foot"><span>Запланировано</span><strong>{SLOT_HOURS.length * MAX_PER_SLOT} мест</strong></div>
            </article>
            <article className="dashboard-kpi-card">
              <div className="dashboard-kpi-title"><span><DollarSign size={18} /></span><p>Выручка сегодня</p></div>
              <div className="dashboard-kpi-value">{isLoading ? '...' : `${revenueToday.toLocaleString('ru-RU')} ₸`}</div>
              <div className="dashboard-kpi-foot"><span>Пришло клиентов</span><strong>{visitedToday}</strong></div>
            </article>
            <article className="dashboard-chart-card">
              <div className="dashboard-chart-header"><div><h3>Нагрузка по часам</h3><p>Текущий день</p></div><strong>{loadPercent}%</strong></div>
              <div className="dashboard-bars" aria-label="Загрузка по часам">
                {slots.map(slot => <span key={slot.time} style={{ height: `${Math.max(12, (slot.booked / maxSlotLoad) * 100)}%` }} title={`${slot.time}: ${slot.booked} записей`} />)}
              </div>
              <div className="dashboard-chart-labels"><span>{slots[0]?.time}</span><span>{slots[slots.length - 1]?.time}</span></div>
            </article>
          </section>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* AGENT RACE */}
          <div className="dashboard-panel lg:col-span-2 flex flex-col">
            <div className="dashboard-panel-header"><div><p>Эффективность</p><h3>Гонка агентов</h3></div><span>{agents.length} сотрудников</span></div>
            {loadingData ? (
              <p className="text-sm text-[#94A3B8]">Загрузка...</p>
            ) : agents.length === 0 ? (
              <p className="text-sm text-[#94A3B8]">Букинг-менеджеры не найдены</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {agents.map((agent, index) => {
                  const pct = Math.min(Math.round((agent.bookings / agent.weekly_target) * 100), 100);
                  const isLeader = index === 0 && agent.bookings > 0;
                  return (
                    <div key={agent.id} className={`dashboard-agent-card ${isLeader ? 'is-leader' : ''}`}>
                      {isLeader && (
                        <div className="absolute -top-3 -right-3 text-2xl drop-shadow-md">👑</div>
                      )}
                      <div className="flex items-center gap-3 mb-4">
                        <div className={`dashboard-agent-avatar ${isLeader ? 'is-leader' : ''}`}>
                          {agent.initials}
                        </div>
                        <div>
                          <p className="font-semibold text-sm">{agent.displayName}</p>
                          <p className="text-xs text-[#64748B]">{agent.bookings} / {agent.weekly_target} записей</p>
                        </div>
                      </div>
                      <div className="dashboard-progress">
                        <div
                          className={`h-full transition-all duration-500 rounded-full ${isLeader ? 'bg-[#1A56DB]' : 'bg-[#64748B]'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="text-right text-xs font-bold mt-1 text-[#1E293B]">{pct}%</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* HOURLY LOAD */}
          <div className="dashboard-panel">
            <div className="dashboard-panel-header"><div><p>Расписание</p><h3>Загрузка по часам</h3></div><span>{loadPercent}%</span></div>
            {loadingData ? (
              <p className="text-sm text-[#94A3B8]">Загрузка...</p>
            ) : (
              <div className="space-y-3">
                {slots.map((slot) => (
                  <div key={slot.time} className="dashboard-slot-row">
                    <span className="font-medium text-sm">{slot.time}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-semibold text-[#64748B]">{slot.booked} / {MAX_PER_SLOT}</span>
                      <div className={`h-3 w-3 rounded-full ${getLoadColor(slot.booked)}`} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    </PageLayout>
  );
}
