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

// GET /strike/feed/:nctId — full dossier for one trial
router.get("/strike/feed/:nctId", async (req, res): Promise<void> => {
  const { nctId } = req.params;
  try {
    const alerts = (await dbGet<TriggeredAlert[]>(`trial:alerts:${nctId}`)) ?? [];

    // Pull raw trial snapshot for enriched context
    const current = await dbGet<Record<string, unknown>>(`trial:current:${nctId}`);
    const baseline = await dbGet<Record<string, unknown>>(`trial:baseline:${nctId}`);

    let trialMeta: Record<string, unknown> = {};
    if (current) {
      const proto = current.protocolSection as Record<string, unknown> | undefined;
      const idMod = proto?.identificationModule as Record<string, unknown> | undefined;
      const statusMod = proto?.statusModule as Record<string, unknown> | undefined;
      const designMod = proto?.designModule as Record<string, unknown> | undefined;
      const outcomesMod = proto?.outcomesModule as Record<string, unknown> | undefined;
      const descMod = proto?.descriptionModule as Record<string, unknown> | undefined;
      const condsMod = proto?.conditionsModule as Record<string, unknown> | undefined;
      const sponsorMod = proto?.sponsorCollaboratorsModule as Record<string, unknown> | undefined;

      const enrollInfo = designMod?.enrollmentInfo as Record<string, unknown> | undefined;
      const primaryComp = statusMod?.primaryCompletionDateStruct as Record<string, unknown> | undefined;
      const phases = designMod?.phases as string[] | undefined;

      const primaryOutcomes = (outcomesMod?.primaryOutcomes as Array<Record<string, unknown>> | undefined) ?? [];
      const secondaryOutcomes = (outcomesMod?.secondaryOutcomes as Array<Record<string, unknown>> | undefined) ?? [];
      const conditions = (condsMod?.conditions as string[] | undefined) ?? [];
      const leadSponsor = sponsorMod?.leadSponsor as Record<string, unknown> | undefined;

      // Baseline values for diff display
      const bProto = baseline?.protocolSection as Record<string, unknown> | undefined;
      const bStatus = bProto?.statusModule as Record<string, unknown> | undefined;
      const bDesign = bProto?.designModule as Record<string, unknown> | undefined;
      const bEnroll = bDesign?.enrollmentInfo as Record<string, unknown> | undefined;
      const bPrimaryComp = bStatus?.primaryCompletionDateStruct as Record<string, unknown> | undefined;

      trialMeta = {
        nctId: idMod?.nctId ?? nctId,
        title: (idMod?.briefTitle ?? idMod?.officialTitle ?? nctId) as string,
        overallStatus: statusMod?.overallStatus ?? "UNKNOWN",
        whyStopped: statusMod?.whyStopped ?? null,
        primaryCompletionDate: primaryComp?.date ?? null,
        enrollmentCount: enrollInfo?.count ?? null,
        enrollmentType: enrollInfo?.type ?? null,
        phase: Array.isArray(phases) ? phases.join(", ") : "N/A",
        hasResults: current.hasResults ?? false,
        conditions,
        leadSponsor: leadSponsor?.name ?? "Unknown",
        briefSummary: descMod?.briefSummary ?? null,
        primaryOutcomes: primaryOutcomes.map((o) => ({
          measure: o.measure ?? "",
          timeFrame: o.timeFrame ?? "",
          description: o.description ?? null,
        })),
        secondaryOutcomes: secondaryOutcomes.slice(0, 5).map((o) => ({
          measure: o.measure ?? "",
          timeFrame: o.timeFrame ?? "",
        })),
        fetchedAt: current.fetchedAt ?? null,
        // Baseline values for diff comparisons
        baseline: baseline ? {
          overallStatus: bStatus?.overallStatus ?? null,
          primaryCompletionDate: bPrimaryComp?.date ?? null,
          enrollmentCount: bEnroll?.count ?? null,
        } : null,
      };
    }

    res.json({
      nctId,
      alerts: alerts.sort((a, b) => {
        const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
        return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
      }),
      trial: trialMeta,
    });
  } catch (err) {
    logger.error({ err, nctId }, "Failed to fetch dossier");
    res.status(500).json({ error: "Failed to fetch dossier" });
  }
});

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

