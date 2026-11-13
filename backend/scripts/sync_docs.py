"""Download official KIT documents from `/v1/documents` into data/documents and print handbook/brochure/circular text."""

import asyncio
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import REPO_ROOT
from app.integrations.college_api import CollegeAPIClient
from app.knowledge.pdf_service import extract_pages_from_pdf_bytes


async def main() -> None:
    client = CollegeAPIClient()
    docs = await client.list_documents()
    out_dir = REPO_ROOT / "data" / "documents"
    out_dir.mkdir(parents=True, exist_ok=True)

    for doc in docs:
        doc_id = doc["id"]
        safe_title = re.sub(r'[<>:"/\\|?*]+', "_", str(doc["title"])).strip()
        raw = await client.download_document_file(int(doc_id))
        pdf_path = out_dir / f"{doc_id}_{safe_title}.pdf"
        pdf_path.write_bytes(raw)
        pages = extract_pages_from_pdf_bytes(raw)
        print(f"\n=== DOC {doc_id}: {doc['title']} ({doc['type']}, v{doc['version']}, effective {doc['effective_date']}) ===")
        if doc_id in (2, 3, 5):
            for pnum, text in pages:
                print(f"--- Page {pnum} ---")
                print(text)
        else:
            print(f"Pages: {len(pages)}, chars: {sum(len(t) for _, t in pages)}")


if __name__ == "__main__":
    asyncio.run(main())

