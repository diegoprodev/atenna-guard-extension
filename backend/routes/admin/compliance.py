import csv
import io
import logging
import os
from collections import Counter
from datetime import datetime, timezone, timedelta
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from middleware.admin_auth import require_super_admin

router = APIRouter()
logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "https://kezbssjmgwtrunqeoyir.supabase.co")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

RETENTION_DAYS = 90


def _svc() -> dict:
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    }


class ComplianceSummary(BaseModel):
    total_events: int
    high_risk_events: int
    protected_count: int
    protection_rate: float
    top_entity_types: list[dict]
    unique_users: int


class TrendPoint(BaseModel):
    date: str
    total: int
    high_risk: int


def _build_summary_from_rows(rows: list[dict]) -> ComplianceSummary:
    if not rows:
        return ComplianceSummary(
            total_events=0, high_risk_events=0, protected_count=0,
            protection_rate=0.0, top_entity_types=[], unique_users=0,
        )

    total = len(rows)
    high_risk = sum(1 for r in rows if r.get("risk_level") == "HIGH")
    protected = sum(1 for r in rows if r.get("was_rewritten"))
    protection_rate = round(protected / total * 100, 1) if total else 0.0

    entity_counter: Counter = Counter()
    for row in rows:
        for et in (row.get("entity_types") or []):
            entity_counter[et] += 1

    top_types = [{"type": k, "count": v} for k, v in entity_counter.most_common(10)]
    unique_users = len({r.get("user_id") for r in rows if r.get("user_id")})

    return ComplianceSummary(
        total_events=total,
        high_risk_events=high_risk,
        protected_count=protected,
        protection_rate=protection_rate,
        top_entity_types=top_types,
        unique_users=unique_users,
    )


def _build_trend_from_rows(rows: list[dict]) -> list[dict]:
    by_day: dict[str, dict] = {}
    for row in rows:
        created = row.get("created_at", "")
        day = created[:10] if created else "unknown"
        if day not in by_day:
            by_day[day] = {"total": 0, "high_risk": 0}
        by_day[day]["total"] += 1
        if row.get("risk_level") == "HIGH":
            by_day[day]["high_risk"] += 1
    return [{"date": d, **v} for d, v in sorted(by_day.items())]


@router.get("/compliance/summary")
async def compliance_summary(
    days: int = Query(30, ge=1, le=365),
    _admin: dict = Depends(require_super_admin),
) -> dict:
    if not SUPABASE_SERVICE_KEY:
        return {"error": "service_key_not_configured"}

    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    try:
        async with httpx.AsyncClient(timeout=10.0) as c:
            r = await c.get(
                f"{SUPABASE_URL}/rest/v1/dlp_events"
                f"?select=risk_level,was_rewritten,entity_types,created_at,user_id"
                f"&created_at=gte.{since}&order=created_at.asc&limit=10000",
                headers=_svc(),
            )
        rows = r.json() if r.is_success else []
    except Exception as exc:
        logger.warning("compliance: summary failed: %s", exc)
        return {"error": "unavailable", "summary": {}, "trend": []}

    summary = _build_summary_from_rows(rows)
    trend = _build_trend_from_rows(rows)

    return {
        "summary": summary.model_dump(),
        "trend": trend,
        "retention_days": RETENTION_DAYS,
        "period_days": days,
    }


_SAFE_FIELDS = (
    "id", "user_id", "risk_level", "entity_types", "entity_count",
    "was_rewritten", "provider", "endpoint", "created_at", "event_type", "score",
)


def _build_event_row(raw: dict) -> dict:
    row = {k: raw.get(k) for k in _SAFE_FIELDS}
    row["platform"] = raw.get("provider")
    return row


@router.get("/compliance/events")
async def compliance_events(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    days: int = Query(30, ge=1, le=365),
    risk_level: str = Query("", max_length=20),
    entity_type: str = Query("", max_length=50),
    user_id: str = Query("", max_length=100),
    was_rewritten: Optional[bool] = Query(None),
    _admin: dict = Depends(require_super_admin),
) -> dict:
    if not SUPABASE_SERVICE_KEY:
        return {"data": [], "total": 0, "error": "service_key_not_configured"}

    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    offset = (page - 1) * limit

    filters = f"&created_at=gte.{since}"
    if risk_level:
        filters += f"&risk_level=eq.{risk_level}"
    if entity_type:
        filters += f"&entity_types=cs.%7B{entity_type}%7D"
    if user_id:
        filters += f"&user_id=eq.{user_id}"
    if was_rewritten is not None:
        filters += f"&was_rewritten=is.{'true' if was_rewritten else 'false'}"

    try:
        async with httpx.AsyncClient(timeout=10.0) as c:
            r = await c.get(
                f"{SUPABASE_URL}/rest/v1/dlp_events"
                f"?select=id,user_id,risk_level,entity_types,entity_count,"
                f"was_rewritten,provider,endpoint,created_at,event_type,score"
                f"{filters}&order=created_at.desc&limit={limit}&offset={offset}",
                headers={**_svc(), "Prefer": "count=exact"},
            )
        total = int(r.headers.get("content-range", "0/0").split("/")[-1] or 0)
        rows = [_build_event_row(row) for row in (r.json() if r.is_success else [])]
    except Exception as exc:
        logger.warning("compliance: events failed: %s", exc)
        return {"data": [], "total": 0, "error": "unavailable"}

    return {"data": rows, "total": total, "page": page, "limit": limit}


_CSV_COLUMNS = [
    "id", "user_id", "risk_level", "entity_types", "entity_count",
    "was_rewritten", "platform", "created_at", "event_type", "score",
]


def _rows_to_csv(rows: list[dict]) -> str:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=_CSV_COLUMNS, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({
            **row,
            "entity_types": "|".join(row.get("entity_types") or []),
        })
    return buf.getvalue()


@router.get("/compliance/export.csv")
async def compliance_export_csv(
    days: int = Query(30, ge=1, le=365),
    risk_level: str = Query("", max_length=20),
    _admin: dict = Depends(require_super_admin),
) -> StreamingResponse:
    if not SUPABASE_SERVICE_KEY:
        return StreamingResponse(iter(["error,service_key_not_configured\n"]),
                                 media_type="text/csv")

    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    filters = f"&created_at=gte.{since}"
    if risk_level:
        filters += f"&risk_level=eq.{risk_level}"

    try:
        async with httpx.AsyncClient(timeout=15.0) as c:
            r = await c.get(
                f"{SUPABASE_URL}/rest/v1/dlp_events"
                f"?select=id,user_id,risk_level,entity_types,entity_count,"
                f"was_rewritten,provider,endpoint,created_at,event_type,score"
                f"{filters}&order=created_at.desc&limit=10000",
                headers=_svc(),
            )
        rows = [_build_event_row(row) for row in (r.json() if r.is_success else [])]
    except Exception as exc:
        logger.warning("compliance: export_csv failed: %s", exc)
        rows = []

    csv_content = _rows_to_csv(rows)
    filename = f"dlp-audit-{days}d.csv"
    return StreamingResponse(
        iter([csv_content]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
