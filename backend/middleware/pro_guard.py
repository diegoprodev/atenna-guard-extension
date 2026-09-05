"""
FASE P-ZT.4 — guard dos endpoints PAGOS (LLM/OCR externo).

`Depends(enforce_pro_limits)` = require_auth + (se PRO) lock de IP único.
O teto de 12/hora continua sendo aplicado pelo `check_rate_limit` de sempre
dentro de cada rota — este guard só adiciona a checagem de IP.

Free não passa por aqui (já tem o /dia; compartilhar login free = 5/dia no
total, não vale o abuso). Fail-open em qualquer erro.
"""
import logging

from fastapi import Depends, HTTPException, Request

from middleware.auth import require_auth
from services.client_ip import get_client_ip, mask_ip
from services.pro_ip_lock import check_and_claim_ip, get_mode

try:
    from dlp.rate_limit import get_user_plan
except Exception:  # pragma: no cover
    def get_user_plan(_uid):  # type: ignore
        return "free"

try:
    from dlp.rate_limit import audit_log
except Exception:  # pragma: no cover
    def audit_log(*_a, **_k):  # type: ignore
        return None

try:
    from observability_metrics import record_pro_ip_lock_block
except Exception:  # pragma: no cover
    def record_pro_ip_lock_block(*_a, **_k):
        return None

logger = logging.getLogger(__name__)


def enforce_pro_limits(request: Request, user: dict = Depends(require_auth)) -> dict:
    mode = get_mode()
    if mode == "off":
        return user

    user_id = user.get("user_id")
    if not user_id:
        return user

    try:
        plan = get_user_plan(user_id)
    except Exception:
        plan = user.get("plan", "free")
    if plan != "pro":
        return user  # IP lock é só PRO

    ip = get_client_ip(request)
    res = check_and_claim_ip(user_id, ip, mode)

    if res.get("action") == "blocked":
        record_pro_ip_lock_block(mode)
        try:
            audit_log(
                user_id, "pro_ip_lock",
                metadata={
                    "mode": mode,
                    "active_ip": res.get("active_ip"),
                    "req_ip": ip,
                    "idle_s": res.get("idle_s"),
                },
            )
        except Exception:
            pass
        logger.warning(
            "pro_ip_lock %s: user=%s req_ip=%s active_ip=%s idle=%ss",
            mode, user_id, ip, res.get("active_ip"), res.get("idle_s"),
        )
        if mode == "enforce":
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "account_in_use_elsewhere",
                    # Mensagem amigável exigida pelo dono — mostrada ao 2º
                    # dispositivo quando dois IPs estão online ao mesmo tempo.
                    "message": (
                        "Você só pode usar o Atenna Safe Prompt em um único "
                        "dispositivo de forma simultânea."
                    ),
                    "hint": (
                        f"Sua conta está ativa em outro local (IP {mask_ip(res.get('active_ip') or '?')}). "
                        "Aguarde alguns minutos sem uso no outro dispositivo ou entre "
                        "novamente aqui para assumir a sessão."
                    ),
                },
            )

    return user
