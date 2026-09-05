"""
FASE 10.9.6 — achado real do dono: modal demora ~3s só pra ABRIR (antes de
qualquer geração). Causa raiz: GET /auth/me fazia 3 chamadas ao Supabase em
SÉRIE (resolve_token → _get_plan → onboarding_seen) — cada uma um round trip
de rede bloqueante (supabase-py é síncrono), e a 2ª e a 3ª não dependem uma
da outra, só do user_id que a 1ª resolve.

Este teste prova que _get_plan e _get_onboarding_seen agora rodam em
PARALELO (via asyncio.to_thread + gather): com um delay artificial de 200ms
em cada uma, o tempo total tem que ficar perto de UM delay (paralelo), não
da SOMA dos dois (serial) — falha antes do fix, passa depois.
"""
import time
from types import SimpleNamespace
from unittest.mock import patch

import pytest

import routes.bff_auth as bff_auth


def _fake_resolve_token(_token):
    return {"user_id": "u1", "email": "a@b.com", "expires_at": 9999999999}


def _slow_get_plan(_user_id):
    time.sleep(0.2)
    return "pro"


def _slow_get_onboarding_seen(_user_id):
    time.sleep(0.2)
    return True


@pytest.mark.asyncio
async def test_me_runs_plan_and_onboarding_lookups_in_parallel():
    creds = SimpleNamespace(credentials="opaque-fake-token")

    with patch.object(bff_auth, "resolve_token", _fake_resolve_token), \
         patch.object(bff_auth, "_get_plan", _slow_get_plan), \
         patch.object(bff_auth, "_get_onboarding_seen", _slow_get_onboarding_seen):

        t0 = time.monotonic()
        result = await bff_auth.me(creds=creds)
        elapsed = time.monotonic() - t0

    assert result["plan"] == "pro"
    assert result["onboarding_seen"] is True
    # Serial seria ~0.4s (0.2 + 0.2). Paralelo fica perto de ~0.2s. Corte no
    # meio do caminho (0.32s) separa claramente os dois cenários com folga
    # de timing de CI.
    assert elapsed < 0.32, (
        f"levou {elapsed:.3f}s — parece SERIAL (esperado ~0.2s em paralelo, "
        "não ~0.4s somado)"
    )
