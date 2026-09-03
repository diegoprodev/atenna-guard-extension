"""Admin — saúde das assinaturas (FASE P3.5). O job diário é o que alerta; aqui é sob demanda."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from middleware.admin_auth import require_super_admin

router = APIRouter()


@router.get("/subscriptions/health")
async def subscriptions_health(_: dict = Depends(require_super_admin)):
    from routes.subscription_health import check
    return check()


class ReconcileBody(BaseModel):
    confirmed: bool = False


@router.post("/subscriptions/reconcile")
async def subscriptions_reconcile(body: ReconcileBody, admin: dict = Depends(require_super_admin)):
    from routes.subscription_health import reconcile
    r = reconcile(dry_run=not body.confirmed)
    try:
        from services.audit_service import record_audit_event
        await record_audit_event(
            admin.get("id", "?"),
            "subscriptions.reconcile",
            after={"applied": body.confirmed, "n": r.get("n"), "changes": r.get("changes")},
        )
    except Exception:
        pass
    return r
