import test from "node:test";
import assert from "node:assert/strict";
import { queryFor } from "../lib/search-provider.ts";
import {
  NEXT_SEQUENCE_SCRIPT, CLAIM_CANDIDATES_SCRIPT,
  reserveSearchSequence, claimSearchCandidates, saveSearchBatch, loadSearchBatch,
} from "../lib/search-progress.ts";
import { canStartGroup, FUNCTION_BUDGET_MS, groupDeadline } from "../lib/search-budget.ts";
import { predominantReason } from "../lib/search-diagnostics.ts";
import { emptyStats } from "../lib/types.ts";

function fakeRedis() {
  let sequence = 100000;
  const values = new Map();
  const recent = new Set();
  const commands = [];
  const command = async (args) => {
    commands.push(args);
    if (args[0] === "EVAL" && args[1] === NEXT_SEQUENCE_SCRIPT) return ++sequence;
    if (args[0] === "EVAL" && args[1] === CLAIM_CANDIDATES_SCRIPT) {
      return args.slice(3, 3 + Number(args[2])).map((key) => {
        if (recent.has(key)) return 0;
        recent.add(key);
        return 1;
      });
    }
    if (args[0] === "SET") { values.set(args[1], args[2]); return "OK"; }
    if (args[0] === "GET") return values.get(args[1]) ?? null;
    throw new Error("Unexpected Redis command");
  };
  return { command, commands };
}

test("four simultaneous operators receive distinct persistent query sequences", async () => {
  const redis = fakeRedis();
  const first = await Promise.all(Array.from({ length: 4 }, () => reserveSearchSequence(redis.command)));
  assert.deepEqual(first, [100001, 100002, 100003, 100004]);
  assert.equal(new Set(first.map(queryFor)).size, 4);
  const nextBrowser = await reserveSearchSequence(redis.command);
  assert.equal(nextBrowser, 100005);
  assert.equal(redis.commands.filter((item) => item[1] === NEXT_SEQUENCE_SCRIPT).length, 5);
  assert.ok(!queryFor(100001).includes("São Paulo SP") || !queryFor(100002).includes("São Paulo SP"));
});

test("recent organic domains are claimed once across simultaneous searches", async () => {
  const redis = fakeRedis();
  const urls = ["https://www.loja.com.br", "https://nova.com.br"];
  const [first, second] = await Promise.all([
    claimSearchCandidates(urls, redis.command),
    claimSearchCandidates(["https://loja.com.br", "https://outra.com.br"], redis.command),
  ]);
  assert.deepEqual(first, urls);
  assert.deepEqual(second, ["https://outra.com.br"]);
  assert.match(CLAIM_CANDIDATES_SCRIPT, /'NX', 'EX'/);
});

test("a resumed batch loads saved candidates without another Google search", async () => {
  const redis = fakeRedis();
  const sequence = await reserveSearchSequence(redis.command);
  const batch = { sites: ["https://a.com.br", "https://b.com.br", "https://c.com.br"], organicCount: 3 };
  await saveSearchBatch(sequence, batch, redis.command);
  const resumed = await loadSearchBatch(sequence, redis.command);
  assert.deepEqual(resumed.sites.slice(2), ["https://c.com.br"]);
  assert.equal(redis.commands.filter((item) => item[0] === "SET").length, 1);
  assert.equal(redis.commands.filter((item) => item[0] === "GET").length, 1);
});

test("time budget permits another group after twelve seconds and stops safely later", () => {
  const startedAt = 1_000_000;
  const functionDeadline = startedAt + FUNCTION_BUDGET_MS;
  assert.equal(canStartGroup(functionDeadline, startedAt + 12_000), true);
  assert.equal(canStartGroup(functionDeadline, startedAt + 27_000), true);
  assert.equal(canStartGroup(functionDeadline, startedAt + 28_000), false);
  assert.ok(groupDeadline(functionDeadline, startedAt + 12_000) <= functionDeadline - 7_000);
});

test("diagnostic prefers repeated companies over fewer branches and distinguishes timeouts", () => {
  const repeated = { ...emptyStats(), googleSites: 26, alreadyPresented: 4, rejectedBranch: 1, siteErrors: 2 };
  assert.match(predominantReason(repeated), /4 candidatos já constavam/);
  assert.doesNotMatch(predominantReason(repeated), /filiais/);
  const timed = { ...emptyStats(), googleSites: 20, timeLimitedCandidates: 3 };
  assert.match(predominantReason(timed, true), /prazo do lote/);
});
