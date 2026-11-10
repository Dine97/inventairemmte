// ============================================================
// 6.13 — Décodage du VIN (information), bouton « Suivre », paramètres de l'application
// Le décodage et les suivis ne modifient jamais le stock ni les informations fournies par les parcs.
// ============================================================

// ---------- Droits réglables ----------
const STK_DROITS = [
  ["importer", "Importer un état de stock"],
  ["saisir", "Saisir des entrées / sorties"],
  ["justifier", "Justifier une sortie, joindre une déclaration"],
  ["transferts", "Confirmer ou écarter un transfert"],
  ["relancer", "Relancer un parc (couverture hebdomadaire)"],
  ["contacts", "Modifier le contact d'un parc pour les relances"],
  ["manifestes", "Importer un manifeste dans un PTU"],
  ["enlevement", "Enregistrer un enlèvement direct au PTU"]
];
function stkCan(C, key) {
  if (C.isAdmin) return true;
  if (!C.me || C.me.access !== "agent") return false;
  const d = stkCfgExtra(C.settings).droits;
  return (d[key] || "agent") !== "admin";
}

// ---------- Décodage du VIN ----------
const STK_WMI = {
  // Japon
  JTH: "Lexus", JTJ: "Lexus", JT: "Toyota", JH4: "Acura", JH: "Honda", JNK: "Infiniti", JN: "Nissan", JMB: "Mitsubishi", JMY: "Mitsubishi", JA3: "Mitsubishi", JA4: "Mitsubishi", JM: "Mazda",
  JS: "Suzuki", JF: "Subaru", JAA: "Isuzu", JAL: "Isuzu", JD: "Daihatsu", JY: "Yamaha", JK: "Kawasaki",
  // Corée
  KMH: "Hyundai", KM8: "Hyundai", KMF: "Hyundai", KNA: "Kia", KND: "Kia", KNC: "Kia", KNM: "Renault Samsung", KPT: "SsangYong", KL: "Chevrolet (GM Corée)",
  // Allemagne
  WDB: "Mercedes-Benz", WDD: "Mercedes-Benz", WDC: "Mercedes-Benz", WDF: "Mercedes-Benz", W1K: "Mercedes-Benz", W1N: "Mercedes-Benz", W1V: "Mercedes-Benz", W1W: "Mercedes-Benz", WME: "Smart",
  WBA: "BMW", WBS: "BMW", WBX: "BMW", WBY: "BMW", WMW: "Mini", WVW: "Volkswagen", WVG: "Volkswagen", WV1: "Volkswagen", WV2: "Volkswagen", WAU: "Audi", WUA: "Audi", WA1: "Audi",
  WP0: "Porsche", WP1: "Porsche", WF0: "Ford", W0L: "Opel", W0V: "Opel", WMA: "MAN",
  // France, Italie, Espagne, Europe
  VF1: "Renault", VF3: "Peugeot", VF7: "Citroën", VR3: "Peugeot", VR1: "DS", VF6: "Renault Trucks", VNK: "Toyota", UU1: "Dacia", VS6: "Ford", VSS: "SEAT", VSK: "Nissan", VSX: "Opel", VWV: "Volkswagen",
  ZFA: "Fiat", ZAR: "Alfa Romeo", ZFF: "Ferrari", ZHW: "Lamborghini", ZCF: "Iveco", SAL: "Land Rover", SAJ: "Jaguar", SCC: "Lotus", SB1: "Toyota", SJN: "Nissan", SHH: "Honda", SHS: "Honda",
  YV1: "Volvo", YV4: "Volvo", YV2: "Volvo (camions)", YS3: "Saab", YS2: "Scania", TMB: "Škoda", TMA: "Hyundai", TRU: "Audi", TSM: "Suzuki", U5Y: "Kia", XTA: "Lada", NMT: "Toyota", NLH: "Hyundai", NM0: "Ford",
  // Amérique du Nord
  "1FA": "Ford", "1FD": "Ford", "1FM": "Ford", "1FT": "Ford", "1FB": "Ford", "1FC": "Ford", "2FA": "Ford", "2FM": "Ford", "2FT": "Ford", "3FA": "Ford", "3FM": "Ford", "3FT": "Ford", "1LN": "Lincoln", "5LM": "Lincoln",
  "1G1": "Chevrolet", "1GC": "Chevrolet", "1GN": "Chevrolet", "1GB": "Chevrolet", "2G1": "Chevrolet", "2GN": "Chevrolet", "3GN": "Chevrolet", "3GC": "Chevrolet", "1GT": "GMC", "2GT": "GMC", "3GT": "GMC", "1GK": "GMC", "1G6": "Cadillac", "1GY": "Cadillac", "1G4": "Buick", "5GA": "Buick", "1G2": "Pontiac",
  "1C3": "Chrysler", "2C3": "Chrysler", "2C4": "Chrysler", "1C4": "Jeep / Dodge / Chrysler", "1C6": "Ram", "3C6": "Ram", "3C4": "Chrysler / Dodge", "1J4": "Jeep", "1J8": "Jeep", "1B3": "Dodge", "2B3": "Dodge", "1D7": "Dodge", "3D7": "Dodge", "2D4": "Dodge",
  "4T1": "Toyota", "4T3": "Toyota", "4T4": "Toyota", "5TD": "Toyota", "5TF": "Toyota", "5TE": "Toyota", "2T1": "Toyota", "2T3": "Toyota", "3TM": "Toyota", "JTE": "Toyota",
  "1HG": "Honda", "2HG": "Honda", "2HK": "Honda", "5FN": "Honda", "5J6": "Honda", "19X": "Honda", "19U": "Acura", "3HG": "Honda", "1N4": "Nissan", "1N6": "Nissan", "5N1": "Nissan", "3N1": "Nissan", "3N6": "Nissan",
  "4S3": "Subaru", "4S4": "Subaru", "5NP": "Hyundai", "5NM": "Hyundai", "5XY": "Kia", "3KP": "Kia", "5YJ": "Tesla", "7SA": "Tesla", "4JG": "Mercedes-Benz", "55S": "Mercedes-Benz", "5UX": "BMW", "5YM": "BMW", "1VW": "Volkswagen", "3VW": "Volkswagen", "4F2": "Mazda", "3MZ": "Mazda", "1YV": "Mazda", "4A3": "Mitsubishi", "4A4": "Mitsubishi", "1M": "Mack",
  // Chine, Inde, Asie du Sud-Est, Afrique, Amérique latine
  LSV: "Volkswagen", LFV: "Volkswagen", LGX: "BYD", LC0: "BYD", LVS: "Ford", LRW: "Tesla", LHG: "Honda", LVV: "Chery", LGW: "Great Wall", LJD: "Kia", LZW: "Wuling", LSG: "Chevrolet / Buick", LBV: "BMW", LE4: "Mercedes-Benz", LTV: "Toyota", LFM: "Toyota", LDC: "Peugeot / Citroën", LSJ: "MG", LNB: "BAIC", LGB: "Nissan", LZG: "Shaanxi", LFP: "FAW", LB3: "Geely", LJ1: "JAC", LBE: "Hyundai", LYV: "Volvo", LKL: "Higer", LZY: "Yutong", LGA: "Dongfeng", LRB: "Buick",
  MA1: "Mahindra", MAT: "Tata", MAL: "Hyundai", MAK: "Honda", MA3: "Suzuki", MBH: "Suzuki", MNT: "Nissan", MR0: "Toyota", MR2: "Toyota", MPA: "Isuzu", MPB: "Ford", MMB: "Mitsubishi", MMC: "Mitsubishi", MMT: "Mitsubishi", MHF: "Toyota", MNB: "Ford", MMM: "Chevrolet", MRH: "Honda", PL1: "Proton", PN8: "Nissan", PM2: "Perodua",
  AHT: "Toyota", ADM: "Chevrolet (GM Afrique du Sud)", AAV: "Volkswagen", AFA: "Ford", ACV: "Nissan", "9BW": "Volkswagen", "9BG": "Chevrolet", "93H": "Honda", "9BD": "Fiat", "8AP": "Fiat", "8AJ": "Toyota", "93R": "Toyota", "9BR": "Toyota", "8AG": "Chevrolet"
};
// Familles de marques : le constructeur décodé est compatible avec ces marques déclarées
const STK_MARQUE_FAM = {
  Toyota: ["TOYOTA", "LEXUS", "SCION"], Lexus: ["LEXUS", "TOYOTA"], Honda: ["HONDA", "ACURA"], Acura: ["ACURA", "HONDA"], Nissan: ["NISSAN", "INFINITI", "DATSUN"], Infiniti: ["INFINITI", "NISSAN"],
  Mitsubishi: ["MITSUBISHI"], Mazda: ["MAZDA"], Suzuki: ["SUZUKI", "MARUTI"], Subaru: ["SUBARU"], Isuzu: ["ISUZU"], Daihatsu: ["DAIHATSU", "TOYOTA"], Hyundai: ["HYUNDAI", "GENESIS"], Kia: ["KIA"],
  "Mercedes-Benz": ["MERCEDES", "BENZ", "MB"], Smart: ["SMART", "MERCEDES"], BMW: ["BMW"], Mini: ["MINI", "BMW"], Volkswagen: ["VOLKSWAGEN", "VW"], Audi: ["AUDI"], Porsche: ["PORSCHE"], Ford: ["FORD", "LINCOLN", "MERCURY"], Lincoln: ["LINCOLN", "FORD"],
  Opel: ["OPEL", "VAUXHALL", "CHEVROLET"], Renault: ["RENAULT", "DACIA"], Dacia: ["DACIA", "RENAULT"], Peugeot: ["PEUGEOT"], "Citroën": ["CITROEN"], DS: ["DS", "CITROEN"], "Peugeot / Citroën": ["PEUGEOT", "CITROEN"], Fiat: ["FIAT"], "Land Rover": ["LANDROVER", "RANGEROVER", "LANDROVERRANGEROVER"], Jaguar: ["JAGUAR"],
  Volvo: ["VOLVO"], "Škoda": ["SKODA"], SEAT: ["SEAT", "CUPRA"], Chevrolet: ["CHEVROLET", "CHEVY", "GMC", "GM"], GMC: ["GMC", "CHEVROLET", "GM"], Cadillac: ["CADILLAC", "GM"], Buick: ["BUICK", "GM"], "Chevrolet / Buick": ["CHEVROLET", "BUICK"],
  Chrysler: ["CHRYSLER", "DODGE", "JEEP"], "Jeep / Dodge / Chrysler": ["JEEP", "DODGE", "CHRYSLER", "RAM"], "Chrysler / Dodge": ["CHRYSLER", "DODGE"], Jeep: ["JEEP"], Dodge: ["DODGE", "RAM"], Ram: ["RAM", "DODGE"], Tesla: ["TESLA"],
  Lada: ["LADA"], BYD: ["BYD"], Chery: ["CHERY"], "Great Wall": ["GREATWALL", "HAVAL"], Geely: ["GEELY"], MG: ["MG"], JAC: ["JAC"], Tata: ["TATA"], Mahindra: ["MAHINDRA"], Proton: ["PROTON"]
};
const STK_VIN_PAYS = [
  [/^A[A-H]/, "Afrique du Sud"], [/^J/, "Japon"], [/^K[L-R]/, "Corée du Sud"], [/^L/, "Chine"], [/^M[A-E]/, "Inde"], [/^M[F-K]/, "Indonésie"], [/^M[L-R]/, "Thaïlande"], [/^N[L-R]/, "Turquie"], [/^P[L-R]/, "Malaisie"],
  [/^S[A-M]/, "Royaume-Uni"], [/^S[N-T]/, "Allemagne"], [/^S[U-Z]/, "Pologne"], [/^T[J-P]/, "Tchéquie"], [/^T[R-V]/, "Hongrie"], [/^U[5-7]/, "Slovaquie"], [/^U[U-Z]/, "Roumanie"], [/^V[F-R]/, "France"], [/^V[S-W]/, "Espagne"], [/^W/, "Allemagne"],
  [/^X[S-W0-9]/, "Russie"], [/^Y[A-E]/, "Belgique"], [/^Y[S-W]/, "Suède"], [/^Z[A-R]/, "Italie"], [/^[145]/, "États-Unis"], [/^2/, "Canada"], [/^3/, "Mexique"], [/^6/, "Australie"], [/^7/, "Nouvelle-Zélande"], [/^8[A-E]/, "Argentine"], [/^9[A-E3-9]/, "Brésil"]
];
const STK_VIN_YEAR = "ABCDEFGHJKLMNPRSTVWXY123456789";
function stkVinCheck(vin) {
  const T = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
  const W = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
  let s = 0;
  for (let i = 0; i < 17; i++) { const c = vin[i]; const v = /\d/.test(c) ? +c : T[c]; if (v == null) return null; s += v * W[i]; }
  const r = s % 11;
  return (r === 10 ? "X" : String(r)) === vin[8];
}
function stkVinDecode(chassis) {
  const vin = String(chassis || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (vin.length !== 17) return { ok: false, raison: vin.length ? `${vin.length} caractères : ce n'est pas un VIN standard de 17 caractères (numéro de châssis constructeur ou engin ancien), il ne peut pas être décodé.` : "" };
  if (/[IOQ]/.test(vin)) return { ok: false, raison: "Le numéro contient les lettres I, O ou Q, interdites dans un VIN : sans doute une faute de saisie (1, 0)." };
  const constructeur = STK_WMI[vin.slice(0, 3)] || STK_WMI[vin.slice(0, 2)] || null;
  const pays = (STK_VIN_PAYS.find(([re]) => re.test(vin)) || [])[1] || null;
  const na = /^[1-5]/.test(vin);
  const yi = STK_VIN_YEAR.indexOf(vin[9]);
  let annee = null, anneeAlt = null;
  if (yi >= 0) {
    const y0 = 1980 + yi, y1 = y0 + 30, max = new Date().getFullYear() + 1;
    if (na) annee = /\d/.test(vin[6]) ? y0 : y1;
    else { annee = y1 <= max ? y1 : y0; anneeAlt = y1 <= max ? y0 : null; }
    if (annee > max) annee = null;
  }
  return { ok: true, vin, wmi: vin.slice(0, 3), constructeur, pays, annee, anneeAlt, cle: na ? stkVinCheck(vin) : null, na };
}
function stkNormMarque(m) { return String(m || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z]/g, ""); }
// Incohérence entre le constructeur décodé et la marque déclarée par le parc (information seulement)
function stkVinIncoherence(row) {
  const d = stkVinDecode(row.chassis);
  if (!d.ok || !d.constructeur || !row.marque) return null;
  const decl = stkNormMarque(row.marque);
  if (decl.length < 2) return null;
  const fam = STK_MARQUE_FAM[d.constructeur] || [stkNormMarque(d.constructeur)];
  if (fam.some((f) => decl.includes(f) || (decl.length >= 3 && f.startsWith(decl)))) return null;
  return { constructeur: d.constructeur, declare: row.marque };
}
function StkVinBox({ v }) {
  const d = stkVinDecode(v.chassis);
  if (!d.ok && !d.raison) return null;
  const inc = d.ok ? stkVinIncoherence(v) : null;
  const yr = v.annee ? String(v.annee).match(/\d{4}/) : null;
  const yInc = d.ok && d.annee && yr && Math.abs(+yr[0] - d.annee) > 1 && !(d.anneeAlt && Math.abs(+yr[0] - d.anneeAlt) <= 1);
  return <div className="rounded-xl border border-dashed border-[#9DB9DA] bg-[#F7FAFE] px-4 py-3" data-testid="vin-box">
    <div className="flex flex-wrap items-center gap-2 mb-1"><div className="text-[11px] font-bold uppercase tracking-wider text-[#1B4F8C]">D'après le numéro de châssis</div><span className="text-[11px] text-slate-400">information seulement — les données du parc ne sont pas modifiées</span></div>
    {!d.ok ? <div className="text-sm text-slate-600">{d.raison}</div> : <>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span>Constructeur : <b className="text-[#0B1F38]">{d.constructeur || "non identifié"}</b></span>
        <span>Pays de fabrication : <b className="text-[#0B1F38]">{d.pays || "non identifié"}</b></span>
        <span>Année probable : <b className="text-[#0B1F38]">{d.annee || "—"}</b>{d.anneeAlt ? <span className="text-slate-500"> (ou {d.anneeAlt})</span> : ""}</span>
        {d.cle != null && <span>Clé de contrôle : <b className={d.cle ? "text-emerald-700" : "text-rose-700"}>{d.cle ? "cohérente" : "incohérente"}</b></span>}
      </div>
      {(inc || yInc) && <div className="mt-2 text-sm text-amber-900 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2">
        {inc && <div>Le parc a déclaré la marque <b>{inc.declare}</b>, le numéro correspond plutôt à <b>{inc.constructeur}</b>.</div>}
        {yInc && <div>Le parc a déclaré l'année <b>{yr[0]}</b>, le numéro indique plutôt <b>{d.annee}</b>.</div>}
        <div className="text-[11px] text-amber-800 mt-0.5">À vérifier sur le terrain si besoin. Aucune correction automatique.</div>
      </div>}
    </>}
  </div>;
}

// ---------- Suivis personnels ----------
function stkSuiviEvents(data, cfg) {
  if (!data) return [];
  const pn = {}; (data.parcs || []).forEach((p) => (pn[p.id] = p));
  const vs = {}; (data.vehicles || []).forEach((v) => (vs[v.id] = v));
  const since = {}; (data.suivis || []).forEach((s) => { if (!since[s.vehicle_id] || s.created_at < since[s.vehicle_id]) since[s.vehicle_id] = s.created_at; });
  const today = data.today || stkToday();
  const out = [];
  (data.stays || []).forEach((s) => {
    const v = vs[s.vehicle_id]; if (!v || !since[s.vehicle_id]) return;
    const P = pn[s.parc_id] || {}, from = pn[s.from_parc_id] || {}, to = pn[s.to_parc_id] || {};
    if (s.entry_kind !== "initial" && s.created_at > since[s.vehicle_id]) out.push({ v, at: s.created_at, date: s.entry_date, kind: P.type === "ptu" ? "arrivee_ptu" : from.name ? "transfert" : "entree",
      text: P.type === "ptu" ? `Arrivé au ${P.name}` : from.name ? `Entré au parc ${P.name} (depuis ${from.name})` : `Entré au parc ${P.name}` });
    if (s.exit_date && s.updated_at > since[s.vehicle_id]) out.push({ v, at: s.updated_at, date: s.exit_date, kind: s.exit_kind === "transfert" ? "transfert" : "sortie",
      text: s.exit_kind === "transfert" ? `Parti de ${P.name}${to.name ? ` vers ${to.name}` : ""}` : P.type === "ptu" ? `Enlèvement direct au ${P.name}` : `Sorti du parc ${P.name}` });
  });
  (data.vehicles || []).forEach((v) => {
    if (!v.current_parc_id || !since[v.id]) return;
    const sit = stkSit(v, today, cfg);
    if (sit.depot && sit.depot <= today && sit.depot + "T23:59:59" > since[v.id]) out.push({ v, at: sit.depot + "T00:00:01Z", date: sit.depot, kind: "depot", text: `Passé en dépôt (${(pn[v.current_parc_id] || {}).name || ""})` });
  });
  return out.sort((a, b) => String(b.at).localeCompare(a.at));
}
function stkSuiviUnread(data, cfg) {
  if (!data) return 0;
  const vu = data.vu_at || "";
  return stkSuiviEvents(data, cfg).filter((e) => e.at > vu).length;
}
const STK_EV_TONE = { entree: "bg-emerald-50 text-emerald-800 border-emerald-200", arrivee_ptu: "bg-[#EAF1FA] text-[#123A66] border-[#C9DBEF]", transfert: "bg-sky-50 text-sky-800 border-sky-200", sortie: "bg-rose-50 text-rose-800 border-rose-200", depot: "bg-amber-50 text-amber-900 border-amber-300" };
const STK_EV_LABEL = { entree: "Entrée", arrivee_ptu: "Arrivée au port", transfert: "Transfert", sortie: "Sortie", depot: "Dépôt" };
const StkStar = ({ on, size }) => <svg width={size || 16} height={size || 16} viewBox="0 0 24 24" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" /></svg>;
const StkBellIc = ({ size }) => <svg width={size || 18} height={size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>;

function StkFollowBtn({ vehicleId }) {
  const C = React.useContext(StkCtx);
  const S = C.suivis;
  if (!S || stkCfgExtra(C.settings).hidden.includes("suivis")) return null;
  const on = S.followed.has(vehicleId);
  const toggle = async () => {
    try {
      if (on) await stkCall("suivi_remove", { vehicle_id: vehicleId });
      else await stkCall("suivi_add", { vehicle_ids: [vehicleId] });
      C.toast(on ? "Vous ne suivez plus ce véhicule" : "Véhicule suivi : vous serez alerté de ses mouvements");
      S.reload();
    } catch (e) { alert(stkErrText(e)); }
  };
  return <StkBtn small onClick={toggle} data-testid="btn-suivre" className={on ? "!text-amber-700 !border-amber-300" : ""}><StkStar on={on} size={15} /> {on ? "Suivi" : "Suivre"}</StkBtn>;
}
function StkBellBar() {
  const C = React.useContext(StkCtx);
  const S = C.suivis;
  if (!S || stkCfgExtra(C.settings).hidden.includes("suivis")) return null;
  const n = S.unread;
  return <div className="flex justify-end -mb-2 no-print">
    <button onClick={() => C.go("suivis")} data-testid="bell" className={`inline-flex items-center gap-2 rounded-full border-2 px-3 py-1.5 text-xs font-bold ${n ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-200 bg-white text-slate-500"}`} title="Mes suivis">
      <StkBellIc size={15} /> Mes suivis {n > 0 && <span className="font-plex-mono rounded-full bg-amber-500 text-white px-1.5">{n}</span>}
    </button>
  </div>;
}
function StkSuivis() {
  const C = React.useContext(StkCtx);
  const { cfg, openVehicle, toast } = C;
  const S = C.suivis || {};
  const data = S.data;
  const [tab, setTab] = useState("alertes");
  const [liste, setListe] = useState("");
  const [q, setQ] = useState("");
  const [add, setAdd] = useState(false);
  const [vu0] = useState(() => (data && data.vu_at) || "");
  useEffect(() => { if (data && S.unread) stkCall("suivi_vu").then(() => S.reload()).catch(() => {}); }, [!!data]);
  if (!data) return <><StkPageHead title="Mes suivis" /><StkLoading /></>;
  const events = stkSuiviEvents(data, cfg);
  const vs = {}; data.vehicles.forEach((v) => (vs[v.id] = v));
  const pn = {}; data.parcs.forEach((p) => (pn[p.id] = p));
  const listes = [...new Set(data.suivis.map((s) => s.liste))].sort();
  const rows = data.suivis.filter((s) => !liste || s.liste === liste).map((s) => ({ ...s, ...(vs[s.vehicle_id] || {}), suivi_id: s.id, parcNom: (pn[(vs[s.vehicle_id] || {}).current_parc_id] || {}).name }));
  const shown = stkFilterRows(rows, q);
  const evShown = events.filter((e) => (!liste || data.suivis.some((s) => s.vehicle_id === e.v.id && s.liste === liste)) && (!q || stkFilterRows([e.v], q).length));
  const remove = async (p, conf) => { if (conf && !window.confirm(conf)) return; try { await stkCall("suivi_remove", p); S.reload(); } catch (e) { alert(stkErrText(e)); } };
  const exp = (k) => {
    const cols = [{ h: "Liste", k: "liste", w: 18 }, { h: "Châssis", k: "chassis", w: 22 }, { h: "Marque", k: "marque" }, { h: "Modèle", k: "modele" }, { h: "Navire", k: "navire", w: 20 }, { h: "Situation", x: (r) => r.parcNom ? `Au parc ${r.parcNom}` : "Sorti", w: 24 }, { h: "Date de dépôt", x: (r) => stkFmt(stkSit(r, stkToday(), cfg).depot) }, { h: "Suivi depuis", x: (r) => stkFmt(r.created_at) }];
    const meta = [`${liste ? "Liste : " + liste : "Toutes les listes"} — ${shown.length} véhicule(s)`, `Situation au ${stkFmt(stkToday())}`];
    if (k === "x") stkExportXlsx(`Mes_suivis_${stkToday()}`, "Véhicules suivis", meta, cols, shown); else stkPrintPdf("Véhicules suivis", meta, cols, shown);
  };
  return <>
    <StkPageHead title="Mes suivis" sub="Véhicules que vous suivez personnellement. Vous êtes alerté de leurs entrées, sorties, transferts et passages en dépôt. Rien n'est modifié dans le stock." right={<StkBtn kind="primary" onClick={() => setAdd(true)} data-testid="btn-suivre-liste"><StkStar on={false} /> Suivre une liste</StkBtn>} />
    <div className="flex flex-wrap gap-2 items-center">
      <StkTabs tabs={[{ key: "alertes", label: "Alertes", count: events.length }, { key: "vehicules", label: "Véhicules suivis", count: data.suivis.length }]} value={tab} onChange={setTab} />
      <div className="flex-1" />
      {listes.length > 1 && <select value={liste} onChange={(e) => setListe(e.target.value)} className={`${stkInput} max-w-[220px]`}><option value="">Toutes les listes</option>{listes.map((l) => <option key={l}>{l}</option>)}</select>}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer un châssis..." className={`${stkInput} max-w-[220px]`} />
    </div>
    {!data.suivis.length ? <StkCard className="p-8 text-center text-sm text-slate-500">Vous ne suivez encore aucun véhicule. Ouvrez la fiche d'un véhicule et cliquez sur <b>Suivre</b>, ou collez une liste de châssis avec <b>Suivre une liste</b>.</StkCard>
      : tab === "alertes" ? <StkCard className="p-2 md:p-3">
        {!evShown.length ? <div className="py-8 text-center text-sm text-slate-400">Aucun mouvement depuis que vous suivez ces véhicules.</div> :
          <div className="divide-y divide-slate-100">{evShown.slice(0, 500).map((e, i) => <button key={i} onClick={() => openVehicle({ id: e.v.id })} className={`w-full text-left px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 hover:bg-[#F4F8FC] rounded-lg ${e.at > vu0 ? "bg-amber-50/60" : ""}`}>
            {e.at > vu0 && <span className="w-2 h-2 rounded-full bg-amber-500" title="Nouveau" />}
            <StkBadge tone={STK_EV_TONE[e.kind]}>{STK_EV_LABEL[e.kind]}</StkBadge>
            <span className="font-plex-mono font-bold text-[#0B1F38] whitespace-nowrap">{e.v.chassis}</span>
            <span className="text-sm text-slate-700">{e.text}</span>
            <span className="text-xs text-slate-500 ml-auto">le {stkFmt(e.date)}</span>
          </button>)}</div>}
      </StkCard>
      : <StkCard className="p-4 md:p-5 space-y-3">
        <div className="flex flex-wrap gap-2 justify-end">
          {liste && <StkBtn small kind="danger" onClick={() => remove({ liste }, `Ne plus suivre la liste « ${liste} » ?`).then(() => setListe(""))}>Ne plus suivre cette liste</StkBtn>}
          <StkExportBar disabled={!shown.length} onXlsx={() => exp("x")} onPdf={() => exp("p")} />
        </div>
        <StkTable rows={shown} rowKey={(r) => r.suivi_id} onRow={(r) => openVehicle({ id: r.vehicle_id })} columns={[
          { key: "chassis", label: "Châssis", render: (r) => <span className="font-plex-mono font-bold text-[#0B1F38] whitespace-nowrap">{r.chassis}</span> },
          { key: "veh", label: "Véhicule", sort: (r) => stkVeh(r), render: (r) => stkVeh(r) || "—" },
          { key: "liste", label: "Liste", render: (r) => <StkBadge>{r.liste}</StkBadge> },
          { key: "parcNom", label: "Situation", render: (r) => r.parcNom ? <span className="font-semibold">{r.parcNom}</span> : <StkBadge tone={STK_SIT_TONE.sorti}>Sorti</StkBadge> },
          { key: "sit", label: "Dépôt", sortable: false, render: (r) => r.current_parc_id ? <StkSitBadge row={r} /> : "—" },
          { key: "created_at", label: "Suivi depuis", render: (r) => stkFmt(r.created_at) },
          { key: "x", label: "", sortable: false, render: (r) => <button className="text-xs text-rose-700 underline" onClick={(e) => { e.stopPropagation(); remove({ ids: [r.suivi_id] }); }}>Ne plus suivre</button> }
        ]} />
      </StkCard>}
    {add && <StkSuiviListModal listes={listes} onClose={() => setAdd(false)} onDone={(r) => { setAdd(false); S.reload(); toast(`${r.ok} véhicule(s) suivi(s)${r.inconnus.length ? ` · ${r.inconnus.length} châssis inconnu(s)` : ""}`); }} />}
  </>;
}
function StkSuiviListModal({ listes, onClose, onDone }) {
  const [name, setName] = useState("");
  const [paste, setPaste] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const list = stkParsePastedChassis(paste);
  const run = async () => {
    if (!list.length) { setErr("Collez au moins un châssis."); return; }
    setBusy(true); setErr("");
    try { const r = await stkCall("suivi_add", { chassis: list, liste: name.trim() || "Mes véhicules" }); if (r.inconnus.length) setRes(r); else onDone(r); }
    catch (e) { setErr(stkErrText(e)); }
    setBusy(false);
  };
  if (res) return <StkModal title="Liste suivie" onClose={() => onDone(res)} footer={<StkBtn kind="primary" onClick={() => onDone(res)}>Terminer</StkBtn>}>
    <div className="space-y-2"><StkMsg tone="ok">{res.ok} véhicule(s) suivi(s).</StkMsg><StkMsg tone="warn">{res.inconnus.length} châssis inconnu(s) dans le suivi des stocks (pas encore déclaré par un parc ni par un manifeste) :<div className="font-plex-mono text-xs mt-1 break-all">{res.inconnus.join(", ")}</div></StkMsg></div>
  </StkModal>;
  return <StkModal title="Suivre une liste de véhicules" onClose={onClose} footer={<><StkBtn onClick={onClose}>Annuler</StkBtn><StkBtn kind="primary" disabled={busy} onClick={run} data-testid="save-suivi-liste">Suivre {list.length ? `(${list.length})` : ""}</StkBtn></>}>
    <div className="space-y-3">
      <StkField label="Nom de la liste" hint="Par exemple : « Lot signalé par la douane — novembre »"><input list="stk-listes" value={name} onChange={(e) => setName(e.target.value)} className={stkInput} placeholder="Mes véhicules" data-testid="f-suivi-nom" /><datalist id="stk-listes">{listes.map((l) => <option key={l} value={l} />)}</datalist></StkField>
      <StkField label="Châssis (un par ligne, ou copiés depuis Excel)"><textarea rows={8} value={paste} onChange={(e) => setPaste(e.target.value)} className={stkInput} data-testid="f-suivi-paste" /></StkField>
      {err && <StkMsg tone="err">{err}</StkMsg>}
    </div>
  </StkModal>;
}

// ---------- Paramètres de l'application (administrateur) ----------
const STK_MODULES = () => STK_SECTIONS.filter((s) => !s.admin && s.key !== "dash");
function StkAdminParams() {
  const C = React.useContext(StkCtx);
  const S = C.settings || {};
  const X = stkCfgExtra(S);
  const lines = (a) => (a || []).join("\n");
  const init = {
    duree_sejour: S.duree_sejour || 365, seuil_alerte: S.seuil_alerte || 30, fenetre_transfert: S.fenetre_transfert || 14, seuil_agrement: X.agr, delai_ptu: X.ptuDelai,
    source_depot: S.source_depot === "mmte" ? "mmte" : "parc", afficher_transfert: S.afficher_transfert !== false,
    types_sortie: lines(C.cfg.types), zones: lines(X.zones), types_rapport: lines(X.typesRapport),
    modules_masques: X.hidden, droits: { ...X.droits }, identite_visible: X.identiteAdmin ? "admin" : "tous",
    texte_relance_1: S.texte_relance_1 || "", texte_relance_2: S.texte_relance_2 || "", signature_mail: S.signature_mail || ""
  };
  const [f, setF] = useState(init);
  const [sec, setSec] = useState("delais");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const toList = (s) => String(s || "").split("\n").map((x) => x.trim()).filter(Boolean);
  const save = async () => {
    setBusy(true); setMsg("");
    const out = {
      duree_sejour: Number(f.duree_sejour) || 365, seuil_alerte: Number(f.seuil_alerte) || 30, fenetre_transfert: Number(f.fenetre_transfert) || 14,
      seuil_agrement: Number(f.seuil_agrement) || 30, delai_ptu: Number(f.delai_ptu) || 15, source_depot: f.source_depot, afficher_transfert: !!f.afficher_transfert,
      types_sortie: toList(f.types_sortie), zones: toList(f.zones), types_rapport: toList(f.types_rapport), modules_masques: f.modules_masques, droits: f.droits,
      identite_visible: f.identite_visible, texte_relance_1: f.texte_relance_1, texte_relance_2: f.texte_relance_2, signature_mail: f.signature_mail
    };
    try {
      let n = 0;
      for (const [k, v] of Object.entries(out)) {
        if (JSON.stringify(v) === JSON.stringify(S[k])) continue;
        if ((k === "texte_relance_1" || k === "texte_relance_2" || k === "signature_mail") && !v && !S[k]) continue;
        await stkCall("settings_save", { key: k, value: v }); n++;
      }
      setMsg(n ? `Paramètres enregistrés (${n} modification${n > 1 ? "s" : ""}).` : "Aucune modification."); if (n) C.reloadAll();
    } catch (e) { setMsg(stkErrText(e)); }
    setBusy(false);
  };
  const Num = ({ k, label, hint }) => <StkField label={label} hint={hint}><input type="number" min="1" value={f[k]} onChange={set(k)} className={stkInput} data-testid={"p-" + k} /></StkField>;
  const SECS = [["delais", "Délais et alertes"], ["listes", "Listes"], ["modules", "Fonctions affichées"], ["droits", "Droits"], ["textes", "Textes des mails"]];
  return <StkCard className="p-4 md:p-5 space-y-4 max-w-3xl" data-testid="admin-params">
    <StkTabs tabs={SECS.map(([key, label]) => ({ key, label }))} value={sec} onChange={setSec} />
    {sec === "delais" && <div className="space-y-4">
      <div className="grid md:grid-cols-3 gap-3">
        <Num k="duree_sejour" label="Durée de séjour (jours)" hint="Passage en dépôt après cette durée, depuis la date d'arrivée du navire" />
        <Num k="seuil_alerte" label="Alerte « Bientôt en dépôt » (jours)" />
        <Num k="fenetre_transfert" label="Reconnaissance automatique des transferts (jours)" hint="Sortie d'un parc puis entrée dans un autre dans ce délai = transfert" />
        <Num k="seuil_agrement" label="Alerte d'échéance des agréments (jours)" hint="Avertissement avant l'expiration de l'agrément d'un parc" />
        <Num k="delai_ptu" label="Alerte véhicule resté au PTU (jours)" hint="Au-delà, le véhicule est signalé dans l'écran des PTU" />
      </div>
      <StkField label="Date de dépôt utilisée" hint="La date MMTE est connue après un « Contrôle avec MMTE ». Sans elle, la date calculée reste utilisée."><select value={f.source_depot} onChange={set("source_depot")} className={stkInput}><option value="parc">Calculée : date d'arrivée du fichier du parc + durée de séjour</option><option value="mmte">Date de dépôt MMTE quand elle est connue (sinon calculée)</option></select></StkField>
      <label className="flex items-center gap-3 text-sm font-semibold text-slate-700"><input type="checkbox" checked={f.afficher_transfert} onChange={set("afficher_transfert")} /> Afficher la date de transfert dans les listes, fiches et exports</label>
    </div>}
    {sec === "listes" && <div className="grid md:grid-cols-3 gap-3">
      <StkField label="Types de sortie (un par ligne)"><textarea rows={8} value={f.types_sortie} onChange={set("types_sortie")} className={stkInput} /></StkField>
      <StkField label="Zones des parcs (une par ligne)"><textarea rows={8} value={f.zones} onChange={set("zones")} className={stkInput} data-testid="p-zones" /></StkField>
      <StkField label="Types de rapport d'inventaire"><textarea rows={8} value={f.types_rapport} onChange={set("types_rapport")} className={stkInput} /></StkField>
    </div>}
    {sec === "modules" && <div className="space-y-2">
      <div className="text-sm text-slate-500">Décochez une fonction pour la retirer du menu de tous les utilisateurs. Les données ne sont pas supprimées.</div>
      <div className="grid sm:grid-cols-2 gap-1.5">{STK_MODULES().map((s) => <label key={s.key} className="flex items-center gap-2 text-sm font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg px-3 py-2">
        <input type="checkbox" checked={!f.modules_masques.includes(s.key)} data-testid={"mod-" + s.key} onChange={(e) => setF((x) => ({ ...x, modules_masques: e.target.checked ? x.modules_masques.filter((k) => k !== s.key) : [...x.modules_masques, s.key] }))} /> {s.label}</label>)}</div>
    </div>}
    {sec === "droits" && <div className="space-y-3">
      <div className="text-sm text-slate-500">Les profils « consultation » ne peuvent jamais modifier. Les administrateurs peuvent tout faire.</div>
      <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {STK_DROITS.map(([k, label]) => <div key={k} className="px-3 py-2 flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-[200px] text-sm font-semibold text-slate-700">{label}</div>
          <select value={f.droits[k] || "agent"} onChange={(e) => setF((x) => ({ ...x, droits: { ...x.droits, [k]: e.target.value } }))} className={`${stkInput} max-w-[250px]`} data-testid={"droit-" + k}>
            <option value="agent">Agents et administrateurs</option><option value="admin">Administrateurs seulement</option></select>
        </div>)}
        {["Modifier l'identité d'un parc (chefs, zone, adresse, position, photo)", "Joindre ou modifier un agrément", "Joindre un rapport d'inventaire", "Paramètres de l'application"].map((l) => <div key={l} className="px-3 py-2 flex flex-wrap items-center gap-2 bg-slate-50">
          <div className="flex-1 min-w-[200px] text-sm font-semibold text-slate-700">{l}</div><span className="text-sm text-slate-500 px-3">Administrateurs seulement (fixe)</span></div>)}
        <div className="px-3 py-2 flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-[200px] text-sm font-semibold text-slate-700">Consulter la carte d'identité des parcs et les agréments</div>
          <select value={f.identite_visible} onChange={set("identite_visible")} className={`${stkInput} max-w-[250px]`}><option value="tous">Tous les utilisateurs</option><option value="admin">Administrateurs seulement</option></select>
        </div>
      </div>
    </div>}
    {sec === "textes" && <div className="space-y-3">
      <div className="text-sm text-slate-500">Laissez vide pour garder le texte standard. Mots remplacés automatiquement : <code>{"{parc}"}</code>, <code>{"{semaine}"}</code>, <code>{"{dernier_etat}"}</code>, <code>{"{signataire}"}</code>.</div>
      <StkField label="Mail de demande d'état (1re relance)"><textarea rows={7} value={f.texte_relance_1} onChange={set("texte_relance_1")} className={stkInput} placeholder={stkRelanceText({ parc: "{parc}", last: null }, stkMonday(stkToday()), 1, "{signataire}", true).body} /></StkField>
      <StkField label="Mail de relance (2e relance)"><textarea rows={7} value={f.texte_relance_2} onChange={set("texte_relance_2")} className={stkInput} placeholder={stkRelanceText({ parc: "{parc}", last: null }, stkMonday(stkToday()), 2, "{signataire}", true).body} /></StkField>
      <StkField label="Signature des mails" hint="Ajoutée sous le nom de l'agent"><textarea rows={3} value={f.signature_mail} onChange={set("signature_mail")} className={stkInput} placeholder={"Bénin Control — Département MAD-MAE\nSuivi des stocks MAD ROULANTS"} /></StkField>
    </div>}
    {msg && <StkMsg tone={/Erreur|réservée|impossible/i.test(msg) ? "err" : "ok"}>{msg}</StkMsg>}
    <StkBtn kind="primary" disabled={busy} onClick={save} data-testid="save-params">{busy ? "Enregistrement..." : "Enregistrer"}</StkBtn>
  </StkCard>;
}
