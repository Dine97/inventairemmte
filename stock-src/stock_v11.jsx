// ============================================================
// 6.13 — Carte d'identité des parcs, agréments, rapports d'inventaire, parcs tampon uniques (PTU)
// Identité, agréments et rapports : modifiables par l'administrateur seulement.
// ============================================================

// ---------- Outils ----------
function stkCfgExtra(S) {
  S = S || {};
  const arr = (v, d) => (Array.isArray(v) && v.length ? v : d);
  return {
    agr: stkNum(S.seuil_agrement, 30),
    ptuDelai: stkNum(S.delai_ptu, 15),
    zones: arr(S.zones, ["Sèkandji", "MIVVO", "RITIS"]),
    typesRapport: arr(S.types_rapport, ["Inventaire annuel", "Inventaire inopiné", "Contrôle de routine", "Autre"]),
    hidden: Array.isArray(S.modules_masques) ? S.modules_masques : [],
    droits: S.droits && typeof S.droits === "object" ? S.droits : {},
    identiteAdmin: S.identite_visible === "admin"
  };
}
const STK_AGR = {
  valide: { label: "Valide", tone: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  bientot: { label: "Expire bientôt", tone: "bg-amber-50 text-amber-900 border-amber-300" },
  expire: { label: "Expiré", tone: "bg-rose-50 text-rose-800 border-rose-200" },
  manquant: { label: "Manquant", tone: "bg-slate-100 text-slate-600 border-slate-300" }
};
function stkAgrStatus(echeance, today, seuil) {
  if (!echeance) return { code: "manquant", jours: null, text: "Aucun agrément joint" };
  const j = stkDiff(today, echeance);
  if (j < 0) return { code: "expire", jours: j, text: `Expiré depuis ${-j} j` };
  if (j <= seuil) return { code: "bientot", jours: j, text: j === 0 ? "Expire aujourd'hui" : `Expire dans ${j} j` };
  return { code: "valide", jours: j, text: `Valide encore ${j} j` };
}
function StkAgrBadge({ echeance, seuil, short }) {
  const s = stkAgrStatus(echeance, stkToday(), seuil);
  return <StkBadge tone={STK_AGR[s.code].tone}>{short ? STK_AGR[s.code].label : s.code === "manquant" ? "Agrément manquant" : s.text}</StkBadge>;
}
const STK_PARC_TYPES = { parc: "Parc de vente", divers: "Parc de divers", ptu: "Parc tampon unique (PTU)" };
const StkDiversBadge = () => <StkBadge tone="bg-violet-50 text-violet-800 border-violet-200">Parc de divers</StkBadge>;
function stkIsPtu(C, id) { const m = (C.parcsMeta || []).find((x) => x.id === Number(id)); return !!(m && m.type === "ptu"); }
function stkMeta(C, id) { return (C.parcsMeta || []).find((x) => x.id === Number(id)) || {}; }
function stkTelHref(t) { const d = String(t || "").replace(/[^\d+]/g, ""); return d ? "tel:" + d : null; }
function stkWaHref(t) {
  let d = String(t || "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 8 || (d.length === 10 && d.startsWith("01"))) d = "229" + d;
  return "https://wa.me/" + d;
}
// Réduit une photo (façade du parc) avant l'envoi : 1600 px maximum, JPEG
function stkResizeImage(file, max) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, (max || 1600) / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.85).split(",")[1]);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Image illisible")); };
    img.src = url;
  });
}
async function stkOpenParcFile(path) {
  const w = window.open("", "_blank");
  try { const r = await stkCall("file_url", { path, bucket: "parcs" }); if (w) w.location = r.url; else window.open(r.url, "_blank", "noopener"); }
  catch (e) { if (w) w.close(); alert(stkErrText(e)); }
}
const StkIdIc = {
  Pin: (p) => <Icon {...p}><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" /><circle cx="12" cy="10" r="2.5" /></Icon>,
  Phone: (p) => <Icon {...p}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></Icon>,
  Camera: (p) => <Icon {...p}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></Icon>,
  Doc: (p) => <Icon {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h6" /></Icon>,
  Nav: (p) => <Icon {...p}><path d="m3 11 19-9-9 19-2-8-8-2z" /></Icon>,
  Chat: (p) => <Icon {...p}><path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2.1-5.6A8.4 8.4 0 1 1 21 11.5z" /></Icon>
};

// ---------- Bandeau d'identité en tête de la page d'un parc ----------
function StkParcIdStrip({ parcId, onOpen }) {
  const C = React.useContext(StkCtx);
  const m = stkMeta(C, parcId);
  const X = stkCfgExtra(C.settings);
  if (!m.id) return null;
  return <button onClick={onOpen} data-testid="id-strip" className="w-full text-left flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm hover:border-[#1B4F8C]/40">
    {m.type === "ptu" && <StkBadge tone="bg-[#0B1F38] text-[#E8D3A2] border-[#0B1F38]">Parc tampon unique (PTU)</StkBadge>}
    {m.type === "divers" && <StkDiversBadge />}
    <span className="inline-flex items-center gap-1 text-slate-600"><StkIdIc.Pin size={14} /> {m.zone ? <b className="text-[#0B1F38]">Zone {m.zone}</b> : <span className="text-slate-400">Zone non renseignée</span>}</span>
    {m.type !== "ptu" && <StkAgrBadge echeance={m.agrement} seuil={X.agr} />}
    <span className="ml-auto text-xs font-bold text-[#1B4F8C]">Carte d'identité du parc →</span>
  </button>;
}

// ---------- Onglet « Identité » d'un parc ----------
function StkParcIdentity({ parcId, parcName }) {
  const C = React.useContext(StkCtx);
  const { isAdmin, toast } = C;
  const X = stkCfgExtra(C.settings);
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [photo, setPhoto] = useState(null);
  const [edit, setEdit] = useState(false);
  const [agr, setAgr] = useState(null);
  const [rap, setRap] = useState(false);
  const [busy, setBusy] = useState("");
  const load = async () => {
    try { setErr(""); const r = await stkCall("parc_identity", { parc_id: parcId }); setD(r);
      if (r.parc && r.parc.photo_path) stkCall("file_url", { path: r.parc.photo_path, bucket: "parcs" }).then((u) => setPhoto(u.url)).catch(() => setPhoto(null)); else setPhoto(null);
    } catch (e) { setErr(stkErrText(e)); }
  };
  useEffect(() => { load(); }, [parcId]);
  const after = (msg) => { load(); C.reloadMeta && C.reloadMeta(); if (msg) toast(msg); };
  const act = async (a, p, conf, msg) => { if (conf && !window.confirm(conf)) return; try { await stkCall(a, p); after(msg); } catch (e) { alert(stkErrText(e)); } };
  const onPhoto = async (f) => {
    if (!f) return;
    setBusy("Envoi de la photo...");
    try { const b64 = await stkResizeImage(f, 1600); await stkCall("parc_photo_upload", { parc_id: parcId, b64, name: "facade.jpg", type: "image/jpeg" }, false, 90e3); after("Photo de la façade enregistrée"); }
    catch (e) { alert(stkErrText(e)); }
    setBusy("");
  };
  const fixGps = () => {
    if (!navigator.geolocation) { alert("La localisation n'est pas disponible sur cet appareil."); return; }
    setBusy("Recherche de votre position...");
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      setBusy("");
      if (!window.confirm(`Position trouvée (précision ${Math.round(accuracy)} m).\n\nEnregistrer cette position comme localisation du parc ${parcName} ?\n\nÀ faire uniquement quand vous êtes sur le parc.`)) return;
      act("parc_gps_set", { parc_id: parcId, lat, lng, accuracy }, null, "Localisation du parc enregistrée");
    }, (e) => { setBusy(""); alert(e && e.code === 1 ? "Autorisez l'accès à la position dans le navigateur, puis réessayez." : "Position introuvable. Réessayez à l'extérieur, avec le GPS activé."); }, { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 });
  };
  if (err) return <StkMsg tone="err">{err}</StkMsg>;
  if (!d) return <StkCard className="p-6"><StkLoading /></StkCard>;
  if (d.hidden) return <StkMsg tone="info">La carte d'identité des parcs est réservée aux administrateurs.</StkMsg>;
  const p = d.parc;
  const cur = d.agrements[0] || null;
  const st = stkAgrStatus(cur && cur.date_echeance, stkToday(), X.agr);
  const isPtu = p.type === "ptu";
  const Person = ({ role, nom, tel }) => <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
    <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">{role}</div>
    <div className="font-semibold text-[#0B1F38] mt-0.5">{nom || <span className="text-slate-400 font-normal">Non renseigné</span>}</div>
    {tel && <div className="flex flex-wrap items-center gap-2 mt-1.5">
      <span className="font-plex-mono text-sm text-slate-700">{tel}</span>
      <a href={stkTelHref(tel)} className="inline-flex items-center gap-1 text-xs font-bold text-[#1B4F8C] border-2 border-[#1B4F8C]/25 rounded-lg px-2 py-1"><StkIdIc.Phone size={13} /> Appeler</a>
      <a href={stkWaHref(tel)} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 border-2 border-emerald-200 rounded-lg px-2 py-1"><StkIdIc.Chat size={13} /> WhatsApp</a>
    </div>}
  </div>;
  return <div className="space-y-4" data-testid="parc-identity">
    {busy && <StkMsg tone="info">{busy}</StkMsg>}
    <StkCard className="overflow-hidden">
      <div className="grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="relative bg-[#0B1F38] min-h-[220px] flex items-center justify-center">
          {photo ? <img src={photo} alt={`Façade du parc ${p.name}`} className="absolute inset-0 w-full h-full object-cover" /> : <div className="text-center text-white/60 text-sm px-6"><StkIdIc.Camera size={34} className="mx-auto mb-2" />Aucune photo de la façade</div>}
          {isAdmin && <div className="absolute left-3 bottom-3 flex gap-2">
            <label className="cursor-pointer inline-flex items-center gap-1.5 rounded-lg bg-white/95 text-[#123A66] text-xs font-bold px-3 py-2 shadow"><StkIdIc.Camera size={14} /> {photo ? "Changer la photo" : "Ajouter une photo"}
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { onPhoto(e.target.files[0]); e.target.value = ""; }} data-testid="photo-input" /></label>
            {photo && <button className="rounded-lg bg-white/90 text-rose-700 text-xs font-bold px-3 py-2 shadow" onClick={() => act("parc_photo_upload", { parc_id: parcId, remove: true }, "Retirer la photo de la façade ?", "Photo retirée")}>Retirer</button>}
          </div>}
        </div>
        <div className="p-4 md:p-5 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-xl font-semibold text-[#0B1F38] flex-1 min-w-[160px]">{p.name}</div>
            {isPtu && <StkBadge tone="bg-[#0B1F38] text-[#E8D3A2] border-[#0B1F38]">PTU</StkBadge>}
            {p.type === "divers" && <StkDiversBadge />}
            {p.zone && <StkBadge tone="bg-[#EAF1FA] text-[#123A66] border-[#C9DBEF]">Zone {p.zone}</StkBadge>}
            {isAdmin && <StkBtn small onClick={() => setEdit(true)} data-testid="btn-edit-identity"><StkIc.Edit size={14} /> Modifier</StkBtn>}
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            {isPtu ? <Person role="Chargé des transferts" nom={p.chef_parc_nom} tel={p.chef_parc_tel} /> : <>
              <Person role="Chef de parc" nom={p.chef_parc_nom} tel={p.chef_parc_tel} />
              <Person role="Chef trafic" nom={p.chef_trafic_nom} tel={p.chef_trafic_tel} />
            </>}
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Adresse et localisation</div>
            <div className="text-sm text-[#0B1F38] mt-0.5 whitespace-pre-line">{p.adresse || <span className="text-slate-400">Adresse non renseignée</span>}</div>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {p.gps_lat != null ? <>
                <span className="text-xs text-slate-500 font-plex-mono">{Number(p.gps_lat).toFixed(5)}, {Number(p.gps_lng).toFixed(5)}</span>
                <a className="inline-flex items-center gap-1 text-xs font-bold text-[#1B4F8C] border-2 border-[#1B4F8C]/25 rounded-lg px-2 py-1" target="_blank" rel="noopener" href={`https://www.google.com/maps?q=${p.gps_lat},${p.gps_lng}`}><StkIdIc.Pin size={13} /> Voir sur la carte</a>
                <a className="inline-flex items-center gap-1 text-xs font-bold text-[#1B4F8C] border-2 border-[#1B4F8C]/25 rounded-lg px-2 py-1" target="_blank" rel="noopener" href={`https://www.google.com/maps/dir/?api=1&destination=${p.gps_lat},${p.gps_lng}`}><StkIdIc.Nav size={13} /> Itinéraire</a>
              </> : <span className="text-xs text-slate-400">Position GPS non fixée</span>}
              {isAdmin && <StkBtn small onClick={fixGps} data-testid="btn-gps"><StkIdIc.Pin size={14} /> {p.gps_lat != null ? "Refixer la position ici" : "Fixer la position ici"}</StkBtn>}
              {isAdmin && p.gps_lat != null && <button className="text-xs text-rose-700 underline" onClick={() => act("parc_gps_set", { parc_id: parcId, clear: true }, "Effacer la localisation du parc ?", "Localisation effacée")}>Effacer</button>}
            </div>
            {p.gps_at && <div className="text-[11px] text-slate-400 mt-1">Fixée le {stkFmtTs(p.gps_at)}{p.gps_by ? ` par ${p.gps_by}` : ""}</div>}
          </div>
          {(p.contact_nom || p.contact_email || p.contact_tel) && <div className="text-xs text-slate-500">Contact pour les états de stock : {[p.contact_nom, p.contact_email, p.contact_tel].filter(Boolean).join(" · ")}</div>}
          {p.identite_at && <div className="text-[11px] text-slate-400">Fiche mise à jour le {stkFmtTs(p.identite_at)}{p.identite_by ? ` par ${p.identite_by}` : ""}</div>}
        </div>
      </div>
    </StkCard>

    {!isPtu && <StkCard className="p-4 md:p-5 space-y-3" data-testid="agrement-card">
      <div className="flex flex-wrap items-center gap-2">
        <div className="font-bold text-[#0B1F38] text-lg flex-1">Agrément</div>
        {isAdmin && <StkBtn small kind="primary" onClick={() => setAgr(cur ? { renew: cur } : {})} data-testid="btn-add-agrement"><StkIc.Plus size={14} /> {cur ? "Renouveler l'agrément" : "Joindre l'agrément"}</StkBtn>}
      </div>
      {!cur ? <StkMsg tone="warn">Aucun agrément joint pour ce parc.</StkMsg> : <div className={`rounded-xl border-2 px-4 py-3 ${st.code === "expire" ? "border-rose-200 bg-rose-50/60" : st.code === "bientot" ? "border-amber-300 bg-amber-50/60" : "border-emerald-200 bg-emerald-50/50"}`}>
        <div className="flex flex-wrap items-center gap-2">
          <StkBadge tone={STK_AGR[st.code].tone}>{STK_AGR[st.code].label}</StkBadge>
          <span className="font-semibold text-[#0B1F38]">{cur.numero ? `N° ${cur.numero}` : "Agrément"}</span>
          <span className="text-sm text-slate-700">du {stkFmt(cur.date_emission)} au <b>{stkFmt(cur.date_echeance)}</b></span>
          <span className="text-sm font-semibold text-slate-600">· {st.text}</span>
          <div className="flex-1" />
          {cur.file_path && <StkBtn small onClick={() => stkOpenParcFile(cur.file_path)} data-testid="btn-voir-agrement"><Eye size={14} /> Voir l'agrément</StkBtn>}
          {isAdmin && <StkBtn small onClick={() => setAgr({ edit: cur })}>Modifier</StkBtn>}
        </div>
        {cur.note && <div className="text-sm text-slate-600 mt-1">{cur.note}</div>}
      </div>}
      {d.agrements.length > 1 && <div>
        <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">Historique des agréments</div>
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">{d.agrements.slice(1).map((a) => <div key={a.id} className="px-3 py-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">{a.numero ? `N° ${a.numero}` : "Agrément"}</span><span className="text-slate-600">du {stkFmt(a.date_emission)} au {stkFmt(a.date_echeance)}</span>
          <div className="flex-1" />
          {a.file_path && <button className="text-xs font-bold text-[#1B4F8C] underline" onClick={() => stkOpenParcFile(a.file_path)}>Voir</button>}
          {isAdmin && <button className="text-xs font-bold text-[#1B4F8C] underline" onClick={() => setAgr({ edit: a })}>Modifier</button>}
          {isAdmin && <button className="text-xs text-rose-700 underline" onClick={() => act("agrement_delete", { id: a.id }, "Retirer cet agrément de l'historique ?", "Agrément retiré")}>Retirer</button>}
        </div>)}</div>
      </div>}
    </StkCard>}

    <StkCard className="p-4 md:p-5 space-y-3" data-testid="rapports-card">
      <div className="flex flex-wrap items-center gap-2">
        <div className="font-bold text-[#0B1F38] text-lg flex-1">Rapports d'inventaire</div>
        {isAdmin && <StkBtn small kind="primary" onClick={() => setRap(true)} data-testid="btn-add-rapport"><StkIc.Plus size={14} /> Joindre un rapport</StkBtn>}
      </div>
      {!d.rapports.length ? <div className="text-sm text-slate-400">Aucun rapport d'inventaire joint.</div> :
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">{d.rapports.map((r) => <div key={r.id} className="px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <StkIdIc.Doc size={16} className="text-[#1B4F8C]" />
          <span className="font-semibold text-[#0B1F38]">{stkFmt(r.date_rapport)}</span>
          {r.type && <StkBadge>{r.type}</StkBadge>}
          <span className="text-slate-600 truncate max-w-[260px]">{r.file_name}</span>
          {r.commentaire && <span className="text-slate-500 basis-full md:basis-auto">{r.commentaire}</span>}
          <div className="flex-1" />
          <StkBtn small onClick={() => stkOpenParcFile(r.file_path)}><Eye size={14} /> Consulter</StkBtn>
          {isAdmin && <button className="text-xs text-rose-700 underline" onClick={() => act("rapport_delete", { id: r.id }, "Retirer ce rapport ?", "Rapport retiré")}>Retirer</button>}
          <span className="basis-full text-[11px] text-slate-400">Joint par {r.created_by} le {stkFmtTs(r.created_at)}</span>
        </div>)}</div>}
    </StkCard>

    {edit && <StkIdentityForm parc={p} zones={X.zones} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); after("Identité du parc enregistrée"); }} />}
    {agr && <StkAgrementForm parcId={parcId} parcName={p.name} init={agr} onClose={() => setAgr(null)} onSaved={() => { setAgr(null); after("Agrément enregistré"); }} />}
    {rap && <StkRapportForm parcId={parcId} types={X.typesRapport} onClose={() => setRap(false)} onSaved={() => { setRap(false); after("Rapport joint"); }} />}
  </div>;
}

