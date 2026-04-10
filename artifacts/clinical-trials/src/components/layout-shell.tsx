import React, { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { 
  Sidebar, 
  SidebarContent, 
  SidebarGroup, 
  SidebarGroupContent, 
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu, 
  SidebarMenuButton, 
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarFooter
} from "@/components/ui/sidebar";
import { Settings, FileText, CheckCircle2, AlertCircle, XCircle, ClipboardList, Loader2, Eye, Radar, ShieldCheck, Cpu } from "lucide-react";

interface IntegrationStatus {
  label: string;
  connected: boolean;
  degraded?: boolean;
  statusReason?: string | null;
  needsReconnect?: boolean;
}

interface HealthResponse {
  notion?: IntegrationStatus;
  googleSheets?: IntegrationStatus;
  googleDocs?: IntegrationStatus;
  gmail?: IntegrationStatus;
  googleCalendar?: IntegrationStatus;
}

function useLiveHealth() {
  const [status, setStatus] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failingServices, setFailingServices] = useState<string[]>([]);

  const fetchHealth = async () => {
    try {
      const res = await fetch("/api/integrations/status");
      if (!res.ok) throw new Error("status fetch failed");
      const data = (await res.json()) as HealthResponse;
      setStatus(data);

      const failing: string[] = [];
      for (const [, svc] of Object.entries(data)) {
        const s = svc as IntegrationStatus;
        if (!s.connected) {
          if (s.needsReconnect) failing.push(`${s.label}: reconnection required`);
          else if (s.statusReason) failing.push(`${s.label}: ${s.statusReason}`);
          else failing.push(s.label);
        } else if (s.degraded && s.statusReason) {
          failing.push(s.statusReason);
        }
      }
      setFailingServices(failing);
    } catch {
      setFailingServices(["Health check unreachable"]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 60_000);
    return () => clearInterval(interval);
  }, []);

  const allConnected =
    status !== null &&
    Object.values(status).every((s) => {
      const svc = s as IntegrationStatus;
      return svc.connected && !svc.degraded;
    }) &&
    failingServices.length === 0;

  return { status, loading, allConnected, failingServices };
}

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { loading, allConnected, failingServices } = useLiveHealth();

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <Sidebar>
          <SidebarHeader className="p-4">
            <div className="flex items-center gap-2 px-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <FileText className="h-4 w-4" />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-bold leading-tight text-sidebar-foreground">Clinical Trials</span>
                <span className="text-xs text-sidebar-foreground/70">Co-Pilot</span>
              </div>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Workspace</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location.startsWith("/strike-center")}>
                      <Link href="/strike-center">
                        <Radar className="h-4 w-4 text-teal-600" />
                        <span className="font-semibold">Competitor Intelligence</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location.startsWith("/governance")}>
                      <Link href="/governance">
                        <ShieldCheck className="h-4 w-4 text-violet-600" />
                        <span>Governance & Audit</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location.startsWith("/competitor-watch")}>
                      <Link href="/competitor-watch">
                        <Eye className="h-4 w-4" />
                        <span>Competitor Watch</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location.startsWith("/reports")}>
                      <Link href="/reports">
                        <ClipboardList className="h-4 w-4" />
                        <span>Sponsor Reports</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location.startsWith("/regulatory")}>
                      <Link href="/regulatory">
                        <FileText className="h-4 w-4" />
                        <span>Regulatory Timeline</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location.startsWith("/settings")}>
                      <Link href="/settings">
                        <Settings className="h-4 w-4" />
                        <span>Connection Setup</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarGroup>
              <SidebarGroupLabel>Admin</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location.startsWith("/admin/rules")}>
                      <Link href="/admin/rules">
                        <Cpu className="h-4 w-4 text-slate-500" />
                        <span>Kill-Chain Rules</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter className="p-4 border-t border-sidebar-border">
            <div className="px-2 text-sm text-sidebar-foreground/80 space-y-1">
              {loading ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="text-xs">Checking systems…</span>
                </div>
              ) : allConnected ? (
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span>Systems Connected</span>
                </div>
              ) : failingServices.length > 0 ? (
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                    <span className="text-xs font-medium">Degraded</span>
                  </div>
                  {failingServices.slice(0, 3).map((msg, i) => (
                    <p key={i} className="text-xs text-sidebar-foreground/60 pl-6 leading-tight">{msg}</p>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-red-500" />
                  <span>Setup Required</span>
                </div>
              )}
            </div>
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>
        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-auto p-8">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
