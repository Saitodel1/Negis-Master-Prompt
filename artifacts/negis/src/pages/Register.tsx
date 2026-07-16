import React, { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { trackEvent } from '@/lib/fbpixel';
import { ArrowLeft } from 'lucide-react';
import { VERTICALS, INDUSTRY_OPTIONS, DEFAULT_INDUSTRY, type IndustrySlug } from '@/lib/verticals/config';
import { apiUrl } from '@/lib/api';
import { readRegistrationResponse, registrationNetworkError } from '@/lib/registration';

const registerSchema = z.object({
  fullName: z.string().min(2, 'Обязательное поле'),
  clinicName: z.string().min(2, 'Обязательное поле'),
  email: z.string().email('Неверный формат email'),
  password: z.string().min(8, 'Пароль должен быть не менее 8 символов'),
  confirmPassword: z.string()
}).refine((data) => data.password === data.confirmPassword, {
  message: "Пароли не совпадают",
  path: ["confirmPassword"],
});

type RegisterFormValues = z.infer<typeof registerSchema>;

export default function Register() {
  const [, setLocation] = useLocation();
  const [isLoading, setIsLoading] = useState(false);
  const [industry, setIndustry] = useState<IndustrySlug>(DEFAULT_INDUSTRY);
  const [country, setCountry] = useState<'KZ' | 'KG'>('KZ');
  const [submitError, setSubmitError] = useState('');

  const { register, handleSubmit, formState: { errors } } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema)
  });

  const onSubmit = async (data: RegisterFormValues) => {
    setIsLoading(true);
    setSubmitError('');
    try {
      const businessTypeByIndustry: Record<IndustrySlug, string> = {
        clinic: 'private_clinic', beauty: 'beauty_salon', fitness: 'fitness_wellness', education: 'education_courses', custom: 'other',
      };
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 25_000);
      const response = await fetch(apiUrl('/api/auth/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          ownerName: data.fullName,
          clinicName: data.clinicName,
          email: data.email,
          password: data.password,
          businessType: businessTypeByIndustry[industry],
          country,
        }),
      });
      window.clearTimeout(timeout);
      const result = await readRegistrationResponse(response);
      if (!response.ok) throw new Error(result.error || 'Не удалось создать кабинет');

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });
      if (signInError) throw signInError;

      toast.success(result.welcomeEmailSent === false
        ? 'Кабинет создан. Письмо временно не отправлено.'
        : 'Кабинет создан. Поздравительное письмо отправлено.');
      trackEvent('CompleteRegistration');
      setLocation('/onboarding');
      
    } catch (error: unknown) {
      console.error(error);
      const message = registrationNetworkError(error);
      setSubmitError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#E8EDF2] flex items-center justify-center p-4">
      <div className="neu-lg w-full max-w-md p-8 bg-[#E8EDF2]">
        <Link href="/" className="inline-flex items-center text-sm font-medium text-[#64748B] hover:text-[#1A56DB] mb-6 transition-colors">
          <ArrowLeft size={16} className="mr-1" />
          На главную
        </Link>
        
        <h2 className="text-2xl font-bold text-center mb-8 text-foreground">Создать пространство</h2>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5 text-[#1E293B]">Страна</label>
            <select
              className="neu-input bg-transparent"
              value={country}
              onChange={event => setCountry(event.target.value as 'KZ' | 'KG')}
            >
              <option value="KZ">Казахстан</option>
              <option value="KG">Кыргызстан</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5 text-[#1E293B]">Сфера бизнеса</label>
            <select
              className="neu-input bg-transparent"
              value={industry}
              onChange={event => setIndustry(event.target.value as IndustrySlug)}
            >
              {INDUSTRY_OPTIONS.map(slug => (
                <option key={slug} value={slug}>{VERTICALS[slug].name}</option>
              ))}
            </select>
          </div>

          <div>
            <input 
              type="text" 
              placeholder="Ваше имя"
              className="neu-input" 
              {...register('fullName')}
            />
            {errors.fullName && <p className="text-destructive text-xs mt-1 px-2">{errors.fullName.message}</p>}
          </div>

          <div>
            <input 
              type="text" 
              placeholder="Название бизнеса"
              className="neu-input" 
              {...register('clinicName')}
            />
            {errors.clinicName && <p className="text-destructive text-xs mt-1 px-2">{errors.clinicName.message}</p>}
          </div>

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
              placeholder="Пароль (мин 8 символов)" 
              className="neu-input" 
              {...register('password')}
            />
            {errors.password && <p className="text-destructive text-xs mt-1 px-2">{errors.password.message}</p>}
          </div>

          <div>
            <input 
              type="password" 
              placeholder="Подтверждение пароля" 
              className="neu-input" 
              {...register('confirmPassword')}
            />
            {errors.confirmPassword && <p className="text-destructive text-xs mt-1 px-2">{errors.confirmPassword.message}</p>}
          </div>

          {submitError && (
            <div role="alert" aria-live="polite" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {submitError}
            </div>
          )}

          <button 
            type="submit" 
            className="neu-btn-primary w-full justify-center mt-6"
            disabled={isLoading}
          >
            {isLoading ? 'Создание...' : 'Создать пространство'}
          </button>
        </form>
      </div>
    </div>
  );
}
