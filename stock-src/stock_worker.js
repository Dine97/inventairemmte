// ---------------- Lecture des fichiers Excel en arrière-plan ----------------
// Fichier exécuté dans un « Web Worker » : l'ouverture et la lecture d'un gros fichier (12 000 véhicules et plus)
// ne bloquent plus l'écran. Le classeur reste ici ; la page ne reçoit que les premières lignes et le résultat de la lecture.
importScripts("https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js");
/*@@PARSER@@*/
const STK_BOOKS = new Map();
const STK_HEAD = 150; // lignes envoyées à la page pour l'aperçu, le choix de la ligne d'en-tête et la reconnaissance du parc
self.onmessage = (e) => {
  const { id, op, key } = e.data || {};
  const reply = (o) => self.postMessage(Object.assign({ id }, o));
  try {
    if (op === "open" || op === "rows") {
      reply({ progress: { phase: "ouverture" } });
      // « rows » : tableau déjà extrait (fichier PDF), une feuille par tableau
      const book = op === "rows" ? { SheetNames: Object.keys(e.data.sheets), Sheets: Object.fromEntries(Object.entries(e.data.sheets).map(([n, r]) => [n, { __rows: r }])) }
        : XLSX.read(e.data.buf, { cellDates: true, type: "array" });
      const head = {};
      book.SheetNames.forEach((n, i) => {
        reply({ progress: { phase: "onglets", done: i, total: book.SheetNames.length } });
        const ws = book.Sheets[n];
        const rows = ws.__rows || stkSheetRows(ws);
        ws.__rows = rows;
        const h = rows.slice(0, STK_HEAD);
        head[n] = { rows: h, offset: rows.offset || 0, total: rows.length };
      });
      STK_BOOKS.set(key, book);
      reply({ ok: { SheetNames: book.SheetNames, head } });
    } else if (op === "parse") {
      // Plusieurs fichiers d'un même parc : leurs feuilles sont réunies (nom affiché « fichier › feuille »)
      const keys = e.data.keys || [key];
      let book;
      if (keys.length === 1) { book = STK_BOOKS.get(keys[0]); if (!book) throw new Error("fichier fermé, sélectionnez-le à nouveau"); }
      else {
        book = { SheetNames: [], Sheets: {} };
        keys.forEach((k, i) => {
          const b = STK_BOOKS.get(k);
          if (!b) throw new Error("fichier fermé, sélectionnez-le à nouveau");
          const pre = (e.data.prefixes || [])[i] || ("Fichier " + (i + 1));
          b.SheetNames.forEach((n) => { const nn = pre + " › " + n; book.SheetNames.push(nn); book.Sheets[nn] = b.Sheets[n]; });
        });
      }
      stkProgress = (done, total, sheet) => reply({ progress: { phase: "lignes", done, total, sheet } });
      const res = stkParseWorkbook(book, e.data.opts || {});
      stkProgress = null;
      reply({ ok: res });
    } else if (op === "close") {
      STK_BOOKS.delete(key);
      reply({ ok: true });
    } else throw new Error("opération inconnue : " + op);
  } catch (err) {
    stkProgress = null;
    reply({ err: String((err && err.message) || err) });
  }
};
