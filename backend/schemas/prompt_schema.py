from pydantic import BaseModel


class PromptRequest(BaseModel):
    input: str


class PromptResponse(BaseModel):
    direct: str
    technical: str
    structured: str
