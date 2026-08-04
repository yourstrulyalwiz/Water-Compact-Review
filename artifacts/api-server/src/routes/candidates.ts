import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";

const router: IRouter = Router();

router.get("/candidates", async (req, res): Promise<void> => {
  const {
    country,
    stream,
    inclusion_decision,
    confidence_level,
    anchor_confidence,
    reform_aspiration_status,
    reform_type_tier_1,
    human_review_status,
    search,
    page = "1",
    limit = "50",
  } = req.query as Record<string, string | undefined>;

  const pageNum = Math.max(1, parseInt(page ?? "1", 10));
  const limitNum = Math.min(200, Math.max(1, parseInt(limit ?? "50", 10)));
  const offset = (pageNum - 1) * limitNum;

  const params: (string | number | null)[] = [];
  let idx = 1;

  const where: string[] = [];

  if (country) {
    params.push(country);
    where.push(`c.country = $${idx++}`);
  }
  if (stream) {
    // Accept either single-letter prefix ("A") or full string
    const streamVal = stream.length === 1 ? stream + '%' : stream;
    params.push(streamVal);
    where.push(`c.candidate_stream LIKE $${idx++}`);
  }
  if (inclusion_decision) {
    params.push(inclusion_decision);
    where.push(`c.inclusion_decision = $${idx++}`);
  }
  if (confidence_level) {
    params.push(confidence_level);
    where.push(`c.confidence_level = $${idx++}`);
  }
  if (human_review_status) {
    params.push(human_review_status);
    where.push(`c.human_review_status = $${idx++}`);
  }
  if (reform_aspiration_status) {
    params.push(reform_aspiration_status);
    where.push(`c.reform_aspiration_status = $${idx++}`);
  }
  if (reform_type_tier_1) {
    params.push(reform_type_tier_1);
    where.push(`c.reform_type_tier_1 = $${idx++}`);
  }
  if (anchor_confidence) {
    params.push(anchor_confidence);
    where.push(
      `EXISTS (SELECT 1 FROM source_anchors sa WHERE sa.candidate_id = c.candidate_id AND sa.anchor_role = 'Primary Evidence' AND sa.anchor_confidence = $${idx++})`,
    );
  }
  if (search) {
    const like = `%${search}%`;
    params.push(like, like, like, like, like);
    where.push(
      `(c.candidate_id ILIKE $${idx} OR c.standardized_candidate_reform_action ILIKE $${idx + 1} OR c.responsible_entity ILIKE $${idx + 2} OR c.reform_type_tier_1 ILIKE $${idx + 3} OR c.original_compact_text ILIKE $${idx + 4})`,
    );
    idx += 5;
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  // Count query
  const countResult = await pool.query(
    `SELECT COUNT(*) FROM candidates c ${whereClause}`,
    params,
  );
  const total = parseInt(countResult.rows[0].count, 10);

  // Data query
  params.push(limitNum, offset);
  const dataResult = await pool.query(
    `SELECT c.* FROM candidates c ${whereClause} ORDER BY c.candidate_id LIMIT $${idx} OFFSET $${idx + 1}`,
    params,
  );

  res.json({
    candidates: dataResult.rows,
    total,
    page: pageNum,
    limit: limitNum,
  });
});

router.get("/candidates/:candidateId", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.candidateId)
    ? req.params.candidateId[0]
    : req.params.candidateId;

  const candidateResult = await pool.query(
    "SELECT * FROM candidates WHERE candidate_id = $1",
    [raw],
  );
  if (candidateResult.rows.length === 0) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }
  const candidate = candidateResult.rows[0];

  // Fetch anchors with rectangles
  const anchorsResult = await pool.query(
    `SELECT sa.*, 
      COALESCE(
        json_agg(r.* ORDER BY r.rectangle_id) FILTER (WHERE r.rectangle_id IS NOT NULL),
        '[]'::json
      ) AS rectangles
    FROM source_anchors sa
    LEFT JOIN anchor_rectangles r ON r.anchor_id = sa.anchor_id
    WHERE sa.candidate_id = $1
    GROUP BY sa.anchor_id
    ORDER BY 
      CASE sa.anchor_role
        WHEN 'Primary Evidence' THEN 1
        WHEN 'Context' THEN 2
        WHEN 'Aspiration' THEN 3
        WHEN 'Explicit Mechanism' THEN 4
        WHEN 'Duplicate/Sub-action Evidence' THEN 5
        WHEN 'Exclusion Evidence' THEN 6
        ELSE 7
      END,
      sa.anchor_id`,
    [raw],
  );

  res.json({ ...candidate, anchors: anchorsResult.rows });
});

export default router;
