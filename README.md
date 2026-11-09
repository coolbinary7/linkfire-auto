# Linkfire Auto

Extension Chrome qui crée des liens **pre-save Linkfire** en série.

Tu fournis, pour chaque sortie, l’artiste ou les artistes, le titre, l’UPC, la date de sortie et une cover si tu en as une. Tu peux les saisir à la main ou importer un fichier Excel/CSV. L’extension :

1. clique sur *Create link* puis choisit *Pre-release* ;
2. remplit la cover, le titre, l’artiste, les tags et le lien (domaine de l’artiste + `Artiste_Titre`) ;
3. clique sur *Create draft* ;
4. dans *Rescan link*, choisit *UPC*, saisit le code, coche *Schedule rescan* et met la date de sortie ;
5. publie, puis récupère le lien.

**Page de téléchargement et mode d’emploi :** https://coolbinary7.github.io/linkfire-auto/

## Contenu du dépôt

- `extension/` : code de l’extension (Manifest V3)
  - `content.js` : moteur qui pilote l’interface Linkfire
  - `sidepanel.*` : panneau latéral (saisie, import Excel, résultats)
  - `xlsx.full.min.js` : SheetJS 0.18.5, pour lire les fichiers Excel
- `docs/` : page de téléchargement (GitHub Pages), zip de l’extension et modèle Excel

## Installation pour développer

`chrome://extensions` → Mode développeur → *Charger l’extension non empaquetée* → dossier `extension/`.

## Publier une nouvelle version

1. Monter le numéro `version` dans `extension/manifest.json`.
2. Zipper le dossier sous le nom `linkfire-auto/` dans `docs/downloads/Linkfire-Auto-X.Y.Z.zip`.
3. Mettre à jour le numéro et le lien dans `docs/index.html`.

> Outil interne non officiel, non affilié à Linkfire. Il dépend de l’interface du site : si Linkfire la modifie, il faudra peut-être ajuster `content.js`. Le bouton *Copier le diagnostic* sert à ça.
