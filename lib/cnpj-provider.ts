import { randomUUID } from "node:crypto";
import { isValidCnpj, normalizeCnpj } from "./cnpj-extractor";
import { classifyRegistration } from "./registration-classifier";
import { redisCommand } from "./global-history";

export type Registration = {
  cnpj: string;
  nome_fantasia?: string;
  razao_social?: string;
  municipio?: string;
  uf?: string;
  identificador_matriz_filial?: number | string;
  descricao_identificador_matriz_filial?: string;
  descricao_situacao_cadastral?: string;
};
export type RegistrationSource = "brasilapi" | "cnpjws";
export type RegistrationResult =
  | { status: "approved"; data: Registration; source: RegistrationSource }
  | { status: "branch" | "inactive" | "unconfirmed" | "not_found" }
  | { status: "timeout" | "unavailable"; source: RegistrationSource; httpStatus?: number; reason?: "rate_limit" | "limiter_unavailable" };

const TOTAL_BUDGET_MS = 14_000;
const BRASIL_ATTEMPT_MS = 3_000;
const FALLBACK_ATTEMPT_MS = 3_000;
const TRANSIENT_HTTP = new Set([429, 500, 502, 503, 504]);
const USER_AGENT = "VerificaAI/1.0 (+https://verifica7.vercel.app/)";

// Atomic rolling window across Functions: two calls per 60 seconds leaves
// margin below the provider's three-per-minute-per-IP ceiling.
export const CNPJWS_SLOT_SCRIPT = `
if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - 60000)
if redis.call('ZCARD', KEYS[1]) >= 2 then return 0 end
redis.call('ZADD', KEYS[1], now, ARGV[1])
redis.call('PEXPIRE', KEYS[1], 65000)
return 1
`;
const SLOTS_KEY = "verifica-ai:{cnpjws}:slots";
const COOLDOWN_KEY = "verifica-ai:{cnpjws}:cooldown";

type Dependencies = {
  fetcher?: typeof fetch;
  redis?: typeof redisCommand;
  now?: () => number;
  pause?: (ms: number) => Promise<void>;
  deadline?: number;
};
type ResolvedDependencies = Required<Dependencies>;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function retryAfterMs(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

async function timedRequest<T>(duration: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new DOMException("Prazo da consulta cadastral esgotado.", "TimeoutError"));
    }, duration);
  });
  try { return await Promise.race([run(controller.signal), limit]); }
  finally { if (timer) clearTimeout(timer); }
}

