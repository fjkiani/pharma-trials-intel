import { Router, type IRouter } from "express";
import { getAuditLog, clearAuditLog } from "../services/audit/logger.js";

const router: IRouter = Router();

router.get("/audit/logs", async (_req, res): Promise<void> => {
  const entries = await getAuditLog(1000);
  res.json({ entries });
});

router.delete("/audit/logs", async (_req, res): Promise<void> => {
  await clearAuditLog();
  res.json({ ok: true });
});

export default router;
