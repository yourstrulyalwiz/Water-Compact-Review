-- Migration 003: isolated, non-destructive schema for Water Compact v5.
-- Applying this migration does not modify or redirect the legacy public dataset.
-- A NULL active_dataset_id means the application remains on its legacy source.
BEGIN;

CREATE SCHEMA IF NOT EXISTS compact_v5;

CREATE TABLE IF NOT EXISTS compact_v5.datasets (
  dataset_id text PRIMARY KEY,
  methodology_version text NOT NULL,
  status text NOT NULL DEFAULT 'staging'
    CHECK (status IN ('staging', 'staged', 'verified', 'active', 'archived')),
  source_fingerprint text NOT NULL,
  validation_report jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  activated_at timestamptz
);

CREATE TABLE IF NOT EXISTS compact_v5.dataset_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  active_dataset_id text REFERENCES compact_v5.datasets(dataset_id),
  previous_active_dataset_id text REFERENCES compact_v5.datasets(dataset_id),
  changed_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO compact_v5.dataset_state(singleton, active_dataset_id)
VALUES (true, NULL)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS compact_v5.import_batches (
  batch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id text NOT NULL UNIQUE REFERENCES compact_v5.datasets(dataset_id),
  source_fingerprint text NOT NULL,
  status text NOT NULL CHECK (status IN ('staging', 'staged', 'verified', 'activated', 'failed')),
  diagnostics jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS compact_v5.import_files (
  dataset_id text NOT NULL,
  batch_id uuid NOT NULL REFERENCES compact_v5.import_batches(batch_id),
  file_kind text NOT NULL,
  source_path text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  PRIMARY KEY (dataset_id, source_path),
  FOREIGN KEY (dataset_id) REFERENCES compact_v5.datasets(dataset_id)
);

CREATE TABLE IF NOT EXISTS compact_v5.documents (
  dataset_id text NOT NULL REFERENCES compact_v5.datasets(dataset_id),
  document_id text NOT NULL,
  country_code text NOT NULL CHECK (country_code IN ('KHM', 'SLE', 'JAM', 'COD')),
  country text NOT NULL,
  document_title text NOT NULL,
  source_language text NOT NULL,
  document_version text,
  source_file_name text,
  source_library_id text,
  official_source_url text,
  repository_source text,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  pdf_page_count integer NOT NULL CHECK (pdf_page_count > 0),
  asset_path text NOT NULL CHECK (asset_path !~ '(^/|(^|/)\.\.(/|$))'),
  page_numbering_basis text,
  coordinate_system text,
  extraction_limitations text,
  raw_row jsonb NOT NULL,
  PRIMARY KEY (dataset_id, document_id),
  UNIQUE (dataset_id, country_code),
  UNIQUE (dataset_id, document_id, country_code)
);

CREATE TABLE IF NOT EXISTS compact_v5.analysis_runs (
  dataset_id text NOT NULL REFERENCES compact_v5.datasets(dataset_id),
  analysis_run_id text NOT NULL,
  methodology_version text,
  schema_version text,
  analysis_date date,
  baseline text,
  unit_of_analysis text,
  coverage text,
  status text,
  raw_row jsonb NOT NULL,
  PRIMARY KEY (dataset_id, analysis_run_id)
);

CREATE TABLE IF NOT EXISTS compact_v5.candidate_baselines (
  dataset_id text NOT NULL REFERENCES compact_v5.datasets(dataset_id),
  candidate_id text NOT NULL,
  country text NOT NULL,
  country_code text NOT NULL CHECK (country_code IN ('KHM', 'SLE', 'JAM', 'COD')),
  source_language text,
  source_reference text,
  compact_form text,
  evidence_passage_original_language text,
  evidence_passage_english_translation text,
  reform_action_text_original_language text,
  reform_action_text_english_translation text,
  candidate_stream text NOT NULL CHECK (candidate_stream IN (
    'High-confidence Reform Action', 'Needs Human Review', 'High-confidence Non-reform'
  )),
  c1_explicit_commitment smallint NOT NULL CHECK (c1_explicit_commitment IN (0, 1)),
  c2_discrete_actionable_mechanism smallint NOT NULL CHECK (c2_discrete_actionable_mechanism IN (0, 1)),
  c3_system_change smallint NOT NULL CHECK (c3_system_change IN (0, 1)),
  c4_not_merely_implementation smallint NOT NULL CHECK (c4_not_merely_implementation IN (0, 1)),
  c5_distinct_reform_action smallint NOT NULL CHECK (c5_distinct_reform_action IN (0, 1)),
  c6_trackable_monitorable smallint NOT NULL CHECK (c6_trackable_monitorable IN (0, 1)),
  six_criteria_pass smallint NOT NULL CHECK (six_criteria_pass IN (0, 1)),
  llm_decision_rationale text,
  cluster_id text,
  cluster_role text,
  parent_reform_action_id text,
  primary_pillar text,
  primary_scalable_solution text,
  additional_scalable_solutions text[] NOT NULL DEFAULT '{}',
  primary_tier1_reform_domain text,
  tier2_reform_category text,
  secondary_reform_domain_tags text[] NOT NULL DEFAULT '{}',
  lead_institution_actor text,
  water_financing_relevance smallint NOT NULL CHECK (water_financing_relevance IN (0, 1)),
  temporal_status text,
  monitoring_completion_criterion text,
  global_review_decision text,
  regional_confirmation_decision text,
  final_status text,
  count_in_final_reform_total smallint NOT NULL CHECK (count_in_final_reform_total IN (0, 1)),
  reform_action_statement_english text,
  document_id text NOT NULL,
  analysis_run_id text NOT NULL,
  analysis_version_id text NOT NULL,
  global_review_comment text,
  regional_comment text,
  review_resolution text,
  source_row jsonb NOT NULL,
  imported_batch_id uuid NOT NULL REFERENCES compact_v5.import_batches(batch_id),
  PRIMARY KEY (dataset_id, candidate_id),
  FOREIGN KEY (dataset_id, document_id) REFERENCES compact_v5.documents(dataset_id, document_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (dataset_id, analysis_run_id) REFERENCES compact_v5.analysis_runs(dataset_id, analysis_run_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (dataset_id, parent_reform_action_id) REFERENCES compact_v5.candidate_baselines(dataset_id, candidate_id)
    DEFERRABLE INITIALLY DEFERRED,
  CHECK (candidate_id ~ '^(KHM|SLE|JAM|COD)-RA-[0-9]{3,}[A-Z]*$'),
  CHECK (split_part(candidate_id, '-RA-', 1) = country_code),
  CHECK (parent_reform_action_id IS NULL OR parent_reform_action_id <> candidate_id),
  CHECK (six_criteria_pass = CASE WHEN c1_explicit_commitment = 1 AND c2_discrete_actionable_mechanism = 1
    AND c3_system_change = 1 AND c4_not_merely_implementation = 1
    AND c5_distinct_reform_action = 1 AND c6_trackable_monitorable = 1 THEN 1 ELSE 0 END)
);
CREATE INDEX IF NOT EXISTS candidate_baselines_country_stream_idx
  ON compact_v5.candidate_baselines(dataset_id, country_code, candidate_stream);

CREATE TABLE IF NOT EXISTS compact_v5.candidate_assessments (
  dataset_id text NOT NULL,
  candidate_id text NOT NULL,
  assessment_revision integer NOT NULL CHECK (assessment_revision > 0),
  candidate_stream text NOT NULL CHECK (candidate_stream IN (
    'High-confidence Reform Action', 'Needs Human Review', 'High-confidence Non-reform'
  )),
  c1_explicit_commitment smallint NOT NULL CHECK (c1_explicit_commitment IN (0, 1)),
  c2_discrete_actionable_mechanism smallint NOT NULL CHECK (c2_discrete_actionable_mechanism IN (0, 1)),
  c3_system_change smallint NOT NULL CHECK (c3_system_change IN (0, 1)),
  c4_not_merely_implementation smallint NOT NULL CHECK (c4_not_merely_implementation IN (0, 1)),
  c5_distinct_reform_action smallint NOT NULL CHECK (c5_distinct_reform_action IN (0, 1)),
  c6_trackable_monitorable smallint NOT NULL CHECK (c6_trackable_monitorable IN (0, 1)),
  llm_decision_rationale text,
  cluster_role text,
  primary_pillar text,
  primary_scalable_solution text,
  additional_scalable_solutions text[] NOT NULL DEFAULT '{}',
  primary_tier1_reform_domain text,
  tier2_reform_category text,
  secondary_reform_domain_tags text[] NOT NULL DEFAULT '{}',
  lead_institution_actor text,
  water_financing_relevance smallint NOT NULL CHECK (water_financing_relevance IN (0, 1)),
  temporal_status text,
  monitoring_completion_criterion text,
  reform_action_statement_english text,
  originating_analysis_version_id text NOT NULL,
  change_reason text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dataset_id, candidate_id, assessment_revision),
  FOREIGN KEY (dataset_id, candidate_id)
    REFERENCES compact_v5.candidate_baselines(dataset_id, candidate_id)
    DEFERRABLE INITIALLY DEFERRED,
  CHECK (assessment_revision <> 1 OR change_reason = 'Imported baseline')
);
ALTER TABLE compact_v5.candidate_baselines ALTER COLUMN water_financing_relevance SET NOT NULL;
ALTER TABLE compact_v5.candidate_assessments ALTER COLUMN water_financing_relevance SET NOT NULL;

CREATE TABLE IF NOT EXISTS compact_v5.evidence (
  dataset_id text NOT NULL,
  evidence_id text NOT NULL,
  document_id text NOT NULL,
  pdf_page integer NOT NULL CHECK (pdf_page > 0),
  printed_page_label text,
  section_or_table text,
  quote_original_language text,
  quote_english_translation text,
  text_prefix text,
  text_suffix text,
  page_char_start integer CHECK (page_char_start IS NULL OR page_char_start >= 0),
  page_char_end integer CHECK (page_char_end IS NULL OR page_char_end >= 0),
  quote_sha256 text,
  location_status text,
  match_method text,
  extraction_method text,
  analysis_run_id text NOT NULL,
  raw_row jsonb NOT NULL,
  PRIMARY KEY (dataset_id, evidence_id),
  FOREIGN KEY (dataset_id, document_id) REFERENCES compact_v5.documents(dataset_id, document_id),
  FOREIGN KEY (dataset_id, analysis_run_id) REFERENCES compact_v5.analysis_runs(dataset_id, analysis_run_id),
  CHECK (page_char_start IS NULL OR page_char_end IS NULL OR page_char_end >= page_char_start)
);

CREATE TABLE IF NOT EXISTS compact_v5.candidate_evidence (
  dataset_id text NOT NULL,
  candidate_id text NOT NULL,
  evidence_id text NOT NULL,
  evidence_role text NOT NULL,
  relationship_note text,
  analysis_run_id text NOT NULL,
  raw_row jsonb NOT NULL,
  PRIMARY KEY (dataset_id, candidate_id, evidence_id),
  FOREIGN KEY (dataset_id, candidate_id) REFERENCES compact_v5.candidate_baselines(dataset_id, candidate_id),
  FOREIGN KEY (dataset_id, evidence_id) REFERENCES compact_v5.evidence(dataset_id, evidence_id),
  FOREIGN KEY (dataset_id, analysis_run_id) REFERENCES compact_v5.analysis_runs(dataset_id, analysis_run_id)
);

CREATE TABLE IF NOT EXISTS compact_v5.evidence_rectangles (
  dataset_id text NOT NULL,
  rectangle_id text NOT NULL,
  evidence_id text NOT NULL,
  pdf_page integer NOT NULL CHECK (pdf_page > 0),
  x0 double precision NOT NULL,
  y0 double precision NOT NULL,
  x1 double precision NOT NULL,
  y1 double precision NOT NULL,
  x0_normalized double precision NOT NULL CHECK (x0_normalized BETWEEN 0 AND 1),
  y0_normalized double precision NOT NULL CHECK (y0_normalized BETWEEN 0 AND 1),
  x1_normalized double precision NOT NULL CHECK (x1_normalized BETWEEN 0 AND 1),
  y1_normalized double precision NOT NULL CHECK (y1_normalized BETWEEN 0 AND 1),
  page_width_points double precision NOT NULL CHECK (page_width_points > 0),
  page_height_points double precision NOT NULL CHECK (page_height_points > 0),
  coordinate_origin text,
  coordinate_unit text,
  page_rotation integer NOT NULL DEFAULT 0,
  raw_row jsonb NOT NULL,
  PRIMARY KEY (dataset_id, rectangle_id),
  FOREIGN KEY (dataset_id, evidence_id) REFERENCES compact_v5.evidence(dataset_id, evidence_id),
  CHECK (x0 <= x1 AND y0 <= y1),
  CHECK (x0_normalized <= x1_normalized AND y0_normalized <= y1_normalized),
  CHECK (page_rotation IN (0, 90, 180, 270))
);
CREATE INDEX IF NOT EXISTS evidence_rectangles_evidence_page_idx
  ON compact_v5.evidence_rectangles(dataset_id, evidence_id, pdf_page);

CREATE TABLE IF NOT EXISTS compact_v5.relationships (
  dataset_id text NOT NULL,
  relationship_id text NOT NULL,
  source_candidate_id text NOT NULL,
  target_candidate_id text NOT NULL,
  relationship_type text NOT NULL,
  rationale text,
  status text,
  raw_row jsonb NOT NULL,
  PRIMARY KEY (dataset_id, relationship_id),
  FOREIGN KEY (dataset_id, source_candidate_id) REFERENCES compact_v5.candidate_baselines(dataset_id, candidate_id),
  FOREIGN KEY (dataset_id, target_candidate_id) REFERENCES compact_v5.candidate_baselines(dataset_id, candidate_id),
  CHECK (source_candidate_id <> target_candidate_id)
);

CREATE TABLE IF NOT EXISTS compact_v5.id_crosswalk (
  dataset_id text NOT NULL,
  scan_id text NOT NULL,
  candidate_id text NOT NULL,
  first_recorded_pdf_page integer CHECK (first_recorded_pdf_page IS NULL OR first_recorded_pdf_page > 0),
  disposition text,
  reconciliation_note text,
  raw_row jsonb NOT NULL,
  PRIMARY KEY (dataset_id, scan_id),
  FOREIGN KEY (dataset_id, candidate_id) REFERENCES compact_v5.candidate_baselines(dataset_id, candidate_id)
);

CREATE TABLE IF NOT EXISTS compact_v5.scan_log (
  dataset_id text NOT NULL,
  document_id text NOT NULL,
  pdf_page integer NOT NULL CHECK (pdf_page > 0),
  review_method text,
  screening_note text,
  linked_candidate_ids text,
  scan_status text,
  raw_row jsonb NOT NULL,
  PRIMARY KEY (dataset_id, document_id, pdf_page),
  FOREIGN KEY (dataset_id, document_id) REFERENCES compact_v5.documents(dataset_id, document_id)
);

CREATE TABLE IF NOT EXISTS compact_v5.qa_checks (
  qa_check_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dataset_id text NOT NULL REFERENCES compact_v5.datasets(dataset_id),
  check_name text NOT NULL,
  candidate_id text,
  status text,
  detail text,
  raw_row jsonb NOT NULL,
  FOREIGN KEY (dataset_id, candidate_id) REFERENCES compact_v5.candidate_baselines(dataset_id, candidate_id)
);

CREATE TABLE IF NOT EXISTS compact_v5.taxonomy_categories (
  dataset_id text NOT NULL REFERENCES compact_v5.datasets(dataset_id),
  tier1_code text NOT NULL,
  tier1_domain text NOT NULL,
  tier2_category text NOT NULL,
  list_status text,
  methodology_version text NOT NULL,
  PRIMARY KEY (dataset_id, tier1_code, tier1_domain, tier2_category)
);

CREATE TABLE IF NOT EXISTS compact_v5.scalable_solutions (
  dataset_id text NOT NULL REFERENCES compact_v5.datasets(dataset_id),
  code text NOT NULL,
  label text NOT NULL,
  source_url text,
  source_location text,
  coding_note text,
  methodology_version text NOT NULL,
  PRIMARY KEY (dataset_id, code)
);

CREATE TABLE IF NOT EXISTS compact_v5.field_definitions (
  dataset_id text NOT NULL REFERENCES compact_v5.datasets(dataset_id),
  field_kind text NOT NULL CHECK (field_kind IN ('codebook', 'readme')),
  field_key text NOT NULL,
  definition text NOT NULL,
  position integer,
  methodology_version text NOT NULL,
  PRIMARY KEY (dataset_id, field_kind, field_key)
);

CREATE TABLE IF NOT EXISTS compact_v5.review_events (
  review_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id text NOT NULL,
  candidate_id text NOT NULL,
  assessment_revision integer NOT NULL,
  reviewer_id uuid NOT NULL REFERENCES public.reviewers(reviewer_id),
  stage text NOT NULL CHECK (stage IN ('Global', 'Regional')),
  decision text NOT NULL,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (dataset_id, candidate_id, assessment_revision)
    REFERENCES compact_v5.candidate_assessments(dataset_id, candidate_id, assessment_revision)
);
CREATE INDEX IF NOT EXISTS review_events_candidate_revision_idx
  ON compact_v5.review_events(dataset_id, candidate_id, stage, assessment_revision, created_at);

CREATE TABLE IF NOT EXISTS compact_v5.stage_resolutions (
  stage_resolution_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id text NOT NULL,
  candidate_id text NOT NULL,
  assessment_revision integer NOT NULL,
  reviewer_id uuid NOT NULL REFERENCES public.reviewers(reviewer_id),
  stage text NOT NULL CHECK (stage IN ('Global', 'Regional')),
  decision text NOT NULL,
  rationale text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (dataset_id, candidate_id, assessment_revision)
    REFERENCES compact_v5.candidate_assessments(dataset_id, candidate_id, assessment_revision)
);

CREATE TABLE IF NOT EXISTS compact_v5.finalizations (
  finalization_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id text NOT NULL,
  candidate_id text NOT NULL,
  assessment_revision integer NOT NULL,
  final_status text NOT NULL CHECK (final_status IN ('Approved Reform', 'Rejected Non-reform', 'Consolidated', 'Pending')),
  actor_reviewer_id uuid NOT NULL REFERENCES public.reviewers(reviewer_id),
  reason text NOT NULL,
  survivor_candidate_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (dataset_id, candidate_id, assessment_revision)
    REFERENCES compact_v5.candidate_assessments(dataset_id, candidate_id, assessment_revision),
  FOREIGN KEY (dataset_id, survivor_candidate_id)
    REFERENCES compact_v5.candidate_baselines(dataset_id, candidate_id),
  CHECK (final_status <> 'Consolidated' OR survivor_candidate_id IS NOT NULL),
  CHECK (survivor_candidate_id IS NULL OR survivor_candidate_id <> candidate_id)
);

CREATE TABLE IF NOT EXISTS compact_v5.reviewer_assignments (
  assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id text NOT NULL REFERENCES compact_v5.datasets(dataset_id),
  reviewer_id uuid NOT NULL REFERENCES public.reviewers(reviewer_id),
  country_code text NOT NULL CHECK (country_code IN ('KHM', 'SLE', 'JAM', 'COD')),
  stage text NOT NULL CHECK (stage IN ('Global', 'Regional')),
  is_coordinator boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dataset_id, reviewer_id, country_code, stage)
);

CREATE TABLE IF NOT EXISTS compact_v5.evidence_review_events (
  evidence_review_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id text NOT NULL,
  evidence_id text NOT NULL,
  reviewer_id uuid NOT NULL REFERENCES public.reviewers(reviewer_id),
  correction jsonb NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (dataset_id, evidence_id) REFERENCES compact_v5.evidence(dataset_id, evidence_id)
);

CREATE TABLE IF NOT EXISTS compact_v5.consolidation_links (
  dataset_id text NOT NULL,
  retired_candidate_id text NOT NULL,
  surviving_candidate_id text NOT NULL,
  rationale text NOT NULL,
  created_by uuid NOT NULL REFERENCES public.reviewers(reviewer_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dataset_id, retired_candidate_id),
  FOREIGN KEY (dataset_id, retired_candidate_id) REFERENCES compact_v5.candidate_baselines(dataset_id, candidate_id),
  FOREIGN KEY (dataset_id, surviving_candidate_id) REFERENCES compact_v5.candidate_baselines(dataset_id, candidate_id),
  CHECK (retired_candidate_id <> surviving_candidate_id)
);

CREATE OR REPLACE FUNCTION compact_v5.reject_source_baseline_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Imported v5 source baselines are immutable';
END;
$$;
DROP TRIGGER IF EXISTS candidate_baselines_immutable ON compact_v5.candidate_baselines;
CREATE TRIGGER candidate_baselines_immutable
  BEFORE UPDATE OR DELETE ON compact_v5.candidate_baselines
  FOR EACH ROW EXECUTE FUNCTION compact_v5.reject_source_baseline_mutation();
DROP TRIGGER IF EXISTS evidence_immutable ON compact_v5.evidence;
CREATE TRIGGER evidence_immutable
  BEFORE UPDATE OR DELETE ON compact_v5.evidence
  FOR EACH ROW EXECUTE FUNCTION compact_v5.reject_source_baseline_mutation();
DROP TRIGGER IF EXISTS evidence_rectangles_immutable ON compact_v5.evidence_rectangles;
CREATE TRIGGER evidence_rectangles_immutable
  BEFORE UPDATE OR DELETE ON compact_v5.evidence_rectangles
  FOR EACH ROW EXECUTE FUNCTION compact_v5.reject_source_baseline_mutation();

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'documents', 'analysis_runs', 'candidate_evidence', 'relationships', 'id_crosswalk',
    'scan_log', 'qa_checks', 'taxonomy_categories', 'scalable_solutions', 'field_definitions',
    'import_files', 'candidate_assessments', 'review_events', 'stage_resolutions',
    'finalizations', 'evidence_review_events', 'consolidation_links'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON compact_v5.%I', table_name || '_immutable', table_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON compact_v5.%I FOR EACH ROW EXECUTE FUNCTION compact_v5.reject_source_baseline_mutation()',
      table_name || '_immutable', table_name
    );
  END LOOP;
END;
$$;

COMMIT;