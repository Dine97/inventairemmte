// ============================================================
// STOCK MMTE v3 — inventaire depuis le stock du parc, export du stock à une date, comptes et accès
// ============================================================
function stkDmy(iso) { return iso ? stkFmt(iso) : ""; }

// Liste d'inventaire construite depuis le dernier stock du parc
function stkStockToInventoryMap(rows, cfg, label) {
  const map = new Map();
  rows.forEach((r) => {
    const norm = normalize(r.chassis);
    if (!norm) return;
    const sit = stkSit(r, stkToday(), cfg);
    const extra = { "Origine de la liste": label || "Stock du parc" };
    if (r.date_arrivee) extra["Date d'arrivée"] = stkDmy(r.date_arrivee);
    if (r.date_transfert) extra["Date de transfert"] = stkDmy(r.date_transfert);
    if (r.marque) extra["Marque"] = r.marque;
    if (r.importateur) extra["Importateur"] = r.importateur;
    const info = { chassis: r.chassis_raw || r.chassis, extra };
    // Aucun champ vide : Firestore refuse les valeurs « undefined »
    if (stkVeh(r)) info.description = stkVeh(r);
    if (r.manifeste) info.atp = r.manifeste;
    if (r.navire) info.shipName = r.navire;
    if (r.bl) info.bl = r.bl;
    if (sit.depot) info.depotDate = stkDmy(sit.depot);
    if (r.entry_date) info.entryDate = stkDmy(r.entry_date);
    map.set(norm, info);
  });
  return map;
}
// Fusion liste MMTE + stock du parc : chaque châssis est étiqueté selon sa présence
function stkMergeInventoryLists(mmteMap, stockMap) {
  const out = new Map();
  mmteMap.forEach((info, norm) => {
    const inStock = stockMap.get(norm);
    const extra = { ...(info.extra || {}), "Origine de la liste": inStock ? "MMTE + stock du parc" : "MMTE seulement" };
    if (inStock) Object.entries(inStock.extra || {}).forEach(([k, v]) => { if (k !== "Origine de la liste" && extra[k] == null) extra[k] = v; });
    out.set(norm, { ...(inStock || {}), ...info, extra });
  });
  stockMap.forEach((info, norm) => {
    if (!out.has(norm)) out.set(norm, { ...info, extra: { ...(info.extra || {}), "Origine de la liste": "Stock du parc seulement" } });
  });
  return out;
}

