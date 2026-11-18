"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Building2,
  Check,
  ChevronDown,
  CircleCheck,
  Download,
  ExternalLink,
  Globe2,
  History,
  Loader2,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { emptyStats, type Company, type SearchStats } from "@/lib/types";
const HISTORY_KEY = "verifica-ai-history-v2";
const EMPTY = emptyStats();
const MAX_BATCHES = 4;
function predominantReason(stats: SearchStats) {
  if (!stats.googleSites)
    return "A pesquisa não recebeu sites orgânicos do Google.";
  if (!stats.sitesAnalyzed && stats.siteErrors)
    return "Os sites encontrados não puderam ser acessados. Verifique bloqueios ou instabilidade dos sites.";
  if (!stats.withWhatsapp)
    return "Nenhum site analisado publicou um link de WhatsApp verificável.";
  if (!stats.withCnpj)
    return "Os sites com WhatsApp não publicaram um CNPJ válido localizável.";
  if (stats.registryErrors >= stats.cnpjsQueried && stats.cnpjsQueried)
    return "A BrasilAPI não respondeu às consultas cadastrais; tente novamente mais tarde.";
  if (stats.rejectedBranch > stats.rejectedInactive && stats.rejectedBranch > 0)
    return "A maioria dos CNPJs consultados corresponde a filiais.";
  if (stats.rejectedInactive > 0)
    return "A maioria dos CNPJs consultados não está ativa.";
  if (stats.rejectedAssociation > 0)
    return "Não foi possível comprovar a relação entre alguns CNPJs e seus sites.";
  if (stats.rejectedDirectory > 0)
    return "Alguns resultados pertencem a diretórios de terceiros, não a sites próprios.";
  return "Os demais candidatos não passaram por todos os critérios de verificação.";
}
function readHistory(): Company[] {
  try {
    const data = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(data)
      ? data
          .filter(
            (x) =>
              x && typeof x.cnpj === "string" && typeof x.domain === "string",
          )
          .slice(0, 500)
      : [];
  } catch {
    return [];
  }
}
function numberLabel(c: Company) {
  return c.whatsappNumber ? `+${c.whatsappNumber}` : "Número não informado";
}
function CompanyCard({ company, index }: { company: Company; index: number }) {
  return (
    <article className="rounded-2xl border border-[#25354e] bg-[#101c2d] p-6 shadow-lg shadow-black/10 transition hover:border-[#3a5d91]">
      <div className="flex items-start gap-5">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#29406b] bg-[#172b48] font-mono text-sm font-bold text-[#75a7ff]">
          {String(index + 1).padStart(2, "0")}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold tracking-tight text-white">
                {company.name}
              </h3>
              <p className="mt-1 text-sm text-[#94a5bf]">{company.legalName}</p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-700/50 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">
              <CircleCheck size={14} /> Verificada
            </span>
          </div>
          <div className="mt-5 grid gap-4 border-t border-[#23334d] pt-5 md:grid-cols-2 xl:grid-cols-4">
            <Info label="CNPJ" value={company.cnpj} />
            <Info label="Estabelecimento" value="MATRIZ · ATIVA" />
            <Info
              label="Localização"
              value={
                [company.city, company.state].filter(Boolean).join(" · ") ||
                "Brasil"
              }
            />
            <Info label="WhatsApp" value={numberLabel(company)} />
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-[#23334d] pt-5">
            <div className="min-w-0 text-sm text-[#9baac2]">
              <span className="text-[#667b9c]">Site oficial</span>
              <br />
              <span className="break-all text-[#91b5ff]">{company.site}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                className="inline-flex items-center gap-2 rounded-lg border border-[#3a5074] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1b3150]"
                href={company.site}
                target="_blank"
                rel="noopener noreferrer"
              >
                Abrir site <ExternalLink size={14} />
              </a>
              <a
                className="inline-flex items-center gap-2 rounded-lg bg-[#147d5b] px-4 py-2 text-sm font-semibold text-white hover:bg-[#18986e]"
                href={company.whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Abrir WhatsApp <ArrowRight size={15} />
              </a>
            </div>
          </div>
          <details className="mt-4 text-xs text-[#7990b1]">
            <summary className="cursor-pointer">
              Ver evidências públicas
            </summary>
            <div className="mt-2 space-y-1 break-all">
              <p>CNPJ encontrado em: {company.cnpjEvidence}</p>
              <p>WhatsApp encontrado em: {company.whatsappEvidence}</p>
              <p>
                Verificado em:{" "}
                {new Date(company.foundAt).toLocaleString("pt-BR")}
              </p>
            </div>
          </details>
        </div>
      </div>
    </article>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-widest text-[#6f83a2]">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-[#e5edff]">{value}</div>
    </div>
  );
}
export default function Home() {
  const [history, setHistory] = useState<Company[]>([]);
  const [results, setResults] = useState<Company[]>([]);
  const [stats, setStats] = useState<SearchStats>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [candidateOffset, setCandidateOffset] = useState(0);
  const [hasSearched, setHasSearched] = useState(false);
  const [warning, setWarning] = useState("");
  const run = useRef(false);
  useEffect(() => {
    const id = window.setTimeout(() => setHistory(readHistory()), 0);
    return () => window.clearTimeout(id);
  }, []);
  const uniqueHistory = useMemo(
    () => [...new Map(history.map((c) => [c.cnpj, c])).values()].reverse(),
    [history],
  );
  const metrics: { Icon: LucideIcon; label: string; value: number }[] = [
    { Icon: Building2, label: "Empresas encontradas", value: stats.approved },
    {
      Icon: ShieldCheck,
      label: "CNPJs matriz confirmados",
      value: stats.headquartersActive,
    },
    {
      Icon: CircleCheck,
      label: "Aprovadas com WhatsApp",
      value: stats.approved,
    },
  ];
  async function search() {
    if (run.current) return;
    run.current = true;
    setBusy(true);
    setError("");
    setWarning("");
    setStats({ ...EMPTY });
    setHasSearched(true);
    setPhase("Pesquisando empresas no Google...");
    let offset = cursor;
    let siteOffset = candidateOffset;
    const next: Company[] = [];
    const tally: SearchStats = { ...EMPTY };
    const known = new Set(history.flatMap((c) => [c.cnpj, c.domain]));
    try {
      for (let round = 0; round < MAX_BATCHES && next.length < 5; round++) {
        setPhase(
          round === 0
            ? "Pesquisando empresas no Google..."
            : "Pesquisando mais candidatos no Google...",
        );
        const response = await fetch("/api/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            cursor: offset,
            offset: siteOffset,
            excluded: [...known].slice(-500),
          }),
          cache: "no-store",
        });
        if (!response.ok) {
          const payload = await response.json();
          throw new Error(
            payload.error || "A pesquisa está temporariamente indisponível.",
          );
        }
        if (!response.body) throw new Error("A pesquisa não retornou dados.");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = "";
        let finished = false;
        let interrupted = false;
        let batchStats: SearchStats = { ...EMPTY };
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true });
          const lines = pending.split("\n");
          pending = lines.pop() || "";
          for (const line of lines) {
            if (!line) continue;
            const event = JSON.parse(line);
            if (event.type === "phase") setPhase(event.message);
            if (event.type === "notice") setWarning(event.message);
            if (event.type === "company") {
              const c = event.company as Company;
              if (
                next.length < 5 &&
                !known.has(c.cnpj) &&
                !known.has(c.domain)
              ) {
                next.push(c);
                known.add(c.cnpj);
                known.add(c.domain);
                setResults((previous) => [...previous, c]);
              }
            }
            if (event.type === "stats") {
              batchStats = event.stats;
              const visible = { ...tally };
              for (const key of Object.keys(tally) as (keyof SearchStats)[])
                visible[key] += batchStats[key] || 0;
              setStats({ ...visible, approved: next.length });
            }
            if (event.type === "done") {
              offset = event.nextCursor;
              siteOffset = event.nextOffset;
              interrupted = event.interrupted;
              finished = true;
            }
            if (event.type === "error") throw new Error(event.message);
          }
        }
        if (!finished) throw new Error("A pesquisa foi interrompida.");
        for (const key of Object.keys(tally) as (keyof SearchStats)[])
          tally[key] += batchStats[key] || 0;
        if (interrupted && round === MAX_BATCHES - 1)
          setWarning(
            "A pesquisa atingiu o limite de tempo deste clique. Clique novamente para continuar de onde parou.",
          );
      }
      setPhase("Preparando resultados...");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Não foi possível concluir a pesquisa.",
      );
    } finally {
      if (next.length) {
        setHistory((previous) => {
          const existing = new Set(previous.map((c) => c.cnpj));
          const updated = [
            ...previous,
            ...next.filter((c) => !existing.has(c.cnpj)),
          ].slice(-500);
          localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
          return updated;
        });
      }
      setCursor(offset);
      setCandidateOffset(siteOffset);
      setBusy(false);
      setPhase("");
      run.current = false;
    }
  }
  function clearHistory() {
    localStorage.removeItem(HISTORY_KEY);
    setHistory([]);
    setCursor(0);
    setCandidateOffset(0);
  }
  function exportHistory() {
    const cell = (value: string) =>
      '"' +
      (/^[\s]*[=+@-]/.test(value) ? "'" : "") +
      value.replace(/"/g, '""') +
      '"';
    const rows = [
      [
        "Nome fantasia",
        "Razão social",
        "CNPJ",
        "Cidade",
        "Estado",
        "Site",
        "WhatsApp",
        "Data",
      ],
      ...uniqueHistory.map((c) => [
        c.name,
        c.legalName,
        c.cnpj,
        c.city,
        c.state,
        c.site,
        c.whatsappUrl,
        c.foundAt,
      ]),
    ];
    const csv =
      "\uFEFF" + rows.map((row) => row.map(cell).join(";")).join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "verifica-ai-historico.csv";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <main className="grid-bg min-h-screen">
      <div className="mx-auto max-w-[1480px] px-6 pb-20 xl:px-10">
        <header className="flex items-center justify-between border-b border-[#1d2a3f] py-7">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#2768ea] shadow-lg shadow-blue-900/50">
              <Sparkles size={22} strokeWidth={2.2} />
            </div>
            <div>
              <div className="text-xl font-black tracking-tight">
                Verifica <span className="text-[#6fa2ff]">AI</span>
              </div>
              <div className="text-xs text-[#8295b1]">por FortAds</div>
            </div>
          </div>
          <div className="hidden text-sm text-[#a6b7d1] md:block">
            Prospecção inteligente de empresas brasileiras
          </div>
          <div className="flex items-center gap-2 rounded-full border border-emerald-800/50 bg-emerald-500/5 px-3 py-1.5 text-xs text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Painel
            ativo
          </div>
        </header>
        <div className="mt-9 flex items-center gap-2 text-xs font-bold uppercase tracking-[.22em] text-[#6389c8]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#4d87ff]" />{" "}
          INTELIGÊNCIA COMERCIAL
        </div>
        <section className="mt-4 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
          <div className="relative overflow-hidden rounded-3xl border border-[#2b436d] bg-[#101f36] p-9 shadow-xl shadow-black/20">
            <div className="absolute -right-24 -top-40 h-80 w-80 rounded-full bg-[#2365d2]/15 blur-3xl" />
            <div className="relative">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#36578d] bg-[#1d3d6a]/40 px-3 py-1 text-xs font-semibold text-[#9bc0ff]">
                <Zap size={13} /> PESQUISA AUTOMÁTICA
              </div>
              <h1 className="max-w-2xl text-4xl font-bold leading-tight tracking-tight text-white lg:text-5xl">
                Encontre as empresas{" "}
                <span className="text-[#79aaff]">certas para prospectar.</span>
              </h1>
              <p className="mt-5 max-w-xl text-base leading-7 text-[#a9bad2]">
                Encontre empresas brasileiras com CNPJ matriz, site próprio e
                WhatsApp verificado.
              </p>
              <button
                onClick={search}
                disabled={busy}
                className="glow mt-8 inline-flex min-h-14 items-center gap-3 rounded-xl bg-[#2f72f5] px-7 text-base font-bold text-white transition hover:bg-[#4c87fc] disabled:opacity-60"
              >
                {busy ? (
                  <Loader2 className="animate-spin" size={19} />
                ) : (
                  <Search size={20} />
                )}{" "}
                {busy
                  ? "Pesquisando..."
                  : results.length
                    ? "Buscar mais 5 empresas"
                    : "Buscar 5 empresas"}{" "}
                {!busy && <ArrowRight size={18} />}
              </button>
              <p className="mt-4 text-xs text-[#7f94b2]">
                Sem cadastro · Empresas reais · Evidências públicas
              </p>
            </div>
          </div>
          <div className="rounded-3xl border border-[#263850] bg-[#0e1929] p-7">
            <div className="flex items-center gap-2 text-sm font-bold text-[#dce8fb]">
              <ShieldCheck size={18} className="text-[#70a4ff]" /> Verificação
              em 5 etapas
            </div>
            <div className="mt-7 space-y-5">
              {[
                ["01", "Google", "Descoberta de sites comerciais"],
                ["02", "Site próprio", "Análise de páginas públicas"],
                ["03", "WhatsApp + CNPJ", "Evidências no mesmo domínio"],
                ["04", "BrasilAPI", "Matriz e situação ativa"],
                ["05", "Resultado", "Empresa aprovada"],
              ].map(([n, title, desc], i) => (
                <div className="flex items-center gap-4" key={n}>
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#304668] bg-[#172741] font-mono text-xs text-[#8eb5f9]">
                    {n}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">
                      {title}
                    </div>
                    <div className="text-xs text-[#788da9]">{desc}</div>
                  </div>
                  {i === 4 && (
                    <Check size={16} className="ml-auto text-emerald-400" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className="mt-7 grid gap-4 md:grid-cols-3">
          {metrics.map(({ Icon, label, value }) => (
            <div
              key={label}
              className="rounded-2xl border border-[#23344d] bg-[#0d1929] p-5"
            >
              <div className="flex items-center gap-2 text-sm text-[#8fa3bf]">
                <Icon size={17} className="text-[#70a1f7]" />
                {label}
              </div>
              <div className="mt-4 text-3xl font-bold tabular-nums text-white">
                {value}
              </div>
              <div className="mt-1 text-xs text-[#667c9a]">
                na pesquisa atual
              </div>
            </div>
          ))}
        </section>
        {busy && (
          <section
            className="mt-7 flex items-center gap-5 rounded-2xl border border-[#31517e] bg-[#142848] p-6"
            aria-live="polite"
          >
            <div className="flex h-10 items-center gap-1">
              {[1, 2, 3, 4].map((n) => (
                <div
                  key={n}
                  className="pulsebar h-7 w-1 rounded-full bg-[#70a4ff]"
                />
              ))}
            </div>
            <div>
              <div className="font-semibold text-white">
                Pesquisa em andamento
              </div>
              <p className="mt-1 text-sm text-[#a6bddf]">{phase}</p>
              <p className="mt-1 text-xs text-[#7f98bd]">
                Os sites são analisados em lotes. Resultados aprovados aparecem
                assim que chegam.
              </p>
            </div>
          </section>
        )}
        {error && (
          <div
            className="mt-7 rounded-xl border border-red-800/50 bg-red-900/15 p-5 text-sm text-red-200"
            role="alert"
          >
            {error}
          </div>
        )}
        {warning && (
          <div className="mt-4 rounded-xl border border-amber-700/40 bg-amber-500/10 px-5 py-4 text-sm text-amber-200">
            {warning}
          </div>
        )}
        {hasSearched && (stats.googleSites > 0 || (!busy && !error)) && (
          <details
            className="mt-7 rounded-2xl border border-[#23344d] bg-[#0d1929] p-5"
            open={stats.approved === 0 && !busy}
          >
            <summary className="cursor-pointer text-sm font-semibold text-[#c8d8ef]">
              Diagnóstico da pesquisa
            </summary>
            <div className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
              {[
                ["Sites no Google", stats.googleSites],
                ["Sites analisados", stats.sitesAnalyzed],
                ["Com WhatsApp", stats.withWhatsapp],
                ["Com CNPJ", stats.withCnpj],
                ["CNPJs consultados", stats.cnpjsQueried],
                ["Filiais rejeitadas", stats.rejectedBranch],
                ["Inativas rejeitadas", stats.rejectedInactive],
                ["Empresas aprovadas", stats.approved],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-[#14243a] px-3 py-3">
                  <div className="text-xs text-[#8399b8]">{label}</div>
                  <div className="mt-1 font-bold text-white">{value}</div>
                </div>
              ))}
            </div>
            {!busy && stats.approved === 0 && (
              <p className="mt-4 text-sm text-[#afc2df]">
                Analisamos {stats.sitesAnalyzed} sites. Encontramos WhatsApp em{" "}
                {stats.withWhatsapp}, CNPJ em {stats.withCnpj} e nenhuma empresa
                passou por todos os critérios. {predominantReason(stats)}
              </p>
            )}
            {(stats.siteErrors > 0 ||
              stats.registryErrors > 0 ||
              stats.rejectedAssociation > 0) && (
              <p className="mt-2 text-xs text-[#7892b5]">
                Falhas de acesso a sites: {stats.siteErrors} · Falhas na
                BrasilAPI: {stats.registryErrors} · Diretórios:{" "}
                {stats.rejectedDirectory} · Associação site/CNPJ não confirmada:{" "}
                {stats.rejectedAssociation}. Falhas técnicas não são contadas
                como rejeições cadastrais.
              </p>
            )}
          </details>
        )}
        <section className="mt-10">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-[.2em] text-[#6a91d1]">
                RESULTADOS VERIFICADOS
              </div>
              <h2 className="mt-2 text-2xl font-bold text-white">
                Empresas encontradas
              </h2>
            </div>
            <div className="text-sm text-[#8296b4]">
              {results.length} empresa{results.length === 1 ? "" : "s"} nesta
              sessão
            </div>
          </div>
          {results.length ? (
            <div className="grid gap-4">
              {results.map((c, i) => (
                <CompanyCard key={`${c.cnpj}-${i}`} company={c} index={i} />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-[#2a3f5e] bg-[#0b1625] px-8 py-16 text-center">
              <Globe2 size={35} className="mx-auto text-[#5279b3]" />
              <h3 className="mt-5 text-lg font-semibold">
                Sua próxima oportunidade começa aqui
              </h3>
              <p className="mt-2 text-sm text-[#8599b6]">
                Clique em Buscar 5 empresas para iniciar a verificação.
              </p>
            </div>
          )}
          {!busy && results.length > 0 && (
            <div className="mt-6 text-center">
              <p className="mb-4 text-sm text-[#8fa2bd]">
                {stats.approved < 5
                  ? `Encontramos ${stats.approved} empresa${stats.approved === 1 ? "" : "s"} que atende${stats.approved === 1 ? "" : "m"} a todos os critérios nesta pesquisa. Os demais candidatos não passaram pela verificação.`
                  : "Todas as empresas exibidas passaram pela verificação."}
              </p>
              <button
                onClick={search}
                className="inline-flex items-center gap-2 rounded-xl border border-[#3a5c8d] bg-[#172d4e] px-6 py-3 font-semibold hover:bg-[#214273]"
              >
                <RotateCcw size={16} /> Buscar mais 5 empresas
              </button>
            </div>
          )}
        </section>
        <section className="mt-12 border-t border-[#24344b] pt-8">
          <button
            onClick={() => setShowHistory((x) => !x)}
            className="flex w-full items-center justify-between text-left"
          >
            <span className="flex items-center gap-3 text-lg font-semibold">
              <History size={20} className="text-[#77a8ff]" /> Histórico deste
              navegador{" "}
              <span className="rounded-full bg-[#1a2c45] px-2 py-0.5 text-xs text-[#9bb5dc]">
                {uniqueHistory.length}
              </span>
            </span>
            <ChevronDown
              size={18}
              className={`transition ${showHistory ? "rotate-180" : ""}`}
            />
          </button>
          {showHistory && (
            <div className="mt-5">
              <div className="mb-4 flex justify-end gap-5">
                {uniqueHistory.length > 0 && (
                  <button
                    onClick={exportHistory}
                    className="flex items-center gap-2 text-xs text-[#9aabc4] hover:text-white"
                  >
                    <Download size={14} /> Exportar CSV
                  </button>
                )}
                <button
                  onClick={clearHistory}
                  className="flex items-center gap-2 text-xs text-[#9aabc4] hover:text-white"
                >
                  <Trash2 size={14} /> Limpar histórico local
                </button>
              </div>
              {uniqueHistory.length ? (
                <div className="grid gap-3">
                  {uniqueHistory.map((c) => (
                    <div
                      key={c.cnpj}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#23354f] bg-[#0e1a2b] px-5 py-4"
                    >
                      <div>
                        <div className="font-semibold">{c.name}</div>
                        <div className="mt-1 text-xs text-[#869ab8]">
                          {c.cnpj} · {c.city}/{c.state} ·{" "}
                          {new Date(c.foundAt).toLocaleDateString("pt-BR")}
                        </div>
                      </div>
                      <a
                        href={c.site}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-[#90b6ff]"
                      >
                        Abrir site ↗
                      </a>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[#8497b2]">
                  Nenhuma empresa salva neste navegador.
                </p>
              )}
            </div>
          )}
        </section>
        <footer className="mt-16 flex flex-wrap justify-between gap-3 border-t border-[#1d2d44] pt-6 text-xs text-[#647b9c]">
          <span>© {new Date().getFullYear()} FortAds · Verifica AI</span>
          <span>
            Pesquisa de dados comerciais públicos · Histórico salvo apenas neste
            navegador
          </span>
        </footer>
      </div>
    </main>
  );
}
