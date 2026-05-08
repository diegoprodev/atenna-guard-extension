"""
FASE 4.1: Document Upload Routes
Handles: validation, extraction, DLP scan, rewrite
"""

from fastapi import APIRouter, UploadFile, HTTPException, Depends, Header
from fastapi.responses import JSONResponse
import io
import hashlib
import json
from typing import Optional

from middleware.auth import require_auth
from dlp import engine

router = APIRouter(prefix="/user/upload-document", tags=["documents"])

# Supported file types and max sizes (in bytes)
SUPPORTED_TYPES = {
    'txt': {'mime': 'text/plain', 'max_size': 1024 * 1024},      # 1 MB
    'md': {'mime': 'text/markdown', 'max_size': 1024 * 1024},    # 1 MB
    'csv': {'mime': 'text/csv', 'max_size': 5 * 1024 * 1024},    # 5 MB
    'json': {'mime': 'application/json', 'max_size': 1024 * 1024},  # 1 MB
}

MAX_CHARS = 100_000
SCAN_TIMEOUT = 10  # seconds


def validate_file(filename: str, file_size: int) -> tuple[bool, str, Optional[str]]:
    """
    Validate file extension, MIME type, and size.
    Returns: (valid, error_message, file_type)
    """
    if not filename:
        return False, "Arquivo inválido", None

    ext = filename.split('.')[-1].lower()
    if ext not in SUPPORTED_TYPES:
        return False, f"Tipo de arquivo não suportado. Suportamos: TXT, MD, CSV, JSON", None

    config = SUPPORTED_TYPES[ext]
    if file_size > config['max_size']:
        max_mb = config['max_size'] / (1024 * 1024)
        file_mb = file_size / (1024 * 1024)
        return False, f"Arquivo muito grande (máximo: {max_mb} MB, seu arquivo: {file_mb:.1f} MB)", ext

    return True, "", ext


def is_valid_utf8(data: bytes) -> bool:
    """Check if data is valid UTF-8."""
    try:
        data.decode('utf-8')
        return True
    except UnicodeDecodeError:
        return False


def extract_content(raw: str, file_type: str) -> str:
    """Extract and normalize content from different file types."""
    # Remove control characters and normalize whitespace
    content = raw
    # Remove null bytes and other control chars except common whitespace
    content = ''.join(char for char in content if ord(char) >= 32 or char in '\t\n\r')

    # Remove BOM if present
    if content.startswith('﻿'):
        content = content[1:]

    # Normalize multiple newlines
    content = '\n'.join(line.rstrip() for line in content.split('\n'))

    # Normalize JSON if applicable
    if file_type == 'json':
        try:
            parsed = json.loads(content)
            content = json.dumps(parsed, ensure_ascii=False, indent=2)
        except json.JSONDecodeError:
            # Keep original if not valid JSON
            pass

    # Normalize Markdown — compress extra blank lines
    if file_type == 'md':
        lines = content.split('\n')
        normalized = []
        prev_blank = False
        for line in lines:
            is_blank = not line.strip()
            if is_blank and prev_blank:
                continue  # Skip consecutive blank lines
            normalized.append(line)
            prev_blank = is_blank
        content = '\n'.join(normalized)

    return content.strip()


async def hash_content(content: str) -> str:
    """Create a hash of the content for audit purposes."""
    return hashlib.sha256(content.encode('utf-8')).hexdigest()


@router.post("")
async def upload_document(
    file: UploadFile,
    session_id: str = Header(...),
    _user: dict = Depends(require_auth),
):
    """
    Upload and scan document.

    Returns: { success, dlp_risk_level, entity_count, entity_types, preview, char_count, hash }

    Guarantees:
    - File never persisted to disk
    - Content never persisted to DB (only hash for audit)
    - Memory cleaned after response
    """
    user_id = _user.get("sub")

    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="Arquivo inválido")

    # Read file into memory
    try:
        file_data = await file.read()
    except Exception:
        raise HTTPException(status_code=400, detail="Falha ao ler arquivo")

    # Step 1: Validate file
    valid, error, file_type = validate_file(file.filename, len(file_data))
    if not valid:
        raise HTTPException(status_code=400, detail=error)

    # Step 2: Validate encoding
    if not is_valid_utf8(file_data):
        raise HTTPException(status_code=400, detail="Arquivo corrompido ou encoding não suportado. Suportamos UTF-8, ASCII, Latin-1")

    # Step 3: Extract content safely (memory only)
    try:
        raw_text = file_data.decode('utf-8')
        content = extract_content(raw_text, file_type)
    except Exception:
        raise HTTPException(status_code=400, detail="Falha ao extrair arquivo")

    # Validate size after extraction
    if len(content) > MAX_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"Arquivo muito grande ({len(content)} chars > {MAX_CHARS})"
        )

    # Step 4: DLP scan
    try:
        dlp_analysis = await engine.analyze(content, session_id=session_id)
    except Exception as e:
        dlp_analysis = None
        # If DLP fails, return UNKNOWN risk (safe default)
        dlp_risk = "UNKNOWN"
        entity_count = 0
        entity_types = []

    if dlp_analysis:
        dlp_risk = dlp_analysis.risk_level
        entity_count = len(dlp_analysis.entities)
        entity_types = list(set(e.type for e in dlp_analysis.entities))
    else:
        dlp_risk = "UNKNOWN"
        entity_count = 0
        entity_types = []

    # Step 5: Create safe preview (first 500 chars)
    preview = content[:500]

    # Step 6: Generate content hash for audit (no content persisted)
    content_hash = await hash_content(content)

    # Step 7: Log telemetry (no content)
    print(json.dumps({
        "event": "document_upload_success",
        "user_id": user_id,
        "session_id": session_id,
        "file_type": file_type,
        "file_size": len(file_data),
        "char_count": len(content),
        "dlp_risk_level": dlp_risk,
        "entity_count": entity_count,
        "entity_types": entity_types,
    }), flush=True)

    # Step 8: Prepare response
    response_data = {
        "success": True,
        "dlpRiskLevel": dlp_risk,
        "entityCount": entity_count,
        "entityTypes": entity_types,
        "contentPreview": preview,
        "contentHash": content_hash,
        "charCount": len(content),
    }

    # Step 9: Cleanup — delete content from memory
    del file_data
    del raw_text
    del content
    del dlp_analysis

    return JSONResponse(content=response_data, status_code=200)


@router.post("/rewrite")
async def rewrite_document(
    request_body: dict,
    session_id: str = Header(...),
    _user: dict = Depends(require_auth),
):
    """
    User chose to protect or send original.

    Request: { content_hash, action: "protect" | "send_original" }

    This is a placeholder — the actual rewrite should happen on the frontend
    since we don't persist content on the backend.
    """
    user_id = _user.get("sub")
    action = request_body.get("action", "send_original")

    print(json.dumps({
        "event": "document_user_choice",
        "user_id": user_id,
        "session_id": session_id,
        "action": action,
    }), flush=True)

    return JSONResponse(content={"success": True, "action": action}, status_code=200)
