import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Loader2, Plus, Settings2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

type Pipeline = {
  id: string;
  name: string;
  currency: 'KZT' | 'KGS' | 'USD';
  is_default: boolean;
  sort_order: number;
};

type Stage = {
  id: string;
  pipeline_id: string;
  code: string;
  name: string;
  probability: number;
  outcome: 'open' | 'won' | 'lost';
  sort_order: number;
  color: string;
  is_active: boolean;
};

type Deal = {
  id: string;
  pipeline_id: string;
  stage_id: string;
  title: string;
  amount: number;
  currency: string;
  probability: number;
  status: 'open' | 'won' | 'lost' | 'cancelled';
  expected_close_date: string | null;
  created_at: string;
  updated_at: string;
};

type StageEvent = {
  id: string;
  deal_id: string;
  from_stage_id: string | null;
  to_stage_id: string;
  occurred_at: string;
};

type LeadForDeal = {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  source: string | null;
  comment: string | null;
  assigned_to: string | null;
  created_at: string;
};

type DraftStage = Omit<Stage, 'id' | 'code' | 'is_active'> & { id: string; code?: string };

const inputClass = 'w-full rounded-xl border border-[#DDE5EF] bg-white px-3 py-2.5 text-sm text-[#10264B] outline-none focus:border-[#3157DE]';
const stagePalette = ['#DBEAFE', '#E0E7FF', '#EDE9FE', '#FEF3C7', '#D1FAE5', '#BBF7D0', '#FEE2E2'];
const admissionVisaTemplate = [
  ['Новый лид', 10, 'open'],
  ['Первый контакт', 20, 'open'],
  ['Выявление потребности', 30, 'open'],
  ['Консультация назначена', 40, 'open'],
  ['Консультация проведена', 50, 'open'],
  ['Договор отправлен', 60, 'open'],
  ['Договор подписан', 70, 'open'],
  ['Предоплата 50%', 80, 'open'],
  ['Сбор документов', 85, 'open'],
  ['Подача документов', 90, 'open'],
  ['Приглашение / Зачисление', 95, 'open'],
  ['Виза', 100, 'won'],
] as const;

function money(value: number, currency: string) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function dealStatus(status: Deal['status']) {
  return ({ open: 'В работе', won: 'Успешно', lost: 'Проиграна', cancelled: 'Отменена' })[status];
}

