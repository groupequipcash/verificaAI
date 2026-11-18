import test from "node:test";
import assert from "node:assert/strict";
import { extractCnpjs, isValidCnpj } from "../lib/cnpj-extractor.ts";
import { extractWhatsapp } from "../lib/whatsapp-extractor.ts";
import { isPublicIp, safeWebUrl } from "../lib/security.ts";

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
});
