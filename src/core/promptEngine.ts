export interface PromptVariant {
  type: 'Direto' | 'Técnico' | 'Estruturado';
  label: string;
  description: string;
  text: string;
}

export function generatePrompts(userInput: string): PromptVariant[] {
  const trimmed = userInput.trim();
  return [
    { type: 'Direto',      label: 'Direto',      description: 'Claro e objetivo',      text: buildDireto(trimmed) },
    { type: 'Técnico',     label: 'Técnico',      description: 'Aprofundado e preciso', text: buildTecnico(trimmed) },
    { type: 'Estruturado', label: 'Estruturado',  description: 'Organizado em seções',  text: buildEstruturado(trimmed) },
  ];
}

function buildDireto(input: string): string {
  if (!input) {
    return 'Atue como especialista no tema solicitado. Responda de forma direta, objetiva e sem rodeios — vá ao ponto sem introduções ou conclusões desnecessárias. Priorize clareza e precisão acima de tudo.';
  }
  return `Atue como especialista no tema a seguir. Responda de forma direta, objetiva e sem rodeios.

Tarefa: ${input}

Requisitos da resposta:
- Vá direto ao ponto, sem introduções genéricas
- Use linguagem clara e precisa
- Máximo de 3 parágrafos, a menos que a complexidade exija mais
- Priorize informação prática e aplicável`;
}

function buildTecnico(input: string): string {
  if (!input) {
    return 'Atue como especialista sênior com ampla experiência prática. Forneça uma análise técnica aprofundada incluindo: explicação técnica detalhada, exemplos práticos aplicáveis, pontos de atenção e armadilhas comuns, e recomendações baseadas em boas práticas do mercado.';
  }
  return `Atue como especialista sênior com ampla experiência prática e domínio técnico profundo no tema abaixo.

Tarefa: ${input}

Inclua obrigatoriamente em sua resposta:
• Explicação técnica aprofundada com embasamento sólido
• Exemplos práticos e cenários reais aplicáveis
• Pontos de atenção, limitações e armadilhas comuns a evitar
• Recomendações baseadas em boas práticas e padrões do mercado
• Ferramentas, métodos ou abordagens relevantes quando aplicável

Use terminologia técnica precisa. Seja completo, detalhado e rigoroso.`;
}

function buildEstruturado(input: string): string {
  if (!input) {
    return 'Responda de forma estruturada e abrangente usando as seções: Contexto (fundamentos), Desenvolvimento (resposta aprofundada), Exemplos Práticos (casos concretos) e Conclusão com Próximos Passos (síntese e ações).';
  }
  return `Responda à solicitação abaixo de forma estruturada, completa e bem organizada.

Solicitação: ${input}

## Contexto
Defina o cenário, os conceitos fundamentais e os pressupostos necessários para entender o tema com profundidade.

## Desenvolvimento
Aborde a solicitação com precisão e profundidade. Explore os aspectos principais, secundários e as nuances relevantes.

## Exemplos Práticos
Ilustre com casos concretos, cenários reais e exemplos aplicáveis que facilitem a compreensão e implementação.

## Conclusão e Próximos Passos
Sintetize os pontos mais importantes e sugira ações concretas, aprofundamentos ou recursos adicionais relevantes.`;
}
