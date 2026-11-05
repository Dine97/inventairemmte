// ============================================================
// STOCK MMTE — Revue des anomalies avant import : corriger, exclure ou accepter tel quel
// ============================================================

// Corrections de châssis mémorisées (faute de frappe d'un parc corrigée une fois pour toutes)
function stkApplyAliases(parsed, aliases) {
  const map = {};
  (aliases || []).forEach((a) => { if (a && a.alias && a.chassis && a.alias !== a.chassis) map[a.alias] = a.chassis; });
  let n = 0;
  parsed.rows.forEach((r) => {
    const to = map[r.chassis];
    if (!to) return;
    r.alias_from = r.chassis; r.chassis = to; n++;
    if (to.length === 17 && !/[IOQ]/.test(to)) r.flags = r.flags.filter((f) => f !== "chassis_atypique");
  });
  if (n) parsed.anomalies = parsed.anomalies.filter((a) => a.code !== "chassis_atypique").concat(
    parsed.rows.some((r) => r.flags.includes("chassis_atypique")) ? [{ code: "chassis_atypique", niveau: "alerte", texte: `${parsed.rows.filter((r) => r.flags.includes("chassis_atypique")).length} châssis atypiques (pas 17 caractères ou lettres I/O/Q) à vérifier`, items: parsed.rows.filter((r) => r.flags.includes("chassis_atypique")).map((r) => r.chassis) }] : [],
    [{ code: "alias_applique", niveau: "info", texte: `${n} châssis corrigé(s) automatiquement grâce aux corrections déjà mémorisées`, items: parsed.rows.filter((r) => r.alias_from).map((r) => `${r.alias_from} → ${r.chassis}`) }]);
  return parsed;
}

const stkRowKey = (r) => `${r.sheet || ""}:${r.line}`;

// Points à décider, construits à partir des lignes lues
function stkBuildIssues(parsed, preview, stockDate, prevCount) {
  if (!parsed || !parsed.rows.length) return [];
  const out = [];
  if (prevCount && prevCount >= 20 && parsed.unique < prevCount * 0.7) out.push({ key: "incomplet", code: "fichier_incomplet", rows: [],
    title: `Fichier probablement incomplet : ${parsed.unique} véhicules contre ${prevCount} au dernier stock du parc (−${Math.round((1 - parsed.unique / prevCount) * 100)} %)`,
    help: "Un tel écart vient souvent d'un onglet oublié, d'un filtre resté actif dans Excel ou d'un fichier coupé. Validé tel quel, il enregistrerait des centaines de fausses sorties. Vérifiez le fichier avant de confirmer." });
  const newSet = preview && !preview.is_initial ? new Set(preview.entrees || []) : null;
  const atyp = parsed.rows.filter((r) => r.flags.includes("chassis_atypique") && (!newSet || newSet.has(r.chassis)));
  if (atyp.length) out.push({ key: "atypique", code: "chassis_atypique", rows: atyp,
    title: `${atyp.length} châssis atypique(s)${newSet ? " parmi les nouveaux véhicules" : ""}`,
    help: "Un châssis normal fait 17 caractères sans les lettres I, O et Q. Les engins anciens ou les remorques peuvent avoir un numéro plus court : corrigez seulement les vraies fautes de frappe." });
  const noDate = parsed.rows.filter((r) => !r.date_arrivee);
  if (noDate.length) out.push({ key: "sans_date", code: "date_manquante", rows: noDate,
    withTransfer: noDate.filter((r) => r.date_transfert).length,
    title: `${noDate.length} véhicule(s) sans date d'arrivée${noDate.length === parsed.rows.length ? " (aucune date lue dans tout le fichier)" : ""}`,
    help: "Sans date d'arrivée du navire, la date de dépôt (365 jours) ne peut pas être calculée." + (noDate.length === parsed.rows.length ? " Si le fichier contient bien une colonne de date d'arrivée, indiquez-la avec « Vérifier les colonnes »." : "") });
  const fut = parsed.rows.filter((r) => (r.date_arrivee && r.date_arrivee > stockDate) || (r.date_transfert && r.date_transfert > stockDate));
  if (fut.length) out.push({ key: "futur", code: "date_future", rows: fut,
    title: `${fut.length} date(s) postérieure(s) à la date du stock (${stkFmt(stockDate)})`,
    help: "Une date d'arrivée ou de transfert dans le futur est presque toujours une erreur de saisie du parc (jour et mois inversés, mauvaise année)." });
  if (parsed.skipped && parsed.skipped.length) out.push({ key: "ignorees", code: "ligne_ignoree", rows: parsed.skipped.map((k) => ({ ...k, chassis: "", ignored: true })),
    title: `${parsed.skipped.length} ligne(s) sans châssis lisible`,
    help: "Ces lignes ont des informations mais pas de numéro de châssis exploitable. Saisissez le châssis pour les ajouter, ou laissez-les de côté." });
  if (parsed.duplicates && parsed.duplicates.length) out.push({ key: "doublon", code: "doublon", rows: parsed.duplicates.map((d) => ({ chassis: d.chassis, line: d.lines.join(", ") })),
    title: `${parsed.duplicates.length} châssis présent(s) plusieurs fois dans le fichier`, help: "Seule la première ligne de chaque châssis est retenue." });
  const tot = parsed.anomalies.find((a) => a.code === "total_annonce");
  if (tot) out.push({ key: "total", code: "total_annonce", rows: [], title: tot.texte, help: "Le total annoncé par le parc ne correspond pas au nombre de lignes lues." });
  return out;
}

