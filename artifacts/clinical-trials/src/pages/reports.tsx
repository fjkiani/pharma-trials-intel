import { useState } from "react";
import { LayoutShell } from "@/components/layout-shell";
import {
  useListReports,
  getListReportsQueryKey,
  useGenerateReport,
  useRunMonthlyReport,
  useSendReportToPi,
  useMarkReportApproved,
  useMarkReportFinal,
  useDiscardReport,
} from "@workspace/api-client-react";
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
  FileText,
  ExternalLink,
  Send,
  CheckCircle2,
  Flag,
  Trash2,
  AlertTriangle,
  Clock,
  RotateCcw,
  CheckCheck,
  Zap,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";

type ReportStatus = "Draft" | "PI Review" | "Approved" | "Sent" | "Discarded";

interface SponsorReport {
  id: string;
  docUrl: string;
  docId: string;
  status: ReportStatus;
  generatedAt: string;
  sentToPiAt?: string | null;
  lastNagAt?: string | null;
  approvedAt?: string | null;
  finalizedAt?: string | null;
  unreplacedPlaceholders: string[];
}

type PendingFlow = "run-monthly" | "generate";

function StatusBadge({ status }: { status: ReportStatus }) {
  switch (status) {
    case "Draft":
      return <Badge variant="secondary" className="gap-1"><FileText className="h-3 w-3" />Draft</Badge>;
    case "PI Review":
      return <Badge className="bg-amber-500/10 text-amber-700 border-amber-500/20 gap-1"><Clock className="h-3 w-3" />PI Review</Badge>;
    case "Approved":
      return <Badge className="bg-blue-500/10 text-blue-700 border-blue-500/20 gap-1"><CheckCircle2 className="h-3 w-3" />Approved</Badge>;
    case "Sent":
      return <Badge className="bg-green-500/10 text-green-700 border-green-500/20 gap-1"><CheckCheck className="h-3 w-3" />Sent</Badge>;
    case "Discarded":
      return <Badge variant="outline" className="text-muted-foreground gap-1"><Trash2 className="h-3 w-3" />Discarded</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function StepBadge({ label, active, complete }: { label: string; active?: boolean; complete?: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border ${
      complete
        ? "bg-green-500/10 text-green-700 border-green-500/20"
        : active
          ? "bg-primary/10 text-primary border-primary/20"
          : "bg-muted text-muted-foreground border-transparent"
    }`}>
      {complete ? <CheckCircle2 className="h-3 w-3" /> : null}
      {label}
    </div>
  );
}

function LifecycleBar({ status }: { status: ReportStatus }) {
  const steps = ["Draft", "PI Review", "Approved", "Sent"] as const;
  const idx = steps.indexOf(status as typeof steps[number]);
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center gap-1">
          <StepBadge label={s} active={i === idx} complete={i < idx} />
          {i < steps.length - 1 && <span className="text-muted-foreground text-xs">→</span>}
        </div>
      ))}
    </div>
  );
}

function ReportCard({
  report,
  onRefresh,
}: {
  report: SponsorReport;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const sendToPi = useSendReportToPi();
  const markApproved = useMarkReportApproved();
  const markFinal = useMarkReportFinal();
  const discardReport = useDiscardReport();
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const isDiscarded = report.status === "Discarded";

  return (
    <>
      <Card className={isDiscarded ? "opacity-50" : ""}>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">
                  Sponsor Report — {format(parseISO(report.generatedAt), "MMM d, yyyy")}
                </CardTitle>
                <StatusBadge status={report.status} />
              </div>
              <CardDescription className="text-xs">
                Generated {format(parseISO(report.generatedAt), "MMM d, yyyy 'at' h:mm a")}
                {report.sentToPiAt && ` · Sent to PI ${format(parseISO(report.sentToPiAt), "MMM d, h:mm a")}`}
                {report.approvedAt && ` · Approved ${format(parseISO(report.approvedAt), "MMM d, h:mm a")}`}
                {report.finalizedAt && ` · Finalized ${format(parseISO(report.finalizedAt), "MMM d, h:mm a")}`}
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <a href={report.docUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                Open Doc
              </a>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isDiscarded && <LifecycleBar status={report.status} />}

          {report.unreplacedPlaceholders.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">Unreplaced placeholders detected</p>
                <p className="text-xs mt-1 font-mono">{report.unreplacedPlaceholders.join(", ")}</p>
                <p className="text-xs mt-1">Check your template — these may appear in the report sent to the sponsor.</p>
              </div>
            </div>
          )}

          {!isDiscarded && (
            <div className="flex flex-wrap gap-2">
              {report.status === "Draft" && (
                <>
                  <Button
                    size="sm"
                    onClick={() => {
                      sendToPi.mutate(
                        { reportId: report.id },
                        {
                          onSuccess: () => {
                            toast({ title: "Sent to PI", description: "The PI has been emailed a link to the report." });
                            onRefresh();
                          },
                          onError: (err: unknown) => {
                            const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? (err instanceof Error ? err.message : "Unknown error");
                            toast({ title: "Failed to Send", description: msg, variant: "destructive" });
                          },
                        },
                      );
                    }}
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

              {report.status === "PI Review" && (
                <>
                  <Button
                    size="sm"
                    onClick={() => {
                      markApproved.mutate(
                        { reportId: report.id },
                        {
                          onSuccess: () => {
                            toast({ title: "Report Approved", description: "Marked as approved by PI." });
                            onRefresh();
                          },
                          onError: (err: unknown) => {
                            const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Unknown error";
                            toast({ title: "Error", description: msg, variant: "destructive" });
                          },
                        },
                      );
                    }}
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
                    disabled={discardReport.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                    Discard
                  </Button>
                </>
              )}

              {report.status === "Approved" && (
                <>
                  <Button
                    size="sm"
                    onClick={() => {
                      markFinal.mutate(
                        { reportId: report.id },
                        {
                          onSuccess: (data: unknown) => {
                            toast({ title: "Report Finalized", description: "Report marked as sent to sponsor." });
                            const calWarn = (data as { calendarWarning?: string | null })?.calendarWarning;
                            if (calWarn) {
                              toast({ title: "Calendar Update Skipped", description: calWarn, variant: "default" });
                            }
                            onRefresh();
                          },
                          onError: (err: unknown) => {
                            const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Unknown error";
                            toast({ title: "Error", description: msg, variant: "destructive" });
                          },
                        },
                      );
                    }}
                    disabled={markFinal.isPending}
                  >
                    <Flag className="h-3.5 w-3.5 mr-1.5" />
                    {markFinal.isPending ? "Finalizing..." : "Mark Final"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirmDiscard(true)}
                    className="text-destructive hover:text-destructive"
                    disabled={discardReport.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                    Discard
                  </Button>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this report?</AlertDialogTitle>
            <AlertDialogDescription>
              {report.status === "Draft"
                ? "The Google Doc will be permanently deleted from Drive. This cannot be undone."
                : "This report will be marked as discarded. The Google Doc will not be deleted — the PI still has access to it."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                discardReport.mutate(
                  { reportId: report.id },
                  {
                    onSuccess: () => {
                      toast({
                        title: "Report Discarded",
                        description: report.status === "Draft"
                          ? "The report draft and its Google Doc have been deleted."
                          : "The report has been marked as discarded. The Google Doc remains accessible to the PI.",
                      });
                      setConfirmDiscard(false);
                      onRefresh();
                    },
                    onError: (err: unknown) => {
                      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Unknown error";
                      toast({ title: "Error", description: msg, variant: "destructive" });
                      setConfirmDiscard(false);
                    },
                  },
                );
              }}
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

export default function SponsorReports() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: reports, isLoading, refetch } = useListReports({
    query: { enabled: true, queryKey: getListReportsQueryKey() },
  });

  const runMonthly = useRunMonthlyReport();
  const generateReport = useGenerateReport();

  const [stalenessWarning, setStalenessWarning] = useState<string | null>(null);
  const [pendingFlow, setPendingFlow] = useState<PendingFlow | null>(null);

  const { data: integrationStatus } = useQuery({
    queryKey: ["integration-status"],
    queryFn: async () => {
      const res = await fetch("/api/integrations/status");
      if (!res.ok) return null;
      return res.json() as Promise<{
        gmail?: { connected: boolean; needsReconnect?: boolean };
        googleSheets?: { connected: boolean; needsReconnect?: boolean };
        googleDocs?: { connected: boolean; needsReconnect?: boolean };
      }>;
    },
    staleTime: 60_000,
  });
  const gmailNeedsReconnect = integrationStatus?.gmail?.needsReconnect === true;
  const driveNeedsReconnect =
    integrationStatus?.googleSheets?.needsReconnect === true ||
    integrationStatus?.googleDocs?.needsReconnect === true;

  function invalidateReports() {
    queryClient.invalidateQueries({ queryKey: getListReportsQueryKey() });
    refetch();
  }

  function handleRunMonthly(acknowledgeStale = false) {
    runMonthly.mutate(
      { data: { acknowledgeStale } },
      {
        onSuccess: (result) => {
          if (result.requiresStaleAcknowledge && result.stalenessWarning) {
            setStalenessWarning(result.stalenessWarning);
            setPendingFlow("run-monthly");
            return;
          }
          if (result.stalenessWarning) {
            toast({
              title: "Data Freshness Warning",
              description: result.stalenessWarning,
            });
          }
          invalidateReports();
          toast({
            title: "Report sent to PI",
            description: result.message ?? "Report generated and emailed to PI for review.",
          });
        },
        onError: (err: unknown) => {
          const errData = err as { response?: { data?: { error?: string }; status?: number } };
          const status = errData?.response?.status;
          const msg = errData?.response?.data?.error ?? (err instanceof Error ? err.message : "Unknown error");
          if (status === 409) {
            toast({ title: "Cannot Run", description: msg, variant: "destructive" });
          } else {
            toast({ title: "Run Failed", description: msg, variant: "destructive" });
          }
        },
      },
    );
  }

  function handleGenerate(acknowledgeStale = false) {
    generateReport.mutate(
      { data: { acknowledgeStale } },
      {
        onSuccess: (result) => {
          if (result.requiresStaleAcknowledge && result.stalenessWarning) {
            setStalenessWarning(result.stalenessWarning);
            setPendingFlow("generate");
            return;
          }
          if (result.stalenessWarning) {
            toast({
              title: "Data Freshness Warning",
              description: result.stalenessWarning,
            });
          }
          invalidateReports();
          toast({
            title: "Report Generated",
            description: result.report?.unreplacedPlaceholders?.length
              ? `Report created with ${result.report.unreplacedPlaceholders.length} unreplaced placeholder(s) — review before sending.`
              : "Report draft is ready to review.",
          });
        },
        onError: (err: unknown) => {
          const errData = err as { response?: { data?: { error?: string }; status?: number } };
          const status = errData?.response?.status;
          const msg = errData?.response?.data?.error ?? (err instanceof Error ? err.message : "Unknown error");
          if (status === 409) {
            toast({ title: "Cannot Generate", description: msg, variant: "destructive" });
          } else {
            toast({ title: "Generation Failed", description: msg, variant: "destructive" });
          }
        },
      },
    );
  }

  function handleStalenessConfirm() {
    const flow = pendingFlow;
    setStalenessWarning(null);
    setPendingFlow(null);
    if (flow === "run-monthly") handleRunMonthly(true);
    else if (flow === "generate") handleGenerate(true);
  }

  const activeReport = reports?.find(
    (r) => r.status === "PI Review" || r.status === "Approved",
  );

  const isPending = runMonthly.isPending || generateReport.isPending;

  return (
    <LayoutShell>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Sponsor Report Co-Pilot</h1>
            <p className="text-muted-foreground mt-2">
              One click generates, fills, and emails the monthly report to your PI.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleGenerate(false)}
              disabled={isPending}
              title="Generate draft only — you will send it manually"
            >
              <RotateCcw className={`h-3.5 w-3.5 mr-1.5 ${generateReport.isPending ? "animate-spin" : ""}`} />
              {generateReport.isPending ? "Generating..." : "Draft Only"}
            </Button>

            <Button
              onClick={() => handleRunMonthly(false)}
              disabled={isPending}
              className="gap-2"
            >
              <Zap className={`h-4 w-4 ${runMonthly.isPending ? "animate-pulse" : ""}`} />
              {runMonthly.isPending ? "Running..." : "Run Monthly Report"}
            </Button>
          </div>
        </div>

        {driveNeedsReconnect && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-red-500" />
            <div>
              <p className="font-semibold">Google Drive reconnection required</p>
              <p className="text-xs mt-1">
                Google Sheets and Docs access is failing (401). Report generation will fail until you reconnect.
              </p>
              <ol className="text-xs mt-2 space-y-0.5 list-decimal list-inside text-red-700">
                <li>Open the <strong>Replit integrations panel</strong> (top-right of the Replit editor).</li>
                <li>Find <strong>Google Drive</strong> and click <strong>Disconnect</strong>.</li>
                <li>Click <strong>Connect</strong> again and accept all permission scopes when prompted.</li>
              </ol>
            </div>
          </div>
        )}

        {gmailNeedsReconnect && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-red-500" />
            <div>
              <p className="font-semibold">Gmail reconnection required</p>
              <p className="text-xs mt-1">
                The Gmail integration is missing send permissions. Email delivery will fail until you reconnect.
              </p>
              <ol className="text-xs mt-2 space-y-0.5 list-decimal list-inside text-red-700">
                <li>Open the <strong>Replit integrations panel</strong> (top-right of the Replit editor).</li>
                <li>Find <strong>Google Mail</strong> and click <strong>Disconnect</strong>.</li>
                <li>Click <strong>Connect</strong> again and accept all permission scopes when prompted.</li>
              </ol>
            </div>
          </div>
        )}

        {activeReport && (
          <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">Active report in progress</p>
              <p className="text-xs mt-1">
                The report from {format(parseISO(activeReport.generatedAt), "MMM d, yyyy")} is in{" "}
                <strong>{activeReport.status}</strong> status. Finalize or discard it before generating a new report.
              </p>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-4">
            {Array(2).fill(0).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full" />
            ))}
          </div>
        ) : reports && reports.length > 0 ? (
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Report History
            </h2>
            {reports.map((report) => (
              <ReportCard
                key={report.id}
                report={report as SponsorReport}
                onRefresh={invalidateReports}
              />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-16 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mx-auto mb-4">
                <Zap className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-lg font-semibold">Ready to run your first report</h3>
              <p className="text-muted-foreground text-sm mt-2 max-w-sm mx-auto">
                Click <strong>Run Monthly Report</strong> to pull enrollment data, AE/deviation summaries,
                and email a pre-filled report draft directly to your PI.
              </p>
              <p className="text-muted-foreground text-xs mt-4">
                Make sure your{" "}
                <Link href="/settings" className="text-primary underline underline-offset-2">
                  Settings
                </Link>{" "}
                are configured first.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <AlertDialog
        open={!!stalenessWarning && !!pendingFlow}
        onOpenChange={(open) => {
          if (!open) {
            setStalenessWarning(null);
            setPendingFlow(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Enrollment Data May Be Stale
            </AlertDialogTitle>
            <AlertDialogDescription>
              {stalenessWarning}
              {"\n\n"}Do you want to proceed anyway?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setStalenessWarning(null); setPendingFlow(null); }}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleStalenessConfirm}>
              Proceed Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </LayoutShell>
  );
}
