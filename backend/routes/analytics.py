import json
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(tags=["Analytics"])


class AnalyticsEvent(BaseModel):
    event:       str
    user_id:     str
    timestamp:   int
    prompt_type: Optional[str] = None
    origin:      Optional[str] = None


@router.post("/track")
async def track_event(event: AnalyticsEvent):
    """
    Recebe eventos de uso da extensão e grava em JSONL local.
    Em produção: substituir por Supabase, Mixpanel, ou equivalente.
    """
    log_dir = Path(__file__).parent.parent / "data"
    log_dir.mkdir(exist_ok=True)

    entry = {
        **event.model_dump(),
        "server_ts": datetime.utcnow().isoformat(),
    }

    with open(log_dir / "events.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    return {"ok": True}
