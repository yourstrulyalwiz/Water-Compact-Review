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

// Fixed reviewer order — must match the seeded names in migration 002.
const REVIEWERS = ["Christina", "Billy", "Juliana", "Patricia"] as const;

// Wide-format header: one row per candidate, reviewer decisions pivoted into columns.
const HEADER = [
  "candidate_id",
  "country",
  "stream",
  "standardized_reform_action",
  "llm_inclusion_decision",
  "llm_rationale",
  // Per-reviewer columns (3 × 4 = 12)
  "christina_decision",
  "christina_comment",
  "christina_reviewed_at",
  "billy_decision",
  "billy_comment",
  "billy_reviewed_at",
  "juliana_decision",
  "juliana_comment",
  "juliana_reviewed_at",
  "patricia_decision",
  "patricia_comment",
  "patricia_reviewed_at",
  // Cross-reviewer aggregates
  "review_count",
  "has_conflict",
  "consensus_decision",
];

/**
 * GET /api/export/decisions.csv
 *
 * Returns a UTF-8 CSV (with BOM for Excel) in wide format:
 * one row per candidate, with each of the four reviewers' latest decision,
 * comment, and timestamp in dedicated columns, plus aggregate columns.
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

  // LATERAL subquery per reviewer: picks the single most-recent review for that
  // reviewer on each candidate.  LEFT JOIN … ON TRUE preserves candidates with
  // no review from that reviewer (all columns NULL).
  const result = await pool.query(
    `SELECT
       c.candidate_id,
       c.country,
       c.candidate_stream                        AS stream,
       c.standardized_candidate_reform_action    AS standardized_reform_action,
       c.inclusion_decision                      AS llm_inclusion_decision,
       c.decision_rationale                      AS llm_rationale,
       -- Christina
       cr_c.inclusion_decision  AS christina_decision,
       cr_c.comment             AS christina_comment,
       cr_c.created_at          AS christina_reviewed_at,
       -- Billy
       cr_b.inclusion_decision  AS billy_decision,
       cr_b.comment             AS billy_comment,
       cr_b.created_at          AS billy_reviewed_at,
       -- Juliana
       cr_j.inclusion_decision  AS juliana_decision,
       cr_j.comment             AS juliana_comment,
       cr_j.created_at          AS juliana_reviewed_at,
       -- Patricia
       cr_p.inclusion_decision  AS patricia_decision,
       cr_p.comment             AS patricia_comment,
       cr_p.created_at          AS patricia_reviewed_at
     FROM candidates c
     LEFT JOIN LATERAL (
       SELECT cr.inclusion_decision, cr.comment, cr.created_at
       FROM candidate_reviews cr
       JOIN reviewers r ON r.reviewer_id::text = cr.reviewer_id
       WHERE r.display_name = 'Christina' AND cr.candidate_id = c.candidate_id
       ORDER BY cr.created_at DESC LIMIT 1
     ) cr_c ON TRUE
     LEFT JOIN LATERAL (
       SELECT cr.inclusion_decision, cr.comment, cr.created_at
       FROM candidate_reviews cr
       JOIN reviewers r ON r.reviewer_id::text = cr.reviewer_id
       WHERE r.display_name = 'Billy' AND cr.candidate_id = c.candidate_id
       ORDER BY cr.created_at DESC LIMIT 1
     ) cr_b ON TRUE
     LEFT JOIN LATERAL (
       SELECT cr.inclusion_decision, cr.comment, cr.created_at
       FROM candidate_reviews cr
       JOIN reviewers r ON r.reviewer_id::text = cr.reviewer_id
       WHERE r.display_name = 'Juliana' AND cr.candidate_id = c.candidate_id
       ORDER BY cr.created_at DESC LIMIT 1
     ) cr_j ON TRUE
     LEFT JOIN LATERAL (
       SELECT cr.inclusion_decision, cr.comment, cr.created_at
       FROM candidate_reviews cr
       JOIN reviewers r ON r.reviewer_id::text = cr.reviewer_id
       WHERE r.display_name = 'Patricia' AND cr.candidate_id = c.candidate_id
       ORDER BY cr.created_at DESC LIMIT 1
     ) cr_p ON TRUE
     ${whereClause}
     ORDER BY c.candidate_id`,
    params,
  );

  // Build CSV in memory (at most ~189 rows, one per candidate — well within limits)
  const lines: string[] = [
    // UTF-8 BOM so Excel opens without import wizard
    "\uFEFF" + HEADER.join(","),
  ];

  for (const row of result.rows) {
    // Compute cross-reviewer aggregates in the application layer
    const decisions = [
      row.christina_decision,
      row.billy_decision,
      row.juliana_decision,
      row.patricia_decision,
    ].filter(Boolean) as string[];

    const review_count = decisions.length;
    const unique = new Set(decisions);
    const has_conflict = review_count >= 2 && unique.size > 1;
    const consensus_decision =
      review_count > 0 && !has_conflict ? decisions[0] : null;

    const fmt = (ts: unknown) =>
      ts ? new Date(ts as string).toISOString() : null;

    lines.push(
      csvRow([
        row.candidate_id,
        row.country,
        row.stream,
        row.standardized_reform_action,
        row.llm_inclusion_decision,
        row.llm_rationale,
        row.christina_decision,
        row.christina_comment,
        fmt(row.christina_reviewed_at),
        row.billy_decision,
        row.billy_comment,
        fmt(row.billy_reviewed_at),
        row.juliana_decision,
        row.juliana_comment,
        fmt(row.juliana_reviewed_at),
        row.patricia_decision,
        row.patricia_comment,
        fmt(row.patricia_reviewed_at),
        String(review_count),
        has_conflict ? "TRUE" : "FALSE",
        consensus_decision,
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
