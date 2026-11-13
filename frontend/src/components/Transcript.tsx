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
    <div className="flex flex-col gap-4">
      {entries.length === 0 && !interimTranscript && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white/80 p-8 text-center text-sm text-slate-500">
          Start speaking with the microphone button or pick a quick prompt above to begin.
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
              className="ml-auto flex max-w-[82%] flex-col gap-1 rounded-2xl rounded-br-sm border border-blue-200 bg-blue-600 px-4 py-3 text-sm text-white shadow-xs"
            >
              <span className="text-[11px] font-medium text-blue-100">You</span>
              <p className="whitespace-pre-wrap leading-relaxed">{entry.content}</p>
            </div>
          );
        }

        return (
          <div
            key={entry.id}
            className="mr-auto flex w-full max-w-[95%] flex-col gap-2.5 rounded-2xl rounded-bl-sm border border-slate-200 bg-white p-4 text-sm text-slate-800 shadow-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-900 text-[10px] font-bold text-white">
                  KIT
                </span>
                <span className="text-xs font-semibold text-slate-900">
                  Knotopian AI Assistant
                </span>
              </div>
              {entry.fallbackUsed && (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                  Fallback Mode
                </span>
              )}
            </div>

            <FormattedText content={entry.content} />

            {timetableTools.map((tt, idx) => (
              <TimetableCard key={`tt-${idx}`} data={tt.data as TimetableToolData} />
            ))}

            {entry.toolsUsed && entry.toolsUsed.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-t border-slate-100 pt-2">
                {entry.toolsUsed.map((tool, idx) => (
                  <span
                    key={`${tool.tool_name}-${idx}`}
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                      tool.status === "success"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : tool.status === "pending_confirmation"
                          ? "border-amber-200 bg-amber-50 text-amber-700"
                          : "border-rose-200 bg-rose-50 text-rose-700"
                    }`}
                  >
                    {tool.tool_name}: {tool.status}
                  </span>
                ))}
              </div>
            )}

            {entry.pendingConfirmation && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <span className="text-xs font-medium text-amber-900">
                  Explicit confirmation required:
                </span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onConfirmAction("Confirm")}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  Confirm & Submit
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onConfirmAction("Cancel")}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        );
      })}

      {interimTranscript && (
        <div className="ml-auto max-w-[82%] rounded-2xl border border-dashed border-blue-300 bg-blue-50/70 px-4 py-2.5 text-sm italic text-slate-600">
          {interimTranscript}
        </div>
      )}
    </div>
  );
}
