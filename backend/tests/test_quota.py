import pytest
from unittest.mock import patch, MagicMock
from services.quota_service import check_and_increment_quota, QuotaExceeded, FREE_DAILY_LIMIT


def make_mock_client(allowed: bool, new_count: int):
    client = MagicMock()
    client.rpc.return_value.execute.return_value = MagicMock(
        data={"allowed": allowed, "new_count": new_count}
    )
    return client


def test_free_plan_allows_under_limit():
    with patch("services.quota_service.get_admin_client", return_value=make_mock_client(True, 5)):
        result = check_and_increment_quota("user-1", "free")
    assert result == 5


def test_free_plan_blocks_over_limit():
    with patch("services.quota_service.get_admin_client", return_value=make_mock_client(False, 11)):
        with pytest.raises(QuotaExceeded) as exc_info:
            check_and_increment_quota("user-1", "free")
    assert exc_info.value.count == 11


def test_pro_plan_never_blocked():
    # pro plan must return -1 without calling supabase at all
    with patch("services.quota_service.get_admin_client") as mock_client:
        result = check_and_increment_quota("user-1", "pro")
    assert result == -1
    mock_client.assert_not_called()


def test_supabase_failure_fails_open():
    client = MagicMock()
    client.rpc.side_effect = Exception("Supabase down")
    with patch("services.quota_service.get_admin_client", return_value=client):
        result = check_and_increment_quota("user-1", "free")
    assert result == 1  # fail open
