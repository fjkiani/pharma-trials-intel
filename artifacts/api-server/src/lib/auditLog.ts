import Database from "@replit/database";

const db = new Database();
export const AUDIT_KEY = "app:audit-log";

export interface AuditEntry {
  timestamp: string;
  resource: string;
  action: "discovered" | "validated" | "confirmed" | "health-check-failed";
  result: string;
}

type DbResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

async function dbGet<T>(key: string): Promise<T | null> {
  const result = await (db as unknown as { get(k: string): Promise<DbResult<T | null>> }).get(key);
  if (!result.ok) return null;
  return (result as { ok: true; value: T | null }).value;
}

async function dbSet(key: string, value: unknown): Promise<void> {
  await (db as unknown as { set(k: string, v: unknown): Promise<DbResult<void>> }).set(key, value);
}

export async function appendAudit(entry: Omit<AuditEntry, "timestamp">): Promise<void> {
  const raw = await dbGet<AuditEntry[]>(AUDIT_KEY);
  const existing: AuditEntry[] = Array.isArray(raw) ? raw : [];
  existing.push({ ...entry, timestamp: new Date().toISOString() });
  await dbSet(AUDIT_KEY, existing.slice(-200));
}

export async function getAuditLog(limit = 50): Promise<AuditEntry[]> {
  const raw = await dbGet<AuditEntry[]>(AUDIT_KEY);
  const entries: AuditEntry[] = Array.isArray(raw) ? raw : [];
  return entries.slice(-limit).reverse();
}
