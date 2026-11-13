'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface ConversationItem {
  id: string;
  user_id: string;
  role: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface MessageItem {
  id: string;
  sender: 'user' | 'assistant' | 'system';
  message: string;
  created_at: string;
}

interface ToolExecItem {
  id: string;
  tool_name: string;
  execution_status: string;
  result_summary: string | null;
  created_at: string;
}

export default function HistoryPage() {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [toolExecs, setToolExecs] = useState<ToolExecItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    fetch('/api/history')
      .then((res) => res.json())
      .then((data) => {
        if (data.conversations) {
          setConversations(data.conversations);
          if (data.conversations.length > 0) {
            loadConversationDetails(data.conversations[0].id);
          }
        }
      })
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  async function loadConversationDetails(id: string) {
    setSelectedConvId(id);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/history/${id}`);
      const data = await res.json();
      if (data.success) {
        setMessages(data.messages || []);
        setToolExecs(data.toolExecutions || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <div className="flex-1 max-w-7xl mx-auto w-full p-4 sm:p-6 lg:p-8 flex flex-col">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0E625E]">Conversation History</h1>
          <p className="text-xs text-slate-500 mt-1">
            Persisted SQLite conversation sessions and tool execution audit logs.
          </p>
        </div>
        <Link
          href="/assistant"
          className="px-4 py-2 rounded-lg bg-[#F47F20] hover:bg-[#D66710] text-white text-xs font-semibold shadow transition-colors flex items-center gap-1.5"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>New Voice Session</span>
        </Link>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
          Loading conversation history...
        </div>
      ) : conversations.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-12 bg-white rounded-2xl border border-slate-200 text-center">
          <div className="w-12 h-12 rounded-full bg-teal-50 text-[#0E625E] flex items-center justify-center mb-4">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <h3 className="font-bold text-slate-800 text-base">No previous conversations found</h3>
          <p className="text-xs text-slate-500 max-w-sm mt-1">
            Start a voice or text session with KIT Assistant to begin building conversation history.
          </p>
          <Link
            href="/assistant"
            className="mt-5 px-5 py-2.5 rounded-lg bg-[#0E625E] text-white text-xs font-semibold"
          >
            Launch Voice Assistant
          </Link>
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-6 min-h-[500px]">
          {/* Conversation List Sidebar */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-100 font-bold text-sm text-slate-800 bg-slate-50">
              Saved Sessions ({conversations.length})
            </div>
            <div className="divide-y divide-slate-100 overflow-y-auto flex-1">
              {conversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => loadConversationDetails(conv.id)}
                  className={`w-full text-left p-4 transition-colors flex flex-col gap-1 ${
                    selectedConvId === conv.id
                      ? 'bg-teal-50/80 border-l-4 border-[#0E625E]'
                      : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-800 truncate max-w-[180px]">
                      {conv.title || 'Untitled Conversation'}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {new Date(conv.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span className="capitalize">{conv.role} session</span>
                    <span className="text-[10px]">
                      {new Date(conv.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Conversation Thread & Details View */}
          <div className="md:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
            {selectedConvId && (
              <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-sm text-slate-800">
                    {conversations.find((c) => c.id === selectedConvId)?.title}
                  </h3>
                  <span className="text-[11px] text-slate-500">
                    ID: {selectedConvId}
                  </span>
                </div>

                <Link
                  href={`/assistant?convId=${selectedConvId}`}
                  className="px-3 py-1.5 rounded-lg bg-teal-50 hover:bg-teal-100 text-[#0E625E] font-semibold text-xs border border-teal-200 transition-colors"
                >
                  Resume in Assistant →
                </Link>
              </div>
            )}

            <div className="flex-1 p-6 overflow-y-auto space-y-4">
              {detailLoading ? (
                <div className="text-center py-12 text-slate-400 text-sm">
                  Loading messages...
                </div>
              ) : messages.length === 0 ? (
                <div className="text-center py-12 text-slate-400 text-sm">
                  No messages in this conversation.
                </div>
              ) : (
                messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex flex-col ${
                      m.sender === 'user' ? 'items-end' : 'items-start'
                    }`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl p-4 text-sm leading-relaxed ${
                        m.sender === 'user'
                          ? 'bg-[#0E625E] text-white rounded-br-xs'
                          : 'bg-slate-100 text-slate-800 rounded-bl-xs border border-slate-200/80'
                      }`}
                    >
                      <div className="text-[10px] uppercase font-bold tracking-wider mb-1 opacity-70">
                        {m.sender === 'user' ? 'User' : 'KIT Assistant'}
                      </div>
                      <div className="whitespace-pre-wrap">{m.message}</div>
                    </div>
                    <span className="text-[10px] text-slate-400 mt-1 px-1">
                      {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))
              )}

              {/* Tool Execution Audit Log Box */}
              {toolExecs.length > 0 && (
                <div className="mt-8 pt-6 border-t border-slate-200">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                    Audit Log: College API Tool Calls ({toolExecs.length})
                  </h4>
                  <div className="space-y-2">
                    {toolExecs.map((tx) => (
                      <div
                        key={tx.id}
                        className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs flex items-start justify-between gap-3"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-semibold text-slate-800">
                              {tx.tool_name}
                            </span>
                            <span
                              className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                                tx.execution_status === 'success'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-rose-100 text-rose-800'
                              }`}
                            >
                              {tx.execution_status}
                            </span>
                          </div>
                          {tx.result_summary && (
                            <p className="text-slate-600 mt-1">{tx.result_summary}</p>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400 whitespace-nowrap">
                          {new Date(tx.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
