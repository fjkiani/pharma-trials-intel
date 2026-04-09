import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import regulatoryRouter from "./regulatory.js";
import settingsRouter from "./settings.js";
import reportsRouter from "./reports.js";
import integrationsRouter from "./integrations.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(regulatoryRouter);
router.use(settingsRouter);
router.use(reportsRouter);
router.use(integrationsRouter);

export default router;
