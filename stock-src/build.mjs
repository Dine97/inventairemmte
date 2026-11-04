// Reconstruit le module « Suivi des stocks » et l'injecte dans index.html.
// Usage (depuis la racine du dépôt) :  npm i --no-save esbuild  puis  node stock-src/build.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { transformSync } from "esbuild";
const dir = new URL(".", import.meta.url).pathname;
const files = ["parser.js", "stock_core.jsx", "stock_views.jsx", "stock_import_admin.jsx", "stock_v2.jsx"];
const src = files.map((f) => readFileSync(dir + f, "utf8")).join("\n");
const { code } = transformSync(src, { loader: "jsx", jsxFactory: "React.createElement", jsxFragment: "React.Fragment", target: "es2019", charset: "utf8" });
const htmlPath = dir + "../index.html";
const html = readFileSync(htmlPath, "utf8");
const A = "/* STOCK-MODULE-DEBUT (généré depuis stock-src, ne pas modifier ici) */\n", B = "\n/* STOCK-MODULE-FIN */";
const i = html.indexOf(A), j = html.indexOf(B);
if (i < 0 || j < 0) throw new Error("Marqueurs du module introuvables dans index.html");
writeFileSync(htmlPath, html.slice(0, i + A.length) + code + html.slice(j));
console.log("Module stock reconstruit :", (code.length / 1024).toFixed(0), "Ko");
