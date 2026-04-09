import Database from "@replit/database";
import { randomUUID } from "crypto";

const db = new Database();

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

  await db.set(reportKey(record.id), record);

  const existing = await db.get(REPORTS_INDEX_KEY);
  const ids: string[] = Array.isArray(existing) ? (existing as string[]) : [];
  if (!ids.includes(record.id)) {
    ids.push(record.id);
    await db.set(REPORTS_INDEX_KEY, ids);
  }

  return record;
}

export async function getReport(id: string): Promise<SponsorReportRecord | null> {
  const raw = await db.get(reportKey(id));
  if (!raw) return null;
  return raw as unknown as SponsorReportRecord;
}

export async function updateReport(
  id: string,
  patch: Partial<SponsorReportRecord>,
): Promise<SponsorReportRecord | null> {
  const existing = await getReport(id);
  if (!existing) return null;
  const updated: SponsorReportRecord = { ...existing, ...patch, id: existing.id };
  await db.set(reportKey(id), updated);
  return updated;
}

export async function listReports(): Promise<SponsorReportRecord[]> {
  const indexData = await db.get(REPORTS_INDEX_KEY);
  if (!indexData || !Array.isArray(indexData)) return [];

  const ids = indexData as string[];
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
