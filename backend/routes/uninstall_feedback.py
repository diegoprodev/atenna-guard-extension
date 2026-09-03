"""
FASE 10.6 — feedback de desinstalação (off-boarding).

  GET  /desinstalado        → página servida ao usuário quando ele remove a extensão
                              (chrome.runtime.setUninstallURL aponta pra cá)
  POST /uninstall-feedback  → grava a resposta (público — a extensão já foi removida,
                              não dá pra autenticar). Honeypot + caps + rate-limit por IP.
"""
from __future__ import annotations

import os
import time
from collections import deque

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from services.error_reporter import log_uninstall_feedback

router = APIRouter(tags=["feedback"])

_STATIC = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")

# motivos aceitos (o front manda a chave; texto livre só em "detail")
REASONS = {
    "nao_melhorou",
    "confuso",
    "bugs",
    "faltou_recurso",
    "caro",
    "nao_preciso",
    "outro",
}

# rate-limit por IP — 5 envios / 10 min (in-process, defesa contra flood trivial)
_hits: dict[str, deque] = {}
_WINDOW = 600
_MAX = 5


def _rate_ok(ip: str) -> bool:
    now = time.monotonic()
    dq = _hits.setdefault(ip, deque())
    while dq and now - dq[0] > _WINDOW:
        dq.popleft()
    if len(dq) >= _MAX:
        return False
    dq.append(now)
    return True


class UninstallFeedback(BaseModel):
    reason: str
    detail: str | None = Field(default=None, max_length=2000)
    email: str | None = Field(default=None, max_length=200)
    ext_version: str | None = Field(default=None, max_length=40)
    website: str | None = None  # honeypot — humanos deixam vazio


@router.get("/desinstalado", include_in_schema=False)
async def uninstall_page():
    return FileResponse(os.path.join(_STATIC, "uninstall.html"))


@router.post("/uninstall-feedback", include_in_schema=False)
async def uninstall_feedback(payload: UninstallFeedback, request: Request):
    # honeypot: bot preencheu → finge sucesso, não grava
    if payload.website:
        return JSONResponse({"received": True})

    ip = (request.client.host if request.client else "?") or "?"
    if not _rate_ok(ip):
        raise HTTPException(status_code=429, detail="slow down")

    if payload.reason not in REASONS:
        raise HTTPException(status_code=422, detail="reason inválido")

    await log_uninstall_feedback(
        reason=payload.reason,
        detail=payload.detail,
        email=payload.email,
        ext_version=payload.ext_version,
    )
    return JSONResponse({"received": True})
