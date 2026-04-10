import { useState, useEffect, useCallback } from "react";
import { LayoutShell } from "@/components/layout-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, RefreshCw, ShieldCheck, ChevronDown, ChevronRight } from "lucide-react";
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
              Transparent record of every autonomous action executed by the Signal Engine. Immutable provenance for FDA audit.
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
                {/* Vertical connector line */}
                <div className="absolute left-[19px] top-4 bottom-4 w-px bg-border" />

                <ol className="space-y-0">
                  {visible.map((entry, idx) => {
                    const meta = ACTOR_META[entry.actor] ?? ACTOR_META["SYSTEM"];
                    const isLast = idx === visible.length - 1;
                    const isExpanded = expandedId === entry.id;
                    return (
                      <li key={entry.id} className={`relative flex gap-4 ${isLast ? "" : "pb-5"}`}>
                        {/* Dot */}
                        <div className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-background border-2 border-border text-base select-none">
                          {meta.icon}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0 pt-1">
                          {/* Clickable header row */}
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
                            <p className="text-sm text-muted-foreground leading-snug text-left">
                              {entry.details}
                            </p>
                          </button>

                          {/* Expanded raw log panel */}
                          {isExpanded && (
                            <div className="mt-3 rounded-md border border-border bg-muted/40 p-3 font-mono text-xs space-y-1.5">
                              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                                <span className="text-muted-foreground">id</span>
                                <span className="text-foreground break-all">{entry.id}</span>

                                <span className="text-muted-foreground">timestamp</span>
                                <span className="text-foreground">{entry.timestamp}</span>

                                <span className="text-muted-foreground">actor</span>
                                <span className={`font-semibold ${meta.color.split(" ")[0]}`}>{entry.actor}</span>

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
                          )}
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
