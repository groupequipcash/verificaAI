import {
  decodeHtml,
  extractCnpjEvidence,
  visibleSiteText,
  type CnpjEvidence,
} from "./cnpj-extractor";
import { fetchPublicHtml } from "./security";
import { extractWhatsapp, type WhatsappEvidence } from "./whatsapp-extractor";
import { isDirectorySite } from "./directory-classifier";
export type SiteEvidence = {
  site: string;
  domain: string;
  directory: boolean;
  cnpjs: (CnpjEvidence & { source: string })[];
  whatsapp: WhatsappEvidence | null;
  text: string;
  identityText: string;
};
export async function analyzeSite(candidate: string): Promise<SiteEvidence> {
  const home = await fetchPublicHtml(new URL(candidate).origin);
  const origin = new URL(home.url).origin;
  const homeText = visibleSiteText(home.html).slice(0, 40_000);
  const directory = isDirectorySite(new URL(origin).hostname, homeText);
  if (directory)
    return {
      site: origin,
      domain: new URL(origin).hostname.replace(/^www\./, ""),
      directory: true,
      cnpjs: [],
      whatsapp: null,
      text: homeText,
      identityText: "",
    };
  const pages = [home];
  const hrefs = [
    ...decodeHtml(home.html).matchAll(/href\s*=\s*["']([^"']+)["']/gi),
  ].map((m) => m[1]);
  const contacts = hrefs.filter((h) =>
    /contato|sobre|institucional|atendimento|quem-somos|empresa|privacidade|termos|contact|about/i.test(
      h,
    ),
  );
  const visited = new Set([home.url]);
  for (const href of contacts) {
    if (pages.length >= 3) break;
    try {
      const u = new URL(href, home.url);
      if (u.origin !== origin || visited.has(u.toString())) continue;
      visited.add(u.toString());
      const hasCnpj = pages.some((p) => extractCnpjEvidence(p.html).length);
      const hasWhatsapp = pages.some((p) => extractWhatsapp(p.html, p.url));
      if (hasCnpj && hasWhatsapp) break;
      pages.push(await fetchPublicHtml(u.toString()));
    } catch {
      /* página interna inacessível */
    }
  }
  const cnpjs = [
    ...new Map(
      pages.flatMap((p) =>
        extractCnpjEvidence(p.html).map(
          (e) => [e.cnpj, { ...e, source: p.url }] as const,
        ),
      ),
    ).values(),
  ];
  const whatsapp =
    pages.map((p) => extractWhatsapp(p.html, p.url)).find(Boolean) || null;
  const text = pages
    .map((p) => visibleSiteText(p.html))
    .join(" ")
    .slice(0, 100_000);
  const identityText = pages
    .map((p) =>
      [
        ...p.html.matchAll(
          /<(?:title|h1)\b[^>]*>([\s\S]*?)<\/(?:title|h1)>|<meta\b[^>]*(?:property|name)=["'](?:og:site_name|application-name)["'][^>]*content=["']([^"']+)["']/gi,
        ),
      ]
        .map((m) => decodeHtml(m[1] || m[2] || "").replace(/<[^>]+>/g, " "))
        .join(" "),
    )
    .join(" ");
  return {
    site: origin,
    domain: new URL(origin).hostname.replace(/^www\./, ""),
    directory: false,
    cnpjs,
    whatsapp,
    text,
    identityText,
  };
}
