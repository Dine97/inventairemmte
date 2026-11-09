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
    if (op === "open") {
      reply({ progress: { phase: "ouverture" } });
      const book = XLSX.read(e.data.buf, { cellDates: true, type: "array" });
      const head = {};
      book.SheetNames.forEach((n, i) => {
        reply({ progress: { phase: "onglets", done: i, total: book.SheetNames.length } });
        const ws = book.Sheets[n];
        const rows = stkSheetRows(ws);
        ws.__rows = rows;
        const h = rows.slice(0, STK_HEAD);
        head[n] = { rows: h, offset: rows.offset || 0, total: rows.length };
      });
      STK_BOOKS.set(key, book);
      reply({ ok: { SheetNames: book.SheetNames, head } });
    } else if (op === "parse") {
      const book = STK_BOOKS.get(key);
      if (!book) throw new Error("fichier fermé, sélectionnez-le à nouveau");
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
