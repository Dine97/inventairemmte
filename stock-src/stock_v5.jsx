// ============================================================
// STOCK MMTE — Entrées et sorties saisies (une par une ou par fichier), entre deux imports
// ============================================================

// Libellés d'entrée / de sortie, avec la mention « saisie » pour les mouvements enregistrés à la main
function stkEntryLabel(r) { return (STK_ENTRY[r.entry_kind] || "") + (r.entry_move_id ? " (saisie)" : ""); }
function stkExitLabel(r) { return (STK_EXIT[r.exit_kind] || "") + (r.exit_move_id ? " (saisie)" : ""); }

const STK_MOVE_RESULT = {
  ok: ["Enregistré", "bg-emerald-50 text-emerald-800 border-emerald-200"],
  ok_transfert: ["Enregistré (transfert)", "bg-emerald-50 text-emerald-800 border-emerald-200"],
  deja_present: ["Déjà dans le parc : sans effet", "bg-amber-50 text-amber-900 border-amber-300"],
  absent: ["Absent du parc à cette date : sans effet", "bg-rose-50 text-rose-800 border-rose-200"]
};

// Lecture d'une liste de châssis collée (un par ligne, ou séparés par des virgules / points-virgules)
function stkParsePastedChassis(text) {
  return Array.from(new Set(String(text || "").split(/[\n\r,;\t]+/).map((x) => stkNormChassis(x)).filter((x) => x.length >= 5)));
}

