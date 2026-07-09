import io

from pypdf import PdfReader

MAX_CHARS = 100_000  # smart reports can run 15-20 pages, generous cap


class PdfExtractionError(Exception):
    pass


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
