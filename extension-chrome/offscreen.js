// Page offscreen : reçoit les demandes du service de l'extension et lit MMTE / GUCE sans fenêtre (voir lecture.js)
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.target !== "offscreen") return; // les messages de l'application vont au service de l'extension
  (msg.site === "mmte" ? self.BCL.mmteSearch(msg.chassis) : self.BCL.guceSearch(msg.chassis))
    .then((r) => reply(r), (e) => reply({ etat: "erreur", message: String((e && e.message) || e).slice(0, 200) }));
  return true;
});
