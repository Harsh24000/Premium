"""
Models for the RAW diagnostic lab export format ("diagnofirm"), confirmed
by reading 5 real sample files directly (all 5 turned out to be the same
report — same WorkOrderID — so this is one confirmed real structure, not
five varied ones; treat as reliable for this exact source but unverified
against other formats).

This is fundamentally different from models.py's SmartReport: it's raw
test results with no wellness score, diet plan, or narrative content at
all. See raw_to_smart.py for how this gets turned into a SmartReport.
"""

from pydantic import BaseModel


class RawObservation(BaseModel):
    name: str = ""
    value: str = ""
    MinValue: str = "0"
    MaxValue: str = "0"
    unit: str = ""
    impression: str = ""


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
    Date: str = ""
    WorkOrderID: str = ""
    results: list[RawResultGroup] = []
