// ============================================================
// STOCK MMTE v7 — recherche par liste, vue par manifeste, mise en service, encadré « À faire »
// ============================================================

// ---------- Recherche par liste de châssis ----------
function stkLookupSituation(r, cfg) {
  if (!r.trouve) return { code: "introuvable", label: "Introuvable", tone: "bg-slate-100 text-slate-600 border-slate-300" };
  if (r.parc) {
    const s = stkSit(r, stkToday(), cfg);
    return { code: s.code, label: `${r.parc} · ${s.code === "depot" ? "en dépôt" : s.code === "bientot" ? `dépôt dans ${s.restant} j` : s.code === "disponible" ? "disponible" : "sans date d'arrivée"}`, tone: STK_SIT_TONE[s.code], depot: s.depot };
  }
  if (r.sortie) return { code: "sorti", label: `Sorti de ${r.sortie.parc} le ${stkFmt(r.sortie.date)}${r.sortie.kind === "transfert" && r.sortie.to_parc ? " (transfert vers " + r.sortie.to_parc + ")" : ""}`, tone: STK_SIT_TONE.sorti };
  return { code: "inconnu", label: "Connu, sans séjour en parc", tone: "bg-slate-100 text-slate-600 border-slate-300" };
}
function StkListLookup() {
  const { cfg, openVehicle } = React.useContext(StkCtx);
  const [text, setText] = useState("");
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("tous");
  const run = async (list) => {
    const l = list || stkParsePastedChassis(text);
    if (!l.length) { setErr("Collez au moins un numéro de châssis (un par ligne)."); return; }
    setBusy(true); setErr(""); setRows(null);
    try { setRows(await stkCall("lookup", { chassis: l.slice(0, 5000) }, false, 90e3)); } catch (e) { setErr(stkErrText(e)); }
    setBusy(false);
  };
  const onFile = async (f) => {
    if (!f) return;
    try {
      const book = XLSX.read(await f.arrayBuffer(), { cellDates: true, type: "array" });
      const res = stkParseWorkbook(book, {});
      let list = res.rows.map((r) => r.chassis);
      if (!list.length) { // pas d'en-tête reconnu : toutes les cellules qui ressemblent à un châssis
        book.SheetNames.forEach((sn) => stkSheetRows(book.Sheets[sn]).forEach((r) => (r || []).forEach((c) => { const v = stkNormChassis(stkText(c)); if (v.length >= 6 && /\d/.test(v) && /[A-Z]/.test(v)) list.push(v); })));
      }
      list = Array.from(new Set(list));
      setText(list.join("\n"));
      run(list);
    } catch (e) { setErr("Fichier illisible : " + (e.message || e)); }
  };
  const enriched = (rows || []).map((r) => ({ ...r, sit: stkLookupSituation(r, cfg) }));
  const count = (f) => enriched.filter(f).length;
  const K = { tous: () => true, en_parc: (r) => !!r.parc, depot: (r) => r.sit.code === "depot", sortis: (r) => r.sit.code === "sorti", introuvables: (r) => !r.trouve };
  const shown = enriched.filter(K[filter]);
  const exportX = () => stkExportXlsx(`Recherche_liste_${stkToday()}`, "Situation d'une liste de châssis", [`Au ${stkFmt(stkToday())}`, `${enriched.length} châssis recherchés`], [
    { h: "Châssis saisi", k: "saisi", w: 22 }, { h: "Châssis en base", x: (r) => (r.trouve ? r.chassis : ""), w: 22 },
    { h: "Retrouvé par", x: (r) => (r.retrouve === "fin" ? "fin du numéro" : r.retrouve === "correction" ? "correction mémorisée" : "") },
    { h: "Situation", x: (r) => r.sit.label, w: 40 }, { h: "Parc actuel", k: "parc" }, { h: "Entrée au parc", x: (r) => stkFmt(r.entry_date) },
    { h: "Date de dépôt", x: (r) => stkFmt(r.sit.depot) }, { h: "Marque", k: "marque" }, { h: "Modèle", k: "modele" }, { h: "Navire", k: "navire" },
    { h: "Manifeste", k: "manifeste" }, { h: "BL", k: "bl" }, { h: "Arrivée", x: (r) => stkFmt(r.date_arrivee) },
    { h: "Dernière sortie", x: (r) => (r.sortie ? `${stkFmt(r.sortie.date)} — ${r.sortie.parc}` : "") }, { h: "Déclaration", x: (r) => (r.sortie && r.sortie.justif_numero) || "" },
    { h: "Suggestion", x: (r) => r.suggestion || "" }
  ], shown);
  return <>
    <StkPageHead title="Recherche par liste" sub="Collez une liste de châssis (par exemple une demande de la Douane) : l'outil donne pour chacun le parc, la situation, la date de dépôt et la dernière sortie. Les numéros incomplets (6 derniers caractères) sont acceptés." />
    <StkCard className="p-4 md:p-5 space-y-3">
      <div className="grid md:grid-cols-[1fr_260px] gap-3">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} placeholder={"Un châssis par ligne\nJTDBR32E720123456\nVF1RFB00X51234567\n…"} className={`${stkInput} font-plex-mono`} data-testid="lookup-text" />
        <label className="rounded-2xl border-2 border-dashed border-[#1B4F8C]/30 bg-[#F4F8FC] hover:bg-[#EAF1FA] p-4 text-center cursor-pointer flex flex-col items-center justify-center"
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files && e.dataTransfer.files[0]); }}>
          <input type="file" className="hidden" accept=".xlsx,.xls,.xlsm,.ods,.csv,.txt" onChange={(e) => { onFile(e.target.files && e.target.files[0]); e.target.value = ""; }} />
          <FileSpreadsheet size={26} className="text-[#1B4F8C]" />
          <div className="font-bold text-sm text-[#123A66] mt-2">Ou déposer un fichier Excel</div>
        </label>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <StkBtn kind="primary" disabled={busy} onClick={() => run()} data-testid="lookup-run"><Search size={16} /> {busy ? "Recherche..." : `Rechercher ${stkParsePastedChassis(text).length || ""} châssis`}</StkBtn>
        {rows && rows.length > 0 && <StkBtn onClick={exportX}><Download size={16} /> Excel</StkBtn>}
      </div>
      {err && <StkMsg tone="err">{err}</StkMsg>}
    </StkCard>
    {rows && <>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3" data-testid="lookup-kpis">
        <StkKpi label="Recherchés" value={enriched.length} onClick={() => setFilter("tous")} />
        <StkKpi label="En parc" value={count(K.en_parc)} tone="green" onClick={() => setFilter("en_parc")} />
        <StkKpi label="Dont en dépôt" value={count(K.depot)} tone="rose" onClick={() => setFilter("depot")} />
        <StkKpi label="Sortis" value={count(K.sortis)} tone="slate" onClick={() => setFilter("sortis")} />
        <StkKpi label="Introuvables" value={count(K.introuvables)} tone="amber" onClick={() => setFilter("introuvables")} />
      </div>
      <StkCard className="p-0 overflow-hidden">
        <div className="overflow-x-auto"><table className="w-full text-sm min-w-[880px]" data-testid="lookup-table">
          <thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 bg-slate-50 border-b border-slate-200">
            <th className="py-2 px-3">Châssis</th><th className="px-2">Véhicule</th><th className="px-2">Navire</th><th className="px-2">Situation</th><th className="px-2">Dépôt</th><th className="px-2">Dernière sortie</th></tr></thead>
          <tbody>{shown.map((r) => <tr key={r.saisi} className="border-b border-slate-100 align-top">
            <td className="py-2 px-3">{r.trouve ? <button className="font-plex-mono font-bold text-[#1B4F8C] underline" onClick={() => openVehicle({ id: r.vehicle_id })}>{r.chassis}</button> : <span className="font-plex-mono font-bold">{r.saisi}</span>}
              {r.retrouve && <div className="text-[11px] text-slate-500">saisi « {r.saisi} » — retrouvé par {r.retrouve === "fin" ? "la fin du numéro" : "une correction mémorisée"}</div>}
              {!r.trouve && r.suggestion && <div className="text-[11px] text-amber-800">Vouliez-vous dire <button className="font-plex-mono underline" onClick={() => openVehicle({ chassis: r.suggestion })}>{r.suggestion}</button> ?</div>}</td>
            <td className="px-2 py-2">{stkVeh(r) || "—"}</td>
            <td className="px-2 py-2 text-xs">{r.navire}{r.manifeste ? <span className="block text-slate-500">{r.manifeste}</span> : null}</td>
            <td className="px-2 py-2"><StkBadge tone={r.sit.tone}>{r.sit.label}</StkBadge></td>
            <td className="px-2 py-2 whitespace-nowrap">{stkFmt(r.sit.depot)}</td>
            <td className="px-2 py-2 text-xs">{r.sortie ? <>{stkFmt(r.sortie.date)} — {r.sortie.parc}{r.sortie.justif_numero ? <span className="block text-slate-500">Décl. {r.sortie.justif_numero}</span> : null}</> : "—"}</td>
          </tr>)}</tbody>
        </table></div>
        {!shown.length && <div className="p-6 text-center text-sm text-slate-500">Aucun châssis dans cette catégorie.</div>}
      </StkCard>
    </>}
  </>;
}

