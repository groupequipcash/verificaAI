import { analyzeSite } from "./site-analyzer";
import { getRegistration } from "./cnpj-provider";
import type { Company } from "./types";
function norm(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}
function nameMatches(name: string, text: string, domain: string) {
  const words = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(
      (w) =>
        w.length > 3 &&
        ![
          "ltda",
          "eireli",
          "comercio",
          "servicos",
          "industria",
          "empresa",
          "brasil",
        ].includes(w),
    );
  return (
    words.some((w) => norm(text).includes(w) && norm(domain).includes(w)) ||
    (words.length >= 2 &&
      words.slice(0, 2).every((w) => norm(text).includes(w)))
  );
}
export async function verifyCompany(
  url: string,
): Promise<{
  company: Company | null;
  siteAnalyzed: boolean;
  evidence: boolean;
  registered: boolean;
}> {
  try {
    const site = await analyzeSite(url);
    if (!site)
      return {
        company: null,
        siteAnalyzed: true,
        evidence: false,
        registered: false,
      };
    for (const cnpj of site.cnpjs) {
      const data = await getRegistration(cnpj).catch(() => null);
      if (!data) continue;
      const name =
        data.nome_fantasia?.trim() || data.razao_social?.trim() || "";
      const legal = data.razao_social?.trim() || "";
      if (
        !nameMatches(name, site.text, site.domain) &&
        !nameMatches(legal, site.text, site.domain)
      )
        continue;
      return {
        company: {
          cnpj,
          name,
          legalName: legal,
          city: data.municipio || "",
          state: data.uf || "",
          site: site.site,
          domain: site.domain,
          whatsappUrl: site.whatsapp.url,
          whatsappNumber: site.whatsapp.number,
          whatsappEvidence: site.whatsapp.source,
          cnpjEvidence: site.cnpjSource,
          foundAt: new Date().toISOString(),
        },
        siteAnalyzed: true,
        evidence: true,
        registered: true,
      };
    }
    return {
      company: null,
      siteAnalyzed: true,
      evidence: true,
      registered: false,
    };
  } catch {
    return {
      company: null,
      siteAnalyzed: false,
      evidence: false,
      registered: false,
    };
  }
}
