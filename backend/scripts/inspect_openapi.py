"""CLI utility to inspect and summarize the external College API OpenAPI specification."""

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.integrations.college_api import CollegeAPIClient


async def main() -> int:
    client = CollegeAPIClient()
    summary = await client.fetch_openapi_spec(force_refresh=True)
    print(json.dumps(summary.model_dump(), indent=2))
    return 0 if summary.available else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

