# Programming instructions: four-country v5 Water Compact review app

Prepared for the existing [Water-Compact-Review repository](https://github.com/yourstrulyalwiz/Water-Compact-Review). Repository inspected at commit [`79cbdb758fb66ed3fc8f315d930064af0ce92d6b`](https://github.com/yourstrulyalwiz/Water-Compact-Review/tree/79cbdb758fb66ed3fc8f315d930064af0ce92d6b).

This is an implementation brief for Replit Agent. It has not been executed against the repository or a deployed database. File paths below are relative to that repository unless described as handoff paths. Proposed files and commands are explicitly identified.

## 1. Implementation request

Update the existing app to use the four supplied v5 XLSX workbooks as its authoritative imported analytical baseline. Import their data into the app’s existing PostgreSQL database and store subsequent human review activity there. Retain the workbooks unchanged as source snapshots. Preserve the current React/Express application and its three-panel review layout.

The scope is reform-action identification and validation for Cambodia, Sierra Leone, Jamaica and the Democratic Republic of the Congo. Use the supplied analysis; do not ask an LLM to reclassify, translate, summarize, split or rewrite the records during import. Sector challenges and targets are outside this delivery.

The accompanying ZIP contains:

- `workbooks/`: the four issued v5 workbooks.
- `pdfs/`: the exact four PDF versions referenced by their evidence coordinates and SHA-256 hashes.
- `methodology/`: the v5 master methodology and reform-domain taxonomy.
- `import-manifest.json`: filenames, fingerprints, document bindings, actual sheet headers and acceptance counts.
- `candidate-field-map.json`: all 42 candidate-column mappings, in workbook order.
- This programming brief and a short Replit starting prompt.

Extract the handoff beneath a new repository folder, for example `source_package/v5/`. Resolve manifest paths relative to that folder. The manifest is a validation/configuration file; the workbooks remain the data source.

### Expected initial data

| Country | Prefix | Candidates | High-confidence reform | Needs human review | Non-reform | Review-action view |
|---|---|---:|---:|---:|---:|---:|
| Cambodia | KHM | 73 | 40 | 15 | 18 | 55 |
| Sierra Leone | SLE | 73 | 24 | 18 | 31 | 42 |
| Jamaica | JAM | 43 | 7 | 9 | 27 | 16 |
| Democratic Republic of the Congo | COD | 63 | 42 | 14 | 7 | 56 |
| **Total** | | **252** | **113** | **56** | **83** | **169** |

There are **4 documents, 348 distinct evidence passages, 350 candidate–evidence links, 968 rectangles, 63 relationship records, 4 analysis runs, 252 ID-crosswalk records, 70 scan-log records and 25 QA records**. The 350 links intentionally exceed the 348 evidence passages: a passage can support more than one candidate.

All initial Global decisions are blank, Regional confirmation and Final status are `Pending`, and the final approved count is **0**. The 113 high-confidence classifications are preliminary analytical assessments, not 113 approved reforms. Use these counts as import acceptance fixtures, not hard-coded application totals.

## 2. Preserve the existing architecture and address these observed differences

The inspected repository uses pnpm workspaces, TypeScript, React/Vite, Express and PostgreSQL queried through `pool.query()`. The SQL schema is maintained directly; the Drizzle schema file is a placeholder. Keep that arrangement and do not run `@workspace/db`’s Drizzle `push` command.

| Existing file or behavior | Required v5 change |
|---|---|
| `source_package/schema_postgres.sql` has the older candidate model | Add versioned SQL migrations for the v5 model. Do not coerce 42 columns into the old 24-field representation. |
| `candidates.ts`, `export.ts`, `Workspace.tsx` use A/B/C prefixes and legacy inclusion fields | Use the exact three v5 stream values, six binary criteria, two review stages and final status. Remove `startsWith('A')`, `charAt(0)` and single-letter stream assumptions. |
| Legacy `source_anchors` attaches each anchor directly to one candidate | Represent `Evidence` independently and join it through `Candidate_Evidence`. Rectangles belong to evidence, not directly to candidates. |
| `Workspace.tsx` hard-codes three countries, source links and four generic domain labels | Populate filters/source navigation from the active dataset and the supplied ten-domain taxonomy. Include COD. |
| Candidate review POST already exists, despite `replit.md` describing Phase 2 as pending | Preserve the existing review history. Implement explicit v5 Global/Regional decisions and assessment-version binding. |
| `export.ts` hard-codes four reviewer names and uses agreement as `consensus_decision` | Generate reviewer columns dynamically where needed. Consensus is informational and must never substitute for Global approval and Regional confirmation. |
| `reviewers.ts` currently issues tokens from a selected allowed name | Preserve prototype usability but describe this accurately as name selection, not verified identity. See review-role requirements below. |
| OpenAPI still describes retired register/login endpoints | Bring the spec into agreement with `/reviewers/authenticate` and new v5 endpoints, then regenerate clients. |
| `PdfViewer.tsx` compares the response hash header with the database hash | Compute SHA-256 of the actual PDF response bytes before enabling overlays. Header comparison alone cannot detect wrong bytes behind matching metadata. |
| `build.mjs` already copies `source_package/documents/` to `dist/documents/` | Extend/verify this build path for the new exact PDFs, including subdirectories. Keep production PDF availability. |

Keep the installed PDF.js version during this migration. Do not combine a renderer upgrade with the data/workflow change. Re-read any repository instructions and inspect changes made after the pinned commit before coding; adapt paths if the project has moved.

## 3. Database design and migration

Use a separate PostgreSQL schema such as `compact_v5` for the new dataset and workflow tables. This avoids breaking the existing public-schema tables and their review foreign keys during migration. Preserve legacy tables, records and reviews as an archive. Switch the active application dataset only after the new dataset validates.

Recommended logical tables:

| Table in `compact_v5` | Purpose |
|---|---|
| `datasets`, `dataset_state` | Dataset metadata and one active-dataset pointer; use `water-compacts-v5-baseline-01` for this initial package. |
| `import_batches`, `import_files` | Import identity, per-file hashes, source filenames, timestamps, validation results and commit/activation state. |
| `documents` | Exact document version, country, language, hash, page count and resolved PDF asset path. |
| `candidate_baselines` | Immutable typed import of all 42 candidate fields, plus dataset/import provenance. Retain an exact raw-row representation for audit and export. |
| `candidate_assessments` | Versioned working assessments. Revision 1 is initialized from the workbook; accepted analytical edits create a new revision. |
| `evidence` | Original-language quotation, English translation, page/section, contextual prefix/suffix, hashes and extraction metadata. |
| `candidate_evidence` | Many-to-many links, with role and relationship note on the link. |
| `evidence_rectangles` | Geometry keyed by `Evidence_ID`; preserve original points, normalized coordinates, page dimensions and rotation. |
| `relationships` | Typed source/target candidate relationships, rationale and status. |
| `analysis_runs`, `id_crosswalk`, `scan_log`, `qa_checks` | Import the corresponding supporting sheets without collapsing their audit detail. |
| `taxonomy_categories`, `scalable_solutions`, `field_definitions` | Versioned classification and codebook reference data, deduplicated across workbooks. |
| `review_events`, `stage_resolutions`, `finalizations` | Append-only reviewer submissions, authoritative stage decisions, and final-status history. |
| `reviewer_assignments` | Explicit workflow stage/country/coordinator assignments, linked to existing reviewer IDs. |
| `evidence_review_events`, `consolidation_links` | Human source-location corrections and explicit surviving-candidate links, separate from original evidence and parent hierarchy. |

Table names can follow project conventions; these relationships and provenance requirements are mandatory.

Use composite dataset-scoped keys such as `(dataset_id, candidate_id)` and `(dataset_id, evidence_id)` consistently, including foreign keys. This permits future source versions without contaminating the active baseline. Scope every API query, join, count, export, review and cache key to the resolved dataset. Accept historical dataset IDs only through an explicit archive operation; the normal workspace uses the active dataset.

The imported baseline and original source passages are immutable. A reviewer may propose changes to criteria, classification, rationale, statement, temporal status, monitoring criterion or relationships. Applying an authorized change creates a new assessment revision with old/new values, author, reason and time. It does not rewrite the imported row. Preserve the imported `Analysis_Version_ID`; keep a separate live `assessment_revision` and a link back to the originating analysis version.

Keep workflow fields in the effective view synchronized with authoritative review events/resolutions, rather than independently editable copies in several tables. A substantive assessment change invalidates approvals attached to an earlier revision and returns the new revision to pending review. Earlier decisions remain in history.

### Identifiers and aggregation

- Import issued `Candidate_ID` values verbatim. Do not regenerate them from row numbers, sort order, country names or the pilot IDs.
- Country codes are KHM, SLE, JAM and COD. Accept at least three numeric digits and optional uppercase suffixes: `^(KHM|SLE|JAM|COD)-RA-[0-9]{3,}[A-Z]*$`.
- Examples of valid subsidiaries are `COD-RA-004A` and `COD-RA-004B`. Support suffixes beyond Z if new records are later created.
- `Parent_Reform_Action_ID` is authoritative. Verify it resolves within the same country and dataset; reject self-parenting and cycles. A shared cluster does not create a parent.
- Keep a coordinated law amendment with parallel objectives as one record. The app must not create additional candidates because one row has multiple domains, objectives, solutions or evidence links.
- Parent and subsidiary actions count individually only when each independently meets all criteria and validation requirements.
- Consolidation needs an explicit surviving-candidate link and rationale. Do not use the parent field as a consolidation target. Preserve retired IDs and source evidence.
- Later allocation of new IDs must be transaction-safe. Never reuse gaps or rename issued records. Natural sorting should handle numeric sequences and letter suffixes without changing the IDs.

## 4. Import contract

### Authoritative sheets

| Workbook sheet | Import treatment |
|---|---|
| `Candidates` | Main 36-field methodology schema plus 6 provenance/review extensions; exact header mapping. |
| `Documents` | Document registry; accept optional source filename/Library identifier fields only present in Jamaica/DRC. |
| `Evidence` | Independent source passages and translations. |
| `Candidate_Evidence` | Candidate–evidence links; retain every role, including canonical continuations and context. |
| `Anchor_Rectangles` | Geometry joined through `Evidence_ID`. |
| `Relationships` | Explicit relationships; preserve the source’s relationship types and status text. |
| `Analysis_Runs`, `ID_Crosswalk`, `Scan_Log`, `QA` | Provenance, scan coverage and human-QA queue. |
| `Taxonomy`, `Scalable_Solutions` | Shared reference tables; verify agreement across all four files before deduplicating. |
| `Codebook`, `ReadMe` | Retain as versioned field definitions/documentation; they are not candidate records. |
| `Summary`, `Review_Actions`, `Data >>` | Presentation sheets. Regenerate equivalent views from `Candidates`; do not import their rows as additional candidates. |

All four `Candidates` sheets have the same 42 headers. `Documents` is not identical: Cambodia/Sierra Leone lack `Source_File_Name` and `Source_Library_ID`, while Jamaica/DRC have blank official/repository URLs. Treat these as legitimate optional metadata. Do not force guessed URLs or reject the files for this difference. A Library identifier is provenance, not an app-accessible PDF URL.

Use `candidate-field-map.json` for the exhaustive mapping. API/DB keys can be lower-case snake case while XLSX/CSV exports retain the exact original header spelling and order. Fields 1–36 are the methodology core; 37–42 are `Document_ID`, `Analysis_Run_ID`, `Analysis_Version_ID`, `Global_Review_Comment`, `Regional_Comment`, `Review_Resolution`.

### Parser and validation requirements

Implement a server-side TypeScript CLI importer under `scripts/src/`, using an XLSX parser compatible with the workspace’s Node runtime and committed lockfile. Add the dependency in the scripts workspace. Never execute arbitrary workbook formulas, macros or external links.

1. Read headers by name, preserve row/column coordinates for error reporting, reject duplicate or missing required headers. Ignore purely blank rows, not legitimate blank optional cells.
2. Preserve Unicode, accents, punctuation, line breaks, quotations and original-language fields exactly. Any normalized search representation must be a separate field. Treat formula-looking source text as text.
3. Accept only 0/1 for the six criteria and financing flag, allowing exact string `"0"`/`"1"` to convert to numbers. Reject ambiguous values; `Boolean("0")` is incorrect.
4. Recompute `Six_Criteria_Pass` from C1–C6 and the final-count gate on the server. Compare available formula caches with the recomputed values, reporting inconsistencies. A missing formula cache is not missing source evidence and must not become a default approval.
5. Parse semicolon-delimited additional solution/domain tags into arrays for filtering, retaining their original cell text. Do not split action prose, actor text or the original quotations on punctuation.
6. Validate the three stream values and all controlled review/status values exactly. Do not infer a stream from its first character: both high-confidence labels begin with H.
7. Allow blank statement/classification cells for obvious non-reforms. Retained High-confidence Reform Action and Needs Human Review rows need full classification, except scalable solution codes may legitimately be blank when unsupported. Tier 2 is non-exhaustive: unfamiliar labels require a diagnostic, not automatic replacement or silent deletion.
8. Reject duplicate IDs, broken document/run/evidence/relationship references, invalid parent cycles, out-of-range PDF pages, invalid rectangle bounds, and country-prefix mismatches. Validate the source hash and page count against the actual PDF asset.
9. Preserve many-to-many evidence. Enforce uniqueness of each candidate/evidence link in this package; do not duplicate evidence records to satisfy the legacy anchor schema.
10. Import review fields as baseline observations, not newly fabricated review events. For this specific baseline all human approvals are blank/pending; any unexpected non-pending approval should stop the initial import for investigation.
11. Match fingerprints and row totals to the supplied manifest. A changed file should require a new explicit import manifest/version, not a disabled integrity check.
12. Store all diagnostics with file, sheet, row, column, record ID and reason. Fail the whole activation if any required relationship or file is invalid.

### Dry run, atomic import and reimport behavior

Add proposed commands to `scripts/package.json`:

```text
pnpm --filter @workspace/scripts run compact:v5:validate -- --manifest source_package/v5/import-manifest.json
pnpm --filter @workspace/scripts run compact:v5:import -- --manifest source_package/v5/import-manifest.json --mode stage
pnpm --filter @workspace/scripts run compact:v5:activate -- --dataset water-compacts-v5-baseline-01
pnpm --filter @workspace/scripts run compact:v5:verify -- --dataset water-compacts-v5-baseline-01
```

These commands do not exist in the inspected repo; implement them with explicit argument validation. Validation writes a report and changes no active data. Stage the complete dataset transactionally. Verify all four files and PDF assets before atomically moving the active pointer. If staging or activation fails, the old application dataset remains usable.

A second import of identical files and dataset ID must be a no-op. A different hash under an existing imported identity must produce a version conflict, not overwrite the baseline or erase reviews. Future revised workbooks should create a staged source revision with a readable diff. Never reset live review history because a workbook’s original review columns are blank. Migration rollback should restore the prior active pointer; do not delete either history.

Do not make import run automatically on every server start, build or deployment. Add explicit migrations and an operator-run import step. Keep database credentials in environment variables and out of the handoff, repository and logs.

## 5. Review workflow and counting

Display these exact stream values:

```text
High-confidence Reform Action
Needs Human Review
High-confidence Non-reform
```

Global decisions: `Approve`, `Revise`, `Reject`, `Consolidate`, `Needs Discussion`.

Regional decisions: `Confirm`, `Confirm with Revision`, `Disagree`, `Needs Discussion`, `Pending`.

Final statuses: `Approved Reform`, `Rejected Non-reform`, `Consolidated`, `Pending`.

Temporal statuses: `Completed at baseline`, `Ongoing`, `Planned`, `Unclear`.

Cluster roles: `Standalone`, `Primary`, `Secondary`, `Supporting Evidence`, `Duplicate-Consolidated`.

Pillars: `Water for People`, `Water for Food`, `Water for Planet`, `Cross-cutting`.

`Review_Resolution` is initially blank and can become `Open` or `Resolved`. A resolution must link to the corresponding issue/revision and reviewer action; a client-supplied string alone cannot authorize a final count.

### Workflow behavior

1. A reviewer inspects the current assessment, original source passage, translation and PDF highlight.
2. Save their stage-specific decision and comment as an append-only `review_event`, bound to candidate ID and assessment revision. Store reviewer identity from the validated session token, never from a submitted `reviewer_id` or display name.
3. Retain individual reviewer decisions. Compare the latest submission per reviewer **within the same stage and assessment revision**, ordered deterministically by timestamp and event ID. `Approve` and `Confirm` at different stages are not a conflict.
4. An explicitly assigned stage coordinator records the authoritative stage resolution. Do not let the latest arbitrary reviewer or a majority vote silently set final status. Unresolved disagreement stays visible and blocks finalization.
5. Regional confirmation applies to the same assessment revision that received Global approval. A substantive edit requires renewed decisions for that revision.
6. Finalization records `Final_Status` with actor/time/reason and enforces all prerequisites server-side. Reject and consolidate also preserve the original candidate and history; consolidation must identify a valid survivor.

Add configurable stage/country/coordinator assignments for the existing reviewers. Do not infer these roles from their names. Unassigned users can inspect and submit non-authoritative comments/proposals; finalization remains unavailable until assignments are configured.

The existing name-selection endpoint is suitable only as prototype attribution: selecting an allowed name is not proof of that person’s identity. Do not claim that adding a role table fixes this. Before enabling permission-enforced final approval for other users, bind assignments to verified sessions using the project’s chosen authentication mechanism. The initial data import and read-only v5 workspace can be completed independently of that configuration. Keep the current identities and their historical reviews; do not automatically carry pilot `Accept` decisions into v5 `Approve`/`Confirm` decisions.

### Single server-side counting gate

Implement this once as a shared database view/function or domain function used consistently by list/detail, summary, exports and finalization. Clients may show the result but cannot set it.

```text
six_criteria_pass = 1 only when C1 = C2 = C3 = C4 = C5 = C6 = 1

count_in_final_reform_total = 1 only when:
  six_criteria_pass = 1
  AND final_status = 'Approved Reform'
  AND global_review_decision = 'Approve'
  AND regional_confirmation_decision is:
        'Confirm'
        OR ('Confirm with Revision' AND review_resolution = 'Resolved')
  AND cluster_role is 'Standalone', 'Primary' or 'Secondary'
  AND all required decisions apply to the current assessment revision
  AND no revision or stage disagreement remains unresolved
```

Also reject inconsistent finalization, such as keeping the effective stream as High-confidence Non-reform while approving it without a recorded reassessment. A previously excluded or review-needed item may become eligible through an evidence-grounded revision, but its original stream stays in the immutable baseline.

“Has a review,” “reviewers agree,” “high confidence” and “all six criteria pass” are separate facts from final approval. A completed-at-baseline reform may count if it otherwise qualifies; an active-monitoring view can filter it out without changing the approved inventory. A date already in the past does not establish completion.

## 6. Frontend changes

Keep the left candidate list, central PDF viewer and right assessment/review panel. Split the large `Workspace.tsx` into focused components as needed without redesigning the app from scratch.

### Left panel and overview

- Load four-country options dynamically; show “DRC” as a short label while retaining the full country name and `COD` code in data.
- Offer `All candidates`, `Review actions` and `Final approved reforms` views. The review-action view initially has 169 records; non-reforms remain available through All candidates and the QA queue.
- Filter by full stream, country, primary pillar, Tier 1/Tier 2, scalable solution, financing relevance, temporal status, cluster role, C1–C6 failures, Global decision, Regional decision, final status and unresolved review issues.
- Populate ten-domain and solution labels from reference data. Keep Tier 2 options dependent on Tier 1.
- Search IDs, English statements, original/translated action text, evidence, actors and classification labels. Make French accents usable in search without changing stored quotations.
- Show the minimal action statement as the card title where populated. For non-reforms, use a clearly labeled source excerpt fallback for display only; do not populate the blank statement field.
- Distinguish baseline and effective stream if human reassessment changes it. Keep all calculations explicit about the selected view.
- Compute totals server-side for the full matching dataset, not just the current page. Reset pagination on filter changes. Include dataset/revision/filter values in React Query keys and invalidate affected views after saves.

### Right panel

Use clear tabs or sections for Action, Evidence, Assessment, Relationships and Review history.

- Display `Reform_Action_Statement_English` separately from verbatim text.
- Show original-language action and evidence beside English translations. For DRC, use French/English labels and preserve both. For English sources, avoid needlessly repeating identical text in the UI while retaining both fields in data/export.
- Present six labeled binary criteria with definitions from the Codebook and a computed all-criteria result. State that zero means not established by the current evidence, not necessarily a false real-world proposition.
- Display rationale, primary and secondary classifications, solution codes/labels, responsible actor, financing relevance, temporal status and completion criterion.
- Show explicit parent and related-candidate links. Clicking a linked ID navigates to that candidate. Use `Relationships` and parent fields, not suffix parsing alone.
- Provide Global and Regional review controls according to configured assignments. Show initial pending state, authoritative stage decisions and individual comments distinctly.
- Expose the QA sample as a human review queue. It is already selected in the workbooks; do not redraw a random sample at import or app startup.

Remove obsolete aspiration-status and free-text criterion-assessment controls from the v5 workflow. Do not invent replacement values for retired legacy fields merely to keep old components satisfied.

## 7. Source evidence and PDF behavior

### Exact PDF binding

Copy each supplied PDF to the manifest’s proposed repo path, such as `source_package/documents/v5/JAM-DOC-2026-001.pdf`. Preserve older PDFs for the legacy dataset. Store a trusted relative asset path and block path traversal when resolving it.

| Document ID | Pages | SHA-256 of supplied PDF |
|---|---:|---|
| KHM-DOC-2026-001 | 26 | `0935dc3aad79c23426dc68078b1739c0c88946e2e94e18fec1bdd2bfb3b8e5d4` |
| SLE-DOC-2026-001 | 20 | `026c887e88362ec453d515f93e34997e715c546f3a1cceb5b609b17ecfaeed15` |
| JAM-DOC-2026-001 | 12 | `97f5852d6b4d642a7fc710363cf6c907bc75d4dcc82c01483dcdd9a5748e52ca` |
| COD-DOC-2026-001 | 12 | `089f63b492a8f72ee6bde22bb11a9e870060843389e60e9acbdc8fb6a82529bc` |

The repository’s older Jamaica PDF has hash `24b077a5d6c0cae3021836b675ce8da2a96444f81fa249087706a5ffbce0001a`; it cannot be substituted for the v5 PDF. Different bytes do not by themselves prove a textual change, but the version-specific evidence must stay bound to its recorded file.

Verify bytes at import/build and in the browser. Hash the fetched `ArrayBuffer` with SHA-256 before passing it to PDF.js, accounting for PDF.js transferring the buffer. Enable overlays only after successful verification against the selected document’s expected hash. On mismatch, missing hash or verification failure, display the source-version issue and leave highlights disabled; never present unverified overlays as valid. Reset document/page/selection/hash state on document changes and cancel stale fetch/render work so another country’s overlay cannot persist.

### Evidence navigation and geometry

- Select evidence via `candidate_evidence`; each item carries its own document/page and link role. Order canonical action first, then canonical continuation and context, retaining original IDs and roles.
- Replace old anchor-role strings with the actual workbook roles, or use an explicit display-label adapter that retains the original values. Do not convert all evidence to “Primary Evidence.”
- Preserve `Location_Status` such as “Exact text located; visual spot-check only.” This is not “human verified,” and no match-confidence score should be invented.
- Use one-based physical `PDF_Page` for navigation. Printed labels are optional display metadata, never the navigation index.
- Import `X0_Normalized`, `Y0_Normalized`, `X1_Normalized`, `Y1_Normalized` directly and apply them to the displayed page content box, excluding margins. Scale against CSS dimensions, not the high-DPI canvas backing dimensions.
- Render only rectangles belonging to the selected evidence and visible PDF page. Keep all rectangles for multi-line quotations; cross-page actions navigate through separate linked evidence passages.
- The four current datasets have page rotation 0. Preserve `Page_Rotation` and use a PDF.js viewport transformation or explicitly reject unsupported geometry for future rotated pages; do not silently ignore rotation.
- Retain absolute point coordinates, dimensions, char offsets and quote hashes. Offsets refer to the recorded PyMuPDF extraction order; do not apply them blindly to PDF.js text-layer offsets. Geometry drives highlighting.
- Human source corrections append a versioned correction/review record. Preserve the original quote and rectangles, and distinguish original from corrected evidence in the UI.

## 8. API and exports

Update `lib/api-spec/openapi.yaml` first and regenerate clients/Zod types using the existing Orval command. Keep the API title `Api`, which the current generation setup expects. Do not hand-edit generated code.

Existing route families can be retained with v5 response types:

- `GET /api/candidates`: validated filters, pagination, dataset ID, current assessment and effective review status.
- `GET /api/candidates/:candidateId`: baseline, current assessment, linked evidence with rectangles, source provenance and version metadata.
- `GET /api/documents` and `GET /api/documents/:id/pdf`: active-dataset document assets with hashes.
- `GET /api/relationships`, `GET /api/stats`: dataset-scoped joins and totals.
- `GET/POST /api/candidates/:candidateId/reviews`: revision-bound, stage-specific events. Validate decision enums and role/country scope on the server.

Add explicit endpoints for assessment revision proposals/application, stage resolutions, finalization, QA checks and evidence corrections. Include `expected_assessment_revision` on writes and return `409` for stale updates. Use a DB transaction to validate version, append events and update effective state atomically. A pending background response for a previously selected candidate must not overwrite the current candidate’s form.

Retire or explicitly adapt the legacy `/anchors/:anchorId` endpoint to the new evidence model. Update `/reviewers/authenticate` in OpenAPI; remove or mark the already-retired register/login operations as deprecated/410. Do not publish workbook import or dataset activation as unauthenticated HTTP routes; CLI commands are sufficient for this scope.

Provide:

1. **Master candidate export:** current effective values, all 36 core headers followed by the same 6 extensions, with immutable original quotations/translations and stable IDs. Include baseline/current revision provenance separately where needed.
2. **Final approved export:** only rows whose server-derived final count is 1. Initially this is an empty, correctly headed export.
3. **Review history export:** long format, one event per reviewer/stage/revision, with IDs, decision, comment and timestamp. An optional wide comparison should discover reviewers dynamically and remain informational.
4. **Evidence/provenance export:** passages, candidate links, geometry, relationships and source documents sufficient to reproduce source navigation.

All export filters must match the workspace filters and cover every matching row, not just the loaded page. Preserve UTF-8 French and embedded line breaks. When writing XLSX, write user/source text as string cells; derived fields can use explicit supported formulas or computed values. For spreadsheet-oriented CSV, prevent formula injection from leading `=`, `+`, `-` or `@` in text using a documented export-only escape and retain exact text in the lossless XLSX/JSON export. Do not alter the stored evidence to make CSV safe.

## 9. File-level implementation map

| File/path | Work |
|---|---|
| `artifacts/api-server/migrations/` | Add ordered v5 schema/workflow migrations after the existing 001/002 files; no destructive reload of the old schema. |
| `scripts/src/import-compact-v5.ts` — proposed | Parse, validate, stage, deduplicate and report workbook import. |
| `scripts/src/validate-compact-v5.ts` — proposed | Read-only manifest, workbook and PDF integrity checks. |
| `scripts/package.json` | Add the explicit validate/import/activate/verify scripts and parser dependency. |
| `artifacts/api-server/src/lib/` | Shared filter validation, dataset resolution, effective assessment and final-count logic; reuse across routes and export. |
| `artifacts/api-server/src/routes/candidates.ts` | Replace legacy fields/joins; implement version-aware assessment and review operations. |
| `artifacts/api-server/src/routes/anchors.ts` | Adapt/replace with evidence plus candidate-link semantics. |
| `artifacts/api-server/src/routes/relationships.ts` | Query v5 relationship and explicit parent/consolidation structures. |
| `artifacts/api-server/src/routes/documents.ts` | Bind to exact v5 assets, validate trusted paths, serve correct hashes. |
| `artifacts/api-server/src/routes/stats.ts` | Dataset/filter-aware counts, separate analytical streams and final approval. |
| `artifacts/api-server/src/routes/export.ts` | Replace fixed legacy headers and hard-coded reviewer pivots with v5 exports. |
| `artifacts/api-server/src/routes/reviewers.ts`, `src/lib/reviewer-token.ts` | Preserve existing identities; support explicit workflow assignments and accurately scoped authentication behavior. |
| `artifacts/api-server/src/routes/index.ts` | Register any new v5 review/reference/QA endpoints. |
| `lib/api-spec/openapi.yaml` | v5 objects, enums, nullable fields, errors, auth and endpoint contracts. |
| `lib/api-client-react/src/generated/`, `lib/api-zod/src/generated/` | Regenerate through Orval. |
| `artifacts/compact-review/src/pages/Workspace.tsx` | Dynamic countries/filters, v5 assessment display and staged review controls. |
| `artifacts/compact-review/src/components/PdfViewer.tsx` | Actual-byte hash verification, evidence-role display, safe document/page switching and geometry rendering. |
| `artifacts/api-server/build.mjs` | Ensure all exact PDF assets reach deployed `dist/documents/`. |
| `replit.md` | Replace stale 189-candidate/three-country/24-field/Phase-2-pending descriptions and document the new operator commands. |

## 10. Acceptance tests and completion report

Use focused importer, domain/API and browser tests for these concrete risks. New test-script names below are deliverables; do not claim they already exist.

**Import and integrity**

- The four workbooks validate together with all manifest counts and hashes. All 252 candidate IDs survive unchanged. The active baseline has 4 documents, 348 evidence rows, 350 links and 968 rectangles.
- Reimporting identical files changes neither counts nor review events. A changed hash, missing PDF, broken foreign key or invalid parent cycle fails without replacing the active dataset.
- The source blank fields, French text, full quotations and separate English translations survive round-trip export. Codebook/taxonomy are deduplicated without merging distinct Tier 2 entries.
- A shared evidence passage has two candidate links and one evidence/geometry record. A cross-page canonical action exposes both page-specific source passages.

**Workflow**

- Initial count is 0 everywhere. `111111` plus Global approval alone remains 0; pending/disagreeing Regional confirmation remains 0.
- Global Approve + Regional Confirm + Approved Reform + eligible role + all six criteria + current-version resolved workflow yields 1.
- Confirm with Revision remains 0 until its revisions are resolved; rejected, consolidated, supporting, duplicate or any-zero-criterion rows remain 0.
- Old-revision approvals do not count after a substantive edit. Parallel reviewer submissions are preserved; stale writes return 409 rather than losing work.
- Cross-stage Approve/Confirm does not appear as a reviewer conflict. Unresolved within-stage disagreements block finalization. Pilot reviews remain accessible historically without becoming v5 approvals.
- Unknown enum values and body-supplied reviewer identity are rejected; only configured/authorized stage resolvers can finalize. Prototype name attribution is not mislabeled as verified access control.

**UI, source viewer and exports**

- All four countries and all three full stream labels filter correctly. DRC shows French evidence beside English translation. Non-reform statements remain blank in data/export.
- Cambodia irrigation/allocation multi-objective records are not split by the app; Jamaica’s paired irrigation-law objectives remain in one record. COD subsidiaries link to their explicit parent without extra duplicate parent records.
- Correct Jamaica bytes enable highlights; substituting the old repository Jamaica PDF disables them even if a response header is unchanged. Missing/failed hash verification also disables overlays.
- Zoom, high-DPI rendering, resizing, evidence switching and rapid country switching keep overlays on the correct page. Check dense DRC annex pages 8–10 and a Jamaica cross-page action.
- Reviewed/approved summary counts match the database across pagination. Exports honor filters and include all matching records. The final-approved export initially contains headers and zero data rows.
- Production build serves every PDF asset; original and translated quotations display without truncation that hides substantive text.

Run the existing commands after implementation:

```text
pnpm --filter @workspace/api-spec run codegen
pnpm run typecheck
pnpm run build
```

Run the newly implemented validation/import tests and browser checks in a development database first. Record test commands and actual results. Stage and activate the dataset only after successful validation, keeping the previous active dataset available for rollback. Publication/deployment is a separate operation from preparing this change.

Report back with changed files, database migrations, import totals by country/stream, source-asset verification, test results, active dataset/version, any remaining reviewer-role/authentication configuration, and exact rollback instructions. Do not report success merely because the import script exits without throwing.
