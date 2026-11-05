import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import type { OctoberAssetReadiness, OctoberPdfAsset } from "@workspace/api-zod";

// Pinned to the independently validated October package, not to live DB rows.
// Do not accept filenames, expected hashes, or directory overrides from requests.
export const OCTOBER_PACKAGE_SHA256 = "70c2790c3fc07527eb8beac1062000a464d9e41547cd4a128018cf10f41e06e3";
export const OCTOBER_BATCH_KEY = "water-compacts-append-20261020-ten-countries-v1";
export const OCTOBER_PDF_ASSETS = [
  ["AGO-DOC-2026-01", "70734d959e4b68577f6fb8103c3de31363394dd4f8a37fd5bebafe6a476c35f9"],
  ["BOL-DOC-20260415-01", "dddfd1dc93fb935fffd90d09bba280abc4686b982ea1b0ecf7112690684524b6"],
  ["BDI-DOC-2026-01", "40ea4a105675781bdc8f53bb2e01db92aa396b3c8b9e95d44da79805f41af992"],
  ["CIV-DOC-2026-01", "3aadd07d222a93fc1c3a670d3ff717b34a0c9f105985faa752a09f4e74aee782"],
  ["GIN-DOC-2026-01", "83016b4591b6550a7a90506fe16f044dbe5ecfe0001fae9db4f92b3965728da6"],
  ["MOZ-DOC-2026-01", "ff92889063984ecfcff1caee194b83401a6f6205aaaf1e0a0b9b0bdfd539d864"],
  ["SEN-DOC-2026-01", "09894fcf55f76e83dced1930ef883390f3d1213e9a5954bd5aac3f5fd8597197"],
  ["TGO-DOC-2026-01", "7ee206ccaf4c4b95a5cae18bd9f4946485ee1be108b9b4071541b2412bd1e733"],
  ["UZB-DOC-2026-01", "99731de53b55f9407ed8fb9f035cc8526f7b683f22b53481b1a5de8d7659ee2e"],
  ["ZMB-DOC-2026-01", "365f589b04a82efb8634feff6dd202f9d602deea5551ec72a64fe13e07ebc9de"],
] as const;

/** Stream only the fixed deploy-bundled assets. No SQL or filesystem writes. */
export async function checkOctoberPdfAssets(bundledDocuments: string): Promise<OctoberAssetReadiness> {
  const documents: OctoberPdfAsset[] = [];
  for (const [documentId, expectedHash] of OCTOBER_PDF_ASSETS) {
    const result: OctoberPdfAsset = {
      document_id: documentId,
      country_code: documentId.slice(0, 3),
      expected_sha256: expectedHash,
      actual_sha256: null,
      byte_size: null,
      status: "unreadable",
    };
    try {
      const hash = createHash("sha256");
      let size = 0;
      const file = path.join(bundledDocuments, "v5", "append-20261020", `${documentId}.pdf`);
      for await (const chunk of createReadStream(file)) {
        size += chunk.length;
        hash.update(chunk);
      }
      result.byte_size = size;
      result.actual_sha256 = hash.digest("hex");
      result.status = result.actual_sha256 === expectedHash ? "verified" : "hash_mismatch";
    } catch (error) {
      result.status = (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unreadable";
    }
    documents.push(result);
  }
  const verified = documents.filter(document => document.status === "verified").length;
  return {
    ready: verified === OCTOBER_PDF_ASSETS.length,
    read_only: true,
    database_accessed: false,
    checked_at: new Date(),
    batch_key: OCTOBER_BATCH_KEY,
    package_sha256: OCTOBER_PACKAGE_SHA256,
    asset_location: "bundled-documents",
    expected_documents: OCTOBER_PDF_ASSETS.length,
    verified_documents: verified,
    documents,
  };
}
