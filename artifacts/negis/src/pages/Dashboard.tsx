import React, { useState, useEffect } from 'react';
import { PageLayout } from '@/components/layout/PageLayout';
import { Calendar, TrendingUp, DollarSign, Users, ArrowUpRight, CalendarClock, CircleAlert } from 'lucide-react';
import { useGetDashboardMetrics } from '@workspace/api-client-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { agentDisplayName, loadAgentRoleMaps } from '@/lib/agentDisplay';
import ReportsOverview from '@/pages/Reports';

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

interface CoreSummary {
  contacts: number;
  openDeals: number;
  openTasks: number;
  paidAmount: number;
}

export default function Dashboard() {
  const { clinicId, country, hasModule, rolePermissions, userRole } = useAuth();
  const hasBooking = hasModule('booking');
  const hasReports = hasModule('reports')
    && (userRole === 'owner' || userRole === 'manager' || Boolean(rolePermissions.reports));
  const { data: metrics, isLoading } = useGetDashboardMetrics();
  const [agents, setAgents] = useState<AgentRace[]>([]);
  const [slots, setSlots] = useState<SlotLoad[]>(
    SLOT_HOURS.map(h => ({ time: `${String(h).padStart(2, '0')}:00`, booked: 0 }))
  );
  const [loadingData, setLoadingData] = useState(true);
  const [coreSummary, setCoreSummary] = useState<CoreSummary>({ contacts: 0, openDeals: 0, openTasks: 0, paidAmount: 0 });

  useEffect(() => {
    if (clinicId) loadDashboardData();
  }, [clinicId, hasBooking]);

  const loadDashboardData = async () => {
    if (!clinicId) return;
    setLoadingData(true);

    const today = new Date().toISOString().split('T')[0];
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    const weekStartStr = weekStart.toISOString().split('T')[0];

    const [contactsResult, dealsResult, tasksResult, paymentsResult] = await Promise.all([
      supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId),
      supabase.from('deals').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId).eq('status', 'open'),
      supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId).neq('status', 'done'),
      supabase.from('payments').select('amount').eq('clinic_id', clinicId).eq('status', 'paid').gte('created_at', today),
    ]);
    setCoreSummary({
      contacts: contactsResult.count ?? 0,
      openDeals: dealsResult.count ?? 0,
      openTasks: tasksResult.count ?? 0,
      paidAmount: (paymentsResult.data ?? []).reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    });

    if (!hasBooking) {
      setAgents([]);
      setSlots(SLOT_HOURS.map(hour => ({ time: `${String(hour).padStart(2, '0')}:00`, booked: 0 })));
      setLoadingData(false);
      return;
    }

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
  const currency = country === 'KG' ? 'сом' : '₸';

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
              <span>{isLoading ? '...' : coreSummary.openTasks + (hasBooking ? bookingsToday : coreSummary.openDeals)}</span>
            </div>
            <div className="dashboard-attention-list">
              {hasBooking && <div className="dashboard-attention-card">
                <div className="dashboard-attention-icon"><CalendarClock size={19} /></div>
                <div><strong>Записи на сегодня</strong><small>{isLoading ? 'Загрузка данных' : `${bookingsToday} записей в расписании`}</small></div>
                <ArrowUpRight size={18} />
              </div>}
              {hasBooking && <div className="dashboard-attention-card">
                <div className="dashboard-attention-icon"><TrendingUp size={19} /></div>
                <div><strong>Загрузка дня</strong><small>{isLoading ? 'Загрузка данных' : `${loadPercent}% от доступных слотов`}</small></div>
                <ArrowUpRight size={18} />
              </div>}
              {!hasBooking && <div className="dashboard-attention-card">
                <div className="dashboard-attention-icon"><TrendingUp size={19} /></div>
                <div><strong>Активные сделки</strong><small>{coreSummary.openDeals} сделок требуют работы</small></div>
                <ArrowUpRight size={18} />
              </div>}
              <div className="dashboard-attention-card is-alert">
                <div className="dashboard-attention-icon"><CircleAlert size={19} /></div>
                <div><strong>Контроль задач</strong><small>{coreSummary.openTasks ? `${coreSummary.openTasks} задач не завершено` : 'Просроченных и активных задач нет'}</small></div>
                <ArrowUpRight size={18} />
              </div>
            </div>
          </section>

          <section className="dashboard-kpi-grid">
            <article className="dashboard-kpi-card">
              <div className="dashboard-kpi-title"><span>{hasBooking ? <Calendar size={18} /> : <Users size={18} />}</span><p>{hasBooking ? 'Записи на сегодня' : 'Контакты'}</p></div>
              <div className="dashboard-kpi-value">{isLoading ? '...' : hasBooking ? bookingsToday : coreSummary.contacts}</div>
              <div className="dashboard-kpi-foot"><span>{hasBooking ? 'Запланировано' : 'В CRM'}</span><strong>{hasBooking ? `${SLOT_HOURS.length * MAX_PER_SLOT} мест` : `${coreSummary.openDeals} активных сделок`}</strong></div>
            </article>
            <article className="dashboard-kpi-card">
              <div className="dashboard-kpi-title"><span><DollarSign size={18} /></span><p>Выручка сегодня</p></div>
              <div className="dashboard-kpi-value">{isLoading ? '...' : `${(hasBooking ? revenueToday : coreSummary.paidAmount).toLocaleString('ru-RU')} ${currency}`}</div>
              <div className="dashboard-kpi-foot"><span>{hasBooking ? 'Пришло клиентов' : 'Получено оплат'}</span><strong>{hasBooking ? visitedToday : 'сегодня'}</strong></div>
            </article>
            <article className="dashboard-chart-card">
              <div className="dashboard-chart-header"><div><h3>{hasBooking ? 'Нагрузка по часам' : 'Рабочая сводка'}</h3><p>Текущий день</p></div><strong>{hasBooking ? `${loadPercent}%` : `${coreSummary.openDeals}`}</strong></div>
              {hasBooking ? <>
                <div className="dashboard-bars" aria-label="Загрузка по часам">
                  {slots.map(slot => <span key={slot.time} style={{ height: `${Math.max(12, (slot.booked / maxSlotLoad) * 100)}%` }} title={`${slot.time}: ${slot.booked} записей`} />)}
                </div>
                <div className="dashboard-chart-labels"><span>{slots[0]?.time}</span><span>{slots[slots.length - 1]?.time}</span></div>
              </> : <div className="grid grid-cols-3 gap-4 pt-8 text-center">
                <div><strong className="block text-2xl">{coreSummary.contacts}</strong><span className="text-xs text-[#64748B]">контактов</span></div>
                <div><strong className="block text-2xl">{coreSummary.openDeals}</strong><span className="text-xs text-[#64748B]">сделок</span></div>
                <div><strong className="block text-2xl">{coreSummary.openTasks}</strong><span className="text-xs text-[#64748B]">задач</span></div>
              </div>}
            </article>
          </section>
        </div>

        {hasBooking && <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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
        </div>}

        {hasReports && <ReportsOverview />}

      </div>
    </PageLayout>
  );
}
