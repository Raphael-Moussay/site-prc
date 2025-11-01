# Polytech Roule pour le Caritatif (PRC)

Site web événementiel pour le défi solidaire « Polytech Roule pour le Caritatif ». Les 16 écoles du réseau Polytech se mobilisent afin de parcourir un maximum de kilomètres au profit des Restos du Cœur.

## 🌟 Fonctionnalités principales

- Classement en direct des écoles (realtime) et tableaux de bord: total global, nombre de trajets, progression vs. objectif.
- Page dédiée par école avec formulaire de trajets, téléversement d’images (preuves) vers Appwrite Storage et fil des publications.
- Authentification email/mot de passe (messages en français) + publications anonymes possibles avec Nom/Prénom/Spécialité.
- Modération basée sur les permissions: propriétaire(s) et administrateurs par école peuvent modifier/supprimer.
- Édition rapide de l’objectif école (icône crayon), mise à jour immédiate des totaux et du classement.
- Design responsive (mobile-first), navigation mobile scrollable, header auto-masqué et bouton « retour en haut ».

> Remarque: aucune donnée sensible (IDs de projet, team IDs, etc.) n’apparaît dans ce README. Renseignez ces valeurs dans `assets/js/appwrite-config.js` (fichier local à vous, non documenté ici).

## 🗂️ Structure du projet

```
.
├── index.html                # Page d'accueil avec le classement global
├── school.html               # Gabarit unique pour les 16 écoles (URL ?code=...)
├── assets/
│   ├── css/
│   │   └── style.css        # Styles globaux et responsives
│   ├── images/
│   │   └── prc-logo.svg     # Logo de l'événement
│   └── js/
│       ├── app.js           # Logique de la page d'accueil
│       ├── core.js          # Helpers, intégration Appwrite, formatage
│       ├── appwrite-config.js # À personnaliser localement avec vos identifiants Appwrite
│       └── school.js        # Logique des pages école
├── package.json              # Scripts de développement (Vite)
└── README.md
```

## 🔧 Prérequis

- Node.js ≥ 18 (pour le serveur de développement Vite)
- Un projet Appwrite configuré (Database + Storage)
- Dépendances NPM installées via `npm install`

## 🚀 Démarrer le projet en local

```bash
npm install
npm run dev
```

