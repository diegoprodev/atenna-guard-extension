import os
import json
import httpx
from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models"
    "/gemini-2.5-flash-lite:generateContent"
)

# Instrução clara de formato para o Gemini — sem markdown, só JSON puro
SYSTEM_PROMPT = """Gere 3 versões de prompt otimizado com base no texto do usuário abaixo.

As 3 versões devem ser:
1. Direto — claro, objetivo, sem rodeios. Máximo 2 parágrafos.
2. Técnico — profundo, com role assignment de especialista sênior, exemplos práticos, pontos de atenção e boas práticas relevantes ao tema.
3. Estruturado — organizado em seções: Contexto, Desenvolvimento, Exemplos Práticos, Conclusão e Próximos Passos.

Texto do usuário: {input_text}

Retorne APENAS JSON válido, sem markdown, sem blocos de código, sem texto extra. Formato exato:
{{
  "direct": "...",
  "technical": "...",
  "structured": "..."
}}"""


def _build_fallback(input_text: str) -> dict:
    """Fallback local se o Gemini falhar — mantém o serviço funcionando."""
    return {
        "direct": f"Explique de forma clara e objetiva:\n\n{input_text}",
        "technical": f"Você é um especialista. Analise profundamente:\n\n{input_text}",
        "structured": f"Responda com contexto, solução e conclusão:\n\n{input_text}",
    }


async def generate_prompts(input_text: str) -> dict:
    """
    Chama Gemini Flash 1.5 para gerar 3 versões otimizadas do prompt do usuário.
    Retorna fallback local em caso de erro.
    """
    print("[Atenna] Input recebido:", input_text)

    if not GEMINI_API_KEY or GEMINI_API_KEY == "cole_sua_chave_aqui":
        print("[Atenna] GEMINI_API_KEY não configurada — usando fallback")
        return _build_fallback(input_text)

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
            "maxOutputTokens": 1024,
        }
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                GEMINI_URL,
                params={"key": GEMINI_API_KEY},
                headers={"Content-Type": "application/json"},
                json=payload,
            )
            response.raise_for_status()

        data = response.json()

        # Extrai o texto gerado pelo Gemini
        raw_text = (
            data["candidates"][0]["content"]["parts"][0]["text"]
            .strip()
        )

        # Remove possíveis blocos ```json ... ``` que o modelo às vezes inclui
        if raw_text.startswith("```"):
            raw_text = raw_text.split("```")[1]
            if raw_text.startswith("json"):
                raw_text = raw_text[4:]
            raw_text = raw_text.strip()

        result = json.loads(raw_text)

        # Valida que as 3 chaves existem
        if not all(k in result for k in ("direct", "technical", "structured")):
            raise ValueError("Resposta do Gemini não contém as chaves esperadas")

        print("[Atenna] Prompt gerado com sucesso")
        return result

    except httpx.TimeoutException:
        print("[Atenna] Timeout ao chamar Gemini — usando fallback")
        return _build_fallback(input_text)

    except httpx.HTTPStatusError as e:
        print(f"[Atenna] HTTP {e.response.status_code} do Gemini — usando fallback")
        return _build_fallback(input_text)

    except (json.JSONDecodeError, KeyError, ValueError) as e:
        print(f"[Atenna] Erro ao parsear resposta do Gemini: {e} — usando fallback")
        return _build_fallback(input_text)

    except Exception as e:
        print(f"[Atenna] Erro inesperado: {e} — usando fallback")
        return _build_fallback(input_text)
