"""FastAPI HTTP endpoints for auth, voice/text chat, conversation history, knowledge PDFs, and public overview."""

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.agent.orchestrator import CollegeVoiceOrchestrator
from app.api.schemas import (
    ChatRequest,
    ChatResponse,
    ConversationDetailResponse,
    ConversationSummary,
    KnowledgeDocumentResponse,
    LoginRequest,
    MessageItem,
    ToolExecutionAuditItem,
    ToolExecutionSummary,
    UserProfileResponse,
)
from app.config import get_settings
from app.database.models import Conversation, Message
from app.database.session import get_db
from app.integrations.college_api import (
    CollegeAPIAuthError,
    CollegeAPIClient,
    CollegeAPIError,
    CollegeAPIUnavailableError,
    CollegeOperationNotSupportedError,
)
from app.knowledge.pdf_service import infer_doc_type, ingest_pdf_bytes, list_documents
from app.security.auth import (
    AuthenticatedUser,
    UserRole,
    clear_session_cookie,
    create_user_session,
    delete_user_session,
    get_current_user,
    set_session_cookie,
)

router = APIRouter(prefix="/api")
orchestrator = CollegeVoiceOrchestrator()


@router.get("/health")
async def health_check(db: Session = Depends(get_db)):
    """Report backend, database, Grok config, participant key status, and College API OpenAPI status."""
    settings = get_settings()
    db_ok = True
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        db_ok = False

    college_client = CollegeAPIClient()
    college_status = await college_client.fetch_openapi_spec()
    grok_configured = bool(
        settings.GROK_API_KEY.strip() and settings.GROK_API_KEY.strip() != "your-grok-api-key-here"
    )
    participant_key_configured = bool(
        settings.COLLEGE_PARTICIPANT_KEY.strip()
        and settings.COLLEGE_PARTICIPANT_KEY.strip() != "your-participant-key-from-access-card"
    )

    return {
        "status": "ok" if db_ok else "degraded",
        "database": "connected" if db_ok else "error",
        "grok_configured": grok_configured,
        "grok_model": settings.GROK_MODEL,
        "participant_key_configured": participant_key_configured,
        "college_api": college_status.model_dump(),
        "timezone": settings.COLLEGE_TIMEZONE,
    }


@router.get("/college/status")
async def college_api_status():
    """Expose College API OpenAPI inspection status."""
    client = CollegeAPIClient()
    summary = await client.fetch_openapi_spec(force_refresh=False)
    return summary.model_dump()


@router.get("/public/overview")
async def public_overview(db: Session = Depends(get_db)):
    """Fetch live college info, courses, today's date, and documents from the KIT College API."""
    client = CollegeAPIClient()
    result: Dict[str, Any] = {
        "connected": False,
        "college": None,
        "courses": [],
        "today": None,
        "remote_documents": [],
        "indexed_documents": [
            {
                "id": d.id,
                "filename": d.filename,
                "doc_type": d.doc_type,
                "page_count": d.page_count,
            }
            for d in list_documents(db)
        ],
        "error": None,
    }
    try:
        college = await client.get_college_info()
        courses = await client.list_courses()
        today = await client.get_today()
        remote_docs = await client.list_documents()
        result.update(
            {
                "connected": True,
                "college": college,
                "courses": courses,
                "today": today,
                "remote_documents": remote_docs,
            }
        )
    except CollegeAPIError as exc:
        result["error"] = exc.message
    return result