function StkManualMoves({ preset }) {
  const C = React.useContext(StkCtx);
  const { cfg, dash, reloadDash, openVehicle } = C;
  const [tab, setTab] = useState((preset && preset.tab) || "une");
  const [kind, setKind] = useState((preset && preset.kind) || "sortie");
  const [parc, setParc] = useState((preset && preset.parc) || "");
  const [date, setDate] = useState(stkToday());
  const [motif, setMotif] = useState("");
  const [jType, setJType] = useState("");
  const [jNum, setJNum] = useState("");
  const [jDate, setJDate] = useState("");
  const [items, setItems] = useState([]); // { chassis, marque, modele, navire, bl, date_arrivee, ... }
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState({});
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [result, setResult] = useState(null);
  const [one, setOne] = useState({ chassis: "", marque: "", modele: "", navire: "", bl: "", date_arrivee: "" });
  const [paste, setPaste] = useState("");
  const [scan, setScan] = useState(false);
  const inputRef = useRef(null);
  const parcNames = useMemo(() => Array.from(new Set(dash.filter((d) => d.active !== false).map((d) => d.parc))).sort(), [dash]);

  // Où se trouve chaque châssis aujourd'hui (aperçu avant enregistrement)
  useEffect(() => {
    if (!parc || !items.length) { setPreview({}); return; }
    const t = setTimeout(async () => {
      try {
        const r = await stkCall("moves_preview", { parc_name: parc, chassis: items.map((x) => x.chassis) });
        const m = {}; r.forEach((x) => (m[x.chassis] = x)); setPreview(m);
      } catch (e) {}
    }, 400);
    return () => clearTimeout(t);
  }, [parc, items.map((x) => x.chassis).join(",")]);

  if (!stkCanEdit(C)) return <><StkPageHead title="Saisir des entrées et sorties" /><StkMsg tone="warn">Votre accès au suivi des stocks est en consultation seule : la saisie est réservée aux agents MMTE.</StkMsg></>;

  const addOne = (e) => {
    if (e) e.preventDefault();
    const c = stkNormChassis(one.chassis);
    if (c.length < 5) { setErr("Saisissez un numéro de châssis complet."); return; }
    setErr("");
    setItems((xs) => (xs.some((x) => x.chassis === c) ? xs : [...xs, { ...one, chassis: c, chassis_raw: one.chassis.trim() }]));
    setOne({ chassis: "", marque: "", modele: "", navire: "", bl: "", date_arrivee: "" });
    setTimeout(() => inputRef.current && inputRef.current.focus(), 30);
  };
  const addPasted = () => {
    const list = stkParsePastedChassis(paste);
    if (!list.length) { setErr("Aucun châssis reconnu dans le texte collé."); return; }
    setErr("");
    setItems((xs) => { const have = new Set(xs.map((x) => x.chassis)); return [...xs, ...list.filter((c) => !have.has(c)).map((c) => ({ chassis: c }))]; });
    setPaste("");
  };
  const onFile = async (f) => {
    if (!f) return;
    setErr(""); setBusy("Lecture du fichier...");
    try {
      const book = XLSX.read(await f.arrayBuffer(), { cellDates: true, type: "array" });
      let synonyms = [];
      try { synonyms = (await stkCall("templates", {})).synonyms || []; } catch (e) {}
      const res = stkParseWorkbook(book, { synonyms });
      if (!res.rows.length) { setErr("Aucune colonne de châssis reconnue dans ce fichier. Vous pouvez aussi copier la colonne des châssis et la coller dans la zone de texte."); setBusy(""); return; }
      const all = [].concat(...res.sheets.map((s) => s.rows));
      const seen = new Set();
      const list = all.filter((r) => (seen.has(r.chassis) ? false : seen.add(r.chassis))).map((r) => ({
        chassis: r.chassis, chassis_raw: r.chassis_raw, marque: r.marque, modele: r.modele, annee: r.annee, navire: r.navire,
        manifeste: r.manifeste, bl: r.bl, date_arrivee: r.date_arrivee, importateur: r.importateur
      }));
      setItems(list); setFileName(f.name);
      if (!parc) { const g = parcNames.find((n) => stkNorm(f.name).includes(stkNorm(n))); if (g) setParc(g); }
    } catch (e) { setErr("Fichier illisible : " + (e.message || e)); }
    setBusy("");
  };
  const remove = (c) => setItems((xs) => xs.filter((x) => x.chassis !== c));
  const reset = () => { setItems([]); setFileName(""); setPreview({}); setResult(null); setMotif(""); setJType(""); setJNum(""); setJDate(""); setErr(""); };

  // Avertissements par châssis, selon le type de mouvement
  const status = (c) => {
    const p = preview[c];
    if (!p) return null;
    if (kind === "sortie") {
      if (!p.dans_ce_parc) return ["err", p.autre_parc ? `Pas dans ce parc (actuellement à ${p.autre_parc})` : "Pas dans le stock de ce parc"];
      return ["ok", `Présent depuis le ${stkFmt(p.entre_le)}`];
    }
    if (p.dans_ce_parc) return ["warn", `Déjà dans ce parc depuis le ${stkFmt(p.entre_le)}`];
    if (p.autre_parc) return ["info", `Actuellement à ${p.autre_parc} : enregistré comme transfert`];
    if (!p.connu) return ["info", "Véhicule inconnu : sa fiche sera créée"];
    return ["ok", "Entrée possible"];
  };
  const blocked = items.filter((x) => { const s = status(x.chassis); return s && s[0] === "err"; }).length;
  const dup = items.filter((x) => { const s = status(x.chassis); return s && s[0] === "warn"; }).length;

  const save = async () => {
    if (!parc) { setErr("Choisissez le parc."); return; }
    if (!items.length) { setErr("Ajoutez au moins un châssis."); return; }
    const verb = kind === "entree" ? "entrée(s)" : "sortie(s)";
    if (!window.confirm(`Enregistrer ${items.length} ${verb} au ${stkFmt(date)} pour le parc ${parc} ?${blocked ? `\n\n${blocked} châssis ne sont pas dans ce parc : ils seront ignorés.` : ""}`)) return;
    setBusy("Enregistrement..."); setErr("");
    try {
      const r = await stkCall("moves_add", {
        parc_name: parc, kind, date, motif, source: fileName ? "fichier" : "saisie", file_name: fileName || null,
        justif_type: kind === "sortie" ? jType : "", justif_numero: kind === "sortie" ? jNum : "", justif_date: kind === "sortie" ? jDate : "",
        items: items.map((x) => { const o = {}; Object.entries(x).forEach(([k, v]) => { if (v != null && v !== "") o[k] = v; }); return o; })
      });
      setResult(r); reloadDash();
    } catch (e) { setErr(stkErrText(e)); }
    setBusy("");
  };

  const head = <StkPageHead title="Saisir des entrées et sorties" sub="Entre deux imports du lundi : enregistrez une entrée ou une sortie constatée, une par une ou par fichier. Les saisies sont intégrées à l'historique du parc et rejouées avec les imports." />;
  const tabs = <StkTabs tabs={[{ key: "une", label: "Une par une" }, { key: "fichier", label: "Par fichier ou liste" }, { key: "historique", label: "Saisies enregistrées" }]} value={tab} onChange={(k) => { setTab(k); if (k !== "historique") { setResult(null); } }} />;

  if (tab === "historique") return <>{head}{tabs}<StkMovesHistory /></>;

  if (result) {
    const det = result.details || [];
    return <>{head}{tabs}
      <StkCard className="p-4 md:p-5 space-y-4">
        <StkMsg tone={result.ok === result.total ? "ok" : "warn"}><b>{result.ok} {kind === "entree" ? "entrée(s)" : "sortie(s)"} enregistrée(s)</b> sur {result.total} pour le parc {parc}.{result.transferts ? ` Dont ${result.transferts} transfert(s) depuis un autre parc.` : ""}{result.deja_present ? ` ${result.deja_present} déjà présent(s) : sans effet.` : ""}{result.absents ? ` ${result.absents} absent(s) du parc à cette date : sans effet.` : ""}{result.reconstruit ? " Saisie antérieure au dernier import : l'historique du parc a été recalculé." : ""}</StkMsg>
        <StkTable rowKey={(r) => r.id} rows={det} columns={[
          { key: "chassis", label: "Châssis", render: (r) => <button className="font-plex-mono font-bold text-[#1B4F8C] underline" onClick={() => openVehicle({ chassis: r.chassis })}>{r.chassis}</button> },
          { key: "date", label: "Date", render: (r) => stkFmt(r.date) },
          { key: "result", label: "Résultat", render: (r) => { const t = STK_MOVE_RESULT[r.result] || ["—", ""]; return <StkBadge tone={t[1]}>{t[0]}</StkBadge>; } }
        ]} />
        <div className="flex flex-wrap gap-2"><StkBtn kind="primary" onClick={reset}><StkIc.Plus size={16} /> Nouvelle saisie</StkBtn><StkBtn onClick={() => setTab("historique")}>Voir les saisies enregistrées</StkBtn></div>
      </StkCard>
    </>;
  }

  return <>
    {head}{tabs}
    <StkCard className="p-4 md:p-5 space-y-4">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Type de mouvement">
        {[["entree", "Entrée dans le parc", "bg-emerald-600 border-emerald-600"], ["sortie", "Sortie du parc", "bg-rose-600 border-rose-600"]].map(([k, l, on]) =>
          <button key={k} type="button" role="radio" aria-checked={kind === k} data-testid={"move-kind-" + k} onClick={() => setKind(k)} className={`px-4 py-2.5 rounded-xl border-2 text-sm font-bold ${kind === k ? on + " text-white" : "bg-white border-slate-200 text-slate-600"}`}>{l}</button>)}
      </div>
      <div className="grid md:grid-cols-3 gap-3">
        <StkField label="Parc"><select value={parc} onChange={(e) => setParc(e.target.value)} className={stkInput} data-testid="move-parc"><option value="">— Choisir le parc —</option>{parcNames.map((n) => <option key={n} value={n}>{n}</option>)}</select></StkField>
        <StkField label={kind === "entree" ? "Date d'entrée" : "Date de sortie"} hint="Une date antérieure au dernier import est acceptée : l'historique est recalculé."><input type="date" value={date} max={stkToday()} onChange={(e) => setDate(e.target.value)} className={stkInput} data-testid="move-date" /></StkField>
        <StkField label="Motif / observation (facultatif)"><input value={motif} onChange={(e) => setMotif(e.target.value)} placeholder={kind === "entree" ? "Ex. : arrivée constatée lors du contrôle" : "Ex. : enlèvement constaté au portail"} className={stkInput} /></StkField>
      </div>
      {kind === "sortie" && <div className="grid md:grid-cols-3 gap-3 rounded-xl bg-[#F4F8FC] border border-[#C9DBEF] p-3">
        <div className="md:col-span-3 text-xs font-bold text-[#123A66]">Justification de la sortie (facultatif — complétable plus tard dans « Justification des sorties »)</div>
        <StkField label="Type"><select value={jType} onChange={(e) => setJType(e.target.value)} className={stkInput}><option value="">—</option>{cfg.types.map((t) => <option key={t}>{t}</option>)}</select></StkField>
        <StkField label="N° de déclaration"><input value={jNum} onChange={(e) => setJNum(e.target.value)} className={stkInput} /></StkField>
        <StkField label="Date de la déclaration"><input type="date" value={jDate} onChange={(e) => setJDate(e.target.value)} className={stkInput} /></StkField>
      </div>}

      {tab === "une" ? <form onSubmit={addOne} className="space-y-3">
        <div className="flex gap-2">
          <input ref={inputRef} value={one.chassis} onChange={(e) => setOne({ ...one, chassis: e.target.value })} placeholder="Numéro de châssis" className={`${stkInput} flex-1 font-plex-mono text-base`} data-testid="move-chassis" autoFocus />
          <StkBtn type="button" onClick={() => setScan(true)} title="Scanner"><ScanLine size={18} /><span className="hidden sm:inline">Scanner</span></StkBtn>
          <StkBtn kind="primary" type="submit" data-testid="move-add"><StkIc.Plus size={16} /> Ajouter</StkBtn>
        </div>
        {kind === "entree" && <details className="text-sm"><summary className="cursor-pointer font-semibold text-[#1B4F8C]">Informations du véhicule (facultatif, utiles pour un véhicule inconnu)</summary>
          <div className="grid md:grid-cols-3 gap-3 mt-3">
            <StkField label="Marque"><input value={one.marque} onChange={(e) => setOne({ ...one, marque: e.target.value.toUpperCase() })} className={stkInput} /></StkField>
            <StkField label="Modèle"><input value={one.modele} onChange={(e) => setOne({ ...one, modele: e.target.value.toUpperCase() })} className={stkInput} /></StkField>
            <StkField label="Navire"><input value={one.navire} onChange={(e) => setOne({ ...one, navire: e.target.value.toUpperCase() })} className={stkInput} /></StkField>
            <StkField label="N° BL"><input value={one.bl} onChange={(e) => setOne({ ...one, bl: e.target.value.toUpperCase() })} className={stkInput} /></StkField>
            <StkField label="Date d'arrivée du navire" hint="Sert au calcul de la date de dépôt"><input type="date" value={one.date_arrivee} onChange={(e) => setOne({ ...one, date_arrivee: e.target.value })} className={stkInput} /></StkField>
          </div>
        </details>}
      </form> : <div className="grid md:grid-cols-2 gap-3">
        <label className="block rounded-2xl border-2 border-dashed border-[#1B4F8C]/30 bg-[#F4F8FC] hover:bg-[#EAF1FA] p-5 text-center cursor-pointer"
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files && e.dataTransfer.files[0]); }}>
          <input type="file" className="hidden" accept=".xlsx,.xls,.xlsm,.xlsb,.ods,.csv,.txt" data-testid="move-file" onChange={(e) => { onFile(e.target.files && e.target.files[0]); e.target.value = ""; }} />
          <FileSpreadsheet size={28} className="mx-auto text-[#1B4F8C]" />
          <div className="font-bold text-[#123A66] mt-2">{fileName || "Fichier Excel des entrées ou des sorties"}</div>
          <div className="text-xs text-slate-500 mt-1">La colonne des châssis est reconnue automatiquement (marque, navire, date d'arrivée aussi si présentes).</div>
        </label>
        <div className="space-y-2">
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={5} placeholder="Ou collez une liste de châssis (un par ligne)" className={`${stkInput} font-plex-mono`} data-testid="move-paste" />
          <StkBtn small onClick={addPasted}><StkIc.Plus size={14} /> Ajouter la liste collée</StkBtn>
        </div>
      </div>}
      {busy && <StkMsg tone="info">{busy}</StkMsg>}
      {err && <StkMsg tone="err">{err}</StkMsg>}
    </StkCard>

    {items.length > 0 && <StkCard className="p-0 overflow-hidden">
      <div className="px-4 md:px-5 py-3 flex flex-wrap items-center gap-2 border-b border-slate-200">
        <div className="flex-1 font-bold text-[#0B1F38]">{items.length} châssis à enregistrer {kind === "entree" ? "en entrée" : "en sortie"}{fileName ? ` · ${fileName}` : ""}</div>
        <StkBtn small kind="ghost" onClick={() => { setItems([]); setFileName(""); }}>Vider la liste</StkBtn>
      </div>
      <div className="overflow-x-auto"><table className="w-full text-sm min-w-[620px]" data-testid="move-table">
        <thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 bg-slate-50 border-b border-slate-200"><th className="py-2 px-4">Châssis</th><th className="px-2">Véhicule</th><th className="px-2">Situation</th><th className="px-2"></th></tr></thead>
        <tbody>{items.map((x) => { const s = status(x.chassis); const p = preview[x.chassis] || {}; const T = { ok: "text-emerald-700", warn: "text-amber-800", info: "text-[#1B4F8C]", err: "text-rose-700 font-semibold" };
          return <tr key={x.chassis} className="border-b border-slate-100">
            <td className="py-2 px-4 font-plex-mono font-bold">{x.chassis}</td>
            <td className="px-2 text-slate-600">{[x.marque || p.marque, x.modele || p.modele].filter(Boolean).join(" ") || "—"}</td>
            <td className={`px-2 text-xs ${s ? T[s[0]] : "text-slate-400"}`}>{s ? s[1] : parc ? "Vérification..." : "Choisissez le parc"}</td>
            <td className="px-2 text-right"><button className="text-xs text-slate-500 underline" onClick={() => remove(x.chassis)}>Retirer</button></td>
          </tr>; })}</tbody>
      </table></div>
      <div className="p-4 md:p-5 space-y-3 border-t border-slate-200 bg-slate-50/60">
        {blocked > 0 && <StkMsg tone="warn">{blocked} châssis ne figurent pas dans le stock de ce parc : leur sortie sera ignorée.</StkMsg>}
        {dup > 0 && <StkMsg tone="warn">{dup} châssis sont déjà dans ce parc : leur entrée sera sans effet.</StkMsg>}
        <StkBtn kind="primary" disabled={!!busy || !parc} onClick={save} data-testid="move-save"><StkIc.Check size={16} /> Enregistrer {items.length} {kind === "entree" ? "entrée(s)" : "sortie(s)"}</StkBtn>
      </div>
    </StkCard>}
    {scan && <CameraScanner knownMap={new Map()} onClose={() => setScan(false)} onDetect={(c) => { setScan(false); setOne((o) => ({ ...o, chassis: c })); setTimeout(() => inputRef.current && inputRef.current.focus(), 50); }} />}
  </>;
}

