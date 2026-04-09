import { useState } from "react";
import { LayoutShell } from "@/components/layout-shell";
import {
  useListReports,
  getListReportsQueryKey,
  useGenerateReport,
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
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
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
          {!isDiscarded && (
            <LifecycleBar status={report.status} />
          )}

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
                            toast({ title: "Email Failed", description: msg, variant: "destructive" });
                          },
                        },
                      );
                    }}
                    disabled={sendToPi.isPending}
                    className="gap-1"
                  >
                    <Send className="h-3.5 w-3.5" />
                    {sendToPi.isPending ? "Sending..." : "Send to PI for Review"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirmDiscard(true)}
                    disabled={discardReport.isPending}
                    className="gap-1 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Discard Draft
                  </Button>
                </>
              )}

              {report.status === "PI Review" && (
                <div className="flex flex-col gap-2 w-full">
                  <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                    <Clock className="h-4 w-4 shrink-0" />
                    <span>
                      Waiting for PI review.
                      {report.lastNagAt &&
                        ` Last reminder sent ${format(parseISO(report.lastNagAt), "MMM d, h:mm a")}.`}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => {
                      markApproved.mutate(
                        { reportId: report.id },
                        {
                          onSuccess: () => {
                            toast({ title: "Marked as PI Approved", description: "Report status advanced to Approved." });
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
                    className="gap-1 w-fit"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {markApproved.isPending ? "Marking..." : "Mark as PI Approved"}
                  </Button>
                </div>
              )}

              {report.status === "Approved" && (
                <Button
                  size="sm"
                  onClick={() => {
                    markFinal.mutate(
                      { reportId: report.id },
                      {
                        onSuccess: () => {
                          toast({ title: "Report Finalized", description: "Sponsor call calendar event updated with report link." });
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
                  className="gap-1"
                >
                  <Flag className="h-3.5 w-3.5" />
                  {markFinal.isPending ? "Finalizing..." : "Mark Final + Update Call"}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard Draft Report?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the Google Doc from Drive and mark the report as Discarded. This action cannot be undone.
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
                      toast({ title: "Report Discarded", description: "The draft and its Google Doc have been deleted." });
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

  const generateReport = useGenerateReport();

  const [stalenessWarning, setStalenessWarning] = useState<string | null>(null);
  const [pendingGenerate, setPendingGenerate] = useState(false);

  function invalidateReports() {
    queryClient.invalidateQueries({ queryKey: getListReportsQueryKey() });
    refetch();
  }

  function handleGenerate(acknowledgeStale = false) {
    generateReport.mutate(
      { data: { acknowledgeStale } },
      {
        onSuccess: (result) => {
          if (result.requiresStaleAcknowledge && result.stalenessWarning) {
            setStalenessWarning(result.stalenessWarning);
            setPendingGenerate(true);
            return;
          }
          if (result.stalenessWarning) {
            toast({
              title: "Data Freshness Warning",
              description: result.stalenessWarning,
              variant: "destructive",
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

  const activeReport = reports?.find(
    (r) => r.status === "PI Review" || r.status === "Approved",
  );

  return (
    <LayoutShell>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Sponsor Report Co-Pilot</h1>
            <p className="text-muted-foreground mt-2">
              Generate, review, and finalize monthly sponsor reports in one place.
            </p>
          </div>
          <Button
            onClick={() => handleGenerate(false)}
            disabled={generateReport.isPending}
            className="gap-2"
          >
            <RotateCcw className={`h-4 w-4 ${generateReport.isPending ? "animate-spin" : ""}`} />
            {generateReport.isPending ? "Generating..." : "Generate Report"}
          </Button>
        </div>

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
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mx-auto mb-4">
                <FileText className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold">No reports yet</h3>
              <p className="text-muted-foreground text-sm mt-2 max-w-sm mx-auto">
                Click <strong>Generate Report</strong> to pull enrollment data from Google Sheets, AE/deviation summaries from Notion, and create a pre-filled sponsor report draft.
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
        open={!!stalenessWarning && pendingGenerate}
        onOpenChange={(open) => {
          if (!open) {
            setStalenessWarning(null);
            setPendingGenerate(false);
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
              {"\n\n"}Do you want to proceed with generating the report anyway?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setStalenessWarning(null); setPendingGenerate(false); }}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setStalenessWarning(null);
                setPendingGenerate(false);
                handleGenerate(true);
              }}
            >
              Proceed Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </LayoutShell>
  );
}
