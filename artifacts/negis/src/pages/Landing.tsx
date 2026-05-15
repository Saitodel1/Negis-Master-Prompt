import React, { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ClipboardList, Building2, Briefcase, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

const loginSchema = z.object({
  email: z.string().email('Неверный формат email'),
  password: z.string().min(6, 'Пароль должен быть не менее 6 символов'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function Landing() {
  const [selectedDept, setSelectedDept] = useState<{ title: string, role: string } | null>(null);
  const [, setLocation] = useLocation();
  const [isLoading, setIsLoading] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema)
  });

  const onSubmit = async (data: LoginFormValues) => {
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });

      if (error) throw error;
      
      // The AuthContext will handle the redirect based on role
      toast.success('Успешный вход');
    } catch (error: any) {
      toast.error(error.message || 'Ошибка входа');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#E8EDF2] flex flex-col items-center justify-center p-4">
      <div className="text-center mb-12">
        <h1 className="text-[#1A56DB] text-5xl md:text-6xl font-extrabold mb-4">Negis</h1>
        <p className="text-[#64748B] text-lg md:text-xl font-medium">Операционная экосистема для клиник</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl w-full">
        {/* Запись */}
        <div 
          className="neu p-8 cursor-pointer text-center flex flex-col items-center hover:-translate-y-1 transition-transform"
          onClick={() => setSelectedDept({ title: 'Запись', role: 'agent' })}
        >
          <div className="neu-icon-btn h-16 w-16 mb-6 text-[#1A56DB]">
            <ClipboardList size={32} />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">Запись</h2>
          <p className="text-[#64748B] text-sm">Операторы</p>
        </div>

        {/* Ресепшн */}
        <div 
          className="neu p-8 cursor-pointer text-center flex flex-col items-center hover:-translate-y-1 transition-transform"
          onClick={() => setSelectedDept({ title: 'Ресепшн', role: 'receptionist' })}
        >
          <div className="neu-icon-btn h-16 w-16 mb-6 text-[#1A56DB]">
            <Building2 size={32} />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">Ресепшн</h2>
          <p className="text-[#64748B] text-sm">Приём клиентов</p>
        </div>

        {/* Negis CRM */}
        <div 
          className="neu p-8 cursor-pointer text-center flex flex-col items-center hover:-translate-y-1 transition-transform"
          onClick={() => setSelectedDept({ title: 'Negis CRM', role: 'manager' })}
        >
          <div className="neu-icon-btn h-16 w-16 mb-6 text-[#1A56DB]">
            <Briefcase size={32} />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">Negis CRM</h2>
          <p className="text-[#64748B] text-sm">Отдел продаж</p>
        </div>
      </div>

      <div className="mt-16 flex flex-col items-center gap-4">
        <Link href="/register" className="text-[#1A56DB] font-semibold hover:underline">
          Нет аккаунта? Зарегистрировать клинику
        </Link>
        <Link href="/admin" className="text-xs text-[#64748B] hover:text-foreground transition-colors">
          Войти как администратор
        </Link>
      </div>

      {/* Login Modal */}
      {selectedDept && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="neu-lg w-full max-w-md relative p-8 bg-[#E8EDF2]">
            <button 
              className="neu-icon-btn absolute top-4 right-4"
              onClick={() => setSelectedDept(null)}
            >
              <X size={20} />
            </button>
            
            <h2 className="text-2xl font-bold text-center mb-6">Вход в систему</h2>
            <p className="text-center text-[#64748B] mb-8 font-medium">{selectedDept.title}</p>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <div>
                <input 
                  type="email" 
                  placeholder="Email" 
                  className="neu-input" 
                  {...register('email')}
                />
                {errors.email && <p className="text-destructive text-xs mt-1 px-2">{errors.email.message}</p>}
              </div>
              
              <div>
                <input 
                  type="password" 
                  placeholder="Пароль" 
                  className="neu-input" 
                  {...register('password')}
                />
                {errors.password && <p className="text-destructive text-xs mt-1 px-2">{errors.password.message}</p>}
              </div>

              <button 
                type="submit" 
                className="neu-btn-primary w-full justify-center mt-4"
                disabled={isLoading}
              >
                {isLoading ? 'Вход...' : 'Войти'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
