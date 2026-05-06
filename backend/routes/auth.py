from fastapi import APIRouter, Query
from fastapi.responses import HTMLResponse

router = APIRouter(prefix="/auth", tags=["Auth"])


@router.get("/callback", response_class=HTMLResponse)
async def auth_callback(
    access_token: str = Query(None),
    refresh_token: str = Query(None),
    expires_in: str = Query(None),
    token_type: str = Query(None),
    error: str = Query(None),
    error_description: str = Query(None),
):
    """
    Callback do Supabase para email confirmation.
    Renderiza uma página que extrai tokens e tenta comunicar com a extensão.
    """
    if error:
        return f"""
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
            <meta charset="UTF-8">
            <title>Erro na confirmação</title>
            <style>
                body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f5f5f5; }}
                .container {{ background: white; border-radius: 12px; padding: 40px; text-align: center; max-width: 400px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }}
                h1 {{ color: #ef4444; margin-bottom: 16px; }}
                p {{ color: #666; margin-bottom: 24px; }}
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Erro na confirmação</h1>
                <p>{error}: {error_description or 'Erro desconhecido'}</p>
                <p style="font-size: 14px; color: #999;">Feche esta aba e tente novamente.</p>
            </div>
        </body>
        </html>
        """

    if not access_token:
        return """
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
            <meta charset="UTF-8">
            <title>Erro na confirmação</title>
            <style>
                body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f5f5f5; }}
                .container {{ background: white; border-radius: 12px; padding: 40px; text-align: center; max-width: 400px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }}
                h1 {{ color: #ef4444; margin-bottom: 16px; }}
                p {{ color: #666; margin-bottom: 24px; }}
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Erro na confirmação</h1>
                <p>Token não recebido do email. Tente novamente.</p>
                <p style="font-size: 14px; color: #999;">Feche esta aba e tente novamente.</p>
            </div>
        </body>
        </html>
        """

    return f"""
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Confirmando acesso…</title>
        <style>
            * {{ margin: 0; padding: 0; box-sizing: border-box; }}
            body {{
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            }}
            .container {{
                background: white;
                border-radius: 12px;
                padding: 40px;
                text-align: center;
                max-width: 400px;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            }}
            .spinner {{
                width: 40px;
                height: 40px;
                border: 3px solid #f0f0f0;
                border-top: 3px solid #22c55e;
                border-radius: 50%;
                animation: spin 1s linear infinite;
                margin: 0 auto 16px;
            }}
            @keyframes spin {{
                to {{ transform: rotate(360deg); }}
            }}
            h1 {{
                font-size: 24px;
                color: #111;
                margin-bottom: 8px;
            }}
            p {{
                color: #666;
                font-size: 14px;
                line-height: 1.5;
                margin-bottom: 16px;
            }}
            .countdown {{
                font-size: 12px;
                color: #999;
                margin-top: 16px;
            }}
            .success {{
                color: #22c55e;
            }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="spinner"></div>
            <h1>Acesso confirmado!</h1>
            <p>Seu login foi verificado com sucesso.</p>
            <p style="font-size: 13px; color: #666;">Você pode fechar esta aba e retornar à extensão.</p>
            <div class="countdown">Encerrando em <span id="countdown">5</span>s…</div>
        </div>

        <script>
            // Tentar comunicar com a extensão via postMessage
            if (window.opener) {{
                window.opener.postMessage({{
                    type: 'ATENNA_AUTH_SUCCESS',
                    access_token: '{access_token}',
                    refresh_token: '{refresh_token}',
                    expires_in: '{expires_in}',
                }}, '*');
            }}

            // Countdown e fechar
            let countdown = 5;
            const countdownEl = document.getElementById('countdown');
            const interval = setInterval(() => {{
                countdown--;
                countdownEl.textContent = String(Math.max(0, countdown));
                if (countdown <= 0) {{
                    clearInterval(interval);
                    window.close();
                }}
            }}, 1000);
        </script>
    </body>
    </html>
    """
