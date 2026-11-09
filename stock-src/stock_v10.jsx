// ---------------- À régulariser (6.11) ----------------
// Onglet de chaque parc qui regroupe toutes les situations à traiter. Lecture seule : rien n'est modifié,
// sauf la confirmation d'un transfert (même action que dans « Transferts parc à parc »).
const STK_REG = {
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
  const load = () => { setErr(""); stkCall("regulariser", { parc_id: parcId }).then((r) => setRows(r.filter((x) => STK_REG[x.motif]))).catch((e) => { setErr(stkErrText(e)); setRows([]); }); };
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

// ---------------- Extraction des données (6.12) ----------------
// Un seul bouton pour extraire le stock voulu (stock total, en délai légal, bientôt en dépôt, en dépôt) à une date,
// ou sur une période (stock au début et à la fin, entrées, sorties, transferts, véhicules passés en dépôt).
const STK_EXT_STOCK = [["tous", "Stock total"], ["disponible", "En délai légal"], ["bientot", "Bientôt en dépôt"], ["depot", "En dépôt"]];
const STK_EXT_MVT = [["entrees", "Entrées"], ["sorties", "Sorties"], ["transferts", "Transferts"], ["passes_depot", "Passés en dépôt"]];
function StkExtractionModal({ parcId, onClose, onShowAtDate }) {
  const C = React.useContext(StkCtx);
  const { dash, cfg } = C;
  const parcs = dash.filter((d) => d.active !== false);
  const [scope, setScope] = useState(parcId ? "parc" : "tous");
  const [sel, setSel] = useState(new Set(parcId ? [parcId] : []));
  const [mode, setMode] = useState("date");
  const [date, setDate] = useState(stkToday());
  const [from, setFrom] = useState(stkMonday(stkToday()));
  const [to, setTo] = useState(stkToday());
  const [cats, setCats] = useState(new Set(["tous"]));
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);
  const toggle = (set, setter, k) => { const n = new Set(set); n.has(k) ? n.delete(k) : n.add(k); setter(n); setDone(null); };
  useEffect(() => setDone(null), [scope, mode, date, from, to]);
  const ids = scope === "parc" ? [parcId] : scope === "selection" ? [...sel] : null;
  const pname = scope === "parc" ? (dash.find((d) => d.parc_id === parcId) || {}).parc : scope === "selection" ? `${sel.size} parc(s)` : "Tous les parcs";
  const keepParc = (r) => !ids || ids.includes(r.parc_id);
  const avail = mode === "date" ? STK_EXT_STOCK : STK_EXT_STOCK.concat(STK_EXT_MVT);
  const chosen = avail.filter(([k]) => cats.has(k));
  const nSheets = chosen.reduce((a, [k]) => a + (mode === "periode" && STK_EXT_STOCK.some(([s]) => s === k) ? 2 : 1), 0);
  const okDates = mode === "date" ? !!date : from && to && from <= to;
  const can = chosen.length && okDates && (scope !== "selection" || sel.size);
  const parcCol = !ids || ids.length > 1 ? [{ h: "Parc", k: "parc", w: 18 }] : [];
  const stockCols = (ref) => parcCol.concat(stkExportCols(cfg, ref)).concat([{ h: "Entrée au parc", x: (x) => stkFmt(x.entry_date), w: 12 }]);
  const build = async () => {
    const sheets = [];
    const stockAt = async (d) => (await stkCall("stock_at", { date: d, parc_id: ids && ids.length === 1 ? ids[0] : null })).rows.filter(keepParc);
    const filt = (rows, k, ref) => rows.filter((x) => k === "tous" || stkSit(x, ref, cfg).code === k);
    const lbl = (k) => (avail.find((a) => a[0] === k) || [k, k])[1];
    if (mode === "date") {
      setBusy("Calcul du stock au " + stkFmt(date) + "...");
      const rows = await stockAt(date);
      chosen.forEach(([k]) => sheets.push({ name: lbl(k), title: `${lbl(k)} au ${stkFmt(date)} — ${pname}`, meta: [`Situation calculée au ${stkFmt(date)} (séjour de ${cfg.duree} jours)`], columns: stockCols(date), rows: filt(rows, k, date) }));
    } else {
      const stockKeys = chosen.filter(([k]) => STK_EXT_STOCK.some(([s]) => s === k));
      const needStock = stockKeys.length || cats.has("passes_depot");
      setBusy("Calcul du stock au début et à la fin de la période...");
      const [r0, r1] = needStock ? await Promise.all([stockAt(from), stockAt(to)]) : [[], []];
      stockKeys.forEach(([k]) => {
        sheets.push({ name: `${lbl(k)} - début`, title: `${lbl(k)} au ${stkFmt(from)} (début de période) — ${pname}`, meta: [], columns: stockCols(from), rows: filt(r0, k, from) });
        sheets.push({ name: `${lbl(k)} - fin`, title: `${lbl(k)} au ${stkFmt(to)} (fin de période) — ${pname}`, meta: [], columns: stockCols(to), rows: filt(r1, k, to) });
      });
      const types = [];
      if (cats.has("entrees")) types.push("entree");
      if (cats.has("sorties")) types.push("sortie");
      if (cats.has("transferts")) types.push("transfert_recu", "transfert_envoye");
      if (cats.has("passes_depot")) types.push("entree", "transfert_recu");
      let mv = [];
      if (types.length) {
        setBusy("Lecture des mouvements de la période...");
        mv = (await stkCall("mouvements", { parc_id: ids && ids.length === 1 ? ids[0] : null, from, to, types: [...new Set(types)] })).filter(keepParc);
      }
      const mvCols = STK_MV_EXPORT.filter((c) => parcCol.length || c.h !== "Parc");
      if (cats.has("entrees")) sheets.push({ name: "Entrées", title: `Entrées du ${stkFmt(from)} au ${stkFmt(to)} — ${pname}`, meta: [], columns: mvCols, rows: mv.filter((r) => r.type === "entree") });
      if (cats.has("sorties")) sheets.push({ name: "Sorties", title: `Sorties du ${stkFmt(from)} au ${stkFmt(to)} — ${pname}`, meta: [], columns: mvCols, rows: mv.filter((r) => r.type === "sortie") });
      if (cats.has("transferts")) sheets.push({ name: "Transferts", title: `Transferts du ${stkFmt(from)} au ${stkFmt(to)} — ${pname}`, meta: [], columns: mvCols, rows: mv.filter((r) => r.type === "transfert_recu" || r.type === "transfert_envoye") });
      if (cats.has("passes_depot")) {
        // véhicules dont la date de dépôt tombe dans la période et qui étaient dans le parc ce jour-là
        const seen = new Set(), list = [];
        r0.concat(r1, mv.filter((r) => r.type === "entree" || r.type === "transfert_recu")).forEach((r) => {
          const d = stkSit(r, to, cfg).depot;
          const k = r.vehicle_id + "|" + r.parc_id + "|" + r.entry_date;
          if (!d || d < from || d > to || seen.has(k)) return;
          if (r.entry_date && r.entry_date > d) return;
          if (r.exit_date && r.exit_date <= d) return;
          seen.add(k); list.push(r);
        });
        sheets.push({ name: "Passés en dépôt", title: `Véhicules passés en dépôt du ${stkFmt(from)} au ${stkFmt(to)} — ${pname}`, meta: [],
          columns: parcCol.concat(stkExportCols(cfg, to).filter((c) => !["Situation", "Jours restants", "Jours en dépôt"].includes(c.h))).concat([{ h: "Passé en dépôt le", x: (x) => stkFmt(stkSit(x, to, cfg).depot), w: 14 }]), rows: list.sort((a, b) => String(stkSit(a, to, cfg).depot).localeCompare(String(stkSit(b, to, cfg).depot))) });
      }
    }
    return sheets;
  };
  const run = async (kind) => {
    setErr(""); setDone(null);
    try {
      const sheets = await build();
      const per = mode === "date" ? `au ${stkFmt(date)}` : `du ${stkFmt(from)} au ${stkFmt(to)}`;
      const fname = `Extraction_${String(pname).replace(/\s+/g, "_")}_${mode === "date" ? date : from + "_" + to}`;
      if (kind === "x") {
        const recap = { name: "Récapitulatif", title: `Extraction des données — ${pname} — ${per}`, meta: [`Édité le ${stkFmt(stkToday())} · Suivi des stocks MAD ROULANTS`],
          columns: [{ h: "Extraction", k: "t", w: 60 }, { h: "Véhicules", k: "n", w: 12 }], rows: sheets.map((s) => ({ t: s.title, n: s.rows.length })) };
        stkExportBook(fname, [recap].concat(sheets));
      } else {
        const s = sheets[0];
        stkPrintPdf(s.title, s.meta, s.columns.filter((c) => !["Manifeste / ATP", "N° BL", "Manifeste", "Importateur", "Semaine", "Date de transfert", "Dépôt MMTE"].includes(c.h)), s.rows, true);
      }
      setDone(sheets.map((s) => `${s.name} : ${s.rows.length.toLocaleString("fr-FR")}`).join(" · "));
    } catch (e) { setErr(stkErrText(e)); }
    setBusy("");
  };
  const Chip = ({ on, onClick, children, testid }) => <button type="button" onClick={onClick} data-testid={testid} className={`px-3 py-1.5 rounded-full text-xs font-bold border-2 ${on ? "bg-[#1B4F8C] text-white border-[#1B4F8C]" : "bg-white text-[#1B4F8C] border-[#1B4F8C]/20"}`}>{children}</button>;
  return <StkModal wide title="Extraction des données" onClose={onClose}>
    <div className="space-y-5" data-testid="extraction">
      <div><div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">1. Parc</div>
        <div className="flex flex-wrap gap-2">
          {parcId && <Chip on={scope === "parc"} onClick={() => setScope("parc")}>{(dash.find((d) => d.parc_id === parcId) || {}).parc}</Chip>}
          <Chip on={scope === "tous"} onClick={() => setScope("tous")}>Tous les parcs</Chip>
          <Chip on={scope === "selection"} onClick={() => setScope("selection")}>Choisir des parcs</Chip>
        </div>
        {scope === "selection" && <div className="mt-2 max-h-40 overflow-y-auto grid grid-cols-2 md:grid-cols-3 gap-1 border-2 border-slate-200 rounded-xl p-2">
          {parcs.map((d) => <label key={d.parc_id} className="text-sm flex items-center gap-1.5"><input type="checkbox" checked={sel.has(d.parc_id)} onChange={() => toggle(sel, setSel, d.parc_id)} />{d.parc}</label>)}
        </div>}
      </div>
      <div><div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">2. Date</div>
        <div className="flex flex-wrap gap-2 items-end">
          <Chip on={mode === "date"} onClick={() => { setMode("date"); setCats(new Set([...cats].filter((k) => STK_EXT_STOCK.some(([s]) => s === k)))); }} testid="ext-date">À une date</Chip>
          <Chip on={mode === "periode"} onClick={() => setMode("periode")} testid="ext-periode">Sur une période</Chip>
          {mode === "date" ? <div className="w-[170px]"><input type="date" value={date} max={stkToday()} onChange={(e) => setDate(e.target.value)} className={stkInput} /></div>
            : <><span className="text-sm">du</span><div className="w-[170px]"><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={stkInput} /></div><span className="text-sm">au</span><div className="w-[170px]"><input type="date" value={to} max={stkToday()} onChange={(e) => setTo(e.target.value)} className={stkInput} /></div></>}
        </div>
      </div>
      <div><div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">3. Données à extraire <span className="normal-case font-normal">(plusieurs choix possibles : un onglet Excel par choix)</span></div>
        <div className="flex flex-wrap gap-2">{STK_EXT_STOCK.map(([k, l]) => <Chip key={k} on={cats.has(k)} onClick={() => toggle(cats, setCats, k)} testid={`ext-${k}`}>{l}</Chip>)}</div>
        {mode === "periode" && <>
          <div className="text-[11px] text-slate-500 mt-1">Sur une période, chaque choix de stock donne le stock au début et le stock à la fin.</div>
          <div className="flex flex-wrap gap-2 mt-2">{STK_EXT_MVT.map(([k, l]) => <Chip key={k} on={cats.has(k)} onClick={() => toggle(cats, setCats, k)} testid={`ext-${k}`}>{l}</Chip>)}</div>
          {cats.has("passes_depot") && <div className="text-[11px] text-slate-500 mt-1">« Passés en dépôt » : véhicules dont la date de dépôt tombe dans la période, présents dans le parc ce jour-là.</div>}
        </>}
      </div>
      {err && <StkMsg tone="err">{err}</StkMsg>}
      {done && !busy && <StkMsg tone="ok">Extraction faite — {done}</StkMsg>}
      <div className="flex flex-wrap gap-2 items-center border-t-2 border-slate-100 pt-4">
        <StkBtn kind="primary" disabled={!can || !!busy} onClick={() => run("x")} data-testid="ext-excel"><Download size={16} /> {busy || `Excel${nSheets > 1 ? ` (${nSheets} onglets)` : ""}`}</StkBtn>
        <StkBtn disabled={!can || !!busy || nSheets > 1} onClick={() => run("p")}><Printer size={16} /> PDF</StkBtn>
        {nSheets > 1 && <span className="text-xs text-slate-500">PDF : une seule extraction à la fois.</span>}
        {onShowAtDate && mode === "date" && scope === "parc" && <StkBtn onClick={() => onShowAtDate(date)} className="ml-auto"><StkIc.Cal size={16} /> Voir ce stock à l'écran</StkBtn>}
      </div>
    </div>
  </StkModal>;
}
