"""Central AI orchestrator using Grok (xAI OpenAI-compatible) tool calling with deterministic fallback."""

import json
import re
from typing import Any, Dict, List, Optional

import httpx
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database.models import Conversation, Message, utc_now
from app.rules.policy_engine import (
    cancel_pending_confirmation,
    get_latest_pending_confirmation,
)
from app.security.auth import AuthenticatedUser, UserRole
from app.tools.registry import ToolExecutionResult, ToolRegistry

PRIVATE_KEYWORDS = (
    "my attendance",
    "my timetable",
    "my profile",
    "my grades",
    "my marks",
    "student profile",
    "student attendance",
    "pending leave",
    "pending requests",
    "approve leave",
    "reject leave",
    "apply for leave",
    "apply for od",
)

CONFIRM_WORDS = {"yes", "confirm", "yes confirm", "proceed", "go ahead", "approve it", "submit"}
CANCEL_WORDS = {"no", "cancel", "stop", "abort", "nevermind", "never mind"}


class AgentTurnResponse(BaseModel):
    conversation_id: str
    reply: str
    mode: str
    user_role: str
    tools_used: List[ToolExecutionResult] = []
    pending_confirmation: Optional[Dict[str, Any]] = None
    fallback_used: bool = False


class CollegeVoiceOrchestrator:
    """Single central orchestrator managing conversation state, RBAC, Grok tool calling, and fallback."""

    def __init__(self, tool_registry: Optional[ToolRegistry] = None):
        self.tools = tool_registry or ToolRegistry()

    def _build_system_prompt(self, user: AuthenticatedUser) -> str:
        base = (
            "You are the official voice AI assistant for Knotopian Institute of Technology. "
            "Keep responses clear, concise, accurate, and natural for text-to-speech playback (avoid markdown tables or raw JSON). "
            "CRITICAL RULES:\n"
            "1. Never invent fees, eligibility criteria, seat counts, exam dates, holidays, attendance numbers, or policies.\n"
            "2. Distinguish clearly between facts retrieved from official documents/College API and missing/unavailable information.\n"
            "3. Never claim a leave, OD, admission, or approval submission succeeded unless the tool returned status 'success'.\n"
            "4. Before submitting any consequential action (leave, OD, approval/rejection, admission submission), explain eligibility/details and ask explicit confirmation.\n"
            "5. Never ask for or accept a student_id/teacher_id from the user to override session identity.\n"
            "6. Document precedence: KIT Student Handbook 2026 supersedes 2025; Circular 12/2026 supersedes Rule 6.4.3 (B.Tech OD proof is 3 working days); Annexure E is an unadopted draft.\n"
        )
        if user.role == UserRole.PUBLIC:
            return base + (
                "\nCURRENT MODE: Public Visitor (unauthenticated).\n"
                "You may help with public admissions, courses, eligibility, fees, dates, and documents using official tools. "
                "You MUST refuse any request for private student or teacher information and direct them to log in."
            )
        if user.role == UserRole.STUDENT:
            return base + (
                f"\nCURRENT MODE: Authenticated Student ({user.display_name or user.user_id}).\n"
                "You may answer questions about their profile, attendance, timetable, exams, holidays, rules, "
                "leave/OD eligibility and applications, placement drives, and lesson notes."
            )
        return base + (
            f"\nCURRENT MODE: Authenticated Teacher ({user.display_name or user.user_id}).\n"
            "You may answer questions about their profile, pending student requests within scope, "
            "holidays, rules, and leave/OD review decisions after explicit confirmation."
        )

    def _get_or_create_conversation(
        self, db: Session, *, user: AuthenticatedUser, conversation_id: Optional[str], first_message: str
    ) -> Conversation:
        if conversation_id:
            conv = db.get(Conversation, conversation_id)
            if conv is not None and conv.user_id == user.user_id:
                return conv

        title = (first_message.strip()[:72] + "...") if len(first_message.strip()) > 72 else first_message.strip()
        conv = Conversation(
            user_id=user.user_id,
            user_role=user.role.value,
            mode=user.role.value,
            title=title or "Voice Conversation",
        )
        db.add(conv)
        db.commit()
        db.refresh(conv)
        return conv

    async def handle_message(
        self,
        *,
        db: Session,
        user: AuthenticatedUser,
        message: str,
        conversation_id: Optional[str] = None,
    ) -> AgentTurnResponse:
        clean_msg = message.strip()
        conv = self._get_or_create_conversation(
            db, user=user, conversation_id=conversation_id, first_message=clean_msg
        )

        db.add(Message(conversation_id=conv.id, role="user", content=clean_msg))
        conv.updated_at = utc_now()
        db.commit()

        pending = get_latest_pending_confirmation(db, conversation_id=conv.id, user_id=user.user_id)
        normalized = clean_msg.lower().rstrip(".!")
        if pending is not None and normalized in CANCEL_WORDS:
            cancel_pending_confirmation(db, confirmation_id=pending.id, user_id=user.user_id, conversation_id=conv.id)
            reply = "Okay, I have cancelled that pending request. Let me know if you need anything else."
            return self._finalize_turn(db, conv, user, reply, [])

        if pending is not None and normalized in CONFIRM_WORDS:
            tool_map = {
                "leave": "submit_leave_request",
                "od": "submit_od_request",
                "review_leave": "review_leave_request",
                "admission": "submit_admission_application",
                "cancel_request": "cancel_my_request",
                "register_placement": "register_placement",
            }
            tool_name = tool_map.get(pending.action_type)
            if tool_name:
                payload = json.loads(pending.payload_json)
                payload["confirmed"] = True
                payload["confirmation_id"] = pending.id
                res = await self.tools.execute(
                    tool_name=tool_name,
                    arguments=payload,
                    user=user,
                    db=db,
                    conversation_id=conv.id,
                )
                reply = self._format_confirmation_outcome(res)
                return self._finalize_turn(db, conv, user, reply, [res])

        if user.role == UserRole.PUBLIC and any(kw in clean_msg.lower() for kw in PRIVATE_KEYWORDS):
            reply = (
                "I cannot access private student or teacher records in public mode. "
                "Please log in with your student or teacher credentials first."
            )
            return self._finalize_turn(db, conv, user, reply, [])

        settings = get_settings()
        api_key = (settings.GROQ_API_KEY or settings.GROK_API_KEY).strip()
        if not api_key or api_key in ("your-grok-api-key-here", "your-groq-api-key-here"):
            reply, tool_results = await self._deterministic_fallback(
                db=db, user=user, message=clean_msg, conversation_id=conv.id, reason="Groq API key is not configured."
            )
            return self._finalize_turn(db, conv, user, reply, tool_results, fallback_used=True)

        try:
            reply, tool_results = await self._run_grok_turn(db=db, conv=conv, user=user)
            return self._finalize_turn(db, conv, user, reply, tool_results, fallback_used=False)
        except Exception as exc:
            reply, tool_results = await self._deterministic_fallback(
                db=db,
                user=user,
                message=clean_msg,
                conversation_id=conv.id,
                reason=f"Grok request failed ({type(exc).__name__}).",
            )
            return self._finalize_turn(db, conv, user, reply, tool_results, fallback_used=True)

    @staticmethod
    def _resolve_grok_base_url(configured_url: str, api_key: str) -> str:
        # Convenience: if user supplies a Groq key (`gsk_...`) while default is xAI, route cleanly;
        # otherwise respect configured GROK_BASE_URL (default https://api.x.ai/v1).
        base = configured_url.rstrip("/")
        if api_key.startswith("gsk_") and "api.x.ai" in base:
            return "https://api.groq.com/openai/v1"
        return base

    @staticmethod
    def _resolve_model_candidates(configured_model: str, base_url: str, api_key: str) -> List[str]:
        if api_key.startswith("gsk_") or "api.groq.com" in base_url:
            candidates = []
            if configured_model and not configured_model.startswith("grok-"):
                candidates.append(configured_model)
            for m in ("qwen/qwen3.8-27b", "openai/gpt-oss-120b", "openai/gpt-oss-20b"):
                if m not in candidates:
                    candidates.append(m)
            return candidates
        return [configured_model or "grok-3-mini"]

    async def _run_grok_turn(
        self,
        *,
        db: Session,
        conv: Conversation,
        user: AuthenticatedUser,
    ) -> tuple[str, List[ToolExecutionResult]]:
        settings = get_settings()
        api_key = (settings.GROQ_API_KEY or settings.GROK_API_KEY).strip()
        base_url = self._resolve_grok_base_url(settings.GROK_BASE_URL, api_key)
        model_candidates = self._resolve_model_candidates(settings.GROK_MODEL, base_url, api_key)
        grok_tools = self.tools.get_grok_tools_for_role(user.role)

        recent_msgs = (
            db.query(Message)
            .filter(Message.conversation_id == conv.id)
            .order_by(Message.created_at.desc())
            .limit(10)
            .all()
        )
        recent_msgs.reverse()

        messages: List[Dict[str, Any]] = [{"role": "system", "content": self._build_system_prompt(user)}]
        for m in recent_msgs:
            role = "user" if m.role == "user" else "assistant"
            messages.append({"role": role, "content": m.content})

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        executed_tools: List[ToolExecutionResult] = []

        async with httpx.AsyncClient(base_url=base_url, timeout=httpx.Timeout(settings.GROK_TIMEOUT_SECONDS)) as client:
            for _ in range(4):
                data: Optional[Dict[str, Any]] = None
                last_exc: Optional[Exception] = None
                for model_name in model_candidates:
                    payload: Dict[str, Any] = {
                        "model": model_name,
                        "messages": messages,
                        "temperature": 0.2,
                    }
                    if grok_tools:
                        payload["tools"] = grok_tools
                        payload["tool_choice"] = "auto"
                    try:
                        resp = await client.post("/chat/completions", headers=headers, json=payload)
                        if resp.status_code in (404, 429, 503):
                            last_exc = httpx.HTTPStatusError(
                                f"HTTP {resp.status_code}", request=resp.request, response=resp
                            )
                            continue
                        resp.raise_for_status()
                        data = resp.json()
                        break
                    except httpx.HTTPStatusError as exc:
                        last_exc = exc
                        if exc.response.status_code in (404, 429, 503):
                            continue
                        raise
                if data is None:
                    raise last_exc or RuntimeError("No LLM model succeeded.")

                choice = (data.get("choices") or [{}])[0]
                msg_obj = choice.get("message") or {}
                tool_calls = msg_obj.get("tool_calls") or []

                if not tool_calls:
                    text = str(msg_obj.get("content") or "").strip()
                    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
                    if not text:
                        text = "I processed your request, though no additional details were returned."
                    return text, executed_tools

                messages.append(
                    {
                        "role": "assistant",
                        "content": msg_obj.get("content") or "",
                        "tool_calls": tool_calls,
                    }
                )

                for tc in tool_calls:
                    fn = tc.get("function") or {}
                    tool_name = str(fn.get("name") or "")
                    raw_args = fn.get("arguments") or "{}"
                    try:
                        parsed_args = json.loads(raw_args) if isinstance(raw_args, str) else dict(raw_args)
                    except ValueError:
                        parsed_args = {}

                    res = await self.tools.execute(
                        tool_name=tool_name,
                        arguments=parsed_args,
                        user=user,
                        db=db,
                        conversation_id=conv.id,
                    )
                    executed_tools.append(res)
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tc.get("id", tool_name),
                            "content": json.dumps({"status": res.status, "data": res.data}, default=str),
                        }
                    )

        return "I completed the tool lookups, but reached the maximum reasoning steps. Please rephrase your question.", executed_tools

    async def _deterministic_fallback(
        self,
        *,
        db: Session,
        user: AuthenticatedUser,
        message: str,
        conversation_id: str,
        reason: str,
    ) -> tuple[str, List[ToolExecutionResult]]:
        """Provide safe, permission-checked deterministic handling when Grok is unavailable."""
        low = message.lower()
        results: List[ToolExecutionResult] = []

        if any(k in low for k in ("course", "admission", "fee", "eligib", "seat", "date", "document")):
            res = await self.tools.execute(
                tool_name="get_admission_info",
                arguments={"topic": message},
                user=user,
                db=db,
                conversation_id=conversation_id,
            )
            results.append(res)
            if res.status == "success":
                courses = res.data.get("courses") or []
                if courses:
                    summary_lines = [
                        f"{c.get('name')} ({c.get('code')}): min 12th {c.get('min_12th_percent')}%, "
                        f"annual fee ₹{c.get('annual_fee')}, seats {c.get('seats')}"
                        for c in courses[:5]
                    ]
                    return "Available courses: " + "; ".join(summary_lines), results
            matches = res.data.get("document_matches") or []
            if matches:
                top = matches[0]
                return f"From {top['filename']} (page {top['page_number']}): {top['content'][:450]}", results
            return self._format_fallback_api_result("admission info", res, reason), results

        if any(k in low for k in ("dbms", "rule", "handbook", "circular", "note")):
            tool_name = "get_college_rules" if ("rule" in low and user.role != UserRole.PUBLIC) else "search_college_documents"
            res = await self.tools.execute(
                tool_name=tool_name,
                arguments={"query": message},
                user=user,
                db=db,
                conversation_id=conversation_id,
            )
            results.append(res)
            matches = res.data.get("matches") or res.data.get("document_matches") or []
            if matches:
                top = matches[0]
                return (
                    f"From {top['filename']} (page {top['page_number']}): {top['content'][:450]}",
                    results,
                )
            return (
                "No official college brochure, rulebook, or lesson PDFs have been indexed yet, and the AI "
                f"orchestrator is in fallback mode ({reason}).",
                results,
            )

        if user.role == UserRole.STUDENT:
            if "attendance" in low:
                res = await self.tools.execute(
                    tool_name="get_attendance", arguments={}, user=user, db=db, conversation_id=conversation_id
                )
                results.append(res)
                return self._format_fallback_api_result("attendance", res, reason), results
            if "timetable" in low or "schedule" in low:
                res = await self.tools.execute(
                    tool_name="get_timetable", arguments={}, user=user, db=db, conversation_id=conversation_id
                )
                results.append(res)
                return self._format_fallback_api_result("timetable", res, reason), results
            if "exam" in low:
                res = await self.tools.execute(
                    tool_name="get_exam_dates", arguments={}, user=user, db=db, conversation_id=conversation_id
                )
                results.append(res)
                return self._format_fallback_api_result("exam dates", res, reason), results
            if "holiday" in low:
                res = await self.tools.execute(
                    tool_name="get_holidays", arguments={}, user=user, db=db, conversation_id=conversation_id
                )
                results.append(res)
                return self._format_fallback_api_result("holidays", res, reason), results

        if user.role == UserRole.TEACHER and ("pending" in low or "leave" in low):
            res = await self.tools.execute(
                tool_name="get_pending_requests", arguments={}, user=user, db=db, conversation_id=conversation_id
            )
            results.append(res)
            return self._format_fallback_api_result("pending requests", res, reason), results

        return (
            f"I am running in deterministic fallback mode because {reason} "
            "I can still search uploaded official PDFs or run basic College API checks once connected.",
            results,
        )

    @staticmethod
    def _format_fallback_api_result(label: str, res: ToolExecutionResult, reason: str) -> str:
        if res.status == "success":
            return f"Here is your {label} data from the College API: {json.dumps(res.data)}"
        err = res.data.get("error", "Service unavailable")
        return f"I could not retrieve {label} because the College API reported: {err} (Fallback reason: {reason})"

    @staticmethod
    def _format_confirmation_outcome(res: ToolExecutionResult) -> str:
        if res.status == "success":
            ref = res.data.get("id") or res.data.get("reference_id") or res.data.get("request_id")
            suffix = f" Reference ID: {ref}." if ref else ""
            return f"Your request has been submitted and confirmed by the College API.{suffix}"
        err = res.data.get("error", "The external College API could not complete the request.")
        return f"Submission did not succeed: {err}"

    @staticmethod
    def _finalize_turn(
        db: Session,
        conv: Conversation,
        user: AuthenticatedUser,
        reply: str,
        tools_used: List[ToolExecutionResult],
        fallback_used: bool = False,
    ) -> AgentTurnResponse:
        db.add(Message(conversation_id=conv.id, role="assistant", content=reply))
        conv.updated_at = utc_now()
        db.commit()

        pending_info = None
        for t in tools_used:
            if t.status == "pending_confirmation":
                pending_info = t.data
                break

        return AgentTurnResponse(
            conversation_id=conv.id,
            reply=reply,
            mode=user.role.value,
            user_role=user.role.value,
            tools_used=tools_used,
            pending_confirmation=pending_info,
            fallback_used=fallback_used,
        )
