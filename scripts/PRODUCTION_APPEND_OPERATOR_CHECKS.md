# Production append: operator checks and data-only commands

## Scope and current gate

This is a one-time operator checklist, not a production schema migration script.
It contains no production DDL. The owner has already applied migration 004;
fresh live checks on 2026-11-05 confirm its prerequisites now pass. Do not reapply
schema migrations as part of this operation. The remaining gate is production
PDF availability; the data-only append has not been performed.

The existing development migration is
`artifacts/api-server/migrations/004_compact_v5_append.sql`. It remains the exact
scope reference for the required changes. Do not apply other migrations, disable
triggers, replace data, activate another dataset, or add build/startup migrations.

## Findings when this checklist was prepared

- Fresh production SQL: `neondb`, active dataset
  `water-compacts-v5-baseline-01`, 252 candidates, 242 review events.
- Both nullable provenance columns, all 14-country checks, candidate-ID pattern,
  checksum check and unique dataset/batch-key index are present. The old
  single-batch constraint/index are absent.
- The existing production plan passed and saved a full-row inventory covering
  all 33 tables and all 242 review events.
- A refreshed backup captured 2026-11-05 05:32:53 UTC was archived privately and
  restored in isolation, matching all 33 inventories and schema checks.
  Its inventory exactly matches the fresh plan inventory.
- Local hashes of all ten PDFs match; the latest successful production build
  logs copying source PDFs. The private published documents route redirects
  unauthenticated requests to Replit sign-in, so deployed-byte checks remain
  unresolved. Build-copy evidence alone is not a production hash verification.
- The existing credential reports INSERT privilege on the compact tables.
  No test write was made; the credential was used only with read-only sessions.
- The earlier append rehearsal remains valid for unchanged tool/package behavior;
  ownership and grants remain uncertified by local restore tests.
- These observations are point-in-time, not a guarantee that reviewers stop
  adding responses after the check.

## 1. Select the production connection

### Confirm the deployed October PDFs before any append

Publish the current code/assets **without overwriting production data**. This
adds only a read-only diagnostic route; it does not append data or migrate schema.
Then, in a browser signed in with access to the private production app, open:

`https://water-compact-review.replit.app/api/append-readiness/october-2026`

Acceptance requires HTTP 200 and the following JSON values:

```json
{
  "ready": true,
  "read_only": true,
  "database_accessed": false,
  "batch_key": "water-compacts-append-20261020-ten-countries-v1",
  "package_sha256": "70c2790c3fc07527eb8beac1062000a464d9e41547cd4a128018cf10f41e06e3",
  "asset_location": "bundled-documents",
  "expected_documents": 10,
  "verified_documents": 10
}
```

The complete response also includes the check time and ten document results,
each with `status: "verified"` and identical expected/actual SHA256 values.
It reads only `dist/documents/v5/append-20261020/` on the serving machine, so it
works before document rows are imported and cannot conceal missing deployment
files by reading workspace copies. It does not query the database or return PDF
contents, review data, absolute paths, or credentials. It inherits the existing
private deployment boundary and is limited to six checks per minute per IP.
No reviewer token needs to be placed in a URL.

A 503 report with `ready: false`, a missing/corrupt/unreadable document, a 404,
a sign-in page, or a development-preview result does NOT satisfy this production
gate. A 429 means wait a minute before retrying. Opening this URL never performs
the append. Copy the JSON result back for confirmation before continuing.

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

The owner has completed the schema operation and these checks passed during
preparation. Repeat them if the target or schema changes; do not run another
schema operation as part of the append.

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

The existing `COMPACT_PRODUCTION_BACKUP_URL` secret was successfully used for the
production read-only plan and fresh backup. If the owner approves reusing that
credential for the authorized data-only append, this subshell selects it only
for the operator session; it does not change workspace or deployment settings:

```bash
(
  set +x
  set -e
  test -n "${COMPACT_PRODUCTION_BACKUP_URL:-}" || {
    echo "Required production connection secret is unavailable"; exit 1;
  }
  export DATABASE_URL="$COMPACT_PRODUCTION_BACKUP_URL"
  export COMPACT_APPEND_TARGET_ENV=production
  inventory="../generated-artifacts/append-tests/production-owner-before-$(date -u +%Y%m%dT%H%M%SZ).json"
  common=(
    --manifest ../source_package/append-20261020/append-manifest.json
    --environment production
    --dataset water-compacts-v5-baseline-01
    --inventory "$inventory"
  )
  pnpm --filter @workspace/scripts run compact:v5:append:plan "${common[@]}"
  # STOP before apply unless production PDFs and backup requirements are satisfied.
  read -r -p "Production PDFs verified and data-only append approved? Type APPEND: " approval
  test "$approval" = APPEND || exit 1
  pnpm --filter @workspace/scripts run compact:v5:append:apply "${common[@]}" \
    --expected-database neondb \
    --expected-package-sha256 70c2790c3fc07527eb8beac1062000a464d9e41547cd4a128018cf10f41e06e3 \
    --production-approved --backup-restore-verified
  pnpm --filter @workspace/scripts run compact:v5:append:verify "${common[@]}" \
    --expected-package-sha256 70c2790c3fc07527eb8beac1062000a464d9e41547cd4a128018cf10f41e06e3
)
```

Run from the repository root in Replit Shell only after the outstanding asset
gate is resolved. Never paste a credential into the command, enable shell
tracing, or print DATABASE_URL. The prompt is an operator attestation, not an
automatic asset verification. Do not type APPEND merely because the plan passed.

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
