# Compact append readiness — 2026-11-02

## Decision: hold production append

Development checks passed, but production is not yet ready for the append.
This check made no production writes and did not publish the app.

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
