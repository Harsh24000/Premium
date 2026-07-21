from dataclasses import dataclass, field

from .models import SmartReport
from .plans import DEFAULT_PLAN


@dataclass
class Session:
    session_id: str
    report: SmartReport
    messages: list[dict] = field(default_factory=list)
    plan: str = DEFAULT_PLAN
    messages_used: int = 0


_sessions: dict[str, Session] = {}


def save_session(session: Session) -> None:
    _sessions[session.session_id] = session


def get_session(session_id: str) -> Session | None:
    return _sessions.get(session_id)
