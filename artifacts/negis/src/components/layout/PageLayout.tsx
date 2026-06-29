import React from 'react';
import { Topbar } from './Topbar';
import { DepartmentHero } from './DepartmentHero';
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
        style={{ background: '#EEF4F8' }}
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
      className="ng-shell min-h-[100dvh] flex flex-col font-sans"
      style={{
        background: '#F6F8FC',
        color: '#0F172A',
        paddingTop: isImpersonation ? 40 : 0,
      }}
    >
      <Topbar />
      <main className="ng-content ng-admin-skin flex-1 overflow-y-auto" style={{ padding: '32px clamp(24px, 3vw, 44px) 44px' }}>
        <DepartmentHero />
        {children}
      </main>
    </div>
  );
}
