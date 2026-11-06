/* ============================================================
   Mes écrits — Ma Bibliothèque
   - onglet « Écrits » : les livres écrits avec Claude
   - liseuse plein écran : thème, taille du texte, chapitres,
     reprise là où on s'est arrêté
   Le texte vit dans bibliotheque.json → ecrits[].chapitres
   (copié depuis le manuscrit Claude par Claude).
   ============================================================ */

const CLE_LECTURE = "maBibliothequeLecture";   // position de lecture et réglages, par appareil
const lireLecture = () => lireJSON(CLE_LECTURE) || { reglages: { theme: "sepia", taille: 19 }, pos: {} };
const ecrireLecture = v => ecrireJSON(CLE_LECTURE, v);
const ecrits = () => Array.isArray(etat.ecrits) ? etat.ecrits : [];

/* ---------- Petit Markdown → HTML (paragraphes, italique, gras, citations, séparateurs) ---------- */
function mdEnHTML(md) {
  const enLigne = t => esc(t)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/\n/g, "<br>");
  return String(md || "").replace(/\r/g, "").split(/\n{2,}/).map(b => b.trim()).filter(Boolean).map(b => {
    if (/^#{1,6}\s/.test(b)) return `<h3>${enLigne(b.replace(/^#+\s*/, ""))}</h3>`;
    if (/^(\*\s*){3,}$|^-{3,}$|^_{3,}$/.test(b)) return `<p class="ornement" aria-hidden="true">❦</p>`;
    // citation ou vers : les lignes « > » vides séparent les vers, pas des paragraphes
    if (/^>/.test(b)) return `<blockquote>${enLigne(b.replace(/^>\s?/gm, "").replace(/\n{2,}/g, "\n").trim())}</blockquote>`;
    return `<p>${enLigne(b)}</p>`;
  }).join("");
}

/* ---------- Onglet Écrits ---------- */
// Livre lu ou écouté jusqu'au bout : marqué à la fin de l'écoute ou de la lecture,
// ou déduit d'une ancienne position arrêtée sur le dernier paragraphe du dernier chapitre
function livreFini(e, pos) {
  const n = (e.chapitres || []).length;
  if (!pos || !n) return false;
  if (pos.fini) return true;
  if (pos.c < n - 1) return false;
  if ((pos.y || 0) >= 0.97) return true;
  const paras = String(e.chapitres[n - 1].texte || "").split(/\n\s*\n/).filter(t => t.trim() && !/^(❦|-{3,}|\*{3,})$/.test(t.trim())).length;
  return pos.p != null && pos.p >= paras - 2;   // + le titre lu en premier, avec une marge
}
function marquerFini(id) {
  const l = lireLecture();
  l.pos[id] = Object.assign(l.pos[id] || {}, { fini: true, d: Date.now() });
  ecrireLecture(l);
}

// Couverture introuvable (site pas encore à jour juste après l'ajout d'un livre) :
// on réessaie toutes les 20 s pendant 3 minutes, sans passer par le cache
function couvEcritKO(img) {
  const n = Number(img.dataset.essais || 0);
  if (n >= 9) return;
  img.dataset.essais = n + 1;
  setTimeout(() => { if (img.isConnected) img.src = img.getAttribute("src").split("?")[0] + "?r=" + Date.now(); }, 20000);
}

