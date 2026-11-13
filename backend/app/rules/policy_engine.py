"""Deterministic KIT 2026 Handbook + Circular 12/2026 policy validation and confirmation workflow."""

import hashlib
import json
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database.models import PendingConfirmation

WEEKDAYS = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}


class PolicyValidationResult(BaseModel):
    eligible: bool
    programme: str = "UG"
    from_date: Optional[str] = None
    to_date: Optional[str] = None
    resolved_date: Optional[str] = None
    reasons: List[str] = []
    warnings: List[str] = []
    missing_fields: List[str] = []
    requires_confirmation: bool = True
    policy_note: str = ""


def resolve_college_date(
    date_input: Optional[str],
    *,
    reference_today: Optional[date] = None,
    tz_name: Optional[str] = None,
) -> Optional[date]:
    """Resolve ISO date strings or relative phrases in the college's current date/timezone."""
    if not date_input or not date_input.strip():
        return None
    tz = ZoneInfo(tz_name or get_settings().COLLEGE_TIMEZONE)
    today = reference_today or datetime.now(tz).date()
    raw = date_input.strip().lower()

    if raw == "today":
        return today
    if raw == "tomorrow":
        return today + timedelta(days=1)

    next_match = re.match(r"^(next|this)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$", raw)
    if next_match:
        modifier, day_name = next_match.groups()
        target_wd = WEEKDAYS[day_name]
        days_ahead = (target_wd - today.weekday()) % 7
        if modifier == "next" and days_ahead == 0:
            days_ahead = 7
        return today + timedelta(days=days_ahead or (7 if modifier == "next" else 0))

    if raw in WEEKDAYS:
        target_wd = WEEKDAYS[raw]
        days_ahead = (target_wd - today.weekday()) % 7
        return today + timedelta(days=days_ahead)

    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


def _analyze_calendar_conflicts(
    *,
    start: date,
    end: date,
    calendar_events: Optional[List[Dict[str, Any]]],
    action_label: str,
) -> List[str]:
    """Check Sundays, holidays, working-day overrides, and internal exams over [start..end]."""
    reasons: List[str] = []
    events_by_date: Dict[str, List[Dict[str, Any]]] = {}
    for ev in calendar_events or []:
        if ev.get("status", "active") != "active":
            continue
        ev_date = str(ev.get("date", ""))
        events_by_date.setdefault(ev_date, []).append(ev)

    cursor = start
    while cursor <= end:
        iso = cursor.isoformat()
        day_events = events_by_date.get(iso, [])
        has_working_override = any(e.get("type") == "working_day" for e in day_events)
        for ev in day_events:
            ev_type = ev.get("type")
            title = ev.get("title") or ev_type
            if ev_type == "internal_exam":
                reasons.append(f"{action_label} conflict: Internal Assessment '{title}' scheduled on {iso} (Rule 6.1.4 / 6.4.7).")
            elif ev_type == "holiday":
                reasons.append(f"{iso} is a declared holiday ({title}).")
        if cursor.weekday() == 6 and not has_working_override and not any(e.get("type") == "holiday" for e in day_events):
            reasons.append(f"{iso} is a Sunday (Rule 3.3.3: Sundays are always holidays).")
        cursor += timedelta(days=1)
    return reasons


def _count_working_days_inclusive(start: date, end: date, calendar_events: Optional[List[Dict[str, Any]]]) -> int:
    holiday_dates = {
        str(ev.get("date"))
        for ev in (calendar_events or [])
        if ev.get("type") == "holiday" and ev.get("status", "active") == "active"
    }
    working_overrides = {
        str(ev.get("date"))
        for ev in (calendar_events or [])
        if ev.get("type") == "working_day" and ev.get("status", "active") == "active"
    }
    count = 0
    cursor = start
    while cursor <= end:
        iso = cursor.isoformat()
        if iso in working_overrides:
            count += 1
        elif cursor.weekday() < 5 and iso not in holiday_dates:
            count += 1
        cursor += timedelta(days=1)
    return count


