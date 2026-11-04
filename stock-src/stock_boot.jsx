// ============================================================
// STOCK MMTE — partie légère chargée avec l'application
// (le reste du module, lib/stock.js, est chargé à la demande)
// ============================================================
const STK_API = "https://hrxldrhfqyxyzsetlamc.supabase.co/functions/v1/stock-api";
const STK_ERR = {
  NON_CONNECTE: "Vous n'êtes pas connecté.",
  SESSION_EXPIREE: "Votre session a expiré. Déconnectez-vous puis reconnectez-vous.",
  INVITE_NON_AUTORISE: "L'accès invité ne permet pas d'utiliser le suivi des stocks.",
  COMPTE_NON_APPROUVE: "Votre compte n'est pas encore approuvé.",
  RESERVE_ADMIN: "Action réservée aux administrateurs.",
  DEJA_VALIDEE: "Cette justification est déjà validée : seul un administrateur peut la modifier.",
  MOTIF_OBLIGATOIRE: "Indiquez le motif.",
  IMPORT_PAS_LE_DERNIER: "Seul le dernier import d'un parc peut être annulé. Annulez d'abord les imports plus récents.",
  IMPORT_DEJA_ANNULE: "Cet import est déjà annulé.",
  CHASSIS_OBLIGATOIRE: "Le châssis est obligatoire.",
  FICHIER_TROP_GROS: "Fichier trop volumineux (8 Mo maximum).",
  VEHICULE_INTROUVABLE: "Aucun véhicule ne correspond à ce châssis.",
  RESEAU: "Connexion impossible au serveur des stocks. Vérifiez Internet puis réessayez.",
  LENTEUR: "Le serveur des stocks ne répond pas assez vite (connexion lente). Réessayez dans un instant.",
  DATE_STOCK_MANQUANTE: "Indiquez la date du stock.",
  LECTURE_SEULE: "Votre accès au suivi des stocks est en consultation seule.",
  ACCES_STOCK_REFUSE: "Vous n'avez pas accès au suivi des stocks. Demandez l'accès à un administrateur MAD-MAE.",
  FUSION_IMPOSSIBLE: "Fusion impossible : les deux véhicules doivent être différents.",
  IMPORT_NON_ANNULE: "Cet import n'est pas annulé."
};
function stkErrText(e) {
  const m = String((e && e.message) || e || "");
  if (m.startsWith("IMPORT_ANTERIEUR")) return `Un import plus récent existe déjà pour ce parc (stock du ${stkFmt(m.split(":")[1])}). Choisissez une date de stock égale ou postérieure.`;
  if (STK_ERR[m]) return STK_ERR[m];
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return STK_ERR.RESEAU;
  return "Erreur : " + m;
}
const STK_SLOW = { commit_import: 180e3, export_all: 180e3, stock_at: 90e3, mmte_sync: 120e3, merge: 90e3, cancel_import: 90e3, restore_import: 90e3, upload_file: 90e3 };
async function stkCall(action, params, retried, timeoutMs) {
  const u = auth.currentUser;
  if (!u) throw new Error("NON_CONNECTE");
  const token = await u.getIdToken(!!retried);
  let r;
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const limit = timeoutMs || STK_SLOW[action] || 30e3;
  const timer = ctl ? setTimeout(() => ctl.abort(), limit) : null;
  try {
    r = await fetch(STK_API, { method: "POST", headers: { "content-type": "text/plain;charset=UTF-8" }, body: JSON.stringify({ action, params: params || {}, token }), signal: ctl ? ctl.signal : void 0 });
  } catch (e) { throw new Error(e && e.name === "AbortError" ? "LENTEUR" : "RESEAU"); }
  finally { if (timer) clearTimeout(timer); }
  let j = null;
  try { j = await r.json(); } catch (e) { throw new Error("RESEAU"); }
  if (!j.ok) {
    if (j.error === "SESSION_EXPIREE" && !retried) return stkCall(action, params, true);
    throw new Error(j.error || "ERREUR");
  }
  return j.data;
}

function stkFmt(iso) {
  if (!iso) return "";
  const s = String(iso).slice(0, 10).split("-");
  return s.length === 3 ? `${s[2]}/${s[1]}/${s[0]}` : String(iso);
}

