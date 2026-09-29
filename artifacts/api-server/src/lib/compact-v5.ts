import { pool } from "@workspace/db";

export type DatasetContext = { datasetId: string } | null;

/**
 * Importer contract assumed by the API:
 * compact_v5.dataset_state has a singleton active_dataset_id row;
 * candidate_baselines stores immutable typed columns plus source_row JSONB;
 * candidate_assessments stores typed revision rows;
 * all dataset-owned tables carry dataset_id.
 */
export async function activeDataset(): Promise<DatasetContext> {
  try {
    const result = await pool.query(
      `SELECT active_dataset_id AS dataset_id
       FROM compact_v5.dataset_state
       WHERE active_dataset_id IS NOT NULL
       LIMIT 1`,
    );
    return result.rows[0]?.dataset_id
      ? { datasetId: String(result.rows[0].dataset_id) }
      : null;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "3F000" || code === "42P01") return null;
    throw error;
  }
}

export async function latestAssessment(datasetId: string, candidateId: string) {
  const result = await pool.query(
    `SELECT assessment_revision, to_jsonb(a) AS assessment_data, created_by AS author_id, change_reason, created_at
     FROM compact_v5.candidate_assessments a
     WHERE dataset_id = $1 AND candidate_id = $2
     ORDER BY assessment_revision DESC
     LIMIT 1`,
    [datasetId, candidateId],
  );
  return result.rows[0] ?? null;
}

export function isSixCriteriaPass(data: Record<string, unknown>): boolean {
  return [1, 2, 3, 4, 5, 6].every((n) => {
    const value =
      data[`c${n}`] ??
      data[`criterion_${n}`] ??
      data[`c${n}_` + [
        "",
        "explicit_commitment",
        "discrete_actionable_mechanism",
        "system_change",
        "not_merely_implementation",
        "distinct_reform_action",
        "trackable_monitorable",
      ][n]];
    return value === 1 || value === true || value === "1";
  });
}

export function finalCountGate(input: {
  assessment: Record<string, unknown>;
  globalDecision?: string | null;
  regionalDecision?: string | null;
  finalStatus?: string | null;
  reviewResolution?: string | null;
  clusterRole?: string | null;
  unresolvedDisagreement?: boolean;
  revisionIsCurrent?: boolean;
}): boolean {
  return (
    isSixCriteriaPass(input.assessment) &&
    input.finalStatus === "Approved Reform" &&
    input.globalDecision === "Approve" &&
    (input.regionalDecision === "Confirm" ||
      (input.regionalDecision === "Confirm with Revision" &&
        input.reviewResolution === "Resolved")) &&
    ["Standalone", "Primary", "Secondary"].includes(input.clusterRole ?? "") &&
    !input.unresolvedDisagreement &&
    input.revisionIsCurrent !== false
  );
}

export async function candidateWorkflow(datasetId: string, candidateId: string, revision: number) {
  const [result, events] = await Promise.all([
    pool.query(
    `SELECT stage, decision, stage_resolution_id
     FROM compact_v5.stage_resolutions
     WHERE dataset_id = $1 AND candidate_id = $2 AND assessment_revision = $3
     ORDER BY created_at DESC, stage_resolution_id DESC`,
    [datasetId, candidateId, revision],
    ),
    pool.query(
      `SELECT stage, reviewer_id, decision, created_at, review_event_id
       FROM compact_v5.review_events
       WHERE dataset_id = $1 AND candidate_id = $2 AND assessment_revision = $3
       ORDER BY created_at DESC, review_event_id DESC`,
      [datasetId, candidateId, revision],
    ),
  ]);
  return deriveWorkflow(result.rows, events.rows);
}

