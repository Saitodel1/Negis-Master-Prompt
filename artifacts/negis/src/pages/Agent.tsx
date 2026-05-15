import React, { useState, useEffect } from 'react';
import { PageLayout } from '@/components/layout/PageLayout';
import { Play, Square, Clock, Target, Calendar as CalendarIcon } from 'lucide-react';
import { toast } from 'sonner';

export default function Agent() {
  const [isShiftActive, setIsShiftActive] = useState(false);
  const [secondsElapsed, setSecondsElapsed] = useState(0);

  const hourlyRate = 2500;
  const target = 50;
  const current = 32;

  useEffect(() => {
    let interval: any;
    if (isShiftActive) {
      interval = setInterval(() => {
        setSecondsElapsed((prev) => prev + 1);
      }, 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [isShiftActive]);

  const formatTime = (totalSeconds: number) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const earnings = Math.floor((secondsElapsed / 3600) * hourlyRate);

  const toggleShift = () => {
    if (isShiftActive) {
      toast.success(`Смена завершена! Заработано: ${earnings} ₸`);
      setIsShiftActive(false);
      // setSecondsElapsed(0); // Optional reset
    } else {
      toast.success('Смена начата. Успешной работы!');
      setIsShiftActive(true);
      setSecondsElapsed(0);
    }
  };

  return (
    <PageLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-[#E8EDF2] border-b border-border pb-6">
          <div>
            <h2 className="text-3xl font-extrabold text-[#1E293B]">Рабочее место</h2>
            <p className="text-[#64748B] font-medium mt-1">Анна С. • Оператор</p>
          </div>
          <div className="neu-sm px-6 py-3 flex flex-col items-end">
            <span className="text-xs font-bold text-[#64748B] uppercase tracking-wider mb-1">Ставка</span>
            <span className="text-xl font-black text-[#1A56DB]">{hourlyRate} ₸ / час</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Main Shift Control */}
          <div className="md:col-span-2 neu-lg p-8 flex flex-col items-center justify-center min-h-[300px] relative overflow-hidden">
            {!isShiftActive ? (
              <button 
                onClick={toggleShift}
                className="w-48 h-48 rounded-full bg-[#E8EDF2] shadow-[12px_12px_24px_#c5cad4,-12px_-12px_24px_#ffffff] flex flex-col items-center justify-center text-[#1A56DB] hover:text-[#1648c0] transition-all hover:scale-105 active:shadow-[inset_8px_8px_16px_#c5cad4,inset_-8px_-8px_16px_#ffffff]"
              >
                <Play size={64} className="ml-3 mb-2" fill="currentColor" />
                <span className="font-extrabold text-lg tracking-widest">НАЧАТЬ</span>
              </button>
            ) : (
              <div className="w-full flex flex-col items-center">
                <div className="font-mono text-7xl font-black text-[#1E293B] mb-2 tracking-tighter drop-shadow-md">
                  {formatTime(secondsElapsed)}
                </div>
                <p className="text-[#64748B] font-bold tracking-widest uppercase mb-12 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  Смена активна
                </p>
                
                <div className="flex items-center gap-8 w-full max-w-sm">
                  <div className="flex-1 neu-pressed-sm p-4 text-center">
                    <p className="text-xs font-bold text-[#64748B] uppercase mb-1">Заработано</p>
                    <p className="text-2xl font-black text-green-600">{earnings} ₸</p>
                  </div>
                  <button 
                    onClick={toggleShift}
                    className="neu-icon-btn w-20 h-20 bg-red-500 text-white shadow-[6px_6px_12px_#c5cad4] hover:bg-red-600 shrink-0 hover:text-white"
                  >
                    <Square size={32} fill="currentColor" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Target Info */}
          <div className="flex flex-col gap-6">
            <div className="neu-card flex-1 flex flex-col justify-center">
              <h3 className="font-bold text-[#1E293B] mb-4 flex items-center gap-2">
                <Target size={20} className="text-[#1A56DB]" />
                Недельный таргет
              </h3>
              <div className="flex items-end justify-between mb-2">
                <span className="text-4xl font-black text-[#1A56DB]">{current}</span>
                <span className="text-lg font-bold text-[#64748B] mb-1">/ {target}</span>
              </div>
              <div className="h-3 w-full bg-border rounded-full overflow-hidden neu-pressed-sm">
                <div 
                  className="h-full bg-[#1A56DB] transition-all duration-500 rounded-full"
                  style={{ width: `${(current / target) * 100}%` }}
                />
              </div>
              <p className="text-right text-xs font-bold mt-2 text-[#1E293B]">{Math.round((current/target)*100)}% выполнено</p>
            </div>

            <div className="neu-card flex-1 flex flex-col justify-center bg-[#1A56DB] text-white shadow-[6px_6px_12px_#c5cad4]">
              <h3 className="font-bold mb-2 flex items-center gap-2 text-white/90">
                <CalendarIcon size={20} />
                Мои записи сегодня
              </h3>
              <p className="text-5xl font-black">8</p>
              <p className="text-sm text-white/80 mt-2 font-medium">Отличный результат!</p>
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
