import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { ArrowRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

const loginSchema = z.object({
  email: z.string().email('Неверный формат email'),
  password: z.string().min(6, 'Минимум 6 символов'),
});

const registerSchema = z.object({
  ownerName: z.string().min(1, 'Введите имя'),
  clinicName: z.string().min(1, 'Введите название'),
  email: z.string().email('Неверный формат email'),
  password: z.string().min(8, 'Минимум 8 символов'),
  confirmPassword: z.string().min(1, 'Подтвердите пароль'),
}).refine(d => d.password === d.confirmPassword, {
  message: 'Пароли не совпадают',
  path: ['confirmPassword'],
});

type LoginValues = z.infer<typeof loginSchema>;
type RegisterValues = z.infer<typeof registerSchema>;
type ModalState = 'idle' | 'choice' | 'login' | 'register';

const roleRoute = (role: string | null) => {
  if (role === 'owner' || role === 'manager') return '/dashboard';
  if (role === 'receptionist') return '/reception';
  return '/booking';
};

export default function Landing() {
  const [modalState, setModalState] = useState<ModalState>('idle');
  const [pressed, setPressed] = useState(false);
  const [visible, setVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [resetMsg, setResetMsg] = useState('');
  const [, setLocation] = useLocation();
  const { session, userRole } = useAuth();
  const modalRef = useRef<HTMLDivElement>(null);

  const loginForm = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });
  const registerForm = useForm<RegisterValues>({ resolver: zodResolver(registerSchema) });

  useEffect(() => {
    if (modalState !== 'idle') {
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [modalState]);

  const openModal = () => {
    if (session) {
      setLocation(roleRoute(userRole));
      return;
    }
    setError(''); setResetSent(false); setResetMsg('');
    setModalState('choice');
  };

  const closeModal = () => {
    setVisible(false);
    setTimeout(() => setModalState('idle'), 220);
  };

  const handleCircleClick = () => {
    setPressed(true);
    setTimeout(() => setPressed(false), 280);
    setTimeout(openModal, 80);
  };

  const handleLogin = async (data: LoginValues) => {
    setIsLoading(true); setError('');
    try {
      const { data: authData, error } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });
      if (error) throw error;
      const { data: roleRow } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', authData.user?.id)
        .single();
      closeModal();
      setLocation(roleRoute(roleRow?.role ?? null));
    } catch (e: any) {
      setError(e.message || 'Ошибка входа');
    } finally { setIsLoading(false); }
  };

  const handleRegister = async (data: RegisterValues) => {
    setIsLoading(true); setError('');
    try {
      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email: data.email, password: data.password,
        options: { data: { full_name: data.ownerName } },
      });
      if (signUpError) throw signUpError;
      const userId = authData.user?.id;
      if (!userId) throw new Error('Не удалось создать аккаунт');
      const slug = data.clinicName
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .slice(0, 40) + '-' + Math.random().toString(36).slice(2, 7);
      const { data: clinic, error: clinicError } = await supabase
        .from('clinics')
        .insert({ name: data.clinicName, owner_id: userId, slug })
        .select('id')
        .single();
      if (clinicError) throw clinicError;
      const { error: roleError } = await supabase
        .from('user_roles')
        .insert({ user_id: userId, clinic_id: clinic.id, role: 'owner' });
      if (roleError) throw roleError;
      setLocation('/onboarding');
    } catch (e: any) {
      setError(e.message || 'Ошибка регистрации');
    } finally { setIsLoading(false); }
  };

  const handleResetPassword = async () => {
    const email = loginForm.getValues('email');
    if (!email) { setResetMsg('Введите email для сброса пароля'); return; }
    await supabase.auth.resetPasswordForEmail(email);
    setResetSent(true);
    setResetMsg(`Письмо отправлено на ${email}`);
  };

  /* ── Circle styles ── */
  const circleOuter: React.CSSProperties = {
    width: 296, height: 296, borderRadius: '50%',
    cursor: 'pointer', border: 'none',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    position: 'relative',
    transition: 'transform 0.22s cubic-bezier(0.25,0.46,0.45,0.94), box-shadow 0.22s ease',
    transform: pressed ? 'scale(0.965)' : 'scale(1)',
    background: 'radial-gradient(ellipse at 35% 30%, #C8D0D8 0%, #B2BCC8 40%, #A4AEB9 70%, #9BA5B0 100%)',
    boxShadow: pressed
      ? '0 6px 24px rgba(15,23,42,0.18), 0 2px 6px rgba(15,23,42,0.12), inset 0 2px 8px rgba(0,0,0,0.14)'
      : '0 16px 48px rgba(15,23,42,0.18), 0 4px 12px rgba(15,23,42,0.10), inset 0 1px 0 rgba(255,255,255,0.15)',
  };

  const circleInner: React.CSSProperties = {
    width: 230, height: 230, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'radial-gradient(ellipse at 38% 32%, #C4CDD6 0%, #B8C1CC 35%, #AEB7C2 65%, #A8B0BB 100%)',
    boxShadow: pressed
      ? 'inset 0 6px 20px rgba(15,23,42,0.20), inset 0 -2px 6px rgba(255,255,255,0.08)'
      : 'inset 0 4px 14px rgba(15,23,42,0.14), inset 0 -3px 8px rgba(255,255,255,0.10), 0 1px 3px rgba(15,23,42,0.08)',
    transition: 'box-shadow 0.22s ease',
    position: 'relative', overflow: 'hidden',
  };

  /* ── Shared input / button styles ── */
  const IS: React.CSSProperties = {
    background: '#F4F7FB', border: '1px solid #E7ECF3', borderRadius: 11,
    outline: 'none', padding: '11px 14px', width: '100%', fontSize: 14,
    color: '#0B1220', fontFamily: "'Inter', sans-serif",
    transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
  };
  const onFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.style.borderColor = '#2859C5';
    e.target.style.boxShadow = '0 0 0 3px rgba(40,89,197,0.12)';
  };
  const onBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.style.borderColor = '#E7ECF3';
    e.target.style.boxShadow = 'none';
  };
  const PrimaryBtn: React.CSSProperties = {
    background: '#1E325C', color: 'white', border: '1px solid #1E325C',
    borderRadius: 12, fontWeight: 500, fontSize: 14, padding: '12px 20px',
    cursor: isLoading ? 'not-allowed' : 'pointer', width: '100%',
    fontFamily: "'Inter', sans-serif", transition: 'background 0.15s ease',
    opacity: isLoading ? 0.65 : 1, letterSpacing: '0.01em',
  };

  const modalLabel =
    modalState === 'choice' ? 'ВХОД В СИСТЕМУ'
    : modalState === 'login' ? 'АВТОРИЗАЦИЯ'
    : 'СОЗДАТЬ ПРОСТРАНСТВО';

  return (
    <div
      className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden"
      style={{ background: '#F4F7FB' }}
    >
      {/* Crosshair */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" xmlns="http://www.w3.org/2000/svg" style={{ zIndex: 0 }}>
        <line x1="50%" y1="0" x2="50%" y2="calc(50% - 168px)" stroke="#DDE5EE" strokeWidth="1" />
        <circle cx="50%" cy="4" r="2" fill="#DDE5EE" />
        <line x1="50%" y1="100%" x2="50%" y2="calc(50% + 168px)" stroke="#DDE5EE" strokeWidth="1" />
        <circle cx="50%" cy="99.5%" r="2" fill="#DDE5EE" />
        <line x1="0" y1="50%" x2="calc(50% - 168px)" y2="50%" stroke="#DDE5EE" strokeWidth="1" />
        <circle cx="4" cy="50%" r="2" fill="#DDE5EE" />
        <line x1="100%" y1="50%" x2="calc(50% + 168px)" y2="50%" stroke="#DDE5EE" strokeWidth="1" />
        <circle cx="99.5%" cy="50%" r="2" fill="#DDE5EE" />
      </svg>

      {/* Core circle */}
      <div className="relative flex flex-col items-center gap-5" style={{ zIndex: 1 }}>
        <button
          onClick={handleCircleClick}
          data-testid="button-negis-main"
          style={circleOuter}
          onMouseEnter={e => {
            if (!pressed) (e.currentTarget as HTMLButtonElement).style.boxShadow =
              '0 20px 56px rgba(15,23,42,0.22), 0 6px 16px rgba(15,23,42,0.12), inset 0 1px 0 rgba(255,255,255,0.15)';
          }}
          onMouseLeave={e => {
            if (!pressed) (e.currentTarget as HTMLButtonElement).style.boxShadow =
              '0 16px 48px rgba(15,23,42,0.18), 0 4px 12px rgba(15,23,42,0.10), inset 0 1px 0 rgba(255,255,255,0.15)';
          }}
        >
          <div style={circleInner}>
            <div style={{
              position: 'absolute', top: 16, left: '20%', width: '60%', height: '30%',
              borderRadius: '50%',
              background: 'radial-gradient(ellipse, rgba(255,255,255,0.12) 0%, transparent 70%)',
              pointerEvents: 'none',
            }} />
            <span style={{
              fontFamily: "'Inter', system-ui, sans-serif", fontWeight: 600,
              fontSize: 22, letterSpacing: '0.22em', color: '#3A4452',
              textTransform: 'uppercase', userSelect: 'none', position: 'relative',
              textShadow: '0 1px 0 rgba(255,255,255,0.18), 0 -1px 0 rgba(15,23,42,0.12)',
            }}>
              NEGIS
            </span>
          </div>
        </button>

        <span style={{
          fontSize: 10, letterSpacing: '0.16em', color: '#B0BAC6',
          fontFamily: "'Inter', sans-serif", textTransform: 'uppercase', userSelect: 'none',
        }}>
          v1.0.0 — BUILD 2026
        </span>
      </div>

      {/* Modal */}
      {modalState !== 'idle' && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50 p-4"
          style={{
            background: 'rgba(11,18,32,0.18)', backdropFilter: 'blur(8px)',
            transition: 'opacity 0.22s ease', opacity: visible ? 1 : 0,
          }}
          onClick={e => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div
            ref={modalRef}
            style={{
              background: '#FFFFFF', border: '1px solid #E7ECF3', borderRadius: 20,
              boxShadow: '0 24px 64px rgba(15,23,42,0.14), 0 4px 16px rgba(15,23,42,0.08)',
              width: '100%', maxWidth: 388, padding: '36px 32px',
              transition: 'transform 0.22s cubic-bezier(0.34,1.15,0.64,1), opacity 0.22s ease',
              transform: visible ? 'scale(1) translateY(0)' : 'scale(0.96) translateY(8px)',
              opacity: visible ? 1 : 0,
            }}
          >
            {/* Header plate */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
              <div style={{
                background: '#DDE5EE', borderRadius: 8, padding: '5px 10px',
                fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', color: '#0B1220',
                fontFamily: "'Inter', sans-serif", textTransform: 'uppercase',
              }}>
                NEGIS
              </div>
              <span style={{ fontSize: 12, color: '#94A3B8', letterSpacing: '0.06em', fontFamily: "'Inter', sans-serif" }}>
                {modalLabel}
              </span>
            </div>

            {/* Choice */}
            {modalState === 'choice' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <ChoiceButton
                  label="Вход"
                  sub="Войти в существующее пространство"
                  onClick={() => { setError(''); setModalState('login'); }}
                  testId="button-choice-login"
                />
                <ChoiceButton
                  label="Создать пространство"
                  sub="Новая клиника с нуля"
                  onClick={() => { setError(''); setModalState('register'); }}
                  testId="button-choice-register"
                />
              </div>
            )}

            {/* Login */}
            {modalState === 'login' && (
              <form onSubmit={loginForm.handleSubmit(handleLogin)} style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
                <div>
                  <input type="email" placeholder="Email" style={IS} data-testid="input-email"
                    {...loginForm.register('email')} onFocus={onFocus} onBlur={onBlur} />
                  {loginForm.formState.errors.email && (
                    <p style={{ color: '#DC2626', fontSize: 12, marginTop: 4, paddingLeft: 2 }}>
                      {loginForm.formState.errors.email.message}
                    </p>
                  )}
                </div>
                <div>
                  <input type="password" placeholder="Пароль" style={IS} data-testid="input-password"
                    {...loginForm.register('password')} onFocus={onFocus} onBlur={onBlur} />
                  {loginForm.formState.errors.password && (
                    <p style={{ color: '#DC2626', fontSize: 12, marginTop: 4, paddingLeft: 2 }}>
                      {loginForm.formState.errors.password.message}
                    </p>
                  )}
                </div>
                {error && (
                  <div>
                    <p style={{ color: '#DC2626', fontSize: 13, textAlign: 'center' }}>{error}</p>
                    {!resetSent && (
                      <button type="button" onClick={handleResetPassword}
                        style={{ background: 'none', border: 'none', color: '#2859C5', fontSize: 12, cursor: 'pointer', width: '100%', textAlign: 'center', marginTop: 4, fontFamily: "'Inter', sans-serif" }}>
                        Забыли пароль?
                      </button>
                    )}
                  </div>
                )}
                {resetMsg && (
                  <p style={{ color: resetSent ? '#0F8A6B' : '#DC2626', fontSize: 12, textAlign: 'center' }}>{resetMsg}</p>
                )}
                <button type="submit" style={{ ...PrimaryBtn, marginTop: 4 }} disabled={isLoading} data-testid="button-login">
                  {isLoading ? 'Вход...' : 'Войти'}
                </button>
                <BackLink label="Назад" onClick={() => setModalState('choice')} />
              </form>
            )}

            {/* Register */}
            {modalState === 'register' && (
              <form onSubmit={registerForm.handleSubmit(handleRegister)} style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                {(
                  [
                    { name: 'ownerName', placeholder: 'Ваше имя', type: 'text' },
                    { name: 'clinicName', placeholder: 'Название клиники', type: 'text' },
                    { name: 'email', placeholder: 'Email', type: 'email' },
                    { name: 'password', placeholder: 'Пароль (мин. 8 символов)', type: 'password' },
                    { name: 'confirmPassword', placeholder: 'Подтвердите пароль', type: 'password' },
                  ] as const
                ).map(({ name, placeholder, type }) => (
                  <div key={name}>
                    <input type={type} placeholder={placeholder} style={IS}
                      data-testid={`input-${name}`}
                      {...registerForm.register(name)}
                      onFocus={onFocus} onBlur={onBlur} />
                    {registerForm.formState.errors[name] && (
                      <p style={{ color: '#DC2626', fontSize: 12, marginTop: 3, paddingLeft: 2 }}>
                        {registerForm.formState.errors[name]?.message as string}
                      </p>
                    )}
                  </div>
                ))}
                {error && <p style={{ color: '#DC2626', fontSize: 13, textAlign: 'center' }}>{error}</p>}
                <button type="submit" style={{ ...PrimaryBtn, marginTop: 4 }} disabled={isLoading} data-testid="button-register">
                  {isLoading ? 'Создание...' : 'Создать пространство'}
                </button>
                <BackLink label="Назад" onClick={() => setModalState('choice')} />
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Choice Button ─────────────────────────────────────────── */
function ChoiceButton({ label, sub, onClick, testId }: {
  label: string; sub: string; onClick: () => void; testId?: string;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      style={{
        background: '#F4F7FB', border: '1px solid #E7ECF3', borderRadius: 14,
        padding: '16px 18px', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        transition: 'all 0.15s ease', fontFamily: "'Inter', sans-serif",
        textAlign: 'left', width: '100%',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.background = '#EEF2F6'; el.style.borderColor = '#DDE5EE';
        el.style.transform = 'translateY(-1px)'; el.style.boxShadow = '0 4px 12px rgba(15,23,42,0.07)';
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.background = '#F4F7FB'; el.style.borderColor = '#E7ECF3';
        el.style.transform = 'translateY(0)'; el.style.boxShadow = 'none';
      }}
    >
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#0B1220', marginBottom: 3 }}>{label}</div>
        <div style={{ fontSize: 12, color: '#94A3B8' }}>{sub}</div>
      </div>
      <ArrowRight size={16} color="#94A3B8" />
    </button>
  );
}

/* ── Back Link ─────────────────────────────────────────────── */
function BackLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'none', border: 'none', color: '#94A3B8', fontSize: 12,
        cursor: 'pointer', textAlign: 'center', fontFamily: "'Inter', sans-serif",
        marginTop: 2, transition: 'color 0.15s ease',
      }}
      onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#475569')}
      onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = '#94A3B8')}
    >
      {label}
    </button>
  );
}
