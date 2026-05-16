import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { useLocation } from 'wouter';
import { toast } from 'sonner';

/* ── Types ── */
interface ImpersonationData {
  active: boolean;
  clinic_id: string;
  clinic_name: string;
  owner_email: string;
  issued_by: string;
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  clinicId: string | null;
  userRole: 'owner' | 'manager' | 'agent' | 'receptionist' | null;
  isLoading: boolean;
  isImpersonation: boolean;
  impersonationClinicName: string | null;
  signOut: () => Promise<void>;
}

/* ── Constants ── */
const IMP_KEY      = 'negis_impersonation';
const CLINIC_KEY   = 'negis_clinic_id';
const SESSION_KEY  = 'negis_session';

function clearImpersonationStorage() {
  localStorage.removeItem(IMP_KEY);
  localStorage.removeItem(CLINIC_KEY);
  localStorage.removeItem(SESSION_KEY);
}

function cleanUrl() {
  window.history.replaceState({}, document.title,
    window.location.origin + window.location.pathname);
}

/* ── Context ── */
const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session,                 setSession]                 = useState<Session | null>(null);
  const [user,                    setUser]                    = useState<User | null>(null);
  const [clinicId,                setClinicId]                = useState<string | null>(null);
  const [userRole,                setUserRole]                = useState<'owner' | 'manager' | 'agent' | 'receptionist' | null>(null);
  const [isLoading,               setIsLoading]               = useState(true);
  const [isImpersonation,         setIsImpersonation]         = useState(false);
  const [impersonationClinicName, setImpersonationClinicName] = useState<string | null>(null);
  const [, setLocation] = useLocation();

  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);

  useEffect(() => {
    initAuth();
    return () => { subscriptionRef.current?.unsubscribe(); };
  }, []);

  /* ── 1. Main init ── */
  const initAuth = async () => {
    const params = new URLSearchParams(window.location.search);
    const token  = params.get('impersonate_token');

    /* A) URL contains impersonation token → verify it */
    if (token) {
      await handleImpersonationToken(token);
      return;
    }

    /* B) localStorage has an active impersonation session (page refresh) */
    const stored = localStorage.getItem(IMP_KEY);
    if (stored) {
      try {
        const data: ImpersonationData = JSON.parse(stored);
        if (data.active && data.clinic_id) {
          setIsImpersonation(true);
          setClinicId(data.clinic_id);
          setImpersonationClinicName(data.clinic_name);
          setUserRole('owner');
          setIsLoading(false);
          return;
        }
      } catch {
        clearImpersonationStorage();
      }
    }

    /* C) Normal Supabase auth */
    setupSupabaseAuth();
  };

  /* ── 2. Verify impersonation token with Negis Control ── */
  const handleImpersonationToken = async (token: string) => {
    const apiUrl = import.meta.env.VITE_NEGIS_CONTROL_API_URL as string | undefined;
    if (!apiUrl) {
      cleanUrl();
      toast.error('VITE_NEGIS_CONTROL_API_URL не настроен');
      setIsLoading(false);
      return;
    }

    try {
      const res = await fetch(`${apiUrl}/api/impersonation/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      if (!res.ok) throw new Error('invalid_token');

      const data: { clinicId: string; clinicName: string; ownerEmail: string; issuedBy: string } = await res.json();

      /* Persist impersonation session */
      const impData: ImpersonationData = {
        active:       true,
        clinic_id:    data.clinicId,
        clinic_name:  data.clinicName,
        owner_email:  data.ownerEmail,
        issued_by:    data.issuedBy,
      };
      localStorage.setItem(IMP_KEY,     JSON.stringify(impData));
      localStorage.setItem(CLINIC_KEY,  data.clinicId);
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        mode:       'impersonation',
        role:       'owner',
        clinic_id:  data.clinicId,
        clinic_name: data.clinicName,
        email:      data.ownerEmail,
        issued_by:  data.issuedBy,
        started_at: new Date().toISOString(),
      }));

      cleanUrl();

      setIsImpersonation(true);
      setClinicId(data.clinicId);
      setImpersonationClinicName(data.clinicName);
      setUserRole('owner');
      setIsLoading(false);
      setLocation('/dashboard');
    } catch {
      cleanUrl();
      clearImpersonationStorage();
      toast.error('Доступ по ссылке истёк. Войдите снова из Negis Control.');
      setIsLoading(false);
      setLocation('/');
    }
  };

  /* ── 3. Normal Supabase auth flow ── */
  const setupSupabaseAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    setSession(session);
    setUser(session?.user ?? null);
    if (session?.user) {
      await fetchUserRole(session.user.id);
    } else {
      setIsLoading(false);
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchUserRole(session.user.id);
      } else {
        setClinicId(null);
        setUserRole(null);
        setIsLoading(false);
      }
    });
    subscriptionRef.current = subscription;
  };

  const fetchUserRole = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select('clinic_id, role')
        .eq('user_id', userId)
        .single();
      if (error) throw error;
      if (data) {
        setClinicId(data.clinic_id);
        setUserRole(data.role as any);
      } else {
        setLocation('/onboarding');
      }
    } catch {
      toast.error('Не удалось загрузить профиль. Попробуйте перезайти.');
    } finally {
      setIsLoading(false);
    }
  };

  /* ── 4. Sign out (handles both modes) ── */
  const signOut = async () => {
    if (isImpersonation) {
      clearImpersonationStorage();
      setIsImpersonation(false);
      setImpersonationClinicName(null);
      setClinicId(null);
      setUserRole(null);
      setLocation('/');
      return;
    }
    await supabase.auth.signOut();
    setLocation('/');
    toast.success('Вы успешно вышли из системы');
  };

  return (
    <AuthContext.Provider value={{
      session, user, clinicId, userRole, isLoading,
      isImpersonation, impersonationClinicName,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
