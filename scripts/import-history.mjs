import { readFile } from "node:fs/promises";
import { normalizeCompanyIdentity, reserveIdentity, assertGlobalHistoryAvailable } from "../lib/global-history.ts";

// Accepts CSV files exported by the existing browser UI. No public API is created.
function parseCsv(input) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ';') { row.push(cell); cell = ""; }
    else if (char === '\n') { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (quoted) throw new Error("CSV incompleto: aspas não fechadas.");
  if (cell || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  return rows;
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const files = args.filter((arg) => arg !== "--apply");
if (!files.length) {
  console.error("Uso: node scripts/import-history.mjs [--apply] historico-operador-1.csv ...");
  process.exitCode = 1;
} else {
  try {
    const records = [];
    let invalid = 0;
    for (const file of files) {
      const rows = parseCsv((await readFile(file, "utf8")).replace(/^\uFEFF/, ""));
      const header = rows.shift()?.map((value) => value.trim().toLowerCase());
      const cnpjIndex = header?.indexOf("cnpj") ?? -1;
      const siteIndex = header?.indexOf("site") ?? -1;
      if (cnpjIndex < 0 || siteIndex < 0) throw new Error(`Colunas CNPJ/Site ausentes em ${file}`);
      for (const row of rows) {
        if (row.every((value) => !value.trim())) continue;
        try { records.push(normalizeCompanyIdentity(row[cnpjIndex] || "", row[siteIndex] || "")); }
        catch { invalid++; }
      }
    }
    const unique = [];
    const cnpjs = new Set(), domains = new Set();
    for (const record of records) {
      if (cnpjs.has(record.cnpj) || domains.has(record.domain)) continue;
      cnpjs.add(record.cnpj); domains.add(record.domain); unique.push(record);
    }
    console.log(`Arquivos: ${files.length}; linhas válidas: ${records.length}; únicas: ${unique.length}; inválidas: ${invalid}.`);
    if (!apply) console.log("Prévia somente. Repita com --apply para registrar no histórico global.");
    else {
      await assertGlobalHistoryAvailable();
      let imported = 0, existing = 0;
      for (const record of unique) {
        if (await reserveIdentity(record.cnpj, record.domain)) imported++;
        else existing++;
      }
      console.log(`Importadas: ${imported}; já registradas globalmente: ${existing}. Históricos locais preservados.`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Falha na importação.");
    process.exitCode = 1;
  }
}
