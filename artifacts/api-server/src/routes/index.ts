import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import employeesRouter from "./employees";
import webhookRouter from "./webhook";
import impersonationRouter from "./impersonation";
import testAuthRouter from "./test-auth";
import adsTikTokRouter from "./ads-tiktok";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dashboardRouter);
router.use(employeesRouter);
router.use(webhookRouter);
router.use(impersonationRouter);
router.use(testAuthRouter);
router.use(adsTikTokRouter);

export default router;
