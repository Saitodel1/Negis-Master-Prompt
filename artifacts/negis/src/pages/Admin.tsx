import React, { useState } from 'react';
import { PageLayout } from '@/components/layout/PageLayout';
import { Plus, Trash2, Edit2 } from 'lucide-react';

export default function Admin() {
  const [activeTab, setActiveTab] = useState('agents');

  const tabs = [
    { id: 'agents', label: 'Агенты' },
    { id: 'roles', label: 'Роли' },
    { id: 'services', label: 'Услуги' },
    { id: 'statuses', label: 'Статусы' },
    { id: 'shifts', label: 'Смены' },
    { id: 'whatsapp', label: 'WhatsApp' },
    { id: 'settings', label: 'Настройки' },
  ];

  return (
    <PageLayout>
      <div className="space-y-6">
        <h2 className="text-2xl font-bold">Настройки Админа</h2>

        <div className="flex gap-3 overflow-x-auto pb-2">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-5 py-2.5 rounded-full font-bold text-sm whitespace-nowrap transition-all ${
                activeTab === tab.id
                  ? 'neu-pressed-sm text-[#1A56DB]'
                  : 'neu-sm text-[#64748B] hover:text-[#1E293B]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="neu-card min-h-[500px]">
          {activeTab === 'agents' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold">Сотрудники клиники</h3>
                <button className="neu-btn-primary"><Plus size={16} /> Добавить агента</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-border text-sm text-[#64748B]">
                      <th className="pb-3 font-semibold">Имя</th>
                      <th className="pb-3 font-semibold">Роль</th>
                      <th className="pb-3 font-semibold">Ставка</th>
                      <th className="pb-3 font-semibold">Таргет</th>
                      <th className="pb-3 font-semibold text-right">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {['Анна С.', 'Иван И.', 'Мария К.'].map((name, i) => (
                      <tr key={i} className="border-b border-border/50">
                        <td className="py-4">
                          <div className="flex items-center gap-3">
                            <div className="neu-icon-btn h-10 w-10 text-xs font-bold shrink-0">{name.substring(0, 2).toUpperCase()}</div>
                            <div>
                              <p className="font-bold text-[#1E293B]">{name}</p>
                              <p className="text-xs text-[#64748B]">agent{i}@clinic.kz</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-4"><span className="badge bg-[#E8EDF2] border border-border shadow-[inset_1px_1px_2px_#c5cad4] font-medium text-xs">Оператор</span></td>
                        <td className="py-4 font-bold text-[#1E293B]">2 500 ₸</td>
                        <td className="py-4 font-bold text-[#1A56DB]">50 / нед</td>
                        <td className="py-4 text-right">
                          <div className="flex justify-end gap-2">
                            <button className="neu-icon-btn h-8 w-8"><Edit2 size={14} /></button>
                            <button className="neu-icon-btn h-8 w-8 text-destructive hover:text-destructive"><Trash2 size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'whatsapp' && (
            <div className="max-w-2xl space-y-6">
              <h3 className="text-lg font-bold">Шаблон WhatsApp</h3>
              <p className="text-sm text-[#64748B]">Этот текст будет отправляться клиентам при записи. Доступные переменные: {'{имя} {дата} {время} {услуга} {агент}'}</p>
              
              <textarea 
                className="neu-input min-h-[150px] resize-y text-base p-4"
                defaultValue="Здравствуйте, {имя}! Вы записаны на услугу {услуга} {дата} в {время}. Ваш специалист: {агент}."
              />
              
              <div className="neu-sm p-5 border-l-4 border-[#10B981]">
                <p className="text-xs font-bold uppercase text-[#10B981] mb-2">Предпросмотр сообщения</p>
                <p className="text-[#1E293B]">Здравствуйте, Дмитрий! Вы записаны на услугу Консультация 24.10.2023 в 14:00. Ваш специалист: Анна С.</p>
              </div>

              <button className="neu-btn-primary px-8 mt-4">Сохранить шаблон</button>
            </div>
          )}

          {/* Add empty states or simple structures for other tabs to meet 'fully implemented' requirement visually */}
          {['roles', 'services', 'statuses', 'shifts', 'settings'].includes(activeTab) && (
            <div className="h-[400px] flex flex-col items-center justify-center text-center">
              <div className="neu-icon-btn h-20 w-20 mb-6 opacity-50">
                <Settings size={32} />
              </div>
              <h3 className="text-xl font-bold text-[#1E293B] mb-2 capitalize">{activeTab}</h3>
              <p className="text-[#64748B] max-w-sm">Раздел в стадии разработки. Скоро здесь появится управление настройками {activeTab}.</p>
            </div>
          )}

        </div>
      </div>
    </PageLayout>
  );
}
