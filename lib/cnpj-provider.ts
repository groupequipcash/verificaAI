import { isValidCnpj } from './cnpj-extractor';
export type Registration = { cnpj: string; nome_fantasia?: string; razao_social?: string; municipio?: string; uf?: string; identificador_matriz_filial?: number | string; descricao_identificador_matriz_filial?: string; descricao_situacao_cadastral?: string };
export async function getRegistration(cnpj: string): Promise<Registration | null> {
  if (!isValidCnpj(cnpj)) return null;
  const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${encodeURIComponent(cnpj)}`, { signal: AbortSignal.timeout(4000), cache: 'no-store' });
  if (!res.ok) return null;
  const data = await res.json() as Registration;
  if (String(data.identificador_matriz_filial) !== '1' || String(data.descricao_identificador_matriz_filial || '').toUpperCase() !== 'MATRIZ' || String(data.descricao_situacao_cadastral || '').toUpperCase() !== 'ATIVA') return null;
  return data;
}
