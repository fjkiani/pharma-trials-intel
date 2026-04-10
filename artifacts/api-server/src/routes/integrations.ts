import { Router, type IRouter } from "express";
import { getSettings } from "../lib/settings.js";
import { getUncachableNotionClient } from "../lib/notionClient.js";
import { driveProxy } from "../lib/googleDriveClient.js";
import { getGoogleOAuth2Client } from "../lib/googleOAuthClient.js";
import { getUncachableGoogleCalendarClient } from "../lib/googleCalendarClient.js";
import { appendAudit } from "../lib/auditLog.js";

const router: IRouter = Router();

async function probeNotion(s: Awaited<ReturnType<typeof getSettings>>): Promise<{ connected: boolean; reason?: string }> {
  if (!s.notionAeLogDbId) return { connected: false, reason: "AE Log DB not configured" };
  try {
    const client = getUncachableNotionClient();
    const result = await client.queryDatabase(s.notionAeLogDbId, { page_size: 1 });
    if (result.results.length === 0) {
      return {
        connected: true,
        reason: "Notion: AE Log unreachable — database returned 0 records. Confirm it is shared with the Replit integration.",
      };
    }
    return { connected: true };
  } catch (e) {
    return { connected: false, reason: `Notion error: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}` };
  }
}

async function probeGoogleSheets(s: Awaited<ReturnType<typeof getSettings>>): Promise<{ connected: boolean; reason?: string }> {
  if (!s.googleSheetsId) return { connected: false, reason: "Google Sheets ID not configured" };
  try {
    const res = await driveProxy(`/drive/v3/files/${s.googleSheetsId}/export`, {
      params: { mimeType: "text/csv" },
    });
    if (!res.ok) {
      const text = await (res as Response).text();
      return { connected: false, reason: `Sheets export failed (${res.status}): ${text.slice(0, 120)}` };
    }
    return { connected: true };
  } catch (e) {
    return { connected: false, reason: `Sheets error: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}` };
  }
}

async function probeGoogleDocs(s: Awaited<ReturnType<typeof getSettings>>): Promise<{ connected: boolean; reason?: string }> {
  if (!s.googleDocsTemplateId) return { connected: false, reason: "Google Docs template ID not configured" };
  try {
    const res = await driveProxy(`/drive/v3/files/${s.googleDocsTemplateId}`, {
      params: { fields: "id,name" },
    });
    if (!res.ok) {
      const text = await (res as Response).text();
      return { connected: false, reason: `Docs (via Drive) file check failed (${res.status}): ${text.slice(0, 120)}` };
    }
    return { connected: true, reason: "Routes through google-drive connector by design (Docs connector has no configured connection)." };
  } catch (e) {
    return { connected: false, reason: `Docs error: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}` };
  }
}

async function probeGmail(): Promise<{ connected: boolean; reason?: string }> {
  try {
    const { google } = await import("googleapis");
    const auth = await getGoogleOAuth2Client("google-mail");
    const gmail = google.gmail({ version: "v1", auth });
    const profile = await gmail.users.getProfile({ userId: "me" });
    if (!profile.data.emailAddress) return { connected: false, reason: "Gmail profile returned no email address" };
    return { connected: true };
  } catch (e) {
    return { connected: false, reason: `Gmail error: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}` };
  }
}

async function probeGoogleCalendar(s: Awaited<ReturnType<typeof getSettings>>): Promise<{ connected: boolean; reason?: string }> {
  try {
    const cal = await getUncachableGoogleCalendarClient();
    const calId = s.googleCalendarId || "primary";
    await cal.calendarList.list({ maxResults: 1 });
    return { connected: true };
  } catch (e) {
    return { connected: false, reason: `Calendar error: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}` };
  }
}

router.get("/integrations/status", async (_req, res): Promise<void> => {
  const s = await getSettings();
  const notionBase = "https://notion.so";

  const [notionProbe, sheetsProbe, docsProbe, gmailProbe, calProbe] = await Promise.all([
    probeNotion(s),
    probeGoogleSheets(s),
    probeGoogleDocs(s),
    probeGmail(),
    probeGoogleCalendar(s),
  ]);

  // Audit health-check failures (fire-and-forget, non-blocking)
  const probeResults: Array<{ name: string; probe: { connected: boolean; reason?: string } }> = [
    { name: "Notion", probe: notionProbe },
    { name: "Google Sheets", probe: sheetsProbe },
    { name: "Google Docs", probe: docsProbe },
    { name: "Gmail", probe: gmailProbe },
    { name: "Google Calendar", probe: calProbe },
  ];
  for (const { name, probe } of probeResults) {
    if (!probe.connected) {
      appendAudit({
        resource: name,
        action: "health-check-failed",
        result: probe.reason ?? "Connection failed",
      }).catch(() => {});
    }
  }

  res.json({
    notion: {
      label: "Notion",
      connected: notionProbe.connected,
      degraded: notionProbe.connected && !!notionProbe.reason,
      statusReason: notionProbe.reason ?? null,
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
      connected: sheetsProbe.connected,
      degraded: false,
      statusReason: sheetsProbe.reason ?? null,
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
      connected: docsProbe.connected,
      degraded: false,
      statusReason: docsProbe.reason ?? null,
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
      connected: gmailProbe.connected,
      degraded: false,
      statusReason: gmailProbe.reason ?? null,
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
      connected: calProbe.connected,
      degraded: false,
      statusReason: calProbe.reason ?? null,
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
