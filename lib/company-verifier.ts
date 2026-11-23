import { analyzeSite, type SiteEvidence } from "./site-analyzer";
import { getRegistration } from "./cnpj-provider";
import type { Company } from "./types";
import { associationMatches } from "./association";
import { isDeliveredDomain } from "./global-history";

export type VerificationResult = {
  company: Company | null;
  analyzed: boolean;
  withWhatsapp: boolean;
  withCnpj: boolean;
  cnpjsQueried: number;
  rejectedBranch: number;
  rejectedInactive: number;
  siteError: boolean;
  registryError: number;
  registryIssue: string | null;
  rejectedAssociation: number;
  rejectedDirectory: boolean;
  headquartersActive: number;
  alreadyPresentedDomain: boolean;
  timeLimited: boolean;
};
export async function verifyCompany(url: string, deadline = Infinity): Promise<VerificationResult> {
  const result: VerificationResult = {
    company: null,
    analyzed: false,
    withWhatsapp: false,
    withCnpj: false,
    cnpjsQueried: 0,
    rejectedBranch: 0,
    rejectedInactive: 0,
    siteError: false,
    registryError: 0,
    registryIssue: null,
    rejectedAssociation: 0,
    rejectedDirectory: false,
    headquartersActive: 0,
    alreadyPresentedDomain: false,
    timeLimited: false,
  };
  let site: SiteEvidence;
  try {
    site = await analyzeSite(url, deadline);
  } catch {
    if (Date.now() >= deadline - 100) result.timeLimited = true;
    else result.siteError = true;
    return result;
  }
  result.analyzed = true;
  if (site.directory) { result.rejectedDirectory = true; return result; }
  result.withWhatsapp = Boolean(site.whatsapp);
  result.withCnpj = site.cnpjs.length > 0;
  if (Date.now() > deadline - 4_000) {
    result.timeLimited = true;
    return result;
  }
  if (await isDeliveredDomain(site.domain)) {
    result.alreadyPresentedDomain = true;
    return result;
  }
  if (!site.whatsapp || !site.cnpjs.length) return result;
  for (const evidence of site.cnpjs.slice(0, 2)) {
    if (Date.now() > deadline - 1_000) {
      result.timeLimited = true;
      break;
    }
    result.cnpjsQueried++;
    const registration = await getRegistration(evidence.cnpj, { deadline });
    if (registration.status === "branch") {
      result.rejectedBranch++;
      continue;
    }
    if (registration.status === "inactive") {
      result.rejectedInactive++;
      continue;
    }
    if (registration.status === "timeout") {
      if (Date.now() >= deadline - 100) result.timeLimited = true;
      else {
        result.registryError++;
        result.registryIssue = "Consultas cadastrais: tempo de resposta esgotado.";
      }
      continue;
    }
    if (registration.status === "unavailable") {
      result.registryError++;
      result.registryIssue = registration.reason === "rate_limit"
        ? "BrasilAPI indisponível; limite da consulta pública CNPJ.ws atingido."
        : registration.reason === "limiter_unavailable"
          ? "BrasilAPI indisponível; controle de cota do CNPJ.ws temporariamente indisponível."
        : `Consulta cadastral ${registration.source === "cnpjws" ? "CNPJ.ws" : "BrasilAPI"} HTTP ${registration.httpStatus || "indisponível"}: não concluída.`;
      continue;
    }
    if (registration.status !== "approved") continue;
    result.headquartersActive++;
    const data = registration.data;
    if (!associationMatches(site, data, evidence)) {
      result.rejectedAssociation++;
      continue;
    }
    result.company = {
      cnpj: evidence.cnpj,
      name: data.nome_fantasia?.trim() || data.razao_social?.trim() || "",
      legalName: data.razao_social?.trim() || "",
      city: data.municipio || "",
      state: data.uf || "",
      site: site.site,
      domain: site.domain,
      whatsappUrl: site.whatsapp.url,
      whatsappNumber: site.whatsapp.number,
      whatsappEvidence: site.whatsapp.source,
      cnpjEvidence: evidence.source,
      foundAt: new Date().toISOString(),
      registrationSource: registration.source,
    };
    break;
  }
  return result;
}