// GET /strike/intelligence/:nctId
// Primary read path for the Target Dossier. Tries strike:intelligence:{nctId}
// first (ZetaCore-enriched), falls back to building from trial:alerts + trial:current.
router.get("/strike/intelligence/:nctId", async (req, res): Promise<void> => {
  const { nctId } = req.params;
  try {
    // Try ZetaCore-enriched record first
    const enriched = await dbGet<Record<string, unknown>>(`strike:intelligence:${nctId}`);
    if (enriched) {
      res.json(enriched);
      return;
    }

    // Fall back: build dossier from raw ingestion data
    const alerts = (await dbGet<TriggeredAlert[]>(`trial:alerts:${nctId}`)) ?? [];
    const current = await dbGet<Record<string, unknown>>(`trial:current:${nctId}`);
    const baseline = await dbGet<Record<string, unknown>>(`trial:baseline:${nctId}`);

    if (!current && alerts.length === 0) {
      res.status(404).json({
        error: `No intelligence record found for ${nctId}. Run a swarm poll first.`,
      });
      return;
    }

    // Extract trial metadata from the raw ClinicalTrials.gov snapshot
    const proto = (current?.protocolSection ?? {}) as Record<string, unknown>;
    const idMod = (proto.identificationModule ?? {}) as Record<string, unknown>;
    const statusMod = (proto.statusModule ?? {}) as Record<string, unknown>;
    const designMod = (proto.designModule ?? {}) as Record<string, unknown>;
    const outcomesMod = (proto.outcomesModule ?? {}) as Record<string, unknown>;
    const descMod = (proto.descriptionModule ?? {}) as Record<string, unknown>;
    const condsMod = (proto.conditionsModule ?? {}) as Record<string, unknown>;
    const sponsorMod = (proto.sponsorCollaboratorsModule ?? {}) as Record<string, unknown>;

    const enrollInfo = (designMod.enrollmentInfo ?? {}) as Record<string, unknown>;
    const primaryComp = (statusMod.primaryCompletionDateStruct ?? {}) as Record<string, unknown>;
    const phases = (designMod.phases ?? []) as string[];
    const leadSponsor = (sponsorMod.leadSponsor ?? {}) as Record<string, unknown>;
    const primaryOutcomes = (outcomesMod.primaryOutcomes ?? []) as Array<Record<string, unknown>>;
    const secondaryOutcomes = (outcomesMod.secondaryOutcomes ?? []) as Array<Record<string, unknown>>;
    const conditions = (condsMod.conditions ?? []) as string[];

    const bProto = (baseline?.protocolSection ?? {}) as Record<string, unknown>;
    const bStatus = (bProto.statusModule ?? {}) as Record<string, unknown>;
    const bDesign = (bProto.designModule ?? {}) as Record<string, unknown>;
    const bEnroll = (bDesign.enrollmentInfo ?? {}) as Record<string, unknown>;
    const bComp = (bStatus.primaryCompletionDateStruct ?? {}) as Record<string, unknown>;

    const sortedAlerts = [...alerts].sort((a, b) => {
      const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
    });

    res.json({
      nctId,
      source: "ingestion-fallback",
      trial: {
        nctId: (idMod.nctId ?? nctId) as string,
        title: ((idMod.briefTitle ?? idMod.officialTitle ?? nctId) as string),
        overallStatus: (statusMod.overallStatus ?? "UNKNOWN") as string,
        whyStopped: (statusMod.whyStopped ?? null) as string | null,
        primaryCompletionDate: (primaryComp.date ?? null) as string | null,
        enrollmentCount: (enrollInfo.count ?? null) as number | null,
        enrollmentType: (enrollInfo.type ?? null) as string | null,
        phase: phases.join(", ") || "N/A",
        hasResults: (current?.hasResults ?? false) as boolean,
        conditions,
        leadSponsor: (leadSponsor.name ?? "Unknown") as string,
        briefSummary: (descMod.briefSummary ?? null) as string | null,
        primaryOutcomes: primaryOutcomes.map((o) => ({
          measure: o.measure ?? "",
          timeFrame: o.timeFrame ?? "",
          description: o.description ?? null,
        })),
        secondaryOutcomes: secondaryOutcomes.slice(0, 5).map((o) => ({
          measure: o.measure ?? "",
          timeFrame: o.timeFrame ?? "",
        })),
        fetchedAt: (current?.fetchedAt ?? null) as string | null,
        baseline: baseline ? {
          overallStatus: (bStatus.overallStatus ?? null) as string | null,
          primaryCompletionDate: (bComp.date ?? null) as string | null,
          enrollmentCount: (bEnroll.count ?? null) as number | null,
        } : null,
      },
      alerts: sortedAlerts,
    });
  } catch (err) {
    logger.error({ err, nctId }, "Failed to fetch intelligence record");
    res.status(500).json({ error: "Failed to fetch intelligence record" });
  }
});

// GET /strike/status — aggregate dashboard summary
router.get("/strike/status", async (_req, res): Promise<void> => {
  try {
    const alertKeys = await dbList("trial:alerts:");
    const currentKeys = await dbList("trial:current:");

    const nctIds = [...new Set([
      ...alertKeys.map((k) => k.replace("trial:alerts:", "")),
      ...currentKeys.map((k) => k.replace("trial:current:", "")),
    ])];

    let totalAlerts = 0;
    let criticalAlerts = 0;
    let highAlerts = 0;
    let mediumAlerts = 0;
    let lowAlerts = 0;
    let lastPollAt: string | null = null;

    for (const key of alertKeys) {
      const alerts = (await dbGet<TriggeredAlert[]>(key)) ?? [];
      totalAlerts += alerts.length;
      for (const a of alerts) {
        if (a.severity === "critical") criticalAlerts++;
        else if (a.severity === "high") highAlerts++;
        else if (a.severity === "medium") mediumAlerts++;
        else lowAlerts++;
        if (!lastPollAt || a.detectedAt > lastPollAt) {
          lastPollAt = a.detectedAt;
        }
      }
    }

    res.json({
      trialsWatched: nctIds.length,
      trialNctIds: nctIds,
      totalAlerts,
      criticalAlerts,
      highAlerts,
      mediumAlerts,
      lowAlerts,
      lastPollAt,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch strike status");
    res.status(500).json({ error: "Failed to fetch strike status" });
  }
});

export default router;
