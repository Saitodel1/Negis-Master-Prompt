import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { ClipboardList, Building2, Briefcase, BarChart2, Settings, LogOut } from 'lucide-react';
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
  clinicName: z.string().min(1, 'Введите название клиники'),
  email: z.string().email('Неверный формат email'),
  password: z.string().min(8, 'Минимум 8 символов'),
  confirmPassword: z.string().min(1, 'Подтвердите пароль'),
}).refine(d => d.password === d.confirmPassword, {
  message: 'Пароли не совпадают',
  path: ['confirmPassword'],
});

type LoginValues = z.infer<typeof loginSchema>;
type RegisterValues = z.infer<typeof registerSchema>;

type ModalState = 'idle' | 'login' | 'register' | 'departments';


export default function Landing() {
  const [modalState, setModalState] = useState<ModalState>('idle');
  const [isButtonPressed, setIsButtonPressed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [resetMsg, setResetMsg] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [, setLocation] = useLocation();
  const { session, userRole, clinicId, signOut } = useAuth();
  const modalRef = useRef<HTMLDivElement>(null);

  const loginForm = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });
  const registerForm = useForm<RegisterValues>({ resolver: zodResolver(registerSchema) });

  useEffect(() => {
    if (modalState !== 'idle') {
      requestAnimationFrame(() => setModalVisible(true));
    } else {
      setModalVisible(false);
    }
  }, [modalState]);

  const openModal = () => {
    setError('');
    setResetSent(false);
    if (session) {
      setModalState('departments');
    } else {
      setModalState('login');
    }
  };

  const closeModal = () => {
    setModalVisible(false);
    setTimeout(() => setModalState('idle'), 200);
  };

  const handleButtonClick = () => {
    setIsButtonPressed(true);
    setTimeout(() => setIsButtonPressed(false), 300);
    setTimeout(() => openModal(), 100);
  };

  const handleLogin = async (data: LoginValues) => {
    setIsLoading(true);
    setError('');
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });
      if (error) throw error;
      setModalState('departments');
    } catch (e: any) {
      setError(e.message || 'Ошибка входа');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (data: RegisterValues) => {
    setIsLoading(true);
    setError('');
    try {
      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: { data: { full_name: data.ownerName } },
      });
      if (signUpError) throw signUpError;
      const userId = authData.user?.id;
      if (!userId) throw new Error('Не удалось создать аккаунт');

      const { data: clinic, error: clinicError } = await supabase
        .from('clinics')
        .insert({ name: data.clinicName, owner_id: userId })
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
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async () => {
    const email = loginForm.getValues('email');
    if (!email) {
      setResetMsg('Введите email для сброса пароля');
      return;
    }
    await supabase.auth.resetPasswordForEmail(email);
    setResetSent(true);
    setResetMsg(`Письмо со сбросом пароля отправлено на ${email}`);
  };

  const isInvalidCredentials = error.toLowerCase().includes('invalid');

  return (
    <div
      className="relative min-h-screen flex items-center justify-center overflow-hidden"
      style={{ background: '#F0F0F0' }}
    >
      {/* Crosshair SVG overlay */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ zIndex: 0 }}
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Top line */}
        <line x1="50%" y1="0" x2="50%" y2="calc(50% - 160px)" stroke="#CCCCCC" strokeWidth="0.5" />
        <circle cx="50%" cy="4" r="2" fill="#CCCCCC" />
        {/* Bottom line */}
        <line x1="50%" y1="100%" x2="50%" y2="calc(50% + 160px)" stroke="#CCCCCC" strokeWidth="0.5" />
        <circle cx="50%" cy="99%" r="2" fill="#CCCCCC" />
        {/* Left line */}
        <line x1="0" y1="50%" x2="calc(50% - 160px)" y2="50%" stroke="#CCCCCC" strokeWidth="0.5" />
        <circle cx="4" cy="50%" r="2" fill="#CCCCCC" />
        {/* Right line */}
        <line x1="100%" y1="50%" x2="calc(50% + 160px)" y2="50%" stroke="#CCCCCC" strokeWidth="0.5" />
        <circle cx="99%" cy="50%" r="2" fill="#CCCCCC" />
      </svg>

      {/* Main circular button */}
      <div className="relative z-10 flex flex-col items-center">
        <button
          onClick={handleButtonClick}
          data-testid="button-negis-main"
          style={{
            width: 300,
            height: 300,
            borderRadius: '50%',
            background: '#D8D8D8',
            boxShadow: isButtonPressed
              ? '4px 4px 12px #b0b0b0, -4px -4px 12px #ffffff, inset 2px 2px 4px #ffffff, inset -2px -2px 4px #b0b0b0'
              : '8px 8px 20px #b0b0b0, -8px -8px 20px #ffffff, inset 2px 2px 4px #ffffff, inset -2px -2px 4px #b0b0b0',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'box-shadow 0.2s ease, transform 0.15s cubic-bezier(0.34,1.56,0.64,1)',
            transform: isButtonPressed ? 'scale(0.97)' : 'scale(1)',
          }}
          onMouseEnter={e => {
            if (!isButtonPressed) {
              (e.currentTarget as HTMLButtonElement).style.boxShadow =
                '12px 12px 28px #b0b0b0, -12px -12px 28px #ffffff, inset 2px 2px 4px #ffffff, inset -2px -2px 4px #b0b0b0';
            }
          }}
          onMouseLeave={e => {
            if (!isButtonPressed) {
              (e.currentTarget as HTMLButtonElement).style.boxShadow =
                '8px 8px 20px #b0b0b0, -8px -8px 20px #ffffff, inset 2px 2px 4px #ffffff, inset -2px -2px 4px #b0b0b0';
            }
          }}
        >
          <div
            style={{
              width: 240,
              height: 240,
              borderRadius: '50%',
              background: '#D4D4D4',
              boxShadow: isButtonPressed
                ? 'inset 8px 8px 20px #b0b0b0, inset -8px -8px 20px #f5f5f5'
                : 'inset 6px 6px 16px #b0b0b0, inset -6px -6px 16px #f5f5f5',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'box-shadow 0.2s ease',
            }}
          >
            <span
              style={{
                fontFamily: "'Space Grotesk', 'Inter', sans-serif",
                fontWeight: 600,
                fontSize: 28,
                letterSpacing: 6,
                color: '#2A2A2A',
                textTransform: 'uppercase',
                userSelect: 'none',
              }}
            >
              NEGIS
            </span>
          </div>
        </button>
      </div>

      {/* Modal backdrop + card */}
      {modalState !== 'idle' && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50 p-4"
          style={{
            background: 'rgba(0,0,0,0.15)',
            backdropFilter: 'blur(6px)',
            transition: 'opacity 0.2s ease',
            opacity: modalVisible ? 1 : 0,
          }}
          onClick={e => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div
            ref={modalRef}
            style={{
              background: '#EBEBEB',
              borderRadius: 24,
              boxShadow: '12px 12px 28px #c0c0c0, -12px -12px 28px #ffffff',
              width: '100%',
              maxWidth: 400,
              padding: '40px 36px',
              transition: 'transform 0.2s cubic-bezier(0.34,1.2,0.64,1), opacity 0.2s ease',
              transform: modalVisible ? 'scale(1)' : 'scale(0.95)',
              opacity: modalVisible ? 1 : 0,
            }}
          >
            {modalState === 'departments' ? (
              <DepartmentSelect userRole={userRole} onNavigate={setLocation} onSignOut={signOut} />
            ) : (
              <AuthForms
                mode={modalState as 'login' | 'register'}
                setMode={m => { setError(''); setResetSent(false); setResetMsg(''); setModalState(m); }}
                loginForm={loginForm}
                registerForm={registerForm}
                onLogin={handleLogin}
                onRegister={handleRegister}
                onResetPassword={handleResetPassword}
                error={error}
                resetSent={resetSent}
                resetMsg={resetMsg}
                isInvalidCredentials={isInvalidCredentials}
                isLoading={isLoading}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Department Select ─────────────────────────────────── */
function DepartmentSelect({
  userRole,
  onNavigate,
  onSignOut,
}: {
  userRole: string | null;
  onNavigate: (path: string) => void;
  onSignOut: () => void;
}) {
  const isManager = userRole === 'owner' || userRole === 'manager';

  const departments = [
    { label: 'Запись', path: '/booking', Icon: ClipboardList, always: true },
    { label: 'Ресепшн', path: '/reception', Icon: Building2, always: true },
    { label: 'Negis CRM', path: '/sales', Icon: Briefcase, always: true },
    { label: 'Дашборд', path: '/dashboard', Icon: BarChart2, always: false },
    { label: 'Админ', path: '/admin', Icon: Settings, always: false },
  ].filter(d => d.always || isManager);

  return (
    <div className="flex flex-col gap-3">
      {departments.map(({ label, path, Icon }) => (
        <button
          key={path}
          data-testid={`button-dept-${path.replace('/', '')}`}
          onClick={() => onNavigate(path)}
          style={{
            background: '#EBEBEB',
            boxShadow: '4px 4px 10px #c0c0c0, -4px -4px 10px #ffffff',
            borderRadius: 14,
            border: 'none',
            padding: '14px 20px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            transition: 'box-shadow 0.15s ease, transform 0.15s ease',
            fontFamily: "'Inter', sans-serif",
            fontSize: 15,
            fontWeight: 600,
            color: '#1E293B',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.boxShadow = '6px 6px 14px #c0c0c0, -6px -6px 14px #ffffff';
            (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.boxShadow = '4px 4px 10px #c0c0c0, -4px -4px 10px #ffffff';
            (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
          }}
          onMouseDown={e => {
            (e.currentTarget as HTMLButtonElement).style.boxShadow = 'inset 3px 3px 6px #c0c0c0, inset -3px -3px 6px #ffffff';
            (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.98)';
          }}
          onMouseUp={e => {
            (e.currentTarget as HTMLButtonElement).style.boxShadow = '4px 4px 10px #c0c0c0, -4px -4px 10px #ffffff';
            (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
          }}
        >
          <Icon size={20} color="#1A56DB" />
          {label}
        </button>
      ))}

      <button
        onClick={onSignOut}
        data-testid="button-signout"
        style={{
          marginTop: 4,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          fontSize: 13,
          color: '#94a3b8',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          fontFamily: "'Inter', sans-serif",
          transition: 'color 0.15s',
        }}
        onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#64748B')}
        onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = '#94a3b8')}
      >
        <LogOut size={14} />
        Выйти
      </button>
    </div>
  );
}

/* ─── Auth Forms ─────────────────────────────────────────── */
function AuthForms({
  mode, setMode, loginForm, registerForm,
  onLogin, onRegister,
  onResetPassword, error, resetSent, resetMsg,
  isInvalidCredentials, isLoading,
}: {
  mode: 'login' | 'register';
  setMode: (m: 'login' | 'register') => void;
  loginForm: any;
  registerForm: any;
  onLogin: (d: LoginValues) => void;
  onRegister: (d: RegisterValues) => void;
  onResetPassword: () => void;
  error: string;
  resetSent: boolean;
  resetMsg: string;
  isInvalidCredentials: boolean;
  isLoading: boolean;
}) {
  const inputStyle: React.CSSProperties = {
    background: '#EBEBEB',
    boxShadow: 'inset 2px 2px 5px #c0c0c0, inset -2px -2px 5px #ffffff',
    borderRadius: 10,
    border: 'none',
    outline: 'none',
    padding: '11px 14px',
    width: '100%',
    fontSize: 14,
    color: '#1E293B',
    fontFamily: "'Inter', sans-serif",
    transition: 'box-shadow 0.2s ease',
  };

  const primaryBtn: React.CSSProperties = {
    background: '#1A56DB',
    color: 'white',
    boxShadow: '3px 3px 8px #c0c0c0, -3px -3px 8px #ffffff',
    borderRadius: 50,
    border: 'none',
    fontWeight: 600,
    fontSize: 14,
    padding: '11px 22px',
    cursor: isLoading ? 'not-allowed' : 'pointer',
    width: '100%',
    fontFamily: "'Inter', sans-serif",
    transition: 'all 0.2s ease',
    opacity: isLoading ? 0.7 : 1,
  };

  const isLogin = mode === 'login';

  return (
    <div style={{ transition: 'opacity 0.2s ease' }}>
      {isLogin ? (
        <form onSubmit={loginForm.handleSubmit(onLogin)} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <input
              type="email"
              placeholder="Email"
              style={inputStyle}
              data-testid="input-email"
              {...loginForm.register('email')}
              onFocus={e => (e.target.style.boxShadow = 'inset 2px 2px 5px #c0c0c0, inset -2px -2px 5px #ffffff, 0 0 0 2px rgba(26,86,219,0.2)')}
              onBlur={e => (e.target.style.boxShadow = 'inset 2px 2px 5px #c0c0c0, inset -2px -2px 5px #ffffff')}
            />
            {loginForm.formState.errors.email && (
              <p style={{ color: '#EF4444', fontSize: 12, marginTop: 4, paddingLeft: 4 }}>
                {loginForm.formState.errors.email.message}
              </p>
            )}
          </div>

          <div>
            <input
              type="password"
              placeholder="Пароль"
              style={inputStyle}
              data-testid="input-password"
              {...loginForm.register('password')}
              onFocus={e => (e.target.style.boxShadow = 'inset 2px 2px 5px #c0c0c0, inset -2px -2px 5px #ffffff, 0 0 0 2px rgba(26,86,219,0.2)')}
              onBlur={e => (e.target.style.boxShadow = 'inset 2px 2px 5px #c0c0c0, inset -2px -2px 5px #ffffff')}
            />
            {loginForm.formState.errors.password && (
              <p style={{ color: '#EF4444', fontSize: 12, marginTop: 4, paddingLeft: 4 }}>
                {loginForm.formState.errors.password.message}
              </p>
            )}
          </div>

          {error && (
            <div>
              <p style={{ color: '#EF4444', fontSize: 13, textAlign: 'center' }}>{error}</p>
              {isInvalidCredentials && !resetSent && (
                <button
                  type="button"
                  onClick={onResetPassword}
                  style={{ background: 'none', border: 'none', color: '#1A56DB', fontSize: 12, cursor: 'pointer', width: '100%', textAlign: 'center', marginTop: 4 }}
                >
                  Забыли пароль? Сбросить
                </button>
              )}
            </div>
          )}

          {resetMsg && (
            <p style={{ color: resetSent ? '#10B981' : '#EF4444', fontSize: 12, textAlign: 'center' }}>
              {resetMsg}
            </p>
          )}

          <button type="submit" style={primaryBtn} disabled={isLoading} data-testid="button-login">
            {isLoading ? 'Вход...' : 'Войти'}
          </button>

          <p style={{ textAlign: 'center', fontSize: 13, color: '#64748B', marginTop: 4 }}>
            Нет аккаунта?{' '}
            <button
              type="button"
              onClick={() => setMode('register')}
              style={{ background: 'none', border: 'none', color: '#1A56DB', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
            >
              Зарегистрироваться
            </button>
          </p>
        </form>
      ) : (
        <form onSubmit={registerForm.handleSubmit(onRegister)} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {(
            [
              { name: 'ownerName', placeholder: 'Имя владельца', type: 'text' },
              { name: 'clinicName', placeholder: 'Название клиники', type: 'text' },
              { name: 'email', placeholder: 'Email', type: 'email' },
              { name: 'password', placeholder: 'Пароль (мин. 8 символов)', type: 'password' },
              { name: 'confirmPassword', placeholder: 'Подтверждение пароля', type: 'password' },
            ] as const
          ).map(({ name, placeholder, type }) => (
            <div key={name}>
              <input
                type={type}
                placeholder={placeholder}
                style={inputStyle}
                data-testid={`input-${name}`}
                {...registerForm.register(name)}
                onFocus={(e: React.FocusEvent<HTMLInputElement>) => (e.target.style.boxShadow = 'inset 2px 2px 5px #c0c0c0, inset -2px -2px 5px #ffffff, 0 0 0 2px rgba(26,86,219,0.2)')}
                onBlur={(e: React.FocusEvent<HTMLInputElement>) => (e.target.style.boxShadow = 'inset 2px 2px 5px #c0c0c0, inset -2px -2px 5px #ffffff')}
              />
              {registerForm.formState.errors[name] && (
                <p style={{ color: '#EF4444', fontSize: 12, marginTop: 4, paddingLeft: 4 }}>
                  {registerForm.formState.errors[name]?.message as string}
                </p>
              )}
            </div>
          ))}

          {error && (
            <p style={{ color: '#EF4444', fontSize: 13, textAlign: 'center' }}>{error}</p>
          )}

          <button type="submit" style={primaryBtn} disabled={isLoading} data-testid="button-register">
            {isLoading ? 'Создание...' : 'Создать аккаунт'}
          </button>

          <p style={{ textAlign: 'center', fontSize: 13, color: '#64748B', marginTop: 4 }}>
            Уже есть аккаунт?{' '}
            <button
              type="button"
              onClick={() => setMode('login')}
              style={{ background: 'none', border: 'none', color: '#1A56DB', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
            >
              Войти
            </button>
          </p>
        </form>
      )}
    </div>
  );
}
