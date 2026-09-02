from fastapi import APIRouter, Depends, HTTPException
from dlp.entities import ScanRequest, ScanResponse, ImageScanRequest
from dlp.pipeline import run
from dlp.image_ocr import extract_text_from_image
from middleware.auth import require_auth

try:
    from observability_metrics import record_dlp_scan
except Exception:  # pragma: no cover
    def record_dlp_scan(*_a, **_k):
        return None

router = APIRouter(prefix="/dlp", tags=["DLP"])


def _resp_risk(resp: ScanResponse) -> str:
    rl = getattr(resp, "risk_level", None)
    return getattr(rl, "value", None) or str(rl or "UNKNOWN")


@router.post("/scan", response_model=ScanResponse)
async def scan(request: ScanRequest, _user: dict = Depends(require_auth)) -> ScanResponse:
    resp = await run(request)
    record_dlp_scan(_resp_risk(resp))
    return resp


@router.post("/image", response_model=ScanResponse)
async def image_scan(request: ImageScanRequest, _user: dict = Depends(require_auth)) -> ScanResponse:
    try:
        text = extract_text_from_image(request.image_b64)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    resp = await run(ScanRequest(
        text=text or "",
        user_id=request.user_id,
        session_id=request.session_id,
        platform=request.platform,
    ))
    record_dlp_scan(_resp_risk(resp))
    return resp


@router.get("/health")
async def dlp_health():
    return {"status": "ok", "engine": "presidio"}
