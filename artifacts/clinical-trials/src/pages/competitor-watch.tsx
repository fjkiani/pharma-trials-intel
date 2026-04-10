import { useState } from "react";
import { LayoutShell } from "@/components/layout-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
  Eye,
  FileText,
  Bell,
  BellOff,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface WatchlistItem {
  nctId: string;
  studyTitle: string;
  sponsor: string;
  overallStatus: string;
  primaryCompletionDate: string | null;
  enrollmentCount: number | null;
  enrollmentType: string | null;
  lastUpdatePostDate: string | null;
  lastCheckedAt: string | null;
  fetchError: boolean;
}

interface WatchlistAlert {
  id: string;
  nctId: string;
  studyTitle: string;
  sponsor: string;
  changeSummary: string;
  clinicalInterpretation: string;
  changedFields: string[];
  status: "new" | "approved" | "dismissed";
  createdAt: string;
  actedAt: string | null;
  docUrl: string | null;
  docId: string | null;
}

const API_BASE = "/api";

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s === "recruiting") return <Badge className="bg-green-500/10 text-green-700 border-green-500/20">Recruiting</Badge>;
  if (s === "completed") return <Badge className="bg-blue-500/10 text-blue-700 border-blue-500/20">Completed</Badge>;
  if (s.includes("terminat") || s.includes("withdrawn") || s.includes("suspend")) {
    return <Badge className="bg-red-500/10 text-red-700 border-red-500/20">{status}</Badge>;
  }
  if (s === "not yet recruiting") return <Badge className="bg-amber-500/10 text-amber-700 border-amber-500/20">{status}</Badge>;
  if (s === "active, not recruiting") return <Badge className="bg-purple-500/10 text-purple-700 border-purple-500/20">{status}</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

