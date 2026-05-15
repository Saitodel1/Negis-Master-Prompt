import React, { useState } from 'react';
import { PageLayout } from '@/components/layout/PageLayout';
import { Search, Plus, Filter, MoreHorizontal, User, Clock, CheckCircle, PhoneCall, X } from 'lucide-react';

const mockLeads = [
  { id: 1, name: 'Дмитрий В.', phone: '+7 777 111 22 33', source: 'Instagram', status: 'Новый', statusColor: 'bg-blue-500', agent: 'Анна С.', date: '24.10.2023' },
  { id: 2, name: 'Елена К.', phone: '+7 701 555 66 77', source: '2GIS', status: 'Перезвонить', statusColor: 'bg-yellow-500', agent: 'Иван И.', date: '24.10.2023' },
  { id: 3, name: 'Алексей М.', phone: '+7 707 999 88 77', source: 'WhatsApp', status: 'Записан', statusColor: 'bg-green-500', agent: 'Мария К.', date: '23.10.2023' },
  { id: 4, name: 'Светлана Р.', phone: '+7 702 333 44 55', source: 'Google', status: 'Отказ', statusColor: 'bg-red-500', agent: 'Анна С.', date: '22.10.2023' },
];

export default function Sales() {
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<any>(null);

  const openLeadDetail = (lead: any) => {
    setSelectedLead(lead);
    setIsDetailModalOpen(true);
  };

  return (
    <PageLayout>
      <div className="space-y-6 h-full flex flex-col">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <h2 className="text-2xl font-bold">Negis CRM</h2>
          <button className="neu-btn-primary">
            <Plus size={18} />
            Новый лид
          </button>
        </div>

        <div className="neu-card p-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input 
                type="text" 
                placeholder="Поиск по имени или телефону" 
                className="neu-input pl-11"
              />
            </div>
            <div className="flex gap-3 overflow-x-auto pb-2 md:pb-0">
              <select className="neu-sm px-4 py-2 bg-transparent text-sm font-medium border-none outline-none cursor-pointer text-[#1E293B]">
                <option>Статус</option>
              </select>
              <select className="neu-sm px-4 py-2 bg-transparent text-sm font-medium border-none outline-none cursor-pointer text-[#1E293B]">
                <option>Ответственный</option>
              </select>
              <select className="neu-sm px-4 py-2 bg-transparent text-sm font-medium border-none outline-none cursor-pointer text-[#1E293B]">
                <option>Источник</option>
              </select>
            </div>
          </div>
        </div>

        <div className="neu-card flex-1 overflow-hidden flex flex-col p-0">
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border text-[#64748B] text-sm">
                  <th className="p-4 font-semibold">Имя</th>
                  <th className="p-4 font-semibold">Телефон</th>
                  <th className="p-4 font-semibold">Источник</th>
                  <th className="p-4 font-semibold">Статус</th>
                  <th className="p-4 font-semibold">Ответственный</th>
                  <th className="p-4 font-semibold">Дата</th>
                  <th className="p-4 font-semibold text-right">Действия</th>
                </tr>
              </thead>
              <tbody>
                {mockLeads.map((lead) => (
                  <tr 
                    key={lead.id} 
                    className="border-b border-border/50 hover:bg-[#1A56DB]/5 cursor-pointer transition-colors"
                    onClick={() => openLeadDetail(lead)}
                  >
                    <td className="p-4 font-medium text-[#1E293B]">{lead.name}</td>
                    <td className="p-4 text-sm">{lead.phone}</td>
                    <td className="p-4 text-sm text-[#64748B]">{lead.source}</td>
                    <td className="p-4">
                      <div className="badge bg-[#E8EDF2] border border-border shadow-[inset_1px_1px_3px_#c5cad4,inset_-1px_-1px_3px_#ffffff]">
                        <div className={`w-2 h-2 rounded-full mr-2 ${lead.statusColor}`} />
                        <span className="text-[#1E293B]">{lead.status}</span>
                      </div>
                    </td>
                    <td className="p-4 text-sm">{lead.agent}</td>
                    <td className="p-4 text-sm text-[#64748B]">{lead.date}</td>
                    <td className="p-4 text-right">
                      <button className="neu-icon-btn h-8 w-8 inline-flex" onClick={(e) => { e.stopPropagation(); }}>
                        <MoreHorizontal size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Lead Detail Modal */}
      {isDetailModalOpen && selectedLead && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4 md:p-8">
          <div className="bg-[#E8EDF2] w-full max-w-5xl h-[90vh] rounded-[24px] shadow-2xl flex flex-col overflow-hidden relative border border-white/40">
            <button 
              className="absolute top-4 right-4 neu-icon-btn z-10 bg-[#E8EDF2]"
              onClick={() => setIsDetailModalOpen(false)}
            >
              <X size={20} />
            </button>
            
            <div className="flex flex-col md:flex-row h-full">
              {/* LEFT 60% */}
              <div className="w-full md:w-3/5 p-8 overflow-y-auto border-r border-border">
                <div className="flex items-center gap-6 mb-8">
                  <div className="neu-icon-btn h-20 w-20 text-2xl font-bold text-[#1A56DB] shrink-0">
                    {selectedLead.name.substring(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h2 className="text-3xl font-bold text-[#1E293B]">{selectedLead.name}</h2>
                    <p className="text-[#64748B] font-medium">{selectedLead.phone}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
                  <div>
                    <label className="block text-sm font-semibold mb-2 text-[#1E293B] ml-1">Имя</label>
                    <input type="text" className="neu-input" defaultValue={selectedLead.name.split(' ')[0]} />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-2 text-[#1E293B] ml-1">Фамилия</label>
                    <input type="text" className="neu-input" defaultValue={selectedLead.name.split(' ')[1]} />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-2 text-[#1E293B] ml-1">Телефон</label>
                    <input type="text" className="neu-input" defaultValue={selectedLead.phone} />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-2 text-[#1E293B] ml-1">Возраст</label>
                    <input type="number" className="neu-input" placeholder="Введите возраст" />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
                  <div>
                    <label className="block text-sm font-semibold mb-2 text-[#1E293B] ml-1">Статус</label>
                    <select className="neu-input bg-transparent" defaultValue={selectedLead.status}>
                      <option value="Новый">Новый</option>
                      <option value="Перезвонить">Перезвонить</option>
                      <option value="Записан">Записан</option>
                      <option value="Отказ">Отказ</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-2 text-[#1E293B] ml-1">Источник</label>
                    <select className="neu-input bg-transparent" defaultValue={selectedLead.source}>
                      <option value="Instagram">Instagram</option>
                      <option value="2GIS">2GIS</option>
                      <option value="WhatsApp">WhatsApp</option>
                      <option value="Google">Google</option>
                    </select>
                  </div>
                </div>

                <div className="mb-8">
                  <label className="block text-sm font-semibold mb-2 text-[#1E293B] ml-1">Комментарий</label>
                  <textarea className="neu-input min-h-[120px] resize-y" placeholder="Добавьте заметки о клиенте..." />
                </div>

                <button className="neu-btn-primary px-8">
                  Сохранить изменения
                </button>
              </div>

              {/* RIGHT 40% */}
              <div className="w-full md:w-2/5 p-8 bg-[#E8EDF2] flex flex-col h-full">
                <div className="flex-1 overflow-y-auto mb-6">
                  <h3 className="text-xl font-bold mb-6 text-[#1E293B]">История действий</h3>
                  
                  <div className="space-y-6 relative before:absolute before:inset-0 before:ml-[15px] before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-border">
                    
                    <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full border border-white bg-[#E8EDF2] shadow-[2px_2px_4px_#c5cad4,-2px_-2px_4px_#ffffff] text-[#1A56DB] shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                        <CheckCircle size={14} />
                      </div>
                      <div className="w-[calc(100%-3rem)] md:w-[calc(50%-2rem)] neu-sm p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-sm">Создан</span>
                          <span className="text-xs text-[#64748B]">24.10, 10:30</span>
                        </div>
                        <p className="text-xs text-[#64748B]">Источник: Instagram</p>
                      </div>
                    </div>

                    <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full border border-white bg-[#E8EDF2] shadow-[2px_2px_4px_#c5cad4,-2px_-2px_4px_#ffffff] text-yellow-600 shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                        <PhoneCall size={14} />
                      </div>
                      <div className="w-[calc(100%-3rem)] md:w-[calc(50%-2rem)] neu-sm p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-sm">Звонок</span>
                          <span className="text-xs text-[#64748B]">24.10, 11:15</span>
                        </div>
                        <p className="text-xs text-[#64748B]">Недозвон, статус изменен на "Перезвонить"</p>
                      </div>
                    </div>

                  </div>
                </div>

                <div className="pt-4 border-t border-border shrink-0">
                  <button className="neu-btn-primary w-full justify-center text-lg py-4 shadow-[6px_6px_12px_#c5cad4,-6px_-6px_12px_#ffffff]">
                    📅 Записать клиента
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  );
}
