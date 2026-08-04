import { useState } from 'react';
import { ReviewerIdentity } from '@/hooks/use-reviewer';
import { User, Lock } from 'lucide-react';

interface ReviewerModalProps {
  onLogin: (identity: ReviewerIdentity) => void;
}

export function ReviewerModal({ onLogin }: ReviewerModalProps) {
  const [displayName, setDisplayName] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!displayName.trim()) {
      setError('Please enter your name.');
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      setError('PIN must be exactly 4 digits.');
      return;
    }

    setLoading(true);
    try {
      // Try registration first. If the name is new, this creates the account.
      // If the name already exists (409), fall through to login.
      const regRes = await fetch('/api/reviewers/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: displayName.trim(), pin }),
      });

      if (regRes.ok) {
        const identity = await regRes.json() as ReviewerIdentity;
        onLogin(identity);
        return;
      }

      if (regRes.status !== 409) {
        // 400 validation, 429 rate limit, or server error
        const regErr = await regRes.json() as { error: string };
        setError(regErr.error || 'Registration failed.');
        return;
      }

      // 409 = name already exists — try login with the supplied PIN
      const loginRes = await fetch('/api/reviewers/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: displayName.trim(), pin }),
      });

      if (loginRes.ok) {
        const identity = await loginRes.json() as ReviewerIdentity;
        onLogin(identity);
        return;
      }

      const loginErr = await loginRes.json() as { error: string };
      setError(loginErr.error || 'Invalid PIN. Please try again.');
    } catch {
      setError('Network error. Please try again.');
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
            <h2 className="text-white font-semibold text-base">Reviewer Identity</h2>
          </div>
          <p className="text-slate-400 text-xs leading-relaxed">
            Enter your name and a 4-digit PIN. New reviewers are registered automatically on first use.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 block">
              Display Name
            </label>
            <div className="relative">
              <User className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="e.g. Sarah K."
                autoFocus
                className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-800 focus:border-transparent"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 block">
              4-Digit PIN
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="password"
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                value={pin}
                onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="••••"
                className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm font-mono tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-slate-800 focus:border-transparent"
              />
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-slate-900 text-white text-sm font-semibold rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50"
          >
            {loading ? 'Signing in…' : 'Continue'}
          </button>

          <p className="text-center text-[10px] text-slate-400 leading-relaxed">
            Your PIN is hashed server-side. Source data and LLM classifications are never modified.
          </p>
        </form>
      </div>
    </div>
  );
}
