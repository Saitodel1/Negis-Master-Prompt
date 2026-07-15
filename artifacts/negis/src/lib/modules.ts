export type WorkspaceModuleKey =
  | 'dashboard'
  | 'crm'
  | 'tasks'
  | 'marketplace'
  | 'admin'
  | 'booking'
  | 'reception'
  | 'chat'
  | 'ads'
  | 'reports'
  | 'automations'
  | 'documents'
  | 'negis_app'
  | 'loyalty'
  | 'negis_chatbot'
  | 'ai_assistant';

export type ModuleStatus =
  | 'available'
  | 'pending_payment'
  | 'pending_setup'
  | 'active'
  | 'suspended'
  | 'disabled';

export interface WorkspaceModuleDefinition {
  key: WorkspaceModuleKey;
  label: string;
  description: string;
  href: string | null;
  permission: string;
  core: boolean;
  selectable: boolean;
}

export const WORKSPACE_MODULES: WorkspaceModuleDefinition[] = [
  { key: 'dashboard', label: 'Главная', description: 'Сводка по рабочему пространству', href: '/dashboard', permission: 'dashboard', core: true, selectable: false },
  { key: 'crm', label: 'CRM', description: 'Контакты, компании, сделки, товары, счета и оплаты', href: '/sales', permission: 'crm', core: true, selectable: false },
  { key: 'tasks', label: 'Задачи', description: 'Задачи, сроки и контроль результата', href: '/tasks', permission: 'tasks', core: true, selectable: false },
  { key: 'marketplace', label: 'Маркет', description: 'Интеграции и дополнительные модули', href: '/marketplace', permission: 'marketplace', core: true, selectable: false },
  { key: 'admin', label: 'Админ', description: 'Сотрудники, роли и настройки', href: '/admin', permission: 'admin', core: true, selectable: false },
  { key: 'booking', label: 'Запись', description: 'Расписание, слоты и запись клиентов', href: '/booking', permission: 'booking', core: false, selectable: true },
  { key: 'reception', label: 'Ресепшн', description: 'Приём и отметка прихода клиентов', href: '/reception', permission: 'reception', core: false, selectable: true },
  { key: 'chat', label: 'Чат', description: 'Рабочие чаты и системные карточки', href: '/chat', permission: 'chat', core: false, selectable: true },
  { key: 'ads', label: 'Реклама', description: 'Рекламные кабинеты, лиды и конверсия', href: '/ads', permission: 'ads', core: false, selectable: true },
  { key: 'reports', label: 'Отчёты на главной', description: 'Продажи, сотрудники, источники и оплаты в дашборде', href: null, permission: 'reports', core: false, selectable: true },
  { key: 'automations', label: 'Автоматизации', description: 'Триггеры, условия и действия', href: '/automations', permission: 'automation', core: false, selectable: true },
  { key: 'documents', label: 'Документы', description: 'Документы и связанные процессы', href: null, permission: 'documents', core: false, selectable: false },
  { key: 'negis_app', label: 'Negis App', description: 'Клиентское приложение Negis', href: null, permission: 'negis_app', core: false, selectable: false },
  { key: 'loyalty', label: 'Лояльность', description: 'Бонусы и возврат клиентов', href: null, permission: 'loyalty', core: false, selectable: false },
  { key: 'negis_chatbot', label: 'Negis Чатбот', description: 'Чатбот для подключенного канала', href: null, permission: 'negis_chatbot', core: false, selectable: false },
  { key: 'ai_assistant', label: 'AI-ассистент', description: 'AI-подсказки и сводки', href: null, permission: 'ai_assistant', core: false, selectable: false },
];

export const ROUTED_MODULES = WORKSPACE_MODULES.filter(
  (module): module is WorkspaceModuleDefinition & { href: string } => Boolean(module.href),
);

export const CORE_MODULE_KEYS = WORKSPACE_MODULES.filter(module => module.core).map(module => module.key);
export const SELECTABLE_MODULES = WORKSPACE_MODULES.filter(module => module.selectable);

export const CORE_ACTIVE_MODULES: Record<WorkspaceModuleKey, ModuleStatus> = WORKSPACE_MODULES.reduce(
  (result, module) => ({ ...result, [module.key]: module.core ? 'active' : 'available' }),
  {} as Record<WorkspaceModuleKey, ModuleStatus>,
);