// ---------- Vue par manifeste (un navire peut revenir plusieurs fois, le manifeste est unique) ----------
function StkManifests() {
  const { cfg, openVehicle } = React.useContext(StkCtx);
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState(null);
  useEffect(() => { stkCall("manifests", {}).then(setRows).catch((e) => setErr(stkErrText(e))); }, []);
  const openM = async (m) => {
    setOpen(m); setDetail(null);
    try { setDetail(await stkCall("manifest_vehicles", { manifeste: m })); } catch (e) { setErr(stkErrText(e)); }
  };
  const Q = q.trim().toUpperCase();
  const list = (rows || []).filter((r) => !Q || r.manifeste.includes(Q) || (r.navires || []).some((n) => String(n).includes(Q)));
  const tot = list.reduce((a, r) => ({ v: a.v + +r.presents, d: a.d + +r.depot }), { v: 0, d: 0 });
  const arr = (r) => (r.arrivee_min === r.arrivee_max ? stkFmt(r.arrivee_min) : `${stkFmt(r.arrivee_min)} → ${stkFmt(r.arrivee_max)}`);
  const exportAll = () => stkExportXlsx(`Manifestes_${stkToday()}`, "Véhicules en parc par manifeste", [`Au ${stkFmt(stkToday())}`], [
    { h: "Manifeste", k: "manifeste", w: 18 }, { h: "Navire", x: (r) => (r.navires || []).join(", "), w: 26 }, { h: "En parc", k: "presents" }, { h: "BL", k: "nb_bl" },
    { h: "Parcs", x: (r) => (r.parcs || []).join(", "), w: 40 }, { h: "Arrivée", x: arr, w: 24 }, { h: "Premier dépôt", x: (r) => stkFmt(r.depot_min) },
    { h: "En dépôt", k: "depot" }, { h: `Dépôt < ${cfg.seuil} j`, k: "bientot" }, { h: "Sans date", k: "sans_date" }
  ], list);
  const exportDetail = () => detail && stkExportXlsx(`Manifeste_${open}_${stkToday()}`, `Manifeste ${open} — véhicules en parc`, [`Au ${stkFmt(stkToday())}`, `${detail.length} véhicule(s)`], [{ h: "Parc", k: "parc" }].concat(stkExportCols(cfg, stkToday())), detail);
  return <>
    <StkPageHead title="Vue par manifeste" sub="Véhicules encore présents dans les parcs, regroupés par manifeste (unique pour chaque escale, alors qu'un navire peut revenir plusieurs fois) : navire, parcs, arrivée et date de dépôt." right={rows && rows.length ? <StkBtn small onClick={exportAll}><Download size={14} /> Excel</StkBtn> : null} />
    <StkCard className="p-4 flex flex-wrap gap-3 items-center"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer : n° de manifeste ou navire" className={`${stkInput} max-w-sm`} data-testid="manifests-filter" /><div className="text-sm text-slate-600">{list.length} manifeste(s) · {tot.v.toLocaleString("fr-FR")} véhicule(s) en parc · {tot.d.toLocaleString("fr-FR")} en dépôt</div></StkCard>
    {err && <StkMsg tone="err">{err}</StkMsg>}
    {!rows ? <StkLoading /> : <StkCard className="p-0 overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm min-w-[880px]" data-testid="manifests-table">
      <thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 bg-slate-50 border-b border-slate-200"><th className="py-2 px-3">Manifeste</th><th className="px-2">Navire</th><th className="px-2 text-right">En parc</th><th className="px-2">Parcs</th><th className="px-2">Arrivée</th><th className="px-2">Premier dépôt</th><th className="px-2 text-right">En dépôt</th><th className="px-2 text-right">&lt; {cfg.seuil} j</th></tr></thead>
      <tbody>{list.slice(0, 1000).map((r) => <tr key={r.manifeste} className="border-b border-slate-100 hover:bg-[#F4F8FC] cursor-pointer" onClick={() => openM(r.manifeste)}>
        <td className="py-2 px-3 font-plex-mono font-bold text-[#1B4F8C]">{r.manifeste}<div className="text-[11px] font-sans font-normal text-slate-500">{r.nb_bl} BL</div></td>
        <td className="px-2 text-xs">{(r.navires || []).join(", ") || "—"}</td>
        <td className="px-2 text-right font-plex-mono font-bold">{r.presents}</td>
        <td className="px-2 text-xs">{(r.parcs || []).join(", ")}{r.nb_parcs > 12 ? "…" : ""}</td>
        <td className="px-2 text-xs whitespace-nowrap">{arr(r)}</td>
        <td className="px-2 text-xs whitespace-nowrap">{stkFmt(r.depot_min)}</td>
        <td className={`px-2 text-right font-plex-mono ${+r.depot ? "text-rose-700 font-bold" : "text-slate-400"}`}>{r.depot}</td>
        <td className={`px-2 text-right font-plex-mono ${+r.bientot ? "text-amber-700 font-bold" : "text-slate-400"}`}>{r.bientot}</td>
      </tr>)}</tbody></table></div></StkCard>}
    {open && <StkModal wide title={`Manifeste ${open}`} onClose={() => setOpen(null)} footer={detail && detail.length ? <StkBtn onClick={exportDetail}><Download size={16} /> Excel</StkBtn> : null}>
      {!detail ? <StkLoading /> : <StkTable rowKey={(r) => r.stay_id} rows={detail} onRow={(r) => openVehicle({ id: r.vehicle_id })} columns={[
        { key: "chassis", label: "Châssis", render: (r) => <span className="font-plex-mono font-bold">{r.chassis}</span> },
        { key: "veh", label: "Véhicule", render: (r) => stkVeh(r) },
        { key: "parc", label: "Parc" },
        { key: "navire", label: "Navire" },
        { key: "bl", label: "BL" },
        { key: "date_arrivee", label: "Arrivée", render: (r) => stkFmt(r.date_arrivee) },
        { key: "sit", label: "Situation", render: (r) => <StkSitBadge row={r} /> }
      ]} />}
    </StkModal>}
  </>;
}

