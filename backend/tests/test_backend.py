"""Comprehensive backend tests covering RBAC, privacy, PDF knowledge, policy rules, history isolation, and failure handling."""

import base64
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Ensure backend/ is importable
BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("SESSION_SECRET_KEY", "test-secret-key-for-unit-tests")
os.environ.setdefault("GROK_API_KEY", "")

from app.database.models import Base, Conversation, Message, UserSession
from app.database.session import get_db
from app.integrations.college_api import CollegeAPIUnavailableError, OpenAPISpecSummary
from app.knowledge.pdf_service import ingest_pdf_bytes, retrieve_relevant_chunks
from app.main import create_app
from app.rules.policy_engine import (
    consume_pending_confirmation,
    create_pending_confirmation,
    resolve_college_date,
    validate_leave_eligibility,
    validate_od_eligibility,
)
from app.security.auth import AuthenticatedUser, UserRole, create_user_session, set_session_cookie
from app.security.sanitizer import redact_sensitive_data
from app.tools.registry import ToolRegistry
from app.config import get_settings

cookie_name = get_settings().SESSION_COOKIE_NAME


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def client(db_session):
    app = create_app()

    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client


def _make_fake_jwt(exp_offset_seconds: int = 3600) -> str:
    header = base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()).decode().rstrip("=")
    exp = int((datetime.now(timezone.utc) + timedelta(seconds=exp_offset_seconds)).timestamp())
    payload = base64.urlsafe_b64encode(json.dumps({"sub": "stu_101", "exp": exp}).encode()).decode().rstrip("=")
    return f"{header}.{payload}.sig"


def test_sanitizer_redacts_secrets_and_jwts():
    raw = {
        "username": "arjun",
        "password": "my-secret-password",
        "nested": {"Authorization": "Bearer eyJabc.def.ghi", "token": "xyz123"},
        "note": "Token is eyJaaaa.bbbb.cccc in logs",
    }
    cleaned = redact_sensitive_data(raw)
    assert cleaned["password"] == "[REDACTED]"
    assert cleaned["nested"]["Authorization"] == "[REDACTED]"
    assert cleaned["nested"]["token"] == "[REDACTED]"
    assert "[REDACTED_JWT]" in cleaned["note"]


def _build_minimal_pdf(text: str) -> bytes:
    """Create a minimal valid single-page PDF containing the given ASCII text."""
    escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    stream = f"BT /F1 12 Tf 72 720 Td ({escaped}) Tj ET".encode("latin-1")
    objects = [
        b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
        b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
        b"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n",
        f"4 0 obj << /Length {len(stream)} >> stream\n".encode("latin-1") + stream + b"\nendstream endobj\n",
        b"5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for obj in objects:
        offsets.append(len(out))
        out.extend(obj)
    xref_pos = len(out)
    out.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode("latin-1"))
    for off in offsets[1:]:
        out.extend(f"{off:010d} 00000 n \n".encode("latin-1"))
    out.extend(f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode("latin-1"))
    return bytes(out)


def test_pdf_ingestion_and_retrieval(db_session):
    pdf_bytes = _build_minimal_pdf(
        "Knotopian Institute of Technology Official Rulebook: Minimum attendance requirement is 75 percent. "
        "Leave applications are strictly prohibited on examination days."
    )

    stored = ingest_pdf_bytes(db_session, filename="college_rulebook.pdf", raw_bytes=pdf_bytes, doc_type="rulebook")
    assert stored.page_count == 1
    assert stored.char_count > 50

    matches = retrieve_relevant_chunks(db_session, "minimum attendance examination leave", doc_types=["rulebook"])
    assert len(matches) == 1
    assert "75 percent" in matches[0].content
    assert matches[0].filename == "college_rulebook.pdf"


