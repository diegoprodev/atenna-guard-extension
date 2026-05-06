import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(tags=["Analytics"])

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")


class AnalyticsEvent(BaseModel):
    event: str
    user_id: str
    timestamp: int
    session_id: str
    extension_version: str
    plan: str
    prompt_type: Optional[str] = None
    origin: Optional[str] = None
    input_length: Optional[int] = None
    output_length: Optional[int] = None
    latency_ms: Optional[int] = None
    error: Optional[str] = None


@router.post("/track")
async def track_event(payload: dict[str, Any]):
    """
    Recebe eventos de uso da extensão e grava em Supabase (com fallback para JSONL).
    Frontend envia: { event, user_id, timestamp, session_id, extension_version, plan, ...opcional }
    """
    log_dir = Path(__file__).parent.parent / "data"
    log_dir.mkdir(exist_ok=True)

    event_name = payload.get("event", "unknown")
    user_id = payload.get("user_id", "anonymous")
    session_id = payload.get("session_id", "")
    timestamp = payload.get("timestamp", int(datetime.utcnow().timestamp() * 1000))
    extension_version = payload.get("extension_version", "unknown")
    plan = payload.get("plan", "free")

    # Separar event_payload (campos opcionais)
    event_payload = {k: v for k, v in payload.items() if k not in [
        "event", "user_id", "timestamp", "session_id", "extension_version", "plan"
    ]}

    # Tentar enviar para Supabase
    if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.post(
                    f"{SUPABASE_URL}/rest/v1/analytics_events",
                    headers={
                        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                        "Content-Type": "application/json",
                        "Prefer": "return=minimal",
                    },
                    json={
                        "event_name": event_name,
                        "user_id": user_id,
                        "session_id": session_id,
                        "timestamp": timestamp,
                        "extension_version": extension_version,
                        "plan": plan,
                        "event_payload": event_payload,
                    },
                )
                if response.status_code in (200, 201):
                    return {"ok": True, "source": "supabase"}
        except Exception as e:
            print(f"[Analytics] Falha ao enviar para Supabase: {e}")

    # Fallback: gravar em JSONL
    entry = {
        "event_name": event_name,
        "user_id": user_id,
        "session_id": session_id,
        "timestamp": timestamp,
        "extension_version": extension_version,
        "plan": plan,
        "event_payload": event_payload,
        "server_ts": datetime.utcnow().isoformat(),
    }

    with open(log_dir / "events.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    return {"ok": True, "source": "jsonl"}
