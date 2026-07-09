import uuid

import groq
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .config import get_settings
from .infographic import build_infographic_summary
from .llm_client import generate_high_risk_starter_questions, stream_chat
from .models import SmartReport
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


class SubmitReportResponse(BaseModel):
    session_id: str
    infographic: dict
    starter_questions: list[str]


class ChatRequest(BaseModel):
    session_id: str
    message: str


@app.post("/api/report", response_model=SubmitReportResponse)
async def submit_report(report: SmartReport) -> SubmitReportResponse:
    """
    Accepts an already-structured SmartReport JSON (produced elsewhere —
    see models.py docstring). This endpoint does NOT parse PDFs.
    """
    if not settings.groq_api_key:
        raise HTTPException(500, "Server is missing GROQ_API_KEY.")

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
    )


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
