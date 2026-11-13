"""College API integration package."""

from app.integrations.college_api import (
    CollegeAPIAuthError,
    CollegeAPIError,
    CollegeAPIUnavailableError,
    CollegeAPIClient,
    CollegeOperationNotSupportedError,
    OpenAPISpecSummary,
)

__all__ = [
    "CollegeAPIClient",
    "CollegeAPIError",
    "CollegeAPIUnavailableError",
    "CollegeAPIAuthError",
    "CollegeOperationNotSupportedError",
    "OpenAPISpecSummary",
]

