import { extractCnpjs } from "./cnpj-extractor";
import { fetchPublicHtml } from "./security";
import { extractWhatsapp, type WhatsappEvidence } from "./whatsapp-extractor";
export type SiteEvidence = {
  site: string;
  domain: string;
  cnpjs: string[];
  whatsapp: WhatsappEvidence;
  text: string;
  cnpjSource: string;
};
export async function analyzeSite(
  candidate: string,
): Promise<SiteEvidence | null> {
  const home = await fetchPublicHtml(candidate);
  const origin = new URL(home.url).origin;
  const pages = [home];
  let cnpjs = extractCnpjs(home.html);
  let whatsapp = extractWhatsapp(home.html, home.url);
  let cnpjSource = cnpjs.length ? home.url : "";
  if (!cnpjs.length || !whatsapp) {
    const hrefs = [...home.html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map(
      (m) => m[1],
    );
    const contact = hrefs
      .filter((h) =>
        /contato|sobre|institucional|atendimento|quem-somos/i.test(h),
      )
      .slice(0, 2);
    for (const href of contact) {
      try {
        const u = new URL(href, home.url);
        if (u.origin !== origin) continue;
        const page = await fetchPublicHtml(u.toString());
        pages.push(page);
        const found = extractCnpjs(page.html);
        if (!cnpjs.length && found.length) {
          cnpjs = found;
          cnpjSource = page.url;
        }
        whatsapp ||= extractWhatsapp(page.html, page.url);
        if (cnpjs.length && whatsapp) break;
      } catch {
        /* página interna inacessível */
      }
    }
  }
  if (!cnpjs.length || !whatsapp) return null;
  const text = pages
    .map((p) =>
      p.html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " "),
    )
    .join(" ")
    .slice(0, 100_000);
  return {
    site: origin,
    domain: new URL(origin).hostname.replace(/^www\./, ""),
    cnpjs,
    whatsapp,
    text,
    cnpjSource,
  };
}
