import { useMemo, useState, type ComponentType } from 'react';
import { PageLayout } from '@/components/layout/PageLayout';
import {
  Bot,
  CheckCircle2,
  CreditCard,
  Headphones,
  Info,
  MessageCircle,
  PhoneCall,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Store,
  X,
} from 'lucide-react';

type CategoryKey = 'negis' | 'messengers' | 'bots' | 'telephony' | 'ai' | 'payments' | 'sms' | 'reputation';
type Status = 'recommended' | 'available' | 'request' | 'soon' | 'connected';

interface MarketplaceItem {
  id: string;
  name: string;
  category: CategoryKey;
  region: string[];
  status: Status;
  tags: string[];
  summary: string;
  details: string;
  priority?: boolean;
}

const CATEGORIES: { key: CategoryKey | 'all'; label: string; icon: ComponentType<{ size?: number }> }[] = [
  { key: 'all', label: 'Все', icon: Sparkles },
  { key: 'negis', label: 'Negis', icon: ShieldCheck },
  { key: 'messengers', label: 'Мессенджеры', icon: MessageCircle },
  { key: 'bots', label: 'Боты', icon: Bot },
  { key: 'telephony', label: 'Телефония', icon: PhoneCall },
  { key: 'ai', label: 'AI', icon: Sparkles },
  { key: 'payments', label: 'Платежи', icon: CreditCard },
  { key: 'sms', label: 'SMS', icon: Headphones },
  { key: 'reputation', label: 'Отзывы', icon: Star },
];

const STATUS_LABEL: Record<Status, string> = {
  recommended: 'Рекомендуем',
  available: 'Доступно',
  request: 'По заявке',
  soon: 'Скоро',
  connected: 'Подключено',
};

const STATUS_CLASS: Record<Status, string> = {
  recommended: 'border-[#C7D2FE] bg-[#EEF2FF] text-[#4F46E5]',
  available: 'border-[#BFDBFE] bg-[#EFF6FF] text-[#2859C5]',
  request: 'border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]',
  soon: 'border-[#E2E8F0] bg-[#F1F5F9] text-[#64748B]',
  connected: 'border-[#BBF7D0] bg-[#F0FDF4] text-[#16A34A]',
};

