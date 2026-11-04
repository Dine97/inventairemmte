// ---------------- Import d'un fichier de stock ----------------
function StkImport({ preset }) {
  const C = React.useContext(StkCtx);
  const { cfg, dash, openParc, reloadDash } = C;
  const [parc, setParc] = useState((preset && preset.parc) || "");
  const [date, setDate] = useState(stkToday());
  const [comment, setComment] = useState("");
  const [file, setFile] = useState(null);
  const [wb, setWb] = useState(null);
  const [tpl, setTpl] = useState({ templates: [], synonyms: [] });
  const [forced, setForced] = useState({});
  const [parsed, setParsed] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [result, setResult] = useState(null);
  const [editMap, setEditMap] = useState(null);
  const [showList, setShowList] = useState(null);
  const inputRef = useRef(null);
  const parcNames = useMemo(() => Array.from(new Set(dash.filter((d) => d.active !== false).map((d) => d.parc))).sort(), [dash]);
  const parcOk = parc.trim().length > 0;

  const analyse = async (book, parcName, frc) => {
    setErr(""); setPreview(null);
    let t = { templates: [], synonyms: [] };
    try { setBusy("Recherche du modèle de lecture du parc..."); t = await stkCall("templates", { parc_name: parcName }); setTpl(t); } catch (e) {}
    setBusy("Lecture du fichier...");
    const res = stkParseWorkbook(book, { synonyms: t.synonyms, templates: t.templates, forced: frc });
    setParsed(res);
    if (!res.rows.length) { setBusy(""); return; }
    if (!parcName) { setBusy(""); return; }
    try {
      setBusy("Comparaison avec le dernier stock du parc...");
      setPreview(await stkCall("preview_import", { parc_name: parcName, chassis: Array.from(new Set(res.rows.map((r) => r.chassis))) }));
    } catch (e) { setErr(stkErrText(e)); }
    setBusy("");
  };
  const onFile = async (f) => {
    if (!f) return;
    setFile(f); setResult(null); setForced({}); setParsed(null); setPreview(null); setErr("");
    if (!parc) { const g = parcNames.find((n) => stkNorm(f.name).includes(stkNorm(n))); if (g) setParc(g); }
    try {
      setBusy("Ouverture du fichier...");
      const buf = await f.arrayBuffer();
      const book = XLSX.read(buf, { cellDates: true, type: "array" });
      setWb(book);
      const guess = parc || parcNames.find((n) => stkNorm(f.name).includes(stkNorm(n))) || "";
      await analyse(book, guess, {});
    } catch (e) { setBusy(""); setErr("Fichier illisible : " + (e.message || e)); }
  };
  useEffect(() => { if (wb && parcOk) { const t = setTimeout(() => analyse(wb, parc.trim().toUpperCase(), forced), 500); return () => clearTimeout(t); } }, [parc]);
  const lastDate = preview && preview.last_stock_date;
  const tooOld = lastDate && date < lastDate;
  const typos = useMemo(() => preview && !preview.is_initial ? stkTypoPairs(preview.entrees, preview.sorties) : [], [preview]);
  if (!stkCanEdit(C)) return <><StkPageHead title="Importer le stock d'un parc" /><StkMsg tone="warn">Votre accès au suivi des stocks est en consultation seule : l'import est réservé aux agents MMTE.</StkMsg></>;
  const stockSheets = parsed ? parsed.sheets.filter((s) => s.role === "stock") : [];

  const commit = async () => {
    if (!parsed || !parcOk) return;
    setBusy("Enregistrement de l'import..."); setErr("");
    try {
      const first = stockSheets[0];
      const newSyn = [];
      Object.keys(forced).forEach((sn) => {
        const sh = parsed.sheets.find((s) => s.name === sn);
        if (!sh) return;
        Object.entries(sh.mapping).forEach(([field, j]) => {
          const h = sh.header[j];
          if (h && field !== "ignore" && stkFieldForHeader(h, stkBuildSynonyms(tpl.synonyms)) !== field) newSyn.push({ field, synonym: stkNorm(h) });
        });
      });
      const res = await stkCall("commit_import", {
        parc_name: parc.trim().toUpperCase(), stock_date: date, file_name: file.name, file_size: file.size,
        sheets: parsed.sheets.map((s) => s.name), header_row: first ? first.headerLine : null, mapping: first ? first.mapping : null,
        declared: parsed.declared, nb_lignes: parsed.rows.length, comment,
        anomalies: parsed.anomalies.map((a) => ({ ...a, items: (a.items || []).slice(0, 300) })),
        rows: parsed.rows.map((r) => ({ chassis: r.chassis, chassis_raw: r.chassis_raw, marque: r.marque, modele: r.modele, annee: r.annee, navire: r.navire, manifeste: r.manifeste, bl: r.bl, date_arrivee: r.date_arrivee, date_transfert: r.date_transfert, importateur: r.importateur, data: r.statut ? { ...r.data, "Statut (fichier)": r.statut } : r.data })),
        template: first ? { signature: first.signature, mapping: first.mapping, header_row: first.headerRow, sheet: first.name } : null,
        new_synonyms: newSyn
      });
      setResult(res); setBusy("");
      reloadDash();
    } catch (e) { setBusy(""); setErr(stkErrText(e)); }
  };
  const reset = () => { setFile(null); setWb(null); setParsed(null); setPreview(null); setResult(null); setForced({}); setComment(""); if (inputRef.current) inputRef.current.value = ""; };

  if (result) return <>
    <StkPageHead title="Import enregistré" sub={`${parc.toUpperCase()} — stock du ${stkFmt(date)}`} />
    <StkCard className="p-5 space-y-4">
      <StkMsg tone="ok"><b>{result.nb_chassis} véhicules</b> enregistrés pour le parc {parc.toUpperCase()}.{result.is_initial ? " C'est le premier import de ce parc : ces véhicules forment son stock initial." : ""}{result.reconstruit ? " Fichier antérieur au dernier import : l'historique du parc a été recalculé." : ""}</StkMsg>
      {!result.is_initial && <div className="grid grid-cols-3 gap-3"><StkKpi label="Entrées" value={result.entrees} tone="green" /><StkKpi label="Sorties" value={result.sorties} tone="rose" /><StkKpi label="Transferts vers un autre parc" value={result.transferts} tone="slate" /></div>}
      <div className="flex flex-wrap gap-2"><StkBtn kind="primary" onClick={() => openParc(result.parc_id)}>Voir le parc</StkBtn><StkBtn onClick={() => { reset(); setParc(""); }}><Upload size={16} /> Importer un autre fichier</StkBtn></div>
    </StkCard>
  </>;

  return <>
    <StkPageHead title="Importer le stock d'un parc" sub="Choisissez le parc, déposez le fichier Excel reçu (tous formats : .xlsx, .xls, .xlsm, .ods, .csv). L'outil reconnaît les colonnes et compare avec le dernier stock du parc." />
    <StkCard className="p-4 md:p-5 space-y-4">
      <div className="grid md:grid-cols-3 gap-3">
        <StkField label="Parc"><ParcAutocomplete value={parc} onChange={setParc} parcsList={parcNames} /></StkField>
        <StkField label="Date du stock" hint="Date de réception du fichier (modifiable si le fichier arrive en retard)"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={stkInput} /></StkField>
        <StkField label="Commentaire (facultatif)"><input value={comment} onChange={(e) => setComment(e.target.value)} className={stkInput} /></StkField>
      </div>
      <label className="block rounded-2xl border-2 border-dashed border-[#1B4F8C]/30 bg-[#F4F8FC] hover:bg-[#EAF1FA] p-6 text-center cursor-pointer"
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files && e.dataTransfer.files[0]); }}>
        <input ref={inputRef} type="file" className="hidden" accept=".xlsx,.xls,.xlsm,.xlsb,.ods,.csv,.txt" onChange={(e) => onFile(e.target.files && e.target.files[0])} />
        <FileSpreadsheet size={30} className="mx-auto text-[#1B4F8C]" />
        <div className="font-bold text-[#123A66] mt-2">{file ? file.name : "Déposer le fichier ici ou cliquer pour le choisir"}</div>
        {file && <div className="text-xs text-slate-500 mt-1">{(file.size / 1024).toFixed(0)} Ko · cliquer pour changer de fichier</div>}
      </label>
      {busy && <StkMsg tone="info">{busy}</StkMsg>}
      {err && <StkMsg tone="err">{err}</StkMsg>}
    </StkCard>

    {parsed && !parsed.rows.length && <StkCard className="p-4 md:p-5 space-y-3">
      <StkMsg tone="warn">Aucun tableau de châssis n'a été reconnu automatiquement. Indiquez l'onglet et la ligne d'en-tête du tableau.</StkMsg>
      <StkManualHeader wb={wb} onApply={(sheet, row) => { const f = { [sheet]: { header_row: row, mapping: null } }; setForced(f); analyse(wb, parc.trim().toUpperCase(), f); }} />
    </StkCard>}

    {parsed && parsed.rows.length > 0 && <>
      <StkCard className="p-4 md:p-5 space-y-3">
        <div className="font-bold text-[#0B1F38] text-lg">1. Lecture du fichier</div>
        <div className="space-y-2">{parsed.sheets.map((s) => <div key={s.name} className="flex flex-wrap items-center gap-2 text-sm bg-[#F4F8FC] rounded-xl px-3 py-2">
          <b>Onglet « {s.name} »</b>
          <StkBadge tone={s.role === "stock" ? "bg-[#EAF1FA] text-[#123A66] border-[#C9DBEF]" : "bg-slate-100 text-slate-600 border-slate-200"}>{s.role === "stock" ? "Stock" : s.role === "entrees" ? "Entrées déclarées par le parc" : "Sorties déclarées par le parc"}</StkBadge>
          <span className="text-slate-600">{s.rows.length} ligne(s) · en-tête ligne {s.headerLine}</span>
          <StkBadge tone={s.source === "modele" ? "bg-emerald-50 text-emerald-800 border-emerald-200" : s.source === "manuel" ? "bg-amber-50 text-amber-900 border-amber-300" : "bg-sky-50 text-sky-800 border-sky-200"}>{s.source === "modele" ? "Modèle du parc reconnu" : s.source === "manuel" ? "Correspondance corrigée" : "Détection automatique"}</StkBadge>
          {s.grouped && <span className="text-xs text-slate-500">(navire et date recopiés sur les lignes du même groupe)</span>}
          <div className="flex-1" />
          <StkBtn small onClick={() => setEditMap(s)}><StkIc.Edit size={14} /> Vérifier les colonnes</StkBtn>
        </div>)}</div>
        <div className="text-sm font-bold text-slate-600">Aperçu des premières lignes lues</div>
        <div className="overflow-x-auto -mx-4 md:mx-0"><table className="w-full text-xs min-w-[760px]"><thead><tr className="text-left text-slate-500 border-b border-slate-200">{["Ligne", "Châssis", "Marque", "Modèle", "Année", "Navire", "Manifeste", "BL", "Arrivée", "Transfert", "Dépôt"].map((h) => <th key={h} className="py-1.5 px-2">{h}</th>)}</tr></thead>
          <tbody>{parsed.rows.slice(0, 8).map((r, i) => <tr key={i} className="border-b border-slate-100"><td className="py-1.5 px-2 text-slate-400">{r.line}</td><td className="px-2 font-plex-mono font-bold">{r.chassis}</td><td className="px-2">{r.marque}</td><td className="px-2">{r.modele}</td><td className="px-2">{r.annee}</td><td className="px-2">{r.navire}</td><td className="px-2">{r.manifeste}</td><td className="px-2">{r.bl}</td><td className="px-2">{stkFmt(r.date_arrivee)}</td><td className="px-2">{stkFmt(r.date_transfert)}</td><td className="px-2">{stkFmt(stkSit(r, stkToday(), cfg).depot)}</td></tr>)}</tbody></table></div>
        {parsed.anomalies.length > 0 && <div className="space-y-2">{parsed.anomalies.map((a, i) => <StkMsg key={i} tone={a.niveau === "erreur" ? "warn" : a.niveau === "info" ? "info" : "warn"}><div className="flex flex-wrap gap-2 items-center"><span className="flex-1">{a.texte}{a.code === "doublon" ? " — seule la première ligne de chaque châssis est retenue." : ""}</span>{a.items && a.items.length > 0 && <button className="text-xs font-bold underline" onClick={() => setShowList({ title: a.texte, items: a.items })}>Voir la liste</button>}</div></StkMsg>)}</div>}
      </StkCard>

      {!parcOk && <StkMsg tone="warn">Choisissez le parc pour comparer avec son dernier stock.</StkMsg>}
      {preview && <StkCard className="p-4 md:p-5 space-y-3">
        <div className="font-bold text-[#0B1F38] text-lg">2. Comparaison avec le dernier stock {lastDate ? `(stock du ${stkFmt(lastDate)})` : ""}</div>
        {preview.is_initial ? <StkMsg tone="info">Premier import pour ce parc : les <b>{preview.nb_chassis}</b> véhicules formeront son stock initial. Les entrées et sorties seront calculées à partir du prochain import.</StkMsg> :
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StkKpi label="Véhicules dans le fichier" value={preview.nb_chassis} />
            <StkKpi label="Entrées" value={preview.entrees.length} tone="green" onClick={() => setShowList({ title: "Entrées", items: preview.entrees })} />
            <StkKpi label="Sorties" value={preview.sorties.length} tone="rose" onClick={() => setShowList({ title: "Sorties", items: preview.sorties })} />
            <StkKpi label="Inchangés" value={preview.inchanges} tone="slate" />
          </div>}
        {tooOld && <StkMsg tone="warn">Ce fichier est <b>antérieur</b> au dernier import du parc (stock du {stkFmt(lastDate)}). Il sera inséré à sa date et tout l'historique du parc sera recalculé automatiquement ; les justificatifs déjà saisis sont conservés. Les chiffres ci-dessus sont indicatifs.</StkMsg>}
        {typos.length > 0 && <StkMsg tone="warn"><div className="flex flex-wrap gap-2"><span className="flex-1">{typos.length} entrée(s) ressemblent à une sortie à 1 ou 2 caractères près : probablement le même véhicule mal saisi par le parc. Après l'import, utilisez le Centre des anomalies pour les fusionner (la faute sera corrigée automatiquement ensuite).</span><button className="text-xs font-bold underline" onClick={() => setShowList({ title: "Fautes de frappe probables", items: typos.map((t) => `${t.entree}  ↔  ${t.sortie}  (${t.distance} car.)`) })}>Voir</button></div></StkMsg>}
        {preview.autres_parcs.length > 0 && <StkMsg tone="warn"><div className="flex flex-wrap gap-2"><span className="flex-1">{preview.autres_parcs.length} véhicule(s) figurent encore dans le stock d'un autre parc : ils seront enregistrés comme <b>entrées par transfert</b>, et leur sortie de l'autre parc sera reconnue comme transfert à son prochain import.</span><button className="text-xs font-bold underline" onClick={() => setShowList({ title: "Présents dans un autre parc", items: preview.autres_parcs.map((x) => `${x.chassis} — ${x.parc}`) })}>Voir</button></div></StkMsg>}
        {preview.reapparus.length > 0 && <StkMsg tone="warn"><div className="flex flex-wrap gap-2"><span className="flex-1">{preview.reapparus.length} véhicule(s) déjà sortis réapparaissent dans ce fichier.</span><button className="text-xs font-bold underline" onClick={() => setShowList({ title: "Véhicules sortis qui réapparaissent", items: preview.reapparus })}>Voir</button></div></StkMsg>}
        <StkDeclaredCheck parsed={parsed} preview={preview} />
        <div className="flex flex-wrap gap-2 pt-1">
          <StkBtn kind="primary" disabled={!!busy || !parcOk} onClick={commit}><StkIc.Check size={16} /> Valider l'import</StkBtn>
          <StkBtn onClick={reset}>Annuler</StkBtn>
        </div>
      </StkCard>}
    </>}
    {editMap && <StkMappingModal sheet={editMap} wb={wb} onClose={() => setEditMap(null)} onApply={(m, hr) => { const f = { ...forced, [editMap.name]: { mapping: m, header_row: hr } }; setForced(f); setEditMap(null); analyse(wb, parc.trim().toUpperCase(), f); }} />}
    {showList && <StkModal title={showList.title} onClose={() => setShowList(null)}><div className="font-plex-mono text-sm columns-1 md:columns-2 gap-6">{showList.items.map((x, i) => <div key={i} className="py-0.5 break-all">{x}</div>)}</div></StkModal>}
  </>;
}
function StkDeclaredCheck({ parsed, preview }) {
  if (preview.is_initial) return null;
  const blocks = [];
  const cmp = (declared, computed, label) => {
    const D = new Set(declared), Cc = new Set(computed);
    const onlyD = [...D].filter((x) => !Cc.has(x)), onlyC = [...Cc].filter((x) => !D.has(x));
    if (!onlyD.length && !onlyC.length) blocks.push(<StkMsg key={label} tone="ok">{label} annoncées par le parc ({D.size}) : concordantes avec le calcul.</StkMsg>);
    else blocks.push(<StkMsg key={label} tone="warn">{label} annoncées par le parc : {D.size} · calculées : {Cc.size}.{onlyD.length ? ` Annoncées mais non constatées : ${onlyD.join(", ")}.` : ""}{onlyC.length ? ` Constatées mais non annoncées : ${onlyC.join(", ")}.` : ""}</StkMsg>);
  };
  if (parsed.declEntrees.length) cmp(parsed.declEntrees, preview.entrees, "Entrées");
  if (parsed.declSorties.length) cmp(parsed.declSorties, preview.sorties, "Sorties");
  const d = parsed.declared || {};
  if (d.initial != null && d.final != null) blocks.push(<div key="t" className="text-xs text-slate-500">Résumé du parc : stock initial {d.initial} · entrées {d.entrees != null ? d.entrees : "?"} · sorties {d.sorties != null ? d.sorties : "?"} · stock final {d.final}</div>);
  return <>{blocks}</>;
}
function StkManualHeader({ wb, onApply }) {
  const [sheet, setSheet] = useState(wb.SheetNames[0]);
  const [line, setLine] = useState(1);
  const rows = useMemo(() => stkSheetRows(wb.Sheets[sheet]), [sheet]);
  const off = rows.offset || 0;
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-3 items-end">
      <StkField label="Onglet"><select value={sheet} onChange={(e) => setSheet(e.target.value)} className={stkInput}>{wb.SheetNames.map((n) => <option key={n}>{n}</option>)}</select></StkField>
      <StkField label="Ligne d'en-tête (numéro Excel)"><input type="number" min="1" value={line} onChange={(e) => setLine(Number(e.target.value))} className={stkInput} /></StkField>
      <StkBtn kind="primary" onClick={() => onApply(sheet, Math.max(0, line - off - 1))}>Lire à partir de cette ligne</StkBtn>
    </div>
    <div className="overflow-x-auto"><table className="text-xs"><tbody>{rows.slice(0, 25).map((r, i) => <tr key={i} className={i === line - off - 1 ? "bg-amber-100" : ""}><td className="pr-2 text-slate-400">{i + off + 1}</td>{(r || []).slice(0, 14).map((c, j) => <td key={j} className="px-2 py-0.5 border border-slate-100 whitespace-nowrap max-w-[160px] truncate">{stkText(c)}</td>)}</tr>)}</tbody></table></div>
  </div>;
}
function StkMappingModal({ sheet, wb, onClose, onApply }) {
  const rows = useMemo(() => stkSheetRows(wb.Sheets[sheet.name]), []);
  const off = rows.offset || 0;
  const [line, setLine] = useState(sheet.headerLine);
  const hr = Math.max(0, line - off - 1);
  const header = rows[hr] || [];
  const width = Math.max(header.length, ...rows.slice(hr + 1, hr + 30).map((r) => (r || []).length));
  const [map, setMap] = useState(() => ({ ...sheet.mapping }));
  const colField = {};
  Object.entries(map).forEach(([f, j]) => { colField[j] = f; });
  const setCol = (j, field) => {
    const m = { ...map };
    Object.keys(m).forEach((f) => { if (m[f] === j) delete m[f]; });
    if (field && field !== "ignore") { delete m[field]; m[field] = j; }
    setMap(m);
  };
  const sample = (j) => rows.slice(hr + 1, hr + 40).map((r) => r && r[j]).filter((v) => v != null && stkText(v) !== "").slice(0, 3).map((v) => v instanceof Date ? stkFmt(stkParseDate(v).iso) : stkText(v)).join(" · ");
  return <StkModal wide title={`Correspondance des colonnes · onglet « ${sheet.name} »`} onClose={onClose} footer={<><StkBtn onClick={onClose}>Fermer</StkBtn><StkBtn kind="primary" disabled={map.chassis == null} onClick={() => onApply(map, hr)}>Appliquer et relire</StkBtn></>}>
    <div className="space-y-3">
      <StkMsg tone="info">Vérifiez à quoi correspond chaque colonne. La correspondance validée est mémorisée pour ce parc : les prochains fichiers de même présentation seront lus automatiquement.</StkMsg>
      <StkField label="Ligne d'en-tête (numéro Excel)"><input type="number" min="1" value={line} onChange={(e) => setLine(Number(e.target.value) || 1)} className={`${stkInput} max-w-[140px]`} /></StkField>
      <div className="overflow-x-auto"><table className="w-full text-sm min-w-[620px]"><thead><tr className="text-left text-[11px] uppercase text-slate-500 border-b-2 border-slate-200"><th className="py-2 px-2">Col.</th><th className="px-2">En-tête du fichier</th><th className="px-2">Exemples de valeurs</th><th className="px-2">Correspond à</th></tr></thead>
        <tbody>{Array.from({ length: width }).map((_, j) => <tr key={j} className="border-b border-slate-100">
          <td className="py-1.5 px-2 text-slate-400">{XLSX.utils.encode_col(j)}</td>
          <td className="px-2 font-semibold">{stkText(header[j]) || <span className="text-slate-300">(vide)</span>}</td>
          <td className="px-2 text-xs text-slate-500 max-w-[260px] truncate">{sample(j)}</td>
          <td className="px-2"><select value={colField[j] || "ignore"} onChange={(e) => setCol(j, e.target.value)} className={`${stkInput} py-1`}>{Object.entries(STK_FIELDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
        </tr>)}</tbody></table></div>
      {map.chassis == null && <StkMsg tone="err">Indiquez la colonne des châssis.</StkMsg>}
    </div>
  </StkModal>;
}

// ---------------- Administration du module stock ----------------
function StkAdmin() {
  const [tab, setTab] = useState("params");
  return <>
    <StkPageHead title="Administration du suivi des stocks" sub="Contrôle total : paramètres, parcs, lecture des fichiers, journal et corbeille. Véhicules et mouvements se modifient depuis leur fiche." />
    <StkTabs tabs={[{ key: "params", label: "Paramètres" }, { key: "users", label: "Utilisateurs" }, { key: "parcs", label: "Parcs" }, { key: "backup", label: "Sauvegarde" }, { key: "syn", label: "Noms de colonnes" }, { key: "tpl", label: "Modèles de fichiers" }, { key: "alias", label: "Châssis corrigés" }, { key: "audit", label: "Journal" }, { key: "trash", label: "Corbeille" }]} value={tab} onChange={setTab} />
    {tab === "users" && <StkAdminUsers />}
    {tab === "backup" && <StkAdminBackup />}
    {tab === "alias" && <StkAdminAliases />}
    {tab === "params" && <StkAdminParams />}
    {tab === "parcs" && <StkAdminParcs />}
    {tab === "syn" && <StkAdminSynonyms />}
    {tab === "tpl" && <StkAdminTemplates />}
    {tab === "audit" && <StkAdminAudit />}
    {tab === "trash" && <StkAdminTrash />}
  </>;
}
function StkAdminParams() {
  const C = React.useContext(StkCtx);
  const S = C.settings || {};
  const [f, setF] = useState({ source_depot: S.source_depot === "mmte" ? "mmte" : "parc", duree_sejour: S.duree_sejour || 365, seuil_alerte: S.seuil_alerte || 30, fenetre_transfert: S.fenetre_transfert || 30, afficher_transfert: S.afficher_transfert !== false, types_sortie: (C.cfg.types || []).join("\n") });
  const [msg, setMsg] = useState("");
  const save = async () => {
    try {
      await stkCall("settings_save", { key: "duree_sejour", value: Number(f.duree_sejour) || 365 });
      await stkCall("settings_save", { key: "seuil_alerte", value: Number(f.seuil_alerte) || 30 });
      await stkCall("settings_save", { key: "fenetre_transfert", value: Number(f.fenetre_transfert) || 30 });
      await stkCall("settings_save", { key: "afficher_transfert", value: !!f.afficher_transfert });
      await stkCall("settings_save", { key: "source_depot", value: f.source_depot });
      await stkCall("settings_save", { key: "types_sortie", value: f.types_sortie.split("\n").map((x) => x.trim()).filter(Boolean) });
      setMsg("Paramètres enregistrés."); C.reloadAll();
    } catch (e) { setMsg(stkErrText(e)); }
  };
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  return <StkCard className="p-4 md:p-5 space-y-4 max-w-2xl">
    <div className="grid md:grid-cols-3 gap-3">
      <StkField label="Durée de séjour (jours)" hint="Passage au statut dépôt après cette durée, depuis la date d'arrivée du navire"><input type="number" value={f.duree_sejour} onChange={set("duree_sejour")} className={stkInput} /></StkField>
      <StkField label="Alerte « bientôt en dépôt » (jours)"><input type="number" value={f.seuil_alerte} onChange={set("seuil_alerte")} className={stkInput} /></StkField>
      <StkField label="Fenêtre de détection des transferts (jours)" hint="Sortie d'un parc puis entrée dans un autre dans ce délai = transfert"><input type="number" value={f.fenetre_transfert} onChange={set("fenetre_transfert")} className={stkInput} /></StkField>
    </div>
    <StkField label="Date de dépôt utilisée" hint="La date MMTE est connue après un « Contrôle avec MMTE ». Sans elle, la date calculée reste utilisée."><select value={f.source_depot} onChange={set("source_depot")} className={stkInput}><option value="parc">Calculée : date d'arrivée du fichier du parc + durée de séjour</option><option value="mmte">Date de dépôt MMTE quand elle est connue (sinon calculée)</option></select></StkField>
    <label className="flex items-center gap-3 text-sm font-semibold text-slate-700"><input type="checkbox" checked={f.afficher_transfert} onChange={set("afficher_transfert")} /> Afficher la date de transfert dans les listes, fiches et exports</label>
    <StkField label="Types de sortie (un par ligne)"><textarea rows={6} value={f.types_sortie} onChange={set("types_sortie")} className={stkInput} /></StkField>
    {msg && <StkMsg tone={/Erreur|réservée/.test(msg) ? "err" : "ok"}>{msg}</StkMsg>}
    <StkBtn kind="primary" onClick={save}>Enregistrer</StkBtn>
  </StkCard>;
}
function StkAdminParcs() {
  const C = React.useContext(StkCtx);
  const [rows, setRows] = useState(null);
  const [edit, setEdit] = useState(null);
  const load = async () => { try { setRows(await stkCall("parcs_list")); } catch (e) { alert(stkErrText(e)); } };
  useEffect(() => { load(); }, []);
  const act = async (a, p, conf) => { if (conf && !window.confirm(conf)) return; try { await stkCall(a, p); load(); C.reloadDash(); } catch (e) { alert(stkErrText(e)); } };
  const cols = [
    { key: "name", label: "Parc", render: (r) => <b className={r.deleted_at ? "line-through text-slate-400" : ""}>{r.name}</b> },
    { key: "active", label: "État", render: (r) => r.deleted_at ? <StkBadge>Corbeille</StkBadge> : r.active ? <StkBadge tone="bg-emerald-50 text-emerald-800 border-emerald-200">Actif</StkBadge> : <StkBadge>Masqué</StkBadge> },
    { key: "note", label: "Note", render: (r) => <span className="text-slate-500">{r.note}</span> },
    { key: "act", label: "", sortable: false, render: (r) => <div className="flex gap-2 justify-end" onClick={(e) => e.stopPropagation()}>
      {r.deleted_at ? <StkBtn small onClick={() => act("parc_restore", { id: r.id })}>Restaurer</StkBtn> : <>
        <StkBtn small onClick={() => setEdit(r)}>Modifier</StkBtn>
        <StkBtn small onClick={() => act("parc_save", { id: r.id, active: !r.active })}>{r.active ? "Masquer" : "Afficher"}</StkBtn>
        <StkBtn small kind="danger" onClick={() => act("parc_delete", { id: r.id }, `Mettre le parc ${r.name} à la corbeille ? Son historique est conservé.`)}>Supprimer</StkBtn></>}
    </div> }
  ];
  return <StkCard className="p-4 md:p-5 space-y-3">
    <div className="flex items-center gap-2"><div className="text-sm text-slate-500 flex-1">La liste est reprise automatiquement des parcs d'INVENTAIRE MMTE. Vous pouvez aussi en ajouter, renommer, masquer ou supprimer ici.</div><StkBtn small kind="primary" onClick={() => setEdit({})}><StkIc.Plus size={14} /> Ajouter un parc</StkBtn></div>
    {!rows ? <StkLoading /> : <StkTable columns={cols} rows={rows} rowKey={(r) => r.id} />}
    {edit && <StkParcForm parc={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); C.reloadDash(); }} />}
  </StkCard>;
}
function StkParcForm({ parc, onClose, onSaved }) {
  const [name, setName] = useState(parc.name || "");
  const [note, setNote] = useState(parc.note || "");
  const [err, setErr] = useState("");
  const save = async () => { try { await stkCall("parc_save", parc.id ? { id: parc.id, name, note } : { name, note, active: true }); onSaved(); } catch (e) { setErr(stkErrText(e)); } };
  return <StkModal title={parc.id ? "Modifier le parc" : "Ajouter un parc"} onClose={onClose} footer={<><StkBtn onClick={onClose}>Annuler</StkBtn><StkBtn kind="primary" disabled={!name.trim()} onClick={save}>Enregistrer</StkBtn></>}>
    <div className="space-y-3"><StkField label="Nom du parc"><input value={name} onChange={(e) => setName(e.target.value)} className={stkInput} /></StkField><StkField label="Note"><input value={note} onChange={(e) => setNote(e.target.value)} className={stkInput} /></StkField>{err && <StkMsg tone="err">{err}</StkMsg>}</div>
  </StkModal>;
}
function StkAdminSynonyms() {
  const [rows, setRows] = useState(null);
  const [field, setField] = useState("chassis");
  const [syn, setSyn] = useState("");
  const load = async () => { try { const t = await stkCall("templates", {}); setRows(t.synonyms); } catch (e) { alert(stkErrText(e)); } };
  useEffect(() => { load(); }, []);
  const add = async () => { if (!syn.trim()) return; try { await stkCall("synonym_save", { field, synonym: stkNorm(syn) }); setSyn(""); load(); } catch (e) { alert(stkErrText(e)); } };
  const del = async (id) => { if (!window.confirm("Supprimer ce nom de colonne ?")) return; try { await stkCall("synonym_delete", { id }); load(); } catch (e) { alert(stkErrText(e)); } };
  const fields = Object.entries(STK_FIELDS).filter(([k]) => k !== "ignore");
  return <StkCard className="p-4 md:p-5 space-y-4">
    <div className="text-sm text-slate-500">Noms de colonnes appris en plus de ceux reconnus d'office. Ils s'ajoutent automatiquement quand une correspondance est corrigée à l'import.</div>
    <div className="flex flex-wrap gap-2 items-end">
      <StkField label="Champ"><select value={field} onChange={(e) => setField(e.target.value)} className={stkInput}>{fields.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></StkField>
      <StkField label="Nom de colonne dans les fichiers"><input value={syn} onChange={(e) => setSyn(e.target.value)} className={stkInput} placeholder="ex. N° DE SERIE" /></StkField>
      <StkBtn kind="primary" onClick={add}><StkIc.Plus size={14} /> Ajouter</StkBtn>
    </div>
    {!rows ? <StkLoading /> : <StkTable rowKey={(r) => r.id} rows={rows} columns={[{ key: "synonym", label: "Nom (normalisé)", render: (r) => <span className="font-plex-mono">{r.synonym}</span> }, { key: "field", label: "Correspond à", render: (r) => STK_FIELDS[r.field] || r.field }, { key: "x", label: "", sortable: false, render: (r) => <div className="text-right"><StkBtn small kind="danger" onClick={() => del(r.id)}>Supprimer</StkBtn></div> }]} empty="Aucun nom ajouté pour l'instant." />}
    <details className="text-xs text-slate-500"><summary className="cursor-pointer font-bold">Noms reconnus d'office</summary><div className="mt-2 space-y-1">{Object.entries(STK_BASE_SYNONYMS).map(([k, l]) => <div key={k}><b>{STK_FIELDS[k]}</b> : {l.join(", ")}</div>)}</div></details>
  </StkCard>;
}
function StkAdminTemplates() {
  const [rows, setRows] = useState(null);
  const load = async () => { try { setRows(await stkCall("templates_all")); } catch (e) { alert(stkErrText(e)); } };
  useEffect(() => { load(); }, []);
  const del = async (id) => { if (!window.confirm("Supprimer ce modèle ? Le prochain fichier de ce parc sera relu automatiquement.")) return; try { await stkCall("template_delete", { id }); load(); } catch (e) { alert(stkErrText(e)); } };
  return <StkCard className="p-4 md:p-5 space-y-3">
    <div className="text-sm text-slate-500">Présentation de fichier mémorisée pour chaque parc (colonnes et ligne d'en-tête). Supprimez un modèle si un parc change complètement de présentation.</div>
    {!rows ? <StkLoading /> : <StkTable rowKey={(r) => r.id} rows={rows} columns={[{ key: "parc", label: "Parc", sort: (r) => r.parcs && r.parcs.name, render: (r) => <b>{r.parcs && r.parcs.name}</b> }, { key: "sheet", label: "Onglet" }, { key: "mapping", label: "Colonnes", sortable: false, render: (r) => <span className="text-xs text-slate-600">{Object.entries(r.mapping || {}).map(([f, j]) => `${STK_FIELDS[f] || f} → ${XLSX.utils.encode_col(j)}`).join(" · ")}</span> }, { key: "updated_at", label: "Mis à jour", render: (r) => <span className="text-xs">{stkFmtTs(r.updated_at)}<br />{r.updated_by}</span> }, { key: "x", label: "", sortable: false, render: (r) => <StkBtn small kind="danger" onClick={() => del(r.id)}>Supprimer</StkBtn> }]} empty="Aucun modèle mémorisé." />}
  </StkCard>;
}
function StkAdminAudit() {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState("");
  const load = async () => { try { setRows(await stkCall("audit", { q, limit: 500 })); } catch (e) { alert(stkErrText(e)); } };
  useEffect(() => { load(); }, []);
  return <StkCard className="p-4 md:p-5 space-y-3">
    <form onSubmit={(e) => { e.preventDefault(); load(); }} className="flex gap-2"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher dans le journal (nom, châssis, parc...)" className={`${stkInput} flex-1`} /><StkBtn type="submit">Rechercher</StkBtn></form>
    {!rows ? <StkLoading /> : <StkTable rowKey={(r) => r.id} rows={rows} columns={[{ key: "at", label: "Date", render: (r) => <span className="text-xs whitespace-nowrap">{stkFmtTs(r.at)}</span> }, { key: "by_name", label: "Par", render: (r) => <b>{r.by_name}</b> }, { key: "action", label: "Action" }, { key: "detail", label: "Détail", render: (r) => <span className="text-slate-600">{r.detail}</span> }]} empty="Journal vide." />}
  </StkCard>;
}
function StkAdminTrash() {
  const C = React.useContext(StkCtx);
  const [d, setD] = useState(null);
  const load = async () => { try { setD(await stkCall("trash")); } catch (e) { alert(stkErrText(e)); } };
  useEffect(() => { load(); }, []);
  const act = async (a, p, conf) => { if (conf && !window.confirm(conf)) return; try { await stkCall(a, p); load(); C.reloadDash(); } catch (e) { alert(stkErrText(e)); } };
  if (!d) return <StkLoading />;
  const Row = ({ label, sub, onRestore, onPurge }) => <div className="flex flex-wrap items-center gap-2 py-2 border-b border-slate-100"><div className="flex-1 min-w-[200px]"><b>{label}</b><div className="text-xs text-slate-500">{sub}</div></div><StkBtn small onClick={onRestore}><RotateCcw size={14} /> Restaurer</StkBtn><StkBtn small kind="danger" onClick={onPurge}>Supprimer définitivement</StkBtn></div>;
  return <StkCard className="p-4 md:p-5 space-y-4">
    <div><div className="font-bold text-[#0B1F38] mb-1">Véhicules ({d.vehicles.length})</div>{d.vehicles.map((v) => <Row key={v.id} label={v.chassis} sub={`${stkVeh(v)} · supprimé le ${stkFmtTs(v.deleted_at)}`} onRestore={() => act("vehicle_restore", { id: v.id })} onPurge={() => act("purge", { entity: "vehicle", id: v.id }, "Suppression définitive du véhicule et de tout son historique ?")} />)}</div>
    <div><div className="font-bold text-[#0B1F38] mb-1">Mouvements ({d.stays.length})</div>{d.stays.map((s) => <Row key={s.id} label={`${s.vehicles && s.vehicles.chassis} — ${s.parcs && s.parcs.name}`} sub={`Entrée ${stkFmt(s.entry_date)}${s.exit_date ? " · sortie " + stkFmt(s.exit_date) : ""} · supprimé le ${stkFmtTs(s.deleted_at)}`} onRestore={() => act("stay_restore", { id: s.id })} onPurge={() => act("purge", { entity: "stay", id: s.id }, "Suppression définitive de ce mouvement ?")} />)}</div>
    <div><div className="font-bold text-[#0B1F38] mb-1">Parcs ({d.parcs.length})</div>{d.parcs.map((p) => <Row key={p.id} label={p.name} sub={`Supprimé le ${stkFmtTs(p.deleted_at)}`} onRestore={() => act("parc_restore", { id: p.id })} onPurge={() => act("purge", { entity: "parc", id: p.id }, "Suppression définitive du parc ? (impossible s'il a un historique)")} />)}</div>
  </StkCard>;
}

// ---------------- Choix de l'application après connexion ----------------
function StkAppChooser({ name, onChoose }) {
  const now = useNow();
  const Card = ({ k, title, text, Ic, tone }) => <button onClick={() => onChoose(k)} data-testid={"choose-" + k} className="group text-left bg-white rounded-3xl border-2 border-slate-200 hover:border-[#1B4F8C] shadow-sm hover:shadow-xl transition p-6 md:p-8 flex flex-col gap-4">
    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-white ${tone}`}><Ic size={28} /></div>
    <div><div className="font-semibold text-2xl text-[#0B1F38]" style={{ fontFamily: "'Sora',system-ui,sans-serif" }}>{title}</div><div className="text-sm text-slate-600 mt-2 leading-relaxed">{text}</div></div>
    <div className="mt-auto inline-flex items-center gap-1 text-sm font-bold text-[#1B4F8C]">Ouvrir <StkIc.Chev size={16} /></div>
  </button>;
  return <div className="max-w-4xl mx-auto px-5 py-8 md:py-14 space-y-8">
    <div className="mmte-welcome"><div><div className="mmte-welcome-hi">{greetingWord(now)}{name ? `, ${name}` : ""}</div><div className="mmte-welcome-date">{formatDateFr(now)}</div></div></div>
    <div className="text-center"><h2 className="text-2xl md:text-3xl font-semibold text-[#0B1F38]">Quelle application voulez-vous ouvrir ?</h2></div>
    <div className="grid md:grid-cols-2 gap-5">
      <Card k="inventaire" title="Inventaire MMTE" Ic={(p) => <ScanLine {...p} />} tone="bg-gradient-to-br from-[#2E7DC1] to-[#123A66]" text="Inventaire physique des parcs : pointage des châssis par scan, liste MMTE, manquants, fiches et rapports." />
      <Card k="stock" title="Suivi des stocks" Ic={(p) => <StkIc.Layers {...p} />} tone="bg-gradient-to-br from-[#C9A96A] to-[#8A6A2E]" text="Stock hebdomadaire de chaque parc : entrées, sorties, véhicules en dépôt, historique complet de chaque châssis et justification des sorties." />
    </div>
  </div>;
}
