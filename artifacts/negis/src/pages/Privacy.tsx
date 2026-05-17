import { Link } from "wouter";

export default function Privacy() {
  return (
    <div style={{ minHeight: '100vh', background: '#E8EDF2', padding: '40px 16px 60px' }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>

        <Link href="/" style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          color: '#64748B', fontSize: 14, textDecoration: 'none',
          marginBottom: 28, fontFamily: "'Inter', sans-serif",
        }}>
          ← На главную
        </Link>

        <div style={{
          background: '#FFFFFF', borderRadius: 20, padding: '48px 52px',
          boxShadow: '6px 6px 16px #C8CDD4, -6px -6px 16px #FFFFFF',
          fontFamily: "'Inter', sans-serif",
        }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#0B1220', margin: '0 0 8px' }}>
            Политика конфиденциальности Negis
          </h1>
          <p style={{ fontSize: 14, color: '#94A3B8', margin: '0 0 44px' }}>
            Последнее обновление: май 2026
          </p>

          <Section title="1. Общие положения">
            Negis (negis.online) — операционная платформа для управления клиниками в Казахстане.
            Настоящая политика описывает как мы собираем, используем и защищаем ваши данные.
          </Section>

          <Section title="2. Какие данные мы собираем">
            <ul style={UL}>
              <li style={LI}>Email и пароль для входа в систему</li>
              <li style={LI}>Название клиники и контактные данные владельца</li>
              <li style={LI}>Данные пациентов, вносимые сотрудниками клиники: имя, телефон, возраст</li>
              <li style={LI}>Статистика рекламных кампаний из Facebook Ads и TikTok Ads</li>
              <li style={LI}>Данные о записях, лидах и сменах сотрудников</li>
            </ul>
          </Section>

          <Section title="3. Как мы используем данные">
            <ul style={UL}>
              <li style={LI}>Для предоставления услуг платформы</li>
              <li style={LI}>Для отображения статистики и аналитики</li>
              <li style={LI}>Для отправки уведомлений через Telegram и WhatsApp</li>
              <li style={{ ...LI, fontWeight: 600, color: '#0B1220' }}>Мы НЕ продаём данные третьим лицам</li>
              <li style={{ ...LI, fontWeight: 600, color: '#0B1220' }}>Мы НЕ передаём данные рекламным сетям</li>
            </ul>
          </Section>

          <Section title="4. Facebook и TikTok данные">
            Мы используем Facebook Marketing API и TikTok Marketing API только для получения
            статистики рекламных кампаний. Мы не храним рекламные креативы и не управляем
            кампаниями без явного разрешения пользователя. Все данные обрабатываются в
            соответствии с политиками Meta и TikTok.
          </Section>

          <Section title="5. Хранение и защита данных">
            Все данные хранятся в защищённой базе данных Supabase на серверах в США. Данные
            каждой клиники полностью изолированы от других клиник. Доступ к данным имеют
            только авторизованные сотрудники клиники.
          </Section>

          <Section title="6. Удаление данных">
            Вы можете запросить полное удаление своих данных, отправив письмо на{' '}
            <a href="mailto:support@negis.online" style={{ color: '#1A56DB' }}>support@negis.online</a>.
            Данные будут удалены в течение 30 рабочих дней.
          </Section>

          <Section title="7. Cookies">
            Мы используем cookies исключительно для поддержания сессии входа в систему.
            Мы не используем cookies для рекламного таргетинга или отслеживания.
          </Section>

          <Section title="8. Контакты" last>
            По всем вопросам конфиденциальности:
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span>Email: <a href="mailto:support@negis.online" style={{ color: '#1A56DB' }}>support@negis.online</a></span>
              <span>Сайт: <a href="https://negis.online" target="_blank" rel="noreferrer" style={{ color: '#1A56DB' }}>negis.online</a></span>
              <span>Адрес: Казахстан, Астана</span>
            </div>
          </Section>

          <div style={{
            borderTop: '1px solid #E7ECF3', paddingTop: 24, marginTop: 8,
            color: '#94A3B8', fontSize: 13, textAlign: 'center',
          }}>
            © 2026 Negis. Все права защищены.
          </div>
        </div>
      </div>
    </div>
  );
}

const UL: React.CSSProperties = { margin: '0', padding: '0 0 0 20px' };
const LI: React.CSSProperties = { marginBottom: 8, color: '#475569', fontSize: 15, lineHeight: 1.6 };

function Section({ title, children, last }: {
  title: string; children: React.ReactNode; last?: boolean;
}) {
  return (
    <div style={{ marginBottom: last ? 36 : 36 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: '#0B1220', margin: '0 0 12px' }}>{title}</h2>
      <div style={{ fontSize: 15, color: '#475569', lineHeight: 1.75 }}>{children}</div>
      {!last && <div style={{ height: 1, background: '#F1F5F9', marginTop: 32 }} />}
    </div>
  );
}
