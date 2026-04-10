import { Router, type IRouter } from "express";
import { fetchTrial, fetchMultipleTrials } from "../lib/clinicalTrialsClient.js";
import {
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  getSnapshot,
  saveSnapshot,
  createAlert,
  getAlert,
  updateAlert,
  listAlerts,
} from "../lib/watchlist.js";
import { detectDeltas, buildPIBriefingContent } from "../lib/watchlistDeltas.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

class ApiError extends Error {
  constructor(
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function handleError(err: unknown, res: Parameters<Parameters<typeof router.get>[1]>[1]): void {
  if (err instanceof ApiError) {
    res.status(err.httpStatus).json({ error: err.message });
  } else {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Watchlist route error");
    res.status(500).json({ error: msg });
  }
}

router.get("/watchlist", async (_req, res): Promise<void> => {
  try {
    const nctIds = await getWatchlist();
    if (nctIds.length === 0) {
      res.json([]);
      return;
    }

    const trialMap = await fetchMultipleTrials(nctIds);
    const items = await Promise.all(
      nctIds.map(async (nctId) => {
        const trialData = trialMap.get(nctId);
        const snapshot = await getSnapshot(nctId);
        return {
          nctId,
          studyTitle: trialData?.studyTitle ?? "Unknown",
          sponsor: trialData?.sponsor ?? "Unknown",
          overallStatus: trialData?.overallStatus ?? "Unknown",
          primaryCompletionDate: trialData?.primaryCompletionDate ?? null,
          enrollmentCount: trialData?.enrollmentCount ?? null,
          enrollmentType: trialData?.enrollmentType ?? null,
          lastUpdatePostDate: trialData?.lastUpdatePostDate ?? null,
          lastCheckedAt: snapshot?.capturedAt ?? null,
          fetchError: trialData == null,
        };
      }),
    );

    res.json(items);
  } catch (err) {
    handleError(err, res);
  }
});

router.post("/watchlist", async (req, res): Promise<void> => {
  try {
    const { nctId } = (req.body ?? {}) as { nctId?: string };
    if (!nctId || typeof nctId !== "string") {
      throw new ApiError(400, "nctId is required");
    }

    const normalized = nctId.trim().toUpperCase();
    if (!/^NCT\d{8}$/.test(normalized)) {
      throw new ApiError(400, "Invalid NCT number format. Expected: NCT followed by 8 digits (e.g. NCT04567890)");
    }

    const trialData = await fetchTrial(normalized);
    if (!trialData) {
      throw new ApiError(404, `Trial ${normalized} not found on ClinicalTrials.gov`);
    }

    const updated = await addToWatchlist(normalized);
    await saveSnapshot(normalized, trialData);

    res.json({ watchlist: updated, trial: trialData });
  } catch (err) {
    handleError(err, res);
  }
});

router.delete("/watchlist/:nct", async (req, res): Promise<void> => {
  try {
    const { nct } = req.params;
    const updated = await removeFromWatchlist(nct);
    res.json({ watchlist: updated });
  } catch (err) {
    handleError(err, res);
  }
});

router.get("/watchlist/alerts", async (_req, res): Promise<void> => {
  try {
    const alerts = await listAlerts();
    res.json(alerts);
  } catch (err) {
    handleError(err, res);
  }
});

router.post("/watchlist/alerts/:id/approve", async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const alert = await getAlert(id);
    if (!alert) throw new ApiError(404, "Alert not found");
    if (alert.status !== "new") {
      throw new ApiError(409, `Alert is already ${alert.status}`);
    }

    const currentSnapshot = await getSnapshot(alert.nctId);
    const trialData = currentSnapshot?.data;

    if (!trialData) {
      throw new ApiError(503, "Could not retrieve trial data to generate briefing");
    }

    const content = buildPIBriefingContent(trialData, alert.changeSummary, alert.clinicalInterpretation);

    let docUrl: string;
    let docId: string;

    const { ReplitConnectors } = await import("@replit/connectors-sdk");
    const connectors = new ReplitConnectors();
    const docTitle = `Competitor Brief — ${alert.nctId} — ${new Date().toLocaleDateString("en-US")}`;

    const createRes = await connectors.proxy("google-drive", "/drive/v3/files", {
      method: "POST",
      body: JSON.stringify({
        name: docTitle,
        mimeType: "application/vnd.google-apps.document",
      }),
      headers: { "Content-Type": "application/json" },
    }) as unknown as Response;

    if (!createRes.ok) {
      const text = await (createRes as Response).text();
      throw new ApiError(503, `Failed to create Google Doc: ${text.slice(0, 300)}`);
    }

    const created = (await (createRes as Response).json()) as { id?: string };
    if (!created.id) throw new ApiError(503, "Drive API returned no file ID — cannot create briefing doc");
    docId = created.id;

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
                text: content,
              },
            },
          ],
        },
      });
    } catch (writeErr) {
      logger.error({ writeErr, alertId: id, docId }, "Failed to write content to Google Doc — doc was created but content is empty");
      throw new ApiError(503, `Google Doc was created but content could not be written: ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`);
    }

    docUrl = `https://docs.google.com/document/d/${docId}/edit`;

    const updated = await updateAlert(id, {
      status: "approved",
      actedAt: new Date().toISOString(),
      docUrl,
      docId,
    });

    res.json(updated);
  } catch (err) {
    handleError(err, res);
  }
});

