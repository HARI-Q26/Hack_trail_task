"use client";

import { useEffect, useState } from "react";
import { FormattedText } from "@/components/FormattedText";
import { api, ConversationDetail, ConversationSummary } from "@/lib/api";

export default function HistoryPage() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selected, setSelected] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .listHistory()
      .then((list) => {
        if (!active) return;
        setConversations(list);
        if (list.length > 0) {
          return api.getHistoryDetail(list[0].id).then((detail) => {
            if (active) setSelected(detail);
          });
        }
        return undefined;
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Failed to load history.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleSelect(id: string) {
    setError(null);
    try {
      const detail = await api.getHistoryDetail(id);
      setSelected(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load conversation detail.");
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Conversation History</h1>
        <p className="text-xs text-slate-600">
          Conversations and sanitized tool execution logs scoped strictly to your account/session.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Loading conversation history...
        </div>
      ) : conversations.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          No conversations recorded yet for this session.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
            {conversations.map((conv) => (
              <button
                key={conv.id}
                type="button"
                onClick={() => void handleSelect(conv.id)}
                className={`w-full rounded-lg border p-3 text-left transition-colors ${
                  selected?.id === conv.id
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100"
                }`}
              >
                <p className="truncate text-xs font-semibold">{conv.title}</p>
                <p
                  className={`mt-1 text-[11px] capitalize ${
                    selected?.id === conv.id ? "text-slate-300" : "text-slate-500"
                  }`}
                >
                  {conv.mode} · {conv.message_count} messages
                </p>
              </button>
            ))}
          </div>

          <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 md:col-span-2">
            {selected ? (
              <>
                <div className="border-b border-slate-100 pb-3">
                  <h2 className="text-sm font-semibold text-slate-900">{selected.title}</h2>
                  <p className="text-xs text-slate-500">
                    Mode: <span className="capitalize">{selected.mode}</span> · Started{" "}
                    {new Date(selected.started_at).toLocaleString()}
                  </p>
                </div>

                <div className="space-y-2.5">
                  {selected.messages.map((m) => (
                    <div
                      key={m.id}
                      className={`rounded-lg border p-3 text-xs ${
                        m.role === "user"
                          ? "border-blue-200 bg-blue-50 text-slate-900"
                          : "border-slate-200 bg-slate-50 text-slate-800"
                      }`}
                    >
                      <span className="font-semibold uppercase text-slate-500">{m.role}</span>
                      <div className="mt-1">
                        {m.role === "assistant" ? (
                          <FormattedText content={m.content} />
                        ) : (
                          <p className="whitespace-pre-wrap">{m.content}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {selected.tool_executions.length > 0 && (
                  <div className="border-t border-slate-100 pt-3">
                    <h3 className="text-xs font-semibold text-slate-700">
                      Tool Execution Audit Trail
                    </h3>
                    <div className="mt-2 space-y-2">
                      {selected.tool_executions.map((t) => (
                        <div
                          key={t.id}
                          className="rounded border border-slate-200 bg-slate-50 p-2.5 text-[11px] text-slate-700"
                        >
                          <div className="flex items-center justify-between font-semibold">
                            <span>{t.tool_name}</span>
                            <span className="uppercase">{t.status}</span>
                          </div>
                          <p className="mt-1 truncate font-mono text-[10px] text-slate-500">
                            Req: {t.sanitized_request}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-slate-500">Select a conversation to view details.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
