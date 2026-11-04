// STOCK MMTE — API sécurisée (Supabase Edge Function)
// Identité : jeton Firebase de l'application INVENTAIRE MMTE (projet benin-control-mmte).
// Droits : agent approuvé dans Firestore (users/{uid}.status == 'approved') ou administrateur.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";

const FIREBASE_PROJECT = "benin-control-mmte";
const FALLBACK_ADMINS = ["nourouloka@gmail.com"];
const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const FS = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

class ApiError extends Error { constructor(public code: string, public status = 400) { super(code); } }

const roleCache = new Map<string, { at: number; role: Who }>();
type Who = { uid: string; email: string; name: string; isAdmin: boolean; access: string };

function fsVal(v: any): any {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fsVal);
  return null;
}
async function fsGet(path: string, token: string) {
  const r = await fetch(`${FS}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const d = await r.json();
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(d.fields || {})) out[k] = fsVal(v);
  return out;
}
async function identify(req: Request): Promise<Who> {
  const h = req.headers.get("authorization") || "";
  const token = h.replace(/^Bearer\s+/i, "");
  if (!token) throw new ApiError("NON_CONNECTE", 401);
  let payload: any;
  try {
    ({ payload } = await jwtVerify(token, JWKS, { issuer: `https://securetoken.google.com/${FIREBASE_PROJECT}`, audience: FIREBASE_PROJECT }));
  } catch (_e) { throw new ApiError("SESSION_EXPIREE", 401); }
  if (payload.firebase?.sign_in_provider === "anonymous") throw new ApiError("INVITE_NON_AUTORISE", 403);
  const uid = String(payload.sub);
  const email = String(payload.email || "").toLowerCase();
  const c = roleCache.get(uid);
  if (c && Date.now() - c.at < 60e3) return c.role;
  let isAdmin = FALLBACK_ADMINS.includes(email);
  if (!isAdmin) {
    const adm = await fsGet("config/admins", token);
    if (adm && Array.isArray(adm.emails) && adm.emails.map((x: string) => String(x).toLowerCase()).includes(email)) isAdmin = true;
  }
  if (!isAdmin) {
    const app = await fsGet("config/app", token);
    if (app && Array.isArray(app.adminEmails) && app.adminEmails.map((x: string) => String(x).toLowerCase()).includes(email)) isAdmin = true;
  }
  const user = await fsGet(`users/${uid}`, token);
  if (!isAdmin && (!user || user.status !== "approved")) throw new ApiError("COMPTE_NON_APPROUVE", 403);
  const name = String((user && (user.displayName || user.name || user.fullName)) || payload.name || email);
  // Accès au suivi des stocks (réglable par utilisateur dans l'administration)
  let access = "agent";
  const su = (await sb.from("stock_users").select("access").eq("uid", uid).maybeSingle()).data as any;
  if (su) access = su.access;
  else {
    const def = (await sb.from("settings").select("value").eq("key", "acces_par_defaut").maybeSingle()).data as any;
    access = def && ["aucun", "consultation", "agent"].includes(def.value) ? def.value : "agent";
    await sb.from("stock_users").insert({ uid, email, name, access });
  }
  await sb.from("stock_users").update({ last_seen: new Date().toISOString(), email, name }).eq("uid", uid);
  if (isAdmin) access = "agent";
  if (access === "aucun") throw new ApiError("ACCES_STOCK_REFUSE", 403);
  const role = { uid, email, name, isAdmin, access };
  roleCache.set(uid, { at: Date.now(), role });
  return role;
}

