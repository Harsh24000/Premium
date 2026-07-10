import io

from pypdf import PdfReader

MAX_CHARS = 100_000  # smart reports can run 15-20 pages, generous cap


class PdfExtractionError(Exception):
    pass


def _dedupe_lines(text: str) -> str:
    """
    These smart-report PDFs repeat the patient header block (Name/Accession
    No/Basic Info/Date of Test) on EVERY page — 21 times for a 21-page
    report, contributing nothing on repeats 2-21. Drop exact-duplicate
    lines after their first occurrence.
    """
    seen: set[str] = set()
    out: list[str] = []
    for line in text.split("\n"):
        stripped = line.strip()
        if not stripped:
            continue
        if stripped in seen:
            continue
        seen.add(stripped)
        out.append(line)
    return "\n".join(out)


def compact_for_extraction(text: str, max_line_len: int = 90) -> str:
    """
    Aggressively shrink the text sent to the extraction LLM call, since
    Groq's free-tier TPM limit (8000 tokens/minute on some accounts) can't
    fit a full 21-page report's raw text. Drops long narrative lines
    (explanatory paragraphs, "common reasons" prose, "did you know" trivia)
    since those map to fields the SmartReport schema already treats as
    optional/nullable — losing them means a less rich extraction, not an
    invalid one. Keeps short lines: headers, panel names, and — critically
    — the compact data rows (parameter name, value, unit, status, range),
    which is the data the chat actually needs to be grounded correctly.
    Measured on a real 21-page report: ~4800 tokens -> ~3000 tokens (38%).
    """
    deduped = _dedupe_lines(text)
    kept = [line for line in deduped.split("\n") if len(line.strip()) <= max_line_len]
    return "\n".join(kept)


def extract_text_from_pdf(data: bytes) -> str:
    """
    Extract text from a smart-report PDF. These reports (per the samples
    provided) have real selectable text underneath the visual layout —
    confirmed by reading them directly — so no OCR/vision step is needed
    here, unlike the free app's scanned-report fallback.
    """
    try:
        reader = PdfReader(io.BytesIO(data))
    except Exception as exc:
        raise PdfExtractionError(f"Could not read PDF: {exc}") from exc

    parts: list[str] = []
    for page in reader.pages:
        try:
            text = page.extract_text() or ""
        except Exception:
            text = ""
        if text.strip():
            parts.append(text)

    combined = "\n\n".join(parts).strip()
    if len(combined) < 50:
        raise PdfExtractionError(
            "No text could be extracted from this PDF. If it's a scanned "
            "image rather than a text-based report, this upload path can't "
            "process it yet."
        )
    return combined[:MAX_CHARS]
