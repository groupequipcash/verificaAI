import { NextRequest, NextResponse } from "next/server";
import { searchSites } from "@/lib/search-provider";
import { verifyCompany } from "@/lib/company-verifier";
import { assertGlobalHistoryAvailable, GlobalHistoryUnavailable, reserveCompany } from "@/lib/global-history";
import { emptyStats, type Company, type SearchStats } from "@/lib/types";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: NextRequest) {
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
  const cursor = b.cursor;
  const offset = b.offset ?? 0;
  const excluded = b.excluded;
  if (
    !Number.isInteger(cursor) ||
    Number(cursor) < 0 ||
    Number(cursor) > 100_000 ||
    !Number.isInteger(offset) ||
    Number(offset) < 0 ||
    Number(offset) > 15 ||
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
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        send({ type: "phase", message: "Pesquisando empresas no Google..." });
        const search = await searchSites(Number(cursor));
        const candidates = search.sites;
        const seen = new Set(excluded as string[]);
        const companies: Company[] = [];
        const stats: SearchStats = {
          ...emptyStats(),
          googleSites: Number(offset) === 0 ? search.organicCount : 0,
        };
        send({
          type: "phase",
          message:
            "Analisando sites, WhatsApp e CNPJ; consultando a BrasilAPI quando há evidências...",
        });
        const deadline = Date.now() + 45_000;
        let registryNoticeSent = false;
        let i = Number(offset);
        for (; i < candidates.length && companies.length < 5; i += 3) {
          if (Date.now() > deadline - 22_000) break;
          const group = candidates
            .slice(i, i + 3)
            .filter(
              (u) => !seen.has(new URL(u).hostname.replace(/^www\./, "")),
            );
          const results = await Promise.all(group.map(verifyCompany));
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
            const c = result.company;
            if (
              c &&
              companies.length < 5 &&
              !seen.has(c.cnpj) &&
              !seen.has(c.domain)
            ) {
              // The atomic reservation is the only authority for delivery.
              // A failed or uncertain write stops the search before this card is sent.
              if (!(await reserveCompany(c))) continue;
              companies.push(c);
              seen.add(c.cnpj);
              seen.add(c.domain);
              send({ type: "company", company: c });
            }
          }
          stats.approved = companies.length;
          send({ type: "stats", stats });
        }
        send({ type: "phase", message: "Preparando resultados..." });
        send({
          type: "done",
          stats,
          nextCursor:
            i < candidates.length && companies.length < 5
              ? Number(cursor)
              : Number(cursor) + 1,
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
