import pytest
from routes.admin.compliance import (
    _build_summary_from_rows,
    _build_trend_from_rows,
    ComplianceSummary,
)


def test_build_summary_empty():
    result = _build_summary_from_rows([])
    assert result.total_events == 0
    assert result.high_risk_events == 0
    assert result.protected_count == 0
    assert result.protection_rate == 0.0
    assert result.top_entity_types == []


def test_build_summary_counts():
    rows = [
        {"risk_level": "HIGH", "was_rewritten": True,  "entity_types": ["BR_CPF", "BR_RG"]},
        {"risk_level": "HIGH", "was_rewritten": False, "entity_types": ["BR_CPF"]},
        {"risk_level": "LOW",  "was_rewritten": True,  "entity_types": ["EMAIL"]},
        {"risk_level": "NONE", "was_rewritten": False, "entity_types": []},
    ]
    result = _build_summary_from_rows(rows)
    assert result.total_events == 4
    assert result.high_risk_events == 2
    assert result.protected_count == 2
    assert result.protection_rate == 50.0
    assert result.top_entity_types[0]["type"] == "BR_CPF"
    assert result.top_entity_types[0]["count"] == 2
    assert result.unique_users == 0  # all user_id are None in test data


def test_build_summary_protection_rate_no_risk():
    rows = [{"risk_level": "NONE", "was_rewritten": False, "entity_types": []}]
    result = _build_summary_from_rows(rows)
    assert result.protection_rate == 0.0


def test_build_trend_groups_by_day():
    rows = [
        {"created_at": "2026-05-20T10:00:00+00:00", "risk_level": "HIGH"},
        {"created_at": "2026-05-20T14:00:00+00:00", "risk_level": "LOW"},
        {"created_at": "2026-05-21T09:00:00+00:00", "risk_level": "HIGH"},
    ]
    trend = _build_trend_from_rows(rows)
    days = {t["date"]: t for t in trend}
    assert days["2026-05-20"]["total"] == 2
    assert days["2026-05-20"]["high_risk"] == 1
    assert days["2026-05-21"]["total"] == 1


def test_build_trend_empty():
    trend = _build_trend_from_rows([])
    assert trend == []


from routes.admin.compliance import _build_event_row


def test_build_event_row_full():
    raw = {
        "id": "abc123", "user_id": "user-uuid", "risk_level": "HIGH",
        "entity_types": ["BR_CPF"], "entity_count": 1, "was_rewritten": True,
        "provider": "chatgpt", "endpoint": "/dlp/scan",
        "created_at": "2026-05-21T10:00:00+00:00", "event_type": "scan", "score": 0.95,
    }
    row = _build_event_row(raw)
    assert row["id"] == "abc123"
    assert row["user_id"] == "user-uuid"
    assert row["risk_level"] == "HIGH"
    assert row["entity_types"] == ["BR_CPF"]
    assert row["was_rewritten"] is True
    assert row["platform"] == "chatgpt"
    assert "created_at" in row


def test_build_event_row_null_user():
    raw = {"id": "x", "user_id": None, "risk_level": "NONE",
           "entity_types": [], "entity_count": 0, "was_rewritten": False,
           "provider": None, "endpoint": None,
           "created_at": "2026-05-21T00:00:00+00:00", "event_type": "scan", "score": None}
    row = _build_event_row(raw)
    assert row["user_id"] is None
    assert row["platform"] is None


def test_build_event_row_strips_internal_fields():
    raw = {"id": "x", "user_id": "u", "risk_level": "LOW",
           "entity_types": [], "entity_count": 0, "was_rewritten": False,
           "provider": None, "endpoint": None,
           "created_at": "2026-05-21T00:00:00+00:00", "event_type": "scan", "score": None,
           "payload_hash": "secret", "hashed_payload_id": "also-secret"}
    row = _build_event_row(raw)
    assert "payload_hash" not in row
    assert "hashed_payload_id" not in row


from routes.admin.compliance import _rows_to_csv


def test_rows_to_csv_header_and_row():
    rows = [
        {"id": "abc", "user_id": "u1", "risk_level": "HIGH",
         "entity_types": ["BR_CPF"], "entity_count": 1,
         "was_rewritten": True, "platform": "chatgpt",
         "created_at": "2026-05-21T10:00:00+00:00", "event_type": "scan", "score": 0.9},
    ]
    csv = _rows_to_csv(rows)
    lines = csv.strip().split("\n")
    assert lines[0].startswith("id,user_id,risk_level")
    assert "abc" in lines[1]
    assert "HIGH" in lines[1]
    assert "BR_CPF" in lines[1]


def test_rows_to_csv_empty():
    csv = _rows_to_csv([])
    assert "id,user_id" in csv
    lines = [l for l in csv.strip().split("\n") if l]
    assert len(lines) == 1
