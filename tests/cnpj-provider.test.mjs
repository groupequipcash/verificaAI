import test from "node:test";
import assert from "node:assert/strict";
import {
  CNPJWS_SLOT_SCRIPT, getRegistration, normalizeCnpjWsRegistration, retryAfterMs,
} from "../lib/cnpj-provider.ts";

const CNPJ = "11222333000181";
const brasil = {
  cnpj: CNPJ, razao_social: "Casa Azul Comércio Ltda", nome_fantasia: "Casa Azul",
  municipio: "Curitiba", uf: "PR", identificador_matriz_filial: 1,
  descricao_identificador_matriz_filial: "MATRIZ", descricao_situacao_cadastral: "ATIVA",
};
const cnpjws = {
  razao_social: "Casa Azul Comércio Ltda",
  estabelecimento: {
    cnpj: CNPJ, tipo: "Matriz", situacao_cadastral: "Ativa",
    nome_fantasia: "Casa Azul", cidade: { nome: "Curitiba" }, estado: { sigla: "PR" },
  },
};
const response = (status, data = null, headers = {}) =>
  new Response(data === null ? null : JSON.stringify(data), { status, headers });

test("BrasilAPI success remains the only source", async () => {
  let calls = 0;
  const result = await getRegistration(CNPJ, {
    fetcher: async () => { calls++; return response(200, brasil); },
    redis: async () => { throw new Error("Redis must not be used"); },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, "approved");
  assert.equal(result.source, "brasilapi");
});

test("retries transient BrasilAPI responses twice with progressive delays", async () => {
  let calls = 0, now = 0;
  const delays = [];
  const result = await getRegistration(CNPJ, {
    now: () => now,
    pause: async (ms) => { delays.push(ms); now += ms; },
    fetcher: async () => {
      calls++;
      return calls === 1 ? response(503) : calls === 2 ? response(502) : response(200, brasil);
    },
    redis: async () => { throw new Error("No fallback expected"); },
  });
  assert.equal(calls, 3);
  assert.deepEqual(delays, [500, 1_000]);
  assert.equal(result.status, "approved");
  assert.equal(result.source, "brasilapi");
});

test("network timeouts are retried and then use the fallback", async () => {
  let brasilCalls = 0, fallbackCalls = 0;
  const result = await getRegistration(CNPJ, {
    fetcher: async (url) => {
      if (url.includes("brasilapi")) {
        brasilCalls++;
        throw new DOMException("timeout", "TimeoutError");
      }
      fallbackCalls++;
      return response(200, cnpjws);
    },
    redis: async () => 1,
    pause: async () => {},
  });
  assert.equal(brasilCalls, 3);
  assert.equal(fallbackCalls, 1);
  assert.equal(result.status, "approved");
  assert.equal(result.source, "cnpjws");
});

test("Retry-After is respected, and a delay beyond the budget skips further BrasilAPI calls", async () => {
  assert.equal(retryAfterMs("2"), 2_000);
  assert.equal(retryAfterMs("Wed, 21 Oct 2015 07:28:00 GMT", Date.parse("Wed, 21 Oct 2015 07:27:58 GMT")), 2_000);
  let brasilCalls = 0, fallbackCalls = 0, delay = 0;
  const result = await getRegistration(CNPJ, {
    now: () => 0,
    pause: async (ms) => { delay = ms; },
    fetcher: async (url) => {
      if (url.includes("brasilapi")) {
        brasilCalls++;
        return response(429, null, { "retry-after": "30" });
      }
      fallbackCalls++;
      return response(200, cnpjws);
    },
    redis: async () => 1,
  });
  assert.equal(brasilCalls, 1);
  assert.equal(fallbackCalls, 1);
  assert.equal(delay, 0);
  assert.equal(result.source, "cnpjws");
});

test("invalid and conclusive CNPJs never trigger retries or fallback", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return response(404); };
  assert.equal((await getRegistration("invalid", { fetcher })).status, "unconfirmed");
  assert.equal(calls, 0);
  assert.equal((await getRegistration(CNPJ, { fetcher })).status, "not_found");
  assert.equal(calls, 1);
  assert.equal((await getRegistration(CNPJ, { fetcher: async () => response(400) })).status, "unconfirmed");
  const branch = { ...brasil, identificador_matriz_filial: 2, descricao_identificador_matriz_filial: "FILIAL" };
  assert.equal((await getRegistration(CNPJ, { fetcher: async () => response(200, branch) })).status, "branch");
});

