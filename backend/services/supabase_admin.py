import os
from supabase import create_client, Client

_client: Client | None = None


def get_admin_client() -> Client:
    """
    Cliente service-role persistente — SÓ para queries de DB (bypassa RLS).

    NUNCA usar para auth (sign_in_with_password / refresh_session / exchange_code):
    essas operações trocam o Authorization do cliente pelo JWT do usuário, o que faz
    as queries seguintes baterem em RLS. Para auth, use get_auth_client(). (FASE 9.0)
    """
    global _client
    if _client is None:
        url = os.environ["SUPABASE_URL"]
        key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        _client = create_client(url, key)
    return _client


def get_auth_client() -> Client:
    """
    Cliente novo (anon key) para operações de autenticação de usuário.
    Descartável — não compartilha estado com o cliente de DB.
    """
    return create_client(
        os.environ["SUPABASE_URL"],
        os.environ.get("SUPABASE_ANON_KEY") or os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )
