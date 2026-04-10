import { Router, type IRouter } from "express";
import {
  ListReportsResponse,
  GenerateReportResponse,
  RunMonthlyReportResponse,
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
  type SponsorReportRecord,
} from "../lib/reportHistory.js";

const router: IRouter = Router();

// ─── Shared error class ───────────────────────────────────────────────────────

class ApiError extends Error {
  constructor(
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ─── Notion client helper ─────────────────────────────────────────────────────

async function getNotionClient() {
  try {
    const { getUncachableNotionClient } = await import("../lib/notionClient.js");
    return getUncachableNotionClient();
  } catch {
    return null;
  }
}

// ─── Core generate logic (shared by /generate and /run-monthly) ───────────────

type GenerateOutcome =
  | { requiresStaleAcknowledge: true; stalenessWarning: string }
  | { requiresStaleAcknowledge: false; report: SponsorReportRecord; stalenessWarning: string | null };

async function performGenerate(acknowledgeStale: boolean): Promise<GenerateOutcome> {
  const settings = await getSettings();

  const {
    googleSheetsId,
    googleDocsTemplateId,
    piEmail,
    notionAeLogDbId,
    notionDeviationLogDbId,
    notionRegulatoryDbId,
  } = settings;

  if (!googleSheetsId || !googleDocsTemplateId || !piEmail) {
    throw new ApiError(
      503,
      "Missing required settings: Google Sheets ID, Google Docs Template ID, or PI Email. Configure them in Settings.",
    );
  }

  const { getSheetFreshness, readEnrollmentData } = await import("../lib/googleSheets.js");
  const {
    copyTemplate,
    fillPlaceholders,
    scanForUnreplacedPlaceholders,
    grantWriterAccess,
    buildDocUrl,
    deleteDoc,
  } = await import("../lib/googleDocs.js");

  // 1. Staleness check
  let stalenessWarning: string | null = null;
  try {
    const freshness = await getSheetFreshness(googleSheetsId);
    if (freshness.isStale && !acknowledgeStale) {
      const hoursAgo = Math.round(freshness.ageHours);
      return {
        requiresStaleAcknowledge: true,
        stalenessWarning: `Enrollment sheet last updated ${hoursAgo} hour${hoursAgo !== 1 ? "s" : ""} ago — confirm data is current before generating.`,
      };
    }
    if (freshness.isStale) {
      const hoursAgo = Math.round(freshness.ageHours);
      stalenessWarning = `Enrollment sheet last updated ${hoursAgo} hour${hoursAgo !== 1 ? "s" : ""} ago — data may be stale.`;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ApiError(
      503,
      `Failed to check enrollment sheet freshness: ${msg}. Check Google Sheets ID and Drive connection in Settings.`,
    );
  }

  // 2. Read enrollment data
  let enrollment: { enrolled: number; screened: number; screenFailures: number; withdrawals: number };
  try {
    enrollment = await readEnrollmentData(
      googleSheetsId,
      settings.googleSheetTab || "Sheet1",
      settings.googleSheetHeaderRow ?? 1,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ApiError(
      503,
      `Failed to read enrollment data from Google Sheets: ${msg}. Check sheet tab name and header row in Settings.`,
    );
  }

  // 3. Read Notion data
  const notionClient = await getNotionClient();
  const { readAeSummary, readDeviationSummary, readNextMilestone } = await import(
    "../lib/notionAeDeviation.js"
  );

  let aeSummary = { totalAe: 0, grade3PlusAe: 0 };
  let devSummary = { totalDeviations: 0, majorDeviations: 0 };
  let milestone = { nextMilestoneName: "N/A", nextMilestoneDate: "N/A" };

  let notionWarning: string | null = null;

  if (notionClient) {
    try {
      [aeSummary, devSummary, milestone] = await Promise.all([
        readAeSummary(notionClient, notionAeLogDbId ?? ""),
        readDeviationSummary(notionClient, notionDeviationLogDbId ?? ""),
        readNextMilestone(notionClient, notionRegulatoryDbId ?? ""),
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Notion is a soft dependency — report generates with zeros; surface warning only.
      notionWarning = msg.includes("shared with your integration")
        ? "Notion databases are not yet shared with the Replit integration — AE/deviation counts defaulted to 0. Share each DB with the 'Replit' integration in Notion, then regenerate."
        : `Notion data unavailable (${msg.slice(0, 150)}) — AE/deviation counts defaulted to 0.`;
      logger.warn({ err }, "Notion read failed — using zero fallbacks for AE/deviation/milestone");
    }
  }

  const reportDate = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  // 4. Copy template
  let docId: string;
  try {
    docId = await copyTemplate(googleDocsTemplateId, `Sponsor Report — ${reportDate}`);
  } catch (err) {
    throw new ApiError(
      503,
      "Failed to copy report template from Google Drive. Check template ID and Drive permissions.",
    );
  }

  // 5. Fill placeholders — hard error, deletes orphan on failure
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
    try { await deleteDoc(docId); } catch {}
    const msg = err instanceof Error ? err.message : String(err);
    throw new ApiError(
      503,
      `Failed to fill report template placeholders: ${msg}. Check Google Docs connection and template ID.`,
    );
  }

  // 6. Scan for unreplaced placeholders (non-fatal)
  let unreplacedPlaceholders: string[] = [];
  try {
    unreplacedPlaceholders = await scanForUnreplacedPlaceholders(docId);
  } catch (err) {
    logger.warn({ err }, "Could not scan for unreplaced placeholders");
  }

  // 7. Grant PI writer access — hard error, deletes orphan on failure
  try {
    await grantWriterAccess(docId, piEmail);
  } catch (err) {
    try { await deleteDoc(docId); } catch {}
    const msg = err instanceof Error ? err.message : String(err);
    throw new ApiError(
      503,
      `Failed to grant PI writer access on the report doc: ${msg}. Check Google Drive permissions and PI email address.`,
    );
  }

  const docUrl = buildDocUrl(docId);
  const report = await createReport({ docUrl, docId, unreplacedPlaceholders });

  // Merge staleness + notion warnings into a single warning string
  const combinedWarning = [stalenessWarning, notionWarning].filter(Boolean).join(" | ") || null;

  return { requiresStaleAcknowledge: false, report, stalenessWarning: combinedWarning };
}

// ─── Core send-to-PI logic (shared by /send-to-pi and /run-monthly) ──────────

async function performSendToPi(
  reportId: string,
  piEmail: string,
): Promise<{ report: SponsorReportRecord; composeUrl: string }> {
  const report = await getReport(reportId);
  if (!report) throw new ApiError(404, "Report not found");
  if (report.status !== "Draft") {
    throw new ApiError(409, `Report is in ${report.status} status — can only send Draft reports.`);
  }

  const { sendPiReviewEmail } = await import("../lib/gmail.js");
  const reportDate = new Date(report.generatedAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const composeUrl = await sendPiReviewEmail({ piEmail, docUrl: report.docUrl, reportDate });

  const updated = await updateReport(reportId, {
    status: "PI Review",
    sentToPiAt: new Date().toISOString(),
    lastNagAt: new Date().toISOString(),
  });
  if (!updated) throw new ApiError(404, "Report not found after update");
  return { report: updated, composeUrl };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

router.get("/reports", async (_req, res): Promise<void> => {
  const reports = await listReports();
  res.json(ListReportsResponse.parse(reports));
});

// POST /reports/run-monthly — 1-click: generate + send to PI in one call
router.post("/reports/run-monthly", async (req, res): Promise<void> => {
  const { acknowledgeStale = false } = (req.body ?? {}) as { acknowledgeStale?: boolean };

  const active = await getActiveReport();
  if (active) {
    const dateStr = new Date(active.generatedAt).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
    res.status(409).json({
      error: `Report from ${dateStr} is still in ${active.status} — finalize or discard before generating a new one.`,
    });
    return;
  }

  let genOutcome: GenerateOutcome;
  try {
    genOutcome = await performGenerate(acknowledgeStale);
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.httpStatus).json({ error: err.message });
    } else {
      res.status(500).json({ error: String(err) });
    }
    return;
  }

  if (genOutcome.requiresStaleAcknowledge) {
    res.json(
      RunMonthlyReportResponse.parse({
        requiresStaleAcknowledge: true,
        stalenessWarning: genOutcome.stalenessWarning,
      }),
    );
    return;
  }

  const settings = await getSettings();
  let sendResult: { report: SponsorReportRecord; composeUrl: string };
  try {
    sendResult = await performSendToPi(genOutcome.report.id, settings.piEmail!);
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.httpStatus).json({ error: err.message });
    } else {
      res.status(500).json({ error: String(err) });
    }
    return;
  }

  res.json({
    ...RunMonthlyReportResponse.parse({
      report: sendResult.report,
      stalenessWarning: genOutcome.stalenessWarning,
      requiresStaleAcknowledge: false,
      message: `Report moved to PI Review. Open Gmail to send the pre-filled email to ${settings.piEmail}.`,
    }),
    composeUrl: sendResult.composeUrl,
  });
});

// POST /reports/generate — step-by-step flow (manual path)
router.post("/reports/generate", async (req, res): Promise<void> => {
  const { acknowledgeStale = false } = (req.body ?? {}) as { acknowledgeStale?: boolean };

  const active = await getActiveReport();
  if (active) {
    const dateStr = new Date(active.generatedAt).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
    res.status(409).json({
      error: `Report from ${dateStr} is still in ${active.status} — finalize or discard before generating a new one.`,
    });
    return;
  }

  let outcome: GenerateOutcome;
  try {
    outcome = await performGenerate(acknowledgeStale);
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.httpStatus).json({ error: err.message });
    } else {
      res.status(500).json({ error: String(err) });
    }
    return;
  }

  if (outcome.requiresStaleAcknowledge) {
    res.json(
      GenerateReportResponse.parse({
        requiresStaleAcknowledge: true,
        stalenessWarning: outcome.stalenessWarning,
      }),
    );
    return;
  }

  res.json(
    GenerateReportResponse.parse({
      report: outcome.report,
      stalenessWarning: outcome.stalenessWarning,
      requiresStaleAcknowledge: false,
    }),
  );
});

// POST /reports/:reportId/send-to-pi
router.post("/reports/:reportId/send-to-pi", async (req, res): Promise<void> => {
  const { reportId } = req.params;
  const settings = await getSettings();

  if (!settings.piEmail) {
    res.status(503).json({ error: "PI email not configured. Set it in Settings." });
    return;
  }

  try {
    const { report, composeUrl } = await performSendToPi(reportId, settings.piEmail);
    res.json({ ...SendReportToPiResponse.parse(report), composeUrl });
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.httpStatus).json({ error: err.message });
    } else {
      res.status(500).json({ error: String(err) });
    }
  }
});

