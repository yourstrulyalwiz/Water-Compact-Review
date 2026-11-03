# Production append: operator checks and data-only commands

## Scope and unresolved gate

This is a one-time operator checklist, not a production schema migration script.
It contains no production DDL and does not authorize running migration 004 against
production. Replit's Agent guidance prohibits preparing or executing a custom
managed-production schema migration. Owner SQL access is documented, but a
supported route for this particular migration must be confirmed separately.

The existing development migration is
`artifacts/api-server/migrations/004_compact_v5_append.sql`. It remains the exact
scope reference for the required changes. Do not apply other migrations, disable
triggers, replace data, activate another dataset, or add build/startup migrations.

## Findings when this checklist was prepared

- Fresh managed Publish diff: success, no statements, no warnings, `hasDiff=false`.
- Fresh production SQL: `neondb`, active dataset
  `water-compacts-v5-baseline-01`, 252 candidates, 242 review events.
- Both provenance columns remain absent; the three four-country allowlists,
  old candidate-ID check, and single-batch unique constraint/index remain.
- Full-row aggregate fingerprints and counts of all 33 tables in the verified
  2026-11-02 17:06 UTC backup inventory match current production.
- Consequently no data divergence currently requires replacing that backup.
  Recheck immediately before any approved write; refresh if data has changed.
  The earlier isolated restore and append rehearsal remains evidence, not proof
  of live database permissions. Ownership and grants were not certified.
- These observations are point-in-time, not a guarantee that reviewers stop
  adding responses after the check.

## 1. Select the production connection

In Replit: Tools → Database → select **Production** → My Data → SQL console.
For an external PostgreSQL client, obtain connection details from the selected
Production database, not the development database. Keep credentials out of chat,
command-line arguments, shared files, and screenshots.

Run this read-only query. Expected before the append: `neondb`, the dataset below,
252 candidates, 242 reviews. Review counts may legitimately increase.
Database name alone is NOT proof of selecting production; also confirm the UI
database selection or external client's host against Production connection details.

```sql
SELECT current_database() AS database_name,
       (SELECT active_dataset_id
          FROM compact_v5.dataset_state WHERE singleton) AS active_dataset,
       (SELECT count(*) FROM compact_v5.candidate_baselines) AS candidates,
       (SELECT count(*) FROM compact_v5.review_events) AS review_events;
```

Stop on an unexpected target, dataset or unexplained discrepancy.

## 2. Verify schema after a supported schema-only operation

This checklist does not contain that operation. Do not proceed to the append
merely because a SQL console is available.

Run these read-only queries:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'compact_v5'
  AND table_name = 'import_batches'
  AND column_name IN ('batch_key', 'package_sha256')
ORDER BY column_name;

SELECT r.relname AS table_name,
       c.conname,
       pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
JOIN pg_class r ON r.oid = c.conrelid
JOIN pg_namespace n ON n.oid = r.relnamespace
WHERE n.nspname = 'compact_v5'
  AND (
    (r.relname IN ('documents','candidate_baselines','reviewer_assignments')
      AND c.contype = 'c')
    OR r.relname = 'import_batches'
  )
ORDER BY r.relname, c.conname;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'compact_v5' AND tablename = 'import_batches'
ORDER BY indexname;
```

Expected:

- Two columns: `batch_key` and `package_sha256`, both `text`, nullable `YES`.
- Country checks on documents, candidate baselines and reviewer assignments
  accept KHM, SLE, JAM, COD, AGO, BOL, BDI, CIV, GIN, MOZ, SEN, TGO, UZB, ZMB.
- Candidate-ID check is
  `^(KHM|SLE|JAM|COD|AGO|BOL|BDI|CIV|GIN|MOZ|SEN|TGO|UZB|ZMB)-RA-[0-9]{3,}[A-Z]*$`.
- The separate candidate-ID/country equality check is unchanged.
- No `UNIQUE (dataset_id)` constraint or standalone unique index enforcing that
  single-batch rule remains on import_batches.
- `import_batches_dataset_batch_key_idx` uniquely indexes `(dataset_id,batch_key)`.
- `package_sha256` permits NULL or matches `^[0-9a-f]{64}$`.
- Primary keys, foreign keys, other validation constraints and immutable triggers
  remain unchanged. Compare the complete schema inventory for this assurance;
  the targeted queries above alone do not establish it.
- Candidate/review contents and the active dataset are unchanged. Counts alone
  are not preservation proof. When comparing the pre-schema backup to the
  post-schema state, account explicitly for the two new NULL metadata fields on
  old import batches, rather than treating their changed row shape as data loss.

## 3. Prepare the operator environment

The following commands run in a Bash shell at the repository root, NOT in the
SQL console. They require the existing dependencies, the validated source package,
private App Storage access, and the exact PDF assets already prepared by the
implementation.

Use an isolated approved operator session whose `DATABASE_URL` is securely
configured to the production connection. The ordinary workspace connection is
development; `--environment production` does NOT select a production database.
Do not change the application's shared development DATABASE_URL.
Do not assume the backup credential is authorized for data writes.

Confirm compatible application code and exact PDF assets are deployed and
accessible through authorized production requests. An HTTP 200 login page is
not evidence that a PDF is available.

## 4. Plan, approve, append, verify

Only use these commands after the schema checks pass, the backup freshness gate
is satisfied, and the operator connection is confirmed.

Set the common arguments and choose a new inventory filename for this attempt.
The tool refuses to overwrite an existing inventory file.

```bash
common=(
  --manifest ../source_package/append-20261020/append-manifest.json
  --environment production
  --dataset water-compacts-v5-baseline-01
  --inventory ../generated-artifacts/append-tests/production-before-approved-append.json
)

COMPACT_APPEND_TARGET_ENV=production \
pnpm --filter @workspace/scripts run compact:v5:append:plan "${common[@]}"
```

Plan is database-read-only and saves a local full-row preservation inventory.
Expected: database `neondb`, the same active dataset, new batch
`water-compacts-append-20261020-ten-countries-v1`, 565 new candidates and ten new
documents with the manifest's other linked additions. No existing rows should
change. If it reports `already-applied`, investigate/verify rather than appending
another batch.

After reviewing the plan and explicitly approving the data-only write:

```bash
COMPACT_APPEND_TARGET_ENV=production \
pnpm --filter @workspace/scripts run compact:v5:append:apply "${common[@]}" \
  --expected-database neondb \
  --expected-package-sha256 70c2790c3fc07527eb8beac1062000a464d9e41547cd4a128018cf10f41e06e3 \
  --production-approved \
  --backup-restore-verified
```

Those flags attest approval and a verified backup; they do not perform a backup.
The command is the existing data-only append tool, not a schema migrator.

Then:

```bash
COMPACT_APPEND_TARGET_ENV=production \
pnpm --filter @workspace/scripts run compact:v5:append:verify "${common[@]}" \
  --expected-package-sha256 70c2790c3fc07527eb8beac1062000a464d9e41547cd4a128018cf10f41e06e3
```

Expected: `result: verified`, `existing_rows_preserved: true`; 817 candidates if
the starting count remains 252; the same active dataset. Every predecessor review
and comment must match its inventory fingerprint. Legitimate later human reviews
may increase review counts and must not be removed to force equality.

Verify the production application lists the new countries/candidates, exports
the complete dataset, and serves old and new PDFs with the expected hashes.
Do not test preservation by submitting fabricated production reviews.

If a step fails, stop. Do not disable a guard, delete the batch, rerun the original
baseline importer, or restore an old dump over subsequent human work.
