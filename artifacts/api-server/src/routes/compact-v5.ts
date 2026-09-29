import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { verifyReviewerToken } from "../lib/reviewer-token.js";
import {
  activeDataset,
  candidateWorkflow,
  candidateWorkflows,
  finalCountGate,
  isSixCriteriaPass,
  latestAssessment,
} from "../lib/compact-v5.js";

const router: IRouter = Router();
const SERVER_MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const GLOBAL_DECISIONS = new Set(["Approve", "Revise", "Reject", "Consolidate", "Needs Discussion"]);
const REGIONAL_DECISIONS = new Set(["Confirm", "Confirm with Revision", "Disagree", "Needs Discussion", "Pending"]);
const MASTER_FIELDS = [
  ["Candidate_ID", "candidate_id"],
  ["Country", "country"],
  ["Source_Language", "source_language"],
  ["Source_Reference", "source_reference"],
  ["Compact_Form", "compact_form"],
  ["Evidence_Passage_Original_Language", "evidence_passage_original_language"],
  ["Evidence_Passage_English_Translation", "evidence_passage_english_translation"],
  ["Reform_Action_Text_Original_Language", "reform_action_text_original_language"],
  ["Reform_Action_Text_English_Translation", "reform_action_text_english_translation"],
  ["Candidate_Stream", "candidate_stream"],
  ["C1_Explicit_Commitment", "c1_explicit_commitment"],
  ["C2_Discrete_Actionable_Mechanism", "c2_discrete_actionable_mechanism"],
  ["C3_System_Change", "c3_system_change"],
  ["C4_Not_Merely_Implementation", "c4_not_merely_implementation"],
  ["C5_Distinct_Reform_Action", "c5_distinct_reform_action"],
  ["C6_Trackable_Monitorable", "c6_trackable_monitorable"],
  ["Six_Criteria_Pass", "six_criteria_pass"],
  ["LLM_Decision_Rationale", "llm_decision_rationale"],
  ["Cluster_ID", "cluster_id"],
  ["Cluster_Role", "cluster_role"],
  ["Parent_Reform_Action_ID", "parent_reform_action_id"],
  ["Primary_Pillar", "primary_pillar"],
  ["Primary_Scalable_Solution", "primary_scalable_solution"],
  ["Additional_Scalable_Solutions", "additional_scalable_solutions"],
  ["Primary_Tier1_Reform_Domain", "primary_tier1_reform_domain"],
  ["Tier2_Reform_Category", "tier2_reform_category"],
  ["Secondary_Reform_Domain_Tags", "secondary_reform_domain_tags"],
  ["Lead_Institution_Actor", "lead_institution_actor"],
  ["Water_Financing_Relevance", "water_financing_relevance"],
  ["Temporal_Status", "temporal_status"],
  ["Monitoring_Completion_Criterion", "monitoring_completion_criterion"],
  ["Global_Review_Decision", "global_review_decision"],
  ["Regional_Confirmation_Decision", "regional_confirmation_decision"],
  ["Final_Status", "final_status"],
  ["Count_in_Final_Reform_Total", "count_in_final_reform_total"],
  ["Reform_Action_Statement_English", "reform_action_statement_english"],
  ["Document_ID", "document_id"],
  ["Analysis_Run_ID", "analysis_run_id"],
  ["Analysis_Version_ID", "analysis_version_id"],
  ["Global_Review_Comment", "global_review_comment"],
  ["Regional_Comment", "regional_comment"],
  ["Review_Resolution", "review_resolution"],
] as const;

