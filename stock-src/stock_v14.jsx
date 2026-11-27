// ============================================================
// 6.19 — Contrôle avec MMTE : lecture sans blocage, listes détaillées, historique des contrôles.
// Rien n'est modifié dans le stock : seules les dates MMTE sont notées sur les fiches des véhicules.
// ============================================================
const stkMmteIso = (dmy) => { const m = String(dmy || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const stkMmteRows = (map) => Array.from(map.values()).map((info) => ({ chassis: stkNormChassis(info.chassis), depot: stkMmteIso(info.depotDate), entry: stkMmteIso(info.entryDate), registred: stkMmteIso(info.registredAt),
  data: { navire: info.shipName || "", manifeste: info.atp || "", description: info.description || "", bl: info.bl || "" } })).filter((r) => r.chassis);
// Lecture de l'export : en arrière-plan quand c'est possible (l'écran reste utilisable)
async function stkReadMmteFile(f, onStep) {
  const buf = await f.arrayBuffer();
  if (stkWorker()) {
    try { return await stkWorkerCall({ op: "aoa", buf }, (p) => onStep && onStep(p.phase === "lignes" ? "Lecture des lignes…" : "Ouverture du fichier…"), [buf]); }
    catch (e) { if (!e.infra) throw e; }
  }
  onStep && onStep("Ouverture du fichier…");
  await new Promise((r) => setTimeout(r, 30));
  const wb = XLSX.read(await f.arrayBuffer(), { cellDates: true, type: "array" });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
}
const STK_MMTE_TABS = [
  { key: "absents", label: "Au parc, absents de MMTE", tone: "amber" },
  { key: "sortis", label: "Dans MMTE, sortis selon le parc", tone: "rose" },
  { key: "autres", label: "Dans MMTE, présents dans un autre parc", tone: "slate" },
  { key: "inconnus", label: "Dans MMTE, inconnus des stocks", tone: "amber" },
  { key: "ecarts", label: "Écarts de date de dépôt", tone: "rose" },
];
const stkMmteWhen = (iso) => { if (!iso) return ""; const d = new Date(iso); return `${stkFmt(d.toISOString().slice(0, 10))} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

function StkMmteCheck() {
  const C = React.useContext(StkCtx);
  const { dash } = C;
  const [view, setView] = useState("nouveau");
  const [parcs, setParcs] = useState([]);
  const [tous, setTous] = useState(false);
  const [aoa, setAoa] = useState(null); // tableau lu (en-tête + lignes)
  const [hi, setHi] = useState(-1);
  const [depCol, setDepCol] = useState("");
  const [fileName, setFileName] = useState("");
  const [step, setStep] = useState("");
  const [err, setErr] = useState("");
  const [invs, setInvs] = useState(null);
  const [invRows, setInvRows] = useState(null);
  const [ctl, setCtl] = useState(null); // contrôle affiché (nouveau ou rouvert)
  const [hist, setHist] = useState(null);
  const loadHist = () => stkCall("mmte_controles").then(setHist).catch((e) => setErr(stkErrText(e)));
  useEffect(() => { loadHist(); }, []);
  // lignes MMTE (depuis le fichier, avec la colonne de dépôt éventuellement indiquée à la main)
  const rows = useMemo(() => {
    if (invRows) return invRows;
    if (!aoa || hi < 0) return null;
    const head = aoa[hi].map(String);
    if (depCol !== "") head[+depCol] = "Date depot";
    const map = buildRichMap(head, aoa.slice(hi + 1));
    return map ? stkMmteRows(map) : [];
  }, [aoa, hi, depCol, invRows]);
  const headers = aoa && hi >= 0 ? aoa[hi].map((h, i) => ({ i, h: String(h || "").trim() })).filter((x) => x.h && matchFieldAlias(x.h) !== "chassis") : [];
  const nDep = rows ? rows.filter((r) => r.depot).length : 0;
  const onFile = async (f) => {
    if (!f) return;
    setErr(""); setCtl(null); setAoa(null); setInvRows(null); setDepCol(""); setFileName(f.name); setStep("Ouverture du fichier…");
    try {
      const t = await stkReadMmteFile(f, setStep);
      setStep("Analyse des lignes…");
      await new Promise((r) => setTimeout(r, 20));
      const h = t.findIndex((r) => (r || []).some((c) => matchFieldAlias(c) === "chassis"));
      if (h < 0) throw new Error("colonne châssis introuvable");
      setHi(h); setAoa(t);
    } catch (e) { setErr("Export MMTE illisible : " + (e.message || e)); }
    setStep("");
  };
  const loadInvs = () => db.collection("inventories").get().then((snap) => { const l = []; snap.forEach((d) => { const x = d.data() || {}; if (x.status !== "trashed") l.push({ id: d.id, ...x }); }); l.sort((a, b) => String(b.invDate).localeCompare(String(a.invDate))); setInvs(l); }).catch((e) => setErr(String(e.message || e)));
  const fromInventory = async (id) => {
    const inv = invs.find((i) => i.id === id); if (!inv) return;
    setStep("Lecture de la liste MMTE de l'inventaire…"); setErr(""); setCtl(null); setAoa(null);
    try {
      const map = await loadMmteMap(db.collection("inventories").doc(id));
      setInvRows(stkMmteRows(map)); setFileName(`Liste MMTE de l'inventaire ${inv.parcName} du ${stkFmt(inv.invDate)}`);
      const p = dash.find((d) => stkNorm(d.parc) === stkNorm(inv.parcName)); if (p && !parcs.length) { setParcs([p.parc]); setTous(false); }
    } catch (e) { setErr(String(e.message || e)); }
    setStep("");
  };
  const run = async () => {
    setStep(`Contrôle de ${rows.length.toLocaleString("fr-FR")} châssis…`); setErr("");
    try {
      const r = await stkCall("mmte_sync", { rows, parc_names: tous ? [] : parcs, tous, source: fileName });
      setCtl(r); loadHist(); C.reloadDash && C.reloadDash();
    } catch (e) { setErr(stkErrText(e)); }
    setStep("");
  };
  const open = async (id) => { setStep("Ouverture du contrôle…"); setErr(""); try { setCtl(await stkCall("mmte_controle", { id })); setView("nouveau"); window.scrollTo(0, 0); } catch (e) { setErr(stkErrText(e)); } setStep(""); };
  const parcOpts = dash.map((d) => ({ v: d.parc, n: d.presents }));
  return <>
    <StkPageHead title="Contrôle avec MMTE" sub="Comparez les stocks déclarés par les parcs avec l'export de la plateforme MMTE. Chaque contrôle est gardé dans l'historique." />
    <StkTabs tabs={[{ key: "nouveau", label: "Nouveau contrôle" }, { key: "historique", label: "Historique des contrôles", count: hist ? hist.length : undefined }]} value={view} onChange={setView} />
    {err && <StkMsg tone="err">{err}</StkMsg>}
    {view === "historique" ? <StkMmteHistory hist={hist} onOpen={open} reload={loadHist} /> : <>
      <StkCard className="p-4 md:p-5 space-y-4">
        <div className="grid md:grid-cols-2 gap-3 items-start">
          <div className="space-y-2">
            <StkMultiSelect label="Parcs couverts par l'export" options={parcOpts} value={tous ? [] : parcs} onChange={(v) => { setParcs(v); if (v.length) setTous(false); }} testid="mmte-parcs" />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={tous} onChange={(e) => { setTous(e.target.checked); if (e.target.checked) setParcs([]); }} data-testid="mmte-tous" /> L'export couvre tous les parcs</label>
            <div className="text-xs text-slate-500">Les véhicules présents dans ces parcs et absents de l'export seront listés avec leur situation.</div>
          </div>
          <StkField label="Export MMTE (CSV ou Excel)"><input type="file" accept=".csv,.xlsx,.xls,.txt" onChange={(e) => onFile(e.target.files && e.target.files[0])} className="block text-sm mt-2" data-testid="mmte-file" /></StkField>
        </div>
        <div className="text-sm text-slate-500">ou reprendre la liste MMTE déjà chargée dans un inventaire : {invs ? <select onChange={(e) => fromInventory(e.target.value)} className={`${stkInput} inline-block w-auto ml-2`} defaultValue=""><option value="" disabled>Choisir un inventaire</option>{invs.map((i) => <option key={i.id} value={i.id}>{i.parcName} — {stkFmt(i.invDate)}</option>)}</select> : <button className="font-bold text-[#1B4F8C] underline" onClick={loadInvs}>afficher les inventaires</button>}</div>
        {step && <div className="rounded-xl border border-[#DCE6F2] bg-[#F4F8FC] px-4 py-3" data-testid="mmte-progress">
          <div className="text-sm font-bold text-[#0B1F38]">{step}</div>
          <div className="h-2 mt-2 rounded-full bg-slate-200 overflow-hidden"><div className="h-full w-1/3 rounded-full bg-[#1B4F8C] stk-indet" /></div>
          <div className="text-xs text-slate-500 mt-1">L'écran reste utilisable pendant la lecture.</div>
          <style>{`@keyframes stkIndet{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}.stk-indet{animation:stkIndet 1.2s ease-in-out infinite}`}</style>
        </div>}
        {rows && !step && <StkMsg tone="info"><b>{rows.length.toLocaleString("fr-FR")}</b> châssis lus depuis « {fileName} » · {nDep.toLocaleString("fr-FR")} avec une date de dépôt.</StkMsg>}
        {rows && !step && !nDep && !invRows && <StkMsg tone="warn"><div className="space-y-2" data-testid="mmte-nodepot">
          <div><b>Aucune date de dépôt n'a été lue dans l'export</b> : les écarts de date ne pourront pas être contrôlés. Si une colonne contient cette date, indiquez-la :</div>
          <select value={depCol} onChange={(e) => setDepCol(e.target.value)} className={`${stkInput} max-w-sm`} data-testid="mmte-depcol"><option value="">Choisir la colonne de la date de dépôt</option>{headers.map((x) => <option key={x.i} value={x.i}>{x.h}</option>)}</select>
        </div></StkMsg>}
        {rows && !step && depCol !== "" && <div className="text-xs text-emerald-700 font-semibold">Colonne « {aoa[hi][+depCol]} » utilisée comme date de dépôt : {nDep.toLocaleString("fr-FR")} date(s) lue(s).</div>}
        <div className="flex flex-wrap items-center gap-2">
          <StkBtn kind="primary" disabled={!rows || !rows.length || !!step || !stkCanEdit(C)} onClick={run} data-testid="mmte-run">Lancer le contrôle</StkBtn>
          {!tous && !parcs.length && rows && <span className="text-xs text-slate-500">Sans parc indiqué, la liste « au parc, absents de MMTE » ne peut pas être établie.</span>}
        </div>
        {!stkCanEdit(C) && <div className="text-xs text-slate-500">Votre accès est en consultation seule.</div>}
      </StkCard>
      {ctl && <StkMmteResult ctl={ctl} />}
    </>}
  </>;
}

