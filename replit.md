# Water Compact Reform-Action Review

A read-only web application that lets policy experts validate LLM-identified reform-action candidates against their exact source passages in the official Cambodia, Sierra Leone, and Jamaica Water Compact PDFs.

## Run & Operate

- `pnpm --filter @workspace/compact-review run dev` — run the frontend review app (port 25670, preview at `/`)
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, at `/api`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- Required env: `DATABASE_URL` — Postgres connection string (pre-configured)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5, raw SQL via `pg` pool (no Drizzle ORM for queries — schema is pre-existing)
- DB: PostgreSQL (schema loaded from `source_package/schema_postgres.sql`)
- Frontend: React 19 + Vite, TailwindCSS v4, shadcn/ui, react-resizable-panels
- PDF rendering: pdfjs-dist 4.4.168 (v4 required — v5+ uses Map.getOrInsertComputed not yet in preview browser)
- API codegen: Orval (from OpenAPI spec in `lib/api-spec/openapi.yaml`)
- Build: esbuild (API server)

## Where things live

- `source_package/` — extracted ZIP: CSVs, PDFs, schema, data dictionary
- `source_package/documents/` — the three official Water Compact PDFs (served by API at `/api/documents/:id/pdf`)
- `source_package/schema_postgres.sql` — the authoritative DB schema (applied once via psql)
- `lib/api-spec/openapi.yaml` — OpenAPI contract for all endpoints
- `artifacts/api-server/src/routes/` — Express route handlers (documents, candidates, anchors, relationships, stats)
- `artifacts/compact-review/src/pages/Workspace.tsx` — main 3-panel review UI
- `artifacts/compact-review/src/components/PdfViewer.tsx` — PDF.js viewer with highlight overlays

## Architecture decisions

- **Raw SQL over Drizzle ORM**: The data model is pre-defined via `schema_postgres.sql` with complex types and constraints (text PKs, check constraints, bigserial PKs for review tables). Using `pool.query()` directly avoids maintaining a parallel Drizzle schema definition.
- **pdfjs-dist 4.x pinned**: v5+ uses `Map.prototype.getOrInsertComputed` (V8-only, not yet in all browsers). v4.4.168 is stable and universally compatible.
- **PDFs served from source_package/**: PDFs stay in their extraction location and are served via Express `fs.createReadStream`. The API sends `X-Document-SHA256` header for client-side hash verification.
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

**Phase 2 (pending):** Human review workflow (anchor accept/correct/reject, candidate validation)

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
- PDF path resolution: `process.cwd()` when API server runs is `artifacts/api-server/`, so PDFs are at `../../source_package/documents/`
- The `candidate_stream` field contains the full string "A — High-confidence Reform Action" etc., not just "A"/"B"/"C" — filter by checking if the string starts with "A"/"B"/"C"

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- Data dictionary: `source_package/source_anchor_data_dictionary.md`
- Package README: `source_package/README.md`
