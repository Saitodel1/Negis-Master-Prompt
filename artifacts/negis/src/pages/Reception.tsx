import React, { useState } from 'react';
import { PageLayout } from '@/components/layout/PageLayout';
import { Check, X } from 'lucide-react';
import { toast } from 'sonner';

export default function Reception() {
  const [bookings, setBookings] = useState([
    { id: 1, time: '10:00', name: 'Игорь Смирнов', phone: '+7 701 123 4567', age: 34, service: 'Первичная консультация', visited: null },
    { id: 2, time: '11:30', name: 'Алина Касымова', phone: '+7 707 987 6543', age: 28, service: 'УЗИ', visited: true },
    { id: 3, time: '14:00', name: 'Марат Омаров', phone: '+7 777 555 4433', age: 45, service: 'Повторный прием', visited: false },
    { id: 4, time: '15:15', name: 'Елена В.', phone: '+7 702 333 2211', age: 31, service: 'Консультация', visited: null },
  ]);

  const handleStatus = (id: number, visited: boolean) => {
    setBookings(bookings.map(b => b.id === id ? { ...b, visited } : b));
    toast.success(`Статус обновлен: ${visited ? 'Пришёл' : 'Не пришёл'}`);
  };

  return (
    <PageLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">Приём клиентов (На сегодня)</h2>
          <div className="neu-sm px-4 py-2 font-bold text-[#1A56DB]">
            24 октября 2023
          </div>
        </div>

        <div className="neu-card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead>
                <tr className="border-b border-border text-[#64748B] text-sm">
                  <th className="p-5 font-semibold w-24">Время</th>
                  <th className="p-5 font-semibold">Имя</th>
                  <th className="p-5 font-semibold">Телефон</th>
                  <th className="p-5 font-semibold w-24">Возраст</th>
                  <th className="p-5 font-semibold">Услуга</th>
                  <th className="p-5 font-semibold text-center w-64">Статус визита</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.id} className="border-b border-border/50 hover:bg-white/30 transition-colors">
                    <td className="p-5 font-bold text-[#1E293B] text-lg">{b.time}</td>
                    <td className="p-5 font-bold text-[#1E293B]">{b.name}</td>
                    <td className="p-5 text-sm font-medium text-[#64748B]">{b.phone}</td>
                    <td className="p-5 text-sm text-[#1E293B]">{b.age}</td>
                    <td className="p-5">
                      <span className="badge bg-[#E8EDF2] border border-border shadow-[inset_1px_1px_3px_#c5cad4,inset_-1px_-1px_3px_#ffffff] text-[#1E293B]">
                        {b.service}
                      </span>
                    </td>
                    <td className="p-5">
                      <div className="flex items-center justify-center gap-3">
                        <button 
                          onClick={() => handleStatus(b.id, true)}
                          className={`w-32 py-2 rounded-full font-bold text-sm flex items-center justify-center gap-1.5 transition-all ${
                            b.visited === true 
                              ? 'neu-pressed-sm text-green-600 bg-green-500/10' 
                              : 'neu-sm text-[#64748B] hover:text-green-600 hover:shadow-[4px_4px_8px_#c5cad4,-4px_-4px_8px_#ffffff]'
                          }`}
                        >
                          <Check size={16} strokeWidth={3} /> Пришёл
                        </button>
                        <button 
                          onClick={() => handleStatus(b.id, false)}
                          className={`w-32 py-2 rounded-full font-bold text-sm flex items-center justify-center gap-1.5 transition-all ${
                            b.visited === false 
                              ? 'neu-pressed-sm text-red-600 bg-red-500/10' 
                              : 'neu-sm text-[#64748B] hover:text-red-600 hover:shadow-[4px_4px_8px_#c5cad4,-4px_-4px_8px_#ffffff]'
                          }`}
                        >
                          <X size={16} strokeWidth={3} /> Не пришёл
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
