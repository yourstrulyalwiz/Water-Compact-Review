import { Pool } from 'pg';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePackage, requireThat } from './append/package.js';
import { preflight, inventory, assertPreserved, applyAppend, verifyBatch, type Inventory } from './append/database.js';
import { archivePackage, installPdfAssets, verifyPdfAssets, restorePackage } from './append/assets.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2).filter(a => a !== '--');
const command = args.shift();
function getArg(values: string[], key: string) {
  const index = values.indexOf(key);
  const value = values[index + 1];
  requireThat(index >= 0 && value && !value.startsWith('--'), `Missing argument ${key}`);
  return value;
}
async function saveReport(file: string, value: unknown) {
  await mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
}
async function main() {
  if (command === 'restore') {
    await restorePackage(getArg(args, '--expected-package-sha256'), getArg(args, '--output'));
    return { result: 'restored', database_changed: false };
  }
  requireThat(['validate', 'plan', 'apply', 'verify', 'prepare'].includes(command || ''), 'Use validate, plan, prepare, apply, verify, or restore');
  const pkg = await validatePackage(getArg(args, '--manifest'));
  const base = { package_sha256: pkg.fingerprint, batch_key: pkg.manifest.batch_key, additions: pkg.manifest.expected_table_deltas };
  if (command === 'validate') return { ...base, result: 'valid', files_checked: pkg.files.length };
  if (command === 'prepare') {
    const archive = await archivePackage(pkg);
    await installPdfAssets(pkg, repoRoot);
    return { ...base, result: 'assets-prepared', archive, database_changed: false };
  }
  const environment = getArg(args, '--environment');
  requireThat(['development', 'production', 'test'].includes(environment), 'Explicit environment required');
  if (environment === 'production') {
    requireThat(process.env.COMPACT_APPEND_TARGET_ENV === 'production', 'Run only in an explicitly configured production operator environment');
  } else {
    requireThat(process.env.NODE_ENV !== 'production' && process.env.COMPACT_APPEND_TARGET_ENV !== 'production', 'Development command cannot run in a production operator environment');
  }
  requireThat(process.env.DATABASE_URL, 'Target DATABASE_URL is not configured');
  const dataset = getArg(args, '--dataset');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, application_name: `compact-append-${environment}` });
  const client = await pool.connect();
  try {
    // Plan and verify run in one consistent, read-only snapshot.
    if (command !== 'apply') await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const plan = await preflight(client, pkg, dataset);
    if (command === 'plan') {
      const snapshot = await inventory(client, dataset);
      if (plan.existing) await verifyBatch(client, pkg, dataset, plan.existing.batch_id);
      await saveReport(getArg(args, '--inventory'), snapshot);
      await client.query('COMMIT');
      return { ...base, ...plan, environment, changes_to_existing_rows: 0, result: plan.existing ? 'already-applied' : 'planned' };
    }
    const before = JSON.parse(await readFile(getArg(args, '--inventory'), 'utf8')) as Inventory;
    requireThat(before.database === plan.database && before.dataset === dataset, 'Inventory is for another target');
    requireThat(getArg(args, '--expected-package-sha256') === pkg.fingerprint, 'Expected package fingerprint differs');
    if (command === 'verify') {
      requireThat(plan.existing, 'Batch not applied');
      await verifyBatch(client, pkg, dataset, plan.existing.batch_id);
      assertPreserved(before, await inventory(client, dataset));
      await client.query('COMMIT');
      await verifyPdfAssets(pkg, repoRoot);
      return { ...base, result: 'verified', existing_rows_preserved: true };
    }
    requireThat(getArg(args, '--expected-database') === plan.database, 'Database identity differs');
    if (environment === 'production') requireThat(args.includes('--production-approved') && args.includes('--backup-restore-verified'),
      'Production approval and verified backup/restore attestation required; do not apply automatically');
    await verifyPdfAssets(pkg, repoRoot);
    const receipt = await archivePackage(pkg);
    const result = await applyAppend(client, pkg, dataset, before, receipt);
    return { ...base, ...result, environment, existing_rows_preserved: true, active_pointer_changed: false };
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await pool.end();
  }
}
main().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
  // Never print connection URLs, SQL parameter payloads, or review comments.
  const message = String(error.message || 'Unknown append error').replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted connection]');
  console.error(`compact:v5:append:${command}: ${message}`);
  process.exitCode = 1;
});
