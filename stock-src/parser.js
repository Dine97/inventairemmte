// ============================================================
// STOCK MMTE — Lecteur universel des fichiers de stock des parcs
// (xlsx, xls, xlsm, ods, csv — tous les onglets)
// ============================================================
const STK_FIELDS = {
  chassis: "Châssis",
  marque: "Marque",
  modele: "Modèle",
  marque_modele: "Marque / modèle",
  annee: "Année",
  navire: "Navire",
  date_arrivee: "Date d'arrivée",
  date_transfert: "Date de transfert",
  manifeste: "Manifeste / ATP",
  bl: "N° BL",
  importateur: "Importateur",
  statut: "Statut (fichier)",
  ignore: "— Ignorer —"
};
const STK_BASE_SYNONYMS = {
  chassis: ["CHASSIS", "NCHASSIS", "NOCHASSIS", "NUMEROCHASSIS", "NUMCHASSIS", "VIN", "NVIN", "CHASSISVIN", "NUMERODECHASSIS", "NDECHASSIS"],
  navire: ["NAVIRE", "NOMNAVIRE", "NOMDUNAVIRE", "BATEAU", "VESSEL", "NAVIRES", "NOMDENAVIRE"],
  date_arrivee: ["DATEARRIVEE", "ARRIVEE", "DATEDARRIVEE", "DATEENTREE", "DATEDENTREE", "DATEDEBARQUEMENT", "DATEARRIVE", "ARRIVE", "DATEARR"],
  date_transfert: ["TRANSFERT", "DATETRANSFERT", "DATEDETRANSFERT", "DATETRANSF"],
  marque_modele: ["MARQUEMODEL", "MARQUEMODELE", "MARQUETYPE", "MARQUEMODELANNE", "MARQUEMODELEANNEE", "MARQUEETMODELE", "VEHICULE", "DESIGNATION", "DESCRIPTION", "TYPEVEHICULE"],
  marque: ["MARQUE", "MARQUES"],
  modele: ["MODELE", "MODEL", "TYPE"],
  annee: ["ANNEE", "ANNEE1", "ANNE", "ANNEEFAB", "ANNEEDEFABRICATION", "AN", "MODELYEAR"],
  bl: ["BL", "NBL", "NUMBL", "NUMEROBL", "CONNAISSEMENT", "NCONNAISSEMENT", "NOBL"],
  manifeste: ["MANIFESTE", "NMANIFESTE", "NUMMANIFESTE", "ATP", "NATP"],
  importateur: ["IMPORTATEUR", "PROPRIETAIRE", "CLIENT", "DESTINATAIRE", "CONSIGNATAIRE"],
  statut: ["STATUT", "ETAT", "SITUATION", "STATUS"]
};
const STK_MULTI_BRANDS = ["SEMI REMORQUE", "SEMI RQ", "MASSEY FERGUSON", "MERCEDES BENZ", "LAND ROVER", "RANGE ROVER", "ALFA ROMEO", "ASTON MARTIN", "ROLLS ROYCE", "GREAT WALL", "RENAULT TRUCK", "RENAULT TRUCKS", "MERCEDES-BENZ", "LAND-ROVER"];
const STK_MONTHS = { JAN: 1, JANV: 1, JANVIER: 1, FEB: 2, FEV: 2, FEVR: 2, FEVRIER: 2, MAR: 3, MARS: 3, APR: 4, AVR: 4, AVRIL: 4, MAY: 5, MAI: 5, JUN: 6, JUIN: 6, JUL: 7, JUIL: 7, JUILLET: 7, AUG: 8, AOU: 8, AOUT: 8, SEP: 9, SEPT: 9, SEPTEMBRE: 9, OCT: 10, OCTOBRE: 10, NOV: 11, NOVEMBRE: 11, DEC: 12, DECEMBRE: 12 };

