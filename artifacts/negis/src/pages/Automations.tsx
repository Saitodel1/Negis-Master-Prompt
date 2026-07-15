import { FormEvent, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import {
  Activity, Gauge, Pencil, Plus, RefreshCw, Save, Trash2, X,
} from 'lucide-react';
import { PageLayout } from '@/components/layout/PageLayout';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

type ExecutionMode = 'manual' | 'automatic';

interface ConditionRow {
  field: string;
  operator: string;
  value: string;
}

interface ActionRow {
  type: string;
  config: Record<string, unknown>;
}

interface ActionDraft {
  type: string;
  target: string;
  value: string;
}

interface AgentOption {
  id: string;
  name: string;
}

interface DealStageOption {
  code: string;
  name: string;
  probability: number;
}

interface AutomationRule {
  id: string;
  clinic_id: string;
  rule_key: string;
  name: string;
  description: string;
  trigger_type: string;
  conditions: ConditionRow[] | Record<string, unknown>;
  actions: ActionRow[] | Array<{ type: string }>;
  execution_mode?: ExecutionMode;
  is_enabled: boolean;
  created_at: string;
  updated_at?: string;
}

interface AutomationRun {
  id: string;
  rule_id: string | null;
  status: string;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
}

const TRIGGERS = [
  { value: 'lead.created', label: 'Лид создан' },
  { value: 'contact.created', label: 'Контакт создан' },
  { value: 'deal.stage_changed', label: 'Сделка сменила этап' },
  { value: 'invoice.overdue', label: 'Счет просрочен' },
  { value: 'payment.received', label: 'Оплата получена' },
  { value: 'task.overdue', label: 'Задача просрочена' },
  { value: 'schedule.daily', label: 'Ежедневное расписание' },
] as const;

const ACTIONS = [
  { value: 'notify_user', label: 'Уведомить пользователя' },
  { value: 'assign_owner', label: 'Назначить ответственного' },
  { value: 'create_task', label: 'Создать задачу' },
  { value: 'update_stage', label: 'Обновить этап' },
  { value: 'create_invoice', label: 'Создать счет' },
] as const;

const OPERATORS = ['equals', 'not_equals', 'contains', 'greater_than', 'less_than', 'is_empty', 'is_not_empty'];

const CONDITION_FIELDS = [
  { value: 'source', label: 'Источник' },
  { value: 'status', label: 'Статус' },
  { value: 'stage', label: 'Этап' },
  { value: 'amount', label: 'Сумма' },
  { value: 'owner_id', label: 'Ответственный' },
  { value: 'created_at', label: 'Дата создания' },
  { value: 'custom', label: 'Другое поле' },
] as const;

const OPERATOR_LABELS: Record<string, string> = {
  equals: 'Равно',
  not_equals: 'Не равно',
  contains: 'Содержит',
  greater_than: 'Больше',
  less_than: 'Меньше',
  is_empty: 'Пусто',
  is_not_empty: 'Заполнено',
};

const DEFAULT_CONDITION: ConditionRow = { field: '', operator: 'equals', value: '' };
const DEFAULT_ACTION: ActionRow = { type: 'notify_user', config: {} };

const statusStyle: Record<string, string> = {
  succeeded: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  running: 'bg-blue-50 text-blue-700 border-blue-200',
  queued: 'bg-slate-50 text-slate-600 border-slate-200',
  skipped: 'bg-amber-50 text-amber-700 border-amber-200',
  failed: 'bg-rose-50 text-rose-700 border-rose-200',
  error: 'bg-rose-50 text-rose-700 border-rose-200',
};

function labelForStatus(status: string) {
  return ({
    queued: 'В очереди',
    running: 'В работе',
    succeeded: 'Сработало',
    skipped: 'Пропущено',
    failed: 'Ошибка',
    error: 'Ошибка',
  } as Record<string, string>)[status] || status;
}

function triggerLabel(value: string) {
  return TRIGGERS.find(item => item.value === value)?.label || value;
}

function actionLabel(value: string) {
  return ACTIONS.find(item => item.value === value)?.label || value;
}

function fieldLabel(value: string) {
  return CONDITION_FIELDS.find(item => item.value === value)?.label || value;
}

function operatorLabel(value: string) {
  return OPERATOR_LABELS[value] || value;
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function normalizeConditions(value: AutomationRule['conditions'] | null | undefined): ConditionRow[] {
  if (Array.isArray(value)) {
    return value.map(item => ({
      field: String((item as Partial<ConditionRow>).field || ''),
      operator: String((item as Partial<ConditionRow>).operator || 'equals'),
      value: String((item as Partial<ConditionRow>).value ?? ''),
    }));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).map(([field, conditionValue]) => ({
      field,
      operator: 'equals',
      value: String(conditionValue ?? ''),
    }));
  }
  return [];
}

function normalizeActions(value: AutomationRule['actions'] | null | undefined): ActionRow[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => ({
    type: String(item.type || 'notify_user'),
    config: 'config' in item && item.config && typeof item.config === 'object' && !Array.isArray(item.config)
      ? item.config as Record<string, unknown>
      : {},
  }));
}

