import { useState } from 'react';

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

  const login = (identity: ReviewerIdentity) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
    setReviewer(identity);
  };

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY);
    setReviewer(null);
  };

  return { reviewer, login, logout };
}
