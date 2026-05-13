"""
FASE 4.2C — Adversarial File Generators
Gera arquivos adversariais em memória para stress/hardening tests.

Nunca persiste no disco — retorna bytes direto para os testes.
Cobre todos os vetores identificados na MATRIZ DE LIMITES seção 3.

Vetores cobertos:
- partially_corrupt_pdf: PDF com bytes corrompidos no meio
- truncated_pdf: PDF cortado antes do %%EOF
- hybrid_pdf: começa com %PDF mas contém dados binários aleatórios
- encrypted_malformed: PDF que declara ser encrypted mas está corrompido
- xml_nesting_docx: DOCX com XML profundamente aninhado
- fake_mime_pdf: extensão .pdf com bytes de outro formato
- fake_mime_docx: extensão .docx com bytes de outro formato
- giant_metadata_pdf: PDF com objetos de metadata gigantes
- embedded_payload_docx: DOCX com dados extras embutidos fora do XML
- recursive_reference: PDF com referências de objetos circulares (simulado)
- zero_pages_pdf: PDF declarando 0 páginas
- negative_size_docx: ZIP com file_size negativo na metadata
- null_bytes_pdf: PDF com blocos de null bytes entre conteúdo válido
- oversized_object_pdf: PDF com um único objeto texto de 600KB
- unicode_bomb: texto com Unicode exploitation patterns
"""
from __future__ import annotations

import io
import struct
import zipfile
import random


def partially_corrupt_pdf() -> bytes:
    """PDF válido com 30% dos bytes corrompidos no meio do stream."""
    base = (
        b"%PDF-1.4\n"
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n"
        b"xref\n0 4\n"
        b"0000000000 65535 f\n"
        b"0000000009 00000 n\n"
        b"0000000058 00000 n\n"
        b"0000000115 00000 n\n"
        b"trailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF"
    )
    data = bytearray(base)
    # Corromper bytes no meio (não no header nem no footer)
    mid = len(data) // 2
    for i in range(mid - 20, mid + 20):
        if i < len(data):
            data[i] = random.randint(0x00, 0xFF)
    return bytes(data)


def truncated_pdf() -> bytes:
    """PDF cortado na metade — sem %%EOF."""
    full = (
        b"%PDF-1.4\n"
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/Me"  # truncado aqui
    )
    return full


def hybrid_pdf() -> bytes:
    """Começa com %PDF mas tem dados binários aleatórios no meio."""
    return b"%PDF-1.4\n" + bytes(random.randint(0, 255) for _ in range(512))


def encrypted_malformed_pdf() -> bytes:
    """PDF que declara /Encrypt mas o objeto está corrompido."""
    return (
        b"%PDF-1.4\n"
        b"1 0 obj<</Type/Catalog/Pages 2 0 R/Encrypt 5 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"5 0 obj<</Filter/Standard/R 3/O CORRUPTEDCORRUPTED/U BADDATA>>endobj\n"
        b"%%EOF"
    )


def xml_nesting_docx(depth: int = 500) -> bytes:
    """DOCX com XML profundamente aninhado (500 levels)."""
    open_tags  = "".join(f"<w:p{i}>" for i in range(depth))
    close_tags = "".join(f"</w:p{i}>" for i in reversed(range(depth)))
    xml = f'<?xml version="1.0"?><w:document>{open_tags}texto{close_tags}</w:document>'

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("word/document.xml", xml.encode())
        zf.writestr("[Content_Types].xml",
            '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="xml" ContentType="application/xml"/></Types>')
    return buf.getvalue()


def fake_mime_pdf() -> bytes:
    """Magic bytes de JPEG mas com extensão .pdf (para MIME spoof test)."""
    return b"\xff\xd8\xff\xe0" + b"X" * 200  # JPEG magic bytes


def fake_mime_docx() -> bytes:
    """Magic bytes de PDF mas com extensão .docx."""
    return b"%PDF-1.4\n" + b"Y" * 200


def giant_metadata_pdf() -> bytes:
    """PDF com objeto /Info com metadata de 200KB."""
    metadata = "A" * 200_000
    return (
        "%PDF-1.4\n"
        "1 0 obj<</Type/Catalog/Pages 2 0 R/Info 4 0 R>>endobj\n"
        f"4 0 obj<</Title({metadata})>>endobj\n"
        "%%EOF"
    ).encode()


def embedded_payload_docx() -> bytes:
    """DOCX com arquivo extra embutido fora dos paths esperados."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("word/document.xml",
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            '<w:body><w:p><w:r><w:t>Texto normal</w:t></w:r></w:p></w:body></w:document>')
        # Payload fora do path esperado
        zf.writestr("evil/payload.bin", b"\x00\xff" * 1000)
        zf.writestr("../../../etc/passwd.txt", "root:x:0:0:root")
    return buf.getvalue()


def zero_pages_pdf() -> bytes:
    """PDF declarando 0 páginas — deve ser tratado sem crash."""
    return (
        b"%PDF-1.4\n"
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n"
        b"xref\n0 3\n"
        b"0000000000 65535 f\n"
        b"0000000009 00000 n\n"
        b"0000000058 00000 n\n"
        b"trailer<</Size 3/Root 1 0 R>>\nstartxref\n100\n%%EOF"
    )


def null_bytes_pdf() -> bytes:
    """PDF com blocos de null bytes entre conteúdo — parser deve aguentar."""
    return (
        b"%PDF-1.4\n"
        + b"\x00" * 512
        + b"1 0 obj<</Type/Catalog>>endobj\n"
        + b"\x00" * 512
        + b"%%EOF"
    )


def oversized_object_pdf() -> bytes:
    """PDF com um único objeto contendo 600KB de texto — deve truncar."""
    big_content = "TextoGrande " * 50_000  # ~600KB
    return (
        "%PDF-1.4\n"
        "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        "3 0 obj<</Type/Page/Contents 4 0 R/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n"
        f"4 0 obj<</Length {len(big_content)}>>\nstream\n{big_content}\nendstream\nendobj\n"
        "%%EOF"
    ).encode()


def unicode_bomb() -> bytes:
    """
    DOCX com texto com Unicode adversarial (escapes explicitos, sem null bytes no fonte).
    RTL override, zero-width joiners, BOM embutido.
    """
    rtl = "\u202E"
    zwj = "‍" * 100
    bom = "﻿"
    text = rtl + zwj + bom + "CPF 529.982.247-25" + " " * 10

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        xml = (
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
            "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">"
            f"<w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body></w:document>"
        )
        zf.writestr("word/document.xml", xml.encode("utf-8", errors="replace"))
    return buf.getvalue()
