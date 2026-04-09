import { Router, type IRouter } from "express";
import { getSettings } from "../lib/settings.js";

const router: IRouter = Router();

router.get("/integrations/status", async (_req, res): Promise<void> => {
  const s = await getSettings();

  const notionBase = "https://notion.so";

  res.json({
    notion: {
      label: "Notion",
      connected: true,
      description: "Reads live clinical data across three databases",
      provides: [
        "AE counts & Grade 3+ adverse events",
        "Protocol deviation tracking",
        "Regulatory document expiry dates & next milestone",
      ],
      sources: [
        {
          name: "Regulatory DB",
          id: s.notionRegulatoryDbId,
          configured: !!s.notionRegulatoryDbId,
          url: s.notionRegulatoryDbId ? `${notionBase}/${s.notionRegulatoryDbId.replace(/-/g, "")}` : null,
        },
        {
          name: "AE Log",
          id: s.notionAeLogDbId,
          configured: !!s.notionAeLogDbId,
          url: s.notionAeLogDbId ? `${notionBase}/${s.notionAeLogDbId.replace(/-/g, "")}` : null,
        },
        {
          name: "Deviation Log",
          id: s.notionDeviationLogDbId,
          configured: !!s.notionDeviationLogDbId,
          url: s.notionDeviationLogDbId ? `${notionBase}/${s.notionDeviationLogDbId.replace(/-/g, "")}` : null,
        },
      ],
    },
    googleSheets: {
      label: "Google Sheets",
      connected: true,
      description: "Live enrollment data for the trial",
      provides: [
        "Patient enrollment counts",
        "Screen failures",
        "Protocol dropouts",
      ],
      sheetId: s.googleSheetsId,
      sheetTab: s.googleSheetTab,
      configured: !!s.googleSheetsId,
      url: s.googleSheetsId
        ? `https://docs.google.com/spreadsheets/d/${s.googleSheetsId}`
        : null,
    },
    googleDocs: {
      label: "Google Docs",
      connected: true,
      description: "Sponsor report template — copied and auto-filled per run",
      provides: [
        "Pre-formatted sponsor report",
        "Auto-filled placeholders (enrollment, AE, deviations, milestone)",
        "PI editable — shared with write access",
      ],
      templateId: s.googleDocsTemplateId,
      configured: !!s.googleDocsTemplateId,
      url: s.googleDocsTemplateId
        ? `https://docs.google.com/document/d/${s.googleDocsTemplateId}/edit`
        : null,
    },
    gmail: {
      label: "Gmail",
      connected: true,
      description: "Automated PI communications",
      provides: [
        `PI review email → ${s.piEmail || "PI"}`,
        "Auto-nag reminders if no response",
        `Sponsor final delivery → ${s.sponsorEmail || "Sponsor"}`,
      ],
      piEmail: s.piEmail,
      sponsorEmail: s.sponsorEmail,
      configured: !!s.piEmail,
    },
    googleCalendar: {
      label: "Google Calendar",
      connected: true,
      description: "Regulatory deadlines synced as calendar events",
      provides: [
        "Expiry reminders for regulatory documents",
        "Sponsor call events with agenda",
        "Timeline visible directly in Google Calendar",
      ],
      calendarId: s.googleCalendarId,
      configured: !!s.googleCalendarId,
      url: s.googleCalendarId
        ? `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(s.googleCalendarId)}`
        : null,
    },
  });
});

export default router;
