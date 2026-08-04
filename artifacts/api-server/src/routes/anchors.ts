import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";

const router: IRouter = Router();

router.get("/anchors/:anchorId", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.anchorId)
    ? req.params.anchorId[0]
    : req.params.anchorId;

  const anchorResult = await pool.query(
    `SELECT sa.*, 
      COALESCE(
        json_agg(r.* ORDER BY r.rectangle_id) FILTER (WHERE r.rectangle_id IS NOT NULL),
        '[]'::json
      ) AS rectangles
    FROM source_anchors sa
    LEFT JOIN anchor_rectangles r ON r.anchor_id = sa.anchor_id
    WHERE sa.anchor_id = $1
    GROUP BY sa.anchor_id`,
    [raw],
  );

  if (anchorResult.rows.length === 0) {
    res.status(404).json({ error: "Anchor not found" });
    return;
  }

  res.json(anchorResult.rows[0]);
});

export default router;