def test_leave_and_od_validation_rules():
    tomorrow = resolve_college_date("tomorrow")
    assert tomorrow is not None

    # Low attendance fails
    res_low = validate_leave_eligibility(
        requested_date=tomorrow.isoformat(),
        reason="Medical appointment",
        attendance_percentage=68.5,
    )
    assert not res_low.eligible
    assert any("below the required 75.0%" in r for r in res_low.reasons)

    # Exam conflict fails
    res_exam = validate_leave_eligibility(
        requested_date=tomorrow.isoformat(),
        reason="Family event",
        attendance_percentage=85.0,
        exams_on_date=[{"subject": "DBMS"}],
    )
    assert not res_exam.eligible
    assert any("examination day" in r for r in res_exam.reasons)

    # OD validation requires event_name
    res_od_missing = validate_od_eligibility(
        requested_date=tomorrow.isoformat(),
        reason="Hackathon",
        event_name="",
    )
    assert not res_od_missing.eligible
    assert "event_name" in res_od_missing.missing_fields


@pytest.mark.asyncio
async def test_rbac_blocks_public_from_student_and_teacher_tools(db_session):
    registry = ToolRegistry()
    public_user = AuthenticatedUser(user_id="pub_1", role=UserRole.PUBLIC, is_authenticated=False)
    conv = Conversation(user_id="pub_1", user_role="public", mode="public", title="Test")
    db_session.add(conv)
    db_session.commit()

    for forbidden_tool in ("get_attendance", "get_student_profile", "get_pending_requests", "review_leave_request"):
        res = await registry.execute(
            tool_name=forbidden_tool,
            arguments={},
            user=public_user,
            db=db_session,
            conversation_id=conv.id,
        )
        assert res.status == "blocked"


def test_public_user_privacy_and_history_isolation(client, db_session):
    # Public chat asking for private student attendance is deterministically refused
    with patch("app.integrations.college_api.CollegeAPIClient.fetch_openapi_spec", new_callable=AsyncMock) as mock_spec:
        mock_spec.return_value = OpenAPISpecSummary(available=False, base_url="https://example.invalid", error="404")
        resp = client.post("/api/chat", json={"message": "What is my attendance?"})
    assert resp.status_code == 200
    data = resp.json()
    assert "log in" in data["reply"].lower()
    conv_id = data["conversation_id"]

    # Another user session must not access the first user's conversation history
    other_session = create_user_session(
        db_session,
        user_id="stu_999",
        role=UserRole.STUDENT,
        display_name="Other Student",
        college_jwt=_make_fake_jwt(),
    )
    from fastapi import Response
    temp_resp = Response()
    set_session_cookie(temp_resp, other_session.id)
    raw_cookie = temp_resp.headers["set-cookie"].split(";")[0].split("=", 1)[1]

    client.cookies.set(cookie_name, raw_cookie)
    hist_detail = client.get(f"/api/history/{conv_id}")
    assert hist_detail.status_code == 403


def test_expired_jwt_session_rejected(client, db_session):
    expired_session = create_user_session(
        db_session,
        user_id="stu_expired",
        role=UserRole.STUDENT,
        display_name="Expired",
        college_jwt=_make_fake_jwt(exp_offset_seconds=-120),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
    )
    from fastapi import Response
    temp_resp = Response()
    set_session_cookie(temp_resp, expired_session.id)
    raw_cookie = temp_resp.headers["set-cookie"].split(";")[0].split("=", 1)[1]

    client.cookies.set(cookie_name, raw_cookie)
    res = client.get("/api/auth/me")
    assert res.status_code == 401


def test_login_returns_503_when_college_api_unavailable(client):
    with patch(
        "app.integrations.college_api.CollegeAPIClient.login",
        new_callable=AsyncMock,
        side_effect=CollegeAPIUnavailableError("External College API returned 404 Application not found", status_code=503),
    ):
        res = client.post("/api/auth/login", json={"login_id": "arjun", "password": "secret"})
    assert res.status_code == 503
    assert "404" in res.json()["detail"]


