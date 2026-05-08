#!/usr/bin/env python
"""Debug: Call Gemini and show exact response"""
import asyncio
import json
import os
import httpx
from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent"

SYSTEM_PROMPT = """Você é um especialista em engenharia de prompts e estruturação de pensamento.
Sua missão é melhorar o raciocínio do usuário, estruturar intenção e gerar prompts superiores ao que ele faria sozinho.
Nunca gere prompts genéricos. Nunca repita o input sem melhoria real.

Se o texto contiver campos como "Objetivo:", "Contexto:", "Formato preferido:", use-os para personalizar com precisão.

Gere 3 versões e para cada uma uma frase curta descrevendo o que aquele prompt vai gerar:

1. DIRETO: simples, claro, sem redundância. Máximo 2 parágrafos. NAO copie o original - reformule de forma mais objetiva.
2. ESTRUTURADO: secoes bem definidas - Contexto, Objetivo, Abordagem, Exemplos Praticos, Formato de Saida.
3. TECNICO: papel de especialista senior + criterios de sucesso mensuraveis + restricoes + logica de raciocinio + formato rigido. Minimo 3 paragrafos.

Entrada do usuario:
{input_text}

REGRAS:
- Elimine ambiguidade, enriqueça contexto, ajuste ao nivel do usuario
- "direct": maximo 2 paragrafos, muito mais conciso
- "technical": role assignment obrigatorio, criterios mensuraveis, exemplos
- "structured": todas as 5 secoes presentes
- *_preview: frase curta (max 12 palavras) descrevendo o que o prompt vai gerar
- TODOS os valores: STRINGS de texto puro (nunca objetos JSON aninhados)

Retorne APENAS JSON valido:
{{
  "direct": "...",
  "direct_preview": "Vai gerar uma resposta clara e objetiva sobre o tema",
  "structured": "Contexto: ...\n\nObjetivo: ...\n\nAbordagem: ...\n\nExemplos Praticos: ...\n\nFormato de Saida: ...",
  "structured_preview": "Vai gerar uma resposta organizada em secoes didaticas",
  "technical": "...",
  "technical_preview": "Vai gerar uma analise profunda com aplicacao profissional"
}}"""


async def debug_call(input_text: str):
    """Call Gemini and show full response"""
    print(f"\n[TEST] Input: {input_text[:80]}...\n")

    prompt_text = SYSTEM_PROMPT.format(input_text=input_text)

    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt_text}
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.7,
            "maxOutputTokens": 2048,
        }
    }

    try:
        print("[*] Calling Gemini API...")
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                GEMINI_URL,
                params={"key": GEMINI_API_KEY},
                headers={"Content-Type": "application/json"},
                json=payload,
            )

        print(f"[*] Status Code: {response.status_code}")

        if response.status_code != 200:
            print(f"[ERROR] HTTP {response.status_code}")
            print(f"[DEBUG] Response body:\n{response.text[:500]}")
            return False

        data = response.json()
        print(f"[OK] Got JSON response")

        # Extract text
        try:
            raw_text = data["candidates"][0]["content"]["parts"][0]["text"].strip()
            print(f"[OK] Text extracted ({len(raw_text)} chars)")
            print(f"\n[RAW RESPONSE]:\n{raw_text[:500]}\n...")

            # Try to parse
            if raw_text.startswith("```"):
                raw_text = raw_text.split("```")[1]
                if raw_text.startswith("json"):
                    raw_text = raw_text[4:]
                raw_text = raw_text.strip()
                print(f"\n[*] Removed markdown code block")

            result = json.loads(raw_text, strict=False)
            print(f"[OK] JSON parsed successfully")

            # Check keys
            expected = ["direct", "technical", "structured"]
            missing = [k for k in expected if k not in result]
            if missing:
                print(f"[WARNING] Missing keys: {missing}")
            else:
                print(f"[OK] All required keys present")

            # Check values are strings
            for key in expected:
                if key in result:
                    val = result[key]
                    is_string = isinstance(val, str)
                    print(f"  - {key}: {type(val).__name__} ({len(str(val))} chars) {'[OK]' if is_string else '[ERROR: NOT STRING]'}")

            return True

        except Exception as e:
            print(f"[ERROR] Failed to parse response: {str(e)}")
            print(f"[DEBUG] Full response:\n{json.dumps(data, indent=2)[:1000]}")
            return False

    except httpx.TimeoutException:
        print(f"[ERROR] Timeout after 10 seconds")
        return False
    except httpx.HTTPStatusError as e:
        print(f"[ERROR] HTTP {e.response.status_code}: {e}")
        return False
    except Exception as e:
        print(f"[ERROR] Unexpected error: {str(e)}")
        return False


async def main():
    """Test various inputs"""
    print("\n" + "="*60)
    print("GEMINI API DEBUG - Testing 3 different inputs")
    print("="*60)

    test_inputs = [
        "Como estruturar um projeto Node.js escalavel?",
        "Explique DLP em uma frase",
        "Builder: Objetivo: Aprender IA. Contexto: Python",
    ]

    results = []
    for inp in test_inputs:
        ok = await debug_call(inp)
        results.append(ok)

    print("\n" + "="*60)
    print(f"SUMMARY: {sum(results)}/{len(results)} calls succeeded")
    print("="*60)

    if all(results):
        print("\nCONCLUSAO: Gemini esta funcionando corretamente!")
        return 0
    else:
        print("\nCONCLUSAO: Gemini esta falhando - verifique logs acima")
        return 1


if __name__ == "__main__":
    if not GEMINI_API_KEY:
        print("ERROR: GEMINI_API_KEY not configured")
        exit(1)

    exit_code = asyncio.run(main())
    exit(exit_code)
