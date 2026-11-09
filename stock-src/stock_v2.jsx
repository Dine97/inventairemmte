// ============================================================
// STOCK MMTE v2 — rapports, graphiques, anomalies, contrôle inventaire et MMTE, filtres, sauvegarde
// ============================================================
function stkLev(a, b) {
  a = String(a || ""); b = String(b || "");
  if (Math.abs(a.length - b.length) > 2) return 9;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
// Paires entrée / sortie probablement identiques (faute de frappe)
function stkTypoPairs(entrees, sorties) {
  const out = [];
  if (entrees.length * sorties.length > 400000) return out;
  entrees.forEach((e) => sorties.forEach((s) => { const d = stkLev(e, s); if (d > 0 && d <= 2) out.push({ entree: e, sortie: s, distance: d }); }));
  return out;
}
function stkMonday(iso) {
  const d = new Date(String(iso).slice(0, 10) + "T12:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}
function stkCanEdit(C) { return C.isAdmin || (C.me && C.me.access === "agent"); }

// ---------- Graphique d'évolution (SVG) ----------
function StkChart({ data, height }) {
  const H = height || 220, W = 720, padL = 58, padR = 40, padT = 16, padB = 34;
  if (!data || !data.length) return <div className="text-sm text-slate-400 py-6 text-center">Pas encore de données.</div>;
  const maxS = Math.max(1, ...data.map((d) => +d.stock));
  const maxM = Math.max(1, ...data.map((d) => Math.max(+d.entrees, +d.sorties)));
  const iw = W - padL - padR, ih = H - padT - padB;
  const gap = Math.max(14, Math.min(26, iw / data.length / 2));
  const x = (i) => padL + gap + (data.length === 1 ? (iw - 2 * gap) / 2 : (i * (iw - 2 * gap)) / (data.length - 1));
  const yS = (v) => padT + ih - (v / maxS) * ih;
  const yM = (v) => padT + ih - (v / maxM) * ih;
  const bw = Math.max(4, Math.min(16, iw / data.length / 3));
  const line = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${yS(+d.stock).toFixed(1)}`).join(" ");
  const ticks = [0, 0.5, 1];
  return <div>
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Évolution du stock">
      {ticks.map((t) => <g key={t}><line x1={padL} x2={W - padR} y1={padT + ih - t * ih} y2={padT + ih - t * ih} stroke="#E2EAF3" />
        <text x={padL - 6} y={padT + ih - t * ih + 4} textAnchor="end" fontSize="11" fill="#123A66">{Math.round(maxS * t).toLocaleString("fr-FR")}</text>
        <text x={W - padR + 6} y={padT + ih - t * ih + 4} fontSize="11" fill="#7A8CA3">{Math.round(maxM * t)}</text></g>)}
      {data.map((d, i) => <g key={i}>
        <rect x={x(i) - bw - 1} y={yM(+d.entrees)} width={bw} height={padT + ih - yM(+d.entrees)} fill="#22A06B" rx="2"><title>{`${stkFmt(d.d)} : ${d.entrees} entrée(s)`}</title></rect>
        <rect x={x(i) + 1} y={yM(+d.sorties)} width={bw} height={padT + ih - yM(+d.sorties)} fill="#E5484D" rx="2"><title>{`${stkFmt(d.d)} : ${d.sorties} sortie(s)`}</title></rect>
        {(data.length <= 14 || i % Math.ceil(data.length / 12) === 0) && <text x={x(i)} y={H - 12} textAnchor="middle" fontSize="10.5" fill="#5B6F86">{stkFmt(d.d).slice(0, 5)}</text>}
      </g>)}
      <path d={line} fill="none" stroke="#123A66" strokeWidth="2.5" />
      {data.map((d, i) => <circle key={i} cx={x(i)} cy={yS(+d.stock)} r="3.5" fill="#123A66"><title>{`${stkFmt(d.d)} : ${(+d.stock).toLocaleString("fr-FR")} véhicules en stock`}</title></circle>)}
    </svg>
    <div className="flex flex-wrap gap-4 text-xs font-semibold text-slate-600 justify-center">
      <span className="inline-flex items-center gap-1.5"><span className="w-4 h-0.5 bg-[#123A66] inline-block" /> Stock (échelle de gauche)</span>
      <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#22A06B] inline-block" /> Entrées de la semaine</span>
      <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#E5484D] inline-block" /> Sorties de la semaine</span>
    </div>
  </div>;
}
function StkEvolution({ parcId, title }) {
  const [weeks, setWeeks] = useState(12);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { setData(null); stkCall("history", { parc_id: parcId || null, weeks, ref: stkToday() }).then(setData).catch((e) => setErr(stkErrText(e))); }, [parcId, weeks]);
  return <StkCard className="p-4 md:p-5">
    <div className="flex flex-wrap items-center gap-2 mb-3">
      <div className="font-bold text-[#0B1F38] text-lg flex-1">{title || "Évolution du stock"}</div>
      <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} className={`${stkInput} max-w-[170px]`}><option value={8}>8 semaines</option><option value={12}>12 semaines</option><option value={26}>6 mois</option><option value={52}>1 an</option></select>
    </div>
    {err ? <StkMsg tone="err">{err}</StkMsg> : !data ? <StkLoading /> : <StkChart data={data} />}
  </StkCard>;
}

// ---------- Rappel du lundi : parcs sans fichier cette semaine ----------
function StkMondayReminder() {
  const { dash, openParc } = React.useContext(StkCtx);
  const [open, setOpen] = useState(false);
  const monday = stkMonday(stkToday());
  const late = dash.filter((d) => d.active !== false && d.last_import && d.last_import < monday);
  const never = dash.filter((d) => d.active !== false && !d.last_import);
  if (!late.length && !never.length) return null;
  const text = `Parcs dont le fichier de stock de la semaine du ${stkFmt(monday)} n'est pas encore reçu :\n` + late.map((d) => `- ${d.parc} (dernier fichier : ${stkFmt(d.last_import)})`).join("\n");
  const copy = async () => { try { await navigator.clipboard.writeText(text); alert("Liste copiée."); } catch (e) { window.prompt("Copiez la liste :", text); } };
  return <StkCard className="p-4 md:p-5 border-l-4 border-l-amber-400">
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex-1 min-w-[220px]"><div className="font-bold text-[#0B1F38]">Fichiers attendus cette semaine (depuis le lundi {stkFmt(monday)})</div>
        <div className="text-sm text-slate-600">{late.length} parc(s) en attente de fichier{never.length ? ` · ${never.length} parc(s) jamais importé(s)` : ""}</div></div>
      {late.length > 0 && <><StkBtn small onClick={copy}>Copier la liste</StkBtn><a className="px-3 py-1.5 text-xs rounded-lg font-bold border-2 border-[#1B4F8C]/25 text-[#1B4F8C] bg-white" href={`mailto:?subject=${encodeURIComponent("Relance — fichiers de stock de la semaine du " + stkFmt(monday))}&body=${encodeURIComponent(text)}`}>Préparer un e-mail</a></>}
      <StkBtn small kind="ghost" onClick={() => setOpen((x) => !x)}>{open ? "Masquer" : "Voir"}</StkBtn>
    </div>
    {open && <div className="mt-3 flex flex-wrap gap-2">
      {late.map((d) => <button key={d.parc_id} onClick={() => openParc(d.parc_id)} className="px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-sm font-semibold text-amber-900">{d.parc} <span className="text-xs font-normal">· {stkFmt(d.last_import)}</span></button>)}
      {never.map((d) => <button key={d.parc_id} onClick={() => openParc(d.parc_id)} className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-500">{d.parc}</button>)}
    </div>}
  </StkCard>;
}

// ---------- Rapport hebdomadaire consolidé ----------
function StkReport() {
  const { cfg, openParc } = React.useContext(StkCtx);
  const lastMonday = stkMonday(stkAddDays(stkToday(), -7));
  const [from, setFrom] = useState(lastMonday);
  const [to, setTo] = useState(stkAddDays(lastMonday, 6));
  const [rows, setRows] = useState(null);
  const [anom, setAnom] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);
  const run = async () => {
    setBusy(true); setErr("");
    try { const [r, a] = await Promise.all([stkCall("report", { from, to }), stkCall("anomalies", {})]); setRows(r); setAnom(a); }
    catch (e) { setErr(stkErrText(e)); }
    setBusy(false);
  };
  useEffect(() => { run(); }, []);
  const setWeek = (mon) => { setFrom(mon); setTo(stkAddDays(mon, 6)); };
  const list = (rows || []).filter((r) => !onlyActive || +r.stock_fin > 0 || +r.stock_debut > 0 || +r.nb_imports > 0);
  const tot = list.reduce((a, r) => { ["stock_debut", "stock_initial", "entrees", "sorties", "transferts", "stock_fin", "disponibles", "bientot", "depot", "sans_date", "non_justifiees"].forEach((k) => a[k] = (a[k] || 0) + Number(r[k] || 0)); return a; }, {});
  const missing = list.filter((r) => !+r.nb_imports);
  const cols = [
    { h: "Parc", k: "parc", w: 22 }, { h: "Stock début", k: "stock_debut", w: 10 }, { h: "Stock initial importé", k: "stock_initial", w: 10 }, { h: "Entrées", k: "entrees", w: 9 }, { h: "Sorties", k: "sorties", w: 9 }, { h: "Transferts sortants", k: "transferts", w: 10 },
    { h: "Stock fin", k: "stock_fin", w: 10 }, { h: "Disponibles", k: "disponibles", w: 10 }, { h: `Dépôt < ${cfg.seuil} j`, k: "bientot", w: 10 }, { h: "En dépôt", k: "depot", w: 10 }, { h: "Sans date", k: "sans_date", w: 9 },
    { h: "Imports reçus", k: "nb_imports", w: 9 }, { h: "Dernier import", x: (r) => stkFmt(r.dernier_import), w: 12 }, { h: "Sorties non justifiées", k: "non_justifiees", w: 10 }
  ];
  const meta = () => {
    const a = anom || {};
    return [`Période du ${stkFmt(from)} au ${stkFmt(to)}`, `Total : stock début ${tot.stock_debut || 0} · entrées ${tot.entrees || 0} · sorties ${tot.sorties || 0} · transferts ${tot.transferts || 0} · stock fin ${tot.stock_fin || 0} · en dépôt ${tot.depot || 0}`,
      `Parcs sans fichier sur la période : ${missing.length ? missing.map((m) => m.parc).join(", ") : "aucun"}`,
      `Anomalies en cours : ${(a.multi_parcs || []).length} véhicule(s) dans deux parcs · ${(a.proches || []).length} faute(s) de frappe probable(s) · ${(a.reapparus || []).length} réapparition(s) · ${(a.sans_date || []).length} sans date · ${(a.ecarts_mmte || []).length} écart(s) avec MMTE`];
  };
  const totalRow = { parc: "TOTAL", ...tot, nb_imports: list.reduce((a, r) => a + +r.nb_imports, 0) };
  const exp = (k) => k === "x" ? stkExportXlsx(`Rapport_stocks_${from}_${to}`, "Rapport hebdomadaire — Suivi des stocks MAD ROULANTS", meta(), cols, [...list, totalRow]) : stkPrintPdf("Rapport hebdomadaire — Suivi des stocks MAD ROULANTS", meta(), cols.filter((c) => c.h !== "Stock initial importé"), [...list, totalRow]);
  const T = (v, tone) => <span className={`font-plex-mono ${tone || ""}`}>{(+v || 0).toLocaleString("fr-FR")}</span>;
  const tcols = [
    { key: "parc", label: "Parc", render: (r) => <b className="text-[#0B1F38]">{r.parc}</b> },
    { key: "stock_debut", label: "Début", sort: (r) => +r.stock_debut, render: (r) => T(r.stock_debut) },
    { key: "entrees", label: "Entrées", sort: (r) => +r.entrees, render: (r) => <span>{T(r.entrees, "text-emerald-700")}{+r.stock_initial ? <span className="block text-[11px] text-slate-400">+{r.stock_initial} initial</span> : null}</span> },
    { key: "sorties", label: "Sorties", sort: (r) => +r.sorties, render: (r) => T(r.sorties, "text-rose-700") },
    { key: "transferts", label: "Transf.", sort: (r) => +r.transferts, render: (r) => T(r.transferts, "text-sky-700") },
    { key: "stock_fin", label: "Fin", sort: (r) => +r.stock_fin, render: (r) => <b>{T(r.stock_fin)}</b> },
    { key: "depot", label: "Dépôt", sort: (r) => +r.depot, render: (r) => T(r.depot, "text-rose-700") },
    { key: "bientot", label: `< ${cfg.seuil} j`, sort: (r) => +r.bientot, render: (r) => T(r.bientot, "text-amber-700") },
    { key: "nb_imports", label: "Fichiers", sort: (r) => +r.nb_imports, render: (r) => +r.nb_imports ? T(r.nb_imports) : <StkBadge tone="bg-amber-50 text-amber-900 border-amber-300">Aucun</StkBadge> },
    { key: "dernier_import", label: "Dernier import", render: (r) => stkFmt(r.dernier_import) || "—" },
    { key: "non_justifiees", label: "Non justif.", sort: (r) => +r.non_justifiees, render: (r) => T(r.non_justifiees) }
  ];
  return <>
    <StkPageHead title="Rapport hebdomadaire" sub="Synthèse consolidée de tous les parcs pour la direction : mouvements, dépôts, fichiers reçus et anomalies." right={<StkExportBar disabled={!rows} onXlsx={() => exp("x")} onPdf={() => exp("p")} />} />
    <StkCard className="p-4 md:p-5">
      <div className="flex flex-wrap gap-3 items-end">
        <StkBtn small onClick={() => setWeek(stkMonday(stkAddDays(from, -7)))}><ArrowLeft size={14} /> Semaine précédente</StkBtn>
        <StkField label="Du"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={stkInput} /></StkField>
        <StkField label="Au"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={stkInput} /></StkField>
        <StkBtn small onClick={() => setWeek(stkMonday(stkAddDays(from, 7)))}>Semaine suivante <StkIc.Chev size={14} /></StkBtn>
        <StkBtn kind="primary" disabled={busy} onClick={run}>{busy ? "Calcul..." : "Afficher"}</StkBtn>
        <label className="text-sm font-semibold text-slate-600 flex items-center gap-2"><input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} /> Parcs avec stock seulement</label>
      </div>
    </StkCard>
    {err && <StkMsg tone="err">{err}</StkMsg>}
    {rows && <>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StkKpi label="Stock au début" value={tot.stock_debut} tone="slate" />
        <StkKpi label="Entrées" value={tot.entrees} tone="green" />
        <StkKpi label="Sorties" value={tot.sorties} tone="rose" sub={tot.transferts ? `+ ${tot.transferts} transfert(s)` : ""} />
        <StkKpi label="Stock en fin" value={tot.stock_fin} />
        <StkKpi label="En dépôt" value={tot.depot} tone="rose" />
        <StkKpi label="Parcs sans fichier" value={missing.length} tone={missing.length ? "amber" : "green"} />
      </div>
      {anom && <StkCard className="p-4 flex flex-wrap gap-2 items-center"><span className="font-bold text-[#0B1F38] mr-2">Anomalies en cours</span>
        {[["multi_parcs", "dans deux parcs"], ["proches", "fautes de frappe probables"], ["reapparus", "réapparitions"], ["sans_date", "sans date"], ["atypiques", "châssis atypiques"], ["ecarts_mmte", "écarts avec MMTE"]].map(([k, l]) => <StkBadge key={k} tone={(anom[k] || []).length ? "bg-amber-50 text-amber-900 border-amber-300" : "bg-emerald-50 text-emerald-800 border-emerald-200"}>{(anom[k] || []).length} {l}</StkBadge>)}
      </StkCard>}
      <StkCard className="p-4 md:p-5"><StkTable columns={tcols} rows={list} rowKey={(r) => r.parc_id} onRow={(r) => openParc(r.parc_id)} initial={500} /></StkCard>
    </>}
    <StkEvolution title="Évolution du stock total (tous parcs)" />
  </>;
}

// ---------- Centre des anomalies ----------
function StkAnomalies() {
  const C = React.useContext(StkCtx);
  const { openVehicle, isAdmin, reloadDash, toast } = C;
  const [d, setD] = useState(null);
  const [tab, setTab] = useState("proches");
  const [err, setErr] = useState("");
  const load = async () => { setD(null); try { setD(await stkCall("anomalies", {})); } catch (e) { setErr(stkErrText(e)); } };
  useEffect(() => { load(); }, []);
  const merge = async (r) => {
    if (!window.confirm(`Confirmer que ${r.entree} (entrée) et ${r.sortie} (sortie) sont le même véhicule ?\n\nLe châssis ${r.entree} sera fusionné dans ${r.sortie}, l'historique du parc recalculé, et la faute mémorisée pour les prochains fichiers.`)) return;
    try { await stkCall("merge", { from_id: r.entree_id, into_id: r.sortie_id }); toast("Véhicules fusionnés"); reloadDash(); load(); } catch (e) { alert(stkErrText(e)); }
  };
  const V = (r, k) => <button className="font-plex-mono font-bold text-[#1B4F8C] underline whitespace-nowrap" onClick={() => openVehicle({ id: r[k || "vehicle_id"] })}>{r.chassis || r[k === "entree_id" ? "entree" : "sortie"]}</button>;
  const defs = {
    proches: { label: "Fautes de frappe probables", help: "Un châssis « entré » et un châssis « sorti » du même parc, au même import, ne diffèrent que d'un ou deux caractères : c'est probablement le même véhicule mal saisi.", cols: [
      { key: "parc", label: "Parc" }, { key: "date", label: "Import du", render: (r) => stkFmt(r.date) },
      { key: "entree", label: "Châssis entré", render: (r) => <button className="font-plex-mono font-bold text-[#1B4F8C] underline" onClick={() => openVehicle({ id: r.entree_id })}>{r.entree}</button> },
      { key: "sortie", label: "Châssis sorti", render: (r) => <button className="font-plex-mono font-bold text-[#1B4F8C] underline" onClick={() => openVehicle({ id: r.sortie_id })}>{r.sortie}</button> },
      { key: "distance", label: "Écart", render: (r) => `${r.distance} car.` },
      { key: "x", label: "", sortable: false, render: (r) => isAdmin ? <StkBtn small kind="primary" onClick={() => merge(r)}>Même véhicule : fusionner</StkBtn> : null }] },
    multi_parcs: { label: "Présents dans deux parcs", help: "Le même châssis figure dans le stock de plusieurs parcs. Il sera reconnu comme transfert quand le parc d'origine l'aura retiré de son fichier.", cols: [{ key: "chassis", label: "Châssis", render: (r) => V(r) }, { key: "parcs", label: "Parcs" }] },
    reapparus: { label: "Sortis puis réapparus", help: "Véhicule sorti d'un parc (hors transfert) puis entré de nouveau plus tard.", cols: [{ key: "chassis", label: "Châssis", render: (r) => V(r) }, { key: "parc_sortie", label: "Sorti de" }, { key: "exit_date", label: "le", render: (r) => stkFmt(r.exit_date) }, { key: "parc_entree", label: "Entré à" }, { key: "entry_date", label: "le", render: (r) => stkFmt(r.entry_date) }] },
    sans_date: { label: "Sans date d'arrivée", help: "Impossible de calculer la date de dépôt. Corrigez la fiche (le champ sera verrouillé) ou faites compléter le fichier du parc.", cols: [{ key: "chassis", label: "Châssis", render: (r) => V(r) }, { key: "parc", label: "Parc" }] },
    atypiques: { label: "Châssis atypiques", help: "Châssis de moins ou plus de 17 caractères, ou contenant I, O ou Q (lettres interdites dans un VIN).", cols: [{ key: "chassis", label: "Châssis", render: (r) => V(r) }, { key: "len", label: "Longueur", sort: (r) => r.chassis.length, render: (r) => r.chassis.length }, { key: "parc", label: "Parc" }] },
    ecarts_mmte: { label: "Écarts avec MMTE", help: "La date de dépôt calculée (arrivée + durée de séjour) diffère de plus de 3 jours de la date de dépôt MMTE. Faites un contrôle MMTE pour alimenter cette liste.", cols: [{ key: "chassis", label: "Châssis", render: (r) => V(r) }, { key: "parc", label: "Parc" }, { key: "date_arrivee", label: "Arrivée (parc)", render: (r) => stkFmt(r.date_arrivee) }, { key: "depot_calcule", label: "Dépôt calculé", render: (r) => stkFmt(r.depot_calcule) }, { key: "mmte_depot_date", label: "Dépôt MMTE", render: (r) => <b>{stkFmt(r.mmte_depot_date)}</b> }, { key: "ecart", label: "Écart", sort: (r) => Math.abs(r.ecart), render: (r) => `${r.ecart > 0 ? "+" : ""}${r.ecart} j` }] }
  };
  const def = defs[tab];
  const rows = d ? d[tab] || [] : [];
  const exp = (k) => {
    const cols = def.cols.filter((c) => c.key !== "x").map((c) => ({ h: c.label, x: (r) => { const v = r[c.key]; return /date|depot/.test(c.key) ? stkFmt(v) : c.key === "len" ? r.chassis.length : v; } }));
    k === "x" ? stkExportXlsx(`Anomalies_${tab}_${stkToday()}`, def.label, [`Édité le ${stkFmt(stkToday())}`], cols, rows) : stkPrintPdf(`Anomalies — ${def.label}`, [`Édité le ${stkFmt(stkToday())}`], cols, rows);
  };
  return <>
    <StkPageHead title="Centre des anomalies" sub="Tout ce qui demande une vérification, sur l'ensemble des parcs." right={<StkBtn small onClick={load}><RefreshCw size={15} /> Actualiser</StkBtn>} />
    {err && <StkMsg tone="err">{err}</StkMsg>}
    <StkTabs tabs={Object.entries(defs).map(([k, v]) => ({ key: k, label: v.label, count: d ? (d[k] || []).length : null }))} value={tab} onChange={setTab} />
    <StkCard className="p-4 md:p-5 space-y-3">
      <div className="flex flex-wrap items-start gap-2"><div className="text-sm text-slate-600 flex-1 min-w-[240px]">{def.help}</div><StkExportBar disabled={!rows.length} onXlsx={() => exp("x")} onPdf={() => exp("p")} /></div>
      {!d ? <StkLoading /> : <StkTable columns={def.cols} rows={rows} rowKey={(r) => JSON.stringify(r)} empty="Aucune anomalie dans cette catégorie." />}
    </StkCard>
  </>;
}

// ---------- Contrôle : stock déclaré par le parc ↔ inventaire physique scanné ----------
function StkInventoryCheck({ parcName }) {
  const { cfg, openVehicle } = React.useContext(StkCtx);
  const C = React.useContext(StkCtx);
  const [invs, setInvs] = useState(null);
  const [sel, setSel] = useState("");
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("manquants");
  const parcId = (C.dash.find((d) => d.parc === parcName) || {}).parc_id;
  useEffect(() => {
    db.collection("inventories").get().then((snap) => {
      const list = [];
      snap.forEach((doc) => { const x = doc.data() || {}; if (x.status !== "trashed" && stkNorm(x.parcName) === stkNorm(parcName)) list.push({ id: doc.id, ...x }); });
      list.sort((a, b) => String(b.invDate).localeCompare(String(a.invDate)));
      setInvs(list);
      if (list[0]) setSel(list[0].id);
    }).catch((e) => setErr("Lecture des inventaires impossible : " + (e.message || e)));
  }, [parcName]);
  const run = async () => {
    const inv = invs.find((i) => i.id === sel);
    if (!inv) return;
    setErr(""); setRes(null);
    try {
      setBusy("Lecture des châssis scannés...");
      const snap = await db.collection("inventories").doc(inv.id).collection("scans").get();
      const scanned = new Map();
      snap.forEach((doc) => { const x = doc.data() || {}; if (x.deleted) return; const c = stkNormChassis(x.chassis || x.norm || doc.id); if (c) scanned.set(c, x); });
      setBusy("Lecture du stock déclaré à la date de l'inventaire...");
      const st = await stkCall("parc_stock", { parc_id: parcId, date: inv.invDate });
      const declared = new Map(st.rows.map((r) => [r.chassis, r]));
      const both = st.rows.filter((r) => scanned.has(r.chassis));
      const manquants = st.rows.filter((r) => !scanned.has(r.chassis));
      const nonDeclares = [...scanned.entries()].filter(([c]) => !declared.has(c)).map(([c, x]) => ({ chassis: c, agent: x.agentName, source: x.source, vehicleName: x.vehicleName || x.description || "" }));
      const proches = stkTypoPairs(manquants.map((r) => r.chassis), nonDeclares.map((r) => r.chassis));
      setRes({ inv, lastImport: st.lastImport, both, manquants, nonDeclares, proches, nScanned: scanned.size, nDeclared: st.rows.length });
      setTab("manquants");
    } catch (e) { setErr(stkErrText(e)); }
    setBusy("");
  };
  const rows = res ? (tab === "manquants" ? res.manquants : tab === "nondeclares" ? res.nonDeclares : tab === "ok" ? res.both : res.proches) : [];
  const exp = (k) => {
    const title = { manquants: "Déclarés par le parc mais non trouvés à l'inventaire", nondeclares: "Trouvés à l'inventaire mais non déclarés par le parc", ok: "Déclarés et trouvés", proches: "Fautes de frappe probables" }[tab];
    const meta = [`Parc : ${parcName}`, `Inventaire du ${stkFmt(res.inv.invDate)} · stock déclaré au ${res.lastImport ? stkFmt(res.lastImport.stock_date) : "—"}`];
    const cols = tab === "nondeclares" ? [{ h: "Châssis", k: "chassis" }, { h: "Véhicule", k: "vehicleName" }, { h: "Agent", k: "agent" }] : tab === "proches" ? [{ h: "Déclaré", k: "entree" }, { h: "Scanné", k: "sortie" }, { h: "Écart", k: "distance" }] : stkExportCols(cfg, res.inv.invDate);
    k === "x" ? stkExportXlsx(`Controle_inventaire_${parcName}_${res.inv.invDate}_${tab}`, title, meta, cols, rows) : stkPrintPdf(title, meta, cols, rows);
  };
  return <StkCard className="p-4 md:p-5 space-y-4">
    <div className="text-sm text-slate-600">Compare le stock déclaré par le parc (fichier importé à la date de l'inventaire) avec les châssis réellement scannés par les agents dans INVENTAIRE MMTE.</div>
    {err && <StkMsg tone="err">{err}</StkMsg>}
    {!invs ? <StkLoading text="Recherche des inventaires de ce parc..." /> : !invs.length ? <StkMsg tone="info">Aucun inventaire physique enregistré pour ce parc dans INVENTAIRE MMTE.</StkMsg> :
      <div className="flex flex-wrap gap-3 items-end">
        <StkField label="Inventaire physique"><select value={sel} onChange={(e) => setSel(e.target.value)} className={stkInput}>{invs.map((i) => <option key={i.id} value={i.id}>{stkFmt(i.invDate)} — {i.status === "closed" ? "clôturé" : i.status === "in_progress" ? "en cours" : i.status}</option>)}</select></StkField>
        <StkBtn kind="primary" disabled={!!busy || !sel} onClick={run}>{busy || "Comparer"}</StkBtn>
      </div>}
    {res && <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StkKpi label="Déclarés par le parc" value={res.nDeclared} tone="slate" sub={res.lastImport ? `Fichier du ${stkFmt(res.lastImport.stock_date)}` : "Aucun fichier"} />
        <StkKpi label="Scannés à l'inventaire" value={res.nScanned} tone="slate" />
        <StkKpi label="Déclarés non trouvés" value={res.manquants.length} tone="rose" onClick={() => setTab("manquants")} />
        <StkKpi label="Trouvés non déclarés" value={res.nonDeclares.length} tone="amber" onClick={() => setTab("nondeclares")} />
      </div>
      {!res.lastImport && <StkMsg tone="warn">Aucun fichier de stock importé à cette date ou avant : importez le fichier du parc de la semaine de l'inventaire.</StkMsg>}
      <div className="flex flex-wrap items-center gap-2"><StkTabs tabs={[{ key: "manquants", label: "Déclarés non trouvés", count: res.manquants.length }, { key: "nondeclares", label: "Trouvés non déclarés", count: res.nonDeclares.length }, { key: "proches", label: "Fautes de frappe probables", count: res.proches.length }, { key: "ok", label: "Concordants", count: res.both.length }]} value={tab} onChange={setTab} /><div className="flex-1" /><StkExportBar disabled={!rows.length} onXlsx={() => exp("x")} onPdf={() => exp("p")} /></div>
      {tab === "nondeclares" ? <StkTable rowKey={(r) => r.chassis} rows={rows} columns={[{ key: "chassis", label: "Châssis scanné", render: (r) => <button className="font-plex-mono font-bold text-[#1B4F8C] underline" onClick={() => openVehicle({ chassis: r.chassis, fallbackSearch: true })}>{r.chassis}</button> }, { key: "vehicleName", label: "Véhicule" }, { key: "agent", label: "Scanné par" }]} empty="Aucun." />
        : tab === "proches" ? <StkTable rowKey={(r) => r.entree + r.sortie} rows={rows} columns={[{ key: "entree", label: "Déclaré par le parc", render: (r) => <span className="font-plex-mono">{r.entree}</span> }, { key: "sortie", label: "Scanné", render: (r) => <span className="font-plex-mono">{r.sortie}</span> }, { key: "distance", label: "Écart", render: (r) => `${r.distance} car.` }]} empty="Aucune." />
        : <StkTable columns={stkCols(cfg, res.inv.invDate, { entree: true })} rows={rows} onRow={(r) => openVehicle({ id: r.vehicle_id })} empty="Aucun." />}
    </>}
  </StkCard>;
}

// ---------- Contrôle croisé avec un export MMTE ----------
function StkMmteCheck() {
  const C = React.useContext(StkCtx);
  const { dash, cfg, openVehicle, reloadDash } = C;
  const [parc, setParc] = useState("");
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState("");
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("ecarts");
  const [invs, setInvs] = useState(null);
  const toIso = (dmy) => { const m = String(dmy || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
  const fromInfoMap = (map) => Array.from(map.values()).map((info) => ({ chassis: stkNormChassis(info.chassis), depot: toIso(info.depotDate), entry: toIso(info.entryDate), registred: toIso(info.registredAt), data: { navire: info.shipName || "", manifeste: info.atp || "", description: info.description || "", bl: info.bl || "" } })).filter((r) => r.chassis);
  const onFile = async (f) => {
    if (!f) return;
    setErr(""); setRes(null); setFileName(f.name);
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { cellDates: true, type: "array" });
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
      const hi = aoa.findIndex((r) => (r || []).some((c) => matchFieldAlias(c) === "chassis"));
      if (hi < 0) throw new Error("colonne châssis introuvable");
      const map = buildRichMap(aoa[hi].map(String), aoa.slice(hi + 1));
      if (!map) throw new Error("aucun châssis lu");
      setRows(fromInfoMap(map));
    } catch (e) { setErr("Export MMTE illisible : " + (e.message || e)); }
  };
  const loadInvs = () => db.collection("inventories").get().then((snap) => { const l = []; snap.forEach((d) => { const x = d.data() || {}; if (x.status !== "trashed") l.push({ id: d.id, ...x }); }); l.sort((a, b) => String(b.invDate).localeCompare(String(a.invDate))); setInvs(l); }).catch((e) => setErr(String(e.message || e)));
  const fromInventory = async (id) => {
    const inv = invs.find((i) => i.id === id); if (!inv) return;
    setBusy("Lecture de la liste MMTE de l'inventaire..."); setErr("");
    try { const map = await loadMmteMap(db.collection("inventories").doc(id)); setRows(fromInfoMap(map)); setFileName(`Liste MMTE de l'inventaire ${inv.parcName} du ${stkFmt(inv.invDate)}`); if (!parc) { const p = dash.find((d) => stkNorm(d.parc) === stkNorm(inv.parcName)); if (p) setParc(p.parc); } }
    catch (e) { setErr(String(e.message || e)); }
    setBusy("");
  };
  const run = async () => {
    setBusy("Contrôle en cours..."); setErr("");
    try { setRes(await stkCall("mmte_sync", { rows, parc_name: parc })); reloadDash(); setTab("ecarts"); } catch (e) { setErr(stkErrText(e)); }
    setBusy("");
  };
  const list = res ? (tab === "ecarts" ? res.ecarts : (tab === "absents_base" ? res.absents_base : res.absents_mmte).map((c) => ({ chassis: c }))) : [];
  const exp = (k) => {
    const title = { ecarts: "Écarts de date de dépôt (parc / MMTE)", absents_base: "Dans MMTE mais absents des stocks des parcs", absents_mmte: "Dans le stock du parc mais absents de MMTE" }[tab];
    const cols = tab === "ecarts" ? [{ h: "Châssis", k: "chassis" }, { h: "Arrivée (parc)", x: (r) => stkFmt(r.date_arrivee) }, { h: "Dépôt calculé", x: (r) => stkFmt(r.depot_calcule) }, { h: "Dépôt MMTE", x: (r) => stkFmt(r.depot_mmte) }, { h: "Écart (jours)", k: "ecart" }] : [{ h: "Châssis", k: "chassis" }];
    const meta = [`Source : ${fileName}`, parc ? `Parc : ${parc}` : "Tous les parcs"];
    k === "x" ? stkExportXlsx(`Controle_MMTE_${tab}_${stkToday()}`, title, meta, cols, list) : stkPrintPdf(title, meta, cols, list);
  };
  return <>
    <StkPageHead title="Contrôle avec MMTE" sub="Comparez les stocks déclarés par les parcs avec l'export de la plateforme MMTE : dates de dépôt, véhicules manquants de part et d'autre." />
    <StkCard className="p-4 md:p-5 space-y-4">
      <div className="grid md:grid-cols-2 gap-3">
        <StkField label="Parc concerné (facultatif)" hint="Indiquez le parc si l'export MMTE ne concerne qu'un parc : les véhicules du stock absents de MMTE seront listés."><select value={parc} onChange={(e) => setParc(e.target.value)} className={stkInput}><option value="">Tous les parcs</option>{dash.map((d) => <option key={d.parc_id} value={d.parc}>{d.parc}</option>)}</select></StkField>
        <StkField label="Export MMTE (CSV ou Excel)"><input type="file" accept=".csv,.xlsx,.xls,.txt" onChange={(e) => onFile(e.target.files && e.target.files[0])} className="block text-sm mt-2" /></StkField>
      </div>
      <div className="text-sm text-slate-500">ou reprendre la liste MMTE déjà chargée dans un inventaire : {invs ? <select onChange={(e) => fromInventory(e.target.value)} className={`${stkInput} inline-block w-auto ml-2`} defaultValue=""><option value="" disabled>Choisir un inventaire</option>{invs.map((i) => <option key={i.id} value={i.id}>{i.parcName} — {stkFmt(i.invDate)}</option>)}</select> : <button className="font-bold text-[#1B4F8C] underline" onClick={loadInvs}>afficher les inventaires</button>}</div>
      {rows && <StkMsg tone="info"><b>{rows.length}</b> châssis lus depuis « {fileName} » · {rows.filter((r) => r.depot).length} avec une date de dépôt.</StkMsg>}
      {err && <StkMsg tone="err">{err}</StkMsg>}
      <StkBtn kind="primary" disabled={!rows || !!busy || !stkCanEdit(C)} onClick={run}>{busy || "Lancer le contrôle"}</StkBtn>
      {!stkCanEdit(C) && <div className="text-xs text-slate-500">Votre accès est en consultation seule.</div>}
    </StkCard>
    {res && <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StkKpi label="Châssis MMTE lus" value={res.lus} tone="slate" />
        <StkKpi label="Retrouvés dans les stocks" value={res.trouves} tone="green" />
        <StkKpi label="Écarts de dépôt (> 3 j)" value={res.ecarts.length} tone="rose" onClick={() => setTab("ecarts")} />
        <StkKpi label="MMTE absents des stocks" value={res.absents_base.length} tone="amber" onClick={() => setTab("absents_base")} />
      </div>
      <StkCard className="p-4 md:p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-2"><StkTabs tabs={[{ key: "ecarts", label: "Écarts de dépôt", count: res.ecarts.length }, { key: "absents_base", label: "Dans MMTE, absents des stocks", count: res.absents_base.length }, ...(parc ? [{ key: "absents_mmte", label: "Dans le stock, absents de MMTE", count: res.absents_mmte.length }] : [])]} value={tab} onChange={setTab} /><div className="flex-1" /><StkExportBar disabled={!list.length} onXlsx={() => exp("x")} onPdf={() => exp("p")} /></div>
        <StkTable rowKey={(r) => r.chassis} rows={list} columns={tab === "ecarts" ? [{ key: "chassis", label: "Châssis", render: (r) => <button className="font-plex-mono font-bold text-[#1B4F8C] underline" onClick={() => openVehicle({ chassis: r.chassis })}>{r.chassis}</button> }, { key: "date_arrivee", label: "Arrivée (parc)", render: (r) => stkFmt(r.date_arrivee) }, { key: "depot_calcule", label: "Dépôt calculé", render: (r) => stkFmt(r.depot_calcule) }, { key: "depot_mmte", label: "Dépôt MMTE", render: (r) => <b>{stkFmt(r.depot_mmte)}</b> }, { key: "ecart", label: "Écart", sort: (r) => Math.abs(r.ecart), render: (r) => `${r.ecart > 0 ? "+" : ""}${r.ecart} j` }] : [{ key: "chassis", label: "Châssis", render: (r) => <span className="font-plex-mono font-bold">{r.chassis}</span> }]} empty="Aucun." />
        <div className="text-xs text-slate-500">Les dates MMTE sont enregistrées sur les fiches véhicules. Dans Administration › Paramètres, vous pouvez choisir d'utiliser la date de dépôt MMTE quand elle est connue.</div>
      </StkCard>
    </>}
  </>;
}

// ---------- Filtres de recherche enregistrés ----------
function StkSavedFilters({ current, onApply }) {
  const C = React.useContext(StkCtx);
  const [list, setList] = useState([]);
  const load = () => stkCall("filters_list", {}).then(setList).catch(() => {});
  useEffect(() => { load(); }, []);
  const save = async () => {
    const name = window.prompt("Nom de ce filtre (ex. « Dépôt dans moins de 30 jours ») :");
    if (!name) return;
    const shared = window.confirm("Partager ce filtre avec toute l'équipe ?\n\nOK = partagé · Annuler = pour moi seulement");
    try { await stkCall("filter_save", { name, params: current, shared }); load(); } catch (e) { alert(stkErrText(e)); }
  };
  const del = async (f) => { if (!window.confirm(`Supprimer le filtre « ${f.name} » ?`)) return; try { await stkCall("filter_delete", { id: f.id }); load(); } catch (e) { alert(stkErrText(e)); } };
  return <div className="flex flex-wrap gap-2 items-center">
    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Filtres enregistrés</span>
    {list.map((f) => <span key={f.id} className="inline-flex items-center rounded-lg border-2 border-[#1B4F8C]/20 bg-white overflow-hidden">
      <button className="px-3 py-1 text-sm font-semibold text-[#123A66] hover:bg-[#EAF1FA]" onClick={() => onApply(f.params)} title={f.shared ? `Partagé par ${f.owner_name}` : "Personnel"}>{f.name}{f.shared ? " ·" : ""}</button>
      {(f.owner_uid === (C.me && C.me.uid) || C.isAdmin) && <button className="px-2 text-slate-400 hover:text-rose-600" onClick={() => del(f)} aria-label="Supprimer">✕</button>}
    </span>)}
    <StkBtn small kind="ghost" onClick={save}><StkIc.Plus size={14} /> Enregistrer ce filtre</StkBtn>
  </div>;
}

// ---------- Sauvegarde complète (Excel) ----------
async function stkBackup(setBusy) {
  setBusy("Préparation de la sauvegarde...");
  try {
    const d = await stkCall("export_all", {});
    const wb = XLSX.utils.book_new();
    const add = (name, rows, map) => { const ws = XLSX.utils.json_to_sheet(rows.map(map || ((r) => r))); XLSX.utils.book_append_sheet(wb, ws, name); };
    add("Lisez-moi", [{ Information: `Sauvegarde complète du Suivi des stocks MAD ROULANTS — ${new Date(d.at).toLocaleString("fr-FR")}` }, { Information: `${d.vehicles.length} véhicules, ${d.stays.length} mouvements, ${d.imports.length} imports, ${d.parcs.length} parcs` }, { Information: "À conserver en lieu sûr (serveur, clé USB, messagerie). Une sauvegarde par semaine est recommandée." }]);
    add("Véhicules", d.vehicles, (v) => ({ ...v, data: JSON.stringify(v.data || {}), locked_fields: (v.locked_fields || []).join(", ") }));
    add("Mouvements", d.stays, (s) => ({ ...s, justif_files: (s.justif_files || []).map((f) => f.name).join(" ; ") }));
    add("Imports", d.imports, (i) => ({ ...i, parc: i.parcs && i.parcs.name, parcs: undefined }));
    add("Parcs", d.parcs);
    add("Châssis corrigés", d.aliases.length ? d.aliases : [{ alias: "", chassis: "" }]);
    add("Paramètres", Object.entries(d.settings).map(([k, v]) => ({ parametre: k, valeur: JSON.stringify(v) })));
    add("Journal", d.audit);
    XLSX.writeFile(wb, `Sauvegarde_stocks_MMTE_${stkToday()}.xlsx`);
  } catch (e) { alert(stkErrText(e)); }
  setBusy("");
}

// ---------- Administration : utilisateurs ----------
function StkAdminUsers() {
  const C = React.useContext(StkCtx);
  const [rows, setRows] = useState(null);
  const [def, setDef] = useState((C.settings && C.settings.acces_par_defaut) || "agent");
  const load = () => stkCall("users_list", {}).then(setRows).catch((e) => alert(stkErrText(e)));
  useEffect(() => { load(); }, []);
  const set = async (u, access) => { try { await stkCall("user_save", { uid: u.uid, access, name: u.name }); load(); } catch (e) { alert(stkErrText(e)); } };
  const saveDef = async (v) => { setDef(v); try { await stkCall("settings_save", { key: "acces_par_defaut", value: v }); } catch (e) { alert(stkErrText(e)); } };
  const L = { agent: "Agent MMTE (import, justification)", consultation: "Consultation seule", aucun: "Aucun accès" };
  return <StkCard className="p-4 md:p-5 space-y-4">
    <div className="text-sm text-slate-600">Chaque personne qui ouvre le suivi des stocks apparaît ici. Les administrateurs d'INVENTAIRE MMTE ont toujours un accès complet.</div>
    <StkField label="Accès donné automatiquement aux nouveaux utilisateurs" className="max-w-md"><select value={def} onChange={(e) => saveDef(e.target.value)} className={stkInput}>{Object.entries(L).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></StkField>
    {!rows ? <StkLoading /> : <StkTable rowKey={(r) => r.uid} rows={rows} columns={[{ key: "name", label: "Nom", render: (r) => <b>{r.name}</b> }, { key: "email", label: "E-mail", render: (r) => <span className="text-slate-500">{r.email}</span> }, { key: "last_seen", label: "Dernière visite", render: (r) => <span className="text-xs">{stkFmtTs(r.last_seen)}</span> }, { key: "access", label: "Accès", render: (r) => <select value={r.access} onChange={(e) => set(r, e.target.value)} className={`${stkInput} py-1 min-w-[220px]`}>{Object.entries(L).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select> }]} empty="Personne n'a encore ouvert le module." />}
  </StkCard>;
}
function StkAdminAliases() {
  const [rows, setRows] = useState(null);
  const load = () => stkCall("aliases_list", {}).then(setRows).catch((e) => alert(stkErrText(e)));
  useEffect(() => { load(); }, []);
  const del = async (a) => { if (!window.confirm(`Ne plus corriger automatiquement « ${a.alias} » ?`)) return; try { await stkCall("alias_delete", { alias: a.alias }); load(); } catch (e) { alert(stkErrText(e)); } };
  return <StkCard className="p-4 md:p-5 space-y-3">
    <div className="text-sm text-slate-600">Châssis mal saisis par les parcs, fusionnés avec le bon véhicule. Les prochains fichiers contenant la faute sont corrigés automatiquement.</div>
    {!rows ? <StkLoading /> : <StkTable rowKey={(r) => r.alias} rows={rows} columns={[{ key: "alias", label: "Écrit dans les fichiers", render: (r) => <span className="font-plex-mono">{r.alias}</span> }, { key: "chassis", label: "Corrigé en", render: (r) => <span className="font-plex-mono font-bold">{r.chassis}</span> }, { key: "created_by", label: "Par", render: (r) => <span className="text-xs">{r.created_by}<br />{stkFmtTs(r.created_at)}</span> }, { key: "x", label: "", sortable: false, render: (r) => <StkBtn small kind="danger" onClick={() => del(r)}>Supprimer</StkBtn> }]} empty="Aucune correction mémorisée." />}
  </StkCard>;
}
function StkAdminBackup() {
  const [busy, setBusy] = useState("");
  return <StkCard className="p-4 md:p-5 space-y-3 max-w-2xl">
    <div className="font-bold text-[#0B1F38] text-lg">Sauvegarde complète</div>
    <div className="text-sm text-slate-600">Télécharge un fichier Excel avec tous les véhicules, mouvements, justificatifs (références), imports, parcs, paramètres et le journal. Conservez-en une copie chaque semaine hors de l'application (serveur Bénin Control, clé USB, messagerie).</div>
    <StkMsg tone="info">Le forfait gratuit de Supabase ne garantit pas de sauvegarde restaurable. Le forfait Pro (environ 25 $ / mois) ajoute des sauvegardes quotidiennes automatiques.</StkMsg>
    <StkBtn kind="primary" disabled={!!busy} onClick={() => stkBackup(setBusy)}><Download size={16} /> {busy || "Télécharger la sauvegarde"}</StkBtn>
  </StkCard>;
}
