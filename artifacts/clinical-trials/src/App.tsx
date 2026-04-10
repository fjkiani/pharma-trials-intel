import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import RegulatoryTimeline from "@/pages/regulatory";
import Settings from "@/pages/settings";
import SponsorReports from "@/pages/reports";
import CompetitorWatch from "@/pages/competitor-watch";
import StrikeCenter from "@/pages/strike-center";
import TargetDossier from "@/pages/TargetDossier";
import Governance from "@/pages/governance";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={() => <Redirect to="/strike-center" />} />
      <Route path="/strike-center" component={StrikeCenter} />
      <Route path="/strike-center/:nctId" component={TargetDossier} />
      <Route path="/governance" component={Governance} />
      <Route path="/competitor-watch" component={CompetitorWatch} />
      <Route path="/reports" component={SponsorReports} />
      <Route path="/regulatory" component={RegulatoryTimeline} />
      <Route path="/settings" component={Settings} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