function StkMmteHistory({ hist, onOpen, reload }) {
  const C = React.useContext(StkCtx);
  if (!hist) return <StkCard className="p-6 text-slate-500">Chargement…</StkCard>;
  const prevOf = (h) => hist.find((x) => x.id === h.prev_id);
  const delta = (h, k) => { const p = prevOf(h); if (!p || p[k] == null || h[k] == null) return null; const d = h[k] - p[k]; return d ? <span className={`ml-1 rounded-full border px-1.5 text-[10px] font-bold ${d > 0 ? "bg-amber-50 text-amber-900 border-amber-300" : "bg-emerald-50 text-emerald-800 border-emerald-200"}`}>{d > 0 ? "+" : "−"}{Math.abs(d)}</span> : null; };
  const del = async (h) => { if (!window.confirm(`Retirer le contrôle du ${stkMmteWhen(h.at)} de l'historique ?`)) return; try { await stkCall("mmte_controle_delete", { id: h.id }); reload(); } catch (e) { alert(stkErrText(e)); } };
  return <StkCard className="p-4 md:p-5" data-testid="mmte-history">
    <StkTable rows={hist} rowKey={(h) => h.id} onRow={(h) => onOpen(h.id)} empty="Aucun contrôle enregistré pour le moment. Chaque nouveau contrôle apparaîtra ici." columns={[
      { key: "at", label: "Date", render: (h) => <span className="whitespace-nowrap">{stkMmteWhen(h.at)}</span> },
      { key: "parcs", label: "Parcs", render: (h) => <b>{h.parcs || "—"}</b> },
      { key: "source", label: "Source", render: (h) => <span className="text-slate-600">{h.source}</span> },
      { key: "lus", label: "Lus", render: (h) => (h.lus || 0).toLocaleString("fr-FR") },
      { key: "absents", label: "Au parc, absents MMTE", render: (h) => <span><b>{h.absents}</b>{delta(h, "absents")}</span> },
      { key: "sortis", label: "Sortis selon le parc", render: (h) => <span><b>{h.sortis}</b>{delta(h, "sortis")}</span> },
      { key: "inconnus", label: "Inconnus", render: (h) => (h.inconnus || 0).toLocaleString("fr-FR") },
      { key: "ecarts", label: "Écarts dépôt", render: (h) => (h.depot_lus ? h.ecarts : "—") },
      { key: "by_name", label: "Par" },
      { key: "act", label: "", sort: false, render: (h) => <span className="flex gap-1"><StkBtn small onClick={(e) => { e.stopPropagation(); onOpen(h.id); }}>Ouvrir</StkBtn>{C.me && C.me.isAdmin && <button className="text-xs text-slate-400 hover:text-rose-700 px-1" title="Retirer de l'historique" onClick={(e) => { e.stopPropagation(); del(h); }}>✕</button>}</span> },
    ]} />
  </StkCard>;
}