function vueEcrits() {
  const liste = ecrits().slice();
  if (!liste.length) return `<div class="vide">Aucun écrit pour l'instant. Quand tu écris un livre avec Claude, demande-lui de l'ajouter ici.</div>`;
  const lecture = lireLecture();
  // le livre en cours de lecture ou d'écoute (le plus récemment ouvert) passe en haut
  const vu = e => (!livreFini(e, lecture.pos[e.id]) && lecture.pos[e.id] && lecture.pos[e.id].d) || 0;
  liste.sort((a, b) => vu(b) - vu(a));
  return `
    <p class="intro">Les livres que tu écris avec Claude, à lire ou à écouter comme de vrais livres.</p>
    <div class="liste">${liste.map(e => {
      const cle = "ecrit-" + e.id, ouvert = ouverts.has(cle);
      const n = (e.chapitres || []).length, prevus = Math.max(n, Number(e.chapitresPrevus) || 0);
      const pos = lecture.pos[e.id];
      const fini = livreFini(e, pos);
      const reprise = fini ? "Relire" : pos && n ? `Reprendre : ${esc(titreChapitreCourt(e.chapitres[Math.min(pos.c, n - 1)].titre))}` : "Lire";
      const couv = e.couverture
        ? `<span class="couv"><img src="${esc(e.couverture)}" alt="" loading="lazy" onerror="couvEcritKO(this)"></span>`
        : `<span class="couv couv-ko">${couvertureMaisonHTML({ id: e.id, titre: e.titre, auteur: e.auteurs })}</span>`;
      return `
      <article class="livre">
        <button class="livre-tete" data-act="ouvrir" data-id="${esc(cle)}" aria-expanded="${ouvert}">
          ${couv}
          <span><span class="livre-titre">${esc(e.titre)}</span><span class="livre-meta">${esc(e.auteurs || "")}${e.genre ? " · " + esc(e.genre) : ""}</span></span>
          <span class="chevron" aria-hidden="true">▶</span>
        </button>
        <div class="rangee">
          <span class="pastille support">Mon livre</span>
          <span class="pastille ${e.statut === "fini" ? "ok" : "accent"}">${e.statut === "fini" ? "Terminé" : "En cours d'écriture"}</span>
          <span class="pastille neutre">${n}/${pluriel(prevus, "chapitre")}</span>
          ${fini ? `<span class="pastille ok">✓ Lu jusqu'au bout</span>` : ""}
        </div>
        ${ouvert ? `
          ${e.accroche ? `<p class="resume">${esc(e.accroche)}</p>` : ""}
          ${prevus && n < prevus ? `<div class="progression" role="img" aria-label="${n} chapitres écrits sur ${prevus}"><span style="width:${Math.round(n / prevus * 100)}%"></span></div>` : ""}
          ${e.lienDoc ? `<p class="livre-notes"><a href="${esc(e.lienDoc)}" target="_blank" rel="noopener">Manuscrit dans Claude ↗</a>${e.maj ? ` · texte mis à jour le ${new Date(e.maj).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}` : ""}</p>` : ""}` : ""}
        ${n ? `<div class="rangee">
          <button class="btn" data-act="lire-ecrit" data-id="${esc(e.id)}">${reprise}</button>
          <button class="btn-sec" data-act="ecouter-ecrit" data-id="${esc(e.id)}">▶ Écouter</button>
          ${n > 1 ? `<button class="btn-discret" data-act="sommaire-ecrit" data-id="${esc(e.id)}">Sommaire</button>` : ""}
        </div>` : ""}
      </article>`;
    }).join("")}</div>`;
}

const titreChapitreCourt = t => String(t).replace(/^Chapitre\s+([IVXLC\d]+)\s*[—–-]\s*/i, "$1. ");

