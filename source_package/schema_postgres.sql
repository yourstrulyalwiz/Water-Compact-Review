BEGIN;

CREATE TABLE IF NOT EXISTS documents (
  document_id text PRIMARY KEY,
  country text NOT NULL,
  document_title text NOT NULL,
  document_version text NOT NULL,
  local_filename text NOT NULL,
  official_source_url text NOT NULL,
  sha256 char(64) NOT NULL UNIQUE,
  file_size_bytes bigint NOT NULL,
  page_count integer NOT NULL CHECK (page_count > 0),
  page_numbering_basis text NOT NULL,
  pdf_creator text,
  pdf_producer text,
  pdf_creation_date text,
  pdf_modified_date text,
  anchor_coordinate_system text NOT NULL,
  generated_at_utc timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS candidates (
  candidate_id text PRIMARY KEY,
  country text NOT NULL,
  source_reference text NOT NULL,
  compact_form text NOT NULL,
  original_compact_text text NOT NULL,
  standardized_candidate_reform_action text NOT NULL,
  detailed_description text NOT NULL,
  candidate_stream text NOT NULL,
  inclusion_decision text NOT NULL,
  reform_action_tag text NOT NULL,
  count_in_reform_total text NOT NULL CHECK (count_in_reform_total IN ('Yes','No')),
  confidence_level text NOT NULL,
  decision_rationale text NOT NULL,
  water_security_pillar text NOT NULL,
  solution_area text NOT NULL,
  reform_type_tier_1 text NOT NULL,
  reform_type_tier_2 text NOT NULL,
  responsible_entity text NOT NULL,
  related_parent_id text,
  human_review_status text NOT NULL,
  reviewer_comment text,
  final_validated_action text,
  reform_aspiration_status text NOT NULL,
  criterion_assessment text NOT NULL
);

CREATE TABLE IF NOT EXISTS source_anchors (
  anchor_id text PRIMARY KEY,
  candidate_id text NOT NULL REFERENCES candidates(candidate_id) ON DELETE CASCADE,
  document_id text NOT NULL REFERENCES documents(document_id),
  anchor_role text NOT NULL,
  anchor_type text NOT NULL,
  linked_candidate_id text REFERENCES candidates(candidate_id),
  source_reference text NOT NULL,
  page_start integer NOT NULL,
  page_end integer NOT NULL,
  matched_page integer NOT NULL,
  page_label text NOT NULL,
  section_or_table text,
  verbatim_source_text text NOT NULL,
  normalized_source_text text NOT NULL,
  quote_sha256 char(64) NOT NULL,
  page_char_start integer,
  page_char_end integer,
  page_char_spans_json jsonb NOT NULL,
  match_method text NOT NULL,
  match_query_source text,
  match_query text,
  match_score numeric(7,6),
  token_f1 numeric(7,6),
  token_precision numeric(7,6),
  token_recall numeric(7,6),
  sequence_similarity numeric(7,6),
  anchor_confidence text NOT NULL,
  automated_validation_status text NOT NULL,
  human_review_status text NOT NULL,
  reviewer_comment text,
  created_at_utc timestamptz NOT NULL,
  CHECK (page_start > 0 AND page_end >= page_start AND matched_page BETWEEN page_start AND page_end)
);

CREATE TABLE IF NOT EXISTS anchor_rectangles (
  rectangle_id text PRIMARY KEY,
  anchor_id text NOT NULL REFERENCES source_anchors(anchor_id) ON DELETE CASCADE,
  page_number integer NOT NULL CHECK (page_number > 0),
  x0 numeric NOT NULL,
  y0 numeric NOT NULL,
  x1 numeric NOT NULL,
  y1 numeric NOT NULL,
  x0_normalized numeric(8,6) NOT NULL CHECK (x0_normalized BETWEEN 0 AND 1),
  y0_normalized numeric(8,6) NOT NULL CHECK (y0_normalized BETWEEN 0 AND 1),
  x1_normalized numeric(8,6) NOT NULL CHECK (x1_normalized BETWEEN 0 AND 1),
  y1_normalized numeric(8,6) NOT NULL CHECK (y1_normalized BETWEEN 0 AND 1),
  page_width_points numeric NOT NULL,
  page_height_points numeric NOT NULL,
  coordinate_origin text NOT NULL CHECK (coordinate_origin = 'top-left'),
  coordinate_unit text NOT NULL CHECK (coordinate_unit = 'PDF points'),
  CHECK (x1 > x0 AND y1 > y0)
);

CREATE TABLE IF NOT EXISTS item_relationships (
  relationship_id text PRIMARY KEY,
  source_candidate_id text NOT NULL REFERENCES candidates(candidate_id) ON DELETE CASCADE,
  target_candidate_id text NOT NULL REFERENCES candidates(candidate_id) ON DELETE CASCADE,
  relationship_type text NOT NULL,
  relationship_status text NOT NULL,
  source_anchor_id text REFERENCES source_anchors(anchor_id),
  target_anchor_id text REFERENCES source_anchors(anchor_id),
  human_review_status text NOT NULL,
  reviewer_comment text
);

CREATE TABLE IF NOT EXISTS unresolved_anchors (
  unresolved_id text PRIMARY KEY,
  candidate_id text NOT NULL REFERENCES candidates(candidate_id) ON DELETE CASCADE,
  document_id text NOT NULL REFERENCES documents(document_id),
  source_reference text NOT NULL,
  pages_searched text,
  reason text NOT NULL,
  best_match_score numeric(7,6),
  best_match_page integer,
  suggested_human_action text NOT NULL,
  human_review_status text NOT NULL
);

CREATE TABLE IF NOT EXISTS anchor_reviews (
  review_id bigserial PRIMARY KEY,
  anchor_id text NOT NULL REFERENCES source_anchors(anchor_id) ON DELETE CASCADE,
  reviewer_id text NOT NULL,
  review_decision text NOT NULL CHECK (review_decision IN ('Accept','Correct','Reject','Needs adjudication')),
  corrected_verbatim_text text,
  corrected_rectangles_json jsonb,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS candidate_reviews (
  review_id bigserial PRIMARY KEY,
  candidate_id text NOT NULL REFERENCES candidates(candidate_id) ON DELETE CASCADE,
  reviewer_id text NOT NULL,
  inclusion_decision text NOT NULL,
  final_validated_action text,
  reform_aspiration_status text,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_source_anchors_candidate ON source_anchors(candidate_id);
CREATE INDEX IF NOT EXISTS idx_source_anchors_document_page ON source_anchors(document_id, matched_page);
CREATE INDEX IF NOT EXISTS idx_anchor_rectangles_anchor ON anchor_rectangles(anchor_id);
CREATE INDEX IF NOT EXISTS idx_relationships_source ON item_relationships(source_candidate_id);
CREATE INDEX IF NOT EXISTS idx_relationships_target ON item_relationships(target_candidate_id);
CREATE INDEX IF NOT EXISTS idx_anchor_reviews_anchor_created ON anchor_reviews(anchor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_candidate_reviews_candidate_created ON candidate_reviews(candidate_id, created_at DESC);

COMMIT;
