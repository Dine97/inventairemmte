// ---------------- Recherche MMTE et GUCE (6.20) ----------------
// Recherche d'un ou plusieurs châssis dans nos stocks, dans MMTE et dans le GUCE.
// MMTE et le GUCE sont lus par l'extension Chrome « Bénin Control — Recherche MMTE et GUCE »
// (dossier extension-chrome), avec les connexions de l'utilisateur. Lecture seule : rien n'est
// modifié sur les plateformes ni dans le stock, et rien n'est enregistré dans la base.
const STK_BCR = { pending: new Map(), seq: 0, version: null };
function stkBcrVersion() { return STK_BCR.version || document.documentElement.getAttribute("data-bc-recherche") || null; }
if (typeof window !== "undefined" && !window.__stkBcr) {
  window.__stkBcr = true;
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data) return;
    if (e.data.bcr === "ready") { STK_BCR.version = e.data.version; window.dispatchEvent(new Event("stk-bcr")); }
    if (e.data.bcr === "res" && STK_BCR.pending.has(e.data.id)) {
      const p = STK_BCR.pending.get(e.data.id);
      STK_BCR.pending.delete(e.data.id);
      e.data.ok ? p.ok(e.data.data) : p.ko(new Error(e.data.error || "EXTENSION"));
    }
  });
}
function stkBcrCall(op, args, ms = 150000) {
  return new Promise((ok, ko) => {
    const id = "r" + ++STK_BCR.seq + "_" + Date.now();
    STK_BCR.pending.set(id, { ok, ko });
    window.postMessage({ bcr: "req", id, op, args }, "*");
    setTimeout(() => { if (STK_BCR.pending.has(id)) { STK_BCR.pending.delete(id); ko(new Error("DELAI")); } }, ms);
  });
}
const STK_PF_ETAT = {
  trouve: ["Trouvé", "bg-emerald-50 text-emerald-800 border-emerald-200"],
  non_trouve: ["Non trouvé", "bg-slate-100 text-slate-700 border-slate-300"],
  non_connecte: ["Non connecté", "bg-amber-50 text-amber-900 border-amber-300"],
  page_indisponible: ["Page indisponible", "bg-rose-50 text-rose-800 border-rose-200"],
  erreur: ["Erreur", "bg-rose-50 text-rose-800 border-rose-200"],
  attente: ["En attente", "bg-slate-50 text-slate-500 border-slate-200"],
  encours: ["Recherche…", "bg-sky-50 text-sky-800 border-sky-200"],
  file: ["En file", "bg-slate-50 text-slate-500 border-slate-200"],
};
const stkPfNorm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
// Résumés lisibles pour le tableau
function stkMmteLast(m) {
  if (!m || m.etat !== "trouve") return "";
  const h = (m.historique || []).filter((x) => x.existe);
  const last = h[h.length - 1];
  return last ? `${last.etape.charAt(0) + last.etape.slice(1).toLowerCase()} — ${last.details[last.details.length - 1] || ""}` : "Historique vide";
}
function stkGuceLast(g) {
  if (!g || g.etat !== "trouve") return "";
  const u = (g.unites || [])[0] || {};
  const l = u.liste || {};
  return [l["Statut"], l["Date"], l["Manutentionnaire"]].filter(Boolean).join(" · ") + ((g.unites || []).length > 1 ? ` (+${g.unites.length - 1} autre(s))` : "");
}
function StkPfBadge({ r }) {
  const e = STK_PF_ETAT[(r && r.etat) || "attente"] || STK_PF_ETAT.erreur;
  return <StkBadge tone={e[1]}>{e[0]}</StkBadge>;
}

