import { Router, type IRouter } from "express";
import { getAuditLog } from "../services/audit/logger.js";

const router: IRouter = Router();

router.get("/audit/logs", async (_req, res): Promise<void> => {
  const entries = await getAuditLog(1000);
  res.json({ entries });
});

export default router;
