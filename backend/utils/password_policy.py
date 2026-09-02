import re

_RULES = [
    (lambda p: len(p) >= 12,                                     'Minimo 12 caracteres.'),
    (lambda p: bool(re.search(r'[A-Z]', p)),                     'Pelo menos uma letra maiuscula.'),
    (lambda p: bool(re.search(r'[a-z]', p)),                     'Pelo menos uma letra minuscula.'),
    (lambda p: bool(re.search(r'[0-9]', p)),                     'Pelo menos um digito.'),
    (lambda p: bool(re.search(r'[!@#$%^&*()\-_=+\[\]{};:,./<>?`~|]', p)),
                                                                  'Pelo menos um caractere especial.'),
]

def validate_admin_password(password: str) -> list:
    """Returns list of violation messages. Empty list means password is valid."""
    return [msg for check, msg in _RULES if not check(password)]