const must = <T>(r: { data: T; error: any }) => { if (r.error) throw new ApiError(r.error.message || "ERREUR_BASE", 500); return r.data; };
async function fetchAll(make: () => any, max = 50000) {
  const out: any[] = [];
  for (let from = 0; from < max; from += 1000) {
    const page = must(await make().range(from, from + 999)) as any[];
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}
async function audit(who: Who, action: string, entity: string, entity_id: unknown, detail = "", before: unknown = null, after: unknown = null) {
  await sb.from("audit_log").insert({ by_uid: who.uid, by_name: who.name, action, entity, entity_id: entity_id == null ? null : String(entity_id), detail, before, after });
}
function adminOnly(who: Who) { if (!who.isAdmin) throw new ApiError("RESERVE_ADMIN", 403); }
function agentOnly(who: Who) { if (!who.isAdmin && who.access !== "agent") throw new ApiError("LECTURE_SEULE", 403); }
function pick(o: any, keys: string[]) { const r: any = {}; for (const k of keys) if (o && k in o) r[k] = o[k] === "" ? null : o[k]; return r; }
const today = () => new Date(Date.now() + 3600e3).toISOString().slice(0, 10); // heure du Bénin

const LIST_COLS = "stay_id,vehicle_id,parc_id,parc,entry_import_id,entry_date,entry_kind,from_parc,exit_import_id,exit_date,exit_kind,to_parc,justif_type,justif_numero,justif_date,justif_bureau,justif_status,justif_files,justif_by,valide_by,chassis,chassis_raw,marque,modele,annee,navire,manifeste,bl,date_arrivee,date_transfert,importateur,mmte_depot_date";
const VEH_FIELDS = ["locked_fields", "chassis_raw", "marque", "modele", "annee", "navire", "manifeste", "bl", "date_arrivee", "date_transfert", "importateur", "notes", "data"];
const STAY_FIELDS = ["parc_id", "entry_date", "entry_kind", "from_parc_id", "exit_date", "exit_kind", "to_parc_id", "justif_type", "justif_numero", "justif_date", "justif_bureau", "justif_note", "justif_status"];
const JUSTIF_FIELDS = ["justif_type", "justif_numero", "justif_date", "justif_bureau", "justif_note"];

async function settingsMap() {
  const rows = must(await sb.from("settings").select("key,value")) as any[];
  const m: Record<string, any> = {};
  rows.forEach((r) => (m[r.key] = r.value));
  return m;
}
async function dashboard(ref?: string) {
  const s = await settingsMap();
  return must(await sb.rpc("stock_dashboard", { p_ref: ref || today(), p_duree: Number(s.duree_sejour) || 365, p_seuil: Number(s.seuil_alerte) || 30, p_mmte: s.source_depot === "mmte" }));
}

const actions: Record<string, (p: any, who: Who) => Promise<unknown>> = {
  async me(_p, who) { return who; },

  async bootstrap(p, who) {
    const names: string[] = Array.isArray(p.names) ? p.names.map((n: string) => String(n).trim().toUpperCase()).filter(Boolean) : [];
    if (names.length) {
      const existing = new Set((must(await sb.from("parcs").select("name")) as any[]).map((r) => r.name));
      const missing = [...new Set(names)].filter((n) => !existing.has(n));
      if (missing.length) must(await sb.from("parcs").insert(missing.map((name) => ({ name }))));
    }
    const [settings, dash] = await Promise.all([settingsMap(), dashboard(p.ref)]);
    const lastImports = must(await sb.from("imports").select("id,parc_id,stock_date,file_name,nb_chassis,nb_entrees,nb_sorties,nb_transferts,status,created_by_name,created_at,parcs(name)").order("created_at", { ascending: false }).limit(8));
    return { me: who, settings, dashboard: dash, lastImports, today: today() };
  },

  async dashboard(p) { return dashboard(p.ref); },

  async parc_stock(p) {
    const pid = Number(p.parc_id);
    if (!pid) throw new ApiError("PARC_MANQUANT");
    const rows = await fetchAll(() => {
      let q = sb.from("v_stays").select(LIST_COLS).eq("parc_id", pid);
      if (p.date) q = q.lte("entry_date", p.date).or(`exit_date.is.null,exit_date.gt.${p.date}`);
      else q = q.is("exit_date", null);
      return q.order("chassis");
    });
    let lastImport = null;
    if (p.date) {
      lastImport = must(await sb.from("imports").select("id,stock_date,file_name").eq("parc_id", pid).eq("status", "valide").lte("stock_date", p.date).order("stock_date", { ascending: false }).limit(1))[0] || null;
    } else {
      lastImport = must(await sb.from("imports").select("id,stock_date,file_name").eq("parc_id", pid).eq("status", "valide").order("stock_date", { ascending: false }).limit(1))[0] || null;
    }
    return { rows, lastImport };
  },

  async movements(p) {
    const from = p.from || "1900-01-01", to = p.to || "2999-12-31";
    const rows = await fetchAll(() => {
      let q = sb.from("v_stays").select(LIST_COLS);
      if (p.parc_id) q = q.eq("parc_id", Number(p.parc_id));
      if (p.kind === "entrees") q = q.gte("entry_date", from).lte("entry_date", to).in("entry_kind", ["entree", "transfert", "manuel"]);
      else q = q.gte("exit_date", from).lte("exit_date", to).not("exit_kind", "is", null);
      if (p.kind === "sorties" && p.only_sorties) q = q.eq("exit_kind", "sortie");
      if (p.justif) q = q.eq("justif_status", p.justif);
      return q.order(p.kind === "entrees" ? "entry_date" : "exit_date", { ascending: false }).order("chassis");
    });
    return rows;
  },

  async search(p) {
    const q = String(p.q || "").trim().toUpperCase();
    const limit = Math.min(Number(p.limit) || 300, 2000);
    let query = sb.from("vehicles").select("id,chassis,chassis_raw,marque,modele,annee,navire,manifeste,bl,date_arrivee,date_transfert,importateur,mmte_depot_date,current_parc_id,updated_at,parc:parcs!vehicles_current_parc_id_fkey(name)").is("deleted_at", null);
    if (q) {
      const esc = q.replace(/[%,()]/g, " ").trim();
      const cq = esc.replace(/[\s\-\.\/]/g, "");
      if (p.field === "chassis") query = query.ilike("chassis", `%${cq}%`);
      else query = query.or(`chassis.ilike.%${cq}%,marque.ilike.%${esc}%,modele.ilike.%${esc}%,navire.ilike.%${esc}%,manifeste.ilike.%${esc}%,bl.ilike.%${esc}%,importateur.ilike.%${esc}%`);
    }
    if (p.parc_id) query = query.eq("current_parc_id", Number(p.parc_id));
    if (p.statut === "present") query = query.not("current_parc_id", "is", null);
    if (p.statut === "sorti") query = query.is("current_parc_id", null);
    if (p.navire) query = query.ilike("navire", `%${String(p.navire).replace(/[%,()]/g, " ")}%`);
    if (p.marque) query = query.ilike("marque", `%${String(p.marque).replace(/[%,()]/g, " ")}%`);
    if (p.arr_from) query = query.gte("date_arrivee", p.arr_from);
    if (p.arr_to) query = query.lte("date_arrivee", p.arr_to);
    if (p.depot_from) query = query.gte("date_arrivee", p.depot_from);
    if (p.depot_to) query = query.lte("date_arrivee", p.depot_to);
    if (p.sans_date) query = query.is("date_arrivee", null);
    const rows = must(await query.order("chassis").limit(limit));
    return rows;
  },

  async vehicle(p) {
    let v: any;
    if (p.id) v = must(await sb.from("vehicles").select("*").eq("id", Number(p.id)).maybeSingle());
    else v = must(await sb.from("vehicles").select("*").eq("chassis", String(p.chassis || "").toUpperCase().replace(/[\s\-\.\/]/g, "")).maybeSingle());
    if (!v) throw new ApiError("VEHICULE_INTROUVABLE", 404);
    const stays = must(await sb.from("v_stays").select("*").eq("vehicle_id", v.id).order("entry_date").order("stay_id"));
    const impIds = [...new Set((stays as any[]).flatMap((s) => [s.entry_import_id, s.exit_import_id]).filter(Boolean))];
    const imports = impIds.length ? must(await sb.from("imports").select("id,stock_date,file_name,created_by_name,created_at").in("id", impIds)) : [];
    const parc = v.current_parc_id ? must(await sb.from("parcs").select("id,name").eq("id", v.current_parc_id).maybeSingle()) : null;
    const hist = must(await sb.from("audit_log").select("at,by_name,action,detail").eq("entity", "vehicle").eq("entity_id", String(v.id)).order("at", { ascending: false }).limit(50));
    return { vehicle: v, parc, stays, imports, history: hist };
  },

  async templates(p) {
    const parc = p.parc_name ? must(await sb.from("parcs").select("id").eq("name", String(p.parc_name).trim().toUpperCase()).maybeSingle()) as any : null;
    const tpl = parc ? must(await sb.from("file_templates").select("*").eq("parc_id", parc.id)) : [];
    const synonyms = must(await sb.from("column_synonyms").select("id,field,synonym"));
    return { templates: tpl, synonyms };
  },

  async preview_import(p, who) {
    agentOnly(who);
    return must(await sb.rpc("stock_preview_import", { p: { parc_name: p.parc_name, chassis: p.chassis || [] } }));
  },

  async commit_import(p, who) {
    agentOnly(who);
    if (!p.parc_name || !p.stock_date || !Array.isArray(p.rows)) throw new ApiError("DONNEES_INCOMPLETES");
    const payload = { ...p, by_uid: who.uid, by_name: who.name };
    delete payload.template;
    const res: any = must(await sb.rpc("stock_commit_import", { p: payload }));
    if (p.template && p.template.signature && p.template.mapping) {
      await sb.from("file_templates").upsert({ parc_id: res.parc_id, signature: p.template.signature, mapping: p.template.mapping, header_row: p.template.header_row, sheet: p.template.sheet, updated_at: new Date().toISOString(), updated_by: who.name }, { onConflict: "parc_id,signature" });
    }
    if (Array.isArray(p.new_synonyms)) {
      for (const s of p.new_synonyms) if (s.field && s.synonym) await sb.from("column_synonyms").upsert({ field: s.field, synonym: s.synonym, created_by: who.name }, { onConflict: "synonym" });
    }
    await audit(who, "import", "import", res.import_id, `${p.parc_name} — stock du ${p.stock_date} — ${p.file_name || ""} : ${res.nb_chassis} châssis, ${res.entrees} entrées, ${res.sorties} sorties, ${res.transferts} transferts`);
    return res;
  },

  async imports(p) {
    let q = sb.from("imports").select("id,parc_id,stock_date,file_name,file_size,sheets,header_row,nb_lignes,nb_chassis,nb_entrees,nb_sorties,nb_transferts,is_initial,anomalies,declared,comment,status,cancel_reason,cancelled_at,cancelled_by,created_by_name,created_at,parcs(name)");
    if (p.parc_id) q = q.eq("parc_id", Number(p.parc_id));
    if (p.from) q = q.gte("stock_date", p.from);
    if (p.to) q = q.lte("stock_date", p.to);
    return must(await q.order("stock_date", { ascending: false }).order("id", { ascending: false }).limit(Math.min(Number(p.limit) || 500, 2000)));
  },

  async import_detail(p) {
    const imp = must(await sb.from("imports").select("*,parcs(name)").eq("id", Number(p.id)).maybeSingle());
    if (!imp) throw new ApiError("IMPORT_INTROUVABLE", 404);
    const entrees = await fetchAll(() => sb.from("v_stays").select(LIST_COLS).eq("entry_import_id", Number(p.id)).order("chassis"));
    const sorties = await fetchAll(() => sb.from("v_stays").select(LIST_COLS).eq("exit_import_id", Number(p.id)).order("chassis"));
    return { import: imp, entrees, sorties };
  },

  async cancel_import(p, who) {
    adminOnly(who);
    if (!p.reason) throw new ApiError("MOTIF_OBLIGATOIRE");
    must(await sb.rpc("stock_cancel_import", { p_import: Number(p.id), p_reason: String(p.reason), p_by: who.name }));
    await audit(who, "annulation_import", "import", p.id, p.reason);
    return { ok: true };
  },

  async import_update(p, who) {
    adminOnly(who);
    const before = must(await sb.from("imports").select("comment").eq("id", Number(p.id)).maybeSingle());
    must(await sb.from("imports").update({ comment: p.comment || null }).eq("id", Number(p.id)));
    await audit(who, "modification", "import", p.id, "Commentaire", before, { comment: p.comment });
    return { ok: true };
  },

  // ---- Justification des sorties (facultatif, agents MMTE) ----
  async justify(p, who) {
    agentOnly(who);
    const ids: number[] = (p.stay_ids || []).map(Number).filter(Boolean);
    if (!ids.length) throw new ApiError("AUCUNE_SORTIE");
    const f = pick(p, JUSTIF_FIELDS);
    const cur = must(await sb.from("stays").select("id,justif_status,vehicle_id").in("id", ids)) as any[];
    if (!who.isAdmin && cur.some((c) => c.justif_status === "validee")) throw new ApiError("DEJA_VALIDEE");
    must(await sb.from("stays").update({ ...f, justif_status: "justifiee", justif_by: who.name, justif_at: new Date().toISOString(), valide_by: null, valide_at: null, updated_at: new Date().toISOString() }).in("id", ids));
    let warning: any[] = [];
    if (f.justif_numero) {
      const others = must(await sb.from("v_stays").select("chassis,parc,exit_date").eq("justif_numero", f.justif_numero).not("stay_id", "in", `(${ids.join(",")})`).limit(20)) as any[];
      warning = others;
    }
    for (const c of cur) await audit(who, "justification", "vehicle", c.vehicle_id, `Sortie justifiée${f.justif_numero ? " — déclaration " + f.justif_numero : ""}`, null, f);
    return { ok: true, warning };
  },
  async unjustify(p, who) {
    agentOnly(who);
    const ids: number[] = (p.stay_ids || []).map(Number).filter(Boolean);
    const cur = must(await sb.from("stays").select("id,justif_status,vehicle_id").in("id", ids)) as any[];
    if (!who.isAdmin && cur.some((c) => c.justif_status === "validee")) throw new ApiError("DEJA_VALIDEE");
    must(await sb.from("stays").update({ justif_status: "non_justifiee", valide_by: null, valide_at: null, updated_at: new Date().toISOString() }).in("id", ids));
    for (const c of cur) await audit(who, "retrait_justification", "vehicle", c.vehicle_id, "Justification retirée");
    return { ok: true };
  },
  async validate(p, who) {
    adminOnly(who);
    const ids: number[] = (p.stay_ids || []).map(Number).filter(Boolean);
    const cur = must(await sb.from("stays").select("id,vehicle_id,justif_status").in("id", ids)) as any[];
    must(await sb.from("stays").update({ justif_status: "validee", valide_by: who.name, valide_at: new Date().toISOString(), updated_at: new Date().toISOString() }).in("id", ids).neq("justif_status", "non_justifiee"));
    for (const c of cur) if (c.justif_status !== "non_justifiee") await audit(who, "validation", "vehicle", c.vehicle_id, "Justification de sortie validée");
    return { ok: true };
  },
  async upload_file(p, who) {
    agentOnly(who);
    const ids: number[] = (p.stay_ids || []).map(Number).filter(Boolean);
    if (!ids.length || !p.b64) throw new ApiError("FICHIER_MANQUANT");
    const bin = Uint8Array.from(atob(String(p.b64)), (c) => c.charCodeAt(0));
    if (bin.length > 8 * 1024 * 1024) throw new ApiError("FICHIER_TROP_GROS");
    const safe = String(p.name || "fichier").normalize("NFKD").replace(/[^\w.\-]+/g, "_").slice(-80);
    const path = `${new Date().toISOString().slice(0, 7)}/${ids[0]}_${Date.now()}_${safe}`;
    const up = await sb.storage.from("justificatifs").upload(path, bin, { contentType: p.type || "application/octet-stream", upsert: false });
    if (up.error) throw new ApiError(up.error.message, 500);
    const file = { path, name: p.name || safe, type: p.type || "", size: bin.length, at: new Date().toISOString(), by: who.name };
    const cur = must(await sb.from("stays").select("id,justif_files,vehicle_id").in("id", ids)) as any[];
    for (const c of cur) {
      must(await sb.from("stays").update({ justif_files: [...(c.justif_files || []), file], updated_at: new Date().toISOString() }).eq("id", c.id));
      await audit(who, "piece_jointe", "vehicle", c.vehicle_id, `Pièce jointe ajoutée : ${file.name}`);
    }
    return file;
  },
  async file_url(p) {
    const r = await sb.storage.from("justificatifs").createSignedUrl(String(p.path), 600);
    if (r.error) throw new ApiError(r.error.message, 404);
    return { url: r.data.signedUrl };
  },
  async remove_file(p, who) {
    agentOnly(who);
    const st = must(await sb.from("stays").select("id,justif_files,justif_status,vehicle_id").eq("id", Number(p.stay_id)).maybeSingle()) as any;
    if (!st) throw new ApiError("SEJOUR_INTROUVABLE", 404);
    if (!who.isAdmin && st.justif_status === "validee") throw new ApiError("DEJA_VALIDEE");
    const files = (st.justif_files || []).filter((f: any) => f.path !== p.path);
    must(await sb.from("stays").update({ justif_files: files }).eq("id", st.id));
    const still = must(await sb.from("stays").select("id").contains("justif_files", [{ path: p.path }]).limit(1)) as any[];
    if (!still.length) await sb.storage.from("justificatifs").remove([String(p.path)]);
    await audit(who, "piece_jointe_supprimee", "vehicle", st.vehicle_id, "Pièce jointe retirée");
    return { ok: true };
  },


  // ---- Rapports, graphiques, anomalies ----
  async report(p) {
    const s = await settingsMap();
    return must(await sb.rpc("stock_report", { p_from: p.from, p_to: p.to, p_duree: Number(s.duree_sejour) || 365, p_seuil: Number(s.seuil_alerte) || 30, p_mmte: s.source_depot === "mmte" }));
  },
  async history(p) {
    return must(await sb.rpc("stock_history", { p_parc: p.parc_id ? Number(p.parc_id) : null, p_ref: p.ref || today(), p_weeks: Math.min(Number(p.weeks) || 12, 104) }));
  },
  async anomalies(p) {
    const s = await settingsMap();
    return must(await sb.rpc("stock_anomalies", { p_duree: Number(s.duree_sejour) || 365, p_ecart: Number(p.ecart) || 3 }));
  },
  async merge(p, who) {
    adminOnly(who);
    const r = must(await sb.rpc("stock_merge_vehicles", { p_from: Number(p.from_id), p_into: Number(p.into_id), p_by: who.name })) as any;
    await audit(who, "fusion", "vehicle", p.into_id, `Châssis ${r.alias} fusionné dans ${r.chassis} (faute de saisie mémorisée)`);
    return r;
  },
  async restore_import(p, who) {
    adminOnly(who);
    must(await sb.rpc("stock_restore_import", { p_import: Number(p.id) }));
    await audit(who, "reactivation_import", "import", p.id, "Import réactivé");
    return { ok: true };
  },
  async mmte_sync(p, who) {
    agentOnly(who);
    if (!Array.isArray(p.rows)) throw new ApiError("DONNEES_INCOMPLETES");
    const r = must(await sb.rpc("stock_mmte_sync", { p: { rows: p.rows, parc_name: p.parc_name || "" } })) as any;
    await audit(who, "controle_mmte", "mmte", p.parc_name || "tous", `Contrôle MMTE${p.parc_name ? " — " + p.parc_name : ""} : ${r.lus} lus, ${r.trouves} trouvés, ${(r.ecarts || []).length} écarts de date`);
    return r;
  },
  // ---- Filtres de recherche enregistrés ----
  async filters_list(_p, who) {
    return must(await sb.from("saved_filters").select("*").or(`owner_uid.eq.${who.uid},shared.eq.true`).order("name"));
  },
  async filter_save(p, who) {
    if (!p.name || !p.params) throw new ApiError("DONNEES_INCOMPLETES");
    return must(await sb.from("saved_filters").insert({ owner_uid: who.uid, owner_name: who.name, name: String(p.name).slice(0, 80), params: p.params, shared: !!p.shared }).select("id").single());
  },
  async filter_delete(p, who) {
    const f = must(await sb.from("saved_filters").select("owner_uid").eq("id", Number(p.id)).maybeSingle()) as any;
    if (!f) return { ok: true };
    if (f.owner_uid !== who.uid && !who.isAdmin) throw new ApiError("RESERVE_ADMIN", 403);
    must(await sb.from("saved_filters").delete().eq("id", Number(p.id)));
    return { ok: true };
  },
  // ---- Utilisateurs du suivi des stocks ----
  async users_list(_p, who) {
    adminOnly(who);
    return must(await sb.from("stock_users").select("*").order("last_seen", { ascending: false, nullsFirst: false }));
  },
  async user_save(p, who) {
    adminOnly(who);
    if (!["aucun", "consultation", "agent"].includes(p.access)) throw new ApiError("ACCES_INVALIDE");
    must(await sb.from("stock_users").update({ access: p.access, updated_at: new Date().toISOString(), updated_by: who.name }).eq("uid", String(p.uid)));
    roleCache.delete(String(p.uid));
    await audit(who, "acces", "user", p.uid, `Accès de ${p.name || p.uid} : ${p.access}`);
    return { ok: true };
  },
  async aliases_list(_p, who) {
    adminOnly(who);
    return must(await sb.from("chassis_aliases").select("*").order("created_at", { ascending: false }));
  },
  async alias_delete(p, who) {
    adminOnly(who);
    must(await sb.from("chassis_aliases").delete().eq("alias", String(p.alias)));
    await audit(who, "suppression", "alias", p.alias, `Correspondance de châssis ${p.alias} supprimée`);
    return { ok: true };
  },
  // ---- Sauvegarde complète ----
  async export_all(_p, who) {
    adminOnly(who);
    const [vehicles, stays, imports, parcs, auditRows, aliases, settings] = await Promise.all([
      fetchAll(() => sb.from("vehicles").select("id,chassis,chassis_raw,marque,modele,annee,navire,manifeste,bl,date_arrivee,date_transfert,importateur,mmte_depot_date,mmte_entry_date,current_parc_id,locked_fields,notes,data,created_at,updated_at,deleted_at").order("id"), 200000),
      fetchAll(() => sb.from("v_stays").select(LIST_COLS + ",justif_note,justif_at,valide_at").order("stay_id"), 500000),
      fetchAll(() => sb.from("imports").select("id,parc_id,stock_date,file_name,nb_chassis,nb_entrees,nb_sorties,nb_transferts,is_initial,status,cancel_reason,comment,created_by_name,created_at,parcs(name)").order("id"), 100000),
      must(await sb.from("parcs").select("*").order("name")),
      fetchAll(() => sb.from("audit_log").select("at,by_name,action,entity,entity_id,detail").order("at", { ascending: false }), 100000),
      must(await sb.from("chassis_aliases").select("*")),
      settingsMap(),
    ]);
    await audit(who, "sauvegarde", "export", null, `Sauvegarde complète : ${vehicles.length} véhicules, ${stays.length} mouvements`);
    return { at: new Date().toISOString(), vehicles, stays, imports, parcs, audit: auditRows, aliases, settings };
  },
  // ---- Administration : contrôle total ----
  async vehicle_save(p, who) {
    adminOnly(who);
    const f = pick(p.fields || {}, VEH_FIELDS);
    if (p.id) {
      const before = must(await sb.from("vehicles").select("*").eq("id", Number(p.id)).maybeSingle());
      if (p.fields && p.fields.chassis) f.chassis = String(p.fields.chassis).toUpperCase().replace(/[\s\-\.\/]/g, "");
      must(await sb.from("vehicles").update({ ...f, updated_at: new Date().toISOString() }).eq("id", Number(p.id)));
      await audit(who, "modification", "vehicle", p.id, "Fiche véhicule modifiée", before, f);
      return { id: p.id };
    }
    const chassis = String(p.fields?.chassis || "").toUpperCase().replace(/[\s\-\.\/]/g, "");
    if (!chassis) throw new ApiError("CHASSIS_OBLIGATOIRE");
    const ex = must(await sb.from("vehicles").select("id,current_parc_id").eq("chassis", chassis).maybeSingle()) as any;
    let id = ex?.id;
    if (!id) id = (must(await sb.from("vehicles").insert({ chassis, ...f }).select("id").single()) as any).id;
    else must(await sb.from("vehicles").update({ ...f, deleted_at: null }).eq("id", id));
    if (p.parc_id) {
      must(await sb.from("stays").insert({ vehicle_id: id, parc_id: Number(p.parc_id), entry_date: p.entry_date || today(), entry_kind: "manuel" }));
      await sb.rpc("stock_recompute_current", { p_vehicle_ids: [id] });
    }
    await audit(who, "ajout", "vehicle", id, `Véhicule ${chassis} ajouté manuellement`, null, f);
    return { id };
  },
  async vehicle_delete(p, who) {
    adminOnly(who);
    must(await sb.from("vehicles").update({ deleted_at: new Date().toISOString() }).eq("id", Number(p.id)));
    await audit(who, "suppression", "vehicle", p.id, "Véhicule mis à la corbeille");
    return { ok: true };
  },
  async vehicle_restore(p, who) {
    adminOnly(who);
    must(await sb.from("vehicles").update({ deleted_at: null }).eq("id", Number(p.id)));
    await audit(who, "restauration", "vehicle", p.id, "Véhicule restauré");
    return { ok: true };
  },
  async stay_save(p, who) {
    adminOnly(who);
    const f = pick(p.fields || {}, STAY_FIELDS);
    if (p.id) {
      const before = must(await sb.from("stays").select("*").eq("id", Number(p.id)).maybeSingle()) as any;
      must(await sb.from("stays").update({ ...f, updated_at: new Date().toISOString() }).eq("id", Number(p.id)));
      await sb.rpc("stock_recompute_current", { p_vehicle_ids: [before.vehicle_id] });
      await audit(who, "modification", "vehicle", before.vehicle_id, "Séjour / mouvement modifié", before, f);
      return { id: p.id };
    }
    const r = must(await sb.from("stays").insert({ vehicle_id: Number(p.vehicle_id), entry_kind: "manuel", entry_date: today(), ...f }).select("id").single()) as any;
    await sb.rpc("stock_recompute_current", { p_vehicle_ids: [Number(p.vehicle_id)] });
    await audit(who, "ajout", "vehicle", p.vehicle_id, "Séjour ajouté manuellement", null, f);
    return { id: r.id };
  },
  async stay_delete(p, who) {
    adminOnly(who);
    const st = must(await sb.from("stays").select("vehicle_id").eq("id", Number(p.id)).maybeSingle()) as any;
    must(await sb.from("stays").update({ deleted_at: new Date().toISOString() }).eq("id", Number(p.id)));
    if (st) await sb.rpc("stock_recompute_current", { p_vehicle_ids: [st.vehicle_id] });
    await audit(who, "suppression", "vehicle", st?.vehicle_id, "Mouvement mis à la corbeille");
    return { ok: true };
  },
  async stay_restore(p, who) {
    adminOnly(who);
    const st = must(await sb.from("stays").select("vehicle_id").eq("id", Number(p.id)).maybeSingle()) as any;
    must(await sb.from("stays").update({ deleted_at: null }).eq("id", Number(p.id)));
    if (st) await sb.rpc("stock_recompute_current", { p_vehicle_ids: [st.vehicle_id] });
    await audit(who, "restauration", "vehicle", st?.vehicle_id, "Mouvement restauré");
    return { ok: true };
  },
  async parcs_list(_p, who) {
    adminOnly(who);
    return must(await sb.from("parcs").select("*").order("name"));
  },
  async parc_save(p, who) {
    adminOnly(who);
    const f = pick(p, ["name", "active", "note"]);
    if (f.name) f.name = String(f.name).trim().toUpperCase();
    if (p.id) {
      const before = must(await sb.from("parcs").select("*").eq("id", Number(p.id)).maybeSingle());
      must(await sb.from("parcs").update({ ...f, updated_at: new Date().toISOString() }).eq("id", Number(p.id)));
      await audit(who, "modification", "parc", p.id, `Parc ${f.name || ""}`, before, f);
      return { id: p.id };
    }
    const r = must(await sb.from("parcs").insert(f).select("id").single()) as any;
    await audit(who, "ajout", "parc", r.id, `Parc ${f.name} ajouté`);
    return r;
  },
  async parc_delete(p, who) {
    adminOnly(who);
    must(await sb.from("parcs").update({ deleted_at: new Date().toISOString() }).eq("id", Number(p.id)));
    await audit(who, "suppression", "parc", p.id, "Parc mis à la corbeille");
    return { ok: true };
  },
  async parc_restore(p, who) {
    adminOnly(who);
    must(await sb.from("parcs").update({ deleted_at: null }).eq("id", Number(p.id)));
    await audit(who, "restauration", "parc", p.id, "Parc restauré");
    return { ok: true };
  },
  async settings_save(p, who) {
    adminOnly(who);
    const before = must(await sb.from("settings").select("value").eq("key", String(p.key)).maybeSingle());
    must(await sb.from("settings").upsert({ key: String(p.key), value: p.value, updated_at: new Date().toISOString(), updated_by: who.name }));
    await audit(who, "parametre", "settings", p.key, `Paramètre ${p.key}`, before, { value: p.value });
    return { ok: true };
  },
  async synonym_save(p, who) {
    adminOnly(who);
    if (p.id) must(await sb.from("column_synonyms").update({ field: p.field, synonym: p.synonym }).eq("id", Number(p.id)));
    else must(await sb.from("column_synonyms").upsert({ field: p.field, synonym: p.synonym, created_by: who.name }, { onConflict: "synonym" }));
    await audit(who, "parametre", "synonym", p.id || p.synonym, `Nom de colonne « ${p.synonym} » → ${p.field}`);
    return { ok: true };
  },
  async synonym_delete(p, who) {
    adminOnly(who);
    must(await sb.from("column_synonyms").delete().eq("id", Number(p.id)));
    await audit(who, "suppression", "synonym", p.id, "Nom de colonne supprimé");
    return { ok: true };
  },
  async templates_all(_p, who) {
    adminOnly(who);
    return must(await sb.from("file_templates").select("*,parcs(name)").order("updated_at", { ascending: false }));
  },
  async template_delete(p, who) {
    adminOnly(who);
    must(await sb.from("file_templates").delete().eq("id", Number(p.id)));
    await audit(who, "suppression", "template", p.id, "Modèle de lecture supprimé");
    return { ok: true };
  },
  async audit(p, who) {
    adminOnly(who);
    let q = sb.from("audit_log").select("*");
    if (p.q) q = q.or(`detail.ilike.%${String(p.q).replace(/[%,()]/g, " ")}%,by_name.ilike.%${String(p.q).replace(/[%,()]/g, " ")}%`);
    return must(await q.order("at", { ascending: false }).range(Number(p.offset) || 0, (Number(p.offset) || 0) + (Math.min(Number(p.limit) || 200, 1000)) - 1));
  },
  async trash(_p, who) {
    adminOnly(who);
    const [vehicles, stays, parcs] = await Promise.all([
      sb.from("vehicles").select("id,chassis,marque,modele,deleted_at").not("deleted_at", "is", null).order("deleted_at", { ascending: false }).limit(500),
      sb.from("stays").select("id,vehicle_id,entry_date,exit_date,deleted_at,vehicles(chassis),parcs!stays_parc_id_fkey(name)").not("deleted_at", "is", null).order("deleted_at", { ascending: false }).limit(500),
      sb.from("parcs").select("id,name,deleted_at").not("deleted_at", "is", null),
    ]);
    return { vehicles: must(vehicles), stays: must(stays), parcs: must(parcs) };
  },
  async purge(p, who) {
    adminOnly(who);
    const table = ({ vehicle: "vehicles", stay: "stays", parc: "parcs" } as any)[p.entity];
    if (!table) throw new ApiError("TYPE_INCONNU");
    must(await sb.from(table).delete().eq("id", Number(p.id)).not("deleted_at", "is", null));
    await audit(who, "suppression_definitive", p.entity, p.id, "Supprimé définitivement de la corbeille");
    return { ok: true };
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const who = await identify(req);
    const body = await req.json().catch(() => ({}));
    const fn = actions[String(body.action || "")];
    if (!fn) throw new ApiError("ACTION_INCONNUE");
    const data = await fn(body.params || {}, who);
    return json({ ok: true, data });
  } catch (e) {
    const err = e as ApiError;
    console.error(err?.message || e);
    return json({ ok: false, error: err?.code || err?.message || "ERREUR" }, err?.status || 500);
  }
});