function configValue(config: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = config[key];
    if (value !== undefined && value !== null) return String(value);
  }
  return '';
}

function normalizeActionDraft(action: ActionRow): ActionDraft {
  return {
    type: action.type,
    target: configValue(action.config, ['target', 'user_id', 'owner_id', 'stage', 'url']),
    value: configValue(action.config, ['value', 'message', 'title', 'note', 'amount']),
  };
}

function buildActionConfig(action: ActionDraft): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  const target = action.target.trim();
  const value = action.value.trim();
  if (target) config.target = target;
  if (value) {
    config.value = value;
    if (action.type === 'notify_user') config.message = value;
    if (action.type === 'create_task') config.title = value;
  }
  return config;
}

export default function Automations() {
  const { clinicId, userRole } = useAuth();
  const canManage = userRole === 'owner' || userRole === 'manager';
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AutomationRule | null>(null);
  const [ruleModal, setRuleModal] = useState(false);

  const load = async () => {
    if (!clinicId) return;
    setLoading(true);
    setError(null);

    const [rulesRes, runsRes] = await Promise.all([
      supabase.from('automation_rules').select('*').eq('clinic_id', clinicId).order('created_at', { ascending: false }),
      supabase
        .from('automation_runs')
        .select('id, rule_id, status, created_at, completed_at, error_message')
        .eq('clinic_id', clinicId)
        .order('created_at', { ascending: false })
        .limit(12),
    ]);

    if (rulesRes.error || runsRes.error) {
      const message = rulesRes.error?.message || runsRes.error?.message || 'Не удалось загрузить автоматизации';
      setError(message);
      toast.error(message);
    }

    setRules((rulesRes.data || []) as AutomationRule[]);
    setRuns((runsRes.data || []) as AutomationRun[]);
    setLoading(false);
  };

  useEffect(() => { void load(); }, [clinicId]);

  const runRuleNames = useMemo(() => new Map(rules.map(rule => [rule.id, rule.name])), [rules]);

  const toggleRule = async (rule: AutomationRule): Promise<void> => {
    if (!clinicId || !canManage) return;
    const nextEnabled = !rule.is_enabled;
    const { error: updateError } = await supabase
      .from('automation_rules')
      .update({ is_enabled: nextEnabled, updated_at: new Date().toISOString() })
      .eq('id', rule.id)
      .eq('clinic_id', clinicId);

    if (updateError) {
      toast.error(updateError.message);
      return;
    }

    setRules(current => current.map(item => item.id === rule.id ? { ...item, is_enabled: nextEnabled } : item));
    toast.success(nextEnabled ? 'Правило включено' : 'Правило выключено');
  };

  const deleteRule = async (rule: AutomationRule): Promise<void> => {
    if (!clinicId || !canManage) return;
    const { error: deleteError } = await supabase
      .from('automation_rules')
      .delete()
      .eq('id', rule.id)
      .eq('clinic_id', clinicId);

    if (deleteError) {
      toast.error(deleteError.message);
      return;
    }

    setRules(current => current.filter(item => item.id !== rule.id));
    toast.success('Правило удалено');
  };

  return (
    <PageLayout>
      <div className="mx-auto max-w-[1500px] space-y-6">
        <section className="rounded-[26px] bg-[linear-gradient(90deg,#182A4B_0%,#1E2F58_45%,#2A3175_100%)] px-9 py-7 shadow-[0_10px_40px_rgba(15,23,42,.08)]">
          <h1 className="text-4xl font-bold tracking-[-0.04em] text-white">Автоматизации</h1>
          <p className="mt-3 text-[17px] leading-7 text-white/80">
            Собирайте правила из триггеров, условий и действий. Рабочий конструктор без серверной кухни.
          </p>
        </section>

        {error && (
          <section className="rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </section>
        )}

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
          <div className="rounded-[22px] border border-[#E4EBF4] bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,.04)]">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-[#10264B]">Правила автоматизации</h2>
                <p className="mt-1 text-sm text-[#71829D]">Выберите событие, добавьте фильтры и задайте, что система сделает сама.</p>
              </div>
              {canManage && (
                <button
                  onClick={() => { setEditing(null); setRuleModal(true); }}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#3157DE] px-3.5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#274AC2]"
                >
                  <Plus size={16} />Новое правило
                </button>
              )}
            </div>

            <div className="space-y-3">
              {loading ? (
                <Empty label="Загрузка правил..." />
              ) : rules.length ? (
                rules.map(rule => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    editable={canManage}
                    onToggle={toggleRule}
                    onEdit={() => { setEditing(rule); setRuleModal(true); }}
                    onDelete={() => void deleteRule(rule)}
                  />
                ))
              ) : (
                <Empty label="Правил пока нет. Создайте первое, иначе все снова поедет вручную." />
              )}
            </div>
          </div>

          <Panel
            title="История срабатываний"
            icon={Activity}
            action={<button onClick={() => void load()} className="inline-flex items-center gap-1 text-sm font-semibold text-[#3157DE]"><RefreshCw size={14} />Обновить</button>}
          >
            {loading ? (
              <Empty label="Загрузка истории..." />
            ) : runs.length ? (
              <div className="space-y-3">
                {runs.map(run => (
                  <div key={run.id} className="rounded-xl border border-[#EDF1F7] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-[#243B63]">{run.rule_id ? runRuleNames.get(run.rule_id) || 'Удаленное правило' : 'Системное правило'}</p>
                        <p className="mt-1 text-xs text-[#8A9AB2]">
                          {formatDate(run.completed_at || run.created_at)}
                        </p>
                      </div>
                      <StatusPill status={run.status} />
                    </div>
                    {run.error_message && <p className="mt-2 text-xs leading-5 text-rose-600">Нужно проверить правило.</p>}
                  </div>
                ))}
              </div>
            ) : (
              <Empty label="История появится после первого срабатывания правила." />
            )}
          </Panel>
        </section>
      </div>

      {ruleModal && (
        <RuleModal
          rule={editing}
          clinicId={clinicId}
          onClose={() => setRuleModal(false)}
          onSaved={() => { setRuleModal(false); void load(); }}
        />
      )}
    </PageLayout>
  );
}