// Bloc affiché dans l'écran de démarrage d'un inventaire (source « Stock du parc »)
function StkInvStockSource({ parcName, mmteSize, onLoaded }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState(null);
  const load = async (mode) => {
    if (!String(parcName || "").trim()) { setErr("Indiquez d'abord le nom du parc ci-dessus."); return; }
    setBusy(true); setErr(""); setInfo(null);
    try {
      const [st, boot] = await Promise.all([stkCall("parc_stock", { parc_name: parcName }), stkCall("bootstrap", {})]);
      const cfg = stkSettings(boot.settings);
      if (!st.rows.length) { setErr("Aucun véhicule en stock pour ce parc dans le suivi des stocks : importez d'abord son fichier de stock."); setBusy(false); return; }
      const label = `Stock du parc${st.lastImport ? " du " + stkFmt(st.lastImport.stock_date) : ""}`;
      const map = stkStockToInventoryMap(st.rows, cfg, label);
      onLoaded(map, mode, `${label} (${st.rows.length} véhicules)`);
      setInfo({ n: st.rows.length, date: st.lastImport && st.lastImport.stock_date, mode });
    } catch (e) {
      setErr(String(e.message) === "PARC_INCONNU" ? `Le parc « ${parcName} » n'existe pas encore dans le suivi des stocks.` : stkErrText(e));
    }
    setBusy(false);
  };
  return <div className="rounded-lg border-2 border-dashed border-[#C9A96A]/60 bg-[#FBF7EE] p-4 space-y-3" data-i18n-skip="1">
    <div className="text-sm text-slate-700">Utiliser comme liste de référence le <b>dernier stock importé</b> de ce parc dans le suivi des stocks (aucun fichier à importer).</div>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={() => load("replace")} className="px-4 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-60" style={{ background: BLUE_DEEP }}>{busy ? "Chargement..." : "Charger le stock du parc"}</button>
      {mmteSize > 0 && <button type="button" disabled={busy} onClick={() => load("merge")} className="px-4 py-2 rounded-lg text-sm font-bold border-2 border-[#1B4F8C] text-[#1B4F8C] bg-white disabled:opacity-60">Fusionner avec la liste MMTE chargée ({mmteSize})</button>}
    </div>
    {mmteSize > 0 && <div className="text-xs text-slate-500">La fusion garde la liste MMTE et ajoute les véhicules déclarés par le parc. Chaque châssis porte l'étiquette « MMTE + stock du parc », « MMTE seulement » ou « Stock du parc seulement », visible dans les détails et les exports.</div>}
    {info && <div className="text-sm font-semibold text-emerald-800">{info.n} véhicules chargés depuis le stock du {stkFmt(info.date)}{info.mode === "merge" ? " et fusionnés avec la liste MMTE" : ""}.</div>}
    {err && <div className="text-sm font-semibold text-rose-700">{err}</div>}
  </div>;
}

// Export du stock à une date (tous les parcs ou un parc, par situation)
function StkExportAtDateModal({ onClose, parcId }) {
  const { dash, cfg } = React.useContext(StkCtx);
  const [date, setDate] = useState(stkToday());
  const [parc, setParc] = useState(parcId ? String(parcId) : "");
  const [cat, setCat] = useState("tous");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [count, setCount] = useState(null);
  const CAT = { tous: "Tout le stock", disponible: "Disponibles", bientot: `Bientôt en dépôt (< ${cfg.seuil} j)`, depot: "En dépôt", sans_date: "Sans date d'arrivée" };
  const run = async (kind) => {
    setBusy("Calcul du stock..."); setErr("");
    try {
      const r = await stkCall("stock_at", { date, parc_id: parc || null });
      const rows = r.rows.filter((x) => cat === "tous" || stkSit(x, date, cfg).code === cat);
      setCount(rows.length);
      const pname = parc ? (dash.find((d) => d.parc_id === Number(parc)) || {}).parc : "Tous les parcs";
      const title = `${CAT[cat]} au ${stkFmt(date)}`;
      const meta = [`Parc : ${pname}`, `Situation calculée au ${stkFmt(date)} (séjour de ${cfg.duree} jours)`, `${rows.length} véhicule(s)`];
      const cols = (parc ? [] : [{ h: "Parc", k: "parc", w: 18 }]).concat(stkExportCols(cfg, date)).concat([{ h: "Entrée au parc", x: (x) => stkFmt(x.entry_date), w: 12 }]);
      const fname = `Stock_${(pname || "").replace(/\s+/g, "_")}_${cat}_${date}`;
      if (kind === "x") stkExportXlsx(fname, title, meta, cols, rows);
      else stkPrintPdf(title, meta, cols.filter((c) => !["Manifeste / ATP", "N° BL", "Jours restants"].includes(c.h)), rows);
    } catch (e) { setErr(stkErrText(e)); }
    setBusy("");
  };
  return <StkModal title="Exporter le stock à une date" onClose={onClose}>
    <div className="space-y-4">
      <StkField label="Date du stock"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={stkInput} /></StkField>
      <StkField label="Parc"><select value={parc} onChange={(e) => setParc(e.target.value)} className={stkInput}><option value="">Tous les parcs</option>{dash.map((d) => <option key={d.parc_id} value={d.parc_id}>{d.parc}</option>)}</select></StkField>
      <StkField label="Véhicules à exporter"><select value={cat} onChange={(e) => setCat(e.target.value)} className={stkInput}>{Object.entries(CAT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></StkField>
      <StkMsg tone="info">Le stock à une date reprend les véhicules présents d'après les fichiers importés jusqu'à cette date ; la situation (disponible, dépôt) est calculée à la date choisie.</StkMsg>
      {err && <StkMsg tone="err">{err}</StkMsg>}
      {count != null && !busy && <div className="text-sm font-semibold text-emerald-800">{count} véhicule(s) exporté(s).</div>}
      <div className="flex flex-wrap gap-2">
        <StkBtn kind="primary" disabled={!!busy} onClick={() => run("x")}><Download size={16} /> {busy || "Excel"}</StkBtn>
        <StkBtn disabled={!!busy} onClick={() => run("p")}><Printer size={16} /> PDF</StkBtn>
      </div>
    </div>
  </StkModal>;
}

// ---------- Comptes et accès (panneau d'administration de l'application) ----------
function StkAccountTools({ users, adminEmails }) {
  const [stockAccess, setStockAccess] = useState({});
  const [stockErr, setStockErr] = useState("");
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);
  const [q, setQ] = useState("");
  const admins = new Set((adminEmails || []).map((e) => String(e).toLowerCase()));
  const loadStock = () => stkCall("users_list", {}).then((rows) => { const m = {}; rows.forEach((r) => (m[r.uid] = r.access)); setStockAccess(m); setStockErr(""); }).catch((e) => setStockErr(stkErrText(e)));
  useEffect(() => { loadStock(); }, []);
  const flash = (text, kind) => { setMsg({ text, kind: kind || "ok" }); setTimeout(() => setMsg(null), 6000); };
  const setInv = async (u, on) => {
    try { await db.collection("users").doc(u.id).update({ inventoryAccess: on }); flash(`${u.displayName || u.email} : inventaire ${on ? "autorisé" : "retiré"}.`); }
    catch (e) { flash("Modification refusée : " + (e.message || e), "err"); }
  };
  const setStock = async (u, access) => {
    try { await stkCall("user_save", { uid: u.id, access, name: u.displayName || u.email, email: u.email }); setStockAccess((m) => ({ ...m, [u.id]: access })); flash(`${u.displayName || u.email} : suivi des stocks — ${access === "agent" ? "agent" : access === "consultation" ? "consultation seule" : "aucun accès"}.`); }
    catch (e) { flash(stkErrText(e), "err"); }
  };
  const create = async () => {
    const f = form;
    if (!f.email || !f.password || f.password.length < 6) { flash("E-mail et mot de passe (6 caractères minimum) obligatoires.", "err"); return; }
    setBusy("Création du compte...");
    let sec = null;
    try {
      sec = firebase.apps.find((a) => a.name === "stk-creation") || firebase.initializeApp(firebaseConfig, "stk-creation");
      const cred = await sec.auth().createUserWithEmailAndPassword(f.email.trim(), f.password);
      const uid = cred.user.uid;
      if (f.name) await cred.user.updateProfile({ displayName: f.name.trim() }).catch(() => {});
      await sec.firestore().collection("users").doc(uid).set({ email: f.email.trim().toLowerCase(), displayName: (f.name || "").trim(), status: "pending", role: "agent", createdAt: firebase.firestore.FieldValue.serverTimestamp(), createdByAdmin: true });
      await sec.auth().signOut().catch(() => {});
      await db.collection("users").doc(uid).update({ status: "approved", inventoryAccess: !!f.inv, approvedAt: firebase.firestore.FieldValue.serverTimestamp() });
      await stkCall("user_save", { uid, access: f.stock, name: f.name || f.email, email: f.email });
      setStockAccess((m) => ({ ...m, [uid]: f.stock }));
      flash(`Compte créé pour ${f.email}. Communiquez-lui son mot de passe provisoire : il pourra le changer avec « Mot de passe oublié ».`);
      setForm(null);
    } catch (e) {
      const c = e && e.code;
      flash(c === "auth/email-already-in-use" ? "Cette adresse a déjà un compte : approuvez-la dans la liste ci-dessous." : c === "auth/invalid-email" ? "Adresse e-mail invalide." : c === "auth/weak-password" ? "Mot de passe trop faible (6 caractères minimum)." : "Création impossible : " + (e.message || e), "err");
      try { if (sec) await sec.auth().signOut(); } catch (x) {}
    }
    setBusy("");
  };
  const list = (users || []).filter((u) => !q || `${u.displayName || ""} ${u.email || ""}`.toLowerCase().includes(q.toLowerCase()));
  const sel = "border-2 border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white";
  return <div className="rounded-xl border-2 border-[#C9A96A]/50 bg-[#FFFDF7] p-4 space-y-3" data-i18n-skip="1">
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex-1 min-w-[220px]"><div className="font-bold text-[#0B1F38]">Comptes et accès aux applications</div>
        <div className="text-xs text-slate-500">Choisissez qui peut utiliser Inventaire MMTE et le Suivi des stocks. Les administrateurs ont toujours accès aux deux.</div></div>
      <button type="button" onClick={() => setForm(form ? null : { name: "", email: "", password: "", inv: true, stock: "agent" })} className="px-3 py-2 rounded-lg text-sm font-bold text-white" style={{ background: BLUE_DEEP }}>{form ? "Fermer" : "+ Créer un compte"}</button>
    </div>
    {msg && <div className={`rounded-lg px-3 py-2 text-sm font-semibold border-2 ${msg.kind === "err" ? "bg-rose-50 border-rose-200 text-rose-700" : "bg-emerald-50 border-emerald-200 text-emerald-800"}`}>{msg.text}</div>}
    {form && <div className="grid md:grid-cols-2 gap-3 bg-white rounded-lg border border-slate-200 p-3">
      <label className="text-xs font-bold text-slate-600">Nom et prénom<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={stkInput + " mt-1"} /></label>
      <label className="text-xs font-bold text-slate-600">E-mail<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={stkInput + " mt-1"} /></label>
      <label className="text-xs font-bold text-slate-600">Mot de passe provisoire<input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={stkInput + " mt-1"} placeholder="6 caractères minimum" /></label>
      <div className="text-xs font-bold text-slate-600 space-y-2">Accès
        <label className="flex items-center gap-2 font-semibold text-sm text-slate-700"><input type="checkbox" checked={form.inv} onChange={(e) => setForm({ ...form, inv: e.target.checked })} /> Inventaire MMTE</label>
        <label className="flex items-center gap-2 font-semibold text-sm text-slate-700">Suivi des stocks <select value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} className={sel}><option value="agent">Agent MMTE</option><option value="consultation">Consultation seule</option><option value="aucun">Aucun accès</option></select></label>
      </div>
      <div className="md:col-span-2"><button type="button" disabled={!!busy} onClick={create} className="px-4 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-60" style={{ background: BLUE_DEEP }}>{busy || "Créer le compte (approuvé immédiatement)"}</button></div>
    </div>}
    {stockErr && <div className="text-xs text-rose-700">Accès au suivi des stocks non chargés : {stockErr}</div>}
    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer les comptes" className={stkInput} />
    <div className="overflow-x-auto"><table className="w-full text-sm min-w-[560px]"><thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b-2 border-slate-200"><th className="py-2 px-2">Compte</th><th className="px-2">Statut</th><th className="px-2">Inventaire MMTE</th><th className="px-2">Suivi des stocks</th></tr></thead>
      <tbody>{list.map((u) => { const adm = admins.has(String(u.email || "").toLowerCase()); return <tr key={u.id} className="border-b border-slate-100">
        <td className="py-2 px-2"><b>{u.displayName || "—"}</b><div className="text-xs text-slate-500">{u.email}</div></td>
        <td className="px-2 text-xs">{adm ? "Administrateur" : u.status === "approved" ? "Actif" : u.status === "disabled" ? "Désactivé" : u.status === "rejected" ? "Refusé" : "En attente"}</td>
        <td className="px-2">{adm ? <span className="text-xs text-slate-500">toujours</span> : <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={u.inventoryAccess !== false} onChange={(e) => setInv(u, e.target.checked)} /> Autorisé</label>}</td>
        <td className="px-2">{adm ? <span className="text-xs text-slate-500">toujours (complet)</span> : <select value={stockAccess[u.id] || "defaut"} onChange={(e) => setStock(u, e.target.value)} className={sel}>{!stockAccess[u.id] && <option value="defaut">Par défaut (à la 1re visite)</option>}<option value="agent">Agent MMTE</option><option value="consultation">Consultation seule</option><option value="aucun">Aucun accès</option></select>}</td>
      </tr>; })}</tbody></table></div>
    <div className="text-xs text-slate-500">Activer, désactiver, renommer, réinitialiser le mot de passe ou supprimer un compte : utilisez la liste détaillée ci-dessous. Un compte désactivé n'a plus accès à aucune des deux applications.</div>
  </div>;
}
