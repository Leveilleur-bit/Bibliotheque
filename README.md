# 📚 Ma Bibliothèque

Une petite application web pour suivre mes lectures : livres audio Audible,
bibliothèque papier, envies de lecture et propositions de Claude pour la
prochaine écoute.

Site statique en HTML/CSS/JS, hébergé gratuitement sur **GitHub Pages**,
installable sur l'écran d'accueil du téléphone et utilisable hors ligne.
Même principe que l'appli [Mon Potager](https://github.com/Leveilleur-bit/Potager).

## Les onglets

- **Audible** : crédits disponibles (dépensés, gaspillés), livres à écouter,
  en cours et écoutés, détail des tomes de chaque série, note sur 5 et
  journal des crédits. La règle de base : un titre n'entre dans « À écouter »
  qu'avec le lien de sa fiche audible.fr et la langue française vérifiée.
- **Bibliothèque** : les livres papier lus et la pile à lire, avec recherche.
- **Envies** : ce que je veux lire ou écouter un jour, et les livres conseillés
  par des proches (avec le nom de la personne).
- **Propositions** : les idées de Claude, classées et expliquées. « Je l'ajoute
  à écouter » (après vérification de la langue), « Déjà lu » ou « Pas pour moi »
  (gardé pour ne jamais être reproposé).
- **Réglages** (icône en haut à droite) : synchronisation GitHub, sauvegarde et
  restauration d'un fichier.

## Les données

Les données ne sont **pas** dans ce dépôt public. Elles vivent dans le dépôt
privé `bibliotheque-donnees` (fichier `bibliotheque.json`) :

- l'appli les lit et les écrit avec un jeton GitHub « fine-grained » limité à
  ce dépôt (permission *Contents : Read and write*), gardé sur l'appareil ;
- Claude les relit en début de session et y ajoute ses propositions, en
  suivant `CONSIGNES.md` ;
- chaque appareil garde une copie locale et se synchronise à l'ouverture et
  après chaque changement. En cas de conflit, l'appli demande quelle version
  garder ; GitHub conserve l'historique.

## Installer

1. Dans ce dépôt : **Settings → Pages → Source : Deploy from a branch**,
   branche `main`, dossier `/ (root)`.
2. Ouvrir `https://leveilleur-bit.github.io/bibliotheque/` sur le téléphone,
   puis « Ajouter à l'écran d'accueil ».
3. Réglages → Synchronisation GitHub : coller le jeton.

## Fichiers

```
index.html       structure de la page
css/style.css    styles (thème clair et sombre)
js/app.js        données, onglets, cartes, actions
js/sync.js       synchronisation avec bibliotheque-donnees
sw.js            hors ligne et installation (incrémenter CACHE_VERSION à chaque version)
version.json     numéro de version et nouveautés
```
