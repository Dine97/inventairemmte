// ============================================================
// STOCK MMTE — Revue des anomalies avant import : corriger, exclure ou accepter tel quel
// ============================================================

// Corrections de châssis mémorisées (faute de frappe d'un parc corrigée une fois pour toutes)
function stkApplyAliases(parsed, aliases) {
  const map = {};
  (aliases || []).forEach((a) => { if (a && a.alias && a.chassis && a.alias !== a.chassis) map[a.alias] = a.chassis; });
  let n = 0;
  parsed.rows.forEach((r) => {
    const to = map[r.chassis];
    if (!to) return;
    r.alias_from = r.chassis; r.chassis = to; n++;
    if (to.length === 17 && !/[IOQ]/.test(to)) r.flags = r.flags.filter((f) => f !== "chassis_atypique");
  });
  if (n) parsed.anomalies = parsed.anomalies.filter((a) => a.code !== "chassis_atypique").concat(
    parsed.rows.some((r) => r.flags.includes("chassis_atypique")) ? [{ code: "chassis_atypique", niveau: "alerte", texte: `${parsed.rows.filter((r) => r.flags.includes("chassis_atypique")).length} châssis atypiques (pas 17 caractères ou lettres I/O/Q) à vérifier`, items: parsed.rows.filter((r) => r.flags.includes("chassis_atypique")).map((r) => r.chassis) }] : [],
    [{ code: "alias_applique", niveau: "info", texte: `${n} châssis corrigé(s) automatiquement grâce aux corrections déjà mémorisées`, items: parsed.rows.filter((r) => r.alias_from).map((r) => `${r.alias_from} → ${r.chassis}`) }]);
  return parsed;
}

const stkRowKey = (r) => `${r.sheet || ""}:${r.line}`;