@router.post("/auth/login", response_model=UserProfileResponse)
async def login(payload: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    """Authenticate student or teacher via KIT `POST /v1/auth/login` and issue an HTTP-only session cookie."""
    try:
        login_id = payload.resolved_login_id
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    client = CollegeAPIClient()
    try:
        api_resp = await client.login(login_id=login_id, password=payload.password)
    except CollegeAPIUnavailableError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=exc.message)
    except CollegeOperationNotSupportedError as exc:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=exc.message)
    except CollegeAPIAuthError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=exc.message)
    except CollegeAPIError as exc:
        raise HTTPException(status_code=exc.status_code or status.HTTP_400_BAD_REQUEST, detail=exc.message)

    token = api_resp.get("access_token")
    if not isinstance(token, str) or not token:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="College API login response did not include an access_token.",
        )

    user_info = api_resp.get("user") if isinstance(api_resp.get("user"), dict) else {}
    raw_role = str(user_info.get("role") or payload.role_hint or "").lower().strip()
    if raw_role not in {UserRole.STUDENT.value, UserRole.TEACHER.value}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Authenticated account does not have a supported student or teacher role.",
        )

    user_id = str(user_info.get("id") or user_info.get("login_id") or login_id)
    display_name = str(user_info.get("full_name") or user_info.get("login_id") or login_id)
    expires_in = api_resp.get("expires_in")
    expires_at = (
        datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))
        if isinstance(expires_in, (int, float)) and expires_in > 0
        else None
    )

    session = create_user_session(
        db,
        user_id=user_id,
        role=UserRole(raw_role),
        display_name=display_name,
        college_jwt=token,
        expires_at=expires_at,
    )
    set_session_cookie(response, session.id, request)

    return UserProfileResponse(
        user_id=user_id,
        role=raw_role,
        display_name=display_name,
        is_authenticated=True,
    )


@router.post("/auth/logout")
async def logout(
    request: Request,
    response: Response,
    user: AuthenticatedUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.session_id:
        delete_user_session(db, user.session_id)
    clear_session_cookie(response, request)
    return {"status": "logged_out"}


@router.get("/auth/me", response_model=UserProfileResponse)
async def get_me(user: AuthenticatedUser = Depends(get_current_user)):
    return UserProfileResponse(
        user_id=user.user_id,
        role=user.role.value,
        display_name=user.display_name,
        is_authenticated=user.is_authenticated,
    )


@router.post("/voice/transcribe")
async def transcribe_voice(
    file: UploadFile = File(...),
):
    """Transcribe voice audio using Groq Whisper model."""
    settings = get_settings()
    api_key = (settings.GROQ_API_KEY or settings.GROK_API_KEY).strip()
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Groq API key is not configured for audio transcription.",
        )

    content = await file.read()
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Audio file too large.")

    filename = file.filename or "audio.webm"
    files = {"file": (filename, content, file.content_type or "audio/webm")}
    data = {
        "model": getattr(settings, "GROQ_STT_MODEL", "whisper-large-v3-turbo"),
        "prompt": "Knotopian Institute of Technology, KIT, Attendance, On-duty, OD, Leave application, Examination, Internal Assessment, Placement, Admissions, Dr. Lakshmi, Arjun, CSE-2A",
    }
    headers = {"Authorization": f"Bearer {api_key}"}

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.post(
                "https://api.groq.com/openai/v1/audio/transcriptions",
                headers=headers,
                data=data,
                files=files,
            )
            resp.raise_for_status()
            res_json = resp.json()
            return {"text": res_json.get("text", "").strip(), "model": data["model"]}
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Groq Whisper transcription failed: {exc}",
            )


