# Water Compact Reform-Action Review

A three-panel review application for v5 reform-action candidates from Cambodia, Sierra Leone, Jamaica, and the Democratic Republic of the Congo. The earlier three-country dataset and its review history remain in the public schema.

## Run & Operate

- `pnpm --filter @workspace/compact-review run dev` — run the frontend review app (port 5173, preview at `/`)
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, at `/api`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/scripts run compact:v5:validate -- --manifest source_package/v5/import-manifest.json` — check immutable source files and workbook integrity
- `pnpm --filter @workspace/scripts run compact:v5:import -- --manifest source_package/v5/import-manifest.json --mode stage` — stage v5 in development only
- `pnpm --filter @workspace/scripts run compact:v5:verify -- --dataset water-compacts-v5-baseline-01 --manifest source_package/v5/import-manifest.json` — verify staged data and source fingerprints
- `pnpm --filter @workspace/scripts run compact:v5:activate -- --dataset water-compacts-v5-baseline-01` — select verified v5 in development; `--dataset legacy` selects the archived public-schema view without deleting either dataset
- Required env: `DATABASE_URL` — Postgres connection string (pre-configured)

## Stack

- pnpm workspaces, Node.js 20, TypeScript 5.9
- API: Express 5, raw SQL via `pg` pool (no Drizzle ORM for queries — schema is pre-existing)
- DB: PostgreSQL (legacy public schema from `source_package/schema_postgres.sql`; separate `compact_v5` SQL schema)
- Frontend: React 19 + Vite, TailwindCSS v4, shadcn/ui, react-resizable-panels
- PDF rendering: pdfjs-dist 4.4.168 (v4 required — v5+ uses Map.getOrInsertComputed not yet in preview browser)
- API codegen: Orval (from OpenAPI spec in `lib/api-spec/openapi.yaml`)
- Build: esbuild (API server)

## Where things live

- `source_package/` — original legacy CSVs, PDFs, schema, data dictionary
- `source_package/v5/` — immutable four-country handoff including manifest, original workbooks and four PDFs
- `source_package/documents/` — original PDFs and trusted v5 PDF copies under `v5/` (served by API at `/api/documents/:id/pdf`)
- `artifacts/api-server/migrations/003_compact_v5_schema.sql` — separately staged v5 schema; apply to development only before importing; never run on server startup
- `source_package/schema_postgres.sql` — the authoritative DB schema (applied once via psql)
- `lib/api-spec/openapi.yaml` — OpenAPI contract for all endpoints
- `artifacts/api-server/src/routes/` — Express route handlers (documents, candidates, anchors, relationships, stats)
- `artifacts/compact-review/src/pages/Workspace.tsx` — main 3-panel review UI
- `artifacts/compact-review/src/components/PdfViewer.tsx` — PDF.js viewer with highlight overlays

## Architecture decisions

- **Raw SQL over Drizzle ORM**: The data model is pre-defined via `schema_postgres.sql` with complex types and constraints (text PKs, check constraints, bigserial PKs for review tables). Using `pool.query()` directly avoids maintaining a parallel Drizzle schema definition.
- **pdfjs-dist 4.x pinned**: v5+ uses `Map.prototype.getOrInsertComputed` (V8-only, not yet in all browsers). v4.4.168 is stable and universally compatible.
- **PDF provenance**: v5 PDFs have exact-version trusted copies in `source_package/documents/v5/` and API build copies in `dist/documents/v5/`; the API verifies stored document hashes against bytes before serving. The browser hashes fetched bytes before drawing rectangles.
- **Separate dataset state**: v5 is staged, verified and activated explicitly in development. It never overwrites the old public schema; no import, migration or activation runs at server startup or build time.
- **Normalized highlight coordinates**: All rectangle overlays use the normalized 0-1 coordinates from the DB (`x0_normalized * canvasWidth`) scaled to the rendered canvas size, tracked via ResizeObserver so zoom doesn't displace highlights.
- **Append-only review tables**: `anchor_reviews` and `candidate_reviews` use bigserial PKs and never overwrite the original LLM evidence — designed for Phase 2 editing workflow.

## Product

**Phase 1 (complete):** Read-only review prototype
- 3-panel workspace: candidate list + filters (left), PDF viewer with precise highlights (center), methodology detail (right)
- 189 candidates from Cambodia, Sierra Leone, Jamaica
- 272 source anchors with 1,572 highlight rectangles
- PDF SHA-256 hash verification before enabling highlights
- Multi-anchor navigation (Primary Evidence, Context, Aspiration, Explicit Mechanism, etc.)
- All 24 methodology variables displayed in the review panel
- Aspiration-to-mechanism comparison view

**v5 development pilot:** 252 candidates, 4 documents, 348 evidence records, 350 candidate-evidence links, 968 highlight rectangles. Original-language and translated text, relationships and append-only review events are retained. Server-derived finally approved count starts at zero. Reviewer name selection is only a prototype, not verified identity; stage coordinator resolutions and finalization remain disabled until verified authentication and explicit assignments are configured.

## Data import (already done — do not re-run)

```bash
psql $DATABASE_URL < source_package/schema_postgres.sql
psql $DATABASE_URL -c "\COPY documents FROM 'source_package/documents.csv' CSV HEADER"
psql $DATABASE_URL -c "\COPY candidates FROM 'source_package/candidates.csv' CSV HEADER"
psql $DATABASE_URL -c "\COPY source_anchors FROM 'source_package/source_anchors.csv' CSV HEADER"
psql $DATABASE_URL -c "\COPY anchor_rectangles FROM 'source_package/anchor_rectangles.csv' CSV HEADER"
psql $DATABASE_URL -c "\COPY item_relationships FROM 'source_package/item_relationships.csv' CSV HEADER"
psql $DATABASE_URL -c "\COPY unresolved_anchors FROM 'source_package/unresolved_anchors.csv' CSV HEADER"
```

Verified counts: 3 docs · 189 candidates · 272 anchors · 1,572 rectangles · 65 relationships · 0 unresolved

## User preferences

- Do not alter the supplied LLM classifications, evidence quotations, or anchor coordinates
- Append-only review history — original records are immutable evidence

## Gotchas

- **pdfjs-dist must stay at v4.x** — upgrading to v5+ breaks PDF rendering in the Replit preview browser
- **Do NOT run `pnpm --filter @workspace/db run push`** — the DB schema was loaded via psql, not Drizzle; running push would attempt to reconcile and may conflict
- The post-merge setup installs packages but does not reconcile the SQL-managed schema via Drizzle.
- The legacy stream uses letter-prefixed labels, while v5 uses the exact three full labels in its manifest; do not map by initial letters or silently treat legacy decisions as v5 approval.
- The v5 SQL migration and activation here target development only. Publication and production data migration are separate decisions; do not deploy or overwrite existing production reviews as part of the v5 import.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- Data dictionary: `source_package/source_anchor_data_dictionary.md`
- Package README: `source_package/README.md`
