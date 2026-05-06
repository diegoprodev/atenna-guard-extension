from fastapi import APIRouter, Query
from fastapi.responses import HTMLResponse

router = APIRouter(prefix="/auth", tags=["Auth"])


@router.get("/callback", response_class=HTMLResponse)
async def auth_callback():
    """
    Callback do Supabase para email confirmation.
    Supabase envia o token como hash fragment (#access_token=...),
    nunca como query param. A pagina usa JS para ler window.location.hash.
    """
    return """
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Confirmando acesso…</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            }
            .container {
                background: white;
                border-radius: 12px;
                padding: 40px;
                text-align: center;
                max-width: 400px;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            }
            .spinner {
                width: 40px;
                height: 40px;
                border: 3px solid #f0f0f0;
                border-top: 3px solid #22c55e;
                border-radius: 50%;
                animation: spin 1s linear infinite;
                margin: 0 auto 16px;
            }
            @keyframes spin { to { transform: rotate(360deg); } }
            h1 { font-size: 24px; color: #111; margin-bottom: 8px; }
            p { color: #666; font-size: 14px; line-height: 1.5; margin-bottom: 16px; }
            .countdown { font-size: 12px; color: #999; margin-top: 16px; }
            .error h1 { color: #ef4444; }
            .hidden { display: none; }
        </style>
    </head>
    <body>
        <div class="container">
            <div id="loading">
                <div class="spinner"></div>
                <h1>Verificando…</h1>
                <p>Processando sua confirmação de email.</p>
            </div>
            <div id="success" class="hidden">
                <div class="spinner"></div>
                <h1>Acesso confirmado!</h1>
                <p>Seu login foi verificado com sucesso.</p>
                <p style="font-size: 13px; color: #666;">Você pode fechar esta aba e retornar à extensão.</p>
                <div class="countdown">Encerrando em <span id="countdown">5</span>s…</div>
            </div>
            <div id="error" class="hidden error">
                <h1>Erro na confirmação</h1>
                <p id="error-msg">Tente novamente.</p>
                <p style="font-size: 14px; color: #999;">Feche esta aba e tente novamente.</p>
            </div>
        </div>

        <script>
            function showError(msg) {
                document.getElementById('loading').classList.add('hidden');
                document.getElementById('error').classList.remove('hidden');
                document.getElementById('error-msg').textContent = msg || 'Erro desconhecido';
            }

            function showSuccess(accessToken, refreshToken, expiresIn) {
                document.getElementById('loading').classList.add('hidden');
                document.getElementById('success').classList.remove('hidden');

                // Comunicar com a extensão via postMessage
                if (window.opener) {
                    window.opener.postMessage({
                        type: 'ATENNA_AUTH_SUCCESS',
                        access_token: accessToken,
                        refresh_token: refreshToken,
                        expires_in: expiresIn,
                    }, '*');
                }

                // Countdown e fechar
                let countdown = 5;
                const el = document.getElementById('countdown');
                const timer = setInterval(() => {
                    countdown--;
                    el.textContent = String(Math.max(0, countdown));
                    if (countdown <= 0) {
                        clearInterval(timer);
                        window.close();
                    }
                }, 1000);
            }

            // Supabase envia tokens como hash fragment: #access_token=...
            const hash = window.location.hash.substring(1);
            const params = new URLSearchParams(hash);

            const accessToken = params.get('access_token');
            const refreshToken = params.get('refresh_token');
            const expiresIn = params.get('expires_in');
            const error = params.get('error');
            const errorDesc = params.get('error_description');

            if (error) {
                showError(errorDesc || error);
            } else if (accessToken) {
                showSuccess(accessToken, refreshToken, expiresIn);
            } else {
                // Fallback: verificar query params (caso raro)
                const qp = new URLSearchParams(window.location.search);
                const qToken = qp.get('access_token');
                if (qToken) {
                    showSuccess(qToken, qp.get('refresh_token'), qp.get('expires_in'));
                } else {
                    showError('Token não recebido. Tente fazer login novamente.');
                }
            }
        </script>
    </body>
    </html>
    """
