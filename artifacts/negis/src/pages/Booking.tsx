import React, { useState } from 'react';
import { PageLayout } from '@/components/layout/PageLayout';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/dist/style.css';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

export default function Booking() {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());

  const mockBookings = [
    { id: 1, time: '10:00', name: 'Анна Иванова', phone: '+7 701 123 4567', service: 'Консультация', agent: 'Ирина С.', status: 'Подтверждено' },
    { id: 2, time: '11:30', name: 'Олег Петров', phone: '+7 707 987 6543', service: 'Лечение', agent: 'Алексей В.', status: 'Ожидает' },
    { id: 3, time: '14:00', name: 'Мария К.', phone: '+7 777 555 4433', service: 'Осмотр', agent: 'Ирина С.', status: 'Отменено' },
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Подтверждено': return 'text-green-600 bg-green-500/10';
      case 'Ожидает': return 'text-yellow-600 bg-yellow-500/10';
      case 'Отменено': return 'text-red-600 bg-red-500/10';
      default: return 'text-gray-600 bg-gray-500/10';
    }
  };

  return (
    <PageLayout>
      <div className="h-full flex flex-col">
        <h2 className="text-2xl font-bold mb-6">Расписание</h2>
        
        <div className="flex flex-col lg:flex-row gap-6 flex-1 h-[calc(100vh-140px)]">
          {/* Calendar Sidebar */}
          <div className="neu-card h-min flex-shrink-0 flex justify-center">
            <style>{`
              .rdp { --rdp-cell-size: 40px; margin: 0; }
              .rdp-day_selected { 
                background-color: #1A56DB !important; 
                font-weight: bold;
                border-radius: 12px;
                box-shadow: 2px 2px 5px #c5cad4, -2px -2px 5px #ffffff;
              }
              .rdp-day:hover:not(.rdp-day_selected) {
                background-color: #E8EDF2;
                border-radius: 12px;
                box-shadow: inset 2px 2px 5px #c5cad4, inset -2px -2px 5px #ffffff;
              }
              .rdp-button:focus-visible:not([disabled]) {
                background-color: transparent;
                border: 2px solid #1A56DB;
              }
            `}</style>
            <DayPicker
              mode="single"
              selected={selectedDate}
              onSelect={setSelectedDate}
              locale={ru}
              showOutsideDays
              modifiers={{ booked: [new Date(2023, 9, 24), new Date(2023, 9, 25)] }}
              modifiersStyles={{
                booked: { textDecoration: 'underline', textDecorationColor: '#1A56DB', textUnderlineOffset: '4px' }
              }}
            />
          </div>

          {/* Bookings List */}
          <div className="neu-card flex-1 flex flex-col p-0 overflow-hidden">
            <div className="p-6 border-b border-border bg-[#E8EDF2] z-10 shrink-0">
              <h3 className="text-xl font-bold text-[#1E293B] capitalize">
                {selectedDate ? format(selectedDate, 'EEEE, d MMMM yyyy', { locale: ru }) : 'Выберите дату'}
              </h3>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {mockBookings.map((booking) => (
                <div key={booking.id} className="neu p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="neu-pressed-sm w-16 py-2 flex flex-col items-center justify-center shrink-0">
                      <span className="text-lg font-bold text-[#1A56DB] leading-none">{booking.time.split(':')[0]}</span>
                      <span className="text-xs font-semibold text-[#64748B] leading-none mt-1">{booking.time.split(':')[1]}</span>
                    </div>
                    <div>
                      <h4 className="font-bold text-[#1E293B] text-lg">{booking.name}</h4>
                      <p className="text-sm font-medium text-[#64748B]">{booking.phone}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="badge bg-[#E8EDF2] border border-border shadow-[inset_1px_1px_3px_#c5cad4,inset_-1px_-1px_3px_#ffffff] text-[#1E293B]">
                          {booking.service}
                        </span>
                        <span className="text-xs font-medium text-[#64748B] flex items-center">
                          <span className="w-1.5 h-1.5 rounded-full bg-border mr-1.5" />
                          {booking.agent}
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between md:flex-col md:items-end gap-3 md:gap-4 ml-20 md:ml-0 border-t border-border/50 pt-3 md:border-0 md:pt-0">
                    <select 
                      className={`text-xs font-bold px-3 py-1.5 rounded-full border-none outline-none appearance-none cursor-pointer ${getStatusColor(booking.status)}`}
                      defaultValue={booking.status}
                    >
                      <option value="Подтверждено">Подтверждено</option>
                      <option value="Ожидает">Ожидает</option>
                      <option value="Отменено">Отменено</option>
                    </select>
                    
                    <button className="text-sm font-semibold text-[#1A56DB] hover:underline">Редактировать</button>
                  </div>
                </div>
              ))}
              
              {mockBookings.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-[#64748B] py-12">
                  <CalendarDays size={48} className="mb-4 opacity-20" />
                  <p className="font-medium text-lg">Нет записей на этот день</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
