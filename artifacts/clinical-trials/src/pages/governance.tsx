import { useState, useEffect, useCallback } from "react";
import { LayoutShell } from "@/components/layout-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, RefreshCw, ShieldCheck, ChevronDown, ChevronRight, Info, AlertTriangle } from "lucide-react";
import { getApiUrl } from "@/lib/api";

const BASE = getApiUrl();

type AuditActor = "SWARM_INGESTION" | "ORCHESTRATOR" | "ZETA_CORE" | "SYSTEM" | "SUSAN";

interface AuditLogEntry {
  id: string;
  timestamp: string;
  nctId: string;
  actor: AuditActor;
  action: string;
  details: string;
}

const ACTOR_META: Record<AuditActor, { icon: string; label: string; color: string; dot: string }> = {
  SWARM_INGESTION: {
    icon: "📡",
    label: "SWARM",
    color: "text-blue-700 border-blue-300 bg-blue-50",
    dot: "bg-blue-500",
  },
  ORCHESTRATOR: {
    icon: "🧠",
    label: "ORCHESTRATOR",
    color: "text-violet-700 border-violet-300 bg-violet-50",
    dot: "bg-violet-500",
  },
  ZETA_CORE: {
    icon: "🧬",
    label: "ZETA_CORE",
    color: "text-emerald-700 border-emerald-300 bg-emerald-50",
    dot: "bg-emerald-500",
  },
  SYSTEM: {
    icon: "⚡",
    label: "SYSTEM",
    color: "text-amber-700 border-amber-300 bg-amber-50",
    dot: "bg-amber-500",
  },
  SUSAN: {
    icon: "👤",
    label: "HUMAN",
    color: "text-teal-700 border-teal-300 bg-teal-50",
    dot: "bg-teal-500",
  },
};

interface GlossaryEntry {
  title: string;
  what: string;
  why: string;
  isLegacy?: boolean;
}