function StkMmteResult({ ctl }) {
  const C = React.useContext(StkCtx);
  const { cfg, openVehicle } = C;
  const R = ctl.result || {};
  const [tab, setTab] = useState(ctl.absents ? "absents" : ctl.sortis ? "sortis" : "inconnus");
  const [sit, setSit] = useState("");
  const ref = String(ctl.at || "").slice(0, 10) || stkToday();
  const newSet = useMemo(() => new Set(R.nouveaux || []), [ctl.id]);
  const abs = useMemo(() => (R.absents || []).map((r) => { const s = stkSit(r, ref, cfg); return { ...r, sit: s.code, sitLabel: s.label, depot: s.depot, mm: r.mmte_vu ? "disparu" : "jamais", nouveau: newSet.has(r.chassis) }; }), [ctl.id, cfg]);
  const cnt = (f) => abs.filter(f).length;
  const multi = !ctl.parc_ids || ctl.parc_ids.length !== 1;
  const sitChips = [["", `Toutes (${abs.length})`], ["disponible", `En délai légal (${cnt((r) => r.sit === "disponible")})`], ["bientot", `Bientôt en dépôt (${cnt((r) => r.sit === "bientot")})`], ["depot", `En dépôt (${cnt((r) => r.sit === "depot")})`],
    ...(cnt((r) => r.sit === "sans_date") ? [["sans_date", `Sans date (${cnt((r) => r.sit === "sans_date")})`]] : []), ["jamais", `Jamais vus dans MMTE (${cnt((r) => r.mm === "jamais")})`], ["disparu", `Disparus de MMTE (${cnt((r) => r.mm === "disparu")})`],
    ...(ctl.nouveaux != null ? [["nouveau", `Nouveaux depuis le contrôle précédent (${cnt((r) => r.nouveau)})`]] : [])];
  const absShown = abs.filter((r) => !sit || r.sit === sit || r.mm === sit || (sit === "nouveau" && r.nouveau));
  const data = { absents: absShown, sortis: R.sortis || [], autres: R.autres || [], inconnus: R.inconnus || [], ecarts: R.ecarts || [] }[tab];
  const mm = (r) => r.mmte || {};
  const veh = (r) => [r.marque, r.modele, r.annee].filter(Boolean).join(" ");
  const chassisCell = (r) => r.id ? <button className="font-plex-mono font-bold text-[#1B4F8C] underline whitespace-nowrap" onClick={() => openVehicle({ id: r.id })}>{r.chassis}</button> : <span className="font-plex-mono font-bold whitespace-nowrap">{r.chassis}</span>;
  const cols = {
    absents: [{ key: "chassis", label: "Châssis", render: chassisCell }, ...(multi ? [{ key: "parc", label: "Parc" }] : []), { key: "veh", label: "Véhicule", sort: veh, render: veh },
      { key: "nav", label: "Navire · manifeste", sort: (r) => r.navire, render: (r) => [r.navire, r.manifeste].filter(Boolean).join(" · ") },
      { key: "date_arrivee", label: "Arrivée", render: (r) => stkFmt(r.date_arrivee) }, { key: "depot", label: "Dépôt le", render: (r) => stkFmt(r.depot) },
      { key: "sit", label: "Situation", render: (r) => <StkBadge tone={STK_SIT_TONE[r.sit]}>{r.sitLabel}</StkBadge> },
      { key: "entry_date", label: "Au parc depuis", render: (r) => r.entry_date ? `${stkFmt(r.entry_date)} (${r.entry_kind === "transfert" && r.from_parc ? `transfert de ${r.from_parc}` : (STK_ENTRY[r.entry_kind] || "entrée").toLowerCase()})` : "—" },
      { key: "mm", label: "Dans MMTE", render: (r) => <span className="flex gap-1 flex-wrap">{r.mm === "disparu" ? <StkBadge tone="bg-amber-50 text-amber-900 border-amber-300">Disparu (vu le {stkFmt(String(r.mmte_vu).slice(0, 10))})</StkBadge> : <StkBadge tone="bg-slate-100 text-slate-600 border-slate-200">Jamais vu</StkBadge>}{r.nouveau && <StkBadge tone="bg-sky-50 text-sky-800 border-sky-200">Nouveau</StkBadge>}</span> }],
    sortis: [{ key: "chassis", label: "Châssis", render: chassisCell }, { key: "veh", label: "Véhicule", sort: veh, render: veh }, { key: "parc", label: "Dernier parc" },
      { key: "exit_date", label: "Sorti le", render: (r) => stkFmt(r.exit_date) },
      { key: "justif", label: "Justification", sort: (r) => r.justif_status, render: (r) => <span className="flex gap-1 flex-wrap items-center">{r.justif_status && STK_JUSTIF[r.justif_status] ? <StkBadge tone={STK_JUSTIF[r.justif_status].tone}>{STK_JUSTIF[r.justif_status].label}</StkBadge> : null}<span className="text-slate-600">{[r.justif_type, r.justif_numero].filter(Boolean).join(" ")}</span></span> },
      { key: "nav", label: "MMTE : navire · manifeste", sort: (r) => mm(r).navire, render: (r) => [mm(r).navire, mm(r).manifeste].filter(Boolean).join(" · ") }, { key: "depot_mmte", label: "Dépôt MMTE", render: (r) => stkFmt(r.depot_mmte) }],
    autres: [{ key: "chassis", label: "Châssis", render: chassisCell }, { key: "veh", label: "Véhicule", sort: veh, render: veh }, { key: "parc", label: "Présent chez", render: (r) => <b>{r.parc}</b> },
      { key: "nav", label: "MMTE : navire · manifeste", render: (r) => [mm(r).navire, mm(r).manifeste].filter(Boolean).join(" · ") }],
    inconnus: [{ key: "chassis", label: "Châssis (MMTE)", render: chassisCell }, { key: "desc", label: "Description", render: (r) => mm(r).description }, { key: "nav", label: "Navire · manifeste", sort: (r) => mm(r).navire, render: (r) => [mm(r).navire, mm(r).manifeste].filter(Boolean).join(" · ") },
      { key: "bl", label: "BL", render: (r) => mm(r).bl }, { key: "depot_mmte", label: "Dépôt MMTE", render: (r) => stkFmt(r.depot_mmte) },
      { key: "proche", label: "Châssis proche dans les stocks", render: (r) => r.proche ? <button className="text-left" onClick={() => openVehicle({ chassis: r.proche })}><span className="font-plex-mono font-bold text-[#1B4F8C] underline">{r.proche}</span> <span className="text-xs text-slate-500">{r.proche_present ? `chez ${r.proche_parc}` : "sorti"} · faute de frappe ?</span></button> : "" }],
    ecarts: [{ key: "chassis", label: "Châssis", render: chassisCell }, { key: "parc", label: "Parc", render: (r) => r.parc || "Sorti" }, { key: "date_arrivee", label: "Arrivée (parc)", render: (r) => stkFmt(r.date_arrivee) },
      { key: "depot_calcule", label: "Dépôt calculé", render: (r) => stkFmt(r.depot_calcule) }, { key: "depot_mmte", label: "Dépôt MMTE", render: (r) => <b>{stkFmt(r.depot_mmte)}</b> }, { key: "ecart", label: "Écart", sort: (r) => Math.abs(r.ecart), render: (r) => `${r.ecart > 0 ? "+" : ""}${r.ecart} j` }],
  }[tab];
  const exp = (k) => {
    const T = STK_MMTE_TABS.find((x) => x.key === tab).label;
    const X = {
      absents: [{ h: "Châssis", k: "chassis", w: 22 }, { h: "Parc", k: "parc" }, { h: "Véhicule", x: veh }, { h: "Navire", k: "navire" }, { h: "Manifeste", k: "manifeste" }, { h: "BL", k: "bl" }, { h: "Arrivée", x: (r) => stkFmt(r.date_arrivee) }, { h: "Dépôt le", x: (r) => stkFmt(r.depot) }, { h: "Situation", k: "sitLabel" }, { h: "Au parc depuis", x: (r) => stkFmt(r.entry_date) }, { h: "Type d'entrée", x: (r) => (r.entry_kind === "transfert" && r.from_parc ? `Transfert de ${r.from_parc}` : STK_ENTRY[r.entry_kind] || "") }, { h: "Dans MMTE", x: (r) => (r.mm === "disparu" ? `Disparu (vu le ${stkFmt(String(r.mmte_vu).slice(0, 10))})` : "Jamais vu") }, { h: "Nouveau", x: (r) => (r.nouveau ? "oui" : "") }],
      sortis: [{ h: "Châssis", k: "chassis", w: 22 }, { h: "Véhicule", x: veh }, { h: "Dernier parc", k: "parc" }, { h: "Sorti le", x: (r) => stkFmt(r.exit_date) }, { h: "Justification", x: (r) => (STK_JUSTIF[r.justif_status] || {}).label || "" }, { h: "Type", k: "justif_type" }, { h: "N° déclaration", k: "justif_numero" }, { h: "MMTE navire", x: (r) => mm(r).navire }, { h: "MMTE manifeste", x: (r) => mm(r).manifeste }, { h: "Dépôt MMTE", x: (r) => stkFmt(r.depot_mmte) }],
      autres: [{ h: "Châssis", k: "chassis", w: 22 }, { h: "Véhicule", x: veh }, { h: "Présent chez", k: "parc" }, { h: "MMTE navire", x: (r) => mm(r).navire }, { h: "MMTE manifeste", x: (r) => mm(r).manifeste }],
      inconnus: [{ h: "Châssis", k: "chassis", w: 22 }, { h: "Description", x: (r) => mm(r).description }, { h: "Navire", x: (r) => mm(r).navire }, { h: "Manifeste", x: (r) => mm(r).manifeste }, { h: "BL", x: (r) => mm(r).bl }, { h: "Dépôt MMTE", x: (r) => stkFmt(r.depot_mmte) }, { h: "Châssis proche", k: "proche" }, { h: "Où", x: (r) => (r.proche ? (r.proche_present ? r.proche_parc : "sorti") : "") }],
      ecarts: [{ h: "Châssis", k: "chassis", w: 22 }, { h: "Parc", k: "parc" }, { h: "Arrivée (parc)", x: (r) => stkFmt(r.date_arrivee) }, { h: "Dépôt calculé", x: (r) => stkFmt(r.depot_calcule) }, { h: "Dépôt MMTE", x: (r) => stkFmt(r.depot_mmte) }, { h: "Écart (jours)", k: "ecart" }],
    }[tab];
    const meta = [`Contrôle du ${stkMmteWhen(ctl.at)} par ${ctl.by_name || ""}`, `Parcs : ${ctl.parcs || "—"} · Source : ${ctl.source || ""}`, `${data.length} ligne(s)`];
    k === "x" ? stkExportXlsx(`Controle_MMTE_${tab}_${ref}`, T, meta, X, data) : stkPrintPdf(`Contrôle MMTE — ${T}`, meta, X.filter((c) => !["BL", "Manifeste", "MMTE manifeste", "Type d'entrée"].includes(c.h)), data);
  };
  const Kpi = ({ k, label, value, tone }) => <button type="button" onClick={() => k && setTab(k)} data-testid={k ? "kpi-" + k : undefined}
    className={`text-left rounded-2xl border px-3 py-2.5 ${tone === "amber" ? "bg-amber-50 border-amber-300" : tone === "rose" ? "bg-rose-50 border-rose-200" : "bg-[#F7FAFE] border-[#E1EAF4]"} ${k && tab === k ? "ring-[3px] ring-[#123A66]" : ""} ${k ? "" : "cursor-default"}`}>
    <div className="text-[10.5px] font-extrabold uppercase tracking-wide text-slate-500">{label}</div>
    <div className={`text-2xl font-extrabold font-plex-mono ${tone === "amber" ? "text-amber-700" : tone === "rose" ? "text-rose-700" : "text-[#123A66]"}`}>{value}</div></button>;
  const n = (x) => (x == null ? "—" : Number(x).toLocaleString("fr-FR"));
  return <StkCard className="p-4 md:p-5 space-y-3" data-testid="mmte-result">
    <div className="text-[12px] font-extrabold uppercase tracking-wider text-[#1B4F8C]">Contrôle du {stkMmteWhen(ctl.at)} · {ctl.parcs || "aucun parc indiqué"} · par {ctl.by_name}</div>
    <div className="text-xs text-slate-500">Source : {ctl.source}{ctl.nouveaux != null && <> · par rapport au contrôle précédent des mêmes parcs : <b>{ctl.nouveaux}</b> nouveau(x) absent(s), <b>{ctl.regularises}</b> régularisé(s)</>}</div>
    {!ctl.depot_lus && <StkMsg tone="warn">Aucune date de dépôt n'a été lue dans l'export : les écarts de date n'ont pas pu être contrôlés.</StkMsg>}
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
      <Kpi label="Lus dans MMTE" value={n(ctl.lus)} />
      <Kpi label="Présents des deux côtés" value={n(ctl.communs)} />
      <Kpi k="absents" label="Au parc, absents de MMTE" value={ctl.scope_key === "aucun" ? "—" : n(ctl.absents)} tone="amber" />
      <Kpi k="sortis" label="Dans MMTE, sortis selon le parc" value={n(ctl.sortis)} tone="rose" />
      <Kpi k="inconnus" label="Dans MMTE, inconnus des stocks" value={n(ctl.inconnus)} tone="amber" />
      <Kpi k="ecarts" label="Écarts de dépôt" value={ctl.depot_lus ? n(ctl.ecarts) : "—"} />
    </div>
    {ctl.autres > 0 && <button className="text-sm font-semibold text-[#1B4F8C] underline" onClick={() => setTab("autres")}>{ctl.autres} véhicule(s) de l'export sont présents dans un autre parc</button>}
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <div className="font-bold text-[#0B1F38] flex-1">{STK_MMTE_TABS.find((x) => x.key === tab).label} ({data.length.toLocaleString("fr-FR")}{tab === "inconnus" && ctl.inconnus > data.length ? ` sur ${n(ctl.inconnus)}` : ""})</div>
      <StkExportBar disabled={!data.length} onXlsx={() => exp("x")} onPdf={() => exp("p")} />
    </div>
    {tab === "absents" && ctl.scope_key === "aucun" && <StkMsg tone="info">Aucun parc n'a été indiqué pour ce contrôle : la liste des véhicules au parc absents de MMTE n'a pas pu être établie.</StkMsg>}
    {tab === "absents" && abs.length > 0 && <div className="flex flex-wrap gap-1.5" data-testid="mmte-sit">{sitChips.map(([k, l]) => <button key={k} type="button" onClick={() => setSit(k)} className={`px-3 py-1 rounded-full text-xs font-bold border-2 ${sit === k ? "bg-[#123A66] text-white border-[#123A66]" : "bg-white text-slate-600 border-slate-200"}`}>{l}</button>)}</div>}
    {tab === "inconnus" && ctl.inconnus > 300 && <div className="text-xs text-slate-500">Recherche d'un châssis proche faite pour les 300 premiers.</div>}
    <StkTable rows={data} rowKey={(r) => r.chassis} columns={cols} empty="Aucun véhicule dans cette liste." />
    <div className="text-xs text-slate-500">Situation calculée au jour du contrôle. Les dates MMTE sont notées sur les fiches véhicules ; rien d'autre n'est modifié dans le stock.</div>
  </StkCard>;
}
