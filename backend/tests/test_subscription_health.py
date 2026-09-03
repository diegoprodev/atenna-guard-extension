"""FASE P3.5 — monitor de assinaturas."""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from routes import subscription_health as sh  # noqa: E402


class _Tbl:
    def __init__(self, rows):
        self._rows = rows

    def select(self, *_a, **_k):
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def eq(self, *_a, **_k):
        return self

    def update(self, *_a, **_k):
        return self

    def execute(self):
        return type("R", (), {"data": self._rows})()


class _SB:
    def __init__(self, tables):
        self._t = tables

    def table(self, name):
        return _Tbl(self._t.get(name, []))


def _patch(monkeypatch, tables):
    monkeypatch.setattr(sh, "_sb", lambda: _SB(tables))


def test_sem_drift_ok(monkeypatch):
    _patch(monkeypatch, {
        "profiles": [{"id": "u1", "plan": "pro", "plan_type": "pro",
                      "plan_expires_at": "2999-01-01T00:00:00Z"}],
        "user_plans": [{"user_id": "u1", "plan_type": "pro", "status": "active"}],
        "checkout_events": [],
    })
    r = sh.check()
    assert r["ok"] is True
    assert r["mismatch_total"] == 0


def test_drift_profiles_vs_user_plans(monkeypatch):
    _patch(monkeypatch, {
        "profiles": [{"id": "u1", "plan": "free", "plan_type": "free", "plan_expires_at": None}],
        "user_plans": [{"user_id": "u1", "plan_type": "pro", "status": "active"}],
        "checkout_events": [],
    })
    r = sh.check()
    assert r["ok"] is False
    assert "u1" in r["errors"]["drift_profiles_vs_user_plans"]


def test_pro_sem_expiry(monkeypatch):
    _patch(monkeypatch, {
        "profiles": [{"id": "u2", "plan": "pro", "plan_type": "pro", "plan_expires_at": None}],
        "user_plans": [{"user_id": "u2", "plan_type": "pro", "status": "active"}],
        "checkout_events": [],
    })
    r = sh.check()
    assert "u2" in r["warnings"]["pro_sem_expiry"]


def test_vencido_ainda_ativo(monkeypatch):
    _patch(monkeypatch, {
        "profiles": [{"id": "u3", "plan": "pro", "plan_type": "pro",
                      "plan_expires_at": "2020-01-01T00:00:00Z"}],
        "user_plans": [{"user_id": "u3", "plan_type": "pro", "status": "active"}],
        "checkout_events": [],
    })
    r = sh.check()
    assert "u3" in r["errors"]["vencido_ainda_ativo"]


def test_output_sem_email_cru(monkeypatch, caplog):
    _patch(monkeypatch, {
        "profiles": [{"id": "abcdef12-3456-7890", "plan": "free",
                      "plan_type": "free", "plan_expires_at": None,
                      "email": "vitima@empresa.com"}],
        "user_plans": [{"user_id": "abcdef12-3456-7890", "plan_type": "pro", "status": "active"}],
        "checkout_events": [],
    })
    import logging
    with caplog.at_level(logging.ERROR):
        sh.check()
    assert "vitima@empresa.com" not in caplog.text
    assert "abcdef12" in caplog.text  # só o prefixo do id


def test_reconcile_idempotente(monkeypatch):
    tables = {
        "profiles": [{"id": "u1", "plan": "free", "plan_type": "free", "plan_expires_at": None}],
        "user_plans": [{"user_id": "u1", "plan_type": "pro", "status": "active",
                        "plan_expires_at": "2999-01-01T00:00:00Z"}],
    }
    _patch(monkeypatch, tables)
    r1 = sh.reconcile(dry_run=True)
    assert r1["n"] == 1 and r1["changes"][0]["para"] == "pro"
