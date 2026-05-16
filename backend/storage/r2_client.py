"""
CF R2 Storage Client — S3-compatible via boto3.
Usado para upload temporário de arquivos grandes (>10MB).
Arquivos são deletados após parse ou após TTL do lifecycle rule.

Env vars necessárias:
  R2_ACCOUNT_ID        — Cloudflare account ID (hex)
  R2_BUCKET            — nome do bucket (atenna-plugin)
  R2_ACCESS_KEY_ID     — chave S3 do token R2
  R2_SECRET_ACCESS_KEY — secret do token R2
"""
from __future__ import annotations

import os
import uuid
from datetime import timedelta
from typing import Any

import boto3  # type: ignore
from botocore.config import Config  # type: ignore

_ACCOUNT_ID  = os.getenv("R2_ACCOUNT_ID", "")
_BUCKET      = os.getenv("R2_BUCKET", "atenna-plugin")
_ACCESS_KEY  = os.getenv("R2_ACCESS_KEY_ID", "")
_SECRET_KEY  = os.getenv("R2_SECRET_ACCESS_KEY", "")
_ENDPOINT    = f"https://{_ACCOUNT_ID}.r2.cloudflarestorage.com" if _ACCOUNT_ID else ""

_PRESIGN_TTL_SECONDS = 300   # 5 min para o cliente fazer o upload
_OBJECT_PREFIX       = "uploads/"


def _client() -> Any:
    if not all([_ACCOUNT_ID, _ACCESS_KEY, _SECRET_KEY]):
        raise RuntimeError("R2 credentials not configured (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)")
    return boto3.client(
        "s3",
        endpoint_url=_ENDPOINT,
        aws_access_key_id=_ACCESS_KEY,
        aws_secret_access_key=_SECRET_KEY,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def generate_upload_url(user_id: str, filename: str, content_type: str) -> dict[str, str]:
    """
    Gera presigned PUT URL para upload direto do browser para o R2.
    O objeto é criado com TTL automático via lifecycle rule (1 day).
    Retorna {url, key, expires_in}.
    """
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
    key = f"{_OBJECT_PREFIX}{user_id}/{uuid.uuid4().hex}.{ext}"

    s3 = _client()
    url = s3.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": _BUCKET,
            "Key": key,
            "ContentType": content_type,
        },
        ExpiresIn=_PRESIGN_TTL_SECONDS,
    )
    return {"upload_url": url, "key": key, "expires_in": _PRESIGN_TTL_SECONDS}


def download_for_parse(key: str) -> bytes:
    """
    Baixa objeto do R2 para parse no VPS.
    Deve ser chamado apenas pelo worker de parse, nunca pela rota HTTP.
    """
    s3 = _client()
    resp = s3.get_object(Bucket=_BUCKET, Key=key)
    return resp["Body"].read()


def delete_object(key: str) -> None:
    """
    Deleta objeto após parse bem-sucedido.
    Lifecycle rule é o fallback caso o delete falhe.
    """
    try:
        _client().delete_object(Bucket=_BUCKET, Key=key)
    except Exception:
        pass  # lifecycle rule garante cleanup em 1 dia


def is_configured() -> bool:
    return bool(_ACCOUNT_ID and _ACCESS_KEY and _SECRET_KEY)
