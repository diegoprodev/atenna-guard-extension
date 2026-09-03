from fastapi import APIRouter
from routes.admin import overview, users, feature_flags, system, errors, dlp, audit, costs

router = APIRouter(prefix='/admin', tags=['Admin'])
router.include_router(overview.router)
router.include_router(users.router)
router.include_router(feature_flags.router)
router.include_router(system.router)
router.include_router(errors.router)
router.include_router(dlp.router)
router.include_router(audit.router)
router.include_router(costs.router)

from routes.admin import usage, plans
router.include_router(usage.router)
router.include_router(plans.router)


from routes.admin import compliance
router.include_router(compliance.router)

from routes.admin import subscriptions
router.include_router(subscriptions.router)

from routes.admin import uninstall_feedback
router.include_router(uninstall_feedback.router)
