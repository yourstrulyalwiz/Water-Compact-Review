import { Router, type IRouter } from "express";
import healthRouter from "./health";
import documentsRouter from "./documents";
import candidatesRouter from "./candidates";
import anchorsRouter from "./anchors";
import relationshipsRouter from "./relationships";
import statsRouter from "./stats";

const router: IRouter = Router();

router.use(healthRouter);
router.use(documentsRouter);
router.use(candidatesRouter);
router.use(anchorsRouter);
router.use(relationshipsRouter);
router.use(statsRouter);

export default router;
