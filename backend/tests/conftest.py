"""
Fixtures compartilhados do harness do backend.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture(autouse=True)
def _reset_bff_session_state():
    """
    `services.session_store` cacheia `_table_ok` (probe da tabela bff_sessions) e
    mantém `_sessions_fallback` (dict in-memory) no nível do módulo. Sem reset, a
    ordem dos testes vaza estado. Zera antes e depois de cada teste.
    """
    def _reset():
        try:
            from services import session_store
            session_store.reset_for_tests()
        except Exception:
            pass
        try:
            from routes import bff_auth
            bff_auth._login_attempts.clear()
        except Exception:
            pass

    _reset()
    yield
    _reset()