function RuleRow({
  rule,
  editable,
  onToggle,
  onEdit,
  onDelete,
}: {
  rule: AutomationRule;
  editable: boolean;
  onToggle: (rule: AutomationRule) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const conditions = normalizeConditions(rule.conditions);
  const actions = normalizeActions(rule.actions);

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-[#E7ECF3] p-4 md:flex-row md:items-center">
      <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${rule.is_enabled ? 'bg-[#EEF4FF] text-[#3157DE]' : 'bg-[#F3F5F8] text-[#8A9AB2]'}`}>
        <Gauge size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-[#10264B]">{rule.name}</p>
          {rule.is_enabled && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Включено</span>}
          <span className="rounded-full bg-[#EEF4FF] px-2 py-0.5 text-[10px] font-semibold text-[#3157DE]">{rule.execution_mode === 'manual' ? 'Ручной запуск' : 'Автоматически'}</span>
        </div>
        <p className="mt-1 text-sm text-[#71829D]">{rule.description || 'Без описания'}</p>
        <p className="mt-2 text-xs text-[#8A9AB2]">Триггер: {triggerLabel(rule.trigger_type)}</p>
        <p className="mt-1 text-xs text-[#8A9AB2]">
          Условия: {conditions.length || 0} · Действия: {actions.length ? actions.map(action => actionLabel(action.type)).join(', ') : 'нет'}
        </p>
        {conditions.length > 0 && (
          <p className="mt-1 truncate text-xs text-[#8A9AB2]">
            {conditions.slice(0, 2).map(condition => `${fieldLabel(condition.field)} ${operatorLabel(condition.operator).toLowerCase()} ${condition.value || '-'}`).join(' · ')}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        {editable && (
          <>
            <button onClick={onEdit} className="rounded-lg border border-[#E2E8F0] p-2 text-[#52657F]" aria-label="Настроить правило"><Pencil size={16} /></button>
            <button onClick={onDelete} className="rounded-lg border border-rose-100 p-2 text-rose-600" aria-label="Удалить правило"><Trash2 size={16} /></button>
          </>
        )}
        <button
          disabled={!editable}
          onClick={() => onToggle(rule)}
          className={`relative h-7 w-12 rounded-full transition ${rule.is_enabled ? 'bg-[#3157DE]' : 'bg-[#CBD5E1]'} disabled:opacity-50`}
          aria-label={rule.is_enabled ? 'Выключить правило' : 'Включить правило'}
        >
          <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition ${rule.is_enabled ? 'left-6' : 'left-1'}`} />
        </button>
      </div>
    </div>
  );
}

