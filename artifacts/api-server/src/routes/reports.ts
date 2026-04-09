import { Router, type IRouter } from "express";
import {
  ListReportsResponse,
  GenerateReportResponse,
  SendReportToPiResponse,
  MarkReportApprovedResponse,
  MarkReportFinalResponse,
  DiscardReportResponse,
  NagCheckResponse,
} from "@workspace/api-zod";
import { getSettings } from "../lib/settings.js";
import { logger } from "../lib/logger.js";
import {
  createReport,
  getReport,
  updateReport,
  listReports,
  getActiveReport,
} from "../lib/reportHistory.js";

const router: IRouter = Router();

async function getNotionClient() {
  try {
    const { getUncachableNotionClient } = await import("../lib/notionClient.js");
    return getUncachableNotionClient();
  } catch {
    return null;
  }
}

router.get("/reports", async (_req, res): Promise<void> => {
  const reports = await listReports();
  res.json(ListReportsResponse.parse(reports));
});

router.post("/reports/generate", async (req, res): Promise<void> => {
  const { acknowledgeStale = false } = (req.body ?? {}) as { acknowledgeStale?: boolean };

  const settings = await getSettings();

  const active = await getActiveReport();
  if (active) {
    const dateStr = new Date(active.generatedAt).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    res.status(409).json({
      error: `Report from ${dateStr} is still in ${active.status} — finalize or discard before generating a new one.`,
    });
    return;
  }

  const {
    googleSheetsId,
    googleDocsTemplateId,
    piEmail,
    notionAeLogDbId,
    notionDeviationLogDbId,
    notionRegulatoryDbId,
  } = settings;

  if (!googleSheetsId || !googleDocsTemplateId || !piEmail) {
    res.status(503).json({
      error:
        "Missing required settings: Google Sheets ID, Google Docs Template ID, or PI Email. Configure them in Settings.",
    });
    return;
  }

  const { getSheetFreshness, readEnrollmentData } = await import(
    "../lib/googleSheets.js"
  );
  const {
    copyTemplate,
    fillPlaceholders,
    scanForUnreplacedPlaceholders,
    grantWriterAccess,
    buildDocUrl,
  } = await import("../lib/googleDocs.js");

  let stalenessWarning: string | null = null;

  try {
    const freshness = await getSheetFreshness(googleSheetsId);
    if (freshness.isStale && !acknowledgeStale) {
      const hoursAgo = Math.round(freshness.ageHours);
      stalenessWarning = `Enrollment sheet last updated ${hoursAgo} hour${hoursAgo !== 1 ? "s" : ""} ago — confirm data is current before generating.`;
      res.json(
        GenerateReportResponse.parse({
          requiresStaleAcknowledge: true,
          stalenessWarning,
        }),
      );
      return;
    }
    if (freshness.isStale) {
      const hoursAgo = Math.round(freshness.ageHours);
      stalenessWarning = `Enrollment sheet last updated ${hoursAgo} hour${hoursAgo !== 1 ? "s" : ""} ago — data may be stale.`;
    }
  } catch (err) {
    logger.warn({ err }, "Could not check sheet freshness — continuing without staleness check");
  }

  let enrollment = { enrolled: 0, screened: 0, screenFailures: 0, withdrawals: 0 };
  try {
    enrollment = await readEnrollmentData(
      googleSheetsId,
      settings.googleSheetTab || "Sheet1",
      (settings.googleSheetHeaderRow ?? 1) - 1,
    );
  } catch (err) {
    logger.warn({ err }, "Could not read enrollment data — using zeros");
  }

  const notionClient = await getNotionClient();
  const { readAeSummary, readDeviationSummary, readNextMilestone } = await import(
    "../lib/notionAeDeviation.js"
  );

  let aeSummary = { totalAe: 0, grade3PlusAe: 0 };
  let devSummary = { totalDeviations: 0, majorDeviations: 0 };
  let milestone = { nextMilestoneName: "N/A", nextMilestoneDate: "N/A" };

  if (notionClient) {
    [aeSummary, devSummary, milestone] = await Promise.all([
      readAeSummary(notionClient, notionAeLogDbId ?? ""),
      readDeviationSummary(notionClient, notionDeviationLogDbId ?? ""),
      readNextMilestone(notionClient, notionRegulatoryDbId ?? ""),
    ]);
  }

  const reportDate = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  let docId: string;
  try {
    docId = await copyTemplate(
      googleDocsTemplateId,
      `Sponsor Report — ${reportDate}`,
    );
  } catch (err) {
    logger.error({ err }, "Failed to copy template doc");
    res.status(503).json({ error: "Failed to copy report template from Google Drive. Check template ID and Drive permissions." });
    return;
  }

  try {
    await fillPlaceholders(docId, [
      { placeholder: "{{enrolled}}", value: String(enrollment.enrolled) },
      { placeholder: "{{screened}}", value: String(enrollment.screened) },
      { placeholder: "{{screen_failures}}", value: String(enrollment.screenFailures) },
      { placeholder: "{{withdrawals}}", value: String(enrollment.withdrawals) },
      { placeholder: "{{ae_count}}", value: String(aeSummary.totalAe) },
      { placeholder: "{{ae_grade3_plus}}", value: String(aeSummary.grade3PlusAe) },
      { placeholder: "{{deviation_count}}", value: String(devSummary.totalDeviations) },
      { placeholder: "{{major_deviations}}", value: String(devSummary.majorDeviations) },
      { placeholder: "{{next_milestone}}", value: milestone.nextMilestoneName },
      { placeholder: "{{next_milestone_date}}", value: milestone.nextMilestoneDate },
      { placeholder: "{{report_date}}", value: reportDate },
    ]);
  } catch (err) {
    logger.error({ err }, "Failed to fill placeholders");
  }

  let unreplacedPlaceholders: string[] = [];
  try {
    unreplacedPlaceholders = await scanForUnreplacedPlaceholders(docId);
  } catch (err) {
    logger.warn({ err }, "Could not scan for unreplaced placeholders");
  }

  try {
    await grantWriterAccess(docId, piEmail);
  } catch (err) {
    logger.error({ err }, "Failed to grant PI writer access — deleting orphaned doc");
    try { await (await import("../lib/googleDocs.js")).deleteDoc(docId); } catch {}
    const errMsg = err instanceof Error ? err.message : String(err);
    res.status(503).json({
      error: `Failed to grant PI writer access on the report doc: ${errMsg}. Check Google Drive permissions and PI email address.`,
    });
    return;
  }

  const docUrl = buildDocUrl(docId);
  const report = await createReport({ docUrl, docId, unreplacedPlaceholders });

  res.json(
    GenerateReportResponse.parse({
      report,
      stalenessWarning,
      requiresStaleAcknowledge: false,
    }),
  );
});

