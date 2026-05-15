import React from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { useAuth } from '@/contexts/AuthContext';
import { Redirect } from 'wouter';

interface PageLayoutProps {
  children: React.ReactNode;
  requireAuth?: boolean;
}

export function PageLayout({ children, requireAuth = true }: PageLayoutProps) {
  const { session, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: '#F4F7FB' }}
      >
        <div style={{ fontSize: 12, letterSpacing: '0.14em', color: '#94A3B8', fontFamily: "'Inter', sans-serif" }}>
          ЗАГРУЗКА...
        </div>
      </div>
    );
  }

  if (requireAuth && !session) {
    return <Redirect to="/" />;
  }

  return (
    <div
      className="min-h-[100dvh] flex font-sans"
      style={{ background: '#F4F7FB', color: '#0B1220' }}
    >
      <Sidebar />
      <div className="flex-1 flex flex-col" style={{ marginLeft: 78 }}>
        <Topbar />
        <main className="flex-1 overflow-y-auto" style={{ padding: '32px 40px' }}>
          {children}
        </main>
      </div>
    </div>
  );
}
