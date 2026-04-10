import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { LayoutShell } from "@/components/layout-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  AlertOctagon,
  AlertTriangle,
  AlertCircle,
  ExternalLink,
  FlaskConical,
  Target,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  ArrowRight,
  Clock,
  Users,
  Activity,
} from "lucide-react";

const API_BASE = "/api";

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

type AlertSeverity = "critical" | "high" | "medium" | "low";

interface TriggeredAlert {
  nctId: string;
  detectedAt: string;
  module: string;
  severity: AlertSeverity;
  headline: string;
  detail: string;
}

interface Outcome {
  measure: string;
  timeFrame: string;
  description?: string | null;
}

interface BaselineSnapshot {
  overallStatus: string | null;
  primaryCompletionDate: string | null;
  enrollmentCount: number | null;
}

interface TrialMeta {
  nctId: string;
  title: string;
  overallStatus: string;
  whyStopped: string | null;
  primaryCompletionDate: string | null;
  enrollmentCount: number | null;
  enrollmentType: string | null;
  phase: string;
  hasResults: boolean;
  conditions: string[];
  leadSponsor: string;
  briefSummary: string | null;
  primaryOutcomes: Outcome[];
  secondaryOutcomes: Outcome[];
  fetchedAt: string | null;
  baseline: BaselineSnapshot | null;
}

interface DossierResponse {
  nctId: string;
  alerts: TriggeredAlert[];
  trial: TrialMeta;
}

// ── Severity config ────────────────────────────────────────────────────────────

const SEVERITY_CONFIG: Record<AlertSeverity, {
  label: string;
  badgeClass: string;
  borderClass: string;
  bgClass: string;
  Icon: React.ComponentType<{ className?: string }>;
  textClass: string;
}> = {
  critical: {
    label: "CRITICAL",
    badgeClass: "bg-red-500 text-white",
    borderClass: "border-red-400",
    bgClass: "bg-red-50",
    textClass: "text-red-700",
    Icon: AlertOctagon,
  },
  high: {
    label: "HIGH",
    badgeClass: "bg-orange-500 text-white",
    borderClass: "border-orange-400",
    bgClass: "bg-orange-50",
    textClass: "text-orange-700",
    Icon: AlertTriangle,
  },
  medium: {
    label: "MEDIUM",
    badgeClass: "bg-amber-400 text-white",
    borderClass: "border-amber-300",
    bgClass: "bg-amber-50",
    textClass: "text-amber-700",
    Icon: AlertCircle,
  },
  low: {
    label: "LOW",
    badgeClass: "bg-gray-400 text-white",
    borderClass: "border-gray-300",
    bgClass: "bg-gray-50",
    textClass: "text-gray-600",
    Icon: AlertCircle,
  },
};

const STATUS_COLOR: Record<string, string> = {
  TERMINATED: "text-red-700 bg-red-50 border-red-300",
  WITHDRAWN: "text-red-700 bg-red-50 border-red-300",
  SUSPENDED: "text-red-700 bg-red-50 border-red-300",
  COMPLETED: "text-emerald-700 bg-emerald-50 border-emerald-300",
  RECRUITING: "text-blue-700 bg-blue-50 border-blue-300",
  ACTIVE_NOT_RECRUITING: "text-amber-700 bg-amber-50 border-amber-300",
  NOT_YET_RECRUITING: "text-gray-600 bg-gray-50 border-gray-300",
};

// ── Module-specific diff viewer ────────────────────────────────────────────────

