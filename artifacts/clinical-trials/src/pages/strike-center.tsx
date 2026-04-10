import { useState } from "react";
import { LayoutShell } from "@/components/layout-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ExternalLink,
  Send,
  CheckCircle2,
  Flag,
  Trash2,
  AlertTriangle,
  RefreshCw,
  Zap,
  ShieldAlert,
  CheckCheck,
  Clock,
  FileText,
  Radar,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

type AlertSeverity = "critical" | "high" | "medium";
type BriefStatus = "Draft" | "PI Review" | "Approved" | "Sent" | "Discarded";

interface StrikeFeedItem {
  nctId: string;
  detectedAt: string;
  module: string;
  severity: AlertSeverity;
  headline: string;
  detail: string;
}

interface IntelligenceBrief {
  id: string;
  docUrl: string;
  docId: string;
  status: BriefStatus;
  generatedAt: string;
  alertCount: number;
  alertIds: string[];
  sentToPiAt: string | null;
  approvedAt: string | null;
  finalizedAt: string | null;
}

interface WatchlistItem {
  nctId: string;
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

function severityConfig(severity: AlertSeverity) {
  switch (severity) {
    case "critical":
      return {
        border: "border-red-300",
        bg: "bg-red-50/60",
        badge: "bg-red-500/10 text-red-700 border-red-400/30",
        label: "Critical",
        icon: <ShieldAlert className="h-3.5 w-3.5" />,
        dot: "bg-red-500",
      };
    case "high":
      return {
        border: "border-orange-300",
        bg: "bg-orange-50/60",
        badge: "bg-orange-500/10 text-orange-700 border-orange-400/30",
        label: "High",
        icon: <AlertTriangle className="h-3.5 w-3.5" />,
        dot: "bg-orange-500",
      };
    case "medium":
      return {
        border: "border-amber-200",
        bg: "bg-amber-50/40",
        badge: "bg-amber-500/10 text-amber-700 border-amber-400/20",
        label: "Medium",
        icon: <AlertTriangle className="h-3.5 w-3.5" />,
        dot: "bg-amber-400",
      };
  }
}

function AnomalyCard({ item }: { item: StrikeFeedItem }) {
  const cfg = severityConfig(item.severity);

  return (
    <div className={`rounded-lg border ${cfg.border} ${cfg.bg} p-3 space-y-2`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`h-2 w-2 rounded-full shrink-0 mt-1 ${cfg.dot}`} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-mono text-xs font-bold text-foreground">{item.nctId}</span>
              <Badge className={`text-[10px] px-1.5 py-0 gap-1 ${cfg.badge}`}>
                {cfg.icon}
                {cfg.label}
              </Badge>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">
                {item.module}
              </Badge>
            </div>
          </div>
        </div>
        <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">
          {format(parseISO(item.detectedAt), "MMM d, h:mm a")}
        </span>
      </div>

      <p className="text-xs font-medium text-foreground leading-snug">{item.headline}</p>
      <p className="text-xs text-muted-foreground leading-relaxed">{item.detail}</p>
    </div>
  );
}

function StepBadge({
  label,
  active,
  complete,
}: {
  label: string;
  active?: boolean;
  complete?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border ${
        complete
          ? "bg-green-500/10 text-green-700 border-green-500/20"
          : active
            ? "bg-primary/10 text-primary border-primary/20"
            : "bg-muted text-muted-foreground border-transparent"
      }`}
    >
      {complete ? <CheckCircle2 className="h-3 w-3" /> : null}
      {label}
    </div>
  );
}

function LifecycleBar({ status }: { status: BriefStatus }) {
  const steps = ["Draft", "PI Review", "Approved", "Sent"] as const;
  const idx = steps.indexOf(status as (typeof steps)[number]);
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center gap-1">
          <StepBadge label={s} active={i === idx} complete={i < idx} />
          {i < steps.length - 1 && (
            <span className="text-muted-foreground text-xs">→</span>
          )}
        </div>
      ))}
    </div>
  );
}

function BriefCard({
  brief,
  onRefresh,
}: {
  brief: IntelligenceBrief;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const isDiscarded = brief.status === "Discarded";

  const sendToPi = useMutation({
    mutationFn: () => apiFetch<IntelligenceBrief>(`/briefs/${brief.id}/send-to-pi`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Sent to PI", description: "The PI has been emailed a link to the intelligence brief." });
      onRefresh();
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Failed to Send", description: msg, variant: "destructive" });
    },
  });

  const markApproved = useMutation({
    mutationFn: () => apiFetch<IntelligenceBrief>(`/briefs/${brief.id}/mark-approved`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Brief Approved", description: "Marked as approved by PI." });
      onRefresh();
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const markFinal = useMutation({
    mutationFn: () => apiFetch<IntelligenceBrief>(`/briefs/${brief.id}/mark-final`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Brief Marked Sent", description: "Intelligence brief recorded as sent to sponsor." });
      onRefresh();
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const discard = useMutation({
    mutationFn: () => apiFetch<IntelligenceBrief>(`/briefs/${brief.id}/discard`, { method: "POST" }),
    onSuccess: () => {
      toast({
        title: "Brief Discarded",
        description:
          brief.status === "Draft"
            ? "The brief draft and its Google Doc have been deleted."
            : "The brief has been discarded. The Google Doc remains accessible.",
      });
      setConfirmDiscard(false);
      onRefresh();
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Error", description: msg, variant: "destructive" });
      setConfirmDiscard(false);
    },
  });

  return (
    <>
      <Card className={isDiscarded ? "opacity-50" : ""}>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-base">
                  Intelligence Brief — {format(parseISO(brief.generatedAt), "MMM d, yyyy")}
                </CardTitle>
                <Badge variant="secondary" className="text-xs">
                  {brief.alertCount} alert{brief.alertCount !== 1 ? "s" : ""}
                </Badge>
              </div>
              <CardDescription className="text-xs">
                Generated {format(parseISO(brief.generatedAt), "MMM d, yyyy 'at' h:mm a")}
                {brief.sentToPiAt &&
                  ` · Sent to PI ${format(parseISO(brief.sentToPiAt), "MMM d, h:mm a")}`}
                {brief.approvedAt &&
                  ` · Approved ${format(parseISO(brief.approvedAt), "MMM d, h:mm a")}`}
                {brief.finalizedAt &&
                  ` · Finalized ${format(parseISO(brief.finalizedAt), "MMM d, h:mm a")}`}
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <a href={brief.docUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                Open Doc
              </a>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isDiscarded && <LifecycleBar status={brief.status} />}

          {!isDiscarded && (
            <div className="flex flex-wrap gap-2">
              {brief.status === "Draft" && (
                <>
                  <Button
                    size="sm"
                    onClick={() => sendToPi.mutate()}
                    disabled={sendToPi.isPending}
                  >
                    <Send className="h-3.5 w-3.5 mr-1.5" />
                    {sendToPi.isPending ? "Sending..." : "Send to PI"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirmDiscard(true)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                    Discard
                  </Button>
                </>
              )}

              {brief.status === "PI Review" && (
                <>
                  <Button
                    size="sm"
                    onClick={() => markApproved.mutate()}
                    disabled={markApproved.isPending}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                    {markApproved.isPending ? "Approving..." : "Mark Approved"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirmDiscard(true)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                    Discard
                  </Button>
                </>
              )}

              {brief.status === "Approved" && (
                <>
                  <Button
                    size="sm"
                    onClick={() => markFinal.mutate()}
                    disabled={markFinal.isPending}
                  >
                    <Flag className="h-3.5 w-3.5 mr-1.5" />
                    {markFinal.isPending ? "Marking..." : "Mark as Sent to Sponsor"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirmDiscard(true)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                    Discard
                  </Button>
                </>
              )}

              {brief.status === "Sent" && (
                <div className="flex items-center gap-2 text-sm text-green-700">
                  <CheckCheck className="h-4 w-4" />
                  <span>Sent to sponsor</span>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this intelligence brief?</AlertDialogTitle>
            <AlertDialogDescription>
              {brief.status === "Draft"
                ? "The Google Doc will be permanently deleted from Drive. This cannot be undone."
                : "This brief will be marked as discarded. The Google Doc will not be deleted — the PI still has access to it."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => discard.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function StrikeCenter() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const feedQuery = useQuery({
    queryKey: ["strike-feed"],
    queryFn: () =>
      apiFetch<{ alerts: StrikeFeedItem[] }>("/strike/feed").then((r) => r.alerts),
    refetchInterval: 2 * 60 * 1000,
  });

  const briefsQuery = useQuery({
    queryKey: ["briefs"],
    queryFn: () => apiFetch<IntelligenceBrief[]>("/briefs"),
  });

  const watchlistQuery = useQuery({
    queryKey: ["watchlist-ncts"],
    queryFn: () => apiFetch<WatchlistItem[]>("/watchlist"),
  });

  const refreshSwarm = useMutation({
    mutationFn: async () => {
      const watchlist = watchlistQuery.data ?? [];
      const nctIds = watchlist.map((w) => w.nctId);
      if (nctIds.length === 0) {
        throw new Error(
          "No trials in your watchlist yet. Add competitor trials on the Competitor Watch page first.",
        );
      }
      return apiFetch<{ processed: number; failed: number; alertsGenerated: number }>(
        "/internal/swarm-poll",
        {
          method: "POST",
          body: JSON.stringify({ nctIds }),
        },
      );
    },
    onSuccess: (data) => {
      toast({
        title: "Swarm Refreshed",
        description: `Checked ${data.processed} trial${data.processed !== 1 ? "s" : ""}. ${data.alertsGenerated} new anomaly${data.alertsGenerated !== 1 ? "s" : ""} detected.`,
      });
      queryClient.invalidateQueries({ queryKey: ["strike-feed"] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Swarm Refresh Failed", description: msg, variant: "destructive" });
    },
  });

  const draftBrief = useMutation({
    mutationFn: () => apiFetch<IntelligenceBrief>("/briefs", { method: "POST" }),
    onSuccess: () => {
      toast({
        title: "Intelligence Brief Created",
        description: "A new draft brief has been generated from active alerts. Review it and send to your PI.",
      });
      queryClient.invalidateQueries({ queryKey: ["briefs"] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Failed to Create Brief", description: msg, variant: "destructive" });
    },
  });

  function invalidateBriefs() {
    queryClient.invalidateQueries({ queryKey: ["briefs"] });
  }

  const feed = feedQuery.data ?? [];
  const briefs = briefsQuery.data ?? [];

  const criticalCount = feed.filter((a) => a.severity === "critical").length;
  const highCount = feed.filter((a) => a.severity === "high").length;

  const hasNewAlerts = feed.length > 0;
  const isPending = refreshSwarm.isPending || draftBrief.isPending;

  return (
    <LayoutShell>
      <div className="space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Radar className="h-6 w-6 text-teal-600" />
              <h1 className="text-3xl font-bold tracking-tight">Competitor Intelligence</h1>
            </div>
            <p className="text-muted-foreground mt-2">
              Live threat radar and automated intelligence briefings.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refreshSwarm.mutate()}
              disabled={isPending}
              className="gap-2"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${refreshSwarm.isPending ? "animate-spin" : ""}`}
              />
              {refreshSwarm.isPending ? "Scanning..." : "Refresh Swarm"}
            </Button>

            <Button
              onClick={() => draftBrief.mutate()}
              disabled={isPending || !hasNewAlerts}
              className="gap-2 bg-teal-600 hover:bg-teal-700 text-white"
              title={!hasNewAlerts ? "No active anomalies to brief on" : undefined}
            >
              <Zap className={`h-4 w-4 ${draftBrief.isPending ? "animate-pulse" : ""}`} />
              {draftBrief.isPending ? "Drafting..." : "Draft Intelligence Brief"}
            </Button>
          </div>
        </div>

        {feed.length === 0 && !feedQuery.isLoading && (
          <div className="flex items-center gap-3 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>All clear — no active anomalies detected across your watched trials.</span>
          </div>
        )}

        {(feedQuery.isLoading || feed.length > 0) && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-widest text-foreground/60">
                Live Anomalies
              </h2>
              <div className="flex items-center gap-2">
                {criticalCount > 0 && (
                  <Badge className="bg-red-500/10 text-red-700 border-red-400/30 gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse inline-block" />
                    {criticalCount} Critical
                  </Badge>
                )}
                {highCount > 0 && (
                  <Badge className="bg-orange-500/10 text-orange-700 border-orange-400/30">
                    {highCount} High
                  </Badge>
                )}
                {feed.length > 0 && (
                  <Badge variant="secondary">{feed.length} total</Badge>
                )}
              </div>
            </div>

            {feedQuery.isLoading ? (
              <div className="grid sm:grid-cols-2 gap-3">
                {Array(3).fill(0).map((_, i) => (
                  <Skeleton key={i} className="h-32 w-full" />
                ))}
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3">
                {feed
                  .slice()
                  .sort((a, b) => {
                    const order: Record<AlertSeverity, number> = { critical: 0, high: 1, medium: 2 };
                    return order[a.severity] - order[b.severity];
                  })
                  .map((item) => (
                    <AnomalyCard key={`${item.nctId}-${item.module}`} item={item} />
                  ))}
              </div>
            )}
          </div>
        )}

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-widest text-foreground/60">
              Intelligence Briefs
            </h2>
          </div>

          {briefsQuery.isLoading ? (
            <div className="space-y-4">
              {Array(2).fill(0).map((_, i) => (
                <Skeleton key={i} className="h-40 w-full" />
              ))}
            </div>
          ) : briefs.length > 0 ? (
            <div className="space-y-4">
              {briefs.map((brief) => (
                <BriefCard key={brief.id} brief={brief} onRefresh={invalidateBriefs} />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-teal-500/10 mx-auto mb-4">
                  <Zap className="h-7 w-7 text-teal-600" />
                </div>
                <h3 className="text-base font-semibold">No intelligence briefs yet</h3>
                <p className="text-muted-foreground text-sm mt-2 max-w-sm mx-auto">
                  When anomalies are detected, click{" "}
                  <strong>Draft Intelligence Brief</strong> to generate a pre-filled
                  Google Doc summary ready to send to your PI.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </LayoutShell>
  );
}