def test_login_uses_kit_contract_and_sets_httponly_cookie(client):
    fake_jwt = _make_fake_jwt(28800)
    with patch(
        "app.integrations.college_api.CollegeAPIClient.login",
        new_callable=AsyncMock,
        return_value={
            "access_token": fake_jwt,
            "token_type": "bearer",
            "expires_in": 28800,
            "user": {
                "id": 1,
                "login_id": "arjun",
                "full_name": "Arjun K",
                "role": "student",
                "department": "CSE",
            },
        },
    ):
        res = client.post("/api/auth/login", json={"login_id": "arjun", "password": "Kit@2026"})

    assert res.status_code == 200
    body = res.json()
    assert body["role"] == "student"
    assert body["display_name"] == "Arjun K"
    assert "access_token" not in body
    assert cookie_name in res.headers.get("set-cookie", "")


@pytest.mark.asyncio
async def test_leave_workflow_checks_calendar_and_submits_after_confirmation(db_session):
    registry = ToolRegistry()
    student = AuthenticatedUser(
        user_id="1",
        role=UserRole.STUDENT,
        display_name="Arjun K",
        is_authenticated=True,
        college_jwt=_make_fake_jwt(),
    )
    conv = Conversation(user_id="1", user_role="student", mode="student", title="Leave")
    db_session.add(conv)
    db_session.commit()

    with (
        patch("app.integrations.college_api.CollegeAPIClient.get_today", new_callable=AsyncMock, return_value={"date": "2026-11-20"}),
        patch("app.integrations.college_api.CollegeAPIClient.get_me", new_callable=AsyncMock, return_value={"programme": "UG"}),
        patch("app.integrations.college_api.CollegeAPIClient.get_my_attendance", new_callable=AsyncMock, return_value={"overall_percentage": 82.0}),
        patch(
            "app.integrations.college_api.CollegeAPIClient.get_calendar",
            new_callable=AsyncMock,
            return_value=[{"id": 1, "date": "2026-11-23", "type": "internal_exam", "title": "DBMS Internal", "status": "active"}],
        ),
    ):
        # Exam day conflict must be rejected deterministically
        conflict = await registry.execute(
            tool_name="check_leave_eligibility",
            arguments={"date": "2026-11-23", "reason": "Family event"},
            user=student,
            db=db_session,
            conversation_id=conv.id,
        )
        assert conflict.status == "success"
        assert conflict.data["eligible"] is False
        assert any("internal assessment" in r.lower() for r in conflict.data["reasons"])

    # Clean day -> pending_confirmation -> confirmed submission
    with (
        patch("app.integrations.college_api.CollegeAPIClient.get_today", new_callable=AsyncMock, return_value={"date": "2026-11-20"}),
        patch("app.integrations.college_api.CollegeAPIClient.get_me", new_callable=AsyncMock, return_value={"programme": "UG"}),
        patch("app.integrations.college_api.CollegeAPIClient.get_my_attendance", new_callable=AsyncMock, return_value={"overall_percentage": 82.0}),
        patch("app.integrations.college_api.CollegeAPIClient.get_calendar", new_callable=AsyncMock, return_value=[]),
        patch(
            "app.integrations.college_api.CollegeAPIClient.create_request",
            new_callable=AsyncMock,
            return_value={"id": 42, "status": "pending", "type": "personal_leave"},
        ) as mock_create,
    ):
        step1 = await registry.execute(
            tool_name="submit_leave_request",
            arguments={"date": "2026-11-24", "reason": "Family function"},
            user=student,
            db=db_session,
            conversation_id=conv.id,
        )
        assert step1.status == "pending_confirmation"
        conf_id = step1.data["confirmation_id"]
        assert mock_create.call_count == 0

        step2 = await registry.execute(
            tool_name="submit_leave_request",
            arguments={"date": "2026-11-24", "reason": "Family function", "confirmed": True, "confirmation_id": conf_id},
            user=student,
            db=db_session,
            conversation_id=conv.id,
        )
        assert step2.status == "success"
        assert step2.data["id"] == 42
        assert mock_create.call_count == 1


