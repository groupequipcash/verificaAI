import { NextRequest, NextResponse } from 'next/server';
import { searchSites } from '@/lib/search-provider';
import { verifyCompany } from '@/lib/company-verifier';
import type { Company, SearchStats } from '@/lib/types';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Solicitação inválida.' }, { status: 400 }); }
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Solicitação inválida.' }, { status: 400 });
  const b = body as Record<string, unknown>;
  const cursor = b.cursor;
  const excluded = b.excluded;
  if (!Number.isInteger(cursor) || Number(cursor) < 0 || Number(cursor) > 100_000 || !Array.isArray(excluded) || excluded.length > 500 || excluded.some(x => typeof x !== 'string' || x.length > 120)) return NextResponse.json({ error: 'Parâmetros inválidos.' }, { status: 400 });
  if (!process.env.SERPER_API_KEY) return NextResponse.json({ error: 'A pesquisa ainda não está configurada. Configure SERPER_API_KEY na Vercel.' }, { status: 503 });
  const encoder = new TextEncoder();
  const stream = new ReadableStream({ async start(controller) {
    const send = (event: unknown) => controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
    try {
      send({ type: 'phase', message: 'Pesquisando empresas no Google...' });
      const candidates = await searchSites(Number(cursor));
      const seen = new Set(excluded as string[]); const companies: Company[] = [];
      const stats: SearchStats = { candidates: candidates.length, sitesAnalyzed: 0, withWhatsappAndCnpj: 0, headquartersActive: 0, approved: 0 };
      send({ type: 'phase', message: 'Analisando sites, WhatsApp e CNPJ; consultando a BrasilAPI quando há evidências...' });
      for (let i = 0; i < candidates.length && companies.length < 5; i += 3) {
        const group = candidates.slice(i, i + 3).filter(u => !seen.has(new URL(u).hostname.replace(/^www\./,'')));
        const results = await Promise.all(group.map(verifyCompany));
        for (const result of results) {
          if (result.siteAnalyzed) stats.sitesAnalyzed++;
          if (result.evidence) stats.withWhatsappAndCnpj++;
          if (result.registered) stats.headquartersActive++;
          const c = result.company;
          if (c && companies.length < 5 && !seen.has(c.cnpj) && !seen.has(c.domain)) { companies.push(c); seen.add(c.cnpj); seen.add(c.domain); send({ type: 'company', company: c }); }
        }
        stats.approved = companies.length;
        send({ type: 'stats', stats });
      }
      send({ type: 'phase', message: 'Preparando resultados...' });
      send({ type: 'done', stats, nextCursor: Number(cursor) + 2, exhausted: candidates.length === 0 });
    } catch (error) { send({ type: 'error', message: error instanceof Error ? error.message : 'Serviço de pesquisa indisponível.' }); }
    finally { controller.close(); }
  }});
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}
