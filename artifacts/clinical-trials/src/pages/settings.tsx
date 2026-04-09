import { useGetSettings, getGetSettingsQueryKey, useUpdateSettings, AppSettingsInput } from "@workspace/api-client-react";
import { LayoutShell } from "@/components/layout-shell";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Lock, Unlock } from "lucide-react";

const settingsSchema = z.object({
  notionRegulatoryDbId: z.string(),
  googleCalendarId: z.string(),
  notionAeLogDbId: z.string(),
  notionDeviationLogDbId: z.string(),
  googleSheetsId: z.string(),
  googleSheetTab: z.string(),
  googleSheetHeaderRow: z.coerce.number().min(1, "Must be at least 1"),
  googleDocsTemplateId: z.string(),
  sponsorCallEventId: z.string(),
  piEmail: z.string().refine((v) => v === "" || z.string().email().safeParse(v).success, { message: "Invalid email" }),
  sponsorEmail: z.string().refine((v) => v === "" || z.string().email().safeParse(v).success, { message: "Invalid email" }),
  nagIntervalHours: z.coerce.number().min(1, "Must be at least 1"),
});

type SettingsFormValues = z.infer<typeof settingsSchema>;

export default function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [locked, setLocked] = useState(true);

  const { data: settings, isLoading } = useGetSettings({ 
    query: { enabled: true, queryKey: getGetSettingsQueryKey() } 
  });

  const updateSettings = useUpdateSettings();

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      notionRegulatoryDbId: "",
      googleCalendarId: "",
      notionAeLogDbId: "",
      notionDeviationLogDbId: "",
      googleSheetsId: "",
      googleSheetTab: "Sheet1",
      googleSheetHeaderRow: 1,
      googleDocsTemplateId: "",
      sponsorCallEventId: "",
      piEmail: "",
      sponsorEmail: "",
      nagIntervalHours: 24,
    },
  });

  useEffect(() => {
    if (settings) {
      form.reset({
        notionRegulatoryDbId: settings.notionRegulatoryDbId || "",
        googleCalendarId: settings.googleCalendarId || "",
        notionAeLogDbId: settings.notionAeLogDbId || "",
        notionDeviationLogDbId: settings.notionDeviationLogDbId || "",
        googleSheetsId: settings.googleSheetsId || "",
        googleSheetTab: settings.googleSheetTab || "Sheet1",
        googleSheetHeaderRow: settings.googleSheetHeaderRow || 1,
        googleDocsTemplateId: settings.googleDocsTemplateId || "",
        sponsorCallEventId: settings.sponsorCallEventId || "",
        piEmail: settings.piEmail || "",
        sponsorEmail: settings.sponsorEmail || "",
        nagIntervalHours: settings.nagIntervalHours || 24,
      });
    }
  }, [settings, form]);

  const onSubmit = (values: SettingsFormValues) => {
    updateSettings.mutate({ data: values }, {
      onSuccess: () => {
        toast({
          title: "Settings saved",
          description: "Application configuration has been updated.",
        });
        queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      },
      onError: (error: unknown) => {
        toast({
          title: "Error saving settings",
          description: error instanceof Error ? error.message : "An unexpected error occurred.",
          variant: "destructive",
        });
      }
    });
  };

  if (isLoading) {
    return (
      <LayoutShell>
        <div className="space-y-6 max-w-4xl">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
            <p className="text-muted-foreground mt-2">Configure system integrations.</p>
          </div>
          <div className="space-y-4">
            <Skeleton className="h-[400px] w-full" />
            <Skeleton className="h-[400px] w-full" />
          </div>
        </div>
      </LayoutShell>
    );
  }

  return (
    <LayoutShell>
      <div className="space-y-6 max-w-4xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
            <p className="text-muted-foreground mt-2">Configure integrations for Notion, Google Drive, and Google Calendar.</p>
          </div>
          <Button
            type="button"
            variant={locked ? "outline" : "secondary"}
            size="sm"
            className="gap-2 shrink-0"
            onClick={() => setLocked((l) => !l)}
          >
            {locked ? <><Lock className="h-3.5 w-3.5" /> Locked</> : <><Unlock className="h-3.5 w-3.5" /> Unlocked</>}
          </Button>
        </div>

        {locked && (
          <div className="flex items-start gap-2 rounded-md border border-muted bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            <Lock className="h-4 w-4 mt-0.5 shrink-0" />
            <p>Settings are pre-configured for ONCO-247. Click <strong>Locked</strong> above to edit them.</p>
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <Card>
              <CardHeader>
                <CardTitle>Notion Databases</CardTitle>
                <CardDescription>Enter the IDs for your required Notion databases.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="notionRegulatoryDbId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Regulatory Timeline DB ID</FormLabel>
                      <FormControl>
                        <Input {...field} disabled={locked} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="notionAeLogDbId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Adverse Events Log DB ID</FormLabel>
                      <FormControl>
                        <Input {...field} disabled={locked} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="notionDeviationLogDbId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Protocol Deviation Log DB ID</FormLabel>
                      <FormControl>
                        <Input {...field} disabled={locked} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Google Workspace</CardTitle>
                <CardDescription>Configure Google Calendar, Sheets, and Docs integration.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="googleCalendarId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Google Calendar ID</FormLabel>
                      <FormControl>
                        <Input {...field} disabled={locked} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="sponsorCallEventId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sponsor Call Event ID</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g. abc123xyz_0" disabled={locked} />
                      </FormControl>
                      {!locked && (
                        <FormDescription className="text-xs text-muted-foreground space-y-1">
                          <span className="block">
                            To find the Event ID: open the sponsor call in Google Calendar → click the three-dot menu → <strong>Edit event</strong>.
                          </span>
                          <span className="block">
                            In the browser URL, look for the <code className="bg-muted px-1 rounded">eid=</code> parameter. The value is base64-encoded — paste it into{" "}
                            <a
                              href="https://www.base64decode.org/"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline text-primary"
                            >
                              base64decode.org
                            </a>{" "}
                            to reveal the raw event ID.
                          </span>
                        </FormDescription>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="googleSheetsId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Google Sheets ID (EDC Extract)</FormLabel>
                      <FormControl>
                        <Input {...field} disabled={locked} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="googleDocsTemplateId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Google Docs Agenda Template ID</FormLabel>
                      <FormControl>
                        <Input {...field} disabled={locked} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="googleSheetTab"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sheet Tab Name</FormLabel>
                      <FormControl>
                        <Input {...field} disabled={locked} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="googleSheetHeaderRow"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Header Row Number</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} disabled={locked} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Notifications & Contacts</CardTitle>
                <CardDescription>Set email contacts and reminder intervals.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="piEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>PI Email Address</FormLabel>
                      <FormControl>
                        <Input type="email" {...field} disabled={locked} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="sponsorEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sponsor Email Address</FormLabel>
                      <FormControl>
                        <Input type="email" {...field} disabled={locked} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="nagIntervalHours"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nag Interval (Hours)</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} disabled={locked} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {!locked && (
              <div className="flex justify-end">
                <Button type="submit" disabled={updateSettings.isPending}>
                  {updateSettings.isPending ? "Saving..." : "Save Settings"}
                </Button>
              </div>
            )}
          </form>
        </Form>

        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Document Placeholders</CardTitle>
            <CardDescription>Reference for variables available in your Google Docs template.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[150px]">Placeholder</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-mono text-xs">{"{{enrolled}}"}</TableCell>
                  <TableCell>Total enrolled subjects</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-xs">{"{{screened}}"}</TableCell>
                  <TableCell>Total screened subjects</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-xs">{"{{screen_failures}}"}</TableCell>
                  <TableCell>Total screen failures</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-xs">{"{{withdrawals}}"}</TableCell>
                  <TableCell>Total withdrawals</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-xs">{"{{ae_count}}"}</TableCell>
                  <TableCell>Total adverse events</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-xs">{"{{ae_grade3_plus}}"}</TableCell>
                  <TableCell>Grade 3+ adverse events count</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-xs">{"{{deviation_count}}"}</TableCell>
                  <TableCell>Total protocol deviations</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-xs">{"{{major_deviations}}"}</TableCell>
                  <TableCell>Major protocol deviations count</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-xs">{"{{next_milestone}}"}</TableCell>
                  <TableCell>Next upcoming regulatory milestone name</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-xs">{"{{next_milestone_date}}"}</TableCell>
                  <TableCell>Next upcoming regulatory milestone date</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-xs">{"{{report_date}}"}</TableCell>
                  <TableCell>Report generation date</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </LayoutShell>
  );
}