// État partagé de la recherche : elle continue quand on change d'écran, et l'écran reste utilisable
const STK_PF = { rows: [], run: false, stop: false, text: "", toast: null, subs: new Set() };
function stkPfNotify() { STK_PF.subs.forEach((f) => f()); }
function stkPfUpd(ch, patch) { STK_PF.rows = STK_PF.rows.map((r) => (r.chassis === ch ? { ...r, ...patch } : r)); stkPfNotify(); }
function useStkPf() {
  const [, force] = useState(0);
  useEffect(() => { const h = () => force((x) => x + 1); STK_PF.subs.add(h); return () => STK_PF.subs.delete(h); }, []);
  return STK_PF;
}
function stkPfLookup(list) {
  stkCall("lookup", { chassis: list }).then((res) => {
    const by = {}; (res || []).forEach((x) => (by[stkPfNorm(x.saisi)] = x));
    STK_PF.rows = STK_PF.rows.map((r) => (by[r.chassis] ? { ...r, stock: by[r.chassis] } : r)); stkPfNotify();
  }).catch(() => {});
}
// Deux files indépendantes (MMTE et GUCE) : la plus rapide n'attend pas l'autre
async function stkPfLoop(k) {
  while (!STK_PF.stop) {
    const r = STK_PF.rows.find((x) => x[k] && x[k].etat === "file");
    if (!r) break;
    stkPfUpd(r.chassis, { [k]: { etat: "encours" } });
    try {
      const d = await stkBcrCall("search", { chassis: r.chassis, sites: [k] });
      stkPfUpd(r.chassis, { [k]: d[k] || { etat: "erreur", message: "Réponse vide." } });
    } catch (e) {
      const m = String(e.message || e);
      stkPfUpd(r.chassis, { [k]: { etat: "erreur", message: m === "DELAI" ? "Pas de réponse de l'extension." : m } });
      if (/EXTENSION_RECHARGEE|Extension context|Receiving end/i.test(m)) { STK_PF.stop = true; STK_PF.toast && STK_PF.toast("L'extension a été rechargée : actualisez la page puis relancez."); }
    }
  }
}
async function stkPfRun() {
  if (STK_PF.run) return;
  STK_PF.run = true; STK_PF.stop = false; stkPfNotify();
  await Promise.all([stkPfLoop("mmte"), stkPfLoop("guce")]);
  STK_PF.rows = STK_PF.rows.map((r) => ({ ...r, mmte: r.mmte && ["file", "encours"].includes(r.mmte.etat) ? { etat: "attente" } : r.mmte, guce: r.guce && ["file", "encours"].includes(r.guce.etat) ? { etat: "attente" } : r.guce }));
  STK_PF.run = false; stkPfNotify();
  const n = STK_PF.rows.length;
  if (n && !STK_PF.stop && STK_PF.toast) STK_PF.toast(`Recherche MMTE / GUCE terminée : ${n} châssis.`);
}
// Ajoute des châssis (remplace la liste si aucune recherche n'est en cours) ; sans extension, seuls nos stocks
function stkPfAdd(list, ext, replace) {
  const have = new Set(replace ? [] : STK_PF.rows.map((r) => r.chassis));
  const add = list.filter((c) => !have.has(c)).slice(0, Math.max(0, 500 - (replace ? 0 : STK_PF.rows.length)));
  const q = ext ? { etat: "file" } : { etat: "attente" };
  const fresh = add.map((c) => ({ chassis: c, stock: null, mmte: q, guce: q }));
  STK_PF.rows = replace ? fresh : STK_PF.rows.concat(fresh);
  stkPfNotify();
  if (add.length) stkPfLookup(add);
  if (ext) stkPfRun();
  return add.length;
}
function stkPfRetry(ch) { stkPfUpd(ch, { mmte: { etat: "file" }, guce: { etat: "file" } }); stkPfRun(); }

