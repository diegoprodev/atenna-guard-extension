from pydantic import BaseModel
from typing import Optional


class DlpMetadataRequest(BaseModel):
    dlp_enabled: bool = False
    dlp_risk_level: str = "NONE"
    dlp_entity_types: list[str] = []
    dlp_entity_count: int = 0
    dlp_was_rewritten: bool = False
    dlp_user_override: bool = False
    dlp_client_score: int = 0


class PromptRequest(BaseModel):
    input: str
    dlp: Optional[DlpMetadataRequest] = None


class PromptResponse(BaseModel):
    direct: str
    technical: str
    structured: str
    direct_preview: str = ''
    technical_preview: str = ''
    structured_preview: str = ''
