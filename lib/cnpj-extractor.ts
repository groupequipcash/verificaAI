const CNPJ_PATTERN =
  /(?<![A-Z0-9])(?:[A-Z0-9]{2}\s*\.?\s*[A-Z0-9]{3}\s*\.?\s*[A-Z0-9]{3}\s*\/\s*[A-Z0-9]{4}\s*-?\s*[0-9]{2}|[A-Z0-9]{12}[0-9]{2})(?![A-Z0-9])/gi;
function digit(ch: string) {
  return /[0-9]/.test(ch) ? Number(ch) : ch.charCodeAt(0) - 48;
}
export function normalizeCnpj(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
export function isValidCnpj(value: string) {
  const c = normalizeCnpj(value);
  if (!/^[A-Z0-9]{12}[0-9]{2}$/.test(c) || /^(.)\1+$/.test(c)) return false;
  const nums = [...c].map(digit);
  const calc = (length: number) => {
    let weight = length - 7,
      sum = 0;
    for (let i = 0; i < length; i++) {
      sum += nums[i] * weight;
      weight = weight === 2 ? 9 : weight - 1;
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return nums[12] === calc(12) && nums[13] === calc(13);
}
export function decodeHtml(value: string) {
  return value
    .replace(/&(?:nbsp|#160|#xA0);/gi, " ")
    .replace(/&amp;|&#38;|&#x26;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(
      /&#(?:x([0-9a-f]+)|([0-9]+));/gi,
      (_m, hex: string, dec: string) => {
        const code = parseInt(hex || dec, hex ? 16 : 10);
        return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
      },
    );
}
export function visibleSiteText(html: string) {
  const structured = [
    ...html.matchAll(
      /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ]
    .map((m) => m[1])
    .join(" ");
  const attributes = [
    ...html.matchAll(
      /(?:data-cnpj|content)\s*=\s*["']([A-Z0-9.\/-]{14,25})["']/gi,
    ),
  ]
    .map((m) => m[1])
    .join(" ");
  return decodeHtml(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ") +
      " " +
      structured +
      " " +
      attributes,
  )
    .replace(/\s+/g, " ")
    .trim();
}
export type CnpjEvidence = {
  cnpj: string;
  context: string;
  labeled: boolean;
  inFooter: boolean;
};
export function extractCnpjEvidence(html: string): CnpjEvidence[] {
  const text = visibleSiteText(html);
  const footer = visibleSiteText(
    [...html.matchAll(/<footer\b[^>]*>([\s\S]*?)<\/footer>/gi)]
      .map((m) => m[1])
      .join(" "),
  );
  const found = new Map<string, CnpjEvidence>();
  for (const match of text.matchAll(CNPJ_PATTERN)) {
    const cnpj = normalizeCnpj(match[0]);
    if (!isValidCnpj(cnpj) || found.has(cnpj)) continue;
    const start = match.index || 0;
    const context = text.slice(
      Math.max(0, start - 100),
      Math.min(text.length, start + match[0].length + 100),
    );
    found.set(cnpj, {
      cnpj,
      context,
      labeled: /cnpj|cadastro nacional/i.test(context),
      inFooter: footer.includes(match[0]) || footer.includes(cnpj),
    });
    if (found.size === 5) break;
  }
  return [...found.values()];
}
export function extractCnpjs(html: string) {
  return extractCnpjEvidence(html).map((e) => e.cnpj);
}
