import { useState, useEffect } from 'react';
import { PageLayout } from '@/components/layout/PageLayout';
import { Search, Plus, X, Check, ArrowUpDown } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

/* ── Types ─────────────────────────────────────────────── */
interface Lead {
  id: string; clinic_id: string; agent_id: string | null;
  first_name: string | null; last_name: string | null;
  phone: string | null; age: number | null;
  source: string | null; status_id: string | null; comment: string | null;
  created_at: string;
  lead_statuses?: { name: string; color: string } | null;
}
interface LeadStatus { id: string; name: string; color: string }
interface Agent { id: string; name: string; user_id: string | null }

const SOURCES = ['Instagram', 'Google', 'WhatsApp', '2GIS', 'Вручную', 'Webhook'];
const SORT_OPTIONS = [
  { value: 'created_at_desc', label: 'Дата (новые)' },
  { value: 'created_at_asc',  label: 'Дата (старые)' },
  { value: 'phone_asc',       label: 'Телефон (А→Я)' },
  { value: 'agent_asc',       label: 'Ответственный' },
];

export default function Sales() {
  const { clinicId, user, userRole } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [statuses, setStatuses] = useState<LeadStatus[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [myAgentId, setMyAgentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterAgent, setFilterAgent] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [sortBy, setSortBy] = useState('created_at_desc');

  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [showNew, setShowNew] = useState(false);

  /* form for new lead */
  const [form, setForm] = useState({ first_name: '', last_name: '', phone: '', age: '', source: 'Вручную', status_id: '', comment: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (clinicId) init(); }, [clinicId]);

  const init = async () => {
    if (!clinicId) return;
    setLoading(true);
    const [{ data: sl }, { data: ag }] = await Promise.all([
      supabase.from('lead_statuses').select('id, name, color').eq('clinic_id', clinicId).order('position'),
      supabase.from('agents').select('id, name, user_id').eq('clinic_id', clinicId).order('name'),
    ]);
    setStatuses(sl ?? []);
    setAgents(ag ?? []);
    if (user && ag) {
      const mine = ag.find(a => a.user_id === user.id);
      setMyAgentId(mine?.id ?? null);
    }
    await loadLeads(sl ?? [], ag ?? []);
    setLoading(false);
  };

  const loadLeads = async (sl: LeadStatus[], ag: Agent[]) => {
    if (!clinicId) return;
    let q = supabase
      .from('leads')
      .select('*, lead_statuses(name, color)')
      .eq('clinic_id', clinicId);

    if (userRole === 'agent' && myAgentId) q = q.eq('agent_id', myAgentId);

    const [field, dir] = sortBy === 'created_at_desc' ? ['created_at', false]
      : sortBy === 'created_at_asc' ? ['created_at', true]
      : sortBy === 'phone_asc' ? ['phone', true]
      : ['created_at', false];
    q = q.order(field, { ascending: dir });

    const { data, error } = await q;
    if (error) { toast.error(error.message); return; }
    setLeads(data ?? []);
  };

  useEffect(() => { if (clinicId && !loading) loadLeads(statuses, agents); }, [sortBy, myAgentId]);

  /* filtered display */
  const displayed = leads.filter(l => {
    const name = `${l.first_name ?? ''} ${l.last_name ?? ''}`.toLowerCase();
    if (search && !name.includes(search.toLowerCase()) && !(l.phone ?? '').includes(search)) return false;
    if (filterStatus && l.status_id !== filterStatus) return false;
    if (filterAgent && l.agent_id !== filterAgent) return false;
    if (filterSource && l.source !== filterSource) return false;
    return true;
  });

  /* ── Create lead ── */
  const createLead = async () => {
    if (!form.phone.trim()) { toast.error('Введите телефон'); return; }
    setSaving(true);
    const { error } = await supabase.from('leads').insert({
      clinic_id: clinicId,
      agent_id: myAgentId,
      first_name: form.first_name || null,
      last_name: form.last_name || null,
      phone: form.phone,
      age: form.age ? parseInt(form.age) : null,
      source: form.source,
      status_id: form.status_id || statuses[0]?.id || null,
      comment: form.comment || null,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Лид создан');
    setShowNew(false);
    setForm({ first_name: '', last_name: '', phone: '', age: '', source: 'Вручную', status_id: '', comment: '' });
    init();
  };

  /* ── Update lead ── */
  const updateLead = async () => {
    if (!selectedLead) return;
    setSaving(true);
    const { error } = await supabase.from('leads').update({
      first_name: selectedLead.first_name,
      last_name: selectedLead.last_name,
      phone: selectedLead.phone,
      age: selectedLead.age,
      source: selectedLead.source,
      status_id: selectedLead.status_id,
      agent_id: selectedLead.agent_id,
      comment: selectedLead.comment,
    }).eq('id', selectedLead.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Лид обновлён');
    setSelectedLead(null);
    init();
  };

  /* ── Delete lead ── */
  const deleteLead = async (id: string) => {
    const { error } = await supabase.from('leads').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('Лид удалён');
    setSelectedLead(null);
    init();
  };

  const statusColor = (lead: Lead) => lead.lead_statuses?.color ?? '#94A3B8';
  const statusName = (lead: Lead) => lead.lead_statuses?.name ?? '—';
  const fullName = (lead: Lead) => [lead.first_name, lead.last_name].filter(Boolean).join(' ') || '—';
  const agentName = (lead: Lead) => agents.find(a => a.id === lead.agent_id)?.name ?? '—';

  /* ── UI ─────────────────────────────────────────────── */
  const IS: React.CSSProperties = {
    background: '#F4F7FB', border: '1px solid #E7ECF3', borderRadius: 10,
    padding: '9px 13px', fontSize: 13, color: '#0B1220',
    fontFamily: "'Inter', sans-serif", outline: 'none', width: '100%',
  };

  return (
    <PageLayout>
      <div className="space-y-5 h-full flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold">Negis CRM</h2>
          <button className="neu-btn-primary flex items-center gap-2" onClick={() => setShowNew(true)}>
            <Plus size={16} /> Новый лид
          </button>
        </div>

        {/* Filters */}
        <div className="neu-card p-4 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-48">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
            <input type="text" placeholder="Имя или телефон"
              className="neu-input pl-9 text-sm" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="neu-input text-sm w-40" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">Все статусы</option>
            {statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {(userRole === 'owner' || userRole === 'manager') && (
            <select className="neu-input text-sm w-44" value={filterAgent} onChange={e => setFilterAgent(e.target.value)}>
              <option value="">Все агенты</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          <select className="neu-input text-sm w-40" value={filterSource} onChange={e => setFilterSource(e.target.value)}>
            <option value="">Все источники</option>
            {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <div className="flex items-center gap-1.5 text-sm text-[#64748B]">
            <ArrowUpDown size={14} />
            <select className="neu-input text-sm w-44" value={sortBy} onChange={e => setSortBy(e.target.value)}>
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="neu-card flex-1 overflow-hidden p-0">
          <div className="overflow-x-auto h-full">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E7ECF3] text-[#64748B] text-sm sticky top-0 bg-white z-10">
                  <th className="p-4 font-semibold">Имя</th>
                  <th className="p-4 font-semibold">Телефон</th>
                  <th className="p-4 font-semibold">Источник</th>
                  <th className="p-4 font-semibold">Статус</th>
                  <th className="p-4 font-semibold">Ответственный</th>
                  <th className="p-4 font-semibold">Дата</th>
                  <th className="p-4 font-semibold text-right">Действия</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="py-16 text-center text-[#94A3B8] text-sm">Загрузка...</td></tr>
                ) : displayed.length === 0 ? (
                  <tr><td colSpan={7} className="py-16 text-center text-[#94A3B8] text-sm">
                    Нет лидов. Добавьте первый или импортируйте из CSV.
                  </td></tr>
                ) : displayed.map(lead => (
                  <tr key={lead.id}
                    className="border-b border-[#F1F5F9] hover:bg-[#F8FAFC] cursor-pointer transition-colors text-sm"
                    onClick={() => setSelectedLead(lead)}
                  >
                    <td className="p-4 font-medium text-[#0B1220]">{fullName(lead)}</td>
                    <td className="p-4 text-[#64748B]">{lead.phone ?? '—'}</td>
                    <td className="p-4 text-[#64748B]">{lead.source ?? '—'}</td>
                    <td className="p-4">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
                        style={{ background: statusColor(lead) + '18', color: statusColor(lead) }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor(lead) }} />
                        {statusName(lead)}
                      </span>
                    </td>
                    <td className="p-4 text-[#64748B]">{agentName(lead)}</td>
                    <td className="p-4 text-[#94A3B8]">
                      {new Date(lead.created_at).toLocaleDateString('ru-RU')}
                    </td>
                    <td className="p-4 text-right">
                      <button className="neu-btn px-2 py-1 text-xs text-[#64748B]"
                        onClick={e => { e.stopPropagation(); setSelectedLead(lead); }}>
                        Открыть
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── New Lead Modal ── */}
        {showNew && (
          <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={e => { if (e.target === e.currentTarget) setShowNew(false); }}>
            <div style={{
              background: '#FFFFFF', border: '1px solid #E7ECF3', borderRadius: 20,
              boxShadow: '0 24px 64px rgba(15,23,42,0.14)', width: '100%', maxWidth: 440, padding: '32px 28px',
            }}>
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-base font-bold text-[#0B1220]">Новый лид</h3>
                <button onClick={() => setShowNew(false)} style={{ background: '#F4F7FB', border: '1px solid #E7ECF3', borderRadius: 8, padding: 6, cursor: 'pointer' }}>
                  <X size={15} color="#64748B" />
                </button>
              </div>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-[#64748B] font-medium block mb-1.5">Имя</label>
                    <input style={IS} placeholder="Имя" value={form.first_name} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs text-[#64748B] font-medium block mb-1.5">Фамилия</label>
                    <input style={IS} placeholder="Фамилия" value={form.last_name} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-[#64748B] font-medium block mb-1.5">Телефон *</label>
                  <input style={IS} placeholder="+7 700 000 0000" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-[#64748B] font-medium block mb-1.5">Источник</label>
                    <select style={IS} value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))}>
                      {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-[#64748B] font-medium block mb-1.5">Статус</label>
                    <select style={IS} value={form.status_id} onChange={e => setForm(f => ({ ...f, status_id: e.target.value }))}>
                      <option value="">— выбрать —</option>
                      {statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                </div>
                {(userRole === 'owner' || userRole === 'manager') && (
                  <div>
                    <label className="text-xs text-[#64748B] font-medium block mb-1.5">Ответственный</label>
                    <select style={IS} value={selectedLead?.agent_id ?? ''} onChange={e => setForm(f => ({ ...f }))}>
                      <option value="">— выбрать —</option>
                      {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label className="text-xs text-[#64748B] font-medium block mb-1.5">Комментарий</label>
                  <textarea style={{ ...IS, minHeight: 80, resize: 'vertical' } as React.CSSProperties}
                    placeholder="Заметки..." value={form.comment} onChange={e => setForm(f => ({ ...f, comment: e.target.value }))} />
                </div>
              </div>
              <div className="flex gap-3 mt-5">
                <button onClick={() => setShowNew(false)} style={{ flex: 1, padding: '11px', borderRadius: 12, background: '#F4F7FB', border: '1px solid #E7ECF3', fontSize: 14, color: '#475569', cursor: 'pointer' }}>
                  Отмена
                </button>
                <button onClick={createLead} disabled={saving}
                  style={{ flex: 1, padding: '11px', borderRadius: 12, background: '#1E325C', border: 'none', fontSize: 14, color: '#FFF', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <Check size={15} />{saving ? 'Создание...' : 'Создать'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Lead Detail Modal ── */}
        {selectedLead && (
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-2xl max-h-[90vh] rounded-[20px] shadow-2xl flex flex-col overflow-hidden border border-[#E7ECF3]">
              <div className="flex items-center justify-between px-7 py-5 border-b border-[#E7ECF3]">
                <h3 className="text-base font-bold text-[#0B1220]">{fullName(selectedLead)}</h3>
                <button onClick={() => setSelectedLead(null)} style={{ background: '#F4F7FB', border: '1px solid #E7ECF3', borderRadius: 8, padding: 6, cursor: 'pointer' }}>
                  <X size={15} color="#64748B" />
                </button>
              </div>
              <div className="overflow-y-auto flex-1 p-7">
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: 'Имя', key: 'first_name', type: 'text' },
                    { label: 'Фамилия', key: 'last_name', type: 'text' },
                    { label: 'Телефон', key: 'phone', type: 'text' },
                    { label: 'Возраст', key: 'age', type: 'number' },
                  ].map(({ label, key, type }) => (
                    <div key={key}>
                      <label className="text-xs text-[#64748B] font-medium block mb-1.5">{label}</label>
                      <input type={type} style={IS}
                        value={(selectedLead as any)[key] ?? ''}
                        onChange={e => setSelectedLead(l => l ? { ...l, [key]: e.target.value || null } : l)} />
                    </div>
                  ))}
                  <div>
                    <label className="text-xs text-[#64748B] font-medium block mb-1.5">Источник</label>
                    <select style={IS} value={selectedLead.source ?? ''} onChange={e => setSelectedLead(l => l ? { ...l, source: e.target.value } : l)}>
                      {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-[#64748B] font-medium block mb-1.5">Статус</label>
                    <select style={IS} value={selectedLead.status_id ?? ''} onChange={e => setSelectedLead(l => l ? { ...l, status_id: e.target.value } : l)}>
                      <option value="">— выбрать —</option>
                      {statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  {(userRole === 'owner' || userRole === 'manager') && (
                    <div className="col-span-2">
                      <label className="text-xs text-[#64748B] font-medium block mb-1.5">Ответственный</label>
                      <select style={IS} value={selectedLead.agent_id ?? ''} onChange={e => setSelectedLead(l => l ? { ...l, agent_id: e.target.value || null } : l)}>
                        <option value="">— выбрать —</option>
                        {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                    </div>
                  )}
                  <div className="col-span-2">
                    <label className="text-xs text-[#64748B] font-medium block mb-1.5">Комментарий</label>
                    <textarea style={{ ...IS, minHeight: 80, resize: 'vertical' } as React.CSSProperties}
                      value={selectedLead.comment ?? ''}
                      onChange={e => setSelectedLead(l => l ? { ...l, comment: e.target.value } : l)} />
                  </div>
                </div>
              </div>
              <div className="px-7 py-4 border-t border-[#E7ECF3] flex gap-3">
                <button onClick={() => deleteLead(selectedLead.id)}
                  style={{ padding: '10px 16px', borderRadius: 10, background: '#FEF2F2', border: '1px solid #FEE2E2', fontSize: 13, color: '#DC2626', cursor: 'pointer' }}>
                  Удалить
                </button>
                <div style={{ flex: 1 }} />
                <button onClick={() => setSelectedLead(null)}
                  style={{ padding: '10px 16px', borderRadius: 10, background: '#F4F7FB', border: '1px solid #E7ECF3', fontSize: 14, color: '#475569', cursor: 'pointer' }}>
                  Отмена
                </button>
                <button onClick={updateLead} disabled={saving}
                  style={{ padding: '10px 20px', borderRadius: 10, background: '#1E325C', border: 'none', fontSize: 14, color: '#FFF', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Check size={15} />{saving ? 'Сохранение...' : 'Сохранить'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </PageLayout>
  );
}
