"use client";

import { ChangeEvent, useEffect, useState } from "react";
import { api, KnowledgeDocument } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export function KnowledgePanel() {
  const { user } = useAuth();
  const [docs, setDocs] = useState<KnowledgeDocument[]>([]);
  const [docType, setDocType] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    api.getKnowledgeDocuments().then(setDocs).catch(() => setDocs([]));
  }, []);

  async function handleSyncFromApi() {
    setBusy(true);
    setStatusMsg(null);
    try {
      const res = await api.syncKnowledgeFromCollege();
      const updated = await api.getKnowledgeDocuments();
      setDocs(updated);
      setStatusMsg(`Synced ${res.synced_count} official PDF(s) from the KIT College API.`);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : "Failed to sync official PDFs.");
    } finally {
      setBusy(false);
    }
  }

  async function handleFileUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setStatusMsg(null);
    try {
      const uploaded = await api.uploadKnowledgePdf(file, docType);
      const updated = await api.getKnowledgeDocuments();
      setDocs(updated);
      setStatusMsg(`Indexed "${uploaded.filename}" (${uploaded.page_count} pages).`);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : "PDF upload failed.");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  return (
    <section className="mx-auto mt-6 max-w-4xl rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Official Knowledge Base ({docs.length} PDF{docs.length === 1 ? "" : "s"} indexed)
          </h2>
          <p className="text-xs text-slate-500">
            Rulebooks, admissions brochures, circulars, and lesson notes used by the assistant.
          </p>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => void handleSyncFromApi()}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {busy ? "Working..." : "Sync Official PDFs from KIT API"}
        </button>
      </div>

      {statusMsg && (
        <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          {statusMsg}
        </p>
      )}

      {docs.length > 0 && (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {docs.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
            >
              <span className="truncate font-medium text-slate-800">{d.filename}</span>
              <span className="shrink-0 rounded bg-white px-2 py-0.5 text-[11px] text-slate-600 border border-slate-200">
                {d.doc_type} · {d.page_count}p
              </span>
            </li>
          ))}
        </ul>
      )}

      {user.role === "teacher" ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 text-xs">
          <span className="font-medium text-slate-700">Upload additional PDF (Teacher):</span>
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            aria-label="Document type"
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
          >
            <option value="auto">Auto-detect type</option>
            <option value="rulebook">Rulebook</option>
            <option value="brochure">Admission Brochure</option>
            <option value="notes">Lesson Notes</option>
            <option value="other">Other</option>
          </select>
          <input
            type="file"
            accept=".pdf,application/pdf"
            disabled={busy}
            onChange={(e) => void handleFileUpload(e)}
            className="text-xs text-slate-600 file:mr-2 file:rounded file:border-0 file:bg-slate-900 file:px-3 file:py-1 file:text-xs file:font-medium file:text-white hover:file:bg-slate-800"
          />
        </div>
      ) : (
        <p className="mt-3 text-[11px] text-slate-500">
          Tip: You can also drop PDFs into <code className="font-mono">data/documents/</code> or log in as a teacher to upload PDFs here.
        </p>
      )}
    </section>
  );
}

