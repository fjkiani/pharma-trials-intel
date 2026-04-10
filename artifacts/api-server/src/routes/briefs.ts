import { Router } from "express";
import Database from "@replit/database";
import { logger } from "../lib/logger.js";
import { logAction } from "../services/audit/logger.js";
import {
  createBrief,
  getBrief,
  updateBrief,
  listBriefs,
} from "../lib/briefHistory.js";
import { getSettings } from "../lib/settings.js";
import { formatIntelligencePayload } from "../services/delivery/formatter.js";
import { writeIntelligenceToNotion, injectNotionTask } from "../services/delivery/notionSink.js";

// ── Helpers (mirrors frontend dossier logic) ─────────────────────────────────

function deriveFailureVector(whyStopped: string | null, headline: string): string {
  const src = (whyStopped ?? headline ?? "").toLowerCase();
  if (src.includes("ctep") || src.includes("drug supply") || src.includes("supplied drug")) return "DRUG SUPPLY HALTED";
  if (src.includes("futility") || src.includes("efficacy")) return "FUTILITY — EFFICACY FAILED";
  if (src.includes("safety") || src.includes("adverse") || src.includes("toxicity")) return "SAFETY SIGNAL FORCED STOP";
  if (src.includes("enrollment") || src.includes("recruit")) return "ENROLLMENT COLLAPSE";
  if (src.includes("covid") || src.includes("pandemic")) return "EXTERNAL FORCE MAJEURE";
  if (src.includes("company") || src.includes("sponsor") || src.includes("decision") || src.includes("prematurely")) return "SPONSOR WITHDRAWAL";
  if (src.includes("partner") || src.includes("collaborat")) return "PARTNER BAILOUT";
  return "SPONSOR DECISION";
}

function deriveEvidenceTier(severity: string): string {
  if (severity === "critical") return "CONFIRMED";
  if (severity === "high") return "PROBABLE";
  if (severity === "medium") return "INSUFFICIENT";
  return "UNSCORED";
}

function deriveClinicalDirective(module: string): string {
  if (module === "TerminationDetector") return "Debrief PI immediately. Evaluate whether this termination creates a positioning gap or enrollment opportunity for ONCO-247.";
  if (module === "ResultsIntelligence") return "Pull primary and secondary outcome data from the registry. Benchmark efficacy and AE profiles against ONCO-247's current targets.";
  if (module === "ToxicityCamouflage") return "Extract AE grade distribution. Identify whether the competitor's safety profile creates a differentiation advantage for ONCO-247.";
  if (module === "EnrollmentBleed") return "Track enrollment velocity. If bleed is accelerating, assess risk of ONCO-247 competing for the same site network.";
  return "Review the full signal chain before the next PI sync.";
}

const MODULE_LABEL: Record<string, string> = {
  TerminationDetector: "Termination Detector",
  ResultsIntelligence: "Results Intelligence",
  ToxicityCamouflage: "Toxicity Camouflage",
  EnrollmentBleed: "Enrollment Bleed",
  TimelineShift: "Timeline Shift",
  StatusTransition: "Status Transition",
};

type DbResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

const _db = new Database();

async function dbGet<T>(key: string): Promise<T | null> {
  const result = await (_db as unknown as { get(k: string): Promise<DbResult<T | null>> }).get(key);
  if (!result.ok) {
    const statusCode = ((result as { ok: false; error: unknown }).error as { statusCode?: number })?.statusCode;
    if (statusCode === 404) return null;
    throw new Error(`DB error (get:${key})`);
  }
  return (result as { ok: true; value: T | null }).value;
}

async function dbList(prefix: string): Promise<string[]> {
  const result = await (_db as unknown as { list(p: string): Promise<DbResult<string[]>> }).list(prefix);
  if (!result.ok) return [];
  return (result as { ok: true; value: string[] }).value ?? [];
}

interface TriggeredAlert {
  nctId: string;
  detectedAt: string;
  module: string;
  severity: "critical" | "high" | "medium" | "low";
  headline: string;
  detail: string;
}