function StkIdentityForm({ parc, zones, onClose, onSaved }) {
  const [f, setF] = useState({ zone: parc.zone || "", adresse: parc.adresse || "", chef_parc_nom: parc.chef_parc_nom || "", chef_parc_tel: parc.chef_parc_tel || "", chef_trafic_nom: parc.chef_trafic_nom || "", chef_trafic_tel: parc.chef_trafic_tel || "", type: parc.type || "parc" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => { setBusy(true); setErr(""); try { await stkCall("parc_identity_save", { parc_id: parc.id, ...f }); onSaved(); } catch (e) { setErr(stkErrText(e)); setBusy(false); } };
  return <StkModal title={`Identité du parc ${parc.name}`} onClose={onClose} footer={<><StkBtn onClick={onClose}>Annuler</StkBtn><StkBtn kind="primary" disabled={busy} onClick={save} data-testid="save-identity">Enregistrer</StkBtn></>}>
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        {/* Pour un PTU, le chargé des transferts est enregistré à la place du chef de parc */}
        <StkField label={f.type === "ptu" ? "Nom du chargé des transferts" : "Nom du chef de parc"}><input value={f.chef_parc_nom} onChange={set("chef_parc_nom")} className={stkInput} data-testid="f-chef-parc" /></StkField>
        <StkField label={f.type === "ptu" ? "Téléphone du chargé des transferts" : "Téléphone du chef de parc"}><input type="tel" value={f.chef_parc_tel} onChange={set("chef_parc_tel")} className={stkInput} placeholder="01 00 00 00 00" /></StkField>
        {f.type !== "ptu" && <>
          <StkField label="Nom du chef trafic"><input value={f.chef_trafic_nom} onChange={set("chef_trafic_nom")} className={stkInput} /></StkField>
          <StkField label="Téléphone du chef trafic"><input type="tel" value={f.chef_trafic_tel} onChange={set("chef_trafic_tel")} className={stkInput} /></StkField>
        </>}
      </div>
      <StkField label="Zone du parc">
        <div className="flex flex-wrap gap-2">{zones.map((z) => <button type="button" key={z} onClick={() => setF((x) => ({ ...x, zone: x.zone === z ? "" : z }))} data-testid={"zone-" + z}
          className={`px-4 py-2 rounded-lg text-sm font-bold border-2 ${f.zone === z ? "bg-[#123A66] text-white border-[#123A66]" : "bg-white text-slate-600 border-slate-200"}`}>{z}</button>)}</div>
      </StkField>
      <StkField label="Adresse" hint="La position GPS se fixe depuis la fiche, une fois sur le parc."><textarea rows={3} value={f.adresse} onChange={set("adresse")} className={stkInput} /></StkField>
      <StkField label="Type" hint={f.type === "divers" ? "Un parc de divers ne vend pas : il ramène des véhicules sur commande. Il envoie ses états de stock comme un parc de vente ; les transferts avec les parcs de vente, dans les deux sens, sont suivis comme les autres." : "Un parc tampon unique (PTU) reçoit les véhicules des manifestes et n'envoie pas d'état de stock."}>
        <select value={f.type} onChange={set("type")} className={stkInput} data-testid="f-type">{Object.entries(STK_PARC_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </StkField>
      {err && <StkMsg tone="err">{err}</StkMsg>}
    </div>
  </StkModal>;
}

function StkAgrementForm({ parcId, parcName, init, onClose, onSaved }) {
  const base = init.edit || {};
  const renewFrom = init.renew ? stkAddDays(init.renew.date_echeance, 1) : "";
  const [f, setF] = useState({ numero: base.numero || "", date_emission: base.date_emission || renewFrom || stkToday(), date_echeance: base.date_echeance || "", note: base.note || "" });
  const [autoEch, setAutoEch] = useState(!base.date_echeance);
  const [file, setFile] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const ech = autoEch && f.date_emission ? stkAddDays(stkAddYears(f.date_emission, 1), -1) : f.date_echeance;
  const save = async () => {
    setErr("");
    if (!f.date_emission || !ech) { setErr("Indiquez la date d'émission et la date d'échéance."); return; }
    if (ech < f.date_emission) { setErr("L'échéance doit suivre la date d'émission."); return; }
    if (!base.id && !file && !window.confirm("Aucun document joint. Enregistrer l'agrément sans le document ?")) return;
    setBusy(true);
    try {
      const p = { parc_id: parcId, id: base.id, numero: f.numero, date_emission: f.date_emission, date_echeance: ech, note: f.note };
      if (file) Object.assign(p, { b64: await stkFileToB64(file), file_name: file.name, file_type: file.type });
      await stkCall("agrement_save", p, false, 120e3);
      onSaved();
    } catch (e) { setErr(stkErrText(e)); setBusy(false); }
  };
  return <StkModal title={`${base.id ? "Modifier l'agrément" : init.renew ? "Renouveler l'agrément" : "Joindre l'agrément"} — ${parcName}`} onClose={onClose} footer={<><StkBtn onClick={onClose}>Annuler</StkBtn><StkBtn kind="primary" disabled={busy} onClick={save} data-testid="save-agrement">{busy ? "Envoi..." : "Enregistrer"}</StkBtn></>}>
    <div className="space-y-3">
      {init.renew && <StkMsg tone="info">L'agrément actuel ({init.renew.numero || "sans n°"}) reste dans l'historique.</StkMsg>}
      <StkField label="N° d'agrément"><input value={f.numero} onChange={(e) => setF((x) => ({ ...x, numero: e.target.value }))} className={stkInput} data-testid="f-agr-numero" /></StkField>
      <div className="grid sm:grid-cols-2 gap-3">
        <StkField label="Date d'émission"><input type="date" value={f.date_emission} onChange={(e) => setF((x) => ({ ...x, date_emission: e.target.value }))} className={stkInput} data-testid="f-agr-emission" /></StkField>
        <StkField label="Date d'échéance" hint={autoEch ? "Calculée : un an après l'émission" : ""}>
          <input type="date" value={ech || ""} disabled={autoEch} onChange={(e) => setF((x) => ({ ...x, date_echeance: e.target.value }))} className={stkInput} data-testid="f-agr-echeance" />
        </StkField>
      </div>
      <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={!autoEch} onChange={(e) => { setAutoEch(!e.target.checked); if (e.target.checked) setF((x) => ({ ...x, date_echeance: ech })); }} /> Saisir une autre date d'échéance</label>
      <StkField label={base.file_path ? "Remplacer le document (facultatif)" : "Document de l'agrément (PDF ou photo)"}>
        <input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files[0] || null)} className="block text-sm" data-testid="f-agr-file" />
      </StkField>
      <StkField label="Note"><input value={f.note} onChange={(e) => setF((x) => ({ ...x, note: e.target.value }))} className={stkInput} /></StkField>
      {err && <StkMsg tone="err">{err}</StkMsg>}
    </div>
  </StkModal>;
}
function stkAddYears(iso, n) { const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); const t = new Date(Date.UTC(y + n, m - 1, d, 12)); if (t.getUTCMonth() !== m - 1) t.setUTCDate(0); return t.toISOString().slice(0, 10); }

function StkRapportForm({ parcId, types, onClose, onSaved }) {
  const [f, setF] = useState({ date_rapport: stkToday(), type: types[0] || "", commentaire: "" });
  const [file, setFile] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!file) { setErr("Choisissez le fichier du rapport."); return; }
    setBusy(true); setErr("");
    try { await stkCall("rapport_add", { parc_id: parcId, ...f, b64: await stkFileToB64(file), file_name: file.name, file_type: file.type }, false, 120e3); onSaved(); }
    catch (e) { setErr(stkErrText(e)); setBusy(false); }
  };
  return <StkModal title="Joindre un rapport d'inventaire" onClose={onClose} footer={<><StkBtn onClick={onClose}>Annuler</StkBtn><StkBtn kind="primary" disabled={busy} onClick={save} data-testid="save-rapport">{busy ? "Envoi..." : "Enregistrer"}</StkBtn></>}>
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <StkField label="Date du rapport"><input type="date" value={f.date_rapport} onChange={(e) => setF((x) => ({ ...x, date_rapport: e.target.value }))} className={stkInput} /></StkField>
        <StkField label="Type"><select value={f.type} onChange={(e) => setF((x) => ({ ...x, type: e.target.value }))} className={stkInput}>{types.map((t) => <option key={t}>{t}</option>)}</select></StkField>
      </div>
      <StkField label="Fichier (PDF, Word, Excel ou photo — 12 Mo maximum)"><input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,image/*" onChange={(e) => setFile(e.target.files[0] || null)} className="block text-sm" data-testid="f-rap-file" /></StkField>
      <StkField label="Commentaire"><textarea rows={3} value={f.commentaire} onChange={(e) => setF((x) => ({ ...x, commentaire: e.target.value }))} className={stkInput} /></StkField>
      {err && <StkMsg tone="err">{err}</StkMsg>}
    </div>
  </StkModal>;
}

// ---------- Écran « Agréments » ----------
function StkAgrements() {
  const C = React.useContext(StkCtx);
  const { openParc, isAdmin } = C;
  const X = stkCfgExtra(C.settings);
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [f, setF] = useState({ statut: "", zone: "", mois: "", q: "" });
  useEffect(() => { stkCall("agrements").then(setD).catch((e) => setErr(stkErrText(e))); }, []);
  const today = stkToday();
  const rows = useMemo(() => {
    if (!d) return [];
    const by = {}; d.agrements.forEach((a) => { (by[a.parc_id] = by[a.parc_id] || []).push(a); });
    return d.parcs.filter((p) => p.type !== "ptu" && p.active !== false).map((p) => {
      const list = (by[p.id] || []).sort((a, b) => String(b.date_echeance).localeCompare(a.date_echeance));
      const a = list[0] || null;
      const s = stkAgrStatus(a && a.date_echeance, today, X.agr);
      return { ...p, parc_id: p.id, agr: a, nb: list.length, statut: s.code, jours: s.jours, stext: s.text };
    });
  }, [d]);
  const counts = { valide: 0, bientot: 0, expire: 0, manquant: 0 }; rows.forEach((r) => counts[r.statut]++);
  const months = [...new Set(rows.filter((r) => r.agr).map((r) => r.agr.date_echeance.slice(0, 7)))].sort();
  const monthName = (m) => new Date(m + "-15T12:00:00Z").toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const list = rows.filter((r) => (!f.statut || r.statut === f.statut) && (!f.zone || (f.zone === "-" ? !r.zone : r.zone === f.zone)) && (!f.mois || (r.agr && r.agr.date_echeance.startsWith(f.mois)))
    && (!f.q || (r.name + " " + ((r.agr && r.agr.numero) || "")).toUpperCase().includes(f.q.trim().toUpperCase())))
    .sort((a, b) => ({ expire: 0, bientot: 1, manquant: 2, valide: 3 }[a.statut] - { expire: 0, bientot: 1, manquant: 2, valide: 3 }[b.statut]) || ((a.jours == null ? 1e9 : a.jours) - (b.jours == null ? 1e9 : b.jours)) || a.name.localeCompare(b.name));
  const xcols = [{ h: "Parc", k: "name", w: 24 }, { h: "Type", x: (r) => STK_PARC_TYPES[r.type] || "", w: 14 }, { h: "Zone", k: "zone", w: 12 }, { h: "N° d'agrément", x: (r) => r.agr ? r.agr.numero : "", w: 18 }, { h: "Émission", x: (r) => r.agr ? stkFmt(r.agr.date_emission) : "", w: 12 }, { h: "Échéance", x: (r) => r.agr ? stkFmt(r.agr.date_echeance) : "", w: 12 }, { h: "Jours restants", x: (r) => r.jours == null ? "" : r.jours, w: 10 }, { h: "Statut", x: (r) => STK_AGR[r.statut].label, w: 16 }, { h: "Document", x: (r) => r.agr && r.agr.file_path ? "Joint" : "Non joint", w: 10 }];
  const exp = (k) => {
    const meta = [`Situation au ${stkFmt(today)} — alerte ${X.agr} jours avant l'échéance`, `${list.length} parc(s)`];
    if (k === "x") stkExportXlsx(`Agrements_parcs_${today}`, "Agréments des parcs", meta, xcols, list);
    else stkPrintPdf("Agréments des parcs", meta, xcols, list, false);
  };
  const mail = (r) => {
    const to = stkMailEmails(r.contact_email);
    const s = r.statut === "expire" ? `Votre agrément ${r.agr && r.agr.numero ? "n° " + r.agr.numero + " " : ""}est arrivé à échéance le ${stkFmt(r.agr.date_echeance)}.` : r.statut === "manquant" ? "Nous ne disposons pas de votre agrément en cours de validité." : `Votre agrément ${r.agr.numero ? "n° " + r.agr.numero + " " : ""}arrive à échéance le ${stkFmt(r.agr.date_echeance)}.`;
    window.location.href = stkMailto(to, `Agrément du parc ${r.name}`, `Madame, Monsieur,\n\n${s}\n\nMerci de nous transmettre une copie de l'agrément renouvelé dès sa délivrance.\n\nCordialement,\n\n${C.userName || ""}\nBénin Control — Département MAD-MAE`);
  };
  if (err) return <><StkPageHead title="Agréments des parcs" /><StkMsg tone="err">{err}</StkMsg></>;
  return <>
    <StkPageHead title="Agréments des parcs" sub={`Agrément d'un an renouvelable · alerte ${X.agr} jours avant l'échéance${isAdmin ? " (réglable dans Administration → Paramètres)" : ""}`} right={<StkExportBar disabled={!list.length} onXlsx={() => exp("x")} onPdf={() => exp("p")} />} />
    {!d ? <StkLoading /> : <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {["expire", "bientot", "manquant", "valide"].map((k) => <button key={k} data-testid={"agr-kpi-" + k} onClick={() => setF((x) => ({ ...x, statut: x.statut === k ? "" : k }))} className={`text-left rounded-2xl border-2 px-4 py-3 bg-white ${f.statut === k ? "border-[#123A66]" : "border-slate-200"}`}>
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{STK_AGR[k].label}</div>
          <div className={`font-plex-mono text-2xl font-bold mt-1 ${k === "expire" ? "text-rose-700" : k === "bientot" ? "text-amber-700" : k === "valide" ? "text-emerald-700" : "text-slate-600"}`}>{counts[k]}</div>
        </button>)}
      </div>
      <StkCard className="p-4 md:p-5 space-y-3">
        <div className="flex flex-wrap gap-2">
          <input value={f.q} onChange={(e) => setF((x) => ({ ...x, q: e.target.value }))} placeholder="Parc ou n° d'agrément" className={`${stkInput} flex-1 min-w-[180px]`} />
          <select value={f.statut} onChange={(e) => setF((x) => ({ ...x, statut: e.target.value }))} className={`${stkInput} max-w-[180px]`} data-testid="agr-f-statut"><option value="">Tous les statuts</option>{Object.entries(STK_AGR).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
          <select value={f.zone} onChange={(e) => setF((x) => ({ ...x, zone: e.target.value }))} className={`${stkInput} max-w-[170px]`}><option value="">Toutes les zones</option>{X.zones.map((z) => <option key={z} value={z}>{z}</option>)}<option value="-">Zone non renseignée</option></select>
          <select value={f.mois} onChange={(e) => setF((x) => ({ ...x, mois: e.target.value }))} className={`${stkInput} max-w-[200px]`}><option value="">Toutes les échéances</option>{months.map((m) => <option key={m} value={m}>Échéance en {monthName(m)}</option>)}</select>
        </div>
        <StkTable rows={list} rowKey={(r) => r.id} onRow={(r) => openParc(r.id, "identite")} empty="Aucun parc." columns={[
          { key: "name", label: "Parc", render: (r) => <b className="text-[#0B1F38] whitespace-nowrap">{r.name}</b> },
          { key: "zone", label: "Zone", render: (r) => <span className="whitespace-nowrap">{r.zone || <span className="text-slate-400">—</span>}{r.type === "divers" && <span className="ml-1.5"><StkDiversBadge /></span>}</span> },
          { key: "numero", label: "N°", sort: (r) => r.agr && r.agr.numero, render: (r) => r.agr ? (r.agr.numero || "—") : "—" },
          { key: "em", label: "Émission", sort: (r) => r.agr && r.agr.date_emission, render: (r) => r.agr ? stkFmt(r.agr.date_emission) : "—" },
          { key: "ech", label: "Échéance", sort: (r) => r.agr && r.agr.date_echeance, render: (r) => r.agr ? <b>{stkFmt(r.agr.date_echeance)}</b> : "—" },
          { key: "jours", label: "Statut", sort: (r) => r.jours == null ? 1e9 : r.jours, render: (r) => <StkBadge tone={STK_AGR[r.statut].tone}>{r.statut === "valide" ? `Valide · ${r.jours} j` : r.stext}</StkBadge> },
          { key: "doc", label: "", sortable: false, render: (r) => <div className="flex gap-1.5 justify-end" onClick={(e) => e.stopPropagation()}>
            {r.agr && r.agr.file_path && <StkBtn small onClick={() => stkOpenParcFile(r.agr.file_path)}><Eye size={14} /> Voir</StkBtn>}
            {r.statut !== "valide" && stkMailEmails(r.contact_email).length > 0 && <StkBtn small onClick={() => mail(r)} title={r.contact_email}>Écrire au parc</StkBtn>}
          </div> }
        ]} />
      </StkCard>
    </>}
  </>;
}

// Alerte des agréments sur le tableau de bord
function StkAgrAlert() {
  const C = React.useContext(StkCtx);
  const X = stkCfgExtra(C.settings);
  if (X.hidden.includes("agrements")) return null;
  const today = stkToday();
  const ps = (C.parcsMeta || []).filter((m) => m.type !== "ptu" && (C.dash.find((d) => d.parc_id === m.id) || {}).active !== false);
  const st = ps.map((m) => stkAgrStatus(m.agrement, today, X.agr).code);
  const exp = st.filter((s) => s === "expire").length, soon = st.filter((s) => s === "bientot").length, miss = st.filter((s) => s === "manquant").length;
  if (!exp && !soon && !miss) return null;
  return <button onClick={() => C.go("agrements")} data-testid="agr-alert" className={`w-full text-left rounded-xl border-2 px-4 py-3 text-sm flex flex-wrap items-center gap-x-4 gap-y-1 ${exp || soon ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-200 bg-white text-slate-600"}`}>
    <b>Agréments des parcs</b>
    {exp > 0 && <span className="font-bold text-rose-700">{exp} expiré(s)</span>}
    {soon > 0 && <span className="font-bold">{soon} expire(nt) dans moins de {X.agr} jours</span>}
    {miss > 0 && <span>{miss} non joint(s)</span>}
    <span className="ml-auto font-bold text-[#1B4F8C]">Voir les agréments →</span>
  </button>;
}

// ---------- Parcs tampon uniques (PTU) ----------
const STK_DEVENIR = {
  au_ptu: { label: "Encore au PTU", tone: "bg-amber-50 text-amber-900 border-amber-300" },
  en_parc: { label: "Parti en parc", tone: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  enleve: { label: "Enlèvement direct", tone: "bg-sky-50 text-sky-800 border-sky-200" },
  inconnu: { label: "À vérifier", tone: "bg-slate-100 text-slate-600 border-slate-300" }
};
function StkPtuCard() {
  const C = React.useContext(StkCtx);
  const ptus = (C.parcsMeta || []).filter((m) => m.type === "ptu");
  if (!ptus.length || stkCfgExtra(C.settings).hidden.includes("ptu")) return null;
  const rows = ptus.map((m) => ({ m, d: C.dashAll.find((x) => x.parc_id === m.id) || {} }));
  const tot = rows.reduce((a, r) => a + (+r.d.presents || 0), 0);
  return <StkCard className="p-4 md:p-5" data-testid="ptu-card">
    <div className="flex flex-wrap items-center gap-2 mb-3">
      <div className="font-bold text-[#0B1F38] text-lg flex-1">Au port — parcs tampon uniques</div>
      <div className="font-plex-mono text-2xl font-bold text-[#123A66]">{tot.toLocaleString("fr-FR")}</div>
      <StkBtn small onClick={() => C.go("ptu")}>Manifestes et PTU</StkBtn>
    </div>
    <div className="grid sm:grid-cols-2 gap-3">{rows.map(({ m, d }) => <button key={m.id} onClick={() => C.openParc(m.id)} className="text-left rounded-xl border-2 border-slate-100 hover:border-[#1B4F8C]/40 bg-[#FAFCFF] p-3 flex items-center gap-3">
      <div className="flex-1 min-w-0"><div className="font-bold text-[#0B1F38] truncate">{m.name}</div><div className="text-[11px] text-slate-500">Hors stock des parcs · alimenté par les manifestes</div></div>
      <div className="font-plex-mono text-xl font-bold text-[#123A66]">{(+d.presents || 0).toLocaleString("fr-FR")}</div>
    </button>)}</div>
  </StkCard>;
}

function StkPtu({ ptuId: fixed }) {
  const C = React.useContext(StkCtx);
  const { openVehicle, isAdmin } = C;
  const X = stkCfgExtra(C.settings);
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [ptu, setPtu] = useState(fixed || "");
  const [open, setOpen] = useState(null); // manifeste ouvert
  const [imp, setImp] = useState(false);
  const [enl, setEnl] = useState(false);
  const [late, setLate] = useState(null);
  const canMan = stkCan(C, "manifestes"), canEnl = stkCan(C, "enlevement");
  const load = () => stkCall("ptu_overview").then(setD).catch((e) => setErr(stkErrText(e)));
  useEffect(() => { load(); }, []);
  const ptus = d ? d.ptus : [];
  const man = d ? d.manifestes.filter((m) => !ptu || m.ptu_id === Number(ptu)) : [];
  const sum = man.reduce((a, m) => ({ n: a.n + m.manifestes, p: a.p + m.en_parc, e: a.e + m.enleves, r: a.r + m.au_ptu }), { n: 0, p: 0, e: 0, r: 0 });
  const showLate = async () => {
    try { const r = await stkCall("ptu_vehicules", { ptu_id: ptu || null }); setLate(r.filter((x) => x.devenir === "au_ptu" && x.jours > X.ptuDelai).filter((x) => !ptu || true)); }
    catch (e) { setErr(stkErrText(e)); }
  };
  const after = () => { load(); C.reloadDash(); };
  return <>
    {!fixed && <StkPageHead title="Parcs tampon uniques (PTU)" sub="Véhicules reçus par manifeste au port, puis partis vers les parcs ou enlevés directement. Le stock des PTU est compté à part." right={<>
      {canMan && <StkBtn kind="primary" onClick={() => setImp(true)} data-testid="btn-import-manifeste"><Upload size={16} /> Importer un manifeste</StkBtn>}
      {canEnl && <StkBtn onClick={() => setEnl(true)} data-testid="btn-enlevement"><StkIc.Truck size={16} /> Enlèvement direct</StkBtn>}
    </>} />}
    {fixed && <div className="flex flex-wrap gap-2 justify-end">
      {canMan && <StkBtn small kind="primary" onClick={() => setImp(true)} data-testid="btn-import-manifeste"><Upload size={15} /> Importer un manifeste</StkBtn>}
      {canEnl && <StkBtn small onClick={() => setEnl(true)} data-testid="btn-enlevement"><StkIc.Truck size={15} /> Enlèvement direct</StkBtn>}
    </div>}
    {err && <StkMsg tone="err">{err}</StkMsg>}
    {!d ? <StkLoading /> : <>
      {!fixed && ptus.length > 1 && <StkTabs tabs={[{ key: "", label: "Tous les PTU" }, ...ptus.map((p) => ({ key: String(p.id), label: p.name, count: (C.dashAll.find((x) => x.parc_id === p.id) || {}).presents != null ? +(C.dashAll.find((x) => x.parc_id === p.id) || {}).presents : null }))]} value={String(ptu)} onChange={setPtu} />}
      {!ptus.length && <StkMsg tone="warn">Aucun parc n'est déclaré comme PTU. Un administrateur peut le faire dans la carte d'identité du parc (Type : parc tampon unique).</StkMsg>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StkKpi label="Véhicules manifestés" value={sum.n} />
        <StkKpi label="Partis en parc" value={sum.p} tone="green" />
        <StkKpi label="Enlèvement direct" value={sum.e} tone="slate" />
        <StkKpi label="Encore au PTU" value={sum.r} tone="amber" sub={`alerte au-delà de ${X.ptuDelai} j`} onClick={showLate} />
      </div>
      <StkCard className="p-4 md:p-5">
        <div className="font-bold text-[#0B1F38] text-lg mb-3">Manifestes</div>
        <StkTable rows={man} rowKey={(r) => r.id} onRow={(r) => setOpen(r)} empty="Aucun manifeste importé." columns={[
          { key: "numero", label: "Manifeste", render: (r) => <b className="font-plex-mono text-[#0B1F38] whitespace-nowrap">{r.numero}</b> },
          { key: "navire", label: "Navire", render: (r) => r.navire || "—" },
          { key: "date_arrivee", label: "Arrivée", render: (r) => stkFmt(r.date_arrivee) },
          ...(ptu ? [] : [{ key: "ptu", label: "PTU", render: (r) => <span className="whitespace-nowrap">{r.ptu}</span> }]),
          { key: "manifestes", label: "Manifestés", render: (r) => <span className="font-plex-mono">{r.manifestes}</span> },
          { key: "en_parc", label: "En parc", render: (r) => <span className="font-plex-mono text-emerald-700">{r.en_parc}</span> },
          { key: "enleves", label: "Enlevés", render: (r) => <span className="font-plex-mono text-sky-700">{r.enleves}</span> },
          { key: "au_ptu", label: "Encore au PTU", render: (r) => <span className={`font-plex-mono font-bold ${r.au_ptu && r.au_ptu_depuis_max > X.ptuDelai ? "text-rose-700" : r.au_ptu ? "text-amber-700" : "text-slate-400"}`}>{r.au_ptu}{r.au_ptu && r.au_ptu_depuis_max > X.ptuDelai ? ` (jusqu'à ${r.au_ptu_depuis_max} j)` : ""}</span> }
        ]} />
      </StkCard>
    </>}
    {open && <StkPtuManifestModal m={open} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); after(); }} />}
    {late && <StkModal wide title={`Véhicules au PTU depuis plus de ${X.ptuDelai} jours`} onClose={() => setLate(null)}>
      <StkPtuVehList rows={late} name={`Au_PTU_plus_${X.ptuDelai}j`} />
    </StkModal>}
    {imp && <StkManifestImport ptus={ptus} ptuId={ptu || fixed} onClose={() => setImp(false)} onDone={() => { setImp(false); after(); }} />}
    {enl && <StkEnlevement ptus={ptus} ptuId={ptu || fixed} onClose={() => setEnl(false)} onDone={() => { setEnl(false); after(); }} />}
  </>;
}
function StkPtuVehList({ rows, name }) {
  const { openVehicle } = React.useContext(StkCtx);
  const [dev, setDev] = useState("");
  const [q, setQ] = useState("");
  const counts = {}; rows.forEach((r) => (counts[r.devenir] = (counts[r.devenir] || 0) + 1));
  const list = stkFilterRows(rows.filter((r) => !dev || r.devenir === dev), q);
  const cols = [{ h: "Châssis", k: "chassis", w: 22 }, { h: "Marque", k: "marque" }, { h: "Modèle", k: "modele" }, { h: "Manifeste", k: "numero_manifeste" }, { h: "Navire", k: "navire", w: 20 }, { h: "BL", k: "bl" }, { h: "Importateur", k: "importateur", w: 22 },
    { h: "Arrivée au PTU", x: (r) => stkFmt(r.entree_ptu) }, { h: "Devenir", x: (r) => STK_DEVENIR[r.devenir].label, w: 16 }, { h: "Parc", k: "parc", w: 18 }, { h: "Date de sortie du PTU", x: (r) => stkFmt(r.sortie_ptu) }, { h: "Jours au PTU", k: "jours", w: 8 }, { h: "N° déclaration", k: "justif_numero" }];
  const exp = (k) => { const meta = [`Édité le ${stkFmt(stkToday())}`]; if (k === "x") stkExportXlsx(name, name.replace(/_/g, " "), meta, cols, list); else stkPrintPdf(name.replace(/_/g, " "), meta, cols.filter((c) => !["BL", "Importateur", "Modèle"].includes(c.h)), list); };
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-2">{Object.keys(STK_DEVENIR).filter((k) => counts[k]).map((k) => <button key={k} onClick={() => setDev(dev === k ? "" : k)} className={`px-3 py-1.5 rounded-lg text-sm font-bold border-2 ${dev === k ? "bg-[#123A66] text-white border-[#123A66]" : "bg-white text-slate-600 border-slate-200"}`}>{STK_DEVENIR[k].label} <span className="font-plex-mono">{counts[k]}</span></button>)}</div>
    <div className="flex flex-wrap gap-2"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer : châssis, marque, BL..." className={`${stkInput} flex-1 min-w-[180px]`} /><StkExportBar disabled={!list.length} onXlsx={() => exp("x")} onPdf={() => exp("p")} /></div>
    <StkTable rows={list} rowKey={(r) => r.manifeste_id + "-" + r.vehicle_id} onRow={(r) => openVehicle({ id: r.vehicle_id })} empty="Aucun véhicule." columns={[
      { key: "chassis", label: "Châssis", render: (r) => <span className="font-plex-mono font-bold text-[#0B1F38] whitespace-nowrap">{r.chassis}</span> },
      { key: "veh", label: "Véhicule", sort: (r) => stkVeh(r), render: (r) => stkVeh(r) || "—" },
      { key: "bl", label: "BL", render: (r) => r.bl || "—" },
      { key: "devenir", label: "Devenir", render: (r) => <span><StkBadge tone={STK_DEVENIR[r.devenir].tone}>{STK_DEVENIR[r.devenir].label}</StkBadge>{r.parc && <span className="block text-[11px] font-bold text-slate-600 mt-0.5">{r.parc}</span>}</span> },
      { key: "sortie_ptu", label: "Sortie du PTU", render: (r) => stkFmt(r.sortie_ptu) || "—" },
      { key: "jours", label: "Jours au PTU", render: (r) => <span className="font-plex-mono">{r.jours}</span> }
    ]} />
  </div>;
}
function StkPtuManifestModal({ m, onClose, onChanged }) {
  const C = React.useContext(StkCtx);
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { stkCall("ptu_vehicules", { manifeste_id: m.id }).then(setRows).catch((e) => setErr(stkErrText(e))); }, []);
  const cancel = async () => {
    const reason = window.prompt(`Annuler le manifeste ${m.numero} ? Ses ${m.manifestes} véhicule(s) seront retirés du stock du PTU.\n\nMotif :`);
    if (!reason) return;
    try { await stkCall("ptu_manifest_cancel", { id: m.id, reason }, false, 120e3); C.toast(`Manifeste ${m.numero} annulé`); onChanged(); } catch (e) { setErr(stkErrText(e)); }
  };
  return <StkModal wide title={<span>Manifeste <span className="font-plex-mono">{m.numero}</span> · {m.ptu}</span>} onClose={onClose} footer={<>{C.isAdmin && <StkBtn small kind="danger" onClick={cancel}>Annuler ce manifeste</StkBtn>}<StkBtn small kind="primary" onClick={onClose}>Fermer</StkBtn></>}>
    <div className="space-y-3">
      <div className="text-sm text-slate-600">Navire <b>{m.navire || "—"}</b> · arrivée le <b>{stkFmt(m.date_arrivee)}</b> · {m.manifestes} véhicule(s){m.file_name ? ` · fichier ${m.file_name}` : ""} · importé par {m.created_by} le {stkFmtTs(m.created_at)}</div>
      {err && <StkMsg tone="err">{err}</StkMsg>}
      {!rows ? <StkLoading /> : <StkPtuVehList rows={rows} name={`Manifeste_${m.numero}`} />}
    </div>
  </StkModal>;
}

// Import d'un manifeste (fichier Excel, ou châssis collés) dans un PTU
function StkManifestImport({ ptus, ptuId, onClose, onDone }) {
  const C = React.useContext(StkCtx);
  const [ptu, setPtu] = useState(ptuId ? String(ptuId) : (ptus.length === 1 ? String(ptus[0].id) : ""));
  const [f, setF] = useState({ numero: "", navire: "", date_arrivee: "" });
  const [items, setItems] = useState([]);
  const [fileName, setFileName] = useState("");
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [res, setRes] = useState(null);
  const onFile = async (file) => {
    if (!file) return;
    setErr(""); setBusy("Lecture du fichier...");
    try {
      const book = await stkOpenWorkbook(file, (p) => setBusy(stkProgressText(p, file.size)));
      let synonyms = [];
      try { synonyms = (await stkCall("templates", {})).synonyms || []; } catch (e) {}
      let r;
      try { r = await stkParseBook(book, { synonyms }, (p) => setBusy(stkProgressText(p, file.size))); } finally { stkCloseBook(book); }
      const all = [].concat(...r.sheets.map((s) => s.rows));
      if (!all.length) { setErr("Aucune colonne de châssis reconnue. Vous pouvez aussi coller la liste des châssis."); setBusy(""); return; }
      const seen = new Set();
      const list = all.filter((x) => (seen.has(x.chassis) ? false : seen.add(x.chassis))).map((x) => ({ chassis: x.chassis, chassis_raw: x.chassis_raw, marque: x.marque, modele: x.modele, annee: x.annee, navire: x.navire, manifeste: x.manifeste, bl: x.bl, date_arrivee: x.date_arrivee, importateur: x.importateur }));
      setItems(list); setFileName(file.name);
      const most = (k) => { const c = {}; list.forEach((x) => x[k] && (c[x[k]] = (c[x[k]] || 0) + 1)); return Object.keys(c).sort((a, b) => c[b] - c[a])[0] || ""; };
      setF((x) => ({ numero: x.numero || most("manifeste"), navire: x.navire || most("navire"), date_arrivee: x.date_arrivee || most("date_arrivee") }));
    } catch (e) { setErr("Fichier illisible : " + (e.message || e)); }
    setBusy("");
  };
  const addPaste = () => { const l = stkParsePastedChassis(paste); if (!l.length) { setErr("Aucun châssis reconnu."); return; } setErr(""); setItems((xs) => { const h = new Set(xs.map((x) => x.chassis)); return [...xs, ...l.filter((c) => !h.has(c)).map((c) => ({ chassis: c }))]; }); setPaste(""); };
  const run = async (force) => {
    setErr("");
    if (!ptu) { setErr("Choisissez le PTU."); return; }
    if (!f.numero.trim()) { setErr("Indiquez le n° du manifeste."); return; }
    if (!f.date_arrivee) { setErr("Indiquez la date d'arrivée du navire."); return; }
    if (!items.length) { setErr("Ajoutez les véhicules du manifeste."); return; }
    setBusy("Enregistrement du manifeste...");
    try { const r = await stkCall("ptu_manifest_add", { ptu_id: Number(ptu), ...f, file_name: fileName || null, items, force: !!force }, false, 180e3); setRes(r); C.toast(`Manifeste ${f.numero} : ${r.ok} véhicule(s) entré(s) au PTU`); }
    catch (e) {
      if (String(e.message) === "MANIFESTE_DEJA_IMPORTE") { setBusy(""); if (window.confirm(`Le manifeste ${f.numero} a déjà été importé dans ce PTU. L'importer quand même (les véhicules déjà présents seront ignorés) ?`)) run(true); return; }
      setErr(stkErrText(e));
    }
    setBusy("");
  };
  if (res) return <StkModal title="Manifeste enregistré" onClose={onDone} footer={<StkBtn kind="primary" onClick={onDone}>Terminer</StkBtn>}>
    <div className="space-y-3" data-testid="manifest-result">
      <StkMsg tone="ok"><b>{res.ok}</b> véhicule(s) entré(s) au PTU sur {res.total}.</StkMsg>
      {res.deja_present > 0 && <StkMsg tone="info">{res.deja_present} véhicule(s) étaient déjà au PTU.</StkMsg>}
      <div className="text-sm text-slate-600">Les véhicules déjà présents dans un parc sont automatiquement notés comme partis en parc.</div>
    </div>
  </StkModal>;
  return <StkModal wide title="Importer un manifeste" onClose={onClose} footer={<><StkBtn onClick={onClose}>Annuler</StkBtn><StkBtn kind="primary" disabled={!!busy} onClick={() => run(false)} data-testid="save-manifeste">Enregistrer {items.length ? `(${items.length} véhicule${items.length > 1 ? "s" : ""})` : ""}</StkBtn></>}>
    <div className="space-y-4">
      <div className="grid md:grid-cols-4 gap-3">
        <StkField label="PTU"><select value={ptu} onChange={(e) => setPtu(e.target.value)} className={stkInput} data-testid="f-ptu"><option value="">Choisir...</option>{ptus.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></StkField>
        <StkField label="N° du manifeste"><input value={f.numero} onChange={(e) => setF((x) => ({ ...x, numero: e.target.value }))} className={stkInput} data-testid="f-man-numero" /></StkField>
        <StkField label="Navire"><input value={f.navire} onChange={(e) => setF((x) => ({ ...x, navire: e.target.value }))} className={stkInput} /></StkField>
        <StkField label="Date d'arrivée du navire"><input type="date" value={f.date_arrivee} onChange={(e) => setF((x) => ({ ...x, date_arrivee: e.target.value }))} className={stkInput} data-testid="f-man-date" /></StkField>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <StkCard className="p-4"><div className="font-bold text-[#0B1F38] mb-2">Fichier du manifeste (Excel)</div>
          <input type="file" accept=".xlsx,.xls,.xlsm,.csv" onChange={(e) => { onFile(e.target.files[0]); e.target.value = ""; }} className="block text-sm" data-testid="f-man-file" />
          {fileName && <div className="text-xs text-slate-500 mt-2">{fileName} · {items.length} véhicule(s) lu(s)</div>}</StkCard>
        <StkCard className="p-4"><div className="font-bold text-[#0B1F38] mb-2">Ou coller les châssis</div>
          <textarea rows={3} value={paste} onChange={(e) => setPaste(e.target.value)} className={stkInput} placeholder="Un châssis par ligne" data-testid="f-man-paste" />
          <StkBtn small className="mt-2" onClick={addPaste}>Ajouter</StkBtn></StkCard>
      </div>
      {busy && <StkMsg tone="info">{busy}</StkMsg>}
      {err && <StkMsg tone="err">{err}</StkMsg>}
      {items.length > 0 && <div>
        <div className="flex items-center gap-2 mb-1"><div className="font-bold text-[#0B1F38] flex-1">{items.length} véhicule(s)</div><button className="text-xs text-rose-700 underline" onClick={() => { setItems([]); setFileName(""); }}>Tout retirer</button></div>
        <StkTable rows={items} rowKey={(r) => r.chassis} initial={100} columns={[
          { key: "chassis", label: "Châssis", render: (r) => <span className="font-plex-mono font-bold whitespace-nowrap">{r.chassis}</span> },
          { key: "veh", label: "Véhicule", sort: (r) => stkVeh(r), render: (r) => stkVeh(r) || "—" },
          { key: "bl", label: "BL", render: (r) => r.bl || "—" },
          { key: "importateur", label: "Importateur", render: (r) => r.importateur || "—" },
          { key: "x", label: "", sortable: false, render: (r) => <button className="text-rose-600 text-xs" onClick={() => setItems((xs) => xs.filter((x) => x.chassis !== r.chassis))}>✕</button> }
        ]} />
      </div>}
    </div>
  </StkModal>;
}

// Enlèvement direct au PTU (achat sans passage en parc)
function StkEnlevement({ ptus, ptuId, onClose, onDone }) {
  const C = React.useContext(StkCtx);
  const [ptu, setPtu] = useState(ptuId ? String(ptuId) : (ptus.length === 1 ? String(ptus[0].id) : ""));
  const [paste, setPaste] = useState("");
  const [date, setDate] = useState(stkToday());
  const [num, setNum] = useState("");
  const [jdate, setJdate] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState(null);
  const list = stkParsePastedChassis(paste);
  const run = async () => {
    setErr("");
    if (!ptu) { setErr("Choisissez le PTU."); return; }
    if (!list.length) { setErr("Saisissez au moins un châssis."); return; }
    setBusy(true);
    try { const r = await stkCall("ptu_enlevement", { ptu_id: Number(ptu), date, justif_numero: num, justif_date: jdate || null, items: list.map((c) => ({ chassis: c })) }, false, 120e3); setRes(r); C.toast(`Enlèvement direct : ${r.ok} véhicule(s)`); }
    catch (e) { setErr(stkErrText(e)); }
    setBusy(false);
  };
  if (res) return <StkModal title="Enlèvement direct enregistré" onClose={onDone} footer={<StkBtn kind="primary" onClick={onDone}>Terminer</StkBtn>}>
    <div className="space-y-2" data-testid="enlevement-result">
      <StkMsg tone="ok"><b>{res.ok}</b> véhicule(s) sorti(s) du PTU sur {res.total}.</StkMsg>
      {(res.details || []).filter((x) => x.result !== "ok").map((x) => <div key={x.chassis} className="text-sm"><span className="font-plex-mono font-bold">{x.chassis}</span> : {x.result === "absent" ? "pas au PTU (déjà parti ou jamais manifesté)" : x.result === "inconnu" ? "châssis inconnu" : x.result}</div>)}
    </div>
  </StkModal>;
  return <StkModal title="Enlèvement direct au PTU" onClose={onClose} footer={<><StkBtn onClick={onClose}>Annuler</StkBtn><StkBtn kind="primary" disabled={busy} onClick={run} data-testid="save-enlevement">Enregistrer {list.length ? `(${list.length})` : ""}</StkBtn></>}>
    <div className="space-y-3">
      <StkMsg tone="info">Véhicule acheté et enlevé directement au port, sans passer par un parc. La sortie du PTU est notée comme justifiée.</StkMsg>
      <div className="grid sm:grid-cols-2 gap-3">
        <StkField label="PTU"><select value={ptu} onChange={(e) => setPtu(e.target.value)} className={stkInput}><option value="">Choisir...</option>{ptus.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></StkField>
        <StkField label="Date d'enlèvement"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={stkInput} /></StkField>
        <StkField label="N° de déclaration (facultatif)"><input value={num} onChange={(e) => setNum(e.target.value)} className={stkInput} /></StkField>
        <StkField label="Date de la déclaration"><input type="date" value={jdate} onChange={(e) => setJdate(e.target.value)} className={stkInput} /></StkField>
      </div>
      <StkField label="Châssis (un par ligne)"><textarea rows={5} value={paste} onChange={(e) => setPaste(e.target.value)} className={stkInput} data-testid="f-enl-paste" /></StkField>
      {err && <StkMsg tone="err">{err}</StkMsg>}
    </div>
  </StkModal>;
}