const ACTION_GLOSSARY: Record<string, GlossaryEntry> = {
  POLL_START: {
    title: "Initiating ClinicalTrials.gov Scan",
    what: "The Signal Engine began a scheduled sweep of the ClinicalTrials.gov v2 API for every trial it is currently monitoring. This is the first step in each analysis cycle.",
    why: "Regular polling ensures the system detects competitor changes — terminations, enrollment shifts, result postings — hours before they surface in published news or regulatory feeds.",
  },
  POLL_COMPLETE: {
    title: "ClinicalTrials.gov Scan Finished",
    what: "The swarm successfully retrieved fresh trial data from ClinicalTrials.gov and dispatched it to the Signal Engine's analysis pipeline.",
    why: "This confirms the raw data pipeline is healthy. Without a successful poll, no anomaly detection runs and no intelligence briefs can be generated.",
  },
  POLL_ERROR: {
    title: "ClinicalTrials.gov Fetch Error",
    what: "The system attempted to retrieve trial data but received an error from the ClinicalTrials.gov API. The exact error is recorded in the details field.",
    why: "Logged for full traceability. The system retries on the next scheduled cycle. Repeated errors may signal API rate-limiting, network instability, or an invalid NCT ID.",
  },
  FETCH_MISS: {
    title: "No Data Returned for Trial",
    what: "ClinicalTrials.gov returned an empty response for this NCT ID during the scan — no study record was found.",
    why: "The trial may have been delisted, the NCT ID may be incorrect, or the API returned an edge-case empty response. Logged so the CRC can investigate directly.",
  },
  FIRST_FETCH: {
    title: "New Trial Baseline Established",
    what: "This trial was monitored for the first time. The system stored the current ClinicalTrials.gov record as the permanent baseline snapshot. It also ran the full Signal Engine immediately — using a deliberately empty 'synthetic sentinel' as the comparison point — so that any signals already present in the trial at the moment tracking began are surfaced immediately rather than waiting for a second poll.",
    why: "The baseline is the foundation of all future delta analysis. Without it, the system cannot detect what changed. Running an immediate first-pass analysis ensures the CRC receives actionable intelligence from day one.",
  },
  DELTA_CHECK: {
    title: "Comparing New Snapshot Against Stored Baseline",
    what: "The system fetched a fresh record from ClinicalTrials.gov and compared it field-by-field against the snapshot stored from the previous scan. Any detected differences were extracted and passed to the Signal Engine's 6 detection modules for analysis.",
    why: "Delta checking is the engine of anomaly detection. Instead of re-analyzing the entire trial each cycle, the system isolates exactly what changed — making signals more precise, faster to surface, and less prone to false positives.",
  },
  SIGNAL_ENGINE_START: {
    title: "Signal Engine Analysis Started",
    what: "The Signal Engine launched its sequential 6-module analysis pipeline on this trial. Each module is a specialized detector that examines a different dimension of competitive risk.",
    why: "The 6-module pipeline covers the full surface area of competitive intelligence: trial termination, results disclosure, toxicity characterization, enrollment dynamics, timeline shifts, and status transitions. Running all 6 in sequence ensures nothing is missed.",
  },
  SIGNAL_ENGINE_CLEAN: {
    title: "Signal Engine: No Anomalies Detected",
    what: "All 6 detection modules completed their analysis. No module found a change significant enough to generate an alert. The trial is behaving as expected relative to its last snapshot.",
    why: "A clean run is itself informative — it confirms the competitor trial is progressing normally with no unexpected terminations, enrollment surges, toxicity signals, or timeline anomalies at this point in time.",
  },
  SIGNAL_ENGINE_COMPLETE: {
    title: "Signal Engine: Alerts Generated",
    what: "One or more of the 6 detection modules flagged an anomaly in this trial. The alerts were written to the competitor intelligence feed and are available in the Competitor Intelligence dashboard.",
    why: "Each alert represents a potential strategic insight for ONCO-247 — a competitor stopping early, enrollment bleeding from your sites, results being posted, or a timeline acceleration. These feed directly into Intelligence Briefs delivered to the PI.",
  },
  MODULE_TERMINATIONDETECTOR: {
    title: "Module 1 of 6 — Termination Detector",
    what: "Scanned the trial's OverallStatus field for signs of termination, suspension, or withdrawal. This module fires on both first-fetch and delta scans — it does not require a change to trigger, only the presence of a termination status.",
    why: "Trial termination is among the highest-value competitive signals available. A competitor stopping early can indicate safety failures, enrollment collapse, futility, or strategic withdrawal — all material information for your PI, sponsor, and IRB.",
  },
  MODULE_RESULTSINTELLIGENCE: {
    title: "Module 2 of 6 — Results Intelligence",
    what: "Checked whether the competitor trial has posted new primary results, secondary outcomes, or publications to ClinicalTrials.gov since the last scan. Analyzes the HasResults field and any linked document references.",
    why: "New results from a competitor can shift the regulatory and commercial landscape overnight. Early detection gives the PI and sponsor time to adjust ONCO-247's messaging, endpoint framing, or interim analysis strategy before the news becomes public.",
  },
  MODULE_TOXICITYCAMOUFLAGE: {
    title: "Module 3 of 6 — Toxicity Camouflage Detector",
    what: "Analyzed the trial's adverse event characterization fields for patterns that may indicate toxicity signals being underreported, inconsistently described, or reclassified between registry updates — a pattern referred to internally as 'camouflage'.",
    why: "Sponsors occasionally minimize or reframe adverse events in public registries. Detecting this pattern creates safety differentiation opportunities for ONCO-247 and ensures the PI has full competitive context when engaging with regulators.",
  },
  MODULE_ENROLLMENTBLEED: {
    title: "Module 4 of 6 — Enrollment Bleed Detector",
    what: "Compared the trial's current enrollment count against the previous snapshot to detect unexpected surges, drops, or changes in recruiting status. A sudden enrollment spike in a competitor trial may indicate clinical sites defecting from ONCO-247.",
    why: "Enrollment bleed is a direct operational threat to ONCO-247. Losing investigator sites to a competitor delays your trial completion, increases per-patient costs, and can undermine the statistical power of interim readouts.",
  },
  MODULE_TIMELINESHIFT: {
    title: "Module 5 of 6 — Timeline Shift Detector",
    what: "Examined changes to the trial's PrimaryCompletionDate, EstimatedPrimaryCompletionDate, and StudyStartDate fields between the current and previous snapshots, detecting both accelerations and delays.",
    why: "A competitor accelerating their timeline threatens ONCO-247's first-mover advantage with the FDA. A delay creates a window of opportunity. Either signal is strategically significant and warrants immediate PI awareness.",
  },
  MODULE_STATUSTRANSITION: {
    title: "Module 6 of 6 — Status Transition Monitor",
    what: "Tracked changes to the trial's OverallStatus, Phase, and StudyType fields between snapshots — detecting transitions such as 'Recruiting' → 'Active, not recruiting' → 'Completed', or unexpected phase changes.",
    why: "Status transitions are regulatory milestones. A competitor completing enrollment, finishing their study, or unexpectedly changing phase has direct implications for FDA review sequencing and the competitive timeline for ONCO-247.",
  },
  KILL_CHAIN_START: {
    title: "Signal Engine Analysis Started (legacy event)",
    what: "Same as SIGNAL_ENGINE_START — this event was recorded under the previous internal action code before the system rename. The analysis that ran was identical.",
    why: "Retained in the audit ledger for historical continuity and complete FDA data provenance.",
    isLegacy: true,
  },
  KILL_CHAIN_CLEAN: {
    title: "Signal Engine: No Anomalies Detected (legacy event)",
    what: "Same as SIGNAL_ENGINE_CLEAN — recorded under the previous internal action code. All 6 modules ran and found no anomalies.",
    why: "Retained in the audit ledger for historical continuity and complete FDA data provenance.",
    isLegacy: true,
  },
  KILL_CHAIN_COMPLETE: {
    title: "Signal Engine: Alerts Generated (legacy event)",
    what: "Same as SIGNAL_ENGINE_COMPLETE — recorded under the previous internal action code. Alerts were generated and written to the intelligence feed.",
    why: "Retained in the audit ledger for historical continuity and complete FDA data provenance.",
    isLegacy: true,
  },
};

