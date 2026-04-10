import Database from "@replit/database";
import { randomUUID } from "crypto";
import type { TrialData } from "./clinicalTrialsClient.js";

const db = new Database();

type DbResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

function unwrap<T>(result: DbResult<T>, label: string): T {
  if (!result.ok) throw new Error(`DB error (${label}): ${JSON.stringify((result as { ok: false; error: unknown }).error)}`);
  return (result as { ok: true; value: T }).value;
}

async function dbGet<T>(key: string): Promise<T | null> {
  const result = await (db as unknown as { get(k: string): Promise<DbResult<T | null>> }).get(key);
  if (!result.ok) {
    const errObj = result.error as Record<string, unknown> | null;
    if (errObj && typeof errObj === "object" && (errObj.statusCode === 404 || errObj.statusCode === "404")) {
      return null;
    }
    throw new Error(`DB error (get:${key}): ${JSON.stringify(result.error)}`);
  }
  return (result as { ok: true; value: T | null }).value;
}

async function dbSet(key: string, value: unknown): Promise<void> {
  const result = await (db as unknown as { set(k: string, v: unknown): Promise<DbResult<void>> }).set(key, value);
  unwrap(result, `set:${key}`);
}

async function dbDelete(key: string): Promise<void> {
  const result = await (db as unknown as { delete(k: string): Promise<DbResult<void>> }).delete(key);
  unwrap(result, `delete:${key}`);
}

const WATCHLIST_KEY = "watchlist:ncts";
const SNAPSHOT_PREFIX = "watchlist:snapshot:";
const ALERTS_INDEX_KEY = "watchlist:alerts:all";
const ALERT_PREFIX = "watchlist:alert:";

export interface TrialSnapshot {
  nctId: string;
  capturedAt: string;
  data: TrialData;
}

export type AlertStatus = "new" | "approved" | "dismissed";

export interface WatchlistAlert {
  id: string;
  nctId: string;
  studyTitle: string;
  sponsor: string;
  changeSummary: string;
  clinicalInterpretation: string;
  changedFields: string[];
  status: AlertStatus;
  createdAt: string;
  actedAt: string | null;
  docUrl: string | null;
  docId: string | null;
}

export async function getWatchlist(): Promise<string[]> {
  const list = await dbGet<string[]>(WATCHLIST_KEY);
  return Array.isArray(list) ? list : [];
}

export async function addToWatchlist(nctId: string): Promise<string[]> {
  const current = await getWatchlist();
  const normalized = nctId.trim().toUpperCase();
  if (!current.includes(normalized)) {
    current.push(normalized);
    await dbSet(WATCHLIST_KEY, current);
  }
  return current;
}

export async function removeFromWatchlist(nctId: string): Promise<string[]> {
  const current = await getWatchlist();
  const normalized = nctId.trim().toUpperCase();
  const updated = current.filter((id) => id !== normalized);
  await dbSet(WATCHLIST_KEY, updated);
  return updated;
}

export async function getSnapshot(nctId: string): Promise<TrialSnapshot | null> {
  return dbGet<TrialSnapshot>(`${SNAPSHOT_PREFIX}${nctId.toUpperCase()}`);
}

export async function saveSnapshot(nctId: string, data: TrialData): Promise<TrialSnapshot> {
  const snapshot: TrialSnapshot = {
    nctId: nctId.toUpperCase(),
    capturedAt: new Date().toISOString(),
    data,
  };
  await dbSet(`${SNAPSHOT_PREFIX}${nctId.toUpperCase()}`, snapshot);
  return snapshot;
}

export async function createAlert(
  data: Pick<WatchlistAlert, "nctId" | "studyTitle" | "sponsor" | "changeSummary" | "clinicalInterpretation" | "changedFields">,
): Promise<WatchlistAlert> {
  const alert: WatchlistAlert = {
    id: randomUUID(),
    ...data,
    status: "new",
    createdAt: new Date().toISOString(),
    actedAt: null,
    docUrl: null,
    docId: null,
  };
  await dbSet(`${ALERT_PREFIX}${alert.id}`, alert);

  const existing = await dbGet<string[]>(ALERTS_INDEX_KEY);
  const ids: string[] = Array.isArray(existing) ? existing : [];
  ids.push(alert.id);
  await dbSet(ALERTS_INDEX_KEY, ids);

  return alert;
}

export async function getAlert(id: string): Promise<WatchlistAlert | null> {
  return dbGet<WatchlistAlert>(`${ALERT_PREFIX}${id}`);
}

export async function updateAlert(id: string, patch: Partial<WatchlistAlert>): Promise<WatchlistAlert | null> {
  const existing = await getAlert(id);
  if (!existing) return null;
  const updated: WatchlistAlert = { ...existing, ...patch, id: existing.id };
  await dbSet(`${ALERT_PREFIX}${id}`, updated);
  return updated;
}

export async function listAlerts(): Promise<WatchlistAlert[]> {
  const ids = await dbGet<string[]>(ALERTS_INDEX_KEY);
  if (!ids || !Array.isArray(ids)) return [];

  const alerts: WatchlistAlert[] = [];
  for (const id of ids) {
    const alert = await getAlert(id);
    if (alert) alerts.push(alert);
  }

  alerts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return alerts;
}
