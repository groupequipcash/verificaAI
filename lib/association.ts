import type { SiteEvidence } from "./site-analyzer";
import type { Registration } from "./cnpj-provider";
import type { CnpjEvidence } from "./cnpj-extractor";

function clean(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
const ignored = new Set([
  "ltda",
  "eireli",
  "me",
  "epp",
  "sa",
  "s",
  "a",
  "comercio",
  "servicos",
  "industria",
  "empresa",
  "brasil",
  "participacoes",
]);
function words(value: string) {
  return clean(value)
    .split(" ")
    .filter((w) => w.length >= 4 && !ignored.has(w));
}
export function nameMatches(name: string, text: string) {
  const target = words(name);
  if (!target.length) return false;
  const normalized = clean(text);
  if (normalized.includes(clean(name)) && clean(name).length >= 6) return true;
  if (target.length < 2) return false;
  const siteWords = normalized.split(" ");
  for (let i = 0; i < siteWords.length; i++) {
    if (!target.includes(siteWords[i])) continue;
    if (
      new Set(siteWords.slice(i, i + 13).filter((w) => target.includes(w)))
        .size >= 2
    )
      return true;
  }
  return false;
}
export function associationMatches(
  site: Pick<SiteEvidence, "text" | "identityText" | "cnpjs">,
  data: Registration,
  evidence: CnpjEvidence,
) {
  const names = [data.nome_fantasia || "", data.razao_social || ""].filter(
    Boolean,
  );
  if (
    site.cnpjs.length > 1 &&
    !names.some((name) => nameMatches(name, site.identityText))
  )
    return false;
  if (names.some((name) => nameMatches(name, site.identityText))) return true;
  if (names.some((name) => nameMatches(name, evidence.context))) return true;
  if (names.some((name) => nameMatches(name, site.text))) return true;
  const city = clean(data.municipio || "");
  const siteText = clean(site.text);
  const noThirdParty =
    !/desenvolvido por|powered by|agencia responsavel|criado por/i.test(
      evidence.context,
    );
  return (
    site.cnpjs.length === 1 &&
    evidence.labeled &&
    evidence.inFooter &&
    noThirdParty &&
    city.length >= 5 &&
    siteText.includes(city) &&
    clean(site.identityText).length >= 5
  );
}
