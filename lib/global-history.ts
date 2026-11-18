import type { Company } from "./types";

// Both keys are checked and written in one Redis operation. No expiry is set.
export const RESERVE_SCRIPT = `
if redis.call('EXISTS', KEYS[1], KEYS[2]) ~= 0 then
  return 0
end
redis.call('SET', KEYS[1], ARGV[1])
redis.call('SET', KEYS[2], ARGV[1])
return 1
`;

export class GlobalHistoryUnavailable extends Error {
  constructor() {
    super("A deduplicação global está temporariamente indisponível. Nenhuma nova empresa será exibida até a conexão com o histórico ser restabelecida.");
    this.name = "GlobalHistoryUnavailable";
  }
}

export function normalizeCompanyIdentity(cnpj: string, site: string) {
  const normalizedCnpj = cnpj.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z0-9]{12}[0-9]{2}$/.test(normalizedCnpj))
    throw new Error("CNPJ inválido para o histórico global.");
  const digits = [...normalizedCnpj].map((ch) => ch.charCodeAt(0) - 48);
  const check = (length: number) => {
    let weight = length - 7;
    let sum = 0;
    for (let i = 0; i < length; i++) {
      sum += digits[i] * weight;
      weight = weight === 2 ? 9 : weight - 1;
    }
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  if (/^(.)\1+$/.test(normalizedCnpj) || digits[12] !== check(12) || digits[13] !== check(13))
    throw new Error("CNPJ inválido para o histórico global.");
  let url: URL;
  try {
    url = new URL(site.includes("://") ? site : `https://${site}`);
  } catch {
    throw new Error("Domínio inválido para o histórico global.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port)
    throw new Error("Domínio inválido para o histórico global.");
  const domain = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  if (!domain.includes(".") || !/^[a-z0-9.-]+$/.test(domain) || domain.length > 253)
    throw new Error("Domínio inválido para o histórico global.");
  return { cnpj: normalizedCnpj, domain };
}

export function reservationCommand(cnpj: string, site: string) {
  const identity = normalizeCompanyIdentity(cnpj, site);
  const prefix = "verifica-ai:{companies}:";
  return [
    "EVAL", RESERVE_SCRIPT, "2",
    `${prefix}cnpj:${identity.cnpj}`,
    `${prefix}domain:${identity.domain}`,
    `${identity.cnpj}|${identity.domain}|${new Date().toISOString()}`,
  ];
}

type RedisReply = { result?: unknown; error?: unknown };
export async function redisCommand(command: string[], fetcher: typeof fetch = fetch): Promise<unknown> {
  const endpoint = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!endpoint || !token) throw new GlobalHistoryUnavailable();
  let url: URL;
  try {
    url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/")
      throw new Error("Invalid endpoint");
  } catch {
    throw new GlobalHistoryUnavailable();
  }
  try {
    const response = await fetcher(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(command),
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) throw new Error("Redis request failed");
    const payload = await response.json() as RedisReply;
    if (payload.error !== undefined || !Object.hasOwn(payload, "result"))
      throw new Error("Redis command failed");
    return payload.result;
  } catch {
    throw new GlobalHistoryUnavailable();
  }
}

export async function assertGlobalHistoryAvailable(fetcher?: typeof fetch) {
  const result = await redisCommand(["PING"], fetcher);
  if (result !== "PONG") throw new GlobalHistoryUnavailable();
}

export async function reserveIdentity(cnpj: string, site: string, fetcher?: typeof fetch): Promise<boolean> {
  const result = await redisCommand(reservationCommand(cnpj, site), fetcher);
  if (result === 1) return true;
  if (result === 0) return false;
  throw new GlobalHistoryUnavailable();
}

export async function reserveCompany(company: Company): Promise<boolean> {
  return reserveIdentity(company.cnpj, company.domain || company.site);
}
