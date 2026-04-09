import { Router, type IRouter } from "express";
import {
  ListRegulatoryDocumentsResponse,
  GetRegulatorysummaryResponse,
  SyncRegulatoryCalendarResponse,
} from "@workspace/api-zod";
import { listRegulatoryDocuments } from "../lib/notion.js";
import { syncCalendarReminders } from "../lib/googleCalendar.js";
import { getSettings } from "../lib/settings.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

async function getNotionClient() {
  try {
    const { getUncachableNotionClient } = await import(
      "../lib/notionClient.js"
    );
    return getUncachableNotionClient();
  } catch {
    return null;
  }
}

async function getCalendarClient() {
  try {
    const { getUncachableGoogleCalendarClient } = await import(
      "../lib/googleCalendarClient.js"
    );
    return await getUncachableGoogleCalendarClient();
  } catch {
    return null;
  }
}

router.get("/regulatory/documents", async (req, res): Promise<void> => {
  const notionClient = await getNotionClient();

  if (!notionClient) {
    res.status(503).json({
      error: "Notion integration not connected. Please connect Notion in Settings.",
    });
    return;
  }

  const settings = await getSettings();
  if (!settings.notionRegulatoryDbId) {
    res.json([]);
    return;
  }

  let docs: Awaited<ReturnType<typeof listRegulatoryDocuments>> = [];
  try {
    docs = await listRegulatoryDocuments(notionClient);
  } catch (err) {
    logger.warn({ err }, "Notion query failed for documents — returning empty list");
    // Soft failure: return empty list so the page still renders
  }
  res.json(ListRegulatoryDocumentsResponse.parse(docs));

  getCalendarClient().then((calendarClient) => {
    if (!calendarClient) return;
    syncCalendarReminders(calendarClient, docs).then((result) => {
      if (result.eventsCreated > 0) {
        logger.info({ eventsCreated: result.eventsCreated }, "Auto-synced calendar reminders");
      }
    }).catch((err: unknown) => {
      logger.warn({ err }, "Auto calendar sync failed");
    });
  }).catch(() => {});
});

router.get("/regulatory/summary", async (req, res): Promise<void> => {
  const notionClient = await getNotionClient();

  if (!notionClient) {
    res.json(
      GetRegulatorysummaryResponse.parse({
        total: 0,
        current: 0,
        expiringSoon: 0,
        expired: 0,
        notionsConnected: false,
      }),
    );
    return;
  }

  const settings = await getSettings();
  if (!settings.notionRegulatoryDbId) {
    res.json(
      GetRegulatorysummaryResponse.parse({
        total: 0,
        current: 0,
        expiringSoon: 0,
        expired: 0,
        notionsConnected: true,
      }),
    );
    return;
  }

  let docs: Awaited<ReturnType<typeof listRegulatoryDocuments>> = [];
  try {
    docs = await listRegulatoryDocuments(notionClient);
  } catch (err) {
    logger.warn({ err }, "Notion query failed for summary — returning zero counts");
    // Soft failure: page still renders; user sees empty state not blocked page
  }
  const summary = {
    total: docs.length,
    current: docs.filter((d) => d.status === "Current").length,
    expiringSoon: docs.filter((d) => d.status === "Expiring Soon").length,
    expired: docs.filter((d) => d.status === "Expired").length,
    notionsConnected: true,
  };

  res.json(GetRegulatorysummaryResponse.parse(summary));
});

router.post("/regulatory/sync-calendar", async (req, res): Promise<void> => {
  const notionClient = await getNotionClient();
  const calendarClient = await getCalendarClient();

  if (!calendarClient) {
    res.status(503).json({
      error:
        "Google Calendar integration not connected. Please connect Google Calendar in Settings.",
    });
    return;
  }

  let docs: Awaited<ReturnType<typeof listRegulatoryDocuments>> = [];
  if (notionClient) {
    const settings = await getSettings();
    if (settings.notionRegulatoryDbId) {
      try {
        docs = await listRegulatoryDocuments(notionClient);
      } catch (err) {
        logger.warn({ err }, "Notion query failed during calendar sync — syncing with empty doc list");
      }
    }
  }

  const result = await syncCalendarReminders(calendarClient, docs);
  res.json(SyncRegulatoryCalendarResponse.parse(result));
});

export default router;
