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
    if (/^>/.test(b)) return `<blockquote>${enLigne(b.replace(/^>\s?/gm, ""))}</blockquote>`;
    return `<p>${enLigne(b)}</p>`;
  }).join("");
}

/* ---------- Onglet Écrits ---------- */
function vueEcrits() {
  const liste = ecrits();
  if (!liste.length) return `<div class="vide">Aucun écrit pour l'instant. Quand tu écris un livre avec Claude, demande-lui de l'ajouter ici.</div>`;
  const lecture = lireLecture();
  return `
    <p class="intro">Les livres que tu écris avec Claude, à lire comme de vrais livres.</p>
    <div class="liste">${liste.map(e => {
      const n = (e.chapitres || []).length, prevus = Math.max(n, Number(e.chapitresPrevus) || 0);
      const pos = lecture.pos[e.id];
      const reprise = pos && n ? `Reprendre : ${esc(titreChapitreCourt(e.chapitres[Math.min(pos.c, n - 1)].titre))}` : "Commencer la lecture";
      return `
      <article class="livre ecrit">
        <div class="ecrit-tete">
          <span class="couv ecrit-couv" style="--c1:${teinte(e.id)};--c2:${teinte(e.id, -12)}">
            <span class="couv-maison"><span class="couv-titre">${esc(e.titre)}</span><span class="couv-auteur">${esc(e.auteurs || "")}</span></span>
          </span>
          <div>
            <span class="livre-titre">${esc(e.titre)}</span>
            <span class="livre-meta">${esc(e.auteurs || "")}${e.genre ? " · " + esc(e.genre) : ""}</span>
            <div class="rangee" style="margin-top:6px">
              <span class="pastille ${e.statut === "fini" ? "ok" : "accent"}">${e.statut === "fini" ? "Terminé" : "En cours d'écriture"}</span>
              <span class="pastille neutre">${n}/${pluriel(prevus, "chapitre")}</span>
            </div>
          </div>
        </div>
        ${prevus ? `<div class="progression" role="img" aria-label="${n} chapitres écrits sur ${prevus}"><span style="width:${Math.round(n / prevus * 100)}%"></span></div>` : ""}
        ${e.accroche ? `<p class="resume">${esc(e.accroche)}</p>` : ""}
        <div class="rangee">
          ${n ? `<button class="btn" data-act="lire-ecrit" data-id="${esc(e.id)}">${reprise}</button>` : ""}
          ${n && "speechSynthesis" in window ? `<button class="btn-sec" data-act="ecouter-ecrit" data-id="${esc(e.id)}">▶ Écouter</button>` : ""}
          ${n > 1 ? `<button class="btn-sec" data-act="sommaire-ecrit" data-id="${esc(e.id)}">Sommaire</button>` : ""}
          ${e.lienDoc ? `<a class="btn-discret" href="${esc(e.lienDoc)}" target="_blank" rel="noopener">Manuscrit dans Claude ↗</a>` : ""}
        </div>
        ${e.maj ? `<p class="doux petit" style="margin:0">Texte mis à jour le ${new Date(e.maj).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}.</p>` : ""}
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
      ${"speechSynthesis" in window ? `<div class="lis-ligne">Voix <select class="lis-voix" aria-label="Voix de lecture">${voixFrancaises().map(v => `<option value="${esc(v.name)}"${v.name === (lireLecture().reglages.voix || "") ? " selected" : ""}>${esc(v.name.replace(/^(Google|Microsoft)\s*/, ""))}</option>`).join("") || "<option>Voix du téléphone</option>"}</select></div>` : ""}
    </div>
    <div class="lis-defil">
      <article class="lis-page">
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
      <div class="lecteur-boutons">
        <button class="lis-btn" data-lis="minuterie" aria-label="Minuterie d'arrêt">☾<small class="lecteur-minu"></small></button>
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
      if (l.pos[id].c !== c) delete l.pos[id].p;
      ecrireLecture(l);
    }, 300);
  };
  defil.addEventListener("scroll", majProgres, { passive: true });
  requestAnimationFrame(() => {
    defil.scrollTop = y * (defil.scrollHeight - defil.clientHeight);
    majProgres();
  });
  liseuse.el.querySelector(".lis-voix")?.addEventListener("change", ev => {
    const l = lireLecture(); l.reglages.voix = ev.target.value; ecrireLecture(l);
    if (audio.joue) { arreterVoix(); parler(); }
  });
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
      case "minuterie": changerMinuterie(); return;
    }
  };
}

