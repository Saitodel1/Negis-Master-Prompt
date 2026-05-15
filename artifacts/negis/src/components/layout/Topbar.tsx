import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { Bell } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export function Topbar() {
  const [location] = useLocation();
  const [unreadCount, setUnreadCount] = useState(3); // Mock for now

  const getPageTitle = () => {
    if (location === '/dashboard') return 'Дашборд';
    if (location === '/booking') return 'Запись';
    if (location === '/reception') return 'Ресепшн';
    if (location === '/sales') return 'Negis CRM';
    if (location === '/admin') return 'Настройки Админа';
    return 'Negis';
  };

  return (
    <header className="h-16 px-8 flex items-center justify-between bg-[#E8EDF2] sticky top-0 z-10">
      <h2 className="text-xl font-bold text-foreground">{getPageTitle()}</h2>
      
      <div className="flex items-center gap-4">
        <Popover>
          <PopoverTrigger asChild>
            <button className="neu-icon-btn relative">
              <Bell size={20} />
              {unreadCount > 0 && (
                <span className="absolute top-0 right-0 bg-destructive text-white text-[10px] font-bold h-4 w-4 rounded-full flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0 neu-card border-none mt-2" align="end">
            <div className="p-4 border-b border-border">
              <h3 className="font-semibold text-sm">Уведомления</h3>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {/* Mock Notifications */}
              {[1, 2, 3].map((i) => (
                <div key={i} className="p-4 border-b border-border/50 hover:bg-black/5 cursor-pointer transition-colors">
                  <p className="text-sm font-medium">Новая запись</p>
                  <p className="text-xs text-muted-foreground mt-1">Клиент Иван записан на 14:00 к агенту Анне.</p>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </header>
  );
}
