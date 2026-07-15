import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { Check, Loader2, PencilLine, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { PageLayout } from '@/components/layout/PageLayout';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

type TabKey = 'companies' | 'contacts' | 'deals' | 'products' | 'invoices' | 'payments';
type RelationKey = TabKey | 'agents' | 'deal_stages';
type FieldKind = 'text' | 'email' | 'tel' | 'url' | 'textarea' | 'number' | 'date' | 'datetime' | 'select' | 'checkbox' | 'tags';
type CrmValue = string | number | boolean | string[] | null;
type CrmForm = Record<string, CrmValue>;
type CrmRow = Record<string, CrmValue | undefined> & {
  id: string;
  clinic_id: string;
  created_at?: string | null;
  updated_at?: string | null;
};

interface FieldConfig {
  key: string;
  label: string;
  kind?: FieldKind;
  required?: boolean;
  placeholder?: string;
  options?: SelectOption[];
  relation?: RelationKey;
  readOnly?: boolean;
}

interface TabConfig {
  key: TabKey;
  label: string;
  table: TabKey;
  titleField: string;
  fields: FieldConfig[];
  columns: string[];
}

interface Agent {
  id: string;
  name: string;
  user_id: string | null;
}

interface SelectOption {
  value: string;
  label: string;
  probability?: number;
  outcome?: 'open' | 'won' | 'lost';
}

const currencyOptions = ['KZT', 'KGS', 'USD'].map(value => ({ value, label: value }));
const dealStatuses = [
  { value: 'open', label: 'Открыта' },
  { value: 'won', label: 'Выиграна' },
  { value: 'lost', label: 'Проиграна' },
  { value: 'cancelled', label: 'Отменена' },
];
const invoiceStatuses = [
  { value: 'draft', label: 'Черновик' },
  { value: 'issued', label: 'Выставлен' },
  { value: 'partially_paid', label: 'Частично оплачен' },
  { value: 'paid', label: 'Оплачен' },
  { value: 'overdue', label: 'Просрочен' },
  { value: 'cancelled', label: 'Отменен' },
];
const paymentStatuses = [
  { value: 'pending', label: 'Ожидает' },
  { value: 'paid', label: 'Оплачен' },
  { value: 'failed', label: 'Ошибка' },
  { value: 'refunded', label: 'Возврат' },
];
const paymentMethods = [
  { value: 'cash', label: 'Наличные' },
  { value: 'card', label: 'Карта' },
  { value: 'bank_transfer', label: 'Банк' },
  { value: 'kaspi', label: 'Kaspi' },
  { value: 'online', label: 'Онлайн' },
];

const tabConfigs: Record<TabKey, TabConfig> = {
  companies: {
    key: 'companies',
    label: 'Компании',
    table: 'companies',
    titleField: 'name',
    columns: ['name', 'bin_iin', 'phone', 'email', 'website'],
    fields: [
      { key: 'name', label: 'Название', required: true, placeholder: 'ТОО Example' },
      { key: 'bin_iin', label: 'БИН / ИИН', placeholder: '000000000000' },
      { key: 'phone', label: 'Телефон', kind: 'tel', placeholder: '+7 700 000 0000' },
      { key: 'email', label: 'Email', kind: 'email', placeholder: 'mail@example.kz' },
      { key: 'website', label: 'Сайт', kind: 'url', placeholder: 'https://example.kz' },
      { key: 'notes', label: 'Заметки', kind: 'textarea' },
    ],
  },
  contacts: {
    key: 'contacts',
    label: 'Контакты',
    table: 'contacts',
    titleField: 'first_name',
    columns: ['first_name', 'last_name', 'phone', 'email', 'company_id', 'owner_agent_id', 'source'],
    fields: [
      { key: 'first_name', label: 'Имя', required: true, placeholder: 'Айгерим' },
      { key: 'last_name', label: 'Фамилия', placeholder: 'Серикова' },
      { key: 'phone', label: 'Телефон', kind: 'tel', placeholder: '+7 700 000 0000' },
      { key: 'email', label: 'Email', kind: 'email', placeholder: 'client@example.kz' },
      { key: 'company_id', label: 'Компания', kind: 'select', relation: 'companies' },
      { key: 'owner_agent_id', label: 'Ответственный', kind: 'select', relation: 'agents' },
      { key: 'source', label: 'Источник', placeholder: 'CRM, сайт, WhatsApp' },
      { key: 'tags', label: 'Теги', kind: 'tags', placeholder: 'vip, b2b' },
      { key: 'notes', label: 'Заметки', kind: 'textarea' },
    ],
  },
  deals: {
    key: 'deals',
    label: 'Сделки',
    table: 'deals',
    titleField: 'title',
    columns: ['title', 'contact_id', 'company_id', 'owner_agent_id', 'stage_id', 'probability', 'status', 'amount', 'expected_close_date'],
    fields: [
      { key: 'title', label: 'Название', required: true, placeholder: 'Продажа пакета услуг' },
      { key: 'contact_id', label: 'Контакт', kind: 'select', relation: 'contacts' },
      { key: 'company_id', label: 'Компания', kind: 'select', relation: 'companies' },
      { key: 'owner_agent_id', label: 'Ответственный', kind: 'select', relation: 'agents' },
      { key: 'stage_id', label: 'Этап', kind: 'select', relation: 'deal_stages', required: true },
      { key: 'probability', label: 'Вероятность, %', kind: 'number', readOnly: true },
      { key: 'status', label: 'Статус', kind: 'select', options: dealStatuses },
      { key: 'amount', label: 'Сумма', kind: 'number', placeholder: '0' },
      { key: 'currency', label: 'Валюта', kind: 'select', options: currencyOptions },
      { key: 'source', label: 'Источник' },
      { key: 'expected_close_date', label: 'Ожидаемое закрытие', kind: 'date' },
    ],
  },
  products: {
    key: 'products',
    label: 'Продукты',
    table: 'products',
    titleField: 'name',
    columns: ['name', 'sku', 'unit_price', 'currency', 'is_active'],
    fields: [
      { key: 'name', label: 'Название', required: true, placeholder: 'Консультация' },
      { key: 'sku', label: 'SKU', placeholder: 'SKU-001' },
      { key: 'description', label: 'Описание', kind: 'textarea' },
      { key: 'unit_price', label: 'Цена', kind: 'number', required: true, placeholder: '0' },
      { key: 'currency', label: 'Валюта', kind: 'select', options: currencyOptions },
      { key: 'is_active', label: 'Активен', kind: 'checkbox' },
    ],
  },
  invoices: {
    key: 'invoices',
    label: 'Счета',
    table: 'invoices',
    titleField: 'number',
    columns: ['number', 'contact_id', 'company_id', 'deal_id', 'status', 'total', 'due_date'],
    fields: [
      { key: 'number', label: 'Номер', required: true, placeholder: 'INV-0001' },
      { key: 'contact_id', label: 'Контакт', kind: 'select', relation: 'contacts' },
      { key: 'company_id', label: 'Компания', kind: 'select', relation: 'companies' },
      { key: 'deal_id', label: 'Сделка', kind: 'select', relation: 'deals' },
      { key: 'status', label: 'Статус', kind: 'select', options: invoiceStatuses },
      { key: 'currency', label: 'Валюта', kind: 'select', options: currencyOptions },
      { key: 'subtotal', label: 'Подытог', kind: 'number', placeholder: '0' },
      { key: 'discount', label: 'Скидка', kind: 'number', placeholder: '0' },
      { key: 'total', label: 'Итого', kind: 'number', required: true, placeholder: '0' },
      { key: 'due_date', label: 'Срок оплаты', kind: 'date' },
      { key: 'notes', label: 'Заметки', kind: 'textarea' },
    ],
  },
  payments: {
    key: 'payments',
    label: 'Платежи',
    table: 'payments',
    titleField: 'amount',
    columns: ['invoice_id', 'deal_id', 'contact_id', 'amount', 'currency', 'status', 'method', 'paid_at'],
    fields: [
      { key: 'invoice_id', label: 'Счет', kind: 'select', relation: 'invoices' },
      { key: 'deal_id', label: 'Сделка', kind: 'select', relation: 'deals' },
      { key: 'contact_id', label: 'Контакт', kind: 'select', relation: 'contacts' },
      { key: 'amount', label: 'Сумма', kind: 'number', required: true, placeholder: '0' },
      { key: 'currency', label: 'Валюта', kind: 'select', options: currencyOptions },
      { key: 'status', label: 'Статус', kind: 'select', options: paymentStatuses },
      { key: 'method', label: 'Метод', kind: 'select', options: paymentMethods },
      { key: 'paid_at', label: 'Дата оплаты', kind: 'datetime' },
      { key: 'external_reference', label: 'Внешняя ссылка' },
      { key: 'notes', label: 'Заметки', kind: 'textarea' },
    ],
  },
};

const tabs = Object.values(tabConfigs);

function emptyForm(config: TabConfig, defaultCurrency: 'KZT' | 'KGS' = 'KZT'): CrmForm {
  return config.fields.reduce<CrmForm>((acc, field) => {
    if (field.kind === 'checkbox') acc[field.key] = true;
    else if (field.key === 'currency') acc[field.key] = defaultCurrency;
    else if (field.key === 'probability') acc[field.key] = 10;
    else if (field.key === 'status') acc[field.key] = field.options?.[0]?.value ?? '';
    else acc[field.key] = '';
    return acc;
  }, {});
}

function asString(value: CrmValue | undefined): string {
  if (value === null || value === undefined || Array.isArray(value)) return '';
  return String(value);
}

function formatMoney(amount: CrmValue | undefined, currency: CrmValue | undefined = 'KZT') {
  const value = Number(amount ?? 0);
  const code = asString(currency) || 'KZT';
  if (!Number.isFinite(value)) return `0 ${code}`;
  return `${value.toLocaleString('ru-RU')} ${code}`;
}

function rowTitle(tab: TabKey, row?: CrmRow | null) {
  if (!row) return '-';
  const config = tabConfigs[tab];
  if (tab === 'contacts') return [row.first_name, row.last_name].map(asString).filter(Boolean).join(' ') || asString(row.phone) || 'Контакт';
  if (tab === 'payments') return formatMoney(row.amount, row.currency);
  return asString(row[config.titleField]) || '-';
}

function formatValue(value: CrmValue | undefined) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '-';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return new Date(value).toLocaleString('ru-RU');
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00`).toLocaleDateString('ru-RU');
  return String(value);
}

function normalizeForm(config: TabConfig, form: CrmForm, clinicId: string) {
  const payload: Record<string, CrmValue> = { clinic_id: clinicId };
  config.fields.forEach(field => {
    const raw = form[field.key];
    if (field.kind === 'checkbox') {
      payload[field.key] = Boolean(raw);
      return;
    }
    if (field.kind === 'number') {
      payload[field.key] = raw === '' || raw === null || raw === undefined ? 0 : Number(raw);
      return;
    }
    if (field.kind === 'tags') {
      payload[field.key] = asString(raw).split(',').map(tag => tag.trim()).filter(Boolean);
      return;
    }
    if (field.kind === 'datetime' && raw) {
      payload[field.key] = new Date(asString(raw)).toISOString();
      return;
    }
    payload[field.key] = raw === '' ? null : raw ?? null;
  });
  return payload;
}

function formFromRow(config: TabConfig, row: CrmRow): CrmForm {
  return config.fields.reduce<CrmForm>((acc, field) => {
    const value = row[field.key];
    if (field.kind === 'tags') acc[field.key] = Array.isArray(value) ? value.join(', ') : asString(value);
    else if (field.kind === 'datetime' && value) acc[field.key] = new Date(asString(value)).toISOString().slice(0, 16);
    else acc[field.key] = value ?? (field.kind === 'checkbox' ? false : '');
    return acc;
  }, {});
}

function validate(config: TabConfig, form: CrmForm) {
  const missing = config.fields.find(field => field.required && (form[field.key] === '' || form[field.key] === null || form[field.key] === undefined));
  if (missing) return `Заполните поле: ${missing.label}`;

  for (const field of config.fields) {
    const value = form[field.key];
    if (field.kind === 'number' && value !== '' && value !== null && value !== undefined && !Number.isFinite(Number(value))) return `${field.label}: нужно число`;
    if (field.kind === 'number' && value !== '' && value !== null && value !== undefined && Number(value) < 0) return `${field.label}: значение не может быть отрицательным`;
    if (field.kind === 'email' && value && !asString(value).includes('@')) return `${field.label}: странный email`;
    if (field.kind === 'url' && value && !/^https?:\/\//i.test(asString(value))) return `${field.label}: нужен URL с http:// или https://`;
  }

  return null;
}

