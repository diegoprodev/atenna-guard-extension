from .entities import RiskLevel, DetectedEntity, ScanResponse
from presidio_analyzer import RecognizerResult


ADVISORIES = {
    RiskLevel.NONE:   ("", False),
    RiskLevel.LOW:    ("Verifique se há informações sensíveis antes de enviar.", True),
    RiskLevel.MEDIUM: ("Possível informação sensível detectada. Revise antes de enviar.", True),
    RiskLevel.HIGH:   ("Informação sensível detectada. Revise antes de enviar.", True),
}


def build_response(
    risk_level:  RiskLevel,
    score:       float,
    results:     list[RecognizerResult],
    text:        str,
    duration_ms: float,
) -> ScanResponse:
    advisory_msg, show = ADVISORIES[risk_level]

    entities = [
        DetectedEntity(
            type=r.entity_type,
            value=text[r.start:r.end],
            start=r.start,
            end=r.end,
            score=r.score,
        )
        for r in results
    ]

    return ScanResponse(
        risk_level=risk_level,
        score=score,
        entities=entities,
        advisory=advisory_msg,
        show_warning=show,
        duration_ms=duration_ms,
    )