router.post("/reports/:reportId/send-to-pi", async (req, res): Promise<void> => {
  const { reportId } = req.params;
  const report = await getReport(reportId);

  if (!report) {
    res.status(404).json({ error: "Report not found" });
    return;
  }

  if (report.status !== "Draft") {
    res.status(409).json({ error: `Report is in ${report.status} status — can only send Draft reports.` });
    return;
  }

  const settings = await getSettings();
  if (!settings.piEmail) {
    res.status(503).json({ error: "PI email not configured. Set it in Settings." });
    return;
  }

  const { sendPiReviewEmail } = await import("../lib/gmail.js");
  const reportDate = new Date(report.generatedAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  try {
    await sendPiReviewEmail({
      piEmail: settings.piEmail,
      docUrl: report.docUrl,
      reportDate,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Failed to send PI review email");
    res.status(503).json({
      error: `Failed to send email to PI: ${errMsg}. Check Gmail connection and PI email address.`,
    });
    return;
  }

  const updated = await updateReport(reportId, {
    status: "PI Review",
    sentToPiAt: new Date().toISOString(),
    lastNagAt: new Date().toISOString(),
  });

  res.json(SendReportToPiResponse.parse(updated));
});

router.post("/reports/:reportId/mark-approved", async (req, res): Promise<void> => {
  const { reportId } = req.params;
  const report = await getReport(reportId);

  if (!report) {
    res.status(404).json({ error: "Report not found" });
    return;
  }

  if (report.status !== "PI Review") {
    res.status(409).json({ error: `Report is in ${report.status} status — can only approve PI Review reports.` });
    return;
  }

  const updated = await updateReport(reportId, {
    status: "Approved",
    approvedAt: new Date().toISOString(),
  });

  res.json(MarkReportApprovedResponse.parse(updated));
});

router.post("/reports/:reportId/mark-final", async (req, res): Promise<void> => {
  const { reportId } = req.params;
  const report = await getReport(reportId);

  if (!report) {
    res.status(404).json({ error: "Report not found" });
    return;
  }

  if (report.status !== "Approved") {
    res.status(409).json({ error: `Report is in ${report.status} status — can only finalize Approved reports.` });
    return;
  }

  const settings = await getSettings();

  if (settings.sponsorCallEventId) {
    try {
      const { getUncachableGoogleCalendarClient } = await import(
        "../lib/googleCalendarClient.js"
      );
      const calendar = await getUncachableGoogleCalendarClient();
      const calId = settings.googleCalendarId || "primary";
      const event = await calendar.events.get({
        calendarId: calId,
        eventId: settings.sponsorCallEventId,
      });
      const existingDesc = event.data.description ?? "";
      const appendedDesc =
        existingDesc +
        (existingDesc ? "\n\n" : "") +
        `Sponsor Report (${new Date().toLocaleDateString("en-US")}): ${report.docUrl}`;
      await calendar.events.patch({
        calendarId: calId,
        eventId: settings.sponsorCallEventId,
        requestBody: { description: appendedDesc },
      });
    } catch (err) {
      logger.warn({ err }, "Could not update sponsor call calendar event");
    }
  }

  const updated = await updateReport(reportId, {
    status: "Sent",
    finalizedAt: new Date().toISOString(),
  });

  res.json(MarkReportFinalResponse.parse(updated));
});

router.post("/reports/:reportId/discard", async (req, res): Promise<void> => {
  const { reportId } = req.params;
  const report = await getReport(reportId);

  if (!report) {
    res.status(404).json({ error: "Report not found" });
    return;
  }

  if (report.status !== "Draft") {
    res.status(409).json({ error: `Report is in ${report.status} status — only Draft reports can be discarded.` });
    return;
  }

  try {
    const { deleteDoc } = await import("../lib/googleDocs.js");
    await deleteDoc(report.docId);
  } catch (err) {
    logger.warn({ err }, "Could not delete Google Doc during discard — marking discarded anyway");
  }

  const updated = await updateReport(reportId, { status: "Discarded" });
  res.json(DiscardReportResponse.parse(updated));
});

router.post("/internal/nag-check", async (_req, res): Promise<void> => {
  const settings = await getSettings();
  const nagIntervalHours = settings.nagIntervalHours ?? 4;

  const reports = await listReports();
  const piReviewReports = reports.filter((r) => r.status === "PI Review");

  let nagsSent = 0;
  const errors: string[] = [];

  for (const report of piReviewReports) {
    const lastNagAt = report.lastNagAt ?? report.sentToPiAt ?? report.generatedAt;
    const elapsedHours =
      (Date.now() - new Date(lastNagAt).getTime()) / (1000 * 60 * 60);

    if (elapsedHours < nagIntervalHours) continue;

    const reportDate = new Date(report.generatedAt).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });

    try {
      if (!settings.piEmail) {
        errors.push(`Report ${report.id}: PI email not configured`);
        continue;
      }
      const { sendNagEmail } = await import("../lib/gmail.js");
      await sendNagEmail({
        piEmail: settings.piEmail,
        docUrl: report.docUrl,
        reportDate,
        nagCount: 1,
      });
      await updateReport(report.id, { lastNagAt: new Date().toISOString() });
      nagsSent++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Report ${report.id}: ${msg}`);
      logger.error({ err, reportId: report.id }, "Nag email failed");
    }
  }

  res.json(NagCheckResponse.parse({ nagsSent, errors }));
});

export default router;
