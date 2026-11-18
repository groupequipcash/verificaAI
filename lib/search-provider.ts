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
];
const states = [
  "São Paulo",
  "Minas Gerais",
  "Paraná",
  "Rio Grande do Sul",
  "Bahia",
  "Pernambuco",
  "Ceará",
  "Goiás",
  "Pará",
  "Amazonas",
  "Espírito Santo",
  "Santa Catarina",
  "Mato Grosso",
  "Mato Grosso do Sul",
  "Paraíba",
  "Rio Grande do Norte",
  "Piauí",
  "Maranhão",
  "Alagoas",
  "Sergipe",
  "Tocantins",
  "Rondônia",
  "Acre",
  "Roraima",
  "Amapá",
  "Distrito Federal",
  "Rio de Janeiro",
];
const blocked =
  /(^|\.)(instagram|facebook|linkedin|youtube|tiktok|mercadolivre|amazon|google|maps|cnpj|econodata|empresascnpj|jusbrasil|reclameaqui|guiamais|solutudo|telelistas|apontador|indeed|glassdoor|wikipedia)\./i;
export function queryFor(cursor: number) {
  const s = sectors[(cursor * 7) % sectors.length];
  const index =
    (cursor * 11 + Math.floor(cursor / places.length)) % places.length;
  const p = cursor % 3 === 0 ? states[index] : places[index];
  return `${s} ${p} site oficial WhatsApp CNPJ`;
}
export async function searchSites(cursor: number): Promise<string[]> {
  const key = process.env.SERPER_API_KEY;
  if (!key) throw new Error("SERPER_API_KEY não configurada");
  const urls: string[] = [];
  for (let i = 0; i < 2; i++) {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": key, "content-type": "application/json" },
      body: JSON.stringify({
        q: queryFor(cursor + i),
        gl: "br",
        hl: "pt-br",
        num: 10,
      }),
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Serper indisponível (${res.status})`);
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
  }
  return urls.slice(0, 6);
}
