import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkOctoberPdfAssets, OCTOBER_PDF_ASSETS, OCTOBER_PACKAGE_SHA256 } from "../../../artifacts/api-server/src/lib/october-pdf-assets.js";
import { validatePackage } from "./package.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const sourceDocs = path.join(root, "source_package/documents");

test("all ten assets match the independently validated append package", async () => {
  const pkg = await validatePackage(path.join(root, "source_package/append-20261020/append-manifest.json"));
  assert.equal(pkg.fingerprint, OCTOBER_PACKAGE_SHA256);
  assert.equal(pkg.data.documents.length, 10);
  for (const [id, hash] of OCTOBER_PDF_ASSETS) {
    const document = pkg.data.documents.find(row => row.document_id === id);
    assert.equal(document?.sha256, hash);
    assert.equal(document?.asset_path, `source_package/documents/v5/append-20261020/${id}.pdf`);
  }
  const report = await checkOctoberPdfAssets(sourceDocs);
  assert.equal(report.ready, true);
  assert.equal(report.verified_documents, 10);
  assert.equal(report.database_accessed, false);
  assert.equal(report.read_only, true);
  assert.ok(report.documents.every(document => document.status === "verified"));
});

test("missing deployed files fail closed, without falling back to workspace PDFs", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "october-missing-"));
  try {
    const report = await checkOctoberPdfAssets(fixture);
    assert.equal(report.ready, false);
    assert.equal(report.verified_documents, 0);
    assert.ok(report.documents.every(document => document.status === "missing" && document.actual_sha256 === null));
    assert.ok(!JSON.stringify(report).includes(fixture));
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test("a corrupt PDF and an unreadable entry fail while unchanged PDFs still pass", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "october-corrupt-"));
  const directory = path.join(fixture, "v5/append-20261020");
  try {
    await mkdir(directory, { recursive: true });
    for (const [id] of OCTOBER_PDF_ASSETS) {
      const filename = `${id}.pdf`;
      if (id.startsWith("AGO")) await writeFile(path.join(directory, filename), "not the trusted PDF");
      else if (id.startsWith("BOL")) await mkdir(path.join(directory, filename));
      else await symlink(path.join(sourceDocs, "v5/append-20261020", filename), path.join(directory, filename));
    }
    const report = await checkOctoberPdfAssets(fixture);
    assert.equal(report.ready, false);
    assert.equal(report.verified_documents, 8);
    assert.equal(report.documents[0].status, "hash_mismatch");
    assert.equal(report.documents[1].status, "unreadable");
    assert.ok(!JSON.stringify(report).includes(fixture));
  } finally { await rm(fixture, { recursive: true, force: true }); }
});
