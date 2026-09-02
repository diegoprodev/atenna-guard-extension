"""
TXT/CSV Redactor — FASE 4.7
Substituição direta usando o masked_content do DLP scanner.
"""
from __future__ import annotations


def redact_text(masked_content: str) -> bytes:
    return masked_content.encode("utf-8")
