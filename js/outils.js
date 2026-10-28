/* ============================================================
   Outils — Ma Bibliothèque
   - recherche dans toute la bibliothèque (loupe de l'en-tête)
   - ajout d'un livre papier en scannant son code-barres (ISBN)
   ============================================================ */

/* ---------- Recherche globale ---------- */
function etiquetteLivre(l) {
  if (l.statut === "propose") return "Idée";
  if (l.statut === "refuse") return "Idée écartée";
  if (l.support === "envie") return "Envie";
  const sup = l.support === "audible" ? "Audio" : "Papier";
  const etat_ = { lu: "lu", ecoute: "écouté", en_cours: "en cours", a_lire: "à lire", a_ecouter: "à écouter", archive: "archivé" }[l.statut] || "";
  return sup + (etat_ ? " · " + etat_ : "");
}

function ouvrirLivre(l) {
  if (!l) return;
  if (l.statut === "propose" || l.statut === "refuse") {
    ui.ongletIdees = ongletIdee(l);
    ouverts.add(l.id);
    allerA("propositions");
    setTimeout(() => document.querySelector(`[data-act="ouvrir"][data-id="${CSS.escape(l.id)}"]`)?.scrollIntoView({ block: "center" }), 50);
    return;
  }
  if (l.support === "envie") {
    ouverts.add(l.id);
    allerA("envies");
    return;
  }
  voirFiche(l);
}

function rechercheGlobale() {
  ouvrirFenetre(`
    <button class="btn-discret fermer-coin" data-fen-act="fermer" aria-label="Fermer">✕</button>
    <h2>Chercher partout</h2>
    <input id="rg-q" class="recherche" type="search" placeholder="Titre, auteur ou tome…" autocomplete="off" aria-label="Chercher dans toute la bibliothèque">
    <div id="rg-res" class="rg-res"><p class="doux petit">Papier, audio, idées, envies et titres des tomes.</p></div>`, dlg => {
    const champ = dlg.querySelector("#rg-q"), zone = dlg.querySelector("#rg-res");
    const n = s => sansAccents(s);
    const majour = () => {
      const q = champ.value.trim();
      if (q.length < 2) { zone.innerHTML = `<p class="doux petit">Papier, audio, idées, envies et titres des tomes.</p>`; return; }
      const t = n(q);
      const res = etat.livres.filter(l => correspond(l, q)).sort((a, b) => {
        const rang = l => n(l.titre).startsWith(t) ? 0 : n(l.titre).includes(t) ? 1 : n(l.auteur).includes(t) ? 2 : 3;
        return rang(a) - rang(b) || parTitre(a, b);
      }).slice(0, 40);
      zone.innerHTML = res.length ? res.map(l => {
        const tome = !n(l.titre).includes(t) && !n(l.auteur).includes(t) ? (l.tomes || []).findIndex(x => n(x.titre).includes(t)) : -1;
        return `<button class="rg-ligne" data-fen-act="ouvrir" data-id="${esc(l.id)}">
            ${couvertureHTML(l)}
            <span><b>${esc(l.titre)}</b>
              <span class="doux petit">${esc(l.auteur || "")}${l.auteur ? " · " : ""}${esc(etiquetteLivre(l))}</span>
              ${tome >= 0 ? `<span class="rg-tome">Tome ${tome + 1} : ${esc(l.tomes[tome].titre)}${l.tomes[tome].ecoute ? " ✓" : ""}</span>` : ""}
            </span>
          </button>`;
      }).join("") : `<p class="doux">Rien dans ta bibliothèque pour « ${esc(q)} ».</p>`;
      chargerCouvertures(zone);
    };
    champ.addEventListener("input", majour);
    dlg.onclick = ev => {
      const el = ev.target.closest("[data-fen-act]");
      if (!el) return;
      fermerFenetre();
      if (el.dataset.fenAct === "ouvrir") ouvrirLivre(livre(el.dataset.id));
    };
    setTimeout(() => champ.focus(), 50);
  });
}

/* ---------- Scanner un code-barres ---------- */
let fluxCamera = null;
function couperCamera() { if (fluxCamera) { fluxCamera.getTracks().forEach(t => t.stop()); fluxCamera = null; } }

const isbnValide = s => /^(97[89])\d{10}$/.test(s);

