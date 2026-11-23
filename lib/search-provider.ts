import { safeWebUrl } from "./security";
const sectors = [
  "loja de móveis",
  "material de construção",
  "clínica odontológica",
  "autopeças",
  "energia solar",
  "academia",
  "distribuidora de alimentos",
  "loja de eletrônicos",
  "serviços automotivos",
  "confecção de roupas",
  "equipamentos industriais",
  "transportadora",
  "farmácia de manipulação",
  "escola de idiomas",
  "gráfica",
  "pet shop",
  "loja de ferramentas",
  "empresa de segurança",
  "hotel",
  "construtora",
  "laboratório",
  "loja de cosméticos",
  "indústria de embalagens",
  "loja de tintas",
  "empresas comerciais",
  "empresas de serviços",
  "indústrias brasileiras",
  "fornecedores locais",
  "lojas especializadas",
  "fabricantes brasileiros",
  "loja de colchões",
  "refrigeração comercial",
  "loja de bicicletas",
  "máquinas agrícolas",
  "empresa de limpeza",
  "loja de iluminação",
  "marmoraria",
  "vidraçaria",
  "clínica veterinária",
  "equipamentos médicos",
  "loja de utilidades domésticas",
  "esquadrias de alumínio",
  "loja de pneus",
  "indústria têxtil",
  "produtos de higiene",
  "empresa de climatização",
  "loja de informática",
  "distribuidora de bebidas",
  "loja de artigos esportivos",
  "empresa de manutenção industrial",
];
const places = [
  "São Paulo SP",
  "Belo Horizonte MG",
  "Curitiba PR",
  "Porto Alegre RS",
  "Salvador BA",
  "Recife PE",
  "Fortaleza CE",
  "Goiânia GO",
  "Belém PA",
  "Manaus AM",
  "Vitória ES",
  "Florianópolis SC",
  "Cuiabá MT",
  "Campo Grande MS",
  "João Pessoa PB",
  "Natal RN",
  "Teresina PI",
  "São Luís MA",
  "Maceió AL",
  "Aracaju SE",
  "Palmas TO",
  "Porto Velho RO",
  "Rio Branco AC",
  "Boa Vista RR",
  "Macapá AP",
  "Brasília DF",
  "Rio de Janeiro RJ",
  "Campinas SP",
  "Santo André SP",
  "São Bernardo do Campo SP",
  "São José dos Campos SP",
  "Sorocaba SP",
  "Ribeirão Preto SP",
  "Bauru SP",
  "Piracicaba SP",
  "Franca SP",
  "Jundiaí SP",
  "Limeira SP",
  "Americana SP",
  "Uberlândia MG",
  "Juiz de Fora MG",
  "Contagem MG",
  "Montes Claros MG",
  "Pouso Alegre MG",
  "Divinópolis MG",
  "Londrina PR",
  "Maringá PR",
  "Cascavel PR",
  "Ponta Grossa PR",
  "Foz do Iguaçu PR",
  "São José dos Pinhais PR",
  "Caxias do Sul RS",
  "Pelotas RS",
  "Novo Hamburgo RS",
  "Santa Maria RS",
  "Passo Fundo RS",
  "Joinville SC",
  "Blumenau SC",
  "Chapecó SC",
  "Criciúma SC",
  "Itajaí SC",
  "Feira de Santana BA",
  "Vitória da Conquista BA",
  "Juazeiro BA",
  "Ilhéus BA",
  "Caruaru PE",
  "Petrolina PE",
  "Olinda PE",
  "Jaboatão dos Guararapes PE",
  "Sobral CE",
  "Juazeiro do Norte CE",
  "Caucaia CE",
  "Anápolis GO",
  "Aparecida de Goiânia GO",
  "Rio Verde GO",
  "Santarém PA",
  "Marabá PA",
  "Ananindeua PA",
  "Parintins AM",
  "Manacapuru AM",
  "Serra ES",
  "Vila Velha ES",
  "Linhares ES",
  "Sinop MT",
  "Rondonópolis MT",
  "Dourados MS",
  "Três Lagoas MS",
  "Campina Grande PB",
  "Mossoró RN",
  "Parnamirim RN",
  "Parnaíba PI",
  "Imperatriz MA",
  "Arapiraca AL",
  "Nossa Senhora do Socorro SE",
  "Araguaína TO",
  "Ji-Paraná RO",
  "Cruzeiro do Sul AC",
  "Rorainópolis RR",
  "Santana AP",
];
const commercialTerms = [
  "atendimento WhatsApp site oficial",
  "fale conosco WhatsApp loja online",
  "contato WhatsApp empresa site",
  "vendas pelo WhatsApp site oficial",
  "orçamento WhatsApp empresa",
  "WhatsApp comercial contato",
  "atendimento por WhatsApp CNPJ",
  "loja própria WhatsApp contato",
];
const blocked =
  /(^|\.)(instagram|facebook|linkedin|youtube|tiktok|mercadolivre|amazon|google|maps|cnpj|econodata|empresascnpj|jusbrasil|reclameaqui|guiamais|solutudo|telelistas|apontador|indeed|glassdoor|wikipedia|listapa|casadamidia)\./i;
