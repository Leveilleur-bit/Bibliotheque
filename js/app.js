/* ============================================================
   Ma Bibliothèque : livres audio Audible, bibliothèque papier,
   envies de lecture et propositions.
   Les données vivent dans le navigateur (localStorage) et se
   synchronisent avec un dépôt GitHub privé (voir sync.js).
   ============================================================ */
"use strict";

const CLE_STOCKAGE = "maBibliotheque";
const CLE_UI = "maBibliothequeUI";
const VERSION_APPLI = "19";   // doit correspondre à version.json

/* ---------- Outils ---------- */

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const maintenant = () => new Date().toISOString();
const dateCourte = d => d ? new Date(String(d).slice(0, 10) + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "2-digit" }) : "";
const estLienAudibleFr = u => /^https:\/\/(www\.)?audible\.fr\//i.test(String(u || "").trim());
const pluriel = (n, mot) => n + " " + mot + (n > 1 ? "s" : "");

function lireJSON(cle) { try { const v = localStorage.getItem(cle); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
function ecrireJSON(cle, valeur) { try { localStorage.setItem(cle, JSON.stringify(valeur)); return true; } catch (e) { return false; } }

function idDepuisTitre(titre, prefixe) {
  const base = String(titre).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "livre";
  let id = prefixe + "-" + base, n = 2;
  while (etat.livres.some(l => l.id === id)) id = prefixe + "-" + base + "-" + n++;
  return id;
}

let minuterieToast = null;
function toast(texte) {
  const t = $("#toast");
  t.textContent = texte;
  t.hidden = false;
  clearTimeout(minuterieToast);
  minuterieToast = setTimeout(() => { t.hidden = true; }, 3200);
}

/* ---------- État ---------- */

function etatVide() { return { format: 1, modifieLe: null, credits: { solde: 0 }, livres: [], exclus: [] }; }

function normaliser(d) {
  const e = Object.assign(etatVide(), d || {});
  e.credits = Object.assign({ solde: 0 }, e.credits);
  e.livres = Array.isArray(e.livres) ? e.livres.filter(l => l && l.id && l.titre) : [];
  e.exclus = Array.isArray(e.exclus) ? e.exclus : [];
  return e;
}

let etat = normaliser(lireJSON(CLE_STOCKAGE));
const ui = Object.assign({ vue: "audible", filtreAudible: "a_ecouter", filtreGenre: "tout", recherche: "" }, lireJSON(CLE_UI) || {});
const ouverts = new Set();
let suppressionEnAttente = null;

function sauverUI() { ecrireJSON(CLE_UI, { vue: ui.vue, filtreAudible: ui.filtreAudible, filtreGenre: ui.filtreGenre }); }

// À appeler après chaque changement fait par l'utilisateur
function sauvegarder() {
  etat.modifieLe = maintenant();
  if (!ecrireJSON(CLE_STOCKAGE, etat)) toast("Impossible d'enregistrer sur cet appareil : la mémoire du navigateur est pleine ou bloquée.");
  rendre();
  if (typeof planifierSynchro === "function") planifierSynchro();
}

// Remplace tout l'état (synchro ou import), sans relancer de synchro
function adopterEtat(d) {
  etat = normaliser(d);
  ecrireJSON(CLE_STOCKAGE, etat);
  rendre();
}

const livre = id => etat.livres.find(l => l.id === id);
function modifier(id, champs) {
  const l = livre(id);
  if (!l) return;
  Object.assign(l, champs, { maj: maintenant() });
  sauvegarder();
}

/* ---------- Libellés ---------- */

const FILTRES_AUDIBLE = [
  ["a_ecouter", "À écouter"],
  ["en_cours", "En cours"],
  ["ecoute", "Écouté"]
];
const TITRES_VUES = { accueil: "Ma Bibliothèque", audible: "Audible", fantasy: "Fantasy", sf: "Science-fiction", autre: "Autres lectures", envies: "Envies", propositions: "Propositions", reglages: "Réglages" };
const GENRES = { fantasy: "Fantasy", sf: "Science-fiction", autre: "Autres lectures" };
const genreDe = l => l.genre === "fantasy" || l.genre === "sf" ? l.genre : "autre";
const FILTRES_GENRE = [
  ["tout", "Tout"],
  ["audio", "Écouté"],
  ["papier", "Lu (papier)"],
  ["avenir", "À venir"]
];
// Range un livre dans un des filtres des onglets Fantasy / SF
// Nombre de livres réellement écoutés ou lus : chaque tome coché compte.
// Un livre sans liste de tomes compte pour 1 s'il est terminé.
function livresFinis(l) {
  const tomes = Array.isArray(l.tomes) ? l.tomes : [];
  if (tomes.length) return tomes.filter(t => t.ecoute).length;
  return l.statut === "ecoute" || l.statut === "lu" ? 1 : 0;
}
const totalFinis = liste => liste.reduce((n, l) => n + livresFinis(l), 0);

// Unités terminées (un tome coché, ou un livre sans tomes), avec une clé de titre
// pour reconnaître le même livre écouté ET lu en papier.
const cleTitre = t => String(t || "").replace(/\(.*?\)/g, " ").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function unitesFinies(liste) {
  const u = [];
  for (const l of liste) {
    const tomes = Array.isArray(l.tomes) ? l.tomes : [];
    if (tomes.length) tomes.filter(t => t.ecoute).forEach(t => u.push({ cle: cleTitre(t.titre), genre: genreDe(l) }));
    else if (l.statut === "ecoute" || l.statut === "lu") u.push({ cle: cleTitre(l.titre), genre: genreDe(l) });
  }
  return u;
}
const memeLivre = (a, b) => a === b;   // titre exact (sans accents ni parenthèses)
// Lectures uniques : un livre écouté et lu en papier ne compte qu'une fois
function lecturesUniques(audio, papier) {
  const doublons = papier.filter(p => audio.some(a => memeLivre(a.cle, p.cle)));
  return { total: audio.length + papier.length - doublons.length, doublons, papierSeul: papier.filter(p => !doublons.includes(p)) };
}

function categorieGenre(l) {
  // Les propositions restent dans l'onglet Idées
  if (l.statut === "propose" || l.statut === "refuse" || l.statut === "archive") return null;
  if (l.support === "audible") return l.statut === "ecoute" ? "audio" : "avenir";
  if (l.support === "papier") return l.statut === "lu" ? "papier" : "avenir";
  if (l.support === "envie") return "avenir";
  return null;
}
const FORMATS_ENVIE = { audio: "En audio", papier: "En papier", indifferent: "Audio ou papier" };

/* ---------- Carte d'un livre ---------- */

function carteLivre(l) {
  const ouvert = ouverts.has(l.id);
  const tomes = Array.isArray(l.tomes) ? l.tomes : [];
  const faits = tomes.filter(t => t.ecoute).length;
  const motTome = l.support === "papier" ? "lu" : "écouté";
  const meta = [l.auteur, l.narrateur ? "lu par " + l.narrateur : "", l.conseillePar ? "conseillé par " + l.conseillePar : ""].filter(Boolean).map(esc).join(" · ");

  const pastilles = [];
  if (["fantasy", "sf", "autre"].includes(ui.vue)) {
    const sup = { audible: "Audio", papier: "Papier", envie: "Envie" }[l.support];
    if (sup && l.statut !== "propose") pastilles.push(`<span class="pastille support">${sup}</span>`);
  }
  if (l.statut === "propose" && l.axe) pastilles.push(`<span class="pastille accent">${l.rang ? "n°" + l.rang + " · " : ""}${esc(l.axe)}</span>`);
  if (l.support === "audible" && l.statut !== "propose" && l.statut !== "refuse") {
    pastilles.push(l.verifieFR
      ? `<span class="pastille ok">FR vérifié${l.dateVerif ? " · " + esc(dateCourte(l.dateVerif)) : ""}</span>`
      : `<span class="pastille alerte">Non vérifié FR</span>`);
  }
  if (l.support === "envie") pastilles.push(`<span class="pastille neutre">${esc(FORMATS_ENVIE[l.formatVoulu] || FORMATS_ENVIE.indifferent)}</span>`);
  if (tomes.length) pastilles.push(`<span class="pastille neutre">${faits}/${pluriel(tomes.length, "tome")}</span>`);
  if (l.achat === "credit") pastilles.push(`<span class="pastille neutre">1 crédit</span>`);
  if (l.gaspille) pastilles.push(`<span class="pastille alerte">${esc(l.raison || "crédit gaspillé")}</span>`);
  if (l.rembourse) pastilles.push(`<span class="pastille ok">remboursé</span>`);
  if (l.lien) pastilles.push(`<a class="petit" href="${esc(l.lien)}" target="_blank" rel="noopener">Fiche Audible</a>`);

  const panneau = !ouvert ? "" : `
    <div class="tomes">
      ${tomes.length ? tomes.map((t, i) => `
        <div class="tome${t.ecoute ? " fait" : ""}">
          <span class="num">T${i + 1}</span>
          <label><input type="checkbox" data-act="tome" data-id="${esc(l.id)}" data-i="${i}"${t.ecoute ? " checked" : ""}><span>${esc(t.titre)}</span></label>
          <button class="btn-discret" data-act="tome-suppr" data-id="${esc(l.id)}" data-i="${i}" aria-label="Retirer le tome ${i + 1}">✕</button>
        </div>`).join("") : `<p class="doux petit" style="margin:0">Aucun tome renseigné. Ajoute-les dans l'ordre de la série, cochés quand ils sont ${motTome}s.</p>`}
      <form class="ajout-tome" data-id="${esc(l.id)}">
        <input id="tome-${esc(l.id)}" placeholder="Titre du tome ${tomes.length + 1}" aria-label="Titre du tome suivant" autocomplete="off">
        <button class="btn-sec" type="submit">Ajouter</button>
      </form>
      ${l.tomesSource ? `<p class="doux petit" style="margin:0">${esc(l.tomesSource)}</p>` : ""}
    </div>`;

  const etoiles = (l.statut === "ecoute" || l.statut === "lu") ? `
    <div class="etoiles" aria-label="Ma note">
      ${[1, 2, 3, 4, 5].map(n => `<button data-act="note" data-n="${n}" data-id="${esc(l.id)}" class="${(l.note || 0) >= n ? "on" : ""}" aria-label="${n} sur 5">★</button>`).join("")}
      ${l.dateFin ? `<span class="doux petit">&nbsp;fini le ${esc(dateCourte(l.dateFin))}</span>` : ""}
    </div>` : "";

  const suppr = suppressionEnAttente === l.id
    ? `<span class="rangee petit">Retirer ce livre ? <button class="btn-sec" data-act="suppr-oui" data-id="${esc(l.id)}">Oui, retirer</button><button class="btn-discret" data-act="suppr-non">Annuler</button></span>`
    : `<button class="btn-discret" data-act="suppr" data-id="${esc(l.id)}">Retirer</button>`;

  return `
    <article class="livre">
      <button class="livre-tete" data-act="ouvrir" data-id="${esc(l.id)}" aria-expanded="${ouvert}">
        <span><span class="livre-titre">${esc(l.titre)}</span>${meta ? `<span class="livre-meta">${meta}</span>` : ""}</span>
        <span class="chevron" aria-hidden="true">▶</span>
      </button>
      ${pastilles.length ? `<div class="rangee">${pastilles.join("")}</div>` : ""}
      ${noteSiteHTML(l)}
      ${l.notes ? `<p class="livre-notes">${esc(l.notes)}</p>` : ""}
      ${panneau}
      ${etoiles}
      <div class="rangee">${actionsLivre(l)}<button class="btn-discret" data-act="modifier" data-id="${esc(l.id)}">Modifier</button>${suppr}</div>
    </article>`;
}

// Note des lecteurs relevée sur un site d'avis (Babelio), affichée en étoiles partielles
function noteSiteHTML(l) {
  const n = l.noteSite;
  if (!n || typeof n.valeur !== "number") return "";
  const v = Math.max(0, Math.min(5, n.valeur));
  const val = v.toFixed(2).replace(".", ",");
  return `<div class="note-site">
      <span class="etoiles-site" style="--v:${v}" role="img" aria-label="${val} sur 5">★★★★★</span>
      <span><b>${val}</b>/5 sur ${n.lien ? `<a href="${esc(n.lien)}" target="_blank" rel="noopener">${esc(n.source || "Babelio")}</a>` : esc(n.source || "")}${n.nombre ? ` · ${esc(n.nombre)} notes` : ""}${n.ouvrage ? ` · ${esc(n.ouvrage)}` : ""}</span>
    </div>`;
}

function actionsLivre(l) {
  const id = esc(l.id);
  const solde = etat.credits.solde || 0;
  if (l.support === "audible") {
    if (l.statut === "propose") return `
      <button class="btn" data-act="valider" data-id="${id}">Je l'ajoute à écouter</button>
      <button class="btn-sec" data-act="deja-lu" data-id="${id}">Déjà lu</button>
      <button class="btn-discret" data-act="refuser" data-id="${id}">Pas pour moi</button>`;
    if (l.statut === "refuse") return `<button class="btn-sec" data-act="remettre" data-id="${id}">Remettre en proposition</button>`;
    let a = "";
    if (l.statut === "a_ecouter") {
      if (l.achat !== "credit") a += `<button class="btn" data-act="acheter" data-id="${id}"${l.verifieFR && solde > 0 ? "" : " disabled"} title="${l.verifieFR ? (solde > 0 ? "" : "Plus de crédit disponible") : "Vérifie la langue avant d'acheter"}">Utiliser 1 crédit</button>`;
      a += `<button class="btn-sec" data-act="commencer" data-id="${id}">Commencer</button>`;
    } else if (l.statut === "en_cours") {
      a += `<button class="btn" data-act="terminer" data-id="${id}">Terminé</button>`;
    }
    if (l.achat === "credit" && !l.gaspille) a += `<button class="btn-discret" data-act="gaspille" data-id="${id}">Crédit gaspillé</button>`;
    return a;
  }
  if (l.support === "papier") {
    return l.statut === "a_lire" ? `<button class="btn" data-act="lu" data-id="${id}">Lu</button>` : "";
  }
  if (l.support === "envie") return `
    <button class="btn" data-act="valider" data-id="${id}">À écouter sur Audible</button>
    <button class="btn-sec" data-act="achete-papier" data-id="${id}">Acheté en papier</button>
    <button class="btn-sec" data-act="envie-lue" data-id="${id}">Déjà lu</button>`;
  return "";
}

