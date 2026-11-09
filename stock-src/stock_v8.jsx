// ---------------- Lecture en arrière-plan (6.8) ----------------
// Les fichiers Excel sont ouverts et lus dans lib/stock-worker.js : l'écran reste utilisable pendant la lecture d'un gros parc.
// Si le navigateur ne le permet pas, la lecture se fait comme avant, sur la page.
let stkWk = null, stkWkSeq = 1;
const stkWkWait = new Map();
function stkWorker() {
  if (stkWk === false) return null;
  if (stkWk) return stkWk;
  try {
    if (typeof Worker === "undefined") { stkWk = false; return null; }
    const w = new Worker("./lib/stock-worker.js?v=" + (typeof APP_VERSION !== "undefined" ? APP_VERSION : "1"));
    w.onmessage = (e) => {
      const m = e.data || {};
      const p = stkWkWait.get(m.id);
      if (!p) return;
      if (m.progress) { if (p.onProgress) try { p.onProgress(m.progress); } catch (x) {} return; }
      stkWkWait.delete(m.id);
      if (m.err) p.reject(Object.assign(new Error(m.err), { fichier: true }));
      else p.resolve(m.ok);
    };
    w.onerror = (e) => {
      // Le lecteur lui-même n'a pas pu démarrer (hors ligne au premier usage, navigateur ancien) : retour à la lecture sur la page
      if (e && e.preventDefault) e.preventDefault();
      stkWk = false;
      stkWkWait.forEach((p) => p.reject(Object.assign(new Error("lecteur indisponible"), { infra: true })));
      stkWkWait.clear();
      try { w.terminate(); } catch (x) {}
    };
    stkWk = w;
    return w;
  } catch (e) { stkWk = false; return null; }
}
function stkWorkerCall(msg, onProgress, transfer) {
  const w = stkWorker();
  if (!w) return Promise.reject(Object.assign(new Error("lecteur indisponible"), { infra: true }));
  const id = stkWkSeq++;
  return new Promise((resolve, reject) => {
    stkWkWait.set(id, { resolve, reject, onProgress });
    try { w.postMessage({ ...msg, id }, transfer || []); }
    catch (e) { stkWkWait.delete(id); reject(Object.assign(e, { infra: true })); }
  });
}
// Ouvre un fichier : renvoie un classeur utilisable comme avant (SheetNames, Sheets) ; avec le lecteur en arrière-plan,
// chaque onglet ne contient que ses premières lignes, la lecture complète se fait avec stkParseBook.
async function stkOpenWorkbook(file, onProgress) {
  if (stkWorker()) {
    try {
      const key = "f" + stkWkSeq++;
      const buf = await file.arrayBuffer();
      const r = await stkWorkerCall({ op: "open", key, buf }, onProgress, [buf]);
      const Sheets = {};
      r.SheetNames.forEach((n) => { const h = r.head[n]; const rows = h.rows; rows.offset = h.offset; Sheets[n] = { __rows: rows, __total: h.total }; });
      return { SheetNames: r.SheetNames, Sheets, __key: key, __size: file.size };
    } catch (e) { if (!e.infra) throw e; }
  }
  if (onProgress) onProgress({ phase: "ouverture" });
  await new Promise((r) => setTimeout(r, 30)); // laisse l'écran afficher « Ouverture… »
  return XLSX.read(await file.arrayBuffer(), { cellDates: true, type: "array" });
}
async function stkParseBook(book, opts, onProgress) {
  if (book && book.__key) {
    try { return await stkWorkerCall({ op: "parse", key: book.__key, opts }, onProgress); }
    catch (e) { if (!e.infra) throw e; throw new Error("la lecture en arrière-plan s'est interrompue, sélectionnez à nouveau le fichier"); }
  }
  return stkParseWorkbook(book, opts);
}
function stkCloseBook(book) { if (book && book.__key && stkWk) stkWorkerCall({ op: "close", key: book.__key }).catch(() => {}); }
// Texte d'avancement : « Ouverture du fichier (1,0 Mo)… », « Lecture des lignes… 6 000 / 15 000 »
function stkProgressText(p, size) {
  if (!p) return "";
  if (p.phase === "ouverture") return `Ouverture du fichier${size ? ` (${(size / 1048576).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo)` : ""}…`;
  if (p.phase === "onglets") return `Préparation des onglets… ${p.done + 1} / ${p.total}`;
  if (p.phase === "lignes") return `Lecture des lignes… ${Number(p.done).toLocaleString("fr-FR")} / ${Number(p.total).toLocaleString("fr-FR")}`;
  return "Lecture…";
}
function StkProgressBar({ p, size }) {
  if (!p) return null;
  const pct = p.phase === "lignes" && p.total ? Math.round((p.done / p.total) * 100) : null;
  return <div className="space-y-1">
    <div className="text-xs text-slate-600">{stkProgressText(p, size)}</div>
    <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
      {pct != null ? <div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.max(3, pct)}%` }} /> : <div className="h-full w-1/3 bg-indigo-400 animate-pulse" />}
    </div>
  </div>;
}

// ---------------- Couverture hebdomadaire et relances (6.8) ----------------
// Semaine de travail du lundi au vendredi (parcs fermés le week-end). Un fichier compte pour la semaine
// s'il est daté du vendredi précédent (état de fin de semaine envoyé le lundi) au vendredi de la semaine.
const StkMail = (p) => <Icon {...p}><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 6-10 7L2 6" /></Icon>;
function stkWeekOf(iso) { return stkMonday(iso); }
function stkWeekCovers(dates, monday) { const a = stkAddDays(monday, -3), b = stkAddDays(monday, 4); return dates.some((d) => d >= a && d <= b); }
function stkWeekLabel(monday) { return `du ${stkFmt(monday)} au ${stkFmt(stkAddDays(monday, 4))}`; }
const STK_COV = {
  jamais: { t: "Jamais reçu", c: "bg-rose-50 text-rose-800 border-rose-200", o: 0 },
  absent: { t: "Absent", c: "bg-rose-50 text-rose-800 border-rose-200", o: 1 },
  retard: { t: "En retard", c: "bg-amber-50 text-amber-900 border-amber-300", o: 2 },
  a_jour: { t: "À jour", c: "bg-emerald-50 text-emerald-800 border-emerald-200", o: 3 },
  inactif: { t: "Inactif", c: "bg-slate-50 text-slate-500 border-slate-200", o: 4 }
};
// État de chaque parc pour la semaine du lundi L0
function stkCoverageRows(data, dash, L0) {
  const byParc = {};
  (data.imports || []).forEach((i) => (byParc[i.parc_id] = byParc[i.parc_id] || []).push(i.stock_date));
  const rel = {};
  (data.relances || []).forEach((r) => (rel[r.parc_id] = rel[r.parc_id] || []).push(r));
  const dmap = {}; dash.forEach((d) => (dmap[d.parc_id] = d));
  return (data.parcs || []).filter((p) => p.active !== false).map((p) => {
    const d = dmap[p.id] || {};
    const dates = (byParc[p.id] || []).slice();
    if (d.last_import) dates.push(d.last_import);
    const last = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
    let etat, weeks = 0;
    if (p.suivi_hebdo === false) etat = "inactif";
    else if (stkWeekCovers(dates, L0)) etat = "a_jour";
    else if (!last) etat = "jamais";
    else {
      // semaines sans fichier, semaine en cours comprise (1 = le fichier de la semaine passée a été reçu)
      weeks = 1;
      while (weeks < 52 && !stkWeekCovers(dates, stkAddDays(L0, -7 * weeks))) weeks++;
      etat = weeks <= 1 ? "retard" : "absent";
    }
    const rs = rel[p.id] || [];
    const thisWeek = rs.filter((r) => r.semaine === L0);
    return {
      parc_id: p.id, parc: p.name, etat, weeks, last, presents: +d.presents || 0,
      contact_nom: p.contact_nom || "", contact_email: p.contact_email || "", contact_tel: p.contact_tel || "", suivi_hebdo: p.suivi_hebdo !== false,
      relances_semaine: thisWeek.length, derniere_relance: rs[0] || null,
      niveau: thisWeek.length || etat === "absent" ? 2 : 1, dates
    };
  });
}
function stkMailEmails(s) { return String(s || "").split(/[;,\s]+/).map((x) => x.trim()).filter((x) => /.+@.+\..+/.test(x)); }
function stkRelanceText(r, L0, niveau, signer) {
  const sem = stkWeekLabel(L0);
  const lastTxt = r.last ? `Le dernier état reçu est daté du ${stkFmt(r.last)}${r.weeks > 1 ? `, soit ${r.weeks} semaines sans mise à jour` : ""}.` : "Nous n'avons encore reçu aucun état de stock de votre part.";
  const sign = `\n\nCordialement,\n\n${signer || ""}\nBénin Control — Département MAD-MAE\nSuivi des stocks MMTE`;
  if (niveau === 2) return {
    subject: `RELANCE — État du stock du parc ${r.parc} non reçu (semaine ${sem})`,
    body: `Madame, Monsieur,\n\nMalgré nos précédentes demandes, nous n'avons toujours pas reçu l'état du stock des véhicules sous régime suspensif du parc ${r.parc} pour la semaine ${sem}.\n\n${lastTxt}\n\nCe document est indispensable au suivi des véhicules de votre parc. Nous vous prions de nous le transmettre dans les meilleurs délais, au format Excel, en utilisant le modèle joint (une ligne par véhicule présent dans le parc).${sign}`
  };
  return {
    subject: `État du stock du parc ${r.parc} — semaine ${sem}`,
    body: `Madame, Monsieur,\n\nSauf erreur de notre part, nous n'avons pas encore reçu l'état du stock des véhicules sous régime suspensif du parc ${r.parc} pour la semaine ${sem}.\n\n${lastTxt}\n\nMerci de nous le transmettre dès que possible, au format Excel, en utilisant le modèle joint (une ligne par véhicule présent dans le parc). Pour la suite, l'état est attendu chaque lundi.${sign}`
  };
}
function stkMailto(to, subject, body, bcc) {
  const q = [`subject=${encodeURIComponent(subject)}`, `body=${encodeURIComponent(body)}`];
  if (bcc && bcc.length) q.unshift(`bcc=${encodeURIComponent(bcc.join(","))}`);
  return `mailto:${(to || []).map(encodeURIComponent).join(",")}?${q.join("&")}`;
}
async function stkCopyText(t) { try { await navigator.clipboard.writeText(t); return true; } catch (e) { window.prompt("Copiez le texte :", t); return false; } }