// Lignes à enregistrer après les décisions, corrections à mémoriser et anomalies annotées
function stkApplyDecisions(parsed, issues, decisions, byName) {
  if (!parsed) return null;
  const D = decisions || {};
  const ex = new Set();
  const rows = parsed.rows.map((r) => ({ ...r }));
  const byKey = {}; rows.forEach((r) => (byKey[stkRowKey(r)] = r));
  const aliases = [];
  const summary = {};
  const at = D.atypique;
  if (at && at.status === "corrige") {
    let nf = 0, nx = 0;
    Object.entries(at.fixes || {}).forEach(([k, v]) => {
      const r = byKey[k]; const c = stkNormChassis(v);
      if (!r || !c || c === r.chassis) return;
      if (at.remember !== false) aliases.push({ alias: r.chassis, chassis: c });
      r.chassis_raw = String(v).trim(); r.corrige_de = r.chassis; r.chassis = c; nf++;
    });
    Object.keys(at.exclude || {}).forEach((k) => { if (at.exclude[k]) { ex.add(k); nx++; } });
    summary.atypique = `${nf} corrigé(s), ${nx} exclu(s)${nf && at.remember !== false ? " — corrections mémorisées" : ""}`;
  }
  const sd = D.sans_date;
  if (sd && sd.status === "corrige") {
    let n = 0;
    rows.forEach((r) => {
      if (r.date_arrivee) return;
      const k = stkRowKey(r);
      const v = (sd.fixes || {})[k] || (sd.mode === "transfert" && r.date_transfert) || (sd.mode === "date" && sd.date) || null;
      if (v) { r.date_arrivee = v; r.date_saisie = true; n++; }
      if ((sd.exclude || {})[k]) ex.add(k);
    });
    summary.sans_date = `${n} date(s) complétée(s)` + (sd.mode === "transfert" ? " avec la date de transfert" : sd.mode === "date" ? ` au ${stkFmt(sd.date)}` : "");
  }
  const fu = D.futur;
  if (fu && fu.status === "corrige") {
    let n = 0;
    issues.filter((i) => i.key === "futur").forEach((i) => i.rows.forEach((x) => {
      const r = byKey[stkRowKey(x)]; if (!r) return;
      const f = (fu.fixes || {})[stkRowKey(x)] || {};
      if (f.date_arrivee !== undefined) { r.date_arrivee = f.date_arrivee || null; n++; }
      else if (fu.mode === "vider" && r.date_arrivee && r.date_arrivee > fu.stockDate) { r.date_arrivee = null; n++; }
      if (f.date_transfert !== undefined) { r.date_transfert = f.date_transfert || null; n++; }
      else if (fu.mode === "vider" && r.date_transfert && r.date_transfert > fu.stockDate) { r.date_transfert = null; n++; }
      if ((fu.exclude || {})[stkRowKey(x)]) ex.add(stkRowKey(x));
    }));
    summary.futur = `${n} date(s) corrigée(s)`;
  }
  const ig = D.ignorees;
  if (ig && ig.status === "corrige") {
    let n = 0;
    Object.entries(ig.fixes || {}).forEach(([line, v]) => {
      const c = stkNormChassis(v);
      if (c.length < 4) return;
      rows.push({ chassis: c, chassis_raw: String(v).trim(), line: Number(line), sheet: "", data: {}, flags: ["ajoute"] }); n++;
    });
    summary.ignorees = `${n} ligne(s) ajoutée(s)`;
  }
  const kept = rows.filter((r) => !ex.has(stkRowKey(r)));
  const codeOf = {}; issues.forEach((i) => (codeOf[i.code] = i.key));
  const decided = (key) => { const d = D[key]; if (!d) return null; return d.status === "accepte" ? `Accepté tel quel par ${byName || "l'agent"}` : `Corrigé par ${byName || "l'agent"} : ${summary[key] || ""}`; };
  const anomalies = parsed.anomalies.map((a) => (codeOf[a.code] && D[codeOf[a.code]] ? { ...a, decision: decided(codeOf[a.code]) } : a));
  issues.filter((i) => i.key === "incomplet").forEach((i) => anomalies.push({ code: "fichier_incomplet", niveau: "erreur", texte: i.title, decision: decided("incomplet") }));
  issues.filter((i) => i.key === "futur").forEach((i) => anomalies.push({ code: "date_future", niveau: "alerte", texte: i.title, items: i.rows.map((r) => r.chassis), decision: decided("futur") }));
  return { rows: kept, aliases, anomalies, excluded: ex.size };
}

