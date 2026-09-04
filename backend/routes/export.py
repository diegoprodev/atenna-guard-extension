"""
FASE 3.1B: User Data Export API

Endpoints para gerenciar ciclo de vida seguro de exports conforme LGPD Art. 18.
"""

import os
from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import StreamingResponse, HTMLResponse
from typing import Optional
import logging

from middleware.auth import require_auth
from dlp.export_manager import get_export_manager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/user/export", tags=["User Data Export"])

_SITE_URL = os.getenv("SITE_URL", "https://api.atennaia.com.br")


def _confirm_page(title: str, body: str, ok: bool = True) -> HTMLResponse:
    color = "#0B6E4B" if ok else "#B23A30"
    html = f"""<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} — Atenna</title>
<style>
  body{{margin:0;font:16px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;background:#FBFAF7;color:#1A2B24;
       display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}}
  .card{{max-width:440px;background:#fff;border:1px solid #E7E3DA;border-radius:14px;padding:36px;text-align:center}}
  h1{{font-size:20px;margin:0 0 12px;color:{color}}}
  p{{margin:0;color:#5B6B63}}
</style></head><body><div class="card"><h1>{title}</h1><p>{body}</p></div></body></html>"""
    return HTMLResponse(html, status_code=200 if ok else 400)


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
    user_id = _user.get("id") or _user.get("sub")
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

    email_sent = await _send_export_email(email, result.get("download_token"))

    return {
        "success": True,
        "message": (f"Email de confirmação enviado para {email}" if email_sent
                    else "Pedido registrado. Se o email não chegar em alguns minutos, use \"Reenviar\"."),
        "email_sent": email_sent,
        "note": "Clique no link no email para confirmar o export",
        "expires_in": result.get("expires_in")
    }


async def _send_export_email(email: str, token: str | None) -> bool:
    if not token:
        return False
    confirm_url = f"{_SITE_URL}/user/export/confirm?token={token}"
    try:
        from routes.email_service import render_data_export_confirmation, send_email
        return await send_email(
            email,
            "Confirme o pedido do seu relatório de dados — Atenna Safe Prompt",
            render_data_export_confirmation(confirm_url, email),
        )
    except Exception as e:
        logger.error(f"export confirmation email failed for {email[:40]}: {e}")
        return False


@router.post("/resend")
async def resend_export_email(_user: dict = Depends(require_auth)):
    """Reenvia o e-mail de confirmação do pedido de export ativo (status 'requested')."""
    user_id = _user.get("id") or _user.get("sub")
    email = _user.get("email")
    if not user_id or not email:
        raise HTTPException(status_code=400, detail="User info incomplete")
    try:
        from services.supabase_admin import get_admin_client
        r = (get_admin_client().table("user_export_requests")
             .select("download_token,status")
             .eq("user_id", user_id).eq("status", "requested")
             .order("created_at", desc=True).limit(1).execute())
    except Exception as e:
        logger.error(f"resend_export lookup failed: {e}")
        raise HTTPException(503, "Não foi possível reenviar agora.")
    if not r.data:
        raise HTTPException(404, "Nenhum pedido de relatório aguardando confirmação.")
    email_sent = await _send_export_email(email, r.data[0].get("download_token"))
    return {"email_sent": email_sent,
            "message": (f"Email reenviado para {email}" if email_sent
                        else "Não foi possível reenviar agora. Tente em alguns minutos.")}


@router.get("/confirm")
async def confirm_export_page(token: str = Query(...)):
    """
    Landing do link do e-mail (GET). Confirma, marca pronto e mostra o link de
    download DIRETO na página (não depende de um 2º e-mail que nunca era enviado).
    """
    manager = get_export_manager()
    result = manager.confirm_export(confirmation_token=token, expires_in_hours=48)
    already = (not result.get("success")
               and "already confirmed" in str(result.get("error", "")).lower())
    if not result.get("success") and not already:
        return _confirm_page(
            "Link inválido ou expirado",
            "Solicite um novo relatório na extensão, em Configurações → Seus dados.",
            ok=False,
        )
    try:
        manager.mark_export_ready(token)
    except Exception as e:
        logger.warning(f"mark_export_ready falhou (segue mesmo assim): {e}")

    dl = f"{_SITE_URL}/user/export/download-file?token={token}"
    return _confirm_page(
        "Relatório pronto",
        f'Seu relatório com os dados da conta está pronto.<br><br>'
        f'<a href="{dl}" style="display:inline-block;background:#0B6E4B;color:#fff;'
        f'text-decoration:none;padding:11px 20px;border-radius:9px;font-weight:600">'
        f'Baixar relatório (PDF)</a><br><br>'
        f'<span style="font-size:13px">Este link vale por 48 horas e permite até 3 downloads.</span>',
    )


@router.get("/download-file")
async def download_file(token: str = Query(...)):
    """
    Download do PDF pelo token (sem auth — o token de 32 bytes É o segredo,
    igual ao fluxo de reset de senha). Valida token, gera o PDF, incrementa o
    contador de downloads.
    """
    from services.supabase_admin import get_admin_client
    try:
        r = (get_admin_client().table("user_export_requests")
             .select("user_id,status,download_count,max_downloads")
             .eq("download_token", token).limit(1).execute())
    except Exception as e:
        logger.error(f"download-file lookup failed: {e}")
        raise HTTPException(503, "Serviço indisponível. Tente de novo em alguns minutos.")
    if not r.data:
        raise HTTPException(404, "Relatório não encontrado ou link inválido.")
    row = r.data[0]
    if row["status"] not in ("ready", "confirmed"):
        raise HTTPException(409, "Este relatório ainda não está pronto ou já expirou.")
    if (row.get("download_count") or 0) >= (row.get("max_downloads") or 3):
        raise HTTPException(410, "Limite de downloads deste relatório atingido.")

    manager = get_export_manager()
    uid = row["user_id"]
    # e-mail/plano pro cabeçalho do PDF
    email, plan = "", "Free"
    try:
        prof = get_admin_client().table("profiles").select("plan").eq("id", uid).single().execute()
        if prof.data:
            plan = prof.data.get("plan") or "Free"
    except Exception:
        pass
    try:
        u = get_admin_client().auth.admin.get_user_by_id(uid)
        email = getattr(getattr(u, "user", None), "email", "") or ""
    except Exception:
        pass

    pdf_bytes = manager.generate_pdf(user_id=uid, email=email, plan=plan)
    if not pdf_bytes:
        raise HTTPException(500, "Erro ao gerar o PDF.")
    try:
        manager.get_download_stream(download_token=token)  # incrementa o contador
    except Exception:
        pass

    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=relatorio_dados_{uid[:8]}.pdf"},
    )


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
    user_id = _user.get("id") or _user.get("sub")

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
    user_id = _user.get("id") or _user.get("sub")

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
