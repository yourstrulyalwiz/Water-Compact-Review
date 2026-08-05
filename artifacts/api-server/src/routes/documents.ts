import path from "path";
import fs from "fs";
import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";

const router: IRouter = Router();

// Resolve relative to this compiled file so the path is correct in both
// development (dist/ is rebuilt before start) and production (PDFs are
// copied into dist/documents/ by the build step in build.mjs).
const DOCUMENTS_DIR = new URL("./documents", import.meta.url).pathname;

router.get("/documents", async (req, res): Promise<void> => {
  const result = await pool.query(`SELECT * FROM documents ORDER BY country`);
  res.json(result.rows);
});

router.get("/documents/:documentId", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.documentId)
    ? req.params.documentId[0]
    : req.params.documentId;
  const result = await pool.query(
    "SELECT * FROM documents WHERE document_id = $1",
    [raw],
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  res.json(result.rows[0]);
});

router.get("/documents/:documentId/pdf", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.documentId)
    ? req.params.documentId[0]
    : req.params.documentId;
  const result = await pool.query(
    "SELECT local_filename, sha256 FROM documents WHERE document_id = $1",
    [raw],
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  const { local_filename } = result.rows[0];
  const filePath = path.join(DOCUMENTS_DIR, local_filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "PDF file not found on server" });
    return;
  }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${local_filename}"`);
  // Allow client-side SHA-256 verification
  res.setHeader("Access-Control-Expose-Headers", "X-Document-SHA256");
  res.setHeader("X-Document-SHA256", result.rows[0].sha256);
  // Cache PDF for the session
  res.setHeader("Cache-Control", "public, max-age=3600");
  fs.createReadStream(filePath).pipe(res);
});

export default router;
