"""
Lock de IP único por conta PRO — FASE P-ZT.4.

Um assento PRO é 1 pessoa. Isto impede uso simultâneo do mesmo login em IPs
diferentes (família/time compartilhando conta), sem travar quem legitimamente
troca de rede (wifi -> 4G) ou viaja: o IP antigo ocioso > 15 min é adotado.

Tabela `pro_ip_locks` (1 linha por usuário PRO). Só o service_role escreve.

`PRO_IP_LOCK_MODE`:
  off      — desligado (default; guard nem chama isto)
  shadow   — observa e loga o que bloquearia, mas LIBERA
  enforce  — bloqueia de verdade (429)

Fail-open: erro no Supabase -> libera + logger.error (nunca travar pagante
por hiccup de infra; mesma política da cota).
"""
from __future__ import annotations

import os
import logging
from datetime import datetime, timezone

from services.request_ip import ip_key

logger = logging.getLogger(__name__)

GRACE_SECONDS = 900  # 15 min de ociosidade -> o IP antigo perde o lock


def get_mode() -> str:
    m = (os.getenv("PRO_IP_LOCK_MODE") or "off").strip().lower()
    return m if m in ("off", "shadow", "enforce") else "off"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_ts(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def check_and_claim_ip(user_id: str, ip: str, mode: str, *, get_client=None) -> dict:
    """
    Confere/reivindica o lock de IP do usuário PRO.

    Retorna dict com:
      allowed: bool          — se a request pode seguir
      action:  str           — created | refreshed | adopted | blocked | error
      active_ip: str | None   — IP que detém o lock (em 'blocked')
      idle_s: int | None
    """
    if mode == "off":
        return {"allowed": True, "action": "off"}

    key = ip_key(ip)

    try:
        if get_client is None:
            from services.supabase_admin import get_admin_client as get_client
        sb = get_client()
        resp = (
            sb.table("pro_ip_locks")
            .select("active_ip, last_seen_at")
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
        row = resp.data if resp else None
        now = _now()

        if not row:
            sb.table("pro_ip_locks").upsert({
                "user_id": user_id, "active_ip": key,
                "last_seen_at": now.isoformat(), "claimed_via": "request",
                "updated_at": now.isoformat(),
            }).execute()
            return {"allowed": True, "action": "created"}

        if ip_key(row["active_ip"]) == key:
            sb.table("pro_ip_locks").update({
                "last_seen_at": now.isoformat(), "updated_at": now.isoformat(),
            }).eq("user_id", user_id).execute()
            return {"allowed": True, "action": "refreshed"}

        idle = int((now - _parse_ts(row["last_seen_at"])).total_seconds())
        if idle > GRACE_SECONDS:
            sb.table("pro_ip_locks").update({
                "active_ip": key, "last_seen_at": now.isoformat(),
                "claimed_via": "request", "updated_at": now.isoformat(),
            }).eq("user_id", user_id).execute()
            return {"allowed": True, "action": "adopted",
                    "prev_ip": row["active_ip"], "idle_s": idle}

        # IP antigo ainda ativo -> conflito
        return {
            "allowed": mode != "enforce",
            "action": "blocked",
            "active_ip": row["active_ip"],
            "idle_s": idle,
        }
    except Exception as e:
        logger.error("pro_ip_lock: erro no Supabase (fail-open): %s", e)
        return {"allowed": True, "action": "error"}


def claim_on_login(user_id: str, ip: str, *, get_client=None) -> None:
    """Login explícito PRO reivindica o lock pro IP do login. Nunca lança."""
    if get_mode() == "off":
        return
    try:
        if get_client is None:
            from services.supabase_admin import get_admin_client as get_client
        sb = get_client()
        now = _now().isoformat()
        sb.table("pro_ip_locks").upsert({
            "user_id": user_id, "active_ip": ip_key(ip),
            "last_seen_at": now, "claimed_via": "login", "updated_at": now,
        }).execute()
    except Exception as e:
        logger.warning("pro_ip_lock: claim_on_login falhou (ignorado): %s", e)
