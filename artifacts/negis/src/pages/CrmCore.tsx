import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { Check, Loader2, PencilLine, Plus, RefreshCw, Search, Tag, Trash2, User, X } from 'lucide-react';
import { toast } from 'sonner';
import { WazzupChat } from '@/components/WazzupChat';
import { PageLayout } from '@/components/layout/PageLayout';
import { ClientDealsTab } from '@/components/crm/ClientDealsTab';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { normalizeWazzupChatId } from '@/lib/wazzup';
import type { WazzupChatType } from '@/types/wazzup';

type TabKey = 'companies' | 'contacts' | 'deals' | 'products' | 'invoices' | 'payments';
type RelationKey = TabKey | 'agents' | 'deal_pipelines' | 'deal_stages';
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

interface WazzupContactLink {
  id: string;
  contact_id: string | null;
  chat_type: WazzupChatType;
  chat_id: string;
  name: string | null;
}

interface SelectOption {
  value: string;
  label: string;
  pipelineId?: string;
  probability?: number;
  outcome?: 'open' | 'won' | 'lost';
}

function splitIntoChunks<T>(items: T[], size = 50) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
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
    columns: ['title', 'contact_id', 'company_id', 'owner_agent_id', 'pipeline_id', 'stage_id', 'probability', 'status', 'amount', 'expected_close_date'],
    fields: [
      { key: 'title', label: 'Название', required: true, placeholder: 'Продажа пакета услуг' },
      { key: 'contact_id', label: 'Контакт', kind: 'select', relation: 'contacts' },
      { key: 'company_id', label: 'Компания', kind: 'select', relation: 'companies' },
      { key: 'owner_agent_id', label: 'Ответственный', kind: 'select', relation: 'agents' },
      { key: 'pipeline_id', label: 'Воронка', kind: 'select', relation: 'deal_pipelines', required: true },
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
  const [location] = useLocation();
  const { clinicId, country, userRole, user } = useAuth();
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
  const [wazzupContacts, setWazzupContacts] = useState<WazzupContactLink[]>([]);
  const [dealPipelines, setDealPipelines] = useState<SelectOption[]>([]);
  const [dealStages, setDealStages] = useState<SelectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [contactBulkPanel, setContactBulkPanel] = useState<'agent' | 'source' | 'delete' | null>(null);
  const [contactBulkAgentId, setContactBulkAgentId] = useState('');
  const [contactBulkSource, setContactBulkSource] = useState('');
  const [contactBulkLoading, setContactBulkLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [contactDrawerTab, setContactDrawerTab] = useState<'details' | 'deals' | 'whatsapp'>('details');
  const [editing, setEditing] = useState<CrmRow | null>(null);
  const [form, setForm] = useState<CrmForm>(emptyForm(tabConfigs.companies));
  const openedContactRef = useRef<string | null>(null);
  const realtimeReloadRef = useRef<number | null>(null);

  const config = tabConfigs[activeTab];

  const load = async () => {
    if (!clinicId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [companies, contacts, deals, products, invoices, payments, agentRows, pipelineRows, stageRows, wazzupRows] = await Promise.all([
        supabase.from('companies').select('*').eq('clinic_id', clinicId).order('created_at', { ascending: false }),
        supabase.from('contacts').select('*').eq('clinic_id', clinicId).order('created_at', { ascending: false }),
        supabase.from('deals').select('*').eq('clinic_id', clinicId).order('created_at', { ascending: false }),
        supabase.from('products').select('*').eq('clinic_id', clinicId).order('created_at', { ascending: false }),
        supabase.from('invoices').select('*').eq('clinic_id', clinicId).order('created_at', { ascending: false }),
        supabase.from('payments').select('*').eq('clinic_id', clinicId).order('created_at', { ascending: false }),
        supabase.from('agents').select('id, name, user_id').eq('clinic_id', clinicId).order('name'),
        supabase.from('deal_pipelines').select('id, name').eq('clinic_id', clinicId).eq('is_active', true).order('sort_order'),
        supabase.from('deal_stages').select('id, pipeline_id, name, probability, outcome').eq('clinic_id', clinicId).eq('is_active', true).order('sort_order'),
        supabase.from('wz_contacts').select('id, contact_id, chat_type, chat_id, name').eq('clinic_id', clinicId).order('updated_at', { ascending: false }),
      ]);
      const failed = [companies, contacts, deals, products, invoices, payments, agentRows, pipelineRows, stageRows].find(result => result.error);
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
      setWazzupContacts(wazzupRows.error ? [] : (wazzupRows.data ?? []) as WazzupContactLink[]);
      setDealPipelines((pipelineRows.data ?? []).map(pipeline => ({ value: pipeline.id, label: pipeline.name })));
      setDealStages((stageRows.data ?? []).map(stage => ({
        value: stage.id,
        label: stage.name,
        pipelineId: stage.pipeline_id,
        probability: stage.probability,
        outcome: stage.outcome as SelectOption['outcome'],
      })));

      const params = new URLSearchParams(location.split('?')[1] || '');
      const requestedTab = params.get('tab');
      if (requestedTab && tabs.some(tab => tab.key === requestedTab)) setActiveTab(requestedTab as TabKey);
      const requestedContactId = params.get('contact');
      if (requestedContactId && openedContactRef.current !== requestedContactId) {
        const requestedContact = ((contacts.data ?? []) as CrmRow[]).find(row => row.id === requestedContactId);
        if (requestedContact) {
          openedContactRef.current = requestedContactId;
          setActiveTab('contacts');
          setEditing(requestedContact);
          setForm(formFromRow(tabConfigs.contacts, requestedContact));
          setContactDrawerTab('details');
          setDrawerOpen(true);
        }
      }
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : 'Не удалось загрузить CRM';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [clinicId, location]);

  useEffect(() => {
    if (!clinicId) return;
    const scheduleReload = () => {
      if (realtimeReloadRef.current) window.clearTimeout(realtimeReloadRef.current);
      realtimeReloadRef.current = window.setTimeout(() => void load(), 180);
    };
    const channel = supabase
      .channel(`crm-core-realtime:${clinicId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contacts', filter: `clinic_id=eq.${clinicId}` }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deals', filter: `clinic_id=eq.${clinicId}` }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wz_contacts', filter: `clinic_id=eq.${clinicId}` }, scheduleReload)
      .subscribe();
    return () => {
      if (realtimeReloadRef.current) window.clearTimeout(realtimeReloadRef.current);
      supabase.removeChannel(channel);
    };
  }, [clinicId, location]);

  useEffect(() => {
    setSearch('');
    setSelectedContactIds(new Set());
    setContactBulkPanel(null);
    setDrawerOpen(false);
    setContactDrawerTab('details');
    setEditing(null);
    setForm(emptyForm(tabConfigs[activeTab], defaultCurrency));
  }, [activeTab, defaultCurrency]);

  useEffect(() => {
    const existingIds = new Set(rows.contacts.map(row => row.id));
    setSelectedContactIds(previous => {
      const next = new Set(Array.from(previous).filter(id => existingIds.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [rows.contacts]);

  const relatedOptions = useMemo<Record<RelationKey, SelectOption[]>>(() => ({
    companies: rows.companies.map(row => ({ value: row.id, label: rowTitle('companies', row) })),
    contacts: rows.contacts.map(row => ({ value: row.id, label: rowTitle('contacts', row) })),
    deals: rows.deals.map(row => ({ value: row.id, label: rowTitle('deals', row) })),
    products: rows.products.map(row => ({ value: row.id, label: rowTitle('products', row) })),
    invoices: rows.invoices.map(row => ({ value: row.id, label: rowTitle('invoices', row) })),
    payments: rows.payments.map(row => ({ value: row.id, label: rowTitle('payments', row) })),
    agents: agents.map(agent => ({ value: agent.id, label: agent.name })),
    deal_pipelines: dealPipelines,
    deal_stages: dealStages,
  }), [agents, dealPipelines, dealStages, rows]);

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

  const selectedContacts = useMemo(
    () => rows.contacts.filter(row => selectedContactIds.has(row.id)),
    [rows.contacts, selectedContactIds],
  );
  const linkedWazzupContact = useMemo(() => {
    if (activeTab !== 'contacts' || !editing) return null;
    const contactPhone = normalizeWazzupChatId(asString(editing.phone));
    return wazzupContacts.find(contact => contact.contact_id === editing.id)
      ?? wazzupContacts.find(contact => contactPhone && normalizeWazzupChatId(contact.chat_id) === contactPhone)
      ?? null;
  }, [activeTab, editing, wazzupContacts]);

  useEffect(() => {
    if (contactDrawerTab === 'whatsapp' && (!linkedWazzupContact || !user)) {
      setContactDrawerTab('details');
    }
  }, [contactDrawerTab, linkedWazzupContact, user]);
  const allFilteredContactsSelected = activeTab === 'contacts'
    && filteredRows.length > 0
    && filteredRows.every(row => selectedContactIds.has(row.id));
  const someFilteredContactsSelected = activeTab === 'contacts'
    && filteredRows.some(row => selectedContactIds.has(row.id));

  const toggleContactSelection = (id: string) => {
    setSelectedContactIds(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllFilteredContacts = () => {
    setSelectedContactIds(previous => {
      const next = new Set(previous);
      if (allFilteredContactsSelected) filteredRows.forEach(row => next.delete(row.id));
      else filteredRows.forEach(row => next.add(row.id));
      return next;
    });
  };

  const clearContactSelection = () => {
    setSelectedContactIds(new Set());
    setContactBulkPanel(null);
    setContactBulkAgentId('');
    setContactBulkSource('');
  };

  const openCreate = () => {
    setEditing(null);
    setContactDrawerTab('details');
    const nextForm = emptyForm(config, defaultCurrency);
    if (activeTab === 'deals' && dealPipelines[0]) {
      const firstStage = dealStages.find(stage => stage.pipelineId === dealPipelines[0].value);
      nextForm.pipeline_id = dealPipelines[0].value;
      if (firstStage) {
        nextForm.stage_id = firstStage.value;
        nextForm.probability = firstStage.probability ?? 10;
        nextForm.status = firstStage.outcome ?? 'open';
      }
    }
    setForm(nextForm);
    setDrawerOpen(true);
  };

  const openEdit = (row: CrmRow) => {
    setEditing(row);
    setForm(formFromRow(config, row));
    setContactDrawerTab('details');
    setDrawerOpen(true);
  };

  const openSelectedContact = () => {
    if (selectedContacts.length !== 1) {
      toast.error('Для редактирования выберите один контакт');
      return;
    }
    openEdit(selectedContacts[0]);
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

  const bulkUpdateContacts = async (patch: { owner_agent_id?: string | null; source?: string }) => {
    if (!clinicId || selectedContactIds.size === 0) return;
    setContactBulkLoading(true);
    const ids = Array.from(selectedContactIds);
    const updatedRows: CrmRow[] = [];
    try {
      for (const chunk of splitIntoChunks(ids)) {
        const { data, error: updateError } = await supabase
          .from('contacts')
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq('clinic_id', clinicId)
          .in('id', chunk)
          .select('*');
        if (updateError) throw updateError;
        updatedRows.push(...((data ?? []) as CrmRow[]));
      }
    } catch (cause: unknown) {
      toast.error(cause instanceof Error ? cause.message : 'Не удалось обновить выбранные контакты');
      return;
    } finally {
      setContactBulkLoading(false);
    }
    const updated = new Map(updatedRows.map(row => [row.id, row]));
    setRows(previous => ({
      ...previous,
      contacts: previous.contacts.map(row => updated.get(row.id) ?? row),
    }));
    toast.success(`Обновлено контактов: ${updatedRows.length}`);
    clearContactSelection();
  };

  const bulkDeleteContacts = async () => {
    if (!clinicId || selectedContactIds.size === 0) return;
    setContactBulkLoading(true);
    const ids = Array.from(selectedContactIds);
    const deletedIds = new Set<string>();
    try {
      for (const chunk of splitIntoChunks(ids)) {
        const { data, error: deleteError } = await supabase
          .from('contacts')
          .delete()
          .eq('clinic_id', clinicId)
          .in('id', chunk)
          .select('id');
        if (deleteError) throw deleteError;
        for (const row of data ?? []) deletedIds.add(row.id);
      }
    } catch (cause: unknown) {
      if (deletedIds.size > 0) {
        setRows(previous => ({
          ...previous,
          contacts: previous.contacts.filter(row => !deletedIds.has(row.id)),
        }));
        setSelectedContactIds(previous => new Set(Array.from(previous).filter(id => !deletedIds.has(id))));
      }
      const message = cause instanceof Error ? cause.message : 'Не удалось удалить выбранные контакты';
      toast.error(deletedIds.size > 0 ? `Удалено ${deletedIds.size}. Остальные не удалены: ${message}` : message);
      return;
    } finally {
      setContactBulkLoading(false);
    }
    setRows(previous => ({
      ...previous,
      contacts: previous.contacts.filter(row => !deletedIds.has(row.id)),
    }));
    toast.success(`Удалено контактов: ${deletedIds.size}`);
    clearContactSelection();
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

        {activeTab === 'contacts' && (
          <section className="crm-filter-bar flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={toggleAllFilteredContacts}
              disabled={filteredRows.length === 0}
              className="neu-btn flex items-center gap-2 px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Check size={15} />
              {allFilteredContactsSelected ? 'Снять выбор' : 'Выбрать все'}
            </button>
            <span className={`text-sm font-semibold ${selectedContactIds.size > 0 ? 'text-[#3157DE]' : 'text-[#94A3B8]'}`}>
              Выбрано: {selectedContactIds.size}
            </span>

            {selectedContactIds.size > 0 && (
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {contactBulkPanel === 'agent' ? (
                  <>
                    <select
                      value={contactBulkAgentId}
                      onChange={event => setContactBulkAgentId(event.target.value)}
                      className="neu-input min-w-[210px] text-sm"
                      aria-label="Новый ответственный"
                    >
                      <option value="">Без ответственного</option>
                      {agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                    </select>
                    <button
                      type="button"
                      disabled={contactBulkLoading}
                      onClick={() => void bulkUpdateContacts({ owner_agent_id: contactBulkAgentId || null })}
                      className="neu-btn-primary px-4 py-2 text-sm font-semibold disabled:opacity-50"
                    >
                      {contactBulkLoading ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                      Применить
                    </button>
                  </>
                ) : contactBulkPanel === 'source' ? (
                  <>
                    <input
                      value={contactBulkSource}
                      onChange={event => setContactBulkSource(event.target.value)}
                      className="neu-input min-w-[210px] text-sm"
                      placeholder="Новый источник"
                      aria-label="Новый источник"
                    />
                    <button
                      type="button"
                      disabled={!contactBulkSource.trim() || contactBulkLoading}
                      onClick={() => void bulkUpdateContacts({ source: contactBulkSource.trim() })}
                      className="neu-btn-primary px-4 py-2 text-sm font-semibold disabled:opacity-50"
                    >
                      {contactBulkLoading ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                      Применить
                    </button>
                  </>
                ) : contactBulkPanel === 'delete' ? (
                  <>
                    <span className="text-sm font-semibold text-[#DC2626]">Удалить контактов: {selectedContactIds.size}?</span>
                    <button
                      type="button"
                      disabled={contactBulkLoading}
                      onClick={() => void bulkDeleteContacts()}
                      className="flex items-center gap-2 rounded-xl border border-[#FECACA] bg-[#FFF5F5] px-4 py-2 text-sm font-semibold text-[#DC2626] disabled:opacity-50"
                    >
                      {contactBulkLoading ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                      Удалить
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={selectedContactIds.size !== 1}
                      onClick={openSelectedContact}
                      className="neu-btn grid h-9 w-9 place-items-center disabled:cursor-not-allowed disabled:opacity-40"
                      title="Редактировать выбранный контакт"
                      aria-label="Редактировать выбранный контакт"
                    >
                      <PencilLine size={15} />
                    </button>
                    {(userRole === 'owner' || userRole === 'manager') && (
                      <button
                        type="button"
                        onClick={() => setContactBulkPanel('agent')}
                        className="neu-btn grid h-9 w-9 place-items-center"
                        title="Сменить ответственного"
                        aria-label="Сменить ответственного"
                      >
                        <User size={15} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setContactBulkPanel('source')}
                      className="neu-btn grid h-9 w-9 place-items-center"
                      title="Сменить источник"
                      aria-label="Сменить источник"
                    >
                      <Tag size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setContactBulkPanel('delete')}
                      className="grid h-9 w-9 place-items-center rounded-xl border border-[#FECACA] bg-[#FFF5F5] text-[#DC2626]"
                      title="Удалить выбранные контакты"
                      aria-label="Удалить выбранные контакты"
                    >
                      <Trash2 size={15} />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={clearContactSelection}
                  className="neu-btn grid h-9 w-9 place-items-center"
                  title="Снять выбор"
                  aria-label="Снять выбор"
                >
                  <X size={15} />
                </button>
              </div>
            )}
          </section>
        )}

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
                    {activeTab === 'contacts' && (
                      <th className="w-14 px-5 py-4">
                        <IndeterminateCheckbox
                          checked={allFilteredContactsSelected}
                          indeterminate={someFilteredContactsSelected && !allFilteredContactsSelected}
                          onChange={toggleAllFilteredContacts}
                          label="Выбрать все показанные контакты"
                        />
                      </th>
                    )}
                    {config.columns.map(column => <th key={column} className="px-5 py-4 font-bold">{config.fields.find(field => field.key === column)?.label ?? column}</th>)}
                    <th className="px-5 py-4 text-right font-bold">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map(row => {
                    const isSelected = activeTab === 'contacts' && selectedContactIds.has(row.id);
                    return (
                    <tr
                      key={row.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openEdit(row)}
                      onKeyDown={event => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        event.preventDefault();
                        openEdit(row);
                      }}
                      className={`group cursor-pointer border-b border-[#F0F3F8] transition-colors focus-visible:outline-none ${isSelected ? 'bg-[#EEF4FF] hover:bg-[#E7EFFF] focus-visible:bg-[#E7EFFF]' : 'hover:bg-[#FAFBFE] focus-visible:bg-[#F5F8FF]'}`}
                    >
                      {activeTab === 'contacts' && (
                        <td className="w-14 px-5 py-4" onClick={event => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleContactSelection(row.id)}
                            onClick={event => event.stopPropagation()}
                            aria-label={`Выбрать контакт ${rowTitle('contacts', row)}`}
                            className="h-4 w-4 cursor-pointer accent-[#3157DE]"
                          />
                        </td>
                      )}
                      {config.columns.map(column => {
                        const field = config.fields.find(item => item.key === column);
                        const moneyField = column === 'amount' || column === 'total' || column === 'unit_price';
                        const value = moneyField ? formatMoney(row[column], row.currency) : lookupLabel(field, row[column]);
                        return (
                          <td key={column} className="px-5 py-4 align-top text-sm text-[#52657F]">
                            <span className={column === config.titleField ? 'font-semibold text-[#10264B] transition-colors group-hover:text-[#3157DE]' : ''}>{value}</span>
                          </td>
                        );
                      })}
                      <td className="px-5 py-4">
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={event => { event.stopPropagation(); openEdit(row); }} className="neu-btn grid h-9 w-9 place-items-center" title="Редактировать">
                            <PencilLine size={15} />
                          </button>
                          <button type="button" onClick={event => { event.stopPropagation(); void remove(row); }} className="grid h-9 w-9 place-items-center rounded-xl border border-[#FECACA] bg-[#FFF5F5] text-[#DC2626]" title="Удалить">
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );})}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {drawerOpen && (
        <Drawer title={editing ? `Редактировать: ${rowTitle(activeTab, editing)}` : `Создать: ${config.label}`} onClose={() => setDrawerOpen(false)}>
          <div className="space-y-7">
            {activeTab === 'contacts' && editing && (
              <div className="flex gap-1 overflow-x-auto rounded-2xl border border-[#E3EAF2] bg-[#F7F9FC] p-1">
                <ContactDrawerTab
                  active={contactDrawerTab === 'details'}
                  label="Данные"
                  onClick={() => setContactDrawerTab('details')}
                />
                <ContactDrawerTab
                  active={contactDrawerTab === 'deals'}
                  label="Сделки"
                  onClick={() => setContactDrawerTab('deals')}
                />
                {linkedWazzupContact && user && (
                  <ContactDrawerTab
                    active={contactDrawerTab === 'whatsapp'}
                    label="WhatsApp"
                    onClick={() => setContactDrawerTab('whatsapp')}
                  />
                )}
              </div>
            )}

            {(!editing || activeTab !== 'contacts' || contactDrawerTab === 'details') && (
            <form onSubmit={save} className="space-y-4">
              {config.fields.map(field => (
                <FieldEditor
                  key={field.key}
                  field={field}
                  value={form[field.key]}
                  options={field.relation
                    ? field.key === 'stage_id'
                      ? relatedOptions.deal_stages.filter(stage => !form.pipeline_id || stage.pipelineId === form.pipeline_id)
                      : relatedOptions[field.relation]
                    : field.options ?? []}
                  onChange={value => setForm(previous => {
                    if (activeTab === 'deals' && field.key === 'pipeline_id') {
                      const firstStage = dealStages.find(stage => stage.pipelineId === value);
                      return {
                        ...previous,
                        pipeline_id: value,
                        stage_id: firstStage?.value ?? '',
                        probability: firstStage?.probability ?? 10,
                        status: firstStage?.outcome ?? 'open',
                      };
                    }
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
            )}

            {activeTab === 'contacts' && editing && clinicId && contactDrawerTab === 'deals' && (
              <div>
                <ClientDealsTab
                  clinicId={clinicId}
                  userRole={userRole}
                  contact={{
                    id: editing.id,
                    first_name: asString(editing.first_name),
                    last_name: asString(editing.last_name) || null,
                    phone: asString(editing.phone) || null,
                    email: asString(editing.email) || null,
                    source: asString(editing.source) || null,
                    notes: asString(editing.notes) || null,
                    owner_agent_id: asString(editing.owner_agent_id) || null,
                    created_at: asString(editing.created_at) || null,
                  }}
                />
              </div>
            )}

            {activeTab === 'contacts' && editing && clinicId && user && linkedWazzupContact && contactDrawerTab === 'whatsapp' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3 rounded-xl border border-[#E3EAF2] bg-[#F7F9FC] px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-[#10264B]">Переписка Wazzup</p>
                    <p className="mt-0.5 text-xs text-[#71829D]">Канал связан с этим контактом. Сообщения остаются внутри его карточки.</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-[#E8F8EF] px-2.5 py-1 text-xs font-semibold text-[#15803D]">Подключено</span>
                </div>
                <WazzupChat
                  clinicId={clinicId}
                  userId={user.id}
                  userName={user.email ?? undefined}
                  contactPhone={linkedWazzupContact.chat_id}
                  contactName={linkedWazzupContact.name || rowTitle('contacts', editing)}
                  chatType={linkedWazzupContact.chat_type}
                  onDealCreate={() => setContactDrawerTab('deals')}
                  onDealOpen={() => setContactDrawerTab('deals')}
                />
              </div>
            )}
          </div>
        </Drawer>
      )}
    </PageLayout>
  );
}

function ContactDrawerTab({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-w-[110px] flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${active ? 'bg-white text-[#3157DE] shadow-sm' : 'text-[#64748B] hover:bg-white/70 hover:text-[#10264B]'}`}
    >
      {label}
    </button>
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

function IndeterminateCheckbox({ checked, indeterminate, onChange, label }: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
  label: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={inputRef}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label={label}
      className="h-4 w-4 cursor-pointer accent-[#3157DE]"
    />
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
