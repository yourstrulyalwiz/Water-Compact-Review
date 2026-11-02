/** Operator-run backup/recovery check. No production DDL or data writes. */
import pg from 'pg';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Storage } from '@google-cloud/storage';
import { inventory } from './database.js';
import { canonical, type Row } from './columns.js';
import { sha } from './package.js';

const dataset = 'water-compacts-v5-baseline-01';
const recoveryUrl = 'postgresql://postgres@127.0.0.1:55433/compact_production_recovery';
const root = path.resolve(import.meta.dirname, '../../..', 'generated-artifacts/production-backups');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const directory = path.join(root, stamp);
let phase = 'initialization';
function requireTrue(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function command(program: string, args: string[], database: string, readonly: boolean) {
  // Do not put credentials in argv or return raw subprocess errors.
  // libpq does not expand a URI supplied only through the PGDATABASE environment
  // fallback. Pass its individual connection fields, overriding inherited dev PG*.
  const connection = new URL(database);
  const env: NodeJS.ProcessEnv = { ...process.env,
    PGHOST: connection.hostname, PGPORT: connection.port || '5432',
    PGUSER: decodeURIComponent(connection.username),
    PGPASSWORD: decodeURIComponent(connection.password),
    PGDATABASE: decodeURIComponent(connection.pathname.slice(1)),
    PGSSLMODE: connection.searchParams.get('sslmode') || (readonly ? 'verify-full' : 'disable'),
    PGCHANNELBINDING: connection.searchParams.get('channel_binding') || 'prefer',
    PGOPTIONS: readonly ? '-c default_transaction_read_only=on' : '',
    PGCONNECT_TIMEOUT: '20' };
  for (const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE']) delete env[key];
  for (const key of connection.searchParams.keys()) {
    requireTrue(['sslmode','channel_binding'].includes(key), 'Unsupported backup connection parameter');
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(program, args, { env, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', data => { stderr += data.toString(); });
    child.on('error', () => reject(new Error(`${program} could not start`)));
    child.on('close', code => {
      const categories = ['server version mismatch', 'permission denied', 'invalid snapshot',
        'invalid URI query parameter', 'invalid connection option', 'unrecognized configuration parameter',
        'does not exist', 'row-level security', 'connection refused', 'SSL error',
        'invalid sslmode', 'invalid integer value', 'password authentication failed'];
      const category = categories.find(c => stderr.toLowerCase().includes(c.toLowerCase())) || 'unclassified';
      if (code === 0) resolve();
      else {
        reject(new Error(`${program} failed (exit ${code}; category ${category}); raw output withheld`));
      }
    });
  });
}
const structureSql = `
SELECT 'column' kind,table_schema||'.'||table_name||'.'||column_name AS name,
  jsonb_build_object('type',udt_name,'nullable',is_nullable,'default',column_default)::text AS definition
FROM information_schema.columns WHERE table_schema IN ('public','compact_v5')
UNION ALL SELECT 'constraint',n.nspname||'.'||t.relname||'.'||c.conname,pg_get_constraintdef(c.oid)
FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
WHERE n.nspname IN ('public','compact_v5')
UNION ALL SELECT 'trigger',n.nspname||'.'||t.relname||'.'||g.tgname,pg_get_triggerdef(g.oid)
FROM pg_trigger g JOIN pg_class t ON t.oid=g.tgrelid JOIN pg_namespace n ON n.oid=t.relnamespace
WHERE NOT g.tgisinternal AND n.nspname IN ('public','compact_v5')
UNION ALL SELECT 'function',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',pg_get_functiondef(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('public','compact_v5') AND p.prokind IN ('f','p') ORDER BY 1,2`;

async function main() {
  process.umask(0o077);
  const url = process.env.COMPACT_PRODUCTION_BACKUP_URL;
  requireTrue(url, 'Backup secret is missing');
  requireTrue(url !== process.env.DATABASE_URL, 'Refusing the development connection');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const pool = new pg.Pool({ connectionString: url, max: 1,
    options: '-c default_transaction_read_only=on', connectionTimeoutMillis: 20000 });
  let original;
  let structure: Row[];
  let counts: Row;
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      phase = 'production identity check';
      const result = await client.query(`SELECT current_database() AS database,
        current_setting('transaction_read_only') AS readonly,
        (SELECT active_dataset_id FROM compact_v5.dataset_state WHERE singleton) AS dataset,
        (SELECT count(*) FROM compact_v5.candidate_baselines) AS candidates,
        (SELECT count(*) FROM compact_v5.review_events) AS review_events,
        (SELECT count(*) FROM compact_v5.candidate_assessments) AS assessments,
        (SELECT count(*) FROM public.reviewers) AS reviewers`);
      counts = result.rows[0];
      requireTrue(counts.database === 'neondb' && counts.dataset === dataset &&
        counts.candidates === '252' && counts.readonly === 'on', 'Unexpected production target; stopped');
      const batch = await client.query('SELECT source_fingerprint FROM compact_v5.import_batches');
      requireTrue(batch.rows.length === 1 && batch.rows[0].source_fingerprint ===
        '88f38a3a187abe357895522d2f84f9f8ada16f97c1f4c0ac08ae1dbecec231a1', 'Original batch identity differs');
      console.log('Verified production target (read-only):', counts);
      phase = 'snapshot inventory and backup';
      original = await inventory(client, dataset);
      structure = (await client.query(structureSql)).rows;
      const snapshot = (await client.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;
      await command('pg_dump', ['--format=custom', '--snapshot', snapshot,
        '--file', path.join(directory, 'production.dump')], url, true);
      await client.query('COMMIT');
    } finally { client.release(); }
  } finally { await pool.end(); }
  await writeFile(path.join(directory, 'inventory.json'), JSON.stringify(original), { mode: 0o600 });
  await writeFile(path.join(directory, 'structure.json'), JSON.stringify(structure), { mode: 0o600 });

  phase = 'private archive verification';
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  requireTrue(privateDir && privateDir.startsWith('/'), 'Private storage missing');
  const [bucketName, ...prefix] = privateDir.slice(1).split('/');
  const storage = new Storage({ credentials: {
    audience: 'replit', subject_token_type: 'access_token', type: 'external_account',
    token_url: 'http://127.0.0.1:1106/token',
    credential_source: { url: 'http://127.0.0.1:1106/credential', format: { type: 'json', subject_token_field_name: 'access_token' } },
    universe_domain: 'googleapis.com',
  }, projectId: '' });
  const objectRoot = `${prefix.join('/')}/production-backups/${stamp}`;
  const hashes: Record<string,string> = {};
  for (const filename of ['production.dump', 'inventory.json', 'structure.json']) {
    const bytes = await readFile(path.join(directory, filename));
    hashes[filename] = sha(bytes);
    const file = storage.bucket(bucketName!).file(`${objectRoot}/${filename}`);
    await file.save(bytes, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 } });
    const [downloaded] = await file.download();
    requireTrue(sha(downloaded) === hashes[filename], 'Archive download hash mismatch');
    if (filename === 'production.dump') {
      await writeFile(path.join(directory, 'recovery.dump'), downloaded, { mode: 0o600 });
    }
  }
  phase = 'isolated restore';
  // This is a literal local target. Never use the secret for CREATE or RESTORE.
  const admin = new pg.Pool({ connectionString: 'postgresql://postgres@127.0.0.1:55433/postgres' });
  try { await admin.query('CREATE DATABASE compact_production_recovery'); } finally { await admin.end(); }
  await command('pg_restore', ['--no-owner', '--no-privileges', '--exit-on-error',
    '--single-transaction', '--dbname', recoveryUrl, path.join(directory, 'recovery.dump')], recoveryUrl, false);
  phase = 'restored row and schema comparisons';
  const restoredPool = new pg.Pool({ connectionString: recoveryUrl });
  try {
    const client = await restoredPool.connect();
    try {
      const restored = await inventory(client, dataset);
      requireTrue(canonical(original.tables) === canonical(restored.tables), 'Restored full-row inventory mismatch');
      requireTrue(canonical(structure) === canonical((await client.query(structureSql)).rows), 'Restored schema mismatch');
    } finally { client.release(); }
  } finally { await restoredPool.end(); }
  const report = { capturedAt: stamp, status: 'restore-verified', counts,
    tableCount: Object.keys(original.tables).length, hashes, objectRoot,
    notes: 'Snapshot-consistent all-schema dump. Exact full-row inventory and column/constraint/trigger/function comparisons passed. Restore excludes ownership/privileges; role grants not certified. No production writes.' };
  const reportBytes = Buffer.from(JSON.stringify(report, null, 2));
  await writeFile(path.join(directory, 'report.json'), reportBytes, { mode: 0o600 });
  await storage.bucket(bucketName!).file(`${objectRoot}/report.json`).save(reportBytes,
    { resumable: false, preconditionOpts: { ifGenerationMatch: 0 } });
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => {
  // Connection errors may contain credentials or host details; never print them.
  console.error(`Backup readiness failed during ${phase}. ${error instanceof Error && !/postgres|password|host|connect/i.test(error.message) ? error.message : 'Sensitive connection details withheld.'}`);
  process.exitCode = 1;
});
