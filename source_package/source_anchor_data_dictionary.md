# Source-Anchor Data Dictionary

## `documents`

| Field | Definition |
|---|---|
| `document_id` | Stable primary key for a fixed PDF. |
| `country` | Compact country. |
| `document_title` | Official document title used in the app. |
| `document_version` | Retrieval/version statement for the fixed bytes. |
| `local_filename` | PDF filename included in the package. |
| `official_source_url` | Official World Bank source URL. |
| `sha256` | SHA-256 hash of the complete PDF bytes; geometry is valid only for this hash. |
| `file_size_bytes` | PDF file size. |
| `page_count` | Number of physical PDF pages. |
| `page_numbering_basis` | Page reference convention; one-indexed physical pages in this release. |
| `pdf_creator`, `pdf_producer` | Embedded PDF metadata. |
| `pdf_creation_date`, `pdf_modified_date` | Embedded PDF dates when available. |
| `anchor_coordinate_system` | Origin, units, and normalized-coordinate convention. |
| `generated_at_utc` | Dataset generation time. |

## `candidates`

This table reproduces the 24 agreed methodology variables.

| No. | Field | Definition |
|---:|---|---|
| 1 | `candidate_id` | Stable country-prefixed candidate identifier. |
| 2 | `country` | Compact country. |
| 3 | `source_reference` | One-indexed PDF page and section/table locator. |
| 4 | `compact_form` | Form of the passage: table, narrative, target, roadmap, appendix, financing, or implementation text. |
| 5 | `original_compact_text` | Brief source wording used in the methodology dataset; not a substitute for the verbatim anchor quotation. |
| 6 | `standardized_candidate_reform_action` | Concise verb-led candidate statement. |
| 7 | `detailed_description` | Normalized explanation of the proposed system change or exclusion. |
| 8 | `candidate_stream` | A high-confidence reform, B potential reform for human review, or C high-confidence non-reform. |
| 9 | `inclusion_decision` | Preliminary or final inclusion state. LLM provisional decisions are not final counts. |
| 10 | `reform_action_tag` | Substantive tag such as core reform, roadmap enabler, potential aspiration, target, implementation activity, or consolidated item. |
| 11 | `count_in_reform_total` | `Yes` only after final human validation. Starts as `No`. |
| 12 | `confidence_level` | Confidence in candidate classification, distinct from anchor-location confidence. |
| 13 | `decision_rationale` | Explanation for the candidate stream and decision. |
| 14 | `water_security_pillar` | Water for People, Food, Planet, or Cross-cutting. |
| 15 | `solution_area` | One or more solution codes S1-S7. |
| 16 | `reform_type_tier_1` | Broad reform-domain classification. |
| 17 | `reform_type_tier_2` | Specific reform mechanism. |
| 18 | `responsible_entity` | Named or inferred implementing actors. |
| 19 | `related_parent_id` | Semicolon-delimited links to a broader mechanism, duplicate parent, or supporting candidate. Also links aspirations to explicit mechanisms. |
| 20 | `human_review_status` | Review workflow state. |
| 21 | `reviewer_comment` | Free-text reviewer note. |
| 22 | `final_validated_action` | Human-approved final wording; blank until validation. |
| 23 | `reform_aspiration_status` | Indicates whether a statement is an aspiration and whether it is linked, validated, or excluded. |
| 24 | `criterion_assessment` | Five-test methodology assessment. |

## `source_anchors`

| Field | Definition |
|---|---|
| `anchor_id` | Stable anchor primary key. |
| `candidate_id` | Candidate receiving the evidence. |
| `document_id` | Fixed PDF containing the passage. |
| `anchor_role` | `Primary Evidence`, `Context`, `Aspiration`, `Explicit Mechanism`, `Duplicate/Sub-action Evidence`, or `Exclusion Evidence`. |
| `anchor_type` | `Text Span`, `Table Cell/Row`, or `Page Range`. |
| `linked_candidate_id` | Candidate whose evidence is reused for an explicit-mechanism link, when applicable. |
| `source_reference` | Original methodology locator. |
| `page_start`, `page_end` | Full cited page scope. |
| `matched_page` | Page containing this anchor's rectangles. |
| `page_label` | Display page label. |
| `section_or_table` | Compact-form/section context. |
| `verbatim_source_text` | Exact quotation assembled from PDF tokens. |
| `normalized_source_text` | Search-normalized quotation. |
| `quote_sha256` | SHA-256 of `verbatim_source_text`. |
| `page_char_start`, `page_char_end` | Offsets in canonical single-space page text for a single contiguous line; blank for discontinuous spans. |
| `page_char_spans_json` | JSON array of `[start,end]` offsets for each visual line. |
| `match_method` | Exact/fuzzy spatial matching method or evidence-link reuse method. |
| `match_query_source` | Candidate field or verified locator used to find the source. |
| `match_query` | Locator query retained for audit. |
| `match_score` | 0-1 location score. |
| `token_f1`, `token_precision`, `token_recall`, `sequence_similarity` | Matching diagnostics. |
| `anchor_confidence` | `High`, `Medium`, `Low`, or `Unresolved`; this measures location quality only. |
| `automated_validation_status` | Automated QA result. |
| `human_review_status` | Anchor review state. |
| `reviewer_comment` | Human note on the anchor. |
| `created_at_utc` | Anchor creation time. |

## `anchor_rectangles`

| Field | Definition |
|---|---|
| `rectangle_id` | Stable rectangle key. |
| `anchor_id` | Parent anchor. |
| `page_number` | One-indexed physical PDF page. |
| `x0`, `y0`, `x1`, `y1` | Bounding box in PDF points, top-left origin. |
| `x0_normalized`, `y0_normalized`, `x1_normalized`, `y1_normalized` | Same box normalized to page width/height in the 0-1 range. |
| `page_width_points`, `page_height_points` | Page dimensions used to normalize coordinates. |
| `coordinate_origin` | `top-left`. |
| `coordinate_unit` | `PDF points`. |

## `item_relationships`

| Field | Definition |
|---|---|
| `relationship_id` | Stable relationship key. |
| `source_candidate_id` | Candidate containing the link. |
| `target_candidate_id` | Related or parent candidate. |
| `relationship_type` | `Aspiration supported by mechanism`, `Consolidated under`, or `Related or supporting candidate`. |
| `relationship_status` | LLM-proposed status pending review. |
| `source_anchor_id`, `target_anchor_id` | Evidence anchors for the relationship. |
| `human_review_status`, `reviewer_comment` | Review fields. |

## `unresolved_anchors`

Retained as a stable error queue even when empty. Each record would identify the candidate, pages searched, failure reason, best tentative match, suggested human action, and review status.

