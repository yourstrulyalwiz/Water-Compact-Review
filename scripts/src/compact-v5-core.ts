import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import XLSX from "xlsx";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export const DEFAULT_MANIFEST = "source_package/v5/import-manifest.json";
export const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const STREAMS = [
  "High-confidence Reform Action",
  "Needs Human Review",
  "High-confidence Non-reform",
];
const GLOBAL_DECISIONS = ["Approve", "Revise", "Reject", "Consolidate", "Needs Discussion"];
const REGIONAL_DECISIONS = ["Confirm", "Confirm with Revision", "Disagree", "Needs Discussion", "Pending"];
const FINAL_STATUSES = ["Approved Reform", "Rejected Non-reform", "Consolidated", "Pending"];
const TEMPORAL_STATUSES = ["Completed at baseline", "Ongoing", "Planned", "Unclear"];
const CLUSTER_ROLES = [
  "Standalone",
  "Primary",
  "Secondary",
  "Supporting Evidence",
  "Duplicate-Consolidated",
];
const PILLARS = ["Water for People", "Water for Food", "Water for Planet", "Cross-cutting"];
const IMPORT_SHEETS = [
  "Candidates",
  "Documents",
  "Evidence",
  "Candidate_Evidence",
  "Anchor_Rectangles",
  "Relationships",
  "Analysis_Runs",
  "ID_Crosswalk",
  "Scan_Log",
  "QA",
  "Codebook",
  "Taxonomy",
  "Scalable_Solutions",
  "ReadMe",
];
const COUNTRY_CODES = new Set(["KHM", "SLE", "JAM", "COD"]);

export interface Diagnostic {
  severity: "error" | "warning";
  file: string;
  sheet: string;
  row: number | null;
  column: string | null;
  record_id: string | null;
  reason: string;
}

export interface SheetRow {
  rowNumber: number;
  values: Record<string, unknown>;
  formulas: Record<string, { formula: string; result: unknown }>;
}

export interface WorkbookData {
  source: ManifestWorkbook;
  filePath: string;
  sheets: Record<string, SheetRow[]>;
  headers: Record<string, string[]>;
}

export interface ManifestWorkbook {
  country_code: string;
  country: string;
  path: string;
  sha256: string;
  source_language: string;
  analysis_run_id: string;
  analysis_date: string;
  expected_rows: Record<string, number>;
  expected_stream_counts: Record<string, number>;
  expected_final_approved: number;
  sheet_headers: Record<string, string[]>;
  document: {
    document_id: string;
    asset_path: string;
    proposed_repo_asset_path: string;
    sha256: string;
    size_bytes: number;
    pdf_page_count: number;
    source_file_name: string;
    official_source_url: string;
  };
}

export interface V5Manifest {
  manifest_version: number;
  dataset_id: string;
  methodology_version: string;
  workbooks: ManifestWorkbook[];
  shared_candidate_headers: string[];
  expected_totals: Record<string, unknown>;
  methodology_files: { path: string; sha256: string }[];
  [key: string]: unknown;
}

export interface ValidationResult {
  valid: boolean;
  manifestPath: string;
  datasetId: string;
  methodologyVersion: string;
  sourceFingerprint: string;
  fileHashes: { kind: string; path: string; sha256: string; byteSize: number }[];
  workbookData: WorkbookData[];
  totals: Record<string, number>;
  countryStreams: Record<string, Record<string, number>>;
  diagnostics: Diagnostic[];
  validatedAt: string;
}

export interface CandidateField {
  position: number;
  workbook_header: string;
  api_and_database_name: string;
  storage_type: string;
  role: string;
}

const nullable = (value: unknown): unknown => (value === "" || value === undefined ? null : value);

function cellValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    if ("result" in object) return cellValue(object.result);
    if (Array.isArray(object.richText)) {
      return object.richText.map((part) => String((part as { text?: unknown }).text ?? "")).join("");
    }
    if ("text" in object && typeof object.text === "string") return object.text;
    if ("hyperlink" in object && typeof object.hyperlink === "string") return object.hyperlink;
  }
  return value;
}

function isBlankRow(values: Record<string, unknown>): boolean {
  return Object.values(values).every((value) => value === null || value === undefined || value === "");
}

function addDiagnostic(
  diagnostics: Diagnostic[],
  severity: "error" | "warning",
  file: string,
  sheet: string,
  row: number | null,
  column: string | null,
  recordId: unknown,
  reason: string,
): void {
  diagnostics.push({
    severity,
    file,
    sheet,
    row,
    column,
    record_id: recordId === null || recordId === undefined ? null : String(recordId),
    reason,
  });
}