function AlertCard({ alert, onRefresh }: { alert: WatchlistAlert; onRefresh: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const approve = useMutation({
    mutationFn: () => apiFetch<WatchlistAlert>(`/watchlist/alerts/${alert.id}/approve`, { method: "POST" }),
    onSuccess: (data) => {
      toast({
        title: "Alert Approved",
        description: data.docUrl
          ? "PI briefing document created. Open the link to review and share."
          : "Alert approved. (Note: Google Doc creation encountered an issue — content was saved.)",
      });
      queryClient.invalidateQueries({ queryKey: ["watchlist-alerts"] });
      onRefresh();
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Approval Failed", description: msg, variant: "destructive" });
    },
  });

  const dismiss = useMutation({
    mutationFn: () => apiFetch<WatchlistAlert>(`/watchlist/alerts/${alert.id}/dismiss`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Alert Dismissed" });
      queryClient.invalidateQueries({ queryKey: ["watchlist-alerts"] });
      onRefresh();
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Dismiss Failed", description: msg, variant: "destructive" });
    },
  });

  const isActing = approve.isPending || dismiss.isPending;

  if (alert.status !== "new") {
    return (
      <div className="flex items-start gap-3 rounded-md border p-3 text-sm text-muted-foreground bg-muted/30">
        {alert.status === "approved" ? (
          <CheckCircle2 className="h-4 w-4 mt-0.5 text-green-600 shrink-0" />
        ) : (
          <X className="h-4 w-4 mt-0.5 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-foreground/80">{alert.nctId}</span>
            <Badge variant="outline" className="text-xs capitalize">{alert.status}</Badge>
          </div>
          <p className="text-xs mt-0.5 line-clamp-1">{alert.changeSummary}</p>
          {alert.docUrl && (
            <a
              href={alert.docUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary underline underline-offset-2 flex items-center gap-1 mt-1"
            >
              <FileText className="h-3 w-3" />
              Open PI Briefing Doc
            </a>
          )}
        </div>
        <span className="text-xs shrink-0">{alert.actedAt ? format(parseISO(alert.actedAt), "MMM d") : ""}</span>
      </div>
    );
  }

  return (
    <Card className="border-amber-200 bg-amber-50/30">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-sm font-semibold">{alert.nctId}</CardTitle>
                <Badge className="bg-amber-500/10 text-amber-700 border-amber-500/20 text-xs">New Alert</Badge>
              </div>
              <CardDescription className="text-xs mt-0.5">
                {alert.studyTitle} · {alert.sponsor}
              </CardDescription>
            </div>
          </div>
          <span className="text-xs text-muted-foreground shrink-0">
            {format(parseISO(alert.createdAt), "MMM d, h:mm a")}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <p className="text-sm font-medium text-foreground">{alert.changeSummary}</p>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{alert.clinicalInterpretation}</p>
        </div>

        {alert.changedFields.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {alert.changedFields.map((f) => (
              <Badge key={f} variant="outline" className="text-xs font-mono">{f}</Badge>
            ))}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            onClick={() => approve.mutate()}
            disabled={isActing}
            className="gap-1.5"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            {approve.isPending ? "Creating Briefing..." : "Approve & Save to Google Doc"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => dismiss.mutate()}
            disabled={isActing}
            className="gap-1.5"
          >
            <BellOff className="h-3.5 w-3.5" />
            {dismiss.isPending ? "Dismissing..." : "Dismiss"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function WatchlistRow({ item, onRemove }: { item: WatchlistItem; onRemove: (nct: string) => void }) {
  return (
    <tr className="border-b last:border-0 hover:bg-muted/30 transition-colors">
      <td className="py-2.5 px-3 font-mono text-sm font-medium text-primary">{item.nctId}</td>
      <td className="py-2.5 px-3 text-sm max-w-[280px]">
        <p className="line-clamp-1" title={item.studyTitle}>{item.fetchError ? "—" : item.studyTitle}</p>
        <p className="text-xs text-muted-foreground line-clamp-1">{item.fetchError ? "Fetch error" : item.sponsor}</p>
      </td>
      <td className="py-2.5 px-3">
        {item.fetchError ? (
          <Badge variant="destructive" className="text-xs">Fetch Error</Badge>
        ) : (
          <StatusBadge status={item.overallStatus} />
        )}
      </td>
      <td className="py-2.5 px-3 text-sm text-muted-foreground">
        {item.primaryCompletionDate ?? "—"}
      </td>
      <td className="py-2.5 px-3 text-sm text-muted-foreground">
        {item.enrollmentCount != null ? `${item.enrollmentCount} (${item.enrollmentType ?? "?"})` : "—"}
      </td>
      <td className="py-2.5 px-3 text-xs text-muted-foreground">
        {item.lastCheckedAt ? format(parseISO(item.lastCheckedAt), "MMM d, h:mm a") : "Never"}
      </td>
      <td className="py-2.5 px-3">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onRemove(item.nctId)}
          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
          title="Remove from watchlist"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </td>
    </tr>
  );
}

export default function CompetitorWatch() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [nctInput, setNctInput] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  const watchlistQuery = useQuery({
    queryKey: ["watchlist"],
    queryFn: () => apiFetch<WatchlistItem[]>("/watchlist"),
    refetchInterval: 5 * 60 * 1000,
  });

  const alertsQuery = useQuery({
    queryKey: ["watchlist-alerts"],
    queryFn: () => apiFetch<WatchlistAlert[]>("/watchlist/alerts"),
    refetchInterval: 2 * 60 * 1000,
  });

  const addTrial = useMutation({
    mutationFn: (nctId: string) =>
      apiFetch<{ watchlist: string[]; trial: { studyTitle: string } }>("/watchlist", {
        method: "POST",
        body: JSON.stringify({ nctId }),
      }),
    onSuccess: (data) => {
      const title = data.trial?.studyTitle ?? nctInput;
      toast({ title: "Trial Added", description: `"${title}" is now being watched.` });
      setNctInput("");
      queryClient.invalidateQueries({ queryKey: ["watchlist"] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Failed to Add Trial", description: msg, variant: "destructive" });
    },
  });

  const removeTrial = useMutation({
    mutationFn: (nctId: string) => apiFetch<{ watchlist: string[] }>(`/watchlist/${nctId}`, { method: "DELETE" }),
    onSuccess: (_data, nctId) => {
      toast({ title: "Trial Removed", description: `${nctId} removed from watchlist.` });
      queryClient.invalidateQueries({ queryKey: ["watchlist"] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Failed to Remove", description: msg, variant: "destructive" });
    },
  });

  const pollNow = useMutation({
    mutationFn: () => apiFetch<{ checked: number; alertsCreated: number; errors: string[] }>("/watchlist/poll", { method: "POST" }),
    onSuccess: (data) => {
      toast({
        title: "Poll Complete",
        description: `Checked ${data.checked} trial${data.checked !== 1 ? "s" : ""}. ${data.alertsCreated} new alert${data.alertsCreated !== 1 ? "s" : ""} detected.${data.errors.length > 0 ? ` ${data.errors.length} error(s) — check logs.` : ""}`,
      });
      queryClient.invalidateQueries({ queryKey: ["watchlist"] });
      queryClient.invalidateQueries({ queryKey: ["watchlist-alerts"] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Poll Failed", description: msg, variant: "destructive" });
    },
  });

  function handleAdd() {
    const v = nctInput.trim().toUpperCase();
    if (!v) return;
    addTrial.mutate(v);
  }

  const [allQuietOpen, setAllQuietOpen] = useState(false);

  const alerts = alertsQuery.data ?? [];
  const watchlist = watchlistQuery.data ?? [];
  const newAlerts = alerts.filter((a) => a.status === "new");
  const historyAlerts = alerts.filter((a) => a.status !== "new");
  const alertedNctIds = new Set(newAlerts.map((a) => a.nctId));
  const quietTrials = watchlist.filter((t) => !alertedNctIds.has(t.nctId));

  return (
    <LayoutShell>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Competitor Watch</h1>
            <p className="text-muted-foreground mt-2">
              Monitor competitor oncology trials on ClinicalTrials.gov. Get plain-English alerts when anything changes.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => pollNow.mutate()}
            disabled={pollNow.isPending}
            className="gap-2 shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${pollNow.isPending ? "animate-spin" : ""}`} />
            {pollNow.isPending ? "Checking..." : "Check Now"}
          </Button>
        </div>

        {newAlerts.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-amber-600" />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-700">
                {newAlerts.length} New Alert{newAlerts.length !== 1 ? "s" : ""} — Action Required
              </h2>
            </div>
            <div className="space-y-3">
              {alertsQuery.isLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : (
                newAlerts.map((alert) => (
                  <AlertCard
                    key={alert.id}
                    alert={alert}
                    onRefresh={() => {
                      queryClient.invalidateQueries({ queryKey: ["watchlist-alerts"] });
                    }}
                  />
                ))
              )}
            </div>
          </div>
        )}

        {!alertsQuery.isLoading && quietTrials.length > 0 && (
          <Collapsible open={allQuietOpen} onOpenChange={setAllQuietOpen}>
            <CollapsibleTrigger className="w-full">
              <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700 hover:bg-green-100 transition-colors cursor-pointer">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span className="flex-1 text-left">
                  All quiet — no new changes detected across {quietTrials.length} watched trial{quietTrials.length !== 1 ? "s" : ""}.
                </span>
                {allQuietOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-1 rounded-md border border-green-100 bg-green-50/50 divide-y divide-green-100">
                {quietTrials.map((trial) => (
                  <div key={trial.nctId} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <BellOff className="h-3.5 w-3.5 text-green-500 shrink-0" />
                      <span className="font-mono text-xs text-muted-foreground shrink-0">{trial.nctId}</span>
                      <span className="text-foreground truncate">{trial.studyTitle}</span>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0 pl-2">
                      {trial.lastCheckedAt ? `Checked ${format(parseISO(trial.lastCheckedAt), "MMM d")}` : "Not yet checked"}
                    </span>
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">Watched Trials</CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  {watchlist.length} trial{watchlist.length !== 1 ? "s" : ""} monitored
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="NCT04567890"
                  value={nctInput}
                  onChange={(e) => setNctInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                  className="pl-8 h-9 font-mono"
                  disabled={addTrial.isPending}
                />
              </div>
              <Button
                size="sm"
                onClick={handleAdd}
                disabled={addTrial.isPending || !nctInput.trim()}
                className="gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" />
                {addTrial.isPending ? "Adding..." : "Add Trial"}
              </Button>
            </div>

            {watchlistQuery.isLoading ? (
              <div className="space-y-2">
                {Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : watchlist.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground text-sm">
                <Eye className="h-8 w-8 mx-auto mb-3 opacity-40" />
                <p className="font-medium">No trials being watched</p>
                <p className="text-xs mt-1">Enter an NCT number above to start monitoring.</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 border-b text-xs font-medium text-muted-foreground">
                      <th className="py-2 px-3 text-left">NCT ID</th>
                      <th className="py-2 px-3 text-left">Trial / Sponsor</th>
                      <th className="py-2 px-3 text-left">Status</th>
                      <th className="py-2 px-3 text-left">Primary Completion</th>
                      <th className="py-2 px-3 text-left">Enrollment</th>
                      <th className="py-2 px-3 text-left">Last Checked</th>
                      <th className="py-2 px-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {watchlist.map((item) => (
                      <WatchlistRow
                        key={item.nctId}
                        item={item}
                        onRemove={(nct) => removeTrial.mutate(nct)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {historyAlerts.length > 0 && (
          <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground">
                {historyOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                Alert History ({historyAlerts.length})
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 space-y-2">
              {historyAlerts.map((alert) => (
                <AlertCard key={alert.id} alert={alert} onRefresh={() => {}} />
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </LayoutShell>
  );
}