const STK_DEC_TONE = { todo: "bg-amber-50 text-amber-900 border-amber-300", accepte: "bg-slate-100 text-slate-700 border-slate-300", corrige: "bg-emerald-50 text-emerald-800 border-emerald-200" };

// Revue des points à décider (écran d'import et import groupé)
function StkAnomalyReview({ issues, decisions, setDecisions, stockDate, onEditColumns }) {
  const [open, setOpen] = useState(null);
  const [draft, setDraft] = useState({});
  const [filter, setFilter] = useState("");
  if (!issues.length) return <StkMsg tone="ok">Aucun point à vérifier dans ce fichier.</StkMsg>;
  const pending = issues.filter((i) => !decisions[i.key]);
  const set = (key, val) => setDecisions((d) => { const n = { ...d }; if (val) n[key] = val; else delete n[key]; return n; });
  const startEdit = (i) => { setOpen(i.key); setFilter(""); setDraft(decisions[i.key] && decisions[i.key].status === "corrige" ? JSON.parse(JSON.stringify(decisions[i.key])) : { status: "corrige", fixes: {}, exclude: {}, remember: true, mode: i.key === "sans_date" && i.withTransfer ? "" : "", stockDate }); };
  const fixes = draft.fixes || {}, exclude = draft.exclude || {};
  const setFix = (k, v) => setDraft((d) => ({ ...d, fixes: { ...d.fixes, [k]: v } }));
  const setFixF = (k, f, v) => setDraft((d) => ({ ...d, fixes: { ...d.fixes, [k]: { ...(d.fixes[k] || {}), [f]: v } } }));
  const setEx = (k, v) => setDraft((d) => ({ ...d, exclude: { ...d.exclude, [k]: v } }));
  const acceptAll = () => { if (!window.confirm(`Accepter tel quel les ${pending.length} point(s) restant(s) ?`)) return; setDecisions((d) => { const n = { ...d }; pending.forEach((i) => (n[i.key] = { status: "accepte" })); return n; }); setOpen(null); };
  const head = (h) => <th key={h} className="py-1.5 px-2 text-left">{h}</th>;
  return <div className="space-y-2" data-testid="anomaly-review">
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex-1 min-w-[220px] font-bold text-[#0B1F38]">Points à vérifier ({issues.length - pending.length}/{issues.length} décidés)</div>
      {pending.length > 0 && <StkBtn small onClick={acceptAll} data-testid="accept-all">Tout accepter tel quel</StkBtn>}
    </div>
    {issues.map((i) => {
      const d = decisions[i.key];
      const st = d ? d.status : "todo";
      const isOpen = open === i.key;
      const canFix = ["atypique", "sans_date", "futur", "ignorees"].includes(i.key);
      const shown = i.rows.filter((r) => !filter || String(r.chassis || r.valeur || "").includes(filter.toUpperCase())).slice(0, 300);
      return <div key={i.key} className={`rounded-xl border-2 ${st === "todo" ? "border-amber-300 bg-amber-50/50" : "border-slate-200 bg-white"}`} data-testid={"issue-" + i.key}>
        <div className="px-4 py-3 flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-[240px]">
            <div className="font-semibold text-[#0B1F38] text-sm">{i.title}</div>
            <div className="text-xs text-slate-600 mt-0.5">{i.help}</div>
          </div>
          <StkBadge tone={STK_DEC_TONE[st]}>{st === "todo" ? "À décider" : st === "accepte" ? "Accepté tel quel" : "Corrigé"}</StkBadge>
          {!isOpen && canFix && <StkBtn small onClick={() => startEdit(i)} data-testid={"fix-" + i.key}><StkIc.Edit size={14} /> {st === "corrige" ? "Modifier" : "Voir et corriger"}</StkBtn>}
          {!isOpen && !canFix && i.rows.length > 0 && <StkBtn small kind="ghost" onClick={() => setOpen(i.key)}>Voir</StkBtn>}
          {st !== "accepte" && !isOpen && <StkBtn small kind={st === "todo" ? "primary" : "ghost"} onClick={() => set(i.key, { status: "accepte" })} data-testid={"accept-" + i.key}><StkIc.Check size={14} /> C'est correct</StkBtn>}
          {st !== "todo" && !isOpen && <button className="text-xs text-slate-500 underline" onClick={() => set(i.key, null)}>Annuler la décision</button>}
        </div>
        {isOpen && <div className="border-t border-slate-200 px-4 py-3 space-y-3 bg-white rounded-b-xl">
          {i.key === "sans_date" && <div className="space-y-2 text-sm">
            {onEditColumns && <div className="flex flex-wrap items-center gap-2"><StkBtn small onClick={onEditColumns}><StkIc.Edit size={14} /> Indiquer la colonne de la date d'arrivée</StkBtn><span className="text-xs text-slate-500">si le fichier en contient une que l'outil n'a pas reconnue</span></div>}
            {i.withTransfer > 0 && <label className="flex items-center gap-2"><input type="radio" checked={draft.mode === "transfert"} onChange={() => setDraft((x) => ({ ...x, mode: "transfert" }))} /> Utiliser la date de transfert comme date d'arrivée ({i.withTransfer} véhicule(s))</label>}
            <label className="flex flex-wrap items-center gap-2"><input type="radio" checked={draft.mode === "date"} onChange={() => setDraft((x) => ({ ...x, mode: "date" }))} /> Même date d'arrivée pour tous : <input type="date" value={draft.date || ""} onChange={(e) => setDraft((x) => ({ ...x, mode: "date", date: e.target.value }))} className="border-2 border-slate-200 rounded-lg px-2 py-1 text-sm" /></label>
            <label className="flex items-center gap-2"><input type="radio" checked={!draft.mode} onChange={() => setDraft((x) => ({ ...x, mode: "" }))} /> Saisir la date véhicule par véhicule (tableau ci-dessous)</label>
          </div>}
          {i.key === "futur" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.mode === "vider"} onChange={(e) => setDraft((x) => ({ ...x, mode: e.target.checked ? "vider" : "" }))} /> Effacer les dates futures non corrigées ci-dessous</label>}
          {i.rows.length > 20 && <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrer par châssis" className={`${stkInput} max-w-xs`} />}
          {(i.key !== "sans_date" || !draft.mode) && <div className="overflow-x-auto max-h-[420px] overflow-y-auto border border-slate-200 rounded-lg"><table className="w-full text-xs min-w-[640px]">
            <thead className="sticky top-0 bg-slate-50"><tr className="text-slate-500 border-b border-slate-200">
              {i.key === "ignorees" ? [head("Ligne"), head("Valeur lue"), head("Châssis à enregistrer")]
                : i.key === "doublon" ? [head("Châssis"), head("Lignes")]
                : [head("Ligne"), head("Châssis"), head("Véhicule"), head("Navire"),
                   ...(i.key === "atypique" ? [head("Châssis corrigé")] : i.key === "sans_date" ? [head("Transfert"), head("Date d'arrivée")] : [head("Arrivée"), head("Transfert")]),
                   head("Exclure")]}
            </tr></thead>
            <tbody>{shown.map((r) => { const k = i.key === "ignorees" ? String(r.line) : stkRowKey(r);
              if (i.key === "ignorees") return <tr key={k} className="border-b border-slate-100"><td className="px-2 py-1 text-slate-400">{r.line}</td><td className="px-2 font-plex-mono">{r.valeur}</td><td className="px-2"><input value={fixes[k] || ""} onChange={(e) => setFix(k, e.target.value)} placeholder="laisser vide pour ignorer" className="border border-slate-300 rounded px-2 py-1 font-plex-mono w-56" /></td></tr>;
              if (i.key === "doublon") return <tr key={r.chassis} className="border-b border-slate-100"><td className="px-2 py-1 font-plex-mono font-bold">{r.chassis}</td><td className="px-2">{r.line}</td></tr>;
              const f = fixes[k] || (i.key === "futur" ? {} : "");
              const bad = (v) => v && v > stockDate;
              return <tr key={k} className={`border-b border-slate-100 ${exclude[k] ? "opacity-40" : ""}`}>
                <td className="px-2 py-1 text-slate-400">{r.line}</td>
                <td className="px-2 font-plex-mono font-bold">{r.chassis}</td>
                <td className="px-2">{[r.marque, r.modele, r.annee].filter(Boolean).join(" ")}</td>
                <td className="px-2">{r.navire}</td>
                {i.key === "atypique" && <td className="px-2"><input value={typeof f === "string" ? f : ""} onChange={(e) => setFix(k, e.target.value.toUpperCase())} placeholder="garder tel quel" className="border border-slate-300 rounded px-2 py-1 font-plex-mono w-52" /></td>}
                {i.key === "sans_date" && <><td className="px-2">{stkFmt(r.date_transfert)}</td><td className="px-2"><input type="date" value={typeof f === "string" ? f : ""} onChange={(e) => setFix(k, e.target.value)} className="border border-slate-300 rounded px-1 py-0.5" /></td></>}
                {i.key === "futur" && <><td className="px-2"><input type="date" value={f.date_arrivee !== undefined ? f.date_arrivee : r.date_arrivee || ""} onChange={(e) => setFixF(k, "date_arrivee", e.target.value)} className={`border rounded px-1 py-0.5 ${bad(f.date_arrivee !== undefined ? f.date_arrivee : r.date_arrivee) ? "border-rose-400 bg-rose-50" : "border-slate-300"}`} /></td>
                  <td className="px-2"><input type="date" value={f.date_transfert !== undefined ? f.date_transfert : r.date_transfert || ""} onChange={(e) => setFixF(k, "date_transfert", e.target.value)} className={`border rounded px-1 py-0.5 ${bad(f.date_transfert !== undefined ? f.date_transfert : r.date_transfert) ? "border-rose-400 bg-rose-50" : "border-slate-300"}`} /></td></>}
                <td className="px-2 text-center"><input type="checkbox" checked={!!exclude[k]} onChange={(e) => setEx(k, e.target.checked)} aria-label="Exclure ce véhicule de l'import" /></td>
              </tr>; })}</tbody>
          </table></div>}
          {i.rows.length > shown.length && <div className="text-xs text-slate-500">{shown.length} ligne(s) affichée(s) sur {i.rows.length} : utilisez le filtre pour retrouver un châssis.</div>}
          {i.key === "atypique" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.remember !== false} onChange={(e) => setDraft((x) => ({ ...x, remember: e.target.checked }))} /> Mémoriser les corrections : la même faute sera corrigée automatiquement dans les prochains fichiers</label>}
          <div className="flex flex-wrap gap-2">
            {canFix && <StkBtn small kind="primary" data-testid={"apply-" + i.key} onClick={() => { if (i.key === "sans_date" && draft.mode === "date" && !draft.date) { alert("Indiquez la date."); return; } set(i.key, { ...draft, status: "corrige", stockDate }); setOpen(null); }}><StkIc.Check size={14} /> Appliquer les corrections</StkBtn>}
            <StkBtn small onClick={() => { set(i.key, { status: "accepte" }); setOpen(null); }}>C'est correct, garder tel quel</StkBtn>
            <StkBtn small kind="ghost" onClick={() => setOpen(null)}>Fermer</StkBtn>
          </div>
        </div>}
      </div>;
    })}
  </div>;
}