function resolveInside(root: string, relative: string): string {
  const absolute = path.resolve(root, relative);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Manifest path escapes the package directory: ${relative}`);
  }
  return absolute;
}

async function hashFile(filePath: string): Promise<{ sha256: string; byteSize: number; bytes: Buffer }> {
  const bytes = await readFile(filePath);
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteSize: bytes.byteLength,
    bytes,
  };
}

function canonicalRows(rows: SheetRow[]): string[] {
  return rows.map((row) => JSON.stringify(row.values)).sort();
}

function parseBinary(
  value: unknown,
  context: { diagnostics: Diagnostic[]; file: string; row: number; column: string; recordId: unknown },
): number | null {
  if (value === 0 || value === "0") return 0;
  if (value === 1 || value === "1") return 1;
  addDiagnostic(context.diagnostics, "error", context.file, "Candidates", context.row, context.column, context.recordId,
    `Expected exactly 0 or 1; got ${JSON.stringify(value)}`);
  return null;
}

function assertAllowedValue(
  value: unknown,
  allowed: string[],
  context: { diagnostics: Diagnostic[]; file: string; row: number; column: string; recordId: unknown },
  allowBlank = true,
): void {
  if (value === null || value === undefined || value === "") {
    if (!allowBlank) addDiagnostic(context.diagnostics, "error", context.file, "Candidates", context.row, context.column, context.recordId, "Required controlled value is blank");
    return;
  }
  if (typeof value !== "string" || !allowed.includes(value)) {
    addDiagnostic(context.diagnostics, "error", context.file, "Candidates", context.row, context.column, context.recordId,
      `Unknown controlled value ${JSON.stringify(value)}; expected one of: ${allowed.join("; ")}`);
  }
}

async function readWorkbook(
  manifestRoot: string,
  source: ManifestWorkbook,
  manifest: V5Manifest,
  diagnostics: Diagnostic[],
): Promise<WorkbookData | null> {
  const workbookPath = resolveInside(manifestRoot, source.path);
  const data: WorkbookData = { source, filePath: workbookPath, sheets: {}, headers: {} };
  const fileName = source.path;
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.readFile(workbookPath, { cellFormula: true, cellDates: true, cellText: false, raw: true });
  } catch (error) {
    addDiagnostic(diagnostics, "error", fileName, "", null, null, null, `Cannot read XLSX: ${String(error)}`);
    return null;
  }

  for (const [sheetName, expectedHeaders] of Object.entries(source.sheet_headers)) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) {
      addDiagnostic(diagnostics, "error", fileName, sheetName, null, null, null, "Manifest-listed worksheet is missing");
      continue;
    }
    const range = worksheet["!ref"] ? XLSX.utils.decode_range(worksheet["!ref"]) : { s: { c: 0, r: 0 }, e: { c: -1, r: -1 } };
    const headers: string[] = [];
    for (let column = 0; column < Math.max(range.e.c + 1, expectedHeaders.length); column += 1) {
      const headerCell = worksheet[XLSX.utils.encode_cell({ r: 0, c: column })];
      const value = cellValue(headerCell?.v);
      headers.push(value === null || value === undefined ? "" : String(value));
    }
    while (headers.length && headers.at(-1) === "") headers.pop();
    data.headers[sheetName] = headers;
    if (IMPORT_SHEETS.includes(sheetName) && JSON.stringify(headers) !== JSON.stringify(expectedHeaders)) {
      addDiagnostic(diagnostics, "error", fileName, sheetName, 1, null, null,
        `Header row differs from the manifest. Expected ${JSON.stringify(expectedHeaders)}; found ${JSON.stringify(headers)}`);
    }
    const duplicateHeaders = headers.filter((header, index) => header !== "" && headers.indexOf(header) !== index);
    if (duplicateHeaders.length) {
      addDiagnostic(diagnostics, "error", fileName, sheetName, 1, null, null,
        `Duplicate header(s): ${[...new Set(duplicateHeaders)].join(", ")}`);
    }

    const rows: SheetRow[] = [];
    if (IMPORT_SHEETS.includes(sheetName)) {
      for (let rowNumber = 2; rowNumber <= range.e.r + 1; rowNumber += 1) {
        const values: Record<string, unknown> = {};
        const formulas: Record<string, { formula: string; result: unknown }> = {};
        for (let column = 0; column < headers.length; column += 1) {
          const header = headers[column];
          if (!header) continue;
          const cell = worksheet[XLSX.utils.encode_cell({ r: rowNumber - 1, c: column })];
          values[header] = cellValue(cell?.v);
          if (cell?.f) {
            formulas[header] = { formula: String(cell.f), result: cellValue(cell.v) };
          }
        }
        if (!isBlankRow(values)) rows.push({ rowNumber, values, formulas });
        const formulaColumns = Object.keys(formulas).filter((header) =>
          sheetName !== "Candidates" || !["Six_Criteria_Pass", "Count_in_Final_Reform_Total"].includes(header));
        if (formulaColumns.length) {
          addDiagnostic(diagnostics, "error", fileName, sheetName, rowNumber, formulaColumns[0], values.Candidate_ID,
            `Formulas are not permitted in imported source cells; formula text must be stored as text (found ${formulaColumns.join(", ")})`);
        }
      }
      data.sheets[sheetName] = rows;
      const expectedRows = source.expected_rows[sheetName];
      if (expectedRows !== undefined && rows.length !== expectedRows) {
        addDiagnostic(diagnostics, "error", fileName, sheetName, null, null, null,
          `Expected ${expectedRows} nonblank data rows; found ${rows.length}`);
      }
    }
  }

  const candidateHeaders = data.headers.Candidates ?? [];
  if (JSON.stringify(candidateHeaders) !== JSON.stringify(manifest.shared_candidate_headers)) {
    addDiagnostic(diagnostics, "error", fileName, "Candidates", 1, null, null,
      "Candidate sheet header order does not match shared_candidate_headers");
  }
  return data;
}

export async function validatePackage(manifestPathArgument: string): Promise<ValidationResult> {
  const manifestPath = path.isAbsolute(manifestPathArgument)
    ? path.resolve(manifestPathArgument)
    : path.resolve(REPOSITORY_ROOT, manifestPathArgument);
  const packageRoot = path.dirname(manifestPath);
  const diagnostics: Diagnostic[] = [];
  const fileHashes: ValidationResult["fileHashes"] = [];
  let manifest: V5Manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as V5Manifest;
  } catch (error) {
    throw new Error(`Cannot read import manifest ${manifestPath}: ${String(error)}`);
  }
  if (manifest.manifest_version !== 1 || !manifest.dataset_id || !Array.isArray(manifest.workbooks)) {
    throw new Error("Unsupported or incomplete v5 import manifest");
  }
  const fieldMapPath = path.join(packageRoot, "candidate-field-map.json");
  let fieldMap: CandidateField[];
  try {
    fieldMap = JSON.parse(await readFile(fieldMapPath, "utf8")) as CandidateField[];
  } catch (error) {
    throw new Error(`Cannot read candidate-field-map.json: ${String(error)}`);
  }
  if (fieldMap.length !== 42 || fieldMap.some((field, index) =>
    field.position !== index + 1 || field.workbook_header !== manifest.shared_candidate_headers[index])) {
    addDiagnostic(diagnostics, "error", "candidate-field-map.json", "", null, null, null,
      "Field map must contain the 42 candidate fields in manifest order");
  }
  for (const [kind, absolutePath] of [["manifest", manifestPath], ["field-map", fieldMapPath]] as const) {
    try {
      const hashed = await hashFile(absolutePath);
      fileHashes.push({
        kind,
        path: path.relative(REPOSITORY_ROOT, absolutePath),
        sha256: hashed.sha256,
        byteSize: hashed.byteSize,
      });
    } catch (error) {
      addDiagnostic(diagnostics, "error", path.relative(REPOSITORY_ROOT, absolutePath), "", null, null, null,
        `Import configuration unavailable: ${String(error)}`);
    }
  }

  const workbookData: WorkbookData[] = [];
  for (const source of manifest.workbooks) {
    const filePath = resolveInside(packageRoot, source.path);
    try {
      const hashed = await hashFile(filePath);
      fileHashes.push({
        kind: "workbook",
        path: path.relative(REPOSITORY_ROOT, filePath),
        sha256: hashed.sha256,
        byteSize: hashed.byteSize,
      });
      if (hashed.sha256 !== source.sha256) {
        addDiagnostic(diagnostics, "error", source.path, "", null, null, null,
          `SHA-256 mismatch: expected ${source.sha256}; found ${hashed.sha256}`);
      }
    } catch (error) {
      addDiagnostic(diagnostics, "error", source.path, "", null, null, null, `Workbook unavailable: ${String(error)}`);
    }
    const parsed = await readWorkbook(packageRoot, source, manifest, diagnostics);
    if (parsed) workbookData.push(parsed);

    const pdfPath = resolveInside(packageRoot, source.document.asset_path);
    try {
      const hashed = await hashFile(pdfPath);
      fileHashes.push({
        kind: "pdf",
        path: path.relative(REPOSITORY_ROOT, pdfPath),
        sha256: hashed.sha256,
        byteSize: hashed.byteSize,
      });
      if (hashed.sha256 !== source.document.sha256 || hashed.byteSize !== source.document.size_bytes) {
        addDiagnostic(diagnostics, "error", source.document.asset_path, "", null, null, source.document.document_id,
          `PDF fingerprint mismatch: expected ${source.document.sha256} (${source.document.size_bytes} bytes); found ${hashed.sha256} (${hashed.byteSize} bytes)`);
      }
      if (hashed.bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
        addDiagnostic(diagnostics, "error", source.document.asset_path, "", null, null, source.document.document_id, "File does not have a PDF signature");
      } else {
        try {
          const pdf = await getDocument({
            data: new Uint8Array(hashed.bytes),
            isEvalSupported: false,
            useWorkerFetch: false,
          }).promise;
          if (pdf.numPages !== source.document.pdf_page_count) {
            addDiagnostic(diagnostics, "error", source.document.asset_path, "", null, null, source.document.document_id,
              `Expected ${source.document.pdf_page_count} PDF pages; parsed ${pdf.numPages}`);
          }
          await pdf.destroy();
        } catch (error) {
          addDiagnostic(diagnostics, "error", source.document.asset_path, "", null, null, source.document.document_id,
            `PDF page count could not be verified: ${String(error)}`);
        }
      }

      const repositoryAsset = source.document.proposed_repo_asset_path;
      const repositoryPath = resolveInside(REPOSITORY_ROOT, repositoryAsset);
      try {
        const repositoryPdf = await hashFile(repositoryPath);
        fileHashes.push({ kind: "pdf-asset", path: repositoryAsset, sha256: repositoryPdf.sha256, byteSize: repositoryPdf.byteSize });
        if (repositoryPdf.sha256 !== source.document.sha256 || repositoryPdf.byteSize !== source.document.size_bytes) {
          addDiagnostic(diagnostics, "error", repositoryAsset, "", null, null, source.document.document_id,
            `Copied PDF asset differs from manifest fingerprint (${repositoryPdf.sha256})`);
        }
      } catch (error) {
        addDiagnostic(diagnostics, "error", repositoryAsset, "", null, null, source.document.document_id,
          `Copied repository PDF asset is missing or unreadable: ${String(error)}`);
      }
    } catch (error) {
      addDiagnostic(diagnostics, "error", source.document.asset_path, "", null, null, source.document.document_id, `PDF unavailable: ${String(error)}`);
    }
  }

  for (const methodology of manifest.methodology_files ?? []) {
    try {
      const hashed = await hashFile(resolveInside(packageRoot, methodology.path));
      fileHashes.push({
        kind: "methodology",
        path: path.relative(REPOSITORY_ROOT, resolveInside(packageRoot, methodology.path)),
        sha256: hashed.sha256,
        byteSize: hashed.byteSize,
      });
      if (hashed.sha256 !== methodology.sha256) {
        addDiagnostic(diagnostics, "error", methodology.path, "", null, null, null,
          `Methodology SHA-256 mismatch: expected ${methodology.sha256}; found ${hashed.sha256}`);
      }
    } catch (error) {
      addDiagnostic(diagnostics, "error", methodology.path, "", null, null, null, `Methodology asset unavailable: ${String(error)}`);
    }
  }

  validateRows(manifest, workbookData, fieldMap, diagnostics);
  const totals: Record<string, number> = {};
  for (const key of Object.keys(manifest.expected_totals)) {
    if (typeof manifest.expected_totals[key] === "number") totals[key] = manifest.expected_totals[key] as number;
  }
  for (const sheetName of IMPORT_SHEETS) {
    totals[sheetName] = workbookData.reduce((sum, file) => sum + (file.sheets[sheetName]?.length ?? 0), 0);
  }
  const countryStreams: Record<string, Record<string, number>> = {};
  for (const file of workbookData) countryStreams[file.source.country_code] = { ...file.source.expected_stream_counts };

  const canonicalFingerprint = createHash("sha256")
    .update(JSON.stringify({
      dataset_id: manifest.dataset_id,
      methodology_version: manifest.methodology_version,
      files: fileHashes
        .filter((file) => file.kind !== "manifest" && file.kind !== "field-map")
        .map(({ path: filePath, sha256 }) => ({ path: filePath, sha256 }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    }))
    .digest("hex");
  return {
    valid: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    manifestPath,
    datasetId: manifest.dataset_id,
    methodologyVersion: manifest.methodology_version,
    sourceFingerprint: canonicalFingerprint,
    fileHashes,
    workbookData,
    totals,
    countryStreams,
    diagnostics,
    validatedAt: new Date().toISOString(),
  };
}

function validateRows(
  manifest: V5Manifest,
  workbooks: WorkbookData[],
  fieldMap: CandidateField[],
  diagnostics: Diagnostic[],
): void {
  const candidateById = new Map<string, { file: WorkbookData; row: SheetRow; countryCode: string }>();
  const evidenceById = new Map<string, { file: WorkbookData; row: SheetRow }>();
  const documentPages = new Map<string, number>();
  const runIds = new Set<string>();
  const candidatesByFile = new Map<string, Set<string>>();
  const taxonomySignatures = new Map<string, string[]>();
  const solutionSignatures = new Map<string, string[]>();
  const codebookSignatures = new Map<string, string[]>();
  const countryStreamCounts = new Map<string, Record<string, number>>();
  let grandCandidateCount = 0;

  for (const file of workbooks) {
    const source = file.source;
    const candidateRows = file.sheets.Candidates ?? [];
    const ids = new Set<string>();
    candidatesByFile.set(source.country_code, ids);
    const streams: Record<string, number> = {};
    for (const row of candidateRows) {
      const values = row.values;
      const id = values.Candidate_ID;
      const idText = String(id ?? "");
      grandCandidateCount += 1;
      if (ids.has(idText)) addDiagnostic(diagnostics, "error", source.path, "Candidates", row.rowNumber, "Candidate_ID", id, "Duplicate candidate ID in this workbook");
      ids.add(idText);
      if (candidateById.has(idText)) addDiagnostic(diagnostics, "error", source.path, "Candidates", row.rowNumber, "Candidate_ID", id, "Duplicate candidate ID across package");
      candidateById.set(idText, { file, row, countryCode: source.country_code });
      if (!new RegExp(`^${source.country_code}-RA-[0-9]{3,}[A-Z]*$`).test(idText)) {
        addDiagnostic(diagnostics, "error", source.path, "Candidates", row.rowNumber, "Candidate_ID", id, "Candidate ID country prefix/format does not match the workbook");
      }
      if (values.Country !== source.country) addDiagnostic(diagnostics, "error", source.path, "Candidates", row.rowNumber, "Country", id, `Country must exactly match ${source.country}`);
      if (values.Analysis_Run_ID !== source.analysis_run_id) addDiagnostic(diagnostics, "error", source.path, "Candidates", row.rowNumber, "Analysis_Run_ID", id, "Candidate references an unexpected analysis run");

      const stream = String(values.Candidate_Stream ?? "");
      assertAllowedValue(stream, STREAMS, { diagnostics, file: source.path, row: row.rowNumber, column: "Candidate_Stream", recordId: id }, false);
      streams[stream] = (streams[stream] ?? 0) + 1;
      const binaries = fieldMap.filter((field) => field.storage_type.startsWith("smallint") &&
        ["C1_Explicit_Commitment", "C2_Discrete_Actionable_Mechanism", "C3_System_Change",
          "C4_Not_Merely_Implementation", "C5_Distinct_Reform_Action", "C6_Trackable_Monitorable",
          "Water_Financing_Relevance"].includes(field.workbook_header));
      for (const field of binaries) {
        if (values[field.workbook_header] === null || values[field.workbook_header] === undefined || values[field.workbook_header] === "") {
          addDiagnostic(diagnostics, "error", source.path, "Candidates", row.rowNumber, field.workbook_header, id, "Required binary field is blank");
        } else {
          parseBinary(values[field.workbook_header], {
            diagnostics, file: source.path, row: row.rowNumber, column: field.workbook_header, recordId: id,
          });
        }
      }
      const criterionNames = fieldMap.slice(10, 16).map((field) => field.workbook_header);
      const sixPass = criterionNames.every((name) => values[name] === 1 || values[name] === "1") ? 1 : 0;
      const derivedColumns = [
        ["Six_Criteria_Pass", sixPass],
        ["Count_in_Final_Reform_Total", 0],
      ] as const;
      for (const [column, derived] of derivedColumns) {
        const reported = values[column];
        const formulaResult = row.formulas[column]?.result;
        const checkValue = formulaResult === null || formulaResult === undefined || formulaResult === "" ? reported : formulaResult;
        if (checkValue !== null && checkValue !== undefined && checkValue !== "") {
          const parsed = checkValue === 0 || checkValue === "0" ? 0 : checkValue === 1 || checkValue === "1" ? 1 : null;
          if (parsed === null) {
            addDiagnostic(diagnostics, "error", source.path, "Candidates", row.rowNumber, column, id,
              `Derived cell must cache 0 or 1, or be blank; got ${JSON.stringify(checkValue)}`);
          } else if (parsed !== derived) {
            addDiagnostic(diagnostics, "error", source.path, "Candidates", row.rowNumber, column, id,
              `Derived value ${parsed} conflicts with server recomputation ${derived}`);
          }
        }
      }
      assertAllowedValue(values.Cluster_Role, CLUSTER_ROLES, { diagnostics, file: source.path, row: row.rowNumber, column: "Cluster_Role", recordId: id });
      assertAllowedValue(values.Primary_Pillar, PILLARS, { diagnostics, file: source.path, row: row.rowNumber, column: "Primary_Pillar", recordId: id });
      assertAllowedValue(values.Temporal_Status, TEMPORAL_STATUSES, { diagnostics, file: source.path, row: row.rowNumber, column: "Temporal_Status", recordId: id });
      assertAllowedValue(values.Global_Review_Decision, GLOBAL_DECISIONS, { diagnostics, file: source.path, row: row.rowNumber, column: "Global_Review_Decision", recordId: id });
      assertAllowedValue(values.Regional_Confirmation_Decision, REGIONAL_DECISIONS, { diagnostics, file: source.path, row: row.rowNumber, column: "Regional_Confirmation_Decision", recordId: id });
      assertAllowedValue(values.Final_Status, FINAL_STATUSES, { diagnostics, file: source.path, row: row.rowNumber, column: "Final_Status", recordId: id });
      assertAllowedValue(values.Review_Resolution, ["Open", "Resolved"], { diagnostics, file: source.path, row: row.rowNumber, column: "Review_Resolution", recordId: id });
      if (stream !== "High-confidence Non-reform") {
        for (const column of ["Reform_Action_Statement_English", "Primary_Pillar", "Primary_Tier1_Reform_Domain"]) {
          if (!values[column]) addDiagnostic(diagnostics, "error", source.path, "Candidates", row.rowNumber, column, id,
            `Retained ${stream} candidate requires classification/statement value`);
        }
      }
      if (values.Global_Review_Decision && values.Global_Review_Decision !== "") {
        addDiagnostic(diagnostics, "error", source.path, "Candidates", row.rowNumber, "Global_Review_Decision", id, "Initial baseline must not contain a human Global approval");
      }
      if (values.Regional_Confirmation_Decision !== "Pending" || values.Final_Status !== "Pending") {
        addDiagnostic(diagnostics, "error", source.path, "Candidates", row.rowNumber, "Regional_Confirmation_Decision", id,
          "Initial baseline review-stage and final decisions must be Pending");
      }
      if (values.Review_Resolution && values.Review_Resolution !== "") {
        addDiagnostic(diagnostics, "error", source.path, "Candidates", row.rowNumber, "Review_Resolution", id, "Initial baseline must not contain a human issue resolution");
      }
    }
    countryStreamCounts.set(source.country_code, streams);
    for (const [stream, count] of Object.entries(source.expected_stream_counts)) {
      if ((streams[stream] ?? 0) !== count) addDiagnostic(diagnostics, "error", source.path, "Candidates", null, "Candidate_Stream", null,
        `Expected ${count} candidates in stream ${stream}; found ${streams[stream] ?? 0}`);
    }

    const documentRows = file.sheets.Documents ?? [];
    for (const row of documentRows) {
      const id = String(row.values.Document_ID ?? "");
      if (id !== source.document.document_id) addDiagnostic(diagnostics, "error", source.path, "Documents", row.rowNumber, "Document_ID", id, "Document ID does not match manifest binding");
      documentPages.set(id, source.document.pdf_page_count);
      if (row.values.SHA256 !== source.document.sha256) addDiagnostic(diagnostics, "error", source.path, "Documents", row.rowNumber, "SHA256", id, "Workbook document hash does not match manifest PDF hash");
      if (Number(row.values.PDF_Page_Count) !== source.document.pdf_page_count) addDiagnostic(diagnostics, "error", source.path, "Documents", row.rowNumber, "PDF_Page_Count", id, "Workbook PDF page count does not match manifest");
      if (String(row.values.Country ?? "") !== source.country) addDiagnostic(diagnostics, "error", source.path, "Documents", row.rowNumber, "Country", id, "Document country does not match workbook country");
    }
    for (const row of file.sheets.Analysis_Runs ?? []) {
      const id = String(row.values.Analysis_Run_ID ?? "");
      if (id !== source.analysis_run_id) addDiagnostic(diagnostics, "error", source.path, "Analysis_Runs", row.rowNumber, "Analysis_Run_ID", id, "Analysis run ID does not match manifest");
      runIds.add(id);
    }
    for (const row of file.sheets.Evidence ?? []) {
      const id = String(row.values.Evidence_ID ?? "");
      if (evidenceById.has(id)) addDiagnostic(diagnostics, "error", source.path, "Evidence", row.rowNumber, "Evidence_ID", id, "Duplicate Evidence_ID across package");
      evidenceById.set(id, { file, row });
      const documentId = String(row.values.Document_ID ?? "");
      const page = Number(row.values.PDF_Page);
      const maxPage = documentPages.get(documentId);
      if (!maxPage) addDiagnostic(diagnostics, "error", source.path, "Evidence", row.rowNumber, "Document_ID", id, `Unknown document ${documentId}`);
      if (!Number.isInteger(page) || page < 1 || (maxPage !== undefined && page > maxPage)) {
        addDiagnostic(diagnostics, "error", source.path, "Evidence", row.rowNumber, "PDF_Page", id, `Evidence page ${page} is outside the bound PDF`);
      }
    }

    taxonomySignatures.set(source.country_code, canonicalRows(file.sheets.Taxonomy ?? []));
    solutionSignatures.set(source.country_code, canonicalRows(file.sheets.Scalable_Solutions ?? []));
    codebookSignatures.set(source.country_code, canonicalRows(file.sheets.Codebook ?? []));
  }

  for (const source of manifest.workbooks) {
    const streamCounts = countryStreamCounts.get(source.country_code) ?? {};
    const reviewActions = (streamCounts["High-confidence Reform Action"] ?? 0) + (streamCounts["Needs Human Review"] ?? 0);
    if (reviewActions !== source.expected_rows.Candidates - (streamCounts["High-confidence Non-reform"] ?? 0)) {
      addDiagnostic(diagnostics, "error", source.path, "Candidates", null, null, null, "Review-action stream count does not reconcile with the candidate total");
    }
  }
  if (grandCandidateCount !== manifest.expected_totals.Candidates) {
    addDiagnostic(diagnostics, "error", "", "Candidates", null, null, null,
      `Expected package total ${manifest.expected_totals.Candidates} candidates; found ${grandCandidateCount}`);
  }

  const compareReference = (label: string, signatures: Map<string, string[]>): void => {
    const first = signatures.values().next().value as string[] | undefined;
    if (first && [...signatures.values()].some((signature) => JSON.stringify(signature) !== JSON.stringify(first))) {
      addDiagnostic(diagnostics, "error", "", label, null, null, null, `${label} reference sheet differs among workbooks; cannot safely deduplicate`);
    }
  };
  compareReference("Taxonomy", taxonomySignatures);
  compareReference("Scalable_Solutions", solutionSignatures);
  compareReference("Codebook", codebookSignatures);

  const taxonomyCategories = new Set<string>();
  for (const file of workbooks) for (const row of file.sheets.Taxonomy ?? []) {
    taxonomyCategories.add(`${row.values.Tier1_Domain}\u0000${row.values.Tier2_Category}`);
  }
  for (const file of workbooks) {
    for (const row of file.sheets.Candidates ?? []) {
      const category = row.values.Tier2_Reform_Category;
      const domain = row.values.Primary_Tier1_Reform_Domain;
      if (category && domain && !taxonomyCategories.has(`${domain}\u0000${category}`)) {
        addDiagnostic(diagnostics, "warning", file.source.path, "Candidates", row.rowNumber, "Tier2_Reform_Category", row.values.Candidate_ID,
          `Tier 2 label ${JSON.stringify(category)} is absent from the supplied exhaustive taxonomy; retained without replacement`);
      }
      const parent = row.values.Parent_Reform_Action_ID;
      if (parent) {
        const target = candidateById.get(String(parent));
        if (!target) addDiagnostic(diagnostics, "error", file.source.path, "Candidates", row.rowNumber, "Parent_Reform_Action_ID", row.values.Candidate_ID,
          `Parent candidate ${parent} does not resolve in this dataset`);
        else if (target.countryCode !== file.source.country_code) addDiagnostic(diagnostics, "error", file.source.path, "Candidates", row.rowNumber, "Parent_Reform_Action_ID", row.values.Candidate_ID,
          "Parent candidate must be in the same country");
      }
    }
  }

  for (const [candidateId, info] of candidateById) {
    const seen = new Set<string>([candidateId]);
    let parent = info.row.values.Parent_Reform_Action_ID;
    while (parent) {
      const parentId = String(parent);
      if (seen.has(parentId)) {
        addDiagnostic(diagnostics, "error", info.file.source.path, "Candidates", info.row.rowNumber, "Parent_Reform_Action_ID", candidateId,
          `Parent hierarchy contains a cycle through ${parentId}`);
        break;
      }
      seen.add(parentId);
      parent = candidateById.get(parentId)?.row.values.Parent_Reform_Action_ID;
    }
  }

  for (const file of workbooks) {
    const checkReference = (sheet: string, column: string, accepted: Set<string>): void => {
      for (const row of file.sheets[sheet] ?? []) {
        const value = row.values[column];
        if (value !== null && value !== undefined && value !== "" && !accepted.has(String(value))) {
          addDiagnostic(diagnostics, "error", file.source.path, sheet, row.rowNumber, column, null, `Broken reference ${JSON.stringify(value)}`);
        }
      }
    };
    checkReference("Candidates", "Document_ID", new Set([file.source.document.document_id]));
    checkReference("Candidates", "Analysis_Run_ID", new Set([file.source.analysis_run_id]));
    checkReference("Evidence", "Document_ID", new Set([file.source.document.document_id]));
    checkReference("Evidence", "Analysis_Run_ID", new Set([file.source.analysis_run_id]));
    checkReference("Candidate_Evidence", "Analysis_Run_ID", new Set([file.source.analysis_run_id]));
    for (const row of file.sheets.Candidate_Evidence ?? []) {
      const candidate = String(row.values.Candidate_ID ?? "");
      const evidence = String(row.values.Evidence_ID ?? "");
      if (!candidateById.has(candidate)) addDiagnostic(diagnostics, "error", file.source.path, "Candidate_Evidence", row.rowNumber, "Candidate_ID", candidate, "Candidate/evidence link candidate is unresolved");
      if (!evidenceById.has(evidence)) addDiagnostic(diagnostics, "error", file.source.path, "Candidate_Evidence", row.rowNumber, "Evidence_ID", candidate, "Candidate/evidence link evidence is unresolved");
      const target = evidenceById.get(evidence);
      if (target && target.file.source.country_code !== file.source.country_code) {
        addDiagnostic(diagnostics, "error", file.source.path, "Candidate_Evidence", row.rowNumber, "Evidence_ID", candidate, "Evidence link crosses country datasets");
      }
    }
    const linkKeys = new Set<string>();
    for (const row of file.sheets.Candidate_Evidence ?? []) {
      const key = `${row.values.Candidate_ID}\u0000${row.values.Evidence_ID}`;
      if (linkKeys.has(key)) addDiagnostic(diagnostics, "error", file.source.path, "Candidate_Evidence", row.rowNumber, "Evidence_ID", row.values.Candidate_ID, "Duplicate candidate/evidence link");
      linkKeys.add(key);
    }
    const checkCandidate = (sheet: string, field: string): void => {
      for (const row of file.sheets[sheet] ?? []) {
        const value = row.values[field];
        if (value !== null && value !== undefined && value !== "" && !candidateById.has(String(value))) {
          addDiagnostic(diagnostics, "error", file.source.path, sheet, row.rowNumber, field, null, `Candidate reference ${value} is unresolved`);
        }
      }
    };
    checkCandidate("Relationships", "Source_Candidate_ID");
    checkCandidate("Relationships", "Target_Candidate_ID");
    checkCandidate("ID_Crosswalk", "Candidate_ID");
    checkCandidate("QA", "Candidate_ID");
    for (const row of file.sheets.Relationships ?? []) {
      const sourceId = String(row.values.Source_Candidate_ID ?? "");
      const targetId = String(row.values.Target_Candidate_ID ?? "");
      if (candidateById.get(sourceId)?.countryCode !== file.source.country_code ||
          candidateById.get(targetId)?.countryCode !== file.source.country_code) {
        addDiagnostic(diagnostics, "error", file.source.path, "Relationships", row.rowNumber, "Target_Candidate_ID", row.values.Relationship_ID,
          "Relationship must reference candidates within the same country and dataset");
      }
    }
    for (const row of file.sheets.Scan_Log ?? []) {
      const page = Number(row.values.PDF_Page);
      if (!Number.isInteger(page) || page < 1 || page > file.source.document.pdf_page_count) {
        addDiagnostic(diagnostics, "error", file.source.path, "Scan_Log", row.rowNumber, "PDF_Page", row.values.Document_ID, "Scan page is outside the PDF");
      }
      const linked = String(row.values.Linked_Candidate_IDs ?? "");
      for (const match of linked.matchAll(/\b(?:KHM|SLE|JAM|COD)-RA-[0-9]{3,}[A-Z]*\b/g)) {
        if (!candidateById.has(match[0])) addDiagnostic(diagnostics, "error", file.source.path, "Scan_Log", row.rowNumber, "Linked_Candidate_IDs", row.values.Document_ID,
          `Scan log references unknown candidate ${match[0]}`);
      }
    }
    for (const row of file.sheets.Anchor_Rectangles ?? []) {
      const evidenceId = String(row.values.Evidence_ID ?? "");
      const evidence = evidenceById.get(evidenceId);
      if (!evidence) {
        addDiagnostic(diagnostics, "error", file.source.path, "Anchor_Rectangles", row.rowNumber, "Evidence_ID", row.values.Rectangle_ID, "Rectangle references unknown evidence");
        continue;
      }
      const page = Number(row.values.PDF_Page);
      const evidencePage = Number(evidence.row.values.PDF_Page);
      if (page !== evidencePage) addDiagnostic(diagnostics, "error", file.source.path, "Anchor_Rectangles", row.rowNumber, "PDF_Page", row.values.Rectangle_ID,
        `Rectangle page ${page} differs from its evidence page ${evidencePage}`);
      const numericFields = ["X0", "Y0", "X1", "Y1", "Page_Width_Points", "Page_Height_Points",
        "X0_Normalized", "Y0_Normalized", "X1_Normalized", "Y1_Normalized"];
      const coordinates = Object.fromEntries(numericFields.map((key) => [key, Number(row.values[key])])) as Record<string, number>;
      if (numericFields.some((key) => !Number.isFinite(coordinates[key]))) {
        addDiagnostic(diagnostics, "error", file.source.path, "Anchor_Rectangles", row.rowNumber, null, row.values.Rectangle_ID, "Rectangle contains a missing/non-numeric coordinate");
      } else {
        if (coordinates.X0 < 0 || coordinates.Y0 < 0 || coordinates.X1 > coordinates.Page_Width_Points || coordinates.Y1 > coordinates.Page_Height_Points ||
            coordinates.X0 > coordinates.X1 || coordinates.Y0 > coordinates.Y1) {
          addDiagnostic(diagnostics, "error", file.source.path, "Anchor_Rectangles", row.rowNumber, null, row.values.Rectangle_ID, "Rectangle is outside page bounds or has inverted points");
        }
        if (["X0_Normalized", "Y0_Normalized", "X1_Normalized", "Y1_Normalized"].some((key) => coordinates[key] < 0 || coordinates[key] > 1) ||
            coordinates.X0_Normalized > coordinates.X1_Normalized || coordinates.Y0_Normalized > coordinates.Y1_Normalized) {
          addDiagnostic(diagnostics, "error", file.source.path, "Anchor_Rectangles", row.rowNumber, null, row.values.Rectangle_ID, "Normalized rectangle bounds are invalid");
        }
      }
      const rotation = Number(row.values.Page_Rotation);
      if (![0, 90, 180, 270].includes(rotation)) addDiagnostic(diagnostics, "error", file.source.path, "Anchor_Rectangles", row.rowNumber, "Page_Rotation", row.values.Rectangle_ID,
        "Page rotation must be one of 0, 90, 180, 270");
    }
  }

  for (const runId of runIds) {
    if (!runId) addDiagnostic(diagnostics, "error", "", "Analysis_Runs", null, "Analysis_Run_ID", null, "Blank analysis run ID");
  }
  for (const code of COUNTRY_CODES) {
    if (!manifest.workbooks.some((workbook) => workbook.country_code === code)) {
      addDiagnostic(diagnostics, "error", "", "", null, null, null, `Manifest lacks required country ${code}`);
    }
  }
}

export function getArg(args: string[], name: string, fallback?: string): string {
  const index = args.indexOf(name);
  if (index === -1) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required argument ${name}`);
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Argument ${name} requires a value`);
  return value;
}

export function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL must point to a development PostgreSQL database");
  try {
    const parsed = new URL(databaseUrl);
    if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname) && process.env.NODE_ENV === "production") {
      throw new Error("Refusing to use DATABASE_URL in production mode");
    }
  } catch (error) {
    if (error instanceof TypeError) throw new Error("DATABASE_URL is not a valid PostgreSQL URL");
    throw error;
  }
  return databaseUrl;
}

export function openDatabase(): Pool {
  return new Pool({ connectionString: requireDatabaseUrl(), max: 3, application_name: "compact-v5-import-cli" });
}

function plainRows(file: WorkbookData, sheet: string): Record<string, unknown>[] {
  return (file.sheets[sheet] ?? []).map((row) => row.values);
}

function rowNum(value: unknown, column: string): number | null {
  const normalized = nullable(value);
  if (normalized === null) return null;
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) throw new Error(`${column} is not numeric: ${String(value)}`);
  return numeric;
}

function stringArray(value: unknown): string[] {
  if (value === null || value === undefined || value === "") return [];
  return String(value).split(";").map((part) => part.trim()).filter(Boolean);
}

function valuesFromRow(row: Record<string, unknown>, columns: string[]): unknown[] {
  return columns.map((column) => nullable(row[column]));
}

async function bulkInsert(
  client: PoolClient,
  table: string,
  columns: string[],
  rows: unknown[][],
): Promise<void> {
  if (!rows.length) return;
  const chunkSize = 100;
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    const params: unknown[] = [];
    const tuples = chunk.map((row, rowIndex) => {
      const placeholders = row.map((value, columnIndex) => {
        params.push(value);
        return `$${rowIndex * columns.length + columnIndex + 1}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    await client.query(
      `INSERT INTO compact_v5.${table} (${columns.join(", ")}) VALUES ${tuples.join(", ")}`,
      params,
    );
  }
}

