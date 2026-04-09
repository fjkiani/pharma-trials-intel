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
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

const settingsSchema = z.object({
  notionRegulatoryDbId: z.string().min(1, "Required"),
  googleCalendarId: z.string().min(1, "Required"),
  notionAeLogDbId: z.string().min(1, "Required"),
  notionDeviationLogDbId: z.string().min(1, "Required"),
  googleSheetsId: z.string().min(1, "Required"),
  googleSheetTab: z.string().min(1, "Required"),
  googleSheetHeaderRow: z.coerce.number().min(1, "Must be at least 1"),
  googleDocsTemplateId: z.string().min(1, "Required"),
  sponsorCallEventId: z.string().min(1, "Required"),
  piEmail: z.string().email("Invalid email"),
  sponsorEmail: z.string().email("Invalid email"),
  nagIntervalHours: z.coerce.number().min(1, "Must be at least 1"),
});

type SettingsFormValues = z.infer<typeof settingsSchema>;

export default function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

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
      onError: (error) => {
        toast({
          title: "Error saving settings",
          description: error.error || "An unexpected error occurred.",
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
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground mt-2">Configure integrations for Notion, Google Drive, and Google Calendar.</p>
        </div>

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
                        <Input {...field} />
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
                        <Input {...field} />
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
                        <Input {...field} />
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
                        <Input {...field} />
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
                        <Input {...field} />
                      </FormControl>
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
                        <Input {...field} />
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
                        <Input {...field} />
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
                        <Input {...field} />
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
                        <Input type="number" {...field} />
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
                        <Input type="email" {...field} />
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
                        <Input type="email" {...field} />
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
                        <Input type="number" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button type="submit" disabled={updateSettings.isPending}>
                {updateSettings.isPending ? "Saving..." : "Save Settings"}
              </Button>
            </div>
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
                  <TableCell>Total number of enrolled subjects</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-xs">{"{{screened}}"}</TableCell>
                  <TableCell>Total number of screened subjects</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-xs">{"{{aes}}"}</TableCell>
                  <TableCell>Recent Adverse Events summary</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-xs">{"{{deviations}}"}</TableCell>
                  <TableCell>Recent Protocol Deviations summary</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-xs">{"{{regulatory_status}}"}</TableCell>
                  <TableCell>Summary of expiring regulatory documents</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </LayoutShell>
  );
}
