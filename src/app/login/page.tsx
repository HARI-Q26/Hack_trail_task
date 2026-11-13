'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentSession, setCurrentSession] = useState<any>(null);

  useEffect(() => {
    fetch('/api/auth/session')
      .then((res) => res.json())
      .then((data) => {
        if (data.session && data.session.isAuthenticated) {
          setCurrentSession(data.session);
        }
      })
      .catch(() => {});
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login_id: loginId, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      router.push('/assistant');
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    setLoading(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setCurrentSession(null);
      router.refresh();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function fillCredentials(id: string, pass: string) {
    setLoginId(id);
    setPassword(pass);
    setError(null);
  }

  return (
    <div className="flex-1 flex items-center justify-center p-4 py-12">
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-xl p-8">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-[#0E625E] text-white font-extrabold flex items-center justify-center text-xl mx-auto shadow-md">
            KIT
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mt-4">College Portal Login</h2>
          <p className="text-xs text-slate-500 mt-1">
            Access student records, class attendance, and faculty approvals.
          </p>
        </div>

        {currentSession ? (
          <div className="p-4 rounded-xl bg-teal-50 border border-teal-200 text-center space-y-3">
            <p className="text-xs text-slate-500">Currently authenticated as:</p>
            <p className="font-bold text-[#0E625E] text-lg">{currentSession.displayName}</p>
            <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider bg-teal-100 text-teal-800">
              Role: {currentSession.role}
            </span>
            <div className="pt-2 flex gap-2 justify-center">
              <Link
                href="/assistant"
                className="px-4 py-2 rounded-lg bg-[#F47F20] hover:bg-[#D66710] text-white text-xs font-semibold shadow"
              >
                Go to Assistant
              </Link>
              <button
                onClick={handleLogout}
                disabled={loading}
                className="px-4 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold"
              >
                Log Out
              </button>
            </div>
          </div>
        ) : (
          <>
            {error && (
              <div className="mb-5 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                {error}
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Login ID
                </label>
                <input
                  type="text"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  placeholder="e.g. arjun or lakshmi"
                  required
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 focus:border-[#0E625E] focus:ring-1 focus:ring-[#0E625E] outline-none text-sm transition-all text-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 focus:border-[#0E625E] focus:ring-1 focus:ring-[#0E625E] outline-none text-sm transition-all text-slate-800"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-lg bg-[#0E625E] hover:bg-[#094340] text-white font-bold text-sm shadow-md transition-all disabled:opacity-50"
              >
                {loading ? 'Authenticating...' : 'Sign In to Portal'}
              </button>
            </form>

            {/* Quick Demo Credentials */}
            <div className="mt-8 pt-6 border-t border-slate-100">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider text-center mb-3">
                1-Click Test Credentials
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => fillCredentials('arjun', 'Kit@2026')}
                  className="p-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-teal-50 text-left text-xs transition-colors"
                >
                  <span className="block font-bold text-slate-800">Arjun K (Student)</span>
                  <span className="text-slate-500 text-[10px]">Class CSE-2A</span>
                </button>
                <button
                  type="button"
                  onClick={() => fillCredentials('lakshmi', 'Kit@2026')}
                  className="p-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-teal-50 text-left text-xs transition-colors"
                >
                  <span className="block font-bold text-slate-800">Dr. Lakshmi (Teacher)</span>
                  <span className="text-slate-500 text-[10px]">Class Advisor</span>
                </button>
              </div>
            </div>

            <div className="mt-6 text-center">
              <Link
                href="/assistant"
                className="text-xs text-[#0E625E] hover:underline font-medium"
              >
                Continue as Public Visitor without Login →
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
