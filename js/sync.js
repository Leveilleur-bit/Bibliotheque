/* ============================================================
   Ma Bibliothèque — synchronisation avec GitHub
   Les données vivent dans un dépôt GitHub PRIVÉ
   (« bibliotheque-donnees », fichier bibliotheque.json).
   Chaque appareil garde une copie locale et se met à jour à
   l'ouverture et quelques secondes après chaque changement.
   Claude lit et complète le même fichier entre deux sessions.
   Même principe que l'appli Mon Potager. Chargé après app.js.
   ============================================================ */
"use strict";

const CLE_SYNCHRO = "maBibliothequeSync";
const CLE_AVANT_SYNCHRO = "maBibliothequeAvantSynchro";
const FICHIER_DONNEES = "bibliotheque.json";
const API_GITHUB = "https://api.github.com";
const FORMAT_DEPOT = /^[\w.-]+\/[\w.-]+$/;
const DEPOT_PAR_DEFAUT = "Leveilleur-bit/bibliotheque-donnees";

const syncEtat = { enCours: false, statut: "inactif", message: "", minuterie: null, dernierEssai: 0 };

function lireSynchro() { return lireJSON(CLE_SYNCHRO); }
function ecrireSynchro(valeur) {
  if (valeur) ecrireJSON(CLE_SYNCHRO, valeur);
  else { try { localStorage.removeItem(CLE_SYNCHRO); } catch (e) { /* rien */ } }
}
function synchroActive() { const s = lireSynchro(); return !!(s && s.depot && s.jeton); }
function nettoyerDepot(v) { return String(v || "").trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/\/+$/, ""); }

/* ---------- Bouton de l'en-tête ---------- */

function definirStatut(statut, message = "") {
  syncEtat.statut = statut;
  syncEtat.message = message;
  majBoutonSynchro();
}
function majBoutonSynchro() {
  const b = document.getElementById("btn-synchro");
  if (!b) return;
  b.hidden = !synchroActive();
  b.dataset.etat = syncEtat.statut;
  const titres = {
    ok: "Synchronisé avec GitHub",
    attente: "Des changements attendent d'être envoyés : touche pour synchroniser",
    encours: "Synchronisation en cours…",
    erreur: "Erreur de synchronisation : touche pour réessayer",
    inactif: "Synchroniser avec GitHub"
  };
  const titre = syncEtat.message || titres[syncEtat.statut] || titres.inactif;
  b.title = titre;
  b.setAttribute("aria-label", titre);
}

/* ---------- API GitHub ---------- */

async function github(chemin, options = {}, cfg = lireSynchro()) {
  const { permettre404, ...opts } = options;
  let r;
  try {
    r = await fetch(API_GITHUB + chemin, {
      cache: "no-store", ...opts,
      headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + cfg.jeton, ...(opts.headers || {}) }
    });
  } catch (e) { throw new Error("reseau"); }
  if (r.status === 404 && permettre404) return null;
  if (!r.ok) throw new Error("github-" + r.status);
  return r;
}
const cheminContenu = (cfg, chemin) => `/repos/${cfg.depot}/contents/${chemin.split("/").map(encodeURIComponent).join("/")}`;

function texteVersBase64(texte) {
  const octets = new TextEncoder().encode(texte);
  let bin = "";
  for (let i = 0; i < octets.length; i += 0x8000) bin += String.fromCharCode.apply(null, octets.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function lireFichier(chemin, cfg = lireSynchro()) {
  const r = await github(cheminContenu(cfg, chemin), { permettre404: true }, cfg);
  if (!r) return null;
  const j = await r.json();
  let texte;
  if (j.content && j.encoding === "base64") {
    const bin = atob(j.content.replace(/\s/g, ""));
    texte = new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  } else {
    const brut = await github(cheminContenu(cfg, chemin), { headers: { Accept: "application/vnd.github.raw+json" } }, cfg);
    texte = await brut.text();
  }
  return { sha: j.sha, texte };
}
async function ecrireFichier(chemin, base64, message, sha = null, cfg = lireSynchro()) {
  const corps = { message, content: base64 };
  if (sha) corps.sha = sha;
  await github(cheminContenu(cfg, chemin), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) }, cfg);
}