export default function CrmCore() {
  const { clinicId, country } = useAuth();
  const defaultCurrency = country === 'KG' ? 'KGS' : 'KZT';
  const [activeTab, setActiveTab] = useState<TabKey>('companies');
  const [rows, setRows] = useState<Record<TabKey, CrmRow[]>>({
    companies: [],
    contacts: [],
    deals: [],
    products: [],
    invoices: [],
    payments: [],
  });
  const [agents, setAgents] = useState<Agent[]>([]);
  const [dealStages, setDealStages] = useState<SelectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<CrmRow | null>(null);
  const [form, setForm] = useState<CrmForm>(emptyForm(tabConfigs.companies));

  const config = tabConfigs[activeTab];

  const load = async () => {
    if (!clinicId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [companies, contacts, deals, products, invoices, payments, agentRows, stageRows] = await Promise.all([
        supabase.from('companies').select('*').eq('clinic_id', clinicId).order('created_at', { ascending: false }),
        supabase.from('contacts').select('*').eq('clinic_id', clinicId).order('created_at', { ascending: false }),
        supabase.from('deals').select('*').eq('clinic_id', clinicId).order('created_at', { ascending: false }),
        supabase.from('products').select('*').eq('clinic_id', clinicId).order('created_at', { ascending: false }),
        supabase.from('invoices').select('*').eq('clinic_id', clinicId).order('created_at', { ascending: false }),
        supabase.from('payments').select('*').eq('clinic_id', clinicId).order('created_at', { ascending: false }),
        supabase.from('agents').select('id, name, user_id').eq('clinic_id', clinicId).order('name'),
        supabase.from('deal_stages').select('id, name, probability, outcome').eq('clinic_id', clinicId).eq('is_active', true).order('sort_order'),
      ]);
      const failed = [companies, contacts, deals, products, invoices, payments, agentRows, stageRows].find(result => result.error);
      if (failed?.error) throw failed.error;
      setRows({
        companies: (companies.data ?? []) as CrmRow[],
        contacts: (contacts.data ?? []) as CrmRow[],
        deals: (deals.data ?? []) as CrmRow[],
        products: (products.data ?? []) as CrmRow[],
        invoices: (invoices.data ?? []) as CrmRow[],
        payments: (payments.data ?? []) as CrmRow[],
      });
      setAgents((agentRows.data ?? []) as Agent[]);
      setDealStages((stageRows.data ?? []).map(stage => ({
        value: stage.id,
        label: stage.name,
        probability: stage.probability,
        outcome: stage.outcome as SelectOption['outcome'],
      })));
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : 'Не удалось загрузить CRM';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [clinicId]);

  useEffect(() => {
    setSearch('');
    setDrawerOpen(false);
    setEditing(null);
    setForm(emptyForm(tabConfigs[activeTab], defaultCurrency));
  }, [activeTab, defaultCurrency]);

  const relatedOptions = useMemo<Record<RelationKey, SelectOption[]>>(() => ({
    companies: rows.companies.map(row => ({ value: row.id, label: rowTitle('companies', row) })),
    contacts: rows.contacts.map(row => ({ value: row.id, label: rowTitle('contacts', row) })),
    deals: rows.deals.map(row => ({ value: row.id, label: rowTitle('deals', row) })),
    products: rows.products.map(row => ({ value: row.id, label: rowTitle('products', row) })),
    invoices: rows.invoices.map(row => ({ value: row.id, label: rowTitle('invoices', row) })),
    payments: rows.payments.map(row => ({ value: row.id, label: rowTitle('payments', row) })),
    agents: agents.map(agent => ({ value: agent.id, label: agent.name })),
    deal_stages: dealStages,
  }), [agents, dealStages, rows]);

  const lookupLabel = (field: FieldConfig | undefined, value: CrmValue | undefined) => {
    if (!field?.relation || !value) return formatValue(value);
    return relatedOptions[field.relation].find(option => option.value === value)?.label ?? formatValue(value);
  };

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows[activeTab];
    return rows[activeTab].filter(row => config.columns.some(column => {
      const field = config.fields.find(item => item.key === column);
      return lookupLabel(field, row[column]).toLowerCase().includes(term);
    }));
  }, [activeTab, config, rows, search, relatedOptions]);

  const openCreate = () => {
    setEditing(null);
    const nextForm = emptyForm(config, defaultCurrency);
    if (activeTab === 'deals' && dealStages[0]) {
      nextForm.stage_id = dealStages[0].value;
      nextForm.probability = dealStages[0].probability ?? 10;
      nextForm.status = dealStages[0].outcome ?? 'open';
    }
    setForm(nextForm);
    setDrawerOpen(true);
  };

  const openEdit = (row: CrmRow) => {
    setEditing(row);
    setForm(formFromRow(config, row));
    setDrawerOpen(true);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!clinicId) {
      toast.error('Рабочее пространство не найдено. Без tenant-id CRM быстро превращается в кашу.');
      return;
    }
    const validationError = validate(config, form);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setSaving(true);
    try {
      const payload = normalizeForm(config, form, clinicId);
      const request = editing
        ? supabase.from(config.table).update(payload).eq('id', editing.id).eq('clinic_id', clinicId).select('*').single()
        : supabase.from(config.table).insert(payload).select('*').single();
      const { data, error: saveError } = await request;
      if (saveError) throw saveError;
      const saved = data as CrmRow;
      setRows(previous => ({
        ...previous,
        [activeTab]: editing
          ? previous[activeTab].map(row => row.id === editing.id ? saved : row)
          : [saved, ...previous[activeTab]],
      }));
      setDrawerOpen(false);
      setEditing(null);
      toast.success(editing ? 'Запись обновлена' : 'Запись создана');
    } catch (cause: unknown) {
      toast.error(cause instanceof Error ? cause.message : 'Сохранение упало. Неприятно, но чинится.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: CrmRow) => {
    if (!clinicId) return;
    if (!window.confirm(`Удалить запись "${rowTitle(activeTab, row)}"?`)) return;
    const { error: deleteError } = await supabase.from(config.table).delete().eq('id', row.id).eq('clinic_id', clinicId);
    if (deleteError) {
      toast.error(deleteError.message);
      return;
    }
    setRows(previous => ({ ...previous, [activeTab]: previous[activeTab].filter(item => item.id !== row.id) }));
    toast.success('Запись удалена');
  };

  const totalAmount = useMemo(() => {
    if (activeTab !== 'deals' && activeTab !== 'invoices' && activeTab !== 'payments') return null;
    const field = activeTab === 'invoices' ? 'total' : 'amount';
    return rows[activeTab].reduce((sum, row) => sum + (Number(row[field]) || 0), 0);
  }, [activeTab, rows]);

  return (
    <PageLayout>
      <div className="space-y-5">
        <section className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#71829D]">CRM Core</p>
            <h1 className="mt-2 text-3xl font-black text-[#10264B]">CRM</h1>
            <p className="mt-1 text-sm text-[#71829D]">Компании, контакты, сделки, продукты, счета и платежи. Универсально, без медицинского туннельного зрения.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void load()} className="neu-btn flex items-center gap-2 px-4 py-2.5 text-sm font-semibold">
              <RefreshCw size={16} /> Обновить
            </button>
            <button type="button" onClick={openCreate} className="crm-create-btn flex items-center gap-2 px-4 py-2.5 text-sm font-semibold">
              <Plus size={17} /> Создать
            </button>
          </div>
        </section>

        <section className="crm-filter-bar flex flex-wrap items-center gap-3">
          <div className="flex gap-1 overflow-x-auto rounded-2xl border border-[#E3EAF2] bg-white/70 p-1">
            {tabs.map(tab => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`shrink-0 rounded-xl px-4 py-2 text-sm font-semibold ${activeTab === tab.key ? 'bg-[#EAF0FF] text-[#3157DE]' : 'text-[#64748B]'}`}
              >
                {tab.label}
                <span className="ml-2 text-xs opacity-70">{rows[tab.key].length}</span>
              </button>
            ))}
          </div>
          <div className="ml-auto flex min-w-[260px] items-center gap-2 rounded-2xl border border-[#E3EAF2] bg-white px-3 py-2">
            <Search size={16} className="text-[#8EA0B7]" />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder={`Поиск: ${config.label.toLowerCase()}`}
              className="w-full bg-transparent text-sm text-[#10264B] outline-none placeholder:text-[#9AAAC0]"
            />
          </div>
        </section>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Metric label="Раздел" value={config.label} />
          <Metric label="Записей" value={String(rows[activeTab].length)} />
          <Metric label="Сумма" value={totalAmount === null ? '-' : formatMoney(totalAmount)} />
        </section>

        <section className="neu-card crm-table-card overflow-hidden p-0">
          {loading ? (
            <StateBlock icon={<Loader2 className="animate-spin" />} title="Загрузка CRM" text="Тяну данные из Supabase." />
          ) : error ? (
            <StateBlock title="Ошибка загрузки" text={error} action={<button type="button" onClick={() => void load()} className="neu-btn mt-3 px-4 py-2 text-sm">Повторить</button>} />
          ) : filteredRows.length === 0 ? (
            <StateBlock title={search ? 'Ничего не найдено' : 'Пока пусто'} text={search ? 'Фильтр слишком бодрый. Ослабьте хватку.' : `Создайте первую запись в разделе "${config.label}".`} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left">
                <thead className="border-b border-[#EDF1F7] text-xs uppercase tracking-wide text-[#7C8DA7]">
                  <tr>
                    {config.columns.map(column => <th key={column} className="px-5 py-4 font-bold">{config.fields.find(field => field.key === column)?.label ?? column}</th>)}
                    <th className="px-5 py-4 text-right font-bold">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map(row => (
                    <tr key={row.id} className="border-b border-[#F0F3F8] hover:bg-[#FAFBFE]">
                      {config.columns.map(column => {
                        const field = config.fields.find(item => item.key === column);
                        const moneyField = column === 'amount' || column === 'total' || column === 'unit_price';
                        const value = moneyField ? formatMoney(row[column], row.currency) : lookupLabel(field, row[column]);
                        return (
                          <td key={column} className="px-5 py-4 align-top text-sm text-[#52657F]">
                            <span className={column === config.titleField ? 'font-semibold text-[#10264B]' : ''}>{value}</span>
                          </td>
                        );
                      })}
                      <td className="px-5 py-4">
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => openEdit(row)} className="neu-btn grid h-9 w-9 place-items-center" title="Редактировать">
                            <PencilLine size={15} />
                          </button>
                          <button type="button" onClick={() => void remove(row)} className="grid h-9 w-9 place-items-center rounded-xl border border-[#FECACA] bg-[#FFF5F5] text-[#DC2626]" title="Удалить">
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {drawerOpen && (
        <Drawer title={editing ? `Редактировать: ${rowTitle(activeTab, editing)}` : `Создать: ${config.label}`} onClose={() => setDrawerOpen(false)}>
          <form onSubmit={save} className="space-y-4">
            {config.fields.map(field => (
              <FieldEditor
                key={field.key}
                field={field}
                value={form[field.key]}
                options={field.relation ? relatedOptions[field.relation] : field.options ?? []}
                onChange={value => setForm(previous => {
                  if (activeTab === 'deals' && field.key === 'stage_id') {
                    const selectedStage = dealStages.find(stage => stage.value === value);
                    return {
                      ...previous,
                      stage_id: value,
                      probability: selectedStage?.probability ?? previous.probability,
                      status: selectedStage?.outcome ?? previous.status,
                    };
                  }
                  return { ...previous, [field.key]: value };
                })}
              />
            ))}
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button type="button" onClick={() => setDrawerOpen(false)} className="neu-btn justify-center py-3 text-sm font-semibold">
                Отмена
              </button>
              <button disabled={saving} className="neu-btn-primary justify-center py-3 text-sm font-semibold">
                {saving ? <Loader2 size={17} className="animate-spin" /> : <Check size={17} />}
                Сохранить
              </button>
            </div>
          </form>
        </Drawer>
      )}
    </PageLayout>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#E4EBF4] bg-white/80 p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#8392A8]">{label}</p>
      <p className="mt-2 text-xl font-black text-[#10264B]">{value}</p>
    </div>
  );
}

function StateBlock({ icon, title, text, action }: { icon?: ReactNode; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="grid min-h-[360px] place-items-center px-6 py-16 text-center">
      <div>
        {icon && <div className="mb-3 flex justify-center text-[#3157DE]">{icon}</div>}
        <h2 className="text-lg font-bold text-[#10264B]">{title}</h2>
        <p className="mt-2 text-sm text-[#71829D]">{text}</p>
        {action}
      </div>
    </div>
  );
}

function FieldEditor({ field, value, options, onChange }: {
  field: FieldConfig;
  value: CrmValue | undefined;
  options: SelectOption[];
  onChange: (value: CrmValue) => void;
}) {
  const common = 'neu-input w-full text-sm';
  const label = <span className="mb-1.5 block text-sm font-semibold text-[#405571]">{field.label}{field.required ? ' *' : ''}</span>;

  if (field.kind === 'textarea') {
    return <label className="block">{label}<textarea className={`${common} min-h-24 py-3`} value={asString(value)} onChange={event => onChange(event.target.value)} placeholder={field.placeholder} /></label>;
  }

  if (field.kind === 'select') {
    return (
      <label className="block">
        {label}
        <select className={common} value={asString(value)} onChange={event => onChange(event.target.value || null)}>
          <option value="">- не выбрано -</option>
          {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
    );
  }

  if (field.kind === 'checkbox') {
    return (
      <label className="flex items-center gap-3 rounded-xl border border-[#E3EAF2] bg-white/70 p-4 text-sm font-semibold text-[#405571]">
        <input type="checkbox" checked={Boolean(value)} onChange={event => onChange(event.target.checked)} />
        {field.label}
      </label>
    );
  }

  const type = field.kind === 'number' ? 'number' : field.kind === 'date' ? 'date' : field.kind === 'datetime' ? 'datetime-local' : field.kind || 'text';
  return (
    <label className="block">
      {label}
      <input
        className={common}
        type={type}
        step={field.kind === 'number' ? '0.01' : undefined}
        value={asString(value)}
        onChange={event => onChange(event.target.value)}
        placeholder={field.placeholder}
        readOnly={field.readOnly}
      />
      {field.kind === 'tags' && <p className="mt-1 text-xs text-[#8392A8]">Через запятую.</p>}
    </label>
  );
}

function Drawer({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] bg-[#10213B]/25 backdrop-blur-[2px]" onMouseDown={onClose}>
      <aside
        onMouseDown={event => event.stopPropagation()}
        className="absolute inset-y-0 right-0 w-full max-w-2xl overflow-y-auto border-l border-[#E5EAF2] bg-white p-6 shadow-[-24px_0_60px_rgba(15,23,42,.14)]"
      >
        <div className="mb-6 flex items-center justify-between gap-4">
          <h1 className="text-xl font-bold text-[#10264B]">{title}</h1>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl border border-[#E2E8F0] text-[#52657F]">
            <X size={17} />
          </button>
        </div>
        {children}
      </aside>
    </div>
  );
}