async function chercherIsbn(isbn) {
  // Google Books d'abord (éditions françaises bien couvertes), puis Open Library
  try {
    const j = await rechercheGoogle(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&fields=items(volumeInfo(title,subtitle,authors,language,imageLinks))`);
    const v = j.items && j.items[0] && j.items[0].volumeInfo;
    if (v && v.title) return {
      titre: v.title + (v.subtitle ? " : " + v.subtitle : ""), auteur: (v.authors || []).join(", "),
      couverture: v.imageLinks ? (v.imageLinks.thumbnail || "").replace(/^http:/, "https:").replace("&edge=curl", "") : "", isbn
    };
  } catch { /* on passe à Open Library */ }
  const r = await fetch(`https://openlibrary.org/search.json?isbn=${isbn}&fields=title,author_name,cover_i&limit=1`);
  if (r.ok) {
    const d = ((await r.json()).docs || [])[0];
    if (d && d.title) return { titre: d.title, auteur: (d.author_name || []).join(", "), couverture: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : "", isbn };
  }
  return null;
}

function scannerLivre() {
  const peutScanner = "BarcodeDetector" in window && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
  ouvrirFenetre(`
    <button class="btn-discret fermer-coin" data-fen-act="fermer" aria-label="Fermer">✕</button>
    <h2>Scanner un livre</h2>
    ${peutScanner ? `<p class="doux petit" style="margin:0">Vise le code-barres au dos du livre (celui qui commence par 978 ou 979).</p>
      <div class="scan-cadre"><video id="scan-video" playsinline muted></video><span class="scan-viseur" aria-hidden="true"></span></div>`
      : `<p class="doux petit" style="margin:0">Ce navigateur ne sait pas lire les codes-barres : tape le numéro ISBN écrit sous le code-barres.</p>`}
    <form id="scan-form" class="rangee" novalidate>
      <input id="scan-isbn" inputmode="numeric" placeholder="ISBN (13 chiffres)" autocomplete="off" style="flex:1;min-width:0" aria-label="Numéro ISBN">
      <button class="btn-sec" type="submit">Chercher</button>
    </form>
    <p id="scan-etat" class="doux petit" style="margin:0"></p>`, async dlg => {
    const etat_ = t => { const e = dlg.querySelector("#scan-etat"); if (e) e.textContent = t; };
    let fini = false;
    const trouver = async isbn => {
      if (fini) return;
      fini = true;
      couperCamera();
      etat_(`ISBN ${isbn} : recherche…`);
      try {
        const r = await chercherIsbn(isbn);
        if (r) resultatScan(r);
        else { fini = false; etat_(`Aucun livre trouvé pour l'ISBN ${isbn}. Ajoute-le à la main avec « + Livre papier ».`); }
      } catch { fini = false; etat_("Les sites de livres ne répondent pas. Réessaie dans un moment."); }
    };
    dlg.addEventListener("close", couperCamera, { once: true });
    dlg.onclick = ev => { const el = ev.target.closest("[data-fen-act]"); if (el && el.dataset.fenAct === "fermer") fermerFenetre(); };
    dlg.querySelector("#scan-form").addEventListener("submit", ev => {
      ev.preventDefault();
      const s = dlg.querySelector("#scan-isbn").value.replace(/[^0-9]/g, "");
      if (!isbnValide(s)) return etat_("Un ISBN compte 13 chiffres et commence par 978 ou 979.");
      trouver(s);
    });
    if (!peutScanner) return;
    try {
      fluxCamera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      const video = dlg.querySelector("#scan-video");
      video.srcObject = fluxCamera;
      await video.play();
      const detecteur = new BarcodeDetector({ formats: ["ean_13"] });
      const boucle = async () => {
        if (fini || !fluxCamera || !dlg.open) return;
        try {
          const codes = await detecteur.detect(video);
          const bon = codes.map(c => c.rawValue).find(isbnValide);
          if (bon) { if (navigator.vibrate) navigator.vibrate(60); return trouver(bon); }
        } catch { /* image pas prête */ }
        setTimeout(boucle, 250);
      };
      boucle();
    } catch {
      etat_("Pas d'accès à l'appareil photo : autorise-le pour ce site, ou tape l'ISBN.");
    }
  });
}

function resultatScan(r) {
  // déjà dans la bibliothèque ?
  const deja = etat.livres.filter(l => titreCorrespond(l.titre, r.titre) || (l.tomes || []).some(t => titreCorrespond(t.titre, r.titre)));
  const nomScan = sansAccents(String(r.auteur).split(",")[0]).split(" ").pop();
  const series = etat.livres.filter(l => l.support === "papier" && (l.tomes || []).length && nomScan && sansAccents(l.auteur).includes(nomScan));
  const genreDefaut = ["fantasy", "sf", "autre"].includes(ui.vue) ? ui.vue : "fantasy";
  const apercu = { id: "scan-" + r.isbn, titre: r.titre, auteur: r.auteur, couverture: r.couverture };
  ouvrirFenetre(`
    <button class="btn-discret fermer-coin" data-fen-act="fermer" aria-label="Fermer">✕</button>
    <div class="apercu">
      ${couvertureHTML(apercu)}
      <div><div class="apercu-serie">ISBN ${esc(r.isbn)}</div>
        <h2 class="apercu-titre">${esc(r.titre)}</h2>
        <div class="doux">${esc(r.auteur || "Auteur inconnu")}</div></div>
    </div>
    ${deja.length ? `<p class="scan-deja">Déjà dans ta bibliothèque : ${deja.map(l => `<b>${esc(l.titre)}</b> (${esc(etiquetteLivre(l))})`).join(", ")}.</p>` : ""}
    <form id="scan-ajout" style="display:grid;gap:10px" novalidate>
      <div class="champ"><label class="lbl" for="sa-titre">Titre</label><input id="sa-titre" value="${esc(r.titre)}"></div>
      <div class="champ"><label class="lbl" for="sa-auteur">Auteur</label><input id="sa-auteur" value="${esc(r.auteur)}"></div>
      ${series.length ? `<div class="champ"><label class="lbl" for="sa-serie">Ranger dans</label>
        <select id="sa-serie"><option value="">Un nouveau livre</option>${series.map(l => `<option value="${esc(l.id)}">Tome suivant de « ${esc(l.titre)} »</option>`).join("")}</select></div>` : ""}
      <div class="champ"><label class="lbl" for="sa-genre">Genre</label>
        <select id="sa-genre">${Object.entries(GENRES).map(([k, t]) => `<option value="${k}"${k === genreDefaut ? " selected" : ""}>${t}</option>`).join("")}</select></div>
      <div class="actions" style="flex-wrap:wrap">
        <button type="button" class="btn-sec" data-ajout="envie">En envie</button>
        <button type="button" class="btn-sec" data-ajout="a_lire">À lire</button>
        <button type="button" class="btn" data-ajout="lu">Déjà lu</button>
      </div>
    </form>
    <button class="btn-discret" data-fen-act="encore">Scanner un autre livre</button>`, dlg => {
    const val = s => (dlg.querySelector(s) || {}).value || "";
    dlg.onclick = ev => {
      const el = ev.target.closest("[data-fen-act],[data-ajout]");
      if (!el) return;
      if (el.dataset.fenAct === "fermer") return fermerFenetre();
      if (el.dataset.fenAct === "encore") return scannerLivre();
      const choix = el.dataset.ajout, titre = val("#sa-titre").trim();
      if (!titre) return;
      const serie = val("#sa-serie");
      if (serie && choix !== "envie") {
        const l = livre(serie);
        // retirer le tome correspondant des « manquants » ; à défaut de titre identique, le premier (on achète dans l'ordre)
        const manq = [...(l.tomesManquants || [])];
        const idx = manq.findIndex(t => titreCorrespond(t, titre) || sansAccents(t).split(" ")[0] === sansAccents(titre).split(" ")[0]);
        if (manq.length) manq.splice(idx >= 0 ? idx : 0, 1);
        modifier(l.id, { tomes: [...(l.tomes || []), { titre, ecoute: choix === "lu" }], tomesManquants: manq });
        toast(`« ${titre} » ajouté à ${l.titre}.`);
      } else {
        const support = choix === "envie" ? "envie" : "papier";
        const g = val("#sa-genre");
        etat.livres.push({
          id: idDepuisTitre(titre, support), support, statut: choix === "envie" ? "envie" : choix,
          titre, auteur: val("#sa-auteur").trim(), genre: g === "autre" ? "" : g, isbn: r.isbn,
          couverture: r.couverture || undefined, notes: "Ajouté en scannant le code-barres.",
          dateFin: choix === "lu" ? aujourdhui() : undefined, ajoute: maintenant(), maj: maintenant()
        });
        sauvegarder();
        toast(`« ${titre} » ajouté${choix === "envie" ? " à tes envies" : choix === "a_lire" ? " à ta pile à lire" : " à tes lectures"}.`);
      }
      fermerFenetre();
    };
    chargerCouvertures(dlg);
  });
}