export function ClientDealsTab({ clinicId, lead, userRole }: {
  clinicId: string;
  lead: LeadForDeal;
  userRole: string | null;
}) {
  const canConfigure = userRole === 'owner' || userRole === 'manager';
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [contactId, setContactId] = useState<string | null>(null);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [events, setEvents] = useState<StageEvent[]>([]);
  const [selectedDealId, setSelectedDealId] = useState('');
  const [showNewDeal, setShowNewDeal] = useState(false);
  const [showPipelineSettings, setShowPipelineSettings] = useState(false);
  const [editingPipelineId, setEditingPipelineId] = useState('');
  const [newDeal, setNewDeal] = useState({ title: '', pipelineId: '', amount: '', expectedCloseDate: '' });
  const [pipelineName, setPipelineName] = useState('');
  const [draftStages, setDraftStages] = useState<DraftStage[]>([]);

  const selectedDeal = deals.find(deal => deal.id === selectedDealId) ?? deals[0] ?? null;
  const selectedPipeline = pipelines.find(pipeline => pipeline.id === selectedDeal?.pipeline_id)
    ?? pipelines.find(pipeline => pipeline.id === newDeal.pipelineId)
    ?? pipelines[0]
    ?? null;
  const editingPipeline = pipelines.find(pipeline => pipeline.id === editingPipelineId) ?? selectedPipeline;
  const selectedStages = useMemo(() => stages
    .filter(stage => stage.pipeline_id === selectedDeal?.pipeline_id && stage.is_active)
    .sort((a, b) => a.sort_order - b.sort_order), [selectedDeal?.pipeline_id, stages]);

  const ensureContact = async () => {
    const existing = await supabase.from('contacts').select('id')
      .eq('clinic_id', clinicId).eq('legacy_lead_id', lead.id).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data?.id) return existing.data.id as string;

    const created = await supabase.from('contacts').insert({
      clinic_id: clinicId,
      legacy_lead_id: lead.id,
      owner_agent_id: lead.assigned_to,
      first_name: lead.full_name?.trim() || lead.phone?.trim() || 'Без имени',
      phone: lead.phone,
      email: lead.email,
      source: lead.source,
      notes: lead.comment || '',
      created_at: lead.created_at,
    }).select('id').single();
    if (created.error) {
      const retried = await supabase.from('contacts').select('id')
        .eq('clinic_id', clinicId).eq('legacy_lead_id', lead.id).single();
      if (retried.error) throw created.error;
      return retried.data.id as string;
    }
    return created.data.id as string;
  };

  const load = async (preferredDealId?: string) => {
    setLoading(true);
    try {
      const resolvedContactId = await ensureContact();
      setContactId(resolvedContactId);
      const [pipelineResult, stageResult, dealResult] = await Promise.all([
        supabase.from('deal_pipelines').select('id, name, currency, is_default, sort_order')
          .eq('clinic_id', clinicId).eq('is_active', true).order('sort_order'),
        supabase.from('deal_stages').select('id, pipeline_id, code, name, probability, outcome, sort_order, color, is_active')
          .eq('clinic_id', clinicId).order('sort_order'),
        supabase.from('deals').select('id, pipeline_id, stage_id, title, amount, currency, probability, status, expected_close_date, created_at, updated_at')
          .eq('clinic_id', clinicId).eq('contact_id', resolvedContactId).order('updated_at', { ascending: false }),
      ]);
      const error = pipelineResult.error || stageResult.error || dealResult.error;
      if (error) throw error;
      const nextPipelines = (pipelineResult.data ?? []) as Pipeline[];
      const nextDeals = (dealResult.data ?? []) as Deal[];
      setPipelines(nextPipelines);
      setStages((stageResult.data ?? []) as Stage[]);
      setDeals(nextDeals);
      const nextSelectedId = preferredDealId && nextDeals.some(deal => deal.id === preferredDealId)
        ? preferredDealId : nextDeals[0]?.id ?? '';
      setSelectedDealId(nextSelectedId);
      setNewDeal(previous => ({
        ...previous,
        title: previous.title || `${lead.full_name || 'Клиент'} — сделка`,
        pipelineId: previous.pipelineId || nextPipelines.find(item => item.is_default)?.id || nextPipelines[0]?.id || '',
      }));
      if (nextDeals.length) {
        const eventResult = await supabase.from('deal_stage_events').select('id, deal_id, from_stage_id, to_stage_id, occurred_at')
          .eq('clinic_id', clinicId).in('deal_id', nextDeals.map(deal => deal.id)).order('occurred_at', { ascending: false }).limit(50);
        if (!eventResult.error) setEvents((eventResult.data ?? []) as StageEvent[]);
      } else {
        setEvents([]);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось загрузить сделки клиента');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [clinicId, lead.id]);

  const createDeal = async () => {
    if (!contactId || !newDeal.pipelineId || !newDeal.title.trim()) {
      toast.error('Укажите название и воронку сделки');
      return;
    }
    const firstStage = stages.filter(stage => stage.pipeline_id === newDeal.pipelineId && stage.is_active)
      .sort((a, b) => a.sort_order - b.sort_order)[0];
    const pipeline = pipelines.find(item => item.id === newDeal.pipelineId);
    if (!firstStage || !pipeline) {
      toast.error('В выбранной воронке нет этапов');
      return;
    }
    setSaving(true);
    const result = await supabase.from('deals').insert({
      clinic_id: clinicId,
      contact_id: contactId,
      owner_agent_id: lead.assigned_to,
      title: newDeal.title.trim(),
      pipeline_id: pipeline.id,
      stage_id: firstStage.id,
      stage: firstStage.code,
      status: firstStage.outcome,
      probability: firstStage.probability,
      amount: Number(newDeal.amount) || 0,
      currency: pipeline.currency,
      source: lead.source,
      expected_close_date: newDeal.expectedCloseDate || null,
    }).select('id').single();
    setSaving(false);
    if (result.error) {
      toast.error(result.error.message);
      return;
    }
    toast.success('Сделка создана');
    setShowNewDeal(false);
    setNewDeal(previous => ({ ...previous, title: '', amount: '', expectedCloseDate: '' }));
    await load(result.data.id);
  };

  const changeStage = async (stage: Stage) => {
    if (!selectedDeal || selectedDeal.stage_id === stage.id) return;
    setSaving(true);
    const { error } = await supabase.from('deals').update({ pipeline_id: stage.pipeline_id, stage_id: stage.id })
      .eq('id', selectedDeal.id).eq('clinic_id', clinicId);
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success(`Этап: ${stage.name}`);
      await load(selectedDeal.id);
    }
  };

  const updateDeal = async (patch: Partial<Pick<Deal, 'title' | 'amount' | 'expected_close_date'>>) => {
    if (!selectedDeal) return;
    setSaving(true);
    const { error } = await supabase.from('deals').update(patch).eq('id', selectedDeal.id).eq('clinic_id', clinicId);
    setSaving(false);
    if (error) toast.error(error.message);
    else { toast.success('Сделка обновлена'); await load(selectedDeal.id); }
  };

  const openPipelineEditor = (pipeline = selectedPipeline) => {
    if (!pipeline) return;
    setEditingPipelineId(pipeline.id);
    setPipelineName(pipeline.name);
    setDraftStages(stages.filter(stage => stage.pipeline_id === pipeline.id && stage.is_active)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(({ id, pipeline_id, code, name, probability, outcome, sort_order, color }) => ({ id, pipeline_id, code, name, probability, outcome, sort_order, color })));
    setShowPipelineSettings(true);
  };

  const addPipeline = async () => {
    const currency = pipelines[0]?.currency || 'KZT';
    const created = await supabase.rpc('negis_create_deal_pipeline', {
      target_clinic_id: clinicId,
      target_name: 'Новая воронка',
      target_currency: currency,
    });
    if (created.error) { toast.error(created.error.message); return; }
    const createdPipelineId = String(created.data);
    toast.success('Воронка создана');
    setNewDeal(previous => ({ ...previous, pipelineId: createdPipelineId }));
    await load();
    const stageResult = await supabase.from('deal_stages').select('id, pipeline_id, code, name, probability, outcome, sort_order, color')
      .eq('clinic_id', clinicId).eq('pipeline_id', createdPipelineId).eq('is_active', true).order('sort_order');
    if (stageResult.error) { toast.error(stageResult.error.message); return; }
    setEditingPipelineId(createdPipelineId);
    setPipelineName('Новая воронка');
    setDraftStages((stageResult.data ?? []) as DraftStage[]);
    setShowPipelineSettings(true);
  };

  const applyAdmissionTemplate = async () => {
    if (!editingPipeline) return;
    const usage = await supabase.from('deals').select('id', { count: 'exact', head: true }).eq('pipeline_id', editingPipeline.id);
    if (usage.error) { toast.error(usage.error.message); return; }
    if ((usage.count ?? 0) > 0) {
      toast.error('Шаблон можно применить только к воронке без сделок. Создайте новую воронку.');
      return;
    }
    setPipelineName('Поступление / Виза');
    setDraftStages(admissionVisaTemplate.map(([name, probability, outcome], index) => ({
      id: `new-${crypto.randomUUID()}`,
      pipeline_id: editingPipeline.id,
      name,
      probability,
      outcome,
      sort_order: (index + 1) * 10,
      color: stagePalette[index % stagePalette.length],
    })));
  };

  const removeDraftStage = async (stage: DraftStage) => {
    if (draftStages.length <= 1) {
      toast.error('В воронке должен остаться хотя бы один этап');
      return;
    }
    if (stage.id.startsWith('new-')) {
      setDraftStages(previous => previous.filter(item => item.id !== stage.id));
      return;
    }
    const usage = await supabase.from('deals').select('id', { count: 'exact', head: true }).eq('stage_id', stage.id);
    if (usage.error) { toast.error(usage.error.message); return; }
    if ((usage.count ?? 0) > 0) {
      toast.error(`На этапе есть сделки: ${usage.count}. Сначала перенесите их.`);
      return;
    }
    setDraftStages(previous => previous.filter(item => item.id !== stage.id));
  };

  const moveDraftStage = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= draftStages.length) return;
    setDraftStages(previous => {
      const next = [...previous];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const savePipeline = async () => {
    if (!editingPipeline || !pipelineName.trim() || draftStages.some(stage => !stage.name.trim())) {
      toast.error('У каждого этапа должно быть название');
      return;
    }
    setSaving(true);
    try {
      const result = await supabase.rpc('negis_replace_deal_pipeline', {
        target_pipeline_id: editingPipeline.id,
        target_name: pipelineName.trim(),
        stage_rows: draftStages.map(stage => ({
          id: stage.id.startsWith('new-') ? null : stage.id,
          name: stage.name.trim(),
          probability: Math.max(0, Math.min(100, Number(stage.probability) || 0)),
          outcome: stage.outcome,
          color: stage.color,
        })),
      });
      if (result.error) throw result.error;
      toast.success('Воронка сохранена');
      setShowPipelineSettings(false);
      await load(selectedDeal?.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось сохранить воронку');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex min-h-[280px] items-center justify-center text-[#71829D]"><Loader2 className="mr-2 animate-spin" size={18} /> Загрузка сделок...</div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-[#10264B]">Сделки клиента</h3>
          <p className="mt-1 text-sm text-[#71829D]">Каждая продажа живёт отдельно: своя воронка, сумма и история.</p>
        </div>
        <div className="flex gap-2">
          {canConfigure && <button type="button" onClick={addPipeline} className="rounded-xl border border-[#DDE5EF] bg-white px-3 py-2 text-sm font-semibold text-[#52657F]"><Plus size={15} className="mr-1 inline" /> Воронка</button>}
          <button type="button" onClick={() => setShowNewDeal(true)} className="rounded-xl bg-[#1E325C] px-4 py-2 text-sm font-semibold text-white"><Plus size={15} className="mr-1 inline" /> Новая сделка</button>
        </div>
      </div>

      {deals.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#CBD5E1] bg-[#F8FAFC] px-6 py-12 text-center">
          <div className="font-semibold text-[#10264B]">У клиента пока нет сделок</div>
          <div className="mt-1 text-sm text-[#71829D]">Создайте первую сделку и выберите подходящую воронку.</div>
        </div>
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {deals.map(deal => (
              <button key={deal.id} type="button" onClick={() => setSelectedDealId(deal.id)}
                className={`min-w-[210px] rounded-xl border px-4 py-3 text-left ${selectedDeal?.id === deal.id ? 'border-[#3157DE] bg-[#EEF3FF]' : 'border-[#E3EAF2] bg-white'}`}>
                <div className="truncate text-sm font-bold text-[#10264B]">{deal.title}</div>
                <div className="mt-1 flex justify-between text-xs text-[#71829D]"><span>{dealStatus(deal.status)}</span><span>{money(deal.amount, deal.currency)}</span></div>
              </button>
            ))}
          </div>

          {selectedDeal && (
            <div className="space-y-5 rounded-2xl border border-[#E3EAF2] bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-bold text-[#10264B]">{selectedDeal.title}</div>
                  <div className="mt-1 text-sm text-[#71829D]">{selectedPipeline?.name} · {selectedDeal.probability}% · {money(selectedDeal.amount, selectedDeal.currency)}</div>
                </div>
                {canConfigure && <button type="button" onClick={() => openPipelineEditor()} className="rounded-xl border border-[#DDE5EF] bg-white px-3 py-2 text-sm font-semibold text-[#52657F]"><Settings2 size={15} className="mr-1 inline" /> Настроить этапы</button>}
              </div>

              <div className="flex gap-2 overflow-x-auto pb-2">
                {selectedStages.map((stage, index) => {
                  const currentIndex = selectedStages.findIndex(item => item.id === selectedDeal.stage_id);
                  const active = stage.id === selectedDeal.stage_id;
                  const passed = currentIndex >= 0 && index < currentIndex;
                  return (
                    <button key={stage.id} type="button" disabled={saving} onClick={() => changeStage(stage)}
                      className={`min-w-[150px] rounded-xl border px-3 py-3 text-left transition-colors ${active ? 'border-[#3157DE] bg-[#EEF3FF]' : passed ? 'border-[#CDEBD8] bg-[#F2FBF5]' : 'border-[#E3EAF2] bg-white hover:border-[#AAB9D0]'}`}>
                      <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: stage.color }} /><span className="text-xs font-bold text-[#10264B]">{stage.name}</span></div>
                      <div className="mt-2 text-xs text-[#71829D]">{stage.probability}%</div>
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <label className="text-xs font-semibold text-[#71829D]">Название
                  <input className={`${inputClass} mt-1`} defaultValue={selectedDeal.title} onBlur={event => event.target.value.trim() !== selectedDeal.title && updateDeal({ title: event.target.value.trim() })} />
                </label>
                <label className="text-xs font-semibold text-[#71829D]">Сумма
                  <input className={`${inputClass} mt-1`} type="number" min="0" defaultValue={selectedDeal.amount} onBlur={event => Number(event.target.value) !== Number(selectedDeal.amount) && updateDeal({ amount: Math.max(0, Number(event.target.value) || 0) })} />
                </label>
                <label className="text-xs font-semibold text-[#71829D]">Ожидаемое закрытие
                  <input className={`${inputClass} mt-1`} type="date" defaultValue={selectedDeal.expected_close_date || ''} onBlur={event => event.target.value !== (selectedDeal.expected_close_date || '') && updateDeal({ expected_close_date: event.target.value || null })} />
                </label>
              </div>

              <div>
                <div className="text-sm font-bold text-[#10264B]">История этапов</div>
                <div className="mt-2 space-y-2">
                  {events.filter(event => event.deal_id === selectedDeal.id).slice(0, 8).map(event => (
                    <div key={event.id} className="flex items-center justify-between rounded-xl bg-[#F8FAFC] px-3 py-2 text-xs">
                      <span className="text-[#52657F]">{stages.find(stage => stage.id === event.from_stage_id)?.name || 'Создание'} → <strong>{stages.find(stage => stage.id === event.to_stage_id)?.name || 'Этап'}</strong></span>
                      <span className="text-[#94A3B8]">{new Date(event.occurred_at).toLocaleString('ru-RU')}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {showNewDeal && (
        <div className="rounded-2xl border border-[#DDE5EF] bg-[#F8FAFC] p-5">
          <div className="flex items-center justify-between"><h4 className="font-bold text-[#10264B]">Новая сделка</h4><button onClick={() => setShowNewDeal(false)}><X size={17} /></button></div>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <input className={inputClass} placeholder="Название сделки" value={newDeal.title} onChange={event => setNewDeal(previous => ({ ...previous, title: event.target.value }))} />
            <select className={inputClass} value={newDeal.pipelineId} onChange={event => setNewDeal(previous => ({ ...previous, pipelineId: event.target.value }))}>{pipelines.map(pipeline => <option key={pipeline.id} value={pipeline.id}>{pipeline.name}</option>)}</select>
            <input className={inputClass} type="number" min="0" placeholder="Сумма" value={newDeal.amount} onChange={event => setNewDeal(previous => ({ ...previous, amount: event.target.value }))} />
            <input className={inputClass} type="date" value={newDeal.expectedCloseDate} onChange={event => setNewDeal(previous => ({ ...previous, expectedCloseDate: event.target.value }))} />
          </div>
          <button type="button" onClick={createDeal} disabled={saving} className="mt-4 rounded-xl bg-[#1E325C] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Создание...' : 'Создать сделку'}</button>
        </div>
      )}

      {showPipelineSettings && editingPipeline && (
        <div className="rounded-2xl border border-[#C7D4E5] bg-[#F8FAFC] p-5">
          <div className="flex items-center justify-between"><div><h4 className="font-bold text-[#10264B]">Настройка воронки</h4><p className="mt-1 text-xs text-[#71829D]">Название и количество этапов применяются ко всем сделкам workspace.</p></div><button onClick={() => setShowPipelineSettings(false)}><X size={17} /></button></div>
          <input className={`${inputClass} mt-4`} value={pipelineName} onChange={event => setPipelineName(event.target.value)} placeholder="Название воронки" />
          <button type="button" onClick={applyAdmissionTemplate} className="mt-3 rounded-xl border border-[#C9D7EA] bg-white px-4 py-2 text-sm font-semibold text-[#3157DE]">
            Применить шаблон «Поступление / Виза»
          </button>
          <div className="mt-4 space-y-2">
            {draftStages.map((stage, index) => (
              <div key={stage.id} className="grid grid-cols-[32px_1fr_92px_120px_40px] items-center gap-2 rounded-xl border border-[#E3EAF2] bg-white p-2">
                <input type="color" value={stage.color} onChange={event => setDraftStages(previous => previous.map(item => item.id === stage.id ? { ...item, color: event.target.value } : item))} className="h-8 w-8 border-0 bg-transparent" />
                <input className={inputClass} value={stage.name} onChange={event => setDraftStages(previous => previous.map(item => item.id === stage.id ? { ...item, name: event.target.value } : item))} />
                <input className={inputClass} type="number" min="0" max="100" value={stage.probability} onChange={event => setDraftStages(previous => previous.map(item => item.id === stage.id ? { ...item, probability: Number(event.target.value) } : item))} />
                <select className={inputClass} value={stage.outcome} onChange={event => setDraftStages(previous => previous.map(item => item.id === stage.id ? { ...item, outcome: event.target.value as Stage['outcome'] } : item))}><option value="open">В работе</option><option value="won">Успех</option><option value="lost">Отказ</option></select>
                <button type="button" onClick={() => removeDraftStage(stage)} className="grid h-9 w-9 place-items-center rounded-lg text-[#DC2626]"><Trash2 size={15} /></button>
                <div className="col-span-5 flex justify-end gap-1"><button type="button" onClick={() => moveDraftStage(index, -1)} disabled={index === 0} className="rounded-lg border p-1.5 disabled:opacity-30"><ArrowUp size={13} /></button><button type="button" onClick={() => moveDraftStage(index, 1)} disabled={index === draftStages.length - 1} className="rounded-lg border p-1.5 disabled:opacity-30"><ArrowDown size={13} /></button></div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => setDraftStages(previous => [...previous, { id: `new-${crypto.randomUUID()}`, pipeline_id: editingPipeline.id, name: `Новый этап ${previous.length + 1}`, probability: Math.min(95, (previous.at(-1)?.probability ?? 0) + 10), outcome: 'open', sort_order: (previous.length + 1) * 10, color: stagePalette[previous.length % stagePalette.length] }])} className="rounded-xl border border-[#DDE5EF] bg-white px-4 py-2 text-sm font-semibold text-[#52657F]"><Plus size={15} className="mr-1 inline" /> Добавить этап</button>
            <button type="button" onClick={savePipeline} disabled={saving} className="rounded-xl bg-[#1E325C] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? <Loader2 size={15} className="mr-1 inline animate-spin" /> : <Check size={15} className="mr-1 inline" />} Сохранить воронку</button>
          </div>
        </div>
      )}
    </div>
  );
}
