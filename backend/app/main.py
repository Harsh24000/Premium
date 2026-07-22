import logging
import uuid

import groq
import pydantic
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .config import get_settings
from .infographic import build_infographic_summary
from .llm_client import extract_smart_report_from_text, generate_high_risk_starter_questions, stream_chat
from .plans import MAX_MESSAGE_CHARS, MAX_MESSAGE_WORDS, looks_like_multiple_questions, quota_for
from .models import SmartReport, safe_parse_smart_report
from .raw_to_smart import generate_smart_report_from_raw
from .pdf_utils import PdfExtractionError, extract_text_from_pdf
from .rate_limit import check_and_record
from .store import Session, get_session, save_session

settings = get_settings()

app = FastAPI(title="NirogGyan Premium API")
logger = logging.getLogger("niroggyan.errors")


def _friendly_groq_error(exc: Exception, context: str) -> HTTPException:
    """
    Groq's raw error includes internal account details — org ID, exact
    TPM limits, a billing upgrade URL — none of which a patient should
    ever see (confirmed happening: a real large report hit an 8000 TPM
    cap and the full Groq error JSON was shown directly in the intake
    screen). Log the real thing server-side, tell the user something
    useful without the internals.
    """
    logger.error("%s failed: %s", context, exc, exc_info=True)
    if isinstance(exc, groq.RateLimitError):
        return HTTPException(
            503,
            "This report needs more processing capacity than we have available right now. Please try again in a minute.",
        )
    return HTTPException(502, f"{context} didn't go through. Please try again in a moment.")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,  # set ALLOWED_ORIGINS env var to your deployed frontend URL
    allow_credentials=False,  # no cookie-based auth here — this also avoids the wildcard+credentials CORS conflict
    allow_methods=["*"],
    allow_headers=["*"],
    # Without this, browsers hide custom response headers from JS by
    # default — allow_headers only covers REQUEST headers, not response
    # ones. api.ts reads X-Messages-Remaining/-Quota via res.headers.get()
    # after every chat call; without exposing them, that silently returns
    # null and the frontend falls back to 0, making quota look exhausted
    # after the very first real message even though the backend's actual
    # count is fine. This is invisible to curl/direct testing since CORS
    # is a browser-enforced restriction, not a server one — confirmed
    # this way after main.py/plans.py/store.py all checked out correct.
    expose_headers=["X-Messages-Remaining", "X-Messages-Quota"],
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
    plan: str
    messages_remaining: int
    messages_quota: int


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
        plan=session.plan,
        messages_remaining=quota_for(session.plan) - session.messages_used,
        messages_quota=quota_for(session.plan),
    )


@app.post("/api/report", response_model=SubmitReportResponse)
async def submit_report(report: dict, request: Request) -> SubmitReportResponse:
    """
    Accepts an already-structured SmartReport JSON directly. Uses the same
    defensive parser as the PDF path (safe_parse_smart_report) rather than
    FastAPI's automatic strict validation — real report exports from
    different sources won't all match this schema exactly, and a single
    missing/extra field shouldn't hard-fail the whole submission before
    even reaching application code.
    """
    check_and_record(request)
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
async def submit_raw_report(raw: dict, request: Request) -> SubmitReportResponse:
    """
    Accepts the RAW diagnofirm-format lab export (patient info + results/
    investigation/observations, no wellness score or narrative content).
    Computes status deterministically wherever a real numeric range
    exists, uses the LLM only to classify genuinely ambiguous qualitative
    results and generate narrative content — see raw_to_smart.py.
    """
    check_and_record(request)
    if not settings.groq_api_key:
        raise HTTPException(500, "Server is missing GROQ_API_KEY.")

    try:
        generated = generate_smart_report_from_raw(raw)
    except groq.APIError as exc:
        raise _friendly_groq_error(exc, "Report generation") from exc

    try:
        parsed = safe_parse_smart_report(generated)
    except pydantic.ValidationError as exc:
        raise HTTPException(422, f"Generated report didn't match the expected structure: {exc}") from exc

    return _create_session_response(parsed)


@app.post("/api/report/upload", response_model=SubmitReportResponse)
async def upload_report_pdf(request: Request, file: UploadFile = File(...)) -> SubmitReportResponse:
    """
    Accepts a smart-report PDF, extracts its text, and uses an LLM to
    structure it into the SmartReport schema. Best-effort: fields the
    report doesn't actually contain (per-category numeric scores, most
    historical trends) are correctly left null rather than guessed.
    """
    check_and_record(request)
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
        raise _friendly_groq_error(exc, "Extraction") from exc

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

    char_count = len(req.message)
    word_count = len(req.message.split())
    if char_count > MAX_MESSAGE_CHARS or word_count > MAX_MESSAGE_WORDS:
        raise HTTPException(
            422,
            {
                "error": "message_too_long",
                "max_chars": MAX_MESSAGE_CHARS,
                "char_count": char_count,
                "max_words": MAX_MESSAGE_WORDS,
                "word_count": word_count,
                "detail": f"Keep it to one short question — {MAX_MESSAGE_CHARS} characters or fewer.",
            },
        )

    if looks_like_multiple_questions(req.message):
        raise HTTPException(
            422,
            {
                "error": "multiple_questions",
                "detail": "That looks like more than one question — ask them one at a time.",
            },
        )

    quota = quota_for(session.plan)
    if session.messages_used >= quota:
        raise HTTPException(
            402,
            {
                "error": "quota_exceeded",
                "plan": session.plan,
                "quota": quota,
                "remaining": 0,
                "detail": "You've used all your questions. Get 10 more for ₹50 to keep chatting.",
            },
        )

    # Counted on acceptance, not on successful completion — a request that
    # fails mid-stream still used a network round trip and a slot in the
    # conversation history. Given how cheap each message is (see cost
    # notes), this tradeoff isn't worth the complexity of a refund path.
    session.messages_used += 1
    save_session(session)
    remaining = quota - session.messages_used

    return StreamingResponse(
        stream_chat(session, req.message),
        media_type="text/plain",
        headers={
            "X-Messages-Remaining": str(remaining),
            "X-Messages-Quota": str(quota),
        },
    )


class ActivatePlanRequest(BaseModel):
    plan: str


@app.post("/api/session/{session_id}/plan")
async def activate_plan(session_id: str, req: ActivatePlanRequest):
    """
    STUB — flips a session's plan with no payment verification at all.
    This exists so you have somewhere to wire a real payment webhook
    once you integrate a gateway: after the gateway confirms a
    successful ₹99 payment server-side, YOUR SERVER calls this (or the
    logic it wraps) — never the browser directly. Calling this from
    client-side code today means anyone can grant themselves the paid
    quota for free by hitting this endpoint themselves; there is no
    auth in this codebase to stop them (see README).
    """
    from .plans import PLAN_QUOTAS

    if req.plan not in PLAN_QUOTAS:
        raise HTTPException(400, f"Unknown plan '{req.plan}'.")

    session = get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found or expired.")

    session.plan = req.plan
    session.messages_used = 0
    save_session(session)
    return {"plan": session.plan, "quota": PLAN_QUOTAS[req.plan]}
