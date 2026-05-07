from fastapi import APIRouter, Depends
from dlp.entities import ScanRequest, ScanResponse
from dlp.pipeline import run
from middleware.auth import require_auth

router = APIRouter(prefix="/dlp", tags=["DLP"])


@router.post("/scan", response_model=ScanResponse)
async def scan(request: ScanRequest, _user: dict = Depends(require_auth)) -> ScanResponse:
    """
    Backend DLP scan — Presidio + contextual scoring.
    Called asynchronously after the local client-side pre-scan.
    Never blocks prompt generation.
    """
    return run(request)


@router.get("/health")
async def dlp_health():
    return {"status": "ok", "engine": "presidio"}
