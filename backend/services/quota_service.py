# backend/services/quota_service.py
import logging
from services.supabase_admin import get_admin_client

logger = logging.getLogger(__name__)

FREE_DAILY_LIMIT = 10


class QuotaExceeded(Exception):
    def __init__(self, count: int):
        self.count = count
        super().__init__(f"Daily quota exceeded: {count}/{FREE_DAILY_LIMIT}")


def check_and_increment_quota(user_id: str, plan: str) -> int:
    """
    Returns the new daily count, or raises QuotaExceeded.
    Pro plan: always returns -1 (unlimited).
    Requires Supabase RPC 'increment_daily_quota' and table 'daily_quota'.
    """
    if plan == "pro":
        return -1

    try:
        client = get_admin_client()
        result = client.rpc(
            "increment_daily_quota",
            {"p_user_id": user_id, "p_limit": FREE_DAILY_LIMIT},
        ).execute()

        data = result.data
        if not isinstance(data, dict):
            logger.warning("increment_daily_quota returned unexpected type: %s", type(data))
            return 1  # fail open (don't break for RPC schema issues)

        if not data.get("allowed", True):
            raise QuotaExceeded(data.get("new_count", FREE_DAILY_LIMIT + 1))

        return data.get("new_count", 1)

    except QuotaExceeded:
        raise
    except Exception as e:
        logger.warning("check_and_increment_quota failed: %s — failing open", e)
        return 1  # fail open if Supabase unavailable
