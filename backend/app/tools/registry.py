"""Role-aware tool registry bound directly to the verified KIT OpenAPI v1.0.0 contract."""

import re
from datetime import date, timedelta
from typing import Any, Callable, Coroutine, Dict, List, Optional

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database.models import ToolExecution
from app.integrations.college_api import (
    CollegeAPIAuthError,
    CollegeAPIClient,
    CollegeAPIError,
    CollegeAPIUnavailableError,
    CollegeOperationNotSupportedError,
)
from app.knowledge.pdf_service import infer_doc_type, ingest_pdf_bytes, list_documents, retrieve_relevant_chunks
from app.rules.policy_engine import (
    WEEKDAYS,
    consume_pending_confirmation,
    create_pending_confirmation,
    resolve_college_date,
    validate_leave_eligibility,
    validate_od_eligibility,
)
from app.security.auth import AuthenticatedUser, UserRole
from app.security.sanitizer import safe_json_dumps


class ToolExecutionResult(BaseModel):
    tool_name: str
    status: str  # success | error | blocked | unsupported | pending_confirmation | unavailable
    data: Dict[str, Any]


class ToolSpec(BaseModel):
    name: str
    description: str
    allowed_roles: List[UserRole]
    parameters_schema: Dict[str, Any]


class ToolRegistry:
    """Executes authorized tools and exposes only role-permitted declarations to Gemini."""

    def __init__(self, college_client: Optional[CollegeAPIClient] = None):
        self.college_client = college_client or CollegeAPIClient()
        self._specs: Dict[str, ToolSpec] = self._build_specs()

    def _build_specs(self) -> Dict[str, ToolSpec]:
        return {
            "search_college_documents": ToolSpec(
                name="search_college_documents",
                description=(
                    "Search official college documents (student handbook/rulebook, circulars, or lesson notes) "
                    "indexed from the College API or uploaded PDFs."
                ),
                allowed_roles=[UserRole.PUBLIC, UserRole.STUDENT, UserRole.TEACHER],
                parameters_schema={
                    "type": "OBJECT",
                    "properties": {
                        "query": {"type": "STRING", "description": "Search query for official documents."},
                        "doc_type": {
                            "type": "STRING",
                            "description": "Optional filter: rulebook, brochure, notes, or all.",
                        },
                    },
                    "required": ["query"],
                },
            ),
            "get_admission_info": ToolSpec(
                name="get_admission_info",
                description=(
                    "Retrieve official college details, available degree courses, minimum 12th eligibility, "
                    "annual/hostel fees, seat counts, and official documents from the KIT College API."
                ),
                allowed_roles=[UserRole.PUBLIC, UserRole.STUDENT, UserRole.TEACHER],
                parameters_schema={
                    "type": "OBJECT",
                    "properties": {
                        "topic": {
                            "type": "STRING",
                            "description": "Optional topic such as courses, eligibility, fees, contact, or documents.",
                        }
                    },
                },
            ),
            "submit_admission_application": ToolSpec(
                name="submit_admission_application",
                description="Submit a public admission enquiry application after explicit user confirmation.",
                allowed_roles=[UserRole.PUBLIC],
                parameters_schema={
                    "type": "OBJECT",
                    "properties": {
                        "full_name": {"type": "STRING"},
                        "phone": {"type": "STRING"},
                        "email": {"type": "STRING"},
                        "course_code": {"type": "STRING", "description": "e.g. BTECH-CSE"},
                        "twelfth_percent": {"type": "NUMBER"},
                        "confirmation_id": {"type": "STRING"},
                        "confirmed": {"type": "BOOLEAN"},
                    },
                    "required": ["full_name", "phone", "email", "course_code", "twelfth_percent"],
                },
            ),
            "get_student_profile": ToolSpec(
                name="get_student_profile",
                description="Retrieve the authenticated student's profile, academics (CGPA, arrears), and subjects.",
                allowed_roles=[UserRole.STUDENT],
                parameters_schema={"type": "OBJECT", "properties": {}},
            ),
            "get_attendance": ToolSpec(
                name="get_attendance",
                description="Retrieve the authenticated student's attendance summary (and optional subject session history).",
                allowed_roles=[UserRole.STUDENT],
                parameters_schema={
                    "type": "OBJECT",
                    "properties": {
                        "subject": {"type": "STRING", "description": "Optional subject code filter, e.g. CS304."}
                    },
                },
            ),
            "get_timetable": ToolSpec(
                name="get_timetable",
                description=(
                    "Retrieve the authenticated student's timetable, resolving today/tomorrow/weekday and any "
                    "working-day or holiday calendar overrides from the KIT College API."
                ),
                allowed_roles=[UserRole.STUDENT],
                parameters_schema={
                    "type": "OBJECT",
                    "properties": {
                        "day": {"type": "STRING", "description": "Optional: today, tomorrow, Monday..Saturday, or YYYY-MM-DD."}
                    },
                },
            ),
            "get_exam_dates": ToolSpec(
                name="get_exam_dates",
                description="Retrieve upcoming internal examination dates from the KIT College calendar.",
                allowed_roles=[UserRole.STUDENT, UserRole.TEACHER],
                parameters_schema={"type": "OBJECT", "properties": {}},
            ),
            "get_holidays": ToolSpec(
                name="get_holidays",
                description="Retrieve official college holidays and working-day calendar events.",
                allowed_roles=[UserRole.STUDENT, UserRole.TEACHER],
                parameters_schema={"type": "OBJECT", "properties": {}},
            ),
            "get_college_rules": ToolSpec(
                name="get_college_rules",
                description="Retrieve official college rules from the KIT student handbook/rulebook PDFs.",
                allowed_roles=[UserRole.STUDENT, UserRole.TEACHER],
                parameters_schema={"type": "OBJECT", "properties": {"topic": {"type": "STRING"}}},
            ),
            "check_leave_eligibility": ToolSpec(
                name="check_leave_eligibility",
                description="Check whether the authenticated student is eligible for personal or medical leave.",
                allowed_roles=[UserRole.STUDENT],
                parameters_schema={
                    "type": "OBJECT",
                    "properties": {
                        "date": {"type": "STRING", "description": "Start date (YYYY-MM-DD, today, tomorrow, etc.)."},
                        "to_date": {"type": "STRING", "description": "Optional end date (YYYY-MM-DD)."},
                        "reason": {"type": "STRING"},
                    },
                    "required": ["date"],
                },
            ),
            "submit_leave_request": ToolSpec(
                name="submit_leave_request",
                description="Submit a personal_leave or medical_leave request after validation and explicit confirmation.",
                allowed_roles=[UserRole.STUDENT],
                parameters_schema={
                    "type": "OBJECT",
                    "properties": {
                        "date": {"type": "STRING", "description": "From date (YYYY-MM-DD or relative date)."},
                        "to_date": {"type": "STRING", "description": "Optional end date (YYYY-MM-DD)."},
                        "request_type": {"type": "STRING", "description": "personal_leave or medical_leave"},
                        "half_day": {"type": "BOOLEAN"},
                        "reason": {"type": "STRING"},
                        "confirmation_id": {"type": "STRING"},
                        "confirmed": {"type": "BOOLEAN"},
                    },
                    "required": ["date", "reason"],
                },
            ),
            "check_od_eligibility": ToolSpec(
                name="check_od_eligibility",
                description="Check whether the authenticated student is eligible for On-Duty (OD).",
                allowed_roles=[UserRole.STUDENT],
                parameters_schema={
                    "type": "OBJECT",
                    "properties": {
                        "date": {"type": "STRING"},
                        "to_date": {"type": "STRING"},
                        "reason": {"type": "STRING"},
                        "event_name": {"type": "STRING"},
                    },
                    "required": ["date"],
                },
            ),
            "submit_od_request": ToolSpec(
                name="submit_od_request",
                description="Submit an on_duty (OD) request after validation and explicit user confirmation.",
                allowed_roles=[UserRole.STUDENT],
                parameters_schema={
                    "type": "OBJECT",
                    "properties": {
                        "date": {"type": "STRING"},
                        "to_date": {"type": "STRING"},
                        "half_day": {"type": "BOOLEAN"},
                        "reason": {"type": "STRING"},
                        "event_name": {"type": "STRING"},
                        "confirmation_id": {"type": "STRING"},
                        "confirmed": {"type": "BOOLEAN"},
                    },
                    "required": ["date", "reason", "event_name"],
                },
            ),
            "get_my_requests": ToolSpec(
                name="get_my_requests",
                description="List all leave and on-duty requests submitted by the authenticated student.",
                allowed_roles=[UserRole.STUDENT],
                parameters_schema={"type": "OBJECT", "properties": {}},
            ),
            "cancel_my_request": ToolSpec(
                name="cancel_my_request",
                description="Cancel a pending or approved student leave/OD request before its start date.",
                allowed_roles=[UserRole.STUDENT],
                parameters_schema={
                    "type": "OBJECT",
                    "properties": {
                        "request_id": {"type": "INTEGER"},
                        "confirmation_id": {"type": "STRING"},
                        "confirmed": {"type": "BOOLEAN"},
                    },
                    "required": ["request_id"],
                },
            ),
            "get_placement_drives": ToolSpec(
                name="get_placement_drives",
                description="List active campus placement drives, minimum CGPA, arrears policy, and seats left.",
                allowed_roles=[UserRole.PUBLIC, UserRole.STUDENT, UserRole.TEACHER],
                parameters_schema={"type": "OBJECT", "properties": {}},
            ),
            "register_placement": ToolSpec(
                name="register_placement",
                description="Register the authenticated student for a placement drive after confirmation.",
                allowed_roles=[UserRole.STUDENT],
                parameters_schema={
                    "type": "OBJECT",
                    "properties": {
                        "drive_id": {"type": "INTEGER"},
                        "confirmation_id": {"type": "STRING"},
                        "confirmed": {"type": "BOOLEAN"},
                    },
                    "required": ["drive_id"],
                },
            ),
            "get_my_placements": ToolSpec(
                name="get_my_placements",
                description="List the authenticated student's registered placement drives.",
                allowed_roles=[UserRole.STUDENT],
                parameters_schema={"type": "OBJECT", "properties": {}},
            ),
            "get_teacher_profile": ToolSpec(
                name="get_teacher_profile",
                description="Retrieve the authenticated teacher's profile and authorized classes.",
                allowed_roles=[UserRole.TEACHER],
                parameters_schema={"type": "OBJECT", "properties": {}},
            ),
            "get_pending_requests": ToolSpec(
                name="get_pending_requests",
                description="List student leave and on-duty requests in the teacher's authorized classes.",
                allowed_roles=[UserRole.TEACHER],
                parameters_schema={
                    "type": "OBJECT",
                    "properties": {
                        "status": {"type": "STRING", "description": "Optional status filter (defaults to 'pending')."}
                    },
                },
            ),
            "get_class_attendance": ToolSpec(
                name="get_class_attendance",
                description="Retrieve student-wise attendance sheet for one of the teacher's authorized classes.",
                allowed_roles=[UserRole.TEACHER],
                parameters_schema={
                    "type": "OBJECT",
                    "properties": {"class_id": {"type": "INTEGER"}},
                    "required": ["class_id"],
                },
            ),
            "review_leave_request": ToolSpec(
                name="review_leave_request",
                description="Approve or reject a pending student leave or OD request after explicit teacher confirmation.",
                allowed_roles=[UserRole.TEACHER],
                parameters_schema={
                    "type": "OBJECT",
                    "properties": {
                        "request_id": {"type": "INTEGER"},
                        "decision": {"type": "STRING", "description": "approve or reject"},
                        "remarks": {"type": "STRING", "description": "Mandatory reason when rejecting; optional comment when approving."},
                        "confirmation_id": {"type": "STRING"},
                        "confirmed": {"type": "BOOLEAN"},
                    },
                    "required": ["request_id", "decision"],
                },
            ),
        }

    @staticmethod
    def _to_json_schema(schema: Any) -> Any:
        if isinstance(schema, dict):
            converted: Dict[str, Any] = {}
            for k, v in schema.items():
                if k == "type" and isinstance(v, str):
                    converted[k] = v.lower()
                else:
                    converted[k] = ToolRegistry._to_json_schema(v)
            return converted
        if isinstance(schema, list):
            return [ToolRegistry._to_json_schema(item) for item in schema]
        return schema

    def get_grok_tools_for_role(self, role: UserRole) -> List[Dict[str, Any]]:
        """Build OpenAI/Grok-compatible tool definitions strictly filtered by caller role."""
        tools: List[Dict[str, Any]] = []
        for spec in self._specs.values():
            if role in spec.allowed_roles:
                tools.append(
                    {
                        "type": "function",
                        "function": {
                            "name": spec.name,
                            "description": spec.description,
                            "parameters": self._to_json_schema(spec.parameters_schema),
                        },
                    }
                )
        return tools

    def list_allowed_tool_names(self, role: UserRole) -> List[str]:
        return [name for name, spec in self._specs.items() if role in spec.allowed_roles]

    async def execute(
        self,
        *,
        tool_name: str,
        arguments: Dict[str, Any],
        user: AuthenticatedUser,
        db: Session,
        conversation_id: str,
    ) -> ToolExecutionResult:
        """Validate RBAC, execute the requested tool, and persist sanitized audit log."""
        spec = self._specs.get(tool_name)
        if spec is None:
            result = ToolExecutionResult(
                tool_name=tool_name,
                status="error",
                data={"error": f"Unknown tool '{tool_name}'."},
            )
            self._record_execution(db, conversation_id, tool_name, arguments, result)
            return result

        if user.role not in spec.allowed_roles:
            result = ToolExecutionResult(
                tool_name=tool_name,
                status="blocked",
                data={"error": f"Access denied: role '{user.role.value}' cannot invoke '{tool_name}'."},
            )
            self._record_execution(db, conversation_id, tool_name, arguments, result)
            return result

        clean_args = {
            k: v
            for k, v in (arguments or {}).items()
            if k not in {"student_id", "user_id", "teacher_id", "token", "login_id"}
        }

        handler = self._get_handler(tool_name)
        try:
            result = await handler(clean_args, user, db, conversation_id)
        except CollegeAPIAuthError as exc:
            result = ToolExecutionResult(
                tool_name=tool_name,
                status="error",
                data={"error": exc.message, "auth_invalid": True},
            )
        except CollegeAPIUnavailableError as exc:
            result = ToolExecutionResult(
                tool_name=tool_name,
                status="unavailable",
                data={"supported": False, "error": exc.message, "base_url": self.college_client.base_url},
            )
        except CollegeOperationNotSupportedError as exc:
            result = ToolExecutionResult(
                tool_name=tool_name,
                status="unsupported",
                data={"supported": False, "error": exc.message},
            )
        except CollegeAPIError as exc:
            result = ToolExecutionResult(
                tool_name=tool_name,
                status="error",
                data={"error": exc.message, "status_code": exc.status_code},
            )
        except Exception as exc:
            result = ToolExecutionResult(
                tool_name=tool_name,
                status="error",
                data={"error": f"Unexpected tool failure: {exc}"},
            )

        self._record_execution(db, conversation_id, tool_name, clean_args, result)
        return result

    def _record_execution(
        self,
        db: Session,
        conversation_id: str,
        tool_name: str,
        arguments: Dict[str, Any],
        result: ToolExecutionResult,
    ) -> None:
        row = ToolExecution(
            conversation_id=conversation_id,
            tool_name=tool_name,
            status=result.status,
            sanitized_request=safe_json_dumps(arguments),
            sanitized_response=safe_json_dumps(result.data),
        )
        db.add(row)
        db.commit()

    def _get_handler(
        self, tool_name: str
    ) -> Callable[[Dict[str, Any], AuthenticatedUser, Session, str], Coroutine[Any, Any, ToolExecutionResult]]:
        handlers = {
            "search_college_documents": self._handle_search_documents,
            "get_admission_info": self._handle_admission_info,
            "submit_admission_application": self._handle_submit_admission,
            "get_student_profile": self._handle_student_profile,
            "get_attendance": self._handle_attendance,
            "get_timetable": self._handle_timetable,
            "get_exam_dates": self._handle_exam_dates,
            "get_holidays": self._handle_holidays,
            "get_college_rules": self._handle_college_rules,
            "check_leave_eligibility": self._handle_check_leave_eligibility,
            "submit_leave_request": self._handle_submit_leave_request,
            "check_od_eligibility": self._handle_check_od_eligibility,
            "submit_od_request": self._handle_submit_od_request,
            "get_my_requests": self._handle_my_requests,
            "cancel_my_request": self._handle_cancel_request,
            "get_placement_drives": self._handle_placement_drives,
            "register_placement": self._handle_register_placement,
            "get_my_placements": self._handle_my_placements,
            "get_teacher_profile": self._handle_teacher_profile,
            "get_pending_requests": self._handle_pending_requests,
            "get_class_attendance": self._handle_class_attendance,
            "review_leave_request": self._handle_review_leave_request,
        }
        return handlers[tool_name]

    async def _sync_college_documents_if_empty(self, db: Session) -> List[Dict[str, Any]]:
        """Attempt to download and index official PDFs from `/v1/documents` when local index is empty."""
        try:
            remote_docs = await self.college_client.list_documents()
        except CollegeAPIError:
            return []

        existing_names = {d.filename for d in list_documents(db)}
        for doc in remote_docs:
            doc_id = doc.get("id")
            title = str(doc.get("title") or f"document_{doc_id}").strip()
            safe_title = re.sub(r'[<>:"/\\|?*]+', "_", title).strip()
            safe_name = f"{doc_id}_{safe_title}.pdf"
            if safe_name in existing_names or doc_id is None:
                continue
            try:
                raw_bytes = await self.college_client.download_document_file(int(doc_id))
                doc_type = str(doc.get("type") or infer_doc_type(title)).lower()
                mapped_type = "rulebook" if "handbook" in doc_type or "rule" in doc_type else (
                    "notes" if "note" in doc_type or "dbms" in title.lower() else (
                        "brochure" if "admission" in doc_type or "brochure" in title.lower() else "other"
                    )
                )
                ingest_pdf_bytes(db, filename=safe_name, raw_bytes=raw_bytes, doc_type=mapped_type)
            except Exception:
                continue
        return remote_docs

    async def _get_college_today_date(self) -> Optional[date]:
        try:
            today_info = await self.college_client.get_today()
            raw_date = today_info.get("date")
            if isinstance(raw_date, str):
                return date.fromisoformat(raw_date)
        except Exception:
            return None
        return None

    async def _handle_search_documents(
        self, args: Dict[str, Any], user: AuthenticatedUser, db: Session, conversation_id: str
    ) -> ToolExecutionResult:
        if not list_documents(db):
            await self._sync_college_documents_if_empty(db)
        query = str(args.get("query", "")).strip()
        doc_type = str(args.get("doc_type", "all")).strip().lower()
        doc_types = None if doc_type in ("", "all") else [doc_type]
        chunks = retrieve_relevant_chunks(db, query, doc_types=doc_types, top_k=4)
        docs = list_documents(db)
        return ToolExecutionResult(
            tool_name="search_college_documents",
            status="success",
            data={
                "documents_loaded": len(docs),
                "available_documents": [{"filename": d.filename, "doc_type": d.doc_type} for d in docs],
                "matches": [c.model_dump() for c in chunks],
            },
        )

    async def _handle_admission_info(
        self, args: Dict[str, Any], user: AuthenticatedUser, db: Session, conversation_id: str
    ) -> ToolExecutionResult:
        topic = str(args.get("topic", "courses eligibility fees")).strip()
        college_info = await self.college_client.get_college_info()
        courses = await self.college_client.list_courses()
        if not list_documents(db):
            await self._sync_college_documents_if_empty(db)
        chunks = retrieve_relevant_chunks(db, topic, doc_types=["brochure", "rulebook", "other"], top_k=4)
        return ToolExecutionResult(
            tool_name="get_admission_info",
            status="success",
            data={
                "college": college_info,
                "courses": courses,
                "document_matches": [c.model_dump() for c in chunks],
            },
        )

    async def _handle_submit_admission(
        self, args: Dict[str, Any], user: AuthenticatedUser, db: Session, conversation_id: str
    ) -> ToolExecutionResult:
        payload = {
            "full_name": str(args.get("full_name", "")).strip(),
            "phone": str(args.get("phone", "")).strip(),
            "email": str(args.get("email", "")).strip(),
            "course_code": str(args.get("course_code", "")).strip(),
            "twelfth_percent": float(args.get("twelfth_percent", 0)),
        }
        confirmed = bool(args.get("confirmed", False))
        confirmation_id = args.get("confirmation_id")
        if not confirmed or not confirmation_id:
            pending = create_pending_confirmation(
                db,
                conversation_id=conversation_id,
                user_id=user.user_id,
                action_type="admission",
                payload=payload,
            )
            return ToolExecutionResult(
                tool_name="submit_admission_application",
                status="pending_confirmation",
                data={
                    "confirmation_id": pending.id,
                    "action_type": "admission",
                    "payload": payload,
                    "message": "Explicit confirmation is required before submitting this admission application.",
                },
            )

        consumed = consume_pending_confirmation(
            db, confirmation_id=str(confirmation_id), user_id=user.user_id, conversation_id=conversation_id
        )
        if consumed is None:
            return ToolExecutionResult(
                tool_name="submit_admission_application",
                status="error",
                data={"error": "Invalid, expired, or already-used confirmation ID."},
            )

        api_res = await self.college_client.submit_admission_application(
            full_name=payload["full_name"],
            phone=payload["phone"],
            email=payload["email"],
            course_code=payload["course_code"],
            twelfth_percent=payload["twelfth_percent"],
            idempotency_key=consumed.idempotency_key,
        )
        return ToolExecutionResult(tool_name="submit_admission_application", status="success", data=api_res)

    async def _handle_student_profile(
        self, args: Dict[str, Any], user: AuthenticatedUser, db: Session, conversation_id: str
    ) -> ToolExecutionResult:
        token = user.college_jwt or ""
        profile = await self.college_client.get_me(token)
        academics = await self.college_client.get_my_academics(token)
        subjects = await self.college_client.get_my_subjects(token)
        return ToolExecutionResult(
            tool_name="get_student_profile",
            status="success",
            data={"profile": profile, "academics": academics, "subjects": subjects},
        )

    async def _handle_attendance(
        self, args: Dict[str, Any], user: AuthenticatedUser, db: Session, conversation_id: str
    ) -> ToolExecutionResult:
        token = user.college_jwt or ""
        summary = await self.college_client.get_my_attendance(token)
        subject = args.get("subject")
        if subject:
            sessions = await self.college_client.get_my_attendance_sessions(token, subject=str(subject))
            summary["sessions"] = sessions
        return ToolExecutionResult(tool_name="get_attendance", status="success", data=summary)

    async def _handle_timetable(
        self, args: Dict[str, Any], user: AuthenticatedUser, db: Session, conversation_id: str
    ) -> ToolExecutionResult:
        token = user.college_jwt or ""
        slots = await self.college_client.get_my_timetable(token)
        ref_today = await self._get_college_today_date()
        day_arg = str(args.get("day", "")).strip()

        if not day_arg:
            return ToolExecutionResult(
                tool_name="get_timetable",
                status="success",
                data={"college_today": ref_today.isoformat() if ref_today else None, "weekly_slots": slots},
            )

        target_date = resolve_college_date(day_arg, reference_today=ref_today)
        calendar_events: List[Dict[str, Any]] = []
        effective_weekday: Optional[int] = None
        note = ""

        if target_date is not None:
            iso = target_date.isoformat()
            calendar_events = await self.college_client.get_calendar(
                bearer_token=token, from_date=iso, to_date=iso
            )
            holiday = next((e for e in calendar_events if e.get("type") == "holiday"), None)
            if holiday:
                return ToolExecutionResult(
                    tool_name="get_timetable",
                    status="success",
                    data={
                        "requested_date": iso,
                        "is_holiday": True,
                        "holiday": holiday,
                        "slots": [],
                    },
                )
            working_override = next((e for e in calendar_events if e.get("type") == "working_day"), None)
            if working_override and working_override.get("follows_weekday"):
                effective_weekday = int(working_override["follows_weekday"])
                note = f"Special working day following weekday {effective_weekday} ({working_override.get('title')})."
            else:
                # KIT TimetableSlotResponse uses 1=Mon ... 6=Sat (Python weekday() is 0=Mon ... 6=Sun)
                effective_weekday = target_date.weekday() + 1
        else:
            low = day_arg.lower()
            if low in WEEKDAYS:
                effective_weekday = WEEKDAYS[low] + 1

        filtered = [s for s in slots if s.get("weekday") == effective_weekday]
        return ToolExecutionResult(
            tool_name="get_timetable",
            status="success",
            data={
                "requested_day": day_arg,
                "resolved_date": target_date.isoformat() if target_date else None,
                "effective_weekday": effective_weekday,
                "note": note,
                "calendar_events": calendar_events,
                "slots": filtered,
            },
        )

    async def _handle_exam_dates(
        self, args: Dict[str, Any], user: AuthenticatedUser, db: Session, conversation_id: str
    ) -> ToolExecutionResult:
        ref_today = await self._get_college_today_date()
        events = await self.college_client.get_calendar(
            bearer_token=user.college_jwt,
            from_date=ref_today.isoformat() if ref_today else None,
        )
        exams = [e for e in events if e.get("type") == "internal_exam" and e.get("status", "active") == "active"]
        return ToolExecutionResult(
            tool_name="get_exam_dates",
            status="success",
            data={"college_today": ref_today.isoformat() if ref_today else None, "exams": exams},
        )

    async def _handle_holidays(
        self, args: Dict[str, Any], user: AuthenticatedUser, db: Session, conversation_id: str
    ) -> ToolExecutionResult:
        ref_today = await self._get_college_today_date()
        events = await self.college_client.get_calendar(
            bearer_token=user.college_jwt,
            from_date=ref_today.isoformat() if ref_today else None,
        )
        holidays = [e for e in events if e.get("type") == "holiday" and e.get("status", "active") == "active"]
        working_days = [e for e in events if e.get("type") == "working_day" and e.get("status", "active") == "active"]
        return ToolExecutionResult(
            tool_name="get_holidays",
            status="success",
            data={
                "college_today": ref_today.isoformat() if ref_today else None,
                "holidays": holidays,
                "special_working_days": working_days,
            },
        )

    async def _handle_college_rules(
        self, args: Dict[str, Any], user: AuthenticatedUser, db: Session, conversation_id: str
    ) -> ToolExecutionResult:
        if not list_documents(db):
            await self._sync_college_documents_if_empty(db)
        topic = str(args.get("topic", "attendance leave on-duty examination rules")).strip()
        chunks = retrieve_relevant_chunks(db, topic, doc_types=["rulebook", "other"], top_k=5)
        return ToolExecutionResult(
            tool_name="get_college_rules",
            status="success",
            data={"document_matches": [c.model_dump() for c in chunks]},
        )

    async def _get_student_programme(self, token: str) -> str:
        try:
            me = await self.college_client.get_me(token)
            prog = me.get("programme")
            if isinstance(prog, str) and prog.strip():
                return prog.strip().upper()
        except Exception:
            pass
        return "UG"

    async def _handle_check_leave_eligibility(
        self, args: Dict[str, Any], user: AuthenticatedUser, db: Session, conversation_id: str
    ) -> ToolExecutionResult:
        token = user.college_jwt or ""
        ref_today = await self._get_college_today_date()
        programme = await self._get_student_programme(token)
        att_data = await self.college_client.get_my_attendance(token)
        pct = att_data.get("overall_percentage")
        subjects = att_data.get("subjects") or []

        parsed_from = resolve_college_date(args.get("date"), reference_today=ref_today)
        parsed_to = resolve_college_date(args.get("to_date") or args.get("date"), reference_today=ref_today)
        events: List[Dict[str, Any]] = []
        if parsed_from and parsed_to:
            events = await self.college_client.get_calendar(
                bearer_token=token,
                from_date=min(parsed_from, parsed_to).isoformat(),
                to_date=max(parsed_from, parsed_to).isoformat(),
            )

        req_type = str(args.get("request_type", "personal_leave")).strip()
        if req_type not in {"personal_leave", "medical_leave"}:
            req_type = "personal_leave"

        validation = validate_leave_eligibility(
            from_date=args.get("date"),
            to_date=args.get("to_date"),
            request_type=req_type,
            half_day=bool(args.get("half_day", False)),
            reason=args.get("reason"),
            programme=programme,
            attendance_percentage=float(pct) if pct is not None else None,
            subject_attendance=subjects,
            calendar_events=events,
            reference_today=ref_today,
        )
        return ToolExecutionResult(
            tool_name="check_leave_eligibility",
            status="success",
            data={
                **validation.model_dump(),
                "overall_attendance_percentage": pct,
                "subjects": subjects,
                "calendar_events_checked": events,
            },
        )

    async def _handle_submit_leave_request(
        self, args: Dict[str, Any], user: AuthenticatedUser, db: Session, conversation_id: str
    ) -> ToolExecutionResult:
        token = user.college_jwt or ""
        ref_today = await self._get_college_today_date()
        programme = await self._get_student_programme(token)
        att_data = await self.college_client.get_my_attendance(token)
        pct = att_data.get("overall_percentage")
        subjects = att_data.get("subjects") or []

        parsed_from = resolve_college_date(args.get("date"), reference_today=ref_today)
        parsed_to = resolve_college_date(args.get("to_date") or args.get("date"), reference_today=ref_today)
        events: List[Dict[str, Any]] = []
        if parsed_from and parsed_to:
            events = await self.college_client.get_calendar(
                bearer_token=token,
                from_date=min(parsed_from, parsed_to).isoformat(),
                to_date=max(parsed_from, parsed_to).isoformat(),
            )

        req_type = str(args.get("request_type", "personal_leave")).strip()
        if req_type not in {"personal_leave", "medical_leave"}:
            req_type = "personal_leave"

        validation = validate_leave_eligibility(
            from_date=args.get("date"),
            to_date=args.get("to_date"),
            request_type=req_type,
            half_day=bool(args.get("half_day", False)),
            reason=args.get("reason"),
            programme=programme,
            attendance_percentage=float(pct) if pct is not None else None,
            subject_attendance=subjects,
            calendar_events=events,
            reference_today=ref_today,
        )
        if not validation.eligible:
            return ToolExecutionResult(
                tool_name="submit_leave_request",
                status="error",
                data={
                    "eligible": False,
                    "reasons": validation.reasons,
                    "warnings": validation.warnings,
                    "missing_fields": validation.missing_fields,
                },
            )

        req_type = str(args.get("request_type", "personal_leave")).strip()
        if req_type not in {"personal_leave", "medical_leave"}:
            req_type = "personal_leave"

        payload = {
            "type": req_type,
            "from_date": validation.from_date,
            "to_date": validation.to_date,
            "half_day": bool(args.get("half_day", False)),
            "reason": str(args.get("reason", "")).strip(),
        }

        confirmed = bool(args.get("confirmed", False))
        confirmation_id = args.get("confirmation_id")
        if not confirmed or not confirmation_id:
            pending = create_pending_confirmation(
                db,
                conversation_id=conversation_id,
                user_id=user.user_id,
                action_type="leave",
                payload=payload,
            )
            return ToolExecutionResult(
                tool_name="submit_leave_request",
                status="pending_confirmation",
                data={
                    "confirmation_id": pending.id,
                    "action_type": "leave",
                    "payload": payload,
                    "message": "Please confirm to submit this leave request.",
                },
            )

        consumed = consume_pending_confirmation(
            db, confirmation_id=str(confirmation_id), user_id=user.user_id, conversation_id=conversation_id
        )
        if consumed is None:
            return ToolExecutionResult(
                tool_name="submit_leave_request",
                status="error",
                data={"error": "Invalid, expired, or already-used confirmation ID."},
            )

        api_res = await self.college_client.create_request(
            token,
            request_type=payload["type"],
            from_date=payload["from_date"],
            to_date=payload["to_date"],
            half_day=payload["half_day"],
            reason=payload["reason"],
            idempotency_key=consumed.idempotency_key,
        )
        return ToolExecutionResult(tool_name="submit_leave_request", status="success", data=api_res)

    async def _handle_check_od_eligibility(
        self, args: Dict[str, Any], user: AuthenticatedUser, db: Session, conversation_id: str
    ) -> ToolExecutionResult:
        token = user.college_jwt or ""
        ref_today = await self._get_college_today_date()
        programme = await self._get_student_programme(token)
        parsed_from = resolve_college_date(args.get("date"), reference_today=ref_today)
        parsed_to = resolve_college_date(args.get("to_date") or args.get("date"), reference_today=ref_today)
        events: List[Dict[str, Any]] = []
        if parsed_from and parsed_to:
            events = await self.college_client.get_calendar(
                bearer_token=token,
                from_date=min(parsed_from, parsed_to).isoformat(),
                to_date=max(parsed_from, parsed_to).isoformat(),
            )
        validation = validate_od_eligibility(
            from_date=args.get("date"),
            to_date=args.get("to_date"),
            reason=args.get("reason"),
            event_name=args.get("event_name"),
            programme=programme,
            calendar_events=events,
            reference_today=ref_today,
        )
        return ToolExecutionResult(
            tool_name="check_od_eligibility",
            status="success",
            data={**validation.model_dump(), "calendar_events_checked": events},
        )

    async def _handle_submit_od_request(
        self, args: Dict[str, Any], user: AuthenticatedUser, db: Session, conversation_id: str
    ) -> ToolExecutionResult:
        token = user.college_jwt or ""
        ref_today = await self._get_college_today_date()
        programme = await self._get_student_programme(token)
        parsed_from = resolve_college_date(args.get("date"), reference_today=ref_today)
        parsed_to = resolve_college_date(args.get("to_date") or args.get("date"), reference_today=ref_today)
        events: List[Dict[str, Any]] = []
        if parsed_from and parsed_to:
            events = await self.college_client.get_calendar(
                bearer_token=token,
                from_date=min(parsed_from, parsed_to).isoformat(),
                to_date=max(parsed_from, parsed_to).isoformat(),
            )
        validation = validate_od_eligibility(
            from_date=args.get("date"),
            to_date=args.get("to_date"),
            reason=args.get("reason"),
            event_name=args.get("event_name"),
            programme=programme,
            calendar_events=events,
            reference_today=ref_today,
        )
        if not validation.eligible:
            return ToolExecutionResult(
                tool_name="submit_od_request",
                status="error",
                data={"eligible": False, "reasons": validation.reasons, "missing_fields": validation.missing_fields},
            )

        payload = {
            "type": "on_duty",
            "from_date": validation.from_date,
            "to_date": validation.to_date,
            "half_day": bool(args.get("half_day", False)),
            "reason": str(args.get("reason", "")).strip(),
            "event_name": str(args.get("event_name", "")).strip(),
        }

        confirmed = bool(args.get("confirmed", False))
        confirmation_id = args.get("confirmation_id")
        if not confirmed or not confirmation_id:
            pending = create_pending_confirmation(
                db,
                conversation_id=conversation_id,
                user_id=user.user_id,
                action_type="od",
                payload=payload,
            )
            return ToolExecutionResult(
                tool_name="submit_od_request",
                status="pending_confirmation",
                data={
                    "confirmation_id": pending.id,
                    "action_type": "od",
                    "payload": payload,
                    "message": "Please confirm to submit this On-Duty (OD) request.",
                },
            )

        consumed = consume_pending_confirmation(
            db, confirmation_id=str(confirmation_id), user_id=user.user_id, conversation_id=conversation_id
        )
        if consumed is None:
            return ToolExecutionResult(
                tool_name="submit_od_request",
                status="error",
                data={"error": "Invalid, expired, or already-used confirmation ID."},
            )

        api_res = await self.college_client.create_request(
            token,
            request_type="on_duty",
            from_date=payload["from_date"],
            to_date=payload["to_date"],
            half_day=payload["half_day"],
            reason=payload["reason"],
            event_name=payload["event_name"],
            idempotency_key=consumed.idempotency_key,
        )
        return ToolExecutionResult(tool_name="submit_od_request", status="success", data=api_res)

    async def _handle_my_requests(
        self, args: Dict[str, Any], user: AuthenticatedUser, db: Session, conversation_id: str
    ) -> ToolExecutionResult:
        items = await self.college_client.get_my_requests(user.college_jwt or "")
        return ToolExecutionResult(tool_name="get_my_requests", status="success", data={"requests": items})

    async def _handle_cancel_request(
        self, args: Dict[str, Any], user: AuthenticatedUser, db: Session, conversation_id: str
    ) -> ToolExecutionResult:
        req_id = int(args["request_id"])
        payload = {"request_id": req_id}
        confirmed = bool(args.get("confirmed", False))
        confirmation_id = args.get("confirmation_id")
        if not confirmed or not confirmation_id:
            pending = create_pending_confirmation(
                db,
                conversation_id=conversation_id,
                user_id=user.user_id,
                action_type="cancel_request",
                payload=payload,
            )
            return ToolExecutionResult(
                tool_name="cancel_my_request",
                status="pending_confirmation",
                data={
                    "confirmation_id": pending.id,
                    "action_type": "cancel_request",
                    "payload": payload,
                    "message": f"Confirm cancellation of request #{req_id}?",
                },
            )
        consumed = consume_pending_confirmation(
            db, confirmation_id=str(confirmation_id), user_id=user.user_id, conversation_id=conversation_id
        )
        if consumed is None:
            return ToolExecutionResult(
                tool_name="cancel_my_request",
                status="error",
                data={"error": "Invalid, expired, or already-used confirmation ID."},
            )
        res = await self.college_client.cancel_request(user.college_jwt or "", req_id)
        return ToolExecutionResult(tool_name="cancel_my_request", status="success", data=res)

    async def _handle_placement_drives(
        self, args: Dict[str, Any], user: AuthenticatedUser, db: Session, conversation_id: str
    ) -> ToolExecutionResult:
        drives = await self.college_client.list_placement_drives()
        return ToolExecutionResult(tool_name="get_placement_drives", status="success", data={"drives": drives})

    async def _handle_register_placement(
        self, args: Dict[str, Any], user: AuthenticatedUser, db: Session, conversation_id: str
    ) -> ToolExecutionResult:
        drive_id = int(args["drive_id"])
        payload = {"drive_id": drive_id}
        confirmed = bool(args.get("confirmed", False))
        confirmation_id = args.get("confirmation_id")
        if not confirmed or not confirmation_id:
            pending = create_pending_confirmation(
                db,
                conversation_id=conversation_id,
                user_id=user.user_id,
                action_type="register_placement",
                payload=payload,
            )
            return ToolExecutionResult(
                tool_name="register_placement",
                status="pending_confirmation",
                data={
                    "confirmation_id": pending.id,
                    "action_type": "register_placement",
                    "payload": payload,
                    "message": f"Confirm registration for placement drive #{drive_id}?",
                },
            )
        consumed = consume_pending_confirmation(
            db, confirmation_id=str(confirmation_id), user_id=user.user_id, conversation_id=conversation_id
        )
        if consumed is None:
            return ToolExecutionResult(
                tool_name="register_placement",
                status="error",
                data={"error": "Invalid, expired, or already-used confirmation ID."},
            )
        res = await self.college_client.register_placement_drive(user.college_jwt or "", drive_id)
        return ToolExecutionResult(tool_name="register_placement", status="success", data=res)

    async def _handle_my_placements(
        self, args: Dict[str, Any], user: AuthenticatedUser, db: Session, conversation_id: str
    ) -> ToolExecutionResult:
        items = await self.college_client.get_my_placements(user.college_jwt or "")
        return ToolExecutionResult(tool_name="get_my_placements", status="success", data={"registrations": items})

    async def _handle_teacher_profile(
        self, args: Dict[str, Any], user: AuthenticatedUser, db: Session, conversation_id: str
    ) -> ToolExecutionResult:
        token = user.college_jwt or ""
        profile = await self.college_client.get_me(token)
        classes = await self.college_client.get_teacher_classes(token)
        return ToolExecutionResult(
            tool_name="get_teacher_profile",
            status="success",
            data={"profile": profile, "authorized_classes": classes},
        )

    async def _handle_pending_requests(
        self, args: Dict[str, Any], user: AuthenticatedUser, db: Session, conversation_id: str
    ) -> ToolExecutionResult:
        status_filter = str(args.get("status", "pending")).strip() or "pending"
        items = await self.college_client.get_teacher_requests(user.college_jwt or "", status=status_filter)
        return ToolExecutionResult(
            tool_name="get_pending_requests",
            status="success",
            data={"status_filter": status_filter, "requests": items},
        )

    async def _handle_class_attendance(
        self, args: Dict[str, Any], user: AuthenticatedUser, db: Session, conversation_id: str
    ) -> ToolExecutionResult:
        class_id = int(args["class_id"])
        data = await self.college_client.get_class_attendance(user.college_jwt or "", class_id)
        return ToolExecutionResult(tool_name="get_class_attendance", status="success", data=data)

    async def _handle_review_leave_request(
        self, args: Dict[str, Any], user: AuthenticatedUser, db: Session, conversation_id: str
    ) -> ToolExecutionResult:
        decision = str(args.get("decision", "")).lower().strip()
        if decision not in {"approve", "reject"}:
            return ToolExecutionResult(
                tool_name="review_leave_request",
                status="error",
                data={"error": "Decision must be 'approve' or 'reject'."},
            )
        remarks = str(args.get("remarks", "")).strip()
        if decision == "reject" and not remarks:
            return ToolExecutionResult(
                tool_name="review_leave_request",
                status="error",
                data={"error": "A rejection reason ('remarks') is mandatory when rejecting a request."},
            )

        req_id = int(args["request_id"])
        payload = {"request_id": req_id, "decision": decision, "remarks": remarks}

        confirmed = bool(args.get("confirmed", False))
        confirmation_id = args.get("confirmation_id")
        if not confirmed or not confirmation_id:
            pending = create_pending_confirmation(
                db,
                conversation_id=conversation_id,
                user_id=user.user_id,
                action_type="review_leave",
                payload=payload,
            )
            return ToolExecutionResult(
                tool_name="review_leave_request",
                status="pending_confirmation",
                data={
                    "confirmation_id": pending.id,
                    "action_type": "review_leave",
                    "payload": payload,
                    "message": f"Explicit teacher confirmation required to {decision} request #{req_id}.",
                },
            )

        consumed = consume_pending_confirmation(
            db, confirmation_id=str(confirmation_id), user_id=user.user_id, conversation_id=conversation_id
        )
        if consumed is None:
            return ToolExecutionResult(
                tool_name="review_leave_request",
                status="error",
                data={"error": "Invalid, expired, or already-used confirmation ID."},
            )

        token = user.college_jwt or ""
        if decision == "approve":
            api_res = await self.college_client.approve_teacher_request(token, req_id, comment=remarks or None)
        else:
            api_res = await self.college_client.reject_teacher_request(token, req_id, reason=remarks)
        return ToolExecutionResult(tool_name="review_leave_request", status="success", data=api_res)
