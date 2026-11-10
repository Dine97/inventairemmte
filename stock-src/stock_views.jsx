// ============================================================
// STOCK MMTE — Écrans
// ============================================================

// Dernier tableau de bord gardé sur l'appareil : affiché tout de suite, puis actualisé
function stkBootKey() { try { return "stk-boot-" + ((auth.currentUser && auth.currentUser.uid) || ""); } catch (e) { return "stk-boot-"; } }
function stkBootCacheRead() { try { const j = JSON.parse(localStorage.getItem(stkBootKey()) || "null"); return j && j.v === 1 ? j.b : null; } catch (e) { return null; } }
function stkBootCacheWrite(b) { try { localStorage.setItem(stkBootKey(), JSON.stringify({ v: 1, at: Date.now(), b })); } catch (e) {} }
function StkApp({ parcsList, isAdmin, section, setSection, userName }) {
  const [boot, setBootRaw] = useState(() => { const c = stkBootCacheRead(); return c ? { ...c, fromCache: true } : null; });
  const setBoot = (fn) => setBootRaw((prev) => { const next = typeof fn === "function" ? fn(prev) : fn; if (next && !next.fromCache) stkBootCacheWrite(next); return next; });
  const [err, setErr] = useState("");
  const [parcId, setParcId] = useState(null);
  const [vehicle, setVehicle] = useState(null);
  const [toast, setToast] = useState("");
  const [searchPreset, setSearchPreset] = useState(null);
  const [importPreset, setImportPreset] = useState(null);
  const [movePreset, setMovePreset] = useState(null);
  const [parcTab, setParcTab] = useState(null);
  const [suivisData, setSuivisData] = useState(null);
  const loadSuivis = () => stkCall("suivis_list", {}, false, 45e3).then(setSuivisData).catch(() => {});
  useEffect(() => { loadSuivis(); const t = setInterval(() => { if (document.visibilityState === "visible") loadSuivis(); }, 300e3); return () => clearInterval(t); }, []);
  const reloadMeta = async () => { try { const b = await stkCall("bootstrap", { names: parcsList }); setBoot(b); } catch (e) {} };
  const load = async () => {
    try {
      setErr("");
      const b = await stkCall("bootstrap", { names: parcsList });
      setBoot(b);
    } catch (e) { setErr(stkErrText(e)); setBootRaw((b) => (b && b.fromCache ? { ...b, stale: true } : b)); }
  };
  const reloadDash = async () => {
    try { const d = await stkCall("dashboard", {}); setBoot((b) => b ? { ...b, dashboard: d, fromCache: false, stale: false } : b); } catch (e) {}
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") reloadDash(); }, 120e3);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { if (section !== "parc") setParcId((p) => p); window.scrollTo(0, 0); }, [section, parcId]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 4500); return () => clearTimeout(t); }, [toast]);
  if (err && !boot) return <div className="max-w-2xl mx-auto px-5 py-10 space-y-3"><StkMsg tone="err">{err}</StkMsg><StkBtn onClick={load}><RefreshCw size={16} /> Réessayer</StkBtn></div>;
  if (!boot) return <StkLoading text="Chargement du Suivi des stocks MAD ROULANTS..." />;
  const cfg = stkSettings(boot.settings);
  const dash = boot.dashboard || [];
  STK_SETTINGS_NOW = boot.settings || {};
  stkPublishHidden(stkCfgExtra(boot.settings).hidden);
  const ctx = {
    cfg, settings: boot.settings, dash, dashAll: dash, parcsMeta: boot.parcsMeta || [], reloadMeta, isAdmin, me: boot.me, userName,
    suivis: { data: suivisData, reload: loadSuivis, followed: new Set(((suivisData && suivisData.suivis) || []).map((s) => s.vehicle_id)), unread: stkSuiviUnread(suivisData, cfg) },
    parcName: (id) => (dash.find((d) => d.parc_id === Number(id)) || {}).parc || "",
    openParc: (id, tab) => { setParcTab(tab || null); setParcId(Number(id)); setSection("parc"); },
    openVehicle: (v) => setVehicle(v),
    go: (s, preset) => { if (s === "search") setSearchPreset(preset || null); if (s === "import") setImportPreset(preset || null); if (s === "saisie") setMovePreset(preset || null); setSection(s); },
    reloadDash, reloadAll: load, toast: setToast
  };
  let body = null;
  if (section === "parc" && parcId) body = <StkParc key={parcId + ":" + (parcTab || "")} parcId={parcId} initialTab={parcTab} />;
  else if (section === "agrements") body = <StkAgrements />;
  else if (section === "ptu") body = <StkPtu />;
  else if (section === "suivis") body = <StkSuivis />;
  else if (section === "search") body = <StkSearch key={JSON.stringify(searchPreset)} preset={searchPreset} />;
  else if (section === "rapport") body = <StkReport />;
  else if (section === "anomalies") body = <StkAnomalies />;
  else if (section === "mmte") body = <StkMmteCheck />;
  else if (section === "import") body = <StkImport preset={importPreset} />;
  else if (section === "bulk") body = <StkBulkImport />;
  else if (section === "couverture") body = <StkCoverage />;
  else if (section === "liste") body = <StkListLookup />;
  else if (section === "manifestes" || section === "navires") body = <StkManifests />;
  else if (section === "miseenservice" && isAdmin) body = <StkRollout />;
  else if (section === "saisie") body = <StkManualMoves key={JSON.stringify(movePreset)} preset={movePreset} />;
  else if (section === "moves") body = <StkMovementsWeek />;
  else if (section === "semaines") body = <StkWeeks />;
  else if (section === "transferts") body = <StkTransfers />;
  else if (section === "justif") body = <StkJustifScreen />;
  else if (section === "imports") body = <StkImportsScreen />;
  else if (section === "admin" && isAdmin) body = <StkAdmin />;
  else body = <StkDashboard lastImports={boot.lastImports} />;
  return <StkCtx.Provider value={ctx}>
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-5 md:py-7 space-y-5" data-i18n-skip="1">
      {boot.fromCache && <div className="no-print flex flex-wrap items-center gap-2 text-xs rounded-xl border border-slate-200 bg-slate-50 text-slate-600 px-3 py-2" data-testid="stk-cache-note">
        {boot.stale ? <>Serveur injoignable : chiffres de votre dernière visite. {err} <button onClick={load} className="font-bold text-[#1B4F8C] underline">Réessayer</button></> : <><span className="w-3 h-3 rounded-full border-2 border-slate-300 border-t-[#1B4F8C] animate-spin" /> Mise à jour des chiffres...</>}
      </div>}
      <StkBellBar />
      {body}
    </div>
    {vehicle && <StkVehicleModal target={vehicle} onClose={() => setVehicle(null)} />}
    {toast && <div className="mmte-toast no-print" role="status">{toast}</div>}
  </StkCtx.Provider>;
}

function StkPageHead({ title, sub, right, back }) {
  return <div className="flex flex-wrap items-end gap-3">
    <div className="flex-1 min-w-[220px]">
      {back && <button onClick={back} className="text-sm font-bold text-[#1B4F8C] inline-flex items-center gap-1 mb-1"><ArrowLeft size={15} /> Retour</button>}
      <h2 className="text-2xl md:text-[28px] font-semibold text-[#0B1F38]">{title}</h2>
      {sub && <div className="text-sm text-slate-500 mt-1">{sub}</div>}
    </div>
    {right && <div className="flex flex-wrap gap-2">{right}</div>}
  </div>;
}

// Recherche rapide par châssis (saisie ou scan)
function StkQuickSearch({ big }) {
  const { go, openVehicle } = React.useContext(StkCtx);
  const [q, setQ] = useState("");
  const [scan, setScan] = useState(false);
  const submit = (v) => { const t = String(v || q).trim(); if (!t) return; go("search", { q: t }); };
  return <div>
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex gap-2">
      <div className="relative flex-1">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Châssis (complet ou 6 derniers caractères), marque, navire, BL..." className={`${stkInput} pl-10 ${big ? "py-3 text-base" : ""}`} />
      </div>
      <StkBtn kind="primary" type="submit">Rechercher</StkBtn>
      <StkBtn type="button" onClick={() => setScan(true)} title="Scanner un code-barres ou un QR code"><ScanLine size={18} /><span className="hidden sm:inline">Scanner</span></StkBtn>
    </form>
    {scan && <CameraScanner knownMap={new Map()} onClose={() => setScan(false)} onDetect={(c) => { setScan(false); setQ(c); openVehicle({ chassis: c, fallbackSearch: true }); }} />}
  </div>;
}

// ---------------- Tableau de bord ----------------
function StkDashboard({ lastImports }) {
  const DC = React.useContext(StkCtx);
  const { openParc, cfg, go, reloadDash } = DC;
  const XA = stkCfgExtra(DC.settings);
  const dash = DC.dash.filter((d) => !stkIsPtu(DC, d.parc_id));
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("stock");
  const [onlyStock, setOnlyStock] = useState(false);
  const [expAt, setExpAt] = useState(false);
  const tot = dash.reduce((a, d) => ({ presents: a.presents + +d.presents, disponibles: a.disponibles + +d.disponibles, bientot: a.bientot + +d.bientot, depot: a.depot + +d.depot, nj: a.nj + +d.non_justifiees, sans: a.sans + +d.sans_date }), { presents: 0, disponibles: 0, bientot: 0, depot: 0, nj: 0, sans: 0 });
  const today = stkToday();
  const withImport = dash.filter((d) => d.last_import);
  const late = withImport.filter((d) => stkDiff(d.last_import, today) > 7);
  let list = dash.filter((d) => d.active !== false && (!q || d.parc.includes(q.trim().toUpperCase())) && (!onlyStock || +d.presents > 0));
  list = [...list].sort((a, b) => sort === "name" ? a.parc.localeCompare(b.parc) : sort === "depot" ? b.depot - a.depot : sort === "import" ? String(b.last_import || "").localeCompare(String(a.last_import || "")) : (b.presents - a.presents) || a.parc.localeCompare(b.parc));
  return <>
    <StkHeroBanner tot={tot} />
    <StkPageHead title="Tableau de bord des stocks" sub={`Situation au ${stkFmt(today)} · séjour de ${cfg.duree} jours à compter de la date d'arrivée du navire`} right={<><StkBtn small onClick={() => setExpAt(true)} data-testid="btn-extraction"><Download size={15} /> Extraction des données</StkBtn><StkBtn small onClick={reloadDash}><RefreshCw size={15} /> Actualiser</StkBtn></>} />
    {expAt && <StkExtractionModal onClose={() => setExpAt(false)} />}
    <StkCard className="p-4"><StkQuickSearch big /></StkCard>
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      <StkKpi label="Stock total" value={tot.presents} sub={`${withImport.length} parc(s) importé(s)`} />
      <StkKpi label="En délai légal" value={tot.disponibles} tone="green" />
      <StkKpi label="Bientôt en dépôt" value={tot.bientot} tone="amber" sub={`moins de ${cfg.seuil} j`} />
      <StkKpi label="En dépôt" value={tot.depot} tone="rose" sub={tot.sans ? `${tot.sans} sans date` : ""} />
      <StkKpi label="Sorties non justifiées" value={tot.nj} tone="slate" onClick={() => go("justif")} />
      <StkKpi label="Imports en retard" value={late.length} tone={late.length ? "amber" : "green"} sub="Dernier import > 7 jours" />
    </div>
    <StkAgrAlert />
    <StkTodo />
    <StkMondayReminder />
    <StkCard className="p-4 md:p-5">
      <div className="flex flex-wrap gap-2 items-center mb-4">
        <div className="font-bold text-[#0B1F38] text-lg flex-1 min-w-[160px]">Parcs</div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer un parc" className={`${stkInput} max-w-[200px]`} />
        <select value={sort} onChange={(e) => setSort(e.target.value)} className={`${stkInput} max-w-[190px]`}>
          <option value="stock">Tri : stock</option><option value="name">Tri : nom</option><option value="depot">Tri : véhicules en dépôt</option><option value="import">Tri : dernier import</option>
        </select>
        <label className="text-sm font-semibold text-slate-600 flex items-center gap-2"><input type="checkbox" checked={onlyStock} onChange={(e) => setOnlyStock(e.target.checked)} /> Avec stock</label>
      </div>
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {list.map((d) => {
          const lateD = d.last_import ? stkDiff(d.last_import, today) : null;
          const n = +d.presents || 0;
          const pc = (x) => n ? Math.max(0, Math.round(x / n * 100)) : 0;
          return <button key={d.parc_id} onClick={() => openParc(d.parc_id)} className="text-left rounded-xl border-2 border-slate-100 hover:border-[#1B4F8C]/40 bg-[#FAFCFF] p-4 transition">
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0"><div className="font-bold text-[#0B1F38] truncate">{d.parc}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{d.last_import ? `Dernier import : ${stkFmt(d.last_import)}` : "Aucun import"}</div></div>
              <div className="font-plex-mono text-2xl font-bold text-[#123A66]">{n.toLocaleString("fr-FR")}</div>
            </div>
            {n > 0 && <div className="flex h-2 rounded-full overflow-hidden mt-3 bg-slate-100">
              <div style={{ width: pc(d.disponibles) + "%" }} className="bg-emerald-500" /><div style={{ width: pc(d.bientot) + "%" }} className="bg-amber-400" /><div style={{ width: pc(d.depot) + "%" }} className="bg-rose-500" />
            </div>}
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[11.5px] font-semibold">
              <span className="text-emerald-700">{d.disponibles} en délai</span><span className="text-amber-700">{d.bientot} bientôt</span><span className="text-rose-700">{d.depot} en dépôt</span>
              {d.last_import_id && <span className="text-slate-500">+{d.last_entrees || 0} / −{(d.last_sorties || 0) + (d.last_transferts || 0)}</span>}
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {lateD != null && lateD > 7 && <StkBadge tone="bg-amber-50 text-amber-900 border-amber-300">Pas d'import depuis {lateD} j</StkBadge>}
              {+d.non_justifiees > 0 && <StkBadge>{d.non_justifiees} sortie(s) non justifiée(s)</StkBadge>}
              {(() => { const m = stkMeta(DC, d.parc_id); const st = stkAgrStatus(m.agrement, today, XA.agr); return st.code === "expire" || st.code === "bientot" ? <StkBadge tone={STK_AGR[st.code].tone}>Agrément : {st.text.toLowerCase()}</StkBadge> : null; })()}
              {stkMeta(DC, d.parc_id).zone && <StkBadge tone="bg-[#EAF1FA] text-[#123A66] border-[#C9DBEF]">{stkMeta(DC, d.parc_id).zone}</StkBadge>}
            </div>
          </button>;
        })}
      </div>
      {!list.length && <div className="text-sm text-slate-400 py-6 text-center">Aucun parc.</div>}
    </StkCard>
    <StkPtuCard />
    <StkEvolution title="Évolution du stock total (tous parcs)" />
    {lastImports && lastImports.length > 0 && <StkCard className="p-4 md:p-5">
      <div className="font-bold text-[#0B1F38] text-lg mb-3">Derniers imports</div>
      <div className="divide-y divide-slate-100">{lastImports.map((i) => <button key={i.id} onClick={() => openParc(i.parc_id)} className="w-full text-left py-2.5 flex flex-wrap gap-x-4 gap-y-1 items-center text-sm hover:bg-[#F4F8FC] px-2 rounded-lg">
        <span className="font-bold text-[#0B1F38] min-w-[140px]">{i.parcs && i.parcs.name}</span>
        <span className="text-slate-600">Stock du {stkFmt(i.stock_date)}</span>
        <span className="font-plex-mono text-slate-700">{i.nb_chassis} véh.</span>
        <span className="text-emerald-700 font-semibold">+{i.nb_entrees}</span><span className="text-rose-700 font-semibold">−{i.nb_sorties + i.nb_transferts}</span>
        {i.status === "annule" && <StkBadge tone="bg-rose-50 text-rose-700 border-rose-200">Annulé</StkBadge>}
        <span className="text-slate-400 text-xs ml-auto">{i.created_by_name} · {stkFmtTs(i.created_at)}</span>
      </button>)}</div>
    </StkCard>}
  </>;
}

// ---------------- Vue d'un parc ----------------
function StkParc({ parcId, initialTab }) {
  const C = React.useContext(StkCtx);
  const { cfg, dash, go, openVehicle, isAdmin } = C;
  const info = dash.find((d) => d.parc_id === parcId) || {};
  const isPtu = stkIsPtu(C, parcId);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState(initialTab || "tous");
  const [q, setQ] = useState("");
  const [atDate, setAtDate] = useState(null); // { date, rows, lastImport }
  const [askDate, setAskDate] = useState(false);
  const [adding, setAdding] = useState(false);
  const [expAt, setExpAt] = useState(false);
  const today = stkToday();
  const load = async () => {
    try { setErr(""); setData(await stkCall("parc_stock", { parc_id: parcId })); } catch (e) { setErr(stkErrText(e)); }
  };
  useEffect(() => { load(); }, [parcId]);
  const [regN, setRegN] = useState(null);
  const vinRows = useMemo(() => stkVinRegRows(data ? data.rows : []), [data]);
  const loadReg = () => stkCall("regulariser", { parc_id: parcId }).then((r) => setRegN(new Set(r.filter((x) => STK_REG[x.motif]).map((x) => x.vehicle_id).concat(vinRows.map((x) => x.vehicle_id))).size)).catch(() => setRegN(null));
  useEffect(() => { loadReg(); }, [parcId, vinRows.length]);
  const ref = atDate ? atDate.date : today;
  const rows = atDate ? atDate.rows : (data ? data.rows : []);
  const groups = useMemo(() => {
    const g = { disponible: [], bientot: [], depot: [], sans_date: [] };
    rows.forEach((r) => g[stkSit(r, ref, cfg).code].push(r));
    return g;
  }, [rows, ref]);
  const tabs = [
    { key: "tous", label: "Stock total", count: rows.length },
    { key: "disponible", label: "En délai légal", count: groups.disponible.length },
    { key: "bientot", label: "Bientôt en dépôt", count: groups.bientot.length },
    { key: "depot", label: "En dépôt", count: groups.depot.length }
  ];
  if (groups.sans_date.length) tabs.push({ key: "sans_date", label: "Sans date", count: groups.sans_date.length });
  if (!atDate) tabs.push({ key: "regulariser", label: "À régulariser", count: regN, warn: !!regN });
  if (!atDate && isPtu && !stkCfgExtra(C.settings).hidden.includes("ptu")) tabs.push({ key: "manifestes", label: "Manifestes" });
  if (!atDate) tabs.push({ key: "identite", label: "Identité" });
  if (!atDate) tabs.push({ key: "periode", label: "Entrées / sorties" }, { key: "semaines", label: "Par semaine" }, { key: "transferts", label: "Transferts" }, { key: "evolution", label: "Évolution" }, { key: "inventaire", label: "Contrôle inventaire" }, { key: "imports", label: "Imports" });
  const list = tab === "tous" ? rows : groups[tab] || [];
  const filtered = stkFilterRows(list, q);
  const title = tab === "tous" ? "Stock" : (tabs.find((t) => t.key === tab) || {}).label;
  const meta = [`Parc : ${info.parc}`, atDate ? `Stock au ${stkFmt(atDate.date)} (dernier import utilisé : ${atDate.lastImport ? stkFmt(atDate.lastImport.stock_date) : "aucun"})` : `Situation au ${stkFmt(today)} — dernier import : ${data && data.lastImport ? stkFmt(data.lastImport.stock_date) : "aucun"}`];
  const exp = (kind) => {
    const cols = stkExportCols(cfg, ref).concat([{ h: "Entrée au parc", x: (r) => stkFmt(r.entry_date), w: 12 }]);
    const name = `Stock_${info.parc}_${title}_${ref}`;
    if (kind === "x") stkExportXlsx(name, `${title} — ${info.parc}`, meta, cols, filtered);
    else stkPrintPdf(`${title} — ${info.parc}`, meta, cols.filter((c) => !["Manifeste / ATP", "N° BL", "Jours restants"].includes(c.h)), filtered);
  };
  return <>
    <StkPageHead back={() => go("dash")} title={info.parc || "Parc"}
      sub={atDate ? <span className="font-bold text-amber-800">Stock au {stkFmt(atDate.date)} · basé sur l'import du {atDate.lastImport ? stkFmt(atDate.lastImport.stock_date) : "—"} <button className="underline ml-2" onClick={() => { setAtDate(null); setTab("disponible"); }}>Revenir au stock actuel</button></span> : (data && data.lastImport ? `Dernier import : stock du ${stkFmt(data.lastImport.stock_date)} (${data.lastImport.file_name || ""})` : "Aucun import pour ce parc")}
      right={<>
        {!isPtu && stkCan(C, "saisir") && <StkBtn onClick={() => go("saisie", { parc: info.parc })}><StkIc.Edit size={16} /> Saisie manuelle</StkBtn>}
        {!isPtu && stkCan(C, "importer") && <StkBtn kind="primary" onClick={() => go("import", { parc: info.parc })}><Upload size={16} /> Importer le stock</StkBtn>}
        <StkBtn onClick={() => setExpAt(true)} data-testid="btn-extraction"><Download size={16} /> Extraction des données</StkBtn>
        {isAdmin && <StkBtn onClick={() => setAdding(true)}><StkIc.Plus size={16} /> Ajouter un véhicule</StkBtn>}
      </>} />
    {err && <StkMsg tone="err">{err}</StkMsg>}
    <StkParcIdStrip parcId={parcId} onOpen={() => setTab("identite")} />
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StkKpi label="Stock total" value={rows.length} onClick={() => setTab("tous")} />
      <StkKpi label="En délai légal" value={groups.disponible.length} tone="green" onClick={() => setTab("disponible")} />
      <StkKpi label="Bientôt en dépôt" sub={`moins de ${cfg.seuil} j`} value={groups.bientot.length} tone="amber" onClick={() => setTab("bientot")} />
      <StkKpi label="En dépôt" value={groups.depot.length} tone="rose" onClick={() => setTab("depot")} />
    </div>
    <StkTabs tabs={tabs} value={tab} onChange={setTab} />
    {tab === "identite" ? <StkParcIdentity parcId={parcId} parcName={info.parc} /> : tab === "manifestes" ? <StkPtu ptuId={parcId} /> : tab === "regulariser" ? <StkRegulariser parcId={parcId} parcName={info.parc} onChanged={loadReg} extra={vinRows} /> : tab === "periode" ? <StkPeriod parcId={parcId} parcName={info.parc} /> : tab === "semaines" ? <StkWeeks parcId={parcId} /> : tab === "transferts" ? <StkTransfers parcId={parcId} /> : tab === "imports" ? <StkImportsList parcId={parcId} /> : tab === "evolution" ? <StkEvolution parcId={parcId} title={`Évolution du stock — ${info.parc}`} /> : tab === "inventaire" ? <StkInventoryCheck parcName={info.parc} /> :
      <StkCard className="p-4 md:p-5">
        <div className="flex flex-wrap gap-2 items-center mb-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer : châssis, marque, navire..." className={`${stkInput} flex-1 min-w-[200px]`} />
          <StkExportBar disabled={!filtered.length} onXlsx={() => exp("x")} onPdf={() => exp("p")} />
        </div>
        {!data && !atDate ? <StkLoading /> : <StkTable columns={stkCols(cfg, ref, { entree: true })} rows={filtered} onRow={(r) => openVehicle({ id: r.vehicle_id })} empty={rows.length ? "Aucun véhicule dans cette catégorie." : "Aucun véhicule : importez le premier fichier de stock de ce parc."} />}
      </StkCard>}
    {askDate && <StkAtDateModal parcId={parcId} lastImport={data && data.lastImport} onClose={() => setAskDate(false)} onImport={() => { setAskDate(false); go("import", { parc: info.parc }); }} onResult={(r) => { setAskDate(false); setAtDate(r); setTab("tous"); }} />}
    {expAt && <StkExtractionModal parcId={parcId} onClose={() => setExpAt(false)} onShowAtDate={(d) => { setExpAt(false); stkCall("parc_stock", { parc_id: parcId, date: d }).then((r) => { setAtDate({ date: d, rows: r.rows, lastImport: r.lastImport }); setTab("tous"); }).catch((e) => setErr(stkErrText(e))); }} />}
    {adding && <StkVehicleForm parcId={parcId} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); C.reloadDash(); }} />}
  </>;
}

// Stock à une date : demande s'il faut importer un nouveau fichier
function StkAtDateModal({ parcId, lastImport, onClose, onImport, onResult }) {
  const [date, setDate] = useState(stkToday());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const newer = lastImport && date > lastImport.stock_date;
  const run = async () => {
    setBusy(true); setErr("");
    try { const r = await stkCall("parc_stock", { parc_id: parcId, date }); onResult({ date, rows: r.rows, lastImport: r.lastImport }); }
    catch (e) { setErr(stkErrText(e)); setBusy(false); }
  };
  return <StkModal title="Stock du parc à une date" onClose={onClose}>
    <div className="space-y-4">
      <StkField label="Date souhaitée"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={stkInput} /></StkField>
      {!lastImport && <StkMsg tone="warn">Aucun import pour ce parc : importez d'abord un fichier de stock.</StkMsg>}
      {newer && <StkMsg tone="info">Le dernier fichier importé date du <b>{stkFmt(lastImport.stock_date)}</b>. Pour le {stkFmt(date)}, voulez-vous importer un nouveau fichier de stock, ou vous baser sur le dernier import ?</StkMsg>}
      {err && <StkMsg tone="err">{err}</StkMsg>}
      <div className="flex flex-wrap gap-2">
        {newer && <StkBtn kind="primary" onClick={onImport}><Upload size={16} /> Importer un nouveau fichier</StkBtn>}
        <StkBtn kind={newer ? "secondary" : "primary"} disabled={busy || !lastImport} onClick={run}>{newer ? `Utiliser le stock du ${stkFmt(lastImport.stock_date)}` : "Afficher le stock"}</StkBtn>
      </div>
    </div>
  </StkModal>;
}

// Période : stock début, entrées, sorties, stock fin
function StkPeriod({ parcId, parcName }) {
  const PC = React.useContext(StkCtx);
  const { cfg, openVehicle } = PC;
  const canEditP = stkCanEdit(PC);
  const [from, setFrom] = useState(stkAddDays(stkToday(), -30));
  const [to, setTo] = useState(stkToday());
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sub, setSub] = useState("entrees");
  const [sel, setSel] = useState(new Set());
  const [justif, setJustif] = useState(null);
  const run = async () => {
    setBusy(true); setErr("");
    try {
      const [ent, sor, s1, s2] = await Promise.all([
        stkCall("movements", { parc_id: parcId, kind: "entrees", from, to }),
        stkCall("movements", { parc_id: parcId, kind: "sorties", from, to }),
        stkCall("parc_stock", { parc_id: parcId, date: stkAddDays(from, -1) }),
        stkCall("parc_stock", { parc_id: parcId, date: to })
      ]);
      setRes({ ent, sor, debut: s1.rows, fin: s2.rows });
      setSel(new Set());
    } catch (e) { setErr(stkErrText(e)); }
    setBusy(false);
  };
  useEffect(() => { run(); }, [parcId]);
  const rows = res ? (sub === "entrees" ? res.ent : sub === "sorties" ? res.sor : sub === "debut" ? res.debut : res.fin) : [];
  const ref = sub === "debut" ? stkAddDays(from, -1) : to;
  const label = { entrees: "Entrées", sorties: "Sorties", debut: `Stock au ${stkFmt(stkAddDays(from, -1))}`, fin: `Stock au ${stkFmt(to)}` }[sub];
  const exp = (k) => {
    const extra = sub === "sorties" ? [{ h: "Date de sortie", x: (r) => stkFmt(r.exit_date) }, { h: "Type", x: (r) => (stkExitLabel(r) || "") + (r.to_parc ? " vers " + r.to_parc : "") }, { h: "Justification", x: (r) => STK_JUSTIF[r.justif_status || "non_justifiee"].label }, { h: "N° déclaration", k: "justif_numero" }]
      : [{ h: "Entrée au parc", x: (r) => stkFmt(r.entry_date) }, { h: "Origine", x: (r) => stkEntryLabel(r) + (r.from_parc ? " depuis " + r.from_parc : "") }];
    const cols = stkExportCols(cfg, ref).concat(extra);
    const meta = [`Parc : ${parcName}`, `Période du ${stkFmt(from)} au ${stkFmt(to)}`];
    if (k === "x") stkExportXlsx(`${label}_${parcName}_${from}_${to}`, `${label} — ${parcName}`, meta, cols, rows);
    else stkPrintPdf(`${label} — ${parcName}`, meta, cols.filter((c) => !["Manifeste / ATP", "N° BL", "Jours restants", "Situation"].includes(c.h)), rows);
  };
  const selRows = rows.filter((r) => sel.has(r.stay_id));
  return <StkCard className="p-4 md:p-5 space-y-4">
    <div className="flex flex-wrap gap-3 items-end">
      <StkField label="Du"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={stkInput} /></StkField>
      <StkField label="Au"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={stkInput} /></StkField>
      <StkBtn kind="primary" disabled={busy} onClick={run}>{busy ? "Calcul..." : "Afficher"}</StkBtn>
    </div>
    {err && <StkMsg tone="err">{err}</StkMsg>}
    {res && <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StkKpi label={`Stock au ${stkFmt(stkAddDays(from, -1))}`} value={res.debut.length} tone="slate" onClick={() => setSub("debut")} />
      <StkKpi label="Entrées" value={res.ent.length} tone="green" onClick={() => setSub("entrees")} />
      <StkKpi label="Sorties" value={res.sor.length} tone="rose" onClick={() => setSub("sorties")} />
      <StkKpi label={`Stock au ${stkFmt(to)}`} value={res.fin.length} onClick={() => setSub("fin")} />
    </div>}
    {res && <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="font-bold text-[#0B1F38] flex-1">{label}</div>
        {sub === "sorties" && selRows.length > 0 && canEditP && <StkBtn small kind="primary" onClick={() => setJustif(selRows)}><StkIc.Clip size={15} /> Justifier / joindre une déclaration ({selRows.length})</StkBtn>}
        <StkExportBar disabled={!rows.length} onXlsx={() => exp("x")} onPdf={() => exp("p")} />
      </div>
      <StkTable columns={stkCols(cfg, ref, { entree: sub !== "sorties", sortie: sub === "sorties", justif: sub === "sorties" })} rows={rows} onRow={(r) => openVehicle({ id: r.vehicle_id })} selectable={sub === "sorties"} selected={sel} setSelected={setSel} empty="Aucun mouvement sur la période." />
    </>}
    {justif && <StkJustifyModal stays={justif} onClose={() => setJustif(null)} onDone={() => { setJustif(null); run(); }} />}
  </StkCard>;
}

// ---------------- Recherche avancée ----------------
function StkSearch({ preset }) {
  const { cfg, dash, openVehicle } = React.useContext(StkCtx);
  const [f, setF] = useState({ q: "", field: "", parc_id: "", statut: "", navire: "", marque: "", arr_from: "", arr_to: "", situation: "", sans_date: false, ...(preset || {}) });
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [scan, setScan] = useState(false);
  const today = stkToday();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e && e.target ? (e.target.type === "checkbox" ? e.target.checked : e.target.value) : e }));
  const run = async (over) => {
    const p = { ...f, ...(over || {}) };
    setBusy(true); setErr("");
    try {
      const params = { q: p.q, field: p.field, parc_id: p.parc_id || null, statut: p.statut, navire: p.navire, marque: p.marque, arr_from: p.arr_from, arr_to: p.arr_to, sans_date: p.sans_date, limit: 2000 };
      // Situation → bornes sur la date d'arrivée
      if (p.situation === "depot") params.depot_to = stkAddDays(today, -cfg.duree);
      if (p.situation === "bientot") { params.depot_from = stkAddDays(today, -cfg.duree + 1); params.depot_to = stkAddDays(today, -cfg.duree + cfg.seuil); }
      if (p.situation === "disponible") params.depot_from = stkAddDays(today, -cfg.duree + cfg.seuil + 1);
      if (p.situation) params.statut = "present";
      const r = await stkCall("search", params);
      setRows(r.map((x) => ({ ...x, parcName: x.parc ? x.parc.name : null })));
      if (r.length === 1 && p.q && !over) openVehicle({ id: r[0].id });
    } catch (e) { setErr(stkErrText(e)); }
    setBusy(false);
  };
  useEffect(() => { if (preset && (preset.q || preset.situation || preset.sans_date || preset.navire)) run(); }, []);
  const applySaved = (params) => { const n = { q: "", field: "", parc_id: "", statut: "", navire: "", marque: "", arr_from: "", arr_to: "", situation: "", sans_date: false, ...params }; setF(n); run(n); };
  const cols = [
    { key: "chassis", label: "Châssis", render: (r) => <span className="font-plex-mono font-bold text-[#0B1F38] whitespace-nowrap">{r.chassis}</span> },
    { key: "veh", label: "Véhicule", sort: (r) => stkVeh(r), render: (r) => stkVeh(r) || "—" },
    { key: "navire", label: "Navire", render: (r) => r.navire || "—" },
    { key: "parcName", label: "Parc actuel", render: (r) => r.parcName ? <span className="font-semibold">{r.parcName}</span> : <StkBadge tone={STK_SIT_TONE.sorti}>Sorti</StkBadge> },
    { key: "date_arrivee", label: "Arrivée", render: (r) => stkFmt(r.date_arrivee) || "—" }
  ];
  if (cfg.transfert) cols.push({ key: "date_transfert", label: "Transfert", render: (r) => stkFmt(r.date_transfert) || "—" });
  cols.push({ key: "depot", label: "Date de dépôt", sort: (r) => stkSit(r, today, cfg).depot, render: (r) => stkFmt(stkSit(r, today, cfg).depot) || "—" });
  cols.push({ key: "sit", label: "Situation", sort: (r) => stkSit(r, today, cfg).restant, render: (r) => r.parcName ? <StkSitBadge row={r} /> : "—" });
  const exp = (k) => {
    const c = [{ h: "Châssis", k: "chassis", w: 22 }, { h: "Marque", k: "marque" }, { h: "Modèle", k: "modele" }, { h: "Année", k: "annee", w: 7 }, { h: "Navire", k: "navire", w: 20 }, { h: "Manifeste / ATP", k: "manifeste" }, { h: "N° BL", k: "bl" }, { h: "Importateur", k: "importateur" }, { h: "Parc actuel", x: (r) => r.parcName || "Sorti" }, { h: "Date d'arrivée", x: (r) => stkFmt(r.date_arrivee) }]
      .concat(cfg.transfert ? [{ h: "Date de transfert", x: (r) => stkFmt(r.date_transfert) }] : [])
      .concat([{ h: "Date de dépôt", x: (r) => stkFmt(stkSit(r, today, cfg).depot) }, { h: "Situation", x: (r) => r.parcName ? stkSit(r, today, cfg).label : "Sorti" }]);
    const meta = [`Recherche : ${f.q || "(tous)"}`, `Édité le ${stkFmt(today)}`];
    if (k === "x") stkExportXlsx(`Recherche_${today}`, "Résultat de recherche", meta, c, rows);
    else stkPrintPdf("Résultat de recherche", meta, c.filter((x) => !["Manifeste / ATP", "N° BL", "Importateur"].includes(x.h)), rows);
  };
  return <>
    <StkPageHead title="Recherche avancée" sub="Retrouvez un véhicule et tout son historique : marque, parc actuel, entrée, transfert, navire, date de dépôt..." />
    <StkCard className="p-4 md:p-5">
      <form onSubmit={(e) => { e.preventDefault(); run(); }} className="space-y-3">
        <div className="flex gap-2">
          <input autoFocus value={f.q} onChange={set("q")} placeholder="Châssis complet ou partiel, marque, modèle, navire, manifeste, BL, importateur" className={`${stkInput} flex-1 py-3 text-base`} />
          <StkBtn type="button" onClick={() => setScan(true)}><ScanLine size={18} /></StkBtn>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StkField label="Chercher dans"><select value={f.field} onChange={set("field")} className={stkInput}><option value="">Tous les champs</option><option value="chassis">Châssis uniquement</option></select></StkField>
          <StkField label="Parc actuel"><select value={f.parc_id} onChange={set("parc_id")} className={stkInput}><option value="">Tous les parcs</option>{dash.map((d) => <option key={d.parc_id} value={d.parc_id}>{d.parc}</option>)}</select></StkField>
          <StkField label="Statut"><select value={f.statut} onChange={set("statut")} className={stkInput}><option value="">Présents et sortis</option><option value="present">Présents en parc</option><option value="sorti">Sortis</option></select></StkField>
          <StkField label="Situation (séjour)"><select value={f.situation} onChange={set("situation")} className={stkInput}><option value="">Toutes</option><option value="disponible">En délai légal</option><option value="bientot">Bientôt en dépôt</option><option value="depot">En dépôt</option></select></StkField>
          <StkField label="Navire"><input value={f.navire} onChange={set("navire")} className={stkInput} /></StkField>
          <StkField label="Marque"><input value={f.marque} onChange={set("marque")} className={stkInput} /></StkField>
          <StkField label="Arrivée du"><input type="date" value={f.arr_from} onChange={set("arr_from")} className={stkInput} /></StkField>
          <StkField label="Arrivée au"><input type="date" value={f.arr_to} onChange={set("arr_to")} className={stkInput} /></StkField>
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          <label className="text-sm font-semibold text-slate-600 flex items-center gap-2"><input type="checkbox" checked={f.sans_date} onChange={set("sans_date")} /> Sans date d'arrivée</label>
          <div className="flex-1" />
          <StkBtn type="button" kind="ghost" onClick={() => { setF({ q: "", field: "", parc_id: "", statut: "", navire: "", marque: "", arr_from: "", arr_to: "", situation: "", sans_date: false }); setRows(null); }}>Effacer</StkBtn>
          <StkBtn kind="primary" type="submit" disabled={busy}><Search size={16} /> {busy ? "Recherche..." : "Rechercher"}</StkBtn>
        </div>
      </form>
      <div className="pt-3 mt-3 border-t border-slate-100"><StkSavedFilters current={f} onApply={applySaved} /></div>
    </StkCard>
    {err && <StkMsg tone="err">{err}</StkMsg>}
    {rows && <StkCard className="p-4 md:p-5">
      <div className="flex items-center gap-2 mb-3"><div className="font-bold text-[#0B1F38] flex-1">{rows.length.toLocaleString("fr-FR")} véhicule(s){rows.length >= 2000 ? " (2 000 premiers — affinez la recherche)" : ""}</div><StkExportBar disabled={!rows.length} onXlsx={() => exp("x")} onPdf={() => exp("p")} /></div>
      <StkTable columns={cols} rows={rows} rowKey={(r) => r.id} onRow={(r) => openVehicle({ id: r.id })} empty="Aucun véhicule ne correspond." />
    </StkCard>}
    {scan && <CameraScanner knownMap={new Map()} onClose={() => setScan(false)} onDetect={(c) => { setScan(false); setF((x) => ({ ...x, q: c, field: "chassis" })); run({ q: c, field: "chassis" }); }} />}
  </>;
}