// ---- 6.18 : pour chaque point, Garder tel quel / Corriger (proposition de l'outil) / Refuser ----
const stkJunkChassis = (c) => !c || c.length < 5 || /^(.)\1+$/.test(c) || !/\d/.test(c);
const stkFixLetters = (c) => String(c).replace(/O/g, "0").replace(/Q/g, "0").replace(/I/g, "1");
const stkNavKey = (n) => String(n || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
function stkSwapDM(iso) { const [y, m, d] = String(iso).split("-"); if (!d || +d > 12 || d === m) return null; return `${y}-${d}-${m}`; }
function stkYearBack(iso, ref) { const y = +String(iso).slice(0, 4); for (let k = 1; k <= 2; k++) { const v = `${y - k}${String(iso).slice(4)}`; if (v <= ref) return v; } return null; }
// Date d'arrivée la plus fréquente de chaque navire (dans le fichier et parmi les dates déjà connues)
function stkNavireDates(rows, connus, stockDate) {
  const m = {};
  rows.forEach((r) => { const d = r.date_arrivee || connus[r.chassis]; const k = stkNavKey(r.navire); if (!k || !d || d > stockDate) return; ((m[k] = m[k] || {})[d] = (m[k][d] || 0) + 1); });
  const out = {};
  Object.entries(m).forEach(([k, ds]) => { const [d, n] = Object.entries(ds).sort((a, b) => b[1] - a[1])[0]; out[k] = { date: d, n }; });
  return out;
}
function stkSugChassis(c, ctx) {
  const p = ctx.proches[c];
  const reason = (from, to) => (/[IOQ]/.test(from) && stkFixLetters(from) === to ? "Lettre O, I ou Q au lieu de 0 ou 1" : from.length > to.length ? `${from.length} caractères : un caractère en trop` : from.length < to.length ? `${from.length} caractères : un caractère manquant` : "1 ou 2 caractères différents");
  if (p) return { val: p.match, why: `${reason(c, p.match)} · ${p.ici ? "déjà au stock de ce parc" : p.present ? `présent chez ${p.parc}` : "véhicule déjà connu (sorti)"}`, conf: p.ici || (p.distance === 1 && p.present) ? "sur" : "probable", act: "corriger" };
  if (stkJunkChassis(c)) return { val: "", why: "Numéro sans valeur", conf: null, act: "refuser" };
  const f = stkFixLetters(c);
  if (f !== c && f.length === 17) return { val: f, why: "Lettre O, I ou Q au lieu de 0 ou 1" + (/^[1-5]/.test(f) && stkVinCheck(f) ? " · clé de contrôle cohérente" : ""), conf: "probable", act: "corriger" };
  if (c.length < 17) return { val: "", why: "Format court : engin, remorque ou ancien modèle", conf: null, act: "garder" };
  return { val: "", why: "Aucun véhicule connu à 1 ou 2 caractères près", conf: null, act: "garder" };
}
function stkSugDate(r, ctx) {
  const k = ctx.connus[r.chassis];
  if (k && k <= ctx.stockDate) return { val: k, why: "Date déjà connue pour ce châssis", conf: "sur", act: "corriger" };
  const n = ctx.navires[stkNavKey(r.navire)];
  if (n) return { val: n.date, why: `Date des autres véhicules du navire ${r.navire} (${n.n})`, conf: "probable", act: "corriger" };
  if (r.date_transfert && r.date_transfert <= ctx.stockDate) return { val: r.date_transfert, why: "Date de transfert indiquée dans le fichier", conf: "probable", act: "corriger" };
  return { val: "", why: "Aucune date retrouvée : à saisir ou à laisser vide", conf: null, act: "garder" };
}
function stkSugFutur(r, ctx) {
  const sd = ctx.stockDate, out = {}, why = [];
  let conf = "sur";
  ["date_arrivee", "date_transfert"].forEach((f) => {
    const v = r[f]; if (!v || v <= sd) return;
    const k = f === "date_arrivee" && ctx.connus[r.chassis];
    if (k && k <= sd) { out[f] = k; why.push(`${stkFmt(v)} → ${stkFmt(k)} : date déjà connue`); return; }
    const sw = stkSwapDM(v);
    if (sw && sw <= sd) { out[f] = sw; why.push(`${stkFmt(v)} → ${stkFmt(sw)} : jour et mois inversés`); conf = "probable"; return; }
    const y = stkYearBack(v, sd);
    if (y) { out[f] = y; why.push(`${stkFmt(v)} → ${stkFmt(y)} : erreur d'année`); conf = "probable"; return; }
    out[f] = ""; why.push(`${stkFmt(v)} : à effacer`); conf = "probable";
  });
  return { val: out, why: why.join(" · "), conf, act: "corriger" };
}
const stkRowFill = (r) => ["marque", "modele", "annee", "navire", "manifeste", "bl", "date_arrivee", "date_transfert", "importateur"].filter((f) => r[f]).length;
const stkRowSig = (r) => ["marque", "modele", "annee", "navire", "manifeste", "bl", "date_arrivee", "date_transfert", "importateur"].map((f) => String(r[f] || "")).join("|");

// Points à décider, avec une proposition pour chaque ligne concernée
function stkBuildIssues(parsed, preview, stockDate, prevCount) {
  if (!parsed || !parsed.rows.length) return [];
  const P = preview || {};
  const connus = P.connus || {};
  const ctx = { stockDate, connus, proches: Object.fromEntries((P.proches || []).map((x) => [x.chassis, x])), navires: stkNavireDates(parsed.rows, connus, stockDate) };
  const row = (r, sug, extra) => ({ k: stkRowKey(r), r, chassis: r.chassis, line: r.line, sug, ...(extra || {}) });
  const out = [];
  if (prevCount && prevCount >= 20 && parsed.unique < prevCount * 0.7) out.push({ key: "incomplet", code: "fichier_incomplet", global: true, rows: [], absents: P.sorties || [],
    title: `Fichier probablement incomplet : ${parsed.unique} véhicules contre ${prevCount} au dernier stock du parc (−${Math.round((1 - parsed.unique / prevCount) * 100)} %)`,
    help: `Validé tel quel, il enregistrerait ${(P.sorties || []).length || "de nombreuses"} sorties. Un tel écart vient souvent d'un onglet oublié, d'un filtre resté actif dans Excel ou d'un fichier coupé.` });
  const newSet = P.entrees && !P.is_initial ? new Set(P.entrees) : null;
  const atyp = parsed.rows.filter((r) => r.flags.includes("chassis_atypique") && (!newSet || newSet.has(r.chassis)));
  if (atyp.length) out.push({ key: "atypique", code: "chassis_atypique", rows: atyp.map((r) => row(r, stkSugChassis(r.chassis, ctx))),
    title: `${atyp.length} châssis atypique(s)${newSet ? " parmi les nouveaux véhicules" : ""}`,
    help: "L'outil a cherché le bon numéro : lettres O, I ou Q à la place de 0 ou 1, caractère en trop ou manquant, véhicule déjà connu à 1 ou 2 caractères près. Les engins et remorques ont souvent un numéro court : gardez-les." });
  const atypSet = new Set(atyp.map((r) => r.chassis));
  if (P.entrees && P.sorties && !P.is_initial) {
    const seen = new Set();
    const pairs = stkTypoPairs(P.entrees, P.sorties).filter((t) => !atypSet.has(t.entree) && !seen.has(t.entree) && seen.add(t.entree)).sort((a, b) => a.distance - b.distance);
    const typos = pairs.map((t) => { const r = parsed.rows.find((x) => x.chassis === t.entree); return r && row(r, { val: t.sortie, why: `Même véhicule que ${t.sortie}, absent de ce fichier (${t.distance} caractère${t.distance > 1 ? "s" : ""} de différence)`, conf: t.distance === 1 ? "sur" : "probable", act: "corriger" }); }).filter(Boolean);
    if (typos.length) out.push({ key: "typo", code: "faute_frappe", rows: typos,
      title: `${typos.length} entrée(s) qui ressemblent à une sortie à 1 ou 2 caractères près`,
      help: "Probablement le même véhicule mal saisi par le parc. Corriger évite d'enregistrer une fausse sortie et une fausse entrée." });
  }
  const noDate = parsed.rows.filter((r) => !r.date_arrivee);
  if (noDate.length) out.push({ key: "sans_date", code: "date_manquante", rows: noDate.map((r) => row(r, stkSugDate(r, ctx))),
    title: `${noDate.length} véhicule(s) sans date d'arrivée${noDate.length === parsed.rows.length ? " (aucune date lue dans tout le fichier)" : ""}`,
    help: "Sans date d'arrivée, la date de dépôt ne peut pas être calculée. L'outil reprend la date déjà connue du châssis, sinon celle des autres véhicules du même navire." + (noDate.length === parsed.rows.length ? " Si le fichier contient bien une colonne de date d'arrivée, indiquez-la avec « Indiquer la colonne »." : "") });
  const fut = parsed.rows.filter((r) => (r.date_arrivee && r.date_arrivee > stockDate) || (r.date_transfert && r.date_transfert > stockDate));
  if (fut.length) out.push({ key: "futur", code: "date_future", rows: fut.map((r) => row(r, stkSugFutur(r, ctx))),
    title: `${fut.length} date(s) postérieure(s) à la date du stock (${stkFmt(stockDate)})`,
    help: "Une date dans le futur est presque toujours une erreur de saisie : jour et mois inversés ou mauvaise année." });
  if (parsed.duplicates && parsed.duplicates.length) {
    const groups = parsed.duplicates.map((d) => { const rs = parsed.rows.filter((r) => r.chassis === d.chassis); const same = new Set(rs.map(stkRowSig)).size === 1; const best = rs.slice().sort((a, b) => stkRowFill(b) - stkRowFill(a))[0];
      return { k: "c:" + d.chassis, chassis: d.chassis, line: rs.map((r) => r.line).join(", "), lines: rs, r: null,
        sug: same ? { val: stkRowKey(rs[0]), why: "Lignes identiques : une seule est gardée", conf: "sur", act: "garder" } : { val: stkRowKey(best), why: `Informations différentes : la ligne ${best.line} est la plus complète`, conf: "probable", act: "corriger" } }; });
    out.push({ key: "doublon", code: "doublon", rows: groups, title: `${groups.length} châssis présent(s) plusieurs fois dans le fichier`, help: "Une seule ligne par châssis est enregistrée : choisissez laquelle, ou refusez le châssis." });
  }
  if (P.reapparus && P.reapparus.length) {
    const det = Object.fromEntries((P.reapparus_detail || []).map((x) => [x.chassis, x]));
    const rs = P.reapparus.map((c) => { const r = parsed.rows.find((x) => x.chassis === c); const d = det[c]; return r && row(r, { val: "", why: d ? `Sorti le ${stkFmt(d.exit_date)} de ${d.parc}${d.justif_numero ? ` (déclaration ${d.justif_numero})` : ""} : gardé, il redevient présent` : "Déjà sorti : gardé, il redevient présent", conf: null, act: "garder" }); }).filter(Boolean);
    if (rs.length) out.push({ key: "reapparus", code: "reapparu", rows: rs, title: `${rs.length} véhicule(s) déjà sorti(s) qui réapparaissent`, help: "Un véhicule sorti ne revient normalement pas. Gardez-le s'il est vraiment revenu au parc, refusez la ligne si c'est une erreur du fichier." });
  }
  if (parsed.skipped && parsed.skipped.length) out.push({ key: "ignorees", code: "ligne_ignoree", noKeep: true,
    rows: parsed.skipped.map((k) => ({ k: "l:" + k.line, chassis: "", line: k.line, valeur: k.valeur, r: null, sug: { val: "", why: "Pas de numéro de châssis lisible : saisissez-le pour ajouter la ligne", conf: null, act: "refuser" } })),
    title: `${parsed.skipped.length} ligne(s) sans châssis lisible`, help: "Ces lignes ont des informations mais pas de numéro de châssis exploitable." });
  const tot = parsed.anomalies.find((a) => a.code === "total_annonce");
  if (tot) out.push({ key: "total", code: "total_annonce", global: true, rows: [], title: tot.texte, help: "Le total annoncé par le parc ne correspond pas au nombre de lignes lues : une partie du tableau a peut-être été oubliée." });
  return out;
}
const stkIsPending = (i, D) => !D[i.key] || D[i.key].status === "partiel";
function stkPendingIssues(issues, decisions) { const D = decisions || {}; return issues.filter((i) => stkIsPending(i, D)); }
const stkActOf = (d, x) => ((d && d.acts) || {})[x.k] || (d && d.status === "partiel" ? "garder" : x.sug.act);
const stkValOf = (d, x) => (((d && d.vals) || {})[x.k] !== undefined ? d.vals[x.k] : x.sug.val);

// Lignes à enregistrer après les décisions, corrections à mémoriser et anomalies annotées
function stkApplyDecisions(parsed, issues, decisions, byName) {
  if (!parsed) return null;
  const D = decisions || {};
  const rows = parsed.rows.map((r) => ({ ...r }));
  const byKey = {}; rows.forEach((r) => (byKey[stkRowKey(r)] = r));
  const ex = new Set(), exCh = new Set(), extra = [], aliases = [], summary = {};
  let refused = null, absents = null;
  const rename = (r, to, remember) => { const c = stkNormChassis(to); if (!r || !c || c === r.chassis) return false; if (remember !== false) aliases.push({ alias: r.chassis, chassis: c }); r.chassis_raw = r.chassis_raw || r.chassis; r.corrige_de = r.chassis; r.chassis = c; return true; };
  issues.forEach((i) => {
    const d = D[i.key];
    // doublons gardés tels quels : seule la première ligne de chaque châssis est enregistrée
    if (d && d.status === "accepte" && i.key === "doublon") { i.rows.forEach((x) => x.lines.slice(1).forEach((r) => ex.add(stkRowKey(r)))); return; }
    if (!d || d.status === "accepte") return;
    if (d.status === "refuse") {
      if (i.global) { refused = refused || i.title; summary[i.key] = "fichier refusé"; return; }
      i.rows.forEach((x) => (x.lines ? exCh.add(x.chassis) : x.r ? ex.add(x.k) : null));
      summary[i.key] = `${i.rows.length} refusé(s)`; return;
    }
    if (i.key === "incomplet") {
      if (d.mode === "sans_sorties") absents = i.absents || [];
      return;
    }
    let nc = 0, nr = 0;
    i.rows.forEach((x) => {
      const act = stkActOf(d, x), v = stkValOf(d, x);
      if (i.key === "doublon") {
        if (act === "refuser") { exCh.add(x.chassis); nr++; return; }
        const keep = act === "corriger" ? v : stkRowKey(x.lines[0]);
        x.lines.forEach((r) => { if (stkRowKey(r) !== keep) ex.add(stkRowKey(r)); });
        if (act === "corriger") nc++;
        return;
      }
      if (act === "refuser") { if (x.r) { ex.add(x.k); nr++; } return; }
      if (act !== "corriger") return;
      const r = x.r ? byKey[x.k] : null;
      if (i.key === "atypique" || i.key === "typo") { if (rename(r, v, d.remember)) nc++; }
      else if (i.key === "sans_date") { if (r && v) { r.date_arrivee = v; r.date_saisie = true; nc++; } }
      else if (i.key === "futur") { if (r && v) { Object.entries(v).forEach(([f, val]) => (r[f] = val || null)); nc++; } }
      else if (i.key === "ignorees") { const c = stkNormChassis(v); if (c.length >= 4) { extra.push({ chassis: c, chassis_raw: String(v).trim(), line: x.line, sheet: "", data: {}, flags: ["ajoute"] }); nc++; } }
    });
    summary[i.key] = `${nc} corrigé(s), ${nr} refusé(s)`;
  });
  let kept = rows.filter((r) => !ex.has(stkRowKey(r)) && !exCh.has(r.chassis)).concat(extra);
  if (absents) {
    // véhicules absents du fichier gardés en stock (sauf ceux retrouvés par une correction de châssis)
    const have = new Set(kept.map((r) => r.chassis));
    const add = absents.filter((c) => !have.has(c));
    kept = kept.concat(add.map((c) => ({ chassis: c, line: 0, sheet: "(absent du fichier)", data: {}, flags: ["non_declare"] })));
    summary.incomplet = `${add.length} véhicule(s) absent(s) du fichier gardés en stock, non comptés comme sortis`;
  }
  const codeOf = {}; issues.forEach((i) => (codeOf[i.code] = i.key));
  const who = byName || "l'agent";
  const decided = (key) => { const d = D[key]; if (!d) return null; return d.status === "accepte" ? `Accepté tel quel par ${who}` : d.status === "refuse" ? `Refusé par ${who}` : `Corrigé par ${who} : ${summary[key] || ""}`; };
  const anomalies = parsed.anomalies.map((a) => (codeOf[a.code] && D[codeOf[a.code]] ? { ...a, decision: decided(codeOf[a.code]) } : a));
  const known = new Set(parsed.anomalies.map((a) => a.code));
  issues.filter((i) => !known.has(i.code)).forEach((i) => anomalies.push({ code: i.code, niveau: i.global ? "erreur" : "alerte", texte: i.title, items: i.rows.map((x) => x.chassis || x.valeur).filter(Boolean), decision: decided(i.key) }));
  return { rows: kept, aliases, anomalies, excluded: rows.length !== kept.length || extra.length ? 1 : 0, refused };
}

// Message prêt à envoyer au parc quand le fichier est refusé
function StkRefusalBox({ parc, date, reason }) {
  const [copied, setCopied] = useState(false);
  const txt = `Bonjour,\n\nLe fichier de stock du parc ${String(parc || "").toUpperCase()} pour le ${stkFmt(date)} n'a pas pu être enregistré : ${reason}.\nMerci de nous renvoyer le fichier complet (tous les onglets, sans filtre actif).\n\nCordialement,\nBénin Control — MAD-MAE`;
  return <StkMsg tone="err"><div className="space-y-2" data-testid="refusal-box">
    <div><b>Fichier refusé : rien ne sera enregistré.</b> Message prêt à envoyer au parc :</div>
    <textarea readOnly value={txt} rows={7} className="w-full rounded-lg border border-rose-200 bg-white p-2 text-sm text-slate-700" />
    <div className="flex flex-wrap gap-2"><StkBtn small onClick={() => { try { navigator.clipboard.writeText(txt); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch (e) {} }}>{copied ? "Copié" : "Copier le message"}</StkBtn>
      <StkBtn small kind="ghost" onClick={() => { window.location.href = `mailto:?subject=${encodeURIComponent(`Fichier de stock ${String(parc || "").toUpperCase()} du ${stkFmt(date)} à renvoyer`)}&body=${encodeURIComponent(txt)}`; }}>Ouvrir dans la messagerie</StkBtn></div>
  </div></StkMsg>;
}

const STK_DEC_TONE = { todo: "bg-amber-50 text-amber-900 border-amber-300", partiel: "bg-amber-50 text-amber-900 border-amber-300", accepte: "bg-slate-100 text-slate-700 border-slate-300", corrige: "bg-emerald-50 text-emerald-800 border-emerald-200", refuse: "bg-rose-50 text-rose-800 border-rose-200" };
const STK_DEC_LABEL = { todo: "À décider", partiel: "En partie décidé", accepte: "Gardé tel quel", corrige: "Corrigé", refuse: "Refusé" };
const STK_CONF = { sur: ["SÛR", "bg-emerald-100 text-emerald-800"], probable: ["PROBABLE", "bg-amber-100 text-amber-800"] };

// Revue des points à décider (écran d'import et import groupé)
function StkAnomalyReview({ issues, decisions, setDecisions, stockDate, onEditColumns }) {
  const [open, setOpen] = useState(null);
  const [draft, setDraft] = useState({});
  const [filter, setFilter] = useState("");
  const [same, setSame] = useState("");
  if (!issues.length) return <StkMsg tone="ok">Aucun point à vérifier dans ce fichier.</StkMsg>;
  const D = decisions || {};
  const pending = stkPendingIssues(issues, D);
  const set = (key, val) => setDecisions((d) => { const n = { ...d }; if (val) n[key] = val; else delete n[key]; return n; });
  const props = (i) => i.rows.filter((x) => x.sug.act === "corriger");
  const sure = (i) => i.rows.filter((x) => x.sug.act === "corriger" && x.sug.conf === "sur");
  const nSure = pending.filter((i) => !i.global).reduce((a, i) => a + sure(i).length, 0);
  const nProps = issues.filter((i) => !i.global).reduce((a, i) => a + props(i).length, 0);
  const applySure = () => setDecisions((d) => {
    const n = { ...d };
    pending.filter((i) => !i.global).forEach((i) => {
      const acts = { ...((n[i.key] || {}).acts || {}) };
      let all = true;
      i.rows.forEach((x) => { if (x.sug.conf === "sur") acts[x.k] = x.sug.act; else if (!acts[x.k]) all = false; });
      if (Object.keys(acts).length) n[i.key] = { ...(n[i.key] || {}), status: all ? "corrige" : "partiel", acts, remember: true };
    });
    return n;
  });
  const keepAll = () => { if (!window.confirm(`Garder tels quels les ${pending.length} point(s) restant(s) ?`)) return; setDecisions((d) => { const n = { ...d }; pending.forEach((i) => (n[i.key] = { status: "accepte" })); return n; }); setOpen(null); };
  const startEdit = (i) => { setOpen(i.key); setFilter(""); setSame(""); const d = D[i.key]; setDraft(d && (d.status === "corrige" || d.status === "partiel") ? JSON.parse(JSON.stringify({ acts: {}, vals: {}, remember: true, ...d })) : { acts: {}, vals: {}, remember: true }); };
  const dAct = (x) => draft.acts[x.k] || x.sug.act;
  const dVal = (x) => (draft.vals[x.k] !== undefined ? draft.vals[x.k] : x.sug.val);
  const setAct = (x, a) => setDraft((d) => ({ ...d, acts: { ...d.acts, [x.k]: a } }));
  const setVal = (x, v) => setDraft((d) => ({ ...d, vals: { ...d.vals, [x.k]: v }, acts: { ...d.acts, [x.k]: "corriger" } }));
  const seg = (x, i) => {
    const opts = i.noKeep ? [["corriger", "Ajouter"], ["refuser", "Laisser"]] : i.key === "reapparus" ? [["garder", "Garder"], ["refuser", "Refuser"]] : i.key === "doublon" ? [["garder", "1re ligne"], ["corriger", "Choisir"], ["refuser", "Refuser"]] : [["garder", "Garder"], ["corriger", "Corriger"], ["refuser", "Refuser"]];
    const a = dAct(x);
    return <span className="inline-flex rounded-lg border-2 border-slate-200 overflow-hidden" data-testid="seg">{opts.map(([k, l]) => <button type="button" key={k} onClick={() => setAct(x, k)}
      className={`px-2.5 py-1 text-xs font-bold border-r last:border-r-0 border-slate-200 ${a === k ? (k === "corriger" ? "bg-[#123A66] text-white" : k === "refuser" ? "bg-rose-100 text-rose-800" : "bg-slate-100 text-[#0B1F38]") : "bg-white text-slate-500"}`}>{l}</button>)}</span>;
  };
  const editor = (x, i) => {
    const v = dVal(x), dis = dAct(x) === "refuser";
    const cls = `border rounded px-2 py-1 ${dis ? "opacity-40" : ""} ${dAct(x) === "corriger" ? "border-emerald-400 bg-emerald-50/50" : "border-slate-300"}`;
    if (i.key === "atypique" || i.key === "typo" || i.key === "ignorees") return <input value={v || ""} disabled={dis} onChange={(e) => setVal(x, e.target.value.toUpperCase())} placeholder={i.key === "ignorees" ? "saisir le châssis" : "aucune proposition"} className={`${cls} font-plex-mono w-52`} />;
    if (i.key === "sans_date") return <input type="date" value={v || ""} disabled={dis} onChange={(e) => setVal(x, e.target.value)} className={cls} />;
    if (i.key === "futur") return <div className="flex flex-col gap-1">{["date_arrivee", "date_transfert"].filter((f) => x.r[f] && x.r[f] > stockDate).map((f) => <label key={f} className="flex items-center gap-1 text-[11px] text-slate-500">{f === "date_arrivee" ? "Arr." : "Tr."}<input type="date" value={(v || {})[f] !== undefined ? v[f] : x.r[f]} disabled={dis} onChange={(e) => setVal(x, { ...(v || {}), [f]: e.target.value })} className={cls} /></label>)}</div>;
    if (i.key === "doublon") return <select value={v} disabled={dis} onChange={(e) => setVal(x, e.target.value)} className={`${cls} text-xs`}>{x.lines.map((r) => <option key={stkRowKey(r)} value={stkRowKey(r)}>Ligne {r.line} : {[r.marque, r.modele, r.annee, r.navire, stkFmt(r.date_arrivee)].filter(Boolean).join(" · ") || "—"}</option>)}</select>;
    return <span className="text-slate-400">—</span>;
  };
  const head = (h) => <th key={h} className="py-1.5 px-2 text-left">{h}</th>;
  return <div className="space-y-2" data-testid="anomaly-review">
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#DCE6F2] bg-[#F4F8FC] px-3 py-2">
      <div className="flex-1 min-w-[220px] text-sm"><b className="text-[#123A66]">{issues.length} point(s)</b> · {issues.length - pending.length} décidé(s){nProps > 0 && <> · <b className="text-[#123A66]">{nProps} correction(s) proposée(s)</b> par l'outil</>}</div>
      {nSure > 0 && <StkBtn small kind="primary" onClick={applySure} data-testid="apply-sure"><StkIc.Check size={14} /> Appliquer les corrections sûres ({nSure})</StkBtn>}
      {pending.length > 0 && <StkBtn small onClick={keepAll} data-testid="accept-all">Tout garder tel quel</StkBtn>}
    </div>
    {issues.map((i) => {
      const d = D[i.key];
      const st = d ? d.status : "todo";
      const isOpen = open === i.key;
      const np = props(i).length, ns = sure(i).length, nref = i.rows.filter((x) => x.sug.act === "refuser" && !i.noKeep).length;
      const shown = i.rows.filter((x) => !filter || String(x.chassis || x.valeur || "").includes(filter.toUpperCase())).slice(0, 300);
      return <div key={i.key} className={`rounded-xl border-2 ${st === "todo" || st === "partiel" ? "border-amber-300 bg-amber-50/40" : "border-slate-200 bg-white"}`} data-testid={"issue-" + i.key}>
        <div className="px-4 py-3 flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-[240px]">
            <div className="font-semibold text-[#0B1F38] text-sm">{i.title}</div>
            <div className="text-xs text-slate-600 mt-0.5">{i.help}</div>
            {!i.global && (np > 0 || nref > 0) && <div className="text-xs font-semibold text-[#1B4F8C] mt-1">{np > 0 ? `${np} correction(s) proposée(s)${ns ? `, dont ${ns} sûre(s)` : ""}` : ""}{np > 0 && nref > 0 ? " · " : ""}{nref > 0 ? `${nref} à refuser (numéro sans valeur)` : ""}</div>}
            {d && d.status === "corrige" && i.key === "incomplet" && <div className="text-xs font-semibold text-emerald-700 mt-1">Les absents restent en stock jusqu'au prochain fichier.</div>}
          </div>
          <StkBadge tone={STK_DEC_TONE[st]}>{i.noKeep && st === "accepte" ? "Laissé de côté" : i.key === "doublon" && st === "accepte" ? "1re ligne gardée" : STK_DEC_LABEL[st]}</StkBadge>
          {!isOpen && !i.global && (np > 0 || nref > 0) && st !== "corrige" && <StkBtn small kind="primary" onClick={() => set(i.key, { status: "corrige", acts: {}, vals: {}, remember: true })} data-testid={"apply-" + i.key}><StkIc.Check size={14} /> {np > 0 ? `Appliquer ${np > 1 ? `les ${np} propositions` : "la proposition"}` : "Appliquer"}</StkBtn>}
          {!isOpen && !i.global && i.rows.length > 0 && <StkBtn small onClick={() => startEdit(i)} data-testid={"fix-" + i.key}><StkIc.Edit size={14} /> {st === "todo" ? "Voir ligne par ligne" : "Modifier"}</StkBtn>}
          {!isOpen && !i.global && st !== "accepte" && <StkBtn small kind="ghost" onClick={() => set(i.key, { status: "accepte" })} data-testid={"accept-" + i.key}>{i.noKeep ? "Laisser de côté" : i.key === "doublon" ? "Garder la 1re ligne" : "Garder tel quel"}</StkBtn>}
          {!isOpen && !i.global && st !== "refuse" && !i.noKeep && <StkBtn small kind="ghost" onClick={() => set(i.key, { status: "refuse" })} data-testid={"refuse-" + i.key}><span className="text-rose-700">Refuser {i.rows.length > 1 ? `les ${i.rows.length}` : ""}</span></StkBtn>}
          {st !== "todo" && !isOpen && <button className="text-xs text-slate-500 underline" onClick={() => set(i.key, null)}>Annuler la décision</button>}
        </div>
        {i.global && <div className="px-4 pb-3 grid md:grid-cols-3 gap-2">
          {[["refuse", "✕ Refuser le fichier", "Rien n'est enregistré. Un message prêt à envoyer au parc pour demander le bon fichier.", "text-rose-700"],
            ...(i.key === "incomplet" ? [["sans_sorties", "Importer sans compter les absents comme sortis", `Les véhicules du fichier sont enregistrés ; les ${(i.absents || []).length} absents restent en stock jusqu'au prochain fichier.`, "text-[#123A66]"]] : []),
            ["accepte", "✓ Garder tel quel", i.key === "incomplet" ? `Les ${(i.absents || []).length} absents sont enregistrés comme sortis.` : "Le fichier est importé tel qu'il a été lu.", "text-[#0B1F38]"]].map(([k, t, h, c]) => {
            const on = k === "sans_sorties" ? st === "corrige" : st === k;
            return <button type="button" key={k} data-testid={`choice-${i.key}-${k}`} onClick={() => set(i.key, k === "sans_sorties" ? { status: "corrige", mode: "sans_sorties" } : { status: k })}
              className={`text-left rounded-xl border-2 px-3 py-2 text-xs ${on ? "border-[#123A66] bg-[#F4F8FC]" : "border-slate-200 bg-white hover:border-slate-300"}`}><b className={`block text-[13px] mb-0.5 ${c}`}>{t}</b><span className="text-slate-600">{h}</span></button>; })}
        </div>}
        {isOpen && <div className="border-t border-slate-200 px-4 py-3 space-y-3 bg-white rounded-b-xl">
          {i.key === "sans_date" && <div className="flex flex-wrap items-center gap-2 text-sm">
            {onEditColumns && <StkBtn small onClick={onEditColumns}><StkIc.Edit size={14} /> Indiquer la colonne de la date d'arrivée</StkBtn>}
            <span className="text-xs text-slate-500">Même date pour toutes les lignes sans proposition :</span>
            <input type="date" value={same} onChange={(e) => setSame(e.target.value)} className="border-2 border-slate-200 rounded-lg px-2 py-1 text-sm" />
            <StkBtn small disabled={!same} onClick={() => setDraft((d) => { const n = { ...d, vals: { ...d.vals }, acts: { ...d.acts } }; i.rows.forEach((x) => { if (!dVal(x)) { n.vals[x.k] = same; n.acts[x.k] = "corriger"; } }); return n; })}>Appliquer</StkBtn>
          </div>}
          {i.rows.length > 20 && <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrer par châssis" className={`${stkInput} max-w-xs`} />}
          <div className="overflow-x-auto max-h-[460px] overflow-y-auto border border-slate-200 rounded-lg"><table className="w-full text-xs min-w-[860px]">
            <thead className="sticky top-0 bg-slate-50 z-10"><tr className="text-slate-500 border-b border-slate-200">
              {[head("Ligne"), head(i.key === "ignorees" ? "Valeur lue" : "Châssis lu"), head("Véhicule"), head(i.key === "doublon" ? "Ligne à garder" : i.key === "reapparus" ? "" : "Correction proposée"), head("Pourquoi"), head("Décision")]}
            </tr></thead>
            <tbody>{shown.map((x) => { const r = x.r || (x.lines && x.lines[0]) || {};
              return <tr key={x.k} className={`border-b border-slate-100 ${dAct(x) === "refuser" ? "bg-rose-50/40" : ""}`}>
                <td className="px-2 py-1.5 text-slate-400 whitespace-nowrap">{x.line}</td>
                <td className="px-2 font-plex-mono font-bold">{x.valeur || x.chassis}</td>
                <td className="px-2">{[r.marque, r.modele, r.annee].filter(Boolean).join(" ")}{r.navire ? <span className="text-slate-400"> · {r.navire}</span> : ""}</td>
                <td className="px-2 py-1">{i.key === "reapparus" ? "" : editor(x, i)}</td>
                <td className="px-2 text-slate-600">{x.sug.why}{x.sug.conf && <span className={`ml-1 rounded px-1.5 py-px text-[10px] font-extrabold ${STK_CONF[x.sug.conf][1]}`}>{STK_CONF[x.sug.conf][0]}</span>}</td>
                <td className="px-2">{seg(x, i)}</td>
              </tr>; })}</tbody>
          </table></div>
          {i.rows.length > shown.length && <div className="text-xs text-slate-500">{shown.length} ligne(s) affichée(s) sur {i.rows.length} : utilisez le filtre pour retrouver un châssis.</div>}
          {(i.key === "atypique" || i.key === "typo") && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.remember !== false} onChange={(e) => setDraft((x) => ({ ...x, remember: e.target.checked }))} /> Mémoriser les corrections : la même faute sera corrigée automatiquement dans les prochains fichiers</label>}
          <div className="flex flex-wrap gap-2">
            <StkBtn small kind="primary" data-testid={"save-" + i.key} onClick={() => { const allKeep = i.rows.every((x) => dAct(x) === "garder"); set(i.key, allKeep ? { status: "accepte" } : { ...draft, status: "corrige" }); setOpen(null); }}><StkIc.Check size={14} /> Valider ces décisions</StkBtn>
            <StkBtn small kind="ghost" onClick={() => setOpen(null)}>Fermer</StkBtn>
          </div>
        </div>}
      </div>;
    })}
  </div>;
}