async function listKillChainAlerts(): Promise<TriggeredAlert[]> {
  const keys = await dbList("trial:alerts:");
  const all: TriggeredAlert[] = [];
  for (const key of keys) {
    const alerts = await dbGet<TriggeredAlert[]>(key);
    if (Array.isArray(alerts)) all.push(...alerts);
  }
  return all.sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime());
}

// Resolves PMIDs for a trial: first checks stored snapshot, then fetches live.
async function resolveTrialPmids(nctId: string, storedSnap: TrialSnapshot | null): Promise<string[]> {
  interface RefEntry { pmid?: string; type?: string }
  interface RefsModule { references?: RefEntry[] }

  // Check stored data first
  const storedRefs = (storedSnap?.protocolSection as Record<string, unknown> | undefined)
    ?.referencesModule as RefsModule | undefined;

  if (storedRefs?.references?.length) {
    return storedRefs.references
      .map(r => r.pmid)
      .filter((p): p is string => !!p);
  }

  // Live fetch — only request ReferencesModule to keep it fast
  try {
    const res = await fetch(
      `https://clinicaltrials.gov/api/v2/studies/${nctId}?fields=ReferencesModule`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { protocolSection?: { referencesModule?: RefsModule } };
    return (data.protocolSection?.referencesModule?.references ?? [])
      .map(r => r.pmid)
      .filter((p): p is string => !!p);
  } catch {
    return [];
  }
}

const router = Router();

class ApiError extends Error {
  constructor(
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function handleError(
  err: unknown,
  res: Parameters<Parameters<typeof router.get>[1]>[1],
): void {
  if (err instanceof ApiError) {
    res.status(err.httpStatus).json({ error: err.message });
  } else {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Briefs route error");
    res.status(500).json({ error: msg });
  }
}

interface TrialSnapshot {
  protocolSection?: {
    identificationModule?: { briefTitle?: string; officialTitle?: string };
    statusModule?: { overallStatus?: string; whyStopped?: string; primaryCompletionDateStruct?: { date?: string } };
    sponsorCollaboratorsModule?: { leadSponsor?: { name?: string } };
    designModule?: { phases?: string[] };
    eligibilityModule?: { maximumAge?: string; minimumAge?: string };
  };
}

async function buildBriefDocContent(alerts: TriggeredAlert[]): Promise<string> {
  const now = new Date().toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });

  const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...alerts].sort(
    (a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9),
  );

  // Group by NCT ID (in order of worst severity first)
  const byNct = new Map<string, TriggeredAlert[]>();
  for (const a of sorted) {
    if (!byNct.has(a.nctId)) byNct.set(a.nctId, []);
    byNct.get(a.nctId)!.push(a);
  }

  // Fetch trial metadata from DB for each NCT ID
  const meta = new Map<string, TrialSnapshot | null>();
  for (const nctId of byNct.keys()) {
    const snap = await dbGet<TrialSnapshot>(`trial:current:${nctId}`);
    meta.set(nctId, snap);
  }

  const criticalCount = alerts.filter(a => a.severity === "critical").length;
  const highCount = alerts.filter(a => a.severity === "high").length;
  const nctCount = byNct.size;

  // Build each trial section
  const sections: string[] = [];
  let trialIdx = 0;

  for (const [nctId, trialAlerts] of byNct.entries()) {
    trialIdx++;
    const snap = meta.get(nctId);
    const ps = snap?.protocolSection;
    const title = ps?.identificationModule?.briefTitle ?? ps?.identificationModule?.officialTitle ?? nctId;
    const sponsor = ps?.sponsorCollaboratorsModule?.leadSponsor?.name ?? "Unknown Sponsor";
    const status = ps?.statusModule?.overallStatus ?? "UNKNOWN";
    const phase = (ps?.designModule?.phases ?? []).join("/") || "N/A";
    const whyStopped = ps?.statusModule?.whyStopped ?? null;
    const primaryCompletion = ps?.statusModule?.primaryCompletionDateStruct?.date ?? "—";

    // Worst signal for this trial
    const worst = trialAlerts[0];
    const failureVector = status === "TERMINATED" ? deriveFailureVector(whyStopped, worst.headline) : "N/A — ACTIVE SIGNAL";
    const evidenceTier = deriveEvidenceTier(worst.severity);
    const worstSeverity = worst.severity.toUpperCase();

    let section = `${"━".repeat(60)}
TRIAL ${trialIdx} OF ${nctCount}  ·  ${worstSeverity} PRIORITY
${"━".repeat(60)}

${title}
${nctId}  ·  ${sponsor}  ·  Phase ${phase}

STATUS             │  FAILURE VECTOR            │  ZETA-CORE VERDICT
${status.padEnd(18)} │  ${failureVector.padEnd(26)} │  ${evidenceTier}

Primary Completion: ${primaryCompletion}
`;

    // Smoking Gun: only for terminations with a reason
    if (status === "TERMINATED" && whyStopped) {
      section += `
SMOKING GUN
"${whyStopped}"
`;
    }

    // All signals for this trial
    section += `
ACTIVE SIGNALS (${trialAlerts.length})
`;
    for (const a of trialAlerts) {
      const moduleLabel = MODULE_LABEL[a.module] ?? a.module;
      const ts = new Date(a.detectedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      section += `
  [${a.severity.toUpperCase()}]  ${moduleLabel}
  Detected: ${ts}
  ${a.headline}
  ${a.detail}
`;
    }

    // Clinical Directive — based on worst module
    const directive = deriveClinicalDirective(worst.module);
    section += `
CLINICAL DIRECTIVE
→ ${directive}
`;

    sections.push(section);
  }

  return `COMPETITOR INTELLIGENCE BRIEFING
${"═".repeat(60)}
Generated:    ${now}
ONCO-247 — CRC Trial  ·  Susan Chen, CRC
Active Alerts: ${alerts.length}  (${criticalCount} CRITICAL  /  ${highCount} HIGH)
Trials In Scope: ${nctCount}
${"═".repeat(60)}

${sections.join("\n")}

${"═".repeat(60)}
STRATEGIC NEXT STEPS

Review each CRITICAL signal with your PI before the next site
visit. Prioritise terminated trials — map their patient
populations against ONCO-247 enrollment targets. ResultsIntelligence
signals should be benchmarked against our primary endpoint specs.

[PI to sign off and return to Susan Chen, CRC — ONCO-247]
${"═".repeat(60)}

Generated by Clinical Trials Co-Pilot — Signal Engine v2
Competitor Intelligence Track  ·  ONCO-247`;
}


router.get("/briefs", async (_req, res): Promise<void> => {
  try {
    const briefs = await listBriefs();
    res.json(briefs);
  } catch (err) {
    handleError(err, res);
  }
});

router.post(["/briefs", "/internal/draft-memo"], async (_req, res): Promise<void> => {
  try {
    const activeAlerts = await listKillChainAlerts();

    if (activeAlerts.length === 0) {
      throw new ApiError(
        409,
        "No active alerts to brief on. Use Refresh Swarm to scan competitor trials first.",
      );
    }

    // ── 1. Resolve trial metadata for all NCT IDs ─────────────────────────────

    const uniqueNctIds = [...new Set(activeAlerts.map((a) => a.nctId))];

    interface TrialMetaRow {
      nctId: string;
      studyTitle: string;
      sponsor: string;
      status: string;
      phase: string;
      whyStopped: string | null;
      primaryCompletion: string;
    }

    const trialMeta = new Map<string, TrialMetaRow>();
    const trialSnaps = new Map<string, TrialSnapshot | null>();

    for (const nctId of uniqueNctIds) {
      const snap = await dbGet<TrialSnapshot>(`trial:current:${nctId}`);
      trialSnaps.set(nctId, snap);
      const ps = snap?.protocolSection;
      trialMeta.set(nctId, {
        nctId,
        studyTitle: ps?.identificationModule?.briefTitle ?? ps?.identificationModule?.officialTitle ?? nctId,
        sponsor: ps?.sponsorCollaboratorsModule?.leadSponsor?.name ?? "Unknown",
        status: ps?.statusModule?.overallStatus ?? "UNKNOWN",
        phase: (ps?.designModule?.phases ?? []).join("/") || "N/A",
        whyStopped: ps?.statusModule?.whyStopped ?? null,
        primaryCompletion: ps?.statusModule?.primaryCompletionDateStruct?.date ?? "—",
      });
    }

    // Resolve PMIDs for all trials in parallel (live fetch where not cached)
    const trialPmids = new Map<string, string[]>();
    await Promise.all(
      uniqueNctIds.map(async (nctId) => {
        const pmids = await resolveTrialPmids(nctId, trialSnaps.get(nctId) ?? null);
        trialPmids.set(nctId, pmids);
      }),
    );

    // ── 2. Create the Google Drive file (get docId / URL early) ──────────────

    const docTitle = `Competitor Intelligence Brief — ${new Date().toLocaleDateString("en-US")}`;
    const { ReplitConnectors } = await import("@replit/connectors-sdk");
    const connectors = new ReplitConnectors();

    const createRes = (await connectors.proxy(
      "google-drive",
      "/drive/v3/files",
      {
        method: "POST",
        body: JSON.stringify({
          name: docTitle,
          mimeType: "application/vnd.google-apps.document",
        }),
        headers: { "Content-Type": "application/json" },
      },
    )) as unknown as Response;

    if (!createRes.ok) {
      const text = await (createRes as Response).text();
      throw new ApiError(503, `Failed to create Google Doc: ${text.slice(0, 300)}`);
    }

    const created = (await (createRes as Response).json()) as { id?: string };
    if (!created.id) throw new ApiError(503, "Drive API returned no file ID");

    const docId = created.id;
    const docUrl = `https://docs.google.com/document/d/${docId}/edit`;

    // ── 3. Run formatter on worst signal per trial ────────────────────────────

    const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const sortedAlerts = [...activeAlerts].sort(
      (a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9),
    );

    const formattedAlerts = sortedAlerts.map((alert) => {
      const meta = trialMeta.get(alert.nctId);
      const pmids = trialPmids.get(alert.nctId) ?? [];
      return formatIntelligencePayload(
        {
          nctId: alert.nctId,
          module: alert.module,
          severity: alert.severity,
          headline: alert.headline,
          detail: alert.detail,
          detectedAt: alert.detectedAt,
        },
        {
          studyTitle: meta?.studyTitle ?? alert.nctId,
          sponsor: meta?.sponsor ?? "Unknown Sponsor",
          status: meta?.status ?? "UNKNOWN",
          whyStopped: meta?.whyStopped ?? null,
          primaryCompletion: meta?.primaryCompletion ?? "—",
          phase: meta?.phase ?? "N/A",
        },
        pmids,
      );
    });

    // ── 4. Notion C2 write-backs (BEFORE Google Doc content) ─────────────────

    (async () => {
      try {
        const settings = await getSettings();
        // Merge env vars with settings — env vars take precedence
        if (!process.env.NOTION_COMPETITOR_DB_ID && settings.notionCompetitorDbId)
          process.env.NOTION_COMPETITOR_DB_ID = settings.notionCompetitorDbId;
        if (!process.env.NOTION_TASKS_DB_ID && settings.notionTasksDbId)
          process.env.NOTION_TASKS_DB_ID = settings.notionTasksDbId;

        // Intelligence page — one per unique trial (worst signal)
        const seenForBrief = new Set<string>();
        for (const formatted of formattedAlerts) {
          if (seenForBrief.has(formatted.nctId)) continue;
          seenForBrief.add(formatted.nctId);
          const alert = sortedAlerts.find(a => a.nctId === formatted.nctId)!;
          await writeIntelligenceToNotion(formatted, alert.severity);
        }

        // Action tasks — one per trial, critical/high only
        const seenForTask = new Set<string>();
        for (const formatted of formattedAlerts) {
          const alert = sortedAlerts.find(a => a.nctId === formatted.nctId)!;
          if (alert.severity !== "critical" && alert.severity !== "high") continue;
          if (seenForTask.has(formatted.nctId)) continue;
          seenForTask.add(formatted.nctId);
          await injectNotionTask(
            formatted.drugName,
            formatted.vector,
            formatted.nctId,
            formatted.directive,
            docUrl,
            alert.severity,
          );
        }

        const taskCount = seenForTask.size;
        const briefCount = seenForBrief.size;
        const nctIds = uniqueNctIds.join(", ");
        await logAction(
          nctIds,
          "SYSTEM",
          "BRIEF_DRAFTED",
          `Notion C2 write-back: ${briefCount} intelligence page(s) and ${taskCount} action task(s) injected. Competitor DB + Tasks DB targeted.`,
        );
      } catch (notionErr) {
        logger.warn({ notionErr }, "Notion C2 write-back failed — non-fatal, brief already saved");
      }
    })();

    // ── 5. Write formatted content to Google Doc ──────────────────────────────

    const docContent = await buildBriefDocContent(activeAlerts);

    try {
      const { getGoogleOAuth2Client } = await import("../lib/googleOAuthClient.js");
      const { google } = await import("googleapis");
      const auth = await getGoogleOAuth2Client("google-drive");
      const docs = google.docs({ version: "v1", auth });

      await docs.documents.batchUpdate({
        documentId: docId,
        requestBody: {
          requests: [
            {
              insertText: {
                location: { index: 1 },
                text: docContent,
              },
            },
          ],
        },
      });
    } catch (writeErr) {
      logger.error({ writeErr, docId }, "Failed to write content to brief doc — doc created but empty");
      throw new ApiError(
        503,
        `Document created but content could not be written: ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`,
      );
    }

    // ── 6. Persist brief record ───────────────────────────────────────────────

    const brief = await createBrief({
      docUrl,
      docId,
      alertCount: activeAlerts.length,
      alertIds: activeAlerts.map((a) => `${a.nctId}:${a.module}`),
    });

    logger.info({ briefId: brief.id, alertCount: activeAlerts.length }, "Intelligence brief created");
    const nctIdsStr = uniqueNctIds.join(", ");
    await logAction(
      nctIdsStr,
      "SYSTEM",
      "BRIEF_DRAFTED",
      `Drafted Intelligence Brief in Google Docs covering ${activeAlerts.length} alert(s) from ${uniqueNctIds.length} trial(s). Doc: ${docUrl}`,
    );

    res.status(201).json(brief);
  } catch (err) {
    handleError(err, res);
  }
});

router.post("/briefs/:id/send-to-pi", async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const brief = await getBrief(id);
    if (!brief) throw new ApiError(404, "Brief not found");
    if (brief.status !== "Draft")
      throw new ApiError(409, `Brief is already in ${brief.status} status`);

    const settings = await getSettings();

    const { getGmailComposeUrl } = await import("../lib/gmailClient.js");

    // Parse unique NCT IDs from alertIds (format: "NCTxxxxxxxx:module")
    const uniqueNctIds = [
      ...new Set((brief.alertIds ?? []).map((id: string) => id.split(":")[0]).filter(Boolean)),
    ] as string[];

    // Build Notion deep-links (strip dashes from DB ID for Notion URL format)
    function notionDbUrl(rawId: string): string {
      return `https://www.notion.so/${rawId.replace(/-/g, "")}`;
    }
    const notionCompetitorUrl = settings.notionCompetitorDbId
      ? notionDbUrl(settings.notionCompetitorDbId)
      : null;
    const notionTasksUrl = settings.notionTasksDbId
      ? notionDbUrl(settings.notionTasksDbId)
      : null;

    const dateStr = new Date(brief.generatedAt).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const subject = `[Action Required] Competitor Intelligence Brief — ${new Date(brief.generatedAt).toLocaleDateString("en-US")}`;

    const lines: string[] = [
      `Hi,`,
      ``,
      `A new Competitor Intelligence Brief has been generated for trial ONCO-247 and is ready for your review.`,
      ``,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `BRIEF SUMMARY — ${dateStr}`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `Active Alerts Detected: ${brief.alertCount}`,
    ];

    if (uniqueNctIds.length > 0) {
      lines.push(`Competitor Trials Flagged: ${uniqueNctIds.length}`);
      lines.push(`  • ${uniqueNctIds.join("\n  • ")}`);
    }

    lines.push(
      ``,
      `These signals were detected by the SWARM Signal Engine scanning ClinicalTrials.gov for`,
      `changes to competitor enrollment, status, eligibility, or intervention arms that may`,
      `affect ONCO-247 strategy or regulatory positioning.`,
      ``,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `REVIEW LINKS`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `📄  Intelligence Brief (Google Docs):`,
      `    ${brief.docUrl}`,
    );

    if (notionCompetitorUrl) {
      lines.push(
        ``,
        `📊  Competitor Intelligence Database (Notion):`,
        `    ${notionCompetitorUrl}`,
      );
    }
    if (notionTasksUrl) {
      lines.push(
        ``,
        `✅  Recommended Action Tasks (Notion):`,
        `    ${notionTasksUrl}`,
      );
    }

    lines.push(
      ``,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `NEXT STEPS`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `1. Review the full brief in the Google Doc above.`,
      `2. Check the Notion Action Tasks database for recommended strategic responses.`,
      `3. Reply to confirm receipt and advise on any implications for our trial strategy.`,
      ``,
      `If you have questions or need additional context on any flagged trial, reply to this email.`,
      ``,
      `—`,
      `Clinical Trials Co-Pilot`,
      `Automated Competitor Intelligence | ONCO-247`,
    );

    const bodyText = lines.join("\n");

    const composeUrl = getGmailComposeUrl({ to: settings.piEmail, subject, bodyText });

    const updated = await updateBrief(id, {
      status: "PI Review",
      sentToPiAt: new Date().toISOString(),
    });

    await logAction(
      "",
      "SUSAN",
      "BRIEF_SENT_TO_PI",
      `Intelligence Brief compose URL generated for PI at ${settings.piEmail}. Subject: ${subject}. Awaiting PI review and sign-off.`,
    );

    res.json({ ...updated, composeUrl });
  } catch (err) {
    handleError(err, res);
  }
});

