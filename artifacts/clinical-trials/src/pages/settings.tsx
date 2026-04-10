import { useState, useCallback, useEffect } from "react";
import { LayoutShell } from "@/components/layout-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, AlertCircle, XCircle, RefreshCw, ChevronRight, Loader2, Database } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getApiUrl } from "@/lib/api";

const BASE = getApiUrl();

type ResourceType = "notion-database" | "google-sheet" | "google-doc" | "google-calendar";

interface DiscoveredResource {
  name: string;
  type: ResourceType;
  connector: string;
  id: string;
  label: string;
}

interface SponsorCallEvent {
  id: string;
  summary: string;
  start: string;
}

interface DiscoveryResponse {
  resources: DiscoveredResource[];
  sponsorCallEvent: SponsorCallEvent | null;
  errors: string[];
}

type ResourceRole =
  | "notionAeLogDbId"
  | "notionDeviationLogDbId"
  | "notionRegulatoryDbId"
  | "googleSheetsId"
  | "googleDocsTemplateId"
  | "googleCalendarId"
  | "sponsorCallEventId";

interface ValidationResult {
  role: ResourceRole;
  id: string;
  verdict: "pass" | "warn" | "fail";
  reason: string;
}

interface ValidationResponse {
  results: ValidationResult[];
  allPass: boolean;
}

interface AuditEntry {
  timestamp: string;
  resource: string;
  action: "discovered" | "validated" | "confirmed" | "health-check-failed";
  result: string;
}

type WizardStep = "idle" | "discovering" | "mapping" | "validating" | "confirmed";

const ROLE_LABELS: Record<ResourceRole, string> = {
  notionAeLogDbId: "AE Log",
  notionDeviationLogDbId: "Protocol Deviation Log",
  notionRegulatoryDbId: "Regulatory Timeline DB",
  googleSheetsId: "Enrollment Sheet",
  googleDocsTemplateId: "Report Template Doc",
  googleCalendarId: "Calendar",
  sponsorCallEventId: "Sponsor Call Event",
};

const ROLE_DESCRIPTIONS: Record<ResourceRole, string> = {
  notionAeLogDbId: "Notion database tracking adverse events",
  notionDeviationLogDbId: "Notion database tracking protocol deviations",
  notionRegulatoryDbId: "Notion database for regulatory milestones",
  googleSheetsId: "Google Sheet with patient enrollment data",
  googleDocsTemplateId: "Google Doc template for sponsor reports",
  googleCalendarId: "Google Calendar for regulatory deadlines",
  sponsorCallEventId: "Upcoming sponsor call event",
};

const RESOURCE_TYPE_TO_ROLES: Partial<Record<ResourceType, ResourceRole[]>> = {
  "notion-database": ["notionAeLogDbId", "notionDeviationLogDbId", "notionRegulatoryDbId"],
  "google-sheet": ["googleSheetsId"],
  "google-doc": ["googleDocsTemplateId"],
  "google-calendar": ["googleCalendarId"],
};

function VerdictIcon({ verdict }: { verdict: "pass" | "warn" | "fail" }) {
  if (verdict === "pass") return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
  if (verdict === "warn") return <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />;
  return <XCircle className="h-4 w-4 text-red-500 shrink-0" />;
}

function VerdictBadge({ verdict }: { verdict: "pass" | "warn" | "fail" }) {
  if (verdict === "pass") return <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50">Pass</Badge>;
  if (verdict === "warn") return <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50">Warning</Badge>;
  return <Badge variant="outline" className="text-red-700 border-red-300 bg-red-50">Fail</Badge>;
}

function ActionBadge({ action }: { action: AuditEntry["action"] }) {
  const colors: Record<AuditEntry["action"], string> = {
    discovered: "text-blue-700 border-blue-300 bg-blue-50",
    validated: "text-purple-700 border-purple-300 bg-purple-50",
    confirmed: "text-green-700 border-green-300 bg-green-50",
    "health-check-failed": "text-red-700 border-red-300 bg-red-50",
  };
  return <Badge variant="outline" className={colors[action]}>{action}</Badge>;
}

