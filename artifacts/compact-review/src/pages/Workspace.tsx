import { useEffect, useState, useCallback } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import {
  useListCandidates,
  useGetCandidate,
  useGetDocument,
  useGetStats,
  useListRelationships,
} from '@workspace/api-client-react';
import { PdfViewer } from '@/components/PdfViewer';
import { ReviewerModal } from '@/components/ReviewerModal';
import { useReviewer } from '@/hooks/use-reviewer';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useLocation, useSearch } from 'wouter';
import {
  ExternalLink, Search, ChevronLeft, ChevronRight, FileText, FileSignature,
  CheckCircle2, AlertTriangle, Filter, User, Users, Download,
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface CandidateReviewItem {
  review_id: number;
  candidate_id: string;
  reviewer_id: string;
  reviewer_name: string;
  inclusion_decision: string;
  comment: string | null;
  created_at: string;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function getDecisionBadgeClass(decision: string): string {
  switch (decision) {
    case 'Accept': return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    case 'Reject': return 'bg-red-100 text-red-800 border-red-200';
    case 'Needs Discussion': return 'bg-amber-100 text-amber-800 border-amber-200';
    default: return 'bg-slate-100 text-slate-700 border-slate-200';
  }
}

export default function Workspace() {
  const [location, setLocation] = useLocation();
  const searchParams = new URLSearchParams(useSearch());

  const selectedCandidateId = searchParams.get('id') || null;
  const [activeAnchorId, setActiveAnchorId] = useState<string | null>(null);

  // Reviewer identity
  const { reviewer, login, logout } = useReviewer();
  const [showReviewerModal, setShowReviewerModal] = useState(!reviewer);

  // Review state
  const [candidateReviews, setCandidateReviews] = useState<CandidateReviewItem[]>([]);
  const [reviewsConflict, setReviewsConflict] = useState(false);
  const [myDecision, setMyDecision] = useState('');
  const [myRationale, setMyRationale] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // Filters State
  const [filters, setFilters] = useState({
    country: 'All',
    stream: 'All',
    inclusion_decision: 'All',
    confidence_level: 'All',
    anchor_confidence: 'All',
    reform_aspiration_status: 'All',
    reform_type_tier_1: 'All',
    human_review_status: 'All',
    search: '',
  });

  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(filters.search), 300);
    return () => clearTimeout(t);
  }, [filters.search]);

  // Query Params for API
  const queryParams = {
    ...(filters.country !== 'All' && { country: filters.country }),
    ...(filters.stream !== 'All' && { stream: filters.stream }),
    ...(filters.inclusion_decision !== 'All' && { inclusion_decision: filters.inclusion_decision }),
    ...(filters.confidence_level !== 'All' && { confidence_level: filters.confidence_level }),
    ...(filters.anchor_confidence !== 'All' && { anchor_confidence: filters.anchor_confidence }),
    ...(filters.reform_aspiration_status !== 'All' && { reform_aspiration_status: filters.reform_aspiration_status }),
    ...(filters.reform_type_tier_1 !== 'All' && { reform_type_tier_1: filters.reform_type_tier_1 }),
    ...(filters.human_review_status !== 'All' && { human_review_status: filters.human_review_status }),
    ...(debouncedSearch && { search: debouncedSearch }),
    limit: 500,
  };

  // Queries
  const { data: stats } = useGetStats({ query: { queryKey: ['/api/stats'] } });
  const { data: candidatesData, isLoading: candidatesLoading } = useListCandidates(queryParams, {
    query: { queryKey: ['/api/candidates', queryParams] }
  });

  const { data: candidateDetail, isLoading: detailLoading } = useGetCandidate(
    selectedCandidateId || '',
    { query: { enabled: !!selectedCandidateId, queryKey: ['/api/candidates', selectedCandidateId] } }
  );

  const { data: relationships } = useListRelationships(
    { candidateId: selectedCandidateId || undefined },
    { query: { enabled: !!selectedCandidateId, queryKey: ['/api/relationships', selectedCandidateId] } }
  );

  const candidates = candidatesData?.candidates || [];

  // Auto-select first item on load if none selected
  useEffect(() => {
    if (!selectedCandidateId && candidates.length > 0) {
      const url = new URL(window.location.href);
      url.searchParams.set('id', candidates[0].candidate_id);
      setLocation(`${location}?${url.searchParams.toString()}`);
    }
  }, [candidates, selectedCandidateId, location, setLocation]);

  // Set active anchor when candidate changes
  useEffect(() => {
    if (candidateDetail?.anchors?.length) {
      const primary = candidateDetail.anchors.find(a => a.anchor_role === 'Primary Evidence');
      setActiveAnchorId(primary?.anchor_id || candidateDetail.anchors[0].anchor_id);
    } else {
      setActiveAnchorId(null);
    }
  }, [candidateDetail]);

  // Fetch reviews when candidate or reviewer changes
  const fetchReviews = useCallback(async (candidateId: string) => {
    try {
      const data = await fetch(`/api/candidates/${candidateId}/reviews`).then(r => r.json()) as {
        reviews: CandidateReviewItem[];
        has_conflict: boolean;
      };
      setCandidateReviews(data.reviews || []);
      setReviewsConflict(data.has_conflict);
      // Pre-fill with my latest decision
      if (reviewer) {
        const myReview = (data.reviews || []).find(r => r.reviewer_id === reviewer.reviewer_id);
        if (myReview) {
          setMyDecision(myReview.inclusion_decision);
          setMyRationale(myReview.comment || '');
        } else {
          setMyDecision('');
          setMyRationale('');
        }
      }
    } catch (err) {
      console.error('Failed to fetch reviews:', err);
    }
  }, [reviewer]);

  useEffect(() => {
    if (!selectedCandidateId) return;
    setCandidateReviews([]);
    setReviewsConflict(false);
    setMyDecision('');
    setMyRationale('');
    setSubmitSuccess(false);
    fetchReviews(selectedCandidateId);
  }, [selectedCandidateId, fetchReviews]);

  const submitReview = async () => {
    if (!myDecision || !reviewer || !selectedCandidateId || submitting) return;
    setSubmitting(true);
    setSubmitSuccess(false);
    try {
      const resp = await fetch(`/api/candidates/${selectedCandidateId}/reviews`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${reviewer.token}`,
        },
        body: JSON.stringify({
          inclusion_decision: myDecision,
          comment: myRationale.trim() || null,
        }),
      });
      if (!resp.ok) throw new Error('Failed to submit review');
      setSubmitSuccess(true);
      await fetchReviews(selectedCandidateId);
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const activeAnchor = candidateDetail?.anchors?.find(a => a.anchor_id === activeAnchorId);

  // Document query for active anchor
  const { data: document } = useGetDocument(
    activeAnchor?.document_id || '',
    { query: { enabled: !!activeAnchor?.document_id, queryKey: ['/api/documents', activeAnchor?.document_id] } }
  );

  // Candidate Navigation
  const selectedIndex = candidates.findIndex(c => c.candidate_id === selectedCandidateId);
  const handleNext = () => {
    if (selectedIndex < candidates.length - 1) {
      const nextId = candidates[selectedIndex + 1].candidate_id;
      const url = new URL(window.location.href);
      url.searchParams.set('id', nextId);
      setLocation(`${location}?${url.searchParams.toString()}`);
    }
  };
  const handlePrev = () => {
    if (selectedIndex > 0) {
      const prevId = candidates[selectedIndex - 1].candidate_id;
      const url = new URL(window.location.href);
      url.searchParams.set('id', prevId);
      setLocation(`${location}?${url.searchParams.toString()}`);
    }
  };

  const getStreamColor = (stream: string) => {
    if (stream.startsWith('A')) return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    if (stream.startsWith('B')) return 'bg-amber-100 text-amber-800 border-amber-200';
    if (stream.startsWith('C')) return 'bg-slate-100 text-slate-800 border-slate-200';
    return 'bg-gray-100 text-gray-800';
  };

  const reviewedCount = candidates.filter(c => (c as any).review_count > 0).length;

  // Build the CSV export URL from the current active filters (no limit/page).
  const exportCsv = () => {
    const p = new URLSearchParams();
    if (filters.country !== 'All') p.set('country', filters.country);
    if (filters.stream !== 'All') p.set('stream', filters.stream);
    if (filters.inclusion_decision !== 'All') p.set('inclusion_decision', filters.inclusion_decision);
    if (filters.confidence_level !== 'All') p.set('confidence_level', filters.confidence_level);
    if (filters.anchor_confidence !== 'All') p.set('anchor_confidence', filters.anchor_confidence);
    if (filters.reform_aspiration_status !== 'All') p.set('reform_aspiration_status', filters.reform_aspiration_status);
    if (filters.reform_type_tier_1 !== 'All') p.set('reform_type_tier_1', filters.reform_type_tier_1);
    if (filters.human_review_status !== 'All') p.set('human_review_status', filters.human_review_status);
    if (debouncedSearch) p.set('search', debouncedSearch);
    const qs = p.toString();
    window.open(`/api/export/decisions.csv${qs ? `?${qs}` : ''}`, '_blank');
  };

  return (
    <div className="flex flex-col h-[100dvh] w-full bg-background overflow-hidden font-sans">
      {/* Reviewer Modal */}
      {showReviewerModal && (
        <ReviewerModal
          onLogin={(identity) => {
            login(identity);
            setShowReviewerModal(false);
          }}
        />
      )}

      {/* Header */}
      <header className="flex-none h-12 border-b bg-card flex items-center justify-between px-4 gap-3">
        <div className="flex items-center gap-3 flex-none">
          <FileSignature className="w-5 h-5 text-primary" />
          <h1 className="font-semibold text-sm">Water Compact Review</h1>
          <Badge variant="secondary" className="text-[10px] uppercase font-mono px-1.5 py-0">Prototype</Badge>
        </div>

        <div className="text-xs text-muted-foreground font-mono hidden md:block">
          {stats
            ? `${stats.total_candidates} candidates · ${stats.total_anchors} anchors · ${stats.total_documents} documents${reviewedCount > 0 ? ` · ${reviewedCount} reviewed` : ''}`
            : 'Loading…'}
        </div>

        <div className="flex items-center gap-4 flex-none">
          {/* Export CSV button */}
          <button
            onClick={exportCsv}
            title="Download all reviewer decisions as CSV"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-md px-2.5 py-1 hover:bg-slate-50 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Export CSV</span>
          </button>

          {/* Reviewer chip */}
          {reviewer ? (
            <div className="flex items-center gap-1.5 text-xs border border-border rounded-full px-2.5 py-1 bg-slate-50">
              <User className="w-3.5 h-3.5 text-slate-500" />
              <span className="font-medium text-slate-700 max-w-[120px] truncate">{reviewer.display_name}</span>
              <button
                onClick={() => { logout(); setShowReviewerModal(true); }}
                className="text-slate-400 hover:text-slate-600 ml-0.5 text-[10px] underline underline-offset-1"
              >
                Switch
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowReviewerModal(true)}
              className="text-xs text-primary hover:underline font-medium flex items-center gap-1"
            >
              <User className="w-3.5 h-3.5" />
              Sign in to review
            </button>
          )}

          <div className="flex gap-4 text-xs font-medium">
            <a href="#" className="flex items-center gap-1 hover:text-primary transition-colors text-muted-foreground">
              Cambodia <ExternalLink className="w-3 h-3" />
            </a>
            <a href="#" className="flex items-center gap-1 hover:text-primary transition-colors text-muted-foreground">
              Sierra Leone <ExternalLink className="w-3 h-3" />
            </a>
            <a href="#" className="flex items-center gap-1 hover:text-primary transition-colors text-muted-foreground">
              Jamaica <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <div className="flex-1 h-[calc(100vh-3rem)]">
        <PanelGroup direction="horizontal">

          {/* Left Panel: List */}
          <Panel defaultSize={25} minSize={20} maxSize={35} className="flex flex-col bg-card relative">
            <div className="flex-none p-3 border-b border-border space-y-3 bg-muted/20">

              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Showing {candidates.length} of {stats?.total_candidates || '?'}
                </span>
                <div className="flex gap-1 items-center">
                  <button onClick={handlePrev} disabled={selectedIndex <= 0} className="p-1 rounded hover:bg-slate-200 disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
                  <span className="text-xs font-mono text-muted-foreground w-16 text-center">
                    {candidates.length > 0 ? selectedIndex + 1 : 0} / {candidates.length}
                  </span>
                  <button onClick={handleNext} disabled={selectedIndex >= candidates.length - 1} className="p-1 rounded hover:bg-slate-200 disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
                </div>
              </div>

              <div className="relative">
                <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input
                  placeholder="Search actions, IDs..."
                  className="pl-8 h-9 text-xs"
                  value={filters.search}
                  onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Select value={filters.country} onValueChange={(v) => setFilters({ ...filters, country: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Country" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All Countries</SelectItem>
                    <SelectItem value="Cambodia">Cambodia</SelectItem>
                    <SelectItem value="Sierra Leone">Sierra Leone</SelectItem>
                    <SelectItem value="Jamaica">Jamaica</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={filters.stream} onValueChange={(v) => setFilters({ ...filters, stream: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Stream" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All Streams</SelectItem>
                    <SelectItem value="A">Stream A</SelectItem>
                    <SelectItem value="B">Stream B</SelectItem>
                    <SelectItem value="C">Stream C</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={filters.inclusion_decision} onValueChange={(v) => setFilters({ ...filters, inclusion_decision: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Inclusion" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All Decisions</SelectItem>
                    <SelectItem value="Provisionally Included">Provisionally Included</SelectItem>
                    <SelectItem value="Excluded by LLM">Excluded by LLM</SelectItem>
                    <SelectItem value="Consolidated">Consolidated</SelectItem>
                    <SelectItem value="Pending Human Review">Pending Human Review</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={filters.confidence_level} onValueChange={(v) => setFilters({ ...filters, confidence_level: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Confidence" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All Conf.</SelectItem>
                    <SelectItem value="High">High</SelectItem>
                    <SelectItem value="Medium">Medium</SelectItem>
                    <SelectItem value="Low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {showAdvancedFilters && (
                <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-border">
                  <Select value={filters.anchor_confidence} onValueChange={(v) => setFilters({ ...filters, anchor_confidence: v })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Anchor Conf" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="All">All Anchor Conf</SelectItem>
                      <SelectItem value="High">High</SelectItem>
                      <SelectItem value="Medium">Medium</SelectItem>
                      <SelectItem value="Low">Low</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={filters.human_review_status} onValueChange={(v) => setFilters({ ...filters, human_review_status: v })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Review Status" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="All">All Review Status</SelectItem>
                      <SelectItem value="Pending human review">Pending Human Review</SelectItem>
                      <SelectItem value="Reviewed">Reviewed</SelectItem>
                      <SelectItem value="Needs Revision">Needs Revision</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={filters.reform_aspiration_status} onValueChange={(v) => setFilters({ ...filters, reform_aspiration_status: v })}>
                    <SelectTrigger className="h-8 text-xs col-span-2"><SelectValue placeholder="Aspiration Status" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="All">All Aspiration Statuses</SelectItem>
                      <SelectItem value="Is an aspiration">Is an aspiration</SelectItem>
                      <SelectItem value="Not an aspiration">Not an aspiration</SelectItem>
                      <SelectItem value="Has explicit mechanism">Has explicit mechanism</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={filters.reform_type_tier_1} onValueChange={(v) => setFilters({ ...filters, reform_type_tier_1: v })}>
                    <SelectTrigger className="h-8 text-xs col-span-2"><SelectValue placeholder="Tier 1 Reform Type" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="All">All Tier 1 Types</SelectItem>
                      <SelectItem value="Governance">Governance</SelectItem>
                      <SelectItem value="Infrastructure">Infrastructure</SelectItem>
                      <SelectItem value="Financing">Financing</SelectItem>
                      <SelectItem value="Policy">Policy</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              <button
                onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                className="w-full text-center text-[10px] uppercase font-bold text-muted-foreground flex items-center justify-center gap-1 hover:text-primary transition-colors"
              >
                <Filter className="w-3 h-3" />
                {showAdvancedFilters ? 'Hide Advanced Filters' : 'Show Advanced Filters'}
              </button>
            </div>

            <ScrollArea className="flex-1">
              <div className="flex flex-col">
                {candidatesLoading ? (
                  <div className="p-4 text-sm text-muted-foreground text-center">Loading candidates…</div>
                ) : candidates.length === 0 ? (
                  <div className="p-4 text-sm text-muted-foreground text-center">No matching candidates</div>
                ) : (
                  candidates.map((c) => {
                    const isSelected = c.candidate_id === selectedCandidateId;
                    const hasConflict = (c as any).has_conflict === true;
                    const reviewCount = (c as any).review_count ?? 0;
                    return (
                      <div
                        key={c.candidate_id}
                        onClick={() => {
                          const url = new URL(window.location.href);
                          url.searchParams.set('id', c.candidate_id);
                          setLocation(`${location}?${url.searchParams.toString()}`);
                        }}
                        className={cn(
                          "p-3 border-b border-border cursor-pointer transition-colors hover:bg-slate-50 group",
                          isSelected ? "bg-slate-100 border-l-2 border-l-primary" : "border-l-2 border-l-transparent"
                        )}
                      >
                        <div className="flex justify-between items-start mb-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-xs font-semibold text-slate-700">{c.candidate_id}</span>
                            <Badge variant="outline" className="text-[10px] px-1 h-4">{c.country.substring(0, 3).toUpperCase()}</Badge>
                            {hasConflict && (
                              <AlertTriangle className="w-3 h-3 text-amber-500" aria-label="Reviewers disagree" />
                            )}
                            {!hasConflict && reviewCount > 0 && (
                              <CheckCircle2 className="w-3 h-3 text-emerald-500" aria-label={`${reviewCount} review(s)`} />
                            )}
                          </div>
                          <Badge variant="outline" className={cn("text-[10px] px-1 h-4 font-mono", getStreamColor(c.candidate_stream))}>
                            Str {c.candidate_stream.charAt(0)}
                          </Badge>
                        </div>
                        <p className="text-xs text-foreground line-clamp-2 leading-relaxed mb-2 font-medium">
                          {c.standardized_candidate_reform_action}
                        </p>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-[9px] px-1 h-3.5 bg-slate-200/50">
                            {c.inclusion_decision}
                          </Badge>
                          {c.confidence_level === 'High' && <span className="text-[9px] text-emerald-600 font-medium">High Conf.</span>}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </Panel>

          <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 transition-colors flex items-center justify-center cursor-col-resize z-20">
            <div className="h-6 w-0.5 bg-slate-300 rounded-full" />
          </PanelResizeHandle>

          {/* Center Panel: PDF Viewer */}
          <Panel defaultSize={45} minSize={30} className="flex flex-col bg-slate-100 relative">
            {candidateDetail && candidateDetail.anchors?.length > 0 ? (
              <>
                <div className="flex-none p-2 border-b border-border bg-white flex items-center overflow-x-auto gap-2 shadow-sm z-10">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider ml-1 mr-2">Evidence</span>
                  {candidateDetail.anchors.map(anchor => {
                    const isActive = anchor.anchor_id === activeAnchorId;
                    return (
                      <button
                        key={anchor.anchor_id}
                        onClick={() => setActiveAnchorId(anchor.anchor_id)}
                        className={cn(
                          "px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all border",
                          isActive
                            ? "bg-slate-800 text-white border-slate-800 shadow-sm"
                            : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                        )}
                      >
                        {anchor.anchor_role}
                        {anchor.matched_page && <span className="ml-1.5 opacity-60 font-mono text-[10px]">p.{anchor.matched_page}</span>}
                      </button>
                    );
                  })}
                </div>

                <div className="flex-1 relative overflow-hidden flex flex-col">
                  {document && activeAnchor ? (
                    <PdfViewer
                      documentId={document.document_id}
                      documentSha256={document.sha256}
                      matchedPage={activeAnchor.matched_page}
                      rectangles={activeAnchor.rectangles}
                      anchorRole={activeAnchor.anchor_role}
                    />
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-sm text-slate-500">
                      Loading document…
                    </div>
                  )}

                  {/* Verbatim quote block */}
                  {activeAnchor && (
                    <div className="flex-none bg-white border-t border-border p-4 max-h-[30vh] overflow-y-auto shadow-[0_-4px_15px_-3px_rgba(0,0,0,0.05)]">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Extracted Source Text</span>
                        <Badge variant="outline" className="font-mono text-[10px]">Conf: {activeAnchor.anchor_confidence}</Badge>
                      </div>
                      <blockquote className="text-sm font-serif italic text-slate-700 border-l-4 border-amber-300 pl-4 py-1 leading-relaxed">
                        "{activeAnchor.verbatim_source_text}"
                      </blockquote>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-slate-400 text-sm bg-slate-50">
                <div className="text-center">
                  <FileText className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p>No document anchors found for this candidate.</p>
                </div>
              </div>
            )}
          </Panel>

          <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 transition-colors flex items-center justify-center cursor-col-resize z-20">
            <div className="h-6 w-0.5 bg-slate-300 rounded-full" />
          </PanelResizeHandle>

          {/* Right Panel: Data Details */}
          <Panel defaultSize={30} minSize={25} className="flex flex-col bg-card">
            {detailLoading ? (
              <div className="p-6 text-center text-sm text-muted-foreground">Loading details…</div>
            ) : candidateDetail ? (
              <>
                <div className="flex-none p-5 border-b border-border bg-slate-50/50">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xl font-mono font-bold tracking-tight text-slate-900">
                      {candidateDetail.candidate_id}
                    </span>
                    <Badge variant="outline" className="bg-white">{candidateDetail.country}</Badge>
                    <Badge variant="outline" className={cn("bg-white font-mono", getStreamColor(candidateDetail.candidate_stream))}>
                      Stream {candidateDetail.candidate_stream.charAt(0)}
                    </Badge>
                    {reviewsConflict && (
                      <Badge variant="outline" className="bg-amber-50 border-amber-300 text-amber-700 text-[10px]">
                        <AlertTriangle className="w-3 h-3 mr-1" /> Conflict
                      </Badge>
                    )}
                  </div>
                  <h2 className="text-[15px] font-semibold text-slate-900 leading-snug">
                    {candidateDetail.standardized_candidate_reform_action}
                  </h2>
                </div>

                <ScrollArea className="flex-1 p-5">
                  <div className="space-y-6 pb-10">

                    {candidateDetail.final_validated_action && (
                      <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-100">
                        <div className="flex items-center gap-2 text-emerald-800 font-semibold mb-1 text-sm uppercase tracking-wide">
                          <CheckCircle2 className="w-4 h-4" /> Final Validated Action
                        </div>
                        <p className="text-sm text-emerald-900 font-medium">
                          {candidateDetail.final_validated_action}
                        </p>
                      </div>
                    )}

                    {/* ── Methodology Decisions ── */}
                    <section className="space-y-4">
                      <div className="flex items-center justify-between border-b border-border pb-1">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Methodology Decisions</h3>
                        <span className="text-[9px] text-slate-400 font-mono">LLM-GENERATED</span>
                      </div>

                      <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                        <div>
                          <label className="text-[10px] font-semibold uppercase text-slate-500 mb-1 block">Inclusion Decision</label>
                          <Badge
                            variant="secondary"
                            className={cn(
                              "text-xs px-2 py-0.5 rounded-sm w-full justify-center",
                              candidateDetail.inclusion_decision === 'Provisionally Included' && "bg-emerald-100 text-emerald-800",
                              candidateDetail.inclusion_decision === 'Excluded by LLM' && "bg-red-100 text-red-800",
                            )}
                          >
                            {candidateDetail.inclusion_decision}
                          </Badge>
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold uppercase text-slate-500 mb-1 block">Action Tag</label>
                          <Badge variant="outline" className="text-xs px-2 py-0.5 rounded-sm w-full justify-center bg-slate-50">
                            {candidateDetail.reform_action_tag}
                          </Badge>
                        </div>

                        <div className="col-span-2">
                          <label className="text-[10px] font-semibold uppercase text-slate-500 mb-1 block">Classification Confidence</label>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="font-mono text-xs">{candidateDetail.confidence_level}</Badge>
                            {candidateDetail.confidence_level === 'High' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                            {candidateDetail.confidence_level === 'Low' && <AlertTriangle className="w-4 h-4 text-amber-500" />}
                          </div>
                        </div>

                        <div className="col-span-2">
                          <label className="text-[10px] font-semibold uppercase text-slate-500 mb-1.5 block">Decision Rationale</label>
                          <div className="p-3 bg-slate-50 border border-slate-100 rounded-md text-sm text-slate-700 leading-relaxed font-serif">
                            {candidateDetail.decision_rationale}
                          </div>
                        </div>
                      </div>
                    </section>

                    {/* ── Domain & Classification ── */}
                    <section className="space-y-4">
                      <div className="flex items-center justify-between border-b border-border pb-1">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Domain & Classification</h3>
                      </div>

                      <div className="space-y-3">
                        <div>
                          <label className="text-[10px] font-semibold uppercase text-slate-500 block">Water Security Pillar</label>
                          <div className="text-sm font-medium">{candidateDetail.water_security_pillar}</div>
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold uppercase text-slate-500 block">Solution Area</label>
                          <div className="text-sm font-medium">{candidateDetail.solution_area}</div>
                        </div>
                        <div className="grid grid-cols-2 gap-4 pt-2 border-t border-dashed border-border">
                          <div>
                            <label className="text-[10px] font-semibold uppercase text-slate-500 block">Tier 1 Reform</label>
                            <div className="text-sm">{candidateDetail.reform_type_tier_1}</div>
                          </div>
                          <div>
                            <label className="text-[10px] font-semibold uppercase text-slate-500 block">Tier 2 Reform</label>
                            <div className="text-sm">{candidateDetail.reform_type_tier_2}</div>
                          </div>
                        </div>
                        <div className="pt-2 border-t border-dashed border-border">
                          <label className="text-[10px] font-semibold uppercase text-slate-500 block">Responsible Entity</label>
                          <div className="text-sm">{candidateDetail.responsible_entity}</div>
                        </div>
                      </div>
                    </section>

                    {/* ── Aspiration & Assessment ── */}
                    <section className="space-y-4">
                      <div className="flex items-center justify-between border-b border-border pb-1">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Aspiration & Assessment</h3>
                      </div>

                      <div className="space-y-3">
                        <div>
                          <label className="text-[10px] font-semibold uppercase text-slate-500 mb-1 block">Aspiration Status</label>
                          <Badge
                            variant="secondary"
                            className={cn(
                              "text-xs font-medium",
                              candidateDetail.reform_aspiration_status.toLowerCase().includes('aspiration') && "bg-purple-100 text-purple-800"
                            )}
                          >
                            {candidateDetail.reform_aspiration_status}
                          </Badge>
                        </div>

                        {candidateDetail.reform_aspiration_status.toLowerCase().includes('aspiration') &&
                          candidateDetail.anchors?.some(a => ['Aspiration', 'Explicit Mechanism'].includes(a.anchor_role)) && (
                            <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-md">
                              <label className="text-[10px] font-semibold uppercase text-slate-500 mb-2 block">Aspiration vs Mechanism Comparison</label>
                              <div className="space-y-3">
                                {candidateDetail.anchors.filter(a => a.anchor_role === 'Aspiration').map(a => (
                                  <div key={a.anchor_id} className="text-sm">
                                    <span className="text-[10px] uppercase font-bold text-purple-600 block">Aspiration</span>
                                    <blockquote className="italic border-l-2 border-purple-300 pl-2 mt-1 text-slate-600">{a.verbatim_source_text}</blockquote>
                                  </div>
                                ))}

                                {candidateDetail.anchors.some(a => a.anchor_role === 'Aspiration') &&
                                  candidateDetail.anchors.some(a => a.anchor_role === 'Explicit Mechanism') && (
                                    <div className="flex justify-center -my-1 relative z-10">
                                      <Badge variant="outline" className="bg-white text-[9px] uppercase shadow-sm">
                                        Substantiated By
                                      </Badge>
                                    </div>
                                  )}

                                {candidateDetail.anchors.filter(a => a.anchor_role === 'Explicit Mechanism').map(a => (
                                  <div key={a.anchor_id} className="text-sm">
                                    <span className="text-[10px] uppercase font-bold text-emerald-600 block">Mechanism</span>
                                    <blockquote className="italic border-l-2 border-emerald-300 pl-2 mt-1 text-slate-600">{a.verbatim_source_text}</blockquote>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                        <div>
                          <label className="text-[10px] font-semibold uppercase text-slate-500 mb-1.5 mt-3 block">Criterion Assessment</label>
                          <div className="text-sm font-mono bg-slate-900 text-slate-300 p-3 rounded-md overflow-x-auto text-[11px] leading-relaxed">
                            {candidateDetail.criterion_assessment.split('\n').map((line, i) => (
                              <div key={i} className="py-0.5">{line}</div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </section>

                    {/* ── Relationships ── */}
                    {relationships && relationships.length > 0 && (
                      <section className="space-y-4">
                        <div className="flex items-center justify-between border-b border-border pb-1">
                          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Relationships</h3>
                        </div>
                        <div className="space-y-2">
                          {relationships.map(rel => (
                            <div key={rel.relationship_id} className="p-2 border rounded text-xs bg-slate-50 flex items-center justify-between">
                              <div>
                                <span className="font-mono text-[10px] text-slate-500 block mb-0.5">{rel.relationship_type}</span>
                                <span className="font-medium text-primary cursor-pointer hover:underline">
                                  {rel.target_candidate_id === candidateDetail.candidate_id ? rel.source_candidate_id : rel.target_candidate_id}
                                </span>
                              </div>
                              <Badge variant="outline" className="text-[9px]">{rel.relationship_status}</Badge>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}

                    {/* ── Your Decision ── */}
                    <section className="space-y-3">
                      <div className="flex items-center justify-between border-b border-border pb-1">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Your Decision</h3>
                        {reviewer && (
                          <span className="text-[9px] text-slate-400 font-mono">as {reviewer.display_name}</span>
                        )}
                      </div>

                      {!reviewer ? (
                        <div className="text-center py-4">
                          <p className="text-xs text-slate-500 mb-2">Sign in to submit a review decision.</p>
                          <button
                            onClick={() => setShowReviewerModal(true)}
                            className="text-xs font-semibold text-primary hover:underline flex items-center gap-1 mx-auto"
                          >
                            <User className="w-3.5 h-3.5" /> Sign in
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {/* Decision radio */}
                          <div className="grid grid-cols-3 gap-1.5">
                            {(['Accept', 'Reject', 'Needs Discussion'] as const).map(opt => (
                              <button
                                key={opt}
                                onClick={() => { setMyDecision(opt); setSubmitSuccess(false); }}
                                className={cn(
                                  "py-2 rounded-md border text-[11px] font-semibold transition-all",
                                  myDecision === opt
                                    ? opt === 'Accept'
                                      ? 'bg-emerald-600 text-white border-emerald-600'
                                      : opt === 'Reject'
                                        ? 'bg-red-600 text-white border-red-600'
                                        : 'bg-amber-500 text-white border-amber-500'
                                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                                )}
                              >
                                {opt}
                              </button>
                            ))}
                          </div>

                          {/* Rationale textarea */}
                          <textarea
                            placeholder="Rationale or notes (optional)…"
                            value={myRationale}
                            onChange={e => { setMyRationale(e.target.value); setSubmitSuccess(false); }}
                            rows={3}
                            className="w-full text-xs border border-slate-200 rounded-md p-2.5 resize-none bg-white focus:outline-none focus:ring-2 focus:ring-slate-800 focus:border-transparent text-slate-700 placeholder:text-slate-400"
                          />

                          {/* Submit button */}
                          <button
                            onClick={submitReview}
                            disabled={!myDecision || submitting}
                            className={cn(
                              "w-full py-2 text-xs font-semibold rounded-md transition-colors disabled:opacity-40",
                              submitSuccess
                                ? "bg-emerald-600 text-white"
                                : "bg-slate-900 hover:bg-slate-700 text-white"
                            )}
                          >
                            {submitting ? 'Saving…' : submitSuccess ? '✓ Saved' : candidateReviews.some(r => r.reviewer_id === reviewer.reviewer_id) ? 'Update Decision' : 'Submit Decision'}
                          </button>
                        </div>
                      )}
                    </section>

                    {/* ── All Reviewer Decisions ── */}
                    <section className="space-y-3">
                      <div className="flex items-center justify-between border-b border-border pb-1">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5" /> All Reviewer Decisions
                        </h3>
                        <span className="text-[9px] font-mono text-slate-400">
                          {candidateReviews.length} {candidateReviews.length === 1 ? 'decision' : 'decisions'}
                        </span>
                      </div>

                      {reviewsConflict && (
                        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-md p-3">
                          <AlertTriangle className="w-4 h-4 text-amber-600 flex-none mt-0.5" />
                          <div>
                            <p className="text-xs font-semibold text-amber-800">Reviewers disagree on this candidate</p>
                            <p className="text-[10px] text-amber-700 mt-0.5">Conflicting decisions are shown below. This candidate may need discussion before finalizing.</p>
                          </div>
                        </div>
                      )}

                      {candidateReviews.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-4">No decisions submitted yet.</p>
                      ) : (
                        <div className="space-y-2">
                          {/* Group: show only latest per reviewer */}
                          {(() => {
                            const seen = new Set<string>();
                            return candidateReviews.filter(r => {
                              if (seen.has(r.reviewer_id)) return false;
                              seen.add(r.reviewer_id);
                              return true;
                            }).map(review => (
                              <div key={review.review_id} className="p-3 bg-slate-50 border border-border rounded-md space-y-2">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-1.5">
                                    <div className="w-5 h-5 rounded-full bg-slate-700 flex items-center justify-center">
                                      <span className="text-white text-[9px] font-bold">
                                        {review.reviewer_name.charAt(0).toUpperCase()}
                                      </span>
                                    </div>
                                    <span className="text-xs font-semibold text-slate-800">{review.reviewer_name}</span>
                                  </div>
                                  <Badge variant="outline" className={cn("text-[9px] font-semibold", getDecisionBadgeClass(review.inclusion_decision))}>
                                    {review.inclusion_decision}
                                  </Badge>
                                </div>
                                {review.comment && (
                                  <p className="text-xs text-slate-600 italic leading-relaxed pl-6.5">
                                    "{review.comment}"
                                  </p>
                                )}
                                <p className="text-[10px] text-muted-foreground pl-6.5">
                                  {formatRelativeTime(review.created_at)}
                                </p>
                              </div>
                            ));
                          })()}
                        </div>
                      )}
                    </section>

                  </div>
                </ScrollArea>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
                No candidate selected
              </div>
            )}
          </Panel>

        </PanelGroup>
      </div>
    </div>
  );
}
