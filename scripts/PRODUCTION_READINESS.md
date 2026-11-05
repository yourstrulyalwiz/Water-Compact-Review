# Compact append readiness — updated 2026-11-05

## Current decision: schema passed; hold for production PDF acceptance

The owner applied migration 004. Fresh read-only production checks confirm all
required columns, indexes, country checks and candidate-ID restrictions are ready.
The existing production plan passed, preserving the active dataset
`water-compacts-v5-baseline-01`, with 252 candidates, four documents and 242 review
events. The plan proposes the exact manifest additions; no data append was run.

The fresh preservation inventory is
`generated-artifacts/append-tests/production-resume/before.json`; its plan is
`generated-artifacts/append-tests/production-resume/plan.log`.
All previously backed-up rows match, except the expected old import-batch row
hash change caused by adding two NULL metadata columns. No missing rows were
observed. A fresh post-schema backup removes that row-shape ambiguity:

- Captured 2026-11-05 05:32:53 UTC and archived under private
  `production-backups/2026-11-05T05-32-53-126Z/`.
- Downloaded dump SHA256:
  `ca02e7a3cf4b926f1c849b8685cea46766c3a08061c3d571548aae7c83a9d13d`.
- Isolated restore passed all 33 complete-row inventories and
  column/constraint/trigger/function comparisons. The temporary recovery server
  was stopped and removed. Ownership/grants were excluded.
- The fresh backup inventory exactly equals the fresh plan inventory.

All ten local October PDF hashes match. The latest successful production build
(`2026-11-02 21:58 UTC`) logs the PDF copy into `dist/documents/`. However, the
private production `/api/documents` request returned a 307 redirect to Replit's
sign-in gate. Production PDF byte/hash availability has not been established.
The new document IDs are also not queryable through document-bound PDF routes
until their database rows exist; absence of pre-append rows is not proof of
missing files. No public path, temporary document rows, or access bypass was added.

The remaining gate is authorized production asset confirmation, not missing
schema columns. See `PRODUCTION_APPEND_OPERATOR_CHECKS.md` for owner commands.
This diagnostic performed no production data writes and did not publish.

## Historical readiness evidence (2026-11-02)

The missing-column observations and blocked Publish diff below describe the
earlier state only. The schema blocker was superseded by the live checks above.

## Confirmed by read-only production queries

- Active dataset: `water-compacts-v5-baseline-01`.
- 252 candidates: COD 63, JAM 43, KHM 73, SLE 73.
- 252 assessment revisions, 242 review events, four reviewer records.
- One activated original import batch, four V5 documents.
- Legacy public tables remain present, including 189 legacy candidates.
- No incoming-country overlap with the ten-country batch.
- Production still has the original four-country allowlists/candidate-ID pattern,
  the single-batch-per-dataset constraint, and neither append provenance column.
- Counts and complete-row aggregate fingerprints were captured for all 33 user
  tables across `compact_v5` and `public`, in one read-only statement.
  The private local reports are under `generated-artifacts/append-tests/`.

These fingerprints are a readiness observation, not a recoverable backup or the
per-primary-key apply inventory. Reviewers may continue submitting responses;
take a fresh inventory immediately before the approved append and preserve any
intervening legitimate human events.

Deployment metadata reports a private Autoscale app with a successful build.
No authenticated production browser/API acceptance was performed: a private
deployment login response is not proof of live application health.

## Development browser acceptance

Read-only desktop test; guest mode, all POSTs blocked, no reviews submitted:

- 817 candidates loaded across both API pages, 1,071 evidence passages and
  14 documents; existing three-panel layout and initial high-confidence filter.
- Zambia searchable after allowing all streams.
- Angola Portuguese, Senegal French and Zambia English source passages rendered
  with matching highlights at 100% and 150% PDF zoom.
- All sampled documents displayed successful SHA256 verification.
- Existing SLE-RA-018 details and its page-10 PDF rendered.
- Uzbekistan UZB-RA-023 landscape page 7 rendered at both scales with its manual
  transcription/region status preserved. A focused follow-up confirmed that the
  overlay covers the supplied phrase and matches its normalized coordinates at
  both scales (rounding differences below 0.03 CSS pixels). Its 30%-opacity
  amber multiply fill has low contrast against the infographic, but it is not
  missing or misaligned. No UI or source-geometry change is needed.
