from fastapi import APIRouter, Depends, HTTPException
from dlp.entities import ScanRequest, ScanResponse, ImageScanRequest
from dlp.pipeline import run
from dlp.image_ocr import extract_text_from_image
from middleware.auth import require_auth

router = APIRouter(prefix="/dlp", tags=["DLP"])


@router.post("/scan", response_model=ScanResponse)
async def scan(request: ScanRequest, _user: dict = Depends(require_auth)) -> ScanResponse:
    return await run(request)


@router.post("/image", response_model=ScanResponse)
async def image_scan(request: ImageScanRequest, _user: dict = Depends(require_auth)) -> ScanResponse:
    try:
        text = extract_text_from_image(request.image_b64)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return await run(ScanRequest(
        text=text or "",
        user_id=request.user_id,
        session_id=request.session_id,
        platform=request.platform,
    ))


@router.get("/health")
async def dlp_health():
    return {"status": "ok", "engine": "presidio"}
