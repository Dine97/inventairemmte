// ============================================================
// STOCK MMTE — Suivi hebdomadaire des stocks des parcs
// Données : Supabase (projet stock-mmte), identité : Firebase (INVENTAIRE MMTE)
// ============================================================

// ---------- Dates & situation ----------
function stkToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function stkFmtTs(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString("fr-FR") + " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}
function stkAddDays(iso, n) {
  if (!iso) return null;
  const d = new Date(String(iso).slice(0, 10) + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function stkDiff(a, b) { // jours de a à b
  return Math.round((new Date(String(b).slice(0, 10) + "T12:00:00Z") - new Date(String(a).slice(0, 10) + "T12:00:00Z")) / 864e5);
}
function stkNum(v, d) { const n = Number(v); return isFinite(n) && n > 0 ? n : d; }
function stkSettings(S) {
  S = S || {};
  return {
    duree: stkNum(S.duree_sejour, 365),
    seuil: stkNum(S.seuil_alerte, 30),
    transfert: S.afficher_transfert !== false,
    types: Array.isArray(S.types_sortie) && S.types_sortie.length ? S.types_sortie : ["Mise à la consommation (déclaration payée)", "Transfert", "Réexportation", "Transit", "Erreur de fichier", "Autre"],
    fenetre: stkNum(S.fenetre_transfert, 30),
    mmte: S.source_depot === "mmte"
  };
}
// Situation d'un véhicule à la date de référence
function stkSit(row, ref, cfg) {
  const useM = !!(cfg.mmte && row && row.mmte_depot_date);
  if (!row || (!row.date_arrivee && !useM)) return { code: "sans_date", label: "Date d'arrivée inconnue", depot: null, restant: null, sejour: null };
  const depot = useM ? String(row.mmte_depot_date).slice(0, 10) : stkAddDays(row.date_arrivee, cfg.duree);
  const restant = stkDiff(ref, depot);
  const sejour = row.date_arrivee ? stkDiff(row.date_arrivee, ref) : null;
  if (restant <= 0) return { code: "depot", label: "Dépôt", depot, restant, sejour };
  if (restant <= cfg.seuil) return { code: "bientot", label: "Bientôt en dépôt", depot, restant, sejour };
  return { code: "disponible", label: "Disponible", depot, restant, sejour };
}
const STK_SIT_TONE = { disponible: "bg-emerald-50 text-emerald-800 border-emerald-200", bientot: "bg-amber-50 text-amber-900 border-amber-300", depot: "bg-rose-50 text-rose-800 border-rose-200", sans_date: "bg-slate-100 text-slate-600 border-slate-200", sorti: "bg-slate-100 text-slate-700 border-slate-300" };
const STK_JUSTIF = { non_justifiee: { label: "Non justifiée", tone: "bg-slate-100 text-slate-600 border-slate-200" }, justifiee: { label: "Justifiée", tone: "bg-sky-50 text-sky-800 border-sky-200" }, validee: { label: "Validée", tone: "bg-emerald-50 text-emerald-800 border-emerald-200" } };
const STK_ENTRY = { initial: "Stock initial", entree: "Entrée", transfert: "Entrée par transfert", manuel: "Ajout manuel" };
const STK_EXIT = { sortie: "Sortie", transfert: "Transfert", erreur: "Erreur de fichier", manuel: "Sortie manuelle" };
function stkVeh(r) { return [r.marque, r.modele, r.annee].filter(Boolean).join(" "); }


// ---------- Exports Excel / PDF ----------
function stkExportXlsx(fileName, title, meta, columns, rows) {
  const aoa = [[title], ...meta.map((m) => [m]), [], columns.map((c) => c.h)];
  rows.forEach((r) => aoa.push(columns.map((c) => { const v = c.x ? c.x(r) : r[c.k]; return v == null ? "" : v; })));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = columns.map((c) => ({ wch: c.w || 16 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Liste");
  XLSX.writeFile(wb, fileName.replace(/[\\/:*?"<>|]+/g, "_") + ".xlsx");
}
function stkEsc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function stkPrintPdf(title, meta, columns, rows, landscape) {
  const head = `<div class="sp-head"><img src="${LOGO_BC}" alt="Bénin Control"><div class="sp-t"><div class="sp-k">Bénin Control · MAD-MAE · Suivi des stocks MAD ROULANTS</div><h1>${stkEsc(title)}</h1>${meta.map((m) => `<div class="sp-m">${stkEsc(m)}</div>`).join("")}</div><img src="${LOGO_DOUANES}" alt="Douanes Béninoises"></div>`;
  const table = `<table><thead><tr><th>N°</th>${columns.map((c) => `<th>${stkEsc(c.h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r, i) => `<tr><td>${i + 1}</td>${columns.map((c) => `<td>${stkEsc(c.p ? c.p(r) : c.x ? c.x(r) : r[c.k])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  const foot = `<div class="sp-f">Édité le ${new Date().toLocaleDateString("fr-FR")} à ${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} — ${rows.length} ligne(s)</div>`;
  const css = `#stk-print{font-family:Calibri,Carlito,"Segoe UI",Arial,sans-serif;color:#0F2A47;font-size:9pt}
#stk-print .sp-head{display:flex;align-items:center;gap:16px;border-bottom:2px solid #123A66;padding-bottom:10px;margin-bottom:12px}
#stk-print .sp-head img{height:52px;width:auto;object-fit:contain}
#stk-print .sp-t{flex:1;text-align:center}
#stk-print .sp-k{font-size:8pt;letter-spacing:.12em;text-transform:uppercase;color:#1B4F8C;font-weight:700}
#stk-print h1{font-size:15pt;margin:4px 0;color:#0B1F38}
#stk-print .sp-m{font-size:9pt;color:#334E68}
#stk-print table{width:100%;border-collapse:collapse}
#stk-print th{background:#123A66;color:#fff;text-align:left;padding:4px 5px;font-size:8.5pt}
#stk-print td{border-bottom:1px solid #DCE6F1;padding:3px 5px;vertical-align:top}
#stk-print tr:nth-child(even) td{background:#F4F8FC}
#stk-print .sp-f{margin-top:10px;font-size:8pt;color:#5B6F86;text-align:right}`;
  const old = document.getElementById("stk-print"); if (old) old.remove();
  const oldSt = document.getElementById("stk-print-style"); if (oldSt) oldSt.remove();
  const host = document.createElement("div");
  host.id = "stk-print";
  host.innerHTML = `<style>${css}</style>${head}${table}${foot}`;
  document.body.appendChild(host);
  const st = document.createElement("style");
  st.id = "stk-print-style";
  st.textContent = `#stk-print{display:none}@page{size:A4 ${landscape === false ? "portrait" : "landscape"};margin:12mm}@media print{body.stk-printing #root{display:none!important}body.stk-printing #stk-print{display:block!important}}`;
  document.head.appendChild(st);
  document.body.classList.add("stk-printing");
  window.addEventListener("afterprint", () => { document.body.classList.remove("stk-printing"); host.remove(); st.remove(); }, { once: true });
  setTimeout(() => window.print(), 300);
}
// Colonnes d'export standard
function stkExportCols(cfg, ref, extra) {
  const cols = [
    { h: "Châssis", k: "chassis", w: 22 },
    { h: "Marque", k: "marque", w: 14 },
    { h: "Modèle", k: "modele", w: 16 },
    { h: "Année", k: "annee", w: 7 },
    { h: "Navire", k: "navire", w: 20 },
    { h: "Manifeste / ATP", k: "manifeste", w: 14 },
    { h: "N° BL", k: "bl", w: 14 },
    { h: "Date d'arrivée", x: (r) => stkFmt(r.date_arrivee), w: 12 }
  ];
  if (cfg.transfert) cols.push({ h: "Date de transfert", x: (r) => stkFmt(r.date_transfert), w: 12 });
  cols.push({ h: "Date de dépôt", x: (r) => stkFmt(stkSit(r, ref, cfg).depot), w: 12 });
  if (cfg.mmte) cols.push({ h: "Dépôt MMTE", x: (r) => stkFmt(r.mmte_depot_date), w: 12 });
  cols.push({ h: "Situation", x: (r) => r.exit_date && extra !== "sorties" ? "Sorti" : stkSit(r, ref, cfg).label, w: 16 });
  cols.push({ h: "Jours restants", x: (r) => { const s = stkSit(r, ref, cfg); return s.restant == null ? "" : s.restant; }, w: 9 });
  (extra || []).forEach && (extra || []).forEach((c) => cols.push(c));
  return cols;
}

// ---------- Composants communs ----------
const StkCtx = React.createContext(null);
function StkBadge({ tone, children, className }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold ${tone || "bg-slate-100 text-slate-600 border-slate-200"} ${className || ""}`}>{children}</span>;
}
function StkSitBadge({ row, refDate }) {
  const { cfg } = React.useContext(StkCtx);
  const s = stkSit(row, refDate || stkToday(), cfg);
  return <StkBadge tone={STK_SIT_TONE[s.code]}>{s.code === "depot" ? `Dépôt (+${-s.restant} j)` : s.code === "bientot" ? `Dépôt dans ${s.restant} j` : s.code === "disponible" ? `${s.restant} j restants` : "Sans date"}</StkBadge>;
}
function StkCard({ children, className, ...rest }) {
  return <div className={`bg-white rounded-2xl border border-slate-200 shadow-sm ${className || ""}`} {...rest}>{children}</div>;
}
function StkBtn({ kind, small, className, children, ...rest }) {
  const base = small ? "px-3 py-1.5 text-xs" : "px-4 py-2.5 text-sm";
  const k = kind === "primary" ? "bg-[#1B4F8C] text-white border-2 border-[#1B4F8C]" : kind === "danger" ? "bg-white text-rose-700 border-2 border-rose-200 hover:bg-rose-50" : kind === "ghost" ? "bg-transparent text-[#1B4F8C] border-2 border-transparent hover:bg-[#EAF1FA]" : "bg-white text-[#1B4F8C] border-2 border-[#1B4F8C]/25 hover:border-[#1B4F8C]";
  return <button {...rest} className={`${base} ${k} rounded-lg font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50 ${className || ""}`}>{children}</button>;
}
function StkField({ label, children, hint, className }) {
  return <label className={`block ${className || ""}`}><span className="block text-xs font-bold text-slate-600 mb-1">{label}</span>{children}{hint && <span className="block text-[11px] text-slate-400 mt-1">{hint}</span>}</label>;
}
const stkInput = "w-full border-2 border-slate-200 rounded-lg px-3 py-2 text-sm";
function StkKpi({ label, value, tone, sub, onClick }) {
  const T = { navy: "text-[#123A66]", green: "text-emerald-700", amber: "text-amber-700", rose: "text-rose-700", slate: "text-slate-700" };
  return <button type="button" onClick={onClick} disabled={!onClick} className="text-left bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-3 disabled:cursor-default">
    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
    <div className={`font-plex-mono text-2xl font-bold mt-1 ${T[tone] || T.navy}`}>{(value || 0).toLocaleString("fr-FR")}</div>
    {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
  </button>;
}
function StkModal({ title, onClose, children, wide, footer }) {
  useEffect(() => {
    const k = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, []);
  return <div className="fixed inset-0 z-50 flex items-start md:items-center justify-center bg-[#0B1F38]/55 p-0 md:p-6 no-print" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className={`bg-[#F4F8FC] w-full ${wide ? "md:max-w-5xl" : "md:max-w-xl"} md:rounded-2xl shadow-2xl max-h-[100vh] md:max-h-[92vh] min-h-[50vh] flex flex-col overflow-hidden`}>
      <div className="flex items-center gap-3 px-5 py-4 bg-white border-b border-slate-200">
        <div className="flex-1 font-bold text-[#0B1F38] text-base md:text-lg min-w-0 truncate">{title}</div>
        <button onClick={onClose} className="w-10 h-10 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100" aria-label="Fermer"><StkIc.X size={20} /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 md:p-5">{children}</div>
      {footer && <div className="px-5 py-3 bg-white border-t border-slate-200 flex flex-wrap gap-2 justify-end">{footer}</div>}
    </div>
  </div>;
}
function StkMsg({ tone, children }) {
  const T = { err: "bg-rose-50 border-rose-200 text-rose-800", ok: "bg-emerald-50 border-emerald-200 text-emerald-800", warn: "bg-amber-50 border-amber-300 text-amber-900", info: "bg-[#EAF1FA] border-[#C9DBEF] text-[#123A66]" };
  return <div className={`rounded-xl border-2 px-4 py-3 text-sm ${T[tone] || T.info}`}>{children}</div>;
}
function StkLoading({ text }) { return <div className="py-10 text-center text-sm text-slate-400">{text || "Chargement..."}</div>; }

// Tableau générique : tri, filtre rapide, pagination, sélection
function StkTable({ columns, rows, onRow, selectable, selected, setSelected, empty, rowKey, initial }) {
  const [sort, setSort] = useState(null);
  const [limit, setLimit] = useState(initial || 200);
  const key = rowKey || ((r) => r.stay_id || r.id);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const c = columns.find((x) => x.key === sort.key);
    if (!c) return rows;
    const val = c.sort || ((r) => r[c.key]);
    return [...rows].sort((a, b) => {
      const A = val(a), B = val(b);
      if (A == null && B == null) return 0; if (A == null) return 1; if (B == null) return -1;
      return (A > B ? 1 : A < B ? -1 : 0) * sort.dir;
    });
  }, [rows, sort]);
  const shown = sorted.slice(0, limit);
  const allSel = selectable && rows.length > 0 && rows.every((r) => selected.has(key(r)));
  const toggleAll = () => { const n = new Set(selected); if (allSel) rows.forEach((r) => n.delete(key(r))); else rows.forEach((r) => n.add(key(r))); setSelected(n); };
  const toggle = (r) => { const n = new Set(selected); const k = key(r); n.has(k) ? n.delete(k) : n.add(k); setSelected(n); };
  if (!rows.length) return <div className="py-10 text-center text-sm text-slate-400">{empty || "Aucune donnée."}</div>;
  return <div>
    <div className="overflow-x-auto -mx-4 md:mx-0">
      <table className="w-full text-sm min-w-[720px]">
        <thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b-2 border-slate-200">
          {selectable && <th className="py-2 px-3 w-8"><input type="checkbox" checked={allSel} onChange={toggleAll} aria-label="Tout sélectionner" /></th>}
          {columns.map((c) => <th key={c.key} className={`py-2 px-3 font-bold whitespace-nowrap ${c.sortable === false ? "" : "cursor-pointer hover:text-[#1B4F8C]"} ${c.th || ""}`} onClick={() => c.sortable !== false && setSort((s) => s && s.key === c.key ? { key: c.key, dir: -s.dir } : { key: c.key, dir: 1 })}>{c.label}{sort && sort.key === c.key ? (sort.dir > 0 ? " ▲" : " ▼") : ""}</th>)}
        </tr></thead>
        <tbody>{shown.map((r) => <tr key={key(r)} className={`border-b border-slate-100 ${onRow ? "cursor-pointer hover:bg-[#EAF1FA]" : ""}`} onClick={() => onRow && onRow(r)}>
          {selectable && <td className="py-2 px-3" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(key(r))} onChange={() => toggle(r)} aria-label="Sélectionner" /></td>}
          {columns.map((c) => <td key={c.key} className={`py-2 px-3 align-top ${c.td || ""}`}>{c.render ? c.render(r) : r[c.key]}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
    {rows.length > limit && <div className="text-center pt-3"><StkBtn small onClick={() => setLimit((l) => l + 500)}>Afficher plus ({(rows.length - limit).toLocaleString("fr-FR")} restants)</StkBtn></div>}
    <div className="text-xs text-slate-400 pt-2 text-right">{rows.length.toLocaleString("fr-FR")} ligne(s){selectable && selected.size ? ` · ${selected.size} sélectionnée(s)` : ""}</div>
  </div>;
}
// Colonnes standard pour une liste de véhicules (séjours)
function stkCols(cfg, ref, opts) {
  opts = opts || {};
  const cols = [
    { key: "chassis", label: "Châssis", render: (r) => <span className="font-plex-mono font-bold text-[#0B1F38] whitespace-nowrap">{r.chassis}</span> },
    { key: "veh", label: "Véhicule", sort: (r) => stkVeh(r), render: (r) => <span className="text-slate-700">{stkVeh(r) || "—"}</span> },
    { key: "navire", label: "Navire", render: (r) => <span className="text-slate-600">{r.navire || "—"}</span> }
  ];
  if (opts.parc) cols.push({ key: "parc", label: "Parc", render: (r) => <span className="font-semibold text-slate-700">{r.parc || (r.parcName) || "—"}</span> });
  cols.push({ key: "date_arrivee", label: "Arrivée", render: (r) => stkFmt(r.date_arrivee) || "—" });
  if (cfg.transfert) cols.push({ key: "date_transfert", label: "Transfert", render: (r) => stkFmt(r.date_transfert) || "—" });
  if (opts.entree) cols.push({ key: "entry_date", label: "Entrée au parc", render: (r) => <span>{stkFmt(r.entry_date)}{r.entry_kind === "transfert" && <span className="block text-[11px] text-sky-700 font-bold">depuis {r.from_parc || "?"}</span>}{r.entry_kind === "initial" && <span className="block text-[11px] text-slate-400">stock initial</span>}{r.entry_kind !== "initial" && r.entry_from_file === false && <span className="block text-[11px] text-slate-400">date de l'import</span>}</span> });
  if (opts.sortie) cols.push({ key: "exit_date", label: "Sortie (constatée)", render: (r) => <span>{stkFmt(r.exit_date)}<span className="block text-[11px] font-bold text-slate-500">{stkExitLabel(r) || ""}{r.to_parc ? ` vers ${r.to_parc}` : ""}</span></span> });
  if (opts.justif) cols.push({ key: "justif_status", label: "Justification", render: (r) => <span><StkBadge tone={STK_JUSTIF[r.justif_status || "non_justifiee"].tone}>{STK_JUSTIF[r.justif_status || "non_justifiee"].label}</StkBadge>{r.justif_numero && <span className="block text-[11px] text-slate-500 mt-0.5">{r.justif_numero}</span>}{(r.justif_files || []).length > 0 && <span className="block text-[11px] text-slate-500"><StkIc.Clip size={11} /> {(r.justif_files || []).length}</span>}</span> });
  if (!opts.noSit) {
    cols.push({ key: "depot", label: "Date de dépôt", sort: (r) => stkSit(r, ref, cfg).depot, render: (r) => stkFmt(stkSit(r, ref, cfg).depot) || "—" });
    cols.push({ key: "sit", label: "Situation", sort: (r) => { const s = stkSit(r, ref, cfg); return s.restant == null ? 99999 : s.restant; }, render: (r) => <StkSitBadge row={r} refDate={ref} /> });
  }
  return cols;
}
function stkFilterRows(rows, q) {
  const t = String(q || "").trim().toUpperCase();
  if (!t) return rows;
  const tc = t.replace(/[\s\-\.\/]/g, "");
  return rows.filter((r) => (r.chassis || "").includes(tc) || [r.marque, r.modele, r.annee, r.navire, r.manifeste, r.bl, r.importateur, r.parc].join(" ").toUpperCase().includes(t));
}
function StkExportBar({ onXlsx, onPdf, disabled }) {
  return <div className="flex gap-2">
    <StkBtn small disabled={disabled} onClick={onXlsx}><Download size={15} /> Excel</StkBtn>
    <StkBtn small disabled={disabled} onClick={onPdf}><Printer size={15} /> PDF</StkBtn>
  </div>;
}
function StkTabs({ tabs, value, onChange }) {
  return <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">{tabs.map((t) => <button key={t.key} onClick={() => onChange(t.key)} className={`shrink-0 px-3 py-2 rounded-lg text-sm font-bold border-2 ${value === t.key ? "bg-[#123A66] text-white border-[#123A66]" : "bg-white text-slate-600 border-slate-200 hover:border-[#1B4F8C]/40"}`}>{t.label}{t.count != null && (t.warn && value !== t.key ? <span className="ml-1.5 font-plex-mono text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-900">{t.count.toLocaleString("fr-FR")}</span> : <span className={`ml-1.5 font-plex-mono text-xs ${value === t.key ? "text-[#7FC2FF]" : "text-slate-400"}`}>{t.count.toLocaleString("fr-FR")}</span>)}</button>)}</div>;
}
function stkFileToB64(file) {
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onerror = () => rej(new Error("lecture")); fr.onload = () => res(String(fr.result).split(",")[1]); fr.readAsDataURL(file); });
}
