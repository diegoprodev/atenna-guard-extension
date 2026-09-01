/**
 * Configuração central da extensão — fonte única da verdade para URLs de infraestrutura.
 *
 * NUNCA colocar segredos aqui. Tudo neste arquivo é público (vai no bundle e é
 * lido por qualquer um que baixe a extensão). Segredos ficam SÓ no backend.
 *
 * Ao trocar o domínio do BFF, altere APENAS este arquivo + o manifest.json
 * (host_permissions e content_security_policy.connect-src precisam bater com BFF_BASE).
 */

/** URL base do Backend-for-Frontend (FastAPI na VPS, atrás do Cloudflare). */
export const BFF_BASE = 'https://api.atennaia.com.br';

/** Project ref do Supabase (público — usado só para o fluxo OAuth do Google). */
export const SUPABASE_PROJECT_REF = 'kezbssjmgwtrunqeoyir';

/** URL do Supabase (público). */
export const SUPABASE_URL = `https://${SUPABASE_PROJECT_REF}.supabase.co`;
