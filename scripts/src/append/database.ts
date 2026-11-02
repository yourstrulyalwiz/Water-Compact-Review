import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { columns, tables, canonical, initialAssessment, type Row } from './columns.js';
import { requireThat, type AppendPackage } from './package.js';

const ident = (name: string) => `"${name.replaceAll('"', '""')}"`;
export interface Inventory { database: string; dataset: string; tables: Record<string, Record<string, string>> }
/** Hash full rows server-side; inventory contains no review text or connection strings. */
export async function inventory(client: PoolClient, dataset: string): Promise<Inventory> {
  const database = (await client.query('SELECT current_database() AS name')).rows[0].name;
  const found = await client.query(`SELECT n.nspname, c.relname,
    COALESCE((SELECT json_agg(a.attname ORDER BY k.ord)
      FROM pg_index i CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(num,ord)
      JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.num
      WHERE i.indrelid=c.oid AND i.indisprimary), '[]') AS keys
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind='r' AND n.nspname NOT IN ('pg_catalog','information_schema')
      AND n.nspname NOT LIKE 'pg_toast%' ORDER BY n.nspname,c.relname`);
  const result: Inventory = { database, dataset, tables: {} };
  for (const table of found.rows) {
    const name = `${table.nspname}.${table.relname}`;
    const keys: string[] = table.keys;
    const q = `${ident(table.nspname)}.${ident(table.relname)}`;
    const keyExpr = keys.length ? `jsonb_build_array(${keys.map(k => `t.${ident(k)}`).join(',')})::text` : 'md5(to_jsonb(t)::text)';
    const rows = await client.query(`SELECT ${keyExpr} AS key, md5(to_jsonb(t)::text) AS hash FROM ${q} t`);
    const values: Record<string, string> = {};
    for (const r of rows.rows) {
      // Include multiplicity for tables without a primary key.
      const key = r.key;
      values[key] = keys.length ? r.hash : String(Number(values[key] || 0) + 1);
    }
    result.tables[name] = values;
  }
  return result;
}
export function assertPreserved(before: Inventory, after: Inventory) {
  requireThat(before.database === after.database && before.dataset === after.dataset, 'Inventory target differs');
  for (const [table, rows] of Object.entries(before.tables)) {
    requireThat(after.tables[table], `Preservation failure: missing table ${table}`);
    for (const [key, fingerprint] of Object.entries(rows)) {
      requireThat(after.tables[table][key] === fingerprint, `Preservation failure in ${table}; existing row changed or missing`);
    }
  }
}
export async function preflight(client: PoolClient, pkg: AppendPackage, dataset: string) {
  const schema = await client.query(`SELECT to_regclass('compact_v5.dataset_state') AS state`);
  requireThat(schema.rows[0].state, 'V5 absent: this append path is not applicable');
  const state = await client.query('SELECT active_dataset_id FROM compact_v5.dataset_state WHERE singleton');
  requireThat(state.rows[0]?.active_dataset_id === dataset, 'Explicit dataset is not the active dataset');
  const defs = await client.query(`SELECT c.conrelid::regclass::text AS table_name,
    c.conname, pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c
    JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='compact_v5' ORDER BY 1,2`);
  const columnCheck = await client.query(`SELECT column_name FROM information_schema.columns
    WHERE table_schema='compact_v5' AND table_name='import_batches'
    AND column_name IN ('batch_key','package_sha256')`);
  requireThat(columnCheck.rowCount === 2, 'Append schema migration missing; apply development migration / review Publish schema diff first');
  requireThat(!defs.rows.some(r => r.table_name === 'compact_v5.import_batches' && r.definition === 'UNIQUE (dataset_id)'), 'Single-batch constraint still present');
  for (const table of ['documents', 'candidate_baselines', 'reviewer_assignments']) {
    const allowlist = defs.rows.find(r => r.table_name === `compact_v5.${table}` && r.definition.includes('country_code = ANY'));
    requireThat(allowlist && pkg.manifest.countries.every((c: Row) => allowlist.definition.includes(`'${c.country_code}'`)), `Country constraint not ready: ${table}`);
  }
  const tax = await client.query('SELECT tier1_domain,tier2_category FROM compact_v5.taxonomy_categories WHERE dataset_id=$1', [dataset]);
  const pairs = new Set(tax.rows.map(r => canonical([r.tier1_domain, r.tier2_category])));
  requireThat(pkg.reference.Taxonomy.every((r: Row) => pairs.has(canonical([r.Tier1_Domain, r.Tier2_Category]))), 'Live taxonomy differs');
  const solutions = await client.query('SELECT code FROM compact_v5.scalable_solutions WHERE dataset_id=$1', [dataset]);
  requireThat(pkg.reference.Scalable_Solutions.every((r: Row) => solutions.rows.some(s => s.code === r.Code)), 'Missing solution reference');
  const batches = await client.query('SELECT batch_id,batch_key,package_sha256,status FROM compact_v5.import_batches WHERE dataset_id=$1', [dataset]);
  const existing = batches.rows.find(r => r.batch_key === pkg.manifest.batch_key);
  if (existing) requireThat(existing.package_sha256 === pkg.fingerprint && existing.status === 'activated', 'Batch fingerprint/status conflict');
  const overlaps = await client.query(`SELECT country_code FROM compact_v5.documents WHERE dataset_id=$1 AND country_code=ANY($2::text[])`,
    [dataset, pkg.manifest.countries.map((c: Row) => c.country_code)]);
  if (!existing) requireThat(!overlaps.rowCount, 'Incoming country already exists; separate migration required');
  const counts = await client.query(`SELECT country_code,candidate_stream,count(*)::int AS count
    FROM compact_v5.candidate_baselines WHERE dataset_id=$1 GROUP BY 1,2 ORDER BY 1,2`, [dataset]);
  // Every supplied primary identifier must be new, even if associated with another country.
  if (!existing) {
    for (const [table, key] of Object.entries({
      documents: 'document_id', analysis_runs: 'analysis_run_id', candidate_baselines: 'candidate_id',
      evidence: 'evidence_id', evidence_rectangles: 'rectangle_id', relationships: 'relationship_id', id_crosswalk: 'scan_id',
    })) {
      const incoming = pkg.data[table as keyof typeof pkg.data].map(r => r[key]);
      const collision = await client.query(`SELECT 1 FROM compact_v5.${table} WHERE dataset_id=$1 AND ${key}=ANY($2::text[]) LIMIT 1`, [dataset, incoming]);
      requireThat(!collision.rowCount, `Existing ${table} key collision`);
    }
  }
  return { existing, batches: batches.rows, counts: counts.rows, constraints: defs.rows,
    additions: existing ? {} : pkg.manifest.expected_table_deltas, active_dataset_id: dataset,
    database: (await client.query('SELECT current_database() AS name')).rows[0].name };
}
async function insert(client: PoolClient, table: string, rows: Row[]) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  // Caller controls table and keys exclusively using the static allowlist.
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    await client.query(`INSERT INTO compact_v5.${table} (${keys.map(ident).join(',')})
      SELECT ${keys.map(ident).join(',')} FROM jsonb_populate_recordset(NULL::compact_v5.${table}, $1::jsonb)`,
      [JSON.stringify(chunk)]);
  }
}
/** Match immutable imported content, not current/latest assessments or later reviews. */
export async function verifyBatch(client: PoolClient, pkg: AppendPackage, dataset: string, batch: string) {
  for (const table of [...tables, 'candidate_assessments'] as const) {
    const expected = table === 'candidate_assessments' ? pkg.data.candidate_baselines.map(initialAssessment) : pkg.data[table];
    const keys = table === 'candidate_assessments' ? Object.keys(expected[0] || {}) : columns[table].split(',');
    const actual = await client.query(`SELECT to_jsonb(t) AS row FROM compact_v5.${table} t WHERE dataset_id=$1`, [dataset]);
    const counts = new Map<string, number>();
    for (const { row } of actual.rows) {
      const value = canonical(Object.fromEntries(keys.map(k => [k, row[k]])));
      counts.set(value, (counts.get(value) || 0) + 1);
    }
    for (const row of expected) {
      const value = canonical(Object.fromEntries(keys.map(k => [k, row[k]])));
      requireThat((counts.get(value) || 0) > 0, `Batch verification failed: ${table} immutable row differs/missing`);
      counts.set(value, counts.get(value)! - 1);
    }
  }
  const owned = await client.query(`SELECT candidate_id FROM compact_v5.candidate_baselines
    WHERE dataset_id=$1 AND imported_batch_id=$2 ORDER BY candidate_id`, [dataset, batch]);
  requireThat(canonical(owned.rows.map(r => r.candidate_id)) === canonical(pkg.data.candidate_baselines.map(r => r.candidate_id).sort()), 'Batch ownership differs');
  const files = await client.query('SELECT source_path,sha256,byte_size::text FROM compact_v5.import_files WHERE dataset_id=$1 AND batch_id=$2', [dataset, batch]);
  const wanted = [...pkg.files, { path: 'SHA256SUMS.json', sha256: pkg.fingerprint }];
  requireThat(files.rows.length === wanted.length, 'Batch provenance count differs');
  for (const f of wanted) requireThat(files.rows.some(r => r.source_path === `append/${pkg.manifest.batch_key}/${f.path}` &&
    r.sha256 === f.sha256 && (!('size_bytes' in f) || r.byte_size === String(f.size_bytes))), 'Batch file provenance differs');
}
export async function applyAppend(client: PoolClient, pkg: AppendPackage, dataset: string, before: Inventory, archiveReceipt: Row) {
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`compact-append:${dataset}`]);
    // Share lock allows normal review inserts but prevents active-pointer changes.
    await client.query('SELECT active_dataset_id FROM compact_v5.dataset_state WHERE singleton FOR SHARE');
    await client.query('SELECT dataset_id FROM compact_v5.datasets WHERE dataset_id=$1 FOR SHARE', [dataset]);
    const plan = await preflight(client, pkg, dataset);
    assertPreserved(before, await inventory(client, dataset));
    if (plan.existing) {
      await verifyBatch(client, pkg, dataset, plan.existing.batch_id);
      await client.query('COMMIT');
      return { result: 'already-applied', batch_id: plan.existing.batch_id };
    }
    const batch = randomUUID();
    await client.query(`INSERT INTO compact_v5.import_batches(batch_id,dataset_id,source_fingerprint,batch_key,package_sha256,status)
      VALUES($1,$2,$3,$4,$3,'staging')`, [batch, dataset, pkg.fingerprint, pkg.manifest.batch_key]);
    const checksumSize = (await import('node:fs/promises')).stat(`${pkg.root}/SHA256SUMS.json`);
    await insert(client, 'import_files', [...pkg.files, { path: 'SHA256SUMS.json', sha256: pkg.fingerprint, size_bytes: (await checksumSize).size }].map(f => ({
      dataset_id: dataset, batch_id: batch, file_kind: f.path.endsWith('.pdf') ? 'pdf' : f.path.endsWith('.xlsx') ? 'workbook' : 'append-provenance',
      source_path: `append/${pkg.manifest.batch_key}/${f.path}`, sha256: f.sha256, byte_size: f.size_bytes,
    })));
    for (const table of tables) {
      await insert(client, table, pkg.data[table].map(row => ({
        dataset_id: dataset, ...Object.fromEntries(columns[table].split(',').map(k => [k, row[k]])),
        ...(table === 'candidate_baselines' ? { imported_batch_id: batch } : {}),
      })));
    }
    await insert(client, 'candidate_assessments', pkg.data.candidate_baselines.map(row => ({ dataset_id: dataset, ...initialAssessment(row) })));
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await verifyBatch(client, pkg, dataset, batch);
    assertPreserved(before, await inventory(client, dataset));
    await client.query(`UPDATE compact_v5.import_batches SET status='activated',completed_at=now(),diagnostics=$2::jsonb WHERE batch_id=$1`,
      [batch, JSON.stringify({ type: 'append', archive: archiveReceipt, additions: pkg.manifest.expected_table_deltas, preservation: 'passed', active_pointer_changed: false })]);
    await client.query('COMMIT');
    return { result: 'appended', batch_id: batch, additions: pkg.manifest.expected_table_deltas };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
