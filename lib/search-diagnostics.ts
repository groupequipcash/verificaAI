import type { SearchStats } from "./types";

export function predominantReason(stats: SearchStats, interrupted = false) {
  if (!stats.googleSites && !stats.sitesAnalyzed && !stats.alreadyPresented && !stats.skippedRecent)
    return "A pesquisa não recebeu sites orgânicos do Google.";
  const reasons = [
    { count: stats.alreadyPresented, text: `${stats.alreadyPresented} candidato${stats.alreadyPresented === 1 ? " já constava" : "s já constavam"} no histórico de entregas e foi${stats.alreadyPresented === 1 ? "" : "ram"} ignorado${stats.alreadyPresented === 1 ? "" : "s"} para evitar repetição.` },
    { count: stats.skippedRecent, text: "Alguns sites já haviam sido selecionados para análise recentemente." },
    { count: stats.rejectedBranch, text: "Os CNPJs consultados correspondem a filiais." },
    { count: stats.rejectedInactive, text: "Os CNPJs consultados não estão ativos." },
    { count: stats.registryErrors, text: "Os serviços cadastrais falharam; tente novamente mais tarde." },
    { count: stats.siteErrors, text: "Alguns sites não puderam ser acessados." },
    { count: stats.timeLimitedCandidates, text: "Alguns candidatos não puderam ser concluídos dentro do prazo do lote." },
    { count: stats.rejectedAssociation, text: "Não foi possível comprovar a relação entre os CNPJs e seus sites." },
    { count: stats.rejectedDirectory, text: "Alguns resultados pertencem a diretórios de terceiros, não a sites próprios." },
  ];
  const predominant = reasons.reduce((best, candidate) => candidate.count > best.count ? candidate : best);
  if (predominant.count > 0) return predominant.text;
  if (interrupted) return "A pesquisa atingiu o limite de tempo e poderá continuar na próxima tentativa.";
  if (!stats.withWhatsapp)
    return "Nenhum site analisado publicou um link de WhatsApp verificável.";
  if (!stats.withCnpj)
    return "Os sites com WhatsApp não publicaram um CNPJ válido localizável.";
  return "Os demais candidatos não passaram por todos os critérios de verificação.";
}
