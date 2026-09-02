"""
Os testes de `dlp/` são unitários e determinísticos. Vários exercitam o
**fallback mode** dos managers (RetentionManager, DeletionManager,
SupabaseTelemetryPersistence, ExportManager) — que só ativa quando NÃO há
credenciais de Supabase. No container de produção o `.env` está no ambiente,
então sem isto o fallback nunca ativa e os testes falham por ambiente.

Limpa as vars de Supabase para todo o pacote `dlp/`.
"""
import pytest

_SUPABASE_ENV = (
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
    "SUPABASE_KEY",
    "SUPABASE_DB_PASSWORD",
)


@pytest.fixture(autouse=True)
def _no_supabase_env(monkeypatch):
    for var in _SUPABASE_ENV:
        monkeypatch.delenv(var, raising=False)
    yield
