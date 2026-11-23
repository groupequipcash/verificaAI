import { NextRequest, NextResponse } from "next/server";
import { searchSites } from "@/lib/search-provider";
import { verifyCompany } from "@/lib/company-verifier";
import { assertGlobalHistoryAvailable, GlobalHistoryUnavailable, isDeliveredDomain, reserveCompany } from "@/lib/global-history";
import { claimSearchCandidates, loadSearchBatch, reserveSearchSequence, saveSearchBatch, SearchBatchExpired, type SearchBatch } from "@/lib/search-progress";
import { emptyStats, type Company, type SearchStats } from "@/lib/types";
import { canStartGroup, FUNCTION_BUDGET_MS, groupDeadline } from "@/lib/search-budget";
export const runtime = "nodejs";
export const maxDuration = 60;
// Read-only connectivity probe. It never calls Serper or reserves a company.
export async function HEAD() {
  try {
    await assertGlobalHistoryAvailable();
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  } catch {
    return new Response(null, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
export async function POST(request: NextRequest) {
  const functionDeadline = Date.now() + FUNCTION_BUDGET_MS;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Solicitação inválida." },
      { status: 400 },
    );
  }
  if (!body || typeof body !== "object")
    return NextResponse.json(
      { error: "Solicitação inválida." },
      { status: 400 },
    );
  const b = body as Record<string, unknown>;
  const requestedLease = b.leaseId;
  const offset = b.offset ?? 0;
  const excluded = b.excluded;
  if (
    (requestedLease !== undefined &&
      (!Number.isSafeInteger(requestedLease) || Number(requestedLease) < 100001)) ||
    !Number.isInteger(offset) ||
    Number(offset) < 0 ||
    Number(offset) > 20 ||
    (requestedLease === undefined && Number(offset) !== 0) ||
    !Array.isArray(excluded) ||
    excluded.length > 500 ||
    excluded.some((x) => typeof x !== "string" || x.length > 120)
  )
    return NextResponse.json(
      { error: "Parâmetros inválidos." },
      { status: 400 },
    );
  if (!process.env.SERPER_API_KEY)
    return NextResponse.json(
      {
        error:
          "A pesquisa ainda não está configurada. Configure SERPER_API_KEY na Vercel.",
      },
      { status: 503 },
    );
  try {
    // Fail before spending Serper credits when the shared history cannot be reached.
    await assertGlobalHistoryAvailable();
  } catch {
    return NextResponse.json(
      { error: new GlobalHistoryUnavailable().message },
      { status: 503 },
    );
  }
  let leaseId: number;
  let search: SearchBatch;
  try {
    if (requestedLease !== undefined) {
      leaseId = Number(requestedLease);
      search = await loadSearchBatch(leaseId);
    } else {
      leaseId = await reserveSearchSequence();
      const discovered = await searchSites(leaseId);
      search = {
        organicCount: discovered.organicCount,
        sites: discovered.sites,
      };
      await saveSearchBatch(leaseId, search);
    }
  } catch (error) {
    if (error instanceof SearchBatchExpired)
      return NextResponse.json({ error: error.message }, { status: 410 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Pesquisa indisponível." },
      { status: 503 },
    );
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        send({ type: "lease", leaseId });
        const candidates = search.sites;
        const seen = new Set(excluded as string[]);
        const companies: Company[] = [];
        const stats: SearchStats = {
          ...emptyStats(),
          googleSites: search.organicCount,
        };
        send({
          type: "phase",
          message:
            "Analisando sites, WhatsApp e CNPJ; consultando a BrasilAPI quando há evidências...",
        });
        let registryNoticeSent = false;
        let i = Number(offset);
        for (; i < candidates.length && companies.length < 5;) {
          // Leave room for Redis prechecks and the final reservation/response.
          // The group deadline bounds site and registry work to the time left.
          if (!canStartGroup(functionDeadline)) break;
          const end = Math.min(i + Math.min(3, 5 - companies.length), candidates.length);
          const checked = await Promise.all(candidates.slice(i, end).map(async (url) => {
            const domain = new URL(url).hostname.replace(/^www\./, "");
            return { url, delivered: seen.has(domain) || await isDeliveredDomain(url) };
          }));
          stats.alreadyPresented += checked.filter((item) => item.delivered).length;
          const available = checked.filter((item) => !item.delivered).map((item) => item.url);
          const group = await claimSearchCandidates(available);
          stats.skippedRecent += available.length - group.length;
          const deadline = groupDeadline(functionDeadline);
          const results = await Promise.all(group.map((url) => verifyCompany(url, deadline)));
          const eligible: Company[] = [];
          for (const result of results) {
            if (result.analyzed) stats.sitesAnalyzed++;
            if (result.withWhatsapp) stats.withWhatsapp++;
            if (result.withCnpj) stats.withCnpj++;
            stats.cnpjsQueried += result.cnpjsQueried;
            stats.rejectedBranch += result.rejectedBranch;
            stats.rejectedInactive += result.rejectedInactive;
            stats.registryErrors += result.registryError;
            if (result.registryIssue && !registryNoticeSent) {
              send({ type: "notice", message: result.registryIssue });
              registryNoticeSent = true;
            }
            stats.rejectedAssociation += result.rejectedAssociation;
            if (result.rejectedDirectory) stats.rejectedDirectory++;
            stats.headquartersActive += result.headquartersActive;
            if (result.siteError) stats.siteErrors++;
            if (result.alreadyPresentedDomain) stats.alreadyPresented++;
            if (result.timeLimited) stats.timeLimitedCandidates++;
            const c = result.company;
            if (c && companies.length < 5) {
              if (seen.has(c.cnpj) || seen.has(c.domain)) {
                stats.alreadyPresented++;
                continue;
              }
              eligible.push(c);
            }
          }
          // Final CNPJ+domain reservations remain atomic. Parallel requests
          // bound the group's Redis tail without allowing more than five cards.
          const reservations = await Promise.allSettled(eligible.map(reserveCompany));
          let reservationFailure = false;
          for (let index = 0; index < eligible.length; index++) {
            const reservation = reservations[index];
            if (reservation.status === "rejected") {
              reservationFailure = true;
              continue;
            }
            if (!reservation.value) {
              stats.alreadyPresented++;
              continue;
            }
            const c = eligible[index];
            companies.push(c);
            seen.add(c.cnpj);
            seen.add(c.domain);
            send({ type: "company", company: c });
          }
          if (reservationFailure) throw new GlobalHistoryUnavailable();
          i = end;
          stats.approved = companies.length;
          send({ type: "stats", stats });
          send({ type: "progress", leaseId, nextOffset: i });
        }
        send({ type: "phase", message: "Preparando resultados..." });
        send({ type: "stats", stats });
        send({
          type: "done",
          stats,
          nextLeaseId:
            i < candidates.length && companies.length < 5 ? leaseId : null,
          nextOffset: i < candidates.length && companies.length < 5 ? i : 0,
          interrupted: i < candidates.length && companies.length < 5,
        });
      } catch (error) {
        send({
          type: "error",
          message:
            error instanceof Error
              ? error.message
              : "Serviço de pesquisa indisponível.",
        });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
