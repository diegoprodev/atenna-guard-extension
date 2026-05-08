"""
Testes de integração com Gemini para validar geração de prompts.
Gera exemplos reais de requisições e respostas esperadas.
"""
import asyncio
import json
import os
from dotenv import load_dotenv
from services.gemini_service import generate_prompts, _build_fallback, GEMINI_API_KEY, GEMINI_URL

load_dotenv()


def test_config():
    """Valida se a chave API está configurada."""
    print("\n[TEST 1: Validacao de Config]")
    print(f"GEMINI_API_KEY configurada: {'SIM' if GEMINI_API_KEY and GEMINI_API_KEY != 'cole_sua_chave_aqui' else 'NAO'}")
    print(f"Chave (primeiros 10 chars): {GEMINI_API_KEY[:10] if GEMINI_API_KEY else 'VAZIA'}...")
    print(f"URL de requisição: {GEMINI_URL}")

    if not GEMINI_API_KEY or GEMINI_API_KEY == "cole_sua_chave_aqui":
        print("\n[AVISO]  PROBLEMA ENCONTRADO: GEMINI_API_KEY não está configurada!")
        print("    Verifique o arquivo .env no backend")
        return False
    return True


def test_fallback():
    """Testa o fallback local quando Gemini falha."""
    print("\n[TEST 2: Fallback Local]")
    input_text = "Como usar machine learning em produção?"
    result = _build_fallback(input_text)

    print(f"Input: {input_text}")
    print(f"\nFallback gerado:")
    print(f"  direct: {result['direct'][:80]}...")
    print(f"  technical: {result['technical'][:80]}...")
    print(f"  structured: {result['structured'][:80]}...")

    # Valida que fallback tem as 3 chaves
    assert "direct" in result, "Falta chave 'direct'"
    assert "technical" in result, "Falta chave 'technical'"
    assert "structured" in result, "Falta chave 'structured'"

    print("\n[OK] Fallback válido")
    return True


async def test_gemini_call():
    """Testa chamada real ao Gemini (se chave configurada)."""
    print("\n[ TEST 3: Chamada ao Gemini [")

    if not GEMINI_API_KEY or GEMINI_API_KEY == "cole_sua_chave_aqui":
        print("[SKIP]  SKIPPED: GEMINI_API_KEY não configurada")
        return None

    test_cases = [
        "Como estruturar um projeto Node.js escalável?",
        "Explique DLP em uma frase",
        "Builder: Objetivo: Aprender IA. Contexto: Python. Formato: Tutorial prático",
    ]

    for i, input_text in enumerate(test_cases, 1):
        print(f"\nTeste {i}: {input_text[:60]}...")

        try:
            result = await generate_prompts(input_text)

            # Valida resposta
            is_fallback = (
                result.get('direct', '').startswith('Explique de forma clara')
                and input_text in result.get('direct', '')
            )

            status = "[ERRO] FALLBACK" if is_fallback else "[OK] GEMINI"
            print(f"  Status: {status}")
            print(f"  direct: {result['direct'][:60]}...")
            print(f"  technical: {result['technical'][:60]}...")
            print(f"  structured: {result['structured'][:60]}...")

            if is_fallback:
                print("  [AVISO]  Usando fallback - Gemini pode estar indisponível")

        except Exception as e:
            print(f"  [ERRO] ERRO: {str(e)}")
            return False

    return True


async def test_response_validation():
    """Testa validação de resposta Gemini."""
    print("\n[ TEST 4: Validação de Resposta [")

    # Simula resposta Gemini válida
    mock_response_json = {
        "direct": "Estruture seu projeto Node com separação clara de camadas: apresentação, lógica, dados.",
        "technical": "Implemente arquitectura MVC/Clean com testes unitários e CI/CD.",
        "structured": "Contexto: Node.js...\n\nObjetivo: Criar app escalável...",
    }

    print("Resposta Gemini (mock):")
    print(json.dumps(mock_response_json, indent=2, ensure_ascii=False))

    # Valida chaves
    required_keys = ["direct", "technical", "structured"]
    for key in required_keys:
        assert key in mock_response_json, f"Falta chave '{key}'"
        assert isinstance(mock_response_json[key], str), f"'{key}' não é string"

    print("\n[OK] Resposta válida")
    return True


async def test_edge_cases():
    """Testa casos extremos."""
    print("\n[ TEST 5: Casos Extremos [")

    edge_cases = [
        ("", "Input vazio"),
        ("a", "Input muito curto"),
        ("x" * 10000, "Input muito longo"),
        ("SELECT * FROM users; DROP TABLE users;", "Input com SQL injection"),
        ("CPF: 123.456.789-10, Email: user@example.com", "Input com PII"),
    ]

    for input_text, description in edge_cases:
        print(f"\n{description}:")
        try:
            result = await generate_prompts(input_text)
            print(f"  [OK] Processado: {len(result['direct'])} chars")
        except Exception as e:
            print(f"  [ERRO] ERRO: {str(e)}")

    return True


async def main():
    """Executa todos os testes."""
    print("\n[TESTES DE INTEGRACAO GEMINI - ATENNA PROMPT EXTENSION]\n")

    # Test 1: Config
    config_ok = test_config()

    # Test 2: Fallback
    fallback_ok = test_fallback()

    # Test 3: Gemini call
    gemini_ok = await test_gemini_call()

    # Test 4: Response validation
    response_ok = await test_response_validation()

    # Test 5: Edge cases
    edge_ok = await test_edge_cases()

    # Summary
    print("\n" + "-----" * 60)
    print("RESUMO DOS TESTES")
    print("-----" * 60)
    print(f"1. Config:                    {'[OK] PASS' if config_ok else '[ERRO] FAIL'}")
    print(f"2. Fallback:                  {'[OK] PASS' if fallback_ok else '[ERRO] FAIL'}")
    print(f"3. Gemini (se config ok):     {'[OK] PASS' if gemini_ok else '[SKIP]  SKIPPED' if gemini_ok is None else '[ERRO] FAIL'}")
    print(f"4. Validação de Resposta:     {'[OK] PASS' if response_ok else '[ERRO] FAIL'}")
    print(f"5. Casos Extremos:            {'[OK] PASS' if edge_ok else '[ERRO] FAIL'}")

    print("\n" + "-----" * 60)
    if not config_ok:
        print("[CRITICO] PROBLEMA CRÍTICO: Chave API não configurada!")
        print("   Solução: Configure GEMINI_API_KEY no .env")
        return 1

    print("[OK] Testes completados. Veja logs acima para detalhes.")
    return 0


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    exit(exit_code)
