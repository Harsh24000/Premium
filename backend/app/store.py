from dataclasses import dataclass, field

from .models import SmartReport


@dataclass
class Session:
    session_id: str
    report: SmartReport
    messages: list[dict] = field(default_factory=list)


_sessions: dict[str, Session] = {}


def save_session(session: Session) -> None:
    _sessions[session.session_id] = session


def get_session(session_id: str) -> Session | None:
    return _sessions.get(session_id)
