"""
DLP Scanner — FASE 4.2A
Adaptado da arquitetura da Atenna Plataforma (bff/app/dlp/scanner.py).

Detecta 18 tipos de entidades sensíveis via regex + validação aritmética.
Retorna resultado imutável — nunca persiste, nunca loga valores originais.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass

from dlp.types import (
    ClassificationLevel,
    DlpFinding,
    DlpScanResult,
    EntityType,
    PLACEHOLDERS,
    RiskLevel,
    RISK_ORDER,
    CLASSIFICATION_ORDER,
)
from dlp.classification import resolve_classification, RISK_TO_CLASSIFICATION


# ─── Validadores aritméticos ───────────────────────────────────────────────────

def _cpf_valid(digits: str) -> bool:
    """Verifica dígitos verificadores do CPF."""
    d = [int(c) for c in digits if c.isdigit()]
    if len(d) != 11 or len(set(d)) == 1:
        return False
    s1 = sum(d[i] * (10 - i) for i in range(9)) % 11
    v1 = 0 if s1 < 2 else 11 - s1
    if v1 != d[9]:
        return False
    s2 = sum(d[i] * (11 - i) for i in range(10)) % 11
    v2 = 0 if s2 < 2 else 11 - s2
    return v2 == d[10]


def _cnpj_valid(digits: str) -> bool:
    """Verifica dígitos verificadores do CNPJ."""
    d = [int(c) for c in digits if c.isdigit()]
    if len(d) != 14 or len(set(d)) == 1:
        return False
    w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    s1 = sum(d[i] * w1[i] for i in range(12)) % 11
    v1 = 0 if s1 < 2 else 11 - s1
    if v1 != d[12]:
        return False
    w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    s2 = sum(d[i] * w2[i] for i in range(13)) % 11
    v2 = 0 if s2 < 2 else 11 - s2
    return v2 == d[13]


def _luhn_valid(digits: str) -> bool:
    """Verifica algoritmo Luhn para cartão de crédito."""
    d = [int(c) for c in digits if c.isdigit()]
    if not (13 <= len(d) <= 19):
        return False
    total = 0
    for i, v in enumerate(reversed(d)):
        if i % 2 == 1:
            v *= 2
            if v > 9:
                v -= 9
        total += v
    return total % 10 == 0


def _pis_valid(digits: str) -> bool:
    """Verifica dígito verificador do PIS/PASEP."""
    d = [int(c) for c in digits if c.isdigit()]
    if len(d) != 11:
        return False
    weights = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    s = sum(d[i] * weights[i] for i in range(10)) % 11
    v = 0 if s < 2 else 11 - s
    return v == d[10]


def _titulo_eleitor_valid(digits: str) -> bool:
    """Verifica estrutura básica do título de eleitor (12 dígitos)."""
    d = [int(c) for c in digits if c.isdigit()]
    return len(d) == 12


# ─── Padrões compilados ────────────────────────────────────────────────────────

# Ordem importa: TITULO_ELEITOR antes de RG (overlap numérico)
_PATTERNS: list[dict] = [
    # ── CRITICAL ──────────────────────────────────────────────────────────────
    {
        "entity": EntityType.JWT,
        "risk": RiskLevel.CRITICAL,
        "action": "block",
        "regex": re.compile(r'\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b'),
        "source": "regex",
    },
    {
        "entity": EntityType.API_KEY,
        "risk": RiskLevel.CRITICAL,
        "action": "block",
        # OpenAI sk-/sk-proj-, Anthropic sk-ant-, Stripe sk_live/sk_test, AWS AKIA, Google AIza
        "regex": re.compile(
            r'\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}'
            r'|sk_(?:live|test)_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}'
            r'|AIza[0-9A-Za-z_-]{35})\b'
        ),
        "source": "regex",
    },
    {
        "entity": EntityType.SECRET,
        "risk": RiskLevel.CRITICAL,
        "action": "block",
        "regex": re.compile(
            r'(?i)(?:secret|password|passwd|api_secret|client_secret|private_key)'
            r'\s*[=:]\s*["\']?([A-Za-z0-9+/=_@#$!%^&*-]{8,})["\']?'
        ),
        "source": "regex",
    },
    {
        "entity": EntityType.TOKEN,
        "risk": RiskLevel.CRITICAL,
        "action": "block",
        "regex": re.compile(
            r'(?i)(?:access_token|bearer_token|auth_token|refresh_token)'
            r'\s*[=:]\s*["\']?([A-Za-z0-9+/=_-]{20,})["\']?'
        ),
        "source": "regex",
    },
    # ── HIGH ──────────────────────────────────────────────────────────────────
    {
        "entity": EntityType.CREDIT_CARD,
        "risk": RiskLevel.HIGH,
        "action": "block",
        # CREDIT_CARD antes de TITULO_ELEITOR: 16 dígitos com Luhn têm prioridade
        # Não usa \b pois espaços entre grupos quebram word boundary
        "regex": re.compile(r'(?<!\d)(\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{1,4})(?!\d)'),
        "validator": _luhn_valid,
        "source": "validator",
    },
    {
        "entity": EntityType.TITULO_ELEITOR,  # depois de CREDIT_CARD, antes de RG
        "risk": RiskLevel.HIGH,
        "action": "mask",
        "regex": re.compile(r'\b(\d{4}\s?\d{4}\s?\d{4})\b'),
        "validator": _titulo_eleitor_valid,
        "source": "validator",
    },
    {
        "entity": EntityType.CPF,
        "risk": RiskLevel.MEDIUM,
        "action": "mask",
        "regex": re.compile(
            r'\b(\d{3}[.\s]\d{3}[.\s]\d{3}[-]\d{2}|\d{11})\b'
        ),
        "validator": _cpf_valid,
        "source": "validator",
    },
    {
        "entity": EntityType.CNPJ,
        "risk": RiskLevel.MEDIUM,
        "action": "mask",
        "regex": re.compile(
            r'\b(\d{2}[.\s]\d{3}[.\s]\d{3}[/]\d{4}[-]\d{2}|\d{14})\b'
        ),
        "validator": _cnpj_valid,
        "source": "validator",
    },
    {
        "entity": EntityType.PIS_PASEP,
        "risk": RiskLevel.HIGH,
        "action": "mask",
        "regex": re.compile(r'\b(\d{3}[.\s]?\d{5}[.\s]?\d{2}[-.\s]?\d{1})\b'),
        "validator": _pis_valid,
        "source": "validator",
    },
    {
        "entity": EntityType.RG,
        "risk": RiskLevel.HIGH,
        "action": "mask",
        "regex": re.compile(r'\b(\d{1,2}[.\s]\d{3}[.\s]\d{3}[-]\d{1,2})\b'),
        "source": "regex",
        "min_digits": 7,
    },
    {
        "entity": EntityType.PROCESS_NUMBER,
        "risk": RiskLevel.HIGH,
        "action": "mask",
        "regex": re.compile(r'\b(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})\b'),
        "source": "regex",
    },
    # ── MEDIUM ────────────────────────────────────────────────────────────────
    {
        "entity": EntityType.EMAIL,
        "risk": RiskLevel.LOW,
        "action": "mask",
        "regex": re.compile(r'\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b'),
        "source": "regex",
    },
    {
        "entity": EntityType.PHONE,
        "risk": RiskLevel.LOW,
        "action": "mask",
        # DDD 11–99, 8–9 dígitos locais
        "regex": re.compile(r'(?:\+?55\s?)?(?:\(?\b([1-9][1-9])\)?\s?)([2-9]\d{3,4}[-\s]?\d{4})\b'),
        "source": "regex",
    },
    {
        "entity": EntityType.VEHICLE_PLATE,
        "risk": RiskLevel.MEDIUM,
        "action": "mask",
        # Padrão antigo ABC-1234 e Mercosul ABC1D23
        "regex": re.compile(r'\b([A-Z]{3}[-\s]?\d[A-Z0-9]\d{2})\b'),
        "source": "regex",
        "year_guard": True,  # anos 1900–2099 são falso positivo
    },
    {
        "entity": EntityType.ADDRESS,
        "risk": RiskLevel.MEDIUM,
        "action": "mask",
        "regex": re.compile(
            r'(?i)\b(?:rua|avenida|av\.|alameda|travessa|estrada|rodovia|praça)'
            r'[\s,]+[A-Za-zÀ-ú\s]{3,40}[\s,]+n[°º]?\s*\d+\b'
        ),
        "source": "heuristic",
    },
    # ── HEURÍSTICOS ───────────────────────────────────────────────────────────
    {
        "entity": EntityType.MEDICAL_DATA,
        "risk": RiskLevel.HIGH,
        "action": "mask",
        "regex": re.compile(
            r'(?i)\b(?:crm\s*[-/]?\s*[A-Z]{0,2}\s*[-/]?\s*\d{4,6}|cid[-\s]?[A-Z]\d{2}'
            r'|diagnos[a-z]+|prescri[a-z]+|prontu[a-z]+|paciente\s+[A-Z]'
            r'|internado|cirurgi[a-z]+|anestes[a-z]+)\b'
        ),
        "source": "heuristic",
    },
    {
        "entity": EntityType.LEGAL_CONTEXT,
        "risk": RiskLevel.MEDIUM,
        "action": "alert",
        "regex": re.compile(
            r'(?i)\b(?:réu|ré\b|impetrante|impetrado|exequente|executado'
            r'|vara\s+(?:cível|criminal|federal|trabalhista)'
            r'|sentença\s+n[°º]?\s*\d+|acórdão|habeas\s+corpus'
            r'|mandado\s+de\s+(?:segurança|prisão|busca))\b'
        ),
        "source": "heuristic",
    },
]

# Regex de anos para guard de placas
_YEAR_RE = re.compile(r'^[12]\d{3}$')


# ─── Scanner principal ─────────────────────────────────────────────────────────

def _hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _is_year_guard(match_str: str) -> bool:
    """Retorna True se a string parece ser um ano (1000–2999)."""
    return bool(_YEAR_RE.match(match_str.strip()))


def scan(text: str) -> DlpScanResult:
    """
    Escaneia texto, detecta entidades, mascara com placeholders canônicos.
    Retorna DlpScanResult imutável.
    Nunca persiste. Nunca loga valores originais.
    """
    if not text or not text.strip():
        return DlpScanResult(
            original_hash=_hash(""),
            masked_content=text or "",
            risk_level=RiskLevel.NONE,
            classification_level=ClassificationLevel.PUBLIC,
            findings=(),
            entity_types=(),
            blocked=False,
            block_reason=None,
            requires_acknowledgment=False,
            telemetry_safe_metadata={},
        )

    original_hash = _hash(text)
    findings: list[DlpFinding] = []
    # Track intervalos mascarados para evitar overlap
    masked_intervals: list[tuple[int, int]] = []

    for pat in _PATTERNS:
        entity: EntityType = pat["entity"]
        risk: RiskLevel = pat["risk"]
        action: str = pat["action"]
        source: str = pat["source"]
        placeholder = PLACEHOLDERS[entity]

        for m in pat["regex"].finditer(text):
            raw = m.group(0)
            start, end = m.start(), m.end()

            # Guard: placa vs ano
            if pat.get("year_guard") and _is_year_guard(raw.replace("-", "").replace(" ", "")):
                continue

            # Guard: RG mínimo de dígitos
            min_digits = pat.get("min_digits")
            if min_digits:
                digit_count = sum(c.isdigit() for c in raw)
                if digit_count < min_digits:
                    continue

            # Guard: validador aritmético
            validator = pat.get("validator")
            if validator:
                digits_only = re.sub(r'\D', '', raw)
                if not validator(digits_only):
                    continue

            # Guard: overlap com intervalo já mascarado
            overlap = any(s <= start < e or s < end <= e for s, e in masked_intervals)
            if overlap:
                continue

            classification = resolve_classification(risk)
            confidence = 0.95 if source == "validator" else (0.85 if source == "regex" else 0.70)

            findings.append(DlpFinding(
                entity_type=entity,
                risk_level=risk,
                classification_level=classification,
                start=start,
                end=end,
                confidence=confidence,
                action=action,
                placeholder=placeholder,
                source=source,
            ))
            masked_intervals.append((start, end))

    # Ordenar por posição para mascarar de trás para frente (não deslocar índices)
    findings.sort(key=lambda f: f.start)
    masked = text
    for f in reversed(findings):
        masked = masked[:f.start] + f.placeholder + masked[f.end:]

    # Nível máximo
    max_risk = RiskLevel.NONE
    for f in findings:
        if RISK_ORDER.get(f.risk_level.value, 0) > RISK_ORDER.get(max_risk.value, 0):
            max_risk = f.risk_level

    max_classification = ClassificationLevel.PUBLIC
    for f in findings:
        if CLASSIFICATION_ORDER.get(f.classification_level.value, 0) > CLASSIFICATION_ORDER.get(max_classification.value, 0):
            max_classification = f.classification_level

    blocked = any(f.action == "block" for f in findings)
    block_reason: str | None = None
    if blocked:
        blocked_types = list({f.entity_type.value for f in findings if f.action == "block"})
        block_reason = f"Credencial ou dado crítico detectado: {', '.join(blocked_types)}"

    requires_ack = CLASSIFICATION_ORDER.get(max_classification.value, 0) >= CLASSIFICATION_ORDER["restricted"]

    entity_types = tuple(sorted({f.entity_type.value for f in findings}))

    telemetry_meta = {
        "original_hash": original_hash,
        "entity_types": list(entity_types),
        "findings_count": len(findings),
        "risk_level": max_risk.value,
        "classification_level": max_classification.value,
        "blocked": blocked,
    }

    return DlpScanResult(
        original_hash=original_hash,
        masked_content=masked,
        risk_level=max_risk,
        classification_level=max_classification,
        findings=tuple(findings),
        entity_types=entity_types,
        blocked=blocked,
        block_reason=block_reason,
        requires_acknowledgment=requires_ack,
        telemetry_safe_metadata=telemetry_meta,
    )