@router.post("/chat", response_model=ChatResponse)
async def chat(
    payload: ChatRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Process a voice/text turn through the central AI orchestrator."""
    result = await orchestrator.handle_message(
        db=db,
        user=user,
        message=payload.message,
        conversation_id=payload.conversation_id,
    )
    return ChatResponse(
        conversation_id=result.conversation_id,
        reply=result.reply,
        mode=result.mode,
        user_role=result.user_role,
        tools_used=[
            ToolExecutionSummary(tool_name=t.tool_name, status=t.status, data=t.data)
            for t in result.tools_used
        ],
        pending_confirmation=result.pending_confirmation,
        fallback_used=result.fallback_used,
    )


@router.get("/history", response_model=List[ConversationSummary])
async def list_history(
    user: AuthenticatedUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List conversations strictly owned by the caller."""
    rows = (
        db.query(Conversation)
        .filter(Conversation.user_id == user.user_id)
        .order_by(Conversation.updated_at.desc())
        .all()
    )
    summaries: List[ConversationSummary] = []
    for row in rows:
        count = db.query(Message).filter(Message.conversation_id == row.id).count()
        summaries.append(
            ConversationSummary(
                id=row.id,
                user_role=row.user_role,
                mode=row.mode,
                title=row.title,
                started_at=row.started_at,
                updated_at=row.updated_at,
                message_count=count,
            )
        )
    return summaries


@router.get("/history/{conversation_id}", response_model=ConversationDetailResponse)
async def get_history_detail(
    conversation_id: str,
    user: AuthenticatedUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return full conversation messages and sanitized tool executions ONLY to its owner."""
    conv = db.get(Conversation, conversation_id)
    if conv is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found.")
    if conv.user_id != user.user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to access this conversation.",
        )

    return ConversationDetailResponse(
        id=conv.id,
        user_role=conv.user_role,
        mode=conv.mode,
        title=conv.title,
        started_at=conv.started_at,
        updated_at=conv.updated_at,
        messages=[
            MessageItem(id=m.id, role=m.role, content=m.content, created_at=m.created_at)
            for m in conv.messages
        ],
        tool_executions=[
            ToolExecutionAuditItem(
                id=t.id,
                tool_name=t.tool_name,
                status=t.status,
                sanitized_request=t.sanitized_request,
                sanitized_response=t.sanitized_response,
                executed_at=t.executed_at,
            )
            for t in conv.tool_executions
        ],
    )


@router.get("/knowledge/documents", response_model=List[KnowledgeDocumentResponse])
async def get_knowledge_documents(db: Session = Depends(get_db)):
    docs = list_documents(db)
    return [
        KnowledgeDocumentResponse(
            id=d.id,
            filename=d.filename,
            doc_type=d.doc_type,
            page_count=d.page_count,
            char_count=d.char_count,
            uploaded_at=d.uploaded_at,
        )
        for d in docs
    ]


@router.post("/knowledge/sync")
async def sync_knowledge_from_college_api(db: Session = Depends(get_db)):
    """Download and index official PDFs exposed by KIT `/v1/documents` + `/v1/documents/{id}/file`."""
    client = CollegeAPIClient()
    try:
        remote_docs = await client.list_documents()
    except CollegeAPIError as exc:
        raise HTTPException(status_code=exc.status_code or 503, detail=exc.message)

    synced: List[Dict[str, Any]] = []
    for doc in remote_docs:
        doc_id = doc.get("id")
        title = str(doc.get("title") or f"document_{doc_id}").strip()
        if doc_id is None:
            continue
        raw = await client.download_document_file(int(doc_id))
        doc_type = str(doc.get("type") or infer_doc_type(title)).lower()
        mapped_type = (
            "rulebook"
            if "handbook" in doc_type or "rule" in doc_type
            else ("notes" if "note" in doc_type or "dbms" in title.lower() else "other")
        )
        safe_title = re.sub(r'[<>:"/\\|?*]+', "_", title).strip()
        safe_name = f"{doc_id}_{safe_title}.pdf"
        stored = ingest_pdf_bytes(db, filename=safe_name, raw_bytes=raw, doc_type=mapped_type)
        synced.append({"id": stored.id, "filename": stored.filename, "pages": stored.page_count})
    return {"synced_count": len(synced), "documents": synced}


@router.post("/knowledge/upload", response_model=KnowledgeDocumentResponse)
async def upload_knowledge_pdf(
    file: UploadFile = File(...),
    doc_type: str = Form("auto"),
    user: AuthenticatedUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Allow authenticated teachers to upload official PDFs (rulebook, brochure, DBMS notes)."""
    if user.role != UserRole.TEACHER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only authenticated teachers can upload official college PDFs via API.",
        )
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only PDF files are supported.")
    raw = await file.read()
    if len(raw) > 20 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="PDF exceeds 20 MB limit.")

    resolved_type = infer_doc_type(file.filename) if doc_type == "auto" else doc_type
    doc = ingest_pdf_bytes(db, filename=file.filename, raw_bytes=raw, doc_type=resolved_type)
    return KnowledgeDocumentResponse(
        id=doc.id,
        filename=doc.filename,
        doc_type=doc.doc_type,
        page_count=doc.page_count,
        char_count=doc.char_count,
        uploaded_at=doc.uploaded_at,
    )
