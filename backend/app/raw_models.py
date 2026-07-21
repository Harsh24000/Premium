"""
Models for the RAW diagnostic lab export format ("diagnofirm"). Originally
confirmed against 5 sample files that turned out to be one report copied
5 times; since then validated against 19 genuinely varied real exports
across 4 lab sources (Blal, CMH, Oncquest, KAR) — this fixed several
fields that were incorrectly non-nullable (see MinValue/MaxValue/unit/
impression/Date below) and are now confirmed against real production
data, not just one sample.

This is fundamentally different from models.py's SmartReport: it's raw
test results with no wellness score, diet plan, or narrative content at
all. See raw_to_smart.py for how this gets turned into a SmartReport.
"""

from pydantic import BaseModel


class RawObservation(BaseModel):
    name: str = ""
    value: str = ""
    # These four are explicitly null in real exports, not just absent —
    # confirmed against 19 real files: MinValue/MaxValue null in 1.6%,
    # unit null in 0.9%, impression null in 12.3% of all observations.
    # A plain `str = "..."` default does NOT accept an explicit null;
    # it only covers a missing key. Without `| None` here, real data
    # fails Pydantic validation before the app ever sees it.
    MinValue: str | None = None
    MaxValue: str | None = None
    unit: str | None = None
    impression: str | None = None


class RawInvestigation(BaseModel):
    test_name: str = ""
    test_type: str = ""  # e.g. "BIOCHEMISTRY", "MICROBIOLOGY"
    observations: list[RawObservation] = []


class RawResultGroup(BaseModel):
    Package_name: str = ""
    investigation: list[RawInvestigation] = []


class RawLabExport(BaseModel):
    PName: str = ""
    Gender: str = ""
    Age: str = ""
    Date: str | None = None  # null in 5 of 19 real sample files
    WorkOrderID: str = ""
    results: list[RawResultGroup] = []