// ---------------- Fiche véhicule ----------------
function StkVehicleModal({ target, onClose }) {
  const C = React.useContext(StkCtx);
  const { cfg, isAdmin } = C;
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [edit, setEdit] = useState(false);
  const [editStay, setEditStay] = useState(null);
  const [justif, setJustif] = useState(null);
  const [raw, setRaw] = useState(false);
  const today = stkToday();
  const load = async () => {
    try { setErr(""); setD(await stkCall("vehicle", target.id ? { id: target.id } : { chassis: target.chassis })); }
    catch (e) {
      if (target.fallbackSearch && String(e.message) === "VEHICULE_INTROUVABLE") { onClose(); C.go("search", { q: target.chassis }); return; }
      setErr(stkErrText(e));
    }
  };
  useEffect(() => { load(); }, []);
  const v = d && d.vehicle;
  const sit = v ? stkSit(v, today, cfg) : null;
  const present = v && v.current_parc_id;
  const impName = (id) => { const i = d && d.imports.find((x) => x.id === id); return i ? `${i.file_name || "fichier"} (stock du ${stkFmt(i.stock_date)})` : ""; };
  const openFile = async (f) => { try { const r = await stkCall("file_url", { path: f.path }); window.open(r.url, "_blank", "noopener"); } catch (e) { alert(stkErrText(e)); } };
  const act = async (action, params, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    try { await stkCall(action, params); await load(); C.reloadDash(); } catch (e) { alert(stkErrText(e)); }
  };
  const Info = ({ l, v: val, mono }) => <div className="bg-white rounded-xl border border-slate-200 px-3 py-2"><div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">{l}</div><div className={`text-sm font-semibold text-[#0B1F38] mt-0.5 break-words ${mono ? "font-plex-mono" : ""}`}>{val || "—"}</div></div>;
  const printFiche = () => {
    const cols = [{ h: "Parc", k: "parc" }, { h: "Entrée", x: (s) => `${stkFmt(s.entry_date)} — ${stkEntryLabel(s)}${s.from_parc ? " depuis " + s.from_parc : ""}` }, { h: "Sortie", x: (s) => s.exit_date ? `${stkFmt(s.exit_date)} — ${stkExitLabel(s) || ""}${s.to_parc ? " vers " + s.to_parc : ""}` : "Présent" }, { h: "Justification", x: (s) => s.exit_date ? `${STK_JUSTIF[s.justif_status].label}${s.justif_numero ? " — " + s.justif_numero : ""}` : "" }];
    stkPrintPdf(`Fiche véhicule ${v.chassis}`, [`${stkVeh(v)} · Navire ${v.navire || "—"} · Arrivée ${stkFmt(v.date_arrivee) || "—"}${cfg.transfert && v.date_transfert ? " · Transfert " + stkFmt(v.date_transfert) : ""} · Dépôt ${stkFmt(sit.depot) || "—"}`, `Parc actuel : ${d.parc ? d.parc.name : "sorti"} · Manifeste ${v.manifeste || "—"} · BL ${v.bl || "—"}`], cols, d.stays, false);
  };
  return <StkModal wide title={v ? <span>Fiche véhicule · <span className="font-plex-mono">{v.chassis}</span></span> : "Fiche véhicule"} onClose={onClose}
    footer={v && <>
      {isAdmin && <StkBtn small kind="danger" onClick={() => act("vehicle_delete", { id: v.id }, "Mettre ce véhicule à la corbeille ? (restaurable depuis l'administration)").then(onClose)}><Trash2 size={15} /> Supprimer</StkBtn>}
      {isAdmin && <StkBtn small onClick={() => setEdit(true)}><StkIc.Edit size={15} /> Modifier la fiche</StkBtn>}
      <StkFollowBtn vehicleId={v.id} />
      <StkBtn small onClick={printFiche}><Printer size={15} /> Imprimer / PDF</StkBtn>
      <StkBtn small kind="primary" onClick={onClose}>Fermer</StkBtn>
    </>}>
    {err && <StkMsg tone="err">{err}</StkMsg>}
    {!d && !err && <StkLoading />}
    {v && <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-xl font-semibold text-[#0B1F38] mr-2">{stkVeh(v) || "Véhicule"}</div>
        {present ? <StkBadge tone={STK_SIT_TONE[sit.code]}>{sit.label}{sit.restant != null ? (sit.restant > 0 ? ` · ${sit.restant} j restants` : ` · depuis ${-sit.restant} j`) : ""}</StkBadge> : <StkBadge tone={STK_SIT_TONE.sorti}>Sorti du parc</StkBadge>}
        {d.parc && <StkBadge tone="bg-[#EAF1FA] text-[#123A66] border-[#C9DBEF]">Parc actuel : {d.parc.name}</StkBadge>}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Info l="Châssis" v={v.chassis} mono />
        <Info l="Marque" v={v.marque} /><Info l="Modèle" v={v.modele} /><Info l="Année" v={v.annee} />
        <Info l="Navire" v={v.navire} /><Info l="Manifeste / ATP" v={v.manifeste} /><Info l="N° BL" v={v.bl} /><Info l="Importateur" v={v.importateur} />
        <Info l="Date d'arrivée" v={stkFmt(v.date_arrivee)} />
        {cfg.transfert && <Info l="Date de transfert" v={stkFmt(v.date_transfert)} />}
        <Info l={cfg.mmte && v.mmte_depot_date ? "Date de dépôt (MMTE)" : "Date de dépôt (calculée)"} v={stkFmt(sit.depot)} />
        {v.mmte_depot_date && <Info l="Dépôt selon MMTE" v={`${stkFmt(v.mmte_depot_date)}${v.date_arrivee ? ` (écart ${stkDiff(stkAddDays(v.date_arrivee, cfg.duree), v.mmte_depot_date)} j)` : ""}`} />}
        <Info l="Durée de séjour" v={sit.sejour != null ? `${sit.sejour} jours` : ""} />
        {v.chassis_raw && v.chassis_raw !== v.chassis && <Info l="Châssis tel qu'écrit" v={v.chassis_raw} mono />}
      </div>
      {!stkCfgExtra(C.settings).hidden.includes("vin") && <StkVinBox v={v} />}
      {v.notes && <StkMsg tone="info"><b>Note :</b> {v.notes}</StkMsg>}
      {(v.locked_fields || []).length > 0 && <div className="text-xs text-slate-500">🔒 Champs corrigés et verrouillés (les imports ne les modifient plus) : {v.locked_fields.map((k) => STK_FIELDS[k] || k).join(", ")}</div>}
      <div>
        <div className="flex items-center gap-2 mb-2"><div className="font-bold text-[#0B1F38] flex-1">Historique du véhicule</div>{isAdmin && <StkBtn small onClick={() => setEditStay({ vehicle_id: v.id })}><StkIc.Plus size={14} /> Ajouter un mouvement</StkBtn>}</div>
        <div className="space-y-2">{d.stays.map((s) => <div key={s.stay_id} className="bg-white rounded-xl border border-slate-200 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="font-bold text-[#0B1F38]">{s.parc}</div>
            {!s.exit_date && <StkBadge tone="bg-emerald-50 text-emerald-800 border-emerald-200">Présent</StkBadge>}
            <div className="flex-1" />
            {isAdmin && <><button className="text-xs font-bold text-[#1B4F8C] underline" onClick={() => setEditStay(s)}>Modifier</button><button className="text-xs font-bold text-rose-700 underline" onClick={() => act("stay_delete", { id: s.stay_id }, "Mettre ce mouvement à la corbeille ?")}>Supprimer</button></>}
          </div>
          <div className="grid md:grid-cols-2 gap-2 mt-2 text-sm">
            <div className="rounded-lg bg-emerald-50/60 border border-emerald-100 px-3 py-2"><div className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">{stkEntryLabel(s)}{s.from_parc ? ` depuis ${s.from_parc}` : ""}</div><div className="font-semibold">{stkFmt(s.entry_date)} <span className="text-[11px] font-normal text-slate-500">{s.entry_from_file ? "(date du fichier du parc)" : s.entry_import_id ? "(date de l'import)" : ""}</span></div>{s.entry_import_id && <div className="text-[11px] text-slate-500">{impName(s.entry_import_id)}</div>}</div>
            <div className={`rounded-lg px-3 py-2 border ${s.exit_date ? "bg-rose-50/60 border-rose-100" : "bg-slate-50 border-slate-100"}`}><div className="text-[11px] font-bold uppercase tracking-wider text-rose-800">{s.exit_date ? `${stkExitLabel(s) || "Sortie"}${s.to_parc ? ` vers ${s.to_parc}` : ""}` : "Sortie"}</div><div className="font-semibold">{s.exit_date ? <>{stkFmt(s.exit_date)} <span className="text-[11px] font-normal text-slate-500">(constatée à l'import)</span></> : "—"}</div>{s.exit_import_id && <div className="text-[11px] text-slate-500">Absent de {impName(s.exit_import_id)}</div>}</div>
          </div>
          {s.exit_date && <div className="mt-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <StkBadge tone={STK_JUSTIF[s.justif_status].tone}>{STK_JUSTIF[s.justif_status].label}</StkBadge>
              {s.justif_type && <span className="font-semibold">{s.justif_type}</span>}
              {s.justif_numero && <span>Déclaration <b>{s.justif_numero}</b></span>}
              {s.justif_date && <span>du {stkFmt(s.justif_date)}</span>}
              {s.justif_bureau && <span>· {s.justif_bureau}</span>}
              <div className="flex-1" />
              {(s.justif_status !== "validee" || isAdmin) && stkCanEdit(C) && <StkBtn small onClick={() => setJustif([s])}><StkIc.Clip size={14} /> {s.justif_status === "non_justifiee" ? "Justifier la sortie" : "Modifier"}</StkBtn>}
              {isAdmin && s.justif_status === "justifiee" && <StkBtn small kind="primary" onClick={() => act("validate", { stay_ids: [s.stay_id] })}><StkIc.Check size={14} /> Valider</StkBtn>}
            </div>
            {s.justif_note && <div className="text-slate-600 mt-1">{s.justif_note}</div>}
            {(s.justif_files || []).length > 0 && <div className="flex flex-wrap gap-2 mt-2">{s.justif_files.map((f) => <span key={f.path} className="inline-flex items-center gap-1"><button className="text-xs font-bold text-[#1B4F8C] underline inline-flex items-center gap-1" onClick={() => openFile(f)}><StkIc.Clip size={12} />{f.name}</button>{(isAdmin || s.justif_status !== "validee") && <button className="text-rose-600 text-xs" title="Retirer" onClick={() => act("remove_file", { stay_id: s.stay_id, path: f.path }, "Retirer cette pièce jointe ?")}>✕</button>}</span>)}</div>}
            {(s.justif_by || s.valide_by) && <div className="text-[11px] text-slate-400 mt-1">{s.justif_by ? `Justifiée par ${s.justif_by}` : ""}{s.valide_by ? ` · validée par ${s.valide_by}` : ""}</div>}
          </div>}
        </div>)}</div>
        {!d.stays.length && <div className="text-sm text-slate-400">Aucun mouvement enregistré.</div>}
      </div>
      <div>
        <button className="text-sm font-bold text-[#1B4F8C] underline" onClick={() => setRaw((x) => !x)}>{raw ? "Masquer" : "Afficher"} toutes les données reçues dans les fichiers</button>
        {raw && <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-1 text-sm">{Object.entries(v.data || {}).map(([k, val]) => <div key={k} className="flex gap-2 bg-white rounded-lg border border-slate-100 px-3 py-1.5"><span className="text-slate-500 min-w-[130px]">{k}</span><span className="font-semibold text-[#0B1F38] break-all">{String(val)}</span></div>)}</div>}
      </div>
      {d.history && d.history.length > 0 && <div><div className="font-bold text-[#0B1F38] mb-2">Journal des actions sur ce véhicule</div>
        <div className="text-sm divide-y divide-slate-100 bg-white rounded-xl border border-slate-200">{d.history.map((h, i) => <div key={i} className="px-3 py-2 flex flex-wrap gap-x-3"><span className="text-slate-400 text-xs">{stkFmtTs(h.at)}</span><span className="font-semibold">{h.by_name}</span><span className="text-slate-600">{h.detail}</span></div>)}</div></div>}
    </div>}
    {edit && <StkVehicleForm vehicle={v} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); load(); }} />}
    {editStay && <StkStayForm stay={editStay} onClose={() => setEditStay(null)} onSaved={() => { setEditStay(null); load(); C.reloadDash(); }} />}
    {justif && <StkJustifyModal stays={justif} onClose={() => setJustif(null)} onDone={() => { setJustif(null); load(); C.reloadDash(); }} />}
  </StkModal>;
}

function StkVehicleForm({ vehicle, parcId, onClose, onSaved }) {
  const v = vehicle || {};
  const [locks, setLocks] = useState(() => new Set(v.locked_fields || []));
  const [f, setF] = useState({ chassis: v.chassis || "", marque: v.marque || "", modele: v.modele || "", annee: v.annee || "", navire: v.navire || "", manifeste: v.manifeste || "", bl: v.bl || "", importateur: v.importateur || "", date_arrivee: v.date_arrivee || "", date_transfert: v.date_transfert || "", notes: v.notes || "", entry_date: stkToday() });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k) => (e) => { const val = e.target.value; setF((x) => ({ ...x, [k]: val })); if (vehicle && k !== "notes" && k !== "chassis") setLocks((L) => new Set([...L, k])); };
  const save = async () => {
    setBusy(true); setErr("");
    try {
      const fields = { ...f, locked_fields: Array.from(locks) }; delete fields.entry_date;
      await stkCall("vehicle_save", vehicle ? { id: v.id, fields } : { fields, parc_id: parcId, entry_date: f.entry_date });
      onSaved();
    } catch (e) { setErr(stkErrText(e)); setBusy(false); }
  };
  const F = (k, l, t) => <StkField label={<span className="flex items-center gap-2">{l}{vehicle && k !== "chassis" && <label className="ml-auto inline-flex items-center gap-1 font-semibold text-[10.5px] text-slate-500 cursor-pointer" title="Un champ verrouillé n'est plus modifié par les imports"><input type="checkbox" checked={locks.has(k)} onChange={(e) => setLocks((L) => { const n = new Set(L); e.target.checked ? n.add(k) : n.delete(k); return n; })} />🔒</label>}</span>}><input type={t || "text"} value={f[k]} onChange={set(k)} className={stkInput} /></StkField>;
  return <StkModal title={vehicle ? "Modifier la fiche véhicule" : "Ajouter un véhicule au parc"} onClose={onClose} footer={<><StkBtn onClick={onClose}>Annuler</StkBtn><StkBtn kind="primary" disabled={busy} onClick={save}>Enregistrer</StkBtn></>}>
    <div className="grid grid-cols-2 gap-3">
      {F("chassis", "Châssis")}{F("marque", "Marque")}{F("modele", "Modèle")}{F("annee", "Année")}{F("navire", "Navire")}{F("manifeste", "Manifeste / ATP")}{F("bl", "N° BL")}{F("importateur", "Importateur")}{F("date_arrivee", "Date d'arrivée", "date")}{F("date_transfert", "Date de transfert", "date")}
      {!vehicle && F("entry_date", "Date d'entrée au parc", "date")}
      <StkField label="Note" className="col-span-2"><textarea value={f.notes} onChange={set("notes")} rows={2} className={stkInput} /></StkField>
    </div>
    {vehicle && <div className="text-xs text-slate-500 mt-3">🔒 Les champs que vous corrigez sont verrouillés automatiquement : les prochains imports ne les écraseront plus. Décochez pour laisser les fichiers des parcs les mettre à jour.</div>}
    {err && <div className="mt-3"><StkMsg tone="err">{err}</StkMsg></div>}
  </StkModal>;
}

function StkStayForm({ stay, onClose, onSaved }) {
  const { dash } = React.useContext(StkCtx);
  const isNew = !stay.stay_id;
  const [f, setF] = useState({ parc_id: stay.parc_id || "", entry_date: stay.entry_date || stkToday(), entry_kind: stay.entry_kind || "manuel", from_parc_id: stay.from_parc_id || "", exit_date: stay.exit_date || "", exit_kind: stay.exit_kind || "", to_parc_id: stay.to_parc_id || "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    if (!f.parc_id) { setErr("Choisissez le parc."); return; }
    setBusy(true); setErr("");
    const fields = { ...f, parc_id: Number(f.parc_id), from_parc_id: f.from_parc_id ? Number(f.from_parc_id) : null, to_parc_id: f.to_parc_id ? Number(f.to_parc_id) : null, exit_date: f.exit_date || null, exit_kind: f.exit_date ? (f.exit_kind || "manuel") : null };
    try { await stkCall("stay_save", isNew ? { vehicle_id: stay.vehicle_id, fields } : { id: stay.stay_id, fields }); onSaved(); }
    catch (e) { setErr(stkErrText(e)); setBusy(false); }
  };
  const parcSel = (k, empty) => <select value={f[k]} onChange={set(k)} className={stkInput}><option value="">{empty}</option>{dash.map((d) => <option key={d.parc_id} value={d.parc_id}>{d.parc}</option>)}</select>;
  return <StkModal title={isNew ? "Ajouter un mouvement" : "Modifier le mouvement"} onClose={onClose} footer={<><StkBtn onClick={onClose}>Annuler</StkBtn><StkBtn kind="primary" disabled={busy} onClick={save}>Enregistrer</StkBtn></>}>
    <div className="grid grid-cols-2 gap-3">
      <StkField label="Parc" className="col-span-2">{parcSel("parc_id", "— Choisir —")}</StkField>
      <StkField label="Date d'entrée"><input type="date" value={f.entry_date} onChange={set("entry_date")} className={stkInput} /></StkField>
      <StkField label="Type d'entrée"><select value={f.entry_kind} onChange={set("entry_kind")} className={stkInput}>{Object.entries(STK_ENTRY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></StkField>
      <StkField label="Venant du parc" className="col-span-2">{parcSel("from_parc_id", "—")}</StkField>
      <StkField label="Date de sortie" hint="Vide = toujours présent"><input type="date" value={f.exit_date} onChange={set("exit_date")} className={stkInput} /></StkField>
      <StkField label="Type de sortie"><select value={f.exit_kind} onChange={set("exit_kind")} className={stkInput}><option value="">—</option>{Object.entries(STK_EXIT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></StkField>
      <StkField label="Vers le parc" className="col-span-2">{parcSel("to_parc_id", "—")}</StkField>
    </div>
    {err && <div className="mt-3"><StkMsg tone="err">{err}</StkMsg></div>}
  </StkModal>;
}

// ---------------- Justification d'une ou plusieurs sorties ----------------
function StkJustifyModal({ stays, onClose, onDone }) {
  const { cfg, toast } = React.useContext(StkCtx);
  const s0 = stays[0] || {};
  const [f, setF] = useState({ justif_type: s0.justif_type || (s0.exit_kind === "transfert" ? "Transfert" : cfg.types[0]), justif_numero: s0.justif_numero || "", justif_date: s0.justif_date || "", justif_bureau: s0.justif_bureau || "", justif_note: s0.justif_note || "" });
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [warn, setWarn] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const ids = stays.map((s) => s.stay_id);
  const save = async () => {
    setErr(""); setBusy("Enregistrement...");
    try {
      const r = await stkCall("justify", { stay_ids: ids, ...f });
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setBusy(`Envoi de la pièce ${i + 1}/${files.length}...`);
        let b64, type = file.type;
        if (/^image\//.test(file.type)) { const url = await compressImageToDataUrl(file, 1800, 0.72); b64 = url.split(",")[1]; type = "image/jpeg"; }
        else b64 = await stkFileToB64(file);
        await stkCall("upload_file", { stay_ids: ids, name: file.name, type, b64 });
      }
      if (r.warning && r.warning.length) { setWarn(r.warning); setBusy(""); return; }
      toast(`${ids.length} sortie(s) justifiée(s)`);
      onDone();
    } catch (e) { setErr(stkErrText(e)); setBusy(""); }
  };
  return <StkModal title={stays.length > 1 ? `Justifier ${stays.length} sorties` : <span>Justifier la sortie · <span className="font-plex-mono">{s0.chassis}</span></span>} onClose={onClose}
    footer={warn ? <StkBtn kind="primary" onClick={onDone}>J'ai compris</StkBtn> : <><StkBtn onClick={onClose}>Annuler</StkBtn><StkBtn kind="primary" disabled={!!busy} onClick={save}>{busy || "Enregistrer"}</StkBtn></>}>
    {warn ? <StkMsg tone="warn"><b>Enregistré.</b> Attention : ce n° de déclaration est déjà utilisé pour d'autres véhicules :<ul className="list-disc ml-5 mt-1">{warn.map((w, i) => <li key={i}>{w.chassis} — {w.parc}{w.exit_date ? ` (sortie du ${stkFmt(w.exit_date)})` : ""}</li>)}</ul></StkMsg> :
      <div className="space-y-3">
        <StkMsg tone="info">La justification est facultative : elle n'empêche aucune opération. Joignez la déclaration de paiement de la douane ou tout document qui confirme la sortie.</StkMsg>
        {stays.length > 1 && <div className="text-xs text-slate-500 break-all">{stays.map((s) => s.chassis).join(", ")}</div>}
        <StkField label="Type de sortie"><select value={f.justif_type} onChange={set("justif_type")} className={stkInput}>{cfg.types.map((t) => <option key={t}>{t}</option>)}</select></StkField>
        <div className="grid grid-cols-2 gap-3">
          <StkField label="N° de déclaration"><input value={f.justif_numero} onChange={set("justif_numero")} className={stkInput} /></StkField>
          <StkField label="Date de la déclaration"><input type="date" value={f.justif_date} onChange={set("justif_date")} className={stkInput} /></StkField>
        </div>
        <StkField label="Bureau de douane"><input value={f.justif_bureau} onChange={set("justif_bureau")} className={stkInput} /></StkField>
        <StkField label="Observation"><textarea rows={2} value={f.justif_note} onChange={set("justif_note")} className={stkInput} /></StkField>
        <StkField label="Pièces jointes (PDF ou photo)" hint="Les photos sont compressées automatiquement. 8 Mo maximum par fichier.">
          <input type="file" multiple accept="application/pdf,image/*" capture="environment" onChange={(e) => setFiles(Array.from(e.target.files || []))} className="block text-sm" />
        </StkField>
        {err && <StkMsg tone="err">{err}</StkMsg>}
      </div>}
  </StkModal>;
}

function StkJustifScreen() {
  const JC = React.useContext(StkCtx);
  const { cfg, dash, openVehicle, isAdmin, reloadDash } = JC;
  const canEditP = stkCanEdit(JC);
  const [tab, setTab] = useState("non_justifiee");
  const [parc, setParc] = useState("");
  const [from, setFrom] = useState(stkAddDays(stkToday(), -365));
  const [to, setTo] = useState(stkToday());
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(new Set());
  const [justif, setJustif] = useState(null);
  const [err, setErr] = useState("");
  const load = async () => {
    setRows(null); setErr("");
    try { setRows(await stkCall("movements", { kind: "sorties", from, to, parc_id: parc || null, justif: tab })); setSel(new Set()); }
    catch (e) { setErr(stkErrText(e)); setRows([]); }
  };
  useEffect(() => { load(); }, [tab, parc]);
  const filtered = stkFilterRows(rows || [], q);
  const selRows = filtered.filter((r) => sel.has(r.stay_id));
  const validate = async () => { try { await stkCall("validate", { stay_ids: selRows.map((r) => r.stay_id) }); load(); reloadDash(); } catch (e) { alert(stkErrText(e)); } };
  const exp = (k) => {
    const cols = [{ h: "Châssis", k: "chassis", w: 22 }, { h: "Véhicule", x: stkVeh, w: 24 }, { h: "Parc", k: "parc" }, { h: "Date de sortie", x: (r) => stkFmt(r.exit_date) }, { h: "Type", x: (r) => (stkExitLabel(r) || "") + (r.to_parc ? " vers " + r.to_parc : "") }, { h: "Justification", x: (r) => STK_JUSTIF[r.justif_status].label }, { h: "N° déclaration", k: "justif_numero" }, { h: "Date décl.", x: (r) => stkFmt(r.justif_date) }, { h: "Bureau", k: "justif_bureau" }];
    const title = `Sorties — ${STK_JUSTIF[tab].label.toLowerCase()}s`;
    const meta = [`Période du ${stkFmt(from)} au ${stkFmt(to)}`, parc ? `Parc : ${(dash.find((d) => d.parc_id === Number(parc)) || {}).parc}` : "Tous les parcs"];
    k === "x" ? stkExportXlsx(`Sorties_${tab}_${to}`, title, meta, cols, filtered) : stkPrintPdf(title, meta, cols, filtered);
  };
  return <>
    <StkPageHead title="Justification des sorties" sub="Joignez les déclarations de paiement de la douane pour justifier les véhicules sortis. Facultatif : rien n'est bloqué." />
    <StkTabs tabs={[{ key: "non_justifiee", label: "Non justifiées" }, { key: "justifiee", label: "Justifiées (à valider)" }, { key: "validee", label: "Validées" }]} value={tab} onChange={setTab} />
    <StkCard className="p-4 md:p-5">
      <div className="flex flex-wrap gap-3 items-end mb-3">
        <StkField label="Parc"><select value={parc} onChange={(e) => setParc(e.target.value)} className={stkInput}><option value="">Tous les parcs</option>{dash.map((d) => <option key={d.parc_id} value={d.parc_id}>{d.parc}</option>)}</select></StkField>
        <StkField label="Sorties du"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={stkInput} /></StkField>
        <StkField label="au"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={stkInput} /></StkField>
        <StkBtn onClick={load}>Afficher</StkBtn>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer" className={`${stkInput} flex-1 min-w-[160px]`} />
        <StkExportBar disabled={!filtered.length} onXlsx={() => exp("x")} onPdf={() => exp("p")} />
      </div>
      {selRows.length > 0 && <div className="flex flex-wrap gap-2 mb-3 p-3 rounded-xl bg-[#EAF1FA]">
        <span className="text-sm font-bold text-[#123A66] flex-1">{selRows.length} sortie(s) sélectionnée(s)</span>
        {canEditP && <StkBtn small kind="primary" onClick={() => setJustif(selRows)}><StkIc.Clip size={14} /> Justifier / joindre une déclaration</StkBtn>}
        {isAdmin && tab === "justifiee" && <StkBtn small onClick={validate}><StkIc.Check size={14} /> Valider</StkBtn>}
      </div>}
      {err && <StkMsg tone="err">{err}</StkMsg>}
      {!rows ? <StkLoading /> : <StkTable columns={stkCols(cfg, stkToday(), { parc: true, sortie: true, justif: true, noSit: true })} rows={filtered} selectable selected={sel} setSelected={setSel} onRow={(r) => openVehicle({ id: r.vehicle_id })} empty="Aucune sortie dans cette catégorie." />}
    </StkCard>
    {justif && <StkJustifyModal stays={justif} onClose={() => setJustif(null)} onDone={() => { setJustif(null); load(); reloadDash(); }} />}
  </>;
}

// ---------------- Entrées et sorties (tous parcs) ----------------
function StkMovements() {
  const C = React.useContext(StkCtx);
  const { cfg, dash, openVehicle, go } = C;
  const [kind, setKind] = useState("entrees");
  const [parc, setParc] = useState("");
  const [from, setFrom] = useState(stkAddDays(stkToday(), -7));
  const [to, setTo] = useState(stkToday());
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const load = async () => {
    setRows(null); setErr("");
    try { setRows(await stkCall("movements", { kind, from, to, parc_id: parc || null })); } catch (e) { setErr(stkErrText(e)); setRows([]); }
  };
  useEffect(() => { load(); }, [kind]);
  const filtered = stkFilterRows(rows || [], q);
  const exp = (k) => {
    const base = [{ h: "Châssis", k: "chassis", w: 22 }, { h: "Marque", k: "marque" }, { h: "Modèle", k: "modele" }, { h: "Année", k: "annee", w: 7 }, { h: "Navire", k: "navire", w: 20 }, { h: "Parc", k: "parc" }, { h: "Date d'arrivée", x: (r) => stkFmt(r.date_arrivee) }];
    const extra = kind === "entrees" ? [{ h: "Entrée au parc", x: (r) => stkFmt(r.entry_date) }, { h: "Origine", x: (r) => stkEntryLabel(r) + (r.from_parc ? " depuis " + r.from_parc : "") }] : [{ h: "Date de sortie", x: (r) => stkFmt(r.exit_date) }, { h: "Type", x: (r) => (stkExitLabel(r) || "") + (r.to_parc ? " vers " + r.to_parc : "") }, { h: "Justification", x: (r) => STK_JUSTIF[r.justif_status].label }, { h: "N° déclaration", k: "justif_numero" }];
    const title = kind === "entrees" ? "Entrées de véhicules" : "Sorties de véhicules";
    const meta = [`Période du ${stkFmt(from)} au ${stkFmt(to)}`, parc ? `Parc : ${(dash.find((d) => d.parc_id === Number(parc)) || {}).parc}` : "Tous les parcs"];
    k === "x" ? stkExportXlsx(`${title}_${from}_${to}`, title, meta, base.concat(extra), filtered) : stkPrintPdf(title, meta, base.concat(extra), filtered);
  };
  return <>
    <StkPageHead title="Entrées et sorties" sub="Mouvements constatés en comparant chaque import au précédent du même parc, et mouvements saisis à la main (mention « saisie »)." right={stkCanEdit(C) ? <StkBtn small onClick={() => go("saisie")}><StkIc.Edit size={14} /> Saisir une entrée ou une sortie</StkBtn> : null} />
    <StkTabs tabs={[{ key: "entrees", label: "Entrées" }, { key: "sorties", label: "Sorties" }]} value={kind} onChange={setKind} />
    <StkCard className="p-4 md:p-5">
      <div className="flex flex-wrap gap-3 items-end mb-3">
        <StkField label="Parc"><select value={parc} onChange={(e) => setParc(e.target.value)} className={stkInput}><option value="">Tous les parcs</option>{dash.map((d) => <option key={d.parc_id} value={d.parc_id}>{d.parc}</option>)}</select></StkField>
        <StkField label="Du"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={stkInput} /></StkField>
        <StkField label="Au"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={stkInput} /></StkField>
        <StkBtn kind="primary" onClick={load}>Afficher</StkBtn>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer" className={`${stkInput} flex-1 min-w-[160px]`} />
        <StkExportBar disabled={!filtered.length} onXlsx={() => exp("x")} onPdf={() => exp("p")} />
      </div>
      {err && <StkMsg tone="err">{err}</StkMsg>}
      {!rows ? <StkLoading /> : <StkTable columns={stkCols(cfg, stkToday(), { parc: true, entree: kind === "entrees", sortie: kind === "sorties", justif: kind === "sorties", noSit: kind === "sorties" })} rows={filtered} onRow={(r) => openVehicle({ id: r.vehicle_id })} empty="Aucun mouvement sur la période." />}
    </StkCard>
  </>;
}

// ---------------- Historique des imports ----------------
function StkImportsList({ parcId }) {
  const { isAdmin, reloadDash, toast } = React.useContext(StkCtx);
  const [rows, setRows] = useState(null);
  const [detail, setDetail] = useState(null);
  const [err, setErr] = useState("");
  const load = async () => { try { setRows(await stkCall("imports", { parc_id: parcId || null })); } catch (e) { setErr(stkErrText(e)); setRows([]); } };
  useEffect(() => { load(); }, [parcId]);
  const cols = [
    { key: "stock_date", label: "Stock du", render: (r) => <b>{stkFmt(r.stock_date)}</b> },
    ...(parcId ? [] : [{ key: "parc", label: "Parc", sort: (r) => r.parcs && r.parcs.name, render: (r) => <span className="font-semibold">{r.parcs && r.parcs.name}</span> }]),
    { key: "file_name", label: "Fichier", render: (r) => <span className="text-slate-600 break-all">{r.file_name}</span> },
    { key: "nb_chassis", label: "Châssis", render: (r) => <span className="font-plex-mono">{r.nb_chassis}</span> },
    { key: "nb_entrees", label: "Entrées", render: (r) => r.is_initial ? <span className="text-slate-400 text-xs">stock initial</span> : <span className="text-emerald-700 font-bold">+{r.nb_entrees}</span> },
    { key: "nb_sorties", label: "Sorties", render: (r) => r.is_initial ? "" : <span className="text-rose-700 font-bold">−{r.nb_sorties}{r.nb_transferts ? <span className="text-sky-700"> (+{r.nb_transferts} transf.)</span> : ""}</span> },
    { key: "anom", label: "Alertes", sort: (r) => (r.anomalies || []).length, render: (r) => (r.anomalies || []).length ? <StkBadge tone="bg-amber-50 text-amber-900 border-amber-300">{(r.anomalies || []).length}</StkBadge> : "" },
    { key: "created_by_name", label: "Importé par", render: (r) => <span className="text-xs text-slate-500">{r.created_by_name}<br />{stkFmtTs(r.created_at)}</span> },
    { key: "status", label: "État", render: (r) => r.status === "annule" ? <StkBadge tone="bg-rose-50 text-rose-700 border-rose-200">Annulé</StkBadge> : <StkBadge tone="bg-emerald-50 text-emerald-800 border-emerald-200">Validé</StkBadge> }
  ];
  if (err) return <StkMsg tone="err">{err}</StkMsg>;
  return <StkCard className="p-4 md:p-5">
    {!rows ? <StkLoading /> : <StkTable columns={cols} rows={rows} rowKey={(r) => r.id} onRow={(r) => setDetail(r)} empty="Aucun import." />}
    {detail && <StkImportDetail imp={detail} onClose={() => setDetail(null)} onChanged={() => { setDetail(null); load(); reloadDash(); toast("Historique du parc recalculé"); }} />}
  </StkCard>;
}
function StkImportsScreen() {
  return <><StkPageHead title="Historique des imports" sub="Chaque fichier importé : date du stock, fichier, nombre de châssis, entrées, sorties, alertes et auteur." /><StkImportsList /></>;
}
function StkImportDetail({ imp, onClose, onChanged }) {
  const { cfg, isAdmin, openVehicle } = React.useContext(StkCtx);
  const [d, setD] = useState(null);
  const [tab, setTab] = useState("entrees");
  const [comment, setComment] = useState(imp.comment || "");
  useEffect(() => { stkCall("import_detail", { id: imp.id }).then(setD).catch((e) => alert(stkErrText(e))); }, []);
  const cancel = async () => {
    const reason = window.prompt("Motif de l'annulation (obligatoire) : cet import sera retiré et l'historique du parc recalculé. Il pourra être réactivé.");
    if (!reason) return;
    try { await stkCall("cancel_import", { id: imp.id, reason }); onChanged(); } catch (e) { alert(stkErrText(e)); }
  };
  const restore = async () => { if (!window.confirm("Réactiver cet import ? L'historique du parc sera recalculé.")) return; try { await stkCall("restore_import", { id: imp.id }); onChanged(); } catch (e) { alert(stkErrText(e)); } };
  const saveComment = async () => { try { await stkCall("import_update", { id: imp.id, comment }); alert("Commentaire enregistré."); } catch (e) { alert(stkErrText(e)); } };
  const rows = d ? (tab === "entrees" ? d.entrees : d.sorties) : [];
  const exp = (k) => {
    const title = `${tab === "entrees" ? (imp.is_initial ? "Stock initial" : "Entrées") : "Sorties"} — import du ${stkFmt(imp.stock_date)}`;
    const meta = [`Parc : ${imp.parcs && imp.parcs.name}`, `Fichier : ${imp.file_name || ""}`];
    const cols = stkExportCols(cfg, imp.stock_date);
    k === "x" ? stkExportXlsx(`Import_${imp.parcs && imp.parcs.name}_${imp.stock_date}_${tab}`, title, meta, cols, rows) : stkPrintPdf(title, meta, cols.filter((c) => !["Manifeste / ATP", "N° BL", "Jours restants"].includes(c.h)), rows);
  };
  return <StkModal wide title={`Import du ${stkFmt(imp.stock_date)} · ${imp.parcs && imp.parcs.name}`} onClose={onClose} footer={<>{isAdmin && imp.status === "valide" && <StkBtn small kind="danger" onClick={cancel}><RotateCcw size={14} /> Annuler cet import</StkBtn>}{isAdmin && imp.status === "annule" && <StkBtn small onClick={restore}><RotateCcw size={14} /> Réactiver cet import</StkBtn>}<StkBtn small kind="primary" onClick={onClose}>Fermer</StkBtn></>}>
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
        {[["Fichier", imp.file_name], ["Onglets", (imp.sheets || []).join(", ")], ["Châssis lus", imp.nb_chassis], ["Importé par", `${imp.created_by_name || ""} le ${stkFmtTs(imp.created_at)}`], ["Entrées", imp.is_initial ? "Stock initial" : imp.nb_entrees], ["Sorties", imp.nb_sorties], ["Transferts sortants", imp.nb_transferts], ["État", imp.status === "annule" ? `Annulé par ${imp.cancelled_by} : ${imp.cancel_reason}` : "Validé"]].map(([l, v]) => <div key={l} className="bg-white rounded-xl border border-slate-200 px-3 py-2"><div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">{l}</div><div className="font-semibold text-[#0B1F38] break-words">{String(v == null ? "" : v)}</div></div>)}
      </div>
      {imp.declared && Object.keys(imp.declared).length > 0 && <StkMsg tone="info">Chiffres annoncés par le parc : {Object.entries(imp.declared).map(([k, v]) => `${k} ${v}`).join(" · ")}</StkMsg>}
      {(imp.anomalies || []).map((a, i) => <StkMsg key={i} tone={a.decision ? "info" : a.niveau === "erreur" ? "err" : a.niveau === "info" ? "info" : "warn"}>{a.texte}{a.decision ? <span className="block text-xs font-semibold mt-1">✓ {a.decision}</span> : null}</StkMsg>)}
      {isAdmin && <div className="flex gap-2"><input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Commentaire sur cet import" className={`${stkInput} flex-1`} /><StkBtn small onClick={saveComment}>Enregistrer</StkBtn></div>}
      <div className="flex items-center gap-2"><StkTabs tabs={[{ key: "entrees", label: imp.is_initial ? "Stock initial" : "Entrées", count: d ? d.entrees.length : null }, { key: "sorties", label: "Sorties", count: d ? d.sorties.length : null }]} value={tab} onChange={setTab} /><div className="flex-1" /><StkExportBar disabled={!rows.length} onXlsx={() => exp("x")} onPdf={() => exp("p")} /></div>
      {!d ? <StkLoading /> : <StkTable columns={stkCols(cfg, imp.stock_date, { entree: tab === "entrees", sortie: tab === "sorties", justif: tab === "sorties", noSit: tab === "sorties" })} rows={rows} onRow={(r) => openVehicle({ id: r.vehicle_id })} empty="Aucun véhicule." />}
    </div>
  </StkModal>;
}
