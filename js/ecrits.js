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

function ouvrirLiseuse(id, chapitre, defil) {
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
  afficherChapitre(y);
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
    </div>`;
  const defil = liseuse.el.querySelector(".lis-defil");
  const barreProg = liseuse.el.querySelector(".lis-progres span");
  let attente = null;
  const majProgres = () => {
    const max = defil.scrollHeight - defil.clientHeight;
    const r = max > 0 ? defil.scrollTop / max : 0;
    barreProg.style.width = Math.round(r * 100) + "%";
    clearTimeout(attente);
    attente = setTimeout(() => {
      const l = lireLecture();
      l.pos[liseuse.id] = { c: liseuse.c, y: r, d: Date.now() };
      ecrireLecture(l);
    }, 300);
  };
  defil.addEventListener("scroll", majProgres, { passive: true });
  requestAnimationFrame(() => {
    defil.scrollTop = y * (defil.scrollHeight - defil.clientHeight);
    majProgres();
  });
  liseuse.el.onclick = ev => {
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
      case "prec": liseuse.c--; afficherChapitre(0); return;
      case "suiv": liseuse.c++; afficherChapitre(0); return;
    }
  };
}

function fermerLiseuse(sansRendu) {
  if (!liseuse) return;
  liseuse.el.remove();
  liseuse = null;
  document.body.classList.remove("en-lecture");
  if (!sansRendu && ui.vue === "ecrits") rendre();
}

// Bouton « retour » d'Android : ferme la liseuse au lieu de quitter l'appli
window.addEventListener("popstate", () => { if (liseuse) fermerLiseuse(); });
