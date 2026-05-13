"""
Outbound Security — FASE 4.2A
Adaptado de bff/app/security/outbound.py (PPSI v2.0 §VI-4.6).

Allowlist explícita de hosts LLM autorizados.
assert_safe_llm_url() deve ser chamada ANTES de qualquer httpx request
para provider externo. Nunca aceitar URL dinâmica de usuário.
"""
from __future__ import annotations

from urllib.parse import urlparse

# Hosts autorizados para chamadas LLM.
# Adicionar novo host apenas com aprovação explícita.
ALLOWED_LLM_HOSTS: frozenset[str] = frozenset({
    "generativelanguage.googleapis.com",  # Gemini
    "api.openai.com",                     # OpenAI / gpt-4.1-nano
    "api.anthropic.com",                  # Anthropic (futuro)
})


def assert_safe_llm_url(url: str) -> None:
    """
    Valida que a URL está na allowlist de providers autorizados.

    Lança ValueError se:
    - URL não é HTTPS
    - Hostname não está na allowlist
    - URL vazia ou malformada

    Deve ser chamada antes de qualquer httpx.AsyncClient request para provider.
    Nunca passar URL recebida de usuário diretamente.
    """
    if not url or not url.strip():
        raise ValueError("URL do provider não pode ser vazia.")

    try:
        parsed = urlparse(url)
    except Exception as exc:
        raise ValueError(f"URL malformada: {url!r}") from exc

    if parsed.scheme != "https":
        raise ValueError(
            f"Provider URL deve usar HTTPS. Recebido: {parsed.scheme!r} em {url!r}"
        )

    host = parsed.hostname or ""
    if host not in ALLOWED_LLM_HOSTS:
        raise ValueError(
            f"Provider host não autorizado: {host!r}. "
            f"Hosts permitidos: {sorted(ALLOWED_LLM_HOSTS)}"
        )


def is_safe_llm_url(url: str) -> bool:
    """Versão booleana de assert_safe_llm_url — para uso em checks não-críticos."""
    try:
        assert_safe_llm_url(url)
        return True
    except ValueError:
        return False
