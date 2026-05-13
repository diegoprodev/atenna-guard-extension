"""
Contratos canônicos da FASE 4.2A — DLP Alignment.
Fonte única de verdade para EntityType, RiskLevel, ClassificationLevel,
DlpFinding e DlpScanResult entre frontend e backend.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum


# ─── Enums ────────────────────────────────────────────────────────────────────

class EntityType(str, Enum):
    CPF                   = "CPF"
    CNPJ                  = "CNPJ"
    RG                    = "RG"
    PIS_PASEP             = "PIS_PASEP"
    TITULO_ELEITOR        = "TITULO_ELEITOR"
    PHONE                 = "PHONE"
    EMAIL                 = "EMAIL"
    PROCESS_NUMBER        = "PROCESS_NUMBER"
    VEHICLE_PLATE         = "VEHICLE_PLATE"
    ADDRESS               = "ADDRESS"
    CREDIT_CARD           = "CREDIT_CARD"
    API_KEY               = "API_KEY"
    JWT                   = "JWT"
    TOKEN                 = "TOKEN"
    SECRET                = "SECRET"
    MEDICAL_DATA          = "MEDICAL_DATA"
    LEGAL_CONTEXT         = "LEGAL_CONTEXT"
    CONFIDENTIAL_DOCUMENT = "CONFIDENTIAL_DOCUMENT"


class RiskLevel(str, Enum):
    NONE     = "NONE"
    LOW      = "LOW"
    MEDIUM   = "MEDIUM"
    HIGH     = "HIGH"
    CRITICAL = "CRITICAL"
    UNKNOWN  = "UNKNOWN"   # timeout ou falha — NÃO tratar como NONE


RISK_ORDER: dict[str, int] = {
    "NONE": 0, "LOW": 1, "MEDIUM": 2,
    "HIGH": 3, "CRITICAL": 4, "UNKNOWN": 1,
}


class ClassificationLevel(str, Enum):
    PUBLIC       = "public"
    INTERNAL     = "internal"
    RESTRICTED   = "restricted"
    CONFIDENTIAL = "confidential"
    SECRET       = "secret"


CLASSIFICATION_ORDER: dict[str, int] = {
    "public": 0, "internal": 1, "restricted": 2,
    "confidential": 3, "secret": 4,
}


# ─── Placeholders canônicos ────────────────────────────────────────────────────
# Deve coincidir exatamente com detector.ts no frontend.

PLACEHOLDERS: dict[EntityType, str] = {
    EntityType.CPF:                   "[CPF]",
    EntityType.CNPJ:                  "[CNPJ]",
    EntityType.RG:                    "[RG]",
    EntityType.PIS_PASEP:             "[PIS_PASEP]",
    EntityType.TITULO_ELEITOR:        "[TITULO_ELEITOR]",
    EntityType.EMAIL:                 "[EMAIL]",
    EntityType.PHONE:                 "[TELEFONE]",
    EntityType.PROCESS_NUMBER:        "[PROCESSO_JUDICIAL]",
    EntityType.VEHICLE_PLATE:         "[PLACA]",
    EntityType.ADDRESS:               "[ENDERECO]",
    EntityType.CREDIT_CARD:           "[CARTAO]",
    EntityType.API_KEY:               "[API_KEY]",
    EntityType.JWT:                   "[TOKEN]",
    EntityType.TOKEN:                 "[TOKEN]",
    EntityType.SECRET:                "[SEGREDO]",
    EntityType.MEDICAL_DATA:          "[DADO_MEDICO]",
    EntityType.LEGAL_CONTEXT:         "[CONTEXTO_JURIDICO]",
    EntityType.CONFIDENTIAL_DOCUMENT: "[DOCUMENTO_CONFIDENCIAL]",
}


# ─── Dataclasses imutáveis ─────────────────────────────────────────────────────

@dataclass(frozen=True)
class DlpFinding:
    entity_type:          EntityType
    risk_level:           RiskLevel
    classification_level: ClassificationLevel
    start:                int
    end:                  int
    confidence:           float          # 0.0 – 1.0
    action:               str            # "block" | "mask" | "alert"
    placeholder:          str            # "[CPF]", "[API_KEY]", etc.
    source:               str            # "regex" | "validator" | "heuristic"


@dataclass(frozen=True)
class DlpScanResult:
    original_hash:             str
    masked_content:            str
    risk_level:                RiskLevel
    classification_level:      ClassificationLevel
    findings:                  tuple[DlpFinding, ...]
    entity_types:              tuple[str, ...]
    blocked:                   bool
    block_reason:              str | None
    requires_acknowledgment:   bool
    telemetry_safe_metadata:   dict = field(default_factory=dict, compare=False)