export default function Settings() {
  const { toast } = useToast();

  const [step, setStep] = useState<WizardStep>("idle");
  const [discovery, setDiscovery] = useState<DiscoveryResponse | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<ResourceRole, string>>>({});
  const [validation, setValidation] = useState<ValidationResponse | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [auditLoaded, setAuditLoaded] = useState(false);

  // Notion C2 settings
  const [notionCompetitorDbId, setNotionCompetitorDbId] = useState("");
  const [notionTasksDbId, setNotionTasksDbId] = useState("");
  const [c2Saving, setC2Saving] = useState(false);

  useEffect(() => {
    fetch(`${BASE}settings`)
      .then(r => r.json())
      .then((s: { notionCompetitorDbId?: string; notionTasksDbId?: string }) => {
        if (s.notionCompetitorDbId) setNotionCompetitorDbId(s.notionCompetitorDbId);
        if (s.notionTasksDbId) setNotionTasksDbId(s.notionTasksDbId);
      })
      .catch(() => {});
  }, []);

  const handleSaveC2 = async () => {
    setC2Saving(true);
    try {
      const res = await fetch(`${BASE}settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notionCompetitorDbId, notionTasksDbId }),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      toast({ title: "Notion C2 settings saved", description: "Intelligence sink and task database configured." });
    } catch (e) {
      toast({ title: "Save failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setC2Saving(false);
    }
  };

  const loadAudit = useCallback(async () => {
    setLoadingAudit(true);
    try {
      const res = await fetch(`${BASE}connections/audit`);
      const data = await res.json() as { entries: AuditEntry[] };
      setAudit(data.entries.slice(0, 10));
      setAuditLoaded(true);
    } catch {
      // silent
    } finally {
      setLoadingAudit(false);
    }
  }, []);

  const handleDiscover = async () => {
    setStep("discovering");
    setDiscovery(null);
    setMapping({});
    setValidation(null);
    try {
      const res = await fetch(`${BASE}connections/discover`, { method: "POST" });
      if (!res.ok) throw new Error(`Discovery failed: ${res.status}`);
      const data = await res.json() as DiscoveryResponse;
      setDiscovery(data);

      // Auto-map by heuristic names
      const autoMap: Partial<Record<ResourceRole, string>> = {};
      for (const resource of data.resources) {
        const nameLower = resource.name.toLowerCase();
        const roles = RESOURCE_TYPE_TO_ROLES[resource.type] ?? [];
        for (const role of roles) {
          if (autoMap[role]) continue;
          if (role === "notionAeLogDbId" && (nameLower.includes("ae") || nameLower.includes("adverse") || nameLower.includes("co-pilot") || nameLower.includes("copilot") || nameLower.includes("clinical trials"))) {
            autoMap[role] = resource.id;
          } else if (role === "notionDeviationLogDbId" && (nameLower.includes("deviation") || nameLower.includes("protocol"))) {
            autoMap[role] = resource.id;
          } else if (role === "notionRegulatoryDbId" && (nameLower.includes("regulatory") || nameLower.includes("milestone") || nameLower.includes("timeline"))) {
            autoMap[role] = resource.id;
          } else if (role === "googleSheetsId" && (nameLower.includes("enrollment") || nameLower.includes("enroll") || nameLower.includes("sheet"))) {
            autoMap[role] = resource.id;
          } else if (role === "googleDocsTemplateId" && (nameLower.includes("template") || nameLower.includes("report") || nameLower.includes("agenda"))) {
            autoMap[role] = resource.id;
          } else if (role === "googleCalendarId") {
            autoMap[role] = resource.id;
          }
        }
      }
      if (data.sponsorCallEvent?.id) {
        autoMap["sponsorCallEventId"] = data.sponsorCallEvent.id;
      }
      setMapping(autoMap);
      setStep("mapping");
      await loadAudit();
    } catch (e) {
      toast({
        title: "Discovery failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
      setStep("idle");
    }
  };

  const handleValidate = async () => {
    setStep("validating");
    setValidation(null);
    try {
      const res = await fetch(`${BASE}connections/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mapping),
      });
      if (!res.ok) throw new Error(`Validation failed: ${res.status}`);
      const data = await res.json() as ValidationResponse;
      setValidation(data);
      setStep("mapping");
      await loadAudit();
    } catch (e) {
      toast({
        title: "Validation failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
      setStep("mapping");
    }
  };

  const handleConfirm = async () => {
    try {
      const res = await fetch(`${BASE}connections/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mapping),
      });
      if (!res.ok) throw new Error(`Confirm failed: ${res.status}`);
      setStep("confirmed");
      await loadAudit();
      toast({
        title: "Connection confirmed",
        description: "All integration settings have been saved successfully.",
      });
    } catch (e) {
      toast({
        title: "Failed to save settings",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleReset = () => {
    setStep("idle");
    setDiscovery(null);
    setMapping({});
    setValidation(null);
  };

  const allRoles: ResourceRole[] = [
    "notionAeLogDbId",
    "notionDeviationLogDbId",
    "notionRegulatoryDbId",
    "googleSheetsId",
    "googleDocsTemplateId",
    "googleCalendarId",
    "sponsorCallEventId",
  ];

  const typeLabel: Record<ResourceType, string> = {
    "notion-database": "Notion DB",
    "google-sheet": "Google Sheet",
    "google-doc": "Google Doc",
    "google-calendar": "Calendar",
  };

  const resourcesForRole = (role: ResourceRole): DiscoveredResource[] => {
    if (!discovery) return [];
    const types = Object.entries(RESOURCE_TYPE_TO_ROLES)
      .filter(([, roles]) => roles?.includes(role))
      .map(([t]) => t as ResourceType);
    if (role === "sponsorCallEventId") return [];
    return discovery.resources.filter((r) => types.includes(r.type));
  };

  return (
    <LayoutShell>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Connection Setup</h1>
          <p className="text-muted-foreground mt-2">
            Automatically discover and validate your connected data sources for ONCO-247.
          </p>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-2 text-sm">
          <StepDot active={step === "idle" || step === "discovering"} done={step !== "idle" && step !== "discovering"} label="1. Discover" />
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
          <StepDot active={step === "mapping" || step === "validating"} done={step === "confirmed"} label="2. Validate" />
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
          <StepDot active={step === "confirmed"} done={false} label="3. Confirmed" />
        </div>

        {/* STEP 1: Discovery */}
        {(step === "idle" || step === "discovering" || step === "mapping" || step === "validating") && (
          <Card>
            <CardHeader>
              <CardTitle>Step 1 — Discover Resources</CardTitle>
              <CardDescription>
                Click to scan your connected Notion, Google Drive, and Google Calendar for accessible data sources.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {step === "idle" && (
                <Button onClick={handleDiscover} className="gap-2">
                  <RefreshCw className="h-4 w-4" /> Set up ONCO-247
                </Button>
              )}
              {step === "discovering" && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Scanning connected services…
                </div>
              )}
              {discovery && (step === "mapping" || step === "validating") && (
                <div className="space-y-4">
                  <p className="text-sm font-medium">I found the following resources:</p>
                  <ul className="space-y-1.5 text-sm">
                    {discovery.resources.map((r) => (
                      <li key={r.id} className="flex items-center gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                        <span className="text-muted-foreground text-xs">{typeLabel[r.type]}</span>
                        <span className="font-medium">{r.name}</span>
                      </li>
                    ))}
                    {discovery.sponsorCallEvent && (
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                        <span className="text-muted-foreground text-xs">Sponsor Call</span>
                        <span className="font-medium">{discovery.sponsorCallEvent.summary}</span>
                        <span className="text-muted-foreground text-xs">
                          ({discovery.sponsorCallEvent.start ? new Date(discovery.sponsorCallEvent.start).toLocaleDateString() : "date unknown"})
                        </span>
                      </li>
                    )}
                    {discovery.resources.length === 0 && !discovery.sponsorCallEvent && (
                      <li className="text-muted-foreground">No resources found. Check your integration permissions.</li>
                    )}
                  </ul>
                  {discovery.errors.length > 0 && (
                    <div className="text-xs text-amber-600 space-y-1">
                      {discovery.errors.map((e, i) => (
                        <p key={i}>⚠ {e}</p>
                      ))}
                    </div>
                  )}
                  <p className="text-sm font-medium pt-2">Does this look right? Review the mapping below, then validate.</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* STEP 2: Mapping + Validation */}
        {(step === "mapping" || step === "validating") && discovery && (
          <Card>
            <CardHeader>
              <CardTitle>Step 2 — Validate &amp; Confirm Mapping</CardTitle>
              <CardDescription>
                Adjust which resource maps to each role, then click Validate to verify all connections.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                {allRoles.map((role) => {
                  const options = resourcesForRole(role);
                  const isSponsorCall = role === "sponsorCallEventId";
                  const currentId = mapping[role] ?? "";
                  return (
                    <div key={role} className="grid grid-cols-[180px_1fr] gap-3 items-center">
                      <div>
                        <p className="text-sm font-medium">{ROLE_LABELS[role]}</p>
                        <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>
                      </div>
                      <div>
                        {isSponsorCall ? (
                          <div className="flex items-center gap-2 text-sm">
                            {discovery.sponsorCallEvent ? (
                              <>
                                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                                <span>{discovery.sponsorCallEvent.summary}</span>
                                <span className="text-xs text-muted-foreground">
                                  ({discovery.sponsorCallEvent.start ? new Date(discovery.sponsorCallEvent.start).toLocaleDateString() : ""})
                                </span>
                              </>
                            ) : (
                              <span className="text-muted-foreground text-xs">No upcoming sponsor call found</span>
                            )}
                          </div>
                        ) : (
                          <select
                            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                            value={currentId}
                            onChange={(e) =>
                              setMapping((m) => ({ ...m, [role]: e.target.value || undefined }))
                            }
                            disabled={step === "validating"}
                          >
                            <option value="">— Not assigned —</option>
                            {options.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="pt-2 flex gap-2">
                <Button
                  onClick={handleValidate}
                  disabled={step === "validating"}
                  className="gap-2"
                >
                  {step === "validating" ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Validating…</>
                  ) : (
                    "Validate Connections"
                  )}
                </Button>
                <Button variant="ghost" onClick={handleDiscover} disabled={step === "validating"} className="gap-2">
                  <RefreshCw className="h-3.5 w-3.5" /> Re-scan
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Validation Results */}
        {validation && step === "mapping" && (
          <Card>
            <CardHeader>
              <CardTitle>Validation Results</CardTitle>
              <CardDescription>
                Per-resource check against expected data contracts.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {validation.results.map((r) => (
                <div key={r.role} className="flex items-start gap-3 py-2 border-b last:border-0">
                  <VerdictIcon verdict={r.verdict} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{ROLE_LABELS[r.role]}</span>
                      <VerdictBadge verdict={r.verdict} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{r.reason}</p>
                  </div>
                </div>
              ))}
              {validation.allPass && (
                <div className="pt-3">
                  <Button onClick={handleConfirm} className="gap-2 bg-green-600 hover:bg-green-700">
                    <CheckCircle2 className="h-4 w-4" /> Confirm &amp; Save
                  </Button>
                </div>
              )}
              {!validation.allPass && (() => {
                const hasFail = validation.results.some((r) => r.verdict === "fail");
                const hasWarn = validation.results.some((r) => r.verdict === "warn");
                const allWarn = !hasFail && hasWarn;
                return (
                  <div className="pt-3 flex items-center gap-2 text-sm text-amber-700">
                    {allWarn ? (
                      <AlertCircle className="h-4 w-4 shrink-0" />
                    ) : (
                      <XCircle className="h-4 w-4 shrink-0 text-red-600" />
                    )}
                    <span className={allWarn ? "" : "text-red-600"}>
                      {allWarn
                        ? "Resources validated with warnings. Resolve the warnings above (e.g. share databases with the integration), then validate again to confirm."
                        : "One or more resources failed validation. Adjust the mapping and validate again."}
                    </span>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        )}

        {/* STEP 3: Confirmed */}
        {step === "confirmed" && (
          <Card className="border-green-200 bg-green-50/50">
            <CardHeader>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-6 w-6 text-green-600" />
                <CardTitle className="text-green-800">Step 3 — Connected</CardTitle>
              </div>
              <CardDescription className="text-green-700">
                All integration settings have been saved. ONCO-247 is fully wired and ready.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {validation && (
                <ul className="space-y-1.5 text-sm">
                  {validation.results.map((r) => (
                    <li key={r.role} className="flex items-center gap-2">
                      <VerdictIcon verdict={r.verdict} />
                      <span className="font-medium">{ROLE_LABELS[r.role]}</span>
                      <span className="text-muted-foreground text-xs">— {r.reason}</span>
                    </li>
                  ))}
                </ul>
              )}
              <Button variant="outline" onClick={handleReset} className="mt-4 gap-2">
                <RefreshCw className="h-3.5 w-3.5" /> Re-run Setup
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Notion C2 Write-Back Config */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-violet-600" />
              <CardTitle className="text-base">Notion Command & Control</CardTitle>
            </div>
            <CardDescription>
              When a brief is generated, the Signal Engine will write intelligence pages and action tasks directly into these Notion databases. Paste the 32-character Notion database IDs below.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="competitorDbId" className="text-sm font-medium">
                Competitor Intelligence DB
              </Label>
              <p className="text-xs text-muted-foreground">
                Each brief creates a new page here — title, severity tags, Zeta-Core verdict, trial sections, smoking gun quotes.
              </p>
              <Input
                id="competitorDbId"
                placeholder="Notion database ID (e.g. 33d95050...)"
                value={notionCompetitorDbId}
                onChange={e => setNotionCompetitorDbId(e.target.value)}
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tasksDbId" className="text-sm font-medium">
                Action Items / Tasks DB
              </Label>
              <p className="text-xs text-muted-foreground">
                For every CRITICAL or HIGH trial signal, a task row is injected — title includes drug name + failure vector, due date is today + 2 days.
              </p>
              <Input
                id="tasksDbId"
                placeholder="Notion database ID (e.g. a1b2c3d4...)"
                value={notionTasksDbId}
                onChange={e => setNotionTasksDbId(e.target.value)}
                className="font-mono text-sm"
              />
            </div>
            <Button
              onClick={handleSaveC2}
              disabled={c2Saving || (!notionCompetitorDbId && !notionTasksDbId)}
              className="gap-2"
              size="sm"
            >
              {c2Saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Database className="h-3.5 w-3.5" />}
              {c2Saving ? "Saving…" : "Save Notion C2 Config"}
            </Button>
          </CardContent>
        </Card>

        {/* Audit Log Panel */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-base">Connection Audit Log</CardTitle>
              <CardDescription className="text-xs">Last 10 connection events</CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={loadAudit}
              disabled={loadingAudit}
              className="gap-1.5 text-xs"
            >
              {loadingAudit ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Refresh
            </Button>
          </CardHeader>
          <CardContent>
            {!auditLoaded && !loadingAudit && (
              <p className="text-xs text-muted-foreground">Click Refresh to load audit log.</p>
            )}
            {loadingAudit && (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
              </div>
            )}
            {auditLoaded && audit.length === 0 && (
              <p className="text-xs text-muted-foreground">No audit entries yet. Run discovery to start logging.</p>
            )}
            {auditLoaded && audit.length > 0 && (
              <div className="space-y-1.5">
                {audit.map((entry, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs border-b last:border-0 py-1.5">
                    <span className="text-muted-foreground shrink-0 w-[130px]">
                      {new Date(entry.timestamp).toLocaleString()}
                    </span>
                    <ActionBadge action={entry.action} />
                    <span className="font-medium shrink-0">{entry.resource}</span>
                    <span className="text-muted-foreground truncate">{entry.result}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </LayoutShell>
  );
}

function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <span
      className={`text-sm font-medium px-2 py-0.5 rounded ${
        done
          ? "text-green-700"
          : active
          ? "text-primary"
          : "text-muted-foreground"
      }`}
    >
      {done ? <CheckCircle2 className="h-3.5 w-3.5 inline mr-1" /> : null}
      {label}
    </span>
  );
}
