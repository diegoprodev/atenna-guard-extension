from enum import Enum
from typing import Optional
from pydantic import BaseModel


class RiskLevel(str, Enum):
    NONE   = "NONE"
    LOW    = "LOW"
    MEDIUM = "MEDIUM"
    HIGH   = "HIGH"


class DetectedEntity(BaseModel):
    type:        str
    value:       str
    start:       int
    end:         int
    score:       float   # presidio confidence 0-1
    redacted:    Optional[str] = None


class ScanRequest(BaseModel):
    text:          str
    client_risk:   Optional[RiskLevel] = None   # pre-scan from browser
    client_score:  Optional[float]     = None
    user_id:       Optional[str]       = None
    session_id:    Optional[str]       = None
    platform:      Optional[str]       = None


class ScanResponse(BaseModel):
    risk_level:  RiskLevel
    score:       float
    entities:    list[DetectedEntity]
    advisory:    str
    show_warning: bool
    duration_ms: float
