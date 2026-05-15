import { useState } from 'react';
import { useLocation } from 'wouter';
import { Bell } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const PAGE_LABELS: Record<string, string> = {
  '/dashboard': 'DASHBOARD',
  '/booking':   'BOOKING',
  '/reception': 'RECEPTION',
  '/sales':     'CRM',
  '/agent':     'AGENT',
  '/admin':     'ADMIN',
};

export function Topbar() {
  const [location] = useLocation();
  const [unreadCount] = useState(3);

  const pageLabel = PAGE_LABELS[location] ?? 'NEGIS';

  const today = new Date().toLocaleDateString('ru', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <header
      className="flex items-center justify-between shrink-0 sticky top-0 z-10 px-8"
      style={{
        height: 56,
        background: 'rgba(244,247,251,0.9)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid #E7ECF3',
      }}
    >
      {/* Left — breadcrumb label */}
      <div className="flex items-center gap-2">
        <span
          style={{
            fontSize: 12,
            fontWeight: 500,
            letterSpacing: '0.14em',
            color: '#94A3B8',
            fontFamily: "'Inter', sans-serif",
            userSelect: 'none',
          }}
        >
          NEGIS
        </span>
        <span style={{ color: '#DDE5EE', fontSize: 14 }}>/</span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.14em',
            color: '#475569',
            fontFamily: "'Inter', sans-serif",
            userSelect: 'none',
          }}
        >
          {pageLabel}
        </span>
      </div>

      {/* Right */}
      <div className="flex items-center gap-4">
        <span
          style={{
            fontSize: 12,
            color: '#94A3B8',
            fontFamily: "'Inter', sans-serif",
            letterSpacing: '0.01em',
          }}
        >
          {today}
        </span>

        <Popover>
          <PopoverTrigger asChild>
            <button
              className="neu-icon-btn relative"
              style={{ width: 36, height: 36, borderRadius: 10 }}
            >
              <Bell size={16} strokeWidth={1.75} />
              {unreadCount > 0 && (
                <span
                  className="absolute -top-0.5 -right-0.5 flex items-center justify-center rounded-full text-white font-bold"
                  style={{
                    background: '#DC2626',
                    fontSize: 9,
                    width: 14,
                    height: 14,
                    fontFamily: "'Inter', sans-serif",
                  }}
                >
                  {unreadCount}
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-80 p-0"
            align="end"
            style={{
              background: '#FFFFFF',
              border: '1px solid #E7ECF3',
              borderRadius: 14,
              boxShadow: '0 12px 32px rgba(15,23,42,0.1)',
            }}
          >
            <div
              className="px-5 py-4 font-semibold text-sm"
              style={{
                borderBottom: '1px solid #E7ECF3',
                color: '#0B1220',
                letterSpacing: '0.01em',
              }}
            >
              Уведомления
            </div>
            <div className="max-h-72 overflow-y-auto">
              {[1, 2, 3].map(i => (
                <div
                  key={i}
                  className="px-5 py-4 cursor-pointer transition-colors"
                  style={{ borderBottom: '1px solid #F4F7FB' }}
                  onMouseEnter={e => ((e.currentTarget as HTMLDivElement).style.background = '#F4F7FB')}
                  onMouseLeave={e => ((e.currentTarget as HTMLDivElement).style.background = 'transparent')}
                >
                  <p className="text-sm font-medium" style={{ color: '#0B1220' }}>Новая запись</p>
                  <p className="text-xs mt-1" style={{ color: '#94A3B8' }}>
                    Клиент записан на 14:00 к агенту.
                  </p>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </header>
  );
}
