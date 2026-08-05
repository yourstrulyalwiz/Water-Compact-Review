import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";

const router: IRouter = Router();

// Escape a value for CSV: wrap in double-quotes, doubling any internal quotes.
// Always quote to avoid ambiguity with commas, newlines, etc.
function csvCell(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

function csvRow(values: (string | null | undefined)[]): string {
  return values.map(csvCell).join(",");
}

const HEADER = [
  "candidate_id",
  "country",
  "stream",
  "llm_inclusion_decision",
  "reviewer_name",
  "reviewer_decision",
  "rationale",
  "reviewed_at",
];

/**
 * GET /api/export/decisions.csv
 *
 * Returns a UTF-8 CSV (with BOM for Excel) with one row per
 * reviewer–candidate pair. Candidates with no reviews appear with
 * blank reviewer columns so analysts can see coverage gaps.
 *
 * Accepts the same filter query params as GET /api/candidates.
 */
router.get("/export/decisions.csv", async (req, res): Promise<void> => {
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
  } = req.query as Record<string, string | undefined>;

  const params: (string | number | null)[] = [];
  let idx = 1;
  const where: string[] = [];

  if (country) {
    params.push(country);
    where.push(`c.country = $${idx++}`);
  }
  if (stream) {
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

  // One row per reviewer–candidate pair (latest decision per reviewer only).
  // Candidates with no reviews appear once with NULL reviewer columns.
  const result = await pool.query(
    `SELECT
       c.candidate_id,
       c.country,
       c.candidate_stream AS stream,
       c.inclusion_decision AS llm_inclusion_decision,
       r.display_name AS reviewer_name,
       cr.inclusion_decision AS reviewer_decision,
       cr.comment AS rationale,
       cr.created_at AS reviewed_at
     FROM candidates c
     LEFT JOIN (
       SELECT DISTINCT ON (candidate_id, reviewer_id)
         candidate_id, reviewer_id, inclusion_decision, comment, created_at
       FROM candidate_reviews
       ORDER BY candidate_id, reviewer_id, created_at DESC
     ) cr ON cr.candidate_id = c.candidate_id
     LEFT JOIN reviewers r ON r.reviewer_id::text = cr.reviewer_id
     ${whereClause}
     ORDER BY c.candidate_id, r.display_name NULLS LAST`,
    params,
  );

  // Build CSV in memory (rows are at most ~189 × reviewers, well within limits)
  const lines: string[] = [
    // UTF-8 BOM so Excel opens correctly without import wizard
    "\uFEFF" + HEADER.join(","),
  ];

  for (const row of result.rows) {
    lines.push(
      csvRow([
        row.candidate_id,
        row.country,
        row.stream,
        row.llm_inclusion_decision,
        row.reviewer_name,
        row.reviewer_decision,
        row.rationale,
        row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
      ]),
    );
  }

  const body = lines.join("\r\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="decisions.csv"',
  );
  res.setHeader("Cache-Control", "no-cache");
  res.send(body);
});

export default router;
