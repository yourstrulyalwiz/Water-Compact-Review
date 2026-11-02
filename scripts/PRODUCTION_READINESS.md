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
  transcription/region status preserved. The exact manual-region boundary was
  not visually separable from the infographic: alignment remains unconfirmed,
  not certified as native-text alignment.
- Non-blocking PDF font warning: `TT: undefined function: 21`.

## Remaining gates, in order

1. **Production backup and restore evidence:** obtain an all-schema production
   backup, retain it privately, and restore it in an isolated database. Verify
   the review tables and source tables in that restore. This has NOT been done;
   the available production SQL callback is read-only and is not a backup or
   restore facility. The earlier restore test used development data only.
   Use the Database tool's supported production backup/export facilities or an
   approved operator connection for pg_dump; never paste credentials into chat.
2. **Review the actual Publish schema diff:** it must include the narrowly scoped
   country/pattern changes and multiple-batch support, without replacing data,
   dropping source/review tables, or changing the active dataset. The actual diff
   has NOT been inspected. If secondary-schema changes are omitted, stop and
   resolve the supported migration route; no startup/build/custom production DDL.
3. **Resolve Uzbekistan visual acceptance:** compare the supplied manual geometry
   with the displayed image region before certifying exact highlight alignment.
   Do not rewrite authoritative source geometry without approval.
4. **Publish and authenticated smoke tests:** only after approval, publish the
   compatible code/assets and supported schema diff. Check original-country
   operation and production PDF bytes/hashes using authorized access.
5. **Fresh plan and explicit data-only append approval:** pin the actual database,
   unchanged active dataset, verified package fingerprint, and fresh inventory.
   Do not run apply until all preceding gates are satisfied. Then verify full
   preservation and the exact added batch inventory.

See `COMPACT_APPEND.md` for commands and package recovery instructions.