// ---------- Mise en service (administrateur) ----------
function StkRollout() {
  const { dash, openParc, go } = React.useContext(StkCtx);
  const [d, setD] = useState(null);
  const [accounts, setAccounts] = useState(null);
  const [err, setErr] = useState("");
  const [onlyTodo, setOnlyTodo] = useState(false);
  useEffect(() => {
    stkCall("rollout", {}).then(setD).catch((e) => setErr(stkErrText(e)));
    try { db.collection("users").get().then((snap) => setAccounts(snap.docs.map((x) => ({ uid: x.id, ...x.data() })))).catch(() => setAccounts([])); } catch (e) { setAccounts([]); }
  }, []);
  if (err) return <><StkPageHead title="Mise en service" /><StkMsg tone="err">{err}</StkMsg></>;
  if (!d) return <><StkPageHead title="Mise en service" /><StkLoading /></>;
  const monday = stkMonday(stkToday());
  const byParc = {}; d.parcs.forEach((p) => (byParc[p.parc_id] = p));
  const parcs = dash.filter((x) => x.active !== false).map((x) => { const p = byParc[x.parc_id] || {}; const etat = !p.n ? "jamais" : p.last >= monday ? "a_jour" : "retard"; return { ...x, first: p.first, last: p.last, n: p.n || 0, etat }; });
  const ETAT = { jamais: ["Jamais importé", "bg-rose-50 text-rose-800 border-rose-200"], retard: ["Fichier de la semaine attendu", "bg-amber-50 text-amber-900 border-amber-300"], a_jour: ["À jour", "bg-emerald-50 text-emerald-800 border-emerald-200"] };
  const nb = (e) => parcs.filter((x) => x.etat === e).length;
  const su = {}; (d.users || []).forEach((u) => (su[u.uid] = u));
  const people = (accounts && accounts.length ? accounts.filter((a) => a.status === "approved" || su[a.uid]) : (d.users || []).map((u) => ({ uid: u.uid, displayName: u.name, email: u.email })))
    .map((a) => ({ uid: a.uid, name: a.displayName || a.name || a.fullName || (su[a.uid] && su[a.uid].name) || a.email, email: a.email || (su[a.uid] && su[a.uid].email), access: su[a.uid] ? su[a.uid].access : "(par défaut)", last: su[a.uid] && su[a.uid].last_seen }))
    .sort((a, b) => String(b.last || "").localeCompare(String(a.last || "")));
  const connected = people.filter((p) => p.last).length;
  const week = people.filter((p) => p.last && Date.now() - new Date(p.last).getTime() < 7 * 864e5).length;
  const todo = parcs.filter((x) => x.etat !== "a_jour");
  const copy = async () => { const t = "Parcs sans fichier de stock pour la semaine du " + stkFmt(monday) + " :\n" + todo.map((x) => `- ${x.parc}${x.last ? " (dernier fichier : " + stkFmt(x.last) + ")" : " (jamais reçu)"}`).join("\n"); try { await navigator.clipboard.writeText(t); alert("Liste copiée."); } catch (e) { window.prompt("Copiez la liste :", t); } };
  return <>
    <StkPageHead title="Mise en service" sub="Avancement du déploiement du suivi des stocks : parcs importés et agents connectés." right={<StkBtn small kind="primary" onClick={() => go("bulk")}><StkIc.Layers size={14} /> Import groupé</StkBtn>} />
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="rollout-kpis">
      <StkKpi label="Parcs importés" value={parcs.length - nb("jamais")} sub={`sur ${parcs.length} parcs actifs`} tone="navy" />
      <StkKpi label="À jour cette semaine" value={nb("a_jour")} tone="green" sub={`depuis le lundi ${stkFmt(monday)}`} />
      <StkKpi label="Agents déjà connectés" value={connected} sub={`sur ${people.length} compte(s)`} />
      <StkKpi label="Connectés cette semaine" value={week} tone="slate" />
    </div>
    <div className="grid gap-5">
      <StkCard className="p-4 md:p-5 space-y-3 min-w-0">
        <div className="flex flex-wrap items-center gap-2"><div className="flex-1 font-bold text-[#0B1F38]">Parcs</div>
          <label className="text-sm flex items-center gap-1.5"><input type="checkbox" checked={onlyTodo} onChange={(e) => setOnlyTodo(e.target.checked)} /> Seulement ceux à traiter ({todo.length})</label>
          {todo.length > 0 && <StkBtn small onClick={copy}>Copier la liste</StkBtn>}</div>
        <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden flex"><div className="bg-emerald-500" style={{ width: `${(nb("a_jour") / Math.max(parcs.length, 1)) * 100}%` }} /><div className="bg-amber-400" style={{ width: `${(nb("retard") / Math.max(parcs.length, 1)) * 100}%` }} /></div>
        <StkTable rowKey={(r) => r.parc_id} rows={onlyTodo ? todo : parcs} onRow={(r) => openParc(r.parc_id)} columns={[
          { key: "parc", label: "Parc", render: (r) => <b>{r.parc}</b> },
          { key: "etat", label: "État", render: (r) => <StkBadge tone={ETAT[r.etat][1]}>{ETAT[r.etat][0]}</StkBadge> },
          { key: "first", label: "Premier fichier", render: (r) => stkFmt(r.first) },
          { key: "last", label: "Dernier fichier", render: (r) => stkFmt(r.last) },
          { key: "n", label: "Imports", render: (r) => r.n || "" },
          { key: "presents", label: "Véhicules", render: (r) => (+r.presents ? (+r.presents).toLocaleString("fr-FR") : "") }
        ]} />
      </StkCard>
      <StkCard className="p-4 md:p-5 space-y-3 min-w-0 overflow-x-auto">
        <div className="font-bold text-[#0B1F38]">Agents</div>
        {accounts === null ? <StkLoading /> : <StkTable rowKey={(r) => r.uid} rows={people} columns={[
          { key: "name", label: "Agent", render: (r) => <div><b>{r.name}</b><div className="text-[11px] text-slate-500">{r.email}</div></div> },
          { key: "access", label: "Accès", render: (r) => <span className="text-xs">{r.access}</span> },
          { key: "last", label: "Dernière visite", render: (r) => r.last ? <span className="text-xs">{stkFmtTs(r.last)}</span> : <StkBadge tone="bg-amber-50 text-amber-900 border-amber-300">Jamais</StkBadge> }
        ]} />}
        <div className="text-xs text-slate-500">Les accès se règlent dans Administration stock → Utilisateurs, ou dans le panneau admin de l'application.</div>
      </StkCard>
    </div>
  </>;
}

