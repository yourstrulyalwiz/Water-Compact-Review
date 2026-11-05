import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router, type IRouter } from "express";
import { rateLimit } from "express-rate-limit";
import { GetOctoberAppendReadinessResponse } from "@workspace/api-zod";
import { checkOctoberPdfAssets } from "../lib/october-pdf-assets.js";

const router: IRouter = Router();
// esbuild bundles this module into dist/index.mjs. Check ONLY dist/documents,
// never a workspace fallback that could conceal missing deployment assets.
const bundledDocuments = path.join(path.dirname(fileURLToPath(import.meta.url)), "documents");
let pending: ReturnType<typeof checkOctoberPdfAssets> | undefined;

router.get("/append-readiness/october-2026", rateLimit({
  windowMs: 60_000,
  limit: 6,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many asset checks; retry in one minute" },
}), async (_req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  // Concurrent requests share an in-flight read; completed results are not cached.
  const check = pending ??= checkOctoberPdfAssets(bundledDocuments);
  try {
    const report = GetOctoberAppendReadinessResponse.parse(await check);
    res.status(report.ready ? 200 : 503).json(report);
  } finally {
    if (pending === check) pending = undefined;
  }
});

export default router;
