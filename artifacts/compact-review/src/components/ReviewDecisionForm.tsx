import { useRef, useState } from 'react';
import { ReviewEventCard, reviewEventKey, type ReviewEvent } from '@/components/ReviewEventCard';
import type { ReviewerIdentity } from '@/hooks/use-reviewer';

const decisions = [
  { label: 'Accept', value: 'Approve' },
  { label: 'Needs discussion', value: 'Needs Discussion' },
  { label: 'Reject', value: 'Reject' },
] as const;

export function ReviewDecisionForm({
  candidateId, revision, reviewer, reviews, onSelectReviewer, onRenewSession, onSaved,
}: {
  candidateId: string;
  revision: number;
  reviewer: ReviewerIdentity | null;
  reviews: ReviewEvent[];
  onSelectReviewer: () => void;
  onRenewSession: (identity: ReviewerIdentity) => Promise<ReviewerIdentity>;
  onSaved: (review: ReviewEvent) => void;
}) {
  const [decision, setDecision] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [needsReviewerSelection, setNeedsReviewerSelection] = useState(false);
  const inFlight = useRef(false);
  const latest = [...reviews].reverse().find(
    event => event.stage === 'Global' &&
      event.reviewer_id === reviewer?.reviewer_id &&
      Number(event.assessment_revision) === revision,
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current || !reviewer || !decision || !Number.isInteger(revision) || revision < 1) return;
    inFlight.current = true;
    setSaving(true);
    setError('');
    setNeedsReviewerSelection(false);
    setMessage('');
    try {
      const body = JSON.stringify({
        stage: 'Global',
        decision,
        comment: comment.trim() || null,
        expected_assessment_revision: revision,
      });
      const sendReview = (token: string) => fetch(`/api/candidates/${encodeURIComponent(candidateId)}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body,
      });
      let response = await sendReview(reviewer.token);
      // A 401 is rejected before insertion. Only that explicit failure is
      // retried; network failures and other statuses could have written data.
      if (response.status === 401) {
        setNeedsReviewerSelection(true);
        const renewed = await onRenewSession(reviewer);
        response = await sendReview(renewed.token);
        setNeedsReviewerSelection(response.status === 401);
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(response.status === 401
          ? 'Your reviewer session could not be restored. Your draft has been kept. Select your name again and retry.'
          : response.status === 409
            ? 'This assessment changed. Reload the page before reviewing it.'
            : body.error || `Review could not be saved (${response.status}).`);
      }
      const savedReview = await response.json() as ReviewEvent;
      onSaved(savedReview);
      setDecision('');
      setComment('');
      setMessage('Review saved to history. This is not a final approval.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Review could not be saved.');
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return <section className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-3">
    <div>
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">Your review decision</h3>
      <p className="text-[11px] text-slate-600 mt-1">Recorded as an individual review opinion. It does not change the official stage decision or final status. Reviewer names are not verified identities.</p>
    </div>
    {!reviewer ? <button type="button" onClick={onSelectReviewer} className="rounded bg-slate-800 text-white px-3 py-2 text-xs font-medium">Select reviewer name to review</button> :
      <form onSubmit={submit} className="space-y-3">
        <p className="text-xs">Reviewing as <strong>{reviewer.display_name}</strong>{latest ? ` · Latest: ${decisions.find(d => d.value === latest.decision)?.label ?? latest.decision}` : ' · No decision on this revision yet'}</p>
        <fieldset disabled={saving} className="space-y-2">
          <legend className="text-[11px] font-semibold text-slate-700 mb-1">Choose a decision</legend>
          <div className="flex flex-wrap gap-2">
            {decisions.map(option => <label key={option.value} className={`cursor-pointer rounded border px-3 py-1.5 text-xs ${decision === option.value ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-700 border-slate-300'}`}>
              <input type="radio" name="review-decision" value={option.value} checked={decision === option.value} onChange={() => { setDecision(option.value); setMessage(''); }} className="sr-only" />
              {option.label}
            </label>)}
          </div>
          <label htmlFor="review-comment" className="block text-[11px] font-semibold text-slate-700">Comment (optional)</label>
          <textarea id="review-comment" value={comment} onChange={event => setComment(event.target.value)} rows={3} maxLength={3000} placeholder="Add context for other reviewers…" className="w-full resize-y rounded border border-slate-300 bg-white p-2 text-xs" />
          <button type="submit" disabled={!decision || !Number.isInteger(revision) || revision < 1} className="rounded bg-slate-800 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save review decision'}</button>
        </fieldset>
      </form>}
    {message && <p role="status" className="text-xs text-emerald-800">{message}</p>}
    {error && <div role="alert" className="space-y-2 text-xs text-red-700">
      <p>{error}</p>
      {needsReviewerSelection && <button type="button" onClick={onSelectReviewer} className="underline font-semibold">Select reviewer again</button>}
    </div>}
    <div className="border-t border-slate-200 pt-3">
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Reviewer decisions · {reviews.length}</h4>
      {reviews.length
        ? reviews.map((review, index) => <ReviewEventCard key={reviewEventKey(review, index)} review={review} />)
        : <p className="text-xs text-slate-500">No review history yet.</p>}
    </div>
  </section>;
}