import { useRef, useState } from 'react';

const STORAGE_KEY = 'compact_review_identity';

export interface ReviewerIdentity {
  reviewer_id: string;
  display_name: string;
  token: string;
}

export function useReviewer() {
  const [reviewer, setReviewer] = useState<ReviewerIdentity | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return null;
      const parsed = JSON.parse(stored) as ReviewerIdentity;
      // Reject legacy entries that pre-date token support
      if (!parsed.token) return null;
      return parsed;
    } catch {
      return null;
    }
  });
  const reviewerRef = useRef(reviewer);

  const login = (identity: ReviewerIdentity) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
    reviewerRef.current = identity;
    setReviewer(identity);
  };

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY);
    reviewerRef.current = null;
    setReviewer(null);
  };

  // This app uses prototype name selection, not verified authentication.
  // Restore the same selected identity without navigating or clearing its draft.
  const renewSession = async (identity: ReviewerIdentity): Promise<ReviewerIdentity> => {
    const response = await fetch('/api/reviewers/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: identity.display_name }),
    });
    if (!response.ok) {
      throw new Error('Could not restore your reviewer session. Your draft is still here. Select your name again and retry.');
    }
    const renewed = await response.json() as ReviewerIdentity;
    if (renewed.reviewer_id !== identity.reviewer_id ||
        renewed.display_name !== identity.display_name ||
        typeof renewed.token !== 'string' || !renewed.token) {
      throw new Error('Reviewer session did not match your selected name. Your draft has been kept.');
    }
    if (reviewerRef.current?.reviewer_id !== identity.reviewer_id) {
      throw new Error('Reviewer selection changed while saving. Select the correct reviewer before retrying.');
    }
    login(renewed);
    return renewed;
  };

  return { reviewer, login, logout, renewSession };
}
