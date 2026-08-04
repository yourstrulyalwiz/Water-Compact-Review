# Replit Implementation Instructions

## Annotated Water Compact Review Application

### 1. Project objective

Build a web application that allows reviewers to examine LLM-identified reform-action candidates against the exact passages in the original Water Compact PDFs.

The initial pilot covers:

- Cambodia
- Sierra Leone
- Jamaica

For each candidate, the application must display the source document, highlight the relevant passage, show the methodology variables and LLM classification, and allow a human reviewer to validate or correct both the source anchor and the reform-action decision.

The architecture should later support the same review process for Compact targets and challenges. The first release should focus only on reform actions.

---

## 2. Files provided

The principal input is:

`Source_Anchor_Replit_Package.zip`

Extract this package before development. It contains:

- `README.md` — package-specific implementation and import guidance.
- `schema_postgres.sql` — normalized PostgreSQL database schema.
- `source_anchor_companion.json` — complete dataset in one structured file.
- `documents.csv` — document metadata, PDF filenames, official URLs, checksums, and page counts.
- `candidates.csv` — 189 reform-action candidates with all 24 methodology variables.
- `source_anchors.csv` — 272 source anchors containing verbatim PDF text, page references, evidence roles, and matching metadata.
- `anchor_rectangles.csv` — 1,572 PDF highlight rectangles.
- `item_relationships.csv` — 65 relationships, including aspiration-to-mechanism and consolidation links.
- `unresolved_anchors.csv` — the stable unresolved-anchor queue; it is empty in the pilot dataset.
- `source_anchor_data_dictionary.md` — field definitions and controlled values.
- `integrity_report.json` and `validation_summary.json` — quality-control results.
- `qa_overlays/` — visual examples of the source highlights.
- `documents/` — the exact Cambodia, Sierra Leone, and Jamaica PDFs used to generate the coordinates.

The following supporting documents should also be provided separately when available:

- Reform Action Identification Methodology
- Application concept note
- Any interface, authentication, hosting, or organizational branding requirements

### Are separate PDF uploads required?

The three original PDFs are already included in `Source_Anchor_Replit_Package.zip` under `documents/`. They do not need to be uploaded separately if Replit successfully extracts and retains them.

If Replit cannot extract ZIP contents, does not preserve the PDFs as application assets, or asks for source files individually, upload these three files separately without renaming or modifying them:

- `Water_Compact_Cambodia_2026.pdf`
- `Water_Compact_Sierra_Leone_2026.pdf`
- `Water_Compact_Jamaica_2026.pdf`

The highlight coordinates are valid only for those exact PDF versions. Do not replace them with downloaded, optimized, rescanned, or renamed-and-recreated PDFs.

---

## 3. Initial development sequence

### Phase 1 — Inspect and initialize

1. Extract `Source_Anchor_Replit_Package.zip`.
2. Read the package `README.md` and data dictionary.
3. Inventory all files and confirm the three PDFs are present.
4. Create a PostgreSQL database using `schema_postgres.sql`.
5. Do not change the supplied schema or source data during the initial import unless a technical incompatibility is documented first.

### Phase 2 — Import the data

Import the normalized files in this order:

1. `documents.csv`
2. `candidates.csv`
3. `source_anchors.csv`
4. `anchor_rectangles.csv`
5. `item_relationships.csv`
6. `unresolved_anchors.csv`

Alternatively, load `source_anchor_companion.json` in a single transaction and insert the tables in the same order.

After importing, confirm:

- 3 documents
- 189 candidates
- 272 source anchors
- 1,572 anchor rectangles
- 65 item relationships
- 0 unresolved anchors

Every candidate must have one candidate-level evidence anchor. Some candidates also have Context, Aspiration, or Explicit Mechanism anchors.

### Phase 3 — Build a read-only prototype first

Before adding editing functions, create a read-only prototype that can:

- List and filter all candidates.
- Open a selected candidate.
- Display the correct PDF and page.
- Highlight every rectangle associated with the selected anchor.
- Display the verbatim source quotation beside the PDF.
- Navigate to the previous and next candidate.
- Switch between multiple anchors for the same candidate.
- Display related or parent candidates.
- Show aspiration evidence beside linked explicit-mechanism evidence.

Do not proceed to the editing workflow until the PDF pages and highlights have been verified for sample candidates from all three countries.

---

## 4. Required application layout

Use a clear review workspace with three main areas.

### Candidate navigation

Provide:

- Country filter
- Candidate stream filter: A, B, or C
- Inclusion-decision filter
- Classification-confidence filter
- Anchor-confidence filter
- Reform aspiration status filter
- Reform domain and category filters
- Human review status filter
- Search by candidate ID, action wording, actor, domain, or source text
- Previous and next candidate controls

### PDF evidence viewer

Use PDF.js or an equivalent browser PDF renderer.

The viewer should:

- Open the correct local PDF from the `documents/` folder.
- Jump automatically to `matched_page`.
- Display all rectangles connected to the active `anchor_id`.
- Allow zooming without displacing the highlights.
- Visually distinguish different anchor roles.
- Allow the reviewer to switch among Primary Evidence, Context, Aspiration, Explicit Mechanism, Duplicate/Sub-action Evidence, and Exclusion Evidence.
- Show the stored verbatim quotation and source reference.

### Review panel

Display the 24 methodology variables, with particular prominence given to:

