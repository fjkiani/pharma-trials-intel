import { Router, type IRouter } from "express";
import { GetSettingsResponse, UpdateSettingsBody, UpdateSettingsResponse } from "@workspace/api-zod";
import { getSettings, updateSettings } from "../lib/settings.js";

const router: IRouter = Router();

router.get("/settings", async (req, res): Promise<void> => {
  const settings = await getSettings();
  res.json(GetSettingsResponse.parse(settings));
});

router.put("/settings", async (req, res): Promise<void> => {
  const parsed = UpdateSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updated = await updateSettings(parsed.data);
  res.json(UpdateSettingsResponse.parse(updated));
});

export default router;