/* ---------- Cycle de synchronisation ---------- */

const etatEstVierge = () => !etat.livres.length;
const resume = d => {
  const l = Array.isArray(d.livres) ? d.livres : [];
  const n = s => l.filter(x => x.support === s).length;
  return `${n("audible")} audio, ${n("papier")} papier, ${n("envie")} envies`;
};

// Résume ce qui a changé, pour un message de commit lisible par Claude
function messageCommit(avant, apres) {
  const ids = d => new Map((d && Array.isArray(d.livres) ? d.livres : []).map(l => [l.id, l]));
  const a = ids(avant), b = ids(apres);
  const ajoutes = [...b.keys()].filter(k => !a.has(k)).map(k => b.get(k).titre);
  const retires = [...a.keys()].filter(k => !b.has(k)).map(k => a.get(k).titre);
  const modifies = [...b.keys()].filter(k => a.has(k) && JSON.stringify(a.get(k)) !== JSON.stringify(b.get(k))).map(k => b.get(k).titre);
  const parts = [];
  const liste = t => t.slice(0, 4).join(", ") + (t.length > 4 ? "…" : "");
  if (ajoutes.length) parts.push("ajout : " + liste(ajoutes));
  if (modifies.length) parts.push("modif : " + liste(modifies));
  if (retires.length) parts.push("retrait : " + liste(retires));
  if (avant && avant.credits && apres.credits && avant.credits.solde !== apres.credits.solde) parts.push("crédits : " + apres.credits.solde);
  return "Depuis l'appli — " + (parts.join(" ; ") || "mise à jour");
}

function demanderConflit(distant) {
  return new Promise(resolve => {
    let choisi = false;
    const dlg = document.getElementById("fenetre");
    dlg.addEventListener("close", () => { if (!choisi) resolve(null); }, { once: true });
    ouvrirFenetre(`
      <h2>Deux versions différentes</h2>
      <p style="margin:0">Ta bibliothèque a changé sur cet appareil <strong>et</strong> sur GitHub (peut-être une mise à jour de Claude). Laquelle garder ?</p>
      <div class="liste">
        <div class="carte"><strong>Cet appareil</strong><span class="doux">${esc(resume(etat))}</span></div>
        <div class="carte"><strong>GitHub</strong><span class="doux">${esc(resume(distant))}</span></div>
      </div>
      <p class="doux petit" style="margin:0">La version non choisie est remplacée, mais GitHub garde l'historique de toutes les versions. Si tu gardes GitHub, la version de cet appareil reste récupérable dans les réglages.</p>
      <div class="actions">
        <button class="btn-discret" id="cf-plus-tard">Plus tard</button>
        <button class="btn-sec" id="cf-local">Garder cet appareil</button>
        <button class="btn" id="cf-distant">Garder GitHub</button>
      </div>`, fen => {
      const fin = valeur => { choisi = true; fermerFenetre(); resolve(valeur); };
      fen.querySelector("#cf-local").addEventListener("click", () => fin("envoyer"));
      fen.querySelector("#cf-distant").addEventListener("click", () => fin("recevoir"));
      fen.querySelector("#cf-plus-tard").addEventListener("click", () => fin(null));
    });
  });
}

function recevoirDonnees(donnees) {
  if (!etatEstVierge()) ecrireJSON(CLE_AVANT_SYNCHRO, etat);
  adopterEtat(donnees);
}

