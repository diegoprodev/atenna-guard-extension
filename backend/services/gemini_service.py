import os
import json
import asyncio
import httpx
from dotenv import load_dotenv
from services.openai_service import generate_prompts_openai

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models"
    "/gemini-2.5-flash-lite:generateContent"
)

# Instrução clara de formato para o Gemini — sem markdown, só JSON puro
SYSTEM_PROMPT = """Você é um especialista em engenharia de prompts e estruturação de pensamento.
Sua missão é melhorar o raciocínio do usuário, estruturar intenção e gerar prompts superiores ao que ele faria sozinho.
Nunca gere prompts genéricos. Nunca repita o input sem melhoria real.

Se o texto contiver campos como "Objetivo:", "Contexto:", "Formato preferido:", use-os para personalizar com precisão.

Gere 3 versões e para cada uma uma frase curta descrevendo o que aquele prompt vai gerar:

1. DIRETO: simples, claro, sem redundância. Máximo 2 parágrafos. NÃO copie o original — reformule de forma mais objetiva.
2. ESTRUTURADO: seções bem definidas — Contexto, Objetivo, Abordagem, Exemplos Práticos, Formato de Saída.
3. TÉCNICO: papel de especialista sênior + critérios de sucesso mensuráveis + restrições + lógica de raciocínio + formato rígido. Mínimo 3 parágrafos.

Entrada do usuário:
{input_text}

REGRAS:
- Elimine ambiguidade, enriqueça contexto, ajuste ao nível do usuário
- "direct": máximo 2 parágrafos, muito mais conciso
- "technical": role assignment obrigatório, critérios mensuráveis, exemplos
- "structured": todas as 5 seções presentes
- *_preview: frase curta (máx 12 palavras) descrevendo o que o prompt vai gerar
- TODOS os valores: STRINGS de texto puro (nunca objetos JSON aninhados)

Retorne APENAS JSON válido:
{{
  "direct": "...",
  "direct_preview": "Vai gerar uma resposta clara e objetiva sobre o tema",
  "structured": "Contexto: ...\n\nObjetivo: ...\n\nAbordagem: ...\n\nExemplos Práticos: ...\n\nFormato de Saída: ...",
  "structured_preview": "Vai gerar uma resposta organizada em seções didáticas",
  "technical": "...",
  "technical_preview": "Vai gerar uma análise profunda com aplicação profissional"
}}"""


def _build_fallback(input_text: str) -> dict:
    """Fallback local se o Gemini falhar — mantém o serviço funcionando."""
    return {
        "direct": f"Explique de forma clara e objetiva:\n\n{input_text}",
        "technical": f"Você é um especialista. Analise profundamente:\n\n{input_text}",
        "structured": f"Responda com contexto, solução e conclusão:\n\n{input_text}",
        "_is_fallback": True,
    }


async def generate_prompts(input_text: str, retry_count: int = 0, max_retries: int = 2) -> dict:
    """
    Chama Gemini Flash 1.5 para gerar 3 versões otimizadas do prompt do usuário.
    Retorna fallback local em caso de erro após retries.

    Retry logic:
    - Max 2 retries para erros temporários (503, 429)
    - Espera exponencial entre retries (1s, 2s)
    """
    if retry_count == 0:
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
            "maxOutputTokens": 2048,
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

        result = json.loads(raw_text, strict=False)

        # Valida que as 3 chaves existem
        if not all(k in result for k in ("direct", "technical", "structured")):
            raise ValueError("Resposta do Gemini não contém as chaves esperadas")

        # Garante que todos os valores são strings — Gemini às vezes retorna
        # "structured" como objeto JSON aninhado em vez de string.
        for key in ("direct", "technical", "structured"):
            if not isinstance(result[key], str):
                result[key] = json.dumps(result[key], ensure_ascii=False)

        print("[Atenna] Prompt gerado com sucesso")
        return result

    except httpx.TimeoutException:
        print("[Atenna] Timeout ao chamar Gemini — usando fallback")
        return _build_fallback(input_text)

    except httpx.HTTPStatusError as e:
        status_code = e.response.status_code
        print(f"[Atenna] HTTP {status_code} do Gemini")

        # Retry logic para erros temporários (503, 429)
        if status_code in (503, 429) and retry_count < max_retries:
            wait_time = 2 ** retry_count  # Exponential backoff: 1s, 2s, 4s
            print(f"[Atenna] Tentando novamente em {wait_time}s... (tentativa {retry_count + 1}/{max_retries})")
            await asyncio.sleep(wait_time)
            return await generate_prompts(input_text, retry_count + 1, max_retries)

        # Se não é erro temporário ou já atingiu max retries
        # Tentar OpenAI como fallback inteligente
        print(f"[Atenna] Gemini HTTP {status_code} — tentando OpenAI como fallback...")
        openai_result = await generate_prompts_openai(input_text)
        if openai_result:
            return openai_result

        # Se OpenAI também falhar, usar fallback local
        print(f"[Atenna] OpenAI também falhou — usando fallback local")
        return _build_fallback(input_text)

    except (json.JSONDecodeError, KeyError, ValueError) as e:
        print(f"[Atenna] Erro ao parsear resposta do Gemini: {e}")
        # Tentar OpenAI como fallback
        print(f"[Atenna] Tentando OpenAI como fallback...")
        openai_result = await generate_prompts_openai(input_text)
        if openai_result:
            return openai_result
        return _build_fallback(input_text)

    except Exception as e:
        print(f"[Atenna] Erro inesperado do Gemini: {e}")
        # Tentar OpenAI como fallback
        print(f"[Atenna] Tentando OpenAI como fallback...")
        openai_result = await generate_prompts_openai(input_text)
        if openai_result:
            return openai_result
        return _build_fallback(input_text)
