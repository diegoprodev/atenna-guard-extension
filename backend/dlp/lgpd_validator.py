"""
Validador LGPD — Contexto + Entidades + Severidade

Categorias obrigatórias:
1. DADOS PESSOAIS: CPF, CNPJ, RG, CNH, telefone, email, endereço, CEP, nome, placas, processo
2. DADOS SENSÍVEIS: saúde, religião, biometria, sindical, racial, política, médico
3. DADOS CORPORATIVOS: API keys, JWT, credenciais, tokens, segredos, pareceres, contratos, internos, financeiro, estratégico
"""

import re
from typing import Tuple

# Contexto keywords por categoria
HEALTH_KEYWORDS = [
    'paciente', 'diagnostico', 'diagnóstico', 'medicacao', 'medicação', 'cirurgia', 'internacao', 'internação',
    'hiv', 'cancer', 'câncer', 'diabetes', 'hipertensao', 'hipertensão', 'depress', 'psiquiat',
    'medico', 'médico', 'hospital', 'doenca', 'doença', 'sintoma', 'terapia', 'tratamento',
]

LEGAL_KEYWORDS = [
    'parecer', 'jurídico', 'processo', 'ação', 'sentença',
    'acórdão', 'procurador', 'defesa', 'reclamação', 'agravo',
    'petição', 'contestação', 'tese', 'jurisprudência', 'precedente',
]

FINANCIAL_KEYWORDS = [
    'salário', 'vencimento', 'bonificação', 'imposto', 'despesa',
    'investimento', 'ativo', 'passivo', 'balanço', 'auditoria',
    'faturamento', 'lucro', 'prejuízo', 'patrimônio', 'receita',
]

CONFIDENTIAL_KEYWORDS = [
    'confidencial', 'secreto', 'reservado', 'sigiloso', 'proprietário',
    'interno', 'privado', 'restrito', 'acesso limitado', 'não publicar',
]

RELIGIOUS_KEYWORDS = [
    'católico', 'evangélico', 'judeu', 'muçulmano', 'budista', 'espírita',
    'religião', 'fé', 'crença', 'práticas religiosas', 'sinagoga',
]

POLITICAL_KEYWORDS = [
    'voto', 'partido', 'eleição', 'candidato', 'político', 'posição',
    'ideologia', 'manifesto', 'protesto', 'movimento', 'filiação política',
]


def detect_health_context(text: str) -> float:
    """Detecta contexto de saúde. Retorna score 0-1."""
    count = sum(1 for kw in HEALTH_KEYWORDS if kw.lower() in text.lower())
    return min(count / 5, 1.0)  # 5+ keywords = score 1.0


def detect_legal_context(text: str) -> float:
    """Detecta contexto jurídico. Retorna score 0-1."""
    count = sum(1 for kw in LEGAL_KEYWORDS if kw.lower() in text.lower())
    return min(count / 4, 1.0)  # 4+ keywords = score 1.0


def detect_financial_context(text: str) -> float:
    """Detecta contexto financeiro. Retorna score 0-1."""
    count = sum(1 for kw in FINANCIAL_KEYWORDS if kw.lower() in text.lower())
    return min(count / 4, 1.0)


def detect_confidential_context(text: str) -> float:
    """Detecta indicação de confidencialidade. Retorna score 0-1."""
    count = sum(1 for kw in CONFIDENTIAL_KEYWORDS if kw.lower() in text.lower())
    return min(count / 3, 1.0)