router.post("/watchlist/alerts/:id/dismiss", async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const alert = await getAlert(id);
    if (!alert) throw new ApiError(404, "Alert not found");
    if (alert.status !== "new") {
      throw new ApiError(409, `Alert is already ${alert.status}`);
    }

    const updated = await updateAlert(id, {
      status: "dismissed",
      actedAt: new Date().toISOString(),
    });

    res.json(updated);
  } catch (err) {
    handleError(err, res);
  }
});

router.post("/watchlist/poll", async (_req, res): Promise<void> => {
  try {
    const result = await runPoll();
    res.json(result);
  } catch (err) {
    handleError(err, res);
  }
});

router.post("/internal/watchlist-poll", async (req, res): Promise<void> => {
  const pollSecret = process.env.NAG_SECRET;
  if (pollSecret) {
    const provided = req.headers["x-nag-secret"];
    if (provided !== pollSecret) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }

  try {
    const result = await runPoll();
    res.json(result);
  } catch (err) {
    handleError(err, res);
  }
});

async function runPoll(): Promise<{ checked: number; alertsCreated: number; errors: string[] }> {
  const nctIds = await getWatchlist();
  if (nctIds.length === 0) return { checked: 0, alertsCreated: 0, errors: [] };

  const trialMap = await fetchMultipleTrials(nctIds);
  let alertsCreated = 0;
  const errors: string[] = [];

  for (const nctId of nctIds) {
    try {
      const newData = trialMap.get(nctId);
      if (!newData) {
        errors.push(`${nctId}: Could not fetch from ClinicalTrials.gov`);
        continue;
      }

      const previousSnapshot = await getSnapshot(nctId);
      await saveSnapshot(nctId, newData);

      if (!previousSnapshot) continue;

      const delta = await detectDeltas(previousSnapshot.data, newData);
      if (!delta) continue;

      await createAlert({
        nctId,
        studyTitle: newData.studyTitle,
        sponsor: newData.sponsor,
        changeSummary: delta.changeSummary,
        clinicalInterpretation: delta.clinicalInterpretation,
        changedFields: delta.changedFields,
      });

      alertsCreated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${nctId}: ${msg}`);
      logger.error({ err, nctId }, "Poll error for trial");
    }
  }

  return { checked: nctIds.length, alertsCreated, errors };
}

export { runPoll };
export default router;
