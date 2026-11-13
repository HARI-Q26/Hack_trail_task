"""Session authentication, HTTP-only cookie management, and role-based access control."""

import base64
import json
import secrets
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Optional

from fastapi import Cookie, Depends, HTTPException, Request, Response, status
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database.models import UserSession
from app.database.session import get_db


class UserRole(str, Enum):
    PUBLIC = "public"
    STUDENT = "student"
    TEACHER = "teacher"


class AuthenticatedUser(BaseModel):
    """Represents the resolved caller identity for the current request."""

    user_id: str
    role: UserRole
    display_name: str = ""
    is_authenticated: bool = False
    session_id: Optional[str] = None
    college_jwt: Optional[str] = None


def _get_serializer() -> URLSafeTimedSerializer:
    settings = get_settings()
    return URLSafeTimedSerializer(settings.SESSION_SECRET_KEY, salt="quirri-session-cookie")


def decode_jwt_expiry_unverified(token: str) -> Optional[datetime]:
    """Read `exp` claim from a JWT without verifying signature (college API validates signature)."""
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        payload_b64 = parts[1] + "=" * (-len(parts[1]) % 4)
        payload = json.loads(base64.urlsafe_b64decode(payload_b64.encode("utf-8")).decode("utf-8"))
        exp = payload.get("exp")
        if isinstance(exp, (int, float)):
            return datetime.fromtimestamp(exp, tz=timezone.utc)
    except Exception:
        return None
    return None


def create_user_session(
    db: Session,
    *,
    user_id: str,
    role: UserRole,
    display_name: str,
    college_jwt: str,
    expires_at: Optional[datetime] = None,
) -> UserSession:
    """Persist a server-side authenticated session storing the College API JWT."""
    settings = get_settings()
    default_exp = datetime.now(timezone.utc) + timedelta(minutes=settings.SESSION_EXPIRE_MINUTES)
    jwt_exp = decode_jwt_expiry_unverified(college_jwt)
    resolved_exp = expires_at or (min(default_exp, jwt_exp) if jwt_exp else default_exp)

    session = UserSession(
        id=secrets.token_urlsafe(32),
        user_id=user_id,
        user_role=role.value,
        display_name=display_name,
        college_jwt=college_jwt,
        expires_at=resolved_exp,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def delete_user_session(db: Session, session_id: str) -> None:
    """Remove a session record on logout or invalidation."""
    row = db.get(UserSession, session_id)
    if row is not None:
        db.delete(row)
        db.commit()


def _resolve_cookie_policy(request: Optional[Request]) -> tuple[bool, str]:
    settings = get_settings()
    if request is not None:
        forwarded_proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower()
        if forwarded_proto == "https" or request.url.scheme == "https":
            return True, "none"
    return settings.COOKIE_SECURE, settings.COOKIE_SAMESITE


def set_session_cookie(response: Response, session_id: str, request: Optional[Request] = None) -> None:
    """Attach an HTTP-only signed session cookie."""
    settings = get_settings()
    secure, samesite = _resolve_cookie_policy(request)
    signed = _get_serializer().dumps({"sid": session_id})
    response.set_cookie(
        key=settings.SESSION_COOKIE_NAME,
        value=signed,
        httponly=True,
        secure=secure,
        samesite=samesite,
        max_age=settings.SESSION_EXPIRE_MINUTES * 60,
        path="/",
    )


def clear_session_cookie(response: Response, request: Optional[Request] = None) -> None:
    settings = get_settings()
    secure, samesite = _resolve_cookie_policy(request)
    response.delete_cookie(key=settings.SESSION_COOKIE_NAME, path="/", secure=secure, samesite=samesite)


def get_or_create_public_visitor_id(request: Request, response: Response) -> str:
    """Issue a signed HTTP-only anonymous visitor ID so public conversation history stays private to its browser."""
    cookie_name = "quirri_visitor"
    raw = request.cookies.get(cookie_name)
    serializer = _get_serializer()
    if raw:
        try:
            data = serializer.loads(raw, max_age=60 * 60 * 24 * 7)
            vid = data.get("vid")
            if isinstance(vid, str) and vid.startswith("pub_"):
                return vid
        except (BadSignature, SignatureExpired):
            pass

    visitor_id = f"pub_{secrets.token_hex(12)}"
    secure, samesite = _resolve_cookie_policy(request)
    response.set_cookie(
        key=cookie_name,
        value=serializer.dumps({"vid": visitor_id}),
        httponly=True,
        secure=secure,
        samesite=samesite,
        max_age=60 * 60 * 24 * 7,
        path="/",
    )
    return visitor_id


def _normalize_aware_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def get_current_user(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> AuthenticatedUser:
    """Resolve authenticated user from HTTP-only session cookie, or fall back to Public visitor mode."""
    settings = get_settings()
    cookie_val = request.cookies.get(settings.SESSION_COOKIE_NAME)
    if cookie_val:
        try:
            payload = _get_serializer().loads(cookie_val, max_age=settings.SESSION_EXPIRE_MINUTES * 60)
            sid = payload.get("sid")
            if isinstance(sid, str):
                row = db.get(UserSession, sid)
                if row is not None:
                    now = datetime.now(timezone.utc)
                    jwt_exp = decode_jwt_expiry_unverified(row.college_jwt)
                    if _normalize_aware_utc(row.expires_at) > now and (jwt_exp is None or jwt_exp > now):
                        return AuthenticatedUser(
                            user_id=row.user_id,
                            role=UserRole(row.user_role),
                            display_name=row.display_name,
                            is_authenticated=True,
                            session_id=row.id,
                            college_jwt=row.college_jwt,
                        )
                    # Expired session cleanup
                    db.delete(row)
                    db.commit()
        except (BadSignature, SignatureExpired, ValueError):
            pass
        clear_session_cookie(response, request)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired or invalid. Please log in again.",
        )

    visitor_id = get_or_create_public_visitor_id(request, response)
    return AuthenticatedUser(
        user_id=visitor_id,
        role=UserRole.PUBLIC,
        display_name="Public Visitor",
        is_authenticated=False,
    )


def require_authenticated_user(user: AuthenticatedUser = Depends(get_current_user)) -> AuthenticatedUser:
    """Dependency requiring a logged-in student or teacher."""
    if not user.is_authenticated or user.role == UserRole.PUBLIC:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )
    return user


def require_roles(*allowed_roles: UserRole):
    """Dependency factory enforcing specific role permissions."""

    def _checker(user: AuthenticatedUser = Depends(get_current_user)) -> AuthenticatedUser:
        if user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to perform this action.",
            )
        return user

    return _checker

