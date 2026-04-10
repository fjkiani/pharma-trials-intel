import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import regulatoryRouter from "./regulatory.js";
import settingsRouter from "./settings.js";
import reportsRouter from "./reports.js";
import integrationsRouter from "./integrations.js";
import swarmRouter from "./swarm.js";
import watchlistRouter from "./watchlist.js";
import briefsRouter from "./briefs.js";
import connectionsRouter from "./connections.js";
import strikeRouter from "./strike.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(regulatoryRouter);
router.use(settingsRouter);
router.use(reportsRouter);
router.use(integrationsRouter);
router.use(swarmRouter);
router.use(watchlistRouter);
router.use(briefsRouter);
router.use(connectionsRouter);
router.use(strikeRouter);

export default router;
