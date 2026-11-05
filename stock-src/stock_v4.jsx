// ============================================================
// STOCK MMTE — Import groupé du lundi (plusieurs fichiers de parcs en une fois)
// ============================================================

// Données envoyées au serveur pour un import (utilisé par l'import simple et l'import groupé)
function stkCommitPayload({ parsed, parcName, date, file, comment, forced, synonyms, applied }) {
  const first = parsed.sheets.filter((s) => s.role === "stock")[0];
  const newSyn = [];
  Object.keys(forced || {}).forEach((sn) => {
    const sh = parsed.sheets.find((s) => s.name === sn);
    if (!sh) return;
    Object.entries(sh.mapping).forEach(([field, j]) => {
      const h = sh.header[j];
      if (h && field !== "ignore" && stkFieldForHeader(h, stkBuildSynonyms(synonyms)) !== field) newSyn.push({ field, synonym: stkNorm(h) });
    });
  });
  return {
    parc_name: String(parcName).trim().toUpperCase(), stock_date: date, file_name: file.name, file_size: file.size,
    sheets: parsed.sheets.map((s) => s.name), header_row: first ? first.headerLine : null, mapping: first ? first.mapping : null,
    declared: parsed.declared, nb_lignes: parsed.rows.length, comment: comment || "",
    anomalies: (applied ? applied.anomalies : parsed.anomalies).map((a) => ({ ...a, items: (a.items || []).slice(0, 300) })),
    aliases: applied ? applied.aliases : [],
    rows: (applied ? applied.rows : parsed.rows).map((r) => ({ chassis: r.chassis, chassis_raw: r.chassis_raw, marque: r.marque, modele: r.modele, annee: r.annee, navire: r.navire, manifeste: r.manifeste, bl: r.bl, date_arrivee: r.date_arrivee, date_transfert: r.date_transfert, importateur: r.importateur, data: r.statut ? { ...r.data, "Statut (fichier)": r.statut } : r.data })),
    template: first ? { signature: first.signature, mapping: first.mapping, header_row: first.headerRow, sheet: first.name } : null,
    new_synonyms: newSyn
  };
}

// Reconnaît le parc d'un fichier : par son nom, sinon par la forme du tableau déjà connue (modèle enregistré)
function stkGuessParc(fileName, book, parcNames, templates) {
  const fn = stkNorm(fileName.replace(/\.[a-z0-9]+$/i, ""));
  const byName = parcNames.filter((n) => stkNorm(n).length >= 3 && fn.includes(stkNorm(n))).sort((a, b) => stkNorm(b).length - stkNorm(a).length);
  if (byName.length) return { parc: byName[0], how: "nom" };
  // Nom abrégé dans le fichier (ex. « Stock_ZF » pour « ZF PARC AUTO ») : premier mot du parc, s'il ne désigne qu'un seul parc
  const words = new Set(fileName.replace(/\.[a-z0-9]+$/i, "").split(/[^A-Za-z0-9]+/).map(stkNorm).filter((w) => w.length >= 2));
  const byWord = parcNames.filter((n) => { const w = stkNorm(String(n).split(/\s+/)[0]); return w.length >= 2 && words.has(w); });
  if (byWord.length === 1) return { parc: byWord[0], how: "nom" };
  const sigs = new Set();
  try {
    book.SheetNames.forEach((sn) => {
      const rows = stkSheetRows(book.Sheets[sn]);
      for (let i = 0; i < Math.min(rows.length, 40); i++) sigs.add(stkHeaderSignature(rows[i] || []));
    });
  } catch (e) {}
  const hits = Array.from(new Set((templates || []).filter((t) => sigs.has(t.signature) && t.parcs && t.parcs.name).map((t) => t.parcs.name)));
  if (hits.length === 1 && parcNames.includes(hits[0])) return { parc: hits[0], how: "modele" };
  return { parc: "", how: "" };
}

