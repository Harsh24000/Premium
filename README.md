# NirogGyan Premium

Paid-tier chat experience: full-screen consultation with Dr. Gyan, opening
with an infographic summary of the patient's Smart Health Report, followed
by AI-generated high-risk starter questions and markdown-formatted chat
answers. Mobile-first (bottom nav, single-column layout, safe-area aware).

## What this does NOT do

This app does **not** parse the source lab-report PDFs into structured
data. That conversion (PDF -> SmartReport JSON) happens elsewhere, per
the schema in `backend/app/models.py` — documented and derived directly
from 4 real sample reports. This app's job starts once a SmartReport JSON
exists: it renders the infographic, grounds the chat in the full report,
and generates starter questions.

## Backend (FastAPI)

```bash
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # add your real GROQ_API_KEY
uvicorn app.main:app --reload --port 8000
```

Endpoints:
- `POST /api/report` — submit a SmartReport JSON, get back session_id + infographic + starter_questions
- `POST /api/chat` — streaming chat grounded in the submitted report
- `GET /api/mock-report` — returns bundled sample data for testing without a real report source

## Frontend (React + Vite + TS, mobile-first)

```bash
cd frontend
npm install
npm run dev
```

Dev server proxies `/api` to `localhost:8000` (see `vite.config.ts`).

## Deploying on Render

**Backend** — Web Service:
- Root directory: `backend`
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Env vars: `GROQ_API_KEY`, `ALLOWED_ORIGINS` (set to your deployed frontend URL)

**Frontend** — Static Site:
- Root directory: `frontend`
- Build command: `npm install && npm run build`
- Publish directory: `dist`
- You'll need to point API calls at the backend's Render URL instead of
  the dev proxy — either set a `VITE_API_BASE` env var and update
  `frontend/src/api.ts` to use it, or configure a rewrite rule.

## Payment

Not wired in — this is a stub, per your instruction to defer real payment
integration. Handle the actual paywall/entry point in whatever system
sends the user here after payment (or add a checkout flow before
`ReportIntake` later).

## Schema source

`backend/app/models.py` documents exactly which real report fields each
schema field was derived from. Read that docstring before changing it.

## Scope as of this version

- ✅ Chat with Dr. Gyan (full-screen, mobile-first)
- ✅ Infographic summary opening the chat (deterministic, computed from the report — no LLM-invented numbers)
- ✅ AI-generated high-risk starter questions, grounded in the report's own critical alert and most out-of-range panels
- ✅ Markdown-formatted answers (bold, headers, bullets) — not plain text
- 🔒 Diet Plan tab — placeholder, not built
- 🔒 Doctor Consult tab — placeholder, not built
- 🔒 Test Upload tab — placeholder, not built
- ❌ Payment — stubbed, no real gateway
- ❌ PDF → SmartReport conversion — out of scope, per your instruction
