import { LayoutShell } from "@/components/layout-shell";
import { 
  useListRegulatoryDocuments, 
  getListRegulatoryDocumentsQueryKey,
  useGetRegulatorysummary,
  getGetRegulatorysummaryQueryKey,
  useSyncRegulatoryCalendar
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ExternalLink, CalendarSync, AlertCircle, FileText } from "lucide-react";
import { format, parseISO } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";

export default function RegulatoryTimeline() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: documents, isLoading: isLoadingDocs } = useListRegulatoryDocuments({
    query: { enabled: true, queryKey: getListRegulatoryDocumentsQueryKey() }
  });

  const { data: summary, isLoading: isLoadingSummary } = useGetRegulatorysummary({
    query: { enabled: true, queryKey: getGetRegulatorysummaryQueryKey() }
  });

  const syncCalendar = useSyncRegulatoryCalendar();

  const handleSyncCalendar = () => {
    syncCalendar.mutate(undefined, {
      onSuccess: (result) => {
        toast({
          title: "Calendar Synced",
          description: `Created ${result.eventsCreated} events. Skipped ${result.eventsSkipped}.`,
        });
        queryClient.invalidateQueries({ queryKey: getListRegulatoryDocumentsQueryKey() });
      },
      onError: (error: unknown) => {
        toast({
          title: "Sync Failed",
          description: error instanceof Error ? error.message : "Failed to sync with Google Calendar.",
          variant: "destructive",
        });
      }
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "Current":
        return <Badge className="bg-green-500/10 text-green-700 hover:bg-green-500/20 border-green-500/20">Current</Badge>;
      case "Expiring Soon":
        return <Badge className="bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 border-amber-500/20">Expiring Soon</Badge>;
      case "Expired":
        return <Badge variant="destructive">Expired</Badge>;
      default:
        return <Badge variant="secondary">Unknown</Badge>;
    }
  };

  const isConfigured = summary?.notionsConnected;

  if (isLoadingSummary || isLoadingDocs) {
    return (
      <LayoutShell>
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Regulatory Timeline</h1>
              <p className="text-muted-foreground mt-2">Manage clinical trial regulatory documents and expiration dates.</p>
            </div>
            <Skeleton className="h-10 w-32" />
          </div>
          <div className="grid gap-4 md:grid-cols-4">
            {Array(4).fill(0).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
          <Skeleton className="h-[400px] w-full mt-6" />
        </div>
      </LayoutShell>
    );
  }

  if (!isConfigured) {
    return (
      <LayoutShell>
        <div className="flex h-[80vh] flex-col items-center justify-center text-center space-y-4">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted">
            <AlertCircle className="h-10 w-10 text-muted-foreground" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight">System Not Configured</h2>
          <p className="text-muted-foreground max-w-md">
            The regulatory timeline requires a connection to a Notion database. Please configure your settings to continue.
          </p>
          <Button asChild className="mt-4">
            <Link href="/settings">Go to Settings</Link>
          </Button>
        </div>
      </LayoutShell>
    );
  }

  return (
    <LayoutShell>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Regulatory Timeline</h1>
            <p className="text-muted-foreground mt-2">Manage clinical trial regulatory documents and expiration dates.</p>
          </div>
          <Button 
            onClick={handleSyncCalendar} 
            disabled={syncCalendar.isPending}
            className="flex items-center gap-2"
          >
            <CalendarSync className="h-4 w-4" />
            {syncCalendar.isPending ? "Syncing..." : "Sync Calendar Reminders"}
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Documents</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary?.total || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Current</CardTitle>
              <div className="h-4 w-4 rounded-full bg-green-500/20 flex items-center justify-center">
                <div className="h-2 w-2 rounded-full bg-green-500" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary?.current || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Expiring Soon</CardTitle>
              <div className="h-4 w-4 rounded-full bg-amber-500/20 flex items-center justify-center">
                <div className="h-2 w-2 rounded-full bg-amber-500" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary?.expiringSoon || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-destructive">Expired</CardTitle>
              <div className="h-4 w-4 rounded-full bg-red-500/20 flex items-center justify-center">
                <div className="h-2 w-2 rounded-full bg-red-500" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-destructive">{summary?.expired || 0}</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Timeline</CardTitle>
            <CardDescription>All regulatory documents sorted by expiration date.</CardDescription>
          </CardHeader>
          <CardContent>
            {documents && documents.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Document Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Expiration Date</TableHead>
                    <TableHead>Days Until</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.map((doc) => (
                    <TableRow key={doc.id}>
                      <TableCell className="font-medium">{doc.name}</TableCell>
                      <TableCell>{getStatusBadge(doc.status)}</TableCell>
                      <TableCell>
                        {doc.expirationDate 
                          ? format(parseISO(doc.expirationDate), "MMM d, yyyy") 
                          : "N/A"}
                      </TableCell>
                      <TableCell>
                        {doc.daysUntilExpiration !== null && doc.daysUntilExpiration !== undefined ? (
                          <span className={doc.daysUntilExpiration < 0 ? "text-destructive font-bold" : doc.daysUntilExpiration <= 30 ? "text-amber-600 font-bold" : ""}>
                            {doc.daysUntilExpiration} days
                          </span>
                        ) : (
                          "N/A"
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {doc.fileLink ? (
                          <Button variant="ghost" size="sm" asChild>
                            <a href={doc.fileLink} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-4 w-4 mr-2" />
                              View
                            </a>
                          </Button>
                        ) : (
                          <span className="text-sm text-muted-foreground mr-4">No file link</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="py-8 text-center text-muted-foreground">
                No regulatory documents found in Notion.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </LayoutShell>
  );
}
