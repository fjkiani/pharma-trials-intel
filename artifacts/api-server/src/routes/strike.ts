import { Router, type IRouter } from "express";
import Database from "@replit/database";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const db = new Database();

type DbResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

function unwrap<T>(result: DbResult<T>, label: string): T {
  if (!result.ok)
    throw new Error(
      `DB error (${label}): ${JSON.stringify((result as { ok: false; error: unknown }).error)}`,
    );
  return (result as { ok: true; value: T }).value;
}

async function dbGet<T>(key: string): Promise<T | null> {
  const result = await (
    db as unknown as { get(k: string): Promise<DbResult<T | null>> }
  ).get(key);
  if (!result.ok) {
    const err = (result as { ok: false; error: unknown }).error;
    const statusCode = (err as { statusCode?: number })?.statusCode;
    if (statusCode === 404) return null;
    throw new Error(`DB error (get:${key}): ${JSON.stringify(err)}`);
  }
  return (result as { ok: true; value: T }).value;
}

async function dbList(prefix: string): Promise<string[]> {
  const result = await (
    db as unknown as { list(p: string): Promise<DbResult<string[]>> }
  ).list(prefix);
  return unwrap(result, `list:${prefix}`) ?? [];
}

async function dbSet(key: string, value: unknown): Promise<void> {
  const result = await (
    db as unknown as { set(k: string, v: unknown): Promise<DbResult<void>> }
  ).set(key, value);
  unwrap(result, `set:${key}`);
}

export interface TriggeredAlert {
  nctId: string;
  detectedAt: string;
  headline: string;
  detail: string;
  severity: "critical" | "high" | "medium" | "low";
}

// GET /strike/feed
router.get("/strike/feed", async (_req, res): Promise<void> => {
  try {
    const keys = await dbList("trial:alerts:");
    const allAlerts: TriggeredAlert[] = [];

    for (const key of keys) {
      const alerts = await dbGet<TriggeredAlert[]>(key);
      if (Array.isArray(alerts)) {
        allAlerts.push(...alerts);
      }
    }

    allAlerts.sort(
      (a, b) =>
        new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime(),
    );

    res.json({ alerts: allAlerts });
  } catch (err) {
    logger.error({ err }, "Failed to fetch strike feed");
    res.status(500).json({ error: "Failed to fetch strike feed" });
  }
});

// POST /internal/swarm-poll
router.post("/internal/swarm-poll", async (req, res): Promise<void> => {
  const nagSecret = process.env.NAG_SECRET;
  if (nagSecret) {
    const provided = req.headers["x-nag-secret"];
    if (provided !== nagSecret) {
      res
        .status(401)
        .json({ error: "Unauthorized — missing or invalid X-Nag-Secret header." });
      return;
    }
  }

  const { nctIds } = req.body as { nctIds?: string[] };
  if (!Array.isArray(nctIds) || nctIds.length === 0) {
    res.status(400).json({ error: "nctIds array is required" });
    return;
  }

  try {
    const generatedAlerts: TriggeredAlert[] = [];
    const now = new Date().toISOString();

    for (const nctId of nctIds) {
      const key = `trial:alerts:${nctId}`;
      const existing = (await dbGet<TriggeredAlert[]>(key)) ?? [];

      const newAlerts = await fetchAlertsForTrial(nctId, now);
      if (newAlerts.length > 0) {
        const merged = [...existing, ...newAlerts];
        await dbSet(key, merged);
        generatedAlerts.push(...newAlerts);
      }
    }

    logger.info(
      { nctIdsPolled: nctIds.length, alertsGenerated: generatedAlerts.length },
      "Swarm poll complete",
    );

    res.json({
      alertsGenerated: generatedAlerts.length,
      nctIdsPolled: nctIds.length,
    });
  } catch (err) {
    logger.error({ err }, "Swarm poll failed");
    res.status(500).json({ error: "Swarm poll failed" });
  }
});

async function fetchAlertsForTrial(
  nctId: string,
  detectedAt: string,
): Promise<TriggeredAlert[]> {
  try {
    const response = await fetch(
      `https://clinicaltrials.gov/api/v2/studies/${nctId}?format=json`,
      { signal: AbortSignal.timeout(10000) },
    );

    if (!response.ok) {
      logger.warn({ nctId, status: response.status }, "ClinicalTrials.gov API returned non-200");
      return [];
    }

    const data = (await response.json()) as {
      protocolSection?: {
        statusModule?: {
          overallStatus?: string;
          whyStopped?: string;
          startDateStruct?: { date?: string };
          primaryCompletionDateStruct?: { date?: string };
        };
        designModule?: {
          enrollmentInfo?: { count?: number; type?: string };
        };
        eligibilityModule?: {
          minimumAge?: string;
          maximumAge?: string;
        };
        outcomesModule?: {
          primaryOutcomes?: Array<{ measure?: string; timeFrame?: string }>;
        };
      };
      hasResults?: boolean;
    };

    const alerts: TriggeredAlert[] = [];
    const status = data?.protocolSection?.statusModule?.overallStatus ?? "";
    const whyStopped = data?.protocolSection?.statusModule?.whyStopped ?? "";
    const enrollment =
      data?.protocolSection?.designModule?.enrollmentInfo?.count;
    const enrollmentType =
      data?.protocolSection?.designModule?.enrollmentInfo?.type ?? "";
    const hasResults = data?.hasResults ?? false;

    if (
      status === "TERMINATED" ||
      status === "WITHDRAWN" ||
      status === "SUSPENDED"
    ) {
      alerts.push({
        nctId,
        detectedAt,
        headline: `Trial ${status.toLowerCase()} — ${whyStopped || "reason not specified"}`,
        detail: `${nctId} has been ${status.toLowerCase()}. ${whyStopped ? `Stated reason: "${whyStopped}".` : "No reason provided."} This may indicate safety concerns, enrollment challenges, or competitive repositioning.`,
        severity: "critical",
      });
    }

    if (
      status === "ACTIVE_NOT_RECRUITING" &&
      !hasResults &&
      enrollment !== undefined &&
      enrollment < 50
    ) {
      alerts.push({
        nctId,
        detectedAt,
        headline: `Low enrollment signal — trial active but not recruiting with ${enrollment} participants`,
        detail: `${nctId} is active but no longer recruiting with only ${enrollment} enrolled (${enrollmentType}). No results posted yet. This pattern may indicate enrollment bleed or protocol difficulties.`,
        severity: "medium",
      });
    }

    if (status === "RECRUITING" && enrollmentType === "ACTUAL" && enrollment !== undefined && enrollment > 0) {
      alerts.push({
        nctId,
        detectedAt,
        headline: `Competitor enrollment update — ${enrollment} actual participants enrolled`,
        detail: `${nctId} reports ${enrollment} actual participants enrolled, suggesting active recruitment velocity. Monitor for completion date acceleration.`,
        severity: "low",
      });
    }

    if (hasResults && status === "COMPLETED") {
      alerts.push({
        nctId,
        detectedAt,
        headline: `Results posted — trial completed with data available`,
        detail: `${nctId} has completed and posted results. Review primary outcome data for competitive intelligence on efficacy and safety profile.`,
        severity: "high",
      });
    }

    return alerts;
  } catch (err) {
    logger.warn({ nctId, err }, "Failed to fetch trial data from ClinicalTrials.gov");
    return [];
  }
}

export default router;