async function cycleSynchro() {
  const s = lireSynchro();
  const distant = await lireFichier(FICHIER_DONNEES);
  const donneesDistantes = distant ? JSON.parse(distant.texte) : null;
  const derniere = s.versionSynchro || null;
  const locale = etat.modifieLe || null;
  const vierge = etatEstVierge();
  const changementLocal = !vierge && (locale !== derniere || derniere === null);
  const versionDistante = donneesDistantes ? donneesDistantes.modifieLe || null : null;
  const changementDistant = !!donneesDistantes && versionDistante !== derniere;

  let action;
  if (!donneesDistantes) action = vierge ? "rien" : "envoyer";
  else if (vierge) action = "recevoir";
  else if (!changementLocal && !changementDistant) action = "rien";
  else if (changementLocal && !changementDistant) action = "envoyer";
  else if (!changementLocal && changementDistant) action = "recevoir";
  else if (versionDistante && versionDistante === locale) action = "rien";
  else action = await demanderConflit(donneesDistantes);
  if (!action) return "reporté";

  if (action === "recevoir") {
    recevoirDonnees(donneesDistantes);
    ecrireSynchro({ ...lireSynchro(), versionSynchro: versionDistante });
    return "reçu";
  }
  if (action === "envoyer") {
    if (!etat.modifieLe) { etat.modifieLe = new Date().toISOString(); ecrireJSON(CLE_STOCKAGE, etat); }
    const version = etat.modifieLe;
    await ecrireFichier(FICHIER_DONNEES, texteVersBase64(JSON.stringify(etat, null, 1)), messageCommit(donneesDistantes, etat), distant ? distant.sha : null);
    ecrireSynchro({ ...lireSynchro(), versionSynchro: version });
    return "envoyé";
  }
  if (donneesDistantes) ecrireSynchro({ ...lireSynchro(), versionSynchro: versionDistante || locale });
  return "à jour";
}

function messageErreur(e) {
  const m = String(e && e.message || e);
  if (m === "reseau") return "Pas de réseau : la synchronisation reprendra plus tard.";
  if (m === "github-401") return "GitHub refuse le jeton : il est faux ou a expiré. Crée-en un nouveau et colle-le dans les réglages.";
  if (m === "github-403") return "Le jeton n'a pas le droit d'écrire dans ce dépôt : donne-lui la permission « Contents : Read and write ».";
  if (m === "github-404") return "Dépôt introuvable : vérifie son nom (propriétaire/dépôt) et que le jeton y a bien accès.";
  if (m === "github-409" || m === "github-422") return "Le fichier a changé sur GitHub pendant l'envoi : réessaie, je récupérerai d'abord la dernière version.";
  if (/github-/.test(m)) return "GitHub a répondu par une erreur (" + m.replace("github-", "") + ").";
  if (m.includes("JSON")) return "Le fichier bibliotheque.json sur GitHub est mal formé : demande à Claude de le réparer.";
  return "La synchronisation a échoué (" + m + ").";
}

async function synchroniser({ manuel = false } = {}) {
  if (!synchroActive() || syncEtat.enCours) return;
  clearTimeout(syncEtat.minuterie);
  syncEtat.enCours = true;
  syncEtat.dernierEssai = Date.now();
  definirStatut("encours");
  try {
    const resultat = await cycleSynchro();
    if (resultat === "reporté") { definirStatut("attente", "Conflit non résolu : touche pour choisir."); return; }
    ecrireSynchro({ ...lireSynchro(), derniereSynchro: new Date().toISOString() });
    definirStatut("ok");
    if (manuel) toast(resultat === "reçu" ? "Bibliothèque mise à jour depuis GitHub." : resultat === "envoyé" ? "Changements envoyés sur GitHub." : "Déjà à jour.");
    else if (resultat === "reçu") toast("Bibliothèque mise à jour depuis GitHub.");
  } catch (e) {
    definirStatut("erreur", messageErreur(e));
    if (manuel) toast(messageErreur(e));
  } finally {
    syncEtat.enCours = false;
    rendreReglages();
  }
}

// Appelée par sauvegarder() après chaque modification
function planifierSynchro() {
  if (!synchroActive()) return;
  clearTimeout(syncEtat.minuterie);
  definirStatut("attente");
  syncEtat.minuterie = setTimeout(() => synchroniser(), 4000);
}

/* ---------- Réglages ---------- */

