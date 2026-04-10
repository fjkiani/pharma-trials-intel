import Database from "@replit/database";
import { randomUUID } from "crypto";

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
    const err = (result as { ok: false; error: unknown }).error as Record<
      string,
      unknown
    > | null;
    if (err && typeof err === "object" && err.statusCode === 404) return null;
    throw new Error(`DB error (get:${key}): ${JSON.stringify(err)}`);
  }
  return (result as { ok: true; value: T | null }).value;
}

async function dbSet(key: string, value: unknown): Promise<void> {
  const result = await (
    db as unknown as {
      set(k: string, v: unknown): Promise<DbResult<void>>;
    }
  ).set(key, value);
  unwrap(result, `set:${key}`);
}

export type BriefStatus =
  | "Draft"
  | "PI Review"
  | "Approved"
  | "Sent"
  | "Discarded";

export interface IntelligenceBriefRecord {
  id: string;
  docUrl: string;
  docId: string;
  status: BriefStatus;
  generatedAt: string;
  alertCount: number;
  alertIds: string[];
  sentToPiAt: string | null;
  lastNagAt: string | null;
  approvedAt: string | null;
  finalizedAt: string | null;
}

const BRIEFS_INDEX_KEY = "briefs:all";

function briefKey(id: string) {
  return `brief:${id}`;
}

export async function createBrief(
  data: Pick<
    IntelligenceBriefRecord,
    "docUrl" | "docId" | "alertCount" | "alertIds"
  >,
): Promise<IntelligenceBriefRecord> {
  const record: IntelligenceBriefRecord = {
    id: randomUUID(),
    ...data,
    status: "Draft",
    generatedAt: new Date().toISOString(),
    sentToPiAt: null,
    lastNagAt: null,
    approvedAt: null,
    finalizedAt: null,
  };
  await dbSet(briefKey(record.id), record);
  const existing = await dbGet<string[]>(BRIEFS_INDEX_KEY);
  const ids: string[] = Array.isArray(existing) ? existing : [];
  ids.push(record.id);
  await dbSet(BRIEFS_INDEX_KEY, ids);
  return record;
}

export async function getBrief(
  id: string,
): Promise<IntelligenceBriefRecord | null> {
  return dbGet<IntelligenceBriefRecord>(briefKey(id));
}

export async function updateBrief(
  id: string,
  patch: Partial<IntelligenceBriefRecord>,
): Promise<IntelligenceBriefRecord | null> {
  const existing = await getBrief(id);
  if (!existing) return null;
  const updated: IntelligenceBriefRecord = {
    ...existing,
    ...patch,
    id: existing.id,
  };
  await dbSet(briefKey(id), updated);
  return updated;
}

export async function listBriefs(): Promise<IntelligenceBriefRecord[]> {
  const ids = await dbGet<string[]>(BRIEFS_INDEX_KEY);
  if (!ids || !Array.isArray(ids)) return [];
  const records: IntelligenceBriefRecord[] = [];
  for (const id of ids) {
    const rec = await getBrief(id);
    if (rec) records.push(rec);
  }
  records.sort(
    (a, b) =>
      new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime(),
  );
  return records;
}
