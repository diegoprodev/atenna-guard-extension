# 🔴 BACKEND FIXES REQUIRED

## PROBLEMA 1: Endpoint `/auth/google` NÃO EXISTE

**Erro:** `POST https://atennaplugin.maestro-n8n.site/auth/google` retorna **404**

**Motivo:** O backend (`routes/bff_auth.py`) não tem esse endpoint registrado.

**Endpoints que existem:**
- ✅ POST /auth/login
- ✅ POST /auth/refresh
- ✅ POST /auth/logout
- ✅ POST /auth/reset-password
- ❌ POST /auth/google — **MISSING!**

---

## SOLUÇÃO: Adicionar Endpoint `/auth/google`

**Arquivo:** `/root/atenna-backend/routes/bff_auth.py`

**Localization:** Adicione APÓS a função `login()` (depois de `@router.post("/login")`)

**Código a adicionar:**

```python
class GoogleAuthRequest(BaseModel):
    code: str
    redirect_uri: str

@router.post("/google")
async def google_auth(req: GoogleAuthRequest):
    """
    Google OAuth callback handler.
    Exchanges authorization code for Supabase JWT + session.
    """
    try:
        client = get_admin_client()
        # Exchange Google code for Supabase token
        r = client.auth.exchange_code_for_session({
            "provider": "google",
            "code": req.code,
            "code_verifier": None  # Not needed for authorization code flow
        })
    except Exception as e:
        logger.error(f"Google OAuth error: {e}")
        record_auth_failure(ip="server", user_id="google")
        raise HTTPException(401, "Google authentication failed")
    
    if not r or not r.session:
        logger.error("No session returned from Supabase Google auth")
        record_auth_failure(ip="server", user_id="google")
        raise HTTPException(401, "Authentication failed")
    
    jwt = r.session.access_token
    refresh_tok = r.session.refresh_token
    uid = r.user.id
    email = r.user.email
    plan = _get_plan(uid)
    
    log_security_event("google_login_success", {"user_id": str(uid)}, severity="LOW")
    return _issue_token(jwt, refresh_tok, uid, email, plan)
```

**Passo 1:** Conecte via SSH ao VPS
```bash
ssh -i C:\Users\dgapc\.ssh\ATENNAPLUGIN-DEPLOY root@157.90.246.156
cd /root/atenna-backend
```

**Passo 2:** Edite o arquivo
```bash
# Faça backup
cp routes/bff_auth.py routes/bff_auth.py.backup

# Adicione o código acima
nano routes/bff_auth.py
```

**Passo 3:** Reinicie o backend
```bash
docker compose restart backend
```

**Passo 4:** Verifique os logs
```bash
docker compose logs -f backend --tail=50
```

---

## PROBLEMA 2: Erro 500 em `/auth/login`

**Erro:** `POST /auth/login` retorna **500 Internal Server Error**

**Possíveis causas:**
1. Supabase não está respondendo
2. Database `bff_sessions` não foi criada
3. Erro no processamento da senha

**Verificação:**

```bash
# SSH para VPS
ssh -i C:\Users\dgapc\.ssh\ATENNAPLUGIN-DEPLOY root@157.90.246.156

# Verifique os logs do backend
cd /root/atenna-backend && docker compose logs backend --tail=100 | grep -A5 "500\|error\|login"
```

**Se a tabela `bff_sessions` não existe:**

Execute em Supabase SQL Editor:
```sql
CREATE TABLE IF NOT EXISTS bff_sessions (
  token TEXT PRIMARY KEY,
  supabase_jwt TEXT NOT NULL DEFAULT '',
  refresh_token TEXT NOT NULL DEFAULT '',
  user_id UUID NOT NULL,
  email TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  role TEXT,
  expires_at BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bff_sessions_expires ON bff_sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_bff_sessions_user_id ON bff_sessions (user_id);
ALTER TABLE bff_sessions ENABLE ROW LEVEL SECURITY;
```

---

## PROBLEMA 3: Reset de Senha Não Chegando

**Erro:** Usuário clica em "Redefinir senha", vê tooltip de sucesso, mas email não chega.

**Possíveis causas:**
1. Resend API key não está configurada
2. Email template está incorreto
3. Endpoint `/auth/reset-password` tem erro

**Verificação:**

1. **Verifique a variável de ambiente:**
```bash
ssh -i C:\Users\dgapc\.ssh\ATENNAPLUGIN-DEPLOY root@157.90.246.156
cd /root/atenna-backend && grep RESEND .env
```

Deve ser algo como:
```
RESEND_API_KEY=re_xxx...
```

2. **Verifique os logs:**
```bash
docker compose logs backend --tail=50 | grep -i resend
```

3. **Se faltar a chave Resend:**
- Vá para https://resend.com/api-keys
- Crie uma chave API
- SSH para VPS e adicione ao `.env`:

```bash
ssh -i C:\Users\dgapc\.ssh\ATENNAPLUGIN-DEPLOY root@157.90.246.156
cd /root/atenna-backend

# Edite o .env
nano .env

# Adicione ou atualize:
RESEND_API_KEY=re_sua_chave_aqui

# Reinicie
docker compose restart backend
```

---

## CHECKLIST

- [ ] Adicionado endpoint `/auth/google` em `routes/bff_auth.py`
- [ ] Backend reiniciado com sucesso
- [ ] Tabela `bff_sessions` criada no Supabase
- [ ] Resend API key configurada no `.env`
- [ ] Login com email/senha funcionando (teste no Chrome)
- [ ] Login com Google funcionando (teste no Chrome)
- [ ] Reset de senha enviando email (teste no Resend dashboard)

---

**Próximos passos:**
1. Faça os 3 fixes acima
2. Reinicie o backend
3. Teste novamente na extensão
4. Se continuar erro, colete os logs e compartilhe comigo
