import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { normalizeCompanyIdentity, reservationCommand, reserveIdentity, assertGlobalHistoryAvailable, GlobalHistoryUnavailable } from "../lib/global-history.ts";

const oldUrl = process.env.UPSTASH_REDIS_REST_URL;
const oldToken = process.env.UPSTASH_REDIS_REST_TOKEN;
const setup = () => {
  process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
};
const restore = () => {
  if (oldUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
  else process.env.UPSTASH_REDIS_REST_URL = oldUrl;
  if (oldToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
  else process.env.UPSTASH_REDIS_REST_TOKEN = oldToken;
};

test("normalizes CNPJ and domain for the same company", () => {
  assert.deepEqual(
    normalizeCompanyIdentity("11.222.333/0001-81", "https://WWW.Example.com.br/contato"),
    { cnpj: "11222333000181", domain: "example.com.br" },
  );
  assert.throws(() => normalizeCompanyIdentity("11222333000182", "https://example.com.br"));
  assert.throws(() => normalizeCompanyIdentity("11222333000181", "ftp://example.com.br"));
});

test("reservation atomically checks both permanent keys", () => {
  const command = reservationCommand("11.222.333/0001-81", "https://www.example.com.br");
  assert.equal(command[0], "EVAL");
  assert.match(command[1], /EXISTS', KEYS\[1\], KEYS\[2\]/);
  assert.doesNotMatch(command[1], /EXPIRE|PSETEX|SETEX/);
  assert.equal(command[2], "2");
  assert.equal(command[3], "verifica-ai:{companies}:cnpj:11222333000181");
  assert.equal(command[4], "verifica-ai:{companies}:domain:example.com.br");
});

test("only confirmed reservation permits delivery; errors fail closed", async () => {
  setup();
  try {
    const accepted = async (_url, init) => {
      assert.equal(init.headers.authorization, "Bearer test-token");
      return new Response(JSON.stringify({ result: 1 }), { status: 200 });
    };
    const duplicate = async () => new Response(JSON.stringify({ result: 0 }), { status: 200 });
    const failed = async () => new Response(JSON.stringify({ error: "offline" }), { status: 200 });
    assert.equal(await reserveIdentity("11222333000181", "example.com.br", accepted), true);
    assert.equal(await reserveIdentity("11222333000181", "example.com.br", duplicate), false);
    await assert.rejects(reserveIdentity("11222333000181", "example.com.br", failed), GlobalHistoryUnavailable);
    await assert.rejects(reserveIdentity("11222333000181", "example.com.br", async () => { throw new Error("timeout"); }), GlobalHistoryUnavailable);
    await assertGlobalHistoryAvailable(async () => new Response(JSON.stringify({ result: "PONG" })));
  } finally { restore(); }
});

test("missing Redis configuration blocks every reservation", async () => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  try {
    await assert.rejects(reserveIdentity("11222333000181", "example.com.br"), GlobalHistoryUnavailable);
  } finally { restore(); }
});

test("historical CSV import previews normalized unique companies without writing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "verifica-ai-import-"));
  try {
    const file = join(dir, "operador.csv");
    await writeFile(file, '\uFEFF"CNPJ";"Site"\r\n"11.222.333/0001-81";"https://www.Example.com.br/contato"\r\n"11222333000181";"https://example.com.br"\r\n"invalid";"https://outro.com.br"\r\n');
    const output = execFileSync(process.execPath, ["scripts/import-history.mjs", file], { encoding: "utf8" });
    assert.match(output, /linhas válidas: 2; únicas: 1; inválidas: 1/);
    assert.match(output, /Prévia somente/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
