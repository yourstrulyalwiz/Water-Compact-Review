# Safe compact appends

These tools append data to the **existing active dataset**. They do not activate
datasets, change existing rows, create human reviews, or run schema migrations.
Never replace production with development data.

## Package and assets

The October package is assembled at `source_package/append-20261020/`.
Originals are not in Git. All 51 package files are retained in private App Storage,
under `compact-append/<package fingerprint>` within the configured private directory.
The exact PDFs are materialized at the manifest's paths and copied by the existing
API build into `dist/documents/`; no new public storage route is introduced.

From the workspace root (pnpm filter commands run in `scripts/`):

```sh
pnpm --filter @workspace/scripts compact:v5:append:validate \
  --manifest ../source_package/append-20261020/append-manifest.json
pnpm --filter @workspace/scripts compact:v5:append:prepare \
  --manifest ../source_package/append-20261020/append-manifest.json
```

For a fresh checkout, restore into a new empty directory, then validate and prepare:

```sh
pnpm --filter @workspace/scripts compact:v5:append:restore \
  --expected-package-sha256 70c2790c3fc07527eb8beac1062000a464d9e41547cd4a128018cf10f41e06e3 \
  --output ../source_package/append-20261020
```

Do this **before building/publishing**. Missing PDFs block apply. Never publish a
checkout with only database rows and no PDF assets. Keep original file names and
SHA256SUMS.json unchanged. Future packages must use the same validated format,
new batch keys, unique countries/IDs and supported country constraints.

## Development

Apply `artifacts/api-server/migrations/004_compact_v5_append.sql` through the
development migration process only. It discovers the relevant constraint names,
extends country checks, permits multiple batches, and leaves immutable triggers
and data untouched. Original migration 003 is unchanged.

Run plan with an explicit dataset and a new private inventory file:

```sh
pnpm --filter @workspace/scripts compact:v5:append:plan \
  --manifest ../source_package/append-20261020/append-manifest.json \
  --environment development --dataset water-compacts-v5-baseline-01 \
  --inventory ../generated-artifacts/append-before.json
```

Review the database identity, existing batches, constraints, counts and proposed
deltas. Then use the same arguments with `compact:v5:append:apply`, adding:

```text
--expected-database <database name from plan>
--expected-package-sha256 <fingerprint from validate>
```

`compact:v5:append:verify` uses the same manifest, environment, dataset, inventory
and expected fingerprint. Verification compares all previously inventoried rows
by primary key and complete server-side row hash; it allows new rows, but never
modifications/removal of old rows. Inventories contain hashes, not review text.
Keep them private and retain them with the operational backup.

Apply is one transaction with a dataset advisory lock and active-pointer share
lock. Conflicts abort the batch. Deferred constraints and content checks run
before commit. A completed matching batch is verified and returns `already-applied`,
including after later human decisions and assessment revisions. Existing-country
overlap or a changed fingerprint requires investigation, never an upsert.

## Production approval gate

No production writes or publication were performed while implementing this
feature. A read-only preflight on 2026-11-02 confirmed the live active dataset is
`water-compacts-v5-baseline-01`, with 252 candidates and 242 review events at the
time of the query. The two append-provenance columns are not present in production,
so the schema prerequisite is NOT satisfied. Recheck these observations before
rollout; additional human reviews may arrive in the meantime.

1. Confirm the deployed database/schema and API use the same active dataset.
2. Take an all-schema recoverable backup and test a restore in isolation; keep
   an access-controlled review export. Development restore tests are not a
   substitute for a production backup.
3. For Replit-managed PostgreSQL, inspect and approve the **Publish schema diff**.
   There is no custom production DDL command. If `compact_v5` changes are absent
   from that diff, STOP; do not use startup/build DDL or the overwrite-data option.
4. Prepare and publish the code/assets separately, then check original countries
   and exact PDF route hashes. A login page with HTTP 200 is not a PDF check.
5. In an approved operator environment with the deployment's actual connection,
   explicitly configure `COMPACT_APPEND_TARGET_ENV=production`. Run `plan` with
   `--environment production`, checking the database identity and dataset.
6. After explicit approval, run **data-only** apply with the pinned inventory,
   database, fingerprint, `--production-approved --backup-restore-verified`.
   These flags attest operator approval/backup work; they do not create a backup.
7. Run verify and API/export/PDF smoke checks. No production connection is copied
   into source, logs, build commands, or this document.

Before commit, errors roll back. After commit, do not delete a batch or restore an
old backup over later reviews: use a separately reviewed roll-forward recovery.

## Tests performed

Full typecheck, frontend/API production builds, package checksums/source mapping,
and isolated PostgreSQL tests passed. The isolated database was restored from a
development dump, not from production. Tests cover failed-transaction rollback,
concurrent jobs, full append content, original-row preservation, repeat import
after later reviews/revisions, mismatched batch/target, and pagination beyond 500
including duplicate/network errors and legacy responses.

The integration test at `src/append/append.test.ts` deliberately uses only a
disposable localhost PostgreSQL database on port 55432 named `compact_append_test`.
Restore a fresh development fixture there and apply migration 004 before running:
`cd scripts && pnpm exec tsx src/append/append.test.ts`.
Never point it at production. Full interactive highlight review and the production
schema-diff approval and production apply remain operator acceptance gates.
The real-production backup restore and append rehearsal subsequently passed;
see `PRODUCTION_READINESS.md` for the evidence and remaining visual check.
