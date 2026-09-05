"""
FASE P-ZT.4 — teto PRO baixado de 20 -> 12 gerações/hora (pedido explícito
do dono: "geração máxima de 12 prompts por hora" pra cortar o abuso de login
compartilhado e economizar custo de API).
"""
from dlp.rate_limit import (
    PRO_HOURLY_LIMIT, FREE_DAILY_LIMIT, check_rate_limit,
)


def test_pro_hourly_limit_is_12():
    assert PRO_HOURLY_LIMIT == 12


def test_free_daily_still_5():
    # a mudança do PRO não pode ter mexido no free
    assert FREE_DAILY_LIMIT == 5


def test_pro_blocked_on_13th_generation_in_the_hour(monkeypatch):
    calls = {"n": 0}

    def fake_count_window(_user_id, window):
        # 'hour' já tem 12; os outros bem abaixo do limite
        return 12 if window == "hour" else 0

    monkeypatch.setattr("dlp.rate_limit._count_window", fake_count_window)
    res = check_rate_limit("u-pro", "pro")
    assert res["allowed"] is False
    assert res["window"] == "hour"
    assert res["limit"] == 12
    assert res["count"] == 12
    calls["n"] += 1


def test_pro_allowed_at_11_in_the_hour(monkeypatch):
    monkeypatch.setattr(
        "dlp.rate_limit._count_window",
        lambda _u, w: 11 if w == "hour" else 0,
    )
    res = check_rate_limit("u-pro", "pro")
    assert res["allowed"] is True
