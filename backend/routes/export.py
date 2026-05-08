"""
FASE 3.1B: User Data Export API

Endpoints para gerenciar ciclo de vida seguro de exports conforme LGPD Art. 18.
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import StreamingResponse
from typing import Optional
import logging

from middleware.auth import require_auth
from dlp.export_manager import get_export_manager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/user/export", tags=["User Data Export"])


@router.post("/request")
async def request_export(
    _user: dict = Depends(require_auth),
):
    """
    Solicitar export de dados pessoais.

    LGPD Art. 18: Direito ao Acesso

    Processo:
    1. User solicita export
    2. Email de confirmação enviado (token válido por 24h)
    3. User confirma via link no email
    4. Sistema gera PDF de relatório de dados
    5. User faz download do PDF (máx 3 downloads em 48h)

    Returns:
        {
            "success": bool,
            "message": str,
            "expires_in": str
        }
    """
    user_id = _user.get("sub")
    email = _user.get("email")

    if not user_id or not email:
        raise HTTPException(status_code=400, detail="User info incomplete")

    logger.info(f"Export request initiated by {user_id}")

    manager = get_export_manager()
    result = manager.request_export(
        user_id=user_id,
        email=email
    )

    if not result["success"]:
        raise HTTPException(
            status_code=503,
            detail=f"Could not initiate export: {result.get('error')}"
        )

    return {
        "success": True,
        "message": f"Email de confirmação enviado para {email}",
        "note": "Clique no link no email para confirmar o export",
        "expires_in": result.get("expires_in")
    }


@router.post("/confirm")
async def confirm_export(
    token: str = Query(...),
    expires_in_hours: int = Query(default=48, ge=1, le=72),
):
    """
    Confirmar export de dados via token do email.

    Processo:
    1. User clica link no email com token
    2. Sistema confirma e dispara geração do PDF
    3. PDF é gerado em background
    4. User recebe email com link de download

    Args:
        token: Token recebido por email
        expires_in_hours: Horas até expiração do PDF (1-72, default 48)

    Returns:
        {
            "success": bool,
            "processing_status": str,
            "message": str,
            "expires_in_hours": int
        }
    """
    logger.info(f"Export confirmation requested with token")

    manager = get_export_manager()
    result = manager.confirm_export(
        confirmation_token=token,
        expires_in_hours=expires_in_hours
    )

    if not result["success"]:
        raise HTTPException(
            status_code=400,
            detail=result.get("error", "Token inválido ou expirado")
        )

    return {
        "success": True,
        "processing_status": result.get("processing_status"),
        "message": result.get("message"),
        "expires_in_hours": result.get("expires_in_hours"),
        "note": "Seu relatório será preparado em breve. Você receberá um email com o link de download."
    }


@router.get("/status")
async def get_export_status(
    _user: dict = Depends(require_auth),
):
    """
    Obter status de requisição de export pendente.

    Mostra:
    - Se há requisição de export ativa
    - Status atual (requested, confirmed, processing, ready, expired)
    - Quantos downloads restam (máx 3)
    - Quando o PDF expira

    Returns:
        {
            "has_pending_request": bool,
            "status": str | None,
            "expires_at": datetime | None,
            "download_count": int | None,
            "max_downloads": int | None,
            "note": str
        }
    """
    user_id = _user.get("sub")

    manager = get_export_manager()
    status = manager.get_export_status(user_id=user_id)

    return {
        "has_pending_request": status.get("has_pending_request"),
        "status": status.get("status"),
        "expires_at": status.get("expires_at"),
        "download_count": status.get("download_count"),
        "max_downloads": status.get("max_downloads"),
        "note": (
            "Seu relatório está pronto para download"
            if status.get("status") == "ready"
            else "Nenhuma requisição de export pendente"
        ),
    }


@router.get("/download")
async def download_export(
    token: str = Query(...),
    _user: dict = Depends(require_auth),
):
    """
    Fazer download do PDF de dados pessoais.

    Valida:
    - Token é válido
    - Não expirou (máx 48h)
    - Não excedeu limite de downloads (máx 3)

    Args:
        token: Token de download (enviado por email)

    Returns:
        Stream PDF com headers apropriados
    """
    user_id = _user.get("sub")

    logger.info(f"Export download requested by {user_id}")

    manager = get_export_manager()

    # Validar token e registrar download
    validation = manager.get_download_stream(download_token=token)

    if not validation["success"]:
        raise HTTPException(
            status_code=400,
            detail=validation.get("error", "Token inválido ou expirado")
        )

    # Gerar PDF (simulado para agora — em produção seria do cache/storage)
    email = _user.get("email")
    pdf_bytes = manager.generate_pdf(
        user_id=user_id,
        email=email,
        plan=_user.get("plan", "Free")
    )

    if not pdf_bytes:
        raise HTTPException(
            status_code=500,
            detail="Erro ao gerar PDF"
        )

    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename=relatorio_dados_{user_id[:8]}.pdf"
        }
    )


@router.post("/purge")
async def purge_expired_exports():
    """
    Purgar exports expirados (job automático).

    Admin/interno: Remove arquivos de exports que expiraram.

    Returns:
        {
            "success": bool,
            "purged_count": int,
            "duration_ms": int
        }
    """
    logger.info("Purging expired exports")

    manager = get_export_manager()
    result = manager.purge_expired_exports()

    return {
        "success": result.get("success"),
        "purged_count": result.get("purged_count", 0),
        "duration_ms": result.get("duration_ms", 0),
        "message": f"Purged {result.get('purged_count', 0)} expired exports"
    }


@router.get("/summary")
async def get_export_summary():
    """
    Obter sumário de operações de export (compliance).

    Admin/interno: Estatísticas para auditoria e conformidade.

    Returns:
        {
            "total_exports": int,
            "exports_completed": int,
            "exports_expired": int,
            "exports_purged": int
        }
    """
    manager = get_export_manager()
    summary = manager.get_export_summary()

    return {
        "total_exports": summary.get("total_exports", 0),
        "exports_completed": summary.get("exports_completed", 0),
        "exports_expired": summary.get("exports_expired", 0),
        "exports_purged": summary.get("exports_purged", 0),
        "message": "Summary of user data export operations (LGPD compliance)"
    }
