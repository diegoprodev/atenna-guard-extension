"""
FASE P-ZT.4 — get_client_ip: fonte única do IP real. Teste de bypass
("nunca confiar no front"): o cliente não pode escolher o próprio IP.
"""
import re

from services.request_ip import get_client_ip, ip_key, mask_ip


class _Req:
    def __init__(self, headers: dict, client_host: str | None = None):
        self.headers = {k.lower(): v for k, v in headers.items()}
        self.client = type("C", (), {"host": client_host})() if client_host else None


def test_uses_x_real_ip_when_present():
    # em produção quem seta X-Real-IP é o nginx (proxy_set_header X-Real-IP
    # $remote_addr SOBRESCREVE qualquer valor do cliente)
    r = _Req({"X-Real-IP": "186.204.19.42", "X-Forwarded-For": "1.2.3.4"}, client_host="10.0.0.5")
    assert get_client_ip(r) == "186.204.19.42"


def test_falls_back_to_first_xff_entry():
    r = _Req({"X-Forwarded-For": "203.0.113.7, 70.41.3.18, 150.172.238.178"}, client_host="10.0.0.5")
    assert get_client_ip(r) == "203.0.113.7"


def test_falls_back_to_request_client_host():
    r = _Req({}, client_host="198.51.100.23")
    assert get_client_ip(r) == "198.51.100.23"


def test_never_raises_with_nothing():
    assert get_client_ip(_Req({})) == "?"


def test_ip_key_collapses_ipv6_to_64_prefix():
    a = ip_key("2804:14d:5c3a:8a00:1111:2222:3333:4444")
    b = ip_key("2804:14d:5c3a:8a00:9999:8888:7777:6666")
    assert a == b  # mesmo /64 -> mesma chave (host-part do IPv6 muda por request)
    assert ip_key("186.204.19.42") == "186.204.19.42"  # IPv4 inteiro


def test_mask_ip_hides_middle_octets():
    masked = mask_ip("186.204.19.42")
    assert masked == "186.xxx.xxx.42"
    # nenhum IPv4 inteiro sobra na string mascarada
    assert not re.search(r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b", masked)
