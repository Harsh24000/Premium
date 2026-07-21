"""
Minimal in-memory rate limiting.

STOPGAP, same caveat as store.py's sessions: this dict lives in one
process's memory, so it resets on every redeploy/restart and doesn't
share state across multiple workers. It still blocks the obvious,
unsophisticated abuse case (one person/script hammering the endpoint
from one IP) far better than nothing, which is where this codebase
is today. Move to Redis (INCR with EX) if you scale past one worker.

Deliberately only guards the *report-creation* endpoints
(/api/report, /api/report/raw, /api/report/upload). Those are the
expensive ones with no per-message quota at all today — a script
calling them in a loop farms unlimited free trial quotas (3 messages
each, forever) AND runs up your Groq bill on report generation itself,
which chat's per-session quota does nothing to stop.
"""

import time

from fastapi import HTTPException, Request

# Max report submissions allowed from one IP within the window.
MAX_SUBMISSIONS_PER_WINDOW = 5
WINDOW_SECONDS = 60 * 60  # 1 hour

_submissions: dict[str, list[float]] = {}


def get_client_ip(request: Request) -> str:
    # Render (and most reverse proxies) put the real client IP in this
    # header — request.client.host would otherwise just be the proxy.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def check_and_record(request: Request) -> None:
    ip = get_client_ip(request)
    now = time.time()
    recent = [t for t in _submissions.get(ip, []) if now - t < WINDOW_SECONDS]

    if len(recent) >= MAX_SUBMISSIONS_PER_WINDOW:
        retry_after = int(WINDOW_SECONDS - (now - recent[0]))
        raise HTTPException(
            429,
            {
                "error": "rate_limited",
                "detail": "Too many reports submitted from this connection. Try again later.",
                "retry_after_seconds": max(retry_after, 1),
            },
        )

    recent.append(now)
    _submissions[ip] = recent
