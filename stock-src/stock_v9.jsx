// ---------------- Mouvements par semaine et transferts parc à parc (6.10) ----------------
// Semaine du lundi au dimanche. Un mouvement constaté par un fichier daté d'un lundi (état du lundi matin)
// est rattaché à la semaine précédente. Un transfert compte dans la semaine de DÉPART pour les deux parcs
// (le véhicule quitte l'un et entre dans l'autre à la même date). Calculs faits par la base (v_mouvements, stock_weeks).
const STK_MV = {
  entree: { l: "Entrée", pl: "Entrées", c: "bg-emerald-50 text-emerald-800 border-emerald-200", t: "text-emerald-700" },
  sortie: { l: "Sortie", pl: "Sorties", c: "bg-rose-50 text-rose-800 border-rose-200", t: "text-rose-700" },
  transfert_recu: { l: "Transfert reçu", pl: "Transferts reçus", c: "bg-sky-50 text-sky-800 border-sky-200", t: "text-sky-700" },
  transfert_envoye: { l: "Transfert envoyé", pl: "Transferts envoyés", c: "bg-indigo-50 text-indigo-800 border-indigo-200", t: "text-indigo-700" }
};
function stkIsoWeek(mon) {
  const d = new Date(String(mon).slice(0, 10) + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 3);
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d - jan4) / 864e5 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
}
function stkWeekName(mon, short) { return short ? `S${stkIsoWeek(mon)} · ${stkFmt(mon).slice(0, 5)} → ${stkFmt(stkAddDays(mon, 6)).slice(0, 5)}` : `Semaine ${stkIsoWeek(mon)} — du ${stkFmt(mon)} au ${stkFmt(stkAddDays(mon, 6))}`; }
function stkMvOther(r) { return r.autre_parc ? (r.type === "transfert_recu" ? `depuis ${r.autre_parc}` : r.type === "transfert_envoye" ? `vers ${r.autre_parc}` : "") : ""; }
function stkMvDateNote(r) {
  if (r.saisie) return "date saisie";
  if (r.date_eff && r.date_mvt && r.date_eff !== r.date_mvt) return "fichier du lundi : semaine précédente";
  return "";
}
function stkMvCols(showParc) {
  const cols = [
    { key: "chassis", label: "Châssis", render: (r) => <span className="font-plex-mono font-bold text-[#0B1F38] whitespace-nowrap">{r.chassis}</span> },
    { key: "veh", label: "Véhicule", sort: (r) => stkVeh(r), render: (r) => <span className="text-slate-700">{stkVeh(r) || "—"}</span> },
    { key: "navire", label: "Navire", render: (r) => <span className="text-slate-600">{r.navire || "—"}</span> }
  ];
  if (showParc) cols.push({ key: "parc", label: "Parc", render: (r) => <b className="text-slate-700">{r.parc}</b> });
  cols.push(
    { key: "type", label: "Mouvement", render: (r) => <div><StkBadge tone={STK_MV[r.type].c}>{STK_MV[r.type].l}{r.confirme ? " (confirmé)" : ""}</StkBadge>{stkMvOther(r) && <div className="text-[11px] font-bold text-slate-600 mt-0.5">{stkMvOther(r)}</div>}</div> },
    { key: "date_mvt", label: "Date", render: (r) => <span>{stkFmt(r.date_mvt)}{stkMvDateNote(r) && <span className="block text-[11px] text-slate-400">{stkMvDateNote(r)}</span>}</span> },
    { key: "semaine", label: "Semaine", render: (r) => <span className="text-xs text-slate-600">S{stkIsoWeek(r.semaine)}</span> },
    { key: "date_arrivee", label: "Arrivée navire", render: (r) => stkFmt(r.date_arrivee) || "—" },
    { key: "justif_status", label: "Justification", sortable: false, render: (r) => r.type === "sortie" || r.type === "transfert_envoye" ? <span><StkBadge tone={STK_JUSTIF[r.justif_status || "non_justifiee"].tone}>{STK_JUSTIF[r.justif_status || "non_justifiee"].label}</StkBadge>{r.justif_numero && <span className="block text-[11px] text-slate-500 mt-0.5">{r.justif_numero}</span>}</span> : "" }
  );
  return cols;
}
const STK_MV_EXPORT = [
  { h: "Châssis", k: "chassis", w: 22 }, { h: "Marque", k: "marque" }, { h: "Modèle", k: "modele" }, { h: "Année", k: "annee", w: 7 },
  { h: "Navire", k: "navire", w: 20 }, { h: "Manifeste", k: "manifeste", w: 14 }, { h: "N° BL", k: "bl", w: 14 }, { h: "Parc", k: "parc", w: 20 },
  { h: "Mouvement", x: (r) => STK_MV[r.type].l + (r.confirme ? " (confirmé)" : ""), w: 16 }, { h: "Autre parc", k: "autre_parc", w: 20 },
  { h: "Date", x: (r) => stkFmt(r.date_mvt), w: 12 }, { h: "Semaine", x: (r) => stkWeekName(r.semaine), w: 34 },
  { h: "Arrivée navire", x: (r) => stkFmt(r.date_arrivee), w: 12 }, { h: "Importateur", k: "importateur", w: 22 },
  { h: "Justification", x: (r) => (r.type === "sortie" || r.type === "transfert_envoye" ? STK_JUSTIF[r.justif_status || "non_justifiee"].label : ""), w: 14 },
  { h: "N° de déclaration", k: "justif_numero", w: 16 }
];
// Classeur à plusieurs onglets
function stkExportBook(fileName, sheets) {
  const wb = XLSX.utils.book_new();
  sheets.forEach((sh) => {
    const aoa = [[sh.title], ...(sh.meta || []).map((m) => [m]), [], sh.columns.map((c) => c.h)];
    sh.rows.forEach((r) => aoa.push(sh.columns.map((c) => { const v = c.x ? c.x(r) : r[c.k]; return v == null ? "" : v; })));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = sh.columns.map((c) => ({ wch: c.w || 16 }));
    XLSX.utils.book_append_sheet(wb, ws, sh.name.slice(0, 31));
  });
  XLSX.writeFile(wb, fileName.replace(/[\\/:*?"<>|]+/g, "_") + ".xlsx");
}

// Choix d'une semaine : flèches ‹ › et calendrier
function StkWeekPicker({ mon, setMon }) {
  const cur = stkMonday(stkToday());
  return <div className="flex items-center gap-1.5" data-testid="week-picker">
    <StkBtn small onClick={() => setMon(stkAddDays(mon, -7))} aria-label="Semaine précédente">‹</StkBtn>
    <div className="px-3 py-1.5 rounded-lg border-2 border-slate-200 bg-white text-sm font-bold text-[#0B1F38] whitespace-nowrap">{stkWeekName(mon)}</div>
    <StkBtn small disabled={mon >= cur} onClick={() => setMon(stkAddDays(mon, 7))} aria-label="Semaine suivante">›</StkBtn>
    <input type="date" value={mon} max={stkToday()} onChange={(e) => e.target.value && setMon(stkMonday(e.target.value))} className={`${stkInput} py-1 w-[150px]`} title="Aller à la semaine contenant cette date" />
  </div>;
}

// Liste de mouvements (filtrée par semaine ou par période), avec export
function StkMvList({ parcId, weekFrom, weekTo, from, to, types, title, compact }) {
  const C = React.useContext(StkCtx);
  const { openVehicle, dash } = C;
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const key = JSON.stringify([parcId, weekFrom, weekTo, from, to, types]);
  useEffect(() => {
    let alive = true;
    setRows(null); setErr("");
    stkCall("mouvements", { parc_id: parcId || null, week_from: weekFrom || null, week_to: weekTo || null, from: from || null, to: to || null, types })
      .then((r) => alive && setRows(r)).catch((e) => alive && (setErr(stkErrText(e)), setRows([])));
    return () => { alive = false; };
  }, [key]);
  const filtered = stkFilterRows(rows || [], q);
  const parcName = parcId ? (dash.find((d) => d.parc_id === Number(parcId)) || {}).parc : "Tous les parcs";
  const period = weekFrom ? (weekFrom === weekTo ? stkWeekName(weekFrom) : `Semaines du ${stkFmt(weekFrom)} au ${stkFmt(stkAddDays(weekTo, 6))}`) : `Période du ${stkFmt(from)} au ${stkFmt(to)}`;
  const exp = (k) => {
    const meta = [period, `Parc : ${parcName}`, "Un fichier daté d'un lundi décrit la semaine précédente."];
    const t = title || "Mouvements";
    if (k === "x") stkExportXlsx(`${t}_${parcName}_${weekFrom || from}`, `${t} — ${parcName}`, meta, STK_MV_EXPORT, filtered);
    else stkPrintPdf(`${t} — ${parcName}`, meta, STK_MV_EXPORT.filter((c) => !["Manifeste", "N° BL", "Importateur", "Semaine"].includes(c.h)), filtered, true);
  };
  const counts = {}; (rows || []).forEach((r) => (counts[r.type] = (counts[r.type] || 0) + 1));
  return <div className="space-y-3" data-testid="mv-list">
    <div className="flex flex-wrap gap-2 items-center">
      {Object.keys(STK_MV).filter((k) => counts[k]).map((k) => <StkBadge key={k} tone={STK_MV[k].c}>{STK_MV[k].pl} : {counts[k].toLocaleString("fr-FR")}</StkBadge>)}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer : châssis, marque, navire, parc..." className={`${stkInput} flex-1 min-w-[180px]`} />
      <StkExportBar disabled={!filtered.length} onXlsx={() => exp("x")} onPdf={() => exp("p")} />
    </div>
    {err && <StkMsg tone="err">{err}</StkMsg>}
    {!rows ? <StkLoading /> : <StkTable columns={stkMvCols(!parcId)} rows={filtered} rowKey={(r) => r.type + r.stay_id} initial={compact ? 100 : 200} onRow={(r) => openVehicle({ id: r.vehicle_id })} empty="Aucun mouvement." />}
  </div>;
}

// A et C — Tableau des mouvements par semaine (tous les parcs ou un parc)
function StkWeeks({ parcId: fixed }) {
  const C = React.useContext(StkCtx);
  const { dash } = C;
  const [parc, setParc] = useState(fixed ? String(fixed) : "");
  const [n, setN] = useState(12);
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const pid = fixed || parc || null;
  const cur = stkMonday(stkToday());
  const first = stkAddDays(cur, -7 * (n - 1));
  useEffect(() => {
    setRows(null); setErr("");
    stkCall("weeks", { parc_id: pid, from: first, to: stkToday() }).then(setRows).catch((e) => { setErr(stkErrText(e)); setRows([]); });
  }, [pid, n]);
  const parcName = pid ? (dash.find((d) => d.parc_id === Number(pid)) || {}).parc : "Tous les parcs";
  const hasInit = (rows || []).some((r) => r.initial);
  const tot = (k) => (rows || []).reduce((a, r) => a + r[k], 0);
  const ok = (r) => r.stock_debut + r.initial + r.entrees + r.tr_recus - r.sorties - r.tr_envoyes === r.stock_fin;
  const cols = [
    ["entrees", "entree", "Entrées"], ["sorties", "sortie", "Sorties"], ["tr_recus", "transfert_recu", "Transferts reçus"], ["tr_envoyes", "transfert_envoye", "Transferts envoyés"]
  ];
  const tableCols = [{ h: "Semaine", x: (r) => stkWeekName(r.semaine), w: 36 }, { h: "Stock début", k: "stock_debut", w: 12 }].concat(hasInit ? [{ h: "Premier fichier", k: "initial", w: 12 }] : [])
    .concat(cols.map(([k, , l]) => ({ h: l, k, w: 12 }))).concat([{ h: "Stock fin", k: "stock_fin", w: 12 }]);
  const exportTable = () => stkExportXlsx(`Mouvements_par_semaine_${parcName}_${first}`, `Mouvements par semaine — ${parcName}`, [`Du ${stkFmt(first)} au ${stkFmt(stkAddDays(cur, 6))}`, "Semaines du lundi au dimanche ; un fichier daté d'un lundi décrit la semaine précédente."], tableCols, rows || []);
  const exportDetail = async () => {
    setBusy(true);
    try {
      const all = await stkCall("mouvements", { parc_id: pid, week_from: first, week_to: cur });
      const meta = [`${parcName} — du ${stkFmt(first)} au ${stkFmt(stkAddDays(cur, 6))}`];
      stkExportBook(`Mouvements_detail_${parcName}_${first}`, [{ name: "Par semaine", title: `Mouvements par semaine — ${parcName}`, meta, columns: tableCols, rows: rows || [] }]
        .concat(cols.map(([, t, l]) => ({ name: l, title: `${l} — ${parcName}`, meta, columns: STK_MV_EXPORT, rows: all.filter((r) => r.type === t) }))));
    } catch (e) { setErr(stkErrText(e)); }
    setBusy(false);
  };
  const Cell = ({ r, k, t }) => r[k] ? <button className={`font-plex-mono font-bold underline decoration-dotted ${STK_MV[t].t}`} onClick={() => setDetail({ week: r.semaine, types: [t], title: `${STK_MV[t].pl} — ${stkWeekName(r.semaine)}` })} data-testid={`wk-${k}`}>{r[k].toLocaleString("fr-FR")}</button> : <span className="text-slate-300">0</span>;
  return <div className="space-y-4">
    {!fixed && <StkPageHead title="Mouvements par semaine" sub="Entrées, sorties et transferts parc à parc, semaine par semaine (du lundi au dimanche). Cliquez sur un chiffre pour voir les châssis." />}
    <StkCard className="p-4 md:p-5 space-y-3 min-w-0">
      <div className="flex flex-wrap gap-3 items-end">
        {!fixed && <StkField label="Parc"><select value={parc} onChange={(e) => setParc(e.target.value)} className={stkInput} data-testid="wk-parc"><option value="">Tous les parcs</option>{dash.filter((d) => d.active !== false).map((d) => <option key={d.parc_id} value={d.parc_id}>{d.parc}</option>)}</select></StkField>}
        <StkField label="Sur"><select value={n} onChange={(e) => setN(Number(e.target.value))} className={stkInput}>{[4, 8, 12, 26, 52].map((x) => <option key={x} value={x}>{x} semaines</option>)}</select></StkField>
        <div className="flex-1" />
        <StkBtn small disabled={!rows || !rows.length} onClick={exportTable}><Download size={14} /> Excel</StkBtn>
        <StkBtn small disabled={!rows || !rows.length || busy} onClick={exportDetail} data-testid="wk-export-detail"><Download size={14} /> {busy ? "Préparation..." : "Excel détaillé (avec les châssis)"}</StkBtn>
      </div>
      <div className="text-xs text-slate-500">Un transfert compte dans la semaine de départ, pour le parc de départ comme pour le parc d'arrivée{pid ? "" : " ; tous parcs confondus, il ne change pas le stock total"}.</div>
      {err && <StkMsg tone="err">{err}</StkMsg>}
      {!rows ? <StkLoading /> : <div className="overflow-x-auto -mx-4 md:mx-0" data-testid="weeks-table"><table className="w-full text-sm min-w-[760px]">
        <thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b-2 border-slate-200">
          <th className="py-2 px-3">Semaine</th><th className="px-3 text-right">Stock début</th>{hasInit && <th className="px-3 text-right">Premier fichier</th>}
          {cols.map(([k, t, l]) => <th key={k} className={`px-3 text-right ${STK_MV[t].t}`}>{l}</th>)}<th className="px-3 text-right">Stock fin</th><th className="px-3"></th>
        </tr></thead>
        <tbody>{rows.map((r) => <tr key={r.semaine} className={`border-b border-slate-100 ${r.semaine === cur ? "bg-[#EAF1FA]/60" : ""}`}>
          <td className="py-2 px-3"><button className="font-semibold text-[#123A66] hover:underline text-left" onClick={() => setDetail({ week: r.semaine, types: null, title: `Tous les mouvements — ${stkWeekName(r.semaine)}` })}>S{stkIsoWeek(r.semaine)} <span className="font-normal text-slate-500 text-xs">du {stkFmt(r.semaine).slice(0, 5)} au {stkFmt(stkAddDays(r.semaine, 6)).slice(0, 5)}{r.semaine === cur ? " · en cours" : ""}</span></button></td>
          <td className="px-3 text-right font-plex-mono">{r.stock_debut.toLocaleString("fr-FR")}</td>
          {hasInit && <td className="px-3 text-right font-plex-mono text-slate-500">{r.initial ? r.initial.toLocaleString("fr-FR") : ""}</td>}
          {cols.map(([k, t]) => <td key={k} className="px-3 text-right"><Cell r={r} k={k} t={t} /></td>)}
          <td className="px-3 text-right font-plex-mono font-bold text-[#0B1F38]">{r.stock_fin.toLocaleString("fr-FR")}</td>
          <td className="px-3 text-xs">{ok(r) ? <span className="text-emerald-600" title="Stock début + entrées − sorties ± transferts = stock fin">✓</span> : <span className="text-rose-700 font-bold" title="Le calcul ne tombe pas juste">écart</span>}</td>
        </tr>)}</tbody>
        <tfoot><tr className="border-t-2 border-slate-200 font-bold text-[#0B1F38]"><td className="py-2 px-3">Total {n} semaines</td><td></td>{hasInit && <td className="px-3 text-right font-plex-mono">{tot("initial").toLocaleString("fr-FR")}</td>}
          {cols.map(([k, t]) => <td key={k} className={`px-3 text-right font-plex-mono ${STK_MV[t].t}`}>{tot(k).toLocaleString("fr-FR")}</td>)}<td></td><td></td></tr></tfoot>
      </table></div>}
    </StkCard>
    {detail && <StkModal wide title={`${detail.title}${pid ? " · " + parcName : ""}`} onClose={() => setDetail(null)} footer={<StkBtn onClick={() => setDetail(null)}>Fermer</StkBtn>}>
      <StkMvList parcId={pid} weekFrom={detail.week} weekTo={detail.week} types={detail.types || undefined} title={detail.title.split(" — ")[0]} compact />
    </StkModal>}
  </div>;
}

// D — Transferts parc à parc : liste, flux, à confirmer
function StkTransfers({ parcId: fixed, weekFrom, weekTo, embedded }) {
  const C = React.useContext(StkCtx);
  const { dash, openVehicle, isAdmin, toast } = C;
  const canEdit = stkCanEdit(C);
  const [tab, setTab] = useState("liste");
  const [n, setN] = useState(12);
  const [statut, setStatut] = useState("");
  const [rows, setRows] = useState(null);
  const [cands, setCands] = useState(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const cur = stkMonday(stkToday());
  const from = weekFrom || stkAddDays(cur, -7 * (n - 1));
  const to = weekTo ? stkAddDays(weekTo, 6) : stkAddDays(cur, 6);
  const pid = fixed || null;
  const load = () => {
    setRows(null); setErr("");
    stkCall("transfers", { parc_id: pid, from, to }).then(setRows).catch((e) => { setErr(stkErrText(e)); setRows([]); });
    stkCall("transfer_candidates", {}).then((c) => setCands(pid ? c.filter((x) => x.depart_id === Number(pid) || x.arrivee_id === Number(pid)) : c)).catch(() => setCands([]));
  };
  useEffect(load, [pid, from, to]);
  const list = stkFilterRows((rows || []).filter((r) => !statut || r.statut === statut), q);
  const nDouble = (rows || []).filter((r) => r.statut === "double_presence").length;
  const parcName = pid ? (dash.find((d) => d.parc_id === Number(pid)) || {}).parc : "Tous les parcs";
  const ST = { complet: ["Complet", "bg-emerald-50 text-emerald-800 border-emerald-200"], double_presence: ["Double présence", "bg-amber-50 text-amber-900 border-amber-300"] };
  const decide = async (c, decision) => {
    try {
      await stkCall("transfer_decide", { ...c, decision });
      toast && toast(decision === "transfert" ? `Transfert confirmé : ${c.chassis}` : `Noté : deux mouvements distincts (${c.chassis})`);
      load(); C.reloadDash && C.reloadDash();
    } catch (e) { setErr(stkErrText(e)); }
  };
  const undo = async (r) => {
    if (!window.confirm(`Annuler la confirmation du transfert ${r.chassis} (${r.depart} → ${r.arrivee}) ?`)) return;
    try { await stkCall("transfer_undo", { vehicle_id: r.vehicle_id, depart_id: r.depart_id, arrivee_id: r.arrivee_id, date_arrivee: r.date_arrivee }); load(); } catch (e) { setErr(stkErrText(e)); }
  };
  const expCols = [{ h: "Châssis", k: "chassis", w: 22 }, { h: "Marque", k: "marque" }, { h: "Modèle", k: "modele" }, { h: "Navire", k: "navire", w: 20 },
    { h: "Parc de départ", k: "depart", w: 20 }, { h: "Parc d'arrivée", k: "arrivee", w: 20 }, { h: "Sortie du parc de départ", x: (r) => (r.date_sortie ? stkFmt(r.date_sortie) : "toujours présent"), w: 16 },
    { h: "Entrée au parc d'arrivée", x: (r) => stkFmt(r.date_arrivee), w: 16 },
    { h: "Semaine du transfert", x: (r) => stkWeekName(r.semaine_arrivee), w: 34 }, { h: "Délai (jours)", x: (r) => (r.delai == null ? "" : r.delai), w: 10 },
    { h: "Statut", x: (r) => ST[r.statut][0], w: 16 }, { h: "Origine", x: (r) => (r.origine === "confirme" ? "Confirmé par un agent" : "Automatique"), w: 18 }];
  const exp = (k) => {
    const meta = [`${parcName} — du ${stkFmt(from)} au ${stkFmt(to)}`];
    if (k === "x") stkExportXlsx(`Transferts_${parcName}_${from}`, `Transferts parc à parc — ${parcName}`, meta, expCols, list);
    else stkPrintPdf(`Transferts parc à parc — ${parcName}`, meta, expCols.filter((c) => !["Marque", "Modèle", "Navire", "Semaine du transfert", "Origine"].includes(c.h)), list, true);
  };
  // Flux : départ → arrivée
  const flux = useMemo(() => {
    const m = {}; (rows || []).forEach((r) => { const k = r.depart + "→" + r.arrivee; (m[k] = m[k] || { depart: r.depart, arrivee: r.arrivee, n: 0, double: 0 }).n++; if (r.statut === "double_presence") m[k].double++; });
    return Object.values(m).sort((a, b) => b.n - a.n);
  }, [rows]);
  const deps = Array.from(new Set(flux.map((f) => f.depart))).sort(), arrs = Array.from(new Set(flux.map((f) => f.arrivee))).sort();
  const cell = (d, a) => (flux.find((f) => f.depart === d && f.arrivee === a) || {}).n || 0;
  const tabs = [{ key: "liste", label: "Liste", count: rows ? rows.length : null }, { key: "flux", label: "Flux entre parcs" }, { key: "confirmer", label: "À confirmer", count: cands ? cands.length : null }];
  return <div className="space-y-4">
    {!embedded && !fixed && <StkPageHead title="Transferts parc à parc" sub="Un véhicule qui quitte un parc pour un autre est un transfert. Reconnu automatiquement quand l'arrivée suit la sortie de 14 jours au plus, à confirmer au-delà." />}
    <StkCard className="p-4 md:p-5 space-y-3 min-w-0" data-testid="transfers">
      <div className="flex flex-wrap gap-3 items-center">
        <StkTabs tabs={tabs} value={tab} onChange={setTab} />
        <div className="flex-1" />
        {!weekFrom && <select value={n} onChange={(e) => setN(Number(e.target.value))} className="border-2 border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">{[4, 8, 12, 26, 52].map((x) => <option key={x} value={x}>{x} dernières semaines</option>)}</select>}
      </div>
      {err && <StkMsg tone="err">{err}</StkMsg>}
      {tab === "liste" && <>
        <div className="flex flex-wrap gap-2 items-center">
          {[["", "Tous"], ["complet", "Complets"], ["double_presence", `Double présence (${nDouble})`]].map(([k, l]) => <button key={k} onClick={() => setStatut(k)} className={`px-3 py-1.5 rounded-full text-xs font-bold border-2 ${statut === k ? "bg-[#1B4F8C] text-white border-[#1B4F8C]" : "bg-white text-[#1B4F8C] border-[#1B4F8C]/20"}`}>{l}</button>)}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer" className={`${stkInput} flex-1 min-w-[160px]`} />
          <StkExportBar disabled={!list.length} onXlsx={() => exp("x")} onPdf={() => exp("p")} />
        </div>
        {nDouble > 0 && statut !== "complet" && <div className="text-xs text-amber-900">« Double présence » : le véhicule est arrivé dans le nouveau parc mais figure encore dans le dernier fichier de l'ancien. Normal en attendant le fichier suivant de l'ancien parc ; à vérifier si cela dure.</div>}
        {!rows ? <StkLoading /> : <StkTable rows={list} rowKey={(r) => r.vehicle_id + "|" + r.arrivee_id + "|" + r.date_arrivee} onRow={(r) => openVehicle({ id: r.vehicle_id })} empty="Aucun transfert sur la période." columns={[
          { key: "chassis", label: "Châssis", render: (r) => <span className="font-plex-mono font-bold text-[#0B1F38] whitespace-nowrap">{r.chassis}</span> },
          { key: "veh", label: "Véhicule", sort: (r) => stkVeh(r), render: (r) => <span className="text-slate-700">{stkVeh(r) || "—"}</span> },
          { key: "depart", label: "Départ", render: (r) => <div><b>{r.depart}</b><div className="text-[11px] text-slate-500">{r.date_sortie ? `sorti le ${stkFmt(r.date_sortie)}` : "toujours présent"}</div></div> },
          { key: "arrivee", label: "Arrivée", render: (r) => <div><b>{r.arrivee}</b><div className="text-[11px] text-slate-500">entré le {stkFmt(r.date_arrivee)}</div></div> },
          { key: "semaine_arrivee", label: "Semaine", render: (r) => <span className="text-xs">S{stkIsoWeek(r.semaine_arrivee)}{r.statut === "double_presence" ? " (provisoire)" : ""}</span> },
          { key: "delai", label: "Délai", render: (r) => (r.delai == null ? "—" : `${r.delai} j`) },
          { key: "statut", label: "Statut", render: (r) => <div><StkBadge tone={ST[r.statut][1]}>{ST[r.statut][0]}</StkBadge><div className="text-[11px] text-slate-500 mt-0.5">{r.origine === "confirme" ? "confirmé par un agent" : "automatique"}</div>
            {isAdmin && r.origine === "confirme" && <button className="text-[11px] text-rose-700 underline" onClick={(e) => { e.stopPropagation(); undo(r); }}>Annuler la confirmation</button>}</div> }
        ]} />}
      </>}
      {tab === "flux" && (!rows ? <StkLoading /> : !flux.length ? <div className="py-8 text-center text-sm text-slate-400">Aucun transfert sur la période.</div> : <div className="space-y-4" data-testid="transfers-flux">
        <div className="space-y-1.5">{flux.map((f) => <div key={f.depart + f.arrivee} className="flex items-center gap-3 text-sm">
          <div className="w-[38%] text-right font-semibold truncate">{f.depart}</div>
          <div className="flex-1 flex items-center gap-2"><div className="h-2.5 rounded-full bg-sky-400" style={{ width: `${Math.max(6, (f.n / flux[0].n) * 100)}%` }} /><span className="font-plex-mono font-bold text-sky-800 whitespace-nowrap">{f.n}{f.double ? <span className="text-amber-700 text-xs"> ({f.double} en double présence)</span> : ""}</span></div>
          <div className="w-[30%] font-semibold truncate">→ {f.arrivee}</div>
        </div>)}</div>
        {deps.length > 1 && arrs.length > 1 && <div className="overflow-x-auto"><table className="text-xs border-collapse">
          <thead><tr><th className="p-2 text-left text-slate-500">Départ ↓ / Arrivée →</th>{arrs.map((a) => <th key={a} className="p-2 font-bold text-[#123A66] whitespace-nowrap">{a}</th>)}</tr></thead>
          <tbody>{deps.map((d) => <tr key={d} className="border-t border-slate-100"><td className="p-2 font-bold whitespace-nowrap">{d}</td>{arrs.map((a) => <td key={a} className={`p-2 text-center font-plex-mono ${cell(d, a) ? "bg-sky-50 font-bold text-sky-800" : "text-slate-300"}`}>{cell(d, a) || "·"}</td>)}</tr>)}</tbody>
        </table></div>}
      </div>)}
      {tab === "confirmer" && (!cands ? <StkLoading /> : <div className="space-y-3">
        <div className="text-xs text-slate-600">Véhicules sortis d'un parc puis entrés dans un autre <b>plus de 14 jours</b> après (jusqu'à 6 mois) : l'outil ne peut pas savoir seul s'il s'agit d'un transfert. Confirmer un transfert justifie la sortie du premier parc.</div>
        <StkTable rows={cands} rowKey={(r) => r.vehicle_id + "|" + r.arrivee_id + "|" + r.date_arrivee} onRow={(r) => openVehicle({ id: r.vehicle_id })} empty="Rien à confirmer." columns={[
          { key: "chassis", label: "Châssis", render: (r) => <span className="font-plex-mono font-bold text-[#0B1F38] whitespace-nowrap">{r.chassis}</span> },
          { key: "veh", label: "Véhicule", sort: (r) => stkVeh(r), render: (r) => stkVeh(r) || "—" },
          { key: "depart", label: "Sorti de", render: (r) => <div><b>{r.depart}</b><div className="text-[11px] text-slate-500">le {stkFmt(r.date_sortie)}{r.justif_status && r.justif_status !== "non_justifiee" ? ` · ${r.justif_type || "justifiée"}` : ""}</div></div> },
          { key: "arrivee", label: "Entré à", render: (r) => <div><b>{r.arrivee}</b><div className="text-[11px] text-slate-500">le {stkFmt(r.date_arrivee)}</div></div> },
          { key: "ecart", label: "Écart", render: (r) => `${r.ecart} j` },
          { key: "act", label: "", sortable: false, render: (r) => canEdit ? <div className="flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
            <StkBtn small kind="primary" onClick={() => decide(r, "transfert")} data-testid="cand-transfert">C'est un transfert</StkBtn>
            <StkBtn small onClick={() => decide(r, "distinct")} data-testid="cand-distinct">Deux mouvements distincts</StkBtn></div> : null }
        ]} />
      </div>)}
    </StkCard>
  </div>;
}

// B — Entrées, sorties et transferts, par semaine ou par période
function StkMovementsWeek() {
  const C = React.useContext(StkCtx);
  const { dash, go } = C;
  const [kind, setKind] = useState("entrees");
  const [parc, setParc] = useState("");
  const [mode, setMode] = useState("semaine");
  const [mon, setMon] = useState(stkMonday(stkToday()));
  const [from, setFrom] = useState(stkAddDays(stkToday(), -30));
  const [to, setTo] = useState(stkToday());
  const [withTr, setWithTr] = useState(false);
  const types = kind === "entrees" ? (withTr ? ["entree", "transfert_recu"] : ["entree"]) : (withTr ? ["sortie", "transfert_envoye"] : ["sortie"]);
  const per = mode === "semaine" ? { weekFrom: mon, weekTo: mon } : { from, to };
  return <>
    <StkPageHead title="Entrées et sorties" sub="Par semaine (du lundi au dimanche) ou sur une période. Les transferts entre parcs sont comptés à part, dans la semaine de départ ; un fichier daté d'un lundi décrit la semaine précédente."
      right={stkCanEdit(C) ? <StkBtn small onClick={() => go("saisie")}><StkIc.Edit size={14} /> Saisir des entrées / sorties</StkBtn> : null} />
    <StkTabs tabs={[{ key: "entrees", label: "Entrées" }, { key: "sorties", label: "Sorties" }, { key: "transferts", label: "Transferts parc à parc" }]} value={kind} onChange={setKind} />
    <StkCard className="p-4 md:p-5 space-y-3 min-w-0">
      <div className="flex flex-wrap gap-3 items-end">
        <StkField label="Parc"><select value={parc} onChange={(e) => setParc(e.target.value)} className={stkInput} data-testid="mv-parc"><option value="">Tous les parcs</option>{dash.filter((d) => d.active !== false).map((d) => <option key={d.parc_id} value={d.parc_id}>{d.parc}</option>)}</select></StkField>
        <div className="flex rounded-lg border-2 border-slate-200 overflow-hidden text-sm font-bold">
          {[["semaine", "Par semaine"], ["periode", "Période libre"]].map(([k, l]) => <button key={k} onClick={() => setMode(k)} className={`px-3 py-2 ${mode === k ? "bg-[#123A66] text-white" : "bg-white text-slate-600"}`}>{l}</button>)}
        </div>
        {mode === "semaine" ? <StkWeekPicker mon={mon} setMon={setMon} /> : <>
          <StkField label="Du"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={stkInput} /></StkField>
          <StkField label="Au"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={stkInput} /></StkField>
        </>}
        {kind !== "transferts" && <label className="text-sm flex items-center gap-1.5 pb-2"><input type="checkbox" checked={withTr} onChange={(e) => setWithTr(e.target.checked)} /> Inclure les transferts {kind === "entrees" ? "reçus" : "envoyés"}</label>}
      </div>
      {kind === "transferts" ? <StkTransfers embedded parcId={parc || null} weekFrom={mode === "semaine" ? mon : stkMonday(from)} weekTo={mode === "semaine" ? mon : stkMonday(to)} />
        : <StkMvList parcId={parc || null} {...per} types={types} title={kind === "entrees" ? "Entrées" : "Sorties"} />}
    </StkCard>
  </>;
}

// ---------------- Bandeau photo du tableau de bord (6.10.2) ----------------
function StkHeroBanner({ tot }) {
  const C = React.useContext(StkCtx);
  const { dash, go } = C;
  const today = stkToday();
  const mon = stkMonday(today);
  const act = dash.filter((d) => d.active !== false && d.suivi_hebdo !== false);
  const ok = act.filter((d) => d.last_import && stkWeekCovers([d.last_import], mon)).length;
  const name = String(C.userName || (C.me && C.me.name) || "").trim();
  const now = new Date();
  const hello = typeof greetingWord === "function" ? greetingWord(now) : "Bonjour";
  const dateTxt = typeof formatDateFr === "function" ? formatDateFr(now) : stkFmt(today);
  const K = ({ v, l, on }) => <button onClick={on} className="text-left">
    <div className="text-[28px] md:text-[32px] font-bold leading-none text-[#E8D3A2]" style={{ fontFamily: "Lora,Georgia,serif" }}>{v}</div>
    <div className="text-xs text-white/80 mt-1">{l}</div>
  </button>;
  return <div className="relative rounded-3xl overflow-hidden min-h-[220px] bg-[#0B1F38] shadow-[0_30px_60px_-40px_rgba(11,31,56,.8)]" data-testid="hero-banner"
    style={{ backgroundImage: "url(./lib/img/mad-roulants-nuit.jpg)", backgroundSize: "cover", backgroundPosition: "center 60%" }}>
    <div className="absolute inset-0" style={{ background: "linear-gradient(90deg,rgba(11,31,56,.94) 0%,rgba(11,31,56,.6) 55%,rgba(11,31,56,.12))" }} />
    <div className="relative px-6 py-6 md:px-8 md:py-7 text-white">
      <span className="inline-block bg-[#0B1F38]/80 text-[#E8D3A2] font-extrabold text-[11px] tracking-[.14em] px-3 py-1 rounded-full">MAD ROULANTS</span>
      <div className="mt-2 text-2xl md:text-[28px] font-semibold" style={{ fontFamily: "'Sora',system-ui,sans-serif" }}>{hello}{name ? `, ${name}` : ""}</div>
      <div className="text-sm text-white/80">{dateTxt} · semaine {stkIsoWeek(mon)}</div>
      <div className="flex flex-wrap gap-x-8 gap-y-4 mt-5">
        <K v={(+tot.presents || 0).toLocaleString("fr-FR")} l="stock total" />
        <K v={`${ok} / ${act.length}`} l="parcs à jour" on={() => go("couverture")} />
        <K v={(+tot.nj || 0).toLocaleString("fr-FR")} l="sorties à justifier" on={() => go("justif")} />
      </div>
    </div>
  </div>;
}