// Saisies enregistrées : consultation et annulation
function StkMovesHistory() {
  const C = React.useContext(StkCtx);
  const { dash, reloadDash, openVehicle, isAdmin, me } = C;
  const [parc, setParc] = useState("");
  const [from, setFrom] = useState(stkAddDays(stkToday(), -30));
  const [to, setTo] = useState(stkToday());
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const load = async () => {
    setRows(null); setErr("");
    try { setRows(await stkCall("moves_list", { parc_id: parc || null, from, to })); } catch (e) { setErr(stkErrText(e)); setRows([]); }
  };
  useEffect(() => { load(); }, [parc, from, to]);
  const canCancel = (r) => isAdmin || (me && r.created_by_uid === me.uid);
  const cancel = async (ids, restore) => {
    let reason = "";
    if (!restore) { reason = window.prompt("Motif de l'annulation :", ""); if (reason == null) return; if (!reason.trim()) { alert("Indiquez le motif."); return; } }
    try { await stkCall("moves_cancel", { ids, reason, restore: !!restore }); load(); reloadDash(); } catch (e) { alert(stkErrText(e)); }
  };
  const exportX = () => stkExportXlsx(`Saisies_${from}_${to}`, "Entrées et sorties saisies", [`Du ${stkFmt(from)} au ${stkFmt(to)}`], [
    { h: "Date", x: (r) => stkFmt(r.move_date) }, { h: "Parc", x: (r) => r.parcs && r.parcs.name }, { h: "Type", x: (r) => (r.kind === "entree" ? "Entrée" : "Sortie") },
    { h: "Châssis", x: (r) => r.vehicles && r.vehicles.chassis, w: 22 }, { h: "Motif", k: "motif", w: 26 }, { h: "Déclaration", k: "justif_numero" },
    { h: "Source", x: (r) => (r.source === "fichier" ? "Fichier " + (r.file_name || "") : "Saisie") }, { h: "Par", k: "created_by_name" },
    { h: "Résultat", x: (r) => (r.cancelled_at ? "Annulée" : (STK_MOVE_RESULT[r.result] || [""])[0]) }
  ], rows || []);
  return <StkCard className="p-4 md:p-5 space-y-3">
    <div className="grid md:grid-cols-4 gap-3 items-end">
      <StkField label="Parc"><select value={parc} onChange={(e) => setParc(e.target.value)} className={stkInput}><option value="">Tous les parcs</option>{dash.map((d) => <option key={d.parc_id} value={d.parc_id}>{d.parc}</option>)}</select></StkField>
      <StkField label="Du"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={stkInput} /></StkField>
      <StkField label="Au"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={stkInput} /></StkField>
      <div className="flex gap-2"><StkBtn onClick={load}><RefreshCw size={16} /></StkBtn>{rows && rows.length > 0 && <StkBtn onClick={exportX}><Download size={16} /> Excel</StkBtn>}</div>
    </div>
    {err && <StkMsg tone="err">{err}</StkMsg>}
    {!rows ? <StkLoading /> : <StkTable rowKey={(r) => r.id} rows={rows} empty="Aucune saisie sur cette période." columns={[
      { key: "move_date", label: "Date", render: (r) => <span className="whitespace-nowrap">{stkFmt(r.move_date)}</span> },
      { key: "parc", label: "Parc", render: (r) => r.parcs && r.parcs.name },
      { key: "kind", label: "Type", render: (r) => <StkBadge tone={r.kind === "entree" ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-rose-50 text-rose-800 border-rose-200"}>{r.kind === "entree" ? "Entrée" : "Sortie"}</StkBadge> },
      { key: "chassis", label: "Châssis", render: (r) => <button className="font-plex-mono font-bold text-[#1B4F8C] underline" onClick={() => openVehicle({ chassis: r.vehicles && r.vehicles.chassis })}>{r.vehicles && r.vehicles.chassis}</button> },
      { key: "motif", label: "Motif / déclaration", render: (r) => <span className="text-xs text-slate-600">{[r.motif, r.justif_numero && "Décl. " + r.justif_numero].filter(Boolean).join(" · ")}</span> },
      { key: "by", label: "Par", render: (r) => <span className="text-xs">{r.created_by_name}<span className="block text-slate-400">{r.source === "fichier" ? "Fichier " + (r.file_name || "") : "Saisie"} · {stkFmtTs(r.created_at)}</span></span> },
      { key: "result", label: "Résultat", render: (r) => r.cancelled_at ? <StkBadge tone="bg-slate-100 text-slate-600 border-slate-200">Annulée</StkBadge> : (() => { const t = STK_MOVE_RESULT[r.result] || ["—", ""]; return <StkBadge tone={t[1]}>{t[0]}</StkBadge>; })() },
      { key: "act", label: "", render: (r) => r.cancelled_at ? (isAdmin ? <StkBtn small kind="ghost" onClick={() => cancel([r.id], true)}>Rétablir</StkBtn> : null)
        : canCancel(r) ? <span className="flex gap-1"><StkBtn small kind="ghost" onClick={() => cancel([r.id])}>Annuler</StkBtn>{rows.filter((x) => x.batch_id === r.batch_id && !x.cancelled_at).length > 1 && <StkBtn small kind="ghost" onClick={() => cancel(rows.filter((x) => x.batch_id === r.batch_id && !x.cancelled_at).map((x) => x.id))}>Annuler le lot</StkBtn>}</span> : null }
    ]} />}
  </StkCard>;
}
