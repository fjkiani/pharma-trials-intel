/**
 * Notion C2 Write-Back — Task 15A
 *
 * Two write paths:
 *   1. injectNotionBrief  — writes a full intelligence brief page into the
 *      Competitor Intelligence Notion DB (NOTION_COMPETITOR_DB_ID / settings.notionCompetitorDbId)
 *
 *   2. injectNotionTask   — for every unique CRITICAL or HIGH trial, creates an
 *      action-item row in the Tasks DB (NOTION_TASKS_DB_ID / settings.notionTasksDbId)
 *      with a due-date of today + 2 days.
 *
 * Both functions are fire-and-forget from the brief route — failures are logged
 * but never surface to the caller as HTTP errors.
 */

import { logger } from "./logger.js";
import type { NotionProxyClient } from "./notionClient.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function richText(content: string) {
  return [{ type: "text", text: { content } }];
}

function heading1(text: string) {
  return {
    object: "block",
    type: "heading_1",
    heading_1: { rich_text: richText(text) },
  };
}

function heading2(text: string) {
  return {
    object: "block",
    type: "heading_2",
    heading_2: { rich_text: richText(text) },
  };
}

function paragraph(text: string) {
  return {
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: richText(text) },
  };
}

function bullet(text: string) {
  return {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: { rich_text: richText(text) },
  };
}

function divider() {
  return { object: "block", type: "divider", divider: {} };
}

function isoDateOnly(d: Date): string {
  return d.toISOString().split("T")[0];
}

// ── Module-level vector/directive helpers (mirrors briefs.ts logic) ───────────

function deriveFailureVector(whyStopped: string | null, headline: string): string {
  const src = (whyStopped ?? headline ?? "").toLowerCase();
  if (src.includes("ctep") || src.includes("drug supply") || src.includes("supplied drug")) return "DRUG SUPPLY HALTED";
  if (src.includes("futility") || src.includes("efficacy")) return "FUTILITY — EFFICACY FAILED";
  if (src.includes("safety") || src.includes("adverse") || src.includes("toxicity")) return "SAFETY SIGNAL FORCED STOP";
  if (src.includes("enrollment") || src.includes("recruit")) return "ENROLLMENT COLLAPSE";
  if (src.includes("covid") || src.includes("pandemic")) return "EXTERNAL FORCE MAJEURE";
  if (src.includes("company") || src.includes("sponsor") || src.includes("decision") || src.includes("prematurely")) return "SPONSOR WITHDRAWAL";
  return "SPONSOR DECISION";
}

