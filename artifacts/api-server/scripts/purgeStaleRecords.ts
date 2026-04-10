/**
 * purgeStaleRecords.ts
 * One-time hygiene script. Deletes:
 *   - All strike:intelligence:* keys (pre-schema records)
 *   - trial:baseline:NCT03737643 (fake seeded baseline)
 *   - Any strike:intelligence:NCT01874353 specifically named in task spec
 *
 * Run once via: npx tsx scripts/purgeStaleRecords.ts
 */

const DB_URL = process.env.REPLIT_DB_URL;
if (!DB_URL) {
  console.error("REPLIT_DB_URL not set — run inside the Replit environment.");
  process.exit(1);
}

async function listKeys(prefix: string): Promise<string[]> {
  const res = await fetch(`${DB_URL}?prefix=${encodeURIComponent(prefix)}`);
  if (!res.ok) throw new Error(`List failed: ${res.status}`);
  const text = await res.text();
  return text.trim() ? text.trim().split("\n") : [];
}

async function deleteKey(key: string): Promise<void> {
  const res = await fetch(`${DB_URL}/${encodeURIComponent(key)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Delete failed for ${key}: ${res.status}`);
  }
}

async function main() {
  console.log("=== DB Hygiene — Purging Stale Records ===\n");

  // 1. Purge all strike:intelligence:* keys (pre-synthesizedMechanisms schema)
  const intelligenceKeys = await listKeys("strike:intelligence:");
  if (intelligenceKeys.length === 0) {
    console.log("✓ No strike:intelligence:* keys found — already clean.");
  } else {
    for (const key of intelligenceKeys) {
      await deleteKey(key);
      console.log(`  Deleted: ${key}`);
    }
    console.log(`✓ Purged ${intelligenceKeys.length} strike:intelligence:* record(s).`);
  }

  // 2. Explicit named purge from task spec
  await deleteKey("strike:intelligence:NCT01874353");
  console.log("✓ Ensured strike:intelligence:NCT01874353 is gone.");

  // 3. Purge fake seeded baseline
  await deleteKey("trial:baseline:NCT03737643");
  console.log("✓ Ensured trial:baseline:NCT03737643 is gone.");

  // 4. List remaining DB keys for confirmation
  const remaining = await listKeys("");
  console.log(`\n=== Remaining DB keys (${remaining.length}) ===`);
  for (const k of remaining) {
    console.log(`  ${k}`);
  }

  console.log("\n=== Purge complete. DB is clean. ===");
}

main().catch((err) => {
  console.error("Purge failed:", err);
  process.exit(1);
});
