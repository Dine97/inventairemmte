// ============================================================
// 6.16 — Recherche technique : par pays de fabrication, énergie, cylindrée, puissance… d'après le numéro de châssis.
// Écran à part : la Recherche avancée ne change pas. Les caractéristiques sont gardées à part du stock (information seulement).
// ============================================================
const STK_ENERGIE = { essence: "Essence", diesel: "Diesel", hybride: "Hybride", electrique: "Électrique", gaz: "Gaz", autre: "Autre" };
const STK_TECH_EMPTY = { pays: [], marques: [], modeles: [], modele: "", annee_min: "", annee_max: "", types: [], carrosseries: [], energies: [], moteurs: [], cyl_min: "", cyl_max: "", cylindres: [], hp_min: "", hp_max: "", transmissions: [], parc_id: "", statut: "present", situation: "", ecart: "" };
// Lance le décodage des nouveaux châssis en arrière-plan (après un import)
function stkSpecsKick() { try { stkCall("specs_enrich", { max: 200 }, false, 120e3).catch(() => {}); } catch (e) {} }

function StkMultiSelect({ label, options, value, onChange, fmt, testid, empty }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef(null);
  useEffect(() => { const f = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }; document.addEventListener("mousedown", f); return () => document.removeEventListener("mousedown", f); }, []);
  const F = fmt || ((x) => x);
  const txt = !value.length ? "Tous" : value.length <= 2 ? value.map(F).join(", ") : `${value.length} choisis`;
  return <div className="relative" ref={ref}>
    <StkField label={label}><button type="button" onClick={() => setOpen(!open)} className={`${stkInput} text-left truncate`} data-testid={testid}>{txt} <span className="float-right text-slate-400">▾</span></button></StkField>
    {open && <div className="absolute z-30 mt-1 w-full min-w-[220px] max-h-72 overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg p-1">
      {options.length > 12 && <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher..." className={`${stkInput} mb-1`} data-testid={testid ? testid + "-q" : undefined} />}
      {value.length > 0 && <button type="button" className="w-full text-left px-3 py-1.5 text-xs font-bold text-[#1B4F8C]" onClick={() => onChange([])}>Tout effacer</button>}
      {!options.length && <div className="px-3 py-2 text-sm text-slate-400">{empty || "Aucune valeur"}</div>}
      {options.filter((o) => !q || stkNormMarque(F(o.v)).includes(stkNormMarque(q))).map((o) => <label key={o.v} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[#F4F8FC] rounded-lg cursor-pointer">
        <input type="checkbox" checked={value.includes(o.v)} onChange={(e) => onChange(e.target.checked ? [...value, o.v] : value.filter((x) => x !== o.v))} />
        <span className="flex-1">{F(o.v)}</span><span className="text-xs text-slate-400 font-plex-mono">{o.n}</span>
      </label>)}
    </div>}
  </div>;
}
function StkChips({ label, options, value, onChange, testid }) {
  return <StkField label={label}><div className="flex flex-wrap gap-1.5" data-testid={testid}>{options.map(([k, l]) => <button type="button" key={k} onClick={() => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k])}
    className={`px-3 py-1.5 rounded-full text-[13px] font-bold border-2 ${value.includes(k) ? "bg-[#123A66] text-white border-[#123A66]" : "bg-white text-slate-600 border-slate-200"}`}>{l}</button>)}</div></StkField>;
}
function StkBars({ title, data }) {
  if (!data.length) return null;
  const max = Math.max(...data.map((d) => d[1]));
  return <div><div className="text-[11px] font-extrabold uppercase tracking-wider text-[#1B4F8C] mb-1.5">{title}</div>
    {data.slice(0, 6).map(([k, n]) => <div key={k} className="flex items-center gap-2 text-[13px] my-1"><span className="w-32 truncate text-slate-700">{k}</span><span className="h-2.5 rounded-full bg-[#1B4F8C]" style={{ width: `${Math.max(4, (n / max) * 220)}px` }} /><span className="font-plex-mono text-slate-500 text-xs">{n}</span></div>)}
  </div>;
}
function stkTechMarqueInc(r) {
  if (!r.make || !r.marque) return false;
  const decl = stkNormMarque(r.marque), m = stkNormMarque(r.make);
  if (decl.length < 2) return false;
  const fam = STK_MARQUE_FAM[r.make.charAt(0) + r.make.slice(1).toLowerCase()] || [m];
  return !(fam.some((f) => decl.includes(f) || (decl.length >= 3 && f.startsWith(decl))) || decl.includes(m) || m.includes(decl));
}
function stkTechAnneeInc(r) { const y = r.annee ? String(r.annee).match(/\d{4}/) : null; return !!(y && r.model_year && Math.abs(+y[0] - r.model_year) > 1); }
const stkMoteurFmt = (v) => String(Number(v).toFixed(1)).replace(".", ",") + " L";
const stkTechVeh = (r) => [stkTitle(r.make), r.model, r.model_year].filter(Boolean).join(" ");
const stkTechMoteur = (r) => [STK_ENERGIE[r.energie] || "", r.displacement_l ? String(r.displacement_l).replace(".", ",") + " L" : "", r.cylinders ? r.cylinders + " cyl." : ""].filter(Boolean).join(" · ");

