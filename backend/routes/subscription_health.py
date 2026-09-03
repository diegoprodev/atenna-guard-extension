"""
FASE P3.5 — Monitor de assinaturas (proteção de receita).

O plano do usuário vive em 3 tabelas (profiles / user_plans / subscriptions),
escritas não-atomicamente pelo checkout. Este módulo detecta divergência e
outros modos de falha, emite métricas Prometheus e loga (→ GlitchTip → Discord)
SEM vazar PII (só user_id[:8]).

Também expõe `reconcile()` — usado pelo script one-shot `scripts/reconcile_plans.py`.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

from supabase import create_client

logger = logging.getLogger("atenna.subscriptions")

try:
    from observability_metrics import (
        set_subscription_metrics,
        set_last_checkout_event_age,
    )
except Exception:  # pragma: no cover
    def set_subscription_metrics(*_a, **_k):
        return None

    def set_last_checkout_event_age(*_a, **_k):
        return None


def _sb():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")
    return create_client(url, key) if url and key else None


def _short(uid: str) -> str:
    return (uid or "")[:8]


def check() -> dict:
    """
    Roda os 4 checks. Retorna resumo. Loga ERROR (→ issue) se achar problema.
    Nunca levanta — é um job de monitoramento.
    """
    sb = _sb()
    if not sb:
        logger.warning("subscription_health: sem Supabase client")
        return {"ok": False, "reason": "no_client"}

    now = datetime.now(timezone.utc)
    problems: dict[str, list[str]] = {
        "drift_profiles_vs_user_plans": [],
        "pro_sem_expiry": [],
        "vencido_ainda_ativo": [],
    }
    counts: dict[str, int] = {}

    try:
        profiles = sb.table("profiles").select(
            "id, plan, plan_type, plan_expires_at"
        ).execute().data or []
        user_plans = sb.table("user_plans").select(
            "user_id, plan_type, status"
        ).execute().data or []
    except Exception as e:
        logger.error("subscription_health: falha ao ler tabelas: %s", e)
        return {"ok": False, "reason": "query_failed"}

    up_by_uid = {str(r.get("user_id")): r for r in user_plans}

    for p in profiles:
        uid = str(p.get("id"))
        prof_pro = (p.get("plan") == "pro")
        up = up_by_uid.get(uid)
        up_pro = bool(up and up.get("plan_type") == "pro" and up.get("status") == "active")

        if prof_pro != up_pro:
            problems["drift_profiles_vs_user_plans"].append(_short(uid))

        if prof_pro and not p.get("plan_expires_at"):
            problems["pro_sem_expiry"].append(_short(uid))

        exp = p.get("plan_expires_at")
        if prof_pro and exp:
            try:
                exp_dt = datetime.fromisoformat(str(exp).replace("Z", "+00:00"))
                if exp_dt < now:
                    problems["vencido_ainda_ativo"].append(_short(uid))
            except Exception:
                pass

    # contagem por (plan, status) p/ métrica
    for r in user_plans:
        k = f'{r.get("plan_type","?")}/{r.get("status","?")}'
        counts[k] = counts.get(k, 0) + 1
    counts["profiles_pro"] = sum(1 for p in profiles if p.get("plan") == "pro")

    # idade do último evento de checkout
    last_age = None
    try:
        ce = sb.table("checkout_events").select("created_at").order(
            "created_at", desc=True
        ).limit(1).execute().data or []
        if ce:
            last_dt = datetime.fromisoformat(str(ce[0]["created_at"]).replace("Z", "+00:00"))
            last_age = (now - last_dt).total_seconds()
            set_last_checkout_event_age(last_age)
    except Exception:
        pass

    # errors (têm que ser consertados) vs warnings (revisar — contas comp podem não ter expiry)
    errors = {k: v for k, v in problems.items()
              if k in ("drift_profiles_vs_user_plans", "vencido_ainda_ativo") and v}
    warnings = {k: v for k, v in problems.items() if k == "pro_sem_expiry" and v}
    err_total = sum(len(v) for v in errors.values())

    set_subscription_metrics(counts, err_total)

    summary = {
        "ok": err_total == 0,
        "mismatch_total": err_total,
        "errors": errors,
        "warnings": warnings,
        "counts": counts,
        "last_checkout_event_age_h": round(last_age / 3600, 1) if last_age else None,
    }

    if err_total:
        logger.error("subscription_health: %d divergência(s) — %s", err_total, errors)
    if warnings:
        logger.warning("subscription_health: %s", warnings)
    if not err_total and not warnings:
        logger.info("subscription_health OK — %s", counts)

    return summary


async def run_subscription_health() -> dict:
    """Wrapper async p/ o scheduler (AsyncIOScheduler)."""
    import asyncio
    return await asyncio.get_event_loop().run_in_executor(None, check)


def reconcile(dry_run: bool = True) -> dict:
    """
    Fonte da verdade = user_plans (mais atual). Sincroniza profiles p/ bater.
    Idempotente. `dry_run=True` só lista o que faria.
    """
    sb = _sb()
    if not sb:
        return {"ok": False, "reason": "no_client"}

    profiles = sb.table("profiles").select(
        "id, plan, plan_type, plan_expires_at"
    ).execute().data or []
    user_plans = sb.table("user_plans").select(
        "user_id, plan_type, status, plan_expires_at"
    ).execute().data or []
    up_by_uid = {str(r.get("user_id")): r for r in user_plans}

    changes = []
    for p in profiles:
        uid = str(p.get("id"))
        up = up_by_uid.get(uid)
        want_pro = bool(up and up.get("plan_type") == "pro" and up.get("status") == "active")
        want_plan = "pro" if want_pro else "free"
        want_exp = up.get("plan_expires_at") if (up and want_pro) else None

        if p.get("plan") != want_plan or (want_pro and not p.get("plan_expires_at") and want_exp):
            changes.append({"user": uid[:8], "de": p.get("plan"), "para": want_plan})
            if not dry_run:
                sb.table("profiles").update({
                    "plan": want_plan,
                    "plan_type": want_plan if not want_pro else up.get("plan_type", "pro"),
                    "plan_expires_at": want_exp,
                    "updated_at": "now()",
                }).eq("id", uid).execute()

    return {"ok": True, "dry_run": dry_run, "changes": changes, "n": len(changes)}
