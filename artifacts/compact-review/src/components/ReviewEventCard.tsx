import { Badge } from '@/components/ui/badge';

export type ReviewEvent = {
  event_id?: string | number;
  review_event_id?: string | number;
  review_id?: string | number;
  reviewer_id?: string;
  reviewer_name?: string;
  display_name?: string;
  stage?: string;
  review_stage?: string;
  decision?: string;
  inclusion_decision?: string;
  comment?: string | null;
  reviewer_comment?: string | null;
  assessment_revision?: string | number;
  revision?: string | number;
  created_at?: string;
  created_at_utc?: string;
  occurred_at?: string;
};

function eventValue(event: ReviewEvent, ...keys: (keyof ReviewEvent)[]) {
  for (const key of keys) {
    const value = event[key];
    if (value !== undefined && value !== null && value !== '') return String(value);
  }
  return '';
}

export function reviewEventKey(event: ReviewEvent, index: number) {
  return eventValue(event, 'event_id', 'review_event_id', 'review_id') ||
    `${eventValue(event, 'reviewer_id') || 'review'}-${index}`;
}

function reviewDecisionStyle(decision: string) {
  const normalized = decision.trim().toLowerCase();
  if (normalized === 'accept' || normalized === 'approve') return {
    label: 'Accept',
    card: 'border-l-emerald-500 bg-emerald-50/40',
    badge: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  };
  if (normalized === 'needs discussion') return {
    label: 'Needs Discussion',
    card: 'border-l-amber-500 bg-amber-50/50',
    badge: 'bg-amber-100 text-amber-800 border-amber-200',
  };
  if (normalized === 'reject') return {
    label: 'Reject',
    card: 'border-l-red-500 bg-red-50/40',
    badge: 'bg-red-100 text-red-800 border-red-200',
  };
  return {
    label: decision || 'Decision unavailable',
    card: 'border-l-slate-300 bg-white',
    badge: 'bg-slate-100 text-slate-700 border-slate-200',
  };
}

export function ReviewEventCard({ review }: { review: ReviewEvent }) {
  const rawDecision = eventValue(review, 'decision', 'inclusion_decision') || 'Decision unavailable';
  const style = reviewDecisionStyle(rawDecision);
  const reviewerName = eventValue(review, 'reviewer_name', 'display_name') ||
    (eventValue(review, 'reviewer_id') ? `Reviewer ID ${eventValue(review, 'reviewer_id')}` : 'Reviewer identity unavailable');
  const stage = eventValue(review, 'stage', 'review_stage') || 'Legacy review';
  const comment = eventValue(review, 'comment', 'reviewer_comment');
  const timestamp = eventValue(review, 'created_at', 'created_at_utc', 'occurred_at');
  const revision = eventValue(review, 'assessment_revision', 'revision') || 'unknown';

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