export async function candidateWorkflows(
  datasetId: string,
  candidates: { candidateId: string; revision: number }[],
) {
  if (candidates.length === 0) return new Map<string, Awaited<ReturnType<typeof candidateWorkflow>>>();
  const ids = candidates.map((candidate) => candidate.candidateId);
  const revisions = candidates.map((candidate) => candidate.revision);
  const [resolutions, events] = await Promise.all([
    pool.query(
      `WITH current_revisions AS (
         SELECT * FROM unnest($2::text[], $3::integer[]) AS current(candidate_id, revision)
       )
       SELECT DISTINCT ON (s.candidate_id, s.stage) s.candidate_id, s.stage, s.decision, s.stage_resolution_id
       FROM current_revisions c
       JOIN compact_v5.stage_resolutions s
         ON s.dataset_id = $1 AND s.candidate_id = c.candidate_id AND s.assessment_revision = c.revision
       ORDER BY s.candidate_id, s.stage, s.created_at DESC, s.stage_resolution_id DESC`,
      [datasetId, ids, revisions],
    ),
    pool.query(
      `WITH current_revisions AS (
         SELECT * FROM unnest($2::text[], $3::integer[]) AS current(candidate_id, revision)
       )
       SELECT DISTINCT ON (e.candidate_id, e.stage, e.reviewer_id)
              e.candidate_id, e.stage, e.reviewer_id, e.decision, e.created_at, e.review_event_id
       FROM current_revisions c
       JOIN compact_v5.review_events e
         ON e.dataset_id = $1 AND e.candidate_id = c.candidate_id AND e.assessment_revision = c.revision
       ORDER BY e.candidate_id, e.stage, e.reviewer_id, e.created_at DESC, e.review_event_id DESC`,
      [datasetId, ids, revisions],
    ),
  ]);
  const resultByCandidate = new Map<string, Record<string, unknown>[]>();
  const eventsByCandidate = new Map<string, Record<string, unknown>[]>();
  for (const row of resolutions.rows) {
    const items = resultByCandidate.get(String(row.candidate_id)) ?? [];
    items.push(row);
    resultByCandidate.set(String(row.candidate_id), items);
  }
  for (const row of events.rows) {
    const items = eventsByCandidate.get(String(row.candidate_id)) ?? [];
    items.push(row);
    eventsByCandidate.set(String(row.candidate_id), items);
  }
  return new Map(
    candidates.map((candidate) => [
      candidate.candidateId,
      deriveWorkflow(
        resultByCandidate.get(candidate.candidateId) ?? [],
        eventsByCandidate.get(candidate.candidateId) ?? [],
      ),
    ]),
  );
}

function deriveWorkflow(resolutionRows: Record<string, unknown>[], eventRows: Record<string, unknown>[]) {
  const byStage = new Map<string, Record<string, unknown>>();
  for (const row of resolutionRows) {
    if (!byStage.has(String(row.stage))) byStage.set(String(row.stage), row);
  }
  const global = byStage.get("Global") ?? byStage.get("global");
  const regional = byStage.get("Regional") ?? byStage.get("regional");
  const latestPerReviewer = new Map<string, string>();
  for (const event of eventRows) {
    const key = `${event.stage}:${event.reviewer_id}`;
    if (!latestPerReviewer.has(key)) latestPerReviewer.set(key, String(event.decision));
  }
  const decisionsByStage = new Map<string, Set<string>>();
  for (const [key, decision] of latestPerReviewer) {
    const stage = key.slice(0, key.lastIndexOf(":"));
    const values = decisionsByStage.get(stage) ?? new Set<string>();
    values.add(decision);
    decisionsByStage.set(stage, values);
  }
  const resolvedStages = new Set(
    [global ? "Global" : null, regional ? "Regional" : null].filter(Boolean),
  );
  const unresolvedEventDisagreement = [...decisionsByStage.entries()].some(
    ([stage, values]) => values.size > 1 && !resolvedStages.has(stage),
  );
  return {
    globalDecision: (global?.decision as string | undefined) ?? null,
    regionalDecision: (regional?.decision as string | undefined) ?? null,
    reviewResolution: null,
    unresolvedDisagreement:
      unresolvedEventDisagreement ||
      false,
  };
}
