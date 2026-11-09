// Construction de l'application INVENTAIRE MMTE & Suivi des stocks.
//
//   npm ci           (une seule fois)
//   node build.mjs   → index.html, lib/stock.js, lib/app.css
//   node build.mjs --check  → vérifie que les fichiers publiés correspondent aux sources (utilisé par GitHub Actions)
//
// Sources :
//   src/index.template.html  page HTML (en-tête, bibliothèques)
//   src/inventaire.js        application Inventaire (JavaScript lisible)
//   stock-src/stock_boot.jsx partie légère du suivi des stocks (chargée avec la page)
//   stock-src/*.jsx          reste du module, chargé à la demande (lib/stock.js)
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transformSync } from "esbuild";

const root = new URL(".", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");
const check = process.argv.includes("--check");
const JSX = { loader: "jsx", jsxFactory: "React.createElement", jsxFragment: "React.Fragment", target: "es2019", charset: "utf8" };

// 1. Partie légère du module stock, insérée dans l'application
const boot = transformSync(read("stock-src/stock_boot.jsx"), JSX).code;
let app = read("src/inventaire.js");
const A = "/* STOCK-MODULE-DEBUT (généré depuis stock-src, ne pas modifier ici) */\n", B = "\n/* STOCK-MODULE-FIN */";
const i = app.indexOf(A), j = app.indexOf(B);
if (i < 0 || j < 0) throw new Error("Marqueurs du module introuvables dans src/inventaire.js");
app = app.slice(0, i + A.length) + boot + app.slice(j);
const version = (/const APP_VERSION = "([^"]+)"/.exec(app) || [])[1];
if (!version) throw new Error("APP_VERSION introuvable");

const sw = read("service-worker.js");
if (!sw.includes(`lib/app.css?v=${version}`) || !sw.includes(`lib/stock.js?v=${version}`))
  throw new Error(`service-worker.js : mettez la liste APP_SHELL à la version ${version} (lib/app.css?v=… et lib/stock.js?v=…) et changez CACHE_NAME`);

// 2. Module complet, isolé dans sa propre portée et chargé à la demande
const MODULE_FILES = ["parser.js", "stock_core.jsx", "stock_views.jsx", "stock_import_admin.jsx", "stock_v2.jsx", "stock_v3.jsx", "stock_v4.jsx", "stock_v5.jsx", "stock_v6.jsx", "stock_v7.jsx", "stock_v8.jsx", "stock_v9.jsx"];
const modSrc = MODULE_FILES.map((f) => read("stock-src/" + f)).join("\n");
const mod = transformSync(
  `(function () {\n"use strict";\n${modSrc}\nwindow.STK = { StkApp, StkInvStockSource, StkAccountTools, stkMergeInventoryLists };\n})();\n`,
  { ...JSX, minify: true, legalComments: "none" }
).code;
const stockJs = `/* Suivi des stocks MMTE ${version} — fichier généré depuis stock-src/, ne pas modifier */\n` + mod;

// 2 bis. Lecteur de fichiers Excel en arrière-plan (Web Worker)
const workerJs = `/* Suivi des stocks MMTE ${version} — lecteur en arrière-plan, généré depuis stock-src/, ne pas modifier */\n` +
  transformSync(read("stock-src/stock_worker.js").replace("/*@@PARSER@@*/", () => read("stock-src/parser.js")), { loader: "js", target: "es2019", charset: "utf8", minify: true, legalComments: "none" }).code;
if (!sw.includes(`lib/stock-worker.js?v=${version}`)) throw new Error(`service-worker.js : ajoutez "./lib/stock-worker.js?v=${version}" à APP_SHELL`);

// 3. Page
const html = read("src/index.template.html").replace("/*@@APP@@*/", () => app).replaceAll("@@VERSION@@", version);

// 4. Styles Tailwind générés une fois pour toutes (au lieu du script Tailwind en ligne)
const tmp = mkdtempSync(join(tmpdir(), "mmte-"));
writeFileSync(join(tmp, "app.js"), app);
writeFileSync(join(tmp, "stock.js"), modSrc);
writeFileSync(join(tmp, "page.html"), html);
writeFileSync(join(tmp, "in.css"), "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n");
writeFileSync(join(tmp, "tailwind.config.cjs"), `module.exports = { content: [${JSON.stringify(join(tmp, "*.{js,html}"))}], theme: { extend: {} } };\n`);
execFileSync(join(root, "node_modules/.bin/tailwindcss"), ["-c", join(tmp, "tailwind.config.cjs"), "-i", join(tmp, "in.css"), "-o", join(tmp, "app.css"), "--minify"], { stdio: "pipe" });
const css = `/* INVENTAIRE MMTE ${version} — styles générés (Tailwind CSS 3), ne pas modifier */\n` + readFileSync(join(tmp, "app.css"), "utf8");
rmSync(tmp, { recursive: true, force: true });

const outputs = { "index.html": html, "lib/stock.js": stockJs, "lib/stock-worker.js": workerJs, "lib/app.css": css };
if (check) {
  const diff = Object.entries(outputs).filter(([p, c]) => { try { return read(p) !== c; } catch { return true; } }).map(([p]) => p);
  if (diff.length) { console.error("Fichiers publiés différents des sources : " + diff.join(", ") + "\nLancez « node build.mjs » puis validez le résultat."); process.exit(1); }
  console.log("OK : les fichiers publiés correspondent aux sources (version " + version + ").");
} else {
  for (const [p, c] of Object.entries(outputs)) writeFileSync(join(root, p), c);
  console.log(`Version ${version} : index.html ${(html.length / 1024).toFixed(0)} Ko, lib/stock.js ${(stockJs.length / 1024).toFixed(0)} Ko, lib/stock-worker.js ${(workerJs.length / 1024).toFixed(0)} Ko, lib/app.css ${(css.length / 1024).toFixed(0)} Ko`);
}
