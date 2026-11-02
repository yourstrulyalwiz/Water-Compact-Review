import { Storage } from '@google-cloud/storage';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { requireThat, sha, safeFile, type AppendPackage } from './package.js';

function storage() {
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  requireThat(privateDir && privateDir.startsWith('/'), 'Private App Storage is not configured');
  const [bucket, ...prefix] = privateDir.slice(1).split('/');
  const client = new Storage({ credentials: {
    audience: 'replit', subject_token_type: 'access_token', type: 'external_account',
    token_url: 'http://127.0.0.1:1106/token',
    credential_source: { url: 'http://127.0.0.1:1106/credential', format: { type: 'json', subject_token_field_name: 'access_token' } },
    universe_domain: 'googleapis.com',
  }, projectId: '' });
  return { bucket: client.bucket(bucket!), prefix: `${prefix.join('/')}/compact-append` };
}
/** Private provenance archive, separate from the existing authenticated PDF route. */
export async function archivePackage(pkg: AppendPackage) {
  const { bucket, prefix } = storage();
  const objectRoot = `${prefix}/${pkg.fingerprint}`;
  for (const f of [...pkg.files, { path: 'SHA256SUMS.json', sha256: pkg.fingerprint }]) {
    const bytes = await readFile(await safeFile(pkg.root, f.path));
    const file = bucket.file(`${objectRoot}/${f.path}`);
    try {
      await file.save(bytes, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 },
        metadata: { contentType: 'application/octet-stream', metadata: { sha256: f.sha256 } } });
    } catch (error: any) {
      if (error?.code !== 412) throw error;
    }
    const [stored] = await file.download();
    requireThat(sha(stored) === f.sha256, `Durable archive hash mismatch: ${f.path}`);
  }
  return { bucket: bucket.name, objectRoot, package_sha256: pkg.fingerprint, file_count: pkg.files.length + 1 };
}
export async function installPdfAssets(pkg: AppendPackage, repoRoot: string) {
  for (const country of pkg.manifest.countries) {
    const row = pkg.data.documents.find(d => d.document_id === country.document_id)!;
    const dest = path.resolve(repoRoot, row.asset_path);
    const allowed = path.resolve(repoRoot, 'source_package/documents/v5') + path.sep;
    requireThat(dest.startsWith(allowed), 'Invalid PDF destination');
    const bytes = await readFile(await safeFile(pkg.root, country.pdf_path));
    requireThat(sha(bytes) === row.sha256, 'PDF hash differs');
    await mkdir(path.dirname(dest), { recursive: true });
    try { await writeFile(dest, bytes, { flag: 'wx' }); }
    catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      requireThat(sha(await readFile(dest)) === row.sha256, 'Refusing to overwrite a different PDF');
    }
  }
}
export async function verifyPdfAssets(pkg: AppendPackage, repoRoot: string) {
  for (const row of pkg.data.documents) requireThat(sha(await readFile(path.resolve(repoRoot, row.asset_path))) === row.sha256, `Missing/changed deployed PDF: ${row.document_id}`);
}
/** Restore originals without Git bloat. Output must be a new/empty directory. */
export async function restorePackage(fingerprint: string, output: string) {
  requireThat(/^[0-9a-f]{64}$/.test(fingerprint), 'Invalid package fingerprint');
  const { bucket, prefix } = storage();
  const objectRoot = `${prefix}/${fingerprint}`;
  const [bytes] = await bucket.file(`${objectRoot}/SHA256SUMS.json`).download();
  requireThat(sha(bytes) === fingerprint, 'Archive checksum manifest differs');
  const checks = JSON.parse(bytes.toString());
  await mkdir(output, { recursive: true });
  for (const f of [...checks.files, { path: 'SHA256SUMS.json', sha256: fingerprint }]) {
    requireThat(!path.isAbsolute(f.path) && !f.path.includes('\\') &&
      !f.path.split('/').some((s: string) => ['', '.', '..'].includes(s)), 'Unsafe stored path');
    const [data] = await bucket.file(`${objectRoot}/${f.path}`).download();
    requireThat(sha(data) === f.sha256, `Stored archive mismatch: ${f.path}`);
    const target = path.join(output, f.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data, { flag: 'wx', mode: 0o600 });
  }
}
