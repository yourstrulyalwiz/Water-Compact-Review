import { Router, type IRouter } from "express";
import healthRouter from "./health";
import documentsRouter from "./documents";
import candidatesRouter from "./candidates";
import anchorsRouter from "./anchors";
import relationshipsRouter from "./relationships";
import statsRouter from "./stats";
import reviewersRouter from "./reviewers";
import exportRouter from "./export";
import compactV5Router from "./compact-v5";
import appendReadinessRouter from "./append-readiness";

const router: IRouter = Router();

router.use(healthRouter);
// Fixed bundled-asset check is independent of dataset activation and imports.
router.use(appendReadinessRouter);
// Prefer the dataset-scoped v5 API when compact_v5 has an active pointer.
// The router exits cleanly before the legacy routes when v5 is not activated.
router.use(compactV5Router);
router.use(documentsRouter);
router.use(candidatesRouter);
router.use(anchorsRouter);
router.use(relationshipsRouter);
router.use(statsRouter);
router.use(reviewersRouter);
router.use(exportRouter);

export default router;
