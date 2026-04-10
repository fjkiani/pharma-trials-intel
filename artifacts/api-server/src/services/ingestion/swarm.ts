import Database from "@replit/database";
import { logger } from "../../lib/logger.js";
import { runKillChain } from "../exploitation/orchestrator.js";
import { logAction } from "../audit/logger.js";
import type { TriggeredAlert } from "../types.js";

const db = new Database();

type DbResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

function unwrap<T>(result: DbResult<T>, label: string): T {
  if (!result.ok)
    throw new Error(`DB error (${label}): ${JSON.stringify((result as { ok: false; error: unknown }).error)}`);
  return (result as { ok: true; value: T }).value;
}

async function dbGet<T>(key: string): Promise<T | null> {
  const result = await (db as unknown as { get(k: string): Promise<DbResult<T | null>> }).get(key);
  if (!result.ok) {
    const err = (result as { ok: false; error: unknown }).error as Record<string, unknown> | null;
    if (err && typeof err === "object" && err.statusCode === 404) {
      return null;
    }
    throw new Error(`DB error (get:${key}): ${JSON.stringify(err)}`);
  }
  return (result as { ok: true; value: T | null }).value;
}

async function dbSet(key: string, value: unknown): Promise<void> {
  const result = await (db as unknown as { set(k: string, v: unknown): Promise<DbResult<void>> }).set(key, value);
  unwrap(result, `set:${key}`);
}

function baselineKey(nctId: string) {
  return `trial:baseline:${nctId}`;
}

function currentKey(nctId: string) {
  return `trial:current:${nctId}`;
}

function alertsKey(nctId: string) {
  return `trial:alerts:${nctId}`;
}

interface TrialRecord {
  fetchedAt: string;
  [key: string]: unknown;
}

const SYNTHETIC_SENTINEL = "1970-01-01T00:00:00.000Z";

function buildSyntheticBaseline(currentRecord: TrialRecord): TrialRecord {
  const proto = currentRecord.protocolSection as Record<string, unknown> | undefined;
  const idModule = proto?.identificationModule ?? {};
  return {
    fetchedAt: SYNTHETIC_SENTINEL,
    protocolSection: {
      identificationModule: idModule,
      statusModule: { overallStatus: "" },
      designModule: {},
      outcomesModule: {},
    },
    hasResults: false,
    resultsSection: null,
  };
}

interface SwarmResult {
  processed: number;
  failed: number;
  alertsGenerated: number;
}

async function fetchTrials(nctIds: string[]): Promise<Map<string, unknown>> {
  const joined = nctIds.join(",");
  const url = `https://clinicaltrials.gov/api/v2/studies?query.id=${encodeURIComponent(joined)}&format=json`;

  logger.info({ url, count: nctIds.length }, "Fetching trials from ClinicalTrials.gov");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`ClinicalTrials.gov API error: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as { studies?: unknown[] };
  const studies: unknown[] = json.studies ?? [];

  const map = new Map<string, unknown>();
  for (const study of studies) {
    const s = study as Record<string, unknown>;
    const protocol = s.protocolSection as Record<string, unknown> | undefined;
    const idModule = protocol?.identificationModule as Record<string, unknown> | undefined;
    const nctId = idModule?.nctId as string | undefined;
    if (nctId) {
      map.set(nctId, study);
    }
  }

  return map;
}

export async function runSwarmIngestion(nctIds: string[]): Promise<SwarmResult> {
  const result: SwarmResult = { processed: 0, failed: 0, alertsGenerated: 0 };

  if (nctIds.length === 0) {
    return result;
  }

  await logAction(
    "",
    "SWARM_INGESTION",
    "POLL_START",
    `Polling ClinicalTrials.gov v2 API for ${nctIds.length} trial(s): ${nctIds.join(", ")}`,
  );

  let studyMap: Map<string, unknown>;
  try {
    studyMap = await fetchTrials(nctIds);
  } catch (err) {
    logger.error({ err }, "Failed to fetch trials from ClinicalTrials.gov — aborting swarm run");
    await logAction(
      "",
      "SWARM_INGESTION",
      "POLL_ERROR",
      `ClinicalTrials.gov fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    result.failed = nctIds.length;
    return result;
  }

  await logAction(
    "",
    "SWARM_INGESTION",
    "POLL_COMPLETE",
    `Scraped ${studyMap.size} trial(s) from ClinicalTrials.gov v2 API. Dispatching to kill-chain orchestrator.`,
  );

  const fetchedAt = new Date().toISOString();

  for (const nctId of nctIds) {
    try {
      const studyData = studyMap.get(nctId);
      if (!studyData) {
        logger.warn({ nctId }, "No study data returned from ClinicalTrials.gov for NCT ID");
        await logAction(nctId, "SWARM_INGESTION", "FETCH_MISS", `No study data returned from ClinicalTrials.gov for ${nctId}.`);
        result.failed++;
        continue;
      }

      const newRecord: TrialRecord = {
        ...(studyData as Record<string, unknown>),
        fetchedAt,
      };

      const existingBaseline = await dbGet<TrialRecord>(baselineKey(nctId));

      if (!existingBaseline) {
        const syntheticBaseline = buildSyntheticBaseline(newRecord);
        logger.info({ nctId }, "First fetch — running kill-chain against synthetic baseline");

        await logAction(
          nctId,
          "SWARM_INGESTION",
          "FIRST_FETCH",
          `First ingestion for ${nctId}. Storing baseline. Running kill-chain against synthetic sentinel to surface immediate signals.`,
        );

        await dbSet(baselineKey(nctId), newRecord);
        await dbSet(currentKey(nctId), newRecord);

        const firstAlerts: TriggeredAlert[] = await runKillChain(syntheticBaseline, newRecord, nctId);
        if (firstAlerts.length > 0) {
          await dbSet(alertsKey(nctId), firstAlerts);
          result.alertsGenerated += firstAlerts.length;
          logger.info({ nctId, alerts: firstAlerts.length }, "First-fetch kill-chain fired");
        }

        result.processed++;
        continue;
      }

      await logAction(
        nctId,
        "SWARM_INGESTION",
        "DELTA_CHECK",
        `Comparing new snapshot against stored baseline for ${nctId}. Dispatching to orchestrator.`,
      );

      const alerts: TriggeredAlert[] = await runKillChain(existingBaseline, newRecord, nctId);

      await dbSet(currentKey(nctId), newRecord);

      if (alerts.length > 0) {
        await dbSet(alertsKey(nctId), alerts);
        result.alertsGenerated += alerts.length;
      }

      result.processed++;

      logger.info({ nctId, alerts: alerts.length }, "Kill-chain complete");
    } catch (err) {
      logger.error({ nctId, err }, "Swarm ingestion failed for NCT ID");
      await logAction(nctId, "SWARM_INGESTION", "ERROR", `Processing error for ${nctId}: ${err instanceof Error ? err.message : String(err)}`);
      result.failed++;
    }
  }

  return result;
}
