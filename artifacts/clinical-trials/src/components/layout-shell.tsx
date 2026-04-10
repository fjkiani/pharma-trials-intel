import React from "react";
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
import { Settings, FileText, CheckCircle2, AlertCircle, ClipboardList, Eye } from "lucide-react";
import { useGetSettings, getGetSettingsQueryKey } from "@workspace/api-client-react";

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: settings } = useGetSettings({ 
    query: { enabled: true, queryKey: getGetSettingsQueryKey() } 
  });

  const isConfigured = settings && settings.notionRegulatoryDbId && settings.googleCalendarId;

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
                    <SidebarMenuButton asChild isActive={location.startsWith("/competitor-watch")}>
                      <Link href="/competitor-watch">
                        <Eye className="h-4 w-4" />
                        <span>Competitor Watch</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location.startsWith("/settings")}>
                      <Link href="/settings">
                        <Settings className="h-4 w-4" />
                        <span>Settings</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter className="p-4 border-t border-sidebar-border">
            <div className="flex items-center gap-2 px-2 text-sm text-sidebar-foreground/80">
              {isConfigured ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span>Systems Connected</span>
                </>
              ) : (
                <>
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                  <span>Setup Required</span>
                </>
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
