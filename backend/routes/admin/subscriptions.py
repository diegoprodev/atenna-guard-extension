"""Admin — saúde das assinaturas (FASE P3.5). Só leitura; o job diário é o que alerta."""
from fastapi import APIRouter, Depends
from middleware.admin_auth import require_super_admin

router = APIRouter()


@router.get("/subscriptions/health")
async def subscriptions_health(_: dict = Depends(require_super_admin)):
    from routes.subscription_health import check
    return check()
