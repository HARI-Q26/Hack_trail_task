"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, CollegeStatusResponse } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const { user, refresh } = useAuth();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [roleHint, setRoleHint] = useState<"student" | "teacher">("student");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collegeStatus, setCollegeStatus] = useState<CollegeStatusResponse | null>(null);

  useEffect(() => {
    if (user.is_authenticated) {
      router.replace("/assistant");
    }
  }, [router, user.is_authenticated]);

  useEffect(() => {
    api.getCollegeStatus().then(setCollegeStatus).catch(() => setCollegeStatus(null));
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.login({ login_id: loginId, password, role_hint: roleHint });
      await refresh();
      router.push("/assistant");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xs sm:p-8">
      <h1 className="text-xl font-bold text-slate-900">Campus Portal Login</h1>
      <p className="mt-1 text-xs text-slate-600">
        Sign in with your College API student or teacher credentials. Sessions use HTTP-only
        cookies; JWT tokens are never stored in browser storage.
      </p>

      {collegeStatus && !collegeStatus.available && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
        >
          <strong>External College API Unavailable:</strong>{" "}
          {collegeStatus.error || "Cannot reach authentication provider."}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800"
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <div>
          <label htmlFor="role-hint" className="block text-xs font-medium text-slate-700">
            Account Type
          </label>
          <select
            id="role-hint"
            value={roleHint}
            onChange={(e) => setRoleHint(e.target.value as "student" | "teacher")}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
          >
            <option value="student">Student</option>
            <option value="teacher">Teacher</option>
          </select>
        </div>

        <div>
          <label htmlFor="login-id" className="block text-xs font-medium text-slate-700">
            Login ID
          </label>
          <input
            id="login-id"
            type="text"
            required
            value={loginId}
            onChange={(e) => setLoginId(e.target.value)}
            placeholder="e.g. arjun"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-xs font-medium text-slate-700">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-slate-900 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}

