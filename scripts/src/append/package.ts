import { createHash } from 'node:crypto';
import { readFile, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import { columns, tables, canonical, type Row, type Table } from './columns.js';

export const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
export function requireThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export interface AppendPackage {
  root: string; manifest: Row; fingerprint: string;
  files: { path: string; sha256: string; size_bytes: number }[];
  data: Record<Table, Row[]>; reference: Row;
}
export async function safeFile(root: string, relative: string): Promise<string> {
  requireThat(typeof relative === 'string' && relative.length > 0 &&
    !path.isAbsolute(relative) && !relative.includes('\\') &&
    !relative.split('/').some(p => p === '..' || p === '' || p === '.'), `Unsafe package path: ${relative}`);
  let current = root;
  for (const component of relative.split('/')) {
    current = path.join(current, component);
    requireThat(!(await lstat(current)).isSymbolicLink(), `Symlink forbidden: ${relative}`);
  }
  const resolved = await realpath(current);
  requireThat(resolved.startsWith(`${root}${path.sep}`), 'Package path escapes root');
  return resolved;
}
export async function validatePackage(manifestPath: string): Promise<AppendPackage> {
  const root = await realpath(path.dirname(path.resolve(manifestPath)));
  const checksumBytes = await readFile(await safeFile(root, 'SHA256SUMS.json'));
  const checks = JSON.parse(checksumBytes.toString());
  requireThat(checks.algorithm === 'sha256' && Array.isArray(checks.files), 'Invalid checksum manifest');
  const known = new Set<string>();
  for (const file of checks.files) {
    requireThat(!known.has(file.path) && /^[0-9a-f]{64}$/.test(file.sha256), 'Duplicate/invalid checksum entry');
    known.add(file.path);
    const bytes = await readFile(await safeFile(root, file.path));
    requireThat(bytes.length === file.size_bytes && sha(bytes) === file.sha256, `Checksum mismatch: ${file.path}`);
  }
  const read = async (relative: string) => {
    requireThat(known.has(relative), `Unlisted file: ${relative}`);
    return JSON.parse(await readFile(await safeFile(root, relative), 'utf8'));
  };
  const manifest = await read(path.basename(manifestPath));
  requireThat(manifest.package_format === 'water-compact-append-handoff-v1' &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,160}$/.test(manifest.batch_key), 'Unsupported package or batch key');
  const fields = await read('reference/candidate-field-map.json');
  requireThat(fields.length === 42 && canonical(fields.map((f: Row) => f.api_and_database_name)) ===
    canonical(columns.candidate_baselines.split(',').filter(k => !['country_code', 'source_row'].includes(k))), 'Candidate mapping differs from application');
  const reference = await read('reference/repository-reference-data.json');
  const data = Object.fromEntries(tables.map(t => [t, []])) as unknown as Record<Table, Row[]>;
  const totals: Row = {};
  const countries = new Set<string>();
  let reviewActions = 0;
  const keys: Partial<Record<Table, string[]>> = {
    documents: ['document_id'], analysis_runs: ['analysis_run_id'], candidate_baselines: ['candidate_id'],
    evidence: ['evidence_id'], candidate_evidence: ['candidate_id', 'evidence_id'],
    evidence_rectangles: ['rectangle_id'], relationships: ['relationship_id'], id_crosswalk: ['scan_id'],
    scan_log: ['document_id', 'pdf_page'],
  };
  const sourceSheets: Record<Table, string> = {
    documents: 'Documents', analysis_runs: 'Analysis_Runs', candidate_baselines: 'Candidates',
    evidence: 'Evidence', candidate_evidence: 'Candidate_Evidence', evidence_rectangles: 'Anchor_Rectangles',
    relationships: 'Relationships', id_crosswalk: 'ID_Crosswalk', scan_log: 'Scan_Log', qa_checks: 'QA_Log',
  };
  for (const country of manifest.countries) {
    const code = country.country_code;
    requireThat(/^[A-Z]{3}$/.test(code) && !countries.has(code), 'Duplicate or invalid country');
    countries.add(code);
    for (const kind of ['workbook', 'pdf']) {
      requireThat(known.has(country[`${kind}_path`]), `Missing ${kind}`);
      requireThat(sha(await readFile(await safeFile(root, country[`${kind}_path`]))) === country[`${kind}_sha256`], `${code}: ${kind} fingerprint differs`);
    }
    const incoming = (await read(country.normalized_path)).tables;
    const archive = await read(country.archive_path);
    requireThat(canonical(archive.headers.Candidates) === canonical(manifest.shared_candidate_headers), `${code}: candidate headers differ`);
    requireThat(canonical(Object.keys(incoming).sort()) === canonical([...tables].sort()), `${code}: unexpected tables`);
    for (const table of tables) {
      const rows = incoming[table];
      requireThat(Array.isArray(rows) && rows.length === country.expected_table_deltas[table], `${code}: ${table} count differs`);
      for (const row of rows) {
        requireThat(canonical(Object.keys(row).sort()) === canonical(columns[table].split(',').sort()), `${code}: ${table} column mismatch`);
      }
      requireThat(canonical(rows.map((r: Row) => r[table === 'candidate_baselines' ? 'source_row' : 'raw_row'])) ===
        canonical(archive.sheets[sourceSheets[table]]), `${code}: ${table} original rows differ`);
      data[table].push(...rows);
      totals[table] = (totals[table] || 0) + rows.length;
    }
    const streams: Row = {};
    const solutions = new Set(reference.Scalable_Solutions.map((r: Row) => r.Code));
    // Some authoritative source labels omit the numbered domain prefix.
    // Normalize only for comparison; never rewrite source values.
    const domain = (s: string) => s.replace(/^\d+\.\s*/, '');
    const taxonomy = new Set(reference.Taxonomy.map((r: Row) => canonical([domain(r.Tier1_Domain), r.Tier2_Category])));
    for (const row of incoming.candidate_baselines) {
      requireThat(new RegExp(`^${code}-RA-[0-9]{3,}[A-Z]*$`).test(row.candidate_id) && row.country_code === code, 'Candidate prefix mismatch');
      for (const field of fields) {
        const key = field.api_and_database_name;
        let expected = row.source_row[field.workbook_header];
        if (['additional_scalable_solutions', 'secondary_reform_domain_tags'].includes(key))
          expected = expected ? String(expected).split(';').map(s => s.trim()).filter(Boolean) : [];
        if (key === 'six_criteria_pass') expected = Number(fields.slice(10, 16).every((f: Row) => row.source_row[f.workbook_header] === 1));
        if (key === 'count_in_final_reform_total') expected = 0;
        requireThat(canonical(row[key]) === canonical(expected), `${row.candidate_id}: altered ${key}`);
      }
      requireThat(fields.slice(10, 16).every((f: Row) => [0, 1].includes(row[f.api_and_database_name])) &&
        [0, 1].includes(row.water_financing_relevance), 'Invalid criterion/financing flag');
      requireThat(row.global_review_decision === null && row.regional_confirmation_decision === 'Pending' &&
        row.final_status === 'Pending' && row.review_resolution === null && row.count_in_final_reform_total === 0 &&
        row.global_review_comment === null && row.regional_comment === null, 'New candidate contains human review results');
      requireThat(['High-confidence Reform Action', 'Needs Human Review', 'High-confidence Non-reform'].includes(row.candidate_stream), 'Invalid candidate stream');
      requireThat((!row.primary_scalable_solution || solutions.has(row.primary_scalable_solution)) &&
        row.additional_scalable_solutions.every((v: string) => solutions.has(v)), 'Unknown solution');
      requireThat((row.primary_tier1_reform_domain === null && row.tier2_reform_category === null) ||
        (typeof row.primary_tier1_reform_domain === 'string' &&
        taxonomy.has(canonical([domain(row.primary_tier1_reform_domain), row.tier2_reform_category]))), 'Unknown taxonomy');
      streams[row.candidate_stream] = (streams[row.candidate_stream] || 0) + 1;
    }
    requireThat(canonical(streams) === canonical(country.stream_counts), 'Stream totals differ');
    reviewActions += (streams['High-confidence Reform Action'] || 0) + (streams['Needs Human Review'] || 0);
    const doc = incoming.documents[0];
    requireThat(incoming.documents.length === 1 && doc.document_id === country.document_id &&
      doc.country_code === code && doc.sha256 === country.pdf_sha256 && doc.pdf_page_count === country.pdf_page_count &&
      new RegExp(`^source_package/documents/v5/[a-z0-9-]+/${doc.document_id}\\.pdf$`).test(doc.asset_path), 'Document metadata/asset path differs');
    requireThat(incoming.analysis_runs.length === 1 && incoming.analysis_runs[0].analysis_run_id === country.analysis_run_id, 'Analysis run mismatch');
    const candidateIds = new Set(incoming.candidate_baselines.map((r: Row) => r.candidate_id));
    const evidence = new Map<string, Row>(incoming.evidence.map((r: Row) => [r.evidence_id, r]));
    for (const row of incoming.candidate_baselines) {
      requireThat(row.document_id === country.document_id && row.analysis_run_id === country.analysis_run_id &&
        (!row.parent_reform_action_id || candidateIds.has(row.parent_reform_action_id)), 'Candidate references differ');
      const visited = new Set<string>();
      let next: Row | undefined = row;
      while (next) {
        requireThat(!visited.has(next.candidate_id), 'Parent cycle');
        visited.add(next.candidate_id);
        next = incoming.candidate_baselines.find((r: Row) => r.candidate_id === next!.parent_reform_action_id);
      }
    }
    for (const row of evidence.values()) requireThat(row.document_id === country.document_id &&
      row.analysis_run_id === country.analysis_run_id && sha(row.quote_original_language || '') === row.quote_sha256 &&
      Number.isInteger(row.pdf_page) && row.pdf_page >= 1 && row.pdf_page <= doc.pdf_page_count, 'Evidence metadata/quote mismatch');
    for (const row of incoming.candidate_evidence) requireThat(candidateIds.has(row.candidate_id) && evidence.has(row.evidence_id) &&
      row.analysis_run_id === country.analysis_run_id, 'Invalid evidence link');
    requireThat(new Set(incoming.candidate_evidence.map((r: Row) => r.candidate_id)).size === candidateIds.size, 'Candidate without evidence');
    for (const row of incoming.evidence_rectangles) {
      requireThat(evidence.get(row.evidence_id)?.pdf_page === row.pdf_page && row.x0 >= 0 && row.y0 >= 0 &&
        row.x1 > row.x0 && row.y1 > row.y0 && row.x1 <= row.page_width_points + 0.01 &&
        row.y1 <= row.page_height_points + 0.01 && [0, 90, 180, 270].includes(row.page_rotation), 'Invalid evidence rectangle');
    }
    for (const row of incoming.relationships) requireThat(candidateIds.has(row.source_candidate_id) &&
      candidateIds.has(row.target_candidate_id) && row.source_candidate_id !== row.target_candidate_id &&
      row.relationship_id === `${code}-REL-${sha(canonical(row.raw_row)).slice(0, 24)}` && row.status === null, 'Invalid analytical relationship');
    for (const row of incoming.id_crosswalk) requireThat(!row.candidate_id || candidateIds.has(row.candidate_id), 'Invalid crosswalk');
    for (const row of incoming.qa_checks) requireThat(!row.candidate_id || candidateIds.has(row.candidate_id), 'Invalid QA candidate');
    for (const row of incoming.scan_log) requireThat(row.document_id === country.document_id &&
      row.pdf_page > 0 && row.pdf_page <= doc.pdf_page_count, 'Invalid scan page');
  }
  for (const table of tables) {
    const key = keys[table];
    if (key) requireThat(new Set(data[table].map(r => canonical(key.map(k => r[k])))).size === data[table].length, `Duplicate ${table} key`);
  }
  totals.candidate_assessments = data.candidate_baselines.length;
  requireThat(canonical(totals) === canonical(manifest.expected_table_deltas) &&
    reviewActions === manifest.expected_added_review_actions && manifest.expected_added_final_approved === 0, 'Manifest totals differ');
  return { root, manifest, fingerprint: sha(checksumBytes), files: checks.files, data, reference };
}
