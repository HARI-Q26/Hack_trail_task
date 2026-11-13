"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

const ROLE_BADGE_STYLES: Record<string, string> = {
  public: "bg-slate-100 text-slate-700 border-slate-200",
  student: "bg-blue-50 text-blue-700 border-blue-200",
  teacher: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();

  const navItems = [
    { href: "/", label: "Home" },
    { href: "/assistant", label: "Voice Assistant" },
    { href: "/history", label: "History" },
  ];

  async function handleLogout() {
    await logout();
    router.push("/");
    router.refresh();
  }

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-white">
              KIT
            </span>
            <div>
              <p className="text-sm font-semibold leading-tight text-slate-900">
                Knotopian Institute of Technology
              </p>
              <p className="text-xs text-slate-500">Quirri College Voice Agent</p>
            </div>
          </Link>
        </div>

        <nav className="flex items-center gap-1 sm:gap-2" aria-label="Main navigation">
          {navItems.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          <span
            className={`rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${
              ROLE_BADGE_STYLES[user.role] || ROLE_BADGE_STYLES.public
            }`}
          >
            {user.is_authenticated ? `${user.role}: ${user.display_name}` : "Public Mode"}
          </span>

          {user.is_authenticated ? (
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Sign out
            </button>
          ) : (
            <Link
              href="/login"
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              Portal Login
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