const ITEMS: MarketplaceItem[] = [
  {
    id: 'negis-app',
    name: 'Negis App',
    category: 'negis',
    region: ['KZ', 'KG'],
    status: 'recommended',
    tags: ['Клиентское приложение', 'QR', 'Бонусы'],
    summary: 'Клиентское приложение для записи, QR-прихода, бонусов, акций и возврата клиента в клинику.',
    details: 'Основной модуль Negis для клиники: клиент записывается сам, приходит по QR, видит бонусы и акции, а администратор получает меньше ручной работы.',
    priority: true,
  },
  {
    id: 'negis-loyalty',
    name: 'Negis Loyalty',
    category: 'negis',
    region: ['KZ', 'KG'],
    status: 'recommended',
    tags: ['Лояльность', 'Повторные визиты'],
    summary: 'Бонусная программа и сценарии возврата клиентов внутри Negis.',
    details: 'Помогает не терять клиента после первой процедуры: начисления, персональные предложения, напоминания и сегменты для повторных продаж.',
    priority: true,
  },
  {
    id: 'negis-ai',
    name: 'Negis AI Assistant',
    category: 'negis',
    region: ['KZ', 'KG'],
    status: 'soon',
    tags: ['AI', 'Подсказки', 'Продажи'],
    summary: 'AI-помощник для подсказок менеджеру по клиентской карточке, задачам и истории касаний.',
    details: 'Будет анализировать историю клиента, оплаты, процедуры и переписки, чтобы предлагать следующий шаг: позвонить, пригласить, предложить курс или закрыть долг.',
  },
  {
    id: 'wazzup',
    name: 'Wazzup',
    category: 'messengers',
    region: ['KZ', 'KG'],
    status: 'available',
    tags: ['WhatsApp', 'Instagram', 'CRM'],
    summary: 'WhatsApp/Instagram-переписки в CRM, распределение обращений и история сообщений в карточке клиента.',
    details: 'Лучший первый шаг для Negis: заявки с рекламы и WhatsApp попадают в CRM, менеджер видит переписку и работает из карточки клиента.',
    priority: true,
  },
  {
    id: 'chat2desk',
    name: 'Chat2Desk',
    category: 'messengers',
    region: ['KZ', 'KG'],
    status: 'request',
    tags: ['WhatsApp', 'Telegram', 'Омниканал'],
    summary: 'Омниканальная платформа для WhatsApp, Telegram, Instagram и операторских чатов.',
    details: 'Подходит клиникам с несколькими филиалами и большим потоком сообщений, когда нужна очередь операторов и контроль качества диалогов.',
  },
  {
    id: 'sendpulse-whatsapp',
    name: 'SendPulse WhatsApp API',
    category: 'messengers',
    region: ['KZ', 'KG'],
    status: 'request',
    tags: ['WhatsApp API', 'Рассылки'],
    summary: 'WhatsApp Business API и шаблонные сообщения для сервисных уведомлений.',
    details: 'Можно использовать для подтверждений записи, напоминаний и реактивации, если клиника готова работать через официальные шаблоны WhatsApp.',
  },
  {
    id: '360dialog',
    name: '360dialog',
    category: 'messengers',
    region: ['KZ', 'KG'],
    status: 'request',
    tags: ['WhatsApp API', 'BSP'],
    summary: 'Провайдер WhatsApp Business API для официального подключения номера.',
    details: 'Нужен, когда клиника хочет стабильную официальную интеграцию WhatsApp без привязки к обычному телефону.',
  },
  {
    id: 'telegram-bot',
    name: 'Telegram Bot API',
    category: 'bots',
    region: ['KZ', 'KG'],
    status: 'available',
    tags: ['Telegram', 'Бот', 'Уведомления'],
    summary: 'Бот для заявок, уведомлений сотрудникам и быстрых действий из Telegram.',
    details: 'Полезен для внутренних уведомлений, задач, оповещений руководителя и простых сценариев записи через Telegram.',
    priority: true,
  },
  {
    id: 'salebot',
    name: 'Salebot',
    category: 'bots',
    region: ['KZ', 'KG'],
    status: 'request',
    tags: ['Боты', 'Воронки'],
    summary: 'Конструктор ботов для WhatsApp, Telegram и автоворонок.',
    details: 'Можно использовать для первичной квалификации клиента перед передачей в Negis, но основной учет клиента лучше вести в CRM.',
  },
  {
    id: 'bothelp',
    name: 'BotHelp',
    category: 'bots',
    region: ['KZ', 'KG'],
    status: 'request',
    tags: ['Боты', 'Рассылки'],
    summary: 'Боты и рассылки для мессенджеров с сегментацией аудитории.',
    details: 'Подходит для прогрева базы и простых цепочек, если клинике нужны маркетинговые сценарии поверх основной CRM.',
  },
  {
    id: 'zadarma',
    name: 'Zadarma',
    category: 'telephony',
    region: ['KZ', 'KG'],
    status: 'available',
    tags: ['IP-телефония', 'Запись звонков', 'АТС'],
    summary: 'Телефония, виртуальная АТС, записи звонков и карточка клиента при входящем звонке.',
    details: 'Практичный вариант для клиник в Казахстане и Кыргызстане: можно фиксировать звонки, связывать их с клиентом и контролировать работу операторов.',
    priority: true,
  },
  {
    id: 'beeline-kz',
    name: 'Beeline Business KZ',
    category: 'telephony',
    region: ['KZ'],
    status: 'request',
    tags: ['Оператор', 'Номера', 'АТС'],
    summary: 'Корпоративная телефония и номера Beeline для клиник в Казахстане.',
    details: 'Полезно, если клиника уже использует номера Beeline и хочет сохранить текущую телефонную инфраструктуру.',
  },
  {
    id: 'beeline-kg',
    name: 'Beeline ВАТС KG',
    category: 'telephony',
    region: ['KG'],
    status: 'request',
    tags: ['Оператор', 'ВАТС'],
    summary: 'Виртуальная АТС Beeline для бизнеса в Кыргызстане.',
    details: 'Можно рассматривать для локальных номеров и маршрутизации звонков в клинике.',
  },
  {
    id: 'binotel',
    name: 'Binotel',
    category: 'telephony',
    region: ['KZ'],
    status: 'request',
    tags: ['АТС', 'Коллтрекинг'],
    summary: 'Виртуальная АТС, аналитика звонков и контроль менеджеров.',
    details: 'Подходит клиникам, которым важны записи разговоров, пропущенные звонки и базовая аналитика операторов.',
  },
  {
    id: 'kazakhtelecom',
    name: 'Kazakhtelecom / ID Phone',
    category: 'telephony',
    region: ['KZ'],
    status: 'soon',
    tags: ['Локальная телефония', 'SIP'],
    summary: 'Локальная телефония для клиник, которые работают на инфраструктуре Казахтелеком.',
    details: 'Можно добавить как вариант для клиник, которые не хотят менять существующего провайдера связи.',
  },
  {
    id: 'mango',
    name: 'Mango Office',
    category: 'telephony',
    region: ['KZ', 'KG'],
    status: 'soon',
    tags: ['АТС', 'Звонки'],
    summary: 'Виртуальная АТС и бизнес-телефония для контроля входящих обращений.',
    details: 'Вариант для клиник, которым нужна развитая телефония, но подключение стоит делать после базовой настройки CRM.',
  },
  {
    id: 'zvonobot',
    name: 'Zvonobot',
    category: 'ai',
    region: ['KZ', 'KG'],
    status: 'request',
    tags: ['Голосовой бот', 'Напоминания'],
    summary: 'Автоматические звонки клиентам: напоминания, подтверждения и реактивация.',
    details: 'Можно использовать для подтверждения визитов, обзвона базы и возврата клиентов, которые давно не приходили.',
    priority: true,
  },
  {
    id: 'tomoru',
    name: 'Tomoru',
    category: 'ai',
    region: ['KZ', 'KG'],
    status: 'request',
    tags: ['AI-оператор', 'Чат-бот'],
    summary: 'AI-ассистенты для обработки входящих обращений и первичной квалификации.',
    details: 'Подойдет для клиники с большим потоком однотипных вопросов, но сделки и пациентская история должны оставаться в Negis.',
  },
  {
    id: 'openai',
    name: 'OpenAI / ChatGPT API',
    category: 'ai',
    region: ['KZ', 'KG'],
    status: 'soon',
    tags: ['AI', 'Скрипты', 'Анализ'],
    summary: 'AI-модели для подсказок менеджерам, анализа переписок и генерации ответов.',
    details: 'Можно использовать внутри Negis AI Assistant, чтобы не давать сотрудникам отдельный хаотичный инструмент.',
  },
  {
    id: 'kaspi-pay',
    name: 'Kaspi Pay',
    category: 'payments',
    region: ['KZ'],
    status: 'available',
    tags: ['Оплаты', 'Kaspi', 'KZ'],
    summary: 'Прием оплат от клиентов и учет платежей в финансовом блоке CRM.',
    details: 'Критично для Казахстана: помогает связать покупку курса, частичную оплату и остаток долга с карточкой клиента.',
    priority: true,
  },
  {
    id: 'kaspi-qr',
    name: 'Kaspi QR',
    category: 'payments',
    region: ['KZ'],
    status: 'request',
    tags: ['QR', 'Оплаты'],
    summary: 'Оплата по QR для ресепшна и быстрых платежей после процедуры.',
    details: 'Удобно для клиник, где клиент оплачивает на месте и важно быстро привязать оплату к продаже или курсу.',
  },
  {
    id: 'halyk-epay',
    name: 'Halyk Epay',
    category: 'payments',
    region: ['KZ'],
    status: 'request',
    tags: ['Карты', 'Онлайн-оплата'],
    summary: 'Онлайн-платежи банковскими картами для клиник в Казахстане.',
    details: 'Подходит для предоплаты, онлайн-счетов и платежей по ссылке.',
  },
  {
    id: 'freedom-pay',
    name: 'Freedom Pay',
    category: 'payments',
    region: ['KZ', 'KG'],
    status: 'request',
    tags: ['Карты', 'Платежи'],
    summary: 'Платежный провайдер для карт и онлайн-оплат в регионе.',
    details: 'Можно использовать для оплат по ссылке и привязки транзакции к карточке клиента.',
  },
  {
    id: 'paybox',
    name: 'PayBox',
    category: 'payments',
    region: ['KZ', 'KG'],
    status: 'request',
    tags: ['Платежи', 'Онлайн'],
    summary: 'Платежные инструменты для приема онлайн-оплат.',
    details: 'Хороший запасной вариант, если у клиники уже есть договор или привычный процесс через PayBox.',
  },
  {
    id: 'mbank',
    name: 'MBank',
    category: 'payments',
    region: ['KG'],
    status: 'request',
    tags: ['Оплаты', 'KG'],
    summary: 'Популярные платежи для клиентов в Кыргызстане.',
    details: 'Важный вариант для кыргызстанских клиник: можно учитывать оплату, частичную оплату и задолженность в финансах клиента.',
    priority: true,
  },
  {
    id: 'elsom',
    name: 'Элсом',
    category: 'payments',
    region: ['KG'],
    status: 'request',
    tags: ['Кошелек', 'KG'],
    summary: 'Локальный платежный инструмент для Кыргызстана.',
    details: 'Может быть полезен клиникам, где часть клиентов платит через локальные кошельки.',
  },
  {
    id: 'o-money',
    name: 'O! Деньги',
    category: 'payments',
    region: ['KG'],
    status: 'request',
    tags: ['Кошелек', 'KG'],
    summary: 'Платежи через O! Деньги для клиник в Кыргызстане.',
    details: 'Добавляет привычный клиентам способ оплаты и помогает фиксировать платеж в CRM.',
  },
  {
    id: 'smsc-kz',
    name: 'SMSC.kz',
    category: 'sms',
    region: ['KZ'],
    status: 'request',
    tags: ['SMS', 'Напоминания'],
    summary: 'SMS-уведомления о записи, переносе визита и статусе оплаты.',
    details: 'Нужен как резервный канал, когда клиент не отвечает в мессенджере или не пользуется приложением.',
  },
  {
    id: 'mobizon',
    name: 'Mobizon',
    category: 'sms',
    region: ['KZ', 'KG'],
    status: 'request',
    tags: ['SMS', 'Рассылки'],
    summary: 'SMS-рассылки и сервисные уведомления для клиентов.',
    details: 'Можно использовать для напоминаний и коротких сервисных сообщений, не заменяя WhatsApp и приложение.',
  },
  {
    id: 'infobip',
    name: 'Infobip',
    category: 'sms',
    region: ['KZ', 'KG'],
    status: 'soon',
    tags: ['SMS', 'WhatsApp', 'Enterprise'],
    summary: 'Крупная омниканальная платформа для сообщений и уведомлений.',
    details: 'Имеет смысл для сетевых клиник, где нужны SLA, массовые отправки и несколько каналов связи.',
  },
  {
    id: '2gis',
    name: '2GIS',
    category: 'reputation',
    region: ['KZ', 'KG'],
    status: 'request',
    tags: ['Отзывы', 'Карты', 'Рейтинг'],
    summary: 'Отзывы и рейтинг клиники в 2GIS, важный канал доверия в Казахстане и Кыргызстане.',
    details: 'Можно использовать для контроля репутации: после успешного визита клиенту отправляется мягкая просьба оставить отзыв.',
    priority: true,
  },
  {
    id: 'google-reviews',
    name: 'Google Reviews',
    category: 'reputation',
    region: ['KZ', 'KG'],
    status: 'request',
    tags: ['Отзывы', 'Google'],
    summary: 'Отзывы в Google Business Profile для доверия и локального поиска.',
    details: 'Полезно клиникам, которые получают клиентов из поиска и карт. Negis может подсказывать, кому отправить просьбу об отзыве.',
  },
  {
    id: 'yandex-maps',
    name: 'Яндекс Карты',
    category: 'reputation',
    region: ['KZ', 'KG'],
    status: 'soon',
    tags: ['Отзывы', 'Карты'],
    summary: 'Отзывы и карточка клиники в Яндекс Картах.',
    details: 'Можно добавить как дополнительный канал репутации для клиник, где Яндекс Карты дают заметный поток клиентов.',
  },
];