def validate_leave_eligibility(
    *,
    requested_date: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    request_type: str = "personal_leave",
    half_day: bool = False,
    reason: Optional[str] = None,
    programme: str = "UG",
    attendance_percentage: Optional[float] = None,
    subject_attendance: Optional[List[Dict[str, Any]]] = None,
    calendar_events: Optional[List[Dict[str, Any]]] = None,
    exams_on_date: Optional[List[Dict[str, Any]]] = None,
    holidays_on_date: Optional[List[Dict[str, Any]]] = None,
    reference_today: Optional[date] = None,
    min_attendance_pct: Optional[float] = None,
) -> PolicyValidationResult:
    """Apply KIT Student Handbook 2026 rules for personal_leave and medical_leave."""
    reasons: List[str] = []
    warnings: List[str] = []
    missing: List[str] = []

    prog = (programme or "UG").upper().strip()
    is_pg = prog == "PG"
    required_att = min_attendance_pct if min_attendance_pct is not None else (80.0 if is_pg else 75.0)
    notice_days = 2 if is_pg else 1  # Rule 7.1.1 (48h PG) vs Rule 6.1.1 (24h UG)

    raw_from = from_date or requested_date
    raw_to = to_date or raw_from

    parsed_from = resolve_college_date(raw_from, reference_today=reference_today)
    parsed_to = resolve_college_date(raw_to, reference_today=reference_today)

    if parsed_from is None:
        missing.append("from_date (YYYY-MM-DD or relative date like 'tomorrow')")
    if parsed_to is None and parsed_from is not None:
        parsed_to = parsed_from
    if not reason or not reason.strip():
        missing.append("reason")

    if half_day and is_pg:
        reasons.append("Half-day leave is not available to M.Tech (PG) students (Rule 7.2.1).")

    if parsed_from is not None and parsed_to is not None:
        tz = ZoneInfo(get_settings().COLLEGE_TIMEZONE)
        today = reference_today or datetime.now(tz).date()
        if parsed_to < parsed_from:
            reasons.append(f"End date {parsed_to.isoformat()} cannot be before start date {parsed_from.isoformat()}.")

        if request_type == "medical_leave":
            if parsed_to < today:
                days_since_return = (today - parsed_to).days
                limit = 2 if is_pg else 3
                if days_since_return > limit:
                    warnings.append(
                        f"Medical leave must be applied within {limit} working days of returning (Rule {'7.3.1' if is_pg else '6.3.1'})."
                    )
            total_days = (parsed_to - parsed_from).days + 1
            if total_days >= 3:
                warnings.append("Medical absence of 3 or more days requires both a medical certificate and a fitness certificate (Rule 6.3.2 / 7.3.2).")
            else:
                warnings.append("Medical certificate must be submitted for verification; status stays 'proof pending' until verified.")
        else:
            if parsed_from < today:
                reasons.append(
                    f"Retrospective personal leave is not allowed ({parsed_from.isoformat()} is before college today {today.isoformat()}, Rule {'7.1.2' if is_pg else '6.1.2'})."
                )
            elif (parsed_from - today).days < notice_days:
                hours = notice_days * 24
                warnings.append(
                    f"Personal leave requires at least {hours} hours advance notice (Rule {'7.1.1' if is_pg else '6.1.1'}). Late requests may be rejected."
                )

            working_days = _count_working_days_inclusive(parsed_from, parsed_to, calendar_events)
            hod_limit = 2 if is_pg else 3
            if working_days > hod_limit:
                warnings.append(
                    f"Leave exceeding {hod_limit} consecutive working days requires HoD approval in addition to the advisor (Rule {'7.1.3' if is_pg else '6.1.3'})."
                )

        if holidays_on_date:
            reasons.append(f"{parsed_from.isoformat()} is a declared college holiday.")
        if exams_on_date:
            reasons.append(f"Leave cannot be applied on examination day ({parsed_from.isoformat()}, Rule 6.1.4).")
        reasons.extend(
            _analyze_calendar_conflicts(
                start=parsed_from,
                end=parsed_to,
                calendar_events=calendar_events,
                action_label="Leave",
            )
        )

    # Rule 4.1.2 / 5.1.2: eligibility is checked course by course, and sanctioned leave counts as absent (Rule 4.2.2)
    low_subjects = []
    for subj in subject_attendance or []:
        pct = subj.get("percentage")
        code = subj.get("subject_code") or subj.get("subject_name") or "Unknown"
        if pct is not None and float(pct) < required_att:
            low_subjects.append(f"{code} ({float(pct):.1f}%)")

    if low_subjects:
        reasons.append(
            f"Course-wise attendance is below the {required_att:.1f}% minimum in: {', '.join(low_subjects)} (Rule {'5.1.1' if is_pg else '4.1.1'}; sanctioned leave counts as absent under Rule 4.2.2)."
        )
    elif attendance_percentage is None:
        reasons.append("Attendance percentage could not be verified from the College API.")
    elif attendance_percentage < required_att:
        reasons.append(
            f"Attendance is {attendance_percentage:.1f}%, below the required {required_att:.1f}% threshold."
        )

    if not reasons and attendance_percentage is not None:
        warnings.append(
            "Note: Under Rule 4.2.2, periods missed on personal/medical leave still count as absent toward your course attendance %."
        )

    eligible = len(reasons) == 0 and len(missing) == 0
    return PolicyValidationResult(
        eligible=eligible,
        programme=prog,
        from_date=parsed_from.isoformat() if parsed_from else None,
        to_date=parsed_to.isoformat() if parsed_to else None,
        resolved_date=parsed_from.isoformat() if parsed_from else None,
        reasons=reasons,
        warnings=warnings,
        missing_fields=missing,
        requires_confirmation=True,
        policy_note=(
            f"Evaluated for {prog} under KIT Student Handbook 2026 "
            f"({'80% min / 48h notice' if is_pg else '75% min / 24h notice'}), live /v1/today, /v1/me/attendance, and /v1/calendar."
        ),
    )