def classify_lgpd_severity(
    entity_type: str,
    value: str,
    context: str,
) -> Tuple[str, float]:
    """
    Classifica severidade LGPD considerando:
    - Tipo de entidade
    - Contexto semântico
    - Score composto

    Retorna: (risk_level, score)
      risk_level: "NONE", "LOW", "MEDIUM", "HIGH"
      score: 0-1
    """

    # Base score por tipo
    base_scores = {
        # DADOS PESSOAIS
        "BR_CPF": 0.85,
        "BR_CNPJ": 0.80,
        "RG": 0.80,
        "CNH": 0.75,
        "EMAIL_ADDRESS": 0.60,
        "PHONE_NUMBER": 0.70,
        "BR_PHONE": 0.70,
        "ADDRESS": 0.65,
        "CEP": 0.50,
        "PERSON": 0.55,  # Nome em contexto
        "LICENSE_PLATE": 0.60,
        "PROCESS_NUMBER": 0.75,  # CNJ

        # DADOS SENSÍVEIS (contexto-dependente)
        "HEALTH_MENTION": 0.70,  # com contexto médico
        "RELIGIOUS_MENTION": 0.65,
        "POLITICAL_MENTION": 0.65,
        "BIOMETRIC": 0.90,
        "UNION_AFFILIATION": 0.75,

        # DADOS CORPORATIVOS
        "API_KEY": 0.95,
        "JWT": 0.92,
        "CREDENTIAL": 0.90,
        "SECRET": 0.88,
        "CREDIT_CARD": 0.85,

        # Contexto intensifica score
        "FINANCIAL_CONTEXT": 0.10,  # adicionado ao score
        "LEGAL_CONTEXT": 0.10,
        "CONFIDENTIAL_CONTEXT": 0.15,
    }

    base = base_scores.get(entity_type, 0.5)

    # Adicionar score de contexto
    health_score = detect_health_context(context)
    legal_score = detect_legal_context(context)
    financial_score = detect_financial_context(context)
    confidential_score = detect_confidential_context(context)

    final_score = base
    if health_score > 0.3:
        final_score = min(final_score + health_score * 0.15, 1.0)
    if legal_score > 0.3:
        final_score = min(final_score + legal_score * 0.15, 1.0)
    if financial_score > 0.3:
        final_score = min(final_score + financial_score * 0.10, 1.0)
    if confidential_score > 0.3:
        final_score = min(final_score + confidential_score * 0.20, 1.0)

    # Determina risk level
    if final_score >= 0.80:
        return "HIGH", final_score
    elif final_score >= 0.55:
        return "MEDIUM", final_score
    elif final_score >= 0.30:
        return "LOW", final_score
    else:
        return "NONE", final_score