// ---------- Encadré « À faire » du tableau de bord ----------
function StkTodo() {
  const C = React.useContext(StkCtx);
  const { dash, cfg, go, isAdmin } = C;
  const monday = stkMonday(stkToday());
  const act = dash.filter((d) => d.active !== false);
  const late = act.filter((d) => d.last_import && d.last_import < monday).length;
  const never = act.filter((d) => !d.last_import).length;
  const nj = act.reduce((a, d) => a + +d.non_justifiees, 0);
  const soon = act.reduce((a, d) => a + +d.bientot, 0);
  const depot = act.reduce((a, d) => a + +d.depot, 0);
  const sans = act.reduce((a, d) => a + +d.sans_date, 0);
  const canEdit = stkCanEdit(C);
  const items = [
    late + (canEdit ? never : 0) > 0 && { tone: "amber", n: late + (canEdit ? never : 0), t: `fichier(s) de stock attendu(s) cette semaine${never ? ` (dont ${never} parc(s) jamais importé(s))` : ""}`, b: canEdit ? "Import groupé" : null, on: () => go("bulk") },
    nj > 0 && { tone: "rose", n: nj, t: "sortie(s) non justifiée(s)", b: "Justifier", on: () => go("justif") },
    soon > 0 && { tone: "amber", n: soon, t: `véhicule(s) passent en dépôt dans moins de ${cfg.seuil} jours`, b: "Voir la liste", on: () => go("search", { situation: "bientot" }) },
    depot > 0 && { tone: "slate", n: depot, t: "véhicule(s) en dépôt dans les parcs", b: "Voir la liste", on: () => go("search", { situation: "depot" }) },
    sans > 0 && { tone: "slate", n: sans, t: "véhicule(s) sans date d'arrivée (dépôt non calculable)", b: "Voir la liste", on: () => go("search", { sans_date: true }) },
    isAdmin && never > 0 && { tone: "slate", n: never, t: "parc(s) jamais importé(s) : suivre la mise en service", b: "Mise en service", on: () => go("miseenservice") }
  ].filter(Boolean);
  const T = { amber: "text-amber-700", rose: "text-rose-700", slate: "text-[#123A66]" };
  return <StkCard className="p-4 md:p-5" data-testid="todo-card">
    <div className="font-bold text-[#0B1F38] mb-2">À faire</div>
    {!items.length ? <div className="text-sm text-emerald-700 font-semibold">Rien en attente : tous les fichiers de la semaine sont reçus et les sorties sont justifiées.</div> :
      <div className="divide-y divide-slate-100">{items.map((x, i) => <div key={i} className="flex flex-wrap items-center gap-3 py-2">
        <div className={`font-plex-mono text-xl font-bold w-16 text-right ${T[x.tone]}`}>{x.n.toLocaleString("fr-FR")}</div>
        <div className="flex-1 min-w-[200px] text-sm text-slate-700">{x.t}</div>
        {x.b && <StkBtn small onClick={x.on}>{x.b} <StkIc.Chev size={14} /></StkBtn>}
      </div>)}</div>}
  </StkCard>;
}