let stkBulkSeq = 1;
function StkBulkImport() {
  const C = React.useContext(StkCtx);
  const { cfg, dash, reloadDash, openParc, go } = C;
  const [date, setDate] = useState(stkToday());
  const [items, setItems] = useState([]);
  const [ref, setRef] = useState(null); // modèles de lecture de tous les parcs + noms de colonnes
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [showList, setShowList] = useState(null);
  const [review, setReview] = useState(null); // id du fichier dont on revoit les points
  const me = C.userName || (C.me && C.me.name);
  const inputRef = useRef(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const parcNames = useMemo(() => Array.from(new Set(dash.filter((d) => d.active !== false).map((d) => d.parc))).sort(), [dash]);
  const upd = (id, patch) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...(typeof patch === "function" ? patch(x) : patch) } : x)));

  const loadRef = async () => {
    if (ref) return ref;
    let r = { templates: [], synonyms: [] };
    try { r = await stkCall("templates_bulk", {}); } catch (e) {}
    setRef(r);
    return r;
  };

  // Lecture d'un fichier pour un parc, puis comparaison avec le dernier stock de ce parc
  const analyse = async (it, parcName, R) => {
    const tpls = (R.templates || []).filter((t) => t.parcs && t.parcs.name === parcName);
    let parsed;
    try { parsed = stkApplyAliases(stkParseWorkbook(it.wb, { synonyms: R.synonyms, templates: tpls }), R.aliases); }
    catch (e) { upd(it.id, { status: "erreur", err: "Lecture impossible : " + (e.message || e), parsed: null, preview: null }); return; }
    if (!parsed.rows.length) { upd(it.id, { parsed, preview: null, status: "illisible", err: "" }); return; }
    if (!parcName) { upd(it.id, { parsed, preview: null, status: "sans_parc", err: "" }); return; }
    upd(it.id, { parsed, preview: null, status: "comparaison", err: "" });
    try {
      const preview = await stkCall("preview_import", { parc_name: parcName, chassis: Array.from(new Set(parsed.rows.map((r) => r.chassis))) });
      upd(it.id, (x) => (x.parc === parcName ? { preview, status: "pret" } : {}));
    } catch (e) { upd(it.id, (x) => (x.parc === parcName ? { status: "erreur", err: stkErrText(e) } : {})); }
  };

  const addFiles = async (list) => {
    const files = Array.from(list || []).filter((f) => /\.(xlsx|xls|xlsm|xlsb|ods|csv|txt)$/i.test(f.name));
    if (!files.length) return;
    setDone(false);
    const fresh = files.map((f) => ({ id: stkBulkSeq++, file: f, wb: null, parc: "", how: "", parsed: null, preview: null, status: "lecture", err: "", include: true, result: null }));
    setItems((xs) => [...xs, ...fresh]);
    const R = await loadRef();
    // 3 fichiers analysés à la fois
    let k = 0;
    const worker = async () => {
      while (k < fresh.length) {
        const it = fresh[k++];
        try {
          const book = XLSX.read(await it.file.arrayBuffer(), { cellDates: true, type: "array" });
          const g = stkGuessParc(it.file.name, book, parcNames, R.templates);
          const cur = { ...it, wb: book, parc: g.parc, how: g.how };
          upd(it.id, { wb: book, parc: g.parc, how: g.how });
          await analyse(cur, g.parc, R);
        } catch (e) { upd(it.id, { status: "erreur", err: "Fichier illisible : " + (e.message || e) }); }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  };

  const changeParc = async (it, parcName) => {
    upd(it.id, { parc: parcName, how: parcName ? "manuel" : "", preview: null, status: parcName ? "comparaison" : "sans_parc", result: null });
    const R = await loadRef();
    await analyse({ ...it, parc: parcName }, parcName, R);
  };
  const remove = (id) => setItems((xs) => xs.filter((x) => x.id !== id));

  // Contrôles avant import
  const countBy = {};
  items.forEach((x) => { if (x.include && x.parc && x.status !== "ok") countBy[x.parc] = (countBy[x.parc] || 0) + 1; });
  const isDup = (x) => x.parc && countBy[x.parc] > 1;
  const issuesOf = (x) => (x.parsed ? stkBuildIssues(x.parsed, x.preview, date) : []);
  const pendingOf = (x) => issuesOf(x).filter((i) => !(x.decisions || {})[i.key]).length;
  const ready = items.filter((x) => x.include && x.status === "pret" && !isDup(x) && !pendingOf(x));
  const toReview = items.filter((x) => x.include && x.status === "pret" && !isDup(x) && pendingOf(x));
  const blocking = items.filter((x) => x.include && x.status !== "ok" && (x.status !== "pret" || isDup(x)));
  const analysing = items.some((x) => x.status === "lecture" || x.status === "comparaison");
  const inBatch = new Set(items.filter((x) => x.parc && x.status !== "erreur").map((x) => x.parc));
  const monday = stkMonday(date);
  const missing = dash.filter((d) => d.active !== false && !inBatch.has(d.parc) && (!d.last_import || d.last_import < monday));

  const importAll = async () => {
    if (!ready.length) return;
    if (!window.confirm(`Importer ${ready.length} fichier(s) avec la date de stock du ${stkFmt(date)} ?`)) return;
    setRunning(true);
    const R = await loadRef();
    for (const it of ready) {
      upd(it.id, { status: "import", err: "" });
      try {
        const applied = stkApplyDecisions(it.parsed, issuesOf(it), it.decisions || {}, me);
        const res = await stkCall("commit_import", stkCommitPayload({ parsed: it.parsed, parcName: it.parc, date, file: it.file, comment: "Import groupé", forced: {}, synonyms: R.synonyms, applied }));
        upd(it.id, { status: "ok", result: res });
      } catch (e) { upd(it.id, { status: "echec", err: stkErrText(e) }); }
    }
    setRunning(false); setDone(true);
    reloadDash();
  };
  const retryFailed = () => setItems((xs) => xs.map((x) => (x.status === "echec" ? { ...x, status: "pret", err: "" } : x)));

  if (!stkCanEdit(C)) return <><StkPageHead title="Import groupé du lundi" /><StkMsg tone="warn">Votre accès au suivi des stocks est en consultation seule : l'import est réservé aux agents MMTE.</StkMsg></>;

  const okItems = items.filter((x) => x.status === "ok");
  const tot = okItems.reduce((a, x) => ({ v: a.v + (x.result.nb_chassis || 0), e: a.e + (x.result.entrees || 0), s: a.s + (x.result.sorties || 0), t: a.t + (x.result.transferts || 0) }), { v: 0, e: 0, s: 0, t: 0 });
  const ST = {
    lecture: ["Lecture...", "bg-slate-100 text-slate-600 border-slate-200"],
    comparaison: ["Comparaison...", "bg-slate-100 text-slate-600 border-slate-200"],
    pret: ["Prêt", "bg-emerald-50 text-emerald-800 border-emerald-200"],
    sans_parc: ["Parc à choisir", "bg-amber-50 text-amber-900 border-amber-300"],
    illisible: ["Tableau non reconnu", "bg-amber-50 text-amber-900 border-amber-300"],
    erreur: ["Erreur", "bg-rose-50 text-rose-800 border-rose-200"],
    import: ["Import en cours...", "bg-sky-50 text-sky-800 border-sky-200"],
    ok: ["Importé", "bg-emerald-600 text-white border-emerald-600"],
    echec: ["Échec", "bg-rose-50 text-rose-800 border-rose-200"]
  };

  return <>
    <StkPageHead title="Import groupé du lundi" sub="Déposez d'un coup tous les fichiers reçus des parcs. L'outil reconnaît le parc de chaque fichier (par son nom ou par la forme de son tableau), compare avec le dernier stock de chaque parc, puis importe tout à la suite." right={<StkBtn small onClick={() => go("import")}><Upload size={14} /> Import d'un seul fichier</StkBtn>} />
    <StkCard className="p-4 md:p-5 space-y-4">
      <div className="grid md:grid-cols-3 gap-3">
        <StkField label="Date du stock (pour tous les fichiers)" hint="Les fichiers arrivés en retard sont signalés et insérés à leur place dans l'historique."><input type="date" value={date} disabled={running} onChange={(e) => setDate(e.target.value)} className={stkInput} data-testid="bulk-date" /></StkField>
      </div>
      <label className="block rounded-2xl border-2 border-dashed border-[#1B4F8C]/30 bg-[#F4F8FC] hover:bg-[#EAF1FA] p-6 text-center cursor-pointer"
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (!running) addFiles(e.dataTransfer.files); }}>
        <input ref={inputRef} type="file" multiple className="hidden" disabled={running} accept=".xlsx,.xls,.xlsm,.xlsb,.ods,.csv,.txt" data-testid="bulk-files" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        <FileSpreadsheet size={30} className="mx-auto text-[#1B4F8C]" />
        <div className="font-bold text-[#123A66] mt-2">{items.length ? "Ajouter d'autres fichiers" : "Déposer ici tous les fichiers de la semaine, ou cliquer pour les choisir"}</div>
        <div className="text-xs text-slate-500 mt-1">Plusieurs fichiers à la fois · .xlsx, .xls, .xlsm, .ods, .csv</div>
      </label>
    </StkCard>

    {items.length > 0 && <StkCard className="p-0 overflow-hidden">
      <div className="overflow-x-auto"><table className="w-full text-sm min-w-[860px]" data-testid="bulk-table">
        <thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200 bg-slate-50">
          <th className="py-2.5 px-3 w-8"></th><th className="px-2">Fichier</th><th className="px-2 w-56">Parc</th><th className="px-2 text-right">Véhicules</th><th className="px-2 text-right">Entrées</th><th className="px-2 text-right">Sorties</th><th className="px-2">État</th><th className="px-2"></th>
        </tr></thead>
        <tbody>{items.map((x) => {
          const pv = x.preview, ps = x.parsed;
          const late = pv && pv.last_stock_date && date < pv.last_stock_date;
          const same = pv && pv.last_stock_date && date === pv.last_stock_date;
          const nIssues = issuesOf(x).length, nPending = pendingOf(x);
          const [label, tone] = isDup(x) && x.status !== "ok" ? ["Deux fichiers pour ce parc", "bg-rose-50 text-rose-800 border-rose-200"]
            : x.status === "pret" && nPending ? [`${nPending} point(s) à décider`, "bg-amber-50 text-amber-900 border-amber-300"] : ST[x.status] || ST.erreur;
          const res = x.result;
          return <tr key={x.id} className={`border-b border-slate-100 align-top ${x.include ? "" : "opacity-50"}`} data-testid="bulk-row">
            <td className="py-2.5 px-3"><input type="checkbox" checked={x.include} disabled={running || x.status === "ok"} onChange={(e) => upd(x.id, { include: e.target.checked })} aria-label="Inclure ce fichier" /></td>
            <td className="px-2 py-2.5"><div className="font-semibold text-[#0B1F38] break-all">{x.file.name}</div>
              <div className="text-[11px] text-slate-500">{(x.file.size / 1024).toFixed(0)} Ko{ps && ps.sheets.length ? ` · ${ps.sheets.length} onglet(s) lu(s)` : ""}{x.how === "nom" ? " · parc reconnu par le nom du fichier" : x.how === "modele" ? " · parc reconnu par la forme du tableau" : ""}</div>
              {late && <div className="text-[11px] text-amber-800 mt-0.5">Antérieur au dernier import du parc ({stkFmt(pv.last_stock_date)}) : l'historique sera recalculé.</div>}
              {same && <div className="text-[11px] text-amber-800 mt-0.5">Un import existe déjà pour ce parc à cette date.</div>}
              {nIssues > 0 && x.status !== "ok" && <button className={`text-[11px] underline mt-0.5 ${nPending ? "text-amber-800 font-bold" : "text-slate-500"}`} data-testid="bulk-review" onClick={() => setReview(x.id)}>{nPending ? `${nPending} point(s) à vérifier : corriger ou accepter` : `${nIssues} point(s) vérifié(s) : revoir`}</button>}
              {x.err && <div className="text-[11px] text-rose-700 mt-0.5">{x.err}</div>}
            </td>
            <td className="px-2 py-2"><select value={x.parc} disabled={running || x.status === "ok" || !x.wb} onChange={(e) => changeParc(x, e.target.value)} className={`${stkInput} py-1.5 ${!x.parc ? "border-amber-300 bg-amber-50" : ""}`} data-testid="bulk-parc">
              <option value="">— Choisir le parc —</option>{parcNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select></td>
            <td className="px-2 py-2.5 text-right font-plex-mono font-bold">{res ? res.nb_chassis : ps && ps.rows.length ? ps.unique : "—"}</td>
            <td className="px-2 py-2.5 text-right font-plex-mono text-emerald-700">{res ? (res.is_initial ? "initial" : res.entrees) : pv ? (pv.is_initial ? "initial" : <button className="underline" onClick={() => setShowList({ title: `${x.parc} — entrées`, items: pv.entrees })}>{pv.entrees.length}</button>) : "—"}</td>
            <td className="px-2 py-2.5 text-right font-plex-mono text-rose-700">{res ? (res.is_initial ? "" : res.sorties + (res.transferts ? ` (+${res.transferts} tr.)` : "")) : pv && !pv.is_initial ? <button className="underline" onClick={() => setShowList({ title: `${x.parc} — sorties`, items: pv.sorties })}>{pv.sorties.length}</button> : "—"}</td>
            <td className="px-2 py-2.5"><StkBadge tone={tone}>{label}</StkBadge></td>
            <td className="px-2 py-2 text-right whitespace-nowrap">
              {x.status === "ok" ? <StkBtn small kind="ghost" onClick={() => openParc(res.parc_id)}>Voir</StkBtn>
                : !running && <StkBtn small kind="ghost" onClick={() => remove(x.id)} aria-label="Retirer">Retirer</StkBtn>}
            </td>
          </tr>;
        })}</tbody>
      </table></div>
      <div className="p-4 md:p-5 space-y-3 border-t border-slate-200 bg-slate-50/60">
        {analysing && <StkMsg tone="info">Lecture et comparaison des fichiers en cours...</StkMsg>}
        {!analysing && blocking.length > 0 && !done && <StkMsg tone="warn">{blocking.length} fichier(s) ne seront pas importés tant qu'ils ne sont pas corrigés : choisissez le parc, retirez le fichier en double, ou décochez-le. Un fichier dont le tableau n'est pas reconnu s'importe seul depuis « Import d'un seul fichier » (correction des colonnes possible).</StkMsg>}
        {!analysing && toReview.length > 0 && !running && <StkMsg tone="warn"><div className="flex flex-wrap items-center gap-2"><span className="flex-1">{toReview.length} fichier(s) ont des points à vérifier : ouvrez « points à vérifier » sur chaque ligne pour corriger ou accepter.</span><StkBtn small onClick={() => { if (!window.confirm(`Accepter tels quels tous les points des ${toReview.length} fichier(s) ?`)) return; setItems((xs) => xs.map((y) => (toReview.some((t) => t.id === y.id) ? { ...y, decisions: Object.fromEntries(issuesOf(y).map((i) => [i.key, (y.decisions || {})[i.key] || { status: "accepte" }])) } : y))); }} data-testid="bulk-accept-all">Tout accepter tel quel</StkBtn></div></StkMsg>}
        {done && <StkMsg tone={items.some((x) => x.status === "echec") ? "warn" : "ok"}><b>{okItems.length} fichier(s) importé(s)</b> : {tot.v.toLocaleString("fr-FR")} véhicules, {tot.e} entrées, {tot.s} sorties, {tot.t} transferts.{items.some((x) => x.status === "echec") ? " Certains fichiers ont échoué (voir le détail) : vous pouvez relancer." : ""}</StkMsg>}
        <div className="flex flex-wrap gap-2 items-center">
          <StkBtn kind="primary" disabled={running || analysing || !ready.length} onClick={importAll} data-testid="bulk-go"><StkIc.Check size={16} /> {running ? "Import en cours..." : `Importer ${ready.length} fichier(s)`}</StkBtn>
          {items.some((x) => x.status === "echec") && !running && <StkBtn onClick={retryFailed}><RefreshCw size={16} /> Relancer les échecs</StkBtn>}
          {!running && <StkBtn kind="ghost" onClick={() => { setItems([]); setDone(false); }}>Tout effacer</StkBtn>}
        </div>
      </div>
    </StkCard>}

    {missing.length > 0 && <StkCard className="p-4 md:p-5 space-y-2 border-l-4 border-l-amber-400">
      <div className="font-bold text-[#0B1F38]">Parcs sans fichier pour la semaine du lundi {stkFmt(monday)} ({missing.length})</div>
      <div className="flex flex-wrap gap-2">{missing.map((d) => <span key={d.parc_id} className="px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-sm font-semibold text-amber-900">{d.parc}{d.last_import ? <span className="text-xs font-normal"> · dernier {stkFmt(d.last_import)}</span> : <span className="text-xs font-normal"> · jamais importé</span>}</span>)}</div>
    </StkCard>}
    {review && (() => { const x = items.find((y) => y.id === review); if (!x) return null; const iss = issuesOf(x);
      return <StkModal wide title={`${x.file.name} — points à vérifier`} onClose={() => setReview(null)} footer={<StkBtn kind="primary" onClick={() => setReview(null)}>Terminé</StkBtn>}>
        <StkAnomalyReview issues={iss} decisions={x.decisions || {}} setDecisions={(fn) => upd(x.id, (y) => ({ decisions: typeof fn === "function" ? fn(y.decisions || {}) : fn }))} stockDate={date} onEditColumns={null} />
        <div className="text-xs text-slate-500 mt-3">Pour indiquer une autre colonne (par exemple la date d'arrivée), retirez ce fichier et importez-le seul avec « Import d'un seul fichier ».</div>
      </StkModal>; })()}
    {showList && <StkModal title={showList.title} onClose={() => setShowList(null)}><div className="font-plex-mono text-sm columns-1 md:columns-2 gap-6">{showList.items.map((t, i) => <div key={i} className="py-0.5 break-all">{t}</div>)}</div></StkModal>}
  </>;
}