- Candidate ID
- Original Compact Text
- Standardized Candidate Reform Action
- Candidate Stream
- Inclusion Decision
- Reform Action Tag
- Classification Confidence
- Decision Rationale
- Water Security Pillar
- Solution Area
- Tier 1 and Tier 2 reform classifications
- Responsible Entity
- Related/Parent Candidate ID
- Reform Aspiration Status
- Criterion Assessment

The panel should clearly distinguish LLM-generated fields from human-validated fields.

---

## 5. PDF highlighting requirements

Before enabling geometry highlights, calculate the SHA-256 checksum of the loaded PDF and compare it with `documents.sha256`.

- If the hashes match, enable the highlights.
- If the hashes do not match, disable geometry highlights and display a document-version warning.
- Do not silently display coordinates against a different PDF version.

Rectangles use normalized top-left coordinates. For a displayed page with width `W` and height `H`:

```javascript
const left = rectangle.x0_normalized * W;
const top = rectangle.y0_normalized * H;
const width = (rectangle.x1_normalized - rectangle.x0_normalized) * W;
const height = (rectangle.y1_normalized - rectangle.y0_normalized) * H;
```

Render every rectangle belonging to the selected anchor. A quotation may span multiple visual lines and therefore have several rectangles.

Do not reconstruct source quotations from the candidate descriptions. Display `verbatim_source_text` from `source_anchors` as the authoritative extracted quotation.

---

## 6. Human review workflow

### Anchor review

Allow reviewers to:

- Accept the source anchor.
- Correct the source anchor.
- Reject the source anchor.
- Mark it for adjudication.
- Add a comment.
- Draw or adjust replacement rectangles when correcting an anchor.

Store these actions in `anchor_reviews`. Preserve the original extracted anchor and its quotation as immutable evidence.

### Candidate review

Allow reviewers to:

- Confirm inclusion.
- Exclude the candidate.
- Move it between Streams A, B, and C.
- Revise the standardized action.
- Consolidate it under another candidate.
- Split a bundled candidate if necessary.
- Update the Reform Action Tag.
- Update Tier 1 and Tier 2 classifications.
- Update the Reform Aspiration Status.
- Link or revise the related explicit mechanism.
- Add reviewer comments.
- Mark the record for adjudication.

Store review events in `candidate_reviews`. Do not overwrite the original LLM record.

### Counting rule

A candidate should enter the validated reform-action count only when:

1. `inclusion_decision = Included`
2. `count_in_reform_total = Yes`
3. `final_validated_action` is completed

An LLM provisional inclusion must never be counted as a finalized reform action.

---

## 7. Reform aspiration handling

Reform aspirations require a dedicated review treatment.

When `reform_aspiration_status` indicates an aspiration:

- Display the aspiration passage.
- Display any linked Explicit Mechanism anchor beside it.
- Show the corresponding record from `item_relationships`.
- Allow the reviewer to confirm, change, or remove the relationship.
- Do not automatically count a vague aspiration as a separate reform action merely because it is linked to a mechanism.

The reviewer must determine whether the aspiration:

- Is independently actionable;
- Is adequately supported by another passage;
- Should be consolidated with the linked mechanism; or
- Should be excluded as a general ambition.

---

## 8. Auditability and data protection

The application must preserve:

- Original LLM classifications
- Original source anchors
- Original rectangle coordinates
- Reviewer identity
- Review timestamp
- Review decision
- Corrected wording or coordinates
- Reviewer comments

Use append-only review-history tables. The current validated state may be calculated from the latest accepted review event, but earlier events must remain accessible.

Do not expose database credentials, storage secrets, or administrative functions in the browser client.

---

## 9. Future extensibility

Design the user interface and application services so the same annotation workflow can later support:

- Reform actions
- Targets
- Challenges or problem statements

The pilot database uses `candidates` for reform actions. Use an application-layer review-item abstraction so future item types can reuse:

- Documents
- Source anchors
- Rectangles
- Relationships
- Reviewer comments
- Review decisions
- Navigation and filters

Do not alter the pilot records to simulate targets or challenges during the initial build.

---

## 10. Required acceptance tests

Before considering the first implementation complete, demonstrate that:

1. All three PDFs open successfully.
2. Each PDF checksum matches the registered hash.
3. A sample of at least five candidates from each country opens on the correct page.
4. Table-based and narrative-based highlights remain aligned at different zoom levels.
5. Candidates with multiple rectangles display every rectangle.
6. Candidates with multiple anchors can switch between them.
7. An aspiration can display its linked explicit mechanism.
8. Reviewer decisions create new audit records without changing the original LLM evidence.
9. Candidate and anchor filters return the expected records.
10. Data exports retain stable candidate and anchor IDs.

---

## 11. Recommended first instruction to Replit Agent

> Build the annotated Water Compact review application described in these instructions and the accompanying concept note. First extract and inspect `Source_Anchor_Replit_Package.zip`, read its `README.md` and data dictionary, and verify that the three original PDFs are present under `documents/`. Initialize the PostgreSQL database using `schema_postgres.sql` and import the supplied data in the documented order. Begin with a read-only prototype that lists reform-action candidates and displays each candidate beside its highlighted source passage in the correct PDF. Verify PDF hashes and highlight alignment before implementing reviewer edits. Do not alter the supplied LLM classifications, evidence quotations, or anchor coordinates during the initial prototype.

---

## 12. Suggested delivery checkpoints

1. Database initialized and import counts verified.
2. Read-only candidate list and filtering.
3. PDF viewer with accurate highlights.
4. Aspiration-to-mechanism comparison.
5. Anchor review and correction workflow.
6. Candidate validation workflow and audit history.
7. Export and summary dashboard.
8. Architecture review for adding targets and challenges.
