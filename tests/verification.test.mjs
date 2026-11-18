import test from "node:test";
import assert from "node:assert/strict";
import {
  extractCnpjs,
  extractCnpjEvidence,
  isValidCnpj,
} from "../lib/cnpj-extractor.ts";
import { extractWhatsapp } from "../lib/whatsapp-extractor.ts";
import { isPublicIp, pinnedDnsResult, safeWebUrl } from "../lib/security.ts";
import { associationMatches, nameMatches } from "../lib/association.ts";
import { classifyRegistration } from "../lib/registration-classifier.ts";

test("aceita CNPJ válido encontrado no site e rejeita dígito inválido", () => {
  assert.equal(isValidCnpj("11.222.333/0001-81"), true);
  assert.equal(isValidCnpj("11.222.333/0001-82"), false);
  assert.deepEqual(extractCnpjs("<footer>CNPJ 11.222.333/0001-81</footer>"), [
    "11222333000181",
  ]);
});
test("não extrai CNPJ somente de scripts", () => {
  assert.deepEqual(
    extractCnpjs('<script>const cnpj="11.222.333/0001-81"</script>'),
    [],
  );
});
test("encontra CNPJ no rodapé fragmentado e em dados estruturados", () => {
  const footer =
    "<footer>CNPJ: <span>11</span>.<span>222</span>.<span>333</span>/<span>0001</span>-<span>81</span></footer>";
  assert.equal(extractCnpjEvidence(footer)[0]?.inFooter, true);
  assert.deepEqual(
    extractCnpjs(
      '<script type="application/ld+json">{"@type":"Organization","taxID":"11.222.333/0001-81"}</script>',
    ),
    ["11222333000181"],
  );
});
test("exige destino verificável de WhatsApp", () => {
  assert.equal(
    extractWhatsapp("<span>☎ WhatsApp</span>", "https://empresa.com.br"),
    null,
  );
  const result = extractWhatsapp(
    '<a href="https://api.whatsapp.com/send?phone=5511999998888&amp;text=Ola">Fale conosco</a>',
    "https://empresa.com.br/contato",
  );
  assert.equal(result?.number, "5511999998888");
  assert.equal(result?.source, "https://empresa.com.br/contato");
  assert.equal(
    extractWhatsapp(
      '<a href="//wa.me/5511999998888">WhatsApp</a>',
      "https://empresa.com.br",
    )?.number,
    "5511999998888",
  );
  assert.equal(
    extractWhatsapp(
      '<a href="https://wa.me/message/ABC123">WhatsApp</a>',
      "https://empresa.com.br",
    )?.number,
    null,
  );
  assert.equal(
    extractWhatsapp(
      '<a href="https://wa.me/">WhatsApp</a>',
      "https://empresa.com.br",
    ),
    null,
  );
});
test("associa marca publicada no site sem exigir palavra no domínio", () => {
  assert.equal(
    nameMatches("Casa Azul", "Casa Azul | móveis e decoração"),
    true,
  );
  const evidence = {
    cnpj: "11222333000181",
    context: "Casa Azul Ltda CNPJ 11.222.333/0001-81",
    labeled: true,
    inFooter: true,
  };
  const site = {
    text: "Loja Casa Azul em Curitiba",
    identityText: "Casa Azul | móveis",
    cnpjs: [evidence],
  };
  assert.equal(
    associationMatches(
      site,
      {
        nome_fantasia: "Casa Azul",
        razao_social: "Comercial de Móveis do Paraná Ltda",
        municipio: "Curitiba",
      },
      evidence,
    ),
    true,
  );
  assert.equal(
    associationMatches(
      { ...site, text: "Loja qualquer", identityText: "Loja qualquer" },
      { razao_social: "Empresa Alheia Ltda", municipio: "Recife" },
      evidence,
    ),
    false,
  );
});
test("distingue matriz ativa, filial e inativa", () => {
  assert.equal(
    classifyRegistration({
      identificador_matriz_filial: 1,
      descricao_identificador_matriz_filial: "MATRIZ",
      descricao_situacao_cadastral: "ATIVA",
    }),
    "approved",
  );
  assert.equal(
    classifyRegistration({
      identificador_matriz_filial: 2,
      descricao_identificador_matriz_filial: "FILIAL",
      descricao_situacao_cadastral: "ATIVA",
    }),
    "branch",
  );
  assert.equal(
    classifyRegistration({
      identificador_matriz_filial: 1,
      descricao_identificador_matriz_filial: "MATRIZ",
      descricao_situacao_cadastral: "BAIXADA",
    }),
    "inactive",
  );
});
test("bloqueia destinos internos e esquemas não HTTP", () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.1.1",
    "169.254.169.254",
    "192.168.1.2",
    "::1",
    "fc00::1",
  ])
    assert.equal(isPublicIp(ip), false);
  assert.throws(() => safeWebUrl("http://localhost:3000"));
  assert.throws(() => safeWebUrl("file:///etc/passwd"));
  assert.throws(() => safeWebUrl("http://169.254.169.254/latest/meta-data"));
  assert.equal(safeWebUrl("https://example.com.br").hostname, "example.com.br");
  assert.deepEqual(pinnedDnsResult("8.8.8.8", 4, true), [
    { address: "8.8.8.8", family: 4 },
  ]);
});