export default function Marketplace() {
  const [activeCategory, setActiveCategory] = useState<CategoryKey | 'all'>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<MarketplaceItem | null>(null);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return ITEMS.filter(item => {
      const categoryMatch = activeCategory === 'all' || item.category === activeCategory;
      const searchText = [item.name, item.summary, item.details, ...item.tags, ...item.region].join(' ').toLowerCase();
      return categoryMatch && (!normalized || searchText.includes(normalized));
    });
  }, [activeCategory, query]);

  const priorityItems = ITEMS.filter(item => item.priority);

  return (
    <PageLayout>
      <div className="space-y-6">
        <section className="overflow-hidden rounded-[28px] border border-white/70 bg-white/65 p-6 shadow-[10px_16px_38px_rgba(116,135,154,0.12),inset_1px_1px_0_rgba(255,255,255,0.9)] backdrop-blur-xl">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-[#EFF6FF] px-3 py-1 text-xs font-bold text-[#2859C5]">
                <Store size={14} />
                Маркетплейс интеграций
              </div>
              <h1 className="mt-4 text-3xl font-black tracking-tight text-[#0B1220]">Инструменты для клиник KZ и KG</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[#64748B]">
                Здесь клиника выбирает внешние сервисы, которые усиливают Negis: WhatsApp, телефония,
                платежи, AI, SMS и отзывы. Основной процесс остается внутри CRM.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3 text-center">
              <Metric value={ITEMS.length} label="инструментов" />
              <Metric value={CATEGORIES.length - 1} label="категорий" />
              <Metric value={priorityItems.length} label="в приоритете" />
            </div>
          </div>
        </section>

        <section className="rounded-[24px] border border-[#DDE7F0] bg-white/72 p-4 shadow-[8px_12px_28px_rgba(116,135,154,0.10)] backdrop-blur-xl">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
            <div className="relative min-w-[260px] flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#8EA0B7]" size={18} />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Найти сервис, канал или страну"
                className="h-12 w-full rounded-2xl border border-[#DDE7F0] bg-white/75 pl-11 pr-4 text-sm font-semibold text-[#0B1220] outline-none transition focus:border-[#A9C8FF]"
              />
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {CATEGORIES.map(category => {
                const Icon = category.icon;
                const active = activeCategory === category.key;
                return (
                  <button
                    key={category.key}
                    type="button"
                    onClick={() => setActiveCategory(category.key)}
                    className={`flex shrink-0 items-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold transition ${
                      active ? 'bg-[#1E325C] text-white shadow-lg shadow-[#1E325C]/15' : 'bg-white/80 text-[#5F6F89] hover:bg-[#F8FAFC]'
                    }`}
                  >
                    <Icon size={16} />
                    {category.label}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-[24px] border border-[#DDE7F0] bg-white/70 p-5 shadow-[8px_12px_28px_rgba(116,135,154,0.10)]">
            <h2 className="text-lg font-black text-[#0B1220]">Приоритет подключения</h2>
            <p className="mt-1 text-sm text-[#64748B]">То, что даст клинике быстрый эффект без противоречия основному продукту.</p>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              {priorityItems.slice(0, 8).map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelected(item)}
                  className="flex items-start justify-between gap-3 rounded-2xl border border-[#E7ECF3] bg-white/75 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-lg"
                >
                  <div>
                    <div className="font-black text-[#0B1220]">{item.name}</div>
                    <div className="mt-1 line-clamp-2 text-xs leading-5 text-[#64748B]">{item.summary}</div>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-black ${STATUS_CLASS[item.status]}`}>
                    {STATUS_LABEL[item.status]}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-[24px] border border-[#DDE7F0] bg-[#F8FAFC]/85 p-5 shadow-[8px_12px_28px_rgba(116,135,154,0.10)]">
            <h2 className="text-lg font-black text-[#0B1220]">Логика продажи</h2>
            <div className="mt-4 space-y-3">
              <Step number="1" title="Сначала Negis" text="Клиентская база, записи, задачи, финансы и история касаний должны жить внутри CRM." />
              <Step number="2" title="Потом каналы" text="WhatsApp, телефония, платежи и отзывы подключаются как усилители процесса." />
              <Step number="3" title="Не перегружаем" text="Реклама остается в разделе «Реклама», а онлайн-запись и календарь уже встроены в продукт." />
            </div>
          </div>
        </section>

        <section>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-black text-[#0B1220]">Каталог</h2>
              <p className="mt-1 text-sm text-[#64748B]">Показано {filtered.length} из {ITEMS.length}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {filtered.map(item => (
              <IntegrationCard key={item.id} item={item} onOpen={() => setSelected(item)} />
            ))}
          </div>
        </section>
      </div>

      {selected && <IntegrationModal item={selected} onClose={() => setSelected(null)} />}
    </PageLayout>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-2xl border border-[#E7ECF3] bg-white/78 px-5 py-4 shadow-[inset_1px_1px_0_rgba(255,255,255,0.9)]">
      <div className="text-2xl font-black text-[#0B1220]">{value}</div>
      <div className="mt-1 text-xs font-bold uppercase tracking-[0.12em] text-[#8EA0B7]">{label}</div>
    </div>
  );
}

function Step({ number, title, text }: { number: string; title: string; text: string }) {
  return (
    <div className="flex gap-3 rounded-2xl border border-[#E7ECF3] bg-white/70 p-4">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#1E325C] text-sm font-black text-white">{number}</div>
      <div>
        <div className="text-sm font-black text-[#0B1220]">{title}</div>
        <div className="mt-1 text-sm leading-5 text-[#64748B]">{text}</div>
      </div>
    </div>
  );
}

function IntegrationCard({ item, onOpen }: { item: MarketplaceItem; onOpen: () => void }) {
  const category = CATEGORIES.find(c => c.key === item.category);
  const Icon = category?.icon ?? Store;

  return (
    <article className="rounded-[24px] border border-[#DDE7F0] bg-white/78 p-5 shadow-[8px_12px_28px_rgba(116,135,154,0.10)] transition hover:-translate-y-0.5 hover:shadow-[10px_18px_34px_rgba(116,135,154,0.16)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#EFF6FF] text-[#2859C5]">
            <Icon size={22} />
          </div>
          <div>
            <h3 className="text-base font-black text-[#0B1220]">{item.name}</h3>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {item.region.map(region => (
                <span key={region} className="rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[11px] font-bold text-[#64748B]">
                  {region}
                </span>
              ))}
            </div>
          </div>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-black ${STATUS_CLASS[item.status]}`}>
          {STATUS_LABEL[item.status]}
        </span>
      </div>

      <p className="mt-4 min-h-[44px] text-sm leading-6 text-[#64748B]">{item.summary}</p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {item.tags.map(tag => (
          <span key={tag} className="rounded-full bg-[#EFF6FF] px-2.5 py-1 text-[11px] font-bold text-[#2859C5]">
            {tag}
          </span>
        ))}
      </div>

      <div className="mt-5 flex gap-2">
        <button type="button" className="neu-btn flex flex-1 items-center justify-center gap-2 text-sm" onClick={onOpen}>
          <Info size={14} />
          Подробнее
        </button>
        <button
          type="button"
          className={`rounded-xl px-4 py-2.5 text-sm font-bold ${
            item.status === 'soon'
              ? 'bg-[#F1F5F9] text-[#94A3B8]'
              : 'bg-[#1E325C] text-white shadow-lg shadow-[#1E325C]/15'
          }`}
          onClick={onOpen}
        >
          {item.status === 'soon' ? 'Скоро' : item.status === 'request' ? 'Заявка' : 'Подключить'}
        </button>
      </div>
    </article>
  );
}

function IntegrationModal({ item, onClose }: { item: MarketplaceItem; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/25 p-4 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-[#DDE7F0] bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-[#E7ECF3] px-6 py-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-2xl font-black text-[#0B1220]">{item.name}</h3>
              <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black ${STATUS_CLASS[item.status]}`}>
                {STATUS_LABEL[item.status]}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {item.region.map(region => (
                <span key={region} className="rounded-full bg-[#F1F5F9] px-2.5 py-1 text-xs font-bold text-[#64748B]">{region}</span>
              ))}
              {item.tags.map(tag => (
                <span key={tag} className="rounded-full bg-[#EFF6FF] px-2.5 py-1 text-xs font-bold text-[#2859C5]">{tag}</span>
              ))}
            </div>
          </div>
          <button type="button" className="neu-icon-btn h-9 w-9" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="space-y-5 p-6">
          <div className="rounded-2xl border border-[#E7ECF3] bg-[#F8FAFC] p-4">
            <div className="text-sm font-bold text-[#0B1220]">Что дает клинике</div>
            <p className="mt-2 text-sm leading-6 text-[#64748B]">{item.details}</p>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <InfoBox label="Регион" value={item.region.join(', ')} />
            <InfoBox label="Подключение" value={connectionLabel(item.status)} />
            <InfoBox label="Роль Negis" value={item.category === 'negis' ? 'Основной модуль' : 'Внешний усилитель'} />
          </div>

          <div className="rounded-2xl border border-[#E7ECF3] p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 size={18} className="mt-0.5 text-[#16A34A]" />
              <div>
                <div className="text-sm font-bold text-[#0B1220]">Рекомендация</div>
                <div className="mt-1 text-sm leading-6 text-[#64748B]">
                  {item.category === 'negis'
                    ? 'Показывать как часть экосистемы Negis: это усиливает ценность CRM и удерживает клиента внутри продукта.'
                    : 'Подключать после базовой настройки CRM: клиенты, записи, задачи, финансы и история касаний должны уже работать в Negis.'}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-3">
            <button type="button" className="neu-btn px-5" onClick={onClose}>Закрыть</button>
            <button type="button" className="neu-btn-primary px-5">
              {item.status === 'soon' ? 'Запросить приоритет' : item.status === 'request' ? 'Оставить заявку' : 'Подключить'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function connectionLabel(status: Status) {
  if (status === 'available') return 'Можно начать';
  if (status === 'request') return 'Через заявку';
  if (status === 'connected') return 'Активно';
  if (status === 'recommended') return 'Рекомендуем';
  return 'В очереди';
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#E7ECF3] bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[#94A3B8]">{label}</div>
      <div className="mt-1 text-sm font-black text-[#0B1220]">{value}</div>
    </div>
  );
}
