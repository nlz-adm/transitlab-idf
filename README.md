# TransitLab Île-de-France

Carte interactive du réseau de transports en Île-de-France pour explorer le réseau existant (métro, RER, tramway, Transilien), les projets du Grand Paris Express, et **imaginer vos propres lignes**.

## Fonctionnalités

- **Exploration** : lignes ferrées, stations, correspondances, repères colorés et logos officiels.
- **Couches optionnelles** : densité de population, pôles d'emploi, établissements d'enseignement, communes, aéroports, centres commerciaux.
- **Création de lignes** : tracez une ligne hypothétique, raccordez-la aux gares existantes, personnalisez nom et couleur (logo généré automatiquement).
- **Exports** : GeoJSON, aperçu du tracé (PNG), plan schématique (SVG, PDF, impression).
- **Hors ligne** : service worker + cache IndexedDB.

## Architecture

Site 100 % statique (aucun backend, aucune dépendance d'exécution externe).

| Fichier | Rôle |
|---|---|
| `index.html` | Page d'accueil (présentation + carte intégrée) |
| `carte-interactive-ile-de-france.html` | Application cartographique |
| `assets/map-app.js` | Moteur de la carte (Leaflet) |
| `assets/map-boot.js` | Point d'entrée différé (chargement paresseux) |
| `assets/line-index-worker.js` | Web worker (index des tronçons partagés) |
| `sw.js` | Service worker (cache statique + données) |
| `assets/data-catalog.json` | Manifeste des couches de données |
| `assets/*.json` | Données géographiques (réseau, communes, population…) |
| `manifest.json` | Manifeste d'application web (PWA) |

## Développement

Aucune étape de build n'est requise. Lancez un serveur statique (le service worker et les modules ESM nécessitent HTTP) :

```bash
npx serve .
# ou : python -m http.server 8000
```

> Ouvrir `index.html` directement (`file://`) fonctionne pour la carte, mais le service worker et l'import des modules peuvent être restreints selon le navigateur.

## Déploiement

Hébergé sur GitHub Pages. Le dépôt est autonome : aucun réglage particulier requis. Publiez la branche `main` (ou `gh-pages`) dans les réglages du dépôt.

## Données & licences

Le **code** est distribué sous licence MIT (voir [`LICENSE`](LICENSE)). Les **données** et **fonds de carte** conservent leurs licences propres :

| Source | Contenu | Licence |
|---|---|---|
| Île-de-France Mobilités | Réseau en service | Licence Ouverte 2.0 |
| Société des grands projets | Gares du Grand Paris Express | — |
| Métropole du Grand Paris | Tracés GPE | — |
| IGN | Fond de carte détaillé | © IGN |
| INSEE | Densité de population (population municipale 2022) | — |
| DGAC / aéroports | Repères aéroportuaires | — |
| Éducation nationale / enseignement supérieur | Établissements | Répertoires publics |

Leaflet est vendu localement sous licence BSD-2-Clause (voir `assets/leaflet.js`).