// ---------- Icônes ----------
const StkIc = {
  Grid: (p) => <Icon {...p}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></Icon>,
  Layers: (p) => <Icon {...p}><path d="m12 2 9 5-9 5-9-5 9-5z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" /></Icon>,
  Swap: (p) => <Icon {...p}><path d="M7 4 3 8l4 4" /><path d="M3 8h14" /><path d="m17 20 4-4-4-4" /><path d="M21 16H7" /></Icon>,
  Clip: (p) => <Icon {...p}><path d="m21.4 11-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8" /></Icon>,
  Plus: (p) => <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>,
  Edit: (p) => <Icon {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></Icon>,
  Cal: (p) => <Icon {...p}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></Icon>,
  X: (p) => <Icon {...p}><path d="M18 6 6 18M6 6l12 12" /></Icon>,
  Truck: (p) => <Icon {...p}><path d="M1 3h15v13H1z" /><path d="M16 8h4l3 3v5h-7z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></Icon>,
  Inbox: (p) => <Icon {...p}><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></Icon>,
  Check: (p) => <Icon {...p}><path d="M20 6 9 17l-5-5" /></Icon>,
  Chev: (p) => <Icon {...p}><path d="m9 18 6-6-6-6" /></Icon>,
  Gear: (p) => <Icon {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></Icon>,
  Apps: (p) => <Icon {...p}><circle cx="6" cy="6" r="2.2" /><circle cx="18" cy="6" r="2.2" /><circle cx="6" cy="18" r="2.2" /><circle cx="18" cy="18" r="2.2" /></Icon>
};

const STK_SECTIONS = [
  { key: "dash", label: "Tableau de bord", Ic: (p) => <StkIc.Grid {...p} /> },
  { key: "rapport", label: "Rapport hebdomadaire", Ic: (p) => <FileSpreadsheet {...p} /> },
  { key: "search", label: "Recherche avancée", Ic: (p) => <Search {...p} /> },
  { key: "import", label: "Importer un stock", Ic: (p) => <Upload {...p} /> },
  { key: "bulk", label: "Import groupé du lundi", Ic: (p) => <StkIc.Layers {...p} /> },
  { key: "moves", label: "Entrées et sorties", Ic: (p) => <StkIc.Swap {...p} /> },
  { key: "justif", label: "Justification des sorties", Ic: (p) => <StkIc.Clip {...p} /> },
  { key: "anomalies", label: "Centre des anomalies", Ic: (p) => <AlertTriangle {...p} /> },
  { key: "mmte", label: "Contrôle avec MMTE", Ic: (p) => <ShieldCheck {...p} /> },
  { key: "imports", label: "Historique des imports", Ic: (p) => <Archive {...p} /> },
  { key: "admin", label: "Administration stock", Ic: (p) => <StkIc.Gear {...p} />, admin: true }
];

// ---------- Chargement à la demande du module ----------
let stkLoadPromise = null;
function stkEnsureLoaded() {
  if (window.STK) return Promise.resolve(window.STK);
  if (!stkLoadPromise) {
    stkLoadPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "./lib/stock.js?v=" + (typeof APP_VERSION !== "undefined" ? APP_VERSION : "1");
      s.async = true;
      s.onload = () => (window.STK ? resolve(window.STK) : reject(new Error("RESEAU")));
      s.onerror = () => { stkLoadPromise = null; s.remove(); reject(new Error("RESEAU")); };
      document.head.appendChild(s);
    });
  }
  return stkLoadPromise;
}
function stkLazy(name) {
  return function StkLazy(props) {
    const [, setReady] = useState(!!window.STK);
    const [err, setErr] = useState("");
    const retry = () => { setErr(""); stkEnsureLoaded().then(() => setReady(true), (e) => setErr(stkErrText(e))); };
    useEffect(() => { if (!window.STK) retry(); }, []);
    if (window.STK) return React.createElement(window.STK[name], props);
    if (err) return <div className="max-w-xl mx-auto px-5 py-8 space-y-3"><div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">{err}</div><button onClick={retry} className="px-4 py-2 rounded-xl bg-[#1B4F8C] text-white text-sm font-semibold">Réessayer</button></div>;
    return <div className="flex items-center justify-center gap-3 py-12 text-slate-500 text-sm"><span className="w-5 h-5 rounded-full border-2 border-slate-300 border-t-[#1B4F8C] animate-spin" /> Ouverture du suivi des stocks...</div>;
  };
}
const StkApp = stkLazy("StkApp");
const StkInvStockSource = stkLazy("StkInvStockSource");
const StkAccountTools = stkLazy("StkAccountTools");
function stkMergeInventoryLists(a, b) { return window.STK.stkMergeInventoryLists(a, b); }

// ---------- Journal des erreurs (envoyé au serveur, consultable par l'administrateur) ----------
const stkErrQueue = [];
const stkErrSeen = new Set();
let stkErrTimer = null;
function stkReportError(kind, err, extra) {
  try {
    const message = String((err && (err.message || err.reason)) || err || "").slice(0, 1000);
    if (!message || stkErrSeen.has(message) || stkErrSeen.size > 30) return;
    if (/ResizeObserver loop|Script error\.?$/i.test(message)) return;
    stkErrSeen.add(message);
    stkErrQueue.push({ kind, message: extra ? message + " — " + extra : message, stack: String((err && err.stack) || "").slice(0, 4000), url: location.pathname + location.hash, ua: navigator.userAgent, app_version: typeof APP_VERSION !== "undefined" ? APP_VERSION : "" });
    if (!stkErrTimer) stkErrTimer = setTimeout(stkFlushErrors, 4000);
  } catch (e) {}
}
function stkFlushErrors() {
  stkErrTimer = null;
  try {
    const u = typeof auth !== "undefined" && auth.currentUser;
    if (!stkErrQueue.length || !u || u.isAnonymous) return;
    const errors = stkErrQueue.splice(0, 20);
    stkCall("log_error", { errors }, false, 15e3).catch(() => {});
  } catch (e) {}
}
window.addEventListener("error", (e) => stkReportError("erreur", e.error || e.message, e.filename ? String(e.filename).split("/").pop() + ":" + e.lineno : ""));
window.addEventListener("unhandledrejection", (e) => stkReportError("promesse", e.reason));

// ---------------- Choix de l'application après connexion ----------------
function StkAppChooser({ name, onChoose, canInventory }) {
  const now = useNow();
  const [stockOk, setStockOk] = useState(undefined);
  useEffect(() => {
    stkFlushErrors();
    stkEnsureLoaded().catch(() => {}); // préchargement du module pendant que l'utilisateur choisit
    if (!canInventory) { onChoose("stock"); return; }
    let live = true;
    stkCall("me", {}, false, 12e3).then(() => live && setStockOk(true)).catch((e) => { if (live) setStockOk(String(e.message) === "ACCES_STOCK_REFUSE" ? false : true); });
    return () => { live = false; };
  }, []);
  useEffect(() => { if (stockOk === false && canInventory) onChoose("inventaire"); }, [stockOk]);
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
