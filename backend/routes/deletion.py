"""
FASE 3.1A: Account Deletion API

Endpoints para gerenciar ciclo de vida seguro de deleção de conta.
Conforme LGPD Art. 17 (Direito ao esquecimento).
"""

import os
from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import HTMLResponse
from typing import Optional
import logging

from middleware.auth import require_auth
from dlp.deletion_manager import get_deletion_manager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/user/deletion", tags=["Account Deletion"])

_SITE_URL = os.getenv("SITE_URL", "https://api.atennaia.com.br")


def _page(title: str, body: str, ok: bool = True) -> HTMLResponse:
    color = "#0B6E4B" if ok else "#B23A30"
    html = f"""<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} — Atenna</title>
<style>
  body{{margin:0;font:16px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;background:#FBFAF7;color:#1A2B24;
       display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}}
  .card{{max-width:440px;background:#fff;border:1px solid #E7E3DA;border-radius:14px;padding:36px;text-align:center}}
  h1{{font-size:20px;margin:0 0 12px;color:{color}}}
  p{{margin:0 0 8px;color:#5B6B63}}
</style></head><body><div class="card"><h1>{title}</h1><p>{body}</p></div></body></html>"""
    return HTMLResponse(html, status_code=200 if ok else 400)


@router.post("/initiate")
async def initiate_deletion(
    reason: Optional[str] = Query(None),
    _user: dict = Depends(require_auth),
):
    """
    Iniciar solicitação de exclusão de conta.

    LGPD Art. 17: Direito ao esquecimento

    Processo:
    1. User solicita exclusão com motivo opcional
    2. Email de confirmação enviado
    3. Conta fica em estado PENDING_DELETION
    4. User confirma via link no email

    Returns:
        {
            "success": bool,
            "confirmation_token": str (hashed),
            "expires_at": datetime,
            "message": str
        }
    """
    user_id = _user.get("id") or _user.get("sub")
    email = _user.get("email")

    if not user_id or not email:
        raise HTTPException(status_code=400, detail="User info incomplete")

    logger.info(f"Deletion request initiated by {user_id}")

    manager = get_deletion_manager()
    result = manager.initiate_deletion(
        user_id=user_id,
        email=email,
        reason=reason,
    )

    if not result["success"]:
        raise HTTPException(
            status_code=503,
            detail=f"Could not initiate deletion: {result.get('error')}",
        )

    # Envia o e-mail de confirmação (antes: a rota dizia "enviado" e nada saía).
    token = result.get("confirmation_token")
    email_sent = False
    if token:
        confirm_url = f"{_SITE_URL}/user/deletion/confirm?token={token}"
        try:
            from routes.email_service import render_account_deletion_confirmation, send_email
            email_sent = await send_email(
                email,
                "Confirme a exclusão da sua conta — Atenna Safe Prompt",
                render_account_deletion_confirmation(confirm_url, email),
            )
        except Exception as e:
            logger.error(f"deletion confirmation email failed for {email[:40]}: {e}")

    return {
        "success": True,
        "message": (f"Email de confirmação enviado para {email}" if email_sent
                    else "Pedido registrado. Se o email não chegar em alguns minutos, tente de novo."),
        "email_sent": email_sent,
        "note": "Clique no link no email para confirmar exclusão. Nada acontece com a conta antes disso.",
        "expires_in": "24 horas",
    }


@router.get("/confirm")
async def confirm_deletion_page(token: str = Query(...)):
    """Landing do link do e-mail (GET). Confirma a exclusão e mostra uma página."""
    manager = get_deletion_manager()
    result = manager.confirm_deletion(confirmation_token=token, grace_period_days=7)
    if not result.get("success"):
        return _page(
            "Link inválido ou expirado",
            "Solicite a exclusão de novo na extensão, em Configurações → Exclusão de conta.",
            ok=False,
        )
    return _page(
        "Exclusão confirmada",
        "Sua conta será excluída em 7 dias. Até lá, você pode cancelar na extensão, "
        "em Configurações → Exclusão de conta.",
    )


@router.post("/confirm")
async def confirm_deletion(
    token: str = Query(...),
    grace_period_days: int = Query(default=7, ge=1, le=30),
):
    """
    Confirmar exclusão de conta via token do email.

    LGPD Art. 17: Direito ao esquecimento

    Processo:
    1. User clica link no email com token
    2. Conta vira DELETION_SCHEDULED
    3. Grace period começa (padrão 7 dias)
    4. Após grace period, dados são purgados automaticamente

    Args:
        token: Token recebido por email
        grace_period_days: Dias antes de deletar (1-30, default 7)

    Returns:
        {
            "success": bool,
            "deletion_scheduled_at": datetime,
            "grace_period_days": int,
            "message": str
        }
    """
    logger.info(f"Deletion confirmation requested with token")

    manager = get_deletion_manager()
    result = manager.confirm_deletion(
        confirmation_token=token,
        grace_period_days=grace_period_days,
    )

    if not result["success"]:
        raise HTTPException(
            status_code=400,
            detail=result.get("error", "Token inválido ou expirado"),
        )

    return {
        "success": True,
        "deletion_scheduled_at": result.get("deletion_scheduled_at"),
        "grace_period_days": grace_period_days,
        "message": result.get("message"),
        "note": "Você pode cancelar dentro do período de graça",
    }