function listeHTML(livres, messageVide) {
  return livres.length ? `<div class="liste">${livres.map(carteLivre).join("")}</div>` : `<div class="vide">${messageVide}</div>`;
}
const parMaj = (a, b) => String(b.maj || "").localeCompare(String(a.maj || ""));
const parTitre = (a, b) => a.titre.localeCompare(b.titre, "fr", { sensitivity: "base" });

function filtresHTML(liste, actif, nomAct, compter) {
  return `<div class="filtres" role="group">${liste.map(([cle, libelle]) =>
    `<button data-act="${nomAct}" data-f="${cle}" aria-pressed="${cle === actif}">${libelle}<span class="n">${compter(cle) || ""}</span></button>`).join("")}</div>`;
}

/* ---------- Vues ---------- */

function vueAudible() {
  const audible = etat.livres.filter(l => l.support === "audible");
  const achetes = audible.filter(l => l.achat === "credit");
  const compter = s => audible.filter(l => l.statut === s).length;
  const affiches = audible.filter(l => l.statut === ui.filtreAudible).sort(ui.filtreAudible === "ecoute" ? parTitre : parMaj);
  const vides = {
    a_ecouter: "Rien en attente. Ajoute un titre une fois sa fiche audible.fr vérifiée en français, ou valide une proposition.",
    en_cours: "Aucune écoute en cours.",
    ecoute: "Rien de terminé pour l'instant."
  };
  const journal = achetes.slice().sort((a, b) => String(b.dateAchat || "").localeCompare(String(a.dateAchat || "")));
  return `
    <section class="credits" aria-label="Crédits Audible">
      <div><div class="lbl">Crédits dispo</div><div class="chiffre">${etat.credits.solde || 0}</div></div>
      <div style="display:grid;gap:10px;min-width:0">
        <div class="rangee">
          <button class="btn-sec" data-act="credit" data-d="-1" aria-label="Retirer un crédit">−1</button>
          <button class="btn-sec" data-act="credit" data-d="1" aria-label="Ajouter un crédit">+1</button>
          <span class="doux petit">Ajuste quand ton crédit mensuel tombe.</span>
        </div>
        <div class="stats">
          <span><b>${achetes.length}</b> <span class="doux">dépensés</span></span>
          <span><b>${achetes.filter(l => l.gaspille && !l.rembourse).length}</b> <span class="doux">gaspillés</span></span>
          <span><b>${totalFinis(audible.filter(l => l.statut === "ecoute" || l.statut === "en_cours"))}</b> <span class="doux">livres écoutés</span></span>
        </div>
      </div>
    </section>
    <section class="section">
      ${filtresHTML(FILTRES_AUDIBLE, ui.filtreAudible, "filtre-audible", compter)}
      ${listeHTML(affiches, vides[ui.filtreAudible])}
      <div><button class="btn-sec" data-act="ajouter" data-type="audible">+ Ajouter un livre audio</button></div>
    </section>
    <details class="repli section">
      <summary>Journal des crédits</summary>
      <div class="journal">${journal.length ? journal.map(l => `
        <div class="journal-ligne">
          <span class="d">${esc(dateCourte(l.dateAchat))}</span>
          <span class="t">${esc(l.titre)}${l.gaspille ? ` <span class="pastille alerte">${esc(l.raison || "gaspillé")}</span>` : ""}${l.rembourse ? ` <span class="pastille ok">remboursé</span>` : ""}</span>
          <span>${l.gaspille && !l.rembourse ? `<button class="btn-sec" data-act="rembourse" data-id="${esc(l.id)}">Remboursé</button>` : "−1"}</span>
        </div>`).join("") : `<div class="journal-ligne"><span class="t doux">Aucun crédit enregistré.</span></div>`}</div>
    </details>`;
}

