import type { Metadata } from 'next';
import './globals.css';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'KIT AI Voice Assistant — Knotopian Institute of Technology',
  description: 'Official Groq-powered real-time voice and text college assistant for Knotopian Institute of Technology (KIT).',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col bg-[#F2F7F8] text-slate-800 antialiased">
        <header className="sticky top-0 z-50 bg-[#0E625E] text-white shadow-md border-b border-[#094340]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3 group">
              <div className="w-10 h-10 rounded-lg bg-[#F47F20] text-white font-bold flex items-center justify-center text-xl shadow-sm group-hover:scale-105 transition-transform">
                KIT
              </div>
              <div>
                <span className="font-bold text-lg tracking-tight block leading-tight">
                  Knotopian Institute of Technology
                </span>
                <span className="text-xs text-teal-200 tracking-wide">
                  Groq Voice College Assistant
                </span>
              </div>
            </Link>

            <nav className="flex items-center gap-2 sm:gap-4 text-sm font-medium">
              <Link
                href="/"
                className="px-3 py-1.5 rounded-md hover:bg-teal-700/60 transition-colors"
              >
                Home
              </Link>
              <Link
                href="/assistant"
                className="px-3 py-1.5 rounded-md bg-[#F47F20] hover:bg-[#D66710] text-white font-semibold transition-colors shadow-sm flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 100-6 3 3 0 000 6z" />
                </svg>
                <span>Voice Assistant</span>
              </Link>
              <Link
                href="/history"
                className="px-3 py-1.5 rounded-md hover:bg-teal-700/60 transition-colors hidden sm:inline-block"
              >
                History
              </Link>
              <Link
                href="/login"
                className="px-3 py-1.5 rounded-md border border-teal-300/40 hover:bg-teal-700/60 transition-colors text-teal-100"
              >
                Portal Login
              </Link>
            </nav>
          </div>
        </header>

        <main className="flex-1 flex flex-col">{children}</main>

        <footer className="bg-slate-900 text-slate-400 py-6 text-xs border-t border-slate-800">
          <div className="max-w-7xl mx-auto px-4 text-center sm:flex sm:justify-between sm:items-center">
            <p>© 2026 Knotopian Institute of Technology (KIT). Autonomous Premier Institution.</p>
            <p className="mt-2 sm:mt-0 text-slate-500">
              Powered by Groq LLM & Whisper Speech-to-Text • Live College API Connected
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
