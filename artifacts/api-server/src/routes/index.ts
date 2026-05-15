import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import employeesRouter from "./employees";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dashboardRouter);
router.use(employeesRouter);

export default router;