function correspond(l, q) {
  if (!q) return true;
  const n = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const t = n(q);
  return n(l.titre).includes(t) || n(l.auteur).includes(t) || (l.tomes || []).some(x => n(x.titre).includes(t));
}


/* ---------- Accueil ---------- */

function vueAccueil() {
  const L = etat.livres;
  const ecouteFini = l => l.support === "audible" && (l.statut === "ecoute" || l.statut === "en_cours");
  const luFini = l => l.support === "papier" && l.statut === "lu";
  const uAudio = unitesFinies(L.filter(ecouteFini));
  const uPapier = unitesFinies(L.filter(luFini));
  const { total, doublons, papierSeul } = lecturesUniques(uAudio, uPapier);
  const ecoutes = uAudio.length, lus = uPapier.length;
  const parGenre = g => uAudio.filter(u => u.genre === g).length + papierSeul.filter(u => u.genre === g).length;
  const genres = [["fantasy", "Fantasy", "var(--accent)"], ["sf", "SF", "#8fc8e8"], ["autre", "Autres", "#b9a58a"]]
    .map(([g, t, c]) => ({ g, t, c, n: parGenre(g) })).filter(x => x.n);
  const pct = n => total ? (n / total * 100) : 0;

  const enCours = L.filter(l => l.support === "audible" && l.statut === "en_cours");
  const idee = L.filter(l => l.statut === "propose").sort((a, b) => (a.rang ?? 99) - (b.rang ?? 99))[0];
  const aEcouter = L.filter(l => l.support === "audible" && l.statut === "a_ecouter");
  const pile = L.filter(l => l.support === "papier" && l.statut === "a_lire");
  const envies = L.filter(l => l.support === "envie");
  // la pile à lire mène au genre où elle est la plus fournie
  const genrePile = ["fantasy", "sf", "autre"].sort((x, y) => pile.filter(l => genreDe(l) === y).length - pile.filter(l => genreDe(l) === x).length)[0];
  const titres = liste => liste.slice(0, 3).map(l => `<i>${esc(l.titre)}</i>`).join(", ") + (liste.length > 3 ? "…" : "");

  return `
    <section class="accueil-tete">
      <div class="lbl">Lectures terminées</div>
      <div class="accueil-total">${total}</div>
      <p>${ecoutes} écouté${ecoutes > 1 ? "s" : ""} sur Audible · ${lus} lu${lus > 1 ? "s" : ""} en papier${doublons.length ? `<br><span class="doux petit">${doublons.length} à la fois écouté${doublons.length > 1 ? "s" : ""} et lu${doublons.length > 1 ? "s" : ""}, comptés une fois</span>` : ""}</p>
    </section>

    <section class="carte accueil-bloc">
      <div class="section-titre"><h2>Par genre</h2><span class="doux petit">tomes compris</span></div>
      <div class="barre-genres" role="img" aria-label="${genres.map(x => x.t + " " + x.n).join(", ")}">
        ${genres.map(x => `<span style="width:${pct(x.n)}%;background:${x.c}"></span>`).join("")}
      </div>
      <div class="legende-genres">
        ${genres.map(x => `<button class="legende" data-act="aller" data-vue="${x.g}"><span class="pastille-couleur" style="background:${x.c}"></span>${x.t}<b>${x.n}</b><span class="doux">${Math.round(pct(x.n))} %</span></button>`).join("")}
      </div>
    </section>

    <section class="carte accueil-bloc">
      <div class="section-titre"><h2>En ce moment</h2><button class="btn-discret" data-act="aller" data-vue="audible">Audible ›</button></div>
      ${enCours.length ? enCours.map(l => `
        <div class="accueil-ligne">
          <span class="accueil-icone" aria-hidden="true">▶</span>
          <div><b>${esc(l.titre)}</b>${l.auteur ? `<div class="doux petit">${esc(l.auteur)}</div>` : ""}${l.notes ? `<div class="doux petit">${esc(l.notes)}</div>` : ""}</div>
        </div>`).join("") : `<p class="doux">Aucune écoute en cours.</p>`}
      <div class="accueil-ligne">
        <span class="accueil-icone" aria-hidden="true">◆</span>
        <div><b>${pluriel(etat.credits.solde || 0, "crédit")} Audible</b> <span class="doux petit">disponible${(etat.credits.solde || 0) > 1 ? "s" : ""}</span></div>
      </div>
    </section>

    ${idee ? `
    <section class="carte accueil-bloc">
      <div class="section-titre"><h2>Prochaine idée</h2><button class="btn-discret" data-act="aller" data-vue="propositions">Toutes ›</button></div>
      <div><b class="accueil-idee">${esc(idee.titre)}</b>${idee.auteur ? `<div class="doux petit">${esc(idee.auteur)}${idee.axe ? " · " + esc(idee.axe) : ""}</div>` : ""}</div>
      ${noteSiteHTML(idee)}
    </section>` : ""}

    <section class="carte accueil-bloc">
      <div class="section-titre"><h2>Ce qui t'attend</h2></div>
      <button class="accueil-ligne lien-ligne" data-act="aller" data-vue="audible" data-filtre="a_ecouter">
        <span class="accueil-nb">${aEcouter.length}</span>
        <div><b>à écouter</b>${aEcouter.length ? `<div class="doux petit">${titres(aEcouter)}</div>` : ""}</div>
      </button>
      <button class="accueil-ligne lien-ligne" data-act="aller" data-vue="${genrePile}" data-genre-filtre="avenir">
        <span class="accueil-nb">${pile.length}</span>
        <div><b>dans ta pile à lire</b>${pile.length ? `<div class="doux petit">${titres(pile)}</div>` : ""}</div>
      </button>
      <button class="accueil-ligne lien-ligne" data-act="aller" data-vue="envies">
        <span class="accueil-nb">${envies.length}</span>
        <div><b>envie${envies.length > 1 ? "s" : ""} notée${envies.length > 1 ? "s" : ""}</b>${envies.length ? `<div class="doux petit">${titres(envies)}</div>` : `<div class="doux petit">Note les livres qu'on te conseille.</div>`}</div>
      </button>
    </section>`;
}

function vueEnvies() {
  const envies = etat.livres.filter(l => l.support === "envie").sort(parMaj);
  return `
    <p class="intro">Ce que tu veux lire ou écouter un jour, et les livres qu'on t'a conseillés. Claude s'en sert pour ses propositions.</p>
    ${listeHTML(envies, "Aucune envie notée. Ajoute le prochain livre qu'on te recommande, avec le nom de la personne.")}
    <div><button class="btn" data-act="ajouter" data-type="envie">+ Noter une envie</button></div>`;
}

function vuePropositions() {
  const props = etat.livres.filter(l => l.statut === "propose").sort((a, b) => (a.rang ?? 99) - (b.rang ?? 99));
  const refusees = etat.livres.filter(l => l.statut === "refuse").sort(parMaj);
  return `
    <p class="intro">Les idées de Claude pour ta prochaine écoute, classées. La langue française se confirme sur la fiche audible.fr avant de valider.</p>
    ${listeHTML(props, "Aucune proposition en attente. Demande à Claude ta prochaine écoute : il ajoutera ses idées ici.")}
    ${refusees.length ? `
      <details class="repli section">
        <summary>Écartées (${refusees.length})</summary>
        <div class="liste">${refusees.map(carteLivre).join("")}</div>
      </details>` : ""}`;
}

function livresGenre(genre) {
  return etat.livres.filter(l => genreDe(l) === genre && categorieGenre(l)
    && (ui.filtreGenre === "tout" || categorieGenre(l) === ui.filtreGenre) && correspond(l, ui.recherche)).sort(parTitre);
}
const messageVideGenre = total => ui.recherche ? "Aucun livre ne correspond à ta recherche."
  : total ? "Rien dans ce filtre." : "Aucun livre rangé dans ce genre pour l'instant. Ajoute-en un, ou choisis le genre d'un livre avec « Modifier ».";

function vueGenre(genre) {
  const livres = etat.livres.filter(l => genreDe(l) === genre && categorieGenre(l));
  const compter = f => f === "tout" ? livres.length : livres.filter(l => categorieGenre(l) === f).length;
  const affiches = livresGenre(genre);
  const n = f => compter(f);
  const ecoutes = totalFinis(livres.filter(l => l.support === "audible" && (l.statut === "ecoute" || l.statut === "en_cours")));
  const lus = totalFinis(livres.filter(l => l.support === "papier" && l.statut === "lu"));
  return `
    <section class="genre-tete">
      <h2>${GENRES[genre]}</h2>
      <p>${ecoutes} livre${ecoutes > 1 ? "s" : ""} écouté${ecoutes > 1 ? "s" : ""} · ${lus} lu${lus > 1 ? "s" : ""} en papier · ${n("avenir")} à venir</p>
    </section>
    <section class="section">
      ${filtresHTML(FILTRES_GENRE, ui.filtreGenre, "filtre-genre", compter)}
      <input class="recherche" id="recherche-genre" type="search" placeholder="Chercher un titre ou un auteur" value="${esc(ui.recherche)}" aria-label="Chercher dans ${GENRES[genre]}" autocomplete="off">
      <div id="liste-genre">${listeHTML(affiches, messageVideGenre(livres.length))}</div>
      <div class="rangee">
        <button class="btn" data-act="ajouter" data-type="papier">+ Livre papier</button>
        <button class="btn-sec" data-act="ajouter" data-type="audible">+ Livre audio</button>
      </div>
    </section>`;
}

function vueReglages() {
  const nb = s => etat.livres.filter(l => l.support === s).length;
  return `
    ${typeof carteSynchroHTML === "function" ? carteSynchroHTML() : ""}
    <section class="carte">
      <h2>Sauvegarde</h2>
      <p class="doux">${pluriel(nb("audible"), "livre")} audio, ${pluriel(nb("papier"), "livre")} papier, ${pluriel(nb("envie"), "envie")}.</p>
      <div class="rangee">
        <button class="btn-sec" data-act="exporter">Télécharger une sauvegarde</button>
        <label class="btn-sec" for="import-fichier" style="display:inline-flex;align-items:center">Restaurer un fichier</label>
        <input id="import-fichier" type="file" accept="application/json,.json" hidden>
      </div>
    </section>
    <section class="carte">
      <h2>À propos</h2>
      <p class="doux">Version installée : ${VERSION_APPLI} · publiée : <span id="num-version">…</span>. Code : <a href="https://github.com/Leveilleur-bit/Bibliotheque" target="_blank" rel="noopener">Leveilleur-bit/Bibliotheque</a>.</p>
    </section>`;
}

function rendre() {
  const vue = $("#vue");
  const vues = { accueil: vueAccueil, audible: vueAudible, fantasy: () => vueGenre("fantasy"), sf: () => vueGenre("sf"), autre: () => vueGenre("autre"), envies: vueEnvies, propositions: vuePropositions, reglages: vueReglages };
  vue.innerHTML = (vues[ui.vue] || vueAccueil)();
  const genre = ["fantasy", "sf", "autre"].includes(ui.vue) ? ui.vue : null;
  // Fond d'ambiance : chaque onglet a le sien
  document.body.dataset.fond = genre || { accueil: "accueil", envies: "autre", propositions: "idees", reglages: "reglages" }[ui.vue] || "audible";
  vue.classList.add("sur-image");
  $("#titre-vue").textContent = ui.vue === "audible" ? "Audible" : TITRES_VUES[ui.vue];
  document.querySelectorAll(".barre button").forEach(b => b.setAttribute("aria-current", b.dataset.vue === ui.vue ? "page" : "false"));
  $("#btn-reglages").setAttribute("aria-pressed", String(ui.vue === "reglages"));
  if (ui.vue === "reglages") {
    if (typeof brancherSynchro === "function") brancherSynchro(vue);
    fetch("version.json", { cache: "no-store" }).then(r => r.json()).then(v => { const s = $("#num-version"); if (s) s.textContent = v.version + " (" + v.date + ")"; }).catch(() => {});
  }
}
function rendreReglages() { if (ui.vue === "reglages") rendre(); }

function allerA(vue) {
  if (ui.vue !== vue) ui.recherche = "";
  ui.vue = vue;
  suppressionEnAttente = null;
  sauverUI();
  rendre();
  window.scrollTo(0, 0);
}

/* ---------- Fenêtres ---------- */

function ouvrirFenetre(html, init) {
  const dlg = $("#fenetre");
  dlg.innerHTML = `<div class="fenetre-int">${html}</div>`;
  if (init) init(dlg);
  if (!dlg.open) dlg.showModal();
}
function fermerFenetre() { const dlg = $("#fenetre"); if (dlg.open) dlg.close(); }

function formulaireLivre({ type, l }) {
  const edition = !!l;
  const support = edition ? l.support : type;
  const titres = { audible: "Livre audio", papier: "Livre papier", envie: "Envie de lecture" };
  const statutChamp = support === "audible" ? `
      <div class="champ"><label class="lbl" for="f-statut">Où le ranger</label>
        <select id="f-statut">${[["a_ecouter", "À écouter"], ["en_cours", "En cours"], ["ecoute", "Écouté"], ["propose", "Proposition"], ["refuse", "Écartée"], ["archive", "Archivé"]].map(([v, t]) => `<option value="${v}"${(edition ? l.statut : "a_ecouter") === v ? " selected" : ""}>${t}</option>`).join("")}</select></div>`
    : support === "papier" ? `
      <div class="champ"><label class="lbl" for="f-statut">Où le ranger</label>
        <select id="f-statut"><option value="lu"${!edition || l.statut === "lu" ? " selected" : ""}>Lu</option><option value="a_lire"${edition && l.statut === "a_lire" ? " selected" : ""}>À lire (je l'ai, pas encore lu)</option></select></div>` : "";
  const v = k => esc(edition ? l[k] || "" : "");
  const genreDefaut = edition ? genreDe(l) : (ui.vue === "sf" || ui.vue === "autre" ? ui.vue : "fantasy");
  ouvrirFenetre(`
    <h2>${edition ? "Modifier" : "Ajouter"} : ${titres[support]}</h2>
    <form id="f-livre" novalidate style="display:grid;gap:12px">
      <div class="champ"><label class="lbl" for="f-titre">Titre${support === "audible" ? " (tel qu'affiché sur audible.fr)" : ""}</label><input id="f-titre" value="${v("titre")}" required autocomplete="off"></div>
      <div class="champ"><label class="lbl" for="f-auteur">Auteur</label><input id="f-auteur" value="${v("auteur")}" autocomplete="off"></div>
      <div class="champ"><label class="lbl" for="f-genre">Genre</label>
        <select id="f-genre">${Object.entries(GENRES).map(([k, t]) => `<option value="${k}"${genreDefaut === k ? " selected" : ""}>${t}</option>`).join("")}</select></div>
      ${support === "audible" ? `
        <div class="champ"><label class="lbl" for="f-narr">Lu par</label><input id="f-narr" value="${v("narrateur")}" autocomplete="off"></div>
        <div class="champ"><label class="lbl" for="f-lien">Lien de la fiche audible.fr</label><input id="f-lien" inputmode="url" value="${v("lien")}" placeholder="https://www.audible.fr/pd/…" autocomplete="off"></div>` : ""}
      ${support === "envie" ? `
        <div class="champ"><label class="lbl" for="f-conseil">Conseillé par</label><input id="f-conseil" value="${v("conseillePar")}" placeholder="Un ami, un collègue, une vidéo…" autocomplete="off"></div>
        <div class="champ"><label class="lbl" for="f-format">Comment le lire</label>
          <select id="f-format">${Object.entries(FORMATS_ENVIE).map(([k, t]) => `<option value="${k}"${(edition ? l.formatVoulu || "indifferent" : "indifferent") === k ? " selected" : ""}>${t}</option>`).join("")}</select></div>` : ""}
      ${statutChamp}
      <div class="champ"><label class="lbl" for="f-notes">Notes</label><textarea id="f-notes">${v("notes")}</textarea></div>
      ${support === "audible" ? `
        <label class="case" for="f-verif"><input type="checkbox" id="f-verif"${edition && l.verifieFR ? " checked" : ""}><span>J'ai ouvert la fiche sur audible.fr : <strong>langue = Français</strong> et le narrateur est francophone.</span></label>` : ""}
      <p class="erreur" id="f-erreur" hidden></p>
      <div class="actions">
        <button type="button" class="btn-discret" id="f-annuler">Annuler</button>
        <button type="submit" class="btn">${edition ? "Enregistrer" : "Ajouter"}</button>
      </div>
    </form>`, dlg => {
    dlg.querySelector("#f-annuler").addEventListener("click", fermerFenetre);
    dlg.querySelector("#f-livre").addEventListener("submit", ev => {
      ev.preventDefault();
      const val = id => { const el = dlg.querySelector(id); return el ? el.value.trim() : ""; };
      const erreur = msg => { const e = dlg.querySelector("#f-erreur"); e.textContent = msg; e.hidden = false; };
      const titre = val("#f-titre");
      if (!titre) return erreur("Indique le titre.");
      const champs = { titre, auteur: val("#f-auteur"), notes: val("#f-notes") };
      const g = val("#f-genre");
      champs.genre = g === "autre" ? "" : g;
      if (support === "audible") {
        const verif = dlg.querySelector("#f-verif").checked;
        Object.assign(champs, { narrateur: val("#f-narr"), lien: val("#f-lien"), statut: val("#f-statut") });
        if (champs.lien && !estLienAudibleFr(champs.lien)) return erreur("Le lien doit être une fiche audible.fr.");
        if (champs.statut === "a_ecouter" && !verif) return erreur("Coche la vérification : « À écouter » n'accepte que des titres confirmés en français.");
        if (champs.statut === "a_ecouter" && !champs.lien) return erreur("Colle le lien de la fiche audible.fr, pour pouvoir revérifier plus tard.");
        champs.verifieFR = verif;
        if (verif && !(edition && l.verifieFR)) champs.dateVerif = aujourdhui();
      }
      if (support === "papier") champs.statut = val("#f-statut");
      if (support === "envie") Object.assign(champs, { conseillePar: val("#f-conseil"), formatVoulu: val("#f-format") });
      if (edition) {
        modifier(l.id, champs);
      } else {
        const prefixe = { audible: "audio", papier: "papier", envie: "envie" }[support];
        etat.livres.push(Object.assign({ id: idDepuisTitre(titre, prefixe), support, statut: support === "envie" ? "envie" : champs.statut, ajoute: maintenant(), maj: maintenant() }, champs));
        if (support === "audible") ui.filtreAudible = ["a_ecouter", "en_cours", "ecoute"].includes(champs.statut) ? champs.statut : ui.filtreAudible;
        sauverUI();
        sauvegarder();
        toast("« " + titre + " » ajouté.");
      }
      fermerFenetre();
    });
  });
}

// Passage vers « À écouter » : la langue doit être vérifiée sur la fiche
function fenetreValidation(l) {
  ouvrirFenetre(`
    <h2>Ajouter à écouter</h2>
    <p class="doux" style="margin:0">« ${esc(l.titre)} » n'entre dans ta liste qu'une fois sa version française confirmée.</p>
    <form id="f-valid" novalidate style="display:grid;gap:12px">
      <div class="champ"><label class="lbl" for="v-lien">Lien de la fiche audible.fr</label><input id="v-lien" inputmode="url" value="${esc(estLienAudibleFr(l.lien) && /\/pd\//.test(l.lien) ? l.lien : "")}" placeholder="https://www.audible.fr/pd/…" autocomplete="off"></div>
      ${l.lien && !/\/pd\//.test(l.lien) ? `<p class="doux petit" style="margin:0">Point de départ : <a href="${esc(l.lien)}" target="_blank" rel="noopener">la page trouvée par Claude</a>. Ouvre le bon tome et colle le lien de sa fiche.</p>` : ""}
      <label class="case" for="v-verif"><input type="checkbox" id="v-verif"><span>J'ai ouvert la fiche : <strong>langue = Français</strong> et le narrateur est francophone.</span></label>
      <p class="erreur" id="v-erreur" hidden></p>
      <div class="actions">
        <button type="button" class="btn-discret" id="v-annuler">Annuler</button>
        <button type="submit" class="btn">Ajouter à écouter</button>
      </div>
    </form>`, dlg => {
    dlg.querySelector("#v-annuler").addEventListener("click", fermerFenetre);
    dlg.querySelector("#f-valid").addEventListener("submit", ev => {
      ev.preventDefault();
      const lien = dlg.querySelector("#v-lien").value.trim();
      const err = msg => { const e = dlg.querySelector("#v-erreur"); e.textContent = msg; e.hidden = false; };
      if (!estLienAudibleFr(lien)) return err("Colle le lien de la fiche sur audible.fr.");
      if (!dlg.querySelector("#v-verif").checked) return err("Coche la vérification de la langue.");
      modifier(l.id, { support: "audible", statut: "a_ecouter", lien, verifieFR: true, dateVerif: aujourdhui() });
      ui.filtreAudible = "a_ecouter";
      sauverUI();
      fermerFenetre();
      toast("« " + l.titre + " » est dans À écouter.");
    });
  });
}

/* ---------- Actions ---------- */

function changerSolde(delta) {
  etat.credits.solde = Math.max(0, (etat.credits.solde || 0) + delta);
}

function agir(btn) {
  const act = btn.dataset.act, id = btn.dataset.id, l = id ? livre(id) : null;
  switch (act) {
    case "ouvrir": ouverts.has(id) ? ouverts.delete(id) : ouverts.add(id); rendre(); return;
    case "filtre-audible": ui.filtreAudible = btn.dataset.f; sauverUI(); rendre(); return;
    case "aller":
      if (btn.dataset.filtre) ui.filtreAudible = btn.dataset.filtre;
      if (btn.dataset.genreFiltre) ui.filtreGenre = btn.dataset.genreFiltre;
      allerA(btn.dataset.vue);
      return;
    case "filtre-genre": ui.filtreGenre = btn.dataset.f; sauverUI(); rendre(); return;
    case "ajouter": formulaireLivre({ type: btn.dataset.type }); return;
    case "modifier": if (l) formulaireLivre({ l }); return;
    case "credit": changerSolde(+btn.dataset.d); sauvegarder(); return;
    case "suppr": suppressionEnAttente = id; rendre(); return;
    case "suppr-non": suppressionEnAttente = null; rendre(); return;
    case "suppr-oui":
      suppressionEnAttente = null;
      etat.livres = etat.livres.filter(x => x.id !== id);
      sauvegarder();
      toast("Livre retiré.");
      return;
    case "exporter": exporter(); return;
  }
  if (!l) return;
  switch (act) {
    case "tome": {
      const tomes = (l.tomes || []).map(t => ({ ...t }));
      tomes[+btn.dataset.i].ecoute = btn.checked;
      modifier(id, { tomes });
      return;
    }
    case "tome-suppr": modifier(id, { tomes: (l.tomes || []).filter((_, i) => i !== +btn.dataset.i) }); return;
    case "note": modifier(id, { note: +btn.dataset.n === l.note ? 0 : +btn.dataset.n }); return;
    case "acheter":
      if (!l.verifieFR || (etat.credits.solde || 0) < 1) return;
      changerSolde(-1);
      modifier(id, { achat: "credit", dateAchat: aujourdhui() });
      toast("1 crédit utilisé pour « " + l.titre + " ».");
      return;
    case "commencer": modifier(id, { statut: "en_cours", dateDebut: aujourdhui() }); ui.filtreAudible = "en_cours"; sauverUI(); rendre(); return;
    case "terminer": modifier(id, { statut: "ecoute", dateFin: aujourdhui() }); toast("Bravo, « " + l.titre + " » est terminé."); return;
    case "gaspille": modifier(id, { gaspille: true, raison: "crédit gaspillé" }); return;
    case "rembourse": changerSolde(1); modifier(id, { rembourse: true }); toast("Crédit rendu au solde."); return;
    case "lu": modifier(id, { statut: "lu", dateFin: aujourdhui() }); return;
    case "valider": fenetreValidation(l); return;
    case "refuser": modifier(id, { statut: "refuse" }); toast("Écartée : Claude ne la reproposera pas."); return;
    case "remettre": modifier(id, { statut: "propose" }); return;
    case "deja-lu":
      modifier(id, { axe: "Redécouverte", notes: "Déjà lu. " + (l.notes || "") });
      toast("Marqué déjà lu : la proposition passe en redécouverte.");
      return;
    case "achete-papier": modifier(id, { support: "papier", statut: "a_lire" }); toast("Rangé dans ta pile à lire."); return;
    case "envie-lue": modifier(id, { support: "papier", statut: "lu", dateFin: aujourdhui() }); toast("Rangé dans tes livres lus."); return;
  }
}

function exporter() {
  const blob = new Blob([JSON.stringify(etat, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "bibliotheque-" + aujourdhui() + ".json";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function importer(fichier) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(String(r.result));
      if (!d || !Array.isArray(d.livres)) throw new Error("format");
      adopterEtat(d);
      etat.modifieLe = maintenant();
      ecrireJSON(CLE_STOCKAGE, etat);
      if (typeof planifierSynchro === "function") planifierSynchro();
      toast("Sauvegarde restaurée : " + pluriel(etat.livres.length, "livre") + ".");
    } catch (e) { toast("Ce fichier n'est pas une sauvegarde de Ma Bibliothèque."); }
  };
  r.readAsText(fichier);
}

/* ---------- Mise à jour de l'appli ---------- */

// Compare la version installée à celle publiée sur GitHub Pages ;
// si elle a changé, on vide les caches et on recharge une seule fois.
async function verifierMiseAJour() {
  try {
    const r = await fetch("version.json?t=" + Date.now(), { cache: "no-store" });
    const v = await r.json();
    if (String(v.version) === VERSION_APPLI) return;
    if (sessionStorage.getItem("maj-tentee") === v.version) return;   // pas de boucle
    sessionStorage.setItem("maj-tentee", v.version);
    toast("Nouvelle version " + v.version + " : mise à jour…");
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update().catch(() => {});
    }
    if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
    setTimeout(() => location.reload(), 600);
  } catch (e) { /* hors ligne : on réessaiera */ }
}

/* ---------- Branchements ---------- */

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".barre button").forEach(b => b.addEventListener("click", () => allerA(b.dataset.vue)));
  $("#btn-reglages").addEventListener("click", () => allerA(ui.vue === "reglages" ? "accueil" : "reglages"));

  const vue = $("#vue");
  vue.addEventListener("click", ev => {
    const el = ev.target.closest("[data-act]");
    if (el && vue.contains(el)) agir(el);
  });
  vue.addEventListener("submit", ev => {
    const f = ev.target.closest("form.ajout-tome");
    if (!f) return;
    ev.preventDefault();
    const l = livre(f.dataset.id), champ = f.querySelector("input"), titre = champ.value.trim();
    if (!l || !titre) return;
    modifier(l.id, { tomes: [...(l.tomes || []), { titre, ecoute: false }] });
    const nouveau = document.getElementById("tome-" + l.id);
    if (nouveau) nouveau.focus();
  });
  vue.addEventListener("input", ev => {
    if (ev.target.id !== "recherche-genre") return;
    ui.recherche = ev.target.value;
    const total = etat.livres.filter(l => genreDe(l) === ui.vue && categorieGenre(l)).length;
    $("#liste-genre").innerHTML = listeHTML(livresGenre(ui.vue), messageVideGenre(total));
  });
  vue.addEventListener("change", ev => {
    if (ev.target.id === "import-fichier" && ev.target.files[0]) importer(ev.target.files[0]);
  });
  $("#fenetre").addEventListener("click", ev => { if (ev.target === ev.currentTarget) fermerFenetre(); });

  ui.vue = "accueil";   // l'appli s'ouvre toujours sur l'accueil
  rendre();
  setTimeout(verifierMiseAJour, 1500);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") verifierMiseAJour(); });
});
