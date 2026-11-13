"""PDF document ingestion and lightweight keyword/TF retrieval for college PDFs."""

import io
import math
import re
from collections import Counter
from pathlib import Path
from typing import Iterable, List, Optional

from pydantic import BaseModel
from pypdf import PdfReader
from sqlalchemy.orm import Session

try:
    import fitz  # PyMuPDF (optional if native DLL runtime is present)
except ImportError:
    fitz = None

from app.database.models import KnowledgeChunk, KnowledgeDocument

TOKEN_RE = re.compile(r"[a-z0-9]+")
STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have",
    "in", "is", "it", "of", "on", "or", "that", "the", "this", "to", "was", "with",
}


class RetrievedChunk(BaseModel):
    filename: str
    doc_type: str
    page_number: int
    score: float
    content: str


def _tokenize(text: str) -> List[str]:
    return [t for t in TOKEN_RE.findall(text.lower()) if t not in STOPWORDS and len(t) > 1]


def _chunk_text(text: str, chunk_size: int = 800, overlap: int = 120) -> List[str]:
    cleaned = re.sub(r"\s+", " ", text).strip()
    if not cleaned:
        return []
    chunks: List[str] = []
    start = 0
    while start < len(cleaned):
        end = min(len(cleaned), start + chunk_size)
        chunks.append(cleaned[start:end].strip())
        if end >= len(cleaned):
            break
        start = max(0, end - overlap)
    return chunks


def extract_pages_from_pdf_bytes(raw_bytes: bytes) -> List[tuple[int, str]]:
    """Extract (1-indexed page_number, text) pairs using PyMuPDF when available, else pypdf."""
    pages: List[tuple[int, str]] = []
    if fitz is not None:
        with fitz.open(stream=raw_bytes, filetype="pdf") as doc:
            for idx, page in enumerate(doc, start=1):
                text = page.get_text("text") or ""
                if text.strip():
                    pages.append((idx, text))
        return pages

    reader = PdfReader(io.BytesIO(raw_bytes))
    for idx, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        if text.strip():
            pages.append((idx, text))
    return pages


def ingest_pdf_bytes(
    db: Session,
    *,
    filename: str,
    raw_bytes: bytes,
    doc_type: str = "other",
) -> KnowledgeDocument:
    """Extract text from a PDF and store/update its chunks in SQLite."""
    pages = extract_pages_from_pdf_bytes(raw_bytes)
    existing = db.query(KnowledgeDocument).filter(KnowledgeDocument.filename == filename).first()
    if existing is not None:
        db.delete(existing)
        db.flush()

    total_chars = sum(len(text) for _, text in pages)
    doc_row = KnowledgeDocument(
        filename=filename,
        doc_type=doc_type,
        page_count=len(pages),
        char_count=total_chars,
    )
    db.add(doc_row)
    db.flush()

    chunk_idx = 0
    for page_num, page_text in pages:
        for piece in _chunk_text(page_text):
            db.add(
                KnowledgeChunk(
                    document_id=doc_row.id,
                    chunk_index=chunk_idx,
                    page_number=page_num,
                    content=piece,
                )
            )
            chunk_idx += 1

    db.commit()
    db.refresh(doc_row)
    return doc_row


def infer_doc_type(filename: str) -> str:
    low = filename.lower()
    if "rule" in low or "handbook" in low or "policy" in low:
        return "rulebook"
    if "brochure" in low or "admission" in low:
        return "brochure"
    if "dbms" in low or "note" in low or "lesson" in low or "syllabus" in low:
        return "notes"
    return "other"


def ingest_directory(db: Session, docs_dir: Path) -> List[KnowledgeDocument]:
    """Ingest any PDF files placed inside docs_dir."""
    if not docs_dir.exists():
        return []
    ingested: List[KnowledgeDocument] = []
    for pdf_path in sorted(docs_dir.glob("*.pdf")):
        raw = pdf_path.read_bytes()
        doc = ingest_pdf_bytes(
            db,
            filename=pdf_path.name,
            raw_bytes=raw,
            doc_type=infer_doc_type(pdf_path.name),
        )
        ingested.append(doc)
    return ingested


def list_documents(db: Session) -> List[KnowledgeDocument]:
    return db.query(KnowledgeDocument).order_by(KnowledgeDocument.uploaded_at.desc()).all()


def retrieve_relevant_chunks(
    db: Session,
    query: str,
    *,
    doc_types: Optional[Iterable[str]] = None,
    top_k: int = 4,
) -> List[RetrievedChunk]:
    """Rank stored knowledge chunks against a query using TF-IDF + phrase matching."""
    q_tokens = _tokenize(query)
    if not q_tokens:
        return []

    stmt = db.query(KnowledgeChunk, KnowledgeDocument).join(
        KnowledgeDocument, KnowledgeChunk.document_id == KnowledgeDocument.id
    )
    if doc_types:
        stmt = stmt.filter(KnowledgeDocument.doc_type.in_(list(doc_types)))

    rows = stmt.all()
    if not rows:
        return []

    num_docs = len(rows)
    doc_freq: Counter[str] = Counter()
    tokenized_chunks: List[tuple[KnowledgeChunk, KnowledgeDocument, Counter[str], int]] = []

    for chunk, doc in rows:
        tokens = _tokenize(chunk.content)
        counts = Counter(tokens)
        for term in set(q_tokens):
            if counts.get(term, 0) > 0:
                doc_freq[term] += 1
        tokenized_chunks.append((chunk, doc, counts, max(len(tokens), 1)))

    q_lower = query.lower().strip()
    scored: List[RetrievedChunk] = []
    for chunk, doc, counts, chunk_len in tokenized_chunks:
        score = 0.0
        for term in q_tokens:
            tf = counts.get(term, 0) / chunk_len
            if tf > 0:
                idf = math.log((num_docs + 1) / (doc_freq[term] + 1)) + 1.0
                score += tf * idf
        if q_lower and q_lower in chunk.content.lower():
            score += 0.5
        if score > 0:
            scored.append(
                RetrievedChunk(
                    filename=doc.filename,
                    doc_type=doc.doc_type,
                    page_number=chunk.page_number,
                    score=round(score, 4),
                    content=chunk.content,
                )
            )

    scored.sort(key=lambda item: item.score, reverse=True)
    return scored[:top_k]
