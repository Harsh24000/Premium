import uuid

import groq
import pydantic
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .config import get_settings
from .infographic import build_infographic_summary
from .llm_client import extract_smart_report_from_text, generate_high_risk_starter_questions, stream_chat
from .models import SmartReport, safe_parse_smart_report
from .raw_to_smart import generate_smart_report_from_raw
from .pdf_utils import PdfExtractionError, extract_text_from_pdf
from .store import Session, get_session, save_session

settings = get_settings()

app = FastAPI(title="NirogGyan Premium API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,  # set ALLOWED_ORIGINS env var to your deployed frontend URL
    allow_credentials=False,  # no cookie-based auth here — this also avoids the wildcard+credentials CORS conflict
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_UPLOAD_BYTES = 15 * 1024 * 1024


class SubmitReportResponse(BaseModel):
    session_id: str
    infographic: dict
    starter_questions: list[str]
    # The full parsed report. The dashboard renders panels, parameters,
    # diet plan and next steps directly from this — previously only the
    # infographic summary was returned, which wasn't enough to build a
    # report view on the client.
    report: SmartReport


class ChatRequest(BaseModel):
    session_id: str
    message: str


def _create_session_response(report: SmartReport) -> SubmitReportResponse:
    """Shared by both the direct-JSON and PDF-upload paths."""
    session_id = str(uuid.uuid4())
    session = Session(session_id=session_id, report=report)
    save_session(session)

    infographic = build_infographic_summary(report)
    try:
        starter_questions = generate_high_risk_starter_questions(report)
    except Exception:
        starter_questions = []

    return SubmitReportResponse(
        session_id=session_id,
        infographic=infographic,
        starter_questions=starter_questions,
        report=report,
    )


@app.post("/api/report", response_model=SubmitReportResponse)
async def submit_report(report: dict) -> SubmitReportResponse:
    """
    Accepts an already-structured SmartReport JSON directly. Uses the same
    defensive parser as the PDF path (safe_parse_smart_report) rather than
    FastAPI's automatic strict validation — real report exports from
    different sources won't all match this schema exactly, and a single
    missing/extra field shouldn't hard-fail the whole submission before
    even reaching application code.
    """
    if not settings.groq_api_key:
        raise HTTPException(500, "Server is missing GROQ_API_KEY.")

    try:
        parsed = safe_parse_smart_report(report)
    except pydantic.ValidationError as exc:
        raise HTTPException(
            422, f"This JSON is missing something essential (patient name is required): {exc}"
        ) from exc

    return _create_session_response(parsed)


@app.post("/api/report/raw", response_model=SubmitReportResponse)
async def submit_raw_report(raw: dict) -> SubmitReportResponse:
    """
    Accepts the RAW diagnofirm-format lab export (patient info + results/
    investigation/observations, no wellness score or narrative content).
    Computes status deterministically wherever a real numeric range
    exists, uses the LLM only to classify genuinely ambiguous qualitative
    results and generate narrative content — see raw_to_smart.py.
    """
    if not settings.groq_api_key:
        raise HTTPException(500, "Server is missing GROQ_API_KEY.")

    try:
        generated = generate_smart_report_from_raw(raw)
    except groq.APIError as exc:
        raise HTTPException(502, f"Report generation failed: {exc}") from exc

    try:
        parsed = safe_parse_smart_report(generated)
    except pydantic.ValidationError as exc:
        raise HTTPException(422, f"Generated report didn't match the expected structure: {exc}") from exc

    return _create_session_response(parsed)


@app.post("/api/report/upload", response_model=SubmitReportResponse)
async def upload_report_pdf(file: UploadFile = File(...)) -> SubmitReportResponse:
    """
    Accepts a smart-report PDF, extracts its text, and uses an LLM to
    structure it into the SmartReport schema. Best-effort: fields the
    report doesn't actually contain (per-category numeric scores, most
    historical trends) are correctly left null rather than guessed.
    """
    if not settings.groq_api_key:
        raise HTTPException(500, "Server is missing GROQ_API_KEY.")

    if (file.content_type or "") not in ("application/pdf", "application/octet-stream"):
        raise HTTPException(400, "Please upload a PDF file.")

    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File too large (max 15 MB).")

    try:
        text = extract_text_from_pdf(data)
    except PdfExtractionError as exc:
        raise HTTPException(422, str(exc)) from exc

    try:
        extracted = extract_smart_report_from_text(text)
    except groq.APIError as exc:
        raise HTTPException(502, f"Extraction failed: {exc}") from exc

    try:
        report = safe_parse_smart_report(extracted)
    except pydantic.ValidationError as exc:
        # Surface the real validation error — this tells you exactly which
        # field the extraction got wrong, instead of a generic failure.
        raise HTTPException(
            422, f"Extracted data didn't match the expected structure: {exc}"
        ) from exc

    return _create_session_response(report)


@app.get("/api/mock-report")
async def get_mock_report() -> dict:
    """Dev/testing convenience — returns the bundled mock SmartReport JSON
    so the frontend can be exercised without a real report source."""
    import json
    from pathlib import Path

    path = Path(__file__).parent / "fixtures" / "mock_report.json"
    return json.loads(path.read_text())


@app.post("/api/chat")
async def chat_endpoint(req: ChatRequest):
    if not settings.groq_api_key:
        raise HTTPException(500, "Server is missing GROQ_API_KEY.")

    session = get_session(req.session_id)
    if not session:
        raise HTTPException(404, "Session not found or expired.")

    return StreamingResponse(stream_chat(session, req.message), media_type="text/plain")
