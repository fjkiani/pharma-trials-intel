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

    const content = await buildBriefDocContent(activeAlerts);
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

    const created = (await (createRes as Response).json()) as {
      id?: string;
    };
    if (!created.id)
      throw new ApiError(503, "Drive API returned no file ID");

    const docId = created.id;

    try {
      const { getGoogleOAuth2Client } = await import(
        "../lib/googleOAuthClient.js"
      );
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
                text: content,
              },
            },
          ],
        },
      });
    } catch (writeErr) {
      logger.error(
        { writeErr, docId },
        "Failed to write content to brief doc — doc created but empty",
      );
      throw new ApiError(
        503,
        `Document created but content could not be written: ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`,
      );
    }

    const docUrl = `https://docs.google.com/document/d/${docId}/edit`;

    const brief = await createBrief({
      docUrl,
      docId,
      alertCount: activeAlerts.length,
      alertIds: activeAlerts.map((a) => `${a.nctId}:${a.module}`),
    });

    logger.info({ briefId: brief.id, alertCount: activeAlerts.length }, "Intelligence brief created");
    const nctIds = [...new Set(activeAlerts.map((a) => a.nctId))].join(", ");
    await logAction(
      nctIds,
      "SYSTEM",
      "BRIEF_DRAFTED",
      `Drafted Intelligence Brief in Google Docs covering ${activeAlerts.length} alert(s) from ${[...new Set(activeAlerts.map((a) => a.nctId))].length} trial(s). Doc: ${docUrl}`,
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

    const { getGmailClient } = await import("../lib/gmailClient.js");
    const gmail = await getGmailClient();

    const subject = `[Action Required] Competitor Intelligence Brief — ${new Date(brief.generatedAt).toLocaleDateString("en-US")}`;
    const body = [
      `<p>A new competitor intelligence briefing has been prepared for your review.</p>`,
      `<p>This brief covers <strong>${brief.alertCount} active alert${brief.alertCount !== 1 ? "s" : ""}</strong> detected from monitored competitor trials on ClinicalTrials.gov.</p>`,
      `<p><a href="${brief.docUrl}" style="font-size:16px;font-weight:bold;">Open Intelligence Brief →</a></p>`,
      `<p style="color:#888;font-size:12px;">Please review and advise on any implications for our trial strategy. Reply to confirm receipt.</p>`,
      `<p style="color:#888;font-size:12px;">Generated by Clinical Trials Co-Pilot — Competitor Intelligence</p>`,
    ].join("\n");

    const rawMessage = [
      `From: me`,
      `To: ${settings.piEmail}`,
      `Subject: ${subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset=utf-8`,
      ``,
      body,
    ].join("\r\n");

    const encoded = Buffer.from(rawMessage).toString("base64url");
    await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw: encoded },
    });

    const updated = await updateBrief(id, {
      status: "PI Review",
      sentToPiAt: new Date().toISOString(),
    });

    await logAction(
      "",
      "SUSAN",
      "BRIEF_SENT_TO_PI",
      `Intelligence Brief sent to PI at ${settings.piEmail}. Subject: ${subject}. Awaiting PI review and sign-off.`,
    );

    res.json(updated);
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
