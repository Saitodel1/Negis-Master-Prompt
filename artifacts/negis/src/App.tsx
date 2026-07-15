import { useEffect, type ComponentType } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { useAuth } from "@/contexts/AuthContext";

import Landing from "@/pages/Landing";
import Register from "@/pages/Register";
import Onboarding from "@/pages/Onboarding";
import Dashboard from "@/pages/Dashboard";
import Booking from "@/pages/Booking";
import Reception from "@/pages/Reception";
import Sales from "@/pages/Sales";
import CrmCore from "@/pages/CrmCore";
import Tasks from "@/pages/Tasks";
import Chat from "@/pages/Chat";
import Marketplace from "@/pages/Marketplace";
import Agent from "@/pages/Agent";
import Admin from "@/pages/Admin";
import Ads from "@/pages/Ads";
import AdsCallback from "@/pages/AdsCallback";
import Reports from "@/pages/Reports";
import Automations from "@/pages/Automations";
import Privacy from "@/pages/Privacy";
import Terms from "@/pages/Terms";
import DataDeletion from "@/pages/DataDeletion";
import ResetPassword from "@/pages/ResetPassword";
import NotFound from "@/pages/not-found";
import FbPixelInit from "@/components/FbPixelInit";
import { ROUTED_MODULES, type WorkspaceModuleKey } from "@/lib/modules";

const queryClient = new QueryClient();

function firstAllowedRoute(
  rolePermissions: Record<string, boolean>,
  hasModule: (moduleKey: WorkspaceModuleKey) => boolean,
) {
  const first = ROUTED_MODULES.find(module => rolePermissions[module.permission] && hasModule(module.key));
  return first?.href ?? '/';
}

/* ── Impersonation Banner ────────────────────────────────── */
function ImpersonationBanner() {
  const { isImpersonation, impersonationClinicName, signOut } = useAuth();
  if (!isImpersonation) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      height: 40,
      background: '#DC2626',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
      fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 500,
      color: '#FFFFFF',
      letterSpacing: '0.01em',
    }}>
      <span style={{ opacity: 0.75, fontSize: 12 }}>РЕЖИМ ПРОСМОТРА</span>
      <span style={{ opacity: 0.35 }}>|</span>
      <span>{impersonationClinicName}</span>
      <span style={{ opacity: 0.35 }}>|</span>
      <button
        onClick={signOut}
        style={{
          background: 'rgba(255,255,255,0.15)',
          border: '1px solid rgba(255,255,255,0.30)',
          borderRadius: 6,
          color: '#FFFFFF', cursor: 'pointer',
          fontSize: 12, fontWeight: 600,
          padding: '3px 10px',
          fontFamily: "'Inter', sans-serif",
          letterSpacing: '0.03em',
        }}
      >
        Выйти
      </button>
    </div>
  );
}

function ProtectedPage({ component: Component, permission, moduleKey }: {
  component: ComponentType;
  permission: string;
  moduleKey: WorkspaceModuleKey;
}) {
  const {
    isLoading, user, isImpersonation, onboardingCompleted,
    userRole, rolePermissions, hasModule,
  } = useAuth();
  const [, setLocation] = useLocation();
  const isAuthenticated = Boolean(user || isImpersonation);
  const requiresOnboarding = !isImpersonation && !onboardingCompleted;
  const roleAllowed = userRole === 'owner' || userRole === 'manager' || !!rolePermissions[permission];
  const allowed = roleAllowed && hasModule(moduleKey);

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      setLocation('/');
      return;
    }
    if (requiresOnboarding) {
      setLocation('/onboarding');
      return;
    }
    if (!allowed) setLocation(firstAllowedRoute(rolePermissions, hasModule));
  }, [allowed, hasModule, isAuthenticated, isLoading, requiresOnboarding, rolePermissions, setLocation]);

  if (isLoading || !isAuthenticated || requiresOnboarding || !allowed) return null;
  return <Component />;
}

function OnboardingPage() {
  const {
    isLoading, user, isImpersonation, onboardingCompleted,
    rolePermissions, hasModule,
  } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      setLocation('/');
      return;
    }
    if (isImpersonation || onboardingCompleted) {
      setLocation(firstAllowedRoute(rolePermissions, hasModule));
    }
  }, [hasModule, isImpersonation, isLoading, onboardingCompleted, rolePermissions, setLocation, user]);

  if (isLoading || !user || isImpersonation || onboardingCompleted) return null;
  return <Onboarding />;
}

/* ── Router ── */
function Router() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/register" component={Register} />
      <Route path="/onboarding" component={OnboardingPage} />
      <Route path="/dashboard" component={() => <ProtectedPage component={Dashboard} permission="dashboard" moduleKey="dashboard" />} />
      <Route path="/booking" component={() => <ProtectedPage component={Booking} permission="booking" moduleKey="booking" />} />
      <Route path="/reception" component={() => <ProtectedPage component={Reception} permission="reception" moduleKey="reception" />} />
      <Route path="/sales" component={() => <ProtectedPage component={CrmCore} permission="crm" moduleKey="crm" />} />
      <Route path="/clients" component={() => <ProtectedPage component={Sales} permission="crm" moduleKey="crm" />} />
      <Route path="/tasks" component={() => <ProtectedPage component={Tasks} permission="tasks" moduleKey="tasks" />} />
      <Route path="/chat" component={() => <ProtectedPage component={Chat} permission="chat" moduleKey="chat" />} />
      <Route path="/marketplace" component={() => <ProtectedPage component={Marketplace} permission="marketplace" moduleKey="marketplace" />} />
      <Route path="/agent" component={Agent} />
      <Route path="/admin" component={() => <ProtectedPage component={Admin} permission="admin" moduleKey="admin" />} />
      <Route path="/ads" component={() => <ProtectedPage component={Ads} permission="ads" moduleKey="ads" />} />
      <Route path="/reports" component={() => <ProtectedPage component={Reports} permission="reports" moduleKey="reports" />} />
      <Route path="/automations" component={() => <ProtectedPage component={Automations} permission="automation" moduleKey="automations" />} />
      <Route path="/ads/callback" component={AdsCallback} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/terms" component={Terms} />
      <Route path="/data-deletion" component={DataDeletion} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route component={NotFound} />
    </Switch>
  );
}

/* ── App ── */
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <AuthProvider>
          <TooltipProvider>
            <FbPixelInit />
            <ImpersonationBanner />
            <Router />
            <Toaster position="bottom-right" />
          </TooltipProvider>
        </AuthProvider>
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