function DiffRow({
  label,
  prev,
  curr,
  positive,
}: {
  label: string;
  prev: string | number | null;
  curr: string | number | null;
  positive?: "up" | "down";
}) {
  const prevStr = prev != null ? String(prev) : "—";
  const currStr = curr != null ? String(curr) : "—";
  const changed = prevStr !== currStr && prev != null && curr != null;
  const isUp = positive === "up";
  const Arrow = isUp ? TrendingUp : TrendingDown;

  return (
    <div className="grid grid-cols-[120px_1fr_28px_1fr] items-center gap-2 py-2 border-b border-border last:border-0 text-sm">
      <span className="text-muted-foreground font-medium text-xs uppercase tracking-wide">{label}</span>
      <span className={`font-mono px-2 py-0.5 rounded text-xs ${changed ? "line-through text-muted-foreground bg-red-50" : "text-foreground bg-muted"}`}>
        {prevStr}
      </span>
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground mx-auto" />
      <span className={`font-mono px-2 py-0.5 rounded text-xs font-semibold ${changed ? "text-emerald-700 bg-emerald-50 ring-1 ring-emerald-300" : "text-muted-foreground bg-muted"}`}>
        {currStr}
        {changed && <Arrow className="inline h-3 w-3 ml-1" />}
      </span>
    </div>
  );
}

function ModuleDiffViewer({ alert, baseline }: { alert: TriggeredAlert; baseline: BaselineSnapshot | null }) {
  switch (alert.module) {
    case "TimelineShift":
      return (
        <div className="rounded-md border border-border bg-background p-3">
          <DiffRow
            label="Completion Date"
            prev={baseline?.primaryCompletionDate ?? null}
            curr={null}
            positive="up"
          />
          <p className="text-xs text-muted-foreground mt-2 italic">
            Exact dates are embedded in the alert headline above. Baseline snapshot available for cross-reference.
          </p>
        </div>
      );

    case "EnrollmentBleed":
      return (
        <div className="rounded-md border border-border bg-background p-3">
          <DiffRow
            label="Enrollment"
            prev={baseline?.enrollmentCount ?? null}
            curr={null}
            positive="up"
          />
          <p className="text-xs text-muted-foreground mt-2 italic">
            Exact counts are embedded in the alert headline above.
          </p>
        </div>
      );

    case "StatusTransition":
      return (
        <div className="rounded-md border border-border bg-background p-3">
          <DiffRow
            label="Overall Status"
            prev={baseline?.overallStatus ?? null}
            curr={null}
            positive="up"
          />
          <p className="text-xs text-muted-foreground mt-2 italic">
            Exact transition captured in the alert headline above.
          </p>
        </div>
      );

    case "TerminationDetector":
      return (
        <div className="rounded-md border border-red-200 bg-red-50 p-3">
          <div className="flex items-center gap-2 text-red-700">
            <ShieldAlert className="h-4 w-4" />
            <span className="text-sm font-semibold">Trial halted by sponsor/FDA</span>
          </div>
          <p className="text-xs text-red-600 mt-1">
            This trial's overall status has moved into a terminal state. This is the strongest competitive signal — discuss with your PI immediately.
          </p>
        </div>
      );

    case "ResultsIntelligence":
      return (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-3">
          <div className="flex items-center gap-2 text-blue-700">
            <FlaskConical className="h-4 w-4" />
            <span className="text-sm font-semibold">Primary outcome data now public</span>
          </div>
          <p className="text-xs text-blue-600 mt-1">
            Results have been submitted to ClinicalTrials.gov. Efficacy and safety data are now accessible for competitive benchmarking.
          </p>
        </div>
      );

    case "ToxicityCamouflage":
      return (
        <div className="rounded-md border border-orange-200 bg-orange-50 p-3">
          <div className="flex items-center gap-2 text-orange-700">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm font-semibold">Serious adverse events detected in registry</span>
          </div>
          <p className="text-xs text-orange-600 mt-1">
            The trial's results section contains reported serious adverse events. Review the AE profile for safety differentiation opportunities.
          </p>
        </div>
      );

    default:
      return null;
  }
}

// ── Module label lookup ────────────────────────────────────────────────────────

