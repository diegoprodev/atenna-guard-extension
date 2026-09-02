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
    `routes.bff_auth` cacheia `_table_ok` (probe da tabela bff_sessions) e mantém
    `_sessions_fallback` (dict in-memory) no nível do módulo. Sem reset, a ordem
    dos testes vaza estado: um teste que cai no fallback deixa `_table_ok=False`
    para todos os seguintes. Zera antes de cada teste.
    """
    try:
        from routes import bff_auth
        bff_auth._table_ok = None
        bff_auth._sessions_fallback.clear()
        bff_auth._login_attempts.clear()
    except Exception:
        pass
    yield
    try:
        from routes import bff_auth
        bff_auth._table_ok = None
        bff_auth._sessions_fallback.clear()
    except Exception:
        pass
