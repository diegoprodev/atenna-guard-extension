export interface PromptVariant {
  type: 'Direto' | 'Técnico' | 'Estruturado';
  label: string;
  description: string;
  text: string;
}

export function generatePrompts(userInput: string): PromptVariant[] {
  const trimmed = userInput.trim();
  return [
    { type: 'Direto',       label: 'Direto',       description: 'Claro e objetivo', text: buildDireto(trimmed) },
    { type: 'Técnico',      label: 'Técnico',       description: 'Detalhado com exemplos', text: buildTecnico(trimmed) },
    { type: 'Estruturado',  label: 'Estruturado',   description: 'Organizado em seções', text: buildEstruturado(trimmed) },
  ];
}

function buildDireto(input: string): string {
  if (!input) return 'Por favor, responda de forma clara e objetiva.';
  return `${input}\n\nResponda de forma clara, direta e sem rodeios.`;
}

function buildTecnico(input: string): string {
  if (!input) return 'Forneça uma análise técnica detalhada com exemplos práticos.';
  return `${input}\n\nForneça uma resposta técnica e detalhada, com exemplos práticos, referências relevantes e considerações de implementação quando aplicável.`;
}

function buildEstruturado(input: string): string {
  if (!input) return 'Organize sua resposta com: Contexto, Análise, Solução e Próximos Passos.';
  return `${input}\n\nOrganize sua resposta com as seguintes seções:\n1. **Contexto** — resumo do problema\n2. **Análise** — pontos principais\n3. **Solução** — resposta detalhada\n4. **Próximos Passos** — ações recomendadas`;
}