function fermerLiseuse(sansRendu) {
  if (!liseuse) return;
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
  if (minu) minu.textContent = audio.finChapitre ? "fin ch." : audio.finMinuterie ? Math.max(1, Math.round((audio.finMinuterie - Date.now()) / 60000)) + "′" : "";
}

function arreterVoix() { if ("speechSynthesis" in window) { audio.jeton = (audio.jeton || 0) + 1; speechSynthesis.cancel(); } }

// Les longs paragraphes sont lus phrase par phrase (Chrome coupe les énoncés trop longs)
function decouper(t) {
  const morceaux = t.match(/[^.!?;:…]+[.!?;:…»"]*\s*/g) || [t];
  const out = [];
  for (const m of morceaux) {
    if (out.length && (out[out.length - 1] + m).length < 220) out[out.length - 1] += m; else out.push(m);
  }
  return out.map(x => x.trim()).filter(Boolean);
}

function parler() {
  if (!liseuse || !audio.phrases.length) return;
  const cur = audio.phrases[audio.i];
  if (!cur) return;
  const jeton = (audio.jeton = (audio.jeton || 0) + 1);
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
    u.onend = () => dire(k + 1);
    u.onerror = ev => { if (ev.error !== "interrupted" && ev.error !== "canceled") dire(k + 1); };
    speechSynthesis.speak(u);
  };
  dire(0);
  // mémorise le paragraphe pour reprendre l'écoute plus tard
  const l = lireLecture();
  l.pos[liseuse.id] = Object.assign(l.pos[liseuse.id] || {}, { c: liseuse.c, p: audio.i, d: Date.now() });
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
  return String(t).replace(/^Chapitre\s+([IVXLC]+)\b/i, (m, r) => "Chapitre " + (NOMBRES[romainEnNombre(r.toUpperCase())] || r))
    .replace(/\s[—–-]\s/, ". ") + ".";
}

function suivantAudio() {
  if (!liseuse) return;
  if (audio.finMinuterie && Date.now() >= audio.finMinuterie) return finMinuterie();
  if (audio.i < audio.phrases.length - 1) { audio.i++; return parler(); }
  // fin du chapitre
  const e = ecrits().find(x => x.id === liseuse.id);
  if (audio.finChapitre || liseuse.c >= e.chapitres.length - 1) return finMinuterie(liseuse.c >= e.chapitres.length - 1 ? "Fin des chapitres écrits pour l'instant." : null);
  liseuse.c++;
  audio.i = 0;
  afficherChapitre(0);
  parler();
}

function jouer() {
  if (!("speechSynthesis" in window)) return toast("Ce téléphone ne sait pas lire le texte à voix haute.");
  audio.actif = true;
  audio.joue = true;
  const lec = liseuse && liseuse.el.querySelector(".lecteur");
  if (lec) lec.hidden = false;
  arreterVoix();
  parler();
}
function pause() { audio.joue = false; arreterVoix(); majLecteur(); }
function sauter(d) { arreterVoix(); audio.i = Math.max(0, Math.min(audio.phrases.length - 1, audio.i + d)); audio.joue ? parler() : majLecteur(); }

function changerMinuterie() {
  // aucune → 15 min → 30 min → fin du chapitre → aucune
  if (!audio.finMinuterie && !audio.finChapitre) audio.finMinuterie = Date.now() + 15 * 60e3;
  else if (audio.finMinuterie && audio.finMinuterie - Date.now() <= 15 * 60e3) audio.finMinuterie = Date.now() + 30 * 60e3;
  else if (audio.finMinuterie) { audio.finMinuterie = 0; audio.finChapitre = true; }
  else audio.finChapitre = false;
  toast(audio.finChapitre ? "Arrêt à la fin du chapitre." : audio.finMinuterie ? `Arrêt dans ${Math.round((audio.finMinuterie - Date.now()) / 60000)} minutes.` : "Minuterie désactivée.");
  majLecteur();
}
function finMinuterie(message) {
  audio.finMinuterie = 0; audio.finChapitre = false;
  pause();
  if (message) toast(message);
}
