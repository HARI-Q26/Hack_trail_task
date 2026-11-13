"use client";

import { ToolExecutionSummary } from "@/lib/api";
import { FormattedText } from "@/components/FormattedText";
import { TimetableCard, TimetableToolData } from "@/components/TimetableCard";

export interface TranscriptEntry {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolsUsed?: ToolExecutionSummary[];
  fallbackUsed?: boolean;
  pendingConfirmation?: {
    confirmation_id?: string;
    action_type?: string;
    payload?: Record<string, unknown>;
    message?: string;
  } | null;
}

interface TranscriptProps {
  entries: TranscriptEntry[];
  interimTranscript: string;
  onConfirmAction: (text: string) => void;
  disabled: boolean;
}

export function Transcript({
  entries,
  interimTranscript,
  onConfirmAction,
  disabled,
}: TranscriptProps) {
  return (
    <div className="flex flex-col gap-5">
      {entries.length === 0 && !interimTranscript && (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-white/70 py-12 px-6 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 100-6 3 3 0 000 6z" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-slate-800">Ready to Assist</h3>
          <p className="mt-1 max-w-sm text-xs text-slate-500">
            Click &ldquo;Start Phone Call&rdquo; or pick a suggested question above to talk with the campus assistant.
          </p>
        </div>
      )}

      {entries.map((entry) => {
        const isUser = entry.role === "user";
        const timetableTools = (entry.toolsUsed || []).filter(
          (t) => t.tool_name === "get_timetable" && t.status === "success" && t.data
        );

        if (isUser) {
          return (
            <div
              key={entry.id}
              className="ml-auto flex max-w-[85%] flex-col items-end gap-1"
            >
              <div className="rounded-2xl rounded-tr-xs bg-linear-to-r from-blue-600 to-indigo-600 px-4 py-3 text-[15px] font-normal text-white shadow-sm">
                <p className="whitespace-pre-wrap leading-relaxed">{entry.content}</p>
              </div>
              <span className="mr-1 text-[11px] font-medium text-slate-400">You</span>
            </div>
          );
        }

        return (
          <div
            key={entry.id}
            className="mr-auto flex w-full max-w-[96%] flex-col gap-3 rounded-2xl rounded-tl-xs border border-slate-200/90 bg-white p-5 shadow-xs transition-shadow hover:shadow-sm"
          >
            {/* Assistant Header */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-xs font-bold text-white shadow-xs">
                  KIT
                </span>
                <div>
                  <span className="text-xs font-bold text-slate-900">
                    Knotopian Voice Assistant
                  </span>
                  <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                    Campus AI
                  </span>
                </div>
              </div>

              {entry.fallbackUsed && (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[10px] font-semibold text-amber-800">
                  Fallback AI Model
                </span>
              )}
            </div>

            {/* Clear Formatted Response Text */}
            <div className="text-slate-800">
              <FormattedText content={entry.content} />
            </div>

            {/* Interactive Timetable Card if fetched */}
            {timetableTools.map((tt, idx) => (
              <div key={`tt-${idx}`} className="mt-2">
                <TimetableCard data={tt.data as TimetableToolData} />
              </div>
            ))}

            {/* Subtle Collapsed Actions / Tools Performed */}
            {entry.toolsUsed && entry.toolsUsed.length > 0 && (
              <details className="mt-2 border-t border-slate-100 pt-2 text-xs">
                <summary className="cursor-pointer font-medium text-slate-400 hover:text-slate-600 transition-colors">
                  ⚙️ Actions completed ({entry.toolsUsed.length})
                </summary>
                <div className="mt-2 flex flex-wrap gap-1.5 pl-1">
                  {entry.toolsUsed.map((tool, idx) => (
                    <span
                      key={`${tool.tool_name}-${idx}`}
                      className={`rounded-md border px-2 py-0.5 text-[11px] font-mono ${
                        tool.status === "success"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : tool.status === "pending_confirmation"
                          ? "border-amber-200 bg-amber-50 text-amber-700"
                          : "border-rose-200 bg-rose-50 text-rose-700"
                      }`}
                    >
                      {tool.tool_name} ({tool.status})
                    </span>
                  ))}
                </div>
              </details>
            )}

            {/* Explicit Confirmation Banner */}
            {entry.pendingConfirmation && (
              <div className="mt-2 rounded-xl border border-amber-300 bg-amber-50/90 p-4 shadow-2xs">
                <div className="flex items-start gap-3">
                  <span className="text-xl">⚠️</span>
                  <div className="flex-1 space-y-2">
                    <p className="text-xs font-semibold text-amber-900">
                      Confirmation Required Before Submitting
                    </p>
                    <p className="text-xs text-amber-800">
                      {entry.pendingConfirmation.message ||
                        "Please verify the details above before confirming this request."}
                    </p>
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onConfirmAction("Confirm")}
                        className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 active:scale-95 disabled:opacity-50 transition-all"
                      >
                        Yes, Confirm
                      </button>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onConfirmAction("Cancel")}
                        className="rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-all"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Live Interim Transcript Bubble while speaking */}
      {interimTranscript && (
        <div className="ml-auto flex max-w-[85%] items-center gap-2 rounded-2xl rounded-tr-xs border border-dashed border-blue-400 bg-blue-50/90 px-4 py-3 text-[14px] italic text-slate-700 shadow-2xs animate-pulse">
          <span className="h-2 w-2 rounded-full bg-blue-600 animate-ping" />
          <span>&ldquo;{interimTranscript}&rdquo;</span>
        </div>
      )}
    </div>
  );
}
