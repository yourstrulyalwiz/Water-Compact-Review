import { useState } from 'react';
import { ReviewerIdentity } from '@/hooks/use-reviewer';
import { User, ChevronDown } from 'lucide-react';

const REVIEWER_NAMES = ['Christina', 'Billy', 'Juliana', 'Patricia'] as const;
type ReviewerName = typeof REVIEWER_NAMES[number];

interface ReviewerModalProps {
  onLogin: (identity: ReviewerIdentity) => void;
}

export function ReviewerModal({ onLogin }: ReviewerModalProps) {
  const [selectedName, setSelectedName] = useState<ReviewerName | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedName) {
      setError('Please select your name.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/reviewers/authenticate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: selectedName }),
      });

      if (res.ok) {
        const identity = await res.json() as ReviewerIdentity;
        onLogin(identity);
        return;
      }

      if (res.status === 429) {
        setError('Too many attempts. Please wait a few minutes and try again.');
        return;
      }

      const body = await res.json().catch(() => ({})) as { error?: string };
      setError(body.error || 'Sign-in failed. Please try again.');
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-slate-900 px-6 py-5">
          <div className="flex items-center gap-3 mb-1">
            <User className="w-5 h-5 text-slate-400" />
            <h2 className="text-white font-semibold text-base">Select Reviewer</h2>
          </div>
          <p className="text-slate-400 text-xs leading-relaxed">
            Choose your name to begin reviewing.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 block">
              Your Name
            </label>
            <div className="relative">
              <User className="w-4 h-4 absolute left-3 top-2.5 text-slate-400 pointer-events-none" />
              <select
                value={selectedName}
                onChange={e => setSelectedName(e.target.value as ReviewerName | '')}
                autoFocus
                className="w-full pl-9 pr-8 py-2 border border-slate-200 rounded-lg text-sm appearance-none bg-white focus:outline-none focus:ring-2 focus:ring-slate-800 focus:border-transparent text-slate-700"
              >
                <option value="" disabled>Select your name…</option>
                {REVIEWER_NAMES.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 absolute right-3 top-2.5 text-slate-400 pointer-events-none" />
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !selectedName}
            className="w-full py-2.5 bg-slate-900 text-white text-sm font-semibold rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50"
          >
            {loading ? 'Signing in…' : 'Continue'}
          </button>

          <p className="text-center text-[10px] text-slate-400 leading-relaxed">
            Source data and LLM classifications are never modified.
          </p>
        </form>
      </div>
    </div>
  );
}