def validate_od_eligibility(
    *,
    requested_date: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    reason: Optional[str] = None,
    event_name: Optional[str] = None,
    programme: str = "UG",
    calendar_events: Optional[List[Dict[str, Any]]] = None,
    exams_on_date: Optional[List[Dict[str, Any]]] = None,
    holidays_on_date: Optional[List[Dict[str, Any]]] = None,
    reference_today: Optional[date] = None,
) -> PolicyValidationResult:
    """Apply KIT Handbook 2026 + Circular 12/2026 rules for On-Duty (OD) requests."""
    reasons: List[str] = []
    warnings: List[str] = []
    missing: List[str] = []

    prog = (programme or "UG").upper().strip()
    is_pg = prog == "PG"

    raw_from = from_date or requested_date
    raw_to = to_date or raw_from

    parsed_from = resolve_college_date(raw_from, reference_today=reference_today)
    parsed_to = resolve_college_date(raw_to, reference_today=reference_today)

    if parsed_from is None:
        missing.append("from_date")
    if parsed_to is None and parsed_from is not None:
        parsed_to = parsed_from
    if not reason or not reason.strip():
        missing.append("reason")
    if not event_name or not event_name.strip():
        missing.append("event_name")

    if parsed_from is not None and parsed_to is not None:
        tz = ZoneInfo(get_settings().COLLEGE_TIMEZONE)
        today = reference_today or datetime.now(tz).date()
        if parsed_to < parsed_from:
            reasons.append(f"End date {parsed_to.isoformat()} cannot be before start date {parsed_from.isoformat()}.")
        if parsed_from < today:
            reasons.append(
                f"On-duty must be submitted before the event ({parsed_from.isoformat()} is before college today {today.isoformat()}, Rule 6.4.2)."
            )
        if holidays_on_date:
            reasons.append(f"{parsed_from.isoformat()} is a declared college holiday.")
        if exams_on_date:
            reasons.append(f"OD conflict: Internal Assessment scheduled on {parsed_from.isoformat()} (Rule 6.4.7).")
        reasons.extend(
            _analyze_calendar_conflicts(
                start=parsed_from,
                end=parsed_to,
                calendar_events=calendar_events,
                action_label="OD",
            )
        )

    proof_days = 5 if is_pg else 3  # Circular 12/2026 overrides Rule 6.4.3 to 3 working days for B.Tech
    max_od_days = 6 if is_pg else 10  # Rule 7.4.2 vs Rule 6.4.5
    warnings.append(
        f"Participation proof must be submitted within {proof_days} working days after the event "
        f"({'Rule 7.4.3' if is_pg else 'Circular 12/2026'}). Semester cap: {max_od_days} working days."
    )

    eligible = len(reasons) == 0 and len(missing) == 0
    return PolicyValidationResult(
        eligible=eligible,
        programme=prog,
        from_date=parsed_from.isoformat() if parsed_from else None,
        to_date=parsed_to.isoformat() if parsed_to else None,
        resolved_date=parsed_from.isoformat() if parsed_from else None,
        reasons=reasons,
        warnings=warnings,
        missing_fields=missing,
        requires_confirmation=True,
        policy_note=f"Evaluated for {prog} under KIT Handbook 2026 and Circular 12/2026.",
    )


