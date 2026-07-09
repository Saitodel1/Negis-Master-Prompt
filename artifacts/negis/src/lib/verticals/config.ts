export type IndustrySlug = 'clinic' | 'beauty';

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
};

export function getVertical(slug: IndustrySlug | string | null): VerticalDef {
  if (slug && slug in VERTICALS) return VERTICALS[slug as IndustrySlug];
  return VERTICALS.clinic;
}

export const INDUSTRY_OPTIONS: IndustrySlug[] = ['clinic', 'beauty'];
export const DEFAULT_INDUSTRY: IndustrySlug = 'clinic';
