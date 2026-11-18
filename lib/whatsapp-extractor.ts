export type WhatsappEvidence = {
  url: string;
  number: string | null;
  source: string;
};
const LINK =
  /(?:https?:\/\/(?:wa\.me\/|(?:api|web)\.whatsapp\.com\/send\??)[^\s"'<>\\]*)|(?:whatsapp:\/\/send\?[^\s"'<>\\]*)/gi;
export function extractWhatsapp(
  html: string,
  pageUrl: string,
): WhatsappEvidence | null {
  const decoded = html
    .replace(/&amp;/gi, "&")
    .replace(/&#(?:x26|38);/gi, "&")
    .replace(/\\\//g, "/");
  for (const raw of decoded.match(LINK) || []) {
    try {
      const url = new URL(raw);
      if (!["https:", "http:", "whatsapp:"].includes(url.protocol)) continue;
      const host = url.hostname.toLowerCase();
      if (
        url.protocol !== "whatsapp:" &&
        !["wa.me", "api.whatsapp.com", "web.whatsapp.com"].includes(host)
      )
        continue;
      const number = (
        host === "wa.me"
          ? url.pathname.slice(1)
          : url.searchParams.get("phone") || ""
      ).replace(/\D/g, "");
      if (number && (number.length < 10 || number.length > 15)) continue;
      return { url: raw, number: number || null, source: pageUrl };
    } catch {
      continue;
    }
  }
  return null;
}
