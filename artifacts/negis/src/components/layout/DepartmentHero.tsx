import { useLocation } from 'wouter';

const HERO_COPY: Record<string, { title: string; description: string }> = {
  '/dashboard': {
    title: 'Главная',
    description: 'Ключевые показатели клиники, загрузка, записи и операционная активность в одном рабочем пространстве.',
  },
  '/booking': {
    title: 'Запись',
    description: 'Управление заявками, расписанием и слотами записи без лишнего шума.',
  },
  '/reception': {
    title: 'Ресепшн',
    description: 'Приём клиентов, статусы визитов, QR-проход и ежедневная работа администратора.',
  },
  '/sales': {
    title: 'Клиенты',
    description: 'Клиенты, история обращений, задачи, финансы и записи — всё в одном рабочем пространстве.',
  },
  '/tasks': {
    title: 'Задачи',
    description: 'Задачи сотрудников, сроки, приоритеты и контроль выполнения по клиентам.',
  },
  '/chat': {
    title: 'Чат',
    description: 'Командные обсуждения и личные сообщения сотрудников внутри клиники.',
  },
  '/marketplace': {
    title: 'Маркет',
    description: 'Интеграции для клиник: мессенджеры, телефония, AI, платежи, SMS и отзывы.',
  },
  '/ads': {
    title: 'Реклама',
    description: 'Рекламные источники, лиды, конверсия и эффективность каналов привлечения.',
  },
  '/admin': {
    title: 'Админ',
    description: 'Настройки клиники, сотрудники, роли, услуги, статусы, филиалы и интеграции.',
  },
};

export function DepartmentHero() {
  const [location] = useLocation();
  const cleanLocation = location.split('?')[0];
  const copy = HERO_COPY[cleanLocation];

  if (!copy) return null;

  return (
    <section className="department-hero" aria-label={copy.title}>
      <div className="department-hero-content">
        <h1>{copy.title}</h1>
        <p>{copy.description}</p>
      </div>
    </section>
  );
}