function isTimeout(error: unknown) {
  return error instanceof Error && /timeout|abort/i.test(`${error.name} ${error.message}`);
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function nonempty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeCnpjWsRegistration(payload: unknown, requestedCnpj: string): Registration | null {
  const root = record(payload);
  const establishment = record(root?.estabelecimento);
  const returnedCnpj = nonempty(establishment?.cnpj);
  if (!root || !establishment || !returnedCnpj || !isValidCnpj(returnedCnpj) ||
      normalizeCnpj(returnedCnpj) !== normalizeCnpj(requestedCnpj)) return null;
  const type = nonempty(establishment.tipo)?.toUpperCase();
  const situation = nonempty(establishment.situacao_cadastral)?.toUpperCase();
  if (!type || !["MATRIZ", "FILIAL"].includes(type) || !situation) return null;
  const legalName = nonempty(root.razao_social);
  const city = nonempty(record(establishment.cidade)?.nome);
  const state = nonempty(record(establishment.estado)?.sigla)?.toUpperCase();
  if (type === "MATRIZ" && situation === "ATIVA" &&
      (!legalName || !city || !state || !/^[A-Z]{2}$/.test(state))) return null;
  return {
    cnpj: normalizeCnpj(returnedCnpj),
    razao_social: legalName || undefined,
    nome_fantasia: nonempty(establishment.nome_fantasia) || undefined,
    municipio: city || undefined,
    uf: state || undefined,
    identificador_matriz_filial: type === "MATRIZ" ? 1 : 2,
    descricao_identificador_matriz_filial: type,
    descricao_situacao_cadastral: situation,
  };
}

async function fallbackCnpjWs(cnpj: string, deadline: number, deps: ResolvedDependencies): Promise<RegistrationResult> {
  if (deadline - deps.now() < 500) return { status: "timeout", source: "cnpjws" };
  try {
    const slot = await timedRequest(Math.max(1, deadline - deps.now()), () =>
      deps.redis(["EVAL", CNPJWS_SLOT_SCRIPT, "2", SLOTS_KEY, COOLDOWN_KEY, randomUUID()]));
    if (slot !== 1) return { status: "unavailable", source: "cnpjws", reason: "rate_limit" };
  } catch (error) {
    // Never call the public API without the shared limiter.
    return isTimeout(error)
      ? { status: "timeout", source: "cnpjws" }
      : { status: "unavailable", source: "cnpjws", reason: "limiter_unavailable" };
  }
  const remaining = deadline - deps.now();
  if (remaining < 1_500) return { status: "timeout", source: "cnpjws" };
  try {
    const { response, data } = await timedRequest(Math.min(FALLBACK_ATTEMPT_MS, remaining - 1_000), async (signal) => {
      const response = await deps.fetcher(`https://publica.cnpj.ws/cnpj/${encodeURIComponent(cnpj)}`, {
        headers: { "user-agent": USER_AGENT }, signal, cache: "no-store", redirect: "error",
      });
      return { response, data: response.ok ? await response.json() as unknown : null };
    });
    if (response.status === 429) {
      const cooldown = Math.max(60_000, retryAfterMs(response.headers.get("retry-after"), deps.now()) || 0);
      try {
        await timedRequest(Math.max(1, Math.min(1_000, deadline - deps.now())), () =>
          deps.redis(["SET", COOLDOWN_KEY, "1", "PX", String(cooldown)]));
      }
      catch { /* A failed Redis connection blocks future fallback calls. */ }
      return { status: "unavailable", source: "cnpjws", httpStatus: 429, reason: "rate_limit" };
    }
    if (response.status === 404) return { status: "not_found" };
    if (!response.ok) return { status: "unavailable", source: "cnpjws", httpStatus: response.status };
    const normalized = normalizeCnpjWsRegistration(data, cnpj);
    if (!normalized) return { status: "unconfirmed" };
    const status = classifyRegistration(normalized);
    return status === "approved"
      ? { status: "approved", data: normalized, source: "cnpjws" }
      : { status };
  } catch (error) {
    return { status: isTimeout(error) ? "timeout" : "unavailable", source: "cnpjws" };
  }
}

export async function getRegistration(cnpj: string, dependencies: Dependencies = {}): Promise<RegistrationResult> {
  if (!isValidCnpj(cnpj)) return { status: "unconfirmed" };
  const normalized = normalizeCnpj(cnpj);
  const deps: ResolvedDependencies = {
    fetcher: dependencies.fetcher || fetch,
    redis: dependencies.redis || redisCommand,
    now: dependencies.now || Date.now,
    pause: dependencies.pause || wait,
    deadline: dependencies.deadline ?? Infinity,
  };
  const deadline = Math.min(deps.now() + TOTAL_BUDGET_MS, deps.deadline);
  let lastError: RegistrationResult = { status: "unavailable", source: "brasilapi" };
  for (let attempt = 0; attempt < 3; attempt++) {
    const remaining = deadline - deps.now();
    if (remaining < 500) break;
    let delay = [500, 1_000][attempt] || 0;
    try {
      const { response, data } = await timedRequest(Math.min(BRASIL_ATTEMPT_MS, remaining), async (signal) => {
        const response = await deps.fetcher(`https://brasilapi.com.br/api/cnpj/v1/${encodeURIComponent(normalized)}`, {
          headers: { "user-agent": USER_AGENT }, signal, cache: "no-store", redirect: "error",
        });
        return { response, data: response.ok ? await response.json() as Registration : null };
      });
      if (response.status === 404) return { status: "not_found" };
      if (response.status === 400 || response.status === 422) return { status: "unconfirmed" };
      if (response.ok) {
        if (!record(data)) return { status: "unconfirmed" };
        const status = classifyRegistration(data as Registration);
        return status === "approved"
          ? { status: "approved", data: data as Registration, source: "brasilapi" }
          : { status };
      }
      lastError = { status: "unavailable", source: "brasilapi", httpStatus: response.status };
      if (!TRANSIENT_HTTP.has(response.status)) break;
      delay = Math.max(delay, retryAfterMs(response.headers.get("retry-after"), deps.now()) || 0);
    } catch (error) {
      if (error instanceof SyntaxError) {
        lastError = { status: "unavailable", source: "brasilapi" };
        break;
      }
      lastError = { status: isTimeout(error) ? "timeout" : "unavailable", source: "brasilapi" };
    }
    if (attempt === 2 || delay + 500 > deadline - deps.now()) break;
    await deps.pause(delay);
  }
  // The public CNPJ.ws endpoint documents a numeric path parameter.
  if (!/^\d{14}$/.test(normalized)) return lastError;
  const fallback = await fallbackCnpjWs(normalized, deadline, deps);
  if (fallback.status === "timeout" && lastError.status === "timeout") return lastError;
  return fallback;
}
