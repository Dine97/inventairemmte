// Lecture de la date du stock dans le nom d'un fichier (import groupé, reprise de l'historique)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const parser = readFileSync(new URL("../stock-src/parser.js", import.meta.url), "utf8");
const v4 = readFileSync(new URL("../stock-src/stock_v4.jsx", import.meta.url), "utf8");
const pick = (name) => { const a = v4.indexOf("function " + name); const b = v4.indexOf("\nfunction ", a + 10); return v4.slice(a, b > 0 ? b : undefined).split("\nlet stkBulkSeq")[0]; };
const helpers = `function stkToday(){return "2026-11-05";} function stkAddDays(iso,n){const d=new Date(iso+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}`;
const { stkGuessFileDate } = new Function(parser + helpers + pick("stkValidStockDate") + pick("stkGuessFileDate") + "\nreturn { stkGuessFileDate };")();
const book = { SheetNames: ["S"], Sheets: { S: {} } };

test("dates dans le nom du fichier", () => {
  assert.equal(stkGuessFileDate("Original_inventaire_infobrima_261101.xlsx", book).date, "2026-11-01");
  assert.equal(stkGuessFileDate("STOCK GTS 02-11-2026.xls", book).date, "2026-11-02");
  assert.equal(stkGuessFileDate("stock_2026_10_26.xlsx", book).date, "2026-10-26");
  assert.equal(stkGuessFileDate("SOBENI 19.10.26.xlsx", book).date, "2026-10-19");
  assert.equal(stkGuessFileDate("ETAT 12102026.xlsx", book).date, "2026-10-12");
});
test("pas de date inventée", () => {
  assert.equal(stkGuessFileDate("STOCK_RITIS3.xls", book).date, null);
  assert.equal(stkGuessFileDate("stock 2027-01-15.xlsx", book).date, null); // dans le futur
});
