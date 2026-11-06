// Le modèle Excel envoyé aux parcs est lu sans retouche
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
const parser = readFileSync(new URL("../stock-src/parser.js", import.meta.url), "utf8");
const v4 = readFileSync(new URL("../stock-src/stock_v4.jsx", import.meta.url), "utf8");
const pick = (name) => { const a = v4.indexOf("function " + name); const b = v4.indexOf("\nfunction ", a + 10); return v4.slice(a, b > 0 ? b : undefined).split("\nlet stkBulkSeq")[0]; };
const helpers = `function stkToday(){return "2026-11-10";} function stkAddDays(iso,n){const d=new Date(iso+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}`;
const api = new Function("XLSX", parser + helpers + pick("stkValidStockDate") + pick("stkGuessFileDate") + pick("stkGuessParc") +
  "\nreturn { stkParseWorkbook, stkGuessFileDate, stkGuessParc };")(XLSX);
const file = new URL("./fixtures/modele_rempli.xlsx", import.meta.url);

test("modèle rempli : en-tête, colonnes, total, sorties, parc et date", { skip: !existsSync(file) }, () => {
  const book = XLSX.read(readFileSync(file), { cellDates: true });
  const p = api.stkParseWorkbook(book, {});
  const st = p.sheets.find((s) => s.name === "STOCK");
  assert.ok(st, "onglet STOCK lu");
  assert.equal(st.role, "stock");
  assert.equal(st.headerLine, 9);
  for (const f of ["chassis", "marque", "modele", "annee", "navire", "manifeste", "bl", "date_arrivee", "date_transfert", "importateur"]) assert.ok(st.mapping[f] != null, "colonne " + f);
  assert.equal(p.sheets.filter((s) => s.role === "stock").length, 1, "le mode d'emploi n'ajoute aucun véhicule");
  assert.equal(p.rows.length, 4);
  assert.equal(p.rows[0].date_arrivee, "2026-06-08");
  assert.equal(Object.values(st.declared)[0], 4);
  assert.deepEqual(p.declSorties, ["VF1RFB00X52345678"]);
  assert.equal(api.stkGuessFileDate("etat.xlsx", book).date, "2026-11-09");
  assert.deepEqual(api.stkGuessParc("etat.xlsx", book, ["SOBENI", "SODESCY"], []), { parc: "SOBENI", how: "fichier" });
});