const MODULE_PIPELINE = [
  { key: "TERMINATIONDETECTOR", label: "Termination Detector" },
  { key: "RESULTSINTELLIGENCE", label: "Results Intelligence" },
  { key: "TOXICITYCAMOUFLAGE", label: "Toxicity Camouflage" },
  { key: "ENROLLMENTBLEED", label: "Enrollment Bleed" },
  { key: "TIMELINESHIFT", label: "Timeline Shift" },
  { key: "STATUSTRANSITION", label: "Status Transition" },
];

function parseMode(details: string): { mode: string; explanation: string } | null {
  const m = details.match(/Mode:\s*(\S+(?:\s+\([^)]+\))?)/i);
  if (!m) return null;
  const raw = m[1].toLowerCase();
  if (raw.startsWith("delta")) {
    return {
      mode: "delta",
      explanation:
        "Delta mode compares the newly fetched trial data against the snapshot stored from the previous scan. Only changes (deltas) are analyzed — this is the normal recurring scan mode for a trial that has been seen before.",
    };
  }
  if (raw.startsWith("absolute")) {
    return {
      mode: "absolute (first fetch)",
      explanation:
        "Absolute mode runs when a trial is tracked for the very first time. Because there is no prior snapshot to compare against, the engine uses a synthetic empty sentinel as the baseline and treats every current field as a potential signal. This guarantees the CRC gets intelligence immediately.",
    };
  }
  return null;
}