// POST /reports/:reportId/mark-approved
router.post("/reports/:reportId/mark-approved", async (req, res): Promise<void> => {
  const { reportId } = req.params;
  const report = await getReport(reportId);

  if (!report) { res.status(404).json({ error: "Report not found" }); return; }
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

// POST /reports/:reportId/mark-final
router.post("/reports/:reportId/mark-final", async (req, res): Promise<void> => {
  const { reportId } = req.params;
  const report = await getReport(reportId);

  if (!report) { res.status(404).json({ error: "Report not found" }); return; }
  if (report.status !== "Approved") {
    res.status(409).json({ error: `Report is in ${report.status} status — can only finalize Approved reports.` });
    return;
  }

  const settings = await getSettings();
  let calendarWarning: string | null = null;

  if (settings.sponsorCallEventId) {
    try {
      const { getUncachableGoogleCalendarClient } = await import("../lib/googleCalendarClient.js");
      const calendar = await getUncachableGoogleCalendarClient();
      const calId = settings.googleCalendarId || "primary";
      const event = await calendar.events.get({ calendarId: calId, eventId: settings.sponsorCallEventId });
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
      const msg = err instanceof Error ? err.message : String(err);
      calendarWarning = `Report finalized, but the sponsor call calendar event could not be updated: ${msg.slice(0, 200)}. You can manually add the report link to your calendar event.`;
      logger.warn({ err, reportId }, "Calendar patch failed during mark-final — proceeding to mark Sent anyway");
    }
  }

  const updated = await updateReport(reportId, { status: "Sent", finalizedAt: new Date().toISOString() });
  res.json({ ...MarkReportFinalResponse.parse(updated), calendarWarning });
});

// POST /reports/:reportId/discard
router.post("/reports/:reportId/discard", async (req, res): Promise<void> => {
  const { reportId } = req.params;
  const report = await getReport(reportId);

  if (!report) { res.status(404).json({ error: "Report not found" }); return; }
  if (report.status !== "Draft" && report.status !== "Approved" && report.status !== "PI Review") {
    res.status(409).json({ error: `Report is in ${report.status} status — only Draft, PI Review, or Approved reports can be discarded.` });
    return;
  }

  // Only delete the Google Doc for Draft reports.
  // PI Review and Approved reports were already shared with the PI — deleting the doc would break their access.
  if (report.status === "Draft") {
    try {
      const { deleteDoc } = await import("../lib/googleDocs.js");
      await deleteDoc(report.docId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(503).json({
        error: `Failed to delete the report document from Google Drive: ${msg}. Check Drive permissions and try again.`,
      });
      return;
    }
  }

  const updated = await updateReport(reportId, { status: "Discarded" });
  res.json(DiscardReportResponse.parse(updated));
});

// POST /internal/nag-check
router.post("/internal/nag-check", async (req, res): Promise<void> => {
  const nagSecret = process.env.NAG_SECRET;
  if (nagSecret) {
    const provided = req.headers["x-nag-secret"];
    if (provided !== nagSecret) {
      res.status(401).json({ error: "Unauthorized — missing or invalid X-Nag-Secret header." });
      return;
    }
  }

  const settings = await getSettings();
  const nagIntervalHours = settings.nagIntervalHours ?? 4;

  const reports = await listReports();
  const piReviewReports = reports.filter((r) => r.status === "PI Review");

  let nagsSent = 0;
  const errors: string[] = [];

  for (const report of piReviewReports) {
    const lastNagAt = report.lastNagAt ?? report.sentToPiAt ?? report.generatedAt;
    const elapsedHours = (Date.now() - new Date(lastNagAt).getTime()) / (1000 * 60 * 60);
    if (elapsedHours < nagIntervalHours) continue;

    const reportDate = new Date(report.generatedAt).toLocaleDateString("en-US", {
      month: "long", day: "numeric", year: "numeric",
    });

    try {
      if (!settings.piEmail) { errors.push(`Report ${report.id}: PI email not configured`); continue; }
      const { sendNagEmail } = await import("../lib/gmail.js");
      const nagComposeUrl = await sendNagEmail({ piEmail: settings.piEmail, docUrl: report.docUrl, reportDate, nagCount: 1 });
      logger.info({ reportId: report.id, nagComposeUrl }, "Nag compose URL generated");
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
