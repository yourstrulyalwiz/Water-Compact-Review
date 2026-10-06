import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useLocation, useSearch } from 'wouter';
import { AlertTriangle, ChevronLeft, ChevronRight, Download, FileSignature, FileText, Filter, Search, User } from 'lucide-react';
import { PdfViewer } from '@/components/PdfViewer';
import { ReviewerModal } from '@/components/ReviewerModal';
import { ReviewDecisionForm } from '@/components/ReviewDecisionForm';
import { useReviewer } from '@/hooks/use-reviewer';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

const STREAMS = ['High-confidence Reform Action', 'Needs Human Review', 'High-confidence Non-reform'];
const GLOBAL_DECISIONS = ['Approve', 'Revise', 'Reject', 'Consolidate', 'Needs Discussion'];
const REGIONAL_DECISIONS = ['Confirm', 'Confirm with Revision', 'Disagree', 'Needs Discussion', 'Pending'];
const FINAL_STATUSES = ['Approved Reform', 'Rejected Non-reform', 'Consolidated', 'Pending'];
const COUNTRIES = [
  { code: 'KHM', name: 'Cambodia', short: 'Cambodia' },
  { code: 'SLE', name: 'Sierra Leone', short: 'Sierra Leone' },
  { code: 'JAM', name: 'Jamaica', short: 'Jamaica' },
  { code: 'COD', name: 'Democratic Republic of the Congo', short: 'DRC' },
];
const CRITERIA = [
  ['C1', 'Explicit commitment'],
  ['C2', 'Discrete actionable mechanism'],
  ['C3', 'System change'],
  ['C4', 'Not merely implementation'],
  ['C5', 'Distinct reform action'],
  ['C6', 'Trackable and monitorable'],
];