function carteSynchroHTML() {
  const s = lireSynchro();
  const actif = synchroActive();
  const derniere = s && s.derniereSynchro ? new Date(s.derniereSynchro) : null;
  const avant = !!lireJSON(CLE_AVANT_SYNCHRO);
  const statut = syncEtat.enCours ? "Synchronisation en cours…"
    : syncEtat.statut === "erreur" ? "⚠️ " + syncEtat.message
    : syncEtat.statut === "attente" ? "Des changements attendent d'être envoyés."
    : derniere ? "✓ À jour." : "Pas encore synchronisé.";
  return `
    <section class="carte" id="rg-synchro">
      <h2>Synchronisation GitHub</h2>
      ${actif ? `
        <p class="doux">Ta bibliothèque est rangée dans <strong>${esc(s.depot)}</strong>. L'appli s'y met à jour à l'ouverture et quelques secondes après chaque changement. Claude lit et complète le même fichier.</p>
        <p class="petit">${esc(statut)}${derniere ? " Dernière synchronisation : " + esc(derniere.toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })) + "." : ""}</p>
        <div class="rangee">
          <button class="btn" id="sy-lancer"${syncEtat.enCours ? " disabled" : ""}>Synchroniser maintenant</button>
          <button class="btn-discret" id="sy-verifier">Vérifier la configuration</button>
          ${avant ? `<button class="btn-discret" id="sy-avant">Retrouver la version d'avant la dernière réception</button>` : ""}
          <button class="btn-discret" id="sy-deconnecter">Arrêter sur cet appareil</button>
        </div>
        <div id="sy-diag" class="diag" aria-live="polite"></div>`
      : `
        <p class="doux">Pour retrouver ta bibliothèque sur tous tes appareils et laisser Claude la compléter, l'appli range tes données dans ton dépôt GitHub privé.</p>
        <div class="champ"><label class="lbl" for="sy-depot">Dépôt des données</label>
          <input id="sy-depot" type="text" autocomplete="off" spellcheck="false" autocapitalize="off" value="${esc((s && s.depot) || DEPOT_PAR_DEFAUT)}"></div>
        <div class="champ"><label class="lbl" for="sy-jeton">Jeton d'accès GitHub</label>
          <input id="sy-jeton" type="password" autocomplete="off" spellcheck="false" autocapitalize="off" placeholder="github_pat_…"></div>
        <div class="rangee">
          <button class="btn" id="sy-enregistrer">Enregistrer et synchroniser</button>
          <button class="btn-discret" id="sy-verifier">Vérifier</button>
        </div>
        <div id="sy-diag" class="diag" aria-live="polite"></div>
        <details class="repli" open>
          <summary>Créer le jeton (une seule fois)</summary>
          <ol class="etapes">
            <li>Ouvre la page de <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener"><strong>création de jeton « fine-grained »</strong></a> : nom « Bibliothèque », expiration d'un an.</li>
            <li><em>Repository access</em> → <strong>Only select repositories</strong> → <code>bibliotheque-donnees</code> uniquement.</li>
            <li><em>Permissions → Repository permissions</em> : <strong>Contents</strong> sur <strong>Read and write</strong>, puis <strong>Generate token</strong>.</li>
            <li>Copie le jeton (il commence par <code>github_pat_</code>) et colle-le ici.</li>
          </ol>
          <p class="doux petit">Le jeton reste sur cet appareil et ne donne accès qu'à ce dépôt. Ne le colle jamais ailleurs, pas même dans une conversation. Si ton téléphone est perdu, supprime le jeton sur GitHub.</p>
        </details>`}
    </section>`;
}

