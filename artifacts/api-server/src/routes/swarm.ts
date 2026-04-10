import { Router } from "express";
import { logger } from "../lib/logger.js";
import { runSwarmIngestion } from "../services/ingestion/swarm.js";

const router = Router();

router.post("/internal/swarm-poll", async (req, res): Promise<void> => {
  const nagSecret = process.env.NAG_SECRET;
  if (nagSecret) {
    const provided = req.headers["x-nag-secret"];
    if (provided !== nagSecret) {
      res.status(401).json({ error: "Unauthorized — missing or invalid X-Nag-Secret header." });
      return;
    }
  }

  const body = req.body as unknown;
  if (
    typeof body !== "object" ||
    body === null ||
    !Array.isArray((body as Record<string, unknown>).nctIds) ||
    !(body as Record<string, unknown[]>).nctIds.every((id) => typeof id === "string" && id.length > 0)
  ) {
    res.status(400).json({ error: "Invalid request body — expected { nctIds: string[] }." });
    return;
  }

  const { nctIds } = body as { nctIds: string[] };

  logger.info({ nctIds }, "Swarm poll triggered");

  const result = await runSwarmIngestion(nctIds);

  logger.info(result, "Swarm poll complete");

  res.json(result);
});

export default router;