type AnyRecord = Record<string, any>;
const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
const val = (obj: AnyRecord | null | undefined, ...keys: string[]) => {
  for (const key of keys) if (obj?.[key] !== undefined && obj?.[key] !== null && obj[key] !== '') return obj[key];
  return '';
};
const text = (v: unknown) => v === null || v === undefined || v === '' ? 'Not provided' : String(v);
const getCandidateId = (c: AnyRecord) => val(c, 'candidate_id', 'Candidate_ID', 'id');
const getStream = (c: AnyRecord) => val(c, 'effective_stream', 'stream', 'Candidate_Stream_Label') || val(c?.current_assessment, 'effective_stream') || val(c, 'candidate_stream', 'Candidate_Stream');
const getBaselineStream = (c: AnyRecord) => val(c?.baseline, 'candidate_stream', 'Candidate_Stream') || val(c, 'baseline_stream', 'Baseline_Stream', 'candidate_stream', 'Candidate_Stream');
const getCountry = (c: AnyRecord) => val(c, 'country', 'country_name', 'Country');
const countryCode = (c: AnyRecord) => val(c, 'country_code', 'Country_Code') || COUNTRIES.find(x => x.name === getCountry(c) || x.code === getCountry(c))?.code || getCandidateId(c).slice(0, 3);
const countryFullName = (c: AnyRecord) => getCountry(c) && !COUNTRIES.some(x => x.code === getCountry(c)) ? getCountry(c) : COUNTRIES.find(x => x.code === countryCode(c))?.name || getCountry(c);
const titleOf = (c: AnyRecord) => val(c, 'reform_action_statement_english', 'standardized_candidate_reform_action', 'Reform_Action_Statement_English', 'candidate_action_english');
const sourceExcerpt = (c: AnyRecord) => val(c, 'evidence_passage_english_translation', 'Evidence_Passage_English_Translation', 'evidence_passage_original_language', 'Evidence_Passage_Original_Language', 'source_excerpt', 'compact_form', 'Compact_Form');
const reviewDecisionStyle = (decision: string) => {
  const normalized = decision === 'Approve' ? 'Accept' : decision;
  if (normalized === 'Accept') return {
    label: normalized,
    card: 'border-l-emerald-500 bg-emerald-50/40',
    badge: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  };
  if (normalized === 'Needs Discussion') return {
    label: normalized,
    card: 'border-l-amber-500 bg-amber-50/50',
    badge: 'bg-amber-100 text-amber-800 border-amber-200',
  };
  if (normalized === 'Reject') return {
    label: normalized,
    card: 'border-l-red-500 bg-red-50/40',
    badge: 'bg-red-100 text-red-800 border-red-200',
  };
  return {
    label: normalized,
    card: 'border-l-slate-300 bg-white',
    badge: 'bg-slate-100 text-slate-700 border-slate-200',
  };
};
const evidenceOf = (d: AnyRecord | null) => val(d, 'evidence', 'linked_evidence', 'candidate_evidence', 'anchors') as AnyRecord[] || [];
const evidenceOriginal = (e: AnyRecord) => val(e, 'original_quote', 'verbatim_source_text', 'quote_original', 'quote_original_language', 'evidence_passage_original_language', 'Quote_Original_Language', 'Evidence_Passage_Original_Language', 'Original_Quote');
const evidenceEnglish = (e: AnyRecord) => val(e, 'english_translation', 'translation_english', 'quote_english_translation', 'evidence_passage_english_translation', 'Quote_English_Translation', 'Evidence_Passage_English_Translation', 'English_Translation');
const evidenceRotation = (e: AnyRecord) => {
  const rects = val(e, 'rectangles', 'evidence_rectangles') as AnyRecord[] || [];
  return Number(val(e, 'page_rotation', 'Page_Rotation') || val(rects[0], 'page_rotation', 'Page_Rotation') || 0);
};
const streamClass = (s: string) => s === STREAMS[0] ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : s === STREAMS[1] ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-slate-100 text-slate-700 border-slate-200';
const getCriterion = (c: AnyRecord, n: number) => {
  const criterionNames = ['explicit_commitment', 'discrete_actionable_mechanism', 'system_change', 'not_merely_implementation', 'distinct_reform_action', 'trackable_monitorable'];
  const possible = [`c${n}`, `c${n}_${criterionNames[n - 1]}`, `criterion_${n}`, `criterion_c${n}`, `C${n}`, `C${n}_Pass`, `criterion_${n}_pass`];
  const v = val(c, ...possible);
  return v === '' ? null : (v === 1 || v === '1' || v === true);
};
const arrayText = (v: unknown) => Array.isArray(v) ? v.join(', ') : text(v);
const tagValues = (v: unknown): string[] => Array.isArray(v) ? v.map(String) : String(v || '').split(';').map(s => s.trim()).filter(Boolean);
const flattenCandidate = (c: AnyRecord) => {
  const merged = { ...(c?.baseline || {}), ...c, ...(c?.assessment || {}), ...(c?.effective || {}), ...(c?.current_assessment || {}) };
  for (const key of ['candidate_id', 'country', 'country_code', 'final_status', 'global_review_decision', 'regional_confirmation_decision', 'review_resolution', 'count_in_final_reform_total', 'six_criteria_pass', 'has_unresolved_disagreement', 'assessment_revision']) {
    if (c?.[key] !== undefined) merged[key] = c[key];
  }
  return merged;
};
const criteriaPass = (c: AnyRecord) => {
  const stored = val(c, 'six_criteria_pass', 'Six_Criteria_Pass');
  if (stored !== '') return stored === 1 || stored === '1' || stored === true;
  return CRITERIA.every((_, index) => getCriterion(c, index + 1) === true);
};
const hasIssue = (c: AnyRecord) => {
  const flag = val(c, 'has_unresolved_issue', 'unresolved_issue_count');
  return flag === true || flag === 1 || (typeof flag === 'string' && flag !== '' && flag !== '0' && flag.toLowerCase() !== 'false');
};
const isQaSample = (c: AnyRecord) => {
  const sample = val(c, 'qa_sample', 'QA_Sample', 'qa_status', 'QA_Status');
  return sample !== '' && sample !== false && sample !== 0 && sample !== '0' && String(sample).toLowerCase() !== 'no';
};
const countInFinalTotal = (c: AnyRecord) => {
  const value = val(c, 'count_in_final_reform_total', 'Count_in_Final_Reform_Total');
  return value === true || value === 1 || value === '1';
};

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} while loading ${url}`);
  return response.json() as Promise<T>;
}

export default function Workspace() {
  const [location, setLocation] = useLocation();
  const searchParams = new URLSearchParams(useSearch());
  const selectedId = searchParams.get('id');
  const { reviewer, login, logout } = useReviewer();
  const [showReviewerModal, setShowReviewerModal] = useState(!reviewer);
  const [allCandidates, setAllCandidates] = useState<AnyRecord[]>([]);
  const [detail, setDetail] = useState<AnyRecord | null>(null);
  const [stats, setStats] = useState<AnyRecord | null>(null);
  const [datasetId, setDatasetId] = useState('');
  const [qaChecks, setQaChecks] = useState<AnyRecord[]>([]);
  const [qaError, setQaError] = useState('');
  const [relationships, setRelationships] = useState<AnyRecord[]>([]);
  const [document, setDocument] = useState<AnyRecord | null>(null);
  const [activeEvidenceId, setActiveEvidenceId] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [view, setView] = useState('All candidates');
  const [filters, setFilters] = useState<Record<string, string>>({ country: 'All', stream: STREAMS[0], pillar: 'All', tier1: 'All', tier2: 'All', solution: 'All', cluster: 'All', global: 'All', regional: 'All', final: 'All', criterion: 'All', issue: 'All' });
  const [showFilters, setShowFilters] = useState(false);
  const [tab, setTab] = useState('Action');
  const [exportMessage, setExportMessage] = useState('');

  const refreshAfterReview = async (candidateId: string) => {
    try {
      const [updated, list] = await Promise.all([
        readJson<any>(`/api/candidates/${encodeURIComponent(candidateId)}`),
        readJson<any>('/api/candidates?limit=500'),
      ]);
      const updatedDetail = flattenCandidate(updated?.candidate ?? updated?.detail ?? updated);
      setDetail(current => current && getCandidateId(current) === candidateId ? updatedDetail : current);
      const rows = Array.isArray(list) ? list : list?.candidates ?? list?.items ?? [];
      setAllCandidates(rows.map(flattenCandidate));
    } catch {
      setError('Review saved, but the page could not refresh. Reload to see the updated history.');
    }
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    let qaLoadError = '';
    Promise.all([
      readJson<any>('/api/candidates?limit=500'),
      readJson<any>('/api/stats').catch(() => null),
      readJson<any>('/api/qa-checks').catch(e => { qaLoadError = e.message || 'Unable to load QA checks'; return []; }),
    ]).then(([candidateResponse, statsResponse, qaResponse]) => {
      if (!alive) return;
      const candidateRows = Array.isArray(candidateResponse) ? candidateResponse : candidateResponse?.candidates ?? candidateResponse?.items ?? [];
      setAllCandidates(candidateRows.map(flattenCandidate));
      setStats(statsResponse);
      setDatasetId(candidateResponse?.dataset_id || '');
      setQaChecks(Array.isArray(qaResponse) ? qaResponse : []);
      setQaError(qaLoadError);
      setError('');
    }).catch(e => alive && setError(e.message || 'Unable to load candidates'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  const qaCandidateIds = useMemo(() => new Set(qaChecks
    .map(check => String(val(check, 'candidate_id', 'Candidate_ID', 'candidateId')))
    .filter(Boolean)), [qaChecks]);

  const candidates = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase();
    return allCandidates.filter(c => {
      const id = getCandidateId(c);
      const stream = getStream(c);
      const country = getCountry(c);
      if (view === 'Review actions' && stream === STREAMS[2]) return false;
      if (view === 'Final approved reforms' && !countInFinalTotal(c)) return false;
      if (view === 'QA sample' && !(qaCandidateIds.has(String(id)) || (!datasetId && isQaSample(c)))) return false;
      if (filters.country !== 'All' && countryCode(c) !== filters.country && country !== filters.country) return false;
      if (filters.stream !== 'All' && stream !== filters.stream) return false;
      if (filters.pillar !== 'All' && val(c, 'primary_pillar', 'water_security_pillar', 'Primary_Pillar') !== filters.pillar) return false;
      if (filters.tier1 !== 'All' && val(c, 'primary_tier1_reform_domain', 'reform_domain_tier_1', 'reform_type_tier_1', 'Primary_Tier1_Reform_Domain') !== filters.tier1) return false;
      if (filters.tier2 !== 'All' && val(c, 'tier2_reform_category', 'reform_domain_tier_2', 'reform_type_tier_2', 'Tier2_Reform_Category') !== filters.tier2) return false;
      if (filters.solution !== 'All' && ![val(c, 'primary_scalable_solution', 'Primary_Scalable_Solution'), ...tagValues(val(c, 'additional_scalable_solutions', 'Additional_Scalable_Solutions'))].includes(filters.solution)) return false;
      if (filters.cluster !== 'All' && val(c, 'cluster_role', 'Cluster_Role') !== filters.cluster) return false;
      if (filters.global !== 'All' && (val(c, 'global_review_decision', 'Global_Review_Decision') || 'Pending') !== filters.global) return false;
      if (filters.regional !== 'All' && (val(c, 'regional_confirmation_decision', 'Regional_Confirmation_Decision') || 'Pending') !== filters.regional) return false;
      if (filters.final !== 'All' && (val(c, 'final_status', 'Final_Status') || 'Pending') !== filters.final) return false;
      if (filters.criterion !== 'All') {
        const criterionNumber = Number(filters.criterion.slice(1));
        if (getCriterion(c, criterionNumber) !== false) return false;
      }
      if (filters.issue === 'Yes' && !hasIssue(c)) return false;
      if (filters.issue === 'No' && hasIssue(c)) return false;
      if (normalized) {
        const searchable = [id, titleOf(c), sourceExcerpt(c), val(c, 'reform_action_text_original_language', 'reform_action_statement_original', 'original_compact_text'), val(c, 'reform_action_text_english_translation', 'reform_action_statement_english'), val(c, 'llm_decision_rationale', 'decision_rationale', 'rationale'), val(c, 'primary_pillar', 'water_security_pillar'), val(c, 'primary_tier1_reform_domain', 'reform_domain_tier_1', 'reform_type_tier_1'), val(c, 'tier2_reform_category', 'reform_domain_tier_2'), val(c, 'secondary_reform_domain_tags', 'Secondary_Reform_Domain_Tags'), val(c, 'primary_scalable_solution', 'Primary_Scalable_Solution'), val(c, 'additional_scalable_solutions', 'Additional_Scalable_Solutions'), val(c, 'evidence_text', 'evidence_search_text'), country].join(' ').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase();
        const needle = normalized.normalize('NFD').replace(/\p{Diacritic}/gu, '');
        if (!searchable.includes(needle)) return false;
      }
      return true;
    });
  }, [allCandidates, datasetId, filters, qaCandidateIds, search, view]);
  const countryOptions = useMemo(() => {
    const observed = new Map<string, string>();
    for (const candidate of allCandidates) {
      const code = countryCode(candidate);
      if (code) observed.set(code, code === 'COD' ? 'DRC' : COUNTRIES.find(c => c.code === code)?.short || getCountry(candidate) || code);
    }
    return [...observed.entries()];
  }, [allCandidates]);

  useEffect(() => {
    if (!selectedId && candidates.length) {
      const params = new URLSearchParams(searchParams);
      params.set('id', getCandidateId(candidates[0]));
      setLocation(`${location}?${params.toString()}`);
    }
  }, [candidates, selectedId, location, searchParams, setLocation]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); setRelationships([]); setDocument(null); return; }
    let alive = true;
    setDetailLoading(true);
    setDetail(null);
    setDocument(null);
    setRelationships([]);
    setActiveEvidenceId('');
    readJson<any>(`/api/candidates/${encodeURIComponent(selectedId)}`).then(d => {
      if (!alive) return;
      const candidateDetail = flattenCandidate(d?.candidate ?? d?.detail ?? d);
      setDetail(candidateDetail);
      setRelationships(Array.isArray(candidateDetail.relationships) ? candidateDetail.relationships : []);
      const evidence = evidenceOf(candidateDetail);
       const first = evidence.find((e: AnyRecord) => /canonical action/i.test(val(e, 'link_role', 'evidence_role', 'Evidence_Role', 'anchor_role', 'role'))) || evidence[0];
      setActiveEvidenceId(first ? String(val(first, 'evidence_id', 'anchor_id', 'id')) : '');
      setError('');
    }).catch(e => alive && setError(e.message || 'Unable to load candidate details'))
      .finally(() => alive && setDetailLoading(false));
    return () => { alive = false; };
  }, [selectedId]);

  const reviews = Array.isArray(detail?.review_events) ? detail.review_events : Array.isArray(detail?.reviews) ? detail.reviews : Array.isArray(detail?.events) ? detail.events : [];
  const evidence = evidenceOf(detail);
  const activeEvidence = evidence.find((e: AnyRecord) => String(val(e, 'evidence_id', 'anchor_id', 'id')) === activeEvidenceId);
  const docId = val(activeEvidence, 'document_id', 'Document_ID');
  useEffect(() => {
    if (!docId) { setDocument(null); return; }
    let alive = true;
    setDocument(null);
    readJson<any>(`/api/documents/${encodeURIComponent(docId)}`).then(d => alive && setDocument(d?.document ?? d))
      .catch(e => alive && setError(e.message || 'Unable to load source document'));
    return () => { alive = false; };
  }, [docId]);

  const selectCandidate = (id: string) => {
    const params = new URLSearchParams(searchParams);
    params.set('id', id);
    setLocation(`${location}?${params.toString()}`);
  };
  const selectedIndex = candidates.findIndex(c => getCandidateId(c) === selectedId);
  const moveSelection = (delta: number) => {
    const next = candidates[selectedIndex + delta];
    if (next) selectCandidate(getCandidateId(next));
  };
  const distinct = (keys: string[]) => [...new Set(allCandidates.map(c => String(val(c, ...keys))).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  const exportItems = [
    ['Master candidate CSV', '/api/export/master.csv'],
    ['Final approved CSV', '/api/export/final-approved.csv'],
    ['Reviewer decisions & history CSV', '/api/export/review-history.csv'],
    ['Evidence & provenance CSV', '/api/export/evidence.csv'],
  ];
  const exportData = (url: string) => {
    setExportMessage('Preparing export…');
    fetch(url).then(async response => {
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = downloadUrl;
      const serverFilename = response.headers.get('Content-Disposition')?.match(/filename="?([^";]+)"?/i)?.[1];
      a.download = serverFilename || url.split('/').pop() || 'export.csv';
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      setExportMessage('Export downloaded');
    }).catch(e => setExportMessage(`Export unavailable: ${e.message}`));
  };

  const currentDecision = val(detail, 'global_review_decision', 'Global_Review_Decision') || 'Pending';
  const regionalDecision = val(detail, 'regional_confirmation_decision', 'Regional_Confirmation_Decision') || 'Pending';
  const candidateQaChecks = detail ? qaChecks.filter(check => String(val(check, 'candidate_id', 'Candidate_ID', 'candidateId')) === String(getCandidateId(detail))) : [];

  return <div className="flex flex-col h-[100dvh] w-full bg-background overflow-hidden font-sans">
    {showReviewerModal && <ReviewerModal onLogin={identity => { login(identity); setShowReviewerModal(false); }} onViewWithoutReviewer={() => setShowReviewerModal(false)} />}
    <header className="flex-none min-h-12 border-b bg-card flex items-center justify-between px-4 gap-3">
      <div className="flex items-center gap-3 flex-none"><FileSignature className="w-5 h-5 text-primary" /><h1 className="font-semibold text-sm">Water Compact Review</h1><Badge variant="secondary" className="text-[10px] uppercase font-mono px-1.5 py-0">{datasetId ? 'v5 · Review workspace' : loading ? 'Loading dataset' : 'Legacy · read-only'}</Badge></div>
      <div className="text-xs text-muted-foreground font-mono hidden md:block">{allCandidates.length ? `${stats?.total_candidates ?? allCandidates.length} candidates · ${stats?.total_evidence ?? stats?.total_anchors ?? '—'} evidence passages · ${stats?.total_documents ?? '—'} documents` : 'Loading dataset…'}</div>
      <div className="flex items-center gap-3">
        <div className="relative group"><button className="flex items-center gap-1.5 text-xs border rounded-md px-2.5 py-1.5 hover:bg-muted"><Download className="w-3.5 h-3.5" />Exports</button><div className="hidden group-hover:block focus-within:block absolute right-0 top-full z-50 bg-card border rounded-md shadow-lg p-1 min-w-48">{exportItems.map(([label, url]) => <button key={url} onClick={() => exportData(url)} className="block w-full text-left text-xs px-3 py-2 rounded hover:bg-muted">{label}</button>)}</div></div>
        {reviewer ? <div className="flex items-center gap-1.5 text-xs border rounded-full px-2.5 py-1 bg-slate-50"><User className="w-3.5 h-3.5 text-slate-500" /><span className="font-medium max-w-[100px] truncate">{reviewer.display_name}</span><button onClick={() => { logout(); setShowReviewerModal(true); }} className="text-slate-400 hover:text-slate-600 ml-1 text-[10px] underline">Switch</button></div> : <button onClick={() => setShowReviewerModal(true)} className="text-xs text-primary hover:underline font-medium">Select reviewer name</button>}
      </div>
    </header>
    {exportMessage && <div role="status" className="absolute z-50 top-14 right-4 rounded bg-slate-900 text-white px-3 py-2 text-xs shadow">{exportMessage}<button className="ml-3 underline" onClick={() => setExportMessage('')}>Dismiss</button></div>}
    {error && <div className="flex-none px-4 py-2 bg-amber-50 text-amber-900 text-xs border-b border-amber-200"><AlertTriangle className="inline w-3.5 h-3.5 mr-1" />{error}</div>}
    {!datasetId && !loading && allCandidates.length > 0 && <div className="flex-none px-4 py-2 bg-amber-50 text-amber-900 text-xs border-b border-amber-200"><AlertTriangle className="inline w-3.5 h-3.5 mr-1" />Legacy dataset active. This read-only workspace may not have v5 assessments, QA checks, linked evidence, or server-derived final-count data.</div>}
    {datasetId && qaError && <div className="flex-none px-4 py-2 bg-amber-50 text-amber-900 text-xs border-b border-amber-200"><AlertTriangle className="inline w-3.5 h-3.5 mr-1" />QA checks unavailable: {qaError}</div>}
    <div className="flex-1 min-h-0">
      <PanelGroup direction="horizontal">
        <Panel defaultSize={25} minSize={20} maxSize={35} className="flex flex-col bg-card relative">
          <div className="flex-none p-3 border-b space-y-3 bg-muted/20">
            <div className="flex items-center justify-between"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{candidates.length} matching · {allCandidates.length} loaded</span><div className="flex items-center gap-1"><button onClick={() => moveSelection(-1)} disabled={selectedIndex <= 0} className="p-1 rounded hover:bg-slate-200 disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button><span className="text-xs font-mono text-muted-foreground w-16 text-center">{selectedIndex >= 0 ? selectedIndex + 1 : 0} / {candidates.length}</span><button onClick={() => moveSelection(1)} disabled={selectedIndex >= candidates.length - 1} className="p-1 rounded hover:bg-slate-200 disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button></div></div>
            <div className="flex gap-1">{['All candidates', 'Review actions', `Final approved (${stats?.count_in_final_reform_total ?? '—'})`, `QA sample (${qaCandidateIds.size})`].map((label, index) => { const views = ['All candidates', 'Review actions', 'Final approved reforms', 'QA sample']; const value = views[index]; return <button key={value} onClick={() => setView(value)} className={cn('flex-1 rounded px-2 py-1.5 text-[10px] font-medium border', view === value ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 hover:bg-slate-50')}>{label}</button>; })}</div>
            <div className="relative"><Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" /><Input aria-label="Search candidates" placeholder="Search IDs, action text, evidence…" className="pl-8 h-9 text-xs" value={search} onChange={e => setSearch(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-2">
              <FilterSelect label="Country" value={filters.country} options={countryOptions.map(([code, name]) => [code, name] as const)} onChange={v => setFilters({ ...filters, country: v })} />
              <FilterSelect label="Stream" value={filters.stream} options={STREAMS.map(s => [s, s] as const)} onChange={v => setFilters({ ...filters, stream: v })} />
            </div>
            {showFilters && <div className="grid grid-cols-2 gap-2 pt-2 border-t">
              <FilterSelect label="Pillar" value={filters.pillar} options={distinct(['primary_pillar', 'water_security_pillar', 'Primary_Pillar']).map(x => [x, x] as const)} onChange={v => setFilters({ ...filters, pillar: v })} />
              <FilterSelect label="Tier 1" value={filters.tier1} options={distinct(['primary_tier1_reform_domain', 'reform_domain_tier_1', 'reform_type_tier_1', 'Primary_Tier1_Reform_Domain']).map(x => [x, x] as const)} onChange={v => setFilters({ ...filters, tier1: v, tier2: 'All' })} />
              <FilterSelect label="Tier 2" value={filters.tier2} options={distinct(['tier2_reform_category', 'reform_domain_tier_2', 'reform_type_tier_2', 'Tier2_Reform_Category']).filter(x => filters.tier1 === 'All' || allCandidates.some(c => val(c, 'primary_tier1_reform_domain', 'reform_domain_tier_1', 'reform_type_tier_1', 'Primary_Tier1_Reform_Domain') === filters.tier1 && val(c, 'tier2_reform_category', 'reform_domain_tier_2', 'reform_type_tier_2', 'Tier2_Reform_Category') === x)).map(x => [x, x] as const)} onChange={v => setFilters({ ...filters, tier2: v })} />
              <FilterSelect label="Solution" value={filters.solution} options={allCandidates.flatMap(c => [val(c, 'primary_scalable_solution', 'Primary_Scalable_Solution'), ...tagValues(val(c, 'additional_scalable_solutions', 'Additional_Scalable_Solutions'))]).map(s => String(s).trim()).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).sort().map(x => [x, x] as const)} onChange={v => setFilters({ ...filters, solution: v })} />
              <FilterSelect label="Cluster role" value={filters.cluster} options={distinct(['cluster_role', 'Cluster_Role']).map(x => [x, x] as const)} onChange={v => setFilters({ ...filters, cluster: v })} />
              <FilterSelect label="C1–C6 failure" value={filters.criterion} options={CRITERIA.map(([k]) => [k, `${k} failed`] as const)} onChange={v => setFilters({ ...filters, criterion: v })} />
              <FilterSelect label="Global decision" value={filters.global} options={['Pending', ...GLOBAL_DECISIONS].map(x => [x, x] as const)} onChange={v => setFilters({ ...filters, global: v })} />
              <FilterSelect label="Regional decision" value={filters.regional} options={REGIONAL_DECISIONS.map(x => [x, x] as const)} onChange={v => setFilters({ ...filters, regional: v })} />
              <FilterSelect label="Final status" value={filters.final} options={FINAL_STATUSES.map(x => [x, x] as const)} onChange={v => setFilters({ ...filters, final: v })} />
              <FilterSelect label="Unresolved issue" value={filters.issue} options={ [['Yes', 'Has issue'], ['No', 'No issue']] as const } onChange={v => setFilters({ ...filters, issue: v })} />
            </div>}
            <button onClick={() => setShowFilters(!showFilters)} className="w-full text-center text-[10px] uppercase font-bold text-muted-foreground flex items-center justify-center gap-1 hover:text-primary"><Filter className="w-3 h-3" />{showFilters ? 'Hide filters' : 'More filters'}</button>
          </div>
          <ScrollArea className="flex-1"><div className="flex flex-col">
            {loading ? <div className="p-4 text-sm text-muted-foreground text-center">Loading candidates…</div> : candidates.length === 0 ? <div className="p-4 text-sm text-muted-foreground text-center">No matching candidates</div> : candidates.map(c => {
              const id = getCandidateId(c); const isSelected = id === selectedId; const stream = getStream(c);
              const issues = Boolean(val(c, 'has_unresolved_issue', 'unresolved_issue_count'));
              return <button key={id} data-testid={`candidate-${id}`} onClick={() => selectCandidate(id)} className={cn('w-full text-left p-3 border-b border-border transition-colors hover:bg-slate-50', isSelected ? 'bg-slate-100 border-l-2 border-l-primary' : 'border-l-2 border-l-transparent')}>
                <div className="flex justify-between items-start mb-1.5"><div className="flex items-center gap-1.5"><span className="font-mono text-xs font-semibold text-slate-700">{id}</span><Badge variant="outline" className="text-[10px] px-1 h-4">{countryCode(c)}</Badge>{issues && <AlertTriangle className="w-3 h-3 text-amber-500" />}</div><Badge variant="outline" className={cn('text-[9px] px-1 h-auto max-w-36 text-right', streamClass(stream))}>{stream || 'Stream unavailable'}</Badge></div>
                <p className="text-xs text-foreground line-clamp-2 leading-relaxed mb-2 font-medium">{titleOf(c) || <><span className="text-slate-400 italic">Source excerpt · </span>{sourceExcerpt(c) || 'No action statement or excerpt available'}</>}</p>
                <div className="flex gap-2 items-center"><Badge variant="secondary" className="text-[9px] px-1 h-3.5">{val(c, 'final_status', 'Final_Status') || 'Pending'}</Badge>{criteriaPass(c) && <span className="text-[9px] text-emerald-700">6/6 criteria</span>}</div>
              </button>;
            })}
          </div></ScrollArea>
        </Panel>
        <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize" />
        <Panel defaultSize={45} minSize={30} className="flex flex-col bg-slate-100 relative">
          {activeEvidence ? <><div className="flex-none p-2 border-b bg-white flex items-center overflow-x-auto gap-2 shadow-sm z-10"><span className="text-xs font-semibold text-muted-foreground uppercase ml-1 mr-2">Evidence</span>{evidence.map((e: AnyRecord) => { const eid = String(val(e, 'evidence_id', 'Evidence_ID', 'anchor_id', 'id')); return <button key={eid} onClick={() => setActiveEvidenceId(eid)} className={cn('px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap border', eid === activeEvidenceId ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50')}>{val(e, 'link_role', 'evidence_role', 'Evidence_Role', 'anchor_role', 'role') || 'Source evidence'} · p.{val(e, 'pdf_page', 'PDF_Page', 'page_number', 'matched_page') || '—'}</button>; })}</div>
               <div className="flex-1 min-h-0 relative overflow-hidden flex flex-col">{document && activeEvidence ? <PdfViewer key={`${docId}-${activeEvidenceId}`} documentId={docId} documentSha256={val(document, 'sha256', 'SHA256', 'document_sha256')} matchedPage={Number(val(activeEvidence, 'pdf_page', 'PDF_Page', 'page_number', 'matched_page') || 1)} pageRotation={evidenceRotation(activeEvidence)} rectangles={val(activeEvidence, 'rectangles', 'evidence_rectangles') || []} anchorRole={val(activeEvidence, 'link_role', 'evidence_role', 'Evidence_Role', 'anchor_role', 'role')} /> : <div className="flex-1 flex items-center justify-center text-sm text-slate-500">{docId ? 'Loading source document…' : 'Document unavailable for this passage'}</div>}
              <div className="flex-none bg-white border-t p-4 max-h-[30vh] overflow-y-auto"><div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Source passage · {text(val(activeEvidence, 'location_status', 'Location_Status'))}</div><blockquote className="text-sm font-serif italic text-slate-700 border-l-4 border-amber-300 pl-4 py-1 leading-relaxed">{text(evidenceOriginal(activeEvidence))}</blockquote>{evidenceEnglish(activeEvidence) && evidenceEnglish(activeEvidence) !== evidenceOriginal(activeEvidence) && <p className="text-xs mt-3 text-slate-600"><b>English translation:</b> {evidenceEnglish(activeEvidence)}</p>}</div>
            </div></> : <div className="flex-1 flex items-center justify-center text-slate-400 text-sm bg-slate-50"><div className="text-center"><FileText className="w-12 h-12 mx-auto mb-3 opacity-20" /><p>No linked source passage is available.</p></div></div>}
        </Panel>
        <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize" />
        <Panel defaultSize={30} minSize={25} className="flex flex-col bg-card">
          {detailLoading ? <div className="p-6 text-center text-sm text-muted-foreground">Loading details…</div> : detail ? <>
            <div className="flex-none p-4 border-b bg-slate-50/50"><div className="flex items-center gap-2 mb-2"><span className="text-lg font-mono font-bold">{getCandidateId(detail)}</span><Badge variant="outline">{countryCode(detail)} · {countryFullName(detail)}</Badge><Badge variant="outline" className={streamClass(getStream(detail))}>{getStream(detail)}</Badge></div><h2 className="text-sm font-semibold leading-snug">{titleOf(detail) || <><span className="text-[10px] uppercase text-slate-500">Source excerpt · </span>{text(sourceExcerpt(detail))}</>}</h2><div className="text-[10px] text-muted-foreground mt-1">Baseline stream: {text(getBaselineStream(detail))} · Effective stream: {text(getStream(detail))}</div></div>
            <div className="flex border-b bg-white overflow-x-auto">{['Action', 'Evidence', 'Assessment', 'Relationships', 'Review history'].map(t => <button key={t} onClick={() => setTab(t)} className={cn('px-3 py-2 text-[10px] font-semibold whitespace-nowrap border-b-2', tab === t ? 'border-primary text-primary' : 'border-transparent text-slate-500')}>{t}</button>)}</div>
            <ScrollArea className="flex-1 p-4"><div className="space-y-5 pb-8">
              {tab === 'Action' && <>
                <section><SectionTitle>Action statement</SectionTitle>
                  <Field label="English action statement" value={val(detail, 'reform_action_statement_english', 'Reform_Action_Statement_English')} />
                  <Field label="Original-language action" value={val(detail, 'reform_action_text_original_language', 'reform_action_statement_original', 'Reform_Action_Text_Original_Language', 'original_compact_text')} />
                  <Field label="Source language" value={val(detail, 'source_language', 'Source_Language')} />
                </section>
                <section><SectionTitle>Classification</SectionTitle>
                  <Field label="Pillar" value={val(detail, 'primary_pillar', 'Primary_Pillar', 'water_security_pillar')} />
                  <Field label="Primary domain" value={val(detail, 'primary_tier1_reform_domain', 'primary_domain_tier_1', 'reform_domain_tier_1', 'Primary_Tier1_Reform_Domain')} />
                  <Field label="Tier 2 category" value={val(detail, 'tier2_reform_category', 'reform_domain_tier_2', 'Tier2_Reform_Category')} />
                  <Field label="Secondary domains" value={arrayText(val(detail, 'secondary_reform_domain_tags', 'additional_domain_tags', 'secondary_domains', 'Secondary_Reform_Domain_Tags'))} />
                  <Field label="Scalable solutions" value={arrayText([val(detail, 'primary_scalable_solution', 'Primary_Scalable_Solution'), ...tagValues(val(detail, 'additional_scalable_solutions', 'Additional_Scalable_Solutions'))])} />
                </section>
                {datasetId && <ReviewDecisionForm key={`${getCandidateId(detail)}-${reviewer?.reviewer_id || 'guest'}`} candidateId={String(getCandidateId(detail))} revision={Number(val(detail, 'assessment_revision', 'current_assessment_revision'))} reviewer={reviewer} reviews={reviews} onSelectReviewer={() => setShowReviewerModal(true)} onSaved={() => refreshAfterReview(String(getCandidateId(detail)))} />}
                <section><SectionTitle>Stage status · not configured</SectionTitle>
                  <p className="text-xs text-slate-600">Reviewer names are prototype attribution only, not verified identity. Stage assignments and verified permission enforcement are not configured; no authoritative Global or Regional decision can be submitted here.</p>
                  <div className="grid grid-cols-2 gap-2 mt-2"><Field label="Global decision" value={currentDecision} /><Field label="Regional confirmation" value={regionalDecision} /></div>
                  <Field label="Final status" value={val(detail, 'final_status', 'Final_Status') || 'Pending'} />
                  <Field label="Server-derived final reform total" value={countInFinalTotal(detail) ? 'Included' : 'Not included'} />
                </section>
              </>}
              {tab === 'Evidence' && <><SectionTitle>Linked source passages ({evidence.length})</SectionTitle>{evidence.map((e: AnyRecord) => { const evidenceId = String(val(e, 'evidence_id', 'Evidence_ID', 'anchor_id', 'id')); return <button key={evidenceId} onClick={() => setActiveEvidenceId(evidenceId)} className={cn('w-full text-left rounded border p-3 space-y-2 hover:bg-slate-50', evidenceId === activeEvidenceId && 'border-primary bg-slate-50')}><div className="flex justify-between gap-2"><b className="text-xs">{val(e, 'link_role', 'evidence_role', 'Evidence_Role', 'role') || 'Evidence'}</b><span className="text-[10px] text-slate-500">{val(e, 'document_id', 'Document_ID')} · PDF p.{val(e, 'pdf_page', 'PDF_Page', 'page_number', 'matched_page')}</span></div><p className="text-xs italic">{text(evidenceOriginal(e))}</p>{evidenceEnglish(e) && evidenceEnglish(e) !== evidenceOriginal(e) && <p className="text-xs text-slate-600"><b>English translation:</b> {evidenceEnglish(e)}</p>}<p className="text-[10px] text-amber-800">Location status: {text(val(e, 'location_status', 'Location_Status'))}</p></button>; })}</>}
              {tab === 'Assessment' && <>
                <SectionTitle>Six binary criteria</SectionTitle>
                <p className="text-[10px] text-slate-500 mb-2">0 means the criterion is not established by the current evidence; it is not necessarily a claim that the real-world condition is false.</p>
                {CRITERIA.map(([key, definition], index) => {
                  const answer = getCriterion(detail, index + 1);
                  return <div key={key} className="flex items-start gap-2 border-b py-2">
                    <span className={cn('font-mono text-xs font-bold w-7', answer ? 'text-emerald-700' : 'text-slate-500')}>{key}: {answer === null ? '—' : answer ? '1' : '0'}</span>
                    <div><p className="text-xs font-medium">{definition}</p><p className="text-[10px] text-slate-500">{val(detail, `c${index + 1}_rationale`, `criterion_${index + 1}_rationale`, `C${index + 1}_Rationale`) || 'No separate criterion note supplied.'}</p></div>
                  </div>;
                })}
                <div className="mt-3 p-3 bg-slate-50 rounded text-xs font-semibold">Six-criteria result: {criteriaPass(detail) ? <span className="text-emerald-700">Pass (6/6)</span> : <span>Not passed / not established</span>}</div>
                <div className="mt-3"><Field label="Initial assessment rationale" value={val(detail, 'llm_decision_rationale', 'decision_rationale', 'rationale', 'LLM_Decision_Rationale')} /></div>
                <Field label="Server-derived final reform total" value={countInFinalTotal(detail) ? 'Included' : 'Not included'} />
                <Field label="Assessment revision" value={val(detail, 'assessment_revision', 'current_assessment_revision', 'Assessment_Revision') || '1'} />
                <SectionTitle>QA checks ({candidateQaChecks.length})</SectionTitle>
                {candidateQaChecks.length ? candidateQaChecks.map((check, index) => <div key={val(check, 'qa_check_id', 'id') || index} className="mb-2 rounded border p-3"><div className="flex justify-between gap-2"><b className="text-xs">{val(check, 'check_name', 'name') || 'QA check'}</b><Badge variant="outline">{val(check, 'status') || 'Status unavailable'}</Badge></div>{val(check, 'detail') && <p className="mt-1 text-xs text-slate-600">{val(check, 'detail')}</p>}</div>) : <p className="text-xs text-slate-500">{qaError || (datasetId ? 'No QA checks returned for this candidate.' : 'QA checks are unavailable for the legacy dataset.')}</p>}
              </>}
              {tab === 'Relationships' && <><SectionTitle>Parent and related candidates</SectionTitle><div className="mb-3"><label className="text-[10px] font-semibold uppercase text-slate-500 block mb-1">Parent reform action</label>{val(detail, 'parent_reform_action_id', 'Parent_Reform_Action_ID') ? <button onClick={() => selectCandidate(val(detail, 'parent_reform_action_id', 'Parent_Reform_Action_ID'))} className="text-xs font-mono text-primary underline">{val(detail, 'parent_reform_action_id', 'Parent_Reform_Action_ID')}</button> : <p className="text-xs">Not provided</p>}</div>{relationships.map(r => { const other = val(r, 'target_candidate_id') === getCandidateId(detail) ? val(r, 'source_candidate_id') : val(r, 'target_candidate_id'); return <button key={val(r, 'relationship_id')} onClick={() => selectCandidate(other)} className="w-full p-3 border rounded text-left hover:bg-slate-50"><span className="text-xs font-mono font-bold text-primary underline">{other}</span><span className="block text-[10px] text-slate-500 mt-1">{val(r, 'relationship_type', 'Relationship_Type')} · {val(r, 'relationship_status', 'Relationship_Status')}</span><span className="block text-xs mt-1">{val(r, 'rationale', 'relationship_note', 'Rationale')}</span></button>; })}{!relationships.length && <p className="text-xs text-slate-500">No related candidates returned.</p>}</>}
              {tab === 'Review history' && <>
                <SectionTitle>Review history · {reviews.length}</SectionTitle>
                <div className="rounded bg-amber-50 border border-amber-200 p-3 text-[11px] text-amber-900">Identity selection is not identity verification. This UI does not expose or imply authorized stage permissions.</div>
                {reviews.length
                  ? reviews.map((r: AnyRecord, index: number) => <ReviewEventCard key={val(r, 'event_id', 'review_event_id', 'review_id') || index} review={r} />)
                  : <p className="text-xs text-slate-500">No review events recorded.</p>}
              </>}
            </div></ScrollArea>
          </> : <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">{detailLoading ? 'Loading details…' : 'Select a candidate'}</div>}
        </Panel>
      </PanelGroup>
    </div>
  </div>;
}

function ReviewEventCard({ review }: { review: AnyRecord }) {
  const rawDecision = String(val(review, 'decision', 'inclusion_decision') || 'Decision unavailable');
  const style = reviewDecisionStyle(rawDecision);
  const reviewerName = val(review, 'reviewer_name', 'display_name') ||
    (val(review, 'reviewer_id') ? `Reviewer ID ${val(review, 'reviewer_id')}` : 'Reviewer identity unavailable');
  const stage = val(review, 'stage', 'review_stage') || 'Legacy review';
  const comment = val(review, 'comment', 'reviewer_comment');
  const timestamp = val(review, 'created_at', 'created_at_utc', 'occurred_at');
  const revision = val(review, 'assessment_revision', 'revision') || 'unknown';

  return <article aria-label={`${style.label} review from ${reviewerName}`} className={`mb-2 rounded border border-l-4 p-3 space-y-2 ${style.card}`}>
    <div className="flex items-start justify-between gap-3">
      <div>
        <b className="text-xs text-slate-800">{reviewerName}</b>
        <p className="mt-0.5 text-[10px] text-slate-500">{stage} · revision {revision}</p>
      </div>
      <Badge variant="outline" className={`shrink-0 text-[10px] font-semibold ${style.badge}`}>{style.label}</Badge>
    </div>
    <p className="whitespace-pre-wrap break-words text-xs text-slate-600">{comment || 'No comment'}</p>
    <p className="text-[10px] text-slate-400">{timestamp || 'Timestamp unavailable'}</p>
  </article>;
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: ReadonlyArray<readonly [string, string]>; onChange: (value: string) => void }) {
  return <select aria-label={label} value={value} onChange={e => onChange(e.target.value)} className="h-8 min-w-0 w-full rounded-md border border-input bg-background px-2 text-[10px] text-foreground">
    <option value="All">All {label}</option>{options.map(([v, name]) => <option key={v} value={v}>{name}</option>)}
  </select>;
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 border-b pb-1 mb-3">{children}</h3>;
}

function Field({ label, value }: { label: string; value: unknown }) {
  return <div className="mb-3"><label className="text-[10px] font-semibold uppercase text-slate-500 block mb-1">{label}</label><div className="text-xs leading-relaxed whitespace-pre-wrap text-slate-800">{text(value)}</div></div>;
}