def build_idempotency_key(user_id: str, action_type: str, payload: Dict[str, Any]) -> str:
    canonical = json.dumps({"user_id": user_id, "action": action_type, "payload": payload}, sort_keys=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def create_pending_confirmation(
    db: Session,
    *,
    conversation_id: str,
    user_id: str,
    action_type: str,
    payload: Dict[str, Any],
    ttl_minutes: int = 15,
) -> PendingConfirmation:
    """Create or return an existing pending confirmation to prevent duplicate submissions."""
    idem_key = build_idempotency_key(user_id, action_type, payload)
    existing = db.query(PendingConfirmation).filter(PendingConfirmation.idempotency_key == idem_key).first()
    if existing is not None:
        return existing

    row = PendingConfirmation(
        conversation_id=conversation_id,
        user_id=user_id,
        action_type=action_type,
        payload_json=json.dumps(payload, sort_keys=True),
        idempotency_key=idem_key,
        status="pending",
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=ttl_minutes),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_latest_pending_confirmation(
    db: Session, *, conversation_id: str, user_id: str
) -> Optional[PendingConfirmation]:
    now = datetime.now(timezone.utc)
    row = (
        db.query(PendingConfirmation)
        .filter(
            PendingConfirmation.conversation_id == conversation_id,
            PendingConfirmation.user_id == user_id,
            PendingConfirmation.status == "pending",
        )
        .order_by(PendingConfirmation.created_at.desc())
        .first()
    )
    if row is None:
        return None
    exp = row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=timezone.utc)
    if exp <= now:
        row.status = "expired"
        db.commit()
        return None
    return row


def consume_pending_confirmation(
    db: Session, *, confirmation_id: str, user_id: str, conversation_id: str
) -> Optional[PendingConfirmation]:
    row = db.get(PendingConfirmation, confirmation_id)
    if row is None or row.user_id != user_id or row.conversation_id != conversation_id:
        return None
    if row.status != "pending":
        return None
    exp = row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=timezone.utc)
    if exp <= datetime.now(timezone.utc):
        row.status = "expired"
        db.commit()
        return None
    row.status = "executed"
    db.commit()
    db.refresh(row)
    return row


def cancel_pending_confirmation(
    db: Session, *, confirmation_id: str, user_id: str, conversation_id: str
) -> bool:
    row = db.get(PendingConfirmation, confirmation_id)
    if row is None or row.user_id != user_id or row.conversation_id != conversation_id:
        return False
    row.status = "cancelled"
    db.commit()
    return True
