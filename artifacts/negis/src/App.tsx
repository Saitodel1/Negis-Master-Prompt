import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";

import Landing from "@/pages/Landing";
import Register from "@/pages/Register";
import Onboarding from "@/pages/Onboarding";
import Dashboard from "@/pages/Dashboard";
import Booking from "@/pages/Booking";
import Reception from "@/pages/Reception";
import Sales from "@/pages/Sales";
import Agent from "@/pages/Agent";
import Admin from "@/pages/Admin";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/register" component={Register} />
      <Route path="/onboarding" component={Onboarding} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/booking" component={Booking} />
      <Route path="/reception" component={Reception} />
      <Route path="/sales" component={Sales} />
      <Route path="/agent" component={Agent} />
      <Route path="/admin" component={Admin} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <AuthProvider>
          <TooltipProvider>
            <Router />
            <Toaster position="bottom-right" />
          </TooltipProvider>
        </AuthProvider>
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
