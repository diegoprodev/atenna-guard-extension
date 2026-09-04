/**
 * FASE 10.9.2 (B7/B8) — memória do último conteúdo gerado.
 *
 * O dono clicava na canetinha e o mesmo prompt era regerado do zero. E se a caixa
 * da plataforma ainda tem texto (mesmo depois do DLP reescrever), o sistema tem que
 * reconhecer que é "o mesmo conteúdo" e perguntar antes de gastar uma geração.
 *
 * A comparação é feita numa forma NORMALIZADA que ignora:
 *  - caixa, espaços repetidos, pontuação de borda
 *  - tokens de DLP (`[CPF]`, `[NOME]`, `[TELEFONE]`, …) — some no pré e no pós-DLP
 *  - sequências de dígitos (o valor cru vira token, mas o texto ao redor é o mesmo)
 * Assim "meu CPF é 123.456.789-00" e "meu CPF é [CPF]" batem.
 */
import { sk } from './scopedStorage';

const KEY_BASE = 'atenna_last_gen_sig';

const DLP_TOKEN_RE = /\[(?:CPF|CNPJ|RG|CNH|NOME|PESSOA|TELEFONE|EMAIL|E-?MAIL|CART[ÃA]O|CARTAO|ENDERE[ÇC]O|ENDERECO|CEP|PIX|TOKEN|API[_ ]?KEY|SENHA|DADO[_ ]SENS[ÍI]VEL|PROCESSO)\]/gi;

/** Forma canônica pra comparar dois textos "iguais o suficiente". */
export function normalizeForCompare(text: string): string {
  return text
    .replace(DLP_TOKEN_RE, ' ')     // tokens de DLP fora
    .replace(/\d[\d.\-/\s]{4,}\d/g, ' ') // sequências longas de dígitos fora
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // pontuação vira espaço
    .replace(/\s+/g, ' ')
    .trim();
}

/** Hash estável e curto (djb2). */
export function signatureOf(text: string): string {
  const norm = normalizeForCompare(text);
  if (norm.length < 3) return ''; // muito curto pra ter "gerado antes"
  let h = 5381;
  for (let i = 0; i < norm.length; i++) h = ((h << 5) + h + norm.charCodeAt(i)) | 0;
  return `${(h >>> 0).toString(36)}:${norm.length}`;
}

export async function getLastGenSignature(): Promise<string | null> {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get(sk(KEY_BASE), r => resolve((r[sk(KEY_BASE)] as string) ?? null));
    } catch { resolve(null); }
  });
}

export async function setLastGenSignature(sig: string): Promise<void> {
  return new Promise(resolve => {
    try {
      chrome.storage.local.set({ [sk(KEY_BASE)]: sig }, () => resolve());
    } catch { resolve(); }
  });
}

/** true se `text` gera a MESMA assinatura da última geração desta conta. */
export async function isSameAsLastGeneration(text: string): Promise<boolean> {
  const sig = signatureOf(text);
  if (!sig) return false;
  const last = await getLastGenSignature();
  return last === sig;
}