function RuleModal({ rule, clinicId, onClose, onSaved }: { rule: AutomationRule | null; clinicId: string | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(rule?.name || '');
  const [description, setDescription] = useState(rule?.description || '');
  const [trigger, setTrigger] = useState(rule?.trigger_type || 'lead.created');
  const executionMode: ExecutionMode = 'automatic';
  const [isEnabled, setIsEnabled] = useState(rule?.is_enabled ?? true);
  const [conditions, setConditions] = useState<ConditionRow[]>(normalizeConditions(rule?.conditions));
  const [actions, setActions] = useState<ActionDraft[]>(() => {
    const existing = normalizeActions(rule?.actions);
    return existing.length
      ? existing.map(normalizeActionDraft)
      : [{ type: DEFAULT_ACTION.type, target: '', value: '' }];
  });
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [dealStages, setDealStages] = useState<DealStageOption[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!clinicId) return;
    void Promise.all([
      supabase
        .from('agents')
        .select('id,name')
        .eq('clinic_id', clinicId)
        .order('name'),
      supabase
        .from('deal_stages')
        .select('code,name,probability')
        .eq('clinic_id', clinicId)
        .eq('is_active', true)
        .order('sort_order'),
    ]).then(([agentsResult, stagesResult]) => {
      setAgents((agentsResult.data || []) as AgentOption[]);
      setDealStages((stagesResult.data || []) as DealStageOption[]);
    });
  }, [clinicId]);

  const updateCondition = (index: number, patch: Partial<ConditionRow>) => {
    setConditions(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  };

  const updateAction = (index: number, patch: Partial<ActionDraft>) => {
    setActions(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  };

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!clinicId || !name.trim()) return;

    const parsedActions: ActionRow[] = actions.map(action => ({
      type: action.type,
      config: buildActionConfig(action),
    }));

    setSaving(true);
    const payload = {
      clinic_id: clinicId,
      rule_key: rule?.rule_key || `custom_${crypto.randomUUID()}`,
      name: name.trim(),
      description: description.trim(),
      trigger_type: trigger,
      execution_mode: executionMode,
      conditions: conditions
        .map(item => ({ field: item.field.trim(), operator: item.operator, value: item.value.trim() }))
        .filter(item => item.field || item.value),
      actions: parsedActions,
      is_enabled: isEnabled,
      updated_at: new Date().toISOString(),
    };

    const saveWithPayload = async () => (
      rule?.id
        ? supabase.from('automation_rules').update(payload).eq('id', rule.id).eq('clinic_id', clinicId)
        : supabase.from('automation_rules').insert(payload)
    );

    const { error: saveError } = await saveWithPayload();

    setSaving(false);
    if (saveError) {
      toast.error(saveError.message);
      return;
    }

    toast.success('Правило сохранено');
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/30 p-4" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <form onSubmit={save} className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-[#10264B]">{rule ? 'Настроить правило' : 'Новое правило'}</h2>
            <p className="mt-1 text-sm text-[#71829D]">Настройте событие, фильтры и действия. Система сохранит правило сама.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-[#E2E8F0] p-2 text-[#64748B]"><X size={17} /></button>
        </div>

        <div className="mt-5 flex items-center justify-between gap-4 rounded-2xl border border-[#E7ECF3] bg-[#FAFBFE] p-4">
          <div>
            <p className="text-sm font-semibold text-[#334A6A]">Правило активно</p>
            <p className="mt-1 text-xs text-[#71829D]">Выключите, если правило нужно сохранить как черновик.</p>
          </div>
          <button
            type="button"
            onClick={() => setIsEnabled(current => !current)}
            className={`relative h-7 w-12 shrink-0 rounded-full transition ${isEnabled ? 'bg-[#3157DE]' : 'bg-[#CBD5E1]'}`}
            aria-label={isEnabled ? 'Выключить правило' : 'Включить правило'}
          >
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition ${isEnabled ? 'left-6' : 'left-1'}`} />
          </button>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-medium text-[#334A6A]">
            Название
            <input value={name} onChange={event => setName(event.target.value)} className="mt-2 w-full rounded-xl border border-[#DDE6F1] px-3 py-2.5 outline-none focus:border-[#8BA7FF]" required />
          </label>
          <label className="block text-sm font-medium text-[#334A6A]">
            Триггер
            <select value={trigger} onChange={event => setTrigger(event.target.value)} className="mt-2 w-full rounded-xl border border-[#DDE6F1] bg-white px-3 py-2.5 outline-none focus:border-[#8BA7FF]">
              {TRIGGERS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium text-[#334A6A] md:col-span-2">
            Описание
            <textarea value={description} onChange={event => setDescription(event.target.value)} className="mt-2 min-h-24 w-full rounded-xl border border-[#DDE6F1] p-3 outline-none focus:border-[#8BA7FF]" />
          </label>
        </div>

        <EditorSection title="Условия" action={<button type="button" onClick={() => setConditions(current => [...current, { ...DEFAULT_CONDITION }])} className="inline-flex items-center gap-1 text-sm font-semibold text-[#3157DE]"><Plus size={14} />Добавить</button>}>
          {conditions.length ? conditions.map((condition, index) => (
            <div key={index} className="grid gap-2 rounded-xl border border-[#E7ECF3] bg-white p-3 md:grid-cols-[1fr_170px_1fr_auto]">
              <input value={condition.field} onChange={event => updateCondition(index, { field: event.target.value })} list={`condition-fields-${index}`} placeholder="Поле" className="rounded-lg border border-[#DDE6F1] px-3 py-2 text-sm outline-none focus:border-[#8BA7FF]" />
              <datalist id={`condition-fields-${index}`}>
                {CONDITION_FIELDS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
              </datalist>
              <select value={condition.operator} onChange={event => updateCondition(index, { operator: event.target.value })} className="rounded-lg border border-[#DDE6F1] bg-white px-3 py-2 text-sm outline-none focus:border-[#8BA7FF]">
                {OPERATORS.map(operator => <option key={operator} value={operator}>{operatorLabel(operator)}</option>)}
              </select>
              <input value={condition.value} onChange={event => updateCondition(index, { value: event.target.value })} placeholder="Значение" className="rounded-lg border border-[#DDE6F1] px-3 py-2 text-sm outline-none focus:border-[#8BA7FF]" />
              <button type="button" onClick={() => setConditions(current => current.filter((_, itemIndex) => itemIndex !== index))} className="rounded-lg border border-rose-100 p-2 text-rose-600"><Trash2 size={16} /></button>
            </div>
          )) : <Empty label="Условий нет. Значит правило сработает по самому факту триггера." />}
        </EditorSection>

        <EditorSection title="Действия" action={<button type="button" onClick={() => setActions(current => [...current, { type: DEFAULT_ACTION.type, target: '', value: '' }])} className="inline-flex items-center gap-1 text-sm font-semibold text-[#3157DE]"><Plus size={14} />Добавить</button>}>
          {actions.map((action, index) => (
            <div key={index} className="rounded-xl border border-[#E7ECF3] bg-white p-3">
              <div className="flex items-center gap-2">
                <select value={action.type} onChange={event => updateAction(index, { type: event.target.value, target: '', value: '' })} className="w-full rounded-lg border border-[#DDE6F1] bg-white px-3 py-2 text-sm outline-none focus:border-[#8BA7FF]">
                  {ACTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
                <button type="button" onClick={() => setActions(current => current.filter((_, itemIndex) => itemIndex !== index))} className="rounded-lg border border-rose-100 p-2 text-rose-600"><Trash2 size={16} /></button>
              </div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {['notify_user', 'assign_owner', 'create_task'].includes(action.type) ? (
                  <select
                    value={action.target}
                    onChange={event => updateAction(index, { target: event.target.value })}
                    className="rounded-lg border border-[#DDE6F1] bg-white px-3 py-2 text-sm outline-none focus:border-[#8BA7FF]"
                  >
                    <option value="">Ответственный из события</option>
                    {action.type === 'notify_user' && <option value="managers">Все руководители</option>}
                    {agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                  </select>
                ) : <div />}
                {action.type === 'update_stage' ? (
                  <select
                    value={action.value}
                    onChange={event => updateAction(index, { value: event.target.value })}
                    className="rounded-lg border border-[#DDE6F1] bg-white px-3 py-2 text-sm outline-none focus:border-[#8BA7FF]"
                    required
                  >
                    <option value="">Выберите этап</option>
                    {dealStages.map(stage => (
                      <option key={stage.code} value={stage.code}>{stage.name} · {stage.probability}%</option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={action.value}
                    onChange={event => updateAction(index, { value: event.target.value })}
                    placeholder={action.type === 'notify_user'
                      ? 'Текст уведомления'
                      : action.type === 'create_task'
                        ? 'Название задачи'
                        : action.type === 'create_invoice'
                          ? 'Сумма (пусто = сумма сделки)'
                          : 'Значение'}
                    className="rounded-lg border border-[#DDE6F1] px-3 py-2 text-sm outline-none focus:border-[#8BA7FF]"
                  />
                )}
              </div>
            </div>
          ))}
        </EditorSection>

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-[#E2E8F0] px-4 py-2.5 text-sm font-medium text-[#52657F]">Отмена</button>
          <button disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-[#3157DE] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
            <Save size={16} />{saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </form>
    </div>
  );
}

function EditorSection({ title, action, children }: { title: string; action: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-5 rounded-2xl border border-[#E7ECF3] bg-[#FAFBFE] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-semibold text-[#10264B]">{title}</h3>
        {action}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Panel({ title, icon: Icon, action, children }: { title: string; icon: ComponentType<{ size?: number; className?: string }>; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-[22px] border border-[#E4EBF4] bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,.04)]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2"><Icon size={18} className="text-[#3157DE]" /><h2 className="font-semibold text-[#10264B]">{title}</h2></div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function StatusPill({ status }: { status: string }) {
  return <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${statusStyle[status] || 'border-slate-200 bg-slate-50 text-slate-600'}`}>{labelForStatus(status)}</span>;
}

function Empty({ label }: { label: string }) {
  return <p className="rounded-xl border border-dashed border-[#DDE6F1] px-4 py-6 text-center text-sm leading-6 text-[#8A9AB2]">{label}</p>;
}
