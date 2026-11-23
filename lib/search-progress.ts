import { redisCommand, GlobalHistoryUnavailable } from "./global-history";
import { safeWebUrl } from "./security";

const SEQUENCE_KEY = "verifica-ai:{searches}:sequence";
const BATCH_PREFIX = "verifica-ai:{searches}:batch:";
const RECENT_PREFIX = "verifica-ai:{searches}:recent:";
const BATCH_TTL_SECONDS = 3600;
const RECENT_TTL_SECONDS = 1800;

// The old per-browser cursor was limited to 100,000. Start beyond that range
// so the first shared queries do not repeat the old opening searches.
export const NEXT_SEQUENCE_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then redis.call('SET', KEYS[1], 100000) end
return redis.call('INCR', KEYS[1])
`;

export const CLAIM_CANDIDATES_SCRIPT = `
local accepted = {}
for i = 1, #KEYS do
  if redis.call('SET', KEYS[i], '1', 'NX', 'EX', ARGV[1]) then
    accepted[i] = 1
  else
    accepted[i] = 0
  end
end
return accepted
`;

export type SearchBatch = { sites: string[]; organicCount: number };
type Redis = typeof redisCommand;

export class SearchBatchExpired extends Error {
  constructor() {
    super("O lote anterior expirou. Iniciando uma nova consulta.");
    this.name = "SearchBatchExpired";
  }
}

export async function reserveSearchSequence(redis: Redis = redisCommand): Promise<number> {
  const value = await redis(["EVAL", NEXT_SEQUENCE_SCRIPT, "1", SEQUENCE_KEY]);
  if (!Number.isSafeInteger(value) || Number(value) < 100001)
    throw new GlobalHistoryUnavailable();
  return Number(value);
}

export async function claimSearchCandidates(sites: string[], redis: Redis = redisCommand): Promise<string[]> {
  if (!sites.length) return [];
  const keys = sites.map((site) =>
    `${RECENT_PREFIX}${new URL(site).hostname.toLowerCase().replace(/^www\./, "")}`);
  const result = await redis([
    "EVAL", CLAIM_CANDIDATES_SCRIPT, String(keys.length),
    ...keys, String(RECENT_TTL_SECONDS),
  ]);
  if (!Array.isArray(result) || result.length !== sites.length ||
      result.some((value) => value !== 0 && value !== 1))
    throw new GlobalHistoryUnavailable();
  return sites.filter((_, index) => result[index] === 1);
}

export async function saveSearchBatch(sequence: number, batch: SearchBatch, redis: Redis = redisCommand) {
  const result = await redis([
    "SET", `${BATCH_PREFIX}${sequence}`, JSON.stringify(batch),
    "EX", String(BATCH_TTL_SECONDS),
  ]);
  if (result !== "OK") throw new GlobalHistoryUnavailable();
}

export async function loadSearchBatch(sequence: number, redis: Redis = redisCommand): Promise<SearchBatch> {
  const value = await redis(["GET", `${BATCH_PREFIX}${sequence}`]);
  if (value === null) throw new SearchBatchExpired();
  if (typeof value !== "string") throw new GlobalHistoryUnavailable();
  try {
    const batch = JSON.parse(value) as SearchBatch;
    if (!Array.isArray(batch.sites) ||
        batch.sites.length > 20 ||
        batch.sites.some((site) => {
          if (typeof site !== "string") return true;
          try { safeWebUrl(site); return false; }
          catch { return true; }
        }) ||
        !Number.isInteger(batch.organicCount) || batch.organicCount < 0)
      throw new Error("Invalid batch");
    return batch;
  } catch {
    throw new GlobalHistoryUnavailable();
  }
}