@router.get("/status")
async def get_deletion_status(
    _user: dict = Depends(require_auth),
):
    """
    Obter status de solicitação de deleção pendente.

    Mostra:
    - Se há solicitação de deleção ativa
    - Status atual (pending_confirmation, deletion_scheduled)
    - Quantos dias faltam no período de graça

    Returns:
        {
            "has_pending_request": bool,
            "status": str | None,
            "deletion_scheduled_at": datetime | None,
            "grace_period_remaining_days": int | None
        }
    """
    user_id = _user.get("id") or _user.get("sub")

    manager = get_deletion_manager()
    status = manager.get_deletion_status(user_id=user_id)

    return {
        "has_pending_request": status.get("has_pending_request"),
        "status": status.get("status"),
        "deletion_scheduled_at": status.get("deletion_scheduled_at"),
        "grace_period_remaining_days": status.get("grace_period_remaining_days"),
        "note": (
            "Você pode cancelar a deleção até o final do período de graça"
            if status.get("has_pending_request")
            else "Nenhuma solicitação de deleção pendente"
        ),
    }


@router.post("/cancel")
async def cancel_deletion(
    reason: Optional[str] = Query(None),
    _user: dict = Depends(require_auth),
):
    """
    Cancelar solicitação de exclusão de conta.

    Apenas possível enquanto a conta ainda estiver em estado
    PENDING_DELETION ou DELETION_SCHEDULED (antes do purge).

    Uma vez que o purge começou, não é possível cancelar.

    Args:
        reason: Motivo opcional para cancelamento

    Returns:
        {
            "success": bool,
            "message": str
        }
    """
    user_id = _user.get("id") or _user.get("sub")

    logger.info(f"Deletion cancellation requested by {user_id}")

    manager = get_deletion_manager()
    result = manager.cancel_deletion(
        user_id=user_id,
        reason=reason,
    )

    if not result["success"]:
        raise HTTPException(
            status_code=400,
            detail=result.get("error", "Não foi possível cancelar"),
        )

    return {
        "success": True,
        "message": result.get("message"),
    }


@router.get("/lifecycle")
async def get_deletion_lifecycle():
    """
    Explicar o ciclo de vida de deleção de conta.

    Informação pública sobre como funciona o processo de deleção
    conforme LGPD Art. 17.

    Returns:
        {
            "lifecycle": dict with states and transitions,
            "grace_period_days": int,
            "token_validity_hours": int,
            "compliance": dict with LGPD info
        }
    """
    return {
        "lifecycle": {
            "ACTIVE": "Conta ativa normal",
            "PENDING_DELETION": "Exclusão solicitada, aguardando confirmação por email",
            "DELETION_SCHEDULED": "Exclusão confirmada, no período de graça",
            "PURGING": "Dados sendo deletados",
            "PURGED": "Dados deletados, conta removida",
            "ANONYMIZED": "Logs anonimizados (sem PII)",
            "CANCELLED": "Exclusão foi cancelada, conta reativada",
        },
        "transitions": {
            "ACTIVE → PENDING_DELETION": "User solicita exclusão",
            "PENDING_DELETION → DELETION_SCHEDULED": "User confirma via email",
            "DELETION_SCHEDULED → PURGING": "Grace period expira (automático)",
            "PURGING → PURGED": "Dados deletados",
            "PURGED → ANONYMIZED": "Logs anonimizados",
            "PENDING_DELETION → ACTIVE": "User cancela exclusão",
            "DELETION_SCHEDULED → ACTIVE": "User cancela antes do grace period",
        },
        "grace_period_days": 7,
        "token_validity_hours": 24,
        "compliance": {
            "article": "LGPD Art. 17",
            "right": "Direito ao Esquecimento",
            "guarantee": "Dados deletados ou anonimizados conforme política",
            "timeline": "Purge executado em até 7 dias após confirmação",
            "reversibility": "Pode ser cancelado durante período de graça",
            "preservation": "Logs anonimizados preservados para compliance",
        },
    }


@router.get("/anonymization-summary")
async def get_anonymization_summary(_user: dict = Depends(require_auth)):
    """
    Obter resumo de operações de anonimização.

    Apenas para verificação de compliance (usuários com permissão).
    Mostra estatísticas agregadas sem PII.

    Returns:
        {
            "total_anonymizations": int,
            "recent_anonymizations": list[dict]
        }
    """
    # Em produção, validar permissão de admin
    manager = get_deletion_manager()
    summary = manager.get_anonymization_summary()

    return {
        "total_anonymizations": summary.get("total_anonymizations"),
        "recent_anonymizations_count": len(
            summary.get("recent_anonymizations", [])
        ),
        "message": "Summary of anonymization operations (compliance purposes)",
    }