export async function stagePackage(validation: ValidationResult): Promise<{ result: "staged" | "already-staged"; counts: Record<string, number> }> {
  if (!validation.valid) throw new Error("Validation has errors; staging is blocked");
  const pool = openDatabase();
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const existing = await client.query(
      "SELECT d.source_fingerprint, d.status, b.batch_id FROM compact_v5.datasets d JOIN compact_v5.import_batches b USING (dataset_id) WHERE d.dataset_id = $1 FOR UPDATE",
      [validation.datasetId],
    );
    if (existing.rowCount) {
      if (existing.rows[0].source_fingerprint !== validation.sourceFingerprint) {
        throw new Error(`Dataset version conflict for ${validation.datasetId}: existing source fingerprint differs; create a new dataset ID`);
      }
      const status = String(existing.rows[0].status);
      if (["staged", "verified", "active", "archived"].includes(status)) {
        await client.query("COMMIT");
        return { result: "already-staged", counts: validation.totals };
      }
      throw new Error(`Dataset ${validation.datasetId} exists in non-reusable state ${status}`);
    }
    await client.query(
      `INSERT INTO compact_v5.datasets(dataset_id, methodology_version, status, source_fingerprint)
       VALUES ($1, $2, 'staging', $3)`,
      [validation.datasetId, validation.methodologyVersion, validation.sourceFingerprint],
    );
    const batchId = randomUUID();
    await client.query(
      `INSERT INTO compact_v5.import_batches(batch_id, dataset_id, source_fingerprint, status)
       VALUES ($1, $2, $3, 'staging')`,
      [batchId, validation.datasetId, validation.sourceFingerprint],
    );
    await bulkInsert(client, "import_files",
      ["dataset_id", "batch_id", "file_kind", "source_path", "sha256", "byte_size"],
      validation.fileHashes
        .filter((file) => file.kind !== "manifest" && file.kind !== "field-map")
        .map((file) => [validation.datasetId, batchId, file.kind, file.path, file.sha256, file.byteSize]));

    const countryFiles = validation.workbookData;
    await bulkInsert(client, "documents",
      ["dataset_id", "document_id", "country_code", "country", "document_title", "source_language", "document_version",
        "source_file_name", "source_library_id", "official_source_url", "repository_source", "sha256", "pdf_page_count",
        "asset_path", "page_numbering_basis", "coordinate_system", "extraction_limitations", "raw_row"],
      countryFiles.flatMap((file) => plainRows(file, "Documents").map((row) => [
        validation.datasetId, row.Document_ID, file.source.country_code, row.Country, row.Document_Title,
        row.Source_Language, row.Document_Version, row.Source_File_Name, row.Source_Library_ID,
        row.Official_Source_URL, row.Repository_Source, row.SHA256, row.PDF_Page_Count,
        file.source.document.proposed_repo_asset_path, row.Page_Numbering_Basis, row.Coordinate_System,
        row.Extraction_Limitations, row,
      ])));
    await bulkInsert(client, "analysis_runs",
      ["dataset_id", "analysis_run_id", "methodology_version", "schema_version", "analysis_date", "baseline",
        "unit_of_analysis", "coverage", "status", "raw_row"],
      countryFiles.flatMap((file) => plainRows(file, "Analysis_Runs").map((row) => [
        validation.datasetId, row.Analysis_Run_ID, row.Methodology_Version, row.Schema_Version, row.Analysis_Date,
        row.Baseline, row.Unit_of_Analysis, row.Coverage, row.Status, row,
      ])));

    const fieldMap = JSON.parse(await readFile(path.join(path.dirname(validation.manifestPath), "candidate-field-map.json"), "utf8")) as CandidateField[];
    const candidateColumns = [
      "dataset_id",
      ...fieldMap.map((field) => field.api_and_database_name),
      "country_code",
      "source_row",
      "imported_batch_id",
    ];
    await bulkInsert(client, "candidate_baselines", candidateColumns,
      countryFiles.flatMap((file) => (file.sheets.Candidates ?? []).map((sheetRow) => {
        const row = sheetRow.values;
        const criteria = fieldMap.slice(10, 16).map((field) => row[field.workbook_header]);
        const sixPass = criteria.every((value) => value === 1 || value === "1") ? 1 : 0;
        const rawValues = fieldMap.map((field) => nullable(row[field.workbook_header]));
        const mapped = fieldMap.map((field) => {
          if (field.api_and_database_name === "additional_scalable_solutions") return stringArray(row[field.workbook_header]);
          if (field.api_and_database_name === "secondary_reform_domain_tags") return stringArray(row[field.workbook_header]);
          if (field.api_and_database_name === "six_criteria_pass") return sixPass;
          if (field.api_and_database_name === "count_in_final_reform_total") return 0;
          return nullable(row[field.workbook_header]);
        });
        const exactSourceRow = Object.fromEntries(fieldMap.map((field, index) => [field.workbook_header, rawValues[index]]));
        return [validation.datasetId, ...mapped, file.source.country_code, exactSourceRow, batchId];
      })));

    const assessmentColumns = [
      "dataset_id", "candidate_id", "assessment_revision", "candidate_stream", "c1_explicit_commitment",
      "c2_discrete_actionable_mechanism", "c3_system_change", "c4_not_merely_implementation",
      "c5_distinct_reform_action", "c6_trackable_monitorable", "llm_decision_rationale", "cluster_role",
      "primary_pillar", "primary_scalable_solution", "additional_scalable_solutions", "primary_tier1_reform_domain",
      "tier2_reform_category", "secondary_reform_domain_tags", "lead_institution_actor", "water_financing_relevance",
      "temporal_status", "monitoring_completion_criterion", "reform_action_statement_english",
      "originating_analysis_version_id", "change_reason",
    ];
    const assessmentMap = [
      ["candidate_stream", "Candidate_Stream"], ["c1_explicit_commitment", "C1_Explicit_Commitment"],
      ["c2_discrete_actionable_mechanism", "C2_Discrete_Actionable_Mechanism"], ["c3_system_change", "C3_System_Change"],
      ["c4_not_merely_implementation", "C4_Not_Merely_Implementation"], ["c5_distinct_reform_action", "C5_Distinct_Reform_Action"],
      ["c6_trackable_monitorable", "C6_Trackable_Monitorable"], ["llm_decision_rationale", "LLM_Decision_Rationale"],
      ["cluster_role", "Cluster_Role"], ["primary_pillar", "Primary_Pillar"], ["primary_scalable_solution", "Primary_Scalable_Solution"],
      ["additional_scalable_solutions", "Additional_Scalable_Solutions"], ["primary_tier1_reform_domain", "Primary_Tier1_Reform_Domain"],
      ["tier2_reform_category", "Tier2_Reform_Category"], ["secondary_reform_domain_tags", "Secondary_Reform_Domain_Tags"],
      ["lead_institution_actor", "Lead_Institution_Actor"], ["water_financing_relevance", "Water_Financing_Relevance"],
      ["temporal_status", "Temporal_Status"], ["monitoring_completion_criterion", "Monitoring_Completion_Criterion"],
      ["reform_action_statement_english", "Reform_Action_Statement_English"],
    ] as const;
    await bulkInsert(client, "candidate_assessments", assessmentColumns,
      countryFiles.flatMap((file) => (file.sheets.Candidates ?? []).map(({ values: row }) => [
        validation.datasetId,
        row.Candidate_ID,
        1,
        ...assessmentMap.map(([dbColumn, sourceColumn]) => {
          if (dbColumn === "additional_scalable_solutions") return stringArray(row[sourceColumn]);
          if (dbColumn === "secondary_reform_domain_tags") return stringArray(row[sourceColumn]);
          return nullable(row[sourceColumn]);
        }),
        row.Analysis_Version_ID,
        "Imported baseline",
      ])));

    await bulkInsert(client, "evidence",
      ["dataset_id", "evidence_id", "document_id", "pdf_page", "printed_page_label", "section_or_table",
        "quote_original_language", "quote_english_translation", "text_prefix", "text_suffix", "page_char_start",
        "page_char_end", "quote_sha256", "location_status", "match_method", "extraction_method", "analysis_run_id", "raw_row"],
      countryFiles.flatMap((file) => plainRows(file, "Evidence").map((row) => [
        validation.datasetId, row.Evidence_ID, row.Document_ID, row.PDF_Page, row.Printed_Page_Label, row.Section_or_Table,
        row.Quote_Original_Language, row.Quote_English_Translation, row.Text_Prefix, row.Text_Suffix,
        row.Page_Char_Start, row.Page_Char_End, row.Quote_SHA256, row.Location_Status, row.Match_Method,
        row.Extraction_Method, row.Analysis_Run_ID, row,
      ])));
    await bulkInsert(client, "candidate_evidence",
      ["dataset_id", "candidate_id", "evidence_id", "evidence_role", "relationship_note", "analysis_run_id", "raw_row"],
      countryFiles.flatMap((file) => plainRows(file, "Candidate_Evidence").map((row) => [
        validation.datasetId, row.Candidate_ID, row.Evidence_ID, row.Evidence_Role, row.Relationship_Note, row.Analysis_Run_ID, row,
      ])));
    await bulkInsert(client, "evidence_rectangles",
      ["dataset_id", "rectangle_id", "evidence_id", "pdf_page", "x0", "y0", "x1", "y1", "x0_normalized",
        "y0_normalized", "x1_normalized", "y1_normalized", "page_width_points", "page_height_points",
        "coordinate_origin", "coordinate_unit", "page_rotation", "raw_row"],
      countryFiles.flatMap((file) => plainRows(file, "Anchor_Rectangles").map((row) => [
        validation.datasetId, row.Rectangle_ID, row.Evidence_ID, row.PDF_Page, row.X0, row.Y0, row.X1, row.Y1,
        row.X0_Normalized, row.Y0_Normalized, row.X1_Normalized, row.Y1_Normalized, row.Page_Width_Points,
        row.Page_Height_Points, row.Coordinate_Origin, row.Coordinate_Unit, row.Page_Rotation, row,
      ])));
    await bulkInsert(client, "relationships",
      ["dataset_id", "relationship_id", "source_candidate_id", "target_candidate_id", "relationship_type", "rationale", "status", "raw_row"],
      countryFiles.flatMap((file) => plainRows(file, "Relationships").map((row) => [
        validation.datasetId, row.Relationship_ID, row.Source_Candidate_ID, row.Target_Candidate_ID, row.Relationship_Type,
        row.Rationale, row.Status, row,
      ])));
    await bulkInsert(client, "id_crosswalk",
      ["dataset_id", "scan_id", "candidate_id", "first_recorded_pdf_page", "disposition", "reconciliation_note", "raw_row"],
      countryFiles.flatMap((file) => plainRows(file, "ID_Crosswalk").map((row) => [
        validation.datasetId, row.Scan_ID, row.Candidate_ID, row.First_Recorded_PDF_Page, row.Disposition, row.Reconciliation_Note, row,
      ])));
    await bulkInsert(client, "scan_log",
      ["dataset_id", "document_id", "pdf_page", "review_method", "screening_note", "linked_candidate_ids", "scan_status", "raw_row"],
      countryFiles.flatMap((file) => plainRows(file, "Scan_Log").map((row) => [
        validation.datasetId, row.Document_ID, row.PDF_Page, row.Review_Method, row.Screening_Note, row.Linked_Candidate_IDs, row.Scan_Status, row,
      ])));
    await bulkInsert(client, "qa_checks",
      ["dataset_id", "check_name", "candidate_id", "status", "detail", "raw_row"],
      countryFiles.flatMap((file) => plainRows(file, "QA").map((row) => [
        validation.datasetId, row.Check, nullable(row.Candidate_ID), row.Status, row.Detail, row,
      ])));

    const referenceFile = countryFiles[0];
    await bulkInsert(client, "taxonomy_categories",
      ["dataset_id", "tier1_code", "tier1_domain", "tier2_category", "list_status", "methodology_version"],
      (referenceFile?.sheets.Taxonomy ?? []).map(({ values: row }) => [
        validation.datasetId, row.Tier1_Code, row.Tier1_Domain, row.Tier2_Category, nullable(row.List_Status), validation.methodologyVersion,
      ]));
    await bulkInsert(client, "scalable_solutions",
      ["dataset_id", "code", "label", "source_url", "source_location", "coding_note", "methodology_version"],
      (referenceFile?.sheets.Scalable_Solutions ?? []).map(({ values: row }) => [
        validation.datasetId, row.Code, row.Label, nullable(row.Source_URL), nullable(row.Source_Location), nullable(row.Coding_Note), validation.methodologyVersion,
      ]));
    const definitions: unknown[][] = [];
    for (const file of countryFiles) {
      if (file !== referenceFile) continue;
      for (const { values: row } of file.sheets.Codebook ?? []) {
        definitions.push([validation.datasetId, "codebook", String(row.Field), row.Definition, row.Position, validation.methodologyVersion]);
      }
    }
    for (const file of countryFiles) {
      for (const { values: row } of file.sheets.ReadMe ?? []) {
        definitions.push([
          validation.datasetId,
          "readme",
          `${file.source.country_code}:${String(row.Topic)}`,
          row.Guidance,
          null,
          validation.methodologyVersion,
        ]);
      }
    }
    await bulkInsert(client, "field_definitions",
      ["dataset_id", "field_kind", "field_key", "definition", "position", "methodology_version"], definitions);

    await client.query(
      `UPDATE compact_v5.import_batches SET status = 'staged', completed_at = now(), diagnostics = $2::jsonb WHERE batch_id = $1`,
      [batchId, JSON.stringify(validation.diagnostics)],
    );
    await client.query("UPDATE compact_v5.datasets SET status = 'staged' WHERE dataset_id = $1", [validation.datasetId]);
    await client.query("COMMIT");
    return { result: "staged", counts: validation.totals };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

export const EXPECTED_COUNTS: Record<string, number> = {
  documents: 4,
  candidate_baselines: 252,
  candidate_assessments: 252,
  evidence: 348,
  candidate_evidence: 350,
  evidence_rectangles: 968,
  relationships: 63,
  analysis_runs: 4,
  id_crosswalk: 252,
  scan_log: 70,
  qa_checks: 25,
  taxonomy_categories: 136,
  scalable_solutions: 7,
  field_definitions: 92,
};

export async function verifyDataset(datasetId: string, writeVerification: boolean): Promise<Record<string, number>> {
  const pool = openDatabase();
  const client = await pool.connect();
  try {
    const counts: Record<string, number> = {};
    for (const [table, expected] of Object.entries(EXPECTED_COUNTS)) {
      const result = await client.query(
        `SELECT count(*)::int AS count FROM compact_v5.${table} WHERE dataset_id = $1`,
        [datasetId],
      );
      const count = Number(result.rows[0].count);
      counts[table] = count;
      if (count !== expected) throw new Error(`${table}: expected ${expected} rows; found ${count}`);
    }
    const query = await client.query(
      `SELECT
         count(*) FILTER (WHERE child.candidate_stream = 'High-confidence Reform Action')::int AS high_confidence,
         count(*) FILTER (WHERE child.candidate_stream = 'Needs Human Review')::int AS needs_review,
         count(*) FILTER (WHERE child.candidate_stream = 'High-confidence Non-reform')::int AS non_reform,
         count(*) FILTER (WHERE child.count_in_final_reform_total <> 0)::int AS approved_count,
         count(*) FILTER (WHERE child.six_criteria_pass <> CASE WHEN child.c1_explicit_commitment = 1 AND child.c2_discrete_actionable_mechanism = 1
           AND child.c3_system_change = 1 AND child.c4_not_merely_implementation = 1 AND child.c5_distinct_reform_action = 1
           AND child.c6_trackable_monitorable = 1 THEN 1 ELSE 0 END)::int AS criterion_mismatches,
         count(*) FILTER (WHERE child.parent_reform_action_id IS NOT NULL AND parent.country_code <> child.country_code)::int AS parent_country_mismatches
       FROM compact_v5.candidate_baselines child
       LEFT JOIN compact_v5.candidate_baselines parent ON parent.dataset_id = child.dataset_id
         AND parent.candidate_id = child.parent_reform_action_id
       WHERE child.dataset_id = $1`,
      [datasetId],
    );
    const summary = query.rows[0] as Record<string, number>;
    for (const [key, value] of Object.entries(summary)) counts[key] = Number(value);
    if (counts.high_confidence !== 113 || counts.needs_review !== 56 || counts.non_reform !== 83 ||
        counts.approved_count !== 0 || counts.criterion_mismatches !== 0 || counts.parent_country_mismatches !== 0) {
      throw new Error(`Dataset acceptance summary is inconsistent: ${JSON.stringify(counts)}`);
    }
    const unexpectedEvents = await client.query(
      "SELECT count(*)::int AS count FROM compact_v5.review_events WHERE dataset_id = $1",
      [datasetId],
    );
    if (Number(unexpectedEvents.rows[0].count) !== 0) {
      throw new Error("Initial source import must not fabricate human review events");
    }
    const importedFiles = await client.query(
      "SELECT source_path, sha256, byte_size FROM compact_v5.import_files WHERE dataset_id = $1 ORDER BY source_path",
      [datasetId],
    );
    if (importedFiles.rowCount !== 14) throw new Error(`Expected 14 file-provenance records; found ${importedFiles.rowCount}`);
    for (const file of importedFiles.rows as { source_path: string; sha256: string; byte_size: string | number }[]) {
      const sourcePath = resolveInside(REPOSITORY_ROOT, file.source_path);
      const current = await hashFile(sourcePath);
      if (current.sha256 !== file.sha256 || current.byteSize !== Number(file.byte_size)) {
        throw new Error(`Imported file provenance mismatch for ${file.source_path}`);
      }
    }
    if (writeVerification) {
      await client.query("BEGIN");
      const report = { counts, verified_at: new Date().toISOString(), method: "database acceptance counts and review-baseline invariants" };
      const updated = await client.query(
        `UPDATE compact_v5.datasets
         SET status = CASE WHEN status = 'active' THEN status ELSE 'verified' END,
             verified_at = now(), validation_report = $2::jsonb
         WHERE dataset_id = $1 AND status IN ('staged', 'verified', 'active')`,
        [datasetId, JSON.stringify(report)],
      );
      if (updated.rowCount !== 1) throw new Error(`Dataset ${datasetId} is not staged for verification`);
      await client.query(
        "UPDATE compact_v5.import_batches SET status = CASE WHEN status = 'activated' THEN status ELSE 'verified' END WHERE dataset_id = $1",
        [datasetId],
      );
      await client.query("COMMIT");
    }
    return counts;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

export async function activateDataset(datasetId: string): Promise<{ previous: string | null; active: string | null }> {
  const pool = openDatabase();
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const state = await client.query(
      "SELECT active_dataset_id FROM compact_v5.dataset_state WHERE singleton = true FOR UPDATE",
    );
    if (!state.rowCount) throw new Error("compact_v5.dataset_state is missing; apply migration 003 first");
    const previous = state.rows[0].active_dataset_id as string | null;
    if (datasetId.toLowerCase() === "legacy") {
      await client.query("UPDATE compact_v5.dataset_state SET previous_active_dataset_id = active_dataset_id, active_dataset_id = NULL, changed_at = now() WHERE singleton = true");
      if (previous) await client.query("UPDATE compact_v5.datasets SET status = 'archived' WHERE dataset_id = $1 AND status = 'active'", [previous]);
      await client.query("COMMIT");
      return { previous, active: null };
    }
    const dataset = await client.query("SELECT status, verified_at FROM compact_v5.datasets WHERE dataset_id = $1 FOR UPDATE", [datasetId]);
    if (!dataset.rowCount) throw new Error(`Unknown dataset ${datasetId}`);
    if (!dataset.rows[0].verified_at || !["verified", "active", "archived"].includes(String(dataset.rows[0].status))) {
      throw new Error(`Dataset ${datasetId} must pass compact:v5:verify before activation`);
    }
    const importedFiles = await client.query(
      "SELECT source_path, sha256, byte_size FROM compact_v5.import_files WHERE dataset_id = $1 ORDER BY source_path",
      [datasetId],
    );
    if (importedFiles.rowCount !== 14) throw new Error(`Expected 14 file-provenance records; found ${importedFiles.rowCount}`);
    for (const file of importedFiles.rows as { source_path: string; sha256: string; byte_size: string | number }[]) {
      const current = await hashFile(resolveInside(REPOSITORY_ROOT, file.source_path));
      if (current.sha256 !== file.sha256 || current.byteSize !== Number(file.byte_size)) {
        throw new Error(`Imported file provenance mismatch for ${file.source_path}; activation was not changed`);
      }
    }
    if (previous === datasetId) {
      await client.query("COMMIT");
      return { previous, active: datasetId };
    }
    await client.query("UPDATE compact_v5.dataset_state SET previous_active_dataset_id = active_dataset_id, active_dataset_id = $1, changed_at = now() WHERE singleton = true", [datasetId]);
    if (previous) await client.query("UPDATE compact_v5.datasets SET status = 'archived' WHERE dataset_id = $1 AND status = 'active'", [previous]);
    await client.query("UPDATE compact_v5.datasets SET status = 'active', activated_at = now() WHERE dataset_id = $1", [datasetId]);
    await client.query("UPDATE compact_v5.import_batches SET status = 'activated' WHERE dataset_id = $1", [datasetId]);
    await client.query("COMMIT");
    return { previous, active: datasetId };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

export async function writeValidationReport(result: ValidationResult, reportPath?: string): Promise<string> {
  const outputPath = reportPath
    ? (path.isAbsolute(reportPath) ? path.resolve(reportPath) : path.resolve(REPOSITORY_ROOT, reportPath))
    : path.join(tmpdir(), `water-compact-v5-validation-${result.datasetId}.json`);
  const { workbookData: _workbookData, ...serializable } = result;
  await writeFile(outputPath, `${JSON.stringify(serializable, null, 2)}\n`, "utf8");
  return outputPath;
}

export function assertValid(result: ValidationResult): void {
  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length) {
    throw new Error(`v5 validation failed with ${errors.length} error(s); inspect the generated report`);
  }
}

export const helpers = { nullable, rowNum, valuesFromRow, stringArray };