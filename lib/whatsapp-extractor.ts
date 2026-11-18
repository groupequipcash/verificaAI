export type WhatsappEvidence = {
  url: string;
  number: string | null;
  source: string;
};
const LINK =
  /(?:(?:https?:)?\/\/(?:www\.)?(?:wa\.me|(?:api|web)\.whatsapp\.com)\/[^\s"'<>\\]*)|(?:whatsapp:\/\/send\?[^\s"'<>\\]*)/gi;
export function extractWhatsapp(
  html: string,
  pageUrl: string,
): WhatsappEvidence | null {
  const decoded = html
    .replace(/\\\//g, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/&amp;|&#38;|&#x26;/gi, "&");
  for (const raw of decoded.match(LINK) || []) {
    try {
      const url = new URL(raw.startsWith("//") ? "https:" + raw : raw);
      if (!["https:", "http:", "whatsapp:"].includes(url.protocol)) continue;
      const host = url.hostname.toLowerCase().replace(/^www\./, "");
      if (
        url.protocol !== "whatsapp:" &&
        !["wa.me", "api.whatsapp.com", "web.whatsapp.com"].includes(host)
      )
        continue;
      const number = (
        host === "wa.me"
          ? /^\/message\/[A-Za-z0-9]+\/?$/.test(url.pathname)
            ? ""
            : url.pathname.slice(1)
          : url.searchParams.get("phone") || ""
      ).replace(/\D/g, "");
      if (number && (number.length < 10 || number.length > 15)) continue;
      const validWithoutNumber =
        host === "wa.me" && /^\/message\/[A-Za-z0-9]+\/?$/.test(url.pathname);
      if (!number && !validWithoutNumber) continue;
      if (
        url.protocol === "whatsapp:"
          ? host !== "send"
          : host !== "wa.me" && url.pathname !== "/send"
      )
        continue;
      return { url: url.toString(), number: number || null, source: pageUrl };
    } catch {
      continue;
    }
  }
  return null;
}
