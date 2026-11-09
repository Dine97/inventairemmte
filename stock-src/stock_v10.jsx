// ---------------- À régulariser (6.11) ----------------
// Onglet de chaque parc qui regroupe toutes les situations à traiter. Lecture seule : rien n'est modifié,
// sauf la confirmation d'un transfert (même action que dans « Transferts parc à parc »).
const STK_REG = {
  depot_depasse: { t: "Dépôt dépassé", d: "Délai de séjour expiré : le véhicule est toujours dans le parc.", tone: "bg-rose-50 text-rose-800 border-rose-200" },
  double_presence: { t: "Double présence", d: "Le véhicule figure aussi dans le stock d'un autre parc.", tone: "bg-amber-50 text-amber-900 border-amber-300" },
  transfert_a_confirmer: { t: "Transfert à confirmer", d: "Sorti d'un parc puis entré dans un autre plus de 14 jours après : transfert ou deux mouvements distincts ?", tone: "bg-sky-50 text-sky-800 border-sky-200" },
  reapparu: { t: "Revenu après sortie", d: "Sorti du parc puis réapparu dans un fichier suivant : la sortie était-elle réelle ?", tone: "bg-amber-50 text-amber-900 border-amber-300" },
  chassis_proche: { t: "Faute de frappe probable", d: "Entrée et sortie le même jour de deux châssis presque identiques : sans doute le même véhicule mal saisi.", tone: "bg-violet-50 text-violet-800 border-violet-200" },
  sans_date: { t: "Date d'arrivée manquante", d: "Sans date d'arrivée du navire, la date de dépôt ne peut pas être calculée.", tone: "bg-slate-50 text-slate-700 border-slate-300" },
  chassis_atypique: { t: "Châssis atypique", d: "Pas 17 caractères, ou lettres I, O, Q : vérifier la saisie (les engins anciens peuvent être plus courts).", tone: "bg-slate-50 text-slate-700 border-slate-300" }
};
const STK_REG_ORDER = Object.keys(STK_REG);
function stkRegDetail(r) {
  const d = r.detail || {};
  if (r.motif === "depot_depasse") return `date de dépôt ${stkFmt(r.date_ref)} · dépassée de ${r.jours} j`;
  if (r.motif === "double_presence") return `aussi chez ${r.autre_parc} depuis le ${stkFmt(d.entree_autre)}`;
  if (r.motif === "transfert_a_confirmer") return d.sens === "sortie" ? `sorti le ${stkFmt(d.date_sortie)}, entré chez ${d.arrivee} le ${stkFmt(d.date_arrivee)} (${r.jours} j)` : `sorti de ${d.depart} le ${stkFmt(d.date_sortie)}, entré ici le ${stkFmt(d.date_arrivee)} (${r.jours} j)`;
  if (r.motif === "reapparu") return `sorti le ${stkFmt(d.date_sortie)}, revenu le ${stkFmt(d.date_retour)}`;
  if (r.motif === "chassis_proche") return `sorti le même jour : ${d.autre_chassis}`;
  if (r.motif === "sans_date") return `dans le parc depuis le ${stkFmt(r.date_ref)}`;
  if (r.motif === "chassis_atypique") return `${r.jours} caractères`;
  return "";
}
function StkRegulariser({ parcId, parcName, onChanged }) {
  const C = React.useContext(StkCtx);
  const { openVehicle, toast } = C;
  const canEdit = stkCanEdit(C);
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [motif, setMotif] = useState("");
  const [q, setQ] = useState("");
  const load = () => { setErr(""); stkCall("regulariser", { parc_id: parcId }).then(setRows).catch((e) => { setErr(stkErrText(e)); setRows([]); }); };
  useEffect(load, [parcId]);
  const counts = {}; (rows || []).forEach((r) => (counts[r.motif] = (counts[r.motif] || 0) + 1));
  const present = STK_REG_ORDER.filter((k) => counts[k]);
  const list = stkFilterRows((rows || []).filter((r) => !motif || r.motif === motif), q)
    .sort((a, b) => STK_REG_ORDER.indexOf(a.motif) - STK_REG_ORDER.indexOf(b.motif) || (b.jours || 0) - (a.jours || 0) || String(a.chassis).localeCompare(b.chassis));
  const nVeh = new Set((rows || []).map((r) => r.vehicle_id)).size;
  const decide = async (r, decision) => {
    const d = r.detail || {};
    try {
      await stkCall("transfer_decide", { vehicle_id: r.vehicle_id, depart_id: d.depart_id, arrivee_id: d.arrivee_id, date_sortie: d.date_sortie, date_arrivee: d.date_arrivee, decision });
      toast && toast(decision === "transfert" ? `Transfert confirmé : ${r.chassis}` : `Noté : deux mouvements distincts (${r.chassis})`);
      load(); onChanged && onChanged();
    } catch (e) { setErr(stkErrText(e)); }
  };
  const cols = [{ h: "Situation", x: (r) => STK_REG[r.motif].t, w: 24 }, { h: "Châssis", k: "chassis", w: 22 }, { h: "Marque", k: "marque" }, { h: "Modèle", k: "modele" },
    { h: "Navire", k: "navire", w: 20 }, { h: "Manifeste", k: "manifeste", w: 14 }, { h: "Détail", x: stkRegDetail, w: 50 }];
  const exp = (k) => {
    const meta = [`Parc : ${parcName}`, `Situation au ${stkFmt(stkToday())} — ${nVeh} véhicule(s) concerné(s)`];
    if (k === "x") stkExportXlsx(`A_regulariser_${parcName}_${stkToday()}`, `À régulariser — ${parcName}`, meta, cols, list);
    else stkPrintPdf(`À régulariser — ${parcName}`, meta, cols.filter((c) => !["Marque", "Modèle", "Manifeste"].includes(c.h)), list, true);
  };
  if (!rows) return <StkCard className="p-6"><StkLoading /></StkCard>;
  return <StkCard className="p-4 md:p-5 space-y-4 min-w-0" data-testid="regulariser">
    {err && <StkMsg tone="err">{err}</StkMsg>}
    {!rows.length ? <div className="py-10 text-center"><div className="text-3xl">✓</div><div className="font-bold text-emerald-700 mt-1">Rien à régulariser dans ce parc.</div></div> : <>
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2">
        {present.map((k) => <button key={k} onClick={() => setMotif(motif === k ? "" : k)} data-testid={`reg-${k}`}
          className={`text-left rounded-xl border-2 px-3 py-2 transition ${motif === k ? "border-[#123A66] bg-[#EAF1FA]" : "border-slate-200 bg-white hover:border-[#1B4F8C]/40"}`}>
          <div className="font-plex-mono text-xl font-bold text-[#0B1F38]">{counts[k].toLocaleString("fr-FR")}</div>
          <div className="text-xs font-bold text-slate-600 leading-tight">{STK_REG[k].t}</div>
        </button>)}
      </div>
      {motif && <StkMsg tone="info">{STK_REG[motif].d}</StkMsg>}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="text-sm text-slate-600"><b>{nVeh.toLocaleString("fr-FR")}</b> véhicule(s) concerné(s){motif ? <> · <button className="underline text-[#1B4F8C]" onClick={() => setMotif("")}>tout afficher</button></> : ""}</div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer : châssis, marque, navire..." className={`${stkInput} flex-1 min-w-[180px]`} />
        <StkExportBar disabled={!list.length} onXlsx={() => exp("x")} onPdf={() => exp("p")} />
      </div>
      <StkTable rows={list} rowKey={(r) => [r.motif, r.vehicle_id, r.autre_parc, r.date_ref, r.jours, (r.detail || {}).autre_chassis].join("|")} onRow={(r) => openVehicle({ id: r.vehicle_id })} initial={200} empty="Aucun véhicule." columns={[
        { key: "motif", label: "Situation", sort: (r) => STK_REG_ORDER.indexOf(r.motif), render: (r) => <StkBadge tone={STK_REG[r.motif].tone}>{STK_REG[r.motif].t}</StkBadge> },
        { key: "chassis", label: "Châssis", render: (r) => <span className="font-plex-mono font-bold text-[#0B1F38] whitespace-nowrap">{r.chassis}</span> },
        { key: "veh", label: "Véhicule", sort: (r) => stkVeh(r), render: (r) => <span className="text-slate-700">{stkVeh(r) || "—"}</span> },
        { key: "navire", label: "Navire", render: (r) => <span className="text-slate-600">{r.navire || "—"}</span> },
        { key: "detail", label: "Détail", sort: (r) => r.jours || 0, render: (r) => <span className="text-sm text-slate-700">{stkRegDetail(r)}</span> },
        { key: "act", label: "", sortable: false, render: (r) => r.motif === "transfert_a_confirmer" && canEdit ? <div className="flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
          <StkBtn small kind="primary" onClick={() => decide(r, "transfert")}>C'est un transfert</StkBtn>
          <StkBtn small onClick={() => decide(r, "distinct")}>Deux mouvements distincts</StkBtn></div> : null }
      ]} />
    </>}
  </StkCard>;
}
