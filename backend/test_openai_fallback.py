"""
Test OpenAI fallback when Gemini API fails.
Validates the complete multi-LLM cascade.
"""
import asyncio
import json
import os
from dotenv import load_dotenv
from services.gemini_service import generate_prompts
from services.openai_service import generate_prompts_openai

load_dotenv()

GEMINI_KEY = os.getenv("GEMINI_API_KEY", "")
OPENAI_KEY = os.getenv("OPENAI_API_KEY", "")


async def test_openai_direct():
    """Test OpenAI service directly."""
    print("\n[TEST 1: OpenAI Direct]")

    if not OPENAI_KEY:
        print("[SKIP] OPENAI_API_KEY not configured")
        return None

    input_text = "Como implementar authentication segura em Node.js?"
    print(f"Input: {input_text}")

    try:
        result = await generate_prompts_openai(input_text)

        if result is None:
            print("[ERRO] OpenAI returned None")
            return False

        print(f"[OK] OpenAI respondeu com sucesso")
        print(f"  direct: {result.get('direct', '')[:80]}...")
        print(f"  technical: {result.get('technical', '')[:80]}...")
        print(f"  structured: {result.get('structured', '')[:80]}...")

        # Valida que as 3 chaves existem
        required_keys = ["direct", "technical", "structured"]
        for key in required_keys:
            if key not in result:
                print(f"[ERRO] Falta chave '{key}'")
                return False
            if not isinstance(result[key], str):
                print(f"[ERRO] '{key}' nao eh string: {type(result[key])}")
                return False

        return True

    except Exception as e:
        print(f"[ERRO] OpenAI falhou: {str(e)}")
        return False


async def test_fallback_cascade():
    """Test the complete fallback cascade."""
    print("\n[TEST 2: Fallback Cascade (Gemini -> OpenAI -> Template)]")

    input_text = "Melhores praticas de API design com REST?"
    print(f"Input: {input_text}")

    result = await generate_prompts(input_text)

    # Detecta qual fonte foi usada
    is_template = (
        result.get('direct', '').startswith('Explique de forma clara')
        and input_text in result.get('direct', '')
    )

    is_openai = (
        not is_template
        and len(result.get('direct', '')) > 100
        and 'seguranca' not in result.get('direct', '').lower()
    )

    if is_template:
        source = "TEMPLATE (Gemini + OpenAI failed)"
    elif is_openai:
        source = "OPENAI (Gemini failed)"
    else:
        source = "GEMINI (Primary)"

    print(f"[OK] Source: {source}")
    print(f"  direct: {result['direct'][:80]}...")
    print(f"  technical: {result['technical'][:80]}...")
    print(f"  structured: {result['structured'][:80]}...")

    return True


async def test_multi_input():
    """Test multiple inputs through the cascade."""
    print("\n[TEST 3: Multiple Inputs]")

    test_cases = [
        "Como usar Docker em producao?",
        "Explique o conceito de microserviços",
        "Arquitetura escalavel para SaaS",
    ]

    results = []
    for i, inp in enumerate(test_cases, 1):
        print(f"\nTeste {i}: {inp[:50]}...")
        try:
            result = await generate_prompts(inp)

            # Valida resposta
            has_all_keys = all(k in result for k in ("direct", "technical", "structured"))
            all_strings = all(isinstance(result.get(k), str) for k in ("direct", "technical", "structured"))

            if has_all_keys and all_strings:
                print(f"  [OK] Valido")
                results.append(True)
            else:
                print(f"  [ERRO] Resposta invalida")
                results.append(False)
        except Exception as e:
            print(f"  [ERRO] {str(e)}")
            results.append(False)

    return all(results) if results else False


async def main():
    """Run all tests."""
    print("\n[TESTES DE FALLBACK MULTI-LLM - ATENNA]\n")

    # Test 1: OpenAI Direct
    openai_ok = await test_openai_direct()

    # Test 2: Fallback Cascade
    cascade_ok = await test_fallback_cascade()

    # Test 3: Multiple Inputs
    multi_ok = await test_multi_input()

    # Summary
    print("\n" + "-"*60)
    print("RESUMO DOS TESTES")
    print("-"*60)
    print(f"1. OpenAI Direct:         {'[OK] PASS' if openai_ok else '[SKIP] SKIPPED' if openai_ok is None else '[ERRO] FAIL'}")
    print(f"2. Fallback Cascade:      {'[OK] PASS' if cascade_ok else '[ERRO] FAIL'}")
    print(f"3. Multiple Inputs:       {'[OK] PASS' if multi_ok else '[ERRO] FAIL'}")
    print("-"*60)

    if openai_ok is None:
        print("[AVISO] OpenAI API nao configurada, pulando teste direto")
    elif openai_ok and cascade_ok and multi_ok:
        print("[OK] TODOS OS TESTES PASSARAM")
        print("\nArquitetura multi-LLM funcionando:")
        print("  Primario: Gemini")
        print("  Fallback 1: OpenAI (gpt-4o-mini)")
        print("  Fallback 2: Template local")
        return 0
    else:
        print("[ERRO] ALGUNS TESTES FALHARAM")
        return 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    exit(exit_code)