@pytest.mark.asyncio
async def test_timetable_resolves_follows_weekday_override(db_session):
    registry = ToolRegistry()
    student = AuthenticatedUser(
        user_id="1",
        role=UserRole.STUDENT,
        display_name="Arjun K",
        is_authenticated=True,
        college_jwt=_make_fake_jwt(),
    )
    conv = Conversation(user_id="1", user_role="student", mode="student", title="Timetable")
    db_session.add(conv)
    db_session.commit()

    slots = [
        {"id": 1, "weekday": 1, "period": 1, "start_time": "09:00", "end_time": "09:50", "subject_code": "CS304", "subject_name": "DBMS"},
        {"id": 2, "weekday": 6, "period": 1, "start_time": "09:00", "end_time": "09:50", "subject_code": "CS301", "subject_name": "OS"},
    ]
    with (
        patch("app.integrations.college_api.CollegeAPIClient.get_today", new_callable=AsyncMock, return_value={"date": "2026-11-20"}),
        patch("app.integrations.college_api.CollegeAPIClient.get_my_timetable", new_callable=AsyncMock, return_value=slots),
        patch(
            "app.integrations.college_api.CollegeAPIClient.get_calendar",
            new_callable=AsyncMock,
            return_value=[{"id": 9, "date": "2026-11-21", "type": "working_day", "title": "Monday Timetable", "follows_weekday": 1, "status": "active"}],
        ),
    ):
        res = await registry.execute(
            tool_name="get_timetable",
            arguments={"day": "tomorrow"},
            user=student,
            db=db_session,
            conversation_id=conv.id,
        )
        assert res.status == "success"
        assert res.data["effective_weekday"] == 1
        assert len(res.data["slots"]) == 1
        assert res.data["slots"][0]["subject_code"] == "CS304"


def test_confirmation_single_use(db_session):
    conv = Conversation(user_id="stu_1", user_role="student", mode="student", title="Leave")
    db_session.add(conv)
    db_session.commit()

    pending = create_pending_confirmation(
        db_session,
        conversation_id=conv.id,
        user_id="stu_1",
        action_type="leave",
        payload={"date": "2026-11-20", "reason": "Medical"},
    )
    first = consume_pending_confirmation(
        db_session, confirmation_id=pending.id, user_id="stu_1", conversation_id=conv.id
    )
    assert first is not None
    # Replay must fail
    second = consume_pending_confirmation(
        db_session, confirmation_id=pending.id, user_id="stu_1", conversation_id=conv.id
    )
    assert second is None


@pytest.mark.asyncio
async def test_grok_orchestrator_tool_calling(db_session):
    from unittest.mock import MagicMock
    from app.agent.orchestrator import CollegeVoiceOrchestrator

    assert CollegeVoiceOrchestrator._resolve_grok_base_url("https://api.x.ai/v1", "xai-123") == "https://api.x.ai/v1"
    assert CollegeVoiceOrchestrator._resolve_grok_base_url("https://api.x.ai/v1", "gsk_123") == "https://api.groq.com/openai/v1"

    first_resp = MagicMock()
    first_resp.raise_for_status = MagicMock()
    first_resp.json.return_value = {
        "choices": [
            {
                "message": {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [
                        {
                            "id": "call_1",
                            "type": "function",
                            "function": {"name": "search_college_documents", "arguments": '{"query": "attendance"}'},
                        }
                    ],
                }
            }
        ]
    }
    second_resp = MagicMock()
    second_resp.raise_for_status = MagicMock()
    second_resp.json.return_value = {
        "choices": [{"message": {"role": "assistant", "content": "Minimum B.Tech attendance is 75 percent."}}]
    }

    with (
        patch.dict(os.environ, {"GROK_API_KEY": "xai-test-key"}),
        patch("httpx.AsyncClient.post", new_callable=AsyncMock, side_effect=[first_resp, second_resp]),
    ):
        get_settings.cache_clear()
        orch = CollegeVoiceOrchestrator()
        public_user = AuthenticatedUser(user_id="pub_grok", role=UserRole.PUBLIC, is_authenticated=False)
        res = await orch.handle_message(db=db_session, user=public_user, message="What is minimum attendance?")
        assert res.fallback_used is False
        assert res.tools_used[0].tool_name == "search_college_documents"
        assert "75 percent" in res.reply
    get_settings.cache_clear()
