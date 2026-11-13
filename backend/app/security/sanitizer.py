"""Sanitization utilities to ensure secrets, passwords, and JWTs are never logged or persisted."""

import json
import re
from typing import Any

SENSITIVE_KEYS = {
    "password",
    "passwd",
    "token",
    "access_token",
    "refresh_token",
    "id_token",
    "college_jwt",
    "authorization",
    "cookie",
    "set-cookie",
    "secret",
    "api_key",
    "grok_api_key",
    "gemini_api_key",
    "session_secret_key",
    "x-participant-key",
    "participant_key",
    "college_participant_key",
}

BEARER_PATTERN = re.compile(r"(Bearer\s+)[A-Za-z0-9\-._~+/]+=*", re.IGNORECASE)
JWT_PATTERN = re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b")


def redact_sensitive_data(value: Any) -> Any:
    """Recursively redact sensitive fields and bearer/JWT tokens."""
    if isinstance(value, dict):
        sanitized: dict[str, Any] = {}
        for k, v in value.items():
            key_lower = str(k).lower()
            if key_lower in SENSITIVE_KEYS or any(
                s in key_lower for s in ("password", "token", "secret", "auth", "participant_key", "api_key")
            ):
                sanitized[str(k)] = "[REDACTED]"
            else:
                sanitized[str(k)] = redact_sensitive_data(v)
        return sanitized
    if isinstance(value, list):
        return [redact_sensitive_data(item) for item in value]
    if isinstance(value, str):
        redacted = BEARER_PATTERN.sub(r"\1[REDACTED]", value)
        redacted = JWT_PATTERN.sub("[REDACTED_JWT]", redacted)
        return redacted
    return value


def safe_json_dumps(value: Any, max_length: int = 4000) -> str:
    """Serialize sanitized data to JSON truncated safely."""
    sanitized = redact_sensitive_data(value)
    text = json.dumps(sanitized, default=str, ensure_ascii=False)
    if len(text) > max_length:
        return text[: max_length - 15] + "...[truncated]"
    return text

