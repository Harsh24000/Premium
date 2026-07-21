"""
Deterministic layer: everything here is pure computation from the raw
data, zero LLM involvement — consistent with the anti-fabrication
approach used elsewhere (e.g. biological_age.py style, if this app
inherits that pattern). The LLM (in raw_to_smart.py) only ever narrates
around numbers computed here; it never invents the status or score
itself.
"""

import re

from .raw_models import RawLabExport, RawObservation

# These are procedural/metadata fields that appear as "observations" in
# this format but aren't actual clinical values — a timestamp or specimen
# type doesn't have a normal/abnormal status. Auto-classify as "normal"
# (neutral, non-alarming) without ever sending these to the LLM — asking
# it to judge whether "0921" or "MSU" is abnormal would be nonsensical and
# risks an invented-sounding answer for something that was never a real
# question in the first place.
_NON_CLINICAL_NAME_PATTERN = re.compile(
    r"time of collection|specimen type|sample type", re.IGNORECASE
)


class FlatObservation:
    """One observation with panel context attached, and status computed
    deterministically where a real numeric range exists."""

    def __init__(self, panel_name: str, test_type: str, obs: RawObservation):
        self.panel_name = panel_name
        self.test_type = test_type
        self.name = obs.name
        self.raw_value = obs.value
        self.unit = obs.unit
        self.min_value = obs.MinValue
        self.max_value = obs.MaxValue
        self.impression = (obs.impression or "").strip()
        self.status: str | None = self._compute_status()

    def _compute_status(self) -> str | None:
        """
        Only classify when there's a REAL numeric range to compare
        against. Many observations in this format are qualitative
        ('Negative', 'Not Seen', 'Trace') with MinValue=MaxValue=0 —
        that's not a real range, it's an absent one, so we don't
        pretend to classify those numerically. Those get status=None
        and are left for the LLM to classify using clinical knowledge
        of what qualitative results normally mean (e.g. 'Negative' for
        urine nitrite is normal) — that's applying medical convention,
        not inventing a number.
        """
        if _NON_CLINICAL_NAME_PATTERN.search(self.name):
            return "normal"  # metadata field, never sent to the LLM for judgment

        try:
            value = float(self.raw_value)
            low = float(self.min_value)
            high = float(self.max_value)
        except (ValueError, TypeError):
            return None

        if low == 0 and high == 0:
            return None  # not a real range, just absent

        if value < low:
            return "low"
        if value > high:
            return "high"
        return "normal"

    def to_dict(self) -> dict:
        return {
            "panel_name": self.panel_name,
            "test_type": self.test_type,
            "name": self.name,
            "value": self.raw_value,
            "unit": self.unit,
            "range_low": self.min_value,
            "range_high": self.max_value,
            "impression": self.impression,
            "computed_status": self.status,  # None if the LLM needs to classify this one
        }


def flatten_observations(raw: RawLabExport) -> list[FlatObservation]:
    flat: list[FlatObservation] = []
    for result_group in raw.results:
        for investigation in result_group.investigation:
            panel_name = investigation.test_name or investigation.test_type or "General"
            for obs in investigation.observations:
                if not obs.name:
                    continue
                flat.append(FlatObservation(panel_name, investigation.test_type, obs))

    _dedupe_names(flat)
    return flat


def _dedupe_names(flat: list[FlatObservation]) -> None:
    """
    Real lab exports routinely repeat a test name within one report —
    confirmed in a real Blal CBC export, which reports "Neutrophils"
    twice: once as a percentage, once as an absolute count, same
    investigation, different unit. This is standard for any CBC
    differential, not an edge case.

    Downstream code keys observations by name in a plain dict (see
    raw_to_smart.py's obs_by_name) — an unresolved collision there
    silently drops one of the two and shows the wrong one under the
    other's name. Disambiguate here, once, before anything else
    (including the LLM) ever sees these names, so every name from this
    point on is guaranteed unique and nothing downstream needs to know
    duplicates were ever possible.
    """
    groups: dict[str, list[FlatObservation]] = {}
    for obs in flat:
        groups.setdefault(obs.name.strip().lower(), []).append(obs)

    for group in groups.values():
        if len(group) <= 1:
            continue
        seen: set[str] = set()
        for i, obs in enumerate(group):
            # Prefer disambiguating by unit — meaningful to a reader
            # ("Neutrophils (%)" vs "Neutrophils (1000/mm3)"). Only fall
            # back to a bare counter if the unit doesn't actually make it
            # unique (missing, or duplicated in some other real report
            # we haven't seen yet) — never leave a genuine collision.
            candidate = f"{obs.name} ({obs.unit})" if obs.unit else obs.name
            if not obs.unit or candidate in seen:
                candidate = f"{obs.name} (#{i + 1})"
            seen.add(candidate)
            obs.name = candidate


MAX_SCORE_DEDUCTION = 60  # never let the deterministic score go below 40


def compute_wellness_score(flat_observations: list[FlatObservation], llm_classified_abnormal: set[str]) -> int:
    """
    Deterministic score: start at 100, deduct per abnormal finding, capped.
    llm_classified_abnormal is the set of observation names the LLM
    identified as abnormal among the ones with no computable numeric
    range (see module docstring) — combined here with the ones we
    already know are abnormal from real numbers, so the score reflects
    the FULL picture, not just the numerically-classifiable subset.
    """
    deduction = 0.0
    for obs in flat_observations:
        if obs.status in ("low", "high"):
            deduction += 4.0
        elif obs.status is None and obs.name in llm_classified_abnormal:
            deduction += 3.0  # slightly lower weight — qualitative classification is less certain

    deduction = min(deduction, MAX_SCORE_DEDUCTION)
    return round(100 - deduction)


def score_to_label(score: int) -> str:
    if score < 50:
        return "Poor"
    if score <= 60:
        return "Suboptimal"
    if score <= 69:
        return "Fair"
    if score <= 90:
        return "Good"
    return "Optimal"
