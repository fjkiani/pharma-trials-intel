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
  Crosshair,
  ShieldOff,
  FileWarning,
  BookOpen,
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

// ── Types ─────────────────────────────────────────────────────────────────────

type AlertSeverity = "critical" | "high" | "medium" | "low";

interface TriggeredAlert {
  nctId: string;
  detectedAt: string;
  module?: string;
  severity: AlertSeverity;
  headline: string;
  detail: string;
  evidence?: {
    pfsTimeFrameMonths?: number | null;
    osTimeFrameMonths?: number | null;
    pfsBaselineMonths?: number | null;
    osBaselineMonths?: number | null;
  };
  zetaCore?: {
    evidenceTier?: string;
    cynicalSummary?: string;
    clinicalDirective?: string;
    articles?: Array<{
      pmid?: string;
      title?: string;
      journal?: string;
      year?: string | number;
    }>;
  };
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
  source?: string;
  alerts: TriggeredAlert[];
  trial: TrialMeta;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_DISPLAY: Record<string, { label: string; cls: string }> = {
  TERMINATED: { label: "TERMINATED", cls: "text-red-700 bg-red-100 border-red-400" },
  WITHDRAWN: { label: "WITHDRAWN", cls: "text-red-700 bg-red-100 border-red-400" },
  SUSPENDED: { label: "SUSPENDED", cls: "text-orange-700 bg-orange-100 border-orange-400" },
  COMPLETED: { label: "COMPLETED", cls: "text-emerald-700 bg-emerald-100 border-emerald-400" },
  RECRUITING: { label: "RECRUITING", cls: "text-blue-700 bg-blue-100 border-blue-400" },
  ACTIVE_NOT_RECRUITING: { label: "ACTIVE · NOT RECRUITING", cls: "text-amber-700 bg-amber-100 border-amber-400" },
  NOT_YET_RECRUITING: { label: "NOT YET RECRUITING", cls: "text-gray-600 bg-gray-100 border-gray-400" },
};

function deriveFailureVector(whyStopped: string | null, alerts: TriggeredAlert[]): string {
  const src = (whyStopped ?? alerts[0]?.headline ?? "").toLowerCase();
  if (src.includes("ctep") || src.includes("drug supply") || src.includes("supplied drug")) return "DRUG SUPPLY HALTED";
  if (src.includes("futility") || src.includes("efficacy")) return "FUTILITY — EFFICACY FAILED";
  if (src.includes("safety") || src.includes("adverse") || src.includes("toxicity")) return "SAFETY SIGNAL FORCED STOP";
  if (src.includes("enrollment") || src.includes("recruit")) return "ENROLLMENT COLLAPSE";
  if (src.includes("covid") || src.includes("pandemic")) return "EXTERNAL FORCE MAJEURE";
  if (src.includes("company") || src.includes("sponsor") || src.includes("decision") || src.includes("prematurely")) return "SPONSOR WITHDRAWAL";
  if (src.includes("partner") || src.includes("collaborat")) return "PARTNER BAILOUT";
  if (alerts[0]?.module === "TerminationDetector") return "SPONSOR DECISION";
  if (alerts[0]?.module === "ResultsIntelligence") return "RESULTS POSTED";
  if (alerts[0]?.module === "ToxicityCamouflage") return "ADVERSE EVENT SIGNAL";
  return "SIGNAL DETECTED";
}

function deriveEvidenceTier(alerts: TriggeredAlert[]): { label: string; cls: string } {
  const tier = alerts[0]?.zetaCore?.evidenceTier;
  if (tier) {
    const upper = tier.toUpperCase();
    if (upper === "CONFIRMED" || upper === "STRONG") return { label: upper, cls: "bg-red-600 text-white" };
    if (upper === "PROBABLE" || upper === "MODERATE") return { label: upper, cls: "bg-orange-500 text-white" };
    return { label: upper, cls: "bg-gray-500 text-white" };
  }
  const worst = alerts[0]?.severity;
  if (worst === "critical") return { label: "CONFIRMED", cls: "bg-red-600 text-white" };
  if (worst === "high") return { label: "PROBABLE", cls: "bg-orange-500 text-white" };
  if (worst === "medium") return { label: "INSUFFICIENT", cls: "bg-amber-400 text-white" };
  return { label: "UNSCORED", cls: "bg-gray-400 text-white" };
}

function deriveClinicalDirective(alerts: TriggeredAlert[]): string {
  const directive = alerts[0]?.zetaCore?.clinicalDirective;
  if (directive) return directive;
  const module = alerts[0]?.module;
  if (module === "TerminationDetector") return "Debrief PI immediately. Evaluate whether this termination creates a positioning gap or enrollment opportunity for ONCO-247.";
  if (module === "ResultsIntelligence") return "Pull primary and secondary outcome data from the registry. Benchmark efficacy and AE profiles against ONCO-247's current targets.";
  if (module === "ToxicityCamouflage") return "Extract AE grade distribution. Identify whether the competitor's safety profile creates a differentiation advantage for ONCO-247.";
  if (module === "EnrollmentBleed") return "Track enrollment velocity. If bleed is accelerating, assess risk of ONCO-247 competing for the same site network.";
  return "Review the full signal chain before the next PI sync.";
}

function deriveCynicalSummary(alerts: TriggeredAlert[], whyStopped: string | null): string {
  const s = alerts[0]?.zetaCore?.cynicalSummary;
  if (s) return s;
  const module = alerts[0]?.module;
  if (module === "TerminationDetector" && whyStopped) {
    return `Sponsor pulled the plug mid-study. ${whyStopped} This pattern typically precedes a competitive repositioning or portfolio deprioritization.`;
  }
  if (module === "ResultsIntelligence") {
    return "This competitor has crossed the finish line. Results are now on the public record — the window to shape the narrative is closing fast.";
  }
  if (module === "ToxicityCamouflage") {
    return "Serious adverse events are recorded. The sponsor's safety profile is now public domain — a potential differentiation lever for ONCO-247 if your AE rates diverge.";
  }
  return alerts[0]?.detail ?? "Signal detected during live monitoring. Full enrichment pending ZetaCore analysis.";
}

// Parse months from a timeFrame string like "Up to 84 months", "48 months", "3 years"
function parseMonths(tf: string | undefined | null): number | null {
  if (!tf) return null;
  const mMatch = tf.match(/(\d+(?:\.\d+)?)\s*month/i);
  if (mMatch) return parseFloat(mMatch[1]);
  const yMatch = tf.match(/(\d+(?:\.\d+)?)\s*year/i);
  if (yMatch) return Math.round(parseFloat(yMatch[1]) * 12);
  const wMatch = tf.match(/(\d+(?:\.\d+)?)\s*week/i);
  if (wMatch) return Math.round(parseFloat(wMatch[1]) / 4.3);
  return null;
}

// ── Section 1: Kill-Shot Header ────────────────────────────────────────────────

function KillShotHeader({ trial, alerts }: { trial: TrialMeta; alerts: TriggeredAlert[] }) {
  const statusCfg = STATUS_DISPLAY[trial.overallStatus] ?? { label: trial.overallStatus.replace(/_/g, " "), cls: "text-gray-600 bg-gray-100 border-gray-400" };
  const phase = trial.phase && trial.phase !== "N/A" ? trial.phase.replace(/PHASE/gi, "Phase ") : null;
  const failureVector = deriveFailureVector(trial.whyStopped, alerts);
  const evidenceTier = deriveEvidenceTier(alerts);
  const isTerminal = ["TERMINATED", "WITHDRAWN", "SUSPENDED"].includes(trial.overallStatus);

  return (
    <div className="space-y-4">
      {/* Title row */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1 flex-1 min-w-0">
          <p className="text-xs font-mono text-muted-foreground font-semibold tracking-widest">{trial.leadSponsor.toUpperCase()}</p>
          <h1 className="text-xl font-bold leading-snug text-foreground">{trial.title}</h1>
        </div>
        <a
          href={`https://clinicaltrials.gov/study/${trial.nctId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 inline-flex items-center gap-1.5 text-xs text-teal-600 hover:text-teal-700 px-2.5 py-1.5 rounded-md border border-teal-200 bg-teal-50 hover:bg-teal-100 transition-colors"
        >
          <ExternalLink className="h-3 w-3" />
          ClinicalTrials.gov
        </a>
      </div>

      {/* 3-column metrics bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-0 rounded-xl border border-border overflow-hidden divide-y sm:divide-y-0 sm:divide-x divide-border">
        {/* Col 1: Competitor Status */}
        <div className="bg-muted/30 px-5 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Competitor Status</p>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm font-bold px-2.5 py-1 rounded-md border font-mono tracking-wide ${statusCfg.cls}`}>
              {statusCfg.label}
            </span>
            {phase && (
              <span className="text-sm font-semibold text-muted-foreground">{phase}</span>
            )}
          </div>
          {trial.hasResults && (
            <p className="text-[10px] text-emerald-600 font-semibold mt-1.5 uppercase tracking-wide">● Results on record</p>
          )}
        </div>

        {/* Col 2: Failure Vector */}
        <div className={`px-5 py-4 ${isTerminal ? "bg-red-50" : "bg-muted/30"}`}>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Failure Vector</p>
          <div className="flex items-center gap-2">
            {isTerminal && <ShieldOff className="h-4 w-4 text-red-600 shrink-0" />}
            <span className={`text-sm font-bold font-mono tracking-wide ${isTerminal ? "text-red-700" : "text-foreground"}`}>
              {failureVector}
            </span>
          </div>
          {trial.whyStopped && (
            <p className="text-[10px] text-muted-foreground mt-1.5 line-clamp-2 leading-relaxed">
              {trial.whyStopped.slice(0, 80)}{trial.whyStopped.length > 80 ? "…" : ""}
            </p>
          )}
        </div>

        {/* Col 3: Zeta-Core Verdict */}
        <div className="bg-muted/30 px-5 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Zeta-Core Verdict</p>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold px-3 py-1 rounded-full tracking-widest font-mono ${evidenceTier.cls}`}>
              {evidenceTier.label}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1.5">
            {alerts.length} signal{alerts.length !== 1 ? "s" : ""} · {new Date(alerts[0]?.detectedAt ?? Date.now()).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Section 2: The Smoking Gun ────────────────────────────────────────────────

function SmokingGun({ trial, alerts }: { trial: TrialMeta; alerts: TriggeredAlert[] }) {
  const cynicalSummary = deriveCynicalSummary(alerts, trial.whyStopped);
  const clinicalDirective = deriveClinicalDirective(alerts);
  const worst = alerts[0];
  const isTerminal = ["TERMINATED", "WITHDRAWN", "SUSPENDED"].includes(trial.overallStatus);

  const smokingGunQuote = isTerminal && trial.whyStopped
    ? trial.whyStopped
    : worst?.headline ?? null;

  return (
    <Card className={`border-2 ${isTerminal ? "border-red-400" : "border-orange-400"}`}>
      <CardHeader className={`pb-3 ${isTerminal ? "bg-red-50" : "bg-orange-50"} rounded-t-lg`}>
        <div className="flex items-center gap-2">
          <FileWarning className={`h-4 w-4 ${isTerminal ? "text-red-600" : "text-orange-600"}`} />
          <CardTitle className={`text-base ${isTerminal ? "text-red-800" : "text-orange-800"}`}>
            The Smoking Gun
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {/* Exact termination quote */}
        {smokingGunQuote && (
          <div className={`rounded-md border-l-4 ${isTerminal ? "border-red-500 bg-red-50/60" : "border-orange-500 bg-orange-50/60"} pl-4 pr-3 py-3`}>
            <p className={`text-[10px] font-semibold uppercase tracking-widest mb-1.5 ${isTerminal ? "text-red-500" : "text-orange-500"}`}>
              {isTerminal ? "Termination Statement" : "Primary Signal"}
            </p>
            <blockquote className={`font-mono text-sm leading-relaxed italic ${isTerminal ? "text-red-900" : "text-orange-900"}`}>
              "{smokingGunQuote}"
            </blockquote>
          </div>
        )}

        {/* Cynical Summary */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">
            ZetaCore Analysis
          </p>
          <p className="text-sm text-foreground leading-relaxed">{cynicalSummary}</p>
        </div>

        {/* Clinical Directive */}
        <div className="rounded-md bg-slate-900 border border-slate-700 px-4 py-3 flex items-start gap-3">
          <Crosshair className="h-4 w-4 text-teal-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-teal-400 mb-1">
              Clinical Directive
            </p>
            <p className="text-sm text-slate-100 leading-relaxed">{clinicalDirective}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Section 3: Endpoint Benchmark Table ──────────────────────────────────────

interface EndpointBar {
  label: string;
  measure: string;
  competitorMonths: number | null;
  baselineMonths: number | null;
  timeFrameRaw: string;
}

function EndpointBar({ bar, maxMonths }: { bar: EndpointBar; maxMonths: number }) {
  const competitorPct = bar.competitorMonths != null ? Math.min((bar.competitorMonths / maxMonths) * 100, 100) : null;
  const baselinePct = bar.baselineMonths != null ? Math.min((bar.baselineMonths / maxMonths) * 100, 100) : null;
  const delta = bar.competitorMonths != null && bar.baselineMonths != null
    ? bar.competitorMonths - bar.baselineMonths
    : null;

  return (
    <div className="space-y-1.5 py-3 border-b border-border last:border-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{bar.label}</p>
          <p className="text-sm font-medium text-foreground leading-snug mt-0.5 line-clamp-2">{bar.measure}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{bar.timeFrameRaw}</p>
        </div>
        {delta !== null && (
          <div className={`shrink-0 text-right`}>
            <span className={`text-sm font-bold font-mono ${delta > 0 ? "text-red-600" : delta < 0 ? "text-emerald-600" : "text-muted-foreground"}`}>
              {delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : "±0"} mo
            </span>
            {delta !== 0 && (
              <p className={`text-[10px] font-semibold ${delta > 0 ? "text-red-500" : "text-emerald-500"}`}>
                {delta > 0 ? "DELAY" : "AHEAD"}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Bars */}
      {(competitorPct !== null || baselinePct !== null) && (
        <div className="space-y-1 mt-2">
          {baselinePct !== null && (
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-muted-foreground w-16 shrink-0 text-right font-mono">BASELINE</span>
              <div className="flex-1 h-3 bg-muted rounded-sm overflow-hidden">
                <div
                  className="h-full bg-slate-400 rounded-sm transition-all"
                  style={{ width: `${baselinePct}%` }}
                />
              </div>
              <span className="text-[9px] font-mono text-muted-foreground w-12 shrink-0">{bar.baselineMonths} mo</span>
            </div>
          )}
          {competitorPct !== null && (
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-muted-foreground w-16 shrink-0 text-right font-mono">COMPETITOR</span>
              <div className="flex-1 h-3 bg-muted rounded-sm overflow-hidden">
                <div
                  className={`h-full rounded-sm transition-all ${delta !== null && delta > 0 ? "bg-red-400" : delta !== null && delta < 0 ? "bg-emerald-500" : "bg-blue-400"}`}
                  style={{ width: `${competitorPct}%` }}
                />
              </div>
              <span className="text-[9px] font-mono text-muted-foreground w-12 shrink-0">{bar.competitorMonths} mo</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EndpointBenchmarkTable({ trial, alerts }: { trial: TrialMeta; alerts: TriggeredAlert[] }) {
  const hasPrimary = trial.primaryOutcomes.length > 0;
  const hasSecondary = trial.secondaryOutcomes.length > 0;

  if (!hasPrimary && !hasSecondary) return null;

  // Build endpoint bar data
  const bars: EndpointBar[] = [];

  // Check alert evidence first for explicit PFS/OS months
  const evidence = alerts[0]?.evidence;
  if (evidence?.pfsTimeFrameMonths != null || evidence?.osTimeFrameMonths != null) {
    if (evidence.pfsTimeFrameMonths != null) {
      bars.push({
        label: "PFS",
        measure: "Progression-Free Survival",
        competitorMonths: evidence.pfsTimeFrameMonths,
        baselineMonths: evidence.pfsBaselineMonths ?? null,
        timeFrameRaw: `${evidence.pfsTimeFrameMonths} months`,
      });
    }
    if (evidence.osTimeFrameMonths != null) {
      bars.push({
        label: "OS",
        measure: "Overall Survival",
        competitorMonths: evidence.osTimeFrameMonths,
        baselineMonths: evidence.osBaselineMonths ?? null,
        timeFrameRaw: `${evidence.osTimeFrameMonths} months`,
      });
    }
  } else {
    // Parse from primary/secondary outcomes
    [...trial.primaryOutcomes, ...trial.secondaryOutcomes.slice(0, 3)].forEach((outcome, idx) => {
      const competitorMonths = parseMonths(outcome.timeFrame);
      bars.push({
        label: `EP ${idx + 1}`,
        measure: outcome.measure,
        competitorMonths,
        baselineMonths: null,
        timeFrameRaw: outcome.timeFrame || "—",
      });
    });
  }

  if (bars.length === 0) return null;

  const allMonths = bars.flatMap(b => [b.competitorMonths, b.baselineMonths]).filter((m): m is number => m != null);
  const maxMonths = allMonths.length > 0 ? Math.max(...allMonths) * 1.15 : 100;

  const parseable = bars.filter(b => b.competitorMonths !== null);
  const unparseable = bars.filter(b => b.competitorMonths === null);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-orange-500" />
          <CardTitle className="text-base">Endpoint Benchmark</CardTitle>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          Competitor timeframes vs. baseline. Red bars = longer delay than baseline.
        </p>
      </CardHeader>
      <CardContent className="space-y-0 pt-2">
        {/* Visual bars for parseable endpoints */}
        {parseable.length > 0 && (
          <div className="divide-y divide-border">
            {parseable.map((bar, idx) => (
              <EndpointBar key={idx} bar={bar} maxMonths={maxMonths} />
            ))}
          </div>
        )}

        {/* Text-only table for non-parseable timeframes */}
        {unparseable.length > 0 && (
          <div className={`${parseable.length > 0 ? "mt-4 pt-4 border-t border-border" : ""}`}>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">
              Additional Endpoints
            </p>
            <div className="space-y-2">
              {unparseable.map((bar, idx) => (
                <div key={idx} className="flex items-start gap-3 text-sm py-1 border-b border-border/50 last:border-0">
                  <span className="text-[10px] font-mono font-semibold text-muted-foreground mt-0.5 w-8 shrink-0 text-right">{bar.label}</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-foreground">{bar.measure}</span>
                    <span className="text-muted-foreground text-xs ml-2 font-mono">({bar.timeFrameRaw})</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Section 4: Literature Base ────────────────────────────────────────────────

function LiteratureBase({ trial, alerts }: { trial: TrialMeta; alerts: TriggeredAlert[] }) {
  const articles = alerts.flatMap(a => a.zetaCore?.articles ?? []);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-slate-500" />
          <CardTitle className="text-base">Literature Base</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {articles.length > 0 ? (
          <div className="space-y-2">
            {articles.map((article, idx) => (
              <div key={idx} className="flex items-baseline gap-2 text-sm py-1.5 border-b border-border/50 last:border-0">
                {article.pmid ? (
                  <a
                    href={`https://pubmed.ncbi.nlm.nih.gov/${article.pmid}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[10px] font-bold text-blue-600 hover:text-blue-700 shrink-0 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200 hover:bg-blue-100 transition-colors"
                  >
                    [{article.pmid}]
                  </a>
                ) : (
                  <span className="font-mono text-[10px] font-bold text-muted-foreground shrink-0 bg-muted px-1.5 py-0.5 rounded border border-border">
                    [—]
                  </span>
                )}
                <span className="text-foreground leading-snug">
                  {article.title}
                  {(article.journal || article.year) && (
                    <span className="text-muted-foreground">
                      {" "}— {[article.journal, article.year].filter(Boolean).join(" (")}
                      {article.year ? ")" : ""}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2.5">
            <p className="text-xs text-muted-foreground italic">
              ZetaCore article extraction pending. Search PubMed directly:
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                href={`https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(trial.nctId)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 px-3 py-1.5 rounded-md border border-blue-200 bg-blue-50 hover:bg-blue-100 transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                PubMed — {trial.nctId}
              </a>
              <a
                href={`https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(trial.leadSponsor + " " + trial.conditions.slice(0, 1).join(" "))}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 px-3 py-1.5 rounded-md border border-blue-200 bg-blue-50 hover:bg-blue-100 transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                PubMed — {trial.leadSponsor}
              </a>
            </div>
            {trial.fetchedAt && (
              <p className="text-[10px] text-muted-foreground">
                Snapshot: {new Date(trial.fetchedAt).toLocaleString("en-US", {
                  month: "short", day: "numeric", year: "numeric",
                  hour: "numeric", minute: "2-digit", hour12: true,
                })}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Severity icon helper ──────────────────────────────────────────────────────

function SeverityIcon({ severity }: { severity: AlertSeverity }) {
  if (severity === "critical") return <AlertOctagon className="h-4 w-4 text-red-600" />;
  if (severity === "high") return <AlertTriangle className="h-4 w-4 text-orange-500" />;
  return <AlertCircle className="h-4 w-4 text-amber-400" />;
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function TargetDossier() {
  const { nctId } = useParams<{ nctId: string }>();

  const { data, isLoading, isError, error } = useQuery<DossierResponse>({
    queryKey: ["dossier-intelligence", nctId],
    queryFn: () => apiFetch<DossierResponse>(`/strike/intelligence/${nctId}`),
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
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-52 w-full" />
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
          </div>
        )}

        {/* Content */}
        {data && data.trial && (
          <>
            {/* Section 1: Kill-Shot Header */}
            <KillShotHeader trial={data.trial} alerts={data.alerts} />

            {/* Section 2: Smoking Gun */}
            {data.alerts.length > 0 && (
              <SmokingGun trial={data.trial} alerts={data.alerts} />
            )}

            {/* No-signal state */}
            {data.alerts.length === 0 && (
              <div className="rounded-lg border border-border bg-muted/20 p-6 text-center">
                <SeverityIcon severity="low" />
                <p className="text-sm text-muted-foreground font-medium mt-2">No signals detected</p>
                <p className="text-xs text-muted-foreground mt-1">
                  The Signal Engine found no anomalies during the last scan cycle.
                </p>
              </div>
            )}

            {/* Section 3: Endpoint Benchmark */}
            <EndpointBenchmarkTable trial={data.trial} alerts={data.alerts} />

            {/* Section 4: Literature Base */}
            <LiteratureBase trial={data.trial} alerts={data.alerts} />
          </>
        )}
      </div>
    </LayoutShell>
  );
}
