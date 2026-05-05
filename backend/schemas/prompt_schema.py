from pydantic import BaseModel


class PromptRequest(BaseModel):
    input: str


class PromptResponse(BaseModel):
    direct: str
    technical: str
    structured: str
    direct_preview: str = ''
    technical_preview: str = ''
    structured_preview: str = ''