function param(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function csvCell(value: unknown, spreadsheetSafe = true): string {
  if (value == null) return "";
  let text = typeof value === "string" ? value : JSON.stringify(value);
  // Export-only CSV mitigation; stored/source text remains byte-for-byte unchanged.
  if (spreadsheetSafe && /^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function csv(rows: unknown[][], headers: string[], filename: string, res: any) {
  const output = ["\uFEFF" + headers.map((h) => csvCell(h, false)).join(",")];
  for (const row of rows) output.push(row.map((v) => csvCell(v)).join(","));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(output.join("\r\n"));
}

async function requireDataset(req: any, res: any, next: any): Promise<void> {
  const dataset = await activeDataset();
  if (!dataset) {
    next("router");
    return;
  }
  req.compactDatasetId = dataset.datasetId;
  next();
}
router.use(requireDataset);

function datasetId(req: any): string | null {
  return req.compactDatasetId ?? null;
}

function applyFilters(rows: any[], q: Record<string, string | undefined>) {
  const field = (row: any, key: string) =>
    Object.prototype.hasOwnProperty.call(row.current_assessment, key)
      ? row.current_assessment[key]
      : row.baseline[key];
  const exact: Record<string, string> = {
    primary_pillar: "primary_pillar",
    tier1: "primary_tier1_reform_domain",
    tier2: "tier2_reform_category",
    temporal_status: "temporal_status",
    cluster_role: "cluster_role",
    global_decision: "global_review_decision",
    regional_decision: "regional_confirmation_decision",
  };
  for (const [queryKey, rowKey] of Object.entries(exact)) {
    const value = q[queryKey];
    if (value) rows = rows.filter((row) => String(row[rowKey] ?? field(row, rowKey) ?? "") === value);
  }
  if (q.financing_relevance != null) {
    rows = rows.filter((row) => String(field(row, "water_financing_relevance") ?? "") === q.financing_relevance);
  }
  if (q.scalable_solution) {
    rows = rows.filter((row) => {
      const values = [
        field(row, "primary_scalable_solution"),
        ...(field(row, "additional_scalable_solutions") ?? []),
      ];
      return values.some((value) => String(value) === q.scalable_solution);
    });
  }
  if (q.unresolved_issue != null) {
    rows = rows.filter((row) => row.has_unresolved_disagreement === (q.unresolved_issue === "true"));
  }
  if (q.country) rows = rows.filter((r) => r.country === q.country || r.country_code === q.country);
  if (q.stream) rows = rows.filter((r) => r.candidate_stream === q.stream);
  if (q.final_status) rows = rows.filter((r) => r.final_status === q.final_status);
  if (q.view === "review_actions") rows = rows.filter((r) => r.candidate_stream !== "High-confidence Non-reform");
  if (q.view === "final_approved") rows = rows.filter((r) => r.count_in_final_reform_total === 1);
  if (q.view === "qa_sample") rows = rows.filter((r) => r.qa_sample);
  if (q.failed_criterion) {
    const match = /^C([1-6])$/.exec(q.failed_criterion);
    if (!match) return [];
    const key = [
      "",
      "c1_explicit_commitment",
      "c2_discrete_actionable_mechanism",
      "c3_system_change",
      "c4_not_merely_implementation",
      "c5_distinct_reform_action",
      "c6_trackable_monitorable",
    ][Number(match[1])];
    rows = rows.filter((row) => {
      const value = field(row, key);
      return value === 0 || value === "0";
    });
  }
  if (q.search) {
    const term = q.search.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase();
    rows = rows.filter((r) =>
      JSON.stringify(r).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase().includes(term),
    );
  }
  return rows;
}

function validateCandidateFilters(q: Record<string, string | undefined>): string | null {
  if (q.view && !["all", "review_actions", "final_approved", "qa_sample"].includes(q.view)) {
    return "view must be all, review_actions, final_approved, or qa_sample";
  }
  if (q.failed_criterion && !/^C[1-6]$/.test(q.failed_criterion)) {
    return "failed_criterion must be one of C1 through C6";
  }
  if (q.unresolved_issue && !["true", "false"].includes(q.unresolved_issue)) {
    return "unresolved_issue must be true or false";
  }
  if (q.financing_relevance && !["0", "1"].includes(q.financing_relevance)) {
    return "financing_relevance must be 0 or 1";
  }
  return null;
}

async function loadCandidates(id: string) {
  const result = await pool.query(
    `SELECT b.*, b.source_row AS raw_row,
            a.assessment_revision, to_jsonb(a) AS assessment_data, a.created_by AS author_id, a.change_reason,
             a.created_at AS assessment_created_at,
             f.final_status, f.survivor_candidate_id, qa.qa_checks,
             COALESCE(evid.evidence_search_text, '') AS evidence_search_text
     FROM compact_v5.candidate_baselines b
     LEFT JOIN LATERAL (
       SELECT a.*
       FROM compact_v5.candidate_assessments a
       WHERE a.dataset_id = b.dataset_id AND a.candidate_id = b.candidate_id
       ORDER BY assessment_revision DESC LIMIT 1
     ) a ON TRUE
     LEFT JOIN LATERAL (
       SELECT final_status, survivor_candidate_id
       FROM compact_v5.finalizations f
       WHERE f.dataset_id = b.dataset_id AND f.candidate_id = b.candidate_id
         AND f.assessment_revision = a.assessment_revision
       ORDER BY created_at DESC, finalization_id DESC LIMIT 1
     ) f ON TRUE
     LEFT JOIN LATERAL (
       SELECT COALESCE(json_agg(to_jsonb(q) ORDER BY q.qa_check_id), '[]'::json) AS qa_checks
       FROM compact_v5.qa_checks q
       WHERE q.dataset_id = b.dataset_id AND q.candidate_id = b.candidate_id
     ) qa ON TRUE
     LEFT JOIN LATERAL (
       SELECT string_agg(
         concat_ws(' ', e.quote_original_language, e.quote_english_translation),
         ' '
       ) AS evidence_search_text
       FROM compact_v5.candidate_evidence ce
       JOIN compact_v5.evidence e
         ON e.dataset_id = ce.dataset_id AND e.evidence_id = ce.evidence_id
       WHERE ce.dataset_id = b.dataset_id AND ce.candidate_id = b.candidate_id
     ) evid ON TRUE
     WHERE b.dataset_id = $1
     ORDER BY b.candidate_id`,
    [id],
  );
  const workflows = await candidateWorkflows(
    id,
    result.rows.map((row) => ({
      candidateId: String(row.candidate_id),
      revision: Number(row.assessment_revision ?? 0),
    })),
  );
  return result.rows.map((row) => {
      const sourceRow =
        row.raw_row && typeof row.raw_row === "object" ? row.raw_row : {};
      const baseline = Object.fromEntries(
        MASTER_FIELDS.map(([header, key]) => [
          key,
          row[key] ?? sourceRow[header] ?? null,
        ]),
      );
      baseline.country_code = row.country_code;
      const assessmentData =
        row.assessment_data && typeof row.assessment_data === "object"
          ? row.assessment_data
          : {};
      const assessment = { ...baseline, ...assessmentData };
      const qaChecks = row.qa_checks ?? [];
      const revision = Number(row.assessment_revision ?? 0);
      const workflow = workflows.get(String(row.candidate_id))!;
      const finalStatus = String(row.final_status ?? "Pending");
      const clusterRole = String(assessment.cluster_role ?? "");
      const count = finalCountGate({
        assessment,
        globalDecision: workflow.globalDecision,
        regionalDecision: workflow.regionalDecision,
        finalStatus,
        reviewResolution: workflow.reviewResolution,
        clusterRole,
        unresolvedDisagreement: workflow.unresolvedDisagreement,
      });
      return {
        ...row,
        ...assessment,
        candidate_id: row.candidate_id,
        candidate_stream: assessment.candidate_stream,
        country: row.country_code ?? row.country ?? baseline.country,
        baseline,
        source_row: sourceRow,
        current_assessment: assessment,
        assessment_revision: revision,
        global_review_decision: workflow.globalDecision,
        regional_confirmation_decision: workflow.regionalDecision,
        final_status: finalStatus,
        review_resolution: workflow.reviewResolution,
        cluster_role: clusterRole,
        six_criteria_pass: isSixCriteriaPass(assessment),
        count_in_final_reform_total: count ? 1 : 0,
        has_unresolved_disagreement: workflow.unresolvedDisagreement,
        qa_sample: qaChecks.length > 0,
        qa_checks: qaChecks,
      };
  });
}

router.get("/candidates", async (req: any, res): Promise<void> => {
  const id = datasetId(req);
  if (!id) return;
  const q = req.query as Record<string, string | undefined>;
  const invalidFilter = validateCandidateFilters(q);
  if (invalidFilter) {
    res.status(400).json({ error: invalidFilter });
    return;
  }
  let rows = await loadCandidates(id);
  rows = applyFilters(rows, q);
  const page = Math.max(1, Number.parseInt(q.page ?? "1", 10) || 1);
  const limit = Math.min(500, Math.max(1, Number.parseInt(q.limit ?? "50", 10) || 50));
  res.json({
    candidates: rows.slice((page - 1) * limit, page * limit),
    total: rows.length,
    page,
    limit,
    dataset_id: id,
  });
});

router.get("/candidates/:candidateId", async (req: any, res): Promise<void> => {
  const id = datasetId(req);
  if (!id) return;
  const candidateId = param(req.params.candidateId);
  const [candidate] = (await loadCandidates(id)).filter((r) => r.candidate_id === candidateId);
  if (!candidate) {
    res.status(404).json({ error: "Candidate not found in active dataset" });
    return;
  }
  const [evidence, relationships, events] = await Promise.all([
    pool.query(
      `SELECT e.*, ce.evidence_role AS link_role, ce.relationship_note,
              COALESCE(json_agg(r ORDER BY r.rectangle_id) FILTER (WHERE r.rectangle_id IS NOT NULL), '[]'::json) rectangles
       FROM compact_v5.candidate_evidence ce
       JOIN compact_v5.evidence e ON e.dataset_id = ce.dataset_id AND e.evidence_id = ce.evidence_id
       LEFT JOIN compact_v5.evidence_rectangles r ON r.dataset_id = e.dataset_id AND r.evidence_id = e.evidence_id
       WHERE ce.dataset_id = $1 AND ce.candidate_id = $2
     GROUP BY e.dataset_id, e.evidence_id, ce.evidence_role, ce.relationship_note
       ORDER BY CASE ce.evidence_role WHEN 'Canonical Action' THEN 1 WHEN 'Canonical Continuation' THEN 2 ELSE 3 END, e.evidence_id`,
      [id, candidateId],
    ),
    pool.query(
      `SELECT * FROM compact_v5.relationships
       WHERE dataset_id = $1 AND (source_candidate_id = $2 OR target_candidate_id = $2)
       ORDER BY relationship_id`,
      [id, candidateId],
    ),
    pool.query(
      `SELECT e.review_event_id AS event_id, e.candidate_id, e.reviewer_id, r.display_name AS reviewer_name,
              e.stage, e.decision, e.comment, e.assessment_revision, e.created_at,
              false AS identity_verified
       FROM compact_v5.review_events e
       JOIN public.reviewers r ON r.reviewer_id = e.reviewer_id
       WHERE e.dataset_id = $1 AND e.candidate_id = $2
       ORDER BY e.created_at, event_id`,
      [id, candidateId],
    ),
  ]);
  res.json({ ...candidate, evidence: evidence.rows, relationships: relationships.rows, review_events: events.rows });
});

router.get("/candidates/:candidateId/reviews", async (req: any, res): Promise<void> => {
  const id = datasetId(req);
  if (!id) return;
  const candidateId = param(req.params.candidateId);
  const result = await pool.query(
    `SELECT e.review_event_id AS event_id, e.candidate_id, e.reviewer_id, r.display_name AS reviewer_name,
            e.stage, e.decision, e.comment, e.assessment_revision, e.created_at,
            false AS identity_verified
     FROM compact_v5.review_events e
     JOIN public.reviewers r ON r.reviewer_id = e.reviewer_id
     WHERE e.dataset_id = $1 AND e.candidate_id = $2
     ORDER BY e.created_at, event_id`,
    [id, candidateId],
  );
  const assessment = await latestAssessment(id, candidateId);
  const workflow = assessment
    ? await candidateWorkflow(id, candidateId, Number(assessment.assessment_revision))
    : null;
  res.json({
    events: result.rows,
    has_unresolved_disagreement: workflow?.unresolvedDisagreement ?? false,
  });
});

router.post("/candidates/:candidateId/reviews", async (req: any, res): Promise<void> => {
  const id = datasetId(req);
  if (!id) return;
  const token = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : "";
  const reviewerId = token ? verifyReviewerToken(token) : null;
  if (!reviewerId) {
    res.status(401).json({ error: "A valid prototype reviewer token is required" });
    return;
  }
  const { stage, decision, comment, expected_assessment_revision: expected } = req.body ?? {};
  if (
    !Number.isInteger(expected) ||
    !["Global", "Regional"].includes(stage) ||
    !(stage === "Global" ? GLOBAL_DECISIONS : REGIONAL_DECISIONS).has(decision) ||
    (comment != null && typeof comment !== "string")
  ) {
    res.status(400).json({ error: "Invalid stage, decision, or expected_assessment_revision" });
    return;
  }
  const candidateId = param(req.params.candidateId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT candidate_id FROM compact_v5.candidate_baselines WHERE dataset_id = $1 AND candidate_id = $2 FOR UPDATE",
      [id, candidateId],
    );
    const assessment = await client.query(
      `SELECT assessment_revision FROM compact_v5.candidate_assessments
       WHERE dataset_id = $1 AND candidate_id = $2 ORDER BY assessment_revision DESC LIMIT 1`,
      [id, candidateId],
    );
    if (!assessment.rows[0]) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Candidate assessment not found" });
      return;
    }
    if (Number(assessment.rows[0].assessment_revision) !== expected) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "Assessment revision is stale", current_assessment_revision: assessment.rows[0].assessment_revision });
      return;
    }
    const inserted = await client.query(
      `WITH inserted AS (
         INSERT INTO compact_v5.review_events
           (dataset_id, candidate_id, reviewer_id, stage, decision, comment, assessment_revision)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING review_event_id, candidate_id, reviewer_id, stage, decision, comment, assessment_revision, created_at
       )
       SELECT i.review_event_id AS event_id, i.candidate_id, i.reviewer_id,
              r.display_name AS reviewer_name, i.stage, i.decision, i.comment,
              i.assessment_revision, i.created_at, false AS identity_verified
       FROM inserted i JOIN public.reviewers r ON r.reviewer_id = i.reviewer_id`,
      [id, candidateId, reviewerId, stage, decision, comment ?? null, expected],
    );
    await client.query("COMMIT");
    res.status(201).json(inserted.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

router.post("/candidates/:candidateId/assessment-proposals", async (req: any, res): Promise<void> => {
  const id = datasetId(req);
  if (!id) return;
  const token = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : "";
  const reviewerId = token ? verifyReviewerToken(token) : null;
  if (!reviewerId) {
    res.status(401).json({ error: "A valid prototype reviewer token is required" });
    return;
  }
  const candidateId = param(req.params.candidateId);
  const { expected_assessment_revision: expected, changes, reason } = req.body ?? {};
  if (
    !Number.isInteger(expected) ||
    !changes ||
    typeof changes !== "object" ||
    Array.isArray(changes) ||
    typeof reason !== "string" ||
    !reason.trim()
  ) {
    res.status(400).json({ error: "expected_assessment_revision, changes and reason are required" });
    return;
  }
  const workflowFields = new Set([
    "global_review_decision",
    "regional_confirmation_decision",
    "final_status",
    "count_in_final_reform_total",
    "review_resolution",
  ]);
  if (Object.keys(changes).some((key) => workflowFields.has(key))) {
    res.status(400).json({ error: "Workflow decisions and final status are controlled by review resolutions, not assessment proposals" });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT candidate_id FROM compact_v5.candidate_baselines WHERE dataset_id = $1 AND candidate_id = $2 FOR UPDATE",
      [id, candidateId],
    );
    const current = await client.query(
      `SELECT assessment_revision, to_jsonb(a) AS assessment_data FROM compact_v5.candidate_assessments a
       WHERE dataset_id = $1 AND candidate_id = $2 ORDER BY assessment_revision DESC LIMIT 1 FOR UPDATE`,
      [id, candidateId],
    );
    if (!current.rows[0]) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Candidate assessment not found" });
      return;
    }
    if (Number(current.rows[0].assessment_revision) !== expected) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "Assessment revision is stale", current_assessment_revision: current.rows[0].assessment_revision });
      return;
    }
    const allowedFields = new Set([
      "candidate_stream",
      "c1_explicit_commitment",
      "c2_discrete_actionable_mechanism",
      "c3_system_change",
      "c4_not_merely_implementation",
      "c5_distinct_reform_action",
      "c6_trackable_monitorable",
      "llm_decision_rationale",
      "cluster_role",
      "primary_pillar",
      "primary_scalable_solution",
      "additional_scalable_solutions",
      "primary_tier1_reform_domain",
      "tier2_reform_category",
      "secondary_reform_domain_tags",
      "lead_institution_actor",
      "water_financing_relevance",
      "temporal_status",
      "monitoring_completion_criterion",
      "reform_action_statement_english",
    ]);
    if (Object.keys(changes).some((key) => !allowedFields.has(key))) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: "One or more assessment fields are not editable" });
      return;
    }
    const nextData = { ...current.rows[0].assessment_data, ...changes };
    const criterionKeys = [
      "c1_explicit_commitment",
      "c2_discrete_actionable_mechanism",
      "c3_system_change",
      "c4_not_merely_implementation",
      "c5_distinct_reform_action",
      "c6_trackable_monitorable",
    ];
    if (criterionKeys.some((key) => ![0, 1, "0", "1"].includes(nextData[key]))) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: "Six criteria must be binary 0/1 values" });
      return;
    }
    if (!["High-confidence Reform Action", "Needs Human Review", "High-confidence Non-reform"].includes(nextData.candidate_stream)) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: "candidate_stream is invalid" });
      return;
    }
    if (![0, 1, "0", "1"].includes(nextData.water_financing_relevance)) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: "water_financing_relevance must be binary 0/1" });
      return;
    }
    if (
      !Array.isArray(nextData.additional_scalable_solutions) ||
      nextData.additional_scalable_solutions.some((value: unknown) => typeof value !== "string") ||
      !Array.isArray(nextData.secondary_reform_domain_tags) ||
      nextData.secondary_reform_domain_tags.some((value: unknown) => typeof value !== "string")
    ) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: "Scalable solutions and secondary domain tags must be arrays of strings" });
      return;
    }
    const nextRevision = expected + 1;
    const columns = [...allowedFields].filter((key) => key in nextData);
    const values: unknown[] = [id, candidateId, nextRevision];
    const placeholders = columns.map((column, index) => {
      values.push(nextData[column]);
      return `$${index + 4}`;
    });
    values.push(
      nextData.originating_analysis_version_id ?? nextData.analysis_version_id,
      reason,
      reviewerId,
    );
    const originIndex = values.length - 2;
    const reasonIndex = values.length - 1;
    const authorIndex = values.length;
    const inserted = await client.query(
      `INSERT INTO compact_v5.candidate_assessments
        (dataset_id, candidate_id, assessment_revision, ${columns.join(", ")}, originating_analysis_version_id, change_reason, created_by)
       VALUES ($1, $2, $3, ${placeholders.join(", ")}, $${originIndex}, $${reasonIndex}, $${authorIndex})
       RETURNING assessment_revision, to_jsonb(candidate_assessments) AS assessment_data, created_by AS author_id, change_reason, created_at`,
      values,
    );
    await client.query("COMMIT");
    res.status(201).json(inserted.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

router.post("/stage-resolutions", async (_req, res): Promise<void> => {
  res.status(403).json({
    error: "Stage resolution disabled: prototype name-selection sessions are not verified identities or coordinator assignments.",
  });
});

router.post("/candidates/:candidateId/finalizations", async (_req, res): Promise<void> => {
  res.status(403).json({
    error: "Finalization disabled until the actor has a verified identity and an explicit coordinator assignment.",
  });
});

router.post("/evidence/:evidenceId/corrections", async (req: any, res): Promise<void> => {
  const id = datasetId(req);
  if (!id) return;
  const token = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : "";
  const reviewerId = token ? verifyReviewerToken(token) : null;
  if (!reviewerId) {
    res.status(401).json({ error: "A valid prototype reviewer token is required" });
    return;
  }
  const { expected_assessment_revision: expected, correction, corrected_page: page, reason } = req.body ?? {};
  if (
    !Number.isInteger(expected) ||
    typeof reason !== "string" ||
    !reason.trim() ||
    !correction ||
    typeof correction !== "object" ||
    Array.isArray(correction) ||
    (page != null && (!Number.isInteger(page) || page < 1))
  ) {
    res.status(400).json({ error: "Expected revision, correction and reason are required" });
    return;
  }
  const evidenceId = param(req.params.evidenceId);
  const check = await pool.query(
    `SELECT ce.candidate_id FROM compact_v5.candidate_evidence ce
     WHERE ce.dataset_id = $1 AND ce.evidence_id = $2 LIMIT 1`,
    [id, evidenceId],
  );
  if (!check.rows[0]) {
    res.status(404).json({ error: "Evidence not found in active dataset" });
    return;
  }
  const candidateId = String(check.rows[0].candidate_id);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT candidate_id FROM compact_v5.candidate_baselines WHERE dataset_id = $1 AND candidate_id = $2 FOR UPDATE",
      [id, candidateId],
    );
    const assessment = await client.query(
      `SELECT assessment_revision FROM compact_v5.candidate_assessments
       WHERE dataset_id = $1 AND candidate_id = $2 ORDER BY assessment_revision DESC LIMIT 1`,
      [id, candidateId],
    );
    if (Number(assessment.rows[0]?.assessment_revision) !== expected) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "Assessment revision is stale", current_assessment_revision: assessment.rows[0]?.assessment_revision });
      return;
    }
    const inserted = await client.query(
      `INSERT INTO compact_v5.evidence_review_events
         (dataset_id, evidence_id, reviewer_id, correction, reason)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       RETURNING *`,
      [
        id,
        evidenceId,
        reviewerId,
        JSON.stringify({
          ...correction,
          expected_assessment_revision: expected,
          corrected_page: page ?? null,
          candidate_id: candidateId,
        }),
        reason,
      ],
    );
    await client.query("COMMIT");
    res.status(201).json(inserted.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

router.get("/evidence/:evidenceId", async (req: any, res): Promise<void> => {
  const id = datasetId(req);
  if (!id) return;
  const evidenceId = param(req.params.evidenceId);
  const result = await pool.query(
    `SELECT e.*,
            COALESCE((SELECT json_agg(ce ORDER BY ce.candidate_id)
                      FROM compact_v5.candidate_evidence ce
                      WHERE ce.dataset_id = e.dataset_id AND ce.evidence_id = e.evidence_id), '[]'::json) candidate_links,
            COALESCE((SELECT json_agg(r ORDER BY r.rectangle_id)
                      FROM compact_v5.evidence_rectangles r
                      WHERE r.dataset_id = e.dataset_id AND r.evidence_id = e.evidence_id), '[]'::json) rectangles
     FROM compact_v5.evidence e
     WHERE e.dataset_id = $1 AND e.evidence_id = $2`,
    [id, evidenceId],
  );
  if (!result.rows[0]) {
    res.status(404).json({ error: "Evidence not found in active dataset" });
    return;
  }
  res.json(result.rows[0]);
});

router.get("/relationships", async (req: any, res): Promise<void> => {
  const id = datasetId(req);
  if (!id) return;
  const candidateId = req.query.candidateId;
  const result = await pool.query(
    `SELECT * FROM compact_v5.relationships
     WHERE dataset_id = $1 AND ($2::text IS NULL OR source_candidate_id = $2 OR target_candidate_id = $2)
     ORDER BY relationship_id`,
    [id, candidateId ?? null],
  );
  res.json(result.rows);
});

router.get("/anchors/:anchorId", (_req, res): void => {
  res.status(410).json({ error: "Legacy anchors are unavailable for the active dataset; use linked evidence records." });
});

router.get("/stats", async (req: any, res): Promise<void> => {
  const id = datasetId(req);
  if (!id) return;
  const candidates = await loadCandidates(id);
  const by = (field: (r: any) => unknown) => {
    const counts = new Map<string, number>();
    for (const row of candidates) {
      const key = String(field(row) ?? "Unspecified");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts].map(([key, count]) => ({ key, count }));
  };
  const [documents, evidence, relationships, approved] = await Promise.all([
    pool.query("SELECT COUNT(*)::int count FROM compact_v5.documents WHERE dataset_id = $1", [id]),
    pool.query("SELECT COUNT(*)::int count FROM compact_v5.evidence WHERE dataset_id = $1", [id]),
    pool.query("SELECT COUNT(*)::int count FROM compact_v5.relationships WHERE dataset_id = $1", [id]),
    Promise.resolve(candidates.filter((r) => r.count_in_final_reform_total === 1).length),
  ]);
  res.json({
    dataset_id: id,
    total_candidates: candidates.length,
    total_documents: documents.rows[0].count,
    total_evidence: evidence.rows[0].count,
    total_relationships: relationships.rows[0].count,
    count_in_final_reform_total: approved,
    by_country: by((r) => r.country),
    by_stream: by((r) => r.candidate_stream),
    by_final_status: by((r) => r.final_status),
  });
});

router.get("/qa-checks", async (req: any, res): Promise<void> => {
  const id = datasetId(req);
  if (!id) return;
  const result = await pool.query("SELECT * FROM compact_v5.qa_checks WHERE dataset_id = $1 ORDER BY qa_check_id", [id]);
  res.json(result.rows);
});

router.get("/documents", async (req: any, res): Promise<void> => {
  const id = datasetId(req);
  if (!id) return;
  const result = await pool.query("SELECT * FROM compact_v5.documents WHERE dataset_id = $1 ORDER BY country_code, document_id", [id]);
  res.json(result.rows);
});

router.get("/documents/:documentId", async (req: any, res): Promise<void> => {
  const id = datasetId(req);
  if (!id) return;
  const result = await pool.query(
    "SELECT * FROM compact_v5.documents WHERE dataset_id = $1 AND document_id = $2",
    [id, param(req.params.documentId)],
  );
  if (!result.rows[0]) {
    res.status(404).json({ error: "Document not found in active dataset" });
    return;
  }
  res.json(result.rows[0]);
});

async function readPdfAsset(assetPath: string, expectedSha256: string): Promise<Buffer> {
  const normalized = assetPath.replace(/\\/g, "/");
  const relativeAsset = normalized.startsWith("source_package/documents/")
    ? normalized.slice("source_package/documents/".length)
    : normalized.startsWith("documents/")
      ? normalized.slice("documents/".length)
      : normalized;
  if (
    !relativeAsset ||
    path.isAbsolute(normalized) ||
    /^[A-Za-z]:/.test(normalized) ||
    relativeAsset.split("/").some((part) => part === ".." || part === "")
  ) {
    throw new Error("Document has no safe trusted PDF asset path");
  }

  const roots = new Set([
    process.cwd(),
    path.resolve(process.cwd(), "../.."),
    path.resolve(SERVER_MODULE_DIR, "../../.."),
  ]);
  const candidates = new Set<string>();
  for (const root of roots) {
    candidates.add(path.resolve(root, "source_package/documents", relativeAsset));
    candidates.add(path.resolve(root, "documents", relativeAsset));
  }
  candidates.add(path.resolve(SERVER_MODULE_DIR, "documents", relativeAsset));

  let foundFile = false;
  for (const filePath of candidates) {
    try {
      const bytes = await fs.readFile(filePath);
      foundFile = true;
      const actualHash = createHash("sha256").update(bytes).digest("hex");
      if (actualHash.toLowerCase() === expectedSha256.toLowerCase()) return bytes;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  if (foundFile) {
    throw new Error("PDF asset hash mismatch; refusing to serve bytes under this document binding");
  }
  throw new Error("PDF asset is unavailable from source_package/documents or built dist/documents");
}

router.get("/documents/:documentId/pdf", async (req: any, res): Promise<void> => {
  const id = datasetId(req);
  if (!id) return;
  const result = await pool.query(
    "SELECT asset_path AS pdf_asset_path, sha256 FROM compact_v5.documents WHERE dataset_id = $1 AND document_id = $2",
    [id, param(req.params.documentId)],
  );
  const doc = result.rows[0];
  if (!doc) {
    res.status(404).json({ error: "Document not found in active dataset" });
    return;
  }
  const asset = String(doc.pdf_asset_path ?? "");
  if (!asset) {
    res.status(503).json({ error: "Document has no safe trusted PDF asset path" });
    return;
  }
  try {
    const bytes = await readPdfAsset(asset, String(doc.sha256 ?? ""));
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${path.basename(asset)}"`);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Access-Control-Expose-Headers", "X-Document-SHA256, X-Content-SHA256");
    res.setHeader("X-Document-SHA256", actualHash);
    res.setHeader("X-Content-SHA256", actualHash);
    res.send(bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : "PDF asset verification failed";
    const status = message.includes("unavailable") ? 404 : 503;
    res.status(status).json({ error: message });
  }
});

async function exportCandidates(req: any, res: any, finalOnly: boolean) {
  const id = datasetId(req);
  if (!id) return;
  const query = req.query as Record<string, string | undefined>;
  const invalidFilter = validateCandidateFilters(query);
  if (invalidFilter) {
    res.status(400).json({ error: invalidFilter });
    return;
  }
  let rows = await loadCandidates(id);
  rows = applyFilters(rows, query);
  if (finalOnly) rows = rows.filter((row) => row.count_in_final_reform_total === 1);
  const headers = [
    ...MASTER_FIELDS.map(([header]) => header),
    "Current_Assessment_Revision",
    "Baseline_Candidate_Stream",
    "Count_in_Final_Reform_Total_Server_Derived",
  ];
  csv(
    rows.map((row) => [
      ...MASTER_FIELDS.map(([, key]) => {
        if (key === "global_review_decision") return row.global_review_decision;
        if (key === "regional_confirmation_decision") return row.regional_confirmation_decision;
        if (key === "final_status") return row.final_status;
        if (key === "review_resolution") return row.review_resolution;
        if (key === "count_in_final_reform_total") return row.count_in_final_reform_total;
        if (key === "six_criteria_pass") return row.six_criteria_pass ? 1 : 0;
        return Object.prototype.hasOwnProperty.call(row.current_assessment, key)
          ? row.current_assessment[key]
          : row.baseline[key] ?? null;
      }),
      row.assessment_revision,
      row.baseline.candidate_stream,
      row.count_in_final_reform_total,
    ]),
    headers,
    finalOnly ? "final-approved.csv" : "master.csv",
    res,
  );
}
router.get("/export/master.csv", async (req: any, res) => exportCandidates(req, res, false));
router.get("/export/final-approved.csv", async (req: any, res) => exportCandidates(req, res, true));

router.get("/export/review-history.csv", async (req: any, res): Promise<void> => {
  const id = datasetId(req);
  if (!id) return;
  const result = await pool.query(
    `SELECT e.review_event_id AS event_id, e.dataset_id, e.candidate_id, e.reviewer_id,
            r.display_name AS reviewer_name, e.stage, e.decision, e.comment, e.assessment_revision, e.created_at
     FROM compact_v5.review_events e
     JOIN public.reviewers r ON r.reviewer_id = e.reviewer_id
     WHERE e.dataset_id = $1 ORDER BY e.created_at, event_id`,
    [id],
  );
  const headers = ["event_id", "dataset_id", "candidate_id", "reviewer_id", "reviewer_name", "stage", "decision", "comment", "assessment_revision", "created_at"];
  csv(result.rows.map((row) => headers.map((key) => row[key])), headers, "review-history.csv", res);
});

router.get("/export/decisions.csv", async (req: any, res): Promise<void> => {
  const id = datasetId(req);
  if (!id) return;
  const result = await pool.query(
    `SELECT e.review_event_id AS event_id, e.dataset_id, e.candidate_id, e.reviewer_id,
            r.display_name AS reviewer_name, e.stage, e.decision, e.comment, e.assessment_revision, e.created_at
     FROM compact_v5.review_events e
     JOIN public.reviewers r ON r.reviewer_id = e.reviewer_id
     WHERE e.dataset_id = $1 ORDER BY e.created_at, event_id`,
    [id],
  );
  const headers = ["event_id", "dataset_id", "candidate_id", "reviewer_id", "reviewer_name", "stage", "decision", "comment", "assessment_revision", "created_at"];
  csv(result.rows.map((row) => headers.map((key) => row[key])), headers, "decisions.csv", res);
});

router.get("/export/evidence.csv", async (req: any, res): Promise<void> => {
  const id = datasetId(req);
  if (!id) return;
  const result = await pool.query(
    `SELECT e.*, ce.candidate_id, ce.evidence_role AS link_role, ce.relationship_note,
            r.rectangle_id, r.pdf_page, r.x0_normalized, r.y0_normalized, r.x1_normalized, r.y1_normalized,
            d.country_code, d.document_title, d.official_source_url, d.sha256 AS document_sha256, d.asset_path,
            COALESCE((
              SELECT json_agg(rel ORDER BY rel.relationship_id)
              FROM compact_v5.relationships rel
              WHERE rel.dataset_id = e.dataset_id
                AND (rel.source_candidate_id = ce.candidate_id OR rel.target_candidate_id = ce.candidate_id)
            ), '[]'::json) candidate_relationships
     FROM compact_v5.evidence e
     LEFT JOIN compact_v5.candidate_evidence ce ON ce.dataset_id = e.dataset_id AND ce.evidence_id = e.evidence_id
     LEFT JOIN compact_v5.evidence_rectangles r ON r.dataset_id = e.dataset_id AND r.evidence_id = e.evidence_id
     JOIN compact_v5.documents d ON d.dataset_id = e.dataset_id AND d.document_id = e.document_id
     WHERE e.dataset_id = $1 ORDER BY e.evidence_id, ce.candidate_id, r.rectangle_id`,
    [id],
  );
  const headers = Object.keys(result.rows[0] ?? { evidence_id: "" });
  csv(result.rows.map((row) => headers.map((key) => row[key])), headers, "evidence-provenance.csv", res);
});

export default router;