function formatTs(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

function entriesToCsv(entries: AuditLogEntry[]): string {
  const header = ["id", "timestamp", "nctId", "actor", "action", "details"];
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = entries.map((e) =>
    [e.id, e.timestamp, e.nctId, e.actor, e.action, e.details].map(escape).join(","),
  );
  return [header.join(","), ...rows].join("\r\n");
}

function downloadCsv(entries: AuditLogEntry[]) {
  const csv = entriesToCsv(entries);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audit-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const ALL_ACTORS: AuditActor[] = ["SWARM_INGESTION", "ORCHESTRATOR", "ZETA_CORE", "SYSTEM", "SUSAN"];

function ExpandedPanel({ entry }: { entry: AuditLogEntry }) {
  const glossary = ACTION_GLOSSARY[entry.action];
  const isModule = entry.action.startsWith("MODULE_");
  const moduleKey = isModule ? entry.action.replace("MODULE_", "") : null;
  const modeInfo = entry.action === "SIGNAL_ENGINE_START" || entry.action === "KILL_CHAIN_START"
    ? parseMode(entry.details)
    : null;

  return (
    <div className="mt-3 rounded-lg border border-border overflow-hidden text-sm">
      {/* Glossary section */}
      {glossary ? (
        <div className="bg-muted/30 p-4 space-y-4">
          {glossary.isLegacy && (
            <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>Legacy event — recorded under the old action name before the system rename. Data is identical.</span>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">What happened</p>
            <p className="font-semibold text-foreground leading-snug">{glossary.title}</p>
            <p className="text-muted-foreground mt-1.5 leading-relaxed">{glossary.what}</p>
          </div>

          {modeInfo && (
            <div className="rounded-md bg-violet-50 border border-violet-200 p-3">
              <p className="text-xs font-semibold text-violet-700 uppercase tracking-wider mb-1">
                Analysis mode: <span className="font-mono">{modeInfo.mode}</span>
              </p>
              <p className="text-xs text-violet-800 leading-relaxed">{modeInfo.explanation}</p>
            </div>
          )}

          {glossary.why && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
                <Info className="h-3 w-3" /> Why it matters
              </p>
              <p className="text-muted-foreground leading-relaxed">{glossary.why}</p>
            </div>
          )}

          {/* Module pipeline visualizer */}
          {isModule && moduleKey && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                6-Module Signal Engine Pipeline
              </p>
              <div className="flex flex-wrap gap-1.5">
                {MODULE_PIPELINE.map((m, i) => {
                  const isActive = m.key === moduleKey;
                  return (
                    <span
                      key={m.key}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono border ${
                        isActive
                          ? "bg-violet-600 text-white border-violet-600 font-semibold"
                          : "bg-background text-muted-foreground border-border"
                      }`}
                    >
                      <span className="opacity-60">{i + 1}.</span> {m.label}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-muted/30 p-4">
          <p className="text-xs text-muted-foreground italic">No detailed explanation available for action code <span className="font-mono">{entry.action}</span>.</p>
        </div>
      )}

      {/* Raw log divider */}
      <div className="border-t border-border bg-muted/10 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Raw audit record</p>
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-xs">
          <span className="text-muted-foreground">id</span>
          <span className="text-foreground break-all">{entry.id}</span>

          <span className="text-muted-foreground">timestamp</span>
          <span className="text-foreground">{entry.timestamp}</span>

          <span className="text-muted-foreground">actor</span>
          <span className="text-foreground font-semibold">{entry.actor}</span>

          <span className="text-muted-foreground">action</span>
          <span className="text-foreground">{entry.action}</span>

          {entry.nctId && (
            <>
              <span className="text-muted-foreground">nctId</span>
              <span className="text-foreground">{entry.nctId}</span>
            </>
          )}

          <span className="text-muted-foreground">details</span>
          <span className="text-foreground whitespace-pre-wrap break-words">{entry.details}</span>
        </div>
      </div>
    </div>
  );
}

export default function Governance() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AuditActor | "ALL">("ALL");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}audit/logs`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { entries: AuditLogEntry[] };
      setEntries(data.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load audit log");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = filter === "ALL" ? entries : entries.filter((e) => e.actor === filter);

  return (
    <LayoutShell>
      <div className="space-y-6 max-w-4xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-6 w-6 text-teal-600" />
              <h1 className="text-3xl font-bold tracking-tight">Governance & Audit Ledger</h1>
            </div>
            <p className="text-muted-foreground mt-1">
              Transparent record of every autonomous action executed by the Signal Engine. Immutable provenance for FDA audit. Click any event to see a full plain-English explanation.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={load}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => downloadCsv(visible)}
              disabled={visible.length === 0}
              className="bg-teal-700 hover:bg-teal-800 text-white"
            >
              <Download className="h-4 w-4 mr-1" />
              Export Compliance CSV
            </Button>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-5 gap-3">
          {ALL_ACTORS.map((actor) => {
            const meta = ACTOR_META[actor];
            const count = entries.filter((e) => e.actor === actor).length;
            return (
              <button
                key={actor}
                onClick={() => setFilter(filter === actor ? "ALL" : actor)}
                className={`rounded-lg border p-3 text-left transition-all hover:shadow-sm ${
                  filter === actor
                    ? "ring-2 ring-teal-500 bg-teal-50 border-teal-300"
                    : "bg-card border-border hover:border-muted-foreground/30"
                }`}
              >
                <div className="text-lg leading-none mb-1">{meta.icon}</div>
                <div className="text-xs font-semibold text-muted-foreground truncate">{meta.label}</div>
                <div className="text-xl font-bold mt-0.5">{count}</div>
              </button>
            );
          })}
        </div>

        {/* Timeline */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">
                  {filter === "ALL" ? "All Events" : `${ACTOR_META[filter].icon} ${ACTOR_META[filter].label} Events`}
                </CardTitle>
                <CardDescription>
                  {visible.length} event{visible.length !== 1 ? "s" : ""}
                  {filter !== "ALL" && (
                    <button
                      className="ml-2 text-xs text-teal-600 hover:underline"
                      onClick={() => setFilter("ALL")}
                    >
                      Clear filter
                    </button>
                  )}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-4">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="flex gap-4">
                    <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-1/3" />
                      <Skeleton className="h-3 w-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="text-center py-12 text-muted-foreground">
                <p className="text-red-500 font-medium">{error}</p>
                <Button variant="link" onClick={load} className="mt-2">Retry</Button>
              </div>
            ) : visible.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <ShieldCheck className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
                <p className="font-medium">No audit events yet</p>
                <p className="text-sm mt-1">Run a swarm poll from Competitor Intelligence to populate the ledger.</p>
              </div>
            ) : (
              <div className="relative">
                <div className="absolute left-[19px] top-4 bottom-4 w-px bg-border" />

                <ol className="space-y-0">
                  {visible.map((entry, idx) => {
                    const meta = ACTOR_META[entry.actor] ?? ACTOR_META["SYSTEM"];
                    const isLast = idx === visible.length - 1;
                    const isExpanded = expandedId === entry.id;
                    const glossary = ACTION_GLOSSARY[entry.action];
                    return (
                      <li key={entry.id} className={`relative flex gap-4 ${isLast ? "" : "pb-5"}`}>
                        {/* Actor dot */}
                        <div className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-background border-2 border-border text-base select-none">
                          {meta.icon}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0 pt-1">
                          <button
                            onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                            className="w-full text-left group"
                          >
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <Badge variant="outline" className={`text-xs font-mono ${meta.color}`}>
                                {meta.label}
                              </Badge>
                              <span className="text-xs font-semibold text-foreground font-mono">
                                {entry.action}
                              </span>
                              {entry.nctId && (
                                <span className="text-xs text-muted-foreground font-mono">
                                  {entry.nctId}
                                </span>
                              )}
                              <span className="text-xs text-muted-foreground ml-auto shrink-0 flex items-center gap-1">
                                {formatTs(entry.timestamp)}
                                {isExpanded
                                  ? <ChevronDown className="h-3 w-3" />
                                  : <ChevronRight className="h-3 w-3 opacity-40 group-hover:opacity-100" />}
                              </span>
                            </div>
                            {glossary ? (
                              <p className="text-sm font-medium text-foreground leading-snug text-left">
                                {glossary.title}
                              </p>
                            ) : (
                              <p className="text-sm text-muted-foreground leading-snug text-left">
                                {entry.details}
                              </p>
                            )}
                          </button>

                          {isExpanded && <ExpandedPanel entry={entry} />}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}
          </CardContent>
        </Card>

        {visible.length > 0 && (
          <p className="text-xs text-muted-foreground text-center pb-4">
            Showing {visible.length} of {entries.length} total events · Export CSV to hand to an FDA auditor as proof of AI data provenance
          </p>
        )}
      </div>
    </LayoutShell>
  );
}