def evaluate_lgpd_categories(text: str) -> dict:
    """
    Avalia texto contra 15 categorias LGPD obrigatórias.

    Retorna:
    {
        "categories_found": count de categorias,
        "severity_summary": "NONE" | "LOW" | "MEDIUM" | "HIGH",
        "details": {
            "pessoal": [...],
            "sensivel": [...],
            "corporativo": [...],
        }
    }
    """
    results = {
        "pessoal": [],
        "sensivel": [],
        "corporativo": [],
    }

    # ─── DADOS PESSOAIS (7 tipos) ───

    if re.search(r'\d{3}\.\d{3}\.\d{3}-\d{2}', text):
        results["pessoal"].append({"type": "BR_CPF", "risk": "HIGH"})

    if re.search(r'\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}', text):
        results["pessoal"].append({"type": "BR_CNPJ", "risk": "MEDIUM"})

    if re.search(r'\d{8}[-]?[a-zA-Z]', text):
        results["pessoal"].append({"type": "RG", "risk": "MEDIUM"})

    if re.search(r'\d{10,12}', text):  # CNH simplificado
        results["pessoal"].append({"type": "CNH", "risk": "MEDIUM"})

    if re.search(r'\S+@\S+\.\S+', text):
        results["pessoal"].append({"type": "EMAIL_ADDRESS", "risk": "LOW"})

    if re.search(r'(\+55)?\s*\(?\d{2}\)?[\s-]?\d{4,5}[\s-]?\d{4}', text):
        results["pessoal"].append({"type": "PHONE_NUMBER", "risk": "MEDIUM"})

    if re.search(r'\d{5}-?\d{3}', text):
        results["pessoal"].append({"type": "CEP", "risk": "LOW"})

    # ─── DADOS SENSÍVEIS (6 tipos) ───

    health_ctx = detect_health_context(text)
    if health_ctx > 0.3:
        results["sensivel"].append({
            "type": "HEALTH_MENTION",
            "risk": "HIGH" if health_ctx > 0.7 else ("MEDIUM" if health_ctx > 0.5 else "LOW"),
        })

    religious_ctx = sum(1 for kw in RELIGIOUS_KEYWORDS if kw.lower() in text.lower())
    if religious_ctx > 0:
        results["sensivel"].append({"type": "RELIGIOUS_MENTION", "risk": "MEDIUM"})

    political_ctx = sum(1 for kw in POLITICAL_KEYWORDS if kw.lower() in text.lower())
    if political_ctx > 0:
        results["sensivel"].append({"type": "POLITICAL_MENTION", "risk": "MEDIUM"})

    if re.search(r'(biometria|retina|impressão digital|biométrico)', text, re.I):
        results["sensivel"].append({"type": "BIOMETRIC", "risk": "HIGH"})

    if re.search(r'(sindic|filiação|associação de trabalhadores)', text, re.I):
        results["sensivel"].append({"type": "UNION_AFFILIATION", "risk": "MEDIUM"})

    racial_terms = ['afrodescendente', 'indígena', 'origem étnica', 'raça', 'cor da pele']
    if any(term.lower() in text.lower() for term in racial_terms):
        results["sensivel"].append({"type": "RACIAL_ORIGIN", "risk": "MEDIUM"})

    # ─── DADOS CORPORATIVOS (11 tipos) ───

    if re.search(r'sk_live_[a-zA-Z0-9]{10,}|sk_test_[a-zA-Z0-9]{10,}', text, re.I):
        results["corporativo"].append({"type": "API_KEY", "risk": "HIGH"})

    if re.search(r'Bearer\s+eyJ[a-zA-Z0-9_-]{10,}', text, re.I):
        results["corporativo"].append({"type": "JWT", "risk": "HIGH"})

    if re.search(r'(password|passwd|senha)\s*[=:]\s*\S+', text, re.I):
        results["corporativo"].append({"type": "CREDENTIAL", "risk": "HIGH"})

    # Cartão de crédito (Luhn simplificado: 16 dígitos)
    if re.search(r'\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}', text):
        results["corporativo"].append({"type": "CREDIT_CARD", "risk": "HIGH"})

    if re.search(r'(secret|token|apikey|api_key)', text, re.I):
        results["corporativo"].append({"type": "SECRET", "risk": "HIGH"})

    legal_ctx = detect_legal_context(text)
    if legal_ctx > 0.3:
        results["corporativo"].append({
            "type": "LEGAL_DOCUMENT",
            "risk": "MEDIUM" if legal_ctx > 0.5 else "LOW",
        })

    financial_ctx = detect_financial_context(text)
    if financial_ctx > 0.3:
        results["corporativo"].append({
            "type": "FINANCIAL_INFO",
            "risk": "MEDIUM" if financial_ctx > 0.5 else "LOW",
        })

    confidential_ctx = detect_confidential_context(text)
    if confidential_ctx > 0.3:
        results["corporativo"].append({
            "type": "CONFIDENTIAL",
            "risk": "MEDIUM" if confidential_ctx > 0.5 else "LOW",
        })

    if re.search(r'(contrato|acordo|memorando|padrão|SLA|NDA)', text, re.I):
        results["corporativo"].append({"type": "AGREEMENT", "risk": "MEDIUM"})

    if re.search(r'(roadmap|planejamento estratégico|segredo|proprietary)', text, re.I):
        results["corporativo"].append({"type": "STRATEGIC_INFO", "risk": "MEDIUM"})

    # ─── CALCULAR SEVERIDADE ───

    all_items = results["pessoal"] + results["sensivel"] + results["corporativo"]

    max_risk = "NONE"
    risk_hierarchy = {"NONE": 0, "LOW": 1, "MEDIUM": 2, "HIGH": 3}
    for item in all_items:
        risk = item.get("risk", "NONE")
        if risk_hierarchy.get(risk, 0) > risk_hierarchy.get(max_risk, 0):
            max_risk = risk

    return {
        "categories_found": len(all_items),
        "severity_summary": max_risk,
        "details": results,
        "requires_strict": max_risk in ["MEDIUM", "HIGH"],
    }
