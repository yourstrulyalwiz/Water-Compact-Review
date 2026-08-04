import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { verifyReviewerToken } from "../lib/reviewer-token.js";

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
  const limitNum = Math.min(500, Math.max(1, parseInt(limit ?? "50", 10)));
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
    const streamVal = stream.length === 1 ? stream + "%" : stream;
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

  // Count query (doesn't need the review join)
  const countResult = await pool.query(
    `SELECT COUNT(*) FROM candidates c ${whereClause}`,
    params,
  );
  const total = parseInt(countResult.rows[0].count, 10);

  // Data query — LEFT JOIN with review aggregates for has_conflict + review_count.
  // Uses DISTINCT ON to take only the latest decision per reviewer, so that
  // updating a decision never leaves a stale conflict indicator.
  params.push(limitNum, offset);
  const dataResult = await pool.query(
    `SELECT c.*,
       COALESCE(rcounts.review_count, 0)::int AS review_count,
       COALESCE(rcounts.has_conflict, false) AS has_conflict
     FROM candidates c
     LEFT JOIN (
       SELECT
         candidate_id,
         COUNT(DISTINCT reviewer_id) AS review_count,
         (COUNT(DISTINCT inclusion_decision) > 1) AS has_conflict
       FROM (
         SELECT DISTINCT ON (candidate_id, reviewer_id)
           candidate_id, reviewer_id, inclusion_decision
         FROM candidate_reviews
         ORDER BY candidate_id, reviewer_id, created_at DESC
       ) latest
       GROUP BY candidate_id
     ) rcounts ON rcounts.candidate_id = c.candidate_id
     ${whereClause}
     ORDER BY c.candidate_id
     LIMIT $${idx} OFFSET $${idx + 1}`,
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

// GET /api/candidates/:candidateId/reviews — all reviews for a candidate
router.get("/candidates/:candidateId/reviews", async (req, res): Promise<void> => {
  const candidateId = Array.isArray(req.params.candidateId)
    ? req.params.candidateId[0]
    : req.params.candidateId;

  const result = await pool.query(
    `SELECT cr.review_id, cr.candidate_id, cr.reviewer_id,
       r.display_name AS reviewer_name,
       cr.inclusion_decision, cr.comment, cr.created_at
     FROM candidate_reviews cr
     JOIN reviewers r ON r.reviewer_id::text = cr.reviewer_id
     WHERE cr.candidate_id = $1
     ORDER BY cr.created_at DESC`,
    [candidateId],
  );

  // Compute conflict: ≥2 distinct decisions among the most recent submission per reviewer
  const latestByReviewer = new Map<string, string>();
  for (const row of result.rows) {
    if (!latestByReviewer.has(row.reviewer_id)) {
      latestByReviewer.set(row.reviewer_id, row.inclusion_decision);
    }
  }
  const uniqueDecisions = new Set(latestByReviewer.values());
  const has_conflict = uniqueDecisions.size > 1;

  res.json({ reviews: result.rows, has_conflict });
});

// POST /api/candidates/:candidateId/reviews — submit / update a review
// Reviewer identity is derived from the signed Bearer token; reviewer_id is
// never accepted from the request body to prevent impersonation.
router.post("/candidates/:candidateId/reviews", async (req, res): Promise<void> => {
  const candidateId = Array.isArray(req.params.candidateId)
    ? req.params.candidateId[0]
    : req.params.candidateId;

  // Authenticate via signed token
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authorization token required. Please sign in." });
    return;
  }
  const reviewerId = verifyReviewerToken(authHeader.slice(7));
  if (!reviewerId) {
    res.status(401).json({ error: "Invalid or expired session. Please sign in again." });
    return;
  }

  const { inclusion_decision, comment } = req.body as {
    inclusion_decision?: string;
    comment?: string | null;
  };

  if (!inclusion_decision) {
    res.status(400).json({ error: "inclusion_decision is required" });
    return;
  }

  // Verify candidate exists
  const candidateCheck = await pool.query(
    `SELECT 1 FROM candidates WHERE candidate_id = $1`,
    [candidateId],
  );
  if (candidateCheck.rows.length === 0) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }

  const result = await pool.query(
    `WITH inserted AS (
       INSERT INTO candidate_reviews (candidate_id, reviewer_id, inclusion_decision, comment)
       VALUES ($1, $2, $3, $4)
       RETURNING review_id, candidate_id, reviewer_id, inclusion_decision, comment, created_at
     )
     SELECT i.*, r.display_name AS reviewer_name
     FROM inserted i
     JOIN reviewers r ON r.reviewer_id::text = i.reviewer_id`,
    [candidateId, reviewerId, inclusion_decision, comment ?? null],
  );

  res.status(201).json(result.rows[0]);
});

export default router;
