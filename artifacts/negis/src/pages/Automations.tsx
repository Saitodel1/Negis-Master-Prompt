import { FormEvent, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import {
  Activity, Bot, CheckCircle2, ChevronRight, Clock3, FileText, Gauge,
  Lightbulb, Play, Plus, RefreshCw, Settings2, ShieldCheck, Sparkles, X,
} from 'lucide-react';
import { PageLayout } from '@/components/layout/PageLayout';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

type Provider = 'deepseek' | 'anthropic' | 'openai';
type AiJobType = 'lead_summary' | 'next_best_action' | 'conversation_reply' | 'call_analysis' | 'automation_recommendation';

interface AutomationRule {
  id: string;
  clinic_id: string;
  rule_key: string;
  name: string;
  description: string;
  trigger_type: string;
  conditions: Record<string, unknown>;
  actions: Array<{ type: string }>;
  is_enabled: boolean;
  created_at: string;
}

interface AutomationRun {
  id: string;
  rule_id: string | null;
  status: string;
  created_at: string;
  error_message: string | null;
}

interface IntegrationConnection {
  id: string;
  provider: string;
  category: string;
  status: string;
  display_name: string | null;
  last_checked_at: string | null;
  last_error: string | null;
}

interface ActivityEvent {
  id: string;
  lead_id: string | null;
  event_type: string;
  title: string;
  occurred_at: string;
}

interface AiJob {
  id: string;
  provider: Provider;
  job_type: AiJobType;
  status: string;
  output: { summary?: string; insights?: string[]; recommended_actions?: Array<{ title?: string; reason?: string; priority?: string }> };
  error_message: string | null;
  created_at: string;
}

const DEFAULT_RULES = [
  {
    rule_key: 'lead_no_response_15m',
    name: 'Лид без ответа 15 минут',
    description: 'Напомнить ответственному и руководителю, если новый лид остался без активности.',
    trigger_type: 'lead.created',
    conditions: { after_minutes: 15 },
    actions: [{ type: 'notify_assignee' }, { type: 'notify_manager' }],
  },
  {
    rule_key: 'task_overdue',
    name: 'Просроченная задача',
    description: 'Оповестить исполнителя и руководителя, когда срок задачи прошёл.',
    trigger_type: 'task.overdue',
    conditions: {},
    actions: [{ type: 'notify_assignee' }, { type: 'notify_manager' }],
  },
  {
    rule_key: 'daily_summary',
    name: 'Ежедневный отчёт',
    description: 'Собрать лиды, записи, приходы, оплаты и просроченные задачи за день.',
    trigger_type: 'schedule.daily',
    conditions: { hour: 20, timezone: 'clinic' },
    actions: [{ type: 'build_report' }, { type: 'send_email' }],
  },
  {
    rule_key: 'agent_overload',
    name: 'Перегрузка сотрудника',
    description: 'Предупредить руководителя, когда у сотрудника слишком много необработанных лидов.',
    trigger_type: 'lead.assigned',
    conditions: { open_leads_gte: 25 },
    actions: [{ type: 'notify_manager' }],
  },
  {
    rule_key: 'funnel_drop',
    name: 'Лиды не доходят до записи',
    description: 'Подсветить рекламный канал с лидами и низкой конверсией в запись.',
    trigger_type: 'metrics.daily',
    conditions: { min_leads: 10, booking_conversion_lte: 0.1 },
    actions: [{ type: 'notify_manager' }, { type: 'create_report_item' }],
  },
];

const AI_WORKFLOWS: Array<{ id: AiJobType; title: string; description: string; prompt: string }> = [
  {
    id: 'lead_summary',
    title: 'Сводка по клиенту',
    description: 'Собирает историю, обращения, оплаты, задачи и следующий шаг.',
    prompt: 'Суммируй историю клиента. Выдели потребность, возражения, оплаты, незавершённые задачи и безопасный следующий шаг.',
  },
  {
    id: 'next_best_action',
    title: 'Следующее действие',
    description: 'Предлагает один конкретный шаг для ответственного сотрудника.',
    prompt: 'Предложи следующий лучший шаг с причиной, приоритетом и рекомендуемым сроком. Не меняй данные сам.',
  },
  {
    id: 'conversation_reply',
    title: 'Черновик ответа',
    description: 'Готовит короткий ответ в переписку, но не отправляет его.',
    prompt: 'Подготовь уважительный краткий ответ на языке клиента. Не обещай того, чего нет в контексте.',
  },
  {
    id: 'call_analysis',
    title: 'Анализ звонка',
    description: 'Извлекает намерение, возражения, договорённости и задачу.',
    prompt: 'Проанализируй расшифровку звонка без выдумывания деталей. Верни договорённости и задачу для человека.',
  },
  {
    id: 'automation_recommendation',
    title: 'Идея автоматизации',
    description: 'Предлагает правило, но всегда оставляет его на подтверждении владельцу.',
    prompt: 'Предложи триггер, условия, действие, риски и обязательное подтверждение сотрудником.',
  },
];

const PROVIDERS: Array<{ id: Provider; name: string; detail: string; env: string }> = [
  { id: 'deepseek', name: 'DeepSeek', detail: 'Экономичный режим для сводок и черновиков.', env: 'DEEPSEEK_API_KEY' },
  { id: 'anthropic', name: 'Claude', detail: 'Сложные сводки, анализ и бережная работа с контекстом.', env: 'ANTHROPIC_API_KEY' },
  { id: 'openai', name: 'OpenAI', detail: 'Универсальный провайдер для AI-модулей.', env: 'OPENAI_API_KEY' },
];

const statusStyle: Record<string, string> = {
  connected: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  succeeded: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  awaiting_confirmation: 'bg-amber-50 text-amber-700 border-amber-200',
  running: 'bg-blue-50 text-blue-700 border-blue-200',
  queued: 'bg-slate-50 text-slate-600 border-slate-200',
  failed: 'bg-rose-50 text-rose-700 border-rose-200',
  error: 'bg-rose-50 text-rose-700 border-rose-200',
  not_connected: 'bg-slate-50 text-slate-500 border-slate-200',
};

function labelForStatus(status: string) {
  return ({
    connected: 'Подключено', not_connected: 'Не подключено', pending: 'Ожидает', disabled: 'Выключено',
    queued: 'В очереди', running: 'В работе', succeeded: 'Готово', awaiting_confirmation: 'Ждёт подтверждения',
    skipped: 'Пропущено', failed: 'Ошибка', error: 'Ошибка',
  } as Record<string, string>)[status] || status;
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function Automations() {
  const [, setLocation] = useLocation();
  const { clinicId, userRole } = useAuth();
  const canManage = userRole === 'owner' || userRole === 'manager';
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AutomationRule | null>(null);
  const [ruleModal, setRuleModal] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState<AiJobType>('lead_summary');
  const [provider, setProvider] = useState<Provider>('deepseek');
  const [contextText, setContextText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [latestResult, setLatestResult] = useState<AiJob['output'] | null>(null);

  const load = async () => {
    if (!clinicId) return;
    setLoading(true);
    const [rulesRes, runsRes, connectionsRes, eventsRes, jobsRes] = await Promise.all([
      supabase.from('automation_rules').select('*').eq('clinic_id', clinicId).order('created_at'),
      supabase.from('automation_runs').select('id, rule_id, status, created_at, error_message').eq('clinic_id', clinicId).order('created_at', { ascending: false }).limit(8),
      supabase.from('integration_connections').select('id, provider, category, status, display_name, last_checked_at, last_error').eq('clinic_id', clinicId).order('updated_at', { ascending: false }),
      supabase.from('activity_events').select('id, lead_id, event_type, title, occurred_at').eq('clinic_id', clinicId).order('occurred_at', { ascending: false }).limit(8),
      supabase.from('ai_jobs').select('id, provider, job_type, status, output, error_message, created_at').eq('clinic_id', clinicId).order('created_at', { ascending: false }).limit(8),
    ]);
    if (rulesRes.error) toast.error('Выполните SQL migration 011 для автоматизаций.');
    setRules((rulesRes.data || []) as AutomationRule[]);
    setRuns((runsRes.data || []) as AutomationRun[]);
    setConnections((connectionsRes.data || []) as IntegrationConnection[]);
    setEvents((eventsRes.data || []) as ActivityEvent[]);
    setJobs((jobsRes.data || []) as AiJob[]);
    setLoading(false);
  };

  useEffect(() => { void load(); }, [clinicId]);

  const displayedRules = useMemo(() => {
    const existing = new Map(rules.map(rule => [rule.rule_key, rule]));
    return DEFAULT_RULES.map(template => existing.get(template.rule_key) || ({ ...template, id: '', clinic_id: clinicId || '', is_enabled: true, created_at: '' } as AutomationRule))
      .concat(rules.filter(rule => !DEFAULT_RULES.some(template => template.rule_key === rule.rule_key)));
  }, [clinicId, rules]);

  const toggleRule = async (rule: AutomationRule): Promise<void> => {
    if (!clinicId || !canManage) return;
    const nextEnabled = !rule.is_enabled;
    if (!rule.id) {
      const { id: _id, created_at: _createdAt, ...template } = rule;
      const { error } = await supabase.from('automation_rules').insert({ ...template, clinic_id: clinicId, is_enabled: nextEnabled });
      if (error) { toast.error(error.message); return; }
    } else {
      const { error } = await supabase.from('automation_rules').update({ is_enabled: nextEnabled, updated_at: new Date().toISOString() }).eq('id', rule.id);
      if (error) { toast.error(error.message); return; }
    }
    toast.success(nextEnabled ? 'Автоматизация включена' : 'Автоматизация выключена');
    void load();
  };

  const runAi = async () => {
    if (!clinicId) return;
    setAiLoading(true);
    setLatestResult(null);
    const workflow = AI_WORKFLOWS.find(item => item.id === selectedWorkflow)!;
    const { data, error } = await supabase.functions.invoke('ai-run', {
      body: {
        clinicId,
        provider,
        jobType: selectedWorkflow,
        input: { prompt_intent: workflow.prompt, user_context: contextText.trim() || 'No additional context provided.' },
      },
    });
    setAiLoading(false);
    if (error || data?.error) {
      toast.error(data?.error || error?.message || 'AI-сервис не ответил');
      void load();
      return;
    }
    setLatestResult(data.output || null);
    toast.success('AI подготовил результат. Применение остаётся за человеком.');
    void load();
  };

  return (
    <PageLayout>
      <div className="mx-auto max-w-[1500px] space-y-6">
        <section className="rounded-[26px] bg-[linear-gradient(90deg,#182A4B_0%,#1E2F58_45%,#2A3175_100%)] px-9 py-7 shadow-[0_10px_40px_rgba(15,23,42,.08)]">
          <h1 className="text-4xl font-bold tracking-[-0.04em] text-white">Автоматизации</h1>
          <p className="mt-3 text-[17px] leading-7 text-white/80">Правила, события, отчёты и AI-подсказки. Система предлагает действие, человек принимает решение.</p>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rounded-[22px] border border-[#E4EBF4] bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,.04)]">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div><h2 className="font-semibold text-[#10264B]">Правила по умолчанию</h2><p className="mt-1 text-sm text-[#71829D]">Можно включить, выключить или доработать под процесс бизнеса.</p></div>
              {canManage && <button onClick={() => { setEditing(null); setRuleModal(true); }} className="inline-flex items-center gap-2 rounded-xl bg-[#3157DE] px-3.5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#274AC2]"><Plus size={16} />Новое правило</button>}
            </div>
            <div className="space-y-3">
              {displayedRules.map(rule => <RuleRow key={rule.rule_key} rule={rule} editable={canManage} onToggle={toggleRule} onEdit={() => { setEditing(rule); setRuleModal(true); }} />)}
            </div>
          </div>

          <aside className="rounded-[22px] border border-[#E4EBF4] bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,.04)]">
            <div className="flex items-center gap-2"><Activity size={18} className="text-[#3157DE]" /><h2 className="font-semibold text-[#10264B]">Последние события</h2></div>
            <div className="mt-4 space-y-3">
              {events.length ? events.map(event => <div key={event.id} className="rounded-xl border border-[#EDF1F7] p-3"><p className="text-sm font-medium text-[#243B63]">{event.title}</p><p className="mt-1 text-xs text-[#8A9AB2]">{formatDate(event.occurred_at)} · {event.event_type}</p></div>) : <Empty label="События появятся после изменения статусов и запуска правил." />}
            </div>
          </aside>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rounded-[22px] border border-[#E4EBF4] bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,.04)]">
            <div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold text-[#10264B]">AI-режимы</h2><p className="mt-1 text-sm text-[#71829D]">Все ответы записываются в журнал и ждут подтверждения сотрудника.</p></div><span className="rounded-full bg-[#EEF4FF] px-3 py-1 text-xs font-semibold text-[#3157DE]">Ключи только на сервере</span></div>
            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {AI_WORKFLOWS.map(workflow => <button key={workflow.id} type="button" onClick={() => setSelectedWorkflow(workflow.id)} className={`rounded-2xl border p-4 text-left transition ${selectedWorkflow === workflow.id ? 'border-[#8BA7FF] bg-[#F4F7FF] shadow-sm' : 'border-[#E7ECF3] bg-white hover:border-[#C7D5F8]'}`}><Sparkles size={17} className="text-[#3157DE]" /><p className="mt-3 font-semibold text-[#10264B]">{workflow.title}</p><p className="mt-1 text-xs leading-5 text-[#71829D]">{workflow.description}</p></button>)}
            </div>
            <div className="mt-5 rounded-2xl border border-[#E7ECF3] bg-[#FAFBFE] p-4">
              <label className="text-sm font-semibold text-[#334A6A]">Контекст для теста</label>
              <textarea value={contextText} onChange={event => setContextText(event.target.value)} className="mt-2 min-h-28 w-full rounded-xl border border-[#DDE6F1] bg-white p-3 text-sm text-[#263B5B] outline-none transition focus:border-[#7F9BFF]" placeholder="Вставьте обезличенный фрагмент переписки или описание ситуации. Не вставляйте лишние персональные данные." />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex gap-2">{PROVIDERS.map(item => <button key={item.id} type="button" onClick={() => setProvider(item.id)} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${provider === item.id ? 'border-[#8BA7FF] bg-[#EEF4FF] text-[#3157DE]' : 'border-[#E1E8F1] bg-white text-[#607089]'}`}>{item.name}</button>)}</div>
                <button onClick={runAi} disabled={aiLoading} className="inline-flex items-center gap-2 rounded-xl bg-[#3157DE] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"><Play size={15} />{aiLoading ? 'Анализ...' : 'Проверить через сервер'}</button>
              </div>
            </div>
            {latestResult && <AiResult output={latestResult} />}
          </div>

          <aside className="rounded-[22px] border border-[#E4EBF4] bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,.04)]">
            <div className="flex items-center gap-2"><ShieldCheck size={18} className="text-[#3157DE]" /><h2 className="font-semibold text-[#10264B]">Провайдеры AI</h2></div>
            <div className="mt-4 space-y-3">{PROVIDERS.map(item => <div key={item.id} className="rounded-xl border border-[#EDF1F7] p-3"><div className="flex items-center justify-between"><p className="font-medium text-[#243B63]">{item.name}</p><span className="text-xs text-[#71829D]">server-only</span></div><p className="mt-1 text-xs leading-5 text-[#71829D]">{item.detail}</p><code className="mt-2 block text-[11px] text-[#3157DE]">{item.env}</code></div>)}</div>
          </aside>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <Panel title="Подключения" icon={Settings2} action={<button onClick={() => setLocation('/marketplace')} className="text-sm font-semibold text-[#3157DE]">Открыть Маркет</button>}>
            {connections.length ? connections.map(connection => <div key={connection.id} className="flex items-center justify-between gap-3 border-b border-[#F0F3F8] py-3 last:border-0"><div><p className="font-medium text-[#243B63]">{connection.display_name || connection.provider}</p><p className="mt-1 text-xs text-[#8A9AB2]">{connection.category} · проверка: {formatDate(connection.last_checked_at)}</p></div><StatusPill status={connection.status} /></div>) : <Empty label="Подключений пока нет. Карточки Маркета сами по себе не являются интеграциями." />}
          </Panel>
          <Panel title="Журнал запусков" icon={Clock3} action={<button onClick={() => void load()} className="inline-flex items-center gap-1 text-sm font-semibold text-[#3157DE]"><RefreshCw size={14} />Обновить</button>}>
            {runs.length ? runs.map(run => <div key={run.id} className="flex items-center justify-between gap-3 border-b border-[#F0F3F8] py-3 last:border-0"><div><p className="text-sm font-medium text-[#243B63]">{rules.find(rule => rule.id === run.rule_id)?.name || 'Системное правило'}</p><p className="mt-1 text-xs text-[#8A9AB2]">{formatDate(run.created_at)}{run.error_message ? ` · ${run.error_message}` : ''}</p></div><StatusPill status={run.status} /></div>) : <Empty label={loading ? 'Загрузка...' : 'Запусков ещё не было. После включения нужен серверный планировщик.'} />}
          </Panel>
        </section>

        <section className="rounded-[22px] border border-[#DCE6F5] bg-[#F8FAFF] p-5">
          <div className="flex gap-3"><Lightbulb className="mt-0.5 text-[#3157DE]" size={18} /><div><h2 className="font-semibold text-[#10264B]">Что уже безопасно заложено</h2><p className="mt-1 text-sm leading-6 text-[#52657F]">Статусы записывают события воронки и вероятность; правила и подключения разделены по организациям; ключи и токены не попадают в браузер. Чтобы правила начали срабатывать по времени, следующий серверный шаг — запланированный обработчик очереди.</p></div></div>
        </section>
      </div>

      {ruleModal && <RuleModal rule={editing} clinicId={clinicId} onClose={() => setRuleModal(false)} onSaved={() => { setRuleModal(false); void load(); }} />}
    </PageLayout>
  );
}

function RuleRow({ rule, editable, onToggle, onEdit }: { rule: AutomationRule; editable: boolean; onToggle: (rule: AutomationRule) => void; onEdit: () => void }) {
  const trigger = rule.trigger_type.replace('.', ' · ');
  return <div className="flex flex-col gap-3 rounded-2xl border border-[#E7ECF3] p-4 md:flex-row md:items-center"><div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${rule.is_enabled ? 'bg-[#EEF4FF] text-[#3157DE]' : 'bg-[#F3F5F8] text-[#8A9AB2]'}`}><Gauge size={18} /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="font-semibold text-[#10264B]">{rule.name}</p>{rule.is_enabled && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Включено</span>}</div><p className="mt-1 text-sm text-[#71829D]">{rule.description}</p><p className="mt-2 text-xs text-[#8A9AB2]">Триггер: {trigger}</p></div><div className="flex items-center gap-2">{editable && <button onClick={onEdit} className="rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm font-medium text-[#52657F]">Настроить</button>}<button disabled={!editable} onClick={() => onToggle(rule)} className={`relative h-7 w-12 rounded-full transition ${rule.is_enabled ? 'bg-[#3157DE]' : 'bg-[#CBD5E1]'}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition ${rule.is_enabled ? 'left-6' : 'left-1'}`} /></button></div></div>;
}

function RuleModal({ rule, clinicId, onClose, onSaved }: { rule: AutomationRule | null; clinicId: string | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(rule?.name || '');
  const [description, setDescription] = useState(rule?.description || '');
  const [trigger, setTrigger] = useState(rule?.trigger_type || 'lead.created');
  const [saving, setSaving] = useState(false);
  const save = async (event: FormEvent): Promise<void> => { event.preventDefault(); if (!clinicId || !name.trim()) return; setSaving(true); const payload = { clinic_id: clinicId, rule_key: rule?.rule_key || `custom_${crypto.randomUUID()}`, name: name.trim(), description: description.trim(), trigger_type: trigger, conditions: rule?.conditions || {}, actions: rule?.actions || [{ type: 'notify_manager' }], is_enabled: rule?.is_enabled ?? true, updated_at: new Date().toISOString() }; const query = rule?.id ? supabase.from('automation_rules').update(payload).eq('id', rule.id) : supabase.from('automation_rules').insert(payload); const { error } = await query; setSaving(false); if (error) { toast.error(error.message); return; } toast.success('Правило сохранено'); onSaved(); };
  return <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/30 p-4" onClick={event => { if (event.target === event.currentTarget) onClose(); }}><form onSubmit={save} className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-2xl"><div className="flex items-center justify-between"><div><h2 className="text-xl font-semibold text-[#10264B]">{rule ? 'Настроить правило' : 'Новое правило'}</h2><p className="mt-1 text-sm text-[#71829D]">Действие всегда остаётся под контролем сотрудников.</p></div><button type="button" onClick={onClose} className="rounded-lg border border-[#E2E8F0] p-2 text-[#64748B]"><X size={17} /></button></div><div className="mt-5 space-y-4"><label className="block text-sm font-medium text-[#334A6A]">Название<input value={name} onChange={event => setName(event.target.value)} className="mt-2 w-full rounded-xl border border-[#DDE6F1] px-3 py-2.5 outline-none focus:border-[#8BA7FF]" /></label><label className="block text-sm font-medium text-[#334A6A]">Описание<textarea value={description} onChange={event => setDescription(event.target.value)} className="mt-2 min-h-24 w-full rounded-xl border border-[#DDE6F1] p-3 outline-none focus:border-[#8BA7FF]" /></label><label className="block text-sm font-medium text-[#334A6A]">Триггер<select value={trigger} onChange={event => setTrigger(event.target.value)} className="mt-2 w-full rounded-xl border border-[#DDE6F1] bg-white px-3 py-2.5"><option value="lead.created">Создан лид</option><option value="lead.assigned">Назначен ответственный</option><option value="task.overdue">Задача просрочена</option><option value="schedule.daily">Ежедневно по расписанию</option><option value="metrics.daily">Дневные метрики</option></select></label></div><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-xl border border-[#E2E8F0] px-4 py-2.5 text-sm font-medium text-[#52657F]">Отмена</button><button disabled={saving} className="rounded-xl bg-[#3157DE] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{saving ? 'Сохранение...' : 'Сохранить'}</button></div></form></div>;
}

function Panel({ title, icon: Icon, action, children }: { title: string; icon: ComponentType<{ size?: number; className?: string }>; action?: ReactNode; children: ReactNode }) { return <section className="rounded-[22px] border border-[#E4EBF4] bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,.04)]"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Icon size={18} className="text-[#3157DE]" /><h2 className="font-semibold text-[#10264B]">{title}</h2></div>{action}</div><div className="mt-4">{children}</div></section>; }
function StatusPill({ status }: { status: string }) { return <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${statusStyle[status] || 'border-slate-200 bg-slate-50 text-slate-600'}`}>{labelForStatus(status)}</span>; }
function Empty({ label }: { label: string }) { return <p className="rounded-xl border border-dashed border-[#DDE6F1] px-4 py-6 text-center text-sm leading-6 text-[#8A9AB2]">{label}</p>; }
function AiResult({ output }: { output: NonNullable<AiJob['output']> }) { return <div className="mt-5 rounded-2xl border border-[#CFE0FF] bg-[#F6F9FF] p-4"><div className="flex items-center gap-2"><CheckCircle2 size={17} className="text-[#3157DE]" /><p className="font-semibold text-[#10264B]">Результат ждёт подтверждения</p></div><p className="mt-3 text-sm leading-6 text-[#334A6A]">{output.summary || 'AI не вернул сводку.'}</p>{Boolean(output.insights?.length) && <ul className="mt-3 space-y-1 text-sm text-[#52657F]">{output.insights!.map((item, index) => <li key={`${item}-${index}`}>• {item}</li>)}</ul>}{Boolean(output.recommended_actions?.length) && <div className="mt-4 space-y-2">{output.recommended_actions!.map((item, index) => <div key={`${item.title}-${index}`} className="rounded-xl bg-white p-3"><p className="text-sm font-semibold text-[#243B63]">{item.title}</p><p className="mt-1 text-xs text-[#71829D]">{item.reason}</p></div>)}</div>}</div>; }
