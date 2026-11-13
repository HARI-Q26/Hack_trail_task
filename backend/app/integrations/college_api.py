"""HTTPX client bound to the verified Knotopian Institute of Technology (KIT) OpenAPI v1.0.0 contract."""

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from pydantic import BaseModel

from app.config import REPO_ROOT, get_settings


class CollegeAPIError(Exception):
    """Base exception for College API failures."""

    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class CollegeAPIUnavailableError(CollegeAPIError):
    """Raised when the external College API is unreachable or times out."""


class CollegeAPIAuthError(CollegeAPIError):
    """Raised when authentication fails, participant key is invalid, or JWT is invalid/expired."""


class CollegeOperationNotSupportedError(CollegeAPIError):
    """Raised when an operation is not present in the verified OpenAPI specification."""


class OpenAPISpecSummary(BaseModel):
    """Summary of verified endpoints discovered from the College API OpenAPI spec."""

    available: bool
    base_url: str
    title: Optional[str] = None
    version: Optional[str] = None
    paths: Dict[str, List[str]] = {}
    error: Optional[str] = None


class CollegeAPIClient:
    """Async HTTPX wrapper around the verified KIT College System API (`/v1/*`)."""

    def __init__(
        self,
        base_url: Optional[str] = None,
        participant_key: Optional[str] = None,
        timeout_seconds: Optional[float] = None,
        spec_cache_path: Optional[Path] = None,
    ):
        settings = get_settings()
        self.base_url = (base_url or settings.COLLEGE_API_BASE_URL).rstrip("/")
        self.participant_key = (
            participant_key if participant_key is not None else settings.COLLEGE_PARTICIPANT_KEY
        ).strip()
        self.timeout = timeout_seconds or settings.COLLEGE_API_TIMEOUT_SECONDS
        self.spec_cache_path = spec_cache_path or self._resolve_default_spec_path()
        self._spec: Optional[Dict[str, Any]] = None

    @staticmethod
    def _resolve_default_spec_path() -> Path:
        local_path = Path("./data/college_openapi.json")
        if local_path.exists():
            return local_path
        repo_path = REPO_ROOT / "data" / "college_openapi.json"
        if repo_path.exists():
            return repo_path
        return local_path

    def _build_client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=self.base_url,
            timeout=httpx.Timeout(self.timeout),
            follow_redirects=True,
        )

    def _build_headers(
        self,
        *,
        bearer_token: Optional[str] = None,
        idempotency_key: Optional[str] = None,
        accept: str = "application/json",
    ) -> Dict[str, str]:
        headers: Dict[str, str] = {"Accept": accept}
        if self.participant_key:
            headers["X-Participant-Key"] = self.participant_key
        if bearer_token:
            headers["Authorization"] = f"Bearer {bearer_token}"
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        return headers

    def load_cached_spec(self) -> Optional[Dict[str, Any]]:
        """Load cached OpenAPI JSON if previously saved/verified."""
        if self._spec is not None:
            return self._spec
        if self.spec_cache_path.exists():
            try:
                data = json.loads(self.spec_cache_path.read_text(encoding="utf-8"))
                if isinstance(data, dict) and "paths" in data:
                    self._spec = data
                    return data
            except (ValueError, OSError):
                return None
        return None

    async def fetch_openapi_spec(self, force_refresh: bool = False) -> OpenAPISpecSummary:
        """Return OpenAPI summary from live `/openapi.json` or verified local cache."""
        if not force_refresh:
            cached = self.load_cached_spec()
            if cached is not None:
                return self._summarize_spec(cached)

        try:
            async with self._build_client() as client:
                resp = await client.get("/openapi.json")
        except httpx.TimeoutException as exc:
            cached = self.load_cached_spec()
            if cached is not None:
                return self._summarize_spec(cached)
            return OpenAPISpecSummary(
                available=False,
                base_url=self.base_url,
                error=f"Timed out connecting to College API OpenAPI endpoint: {exc}",
            )
        except httpx.RequestError as exc:
            cached = self.load_cached_spec()
            if cached is not None:
                return self._summarize_spec(cached)
            return OpenAPISpecSummary(
                available=False,
                base_url=self.base_url,
                error=f"Network error connecting to College API: {exc}",
            )

        if resp.status_code == 200:
            try:
                data = resp.json()
                if isinstance(data, dict) and "paths" in data:
                    self._spec = data
                    self.spec_cache_path.parent.mkdir(parents=True, exist_ok=True)
                    self.spec_cache_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
                    return self._summarize_spec(data)
            except ValueError:
                pass

        cached = self.load_cached_spec()
        if cached is not None:
            return self._summarize_spec(cached)

        return OpenAPISpecSummary(
            available=False,
            base_url=self.base_url,
            error=f"College API /openapi.json returned HTTP {resp.status_code}: {resp.text[:250]}",
        )

    def _summarize_spec(self, spec: Dict[str, Any]) -> OpenAPISpecSummary:
        paths_summary: Dict[str, List[str]] = {}
        for path, methods in spec.get("paths", {}).items():
            if isinstance(methods, dict):
                paths_summary[path] = [
                    m.upper()
                    for m in methods.keys()
                    if m.lower() in {"get", "post", "put", "patch", "delete"}
                ]
        info = spec.get("info", {})
        return OpenAPISpecSummary(
            available=True,
            base_url=self.base_url,
            title=info.get("title"),
            version=info.get("version"),
            paths=paths_summary,
        )

    def has_endpoint(self, path: str, method: str = "GET") -> bool:
        spec = self.load_cached_spec()
        if not spec:
            return False
        path_item = spec.get("paths", {}).get(path)
        if not isinstance(path_item, dict):
            return False
        return method.lower() in path_item

    async def request_raw(
        self,
        method: str,
        path: str,
        *,
        bearer_token: Optional[str] = None,
        json_body: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, Any]] = None,
        idempotency_key: Optional[str] = None,
        expect_bytes: bool = False,
    ) -> Any:
        """Execute an HTTP request against a verified KIT College API endpoint."""
        headers = self._build_headers(
            bearer_token=bearer_token,
            idempotency_key=idempotency_key,
            accept="application/pdf,*/*" if expect_bytes else "application/json",
        )

        try:
            async with self._build_client() as client:
                resp = await client.request(
                    method=method.upper(),
                    url=path,
                    headers=headers,
                    json=json_body,
                    params=params,
                )
        except httpx.TimeoutException as exc:
            raise CollegeAPIUnavailableError(f"College API request timed out: {exc}", status_code=504) from exc
        except httpx.RequestError as exc:
            raise CollegeAPIUnavailableError(f"College API connection failed: {exc}", status_code=503) from exc

        if resp.status_code in (401, 403):
            detail = self._extract_error_detail(resp)
            raise CollegeAPIAuthError(
                detail or f"College API authentication/authorization failed (HTTP {resp.status_code}).",
                status_code=resp.status_code,
            )

        if resp.status_code == 404:
            if "railway" in resp.headers.get("server", "").lower() or "Application not found" in resp.text:
                raise CollegeAPIUnavailableError(
                    "External College API host returned 404 (Application not found).",
                    status_code=503,
                )
            raise CollegeAPIError(self._extract_error_detail(resp) or f"Resource not found at {path}.", status_code=404)

        if resp.status_code >= 500:
            raise CollegeAPIUnavailableError(
                f"College API returned server error HTTP {resp.status_code}.",
                status_code=resp.status_code,
            )

        if resp.status_code >= 400:
            detail = self._extract_error_detail(resp)
            raise CollegeAPIError(
                detail or f"College API rejected request (HTTP {resp.status_code}).",
                status_code=resp.status_code,
            )

        if expect_bytes:
            return resp.content

        if not resp.content:
            return {"status": "ok"}

        try:
            return resp.json()
        except ValueError:
            return {"raw_text": resp.text}

    @staticmethod
    def _extract_error_detail(resp: httpx.Response) -> str:
        try:
            data = resp.json()
            if isinstance(data, dict):
                detail = data.get("detail") or data.get("message") or data.get("error")
                if isinstance(detail, str):
                    return detail
                if detail is not None:
                    return json.dumps(detail)
        except ValueError:
            pass
        return resp.text[:300].strip()

    async def request(
        self,
        method: str,
        path: str,
        *,
        bearer_token: Optional[str] = None,
        json_body: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, Any]] = None,
        idempotency_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        payload = await self.request_raw(
            method,
            path,
            bearer_token=bearer_token,
            json_body=json_body,
            params=params,
            idempotency_key=idempotency_key,
        )
        return payload if isinstance(payload, dict) else {"items": payload}

    # --- Exact KIT OpenAPI v1.0.0 Endpoint Methods ---

    async def health(self) -> Dict[str, Any]:
        return await self.request("GET", "/v1/health")

    async def get_today(self) -> Dict[str, Any]:
        return await self.request("GET", "/v1/today")

    async def get_college_info(self) -> Dict[str, Any]:
        return await self.request("GET", "/v1/college")

    async def list_courses(self) -> List[Dict[str, Any]]:
        res = await self.request_raw("GET", "/v1/courses")
        return res if isinstance(res, list) else []

    async def submit_admission_application(
        self,
        *,
        full_name: str,
        phone: str,
        email: str,
        course_code: str,
        twelfth_percent: float,
        idempotency_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        return await self.request(
            "POST",
            "/v1/admissions/applications",
            json_body={
                "full_name": full_name,
                "phone": phone,
                "email": email,
                "course_code": course_code,
                "twelfth_percent": twelfth_percent,
            },
            idempotency_key=idempotency_key,
        )

    async def list_documents(self) -> List[Dict[str, Any]]:
        res = await self.request_raw("GET", "/v1/documents")
        return res if isinstance(res, list) else []

    async def download_document_file(self, document_id: int) -> bytes:
        return await self.request_raw("GET", f"/v1/documents/{document_id}/file", expect_bytes=True)

    async def login(self, login_id: str, password: str) -> Dict[str, Any]:
        """Authenticate using exact LoginRequest { login_id, password } against POST /v1/auth/login."""
        return await self.request(
            "POST",
            "/v1/auth/login",
            json_body={"login_id": login_id, "password": password},
        )

    async def get_me(self, bearer_token: str) -> Dict[str, Any]:
        return await self.request("GET", "/v1/me", bearer_token=bearer_token)

    async def get_my_academics(self, bearer_token: str) -> Dict[str, Any]:
        return await self.request("GET", "/v1/me/academics", bearer_token=bearer_token)

    async def get_my_subjects(self, bearer_token: str) -> List[Dict[str, Any]]:
        res = await self.request_raw("GET", "/v1/me/subjects", bearer_token=bearer_token)
        return res if isinstance(res, list) else []

    async def get_my_timetable(self, bearer_token: str) -> List[Dict[str, Any]]:
        res = await self.request_raw("GET", "/v1/me/timetable", bearer_token=bearer_token)
        return res if isinstance(res, list) else []

    async def get_calendar(
        self,
        *,
        bearer_token: Optional[str] = None,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        params: Dict[str, Any] = {}
        if from_date:
            params["from"] = from_date
        if to_date:
            params["to"] = to_date
        res = await self.request_raw("GET", "/v1/calendar", bearer_token=bearer_token, params=params or None)
        return res if isinstance(res, list) else []

    async def get_my_attendance(self, bearer_token: str) -> Dict[str, Any]:
        return await self.request("GET", "/v1/me/attendance", bearer_token=bearer_token)

    async def get_my_attendance_sessions(
        self,
        bearer_token: str,
        *,
        subject: Optional[str] = None,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        params: Dict[str, Any] = {}
        if subject:
            params["subject"] = subject
        if from_date:
            params["from"] = from_date
        if to_date:
            params["to"] = to_date
        res = await self.request_raw(
            "GET", "/v1/me/attendance/sessions", bearer_token=bearer_token, params=params or None
        )
        return res if isinstance(res, list) else []

    async def get_my_requests(self, bearer_token: str) -> List[Dict[str, Any]]:
        res = await self.request_raw("GET", "/v1/me/requests", bearer_token=bearer_token)
        return res if isinstance(res, list) else []

    async def create_request(
        self,
        bearer_token: str,
        *,
        request_type: str,
        from_date: str,
        to_date: str,
        reason: str,
        half_day: bool = False,
        event_name: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {
            "type": request_type,
            "from_date": from_date,
            "to_date": to_date,
            "half_day": half_day,
            "reason": reason,
        }
        if event_name:
            body["event_name"] = event_name
        return await self.request(
            "POST",
            "/v1/me/requests",
            bearer_token=bearer_token,
            json_body=body,
            idempotency_key=idempotency_key,
        )

    async def get_request(self, bearer_token: str, request_id: int) -> Dict[str, Any]:
        return await self.request("GET", f"/v1/me/requests/{request_id}", bearer_token=bearer_token)

    async def cancel_request(self, bearer_token: str, request_id: int) -> Dict[str, Any]:
        return await self.request("POST", f"/v1/me/requests/{request_id}/cancel", bearer_token=bearer_token)

    async def list_placement_drives(self) -> List[Dict[str, Any]]:
        res = await self.request_raw("GET", "/v1/placements/drives")
        return res if isinstance(res, list) else []

    async def register_placement_drive(self, bearer_token: str, drive_id: int) -> Dict[str, Any]:
        return await self.request("POST", f"/v1/placements/drives/{drive_id}/register", bearer_token=bearer_token)

    async def get_my_placements(self, bearer_token: str) -> List[Dict[str, Any]]:
        res = await self.request_raw("GET", "/v1/me/placements", bearer_token=bearer_token)
        return res if isinstance(res, list) else []

    async def get_teacher_classes(self, bearer_token: str) -> List[Dict[str, Any]]:
        res = await self.request_raw("GET", "/v1/teacher/classes", bearer_token=bearer_token)
        return res if isinstance(res, list) else []

    async def get_teacher_requests(
        self, bearer_token: str, *, status: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        params = {"status": status} if status else None
        res = await self.request_raw("GET", "/v1/teacher/requests", bearer_token=bearer_token, params=params)
        return res if isinstance(res, list) else []

    async def get_class_attendance(self, bearer_token: str, class_id: int) -> Dict[str, Any]:
        return await self.request("GET", f"/v1/teacher/classes/{class_id}/attendance", bearer_token=bearer_token)

    async def approve_teacher_request(
        self, bearer_token: str, request_id: int, comment: Optional[str] = None
    ) -> Dict[str, Any]:
        body = {"comment": comment} if comment else None
        return await self.request(
            "POST", f"/v1/teacher/requests/{request_id}/approve", bearer_token=bearer_token, json_body=body
        )

    async def reject_teacher_request(
        self, bearer_token: str, request_id: int, reason: str
    ) -> Dict[str, Any]:
        return await self.request(
            "POST",
            f"/v1/teacher/requests/{request_id}/reject",
            bearer_token=bearer_token,
            json_body={"reason": reason},
        )
