import Database from "@replit/database";
import { randomUUID } from "crypto";

// @replit/database v3 wraps all results in {ok, value} / {ok, error}
// This helper unwraps that and throws on error.
const db = new Database();

type DbResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

function unwrap<T>(result: DbResult<T>, label: string): T {
  if (!result.ok) throw new Error(`DB error (${label}): ${JSON.stringify((result as { ok: false; error: unknown }).error)}`);
  return (result as { ok: true; value: T }).value;
}

async function dbGet<T>(key: string): Promise<T | null> {
  const result = await (db as unknown as { get(k: string): Promise<DbResult<T | null>> }).get(key);
  const val = unwrap(result, `get:${key}`);
  return val;
}

async function dbSet(key: string, value: unknown): Promise<void> {
  const result = await (db as unknown as { set(k: string, v: unknown): Promise<DbResult<void>> }).set(key, value);
  unwrap(result, `set:${key}`);
}

async function dbList(prefix: string): Promise<string[]> {
  const result = await (db as unknown as { list(p: string): Promise<DbResult<string[]>> }).list(prefix);
  return unwrap(result, `list:${prefix}`) ?? [];
}

export type ReportStatus = "Draft" | "PI Review" | "Approved" | "Sent" | "Discarded";

export interface SponsorReportRecord {
  id: string;
  docUrl: string;
  docId: string;
  status: ReportStatus;
  generatedAt: string;
  sentToPiAt: string | null;
  lastNagAt: string | null;
  approvedAt: string | null;
  finalizedAt: string | null;
  unreplacedPlaceholders: string[];
}

const REPORTS_INDEX_KEY = "reports:all";

function reportKey(id: string) {
  return `report:${id}`;
}

export async function createReport(
  data: Pick<SponsorReportRecord, "docUrl" | "docId" | "unreplacedPlaceholders">,
): Promise<SponsorReportRecord> {
  const record: SponsorReportRecord = {
    id: randomUUID(),
    docUrl: data.docUrl,
    docId: data.docId,
    status: "Draft",
    generatedAt: new Date().toISOString(),
    sentToPiAt: null,
    lastNagAt: null,
    approvedAt: null,
    finalizedAt: null,
    unreplacedPlaceholders: data.unreplacedPlaceholders,
  };

  await dbSet(reportKey(record.id), record);

  const existing = await dbGet<string[]>(REPORTS_INDEX_KEY);
  const ids: string[] = Array.isArray(existing) ? existing : [];
  if (!ids.includes(record.id)) {
    ids.push(record.id);
    await dbSet(REPORTS_INDEX_KEY, ids);
  }

  return record;
}

export async function getReport(id: string): Promise<SponsorReportRecord | null> {
  return dbGet<SponsorReportRecord>(reportKey(id));
}

export async function updateReport(
  id: string,
  patch: Partial<SponsorReportRecord>,
): Promise<SponsorReportRecord | null> {
  const existing = await getReport(id);
  if (!existing) return null;
  const updated: SponsorReportRecord = { ...existing, ...patch, id: existing.id };
  await dbSet(reportKey(id), updated);
  return updated;
}

export async function listReports(): Promise<SponsorReportRecord[]> {
  const ids = await dbGet<string[]>(REPORTS_INDEX_KEY);
  if (!ids || !Array.isArray(ids)) return [];

  const records: SponsorReportRecord[] = [];
  for (const id of ids) {
    const rec = await getReport(id);
    if (rec) records.push(rec);
  }

  records.sort(
    (a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime(),
  );

  return records;
}

export async function getActiveReport(): Promise<SponsorReportRecord | null> {
  const reports = await listReports();
  return (
    reports.find((r) => r.status === "PI Review" || r.status === "Approved") ?? null
  );
}
