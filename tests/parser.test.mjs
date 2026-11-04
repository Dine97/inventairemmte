// Tests de la lecture universelle des fichiers Excel des parcs (données fictives uniquement).
// Lancer : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
globalThis.XLSX = XLSX;
const { stkParseWorkbook, stkNormChassis, stkParseDate } = new Function(
  readFileSync(new URL("../stock-src/parser.js", import.meta.url), "utf8") + "\nreturn { stkParseWorkbook, stkNormChassis, stkParseDate };"
)();

// Fabrique un classeur à partir de feuilles { nom: [[ligne], ...] }
function book(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa, { cellDates: true }), name);
  return XLSX.read(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), { cellDates: true });
}
const VIN = ["JTDBR32E720123456", "VF1RFB00X51234567", "WVWZZZ1KZ6W123456", "KMHCT41BAEU123456", "SALLAAA146A123456"];

test("en-tête trouvé sous un titre, colonnes reconnues, dates lues", () => {
  const r = stkParseWorkbook(book({ Stock: [
    ["PARC FICTIF — ÉTAT DU STOCK"], [],
    ["N°", "N° CHASSIS", "MARQUE", "MODELE", "NAVIRE", "DATE D'ARRIVEE"],
    [1, VIN[0], "TOYOTA", "COROLLA", "MSC TEST", new Date(Date.UTC(2026, 0, 15))],
    [2, VIN[1], "RENAULT", "CLIO", "MSC TEST", "15/02/2026"],
  ] }));
  assert.equal(r.unique, 2);
  assert.equal(r.rows[0].chassis, VIN[0]);
  assert.equal(r.rows[0].marque, "TOYOTA");
  assert.equal(r.rows[0].date_arrivee, "2026-01-15");
  assert.equal(r.rows[1].date_arrivee, "2026-02-15");
  assert.equal(r.headerRow, 2);
});

test("colonne « marque / modèle » avec année en tête et marques en plusieurs mots", () => {
  const r = stkParseWorkbook(book({ Feuil1: [
    ["CHASSIS", "MARQUE MODELE", "DATE ARRIVEE"],
    [VIN[2], "2002 NISSAN MICRA", "01/03/2026"],
    [VIN[3], "MASSEY FERGUSON 375", "01/03/2026"],
    [VIN[4], "LAND ROVER DEFENDER 2015", "01/03/2026"],
  ] }));
  const byC = Object.fromEntries(r.rows.map((x) => [x.chassis, x]));
  assert.equal(byC[VIN[2]].marque, "NISSAN");
  assert.equal(byC[VIN[2]].annee, "2002");
  assert.equal(byC[VIN[3]].marque, "MASSEY FERGUSON");
  assert.equal(byC[VIN[4]].marque, "LAND ROVER");
});

test("châssis illisible : ligne signalée, pas importée", () => {
  const r = stkParseWorkbook(book({ Stock: [
    ["CHASSIS", "MARQUE", "NAVIRE", "DATE ARRIVEE"],
    [VIN[0], "TOYOTA", "NAVIRE A", "01/04/2026"],
    ["ILLISIBLE", "KIA", "NAVIRE A", "01/04/2026"],
  ] }));
  assert.equal(r.unique, 1);
  assert.equal(r.skipped.length, 1);
  assert.ok(r.anomalies.some((a) => a.code === "ligne_ignoree"));
});

test("doublons et date manquante signalés", () => {
  const r = stkParseWorkbook(book({ Stock: [
    ["CHASSIS", "MARQUE", "DATE ARRIVEE"],
    [VIN[0], "TOYOTA", "01/04/2026"],
    [VIN[0], "TOYOTA", "01/04/2026"],
    [VIN[1], "RENAULT", ""],
  ] }));
  assert.equal(r.unique, 2);
  assert.ok(r.anomalies.some((a) => a.code === "doublon"));
  assert.ok(r.anomalies.some((a) => a.code === "date_manquante"));
});

test("onglet des sorties distingué de l'onglet du stock", () => {
  const r = stkParseWorkbook(book({
    "STOCK": [["CHASSIS", "MARQUE", "DATE ARRIVEE"], [VIN[0], "TOYOTA", "01/04/2026"], [VIN[1], "RENAULT", "01/04/2026"]],
    "SORTIES": [["CHASSIS", "MARQUE", "DATE ARRIVEE"], [VIN[2], "VOLKSWAGEN", "01/03/2026"]],
  }));
  assert.equal(r.unique, 2);
  assert.deepEqual(r.declSorties, [VIN[2]]);
});

test("normalisation du châssis et des dates", () => {
  assert.equal(stkNormChassis(" jtd-br32 e72/0123456 "), "JTDBR32E720123456");
  assert.equal(stkParseDate("15/02/2026").iso, "2026-02-15");
  assert.equal(stkParseDate("2026-02-15").iso, "2026-02-15");
});