async function diagnostiquerSynchro(zone) {
  const sortie = zone.querySelector("#sy-diag");
  const enreg = lireSynchro() || {};
  const champDepot = zone.querySelector("#sy-depot"), champJeton = zone.querySelector("#sy-jeton");
  const depot = nettoyerDepot((champDepot && champDepot.value) || enreg.depot);
  const jeton = String((champJeton && champJeton.value) || enreg.jeton || "").trim();
  const cfg = { depot, jeton };
  const etapes = [];
  const dessiner = enCours => {
    sortie.innerHTML = etapes.map(e => `<div class="diag-ligne ${e.ok ? "ok" : "ko"}"><span>${e.ok ? "✓" : "✗"}</span><div><strong>${esc(e.titre)}</strong>${e.aide ? `<div class="petit doux">${esc(e.aide)}</div>` : ""}</div></div>`).join("")
      + (enCours ? `<div class="diag-ligne"><span>…</span><div>${esc(enCours)}</div></div>` : "");
  };
  const ajouter = (ok, titre, aide) => { etapes.push({ ok, titre, aide }); dessiner(); return ok; };
  if (!ajouter(FORMAT_DEPOT.test(depot), "Nom du dépôt", FORMAT_DEPOT.test(depot) ? depot : "Écris-le sous la forme propriétaire/nom, par exemple " + DEPOT_PAR_DEFAUT + ".")) return;
  if (!ajouter(jeton.length >= 20, "Jeton d'accès", jeton.length >= 20 ? "" : "Colle le jeton GitHub (il commence par github_pat_).")) return;
  dessiner("Connexion au dépôt…");
  let infos;
  try { infos = await (await github(`/repos/${depot}`, {}, cfg)).json(); }
  catch (e) { ajouter(false, "Accès au dépôt", messageErreur(e)); return; }
  ajouter(true, "Accès au dépôt");
  ajouter(!!infos.private, "Dépôt privé", infos.private ? "" : "Ce dépôt est public : tout le monde peut lire ta bibliothèque. Si ça te gêne, passe-le en privé (Settings → Change visibility).");
  try {
    const f = await lireFichier(FICHIER_DONNEES, cfg);
    ajouter(true, "Lecture des données", f ? "Une bibliothèque est déjà enregistrée : elle sera récupérée." : "Pas encore de données : ta bibliothèque sera envoyée à la première synchronisation.");
  } catch (e) { ajouter(false, "Lecture des données", messageErreur(e)); return; }
  etapes.push({ ok: true, titre: "Tout est prêt", aide: synchroActive() ? "" : "Touche « Enregistrer et synchroniser »." });
  dessiner();
}

function brancherSynchro(zone) {
  const verifier = zone.querySelector("#sy-verifier");
  if (verifier) verifier.addEventListener("click", () => diagnostiquerSynchro(zone));
  const enregistrer = zone.querySelector("#sy-enregistrer");
  if (enregistrer) enregistrer.addEventListener("click", () => {
    const depot = nettoyerDepot(zone.querySelector("#sy-depot").value);
    const jeton = zone.querySelector("#sy-jeton").value.trim();
    if (!FORMAT_DEPOT.test(depot)) { toast("Écris le dépôt sous la forme propriétaire/nom."); return; }
    if (jeton.length < 20) { toast("Colle le jeton GitHub (il commence par github_pat_)."); return; }
    ecrireSynchro({ depot, jeton });
    majBoutonSynchro();
    rendreReglages();
    synchroniser({ manuel: true });
  });
  const lancer = zone.querySelector("#sy-lancer");
  if (lancer) lancer.addEventListener("click", () => synchroniser({ manuel: true }));
  const deco = zone.querySelector("#sy-deconnecter");
  if (deco) deco.addEventListener("click", () => {
    if (!confirm("Arrêter la synchronisation sur cet appareil ? Tes données restent sur l'appareil et sur GitHub.")) return;
    clearTimeout(syncEtat.minuterie);
    ecrireSynchro(null);
    definirStatut("inactif");
    rendreReglages();
    toast("Synchronisation arrêtée sur cet appareil.");
  });
  const avant = zone.querySelector("#sy-avant");
  if (avant) avant.addEventListener("click", () => {
    const ancien = lireJSON(CLE_AVANT_SYNCHRO);
    if (!ancien) return;
    adopterEtat(ancien);
    etat.modifieLe = new Date().toISOString();
    ecrireJSON(CLE_STOCKAGE, etat);
    try { localStorage.removeItem(CLE_AVANT_SYNCHRO); } catch (e) { /* rien */ }
    toast("Version précédente retrouvée. La prochaine synchronisation l'enverra sur GitHub.");
    planifierSynchro();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const b = document.getElementById("btn-synchro");
  if (b) b.addEventListener("click", () => synchroniser({ manuel: true }));
  majBoutonSynchro();
  if (synchroActive()) setTimeout(() => synchroniser(), 600);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && synchroActive() && Date.now() - syncEtat.dernierEssai > 60000) synchroniser();
  });
});