function deriveEvidenceTier(severity: string): string {
  if (severity === "critical") return "CONFIRMED";
  if (severity === "high") return "PROBABLE";
  if (severity === "medium") return "INSUFFICIENT";
  return "UNSCORED";
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TriggeredAlertForNotion {
  nctId: string;
  detectedAt: string;
  module: string;
  severity: "critical" | "high" | "medium" | "low";
  headline: string;
  detail: string;
  vector?: string;
}

export interface TrialMetaForNotion {
  nctId: string;
  studyTitle: string;
  sponsor: string;
  status: string;
  phase: string;
  whyStopped: string | null;
  primaryCompletion: string;
}

// ── 1. Intelligence DB sink ───────────────────────────────────────────────────

export async function injectNotionBrief(
  notion: NotionProxyClient,
  competitorDbId: string,
  alerts: TriggeredAlertForNotion[],
  trialMeta: Map<string, TrialMetaForNotion>,
  docUrl: string,
): Promise<string | null> {
  if (!competitorDbId) return null;

  const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...alerts].sort(
    (a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9),
  );

  const criticalCount = alerts.filter(a => a.severity === "critical").length;
  const highCount = alerts.filter(a => a.severity === "high").length;
  const nctIds = [...new Set(alerts.map(a => a.nctId))];
  const worstSeverity = sorted[0]?.severity ?? "medium";
  const dateLabel = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  // Page properties
  const properties: Record<string, unknown> = {
    Name: {
      title: richText(`Intelligence Brief — ${dateLabel}`),
    },
  };

  // Best-effort property injection — Notion will ignore unknown properties
  try {
    Object.assign(properties, {
      Severity: { select: { name: worstSeverity.toUpperCase() } },
      "Alert Count": { number: alerts.length },
      "Trials Scoped": { number: nctIds.length },
      "Google Doc": { url: docUrl },
      Date: { date: { start: isoDateOnly(new Date()) } },
      "Evidence Tier": { select: { name: deriveEvidenceTier(worstSeverity) } },
    });
  } catch {
    // Ignore — properties that don't exist in the DB are silently skipped by Notion
  }

  // Page body blocks
  const blocks: unknown[] = [
    heading1(`Competitor Intelligence Brief — ${dateLabel}`),
    paragraph(`Active Alerts: ${alerts.length}  (${criticalCount} CRITICAL / ${highCount} HIGH)  ·  Trials: ${nctIds.length}`),
    paragraph(`Google Doc: ${docUrl}`),
    divider(),
  ];

  // Group alerts by trial
  const byNct = new Map<string, TriggeredAlertForNotion[]>();
  for (const a of sorted) {
    if (!byNct.has(a.nctId)) byNct.set(a.nctId, []);
    byNct.get(a.nctId)!.push(a);
  }

  let idx = 0;
  for (const [nctId, trialAlerts] of byNct.entries()) {
    idx++;
    const meta = trialMeta.get(nctId);
    const title = meta?.studyTitle ?? nctId;
    const sponsor = meta?.sponsor ?? "Unknown";
    const status = meta?.status ?? "UNKNOWN";
    const phase = meta?.phase ?? "N/A";
    const whyStopped = meta?.whyStopped ?? null;
    const worstAlert = trialAlerts[0];
    const vector = status === "TERMINATED"
      ? deriveFailureVector(whyStopped, worstAlert.headline)
      : "ACTIVE SIGNAL";
    const evidenceTier = deriveEvidenceTier(worstAlert.severity);

    blocks.push(
      heading2(`Trial ${idx}: ${title}`),
      paragraph(`${nctId}  ·  ${sponsor}  ·  Phase ${phase}`),
      bullet(`Status: ${status}`),
      bullet(`Failure Vector: ${vector}`),
      bullet(`Zeta-Core Verdict: ${evidenceTier}`),
      bullet(`Primary Completion: ${meta?.primaryCompletion ?? "—"}`),
    );

    if (status === "TERMINATED" && whyStopped) {
      blocks.push(
        paragraph(`Smoking Gun: "${whyStopped}"`),
      );
    }

    blocks.push(paragraph(`Active Signals (${trialAlerts.length}):`));
    for (const a of trialAlerts) {
      const ts = new Date(a.detectedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      blocks.push(bullet(`[${a.severity.toUpperCase()}] ${a.module} — ${ts}: ${a.headline}`));
    }

    blocks.push(divider());
  }

  blocks.push(
    heading2("Next Steps"),
    bullet("Review all CRITICAL signals with PI before next site visit."),
    bullet("Benchmark terminated trial populations against ONCO-247 enrollment targets."),
    bullet("ResultsIntelligence signals: compare primary endpoints to ONCO-247 specs."),
    paragraph("Generated by Clinical Trials Co-Pilot — Signal Engine v2"),
  );

  // Notion API limits page body to 100 blocks per createPage call
  const CHUNK = 100;
  const firstChunk = blocks.slice(0, CHUNK);
  const rest = blocks.slice(CHUNK);

  try {
    const page = await notion.createPage(competitorDbId, properties, firstChunk);

    if (rest.length > 0 && page.id) {
      for (let i = 0; i < rest.length; i += CHUNK) {
        await notion.appendBlockChildren(page.id, rest.slice(i, i + CHUNK));
      }
    }

    logger.info({ pageId: page.id, alertCount: alerts.length }, "Notion competitor brief injected");
    return page.id;
  } catch (err) {
    logger.warn({ err }, "Notion injectNotionBrief failed — non-fatal, continuing");
    return null;
  }
}

// ── 2. Task delegation ────────────────────────────────────────────────────────

export async function injectNotionTask(
  notion: NotionProxyClient,
  tasksDbId: string,
  alert: TriggeredAlertForNotion,
  meta: TrialMetaForNotion | undefined,
  docUrl: string,
): Promise<string | null> {
  if (!tasksDbId) return null;
  if (alert.severity !== "critical" && alert.severity !== "high") return null;

  const drugName = meta?.studyTitle
    ? meta.studyTitle.split(" ").slice(0, 3).join(" ")
    : alert.nctId;

  const status = meta?.status ?? "UNKNOWN";
  const whyStopped = meta?.whyStopped ?? null;
  const vector = status === "TERMINATED"
    ? deriveFailureVector(whyStopped, alert.headline)
    : "ACTIVE SIGNAL";

  const taskTitle = `Review Competitor Anomaly: ${drugName} — ${vector}`;

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 2);

  const properties: Record<string, unknown> = {
    Name: { title: richText(taskTitle) },
  };

  try {
    Object.assign(properties, {
      "Due Date": { date: { start: isoDateOnly(dueDate) } },
      Priority: { select: { name: alert.severity === "critical" ? "High" : "Medium" } },
      Status: { status: { name: "Not started" } },
    });
  } catch {
    // Ignore — DB may use different property names
  }

  const bodyBlocks: unknown[] = [
    paragraph("The Strike Suite detected a critical competitor vulnerability. Review the linked intelligence brief and advise on protocol adjustments."),
    paragraph(`Trial: ${alert.nctId}  ·  ${meta?.studyTitle ?? "Unknown"}`),
    paragraph(`Signal: [${alert.severity.toUpperCase()}] ${alert.module}`),
    paragraph(`Headline: ${alert.headline}`),
    paragraph(`Failure Vector: ${vector}`),
    paragraph(`Zeta-Core Verdict: ${deriveEvidenceTier(alert.severity)}`),
    paragraph(`Intelligence Brief: ${docUrl}`),
    paragraph(`Detected: ${new Date(alert.detectedAt).toLocaleString("en-US")}`),
  ];

  if (status === "TERMINATED" && whyStopped) {
    bodyBlocks.push(paragraph(`Termination Reason: "${whyStopped}"`));
  }

  try {
    const page = await notion.createPage(tasksDbId, properties, bodyBlocks);
    logger.info({ pageId: page.id, nctId: alert.nctId, vector }, "Notion action task injected");
    return page.id;
  } catch (err) {
    logger.warn({ err, nctId: alert.nctId }, "Notion injectNotionTask failed — non-fatal");
    return null;
  }
}
