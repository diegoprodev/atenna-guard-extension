"""OpenAI Service — gpt-4.1-nano primary (fastest + cheapest)"""
import os
import json
import httpx
from dotenv import load_dotenv

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_URL = "https://api.openai.com/v1/chat/completions"

# gpt-4.1-nano: $0.10/1M input, $0.40/1M output, ~640ms TTFT
# 2x faster than gemini-2.5-flash-lite at the same price
MODEL = "gpt-4.1-nano"

SYSTEM_PROMPT = """Você é um especialista em engenharia de prompts e estruturação de pensamento.
Sua missão é melhorar o raciocínio do usuário, estruturar intenção e gerar prompts superiores ao que ele faria sozinho.
Nunca gere prompts genéricos. Nunca repita o input sem melhoria real.

Se o texto contiver campos como "Objetivo:", "Contexto:", "Formato preferido:", use-os para personalizar com precisão.

Gere 3 versões e para cada uma uma frase curta descrevendo o que aquele prompt vai gerar:

1. DIRETO: simples, claro, sem redundância. Máximo 2 parágrafos. NÃO copie o original — reformule de forma mais objetiva.
2. ESTRUTURADO: seções bem definidas — Contexto, Objetivo, Abordagem, Exemplos Práticos, Formato de Saída.
3. TÉCNICO: papel de especialista sênior + critérios de sucesso mensuráveis + restrições + lógica de raciocínio + formato rígido. Mínimo 3 parágrafos.

REGRAS:
- Elimine ambiguidade, enriqueça contexto, ajuste ao nível do usuário
- "direct": máximo 2 parágrafos, muito mais conciso
- "technical": role assignment obrigatório, critérios mensuráveis, exemplos
- "structured": todas as 5 seções presentes
- *_preview: frase curta (máx 12 palavras) descrevendo o que o prompt vai gerar
- TODOS os valores: STRINGS de texto puro (nunca objetos JSON aninhados)

Retorne APENAS JSON válido:
{
  "direct": "...",
  "technical": "...",
  "structured": "..."
}

Não inclua markdown, explicações ou nada além do JSON."""


async def generate_prompts_openai(input_text: str) -> dict | None:
    """
    Fallback para OpenAI quando Gemini falha.
    Retorna None se falhar, dict se suceder.
    """
    if not OPENAI_API_KEY:
        print("[Atenna] OPENAI_API_KEY não configurada — não pode usar fallback OpenAI")
        return None

    try:
        print(f"[Atenna] Tentando OpenAI ({MODEL}) como fallback...")

        payload = {
            "model": MODEL,
            "messages": [
                {
                    "role": "system",
                    "content": SYSTEM_PROMPT,
                },
                {
                    "role": "user",
                    "content": input_text,
                }
            ],
            "temperature": 0.7,
            "max_tokens": 2048,
        }

        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                OPENAI_URL,
                headers={
                    "Authorization": f"Bearer {OPENAI_API_KEY}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )

            if response.status_code != 200:
                print(f"[Atenna] HTTP {response.status_code} do OpenAI")
                if response.status_code == 401:
                    print("[Atenna] OPENAI_API_KEY inválida — verifique .env")
                return None

            data = response.json()

            # Extract text from OpenAI response
            raw_text = data["choices"][0]["message"]["content"].strip()
            print(f"[Atenna] OpenAI respondeu ({len(raw_text)} chars)")

            # Remove markdown code blocks if present
            if raw_text.startswith("```"):
                raw_text = raw_text.split("```")[1]
                if raw_text.startswith("json"):
                    raw_text = raw_text[4:]
                raw_text = raw_text.strip()

            result = json.loads(raw_text, strict=False)

            # Validate required keys
            if not all(k in result for k in ("direct", "technical", "structured")):
                print("[Atenna] OpenAI: chaves obrigatórias faltando")
                return None

            # Ensure all values are strings
            for key in ("direct", "technical", "structured"):
                if not isinstance(result[key], str):
                    result[key] = json.dumps(result[key], ensure_ascii=False)

            print("[Atenna] OpenAI gerou prompt com sucesso")
            return result

    except httpx.TimeoutException:
        print("[Atenna] OpenAI timeout (>15s)")
        return None

    except Exception as e:
        print(f"[Atenna] OpenAI erro: {str(e)}")
        return None
