"""
POST /report-problem
Receives a user-submitted problem report from the extension.
Logs to admin panel and optionally sends webhook notification.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional

from middleware.auth import require_auth
from services.error_reporter import log_user_report

router = APIRouter(tags=["report"])


class ProblemReportPayload(BaseModel):
    error_code: str
    error_message: str
    page_url: Optional[str] = None
    extension_version: Optional[str] = None
    context: Optional[dict] = None


@router.post("/report-problem")
async def report_problem(
    payload: ProblemReportPayload,
    user: dict = Depends(require_auth),
):
    user_id = user.get("sub") or user.get("id")
    user_email = user.get("email")

    cid = await log_user_report(
        user_id=user_id,
        user_email=user_email,
        error_code=payload.error_code,
        error_message=payload.error_message,
        context=payload.context,
        page_url=payload.page_url,
        extension_version=payload.extension_version,
    )

    return JSONResponse({"received": True, "correlation_id": cid})
