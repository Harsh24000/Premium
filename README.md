# NirogGyan Premium

A dashboard view of the patient's Smart Health Report (summary, lab
panels, trends, risk profile) with Dr. Gyan available as a floating
chat launcher, bottom-left — opens into a panel grounded in the full
report, with AI-generated starter questions and markdown-formatted
answers. Responsive: full sidebar layout on desktop, collapses to a
top nav and full-width chat sheet on mobile.

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
- `POST /api/report` — submit a SmartReport JSON, get back session_id + infographic + starter_questions + the parsed report (the dashboard renders panels/diet/next-steps straight from this)
- `POST /api/report/raw` — submit a raw diagnofirm-format lab export; backend computes status/score deterministically and uses the LLM only for narrative and qualitative classification
- `POST /api/chat` — streaming chat grounded in the submitted report
- `GET /api/mock-report` — returns bundled sample data for testing without a real report source

## Frontend (React + Vite + TS, mobile-first)

```bash
cd frontend
npm install
npm run dev
```

Dev server proxies `/api` to `localhost:8000` (see `vite.config.ts`).

## Uploading to GitHub

If you're starting from this zip rather than a git clone:

1. Unzip it, `cd` into the folder
2. `git init`
3. `git add .` — the included `.gitignore` keeps `node_modules`,
   `venv`, and your real `.env` out of the commit
4. `git commit -m "Dashboard + chat widget"`
5. Create an empty repo on GitHub (don't initialize it with a README —
   that conflicts with the one already here), then:
   `git remote add origin <your-repo-url>` and `git push -u origin main`

Double-check `.env` never got committed: `git log --all --full-history -- backend/.env`
should return nothing.

## Deploying on Render

Push this repo to GitHub first (above), then create **two** Render
services from it — a Web Service for the backend, a Static Site for the
frontend. Do the backend first; the frontend's env var needs its URL.

### 1. Backend — Web Service

New → Web Service → connect this repo.
- **Root Directory:** `backend`
- **Runtime:** Python 3
- **Build Command:** `pip install -r requirements.txt`
- **Start Command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- **Environment variables:**
  - `GROQ_API_KEY` — your real key from console.groq.com
  - `ALLOWED_ORIGINS` — leave as `http://localhost:5173` for now; come
    back and set this to your frontend's Render URL once step 2 gives
    you one (e.g. `https://niroggyan-premium.onrender.com`)

Deploy, then copy the service's URL — you'll need it in step 2.

### 2. Frontend — Static Site

New → Static Site → same repo.
- **Root Directory:** `frontend`
- **Build Command:** `npm install && npm run build`
- **Publish Directory:** `dist`
- **Environment variable:** `VITE_API_BASE` = your backend's URL from
  step 1 (e.g. `https://niroggyan-premium-api.onrender.com`) — no
  trailing slash. `frontend/src/api.ts` already reads this at build
  time, so no code change is needed.

Deploy, then go back to the backend service and set `ALLOWED_ORIGINS`
to this frontend URL, so CORS actually allows the request.

### Notes on Render's free tier

Free services spin down after inactivity and lose all in-memory state
on wake — including every chat session in `store.py`. The frontend
already handles this: `SessionExpiredError` in `api.ts` triggers an
automatic resubmit-and-retry (see `App.tsx`'s `resubmit` prop), so a
sleeping backend costs the user one extra request, not a broken chat.
For real traffic, move `store.py` to Redis with a TTL — an in-process
dict won't survive a redeploy or a second worker either.

## Payment

Not wired in — this is a stub, per your instruction to defer real payment
integration. Handle the actual paywall/entry point in whatever system
sends the user here after payment (or add a checkout flow before
`ReportIntake` later).

## Schema source

`backend/app/models.py` documents exactly which real report fields each
schema field was derived from. Read that docstring before changing it.

## Scope as of this version

- ✅ Report dashboard — summary, lab insights (all panels/parameters), trends, risk profile
- ✅ Dr. Gyan chat as a floating launcher, bottom-left — full report grounding, streaming, session recovery
- ✅ AI-generated high-risk starter questions, grounded in the report's own critical alert and most out-of-range panels
- ✅ Markdown-formatted answers (bold, headers, bullets) — not plain text
- ✅ Deterministic computation throughout — score, status, range position never come from the LLM
- ❌ Payment — stubbed, no real gateway
- ❌ PDF → SmartReport conversion — out of scope, per your instruction

## Before this repo goes public again

The fixture and code comments previously contained real patient names
and an accession number from the 4 sample reports used to design the
schema — these have been scrubbed. If you fork or rebase this history,
check `git log --all -- backend/app/fixtures/mock_report.json` and
`backend/app/models.py` for older commits that still contain them, and
rewrite history if so (deleting in a new commit isn't enough).
