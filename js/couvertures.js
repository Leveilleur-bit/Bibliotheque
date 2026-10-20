/* ============================================================
   Couvertures et étagère — Ma Bibliothèque
   - couvertures cherchées sur Google Books (éditions françaises d'abord),
     puis Open Library ; mémorisées sur l'appareil
   - couverture « maison » quand rien n'est trouvé
   - tranches de livres pour la vue étagère
   ============================================================ */

const CLE_COUV = "maBibliothequeCouv2";   // v2 : éditions françaises seulement (la v1 prenait parfois des éditions étrangères)
try { localStorage.removeItem("maBibliothequeCouv"); } catch { /* rien */ }
const COUV_REESSAI_JOURS = 30;          // un livre sans couverture est recherché à nouveau après 30 jours
let cacheCouv = (() => { try { return JSON.parse(localStorage.getItem(CLE_COUV)) || {}; } catch { return {}; } })();
const sauverCacheCouv = () => { try { localStorage.setItem(CLE_COUV, JSON.stringify(cacheCouv)); } catch { /* mémoire pleine : tant pis */ } };

// Petit hachage stable d'une chaîne, pour les couleurs
function hacher(s) {
  let h = 2166136261;
  for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Teintes « cuir et toile » : bordeaux, brun, vert sapin, bleu nuit, ocre, prune
const TEINTES = [[352, 48, 26], [18, 42, 24], [28, 50, 30], [150, 28, 20], [165, 22, 24], [215, 36, 22], [228, 28, 28], [38, 55, 34], [280, 22, 24], [0, 0, 18]];
function teinte(cle, decal = 0) {
  const [h, s, l] = TEINTES[hacher(cle) % TEINTES.length];
  return `hsl(${h} ${s}% ${l + decal}%)`;
}

const sansAccents = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// Titre à chercher : sans « (série) », « (papier) », « (French Edition) »…
function titresRecherche(l) {
  const net = t => String(t || "").replace(/\((série|papier|french edition|romans|omnibus)\)/gi, "").replace(/\s+/g, " ").trim();
  const t = [];
  const tomes = Array.isArray(l.tomes) ? l.tomes : [];
  const titreSeul = net(l.titre);
  const titreGenerique = /\(romans\)/i.test(l.titre) || sansAccents(titreSeul) === sansAccents(l.auteur);
  // pour une série, la couverture du premier tome ; sinon le titre du livre
  if (tomes[0] && (tomes.length > 1 || titreGenerique)) t.push(net(tomes[0].titre).replace(/^.*?\s:\s/, ""));
  if (!titreGenerique) t.push(titreSeul.split(/\s[–—:]\s/)[0]);
  if (!titreGenerique && /\s[–—:]\s/.test(titreSeul)) t.push(titreSeul.split(/\s[–—:]\s/).pop());
  return [...new Set(t.filter(Boolean))];
}

function auteurCorrespond(auteursTrouves, l) {
  const nom = sansAccents(typeof nomAuteur === "function" ? nomAuteur(l) : "");
  if (!nom) return true;                               // collectifs : on fait confiance au titre
  return (auteursTrouves || []).some(a => sansAccents(a).includes(nom.split(" ").pop()));
}

// Le titre trouvé doit ressembler au titre cherché (évite de prendre un autre livre du même auteur)
function titreCorrespond(trouve, cherche) {
  const a = sansAccents(trouve).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const b = sansAccents(cherche).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  return !!a && !!b && (a.includes(b) || b.includes(a));
}

async function chercherGoogle(titre, l) {
  const nom = typeof nomAuteur === "function" ? nomAuteur(l) : "";
  const q = `intitle:${titre}` + (nom ? ` inauthor:${nom}` : "");
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&langRestrict=fr&maxResults=10&printType=books&fields=items(volumeInfo(title,authors,language,imageLinks))`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("google " + r.status);
  const j = await r.json();
  for (const it of j.items || []) {
    const v = it.volumeInfo || {};
    const img = v.imageLinks && (v.imageLinks.thumbnail || v.imageLinks.smallThumbnail);
    if (img && v.language === "fr" && titreCorrespond(v.title, titre) && auteurCorrespond(v.authors, l)) return img.replace(/^http:/, "https:").replace("&edge=curl", "");
  }
  return "";
}

async function chercherOpenLibrary(titre, l) {
  const nom = typeof nomAuteur === "function" ? nomAuteur(l) : "";
  const url = `https://openlibrary.org/search.json?title=${encodeURIComponent(titre)}${nom ? "&author=" + encodeURIComponent(nom) : ""}&language=fre&limit=5&fields=cover_i,author_name,title`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("openlibrary " + r.status);
  const j = await r.json();
  const d = (j.docs || []).find(x => x.cover_i && titreCorrespond(x.title, titre) && auteurCorrespond(x.author_name, l));
  return d ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : "";
}

async function trouverCouverture(l) {
  for (const t of titresRecherche(l)) {
    for (const source of [chercherGoogle, chercherOpenLibrary]) {
      try { const u = await source(t, l); if (u) return u; } catch { /* source indisponible : on essaie la suivante */ }
    }
  }
  return "";
}

// URL connue (champ « couverture » du livre, ou trouvée et mémorisée), sinon null
function urlCouverture(l) {
  if (l.couverture) return l.couverture;
  const c = cacheCouv[l.id];
  return c && c.u ? c.u : null;
}

function couvertureMaisonHTML(l) {
  return `<span class="couv-maison" style="--c1:${teinte(l.id)};--c2:${teinte(l.id, -10)}">
      <span class="couv-titre">${esc(String(l.titre).replace(/\((série|papier|French Edition)\)/gi, "").trim())}</span>
      ${l.auteur ? `<span class="couv-auteur">${esc(typeof nomAuteur === "function" ? nomAuteur(l) || l.auteur : l.auteur)}</span>` : ""}
    </span>`;
}

function couvertureHTML(l) {
  const u = urlCouverture(l);
  if (u) return `<span class="couv"><img src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add('couv-ko');this.remove()">${couvertureMaisonHTML(l)}</span>`;
  const c = cacheCouv[l.id];
  const aChercher = !c || (Date.now() - (c.d || 0)) / 864e5 > COUV_REESSAI_JOURS;
  return `<span class="couv couv-ko"${aChercher ? ` data-couv-attente="${esc(l.id)}"` : ""}>${couvertureMaisonHTML(l)}</span>`;
}

/* ---------- Recherche paresseuse : seulement les cartes visibles, deux à la fois ---------- */
const fileCouv = [];
const enCoursCouv = new Set();
let actifsCouv = 0;
const observateurCouv = "IntersectionObserver" in window ? new IntersectionObserver(entrees => {
  for (const e of entrees) {
    if (!e.isIntersecting) continue;
    observateurCouv.unobserve(e.target);
    const id = e.target.dataset.couvAttente;
    if (id && !enCoursCouv.has(id)) { enCoursCouv.add(id); fileCouv.push(id); }
  }
  pomperCouv();
}, { rootMargin: "300px" }) : null;

function pomperCouv() {
  while (actifsCouv < 2 && fileCouv.length) {
    const id = fileCouv.shift();
    const l = etat.livres.find(x => x.id === id);
    if (!l) { enCoursCouv.delete(id); continue; }
    actifsCouv++;
    trouverCouverture(l).then(u => {
      cacheCouv[id] = { u, d: Date.now() };
      sauverCacheCouv();
      if (u) document.querySelectorAll(`[data-couv-attente="${CSS.escape(id)}"]`).forEach(el => {
        el.outerHTML = couvertureHTML(l);
      });
    }).finally(() => { actifsCouv--; enCoursCouv.delete(id); setTimeout(pomperCouv, 150); });
  }
}

function chargerCouvertures(racine = document) {
  if (!observateurCouv || !navigator.onLine) return;
  racine.querySelectorAll("[data-couv-attente]").forEach(el => observateurCouv.observe(el));
}

function oublierCouverture(id) { delete cacheCouv[id]; sauverCacheCouv(); }

/* ---------- Vue étagère : une tranche par tome ---------- */
function tranchesHTML(l) {
  const tomes = Array.isArray(l.tomes) && l.tomes.length ? l.tomes : [{ titre: l.titre, ecoute: l.statut === "lu" || l.statut === "ecoute" }];
  const h = hacher(l.id);
  const hauteur = 124 + (h % 5) * 9;                     // une série garde la même hauteur
  const largeurBase = l.support === "audible" ? 26 : 22 + (h >> 3) % 10;
  const couleur = teinte(l.id), fonce = teinte(l.id, -8);
  const audio = l.support === "audible";
  return tomes.map((t, i) => {
    const titre = tomes.length > 1 ? t.titre : l.titre;
    const largeur = largeurBase + (hacher(t.titre) % 7);
    return `<button class="tranche${audio ? " tranche-audio" : ""}${t.ecoute ? "" : " tranche-avenir"}" data-act="voir-fiche" data-id="${esc(l.id)}"
        style="--h:${hauteur}px;--w:${largeur}px;--c1:${couleur};--c2:${fonce}"
        title="${esc(titre)}${l.auteur ? " — " + esc(l.auteur) : ""}" aria-label="${esc(titre)}${tomes.length > 1 ? ", tome " + (i + 1) + " de " + esc(l.titre) : ""}">
        <span>${esc(String(titre).replace(/\((série|papier|French Edition)\)/gi, "").trim())}</span>
      </button>`;
  }).join("");
}

function etagereHTML(livres, messageVide) {
  if (!livres.length) return `<div class="vide">${messageVide}</div>`;
  let html = "", courant = null;
  for (const l of livres) {
    const cle = typeof nomAuteur === "function" ? nomAuteur(l) || "~" : "";
    if (ui.triGenre !== "titre" && cle !== courant && courant !== null) html += `<span class="serre-livres" aria-hidden="true"></span>`;
    courant = cle;
    html += tranchesHTML(l);
  }
  return `<div class="etagere" role="list">${html}</div>
    <p class="doux petit legende-etagere">Les tranches pâles sont à lire ou à écouter ; les tranches marquées d'un trait sont des livres audio. Touche une tranche pour ouvrir sa fiche.</p>`;
}
