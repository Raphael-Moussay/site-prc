# Polytech Roule pour le Caritatif (PRC)

Site web événementiel pour le défi solidaire « Polytech Roule pour le Caritatif ». Les 16 écoles du réseau Polytech se mobilisent afin de parcourir un maximum de kilomètres au profit des Restos du Cœur.

## 🌟 Fonctionnalités principales

- **Classement en direct** des écoles, mis à jour automatiquement via Appwrite Database.
- **Tableaux de bord dynamiques** : total global, nombre de trajets, progression par rapport aux objectifs.
- **Top 3 des trajets** de la journée et de la semaine.
- **Page dédiée par école** avec formulaire de déclaration de trajets, upload d’images vers Appwrite Storage et fil des publications récentes.
- **Design responsive** inspiré de la charte Polytech, header fixe, couleurs vives et typographie Poppins.
- **Navigation mobile optimisée** avec bouton « Menu » centré, header qui se masque lors du défilement et bouton « retour en haut » accessible.

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
│       ├── appwrite-config.js # À personnaliser avec vos identifiants Appwrite
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

Le serveur Vite ouvre l’application sur [http://localhost:5173](http://localhost:5173). Les fichiers HTML restent accessibles en fichiers statiques si requis (double-cliquez sur `index.html`).

Pour un build statique optimisé :

```bash
npm run build
npm run preview
```

## 🔌 Configuration Appwrite

1. Installez Appwrite (self-hosté ou Appwrite Cloud) puis créez un **project** dédié.
2. Dans la console Appwrite :
    - Créez une **base de données** contenant une collection `rides` avec les attributs suivants :
      - `schoolCode` (**string**, obligatoire, max 32)
      - `schoolName` (**string**, obligatoire, max 128)
      - `totalDistance` (**double**, obligatoire)
      - `proofs` (**string**, optionnel, max 2048)
      - `notes` (**string**, optionnel, max 512)
      - `createdAt` (**datetime**, obligatoire)
   - Ajoutez les index nécessaires :
     - **Index `bySchoolCode`** – type *Key*, attribut `schoolCode`, tri Ascendant, activer la pagination (cursor). Sert aux filtres par école.
     - **Index `byCreatedAt`** – type *Key*, attribut `createdAt`, tri Descendant, activer la pagination. Sert aux tris par date (classement du jour/semaine).
     - Dans l’onglet **Permissions** de la collection, autorisez les actions suivantes (mode prototype sans authentification) :
       - `Any` sur **Create** pour permettre la création de documents anonymes.
       - `Any` sur **Read** pour exposer le classement et les stats en lecture publique.
       - Laissez **Update/Delete** désactivés si les trajets n’ont pas à être modifiés par le public.
   - Créez un **bucket Storage** `proofs` avec les réglages suivants :
     - Nom et ID : `proofs` (laisser Appwrite générer l’ID puis le recopier dans `assets/js/appwrite-config.js`).
     - Activez **File Security** pour que les permissions par fichier définies dans le code soient appliquées.
     - Upload activé pour les navigateurs (Allow file upload / Create permission).
     - Taille max par fichier : 10 Mo (adapté aux captures d’écran).
     - Extensions autorisées : `png`, `jpg`, `jpeg`, `webp`.
     - Permissions (prototype) :
       - Lecture : `role:all`
       - Écriture : `role:all` *(ou restreindre à `role:users` si vous forcez la connexion)*
     - Activez la mise à disposition **File previews** pour permettre l’affichage direct dans le site.
3. Récupérez les identifiants (endpoint, projectId, databaseId, collectionId, bucketId) et remplissez `assets/js/appwrite-config.js`.
4. Configurez les permissions (`role:all` en lecture/écriture pour un prototype, à restreindre ensuite) et ajustez les CORS depuis le dashboard Appwrite.

## 🗃️ Modèle de données

- **Collection `rides`** (Appwrite)
  - `schoolCode` (string, max 32) – identifiant court de l’école (ex: `lille`).
  - `schoolName` (string, max 128) – nom complet pour l’affichage.
  - `totalDistance` (number) – somme des distances du ride.
  - `proofs` (string JSON, max 2048) – chaîne contenant un tableau de preuves `{ downloadUrl, storagePath, fileId, distance }`.
  - `notes` (string, max 512) – commentaire libre.
  - `createdAt` (datetime) – horodatage généré côté client (`new Date().toISOString()`).

> 💡 L’UI actuelle d’Appwrite ne propose pas encore de type « JSON ». Créez donc `proofs` en **String** (texte long), fixez la taille maximale à **2048 caractères** et laissez le champ optionnel. L’application sérialise automatiquement les preuves en JSON lors de l’écriture et les retransforme en tableau lors de la lecture.

> ⏱️ Pour `createdAt`, sélectionnez le type **Datetime** dans Appwrite. Le format attendu est ISO 8601 (RFC 3339) ; la valeur générée par `new Date().toISOString()` est parfaitement compatible.

Les classements sont calculés côté client à partir de cette collection Appwrite.

## 🧪 Tests & qualité

- Le projet est statique : aucun test automatisé n’est fourni par défaut.
- Recommandation : ajouter un linting HTML/CSS/JS (Prettier, ESLint) si vous industrialisez le projet.

## 🛠️ Personnalisation

- Les objectifs kilométriques par école sont définis dans `assets/js/core.js` et peuvent être ajustés.
- Les couleurs principales se trouvent dans `:root` de `assets/css/style.css`.
- Pour ajouter de nouvelles écoles, complétez simplement le tableau `schools` dans `core.js`.

## 📦 Déploiement

- Le projet peut être déployé sur Appwrite Cloud (hébergement statique) ou tout autre hébergeur de fichiers statiques (Firebase Hosting, GitHub Pages, Netlify, Vercel...).
- N’oubliez pas de protéger vos clefs Appwrite (restreindre les domaines autorisés et limiter les permissions).

## 🤝 Contributions

Les Pull Requests sont bienvenues ! Merci de décrire le contexte et de tester vos modifications avant soumission.