export function queryFor(cursor: number) {
  const sectorIndex = cursor % sectors.length;
  const placeIndex = (Math.floor(cursor / sectors.length) + sectorIndex * 13) % places.length;
  const termIndex = (Math.floor(cursor / (sectors.length * places.length)) + sectorIndex + placeIndex) % commercialTerms.length;
  return `${sectors[sectorIndex]} ${places[placeIndex]} ${commercialTerms[termIndex]} -instagram -facebook -linkedin -econodata`;
}
const shortCache = new Map<
  number,
  { at: number; sites: string[]; organicCount: number }
>();
export async function searchSites(
  cursor: number,
): Promise<{ sites: string[]; organicCount: number }> {
  const key = process.env.SERPER_API_KEY;
  if (!key) throw new Error("SERPER_API_KEY não configurada");
  const cached = shortCache.get(cursor);
  if (cached && Date.now() - cached.at < 300_000)
    return { sites: cached.sites, organicCount: cached.organicCount };
  const urls: string[] = [];
  let res: Response;
  try {
    res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": key, "content-type": "application/json" },
      body: JSON.stringify({
        q: queryFor(cursor),
        gl: "br",
        hl: "pt-br",
        num: 20,
      }),
      signal: AbortSignal.timeout(7000),
      cache: "no-store",
    });
  } catch (error) {
    throw new Error(
      error instanceof Error &&
      /timeout|abort/i.test(error.name + " " + error.message)
        ? "Serper: tempo de resposta esgotado. A pesquisa pode ser retomada."
        : "Serper: conexão indisponível. Tente novamente.",
    );
  }
  if (!res.ok)
    throw new Error(
      `Serper HTTP ${res.status}: ${res.status === 429 ? "limite de consultas atingido" : res.status === 401 || res.status === 403 ? "chave inválida ou sem acesso" : "serviço de pesquisa indisponível"}.`,
    );
  const data = (await res.json()) as { organic?: { link?: string }[] };
  for (const item of data.organic || []) {
    if (!item.link) continue;
    try {
      const u = safeWebUrl(item.link);
      if (
        !blocked.test(u.hostname) &&
        !urls.some((x) => new URL(x).hostname === u.hostname)
      )
        urls.push(u.toString());
    } catch {
      /* candidato inválido */
    }
  }
  const result = {
    sites: urls.slice(0, 20),
    organicCount: (data.organic || []).filter((item) => Boolean(item.link))
      .length,
  };
  shortCache.set(cursor, { ...result, at: Date.now() });
  if (shortCache.size > 30) shortCache.delete(shortCache.keys().next().value!);
  return result;
}
