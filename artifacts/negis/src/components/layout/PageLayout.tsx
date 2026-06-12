import React from 'react';
import { Topbar } from './Topbar';
import { TopNav } from './TopNav';
import { useAuth } from '@/contexts/AuthContext';
import { Redirect } from 'wouter';

interface PageLayoutProps {
  children: React.ReactNode;
  requireAuth?: boolean;
}

export function PageLayout({ children, requireAuth = true }: PageLayoutProps) {
  const { session, isLoading, isImpersonation } = useAuth();

  if (isLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: '#F4F7FB' }}
      >
        <div style={{ fontSize: 12, letterSpacing: '0.14em', color: '#8EA0B7', fontFamily: "'Inter', sans-serif" }}>
          ЗАГРУЗКА...
        </div>
      </div>
    );
  }

  if (requireAuth && !session && !isImpersonation) {
    return <Redirect to="/" />;
  }

  return (
    <div
      className="min-h-[100dvh] flex flex-col font-sans"
      style={{
        background: 'radial-gradient(circle at 14% 0%, rgba(219, 230, 246, 0.72), transparent 28%), radial-gradient(circle at 88% 8%, rgba(236, 226, 255, 0.42), transparent 28%), #F4F7FB',
        color: '#0B1220',
        paddingTop: isImpersonation ? 40 : 0,
      }}
    >
      <Topbar />
      <TopNav />
      <main className="flex-1 overflow-y-auto" style={{ padding: '28px clamp(18px, 3vw, 40px) 40px' }}>
        {children}
      </main>
    </div>
  );
}
