import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import regulatoryRouter from "./regulatory.js";
import settingsRouter from "./settings.js";
import reportsRouter from "./reports.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(regulatoryRouter);
router.use(settingsRouter);
router.use(reportsRouter);

export default router;
