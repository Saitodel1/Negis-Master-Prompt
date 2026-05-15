import React from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { useAuth } from '@/contexts/AuthContext';
import { Redirect, useLocation } from 'wouter';

interface PageLayoutProps {
  children: React.ReactNode;
  requireAuth?: boolean;
}

export function PageLayout({ children, requireAuth = true }: PageLayoutProps) {
  const { session, isLoading } = useAuth();
  const [location] = useLocation();

  if (isLoading) {
    return <div className="min-h-screen bg-[#E8EDF2] flex items-center justify-center">Загрузка...</div>;
  }

  if (requireAuth && !session) {
    return <Redirect to="/" />;
  }

  // Basic mobile responsiveness logic for sidebar spacing could be added here, 
  // keeping it simple for now with a fixed pl-60 (or pl-16 if collapsed, but we aren't tracking collapsed state globally yet, assuming full for desktop)
  
  return (
    <div className="min-h-[100dvh] bg-[#E8EDF2] flex text-foreground font-sans">
      <Sidebar />
      <div className="flex-1 ml-60 transition-all duration-300 flex flex-col">
        <Topbar />
        <main className="flex-1 p-6 md:p-8 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