function StkTechSearch() {
  const C = React.useContext(StkCtx);
  const { cfg, dash, openVehicle, go } = C;
  const [ov, setOv] = useState(null);
  const [f, setF] = useState(STK_TECH_EMPTY);
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [enr, setEnr] = useState(null); // avancement du décodage
  const today = stkToday();
  const loadOv = () => stkCall("specs_overview").then(setOv).catch((e) => setErr(stkErrText(e)));
  // Décodage des châssis encore en attente (première fois, ou après des imports), lot par lot
  const enrich = async () => {
    if (!stkCanEdit(C)) return;
    setEnr({ done: 0 });
    let total = 0;
    try {
      for (let i = 0; i < 60; i++) {
        const r = await stkCall("specs_enrich", { max: 200 }, false, 150e3);
        total += r.done; setEnr({ done: total, remaining: r.remaining });
        if (!r.remaining || (!r.done && !r.failed)) break;
        if (r.failed && !r.done) break;
      }
    } catch (e) { setErr("Décodage interrompu : " + stkErrText(e)); }
    setEnr(null); loadOv();
  };
  useEffect(() => { loadOv().then(() => {}); }, []);
  useEffect(() => { if (ov && ov.total > ov.ok + ov.inconnu + ov.non_decodable && !enr) enrich(); }, [ov && ov.total]);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v && v.target ? v.target.value : v }));
  // Modèles proposés : ceux des marques choisies (tous si aucune marque), d'après le châssis
  const modOpts = (((ov || {}).modeles) || []).filter((x) => !f.marques.length || f.marques.includes(x.m)).map((x) => ({ v: x.m + "|" + x.v, n: x.n }));
  const modFmt = (v) => { const [m, mo] = String(v).split("|"); return f.marques.length === 1 ? mo : `${mo} (${stkTitle(m)})`; };
  const setMarques = (v) => setF((x) => ({ ...x, marques: v, modeles: (x.modeles || []).filter((k) => !v.length || v.includes(String(k).split("|")[0])) }));
  const run = async (over) => {
    const p = { ...f, ...(over || {}) };
    setBusy(true); setErr("");
    try {
      const params = { ...p };
      if (p.situation === "depot") params.depot_to = stkAddDays(today, -cfg.duree);
      if (p.situation === "bientot") { params.depot_from = stkAddDays(today, -cfg.duree + 1); params.depot_to = stkAddDays(today, -cfg.duree + cfg.seuil); }
      if (p.situation === "disponible") params.depot_from = stkAddDays(today, -cfg.duree + cfg.seuil + 1);
      if (p.situation) params.statut = "present";
      let r = await stkCall("specs_search", params, false, 90e3);
      r = r.map((x) => ({ ...x, parcName: x.parc, incMarque: stkTechMarqueInc(x), incAnnee: stkTechAnneeInc(x) }));
      const md = p.modeles || [];
      if (md.length) r = r.filter((x) => md.includes(x.make + "|" + x.model));
      const mo = (p.moteurs || []).map((x) => Number(x).toFixed(1));
      if (mo.length) r = r.filter((x) => x.displacement_l != null && mo.includes(Number(x.displacement_l).toFixed(1)));
      if (p.ecart === "marque") r = r.filter((x) => x.incMarque);
      if (p.ecart === "annee") r = r.filter((x) => x.incAnnee);
      if (p.ecart === "tout") r = r.filter((x) => x.incMarque || x.incAnnee);
      setRows(r);
    } catch (e) { setErr(stkErrText(e)); }
    setBusy(false);
  };
  const applySaved = (params) => { const n = { ...STK_TECH_EMPTY, ...params }; delete n._tech; setF(n); run(n); };
  const O = ov || {};
  const decoded = O.ok || 0, waiting = Math.max(0, (O.total || 0) - (O.ok || 0) - (O.inconnu || 0) - (O.non_decodable || 0));
  const stats = useMemo(() => {
    if (!rows || !rows.length) return null;
    const cnt = (fn) => { const m = {}; rows.forEach((r) => { const k = fn(r); if (k) m[k] = (m[k] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
    const hp = rows.filter((r) => r.hp); const yr = rows.filter((r) => r.model_year);
    return { energies: cnt((r) => STK_ENERGIE[r.energie]), moteurs: cnt((r) => r.displacement_l ? stkMoteurFmt(r.displacement_l) : null), pays: cnt((r) => stkPaysNom(r.plant_country)), marques: cnt((r) => stkTitle(r.make)),
      hp: hp.length ? Math.round(hp.reduce((a, r) => a + Number(r.hp), 0) / hp.length) : null, yr: yr.length ? Math.round(yr.reduce((a, r) => a + r.model_year, 0) / yr.length) : null,
      inc: rows.filter((r) => r.incMarque || r.incAnnee).length };
  }, [rows]);
  const exp = (k) => {
    const cols = [{ h: "Châssis", k: "chassis", w: 22 }, { h: "Marque (châssis)", x: (r) => stkTitle(r.make) }, { h: "Modèle (châssis)", k: "model" }, { h: "Année-modèle", k: "model_year", w: 8 },
      { h: "Type", x: (r) => stkFr(r.vehicle_type) }, { h: "Carrosserie", x: (r) => stkFr(r.body_class) }, { h: "Énergie", x: (r) => STK_ENERGIE[r.energie] || "" }, { h: "Cylindrée (L)", x: (r) => r.displacement_l || "" , w: 9 },
      { h: "Cylindres", k: "cylinders", w: 8 }, { h: "Puissance (ch)", x: (r) => r.hp ? Math.round(r.hp) : "", w: 9 }, { h: "Transmission", x: (r) => STK_NH.drive(r.drive) }, { h: "Pays de fabrication", x: (r) => stkPaysNom(r.plant_country) },
      { h: "Déclaré par le parc", x: (r) => [r.marque, r.modele].filter(Boolean).join(" "), w: 22 }, { h: "Année déclarée", k: "annee", w: 8 }, { h: "Écart", x: (r) => [r.incMarque ? "marque" : "", r.incAnnee ? "année" : ""].filter(Boolean).join(", ") },
      { h: "Parc", x: (r) => r.parcName || "Sorti" }, { h: "Date de dépôt", x: (r) => stkFmt(stkSit(r, today, cfg).depot) }];
    const meta = [`Recherche technique — d'après le numéro de châssis (base NHTSA)`, `Édité le ${stkFmt(today)} — ${rows.length} véhicule(s)`];
    if (k === "x") stkExportXlsx(`Recherche_technique_${today}`, "Recherche technique", meta, cols, rows);
    else stkPrintPdf("Recherche technique", meta, cols.filter((c) => !["Type", "Transmission", "Année déclarée", "Cylindres"].includes(c.h)), rows);
  };
  const cylOpts = [["3", "3"], ["4", "4"], ["5", "5"], ["6", "6"], ["8", "8 et +"]];
  const Rng = ({ k1, k2, label, step }) => <StkField label={label}><div className="flex items-center gap-1.5"><input type="number" step={step || "1"} value={f[k1]} onChange={set(k1)} placeholder="min" className={`${stkInput} min-w-0`} data-testid={"t-" + k1} /><span className="text-slate-500">à</span><input type="number" step={step || "1"} value={f[k2]} onChange={set(k2)} placeholder="max" className={`${stkInput} min-w-0`} data-testid={"t-" + k2} /></div></StkField>;
  const Sep = ({ children }) => <div className="text-[11px] font-extrabold uppercase tracking-wider text-[#1B4F8C] mt-2">{children}</div>;
  return <>
    <StkPageHead title="Recherche technique" sub="D'après le numéro de châssis (base mondiale des VIN). Écran à part : la Recherche avancée ne change pas." right={<StkBtn onClick={() => go("search")}>← Recherche avancée</StkBtn>} />
    <div className="rounded-xl border border-dashed border-[#9DB9DA] bg-[#F7FAFE] px-4 py-2.5 text-sm text-slate-600" data-testid="tech-couverture">
      {!ov ? "Chargement..." : <>Couverture : <b className="text-[#0B1F38]">{decoded.toLocaleString("fr-FR")} véhicule(s) décodé(s) sur {(O.total || 0).toLocaleString("fr-FR")}</b>{O.total ? ` (${Math.round((decoded / O.total) * 100)} %)` : ""}
        {O.non_decodable > 0 && ` · ${O.non_decodable} non décodable(s) (châssis de moins de 17 caractères)`}{O.inconnu > 0 && ` · ${O.inconnu} inconnu(s) de la base`}
        {enr ? <b className="text-[#1B4F8C]"> · décodage en cours : {enr.done} fait(s){enr.remaining != null ? `, ${enr.remaining} restant(s)` : ""}…</b> : waiting > 0 ? ` · ${waiting} en attente (décodés automatiquement)` : " · mise à jour automatique après chaque import"}</>}
    </div>
    <StkCard className="p-4 md:p-5">
      <form onSubmit={(e) => { e.preventDefault(); run(); }} className="space-y-3">
        <Sep>Caractéristiques du véhicule</Sep>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StkMultiSelect label="Pays de fabrication" options={O.pays || []} value={f.pays} onChange={set("pays")} fmt={stkPaysNom} testid="t-pays" />
          <StkMultiSelect label="Marque (d'après le châssis)" options={O.marques || []} value={f.marques} onChange={setMarques} fmt={stkTitle} testid="t-marques" />
          <StkMultiSelect label="Modèle" options={modOpts} value={f.modeles || []} onChange={set("modeles")} fmt={modFmt} testid="t-modeles" />
          <Rng k1="annee_min" k2="annee_max" label="Année-modèle" />
          <StkMultiSelect label="Type" options={O.types || []} value={f.types} onChange={set("types")} fmt={stkFr} />
          <StkMultiSelect label="Carrosserie" options={O.carrosseries || []} value={f.carrosseries} onChange={set("carrosseries")} fmt={stkFr} />
        </div>
        <Sep>Moteur</Sep>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="col-span-2"><StkChips label="Énergie" options={Object.entries(STK_ENERGIE).filter(([k]) => k !== "autre")} value={f.energies} onChange={set("energies")} testid="t-energies" /></div>
          <StkMultiSelect label="Moteur (cylindrée)" options={O.moteurs || []} value={f.moteurs} onChange={set("moteurs")} fmt={stkMoteurFmt} testid="t-moteurs" />
          <StkChips label="Cylindres" options={cylOpts} value={f.cylindres} onChange={set("cylindres")} testid="t-cylindres" />
          <Rng k1="hp_min" k2="hp_max" label="Puissance (ch)" />
          <StkMultiSelect label="Transmission" options={O.transmissions || []} value={f.transmissions} onChange={set("transmissions")} fmt={STK_NH.drive} />
        </div>
        <Sep>Situation dans le stock</Sep>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 items-end">
          <StkField label="Parc"><select value={f.parc_id} onChange={set("parc_id")} className={stkInput}><option value="">Tous les parcs</option>{dash.map((d) => <option key={d.parc_id} value={d.parc_id}>{d.parc}</option>)}</select></StkField>
          <StkField label="Statut"><select value={f.statut} onChange={set("statut")} className={stkInput}><option value="present">Présents en parc</option><option value="sorti">Sortis</option><option value="">Présents et sortis</option></select></StkField>
          <StkField label="Séjour"><select value={f.situation} onChange={set("situation")} className={stkInput}><option value="">Toutes situations</option><option value="disponible">En délai légal</option><option value="bientot">Bientôt en dépôt</option><option value="depot">En dépôt</option></select></StkField>
          <StkField label="Écart avec le parc"><select value={f.ecart} onChange={set("ecart")} className={stkInput} data-testid="t-ecart"><option value="">Tous</option><option value="tout">Marque ou année à vérifier</option><option value="marque">Marque à vérifier</option><option value="annee">Année à vérifier</option></select></StkField>
          <div className="col-span-2 flex flex-wrap gap-2 justify-end">
            <StkBtn type="button" kind="ghost" onClick={() => { setF(STK_TECH_EMPTY); setRows(null); }}>Effacer</StkBtn>
            <StkBtn kind="primary" type="submit" disabled={busy} data-testid="t-run"><Search size={16} /> {busy ? "Recherche..." : "Rechercher"}</StkBtn>
          </div>
        </div>
      </form>
      <div className="pt-3 mt-3 border-t border-slate-100"><StkSavedFilters current={f} onApply={applySaved} tech /></div>
    </StkCard>
    {err && <StkMsg tone="err">{err}</StkMsg>}
    {rows && <StkCard className="p-4 md:p-5 space-y-4" data-testid="tech-results">
      <div className="flex items-center gap-2"><div className="font-bold text-[#0B1F38] text-lg flex-1">{rows.length.toLocaleString("fr-FR")} véhicule(s)</div><StkExportBar disabled={!rows.length} onXlsx={() => exp("x")} onPdf={() => exp("p")} /></div>
      {stats && <>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {stats.energies.slice(0, 2).map(([k, n]) => <StkKpi key={k} label={k} value={n} />)}
          <StkKpi label="Puissance moyenne" value={stats.hp ? `${stats.hp} ch` : "—"} />
          <StkKpi label="Année-modèle moyenne" value={stats.yr ? String(stats.yr) : "—"} />
          <StkKpi label="Écart à vérifier" value={stats.inc} tone={stats.inc ? "amber" : undefined} onClick={stats.inc ? () => { setF((x) => ({ ...x, ecart: "tout" })); run({ ecart: "tout" }); } : undefined} />
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4"><StkBars title="Par pays de fabrication" data={stats.pays} /><StkBars title="Par marque" data={stats.marques} /><StkBars title="Par moteur" data={stats.moteurs} /><StkBars title="Par énergie" data={stats.energies} /></div>
      </>}
      <StkTable rows={rows} rowKey={(r) => r.id} onRow={(r) => openVehicle({ id: r.id })} empty="Aucun véhicule ne correspond." columns={[
        { key: "chassis", label: "Châssis", render: (r) => <span className="font-plex-mono font-bold text-[#0B1F38] whitespace-nowrap">{r.chassis}</span> },
        { key: "veh", label: "Véhicule (châssis)", sort: stkTechVeh, render: (r) => stkTechVeh(r) || "—" },
        { key: "mot", label: "Énergie · moteur", sort: stkTechMoteur, render: (r) => stkTechMoteur(r) || "—" },
        { key: "hp", label: "Puissance", sort: (r) => r.hp || 0, render: (r) => r.hp ? `${Math.round(r.hp)} ch` : "—" },
        { key: "pays", label: "Fabriqué", sort: (r) => stkPaysNom(r.plant_country), render: (r) => stkPaysNom(r.plant_country) || "—" },
        { key: "decl", label: "Déclaré par le parc", sort: (r) => r.marque, render: (r) => <span>{[r.marque, r.modele].filter(Boolean).join(" ") || "—"}{r.annee ? <span className="text-slate-500"> · {r.annee}</span> : ""}{(r.incMarque || r.incAnnee) && <span className="ml-1.5"><StkBadge tone="bg-amber-50 text-amber-900 border-amber-300">{r.incMarque && r.incAnnee ? "marque et année à vérifier" : r.incMarque ? "marque à vérifier" : "année à vérifier"}</StkBadge></span>}</span> },
        { key: "parcName", label: "Parc", render: (r) => r.parcName ? <span className="font-semibold whitespace-nowrap">{r.parcName}</span> : <StkBadge tone={STK_SIT_TONE.sorti}>Sorti</StkBadge> },
        { key: "sit", label: "Situation", sort: (r) => stkSit(r, today, cfg).restant, render: (r) => r.parcName ? <StkSitBadge row={r} /> : "—" }
      ]} />
    </StkCard>}
  </>;
}
