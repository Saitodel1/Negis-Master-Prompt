import { Link, useLocation } from 'wouter';
import { BarChart2, CalendarDays, Building2, Briefcase, Settings, LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

const NAV = [
  { href: '/dashboard', icon: BarChart2,    label: 'Дашборд',  roles: ['owner', 'manager'] },
  { href: '/booking',   icon: CalendarDays, label: 'Запись',   roles: ['owner', 'manager', 'agent'] },
  { href: '/reception', icon: Building2,    label: 'Ресепшн',  roles: ['owner', 'manager', 'receptionist'] },
  { href: '/sales',     icon: Briefcase,    label: 'CRM',      roles: ['owner', 'manager', 'agent'] },
  { href: '/admin',     icon: Settings,     label: 'Админ',    roles: ['owner', 'manager'] },
];

export function Sidebar() {
  const [location] = useLocation();
  const { signOut, user, userRole } = useAuth();

  const filtered = NAV.filter(item => !userRole || item.roles.includes(userRole));
  const initials = (user?.email ?? 'U').slice(0, 2).toUpperCase();

  return (
    <aside
      className="fixed left-0 top-0 h-screen flex flex-col z-20 select-none"
      style={{
        width: 78,
        background: '#EEF2F6',
        borderRight: '1px solid #E7ECF3',
      }}
    >
      {/* NEGIS Logo Plate */}
      <div className="flex items-center justify-center shrink-0" style={{ height: 72, padding: '0 12px' }}>
        <div
          style={{
            background: '#DDE5EE',
            borderRadius: 12,
            padding: '7px 10px',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6), 0 1px 3px rgba(15,23,42,0.06)',
            letterSpacing: '0.16em',
            fontSize: 11,
            fontWeight: 600,
            color: '#0B1220',
            textTransform: 'uppercase' as const,
            userSelect: 'none' as const,
            fontFamily: "'Inter', sans-serif",
          }}
        >
          N
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 flex flex-col items-center gap-2 pt-2 pb-4">
        {filtered.map(({ href, icon: Icon, label }) => {
          const active = location === href || location.startsWith(href + '/');
          return (
            <Link key={href} href={href}>
              <div
                title={label}
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 14,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  background: active ? '#FFFFFF' : 'transparent',
                  border: active ? '1px solid #E7ECF3' : '1px solid transparent',
                  boxShadow: active
                    ? '0 2px 8px rgba(15,23,42,0.07), inset 0 1px 0 rgba(255,255,255,0.9)'
                    : '0 1px 2px rgba(15,23,42,0.04), inset 0 1px 0 rgba(255,255,255,0.7)',
                  color: active ? '#1E325C' : '#64748B',
                }}
                className="control-node"
                data-active={active}
              >
                <Icon size={20} strokeWidth={active ? 2 : 1.75} />
              </div>
            </Link>
          );
        })}
      </nav>

      {/* User + Signout */}
      <div
        className="shrink-0 flex flex-col items-center gap-3 pb-5 pt-3"
        style={{ borderTop: '1px solid #E7ECF3' }}
      >
        <div
          title={user?.email}
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: '#DDE5EE',
            border: '1px solid #E7ECF3',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontWeight: 600,
            color: '#1E325C',
            letterSpacing: '0.04em',
            fontFamily: "'Inter', sans-serif",
          }}
        >
          {initials}
        </div>
        <button
          onClick={signOut}
          title="Выйти"
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: 'transparent',
            border: '1px solid transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: '#94A3B8',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.background = '#FFFFFF';
            (e.currentTarget as HTMLButtonElement).style.borderColor = '#E7ECF3';
            (e.currentTarget as HTMLButtonElement).style.color = '#DC2626';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent';
            (e.currentTarget as HTMLButtonElement).style.color = '#94A3B8';
          }}
        >
          <LogOut size={17} />
        </button>
      </div>
    </aside>
  );
}
