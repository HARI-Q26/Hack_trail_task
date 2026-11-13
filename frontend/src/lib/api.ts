// Default to same-origin `/api/...` (proxied by Next.js rewrites) so HTTP-only session
// cookies stay first-party on both localhost and *.trycloudflare.com tunnels.
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_USE_DIRECT_API === "true"
    ? process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, "") || "http://localhost:8000"
    : "";

export type UserRole = "public" | "student" | "teacher";

export interface UserProfile {
  user_id: string;
  role: UserRole;
  display_name: string;
  is_authenticated: boolean;
}

export interface ToolExecutionSummary {
  tool_name: string;
  status: string;
  data: Record<string, unknown>;
}

export interface ChatResponse {
  conversation_id: string;
  reply: string;
  mode: UserRole;
  user_role: UserRole;
  tools_used: ToolExecutionSummary[];
  pending_confirmation?: {
    confirmation_id?: string;
    action_type?: string;
    payload?: Record<string, unknown>;
    message?: string;
  } | null;
  fallback_used: boolean;
}

export interface ConversationSummary {
  id: string;
  user_role: string;
  mode: string;
  title: string;
  started_at: string;
  updated_at: string;
  message_count: number;
}

export interface MessageItem {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}

export interface ToolExecutionAuditItem {
  id: string;
  tool_name: string;
  status: string;
  sanitized_request: string;
  sanitized_response: string;
  executed_at: string;
}

export interface ConversationDetail {
  id: string;
  user_role: string;
  mode: string;
  title: string;
  started_at: string;
  updated_at: string;
  messages: MessageItem[];
  tool_executions: ToolExecutionAuditItem[];
}

export interface KnowledgeDocument {
  id: string;
  filename: string;
  doc_type: string;
  page_count: number;
  char_count: number;
  uploaded_at: string;
}

export interface CollegeStatusResponse {
  available: boolean;
  base_url: string;
  title?: string | null;
  version?: string | null;
  paths: Record<string, string[]>;
  error?: string | null;
}

export interface CourseItem {
  id: number;
  code: string;
  name: string;
  department: string;
  min_12th_percent: number;
  annual_fee: number;
  hostel_fee: number;
  seats: number;
}

export interface CollegeOverviewInfo {
  name: string;
  code: string;
  tagline: string;
  description: string;
  contact: {
    phone: string;
    email: string;
    website: string;
    address: string;
  };
}

export interface PublicOverviewResponse {
  connected: boolean;
  college: CollegeOverviewInfo | null;
  courses: CourseItem[];
  today: {
    date: string;
    weekday: number;
    weekday_name: string;
    timezone: string;
  } | null;
  remote_documents: Array<{
    id: number;
    title: string;
    type: string;
    version: string;
    effective_date: string;
  }>;
  indexed_documents: Array<{
    id: string;
    filename: string;
    doc_type: string;
    page_count: number;
  }>;
  error?: string | null;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  if (!res.ok) {
    let message = `Request failed with HTTP ${res.status}`;
    try {
      const errBody = await res.json();
      if (typeof errBody?.detail === "string") {
        message = errBody.detail;
      }
    } catch {
      // ignore non-JSON error body
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getMe: () => apiFetch<UserProfile>("/api/auth/me"),
  login: (payload: { login_id: string; password: string; role_hint?: "student" | "teacher" }) =>
    apiFetch<UserProfile>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  logout: () =>
    apiFetch<{ status: string }>("/api/auth/logout", {
      method: "POST",
    }),
  chat: (payload: { message: string; conversation_id?: string | null }, signal?: AbortSignal) =>
    apiFetch<ChatResponse>("/api/chat", {
      method: "POST",
      body: JSON.stringify(payload),
      signal,
    }),
  listHistory: () => apiFetch<ConversationSummary[]>("/api/history"),
  getHistoryDetail: (conversationId: string) =>
    apiFetch<ConversationDetail>(`/api/history/${encodeURIComponent(conversationId)}`),
  getKnowledgeDocuments: () => apiFetch<KnowledgeDocument[]>("/api/knowledge/documents"),
  syncKnowledgeFromCollege: () =>
    apiFetch<{ synced_count: number; documents: Array<{ id: string; filename: string; pages: number }> }>(
      "/api/knowledge/sync",
      { method: "POST" }
    ),
  uploadKnowledgePdf: async (file: File, docType = "auto"): Promise<KnowledgeDocument> => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("doc_type", docType);
    const res = await fetch(`${API_BASE_URL}/api/knowledge/upload`, {
      method: "POST",
      credentials: "include",
      body: formData,
    });
    if (!res.ok) {
      let message = `Upload failed with HTTP ${res.status}`;
      try {
        const errBody = await res.json();
        if (typeof errBody?.detail === "string") message = errBody.detail;
      } catch {
        // ignore
      }
      throw new Error(message);
    }
    return res.json() as Promise<KnowledgeDocument>;
  },
  transcribeVoice: async (audioBlob: Blob): Promise<{ text: string }> => {
    const formData = new FormData();
    formData.append("file", audioBlob, "audio.webm");
    const res = await fetch(`${API_BASE_URL}/api/voice/transcribe`, {
      method: "POST",
      credentials: "include",
      body: formData,
    });
    if (!res.ok) {
      let message = `Transcription failed with HTTP ${res.status}`;
      try {
        const errBody = await res.json();
        if (typeof errBody?.detail === "string") message = errBody.detail;
      } catch {
        // ignore
      }
      throw new Error(message);
    }
    return res.json() as Promise<{ text: string }>;
  },
  getCollegeStatus: () => apiFetch<CollegeStatusResponse>("/api/college/status"),
  getPublicOverview: () => apiFetch<PublicOverviewResponse>("/api/public/overview"),
};

