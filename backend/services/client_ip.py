"""
IP real do cliente — FONTE ÚNICA.

FASE P-ZT.4. O uvicorn roda SEM `--proxy-headers` (atrás do nginx em
127.0.0.1:8000), então `request.client.host` é o IP do CONTAINER do nginx,
não do usuário. O IP real vem dos headers que o nginx injeta:

    proxy_set_header X-Real-IP        $remote_addr;   # << o nginx SOBRESCREVE
    proxy_set_header X-Forwarded-For  $proxy_add_x_forwarded_for;

e `$remote_addr` já é o IP real porque o nginx tem
`real_ip_header CF-Connecting-IP` + `set_real_ip_from <faixas Cloudflare>`.

ZERO-TRUST: o cliente NÃO consegue forjar `X-Real-IP` — o `proxy_set_header`
do nginx troca qualquer valor que o cliente mande pelo `$remote_addr`. O
backend confia nele porque só o nginx fala com o uvicorn. (Pré-req duro pra
valer de verdade: a origem só pode aceitar tráfego da Cloudflare no 443 —
senão dá pra bater direto e forjar o `CF-Connecting-IP`. Ver P7.3.)
"""
from __future__ import annotations

import ipaddress


def get_client_ip(request) -> str:
    """IP real do cliente. Nunca lança."""
    xri = request.headers.get("x-real-ip")
    if xri and xri.strip():
        return xri.strip()

    xff = request.headers.get("x-forwarded-for")
    if xff:
        first = xff.split(",")[0].strip()
        if first:
            return first

    try:
        return request.client.host or "?"
    except Exception:
        return "?"


def ip_key(ip: str) -> str:
    """
    Chave de comparação estável do IP. IPv4 = o endereço. IPv6 = o prefixo /64
    (em muitas redes o host-part do IPv6 roda a cada request — comparar o
    endereço inteiro daria falso-positivo de 'IP diferente' pro mesmo usuário).
    """
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return ip
    if addr.version == 6:
        net = ipaddress.ip_network(f"{ip}/64", strict=False)
        return str(net.network_address)
    return str(addr)


def mask_ip(ip: str) -> str:
    """Mascara pro cliente: 186.204.19.42 -> 186.xxx.xxx.42 · IPv6 -> prefixo/64."""
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return "?"
    if addr.version == 4:
        parts = ip.split(".")
        return f"{parts[0]}.xxx.xxx.{parts[3]}"
    return f"{ip_key(ip)}/64"
