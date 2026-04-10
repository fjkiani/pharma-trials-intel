import Database from "@replit/database";

export type AuditActor =
  | "SWARM_INGESTION"
  | "ORCHESTRATOR"
  | "ZETA_CORE"
  | "SYSTEM"
  | "SUSAN";

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  nctId: string;
  actor: AuditActor;
  action: string;
  details: string;
}

const db = new Database();
const AUDIT_KEY = "audit:log";
const MAX_ENTRIES = 1000;

type DbResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

async function dbGet<T>(key: string): Promise<T | null> {
  const result = await (db as unknown as { get(k: string): Promise<DbResult<T | null>> }).get(key);
  if (!result.ok) return null;
  return (result as { ok: true; value: T | null }).value;
}

async function dbSet(key: string, value: unknown): Promise<void> {
  await (db as unknown as { set(k: string, v: unknown): Promise<DbResult<void>> }).set(key, value);
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function logAction(
  nctId: string,
  actor: AuditActor,
  action: string,
  details: string,
): Promise<void> {
  try {
    const raw = await dbGet<AuditLogEntry[]>(AUDIT_KEY);
    const existing: AuditLogEntry[] = Array.isArray(raw) ? raw : [];

    existing.push({
      id: makeId(),
      timestamp: new Date().toISOString(),
      nctId,
      actor,
      action,
      details,
    });

    await dbSet(AUDIT_KEY, existing.slice(-MAX_ENTRIES));
  } catch {
    // Never let audit failures surface to callers
  }
}

export async function getAuditLog(limit = 200): Promise<AuditLogEntry[]> {
  const raw = await dbGet<AuditLogEntry[]>(AUDIT_KEY);
  const entries: AuditLogEntry[] = Array.isArray(raw) ? raw : [];
  return entries.slice(-limit).reverse();
}

export async function clearAuditLog(): Promise<void> {
  await dbSet(AUDIT_KEY, []);
}