function stkNorm(s) {
  return String(s == null ? "" : s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function stkText(v) {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).replace(/\s+/g, " ").trim();
}
function stkNormChassis(v) {
  return String(v == null ? "" : v).toUpperCase().replace(/[\s\-\.\/_*]/g, "").trim();
}
function stkPad(n) { return String(n).padStart(2, "0"); }
function stkIso(y, m, d) {
  if (y < 100) y += y > 60 ? 1900 : 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1950 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${stkPad(m)}-${stkPad(d)}`;
}
// Renvoie { iso, fixed } ou null
function stkParseDate(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v)) {
    // SheetJS crée des dates locales à minuit : on arrondit à la journée la plus proche
    const t = new Date(v.getTime() + 12 * 3600 * 1e3);
    return { iso: stkIso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()), fixed: false };
  }
  if (typeof v === "number") {
    if (v > 20000 && v < 80000) {
      const d = new Date(Math.round((v - 25569) * 86400 * 1e3));
      return { iso: stkIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()), fixed: false };
    }
    return null;
  }
  let s = String(v).trim().toUpperCase();
  if (!s) return null;
  let fixed = false;
  const s2 = s.replace(/(^|[\/\-\.\s])O(?=\d)/g, "$10").replace(/(\d)O(?=[\/\-\.\s]|$)/g, "$10").replace(/(\d)O(\d)/g, "$10$2");
  if (s2 !== s) { fixed = true; s = s2; }
  let m = s.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/);
  if (m) { const iso = stkIso(+m[1], +m[2], +m[3]); return iso ? { iso, fixed } : null; }
  m = s.match(/^(\d{1,2})[\/\-\.\s](\d{1,2})[\/\-\.\s](\d{2,4})$/);
  if (m) { const iso = stkIso(+m[3], +m[2], +m[1]); return iso ? { iso, fixed } : null; }
  m = s.normalize("NFKD").replace(/[̀-ͯ]/g, "").match(/^(\d{1,2})[\s\-\.\/]*([A-Z]{3,9})\.?[\s\-\.\/]*(\d{2,4})$/);
  if (m && STK_MONTHS[m[2]]) { const iso = stkIso(+m[3], STK_MONTHS[m[2]], +m[1]); return iso ? { iso, fixed } : null; }
  m = s.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (m) { const iso = stkIso(+m[3], +m[2], +m[1]); return iso ? { iso, fixed: true } : null; }
  return null;
}
function stkLooksChassis(v) {
  const c = stkNormChassis(v);
  return c.length >= 11 && c.length <= 20 && /\d/.test(c) && /[A-Z]/.test(c);
}
function stkFieldForHeader(h, synonyms) {
  const n = stkNorm(h);
  if (!n) return null;
  for (const [f, list] of Object.entries(synonyms)) if (list.includes(n)) return f;
  // correspondance approchée
  if (/CHASSIS|^VIN/.test(n)) return "chassis";
  if (/NAVIRE|BATEAU|VESSEL/.test(n)) return "navire";
  if (/TRANSFERT/.test(n)) return "date_transfert";
  if (/ARRIV|DEBARQ|DATEENTR/.test(n)) return "date_arrivee";
  if (/MARQUE/.test(n) && /MODEL|TYPE/.test(n)) return "marque_modele";
  if (/MARQUE/.test(n)) return "marque";
  if (/MODEL/.test(n)) return "modele";
  if (/^ANNE/.test(n)) return "annee";
  if (/MANIFEST|^ATP/.test(n)) return "manifeste";
  if (/CONNAISS|^NBL$|^BL/.test(n)) return "bl";
  if (/IMPORTATEUR|PROPRIETAIRE|CLIENT/.test(n)) return "importateur";
  if (/STATUT|^ETAT/.test(n)) return "statut";
  return null;
}
function stkBuildSynonyms(extra) {
  const syn = {};
  for (const [k, v] of Object.entries(STK_BASE_SYNONYMS)) syn[k] = v.slice();
  (extra || []).forEach((e) => {
    if (!e || !e.field || !e.synonym) return;
    (syn[e.field] = syn[e.field] || []).push(stkNorm(e.synonym));
  });
  return syn;
}
function stkSplitMarqueModele(txt, wantYear) {
  let s = stkText(txt).replace(/\*+/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
  let annee = null;
  const lead = s.match(/^((?:19[5-9]\d|20[0-3]\d))\s+(.+)$/);
  if (lead) { annee = lead[1]; s = lead[2]; }
  if (wantYear && !annee) {
    const m = s.match(/(?:^|\s)((?:19[5-9]\d|20[0-3]\d))\s*$/);
    if (m) { annee = m[1]; s = s.slice(0, m.index).trim(); }
  }
  let marque = s, modele = "";
  const multi = STK_MULTI_BRANDS.find((b) => s === b || s.startsWith(b + " "));
  if (multi) { marque = multi.replace("-", " "); modele = s.slice(multi.length).trim(); }
  else { const i = s.indexOf(" "); if (i > 0) { marque = s.slice(0, i); modele = s.slice(i + 1).trim(); } }
  return { marque, modele, annee };
}
// Avancement de la lecture (utilisé par la lecture en arrière-plan)
let stkProgress = null;
function stkSheetRows(ws) {
  if (ws && ws.__rows) return ws.__rows; // lignes déjà extraites (lecture en arrière-plan)
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
  let off = 0;
  try { off = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]).s.r : 0; } catch (e) {}
  rows.offset = off;
  return rows;
}
function stkFindHeader(rows, synonyms) {
  const lim = Math.min(rows.length, 60);
  let best = null;
  for (let i = 0; i < lim; i++) {
    const r = rows[i] || [];
    const cells = r.map((c, j) => ({ j, c })).filter((x) => x.c != null && stkText(x.c) !== "");
    if (cells.length < 3) continue;
    const fields = cells.map((x) => stkFieldForHeader(x.c, synonyms)).filter(Boolean);
    const hasChassis = fields.includes("chassis");
    const score = new Set(fields).size + (hasChassis ? 5 : 0);
    if (hasChassis && (!best || score > best.score)) best = { row: i, score };
  }
  if (best) return best.row;
  // Pas d'en-tête reconnu : on cherche une colonne de châssis par son contenu
  for (let i = 0; i < lim; i++) {
    const next = rows.slice(i + 1, i + 15);
    const r = rows[i] || [];
    const width = Math.max(r.length, ...next.map((x) => (x || []).length));
    for (let j = 0; j < width; j++) {
      const vals = next.map((x) => x && x[j]).filter((v) => v != null && v !== "");
      if (vals.length >= 3 && vals.filter(stkLooksChassis).length / vals.length > 0.7) return i;
    }
  }
  return -1;
}
function stkAutoMapping(header, dataRows, synonyms) {
  const map = {};
  header.forEach((h, j) => {
    const f = stkFieldForHeader(h, synonyms);
    if (f && map[f] == null) map[f] = j;
  });
  // ATP + MANIFESTE : garder MANIFESTE, ATP en donnée annexe
  // Vérification par le contenu : la colonne châssis contient-elle vraiment des châssis ?
  const width = Math.max(header.length, ...dataRows.slice(0, 40).map((r) => (r || []).length));
  const ratio = (j) => {
    const vals = dataRows.slice(0, 80).map((r) => r && r[j]).filter((v) => v != null && v !== "");
    return vals.length ? vals.filter(stkLooksChassis).length / vals.length : 0;
  };
  if (map.chassis == null || ratio(map.chassis) < 0.3) {
    let bestJ = -1, bestR = 0;
    for (let j = 0; j < width; j++) { const r = ratio(j); if (r > bestR) { bestR = r; bestJ = j; } }
    if (bestJ >= 0 && bestR >= 0.5) map.chassis = bestJ;
  }
  // En-têtes décalés (cellules fusionnées) : si une colonne mappée est vide, prendre la voisine remplie
  const filled = (j) => dataRows.slice(0, 80).filter((r) => r && r[j] != null && r[j] !== "").length;
  for (const f of Object.keys(map)) {
    const j = map[f];
    if (filled(j) === 0) {
      for (const k of [j + 1, j - 1, j + 2]) {
        if (k >= 0 && filled(k) > 0 && !Object.values(map).includes(k)) { map[f] = k; break; }
      }
    }
  }
  // Colonne de dates non nommée
  if (map.date_arrivee == null) {
    for (let j = 0; j < width; j++) {
      if (Object.values(map).includes(j)) continue;
      const vals = dataRows.slice(0, 60).map((r) => r && r[j]).filter((v) => v != null && v !== "");
      if (vals.length >= 3 && vals.filter((v) => v instanceof Date).length / vals.length > 0.8) { map.date_arrivee = j; break; }
    }
  }
  return map;
}
function stkSheetRole(rows, headerRow, sheetName) {
  const texts = [];
  for (let i = 0; i < headerRow; i++) (rows[i] || []).forEach((c) => { const t = stkText(c); if (t && isNaN(Number(t))) texts.push(t); });
  const last = stkNorm(texts.length ? texts[texts.length - 1] : "");
  const name = stkNorm(sheetName);
  const role = (t) => /^STOCKENTREE|^ENTREES?(DE|DU|$)|^LISTEDESENTREES/.test(t) ? "entrees" : /^STOCKSORTIE|^SORTIES?(DE|DU|$)|^LISTEDESSORTIES/.test(t) ? "sorties" : null;
  return role(last) || role(name) || "stock";
}
function stkDeclared(rows, headerRow) {
  const out = {};
  const txt = [];
  for (let i = 0; i < rows.length; i++) {
    if (i >= headerRow && i < rows.length - 15) continue;
    (rows[i] || []).forEach((c) => { const t = stkText(c); if (t) txt.push(t); });
  }
  const all = txt.join(" | ").toUpperCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const grab = (re) => { const m = all.match(re); return m ? parseInt(m[1], 10) : null; };
  const si = grab(/STOCK\s*INITIAL\s*:?\s*(\d+)/), se = grab(/STOCK\s*ENTREES?\s*:?\s*(\d+)/), ss = grab(/STOCK\s*SORTIES?\s*:?\s*(\d+)/), sf = grab(/STOCK\s*FINAL\s*:?\s*(\d+)/);
  if (si != null) out.initial = si;
  if (se != null) out.entrees = se;
  if (ss != null) out.sorties = ss;
  if (sf != null) out.final = sf;
  const tot = grab(/(?:NBRE\s*TOTAL|TOTAL\s*GENERAL|NOMBRE\s*TOTAL)\s*:?\s*\|?\s*(\d+)/);
  if (tot != null) out.total = tot;
  // Ligne "TOTAL" avec un nombre en première colonne
  if (out.total == null) {
    for (let i = rows.length - 1; i > headerRow && i > rows.length - 15; i--) {
      const r = rows[i] || [];
      if (r.some((c) => stkNorm(c) === "TOTAL")) { const n = r.find((c) => typeof c === "number"); if (n != null) { out.total = n; break; } }
    }
  }
  return out;
}
function stkHeaderSignature(header) {
  return header.map(stkNorm).filter(Boolean).join("|");
}

// Lit une feuille avec un mapping (auto ou imposé)
function stkReadSheet(rows, headerRow, map, sheetName) {
  const off = rows.offset || 0;
  const skipped = [];
  const header = rows[headerRow] || [];
  const data = rows.slice(headerRow + 1);
  const anomalies = [];
  const out = [];
  // Fichier « groupé » (navire/date écrits seulement sur la 1re ligne du groupe) ?
  const chassisRows = data.filter((r) => r && r[map.chassis] != null && stkText(r[map.chassis]) !== "");
  let grouped = false;
  if (map.date_arrivee != null && chassisRows.length > 5) {
    const empty = chassisRows.filter((r) => r[map.date_arrivee] == null || stkText(r[map.date_arrivee]) === "").length;
    grouped = empty / chassisRows.length > 0.2 && chassisRows[0][map.date_arrivee] != null;
  }
  const fillFields = ["manifeste", "navire", "date_arrivee", "bl", "date_transfert"].filter((f) => map[f] != null);
  const carry = {};
  const wantYear = map.annee == null;
  data.forEach((r, idx) => {
    if (stkProgress && idx % 1000 === 0) stkProgress(idx, data.length, sheetName);
    if (!r) return;
    const line = off + headerRow + idx + 2;
    const rawC = r[map.chassis];
    const cTxt = stkText(rawC);
    if (!cTxt) {
      // ligne de groupe sans châssis : mémoriser navire/date
      return;
    }
    const chassis = stkNormChassis(cTxt);
    if (/^(TOTAL|CHASSIS|NBRE|NUMERO)/.test(chassis)) return;
    if (!/\d/.test(chassis) || chassis.length < 4) {
      if (r.filter((c) => c != null && stkText(c) !== "").length >= 3) skipped.push({ line, valeur: cTxt });
      return;
    }
    const get = (f) => {
      if (map[f] == null) return null;
      let v = r[map[f]];
      if (grouped && fillFields.includes(f)) {
        const has = v != null && stkText(v) !== "";
        if (has) carry[f] = v; else v = carry[f] != null ? carry[f] : null;
      }
      return v;
    };
    const rec = { chassis, chassis_raw: cTxt, line, sheet: sheetName, data: {}, flags: [] };
    // données brutes : toutes les colonnes nommées
    header.forEach((h, j) => {
      const key = stkText(h) || `Colonne ${j + 1}`;
      const v = r[j];
      if (v == null || stkText(v) === "") return;
      rec.data[key] = v instanceof Date ? stkParseDate(v).iso : (typeof v === "number" ? v : stkText(v));
    });
    let navire = get("navire"), dArr = get("date_arrivee");
    let pd = stkParseDate(dArr);
    if (!pd && dArr != null && stkText(dArr) !== "") {
      const alt = stkParseDate(navire);
      if (alt) { // colonnes inversées
        const n = navire; navire = dArr; dArr = n; pd = alt;
        rec.flags.push("colonnes_inversees");
      }
    }
    if (pd && pd.fixed) rec.flags.push("date_corrigee");
    rec.date_arrivee = pd ? pd.iso : null;
    if (!rec.date_arrivee) rec.flags.push(dArr != null && stkText(dArr) !== "" ? "date_illisible" : "date_manquante");
    const pt = stkParseDate(get("date_transfert"));
    rec.date_transfert = pt ? pt.iso : null;
    rec.navire = stkText(navire).toUpperCase() || null;
    rec.manifeste = stkText(get("manifeste")).toUpperCase() || null;
    rec.bl = stkText(get("bl")).toUpperCase() || null;
    rec.importateur = stkText(get("importateur")).toUpperCase() || null;
    rec.statut = stkText(get("statut")).toUpperCase() || null;
    let annee = map.annee != null ? stkText(get("annee")) : "";
    if (/^\d+\.0$/.test(annee)) annee = annee.slice(0, -2);
    if (map.marque_modele != null) {
      const sp = stkSplitMarqueModele(get("marque_modele"), wantYear);
      rec.marque = sp.marque || null; rec.modele = sp.modele || null; if (!annee && sp.annee) annee = sp.annee;
    } else {
      const mq = stkText(get("marque")).toUpperCase();
      const md = stkText(get("modele")).toUpperCase();
      if (mq && !md && mq.includes(" ")) {
        const sp = stkSplitMarqueModele(mq, wantYear);
        rec.marque = sp.marque; rec.modele = sp.modele || null; if (!annee && sp.annee) annee = sp.annee;
      } else { rec.marque = mq || null; rec.modele = md || null; }
    }
    rec.annee = annee || null;
    if (chassis.length !== 17 || /[IOQ]/.test(chassis)) rec.flags.push("chassis_atypique");
    out.push(rec);
  });
  return { rows: out, grouped, anomalies, skipped };
}

// Point d'entrée : analyse d'un classeur complet
// opts: { synonyms: [{field,synonym}], template: {signature, mapping, header_row, sheet} }
function stkParseWorkbook(wb, opts) {
  opts = opts || {};
  const synonyms = stkBuildSynonyms(opts.synonyms);
  const sheets = [];
  wb.SheetNames.forEach((name) => {
    const rows = stkSheetRows(wb.Sheets[name]);
    if (!rows.length) return;
    let headerRow = stkFindHeader(rows, synonyms);
    if (headerRow < 0 && !(opts.forced && opts.forced[name] && opts.forced[name].header_row != null)) return;
    if (headerRow < 0) headerRow = 0;
    let header = rows[headerRow] || [];
    let signature = stkHeaderSignature(header);
    const forced = opts.forced && opts.forced[name];
    const tpl = opts.templates && opts.templates.find((t) => t.signature === signature);
    let map;
    let source = "auto";
    if (forced) {
      if (forced.header_row != null) { headerRow = forced.header_row; header = rows[headerRow] || []; signature = stkHeaderSignature(header); }
      map = forced.mapping && Object.keys(forced.mapping).length ? forced.mapping : stkAutoMapping(header, rows.slice(headerRow + 1), synonyms);
      source = "manuel";
    }
    else if (tpl) { map = tpl.mapping; source = "modele"; }
    else map = stkAutoMapping(header, rows.slice(headerRow + 1), synonyms);
    if (map.chassis == null) return;
    map = Object.fromEntries(Object.entries(map).filter(([k, v]) => k !== "ignore" && v != null));
    const role = stkSheetRole(rows, headerRow, name);
    const read = stkReadSheet(rows, headerRow, map, name);
    if (!read.rows.length) return;
    sheets.push({
      name, role, headerRow, headerLine: (rows.offset || 0) + headerRow + 1, header: header.map(stkText), mapping: map, source, signature,
      rows: read.rows, grouped: read.grouped, skipped: read.skipped, declared: stkDeclared(rows, headerRow)
    });
  });
  const stockSheets = sheets.filter((s) => s.role === "stock");
  const rows = [];
  stockSheets.forEach((s) => s.rows.forEach((r) => { if (stockSheets.length > 1) r.data.Onglet = s.name; rows.push(r); }));
  // Doublons dans le fichier
  const seen = new Map();
  const duplicates = [];
  rows.forEach((r) => {
    if (seen.has(r.chassis)) { duplicates.push({ chassis: r.chassis, lines: [seen.get(r.chassis).line, r.line] }); r.flags.push("doublon"); seen.get(r.chassis).flags.includes("doublon") || seen.get(r.chassis).flags.push("doublon"); }
    else seen.set(r.chassis, r);
  });
  const declared = Object.assign({}, ...stockSheets.map((s) => s.declared));
  const declEntrees = [], declSorties = [];
  sheets.filter((s) => s.role === "entrees").forEach((s) => s.rows.forEach((r) => declEntrees.push(r.chassis)));
  sheets.filter((s) => s.role === "sorties").forEach((s) => s.rows.forEach((r) => declSorties.push(r.chassis)));
  const count = (f) => rows.filter((r) => r.flags.includes(f)).length;
  const unique = seen.size;
  const anomalies = [];
  if (duplicates.length) anomalies.push({ code: "doublon", niveau: "erreur", texte: `${duplicates.length} châssis apparaissent plusieurs fois dans le fichier`, items: duplicates.map((d) => d.chassis) });
  if (count("chassis_atypique")) anomalies.push({ code: "chassis_atypique", niveau: "alerte", texte: `${count("chassis_atypique")} châssis atypiques (pas 17 caractères ou lettres I/O/Q) à vérifier`, items: rows.filter((r) => r.flags.includes("chassis_atypique")).map((r) => r.chassis) });
  if (count("date_manquante") + count("date_illisible")) anomalies.push({ code: "date_manquante", niveau: "alerte", texte: `${count("date_manquante") + count("date_illisible")} véhicules sans date d'arrivée lisible (date de dépôt impossible à calculer)`, items: rows.filter((r) => !r.date_arrivee).map((r) => r.chassis) });
  if (count("date_corrigee")) anomalies.push({ code: "date_corrigee", niveau: "info", texte: `${count("date_corrigee")} dates corrigées automatiquement (ex. lettre O au lieu du zéro)`, items: rows.filter((r) => r.flags.includes("date_corrigee")).map((r) => r.chassis) });
  if (count("colonnes_inversees")) anomalies.push({ code: "colonnes_inversees", niveau: "info", texte: `${count("colonnes_inversees")} lignes avec navire et date inversés, remises en ordre`, items: rows.filter((r) => r.flags.includes("colonnes_inversees")).map((r) => r.chassis) });
  const skipped = [].concat(...stockSheets.map((s) => s.skipped.map((k) => Object.assign({ onglet: s.name }, k))));
  if (skipped.length) anomalies.push({ code: "ligne_ignoree", niveau: "alerte", texte: `${skipped.length} ligne(s) ignorée(s) : châssis absent ou illisible (${skipped.slice(0, 3).map((k) => "ligne " + k.line + " : « " + k.valeur + " »").join(", ")})`, items: skipped.map((k) => "Ligne " + k.line + " : " + k.valeur) });
  const announced = declared.final != null ? declared.final : declared.total;
  if (announced != null && announced !== rows.length) anomalies.push({ code: "total_annonce", niveau: "alerte", texte: `Le parc annonce ${announced} véhicules, ${rows.length} lignes lues (${unique} châssis uniques)` });
  return {
    sheets, rows, unique, duplicates, skipped, declared, declEntrees, declSorties, anomalies,
    signature: stockSheets[0] ? stockSheets[0].signature : "",
    headerRow: stockSheets[0] ? stockSheets[0].headerRow : null,
    mapping: stockSheets[0] ? stockSheets[0].mapping : null
  };
}
