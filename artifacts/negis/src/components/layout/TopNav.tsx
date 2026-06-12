import { useState, type CSSProperties } from 'react';
import { Link, useLocation } from 'wouter';
import {
  BarChart2,
  CalendarDays,
  Building2,
  Briefcase,
  Settings,
  LogOut,
  X,
  Check,
  KeyRound,
  User,
  Megaphone,
  ClipboardList,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

const NAV = [
  { href: '/dashboard', icon: BarChart2, label: 'Дашборд', roles: ['owner', 'manager'] },
  { href: '/booking', icon: CalendarDays, label: 'Запись', roles: ['owner', 'manager', 'agent', 'booking_agent'] },
  { href: '/reception', icon: Building2, label: 'Ресепшн', roles: ['owner', 'manager', 'receptionist', 'booking_agent'] },
  { href: '/sales', icon: Briefcase, label: 'Клиенты', roles: ['owner', 'manager', 'agent'] },
  { href: '/tasks', icon: ClipboardList, label: 'Задачи', roles: ['owner', 'manager', 'agent'] },
  { href: '/ads', icon: Megaphone, label: 'Реклама', roles: ['owner', 'manager'] },
  { href: '/admin', icon: Settings, label: 'Админ', roles: ['owner', 'manager'] },
];

export function TopNav() {
  const [location] = useLocation();
  const { signOut, user, userRole } = useAuth();
  const [showProfile, setShowProfile] = useState(false);
  const [fullName, setFullName] = useState(user?.user_metadata?.full_name ?? '');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const filtered = NAV.filter(item => !userRole || item.roles.includes(userRole));
  const initials = (user?.user_metadata?.full_name ?? user?.email ?? 'U')
    .split(' ')
    .map((w: string) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const openProfile = () => {
    setFullName(user?.user_metadata?.full_name ?? '');
    setNewPassword('');
    setShowProfile(true);
  };

  const saveProfile = async () => {
    if (!fullName.trim()) {
      toast.error('Введите имя');
      return;
    }
    if (newPassword && newPassword.length < 6) {
      toast.error('Пароль: минимум 6 символов');
      return;
    }
    setSaving(true);
    try {
      const updates: { data?: { full_name: string }; password?: string } = {
        data: { full_name: fullName.trim() },
      };
      if (newPassword) updates.password = newPassword;
      const { error } = await supabase.auth.updateUser(updates);
      if (error) throw error;
      toast.success('Профиль сохранён');
      setShowProfile(false);
      setNewPassword('');
    } catch (e: any) {
      toast.error(e.message || 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: CSSProperties = {
    background: 'rgba(255,255,255,0.72)',
    border: '1px solid rgba(211,222,231,0.95)',
    borderRadius: 14,
    padding: '12px 14px',
    fontSize: 14,
    color: '#0B1220',
    fontFamily: "'Inter', sans-serif",
    outline: 'none',
    width: '100%',
    boxShadow: 'inset 2px 2px 6px rgba(133, 153, 174, 0.10), inset -2px -2px 7px rgba(255,255,255,0.95)',
  };

  return (
    <>
      <nav className="soft-dock sticky top-14 z-20 shrink-0 px-5 py-3">
        <div className="flex items-center gap-3">
          <button type="button" onClick={openProfile} className="soft-avatar shrink-0" title="Профиль">
            {initials}
          </button>

          <div className="topnav-scroll flex-1 overflow-x-auto">
            <div className="inline-flex min-w-max items-center gap-2 rounded-[26px] border border-white/70 bg-white/55 p-1.5 shadow-[8px_10px_28px_rgba(116,135,154,0.14),inset_1px_1px_0_rgba(255,255,255,0.9)] backdrop-blur-xl">
              {filtered.map(({ href, icon: Icon, label }) => {
                const active = location === href || location.startsWith(href + '/');
                return (
                  <Link key={href} href={href}>
                    <div className={`topnav-item ${active ? 'is-active' : ''}`} title={label}>
                      <Icon size={18} strokeWidth={active ? 2.2 : 1.8} />
                      <span>{label}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>

          <button type="button" onClick={signOut} className="soft-icon-btn shrink-0" title="Выйти">
            <LogOut size={18} />
          </button>
        </div>
      </nav>

      {showProfile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(92, 105, 120, 0.26)', backdropFilter: 'blur(14px)' }}
          onClick={e => {
            if (e.target === e.currentTarget) setShowProfile(false);
          }}
        >
          <div className="soft-modal w-full max-w-[380px] p-7">
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="soft-avatar">{initials}</div>
                <div>
                  <div className="text-sm font-semibold text-[#0B1220]">
                    {user?.user_metadata?.full_name || 'Профиль'}
                  </div>
                  <div className="mt-0.5 text-xs text-[#8A99AD]">{user?.email}</div>
                </div>
              </div>
              <button type="button" onClick={() => setShowProfile(false)} className="soft-icon-btn">
                <X size={16} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#687995]">
                  <User size={12} />
                  Имя
                </label>
                <input
                  style={inputStyle}
                  placeholder="Ваше имя"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                />
              </div>

              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#687995]">
                  <KeyRound size={12} />
                  Новый пароль
                </label>
                <input
                  type="password"
                  style={inputStyle}
                  placeholder="Оставьте пустым, чтобы не менять"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => setShowProfile(false)} className="neu-btn flex-1">
                Отмена
              </button>
              <button type="button" onClick={saveProfile} disabled={saving} className="neu-btn-primary flex-1">
                <Check size={15} />
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setShowProfile(false);
                signOut();
              }}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-red-100 bg-white/55 px-4 py-2.5 text-sm font-semibold text-red-600 transition hover:bg-red-50"
            >
              <LogOut size={15} />
              Выйти из системы
            </button>
          </div>
        </div>
      )}
    </>
  );
}