Le serveur Vite ouvre l’application sur [http://localhost:5173](http://localhost:5173).

### Proxy de développement (Appwrite Cloud)

Ce projet inclut une configuration de proxy (Vite) pour appeler l’API Appwrite Cloud via `/v1` en local. Le proxy réécrit les cookies afin de permettre les sessions sur `http://localhost`.

- Le proxy est défini dans `vite.config.js` (route `/v1`).
- Côté Appwrite, autorisez vos origines locales (localhost/127.0.0.1) dans les CORS du projet.
- Ce proxy est uniquement pour le développement local. En production, servez le site statiquement et appelez directement l’API Appwrite sur `https://cloud.appwrite.io/v1`.

Pour un build statique optimisé :

```bash
npm run build
npm run preview
```

## 🔌 Configuration Appwrite (sans secret)

1. Créez un projet Appwrite (self-hosté ou Cloud).
2. Base de données → Collection `rides` (trajets) avec attributs:
   - `schoolCode` (string, required, ≤32)
   - `schoolName` (string, required, ≤128)
   - `totalDistance` (double, required)
   - `proofs` (string, optional, ≤2048) — JSON sérialisé.
   - `notes` (string, optional, ≤512)
   - `createdAt` (datetime, required)
   Index:
   - `bySchoolCode` (Key, `schoolCode`, ASC)
   - `byCreatedAt` (Key, `createdAt`, DESC)
   Permissions (prototype/anon):
   - Create: `role:all`
   - Read: `role:all`
   - Update/Delete: donnez ces droits aux équipes d’administrateurs concernées (voir « Modération » ci‑dessous).
3. Storage → Bucket `proofs` (images de preuves):
   - Extensions: png, jpg, jpeg, webp — Taille max 10 Mo — File Security: ON
   - Permissions (prototype): Create/Read `role:all` (à restreindre si vous forcez l’authentification)
   - Activez les « File previews »
4. Renseignez vos identifiants dans `assets/js/appwrite-config.js` (endpoint, projectId, databaseId, ridesCollectionId, proofsBucketId, schoolSettingsCollectionId). Utilisez des placeholders en commit public; gardez vos valeurs réelles en privé.
5. CORS: autorisez vos origines (localhost pour dev, domaine(s) de prod) depuis le dashboard Appwrite. Aucun `cors.json` n’est utilisé dans ce repo.

## 🗃️ Modèle de données

- **Collection `rides`** (Appwrite)
  - `schoolCode` (string, max 32) – identifiant court de l’école (ex: `lille`).
  - `schoolName` (string, max 128) – nom complet pour l’affichage.
  - `totalDistance` (number) – somme des distances du ride.
  - `proofs` (string JSON, max 2048) – chaîne contenant un tableau de preuves `{ downloadUrl, storagePath, fileId, distance }`.
  - `notes` (string, max 512) – commentaire libre.
  - `createdAt` (datetime) – horodatage généré côté client (`new Date().toISOString()`).

Chaque preuve porte sa distance propre; l’interface additionne ces distances pour afficher le total du trajet et montre la distance de chaque preuve sous l’image correspondante.

> 💡 L’UI actuelle d’Appwrite ne propose pas encore de type « JSON ». Créez donc `proofs` en **String** (texte long), fixez la taille maximale à **2048 caractères** et laissez le champ optionnel. L’application sérialise automatiquement les preuves en JSON lors de l’écriture et les retransforme en tableau lors de la lecture.

> ⏱️ Pour `createdAt`, sélectionnez le type **Datetime** dans Appwrite. Le format attendu est ISO 8601 (RFC 3339) ; la valeur générée par `new Date().toISOString()` est parfaitement compatible.

Les classements sont calculés côté client à partir de cette collection Appwrite.

## 🔒 Authentification & publication anonyme

- Auth supportée: email/mot de passe (UI en français). Pas d’OAuth Google dans ce projet.
- Publications anonymes: si l’utilisateur n’est pas connecté, le formulaire exige Nom, Prénom et Spécialité; ces valeurs sont stockées avec le trajet.

## 🛡️ Modération (équipes)

- Créez une équipe « propriétaire » (ou utilisez la vôtre) et des équipes « admins » par école côté Appwrite.
- Donnez les droits Update/Delete sur la collection `rides` aux équipes concernées (global + par école).
- Dans `assets/js/appwrite-config.js`, mappez les codes écoles → IDs de team (`schoolAdminTeams`). Vous pouvez aussi définir une liste d’emails propriétaires `ownerEmails` pour un fallback côté UI.

## 🧪 Tests & qualité

- Le projet est statique : aucun test automatisé n’est fourni par défaut.
- Recommandation : ajouter un linting HTML/CSS/JS (Prettier, ESLint) si vous industrialisez le projet.

## 🛠️ Personnalisation

- Les objectifs kilométriques par école sont définis dans `assets/js/core.js` et peuvent être ajustés.
- Les couleurs principales se trouvent dans `:root` de `assets/css/style.css`.
- Pour ajouter de nouvelles écoles, complétez simplement le tableau `schools` dans `core.js`.

## 🔁 Realtime & rafraîchissements

- Le classement, les totaux par école et le flux de publications se mettent à jour en temps réel.
- Après une action utilisateur (publication, modification, suppression), le site force un rafraîchissement local pour éviter d’attendre l’événement realtime.

## 📦 Déploiement

- Le projet peut être déployé sur Appwrite Cloud (hébergement statique) ou tout autre hébergeur de fichiers statiques (Firebase Hosting, GitHub Pages, Netlify, Vercel...).
- N’oubliez pas de protéger vos clefs Appwrite: restreignez les domaines autorisés, limitez les permissions en prod et évitez de committer des identifiants sensibles.

## 🤝 Contributions

Les Pull Requests sont bienvenues ! Merci de décrire le contexte et de tester vos modifications avant soumission.