router.post("/briefs/:id/mark-approved", async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const brief = await getBrief(id);
    if (!brief) throw new ApiError(404, "Brief not found");
    if (brief.status !== "PI Review")
      throw new ApiError(409, `Brief must be in PI Review to approve`);

    const updated = await updateBrief(id, {
      status: "Approved",
      approvedAt: new Date().toISOString(),
    });

    await logAction("", "SUSAN", "BRIEF_APPROVED", `Intelligence Brief approved by Susan Chen. Brief ID: ${id}.`);

    res.json(updated);
  } catch (err) {
    handleError(err, res);
  }
});

router.post("/briefs/:id/mark-final", async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const brief = await getBrief(id);
    if (!brief) throw new ApiError(404, "Brief not found");
    if (brief.status !== "Approved")
      throw new ApiError(409, `Brief must be Approved before marking sent`);

    const updated = await updateBrief(id, {
      status: "Sent",
      finalizedAt: new Date().toISOString(),
    });

    res.json(updated);
  } catch (err) {
    handleError(err, res);
  }
});

router.post("/briefs/:id/discard", async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const brief = await getBrief(id);
    if (!brief) throw new ApiError(404, "Brief not found");
    if (brief.status === "Discarded")
      throw new ApiError(409, "Brief is already discarded");

    if (brief.status === "Draft" && brief.docId) {
      try {
        const { ReplitConnectors } = await import("@replit/connectors-sdk");
        const connectors = new ReplitConnectors();
        await connectors.proxy(
          "google-drive",
          `/drive/v3/files/${brief.docId}`,
          { method: "DELETE" },
        );
      } catch (delErr) {
        logger.warn({ delErr, briefId: id }, "Could not delete brief doc from Drive — marking discarded anyway");
      }
    }

    const updated = await updateBrief(id, { status: "Discarded" });
    res.json(updated);
  } catch (err) {
    handleError(err, res);
  }
});

export default router;