- Non-blocking PDF font warning: `TT: undefined function: 21`.

## Remaining gates, in order

1. **Production backup and restore evidence — PASSED:** a snapshot-consistent
   production dump was captured at 2026-11-02 17:06 UTC using the separately
   supplied backup secret with read-only source sessions. The dump, full-row
   inventory and schema inventory are archived in private App Storage under
   `.private/production-backups/2026-11-02T17-06-05-610Z/`.
   The downloaded dump matched its SHA256 and restored successfully into a
   localhost-only disposable PostgreSQL database. Full-row inventories matched
   exactly across all 33 tables, including all 242 review events; columns,
   constraints, user triggers and functions also matched. Role ownership and
   grants were excluded from the local restore and are not certified by it.
   The local private report is
   `generated-artifacts/production-backups/2026-11-02T17-06-05-610Z/report.json`.
   A subsequent append rehearsal on that restored production copy also passed:
   817 candidates, 242 unchanged review events, all predecessor rows preserved,
   active dataset unchanged. This was NOT a production migration or append.
   Refresh the backup before the eventual live change if reviews have advanced.
2. **Publish schema diff — BLOCKED:** the platform's read-only diff check returned
   success, `hasDiff: false`, no SQL statements and no destructive-change warnings.
   Fresh SELECT queries against development and production nevertheless show:
   - Development has two append provenance columns; production has neither.
   - Development permits all 14 countries and candidate prefixes; production's
     three country checks and candidate-ID pattern still permit only four.
   - Production retains `UNIQUE(dataset_id)` on import batches; development
     instead has the unique `(dataset_id,batch_key)` index and checksum check.
   Thus the empty proposed diff is not evidence of matching schemas. The cause
   of the missing `compact_v5` changes has not been established. Do not publish
   expecting this check to migrate them, use data overwrite, or substitute
   startup/build/custom production DDL. Resolve the managed schema-detection
   discrepancy before rollout, with Replit Support if needed.
   Evidence is saved in `generated-artifacts/append-tests/publish-schema-check.json`.
   A further read-only comparison checked columns, constraints and indexes in
   both application schemas: all 10 object differences were in `compact_v5`;
   none were in `public`. Both schemas were accessible to the SQL inspection
   connections. The installed local Drizzle implementation defaults its schema
   filter to `public`, making schema scope a concrete hypothesis, not proof of
   the managed publisher's internal configuration.
   An explicit temporary `schemaFilter: ["public", "compact_v5"]` in the local
   Drizzle config did not change the managed comparison: it still returned no
   statements. The temporary setting was removed; no schema push was run.
   No verified repository-only fix was established. The platform comparison
   needs investigation specifically for inclusion of `compact_v5`, rather than
   another unchanged republish or removal of the importer's prerequisites.
3. **Uzbekistan visual acceptance — PASSED:** the focused browser inspection
   confirmed manual-region alignment at both zoom levels. No persistent changes
   were made. This is manual image geometry, not native PDF text matching.
4. **Publish and authenticated smoke tests:** only after approval, publish the
   compatible code/assets and supported schema diff. Check original-country
   operation and production PDF bytes/hashes using authorized access.
5. **Fresh plan and explicit data-only append approval:** pin the actual database,
   unchanged active dataset, verified package fingerprint, and fresh inventory.
   Do not run apply until all preceding gates are satisfied. Then verify full
   preservation and the exact added batch inventory.

See `COMPACT_APPEND.md` for commands and package recovery instructions.

Backup check implementation: `scripts/src/append/backup-readiness.ts`.
It expects a fresh, separate localhost PostgreSQL server on port 55433 with the
`postgres` role; initialize that disposable server with `initdb -U postgres`.
Never substitute a production connection for its literal restore destination.
It deliberately refuses unexpected production identity or an existing local
recovery database. It is not part of application startup or publishing.
