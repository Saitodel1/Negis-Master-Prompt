import React, { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { 
  BarChart2, 
  CalendarDays, 
  Building2, 
  Briefcase, 
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [location] = useLocation();
  const { signOut, user, userRole } = useAuth();

  const navItems = [
    { href: '/dashboard', icon: BarChart2, label: 'Дашборд', roles: ['owner', 'manager'] },
    { href: '/booking', icon: CalendarDays, label: 'Запись', roles: ['owner', 'manager', 'agent'] },
    { href: '/reception', icon: Building2, label: 'Ресепшн', roles: ['owner', 'manager', 'receptionist'] },
    { href: '/sales', icon: Briefcase, label: 'Negis CRM', roles: ['owner', 'manager', 'agent'] },
    { href: '/admin', icon: Settings, label: 'Админ', roles: ['owner', 'manager'] },
  ];

  const filteredNav = navItems.filter(item => 
    !userRole || item.roles.includes(userRole)
  );

  const getInitials = (email: string) => {
    return email ? email.substring(0, 2).toUpperCase() : 'U';
  };

  const isAdmin = userRole === 'owner' || userRole === 'manager';

  return (
    <aside 
      className={`fixed left-0 top-0 h-screen bg-[#E8EDF2] border-r border-border transition-all duration-300 z-20 flex flex-col ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      <div className="p-4 flex items-center justify-between h-16 border-b border-border shrink-0 relative">
        {!collapsed && (
          <h1 className="text-[#1A56DB] font-extrabold text-2xl tracking-tight">Negis</h1>
        )}
        {collapsed && (
          <h1 className="text-[#1A56DB] font-extrabold text-2xl mx-auto">N</h1>
        )}
        <button 
          onClick={() => setCollapsed(!collapsed)}
          className="neu-icon-btn absolute -right-5 top-3 h-10 w-10 bg-[#E8EDF2] z-30 flex items-center justify-center"
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      <nav className="flex-1 px-4 py-6 space-y-3 overflow-y-auto">
        {filteredNav.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.href} href={item.href}>
              <div
                className={`flex items-center gap-4 px-3 py-3 cursor-pointer ${
                  isActive 
                    ? 'neu-pressed-sm text-[#1A56DB]' 
                    : 'neu-sm text-[#64748B] hover:text-[#1E293B] hover:shadow-[4px_4px_8px_#c5cad4,-4px_-4px_8px_#ffffff]'
                } ${collapsed ? 'justify-center' : ''}`}
                title={collapsed ? item.label : undefined}
              >
                <item.icon size={22} className={isActive ? 'text-[#1A56DB]' : ''} strokeWidth={2} />
                {!collapsed && <span className="font-semibold text-[15px]">{item.label}</span>}
              </div>
            </Link>
          );
        })}
      </nav>

      {isAdmin && !collapsed && (
        <div className="mx-4 mb-4 relative overflow-hidden rounded-xl h-24 flex items-center justify-center shrink-0">
          <div className="absolute inset-0" style={{
            background: 'repeating-linear-gradient(45deg, #000 0, #000 10px, #F59E0B 10px, #F59E0B 20px)'
          }} />
          <div className="absolute inset-0 bg-white/15 backdrop-blur-sm mix-blend-multiply" />
          <span className="relative z-10 text-white font-extrabold tracking-widest uppercase drop-shadow-md">
            ⚠️ НЕ ВХОДИТЬ
          </span>
        </div>
      )}

      <div className="p-4 border-t border-border flex flex-col gap-4 shrink-0 bg-[#E8EDF2] z-10">
        <div className={`flex items-center gap-3 ${collapsed ? 'justify-center' : ''}`}>
          <div className="neu-icon-btn flex-shrink-0 font-bold text-sm text-[#1A56DB]">
            {getInitials(user?.email || '')}
          </div>
          {!collapsed && (
            <div className="overflow-hidden flex-1">
              <p className="text-sm font-semibold truncate text-[#1E293B]">{user?.email || 'User'}</p>
              <p className="text-xs text-[#64748B] truncate font-medium capitalize">{userRole || 'Role'}</p>
            </div>
          )}
        </div>
        <button 
          onClick={signOut}
          className={`neu-btn text-sm font-semibold text-destructive hover:text-white hover:bg-destructive ${collapsed ? 'p-2 justify-center' : 'w-full justify-center'}`}
          title={collapsed ? 'Выйти' : undefined}
        >
          {collapsed ? <LogOut size={18} /> : 'Выйти'}
        </button>
      </div>
    </aside>
  );
}
