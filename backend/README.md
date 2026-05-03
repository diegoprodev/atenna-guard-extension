# Atenna Guard Prompt — Backend

Backend local em FastAPI que usa Gemini Flash 1.5 para gerar 3 versões otimizadas do prompt do usuário.

---

## Pré-requisitos

- Python 3.10+
- Chave de API do Gemini: https://aistudio.google.com/app/apikey

---

## Setup

### 1. Criar e ativar o ambiente virtual

```bash
# Windows
python -m venv venv
venv\Scripts\activate

# macOS / Linux
python3 -m venv venv
source venv/bin/activate
```

### 2. Instalar dependências

```bash
pip install -r requirements.txt
```

### 3. Configurar a API key

Edite o arquivo `.env`:

```
GEMINI_API_KEY=sua_chave_aqui
```

### 4. Rodar o servidor

```bash
uvicorn main:app --reload
```

O servidor sobe em: **http://localhost:8000**

### 5. Documentação interativa

Acesse no navegador: **http://localhost:8000/docs**

---

## Endpoints

| Método | Rota                | Descrição                          |
|--------|---------------------|------------------------------------|
| GET    | `/health`           | Status do servidor                 |
| POST   | `/generate-prompts` | Gera 3 versões otimizadas do prompt|

---

## Smoke Test

### POST /generate-prompts

**Body:**
```json
{
  "input": "quero criar plano de treino de natação"
}
```

**Resposta esperada:**
```json
{
  "direct": "...",
  "technical": "...",
  "structured": "..."
}
```

Você pode testar diretamente em **http://localhost:8000/docs** usando o Swagger UI.

---

## Comportamento de Fallback

Se a API do Gemini estiver indisponível ou a chave não estiver configurada, o servidor retorna automaticamente 3 templates locais — o endpoint nunca retorna erro para a extensão.

---

## Conectar a extensão Chrome

Após o servidor rodar, configure a extensão para chamar:

```
POST http://localhost:8000/generate-prompts
```

Body:
```json
{ "input": "<texto do usuário>" }
```
