# Admin Password Policy — Regras de Implementação

## Regras (super_admin)
- Mínimo **12 caracteres**
- Pelo menos **1 maiúscula** (A-Z)
- Pelo menos **1 minúscula** (a-z)
- Pelo menos **1 dígito** (0-9)
- Pelo menos **1 caractere especial** (!@#$%^&*...)

## Onde aplicar

### 1. Supabase Dashboard (configuração manual única)
Authentication → Policies → "Password strength"
- Minimum password length: **12**

### 2. Migration SQL (já criada)
`supabase/migrations/20260514_admin_password_policy.sql`
- Função `private.validate_admin_password(TEXT)` — validação server-side
- Trigger `trg_admin_password_audit` — audita toda troca de senha de super_admin

### 3. Backend — adicionar em `/root/atenna-backend/utils/password_policy.py`
```python
import re

PASSWORD_RULES = [
    (lambda p: len(p) >= 12,        "Senha deve ter no mínimo 12 caracteres."),
    (lambda p: bool(re.search(r'[A-Z]', p)), "Deve conter pelo menos uma letra maiúscula."),
    (lambda p: bool(re.search(r'[a-z]', p)), "Deve conter pelo menos uma letra minúscula."),
    (lambda p: bool(re.search(r'[0-9]', p)), "Deve conter pelo menos um dígito."),
    (lambda p: bool(re.search(r'[!@#$%^&*()\-_=+\[\]{};:\'",.<>/?`~|\\]', p)),
               "Deve conter pelo menos um caractere especial."),
]

def validate_admin_password(password: str) -> list[str]:
    """Returns list of violations. Empty list = valid."""
    return [msg for check, msg in PASSWORD_RULES if not check(password)]
```

### 4. Usar no route de reset de senha (quando implementado)
```python
from utils.password_policy import validate_admin_password

violations = validate_admin_password(new_password)
if violations:
    raise HTTPException(status_code=422, detail={"violations": violations})
```