test("fallback normalizes only matching active headquarters", async () => {
  const normalized = normalizeCnpjWsRegistration(cnpjws, CNPJ);
  assert.equal(normalized?.identificador_matriz_filial, 1);
  assert.equal(normalized?.municipio, "Curitiba");
  assert.equal(normalized?.uf, "PR");
  assert.equal(normalizeCnpjWsRegistration(cnpjws, "27865757000102"), null);
  assert.equal(normalizeCnpjWsRegistration({ ...cnpjws, estabelecimento: { ...cnpjws.estabelecimento, cidade: null } }, CNPJ), null);
  const branch = { ...cnpjws, estabelecimento: { ...cnpjws.estabelecimento, tipo: "Filial" } };
  const inactive = { ...cnpjws, estabelecimento: { ...cnpjws.estabelecimento, situacao_cadastral: "Baixada" } };
  assert.equal((await fallbackWith(branch)).status, "branch");
  assert.equal((await fallbackWith(inactive)).status, "inactive");
  const approved = await fallbackWith(cnpjws);
  assert.equal(approved.status, "approved");
  assert.equal(approved.source, "cnpjws");
  assert.equal(approved.data.razao_social, "Casa Azul Comércio Ltda");
});

async function fallbackWith(payload) {
  let brasilCalls = 0;
  const result = await getRegistration(CNPJ, {
    fetcher: async (url) => url.includes("brasilapi")
      ? (brasilCalls++, response(503)) : response(200, payload),
    redis: async () => 1,
    pause: async () => {},
  });
  assert.equal(brasilCalls, 3);
  return result;
}

test("global Redis slot is atomic and denial prevents CNPJ.ws requests", async () => {
  assert.match(CNPJWS_SLOT_SCRIPT, /ZREMRANGEBYSCORE/);
  assert.match(CNPJWS_SLOT_SCRIPT, /ZCARD/);
  let fallbackCalls = 0;
  const result = await getRegistration(CNPJ, {
    fetcher: async (url) => url.includes("brasilapi") ? response(503) : (fallbackCalls++, response(200, cnpjws)),
    redis: async () => 0,
    pause: async () => {},
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.reason, "rate_limit");
  assert.equal(fallbackCalls, 0);
});

test("Redis limiter failure blocks fallback as a technical error", async () => {
  let fallbackCalls = 0;
  const result = await getRegistration(CNPJ, {
    fetcher: async (url) => url.includes("brasilapi") ? response(503) :
      (fallbackCalls++, response(200, cnpjws)),
    redis: async () => { throw new Error("offline"); },
    pause: async () => {},
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.reason, "limiter_unavailable");
  assert.equal(fallbackCalls, 0);
});

test("CNPJ.ws HTTP 429 sets shared cooldown and is never retried", async () => {
  let fallbackCalls = 0;
  const commands = [];
  const result = await getRegistration(CNPJ, {
    fetcher: async (url) => url.includes("brasilapi") ? response(503) :
      (fallbackCalls++, response(429, null, { "retry-after": "75" })),
    redis: async (command) => { commands.push(command); return 1; },
    pause: async () => {},
  });
  assert.equal(fallbackCalls, 1);
  assert.equal(result.status, "unavailable");
  assert.equal(result.httpStatus, 429);
  assert.equal(commands[0][0], "EVAL");
  assert.equal(commands[1][0], "SET");
  assert.ok(Number(commands[1][4]) >= 75_000);
});
