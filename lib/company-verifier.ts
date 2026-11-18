import { analyzeSite, type SiteEvidence } from "./site-analyzer";
import { getRegistration } from "./cnpj-provider";
import type { Company } from "./types";
import { associationMatches } from "./association";

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
  headquartersActive: number;
};
export async function verifyCompany(url: string): Promise<VerificationResult> {
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
    headquartersActive: 0,
  };
  let site: SiteEvidence;
  try {
    site = await analyzeSite(url);
  } catch {
    result.siteError = true;
    return result;
  }
  result.analyzed = true;
  result.withWhatsapp = Boolean(site.whatsapp);
  result.withCnpj = site.cnpjs.length > 0;
  if (!site.whatsapp || !site.cnpjs.length) return result;
  for (const evidence of site.cnpjs.slice(0, 2)) {
    result.cnpjsQueried++;
    const registration = await getRegistration(evidence.cnpj);
    if (registration.status === "branch") {
      result.rejectedBranch++;
      continue;
    }
    if (registration.status === "inactive") {
      result.rejectedInactive++;
      continue;
    }
    if (registration.status === "timeout") {
      result.registryError++;
      result.registryIssue = "BrasilAPI: tempo de resposta esgotado.";
      continue;
    }
    if (registration.status === "unavailable") {
      result.registryError++;
      result.registryIssue = `BrasilAPI HTTP ${registration.httpStatus || "indisponível"}: consulta cadastral não concluída.`;
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
    };
    break;
  }
  return result;
}
