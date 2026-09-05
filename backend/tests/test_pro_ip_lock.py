"""
FASE P-ZT.4 — lock de IP único por conta PRO.

Impede uso simultâneo do mesmo login PRO em IPs diferentes (compartilhamento),
sem travar quem troca de rede: IP antigo ocioso > 15 min é adotado.
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

from services import pro_ip_lock
from services.pro_ip_lock import check_and_claim_ip, GRACE_SECONDS


def _now_iso(delta_s: int = 0) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=delta_s)).isoformat()


def _client(existing_row: dict | None):
    """Mock do supabase-py client. Guarda o que foi escrito em `.writes`."""
    sb = MagicMock()
    writes = []

    def _table(name):
        t = MagicMock()
        t._name = name

        # leitura: .select().eq().maybe_single().execute()
        chain = MagicMock()
        chain.execute.return_value = MagicMock(data=existing_row)
        t.select.return_value.eq.return_value.maybe_single.return_value = chain

        # escrita: .upsert(payload).execute() / .update(payload).eq().execute()
        def _upsert(payload):
            writes.append(("upsert", payload))
            m = MagicMock(); m.execute.return_value = MagicMock(data=[payload]); return m
        t.upsert.side_effect = _upsert

        def _update(payload):
            writes.append(("update", payload))
            m = MagicMock()
            m.eq.return_value.execute.return_value = MagicMock(data=[payload])
            return m
        t.update.side_effect = _update
        return t

    sb.table.side_effect = _table
    sb.writes = writes
    return sb


def test_first_request_creates_lock():
    sb = _client(None)
    res = check_and_claim_ip("u1", "186.204.19.42", "enforce", get_client=lambda: sb)
    assert res["allowed"] is True and res["action"] == "created"
    assert sb.writes[0][0] == "upsert"
    assert sb.writes[0][1]["active_ip"] == "186.204.19.42"


def test_same_ip_refreshes():
    sb = _client({"active_ip": "186.204.19.42", "last_seen_at": _now_iso(-60)})
    res = check_and_claim_ip("u1", "186.204.19.42", "enforce", get_client=lambda: sb)
    assert res["action"] == "refreshed" and res["allowed"] is True
    assert any(w[0] == "update" and "last_seen_at" in w[1] for w in sb.writes)


def test_different_ip_while_active_is_blocked_in_enforce():
    sb = _client({"active_ip": "186.204.19.42", "last_seen_at": _now_iso(-120)})
    res = check_and_claim_ip("u1", "8.8.8.8", "enforce", get_client=lambda: sb)
    assert res["allowed"] is False
    assert res["action"] == "blocked"
    assert res["active_ip"] == "186.204.19.42"
    # não escreveu nada (não roubou o lock)
    assert sb.writes == []


def test_different_ip_after_grace_is_adopted():
    sb = _client({"active_ip": "186.204.19.42", "last_seen_at": _now_iso(-(GRACE_SECONDS + 60))})
    res = check_and_claim_ip("u1", "8.8.8.8", "enforce", get_client=lambda: sb)
    assert res["allowed"] is True and res["action"] == "adopted"
    assert res["prev_ip"] == "186.204.19.42"
    assert any(w[0] == "update" and w[1]["active_ip"] == "8.8.8.8" for w in sb.writes)


def test_shadow_mode_allows_but_reports_block():
    sb = _client({"active_ip": "186.204.19.42", "last_seen_at": _now_iso(-120)})
    res = check_and_claim_ip("u1", "8.8.8.8", "shadow", get_client=lambda: sb)
    assert res["allowed"] is True          # shadow LIBERA
    assert res["action"] == "blocked"      # mas reporta o que bloquearia


def test_off_mode_is_a_noop():
    sb = _client({"active_ip": "x", "last_seen_at": _now_iso()})
    res = check_and_claim_ip("u1", "8.8.8.8", "off", get_client=lambda: sb)
    assert res["allowed"] is True and res["action"] == "off"
    assert sb.table.called is False


def test_supabase_error_fails_open():
    sb = MagicMock()
    sb.table.side_effect = RuntimeError("supabase down")
    res = check_and_claim_ip("u1", "8.8.8.8", "enforce", get_client=lambda: sb)
    assert res["allowed"] is True and res["action"] == "error"


def test_ipv6_same_prefix_is_same_ip():
    sb = _client({
        "active_ip": "2804:14d:5c3a:8a00::",
        "last_seen_at": _now_iso(-60),
    })
    res = check_and_claim_ip(
        "u1", "2804:14d:5c3a:8a00:abcd:ef01:2345:6789", "enforce", get_client=lambda: sb,
    )
    assert res["action"] == "refreshed"  # mesmo /64 -> não é "IP diferente"
