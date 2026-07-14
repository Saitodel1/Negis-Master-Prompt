export type IndustrySlug = 'clinic' | 'beauty' | 'fitness' | 'education' | 'custom';

export interface VerticalDef {
  slug: IndustrySlug; name: string; icon: string;
  companyLabel: string; leadLabel: string; leadLabelPlural: string;
  agentLabel: string; agentLabelPlural: string; bookingLabel: string;
  serviceLabel: string; serviceLabelPlural: string;
  pipelineSales: string; pipelineBooking: string;
  leadTabs: { id: string; label: string }[];
  leadStatuses: Record<'sales' | 'booking', string[]>;
}

export const VERTICALS: Record<IndustrySlug, VerticalDef> = {
  clinic: {
    slug: 'clinic', name: 'Клиника / Медицина', icon: '🏥',
    companyLabel: 'Клиника', leadLabel: 'Пациент', leadLabelPlural: 'Пациенты',
    agentLabel: 'Врач', agentLabelPlural: 'Врачи', bookingLabel: 'Запись',
    serviceLabel: 'Услуга', serviceLabelPlural: 'Услуги',
    pipelineSales: 'Продажи', pipelineBooking: 'Запись',
    leadTabs: [
      { id: 'overview', label: 'Обзор' }, { id: 'timeline', label: 'Таймлайн' },
      { id: 'bookings', label: 'Записи' }, { id: 'need', label: 'Потребности' },
      { id: 'procedures', label: 'Процедуры' }, { id: 'finance', label: 'Финансы' },
      { id: 'whatsapp', label: 'WhatsApp' }, { id: 'tasks', label: 'Задачи' },
    ],
    leadStatuses: {
      sales: ['Новый', 'Перезвонить', 'Отказ', 'Другой город', 'Противопоказания', 'Возраст'],
      booking: ['Новый', 'Нужно записать', 'Записан', 'Недозвон', 'Отмена'],
    },
  },
  beauty: {
    slug: 'beauty', name: 'Салон красоты / SPA', icon: '💆',
    companyLabel: 'Салон', leadLabel: 'Клиент', leadLabelPlural: 'Клиенты',
    agentLabel: 'Мастер', agentLabelPlural: 'Мастера', bookingLabel: 'Запись',
    serviceLabel: 'Услуга', serviceLabelPlural: 'Услуги',
    pipelineSales: 'Продажи', pipelineBooking: 'Запись',
    leadTabs: [
      { id: 'overview', label: 'Обзор' }, { id: 'timeline', label: 'Таймлайн' },
      { id: 'bookings', label: 'Записи' }, { id: 'need', label: 'Пожелания' },
      { id: 'procedures', label: 'Процедуры' }, { id: 'finance', label: 'Финансы' },
      { id: 'whatsapp', label: 'WhatsApp' }, { id: 'tasks', label: 'Задачи' },
    ],
    leadStatuses: {
      sales: ['Новый', 'Консультация', 'Записан', 'Визит', 'Отказ'],
      booking: ['Новый', 'Перезвонить', 'Записан', 'Недозвон', 'Отмена'],
    },
  },
  fitness: {
    slug: 'fitness', name: 'Фитнес / wellness', icon: 'F',
    companyLabel: 'Бизнес', leadLabel: 'Клиент', leadLabelPlural: 'Клиенты',
    agentLabel: 'Тренер', agentLabelPlural: 'Тренеры', bookingLabel: 'Занятие',
    serviceLabel: 'Услуга', serviceLabelPlural: 'Услуги',
    pipelineSales: 'Продажи', pipelineBooking: 'Расписание',
    leadTabs: [
      { id: 'overview', label: 'Обзор' }, { id: 'timeline', label: 'История' },
      { id: 'bookings', label: 'Занятия' }, { id: 'need', label: 'Потребности' },
      { id: 'procedures', label: 'Абонементы' }, { id: 'finance', label: 'Финансы' },
      { id: 'whatsapp', label: 'WhatsApp' }, { id: 'tasks', label: 'Задачи' },
    ],
    leadStatuses: {
      sales: ['Новый', 'Пробная тренировка', 'Купил абонемент', 'Активный', 'Продление', 'Ушел'],
      booking: ['Новый', 'Записан', 'Пришел', 'Не пришел', 'Отмена'],
    },
  },
  education: {
    slug: 'education', name: 'Курсы / обучение', icon: 'E',
    companyLabel: 'Бизнес', leadLabel: 'Ученик', leadLabelPlural: 'Ученики',
    agentLabel: 'Менеджер', agentLabelPlural: 'Менеджеры', bookingLabel: 'Занятие',
    serviceLabel: 'Программа', serviceLabelPlural: 'Программы',
    pipelineSales: 'Продажи', pipelineBooking: 'Расписание',
    leadTabs: [
      { id: 'overview', label: 'Обзор' }, { id: 'timeline', label: 'История' },
      { id: 'bookings', label: 'Занятия' }, { id: 'need', label: 'Потребности' },
      { id: 'procedures', label: 'Программы' }, { id: 'finance', label: 'Финансы' },
      { id: 'whatsapp', label: 'WhatsApp' }, { id: 'tasks', label: 'Задачи' },
    ],
    leadStatuses: {
      sales: ['Новый', 'Консультация', 'Пробный урок', 'Оплатил курс', 'Учится', 'Продление', 'Потерян'],
      booking: ['Новый', 'Записан', 'Посетил', 'Не пришел', 'Отмена'],
    },
  },
  custom: {
    slug: 'custom', name: 'Другое', icon: 'N',
    companyLabel: 'Бизнес', leadLabel: 'Клиент', leadLabelPlural: 'Клиенты',
    agentLabel: 'Сотрудник', agentLabelPlural: 'Сотрудники', bookingLabel: 'Встреча',
    serviceLabel: 'Услуга', serviceLabelPlural: 'Услуги',
    pipelineSales: 'Продажи', pipelineBooking: 'Записи',
    leadTabs: [
      { id: 'overview', label: 'Обзор' }, { id: 'timeline', label: 'История' },
      { id: 'bookings', label: 'Записи' }, { id: 'need', label: 'Потребности' },
      { id: 'procedures', label: 'Услуги' }, { id: 'finance', label: 'Финансы' },
      { id: 'whatsapp', label: 'WhatsApp' }, { id: 'tasks', label: 'Задачи' },
    ],
    leadStatuses: {
      sales: ['Новый', 'В работе', 'Записан', 'Оплатил', 'Повторный контакт', 'Потерян'],
      booking: ['Новый', 'Записан', 'Пришел', 'Не пришел', 'Отмена'],
    },
  },
};

export function getVertical(slug: IndustrySlug | string | null): VerticalDef {
  if (slug && slug in VERTICALS) return VERTICALS[slug as IndustrySlug];
  return VERTICALS.clinic;
}

export const INDUSTRY_OPTIONS: IndustrySlug[] = ['clinic', 'beauty', 'fitness', 'education', 'custom'];
export const DEFAULT_INDUSTRY: IndustrySlug = 'clinic';