function sommaireEcrit(e) {
  const pos = lireLecture().pos[e.id];
  ouvrirFenetre(`
    <button class="btn-discret fermer-coin" data-fen-act="fermer" aria-label="Fermer">✕</button>
    <h2>${esc(e.titre)}</h2>
    <div class="sommaire">${(e.chapitres || []).map((c, i) => `
      <button class="sommaire-ligne${pos && pos.c === i ? " en-cours" : ""}" data-fen-act="chap" data-i="${i}">${esc(c.titre)}${pos && pos.c === i ? ` <span class="doux petit">· tu en es là</span>` : ""}</button>`).join("")}
      ${(Number(e.chapitresPrevus) || 0) > (e.chapitres || []).length ? `<p class="doux petit">La suite est en cours d'écriture.</p>` : ""}
    </div>`, dlg => {
    dlg.onclick = ev => {
      const el = ev.target.closest("[data-fen-act]");
      if (!el) return;
      fermerFenetre();
      if (el.dataset.fenAct === "chap") ouvrirLiseuse(e.id, +el.dataset.i, 0);
    };
  });
}

/* ---------- Liseuse ---------- */
let liseuse = null;   // { id, c, el }

function ouvrirLiseuse(id, chapitre, defil, ecouter) {
  const e = ecrits().find(x => x.id === id);
  if (!e || !(e.chapitres || []).length) return;
  const lecture = lireLecture();
  // un livre terminé repart du début
  if (chapitre == null && livreFini(e, lecture.pos[id])) { delete lecture.pos[id]; ecrireLecture(lecture); }
  const pos = lecture.pos[id] || { c: 0, y: 0 };
  const c = Math.max(0, Math.min(chapitre ?? pos.c, e.chapitres.length - 1));
  const y = defil ?? (c === pos.c ? pos.y : 0);
  fermerLiseuse(true);
  const el = document.createElement("div");
  el.className = "liseuse";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Lecture : " + e.titre);
  document.body.appendChild(el);
  document.body.classList.add("en-lecture");
  liseuse = { id, c, el };
  if (!history.state || !history.state.liseuse) history.pushState({ liseuse: true }, "");
  appliquerReglages();
  audio.actif = !!ecouter;
  audio.i = ecouter && c === pos.c && Number.isInteger(pos.p) ? pos.p : 0;
  afficherChapitre(y);
  if (ecouter) jouer();
}

function appliquerReglages() {
  if (!liseuse) return;
  const r = lireLecture().reglages;
  liseuse.el.dataset.theme = r.theme;
  liseuse.el.style.setProperty("--taille", r.taille + "px");
}

function afficherChapitre(y = 0) {
  const e = ecrits().find(x => x.id === liseuse.id);
  const ch = e.chapitres[liseuse.c], n = e.chapitres.length;
  const dernier = liseuse.c === n - 1;
  const prevus = Number(e.chapitresPrevus) || n;
  liseuse.el.innerHTML = `
    <div class="lis-barre">
      <button class="lis-btn" data-lis="fermer" aria-label="Fermer la liseuse">✕</button>
      <span class="lis-titre">${esc(e.titre)}</span>
      ${"speechSynthesis" in window ? `<button class="lis-btn" data-lis="audio" aria-label="Écouter le livre">🎧</button>` : ""}
      <button class="lis-btn" data-lis="sommaire" aria-label="Sommaire">☰</button>
      <button class="lis-btn" data-lis="reglages" aria-label="Taille et couleurs">Aa</button>
      <span class="lis-progres"><span></span></span>
    </div>
    <div class="lis-reglages" hidden>
      <div class="lis-ligne">Taille
        <button class="lis-btn" data-lis="moins" aria-label="Texte plus petit">A−</button>
        <button class="lis-btn" data-lis="plus" aria-label="Texte plus grand">A+</button></div>
      <div class="lis-ligne">Couleurs
        <button class="lis-pastille" data-lis="theme" data-t="papier" aria-label="Papier blanc"></button>
        <button class="lis-pastille" data-lis="theme" data-t="sepia" aria-label="Sépia"></button>
        <button class="lis-pastille" data-lis="theme" data-t="nuit" aria-label="Nuit"></button></div>
      <div class="lis-ligne">Voix <select class="lis-voix" aria-label="Voix de lecture">${optionsVoix()}</select></div>
      ${"speechSynthesis" in window ? `
      <div class="lis-ligne lis-timbre">Timbre
        ${[["grave", "Plus grave", 0.93], ["normal", "Naturel", 1], ["clair", "Plus clair", 1.07]].map(([k, t]) => `<button class="lis-choix${(lireLecture().reglages.timbre || "normal") === k ? " actif" : ""}" data-lis="timbre" data-t="${k}">${t}</button>`).join("")}
        <button class="lis-btn" data-lis="essai" aria-label="Écouter un extrait">▶︎ Essai</button></div>
      ` : ""}
    </div>
    <div class="lis-defil">
      <article class="lis-page">
        ${liseuse.c === 0 && e.couverture ? `<img class="lis-couverture" src="${esc(e.couverture)}" onerror="couvEcritKO(this)" alt="Couverture : ${esc(e.titre)}, ${esc(e.auteurs || "")}">` : ""}
        <p class="lis-surtitre">${esc(e.titre)}</p>
        <h2 class="lis-chapitre">${esc(ch.titre).replace(/\s[—–-]\s/, "<br><span>").replace(/$/, ch.titre.match(/\s[—–-]\s/) ? "</span>" : "")}</h2>
        <p class="ornement" aria-hidden="true">❦</p>
        <div class="lis-texte">${mdEnHTML(ch.texte)}</div>
        <p class="ornement" aria-hidden="true">❦</p>
        <nav class="lis-nav">
          ${liseuse.c > 0 ? `<button class="btn-sec" data-lis="prec">‹ ${esc(titreChapitreCourt(e.chapitres[liseuse.c - 1].titre))}</button>` : "<span></span>"}
          ${!dernier ? `<button class="btn" data-lis="suiv">${esc(titreChapitreCourt(e.chapitres[liseuse.c + 1].titre))} ›</button>` : ""}
        </nav>
        ${dernier && prevus > n ? `<p class="lis-fin">La suite est en cours d'écriture : ${n} chapitre${n > 1 ? "s" : ""} sur ${prevus}.</p>` : ""}
        ${dernier && prevus <= n && e.statut === "fini" ? `<p class="lis-fin">Fin.</p>` : ""}
        <p class="lis-pied">${liseuse.c + 1} / ${n}</p>
      </article>
    </div>
    <div class="lecteur" ${audio.actif ? "" : "hidden"}>
      <div class="lecteur-info"><b>${esc(titreChapitreCourt(ch.titre))}</b><span class="lecteur-pos"></span></div>
      <div class="lecteur-progres"><span></span></div>
      <div class="lecteur-menu-minu" hidden>
        <span>Arrêter l'écoute dans</span>
        ${[[15, "15 min"], [30, "30 min"], [45, "45 min"], [60, "1 h"]].map(([m, t]) => `<button class="lis-choix" data-lis="minu" data-m="${m}">${t}</button>`).join("")}
        <button class="lis-choix" data-lis="minu" data-m="chapitre">Fin du chapitre</button>
        <button class="lis-choix" data-lis="minu" data-m="0">Désactiver</button>
      </div>
      <div class="lecteur-boutons">
        <button class="lis-btn" data-lis="ecran-noir" aria-label="Écran noir : la lecture continue, écran au minimum">◐</button>
        <button class="lis-btn lecteur-minuterie" data-lis="minuterie" aria-label="Minuterie : arrêter l'écoute après un temps choisi">⏲<small class="lecteur-minu"></small></button>
        <button class="lis-btn" data-lis="arriere" aria-label="Paragraphe précédent">⏮</button>
        <button class="lis-btn lecteur-play" data-lis="play" aria-label="Lecture ou pause">${audio.joue ? "⏸" : "▶"}</button>
        <button class="lis-btn" data-lis="avant" aria-label="Paragraphe suivant">⏭</button>
        <button class="lis-btn" data-lis="vitesse" aria-label="Vitesse de lecture">${String(audio.vitesse).replace(".", ",")}×</button>
      </div>
    </div>`;
  preparerAudio();
  const defil = liseuse.el.querySelector(".lis-defil");
  const barreProg = liseuse.el.querySelector(".lis-progres span");
  let attente = null;
  const majProgres = () => {
    const max = defil.scrollHeight - defil.clientHeight;
    const r = max > 0 ? defil.scrollTop / max : 0;
    barreProg.style.width = Math.round(r * 100) + "%";
    clearTimeout(attente);
    const id = liseuse.id, c = liseuse.c;
    attente = setTimeout(() => {
      const l = lireLecture();
      l.pos[id] = Object.assign(l.pos[id] || {}, { c, y: r, d: Date.now() });
      const nb = (ecrits().find(x => x.id === id)?.chapitres || []).length;
      if (c >= nb - 1 && r >= 0.97) l.pos[id].fini = true; else delete l.pos[id].fini;
      if (l.pos[id].c !== c) delete l.pos[id].p;
      ecrireLecture(l);
    }, 300);
  };
  defil.addEventListener("scroll", majProgres, { passive: true });
  requestAnimationFrame(() => {
    defil.scrollTop = y * (defil.scrollHeight - defil.clientHeight);
    majProgres();
  });
  liseuse.el.querySelector(".lis-voix")?.addEventListener("change", ev => choisirVoix(ev.target.value));
  liseuse.el.onclick = ev => {
    const para = audio.actif && ev.target.closest(".lis-texte > *");
    if (para) { const k = audio.phrases.findIndex(x => x.el === para); if (k >= 0) { arreterVoix(); audio.i = k; jouer(); } return; }
    const b = ev.target.closest("[data-lis]");
    if (!b) return;
    const l = lireLecture();
    switch (b.dataset.lis) {
      case "fermer": history.back(); return;
      case "sommaire": sommaireEcrit(e); return;
      case "reglages": { const z = liseuse.el.querySelector(".lis-reglages"); z.hidden = !z.hidden; return; }
      case "moins": l.reglages.taille = Math.max(15, l.reglages.taille - 1); ecrireLecture(l); appliquerReglages(); return;
      case "plus": l.reglages.taille = Math.min(28, l.reglages.taille + 1); ecrireLecture(l); appliquerReglages(); return;
      case "theme": l.reglages.theme = b.dataset.t; ecrireLecture(l); appliquerReglages(); return;
      case "prec": arreterVoix(); liseuse.c--; audio.i = 0; afficherChapitre(0); if (audio.joue) parler(); return;
      case "suiv": arreterVoix(); liseuse.c++; audio.i = 0; afficherChapitre(0); if (audio.joue) parler(); return;
      case "audio": audio.actif = true; liseuse.el.querySelector(".lecteur").hidden = false; if (!audio.joue) jouer(); return;
      case "play": audio.joue ? pause() : jouer(); return;
      case "arriere": sauter(-1); return;
      case "avant": sauter(1); return;
      case "vitesse": { const v = [0.8, 1, 1.15, 1.3, 1.5]; audio.vitesse = v[(v.indexOf(audio.vitesse) + 1) % v.length]; l.reglages.vitesse = audio.vitesse; ecrireLecture(l); b.textContent = String(audio.vitesse).replace(".", ",") + "×"; if (audio.joue) { arreterVoix(); parler(); } return; }
      case "minuterie": { const m = liseuse.el.querySelector(".lecteur-menu-minu"); m.hidden = !m.hidden; return; }
      case "minu": regler(b.dataset.m); liseuse.el.querySelector(".lecteur-menu-minu").hidden = true; return;
      case "ecran-noir": ecranNoir(); return;
      case "timbre": l.reglages.timbre = b.dataset.t; ecrireLecture(l);
        liseuse.el.querySelectorAll('[data-lis="timbre"]').forEach(x => x.classList.toggle("actif", x === b));
        if (audio.joue) { arreterVoix(); parler(); } return;
      case "essai": essaiVoix(); return;
    }
  };
}

function fermerLiseuse(sansRendu) {
  if (!liseuse) return;
  document.querySelector(".ecran-noir")?.remove();
  maintenirEnVeille(false);
  pause();
  audio.actif = false;
  liseuse.el.remove();
  liseuse = null;
  document.body.classList.remove("en-lecture");
  if (!sansRendu && ui.vue === "ecrits") rendre();
}

// Bouton « retour » d'Android : ferme la liseuse au lieu de quitter l'appli
window.addEventListener("popstate", () => { if (liseuse) fermerLiseuse(); });

/* ---------- Lecteur audio : la voix du téléphone lit le livre ---------- */
const audio = { actif: false, joue: false, i: 0, phrases: [], vitesse: (lireLecture().reglages.vitesse || 1), minuterie: null, finMinuterie: 0, finChapitre: false };

function voixFrancaises() {
  if (!("speechSynthesis" in window)) return [];
  return speechSynthesis.getVoices().filter(v => /^fr/i.test(v.lang))
    .sort((a, b) => (/fr-FR/i.test(b.lang) - /fr-FR/i.test(a.lang)) || (/google|natural|premium|enhanced/i.test(b.name) - /google|natural|premium|enhanced/i.test(a.name)));
}
if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = () => {
  const sel = liseuse && liseuse.el.querySelector(".lis-voix");
  if (sel && sel.options.length <= 1) afficherChapitre(lireLecture().pos[liseuse.id]?.y || 0);
};

// Le texte du chapitre, découpé en paragraphes (titre compris), chacun relié à son élément
function preparerAudio() {
  if (!liseuse) return;
  const titre = liseuse.el.querySelector(".lis-chapitre");
  const e = ecrits().find(x => x.id === liseuse.id);
  audio.phrases = [{ el: titre, t: titreAOral(e.chapitres[liseuse.c].titre) }]
    .concat([...liseuse.el.querySelectorAll(".lis-texte > *")].map(el => ({ el, t: el.textContent.trim() })).filter(x => x.t && x.t !== "❦"));
  audio.i = Math.min(audio.i, audio.phrases.length - 1);
  majLecteur();
}

function majLecteur() {
  if (!liseuse) return;
  const n = audio.phrases.length;
  liseuse.el.querySelectorAll(".lu-actif").forEach(e => e.classList.remove("lu-actif"));
  const cur = audio.phrases[audio.i];
  if (cur && audio.actif) cur.el.classList.add("lu-actif");
  const play = liseuse.el.querySelector(".lecteur-play");
  if (play) play.textContent = audio.joue ? "⏸" : "▶";
  const pos = liseuse.el.querySelector(".lecteur-pos");
  if (pos) pos.textContent = `Paragraphe ${audio.i + 1} / ${n}`;
  const pr = liseuse.el.querySelector(".lecteur-progres span");
  if (pr) pr.style.width = (n ? Math.round(audio.i / n * 100) : 0) + "%";
  const minu = liseuse.el.querySelector(".lecteur-minu");
  if (minu) minu.textContent = audio.finChapitre ? "fin ch." : audio.finMinuterie ? Math.max(1, Math.ceil((audio.finMinuterie - Date.now()) / 60000)) + " min" : "";
  liseuse.el.querySelector(".lecteur-minuterie")?.classList.toggle("actif", !!(audio.finChapitre || audio.finMinuterie));
}

function arreterVoix() {
  audio.jeton = (audio.jeton || 0) + 1;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

// Les longs paragraphes sont lus phrase par phrase (Chrome coupe les énoncés trop longs)
function decouper(t, max = 220) {
  const morceaux = t.match(/[^.!?;:…]+[.!?;:…»"]*\s*/g) || [t];
  const out = [];
  for (const m of morceaux) {
    if (out.length && (out[out.length - 1] + m).length < max) out[out.length - 1] += m; else out.push(m);
  }
  return out.map(x => x.trim()).filter(Boolean);
}

function parler() {
  if (!liseuse || !audio.phrases.length) return;
  const cur = audio.phrases[audio.i];
  if (!cur) return;
  const jeton = (audio.jeton = (audio.jeton || 0) + 1);
  memoriserPosition();
  sessionMedia();
  const morceaux = decouper(cur.t);
  const voix = voixFrancaises();
  const choisie = voix.find(v => v.name === lireLecture().reglages.voix) || voix[0];
  majLecteur();
  cur.el.scrollIntoView({ block: "center", behavior: "smooth" });
  const dire = k => {
    if (jeton !== audio.jeton || !audio.joue) return;
    if (k >= morceaux.length) return suivantAudio();
    const u = new SpeechSynthesisUtterance(morceaux[k]);
    u.lang = "fr-FR";
    if (choisie) u.voice = choisie;
    u.rate = audio.vitesse;
    u.pitch = TIMBRES[lireLecture().reglages.timbre] || 1;
    u.onend = () => (audio.finMinuterie && Date.now() >= audio.finMinuterie) ? finMinuterie("Bonne nuit : l'écoute s'est arrêtée.") : dire(k + 1);
    u.onerror = ev => { if (ev.error !== "interrupted" && ev.error !== "canceled") dire(k + 1); };
    speechSynthesis.speak(u);
  };
  dire(0);
}

// mémorise le paragraphe pour reprendre l'écoute plus tard
function memoriserPosition() {
  const l = lireLecture();
  l.pos[liseuse.id] = Object.assign(l.pos[liseuse.id] || {}, { c: liseuse.c, p: audio.i, d: Date.now() });
  delete l.pos[liseuse.id].fini;
  ecrireLecture(l);
}

// « Chapitre IV — Les portraits » → « Chapitre quatre. Les portraits. » (sinon la voix lit « i, v »)
const NOMBRES = ["", "premier", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize", "dix-sept", "dix-huit", "dix-neuf", "vingt"];
function romainEnNombre(r) {
  const v = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  let n = 0;
  for (let i = 0; i < r.length; i++) n += v[r[i]] < (v[r[i + 1]] || 0) ? -v[r[i]] : v[r[i]];
  return n;
}
function titreAOral(t) {
  return String(t).replace(/^([IVXLC]+)\.\s+/, "Chapitre $1 — ")   // « I. La ville qui riait »
    .replace(/^Chapitre\s+([IVXLC]+)\b/i, (m, r) => "Chapitre " + (NOMBRES[romainEnNombre(r.toUpperCase())] || r))
    .replace(/\s[—–-]\s/, ". ") + ".";
}

function suivantAudio() {
  if (!liseuse) return;
  if (audio.finMinuterie && Date.now() >= audio.finMinuterie) return finMinuterie();
  if (audio.i < audio.phrases.length - 1) { audio.i++; return parler(); }
  // fin du chapitre
  const e = ecrits().find(x => x.id === liseuse.id);
  if (liseuse.c >= e.chapitres.length - 1) marquerFini(liseuse.id);
  if (audio.finChapitre || liseuse.c >= e.chapitres.length - 1) return finMinuterie(liseuse.c >= e.chapitres.length - 1 ? "Fin des chapitres écrits pour l'instant." : null);
  liseuse.c++;
  audio.i = 0;
  afficherChapitre(0);
  parler();
}

function jouer() {
  if (!voixNaturelleChoisie() && !("speechSynthesis" in window)) return toast("Ce téléphone ne sait pas lire le texte à voix haute.");
  audio.actif = true;
  audio.joue = true;
  const lec = liseuse && liseuse.el.querySelector(".lecteur");
  if (lec) lec.hidden = false;
  arreterVoix();
  if (!voixNaturelleChoisie()) maintenirEnVeille(true);
  parler();
}
function pause() { audio.joue = false; arreterVoix(); maintenirEnVeille(false); majLecteur(); try { localStorage.removeItem("voixNatEnCours"); } catch { /* rien */ } }
function sauter(d) { arreterVoix(); audio.i = Math.max(0, Math.min(audio.phrases.length - 1, audio.i + d)); audio.joue ? parler() : majLecteur(); }

// Minuterie d'arrêt : 15, 30, 45 min, 1 h ou fin du chapitre. L'écoute s'arrête à la fin de la phrase en cours.
let tictac = null;
function regler(m) {
  audio.finChapitre = m === "chapitre";
  audio.finMinuterie = /^\d+$/.test(m) && +m > 0 ? Date.now() + +m * 60e3 : 0;
  clearInterval(tictac);
  if (audio.finMinuterie) tictac = setInterval(() => {
    majLecteur();
    // le temps est écoulé : on coupe à la fin du morceau de phrase en cours
    if (audio.finMinuterie && Date.now() >= audio.finMinuterie && audio.joue && "speechSynthesis" in window && !speechSynthesis.speaking) finMinuterie("Bonne nuit : l'écoute s'est arrêtée.");
  }, 15e3);
  toast(audio.finChapitre ? "L'écoute s'arrêtera à la fin du chapitre." : audio.finMinuterie ? `L'écoute s'arrêtera dans ${m >= 60 ? "1 heure" : m + " minutes"}.` : "Minuterie désactivée.");
  if ((audio.finMinuterie || audio.finChapitre) && !audio.joue) jouer();
  majLecteur();
}
function finMinuterie(message) {
  audio.finMinuterie = 0; audio.finChapitre = false; clearInterval(tictac);
  pause();
  if (message) toast(message);
}

const TIMBRES = { grave: 0.93, normal: 1, clair: 1.07 };   // écarts faibles : au-delà, la voix devient robotique
// Fait entendre la voix choisie sur une phrase du livre, sans toucher à la lecture en cours
const PHRASE_ESSAI = "Il est des terres que la mer n'a jamais tout à fait rendues aux hommes.";
async function essaiVoix() {
  const etaitEnLecture = audio.joue;
  pause();
  if (!("speechSynthesis" in window)) return;
  const voix = voixFrancaises();
  const r = lireLecture().reglages;
  const u = new SpeechSynthesisUtterance(PHRASE_ESSAI);
  u.lang = "fr-FR";
  u.voice = voix.find(v => v.name === r.voix) || voix[0] || null;
  u.rate = audio.vitesse;
  u.pitch = TIMBRES[r.timbre] || 1;
  if (etaitEnLecture) u.onend = () => jouer();
  speechSynthesis.speak(u);
}

// Toutes les voix viennent du téléphone (synthèse vocale d'Android)
const voixNaturelleChoisie = () => null;

function optionsVoix() {
  const choisie = lireLecture().reglages.voix || "";
  return `<option value=""${choisie === "" ? " selected" : ""}>Voix du téléphone (par défaut)</option>`
    + voixFrancaises().map(v => `<option value="${esc(v.name)}"${v.name === choisie ? " selected" : ""}>${esc(v.name.replace(/^(Google|Microsoft)\s*/, ""))}</option>`).join("");
}
function choisirVoix(valeur) {
  const l = lireLecture(); l.reglages.voix = valeur; ecrireLecture(l);
  if (audio.joue) { arreterVoix(); parler(); }
}

// Commandes sur l'écran verrouillé et dans la barre de notifications
function sessionMedia() {
  if (!("mediaSession" in navigator) || !liseuse) return;
  const e = ecrits().find(x => x.id === liseuse.id);
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: titreChapitreCourt(e.chapitres[liseuse.c].titre), artist: e.auteurs || "", album: e.titre });
    navigator.mediaSession.setActionHandler("play", () => jouer());
    navigator.mediaSession.setActionHandler("pause", () => pause());
    navigator.mediaSession.setActionHandler("nexttrack", () => sauter(1));
    navigator.mediaSession.setActionHandler("previoustrack", () => sauter(-1));
  } catch { /* navigateur sans ces commandes */ }
}

// Les voix naturelles ont été retirées : on libère la place qu'elles occupaient sur le téléphone
(() => {
  try {
    const l = lireLecture();
    if ((l.reglages.voix || "").startsWith("piper:")) { l.reglages.voix = ""; ecrireLecture(l); }
    localStorage.removeItem("voixNatEnCours");
    if (navigator.storage && navigator.storage.getDirectory) navigator.storage.getDirectory().then(d => d.removeEntry("piper", { recursive: true })).catch(() => {});
    if (window.caches) caches.delete("moteur-voix-v1");
  } catch { /* rien */ }
})();

/* ---------- Lecture écran éteint ----------
   Android met en pause une page qui ne joue aucun son quand l'écran s'éteint, et la voix du
   téléphone s'arrête avec elle. On joue donc en boucle un son silencieux : Chrome considère
   que de la musique est en cours, garde la page éveillée et affiche les commandes sur l'écran
   verrouillé. */
let silence = null;
function sonSilencieux() {
  // 1 seconde de silence, WAV 8 kHz mono 16 bits
  const n = 8000, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const txt = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  txt(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); txt(8, "WAVE"); txt(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true);
  v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); txt(36, "data"); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}
// Android coupe la voix du téléphone quand l'écran se met en veille : on garde l'écran allumé
// pendant l'écoute (verrou d'écran), et le mode « écran noir » le rend presque invisible.
let verrouEcran = null;
async function garderEcranAllume(actif) {
  try {
    if (actif && "wakeLock" in navigator && !verrouEcran) {
      verrouEcran = await navigator.wakeLock.request("screen");
      verrouEcran.addEventListener("release", () => { verrouEcran = null; });
    } else if (!actif && verrouEcran) { await verrouEcran.release(); verrouEcran = null; }
  } catch { /* refusé (batterie faible…) : sans gravité */ }
}
function ecranNoir() {
  if (!audio.joue) jouer();
  const v = document.createElement("div");
  v.className = "ecran-noir";
  v.innerHTML = `<p>La lecture continue.<br>Touche deux fois l'écran pour revenir.</p>`;
  document.body.appendChild(v);
  let dernier = 0;
  v.addEventListener("click", () => {
    const t = Date.now();
    if (t - dernier < 450) v.remove();
    dernier = t;
    v.classList.add("ecran-noir-indice");
    setTimeout(() => v.classList.remove("ecran-noir-indice"), 1500);
  });
}

function maintenirEnVeille(actif) {
  garderEcranAllume(actif);
  try {
    if (actif) {
      if (!silence) { silence = new Audio(sonSilencieux()); silence.loop = true; silence.volume = 0.01; }
      silence.play().catch(() => { /* lecture automatique refusée : sans gravité */ });
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
    } else if (silence) {
      silence.pause();
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
    }
  } catch { /* navigateur sans audio */ }
}
// Au retour à l'écran : si la voix s'est tue en route, on reprend le paragraphe en cours
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && audio.joue) garderEcranAllume(true);
  if (document.visibilityState === "visible" && audio.joue && !voixNaturelleChoisie()
      && "speechSynthesis" in window && !speechSynthesis.speaking && !speechSynthesis.pending) {
    arreterVoix(); parler();
  }
});