const MODULE_LABELS: Record<string, string> = {
  TerminationDetector: "Termination Detector",
  ResultsIntelligence: "Results Intelligence",
  ToxicityCamouflage: "Toxicity Camouflage",
  EnrollmentBleed: "Enrollment Bleed",
  TimelineShift: "Timeline Shift",
  StatusTransition: "Status Transition",
};

// ── Panels ─────────────────────────────────────────────────────────────────────

function PanelA({ trial, alerts }: { trial: TrialMeta; alerts: TriggeredAlert[] }) {
  const worst = alerts[0];
  const statusClass = STATUS_COLOR[trial.overallStatus] ?? "text-gray-600 bg-gray-50 border-gray-300";
  const worstCfg = worst ? SEVERITY_CONFIG[worst.severity] : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1 flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm font-bold text-muted-foreground">{trial.nctId}</span>
              <Badge className={`text-[10px] px-2 py-0.5 border ${statusClass}`}>
                {trial.overallStatus.replace(/_/g, " ")}
              </Badge>
              {trial.phase && trial.phase !== "N/A" && (
                <Badge variant="outline" className="text-[10px] px-2 py-0.5">
                  {trial.phase.replace(/PHASE/g, "Phase ")}
                </Badge>
              )}
              {trial.hasResults && (
                <Badge className="text-[10px] px-2 py-0.5 bg-emerald-500/10 text-emerald-700 border-emerald-400/30">
                  Results Posted
                </Badge>
              )}
            </div>
            <CardTitle className="text-xl leading-snug">{trial.title}</CardTitle>
            <p className="text-sm text-muted-foreground">{trial.leadSponsor}</p>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <a
              href={`https://clinicaltrials.gov/study/${trial.nctId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-teal-600 hover:text-teal-700 px-2.5 py-1.5 rounded-md border border-teal-200 bg-teal-50 hover:bg-teal-100 transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
              ClinicalTrials.gov
            </a>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Verdict row */}
        {worstCfg && worst && (
          <div className={`rounded-lg border-2 ${worstCfg.borderClass} ${worstCfg.bgClass} p-4 space-y-2`}>
            <div className="flex items-center gap-2">
              <worstCfg.Icon className={`h-5 w-5 ${worstCfg.textClass}`} />
              <span className={`text-sm font-bold uppercase tracking-wide ${worstCfg.textClass}`}>
                {worstCfg.label} ALERT
              </span>
              <Badge className={worstCfg.badgeClass + " ml-auto text-[10px]"}>
                {alerts.length} signal{alerts.length !== 1 ? "s" : ""} detected
              </Badge>
            </div>
            <p className="text-base font-semibold text-foreground leading-snug">{worst.headline}</p>
          </div>
        )}

        {/* Quick stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-md bg-muted/40 border border-border p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <Users className="h-3.5 w-3.5" />
              Enrollment
            </div>
            <div className="text-lg font-bold">
              {trial.enrollmentCount != null ? trial.enrollmentCount.toLocaleString() : "—"}
            </div>
            {trial.enrollmentType && (
              <div className="text-[10px] text-muted-foreground">{trial.enrollmentType}</div>
            )}
          </div>
          <div className="rounded-md bg-muted/40 border border-border p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <Clock className="h-3.5 w-3.5" />
              Primary Completion
            </div>
            <div className="text-sm font-bold">{trial.primaryCompletionDate ?? "—"}</div>
          </div>
          <div className="rounded-md bg-muted/40 border border-border p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <Activity className="h-3.5 w-3.5" />
              Signal Count
            </div>
            <div className="text-lg font-bold">{alerts.length}</div>
            <div className="text-[10px] text-muted-foreground">
              {alerts.filter(a => a.severity === "critical").length} critical
            </div>
          </div>
          <div className="rounded-md bg-muted/40 border border-border p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <FlaskConical className="h-3.5 w-3.5" />
              Conditions
            </div>
            <div className="text-xs font-medium leading-snug line-clamp-2">
              {trial.conditions.length > 0 ? trial.conditions.slice(0, 2).join(", ") : "—"}
            </div>
          </div>
        </div>

        {/* Brief summary */}
        {trial.briefSummary && (
          <div className="rounded-md bg-muted/30 border border-border p-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Sponsor Description
            </p>
            <p className="text-sm text-foreground leading-relaxed line-clamp-4">
              {trial.briefSummary}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PanelB({ alerts, baseline }: { alerts: TriggeredAlert[]; baseline: BaselineSnapshot | null }) {
  if (alerts.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-red-500" />
          <CardTitle className="text-base">Exploit Evidence — {alerts.length} Signal{alerts.length !== 1 ? "s" : ""} Detected</CardTitle>
        </div>
        <p className="text-sm text-muted-foreground mt-0.5">
          Each signal represents a discrete anomaly detected by the Signal Engine during live ClinicalTrials.gov monitoring.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {alerts.map((alert, idx) => {
          const cfg = SEVERITY_CONFIG[alert.severity];
          const moduleLabel = MODULE_LABELS[alert.module] ?? alert.module;
          return (
            <div key={idx} className={`rounded-lg border-2 ${cfg.borderClass} overflow-hidden`}>
              {/* Alert header */}
              <div className={`px-4 py-3 ${cfg.bgClass} flex items-start gap-3`}>
                <cfg.Icon className={`h-4 w-4 mt-0.5 shrink-0 ${cfg.textClass}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <Badge className={`text-[10px] px-1.5 py-0 ${cfg.badgeClass}`}>
                      {cfg.label}
                    </Badge>
                    <span className="text-xs font-mono font-semibold text-muted-foreground">
                      {moduleLabel}
                    </span>
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {new Date(alert.detectedAt).toLocaleString("en-US", {
                        month: "short", day: "numeric", year: "numeric",
                        hour: "numeric", minute: "2-digit", hour12: true,
                      })}
                    </span>
                  </div>
                  <p className="text-sm font-bold text-foreground leading-snug">
                    Mechanical Exploit: {moduleLabel}
                  </p>
                  <p className="text-sm text-foreground mt-1">{alert.headline}</p>
                </div>
              </div>

              {/* Description */}
              <div className="px-4 py-3 border-t border-border bg-background">
                <p className="text-sm text-muted-foreground leading-relaxed">{alert.detail}</p>
              </div>

              {/* Module-specific diff */}
              <div className="px-4 pb-3">
                <ModuleDiffViewer alert={alert} baseline={baseline} />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function PanelC({ trial }: { trial: TrialMeta }) {
  const hasPrimary = trial.primaryOutcomes.length > 0;
  const hasSecondary = trial.secondaryOutcomes.length > 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-teal-600" />
          <CardTitle className="text-base">
            Trial Protocol Intelligence — {hasPrimary ? trial.primaryOutcomes.length : 0} Primary Endpoint{trial.primaryOutcomes.length !== 1 ? "s" : ""} on Record
          </CardTitle>
        </div>
        <p className="text-sm text-muted-foreground mt-0.5">
          Live registry data from ClinicalTrials.gov. Endpoint structure reveals the sponsor's clinical thesis.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Primary outcomes */}
        {hasPrimary ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Primary Endpoints
            </p>
            <div className="space-y-3">
              {trial.primaryOutcomes.map((outcome, idx) => (
                <div key={idx} className="rounded-md border border-border bg-muted/20 p-3 space-y-1">
                  <div className="flex items-start gap-2">
                    <span className="text-xs font-mono text-muted-foreground mt-0.5 shrink-0">{idx + 1}.</span>
                    <div>
                      <p className="text-sm font-semibold text-foreground leading-snug">{outcome.measure}</p>
                      {outcome.timeFrame && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          <Clock className="h-3 w-3 inline mr-1" />
                          Time frame: {outcome.timeFrame}
                        </p>
                      )}
                      {outcome.description && (
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed italic">
                          {outcome.description}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">No primary endpoints recorded in the registry.</p>
        )}

        {/* Secondary outcomes */}
        {hasSecondary && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Secondary Endpoints (top {trial.secondaryOutcomes.length})
            </p>
            <div className="space-y-2">
              {trial.secondaryOutcomes.map((outcome, idx) => (
                <div key={idx} className="flex items-start gap-2 text-sm py-1.5 border-b border-border/60 last:border-0">
                  <span className="text-xs font-mono text-muted-foreground mt-0.5 shrink-0">{idx + 1}.</span>
                  <div>
                    <span className="text-foreground">{outcome.measure}</span>
                    {outcome.timeFrame && (
                      <span className="text-muted-foreground text-xs ml-2">({outcome.timeFrame})</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* External links */}
        <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
          <a
            href={`https://clinicaltrials.gov/study/${trial.nctId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 px-3 py-1.5 rounded-md border border-blue-200 bg-blue-50 hover:bg-blue-100 transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            Full Registry Entry
          </a>
          <a
            href={`https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(trial.nctId)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-emerald-600 hover:text-emerald-700 px-3 py-1.5 rounded-md border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            PubMed Search
          </a>
          <a
            href={`https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(trial.title)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-emerald-600 hover:text-emerald-700 px-3 py-1.5 rounded-md border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            PubMed — By Title
          </a>
        </div>

        {/* Snapshot freshness */}
        {trial.fetchedAt && (
          <p className="text-[10px] text-muted-foreground">
            Snapshot captured: {new Date(trial.fetchedAt).toLocaleString("en-US", {
              month: "short", day: "numeric", year: "numeric",
              hour: "numeric", minute: "2-digit", hour12: true,
            })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function TargetDossier() {
  const { nctId } = useParams<{ nctId: string }>();

  const { data, isLoading, isError, error } = useQuery<DossierResponse>({
    queryKey: ["dossier", nctId],
    queryFn: () => apiFetch<DossierResponse>(`/strike/feed/${nctId}`),
    enabled: !!nctId,
    retry: 1,
  });

  return (
    <LayoutShell>
      <div className="space-y-5 max-w-4xl">
        {/* Back nav */}
        <div className="flex items-center gap-3">
          <Link href="/strike-center">
            <Button variant="ghost" size="sm" className="gap-1.5 -ml-2">
              <ArrowLeft className="h-4 w-4" />
              Back to Radar
            </Button>
          </Link>
          {data && (
            <span className="text-xs text-muted-foreground font-mono">
              {data.nctId} · {data.alerts.length} signal{data.alerts.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="space-y-5">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
            <AlertOctagon className="h-8 w-8 text-red-500 mx-auto mb-2" />
            <p className="font-semibold text-red-700">Failed to load dossier</p>
            <p className="text-sm text-red-600 mt-1">
              {error instanceof Error ? error.message : "Unknown error"}
            </p>
            <p className="text-xs text-red-500 mt-2">
              Make sure this NCT ID has been scanned by the Signal Engine at least once.
            </p>
          </div>
        )}

        {/* Content */}
        {data && (
          <>
            {/* Panel A: Executive Brief */}
            <PanelA trial={data.trial as unknown as TrialMeta} alerts={data.alerts} />

            {/* Panel B: Smoking Gun */}
            <PanelB alerts={data.alerts} baseline={(data.trial as unknown as TrialMeta).baseline} />

            {/* No alerts state */}
            {data.alerts.length === 0 && (
              <Card>
                <CardContent className="py-10 text-center">
                  <Activity className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground font-medium">No signals detected for this trial</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    The Signal Engine found no anomalies during the last scan cycle.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Panel C: Protocol Intelligence */}
            <PanelC trial={data.trial as unknown as TrialMeta} />
          </>
        )}
      </div>
    </LayoutShell>
  );
}
