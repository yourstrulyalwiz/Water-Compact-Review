import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";

const router: IRouter = Router();

router.get("/stats", async (req, res): Promise<void> => {
  const [
    totals,
    byCountry,
    byStream,
    byInclusion,
    byConfidence,
    byAnchorConf,
    byReviewStatus,
  ] = await Promise.all([
    pool.query(`
      SELECT
        (SELECT COUNT(*) FROM candidates) AS total_candidates,
        (SELECT COUNT(*) FROM documents) AS total_documents,
        (SELECT COUNT(*) FROM source_anchors) AS total_anchors,
        (SELECT COUNT(*) FROM item_relationships) AS total_relationships
    `),
    pool.query(
      "SELECT country AS key, COUNT(*)::int AS count FROM candidates GROUP BY country ORDER BY country",
    ),
    pool.query(
      "SELECT candidate_stream AS key, COUNT(*)::int AS count FROM candidates GROUP BY candidate_stream ORDER BY candidate_stream",
    ),
    pool.query(
      "SELECT inclusion_decision AS key, COUNT(*)::int AS count FROM candidates GROUP BY inclusion_decision ORDER BY inclusion_decision",
    ),
    pool.query(
      "SELECT confidence_level AS key, COUNT(*)::int AS count FROM candidates GROUP BY confidence_level ORDER BY confidence_level",
    ),
    pool.query(
      "SELECT anchor_confidence AS key, COUNT(*)::int AS count FROM source_anchors WHERE anchor_role = 'Primary Evidence' GROUP BY anchor_confidence ORDER BY anchor_confidence",
    ),
    pool.query(
      "SELECT human_review_status AS key, COUNT(*)::int AS count FROM candidates GROUP BY human_review_status ORDER BY human_review_status",
    ),
  ]);

  const t = totals.rows[0];
  res.json({
    total_candidates: parseInt(t.total_candidates, 10),
    total_documents: parseInt(t.total_documents, 10),
    total_anchors: parseInt(t.total_anchors, 10),
    total_relationships: parseInt(t.total_relationships, 10),
    by_country: byCountry.rows,
    by_stream: byStream.rows,
    by_inclusion_decision: byInclusion.rows,
    by_confidence_level: byConfidence.rows,
    by_anchor_confidence: byAnchorConf.rows,
    by_human_review_status: byReviewStatus.rows,
  });
});

export default router;