function StkPlatformSearch() {
  const C = React.useContext(StkCtx);
  const { openVehicle, toast } = C;
  const S = useStkPf();
  STK_PF.toast = toast;
  const [ver, setVer] = useState(stkBcrVersion());
  const [text, setTextS] = useState(STK_PF.text);
  const setText = (v) => { STK_PF.text = v; setTextS(v); };
  const rows = S.rows, run = S.run;
  const [sel, setSel] = useState(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    const f = () => setVer(stkBcrVersion());
    window.addEventListener("stk-bcr", f);
    const t = setTimeout(() => { if (!stkBcrVersion()) stkBcrCall("ping", {}, 3000).then((d) => { STK_BCR.version = d.version; f(); }).catch(() => {}); }, 600);
    return () => { window.removeEventListener("stk-bcr", f); clearTimeout(t); };
  }, []);
  const list = useMemo(() => [...new Set(String(text).split(/[\s,;]+/).map(stkPfNorm).filter((c) => c.length >= 5))], [text]);
  const start = () => {
    if (!list.length) return;
    const n = stkPfAdd(list, !!ver, !run);
    if (!run) setSel(null);
    if (run && toast) toast(n ? `${n} châssis ajouté(s) à la recherche en cours.` : "Ces châssis sont déjà dans la recherche.");
    setText("");
  };
  const shown = q ? rows.filter((r) => r.chassis.includes(stkPfNorm(q))) : rows;
  const fini = (x) => x && !["encours", "attente", "file"].includes(x.etat);
  const done = rows.filter((r) => fini(r.mmte) && fini(r.guce)).length;
  const cnt = (k, e) => rows.filter((r) => r[k] && r[k].etat === e).length;
  const nc = rows.some((r) => (r.mmte && r.mmte.etat === "non_connecte") || (r.guce && r.guce.etat === "non_connecte"));
  const stockCell = (s) => !s ? <span className="text-slate-400">…</span> : !s.trouve ? <span className="text-slate-500">Inconnu des stocks</span> : s.parc ? <span><b>{s.parc}</b><span className="block text-[11px] text-slate-500">{[s.marque, s.modele].filter(Boolean).join(" ")}</span></span> : <span className="text-slate-600">Sorti{s.sortie && s.sortie.parc ? ` de ${s.sortie.parc}` : ""}</span>;
  const cols = [
    { key: "chassis", label: "Châssis", render: (r) => <span className="font-plex-mono font-bold text-[#0B1F38] whitespace-nowrap">{r.chassis}</span> },
    { key: "stock", label: "Nos stocks", sort: (r) => (r.stock && r.stock.parc) || "", render: (r) => stockCell(r.stock) },
    { key: "mmte", label: "MMTE", sort: (r) => (r.mmte && r.mmte.etat) || "", render: (r) => <div className="max-w-[340px]"><StkPfBadge r={r.mmte} /><div className="text-[11px] text-slate-600 mt-0.5 line-clamp-2">{stkMmteLast(r.mmte) || (r.mmte && r.mmte.message) || ""}</div></div> },
    { key: "guce", label: "GUCE", sort: (r) => (r.guce && r.guce.etat) || "", render: (r) => <div className="max-w-[300px]"><StkPfBadge r={r.guce} /><div className="text-[11px] text-slate-600 mt-0.5">{stkGuceLast(r.guce) || (r.guce && r.guce.message) || ""}</div></div> },
    { key: "act", label: "", sortable: false, render: (r) => <StkBtn small kind={sel === r.chassis ? "primary" : undefined} onClick={(e) => { e.stopPropagation(); setSel(sel === r.chassis ? null : r.chassis); }}>{sel === r.chassis ? "Fermer" : "Détails"}</StkBtn> },
  ];
  const exportX = () => {
    const kv = (o) => Object.entries(o || {}).filter(([, v]) => v).map(([k, v]) => `${k} : ${v}`).join(" | ");
    const syn = rows.map((r) => {
      const s = r.stock || {}, m = r.mmte || {}, g = r.guce || {}, u = ((g.unites || [])[0]) || {}, gl = u.liste || {}, ml = m.liste || {}, mi = m.info || {};
      return { chassis: r.chassis, st_etat: !r.stock ? "" : s.trouve ? (s.parc ? "Présent" : "Sorti") : "Inconnu", st_parc: s.parc || (s.sortie && s.sortie.parc) || "", st_veh: [s.marque, s.modele, s.annee].filter(Boolean).join(" "),
        m_etat: (STK_PF_ETAT[m.etat] || [""])[0], m_man: ml["MANIFESTE"] || "", m_bl: ml["N° NUMÉRO BL"] || "", m_enr: ml["DATE D'ENREGISTREMENT"] || "", m_dep: ml["DATE DÉPÔT"] || mi["DÉPÔT"] || "", m_cvq: ml["CVQ"] || "", m_besc: ml["BESC"] || mi["BESC"] || "", m_veh: mi["MODELE/MARQUE"] || "", m_poids: mi["POIDS"] || "", m_last: stkMmteLast(m) || m.message || "",
        g_etat: (STK_PF_ETAT[g.etat] || [""])[0], g_statut: gl["Statut"] || "", g_date: gl["Date"] || "", g_voy: gl["ID Voyage"] || "", g_nav: gl["Nom du Moyen de Transport"] || "", g_doc: gl["Référence du document"] || "", g_man: gl["Manutentionnaire"] || "", g_flux: gl["Flux"] || "", g_rel: gl["Type de relâche"] || "", g_eta: (u.entete || {})["ETA"] || "", g_plus: kv(u.unite) , g_msg: g.message || "" };
    });
    const mh = [], gh = [];
    rows.forEach((r) => {
      ((r.mmte && r.mmte.historique) || []).forEach((h, i) => mh.push({ chassis: r.chassis, n: i + 1, etape: h.etape, existe: h.existe ? "Oui" : "Inexistant(e)", details: h.details.join("\n") }));
      ((r.guce && r.guce.unites) || []).forEach((u, j) => (u.historique || []).forEach((h, i) => gh.push({ chassis: r.chassis, unite: j + 1, n: i + 1, ...h })));
    });
    const meta = [`Recherche du ${stkFmt(stkToday())} — ${rows.length} châssis`, "MMTE et GUCE lus avec l'extension Chrome ; information seulement."];
    stkExportBook(`Recherche_MMTE_GUCE_${stkToday()}`, [
      { name: "Synthèse", title: "Recherche MMTE et GUCE — synthèse", meta, rows: syn, columns: [
        { h: "Châssis", k: "chassis", w: 22 }, { h: "Nos stocks", k: "st_etat", w: 10 }, { h: "Parc", k: "st_parc", w: 18 }, { h: "Véhicule (stocks)", k: "st_veh", w: 20 },
        { h: "MMTE", k: "m_etat", w: 12 }, { h: "MMTE manifeste", k: "m_man", w: 13 }, { h: "MMTE BL", k: "m_bl", w: 13 }, { h: "MMTE enregistré le", k: "m_enr", w: 16 }, { h: "MMTE dépôt", k: "m_dep", w: 16 }, { h: "CVQ", k: "m_cvq", w: 6 }, { h: "BESC", k: "m_besc", w: 12 }, { h: "MMTE modèle", k: "m_veh", w: 22 }, { h: "Poids", k: "m_poids", w: 8 }, { h: "MMTE dernière étape", k: "m_last", w: 60 },
        { h: "GUCE", k: "g_etat", w: 12 }, { h: "GUCE statut", k: "g_statut", w: 12 }, { h: "GUCE date", k: "g_date", w: 16 }, { h: "GUCE voyage", k: "g_voy", w: 13 }, { h: "Navire", k: "g_nav", w: 16 }, { h: "Document", k: "g_doc", w: 13 }, { h: "Manutentionnaire", k: "g_man", w: 16 }, { h: "Flux", k: "g_flux", w: 8 }, { h: "Relâche", k: "g_rel", w: 12 }, { h: "ETA", k: "g_eta", w: 16 }, { h: "GUCE unité", k: "g_plus", w: 50 }, { h: "Remarque", k: "g_msg", w: 30 },
      ] },
      { name: "Historique MMTE", title: "Historique MMTE (toutes les étapes)", meta, rows: mh, columns: [{ h: "Châssis", k: "chassis", w: 22 }, { h: "N°", k: "n", w: 5 }, { h: "Étape", k: "etape", w: 36 }, { h: "Existe", k: "existe", w: 12 }, { h: "Détails", k: "details", w: 110 }] },
      { name: "Historique GUCE", title: "Historique GUCE (toutes les opérations)", meta, rows: gh, columns: [{ h: "Châssis", k: "chassis", w: 22 }, { h: "Unité", k: "unite", w: 6 }, { h: "N°", k: "n", w: 5 }, { h: "Opération", k: "operation", w: 22 }, { h: "Type", k: "type", w: 22 }, { h: "Date", k: "date", w: 12 }, { h: "Heure", k: "heure", w: 8 }] },
    ]);
  };
  const exportP = () => stkPrintPdf("Recherche MMTE et GUCE", [`Recherche du ${stkFmt(stkToday())} — ${rows.length} châssis`, "Information seulement."], [
    { h: "Châssis", k: "chassis" }, { h: "Nos stocks", x: (r) => (!r.stock ? "" : r.stock.trouve ? r.stock.parc || "Sorti" : "Inconnu") },
    { h: "MMTE", x: (r) => (STK_PF_ETAT[(r.mmte || {}).etat] || [""])[0] }, { h: "MMTE — dernière étape", x: (r) => stkMmteLast(r.mmte) },
    { h: "GUCE", x: (r) => (STK_PF_ETAT[(r.guce || {}).etat] || [""])[0] }, { h: "GUCE — statut", x: (r) => stkGuceLast(r.guce) }], rows, true);
  const cur = rows.find((r) => r.chassis === sel);
  return <>
    <StkPageHead title="Recherche MMTE et GUCE" sub="Un ou plusieurs châssis : situation dans nos stocks, fiche et historique complet dans MMTE et dans le GUCE. Information seulement : rien n'est modifié." />
    <StkCard className="p-4 md:p-5 space-y-3">
      {ver ? <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="bcr-ok"><StkBadge tone="bg-emerald-50 text-emerald-800 border-emerald-200">Extension active · v{ver}</StkBadge><span className="text-slate-500">Les recherches utilisent vos connexions MMTE et GUCE dans ce navigateur.</span>
        <span className="flex-1" /><StkBtn small kind="ghost" onClick={() => stkBcrCall("open", { site: "mmte" })}>Ouvrir MMTE</StkBtn><StkBtn small kind="ghost" onClick={() => stkBcrCall("open", { site: "guce" })}>Ouvrir le GUCE</StkBtn></div>
        : <StkMsg tone="warn"><span data-testid="bcr-absente"><b>Extension non détectée.</b> Sans elle, seuls nos stocks sont consultés. Pour chercher dans MMTE et le GUCE, installez l'extension « Bénin Control — Recherche MMTE et GUCE » dans Chrome (guide fourni avec le dossier <code>extension-chrome</code>), puis actualisez la page. En attendant : <a className="underline font-bold" href="https://mmte.benincontrol.com/roulant/chassis" target="_blank" rel="noopener">ouvrir MMTE</a> · <a className="underline font-bold" href="https://guce.gouv.bj/emovement/gen/genHandlingUnit/list" target="_blank" rel="noopener">ouvrir le GUCE</a>.</span></StkMsg>}
      <textarea data-testid="bcr-saisie" value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder={"Collez un ou plusieurs châssis (un par ligne, ou séparés par des espaces)\nWAUZZZ4F46N176736"} className={`${stkInput} font-plex-mono`} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-600">{list.length.toLocaleString("fr-FR")} châssis{list.length > 500 ? " (500 au plus par recherche)" : ""}</span>
        <span className="flex-1" />
        {run && <StkBtn kind="danger" onClick={() => { STK_PF.stop = true; stkPfNotify(); }} data-testid="bcr-stop">Arrêter</StkBtn>}
        <StkBtn kind="primary" disabled={!list.length} onClick={start} data-testid="bcr-go"><Search size={16} /> {run ? "Ajouter à la recherche" : "Rechercher"}</StkBtn>
      </div>
      {rows.length > 0 && ver && <div className="space-y-1"><div className="flex justify-between text-xs text-slate-500"><span>{run ? "Recherche en cours (vous pouvez continuer à travailler ou changer d'écran)…" : "Terminé"} : {done} / {rows.length}</span><span>MMTE : {cnt("mmte", "trouve")} trouvé(s), {cnt("mmte", "non_trouve")} non trouvé(s) · GUCE : {cnt("guce", "trouve")} trouvé(s), {cnt("guce", "non_trouve")} non trouvé(s)</span></div><div className="h-1.5 rounded-full bg-slate-200 overflow-hidden"><div className="h-full bg-[#1B4F8C] transition-all" style={{ width: `${Math.max(2, Math.round((done / rows.length) * 100))}%` }} /></div></div>}
      {nc && <StkMsg tone="warn">Vous n'êtes pas connecté à une des plateformes dans ce navigateur. Connectez-vous ({<button className="underline font-bold" onClick={() => stkBcrCall("open", { site: "mmte" })}>MMTE</button>} · {<button className="underline font-bold" onClick={() => stkBcrCall("open", { site: "guce" })}>GUCE</button>}), puis relancez la recherche.</StkMsg>}
    </StkCard>
    {rows.length > 0 && <StkCard className="p-4 md:p-5 space-y-3 mt-4" data-testid="bcr-resultats">
      <div className="flex flex-wrap items-center gap-2">
        <div className="font-bold text-[#0B1F38] flex-1">Résultats ({rows.length})</div>
        <div className="w-[220px]"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer un châssis" className={stkInput} /></div>
        <StkExportBar disabled={!rows.length} onXlsx={exportX} onPdf={exportP} />
      </div>
      <StkTable columns={cols} rows={shown} rowKey={(r) => r.chassis} onRow={(r) => setSel(sel === r.chassis ? null : r.chassis)} empty="Aucun châssis." />
      {cur && <StkPfDetail r={cur} openVehicle={openVehicle} onRetry={() => stkPfRetry(cur.chassis)} run={run} ext={!!ver} />}
    </StkCard>}
  </>;
}

function StkPfDetail({ r, openVehicle, onRetry, run, ext }) {
  const s = r.stock || {}, m = r.mmte || {}, g = r.guce || {};
  const KV = ({ o }) => <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 text-[12.5px]">{Object.entries(o || {}).filter(([, v]) => v !== "" && v != null).map(([k, v]) => <React.Fragment key={k}><dt className="text-slate-500">{k}</dt><dd className="font-semibold text-[#0B1F38] break-words">{v}</dd></React.Fragment>)}</dl>;
  const Box = ({ title, badge, children, tid }) => <div className="rounded-2xl border border-[#E1EAF4] bg-[#F7FAFE] p-3 space-y-2 min-w-0" data-testid={tid}><div className="flex items-center gap-2"><div className="font-extrabold text-[#123A66] text-sm uppercase tracking-wide flex-1">{title}</div>{badge}</div>{children}</div>;
  return <div className="space-y-3 pt-2" data-testid="bcr-detail">
    <div className="flex items-center gap-2"><div className="font-plex-mono font-extrabold text-lg text-[#0B1F38] flex-1">{r.chassis}</div>{ext && <StkBtn small onClick={onRetry}>Relancer ce châssis</StkBtn>}</div>
    <div className="grid lg:grid-cols-3 gap-3">
      <Box title="Nos stocks" tid="bcr-d-stock" badge={s.trouve ? <StkBadge tone="bg-emerald-50 text-emerald-800 border-emerald-200">{s.parc ? "Présent" : "Sorti"}</StkBadge> : r.stock ? <StkBadge tone="bg-slate-100 text-slate-700 border-slate-300">Inconnu</StkBadge> : null}>
        {s.trouve ? <><KV o={{ Parc: s.parc || (s.sortie && s.sortie.parc ? `Sorti de ${s.sortie.parc}` : "Sorti"), "Au parc depuis": stkFmt(s.entry_date), Véhicule: [s.marque, s.modele, s.annee].filter(Boolean).join(" "), Navire: s.navire, Manifeste: s.manifeste, BL: s.bl, Arrivée: stkFmt(s.date_arrivee), "Dépôt MMTE": stkFmt(s.mmte_depot_date) }} /><StkBtn small onClick={() => openVehicle({ id: s.vehicle_id })}>Fiche du véhicule</StkBtn></> : <div className="text-sm text-slate-500">{r.stock ? `Ce châssis n'est dans aucun stock déclaré${s.suggestion ? ` (proche : ${s.suggestion})` : ""}.` : "…"}</div>}
      </Box>
      <Box title="MMTE" tid="bcr-d-mmte" badge={<StkPfBadge r={m} />}>
        {m.message && <div className="text-xs text-rose-700">{m.message}</div>}
        {m.etat === "trouve" && <>
          <KV o={{ ...(m.liste || {}), ...Object.fromEntries(Object.entries(m.info || {}).filter(([k]) => !/CHASSI|BESC|DÉPÔT/.test(k))) }} />
          <div className="text-xs font-extrabold uppercase text-slate-500 pt-1">Historique</div>
          <ol className="space-y-1.5" data-testid="bcr-mmte-hist">{(m.historique || []).map((h, i) => <li key={i} className={`border-l-4 pl-2 ${h.existe ? "border-[#1B4F8C]" : "border-slate-200 opacity-60"}`}><div className="text-[11.5px] font-extrabold text-[#123A66]">{h.etape}</div>{h.details.map((d, j) => <div key={j} className="text-[12px] text-slate-700">{d}</div>)}</li>)}</ol>
        </>}
      </Box>
      <Box title="GUCE" tid="bcr-d-guce" badge={<StkPfBadge r={g} />}>
        {g.message && <div className="text-xs text-rose-700">{g.message}</div>}
        {g.etat === "trouve" && (g.unites || []).map((u, j) => <div key={j} className="space-y-2">
          {(g.unites || []).length > 1 && <div className="text-xs font-extrabold text-slate-500">Unité {j + 1}</div>}
          <KV o={{ ...(u.liste || {}), ...Object.fromEntries(Object.entries(u.entete || {}).filter(([k]) => ["ETA", "ETD", "Sens", "Référence Voyage Transporteur"].includes(k))), ...Object.fromEntries(Object.entries(u.unite || {}).filter(([k]) => /Poids/.test(k))) }} />
          {u.message && <div className="text-xs text-rose-700">{u.message}</div>}
          <div className="text-xs font-extrabold uppercase text-slate-500 pt-1">Historique</div>
          <table className="w-full text-[12px]" data-testid="bcr-guce-hist"><thead><tr className="text-left text-slate-500"><th className="pr-2">Date</th><th className="pr-2">Heure</th><th className="pr-2">Opération</th><th>Type</th></tr></thead>
            <tbody>{(u.historique || []).map((h, i) => <tr key={i} className="border-t border-[#E1EAF4]"><td className="pr-2 whitespace-nowrap">{h.date}</td><td className="pr-2">{h.heure}</td><td className="pr-2">{h.operation}</td><td className="font-semibold">{h.type}</td></tr>)}</tbody></table>
          {u.lien && <a className="text-xs underline text-[#1B4F8C] font-bold" href={u.lien} target="_blank" rel="noopener">Ouvrir la fiche dans le GUCE</a>}
        </div>)}
        {g.plus > 0 && <div className="text-xs text-slate-500">{g.plus} autre(s) unité(s) non détaillée(s).</div>}
      </Box>
    </div>
  </div>;
}
