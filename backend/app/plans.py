"""
Plan quotas and per-message limits.

These are placeholders you'll tune once you see real usage — kept in
one small file rather than scattered as magic numbers through main.py.

IMPORTANT — this does NOT enforce payment. There is no auth in this
codebase yet (see README), so `plan` is just a string on an in-memory
session with no verified link to money actually changing hands. The
/api/session/{id}/plan endpoint in main.py is a stub for wiring up a
real payment webhook later — it must never be called directly from
client-side code once you have a real gateway, or anyone can grant
themselves the paid quota for free by calling it themselves.
"""

import re

# messages allowed before the session must upgrade, keyed by plan name
PLAN_QUOTAS: dict[str, int] = {
    "trial": 3,       # unpaid — enough to demonstrate value, not enough to rely on
    "basic_99": 10,    # the ₹99 plan
}

DEFAULT_PLAN = "trial"

# Longest a single message can be, in characters — the primary limit.
# 75 chars is roughly one short sentence: enough for a real question,
# not enough to stack several. Character count is the primary check
# because it can't be gamed by removing spaces the way a word count can.
MAX_MESSAGE_CHARS = 75

# Secondary check, in words — catches the inverse trick (spamming tiny
# words: "a a a a a..." could stay under a char limit while reading as
# nonsense). 15 words is generous for a 75-character message; it exists
# as a backstop, not the primary constraint.
MAX_MESSAGE_WORDS = 15

# Every question costs exactly 1 credit. (Previously had a 2-credit
# "expert mode" — removed: it was confusing in practice and not worth
# the complexity right now.)
MESSAGE_CREDIT_COST = 1


def quota_for(plan: str) -> int:
    return PLAN_QUOTAS.get(plan, 0)


_QUESTION_WORDS = (
    "what", "why", "how", "is", "are", "do", "does", "did", "can", "could",
    "should", "will", "would", "when", "where", "who", "which",
)
_NUMBERED_ITEM = re.compile(r"(?:^|\s)(\d{1,2}[.)]|[a-dA-D][.)])\s")


def looks_like_multiple_questions(text: str) -> bool:
    """
    Heuristic, not a classifier — deliberately cheap (no extra LLM call,
    which would cost more than the message itself is worth) so it runs
    on every message with zero added latency or spend. Will have false
    positives and negatives; the goal is to catch the common, unclever
    cases people would actually try, not to be airtight. If real usage
    shows this is too aggressive or too permissive, tune the thresholds
    here rather than reaching for a model call.
    """
    if text.count("?") >= 2:
        return True

    if len(_NUMBERED_ITEM.findall(text)) >= 2:
        return True

    # Split on sentence-ish boundaries and count how many resulting
    # clauses both look substantial (not a trailing fragment) and open
    # with a question word — two real question-shaped clauses in one
    # message is the pattern this whole check exists to catch.
    clauses = re.split(r"[.;?!]+", text)
    question_like = 0
    for clause in clauses:
        words = clause.strip().lower().split()
        if len(words) >= 3 and words[0] in _QUESTION_WORDS:
            question_like += 1
    return question_like >= 2