function StkCoverage() {
  const C = React.useContext(StkCtx);
  const { dash, openParc, go, toast } = C;
  const canEdit = stkCanEdit(C);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("a_traiter");
  const [sel, setSel] = useState(new Set());
  const [contact, setContact] = useState(null);
  const [relance, setRelance] = useState(null);
  const load = () => stkCall("coverage", {}).then(setData).catch((e) => setErr(stkErrText(e)));
  useEffect(() => { load(); }, []);
  if (err) return <><StkPageHead title="Couverture hebdomadaire" /><StkMsg tone="err">{err}</StkMsg></>;
  if (!data) return <><StkPageHead title="Couverture hebdomadaire" /><StkLoading /></>;
  const L0 = stkWeekOf(data.today || stkToday());
  const rows = stkCoverageRows(data, dash, L0).sort((a, b) => STK_COV[a.etat].o - STK_COV[b.etat].o || b.weeks - a.weeks || a.parc.localeCompare(b.parc));
  const tracked = rows.filter((r) => r.etat !== "inactif");
  const n = (e) => rows.filter((r) => r.etat === e).length;
  const ok = n("a_jour");
  const pct = tracked.length ? Math.round((ok / tracked.length) * 100) : 0;
  // Évolution sur 8 semaines
  const trend = Array.from({ length: 8 }, (_, k) => { const L = stkAddDays(L0, -7 * (7 - k)); const c = tracked.filter((r) => stkWeekCovers(r.dates, L)).length; return { L, c, p: tracked.length ? c / tracked.length : 0 }; });
  const shown = rows.filter((r) => filter === "tous" ? true : filter === "a_traiter" ? ["jamais", "absent", "retard"].includes(r.etat) : r.etat === filter);
  const selRows = rows.filter((r) => sel.has(r.parc_id));
  const exportXlsx = () => stkExportXlsx(`Couverture_stocks_semaine_${L0}`, `Couverture hebdomadaire des parcs — semaine ${stkWeekLabel(L0)}`,
    [`${ok} parc(s) à jour sur ${tracked.length} suivis (${pct} %)`, `Édité le ${stkFmt(stkToday())}`],
    [{ h: "Parc", k: "parc", w: 28 }, { h: "État", x: (r) => STK_COV[r.etat].t, w: 14 }, { h: "Dernier fichier", x: (r) => stkFmt(r.last), w: 14 },
     { h: "Semaines sans fichier", x: (r) => (["retard", "absent"].includes(r.etat) ? r.weeks : ""), w: 12 }, { h: "Véhicules", k: "presents", w: 10 },
     { h: "Contact", k: "contact_nom", w: 22 }, { h: "E-mail", k: "contact_email", w: 30 }, { h: "Téléphone", k: "contact_tel", w: 16 },
     { h: "Relances cette semaine", x: (r) => r.relances_semaine || "", w: 12 }, { h: "Dernière relance", x: (r) => (r.derniere_relance ? stkFmtTs(r.derniere_relance.at) : ""), w: 18 }], rows);
  const F = [["a_traiter", `À traiter (${n("jamais") + n("absent") + n("retard")})`], ["a_jour", `À jour (${ok})`], ["inactif", `Inactifs (${n("inactif")})`], ["tous", `Tous (${rows.length})`]];
  return <>
    <StkPageHead title="Couverture hebdomadaire" sub={`Semaine ${stkWeekLabel(L0)} · un fichier compte pour la semaine s'il est daté du vendredi précédent au vendredi de la semaine.`}
      right={<div className="flex flex-wrap gap-2"><StkBtn small onClick={exportXlsx}><Download size={14} /> Excel</StkBtn>{canEdit && <StkBtn small kind="primary" onClick={() => go("bulk")}><StkIc.Layers size={14} /> Import groupé</StkBtn>}</div>} />
    <StkCard className="p-4 md:p-5" data-testid="coverage-head">
      <div className="flex flex-wrap items-end gap-6">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-bold">Parcs à jour cette semaine</div>
          <div className="font-plex-mono text-4xl font-bold text-[#0B1F38]" data-testid="coverage-count">{ok} <span className="text-xl text-slate-400">/ {tracked.length}</span></div>
          <div className="text-sm text-slate-600">{pct} % des parcs suivis{n("inactif") ? ` · ${n("inactif")} inactif(s) exclu(s)` : ""}</div>
        </div>
        <div className="flex-1 min-w-[240px]">
          <div className="h-3 rounded-full bg-slate-100 overflow-hidden flex">
            <div className="bg-emerald-500" style={{ width: `${(ok / Math.max(tracked.length, 1)) * 100}%` }} />
            <div className="bg-amber-400" style={{ width: `${(n("retard") / Math.max(tracked.length, 1)) * 100}%` }} />
            <div className="bg-rose-400" style={{ width: `${((n("absent") + n("jamais")) / Math.max(tracked.length, 1)) * 100}%` }} />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 mt-2">
            <span><b className="text-emerald-700">{ok}</b> à jour</span><span><b className="text-amber-700">{n("retard")}</b> en retard</span>
            <span><b className="text-rose-700">{n("absent")}</b> absents (2 semaines ou plus)</span><span><b className="text-rose-700">{n("jamais")}</b> jamais reçus</span>
          </div>
        </div>
        <div className="min-w-[230px]" data-testid="coverage-trend">
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-1">8 dernières semaines</div>
          <div className="flex items-end gap-1.5 h-16">{trend.map((t) => <div key={t.L} className="flex flex-col items-center gap-0.5" title={`Semaine ${stkWeekLabel(t.L)} : ${t.c} parc(s) à jour`}>
            <div className="text-[10px] font-plex-mono text-slate-600">{t.c}</div>
            <div className={`w-6 rounded-t ${t.L === L0 ? "bg-[#1B4F8C]" : "bg-[#9DB8D9]"}`} style={{ height: `${Math.max(2, t.p * 44)}px` }} />
          </div>)}</div>
          <div className="flex gap-1.5 text-[9px] text-slate-400">{trend.map((t) => <div key={t.L} className="w-6 text-center">{t.L.slice(8, 10)}/{t.L.slice(5, 7)}</div>)}</div>
        </div>
      </div>
    </StkCard>
    <StkCard className="p-4 md:p-5 space-y-3 min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        {F.map(([k, l]) => <button key={k} onClick={() => { setFilter(k); setSel(new Set()); }} className={`px-3 py-1.5 rounded-full text-xs font-bold border-2 ${filter === k ? "bg-[#1B4F8C] text-white border-[#1B4F8C]" : "bg-white text-[#1B4F8C] border-[#1B4F8C]/20"}`}>{l}</button>)}
        <div className="flex-1" />
        {canEdit && <StkBtn small kind="primary" disabled={!selRows.length} onClick={() => setRelance(selRows)} data-testid="coverage-relance"><StkMail size={14} /> Préparer la relance{selRows.length ? ` (${selRows.length})` : ""}</StkBtn>}
      </div>
      <StkTable rowKey={(r) => r.parc_id} rows={shown} selectable={canEdit} selected={sel} setSelected={setSel} onRow={(r) => openParc(r.parc_id)} empty="Aucun parc dans cette catégorie." columns={[
        { key: "parc", label: "Parc", render: (r) => <b>{r.parc}</b> },
        { key: "etat", label: "État", sort: (r) => STK_COV[r.etat].o, render: (r) => <div><StkBadge tone={STK_COV[r.etat].c}>{STK_COV[r.etat].t}</StkBadge>{["retard", "absent"].includes(r.etat) && <div className="text-[11px] text-slate-500 mt-0.5">{r.weeks} semaine(s) sans fichier</div>}</div> },
        { key: "last", label: "Dernier fichier", render: (r) => r.last ? stkFmt(r.last) : <span className="text-slate-400">—</span> },
        { key: "presents", label: "Véhicules", render: (r) => (r.presents ? r.presents.toLocaleString("fr-FR") : "") },
        { key: "contact", label: "Contact", sort: (r) => r.contact_nom || r.contact_email, render: (r) => <div onClick={(e) => e.stopPropagation()} className="text-xs">
          {r.contact_nom || r.contact_email || r.contact_tel ? <div><div className="font-semibold text-slate-700">{r.contact_nom}</div><div className="text-slate-500 break-all">{r.contact_email}</div><div className="text-slate-500">{r.contact_tel}</div></div> : <div className="text-slate-400">Non renseigné</div>}
          {canEdit && <button className="block text-[#1B4F8C] underline mt-0.5" onClick={() => setContact(r)} data-testid="coverage-contact">Modifier</button>}
        </div> },
        { key: "relance", label: "Relances", sort: (r) => (r.derniere_relance ? r.derniere_relance.at : ""), render: (r) => r.derniere_relance ? <div className="text-xs"><div>{r.relances_semaine ? <b className="text-amber-800">{r.relances_semaine} cette semaine</b> : "Dernière :"}</div><div className="text-slate-500">{stkFmtTs(r.derniere_relance.at)} · {r.derniere_relance.by_name}</div></div> : <span className="text-xs text-slate-400">—</span> }
      ]} />
    </StkCard>
    {contact && <StkContactModal row={contact} onClose={() => setContact(null)} onSaved={() => { setContact(null); load(); }} />}
    {relance && <StkRelanceModal rows={relance} L0={L0} signer={C.userName || (C.me && C.me.name) || ""} onClose={() => setRelance(null)} onLogged={() => { load(); }} />}
  </>;
}

function StkContactModal({ row, onClose, onSaved }) {
  const [f, setF] = useState({ contact_nom: row.contact_nom, contact_email: row.contact_email, contact_tel: row.contact_tel, suivi_hebdo: row.suivi_hebdo });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const bad = stkMailEmails(f.contact_email).length !== String(f.contact_email || "").split(/[;,\s]+/).filter(Boolean).length;
  const save = async () => {
    setBusy(true); setErr("");
    try { await stkCall("parc_contact_set", { parc_id: row.parc_id, ...f }); onSaved(); } catch (e) { setErr(stkErrText(e)); setBusy(false); }
  };
  return <StkModal title={`Contact du parc ${row.parc}`} onClose={onClose} footer={<><StkBtn onClick={onClose}>Annuler</StkBtn><StkBtn kind="primary" disabled={busy || bad} onClick={save} data-testid="contact-save">Enregistrer</StkBtn></>}>
    <div className="space-y-3">
      <StkField label="Nom du contact"><input className={stkInput} value={f.contact_nom} onChange={(e) => setF({ ...f, contact_nom: e.target.value })} placeholder="Ex. M. AGBO, responsable du parc" /></StkField>
      <StkField label="E-mail(s)" hint="Plusieurs adresses possibles, séparées par un point-virgule."><input className={stkInput} value={f.contact_email} onChange={(e) => setF({ ...f, contact_email: e.target.value })} placeholder="stock@parc.bj; direction@parc.bj" data-testid="contact-email" /></StkField>
      {bad && <StkMsg tone="warn">Une adresse e-mail n'est pas valide.</StkMsg>}
      <StkField label="Téléphone"><input className={stkInput} value={f.contact_tel} onChange={(e) => setF({ ...f, contact_tel: e.target.value })} placeholder="+229 01 00 00 00 00" /></StkField>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={f.suivi_hebdo} onChange={(e) => setF({ ...f, suivi_hebdo: e.target.checked })} />
        <span>Fichier attendu chaque semaine<br /><span className="text-xs text-slate-500">Décochez si le parc est fermé ou n'a plus de véhicule : il sera exclu du calcul de la couverture.</span></span></label>
      {err && <StkMsg tone="err">{err}</StkMsg>}
    </div>
  </StkModal>;
}

function StkRelanceModal({ rows, L0, signer, onClose, onLogged }) {
  const [lvl, setLvl] = useState(() => Object.fromEntries(rows.map((r) => [r.parc_id, r.niveau])));
  const [done, setDone] = useState({});
  const [err, setErr] = useState("");
  const log = async (list, canal) => {
    try {
      await stkCall("relance_add", { canal, items: list.map((r) => ({ parc_id: r.parc_id, semaine: L0, niveau: lvl[r.parc_id] })) });
      setDone((d) => { const n = { ...d }; list.forEach((r) => (n[r.parc_id] = canal)); return n; });
      onLogged();
    } catch (e) { setErr(stkErrText(e)); }
  };
  const withMail = rows.filter((r) => stkMailEmails(r.contact_email).length);
  const group = withMail.length > 1 ? {
    subject: `État du stock des véhicules — semaine ${stkWeekLabel(L0)}`,
    body: `Madame, Monsieur,\n\nSauf erreur de notre part, nous n'avons pas encore reçu l'état du stock des véhicules sous régime suspensif de votre parc pour la semaine ${stkWeekLabel(L0)}.\n\nMerci de nous le transmettre dès que possible, au format Excel, en utilisant le modèle joint (une ligne par véhicule présent dans le parc). Pour la suite, l'état est attendu chaque lundi.\n\nCordialement,\n\n${signer || ""}\nBénin Control — Département MAD-MAE\nSuivi des stocks MMTE`
  } : null;
  return <StkModal wide title={`Relance des parcs — semaine ${stkWeekLabel(L0)}`} onClose={onClose} footer={<StkBtn onClick={onClose}>Fermer</StkBtn>}>
    <div className="space-y-4" data-testid="relance-modal">
      <StkMsg tone="info">
        <div>Le mail s'ouvre dans Outlook avec destinataire, objet et texte déjà remplis. <b>Outlook ne peut pas joindre le fichier tout seul :</b> téléchargez le modèle et glissez-le dans le mail.</div>
        <div className="flex flex-wrap gap-2 mt-2">
          <a className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-xl bg-white text-[#1B4F8C] border-2 border-[#1B4F8C]/25 font-bold" href="./modeles/MODELE_STOCK_PARC_MMTE.xlsx" download><Download size={14} /> Modèle Excel (avec contrôles)</a>
          <a className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-xl bg-white text-[#1B4F8C] border-2 border-[#1B4F8C]/25 font-bold" href="./modeles/STOCK_PARC.xlsx" download><Download size={14} /> Modèle simple</a>
        </div>
      </StkMsg>
      {group && <div className="rounded-xl border-2 border-slate-200 p-3 flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[220px] text-sm"><b>Un seul mail pour les {withMail.length} parcs ayant une adresse</b><div className="text-xs text-slate-500">Destinataires en copie cachée (aucun parc ne voit les autres), texte général sans les dates propres à chaque parc.</div></div>
        <a className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-xl bg-[#1B4F8C] text-white font-bold" href={stkMailto([], group.subject, group.body, withMail.flatMap((r) => stkMailEmails(r.contact_email)))} onClick={() => log(withMail, "outlook")}><StkMail size={14} /> Ouvrir dans Outlook</a>
      </div>}
      {rows.map((r) => {
        const em = stkMailEmails(r.contact_email);
        const t = stkRelanceText(r, L0, lvl[r.parc_id], signer);
        return <div key={r.parc_id} className="rounded-xl border-2 border-slate-200 p-3 space-y-2" data-testid="relance-item">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-[180px]"><b>{r.parc}</b> <StkBadge tone={STK_COV[r.etat].c}>{STK_COV[r.etat].t}</StkBadge>
              <div className="text-xs text-slate-500">{em.length ? em.join(" · ") : <span className="text-amber-800 font-semibold">Pas d'adresse e-mail : renseignez le contact, ou copiez le texte.</span>}{r.contact_tel ? ` · ${r.contact_tel}` : ""}</div></div>
            <select value={lvl[r.parc_id]} onChange={(e) => setLvl({ ...lvl, [r.parc_id]: Number(e.target.value) })} className={`${stkInput} py-1 max-w-[190px]`} data-testid="relance-niveau">
              <option value={1}>1re relance (courtoise)</option><option value={2}>Relance ferme</option></select>
            {em.length > 0 && <a className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-xl bg-[#1B4F8C] text-white font-bold" href={stkMailto(em, t.subject, t.body)} onClick={() => log([r], "outlook")} data-testid="relance-outlook"><StkMail size={14} /> Ouvrir dans Outlook</a>}
            <StkBtn small onClick={async () => { await stkCopyText(`Objet : ${t.subject}\n\n${t.body}`); log([r], "copie"); }} data-testid="relance-copy">Copier le texte</StkBtn>
            {done[r.parc_id] && <span className="text-xs text-emerald-700 font-bold">✓ Relance notée</span>}
          </div>
          <details><summary className="text-xs text-[#1B4F8C] cursor-pointer">Voir le mail</summary>
            <div className="mt-2 text-xs bg-slate-50 rounded-lg p-3 whitespace-pre-wrap"><b>Objet : {t.subject}</b>{"\n\n"}{t.body}</div></details>
        </div>;
      })}
      {err && <StkMsg tone="err">{err}</StkMsg>}
    </div>
  </StkModal>;
}
