"""Pydantic request and response schemas for the FastAPI endpoints."""

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    login_id: Optional[str] = Field(default=None, min_length=1, max_length=200)
    username: Optional[str] = Field(default=None, min_length=1, max_length=200)
    password: str = Field(..., min_length=1, max_length=200)
    role_hint: Optional[str] = Field(default=None, pattern="^(student|teacher)$")

    @property
    def resolved_login_id(self) -> str:
        val = (self.login_id or self.username or "").strip()
        if not val:
            raise ValueError("login_id is required")
        return val


class UserProfileResponse(BaseModel):
    user_id: str
    role: str
    display_name: str
    is_authenticated: bool


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    conversation_id: Optional[str] = None


class ToolExecutionSummary(BaseModel):
    tool_name: str
    status: str
    data: Dict[str, Any] = {}


class ChatResponse(BaseModel):
    conversation_id: str
    reply: str
    mode: str
    user_role: str
    tools_used: List[ToolExecutionSummary] = []
    pending_confirmation: Optional[Dict[str, Any]] = None
    fallback_used: bool = False


class ConversationSummary(BaseModel):
    id: str
    user_role: str
    mode: str
    title: str
    started_at: datetime
    updated_at: datetime
    message_count: int


class MessageItem(BaseModel):
    id: str
    role: str
    content: str
    created_at: datetime


class ToolExecutionAuditItem(BaseModel):
    id: str
    tool_name: str
    status: str
    sanitized_request: str
    sanitized_response: str
    executed_at: datetime


class ConversationDetailResponse(BaseModel):
    id: str
    user_role: str
    mode: str
    title: str
    started_at: datetime
    updated_at: datetime
    messages: List[MessageItem]
    tool_executions: List[ToolExecutionAuditItem]


class KnowledgeDocumentResponse(BaseModel):
    id: str
    filename: str
    doc_type: str
    page_count: int
    char_count: int
    uploaded_at: datetime

