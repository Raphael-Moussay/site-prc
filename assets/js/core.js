import { Client, Databases, Storage, Query, ID, Permission, Role, Account } from 'appwrite';
import { appwriteConfig, appwriteOptions } from './appwrite-config.js';

let clientInstance;
let databasesInstance;
let storageInstance;
let accountInstance;
let currentUser = null;
const authListeners = new Set();

const schools = [
  { code: 'angers', displayName: 'Polytech Angers', objective: 600 },
  { code: 'annecy', displayName: 'Polytech Annecy-Chambéry', objective: 650 },
  { code: 'clermont', displayName: 'Polytech Clermont-Ferrand', objective: 700 },
  { code: 'dijon', displayName: 'Polytech Dijon', objective: 500 },
  { code: 'grenoble', displayName: 'Polytech Grenoble', objective: 800 },
  { code: 'lille', displayName: 'Polytech Lille', objective: 750 },
  { code: 'lyon', displayName: 'Polytech Lyon', objective: 550 },
  { code: 'marseille', displayName: 'Polytech Marseille', objective: 650 },
  { code: 'montpellier', displayName: 'Polytech Montpellier', objective: 620 },
  { code: 'nancy', displayName: 'Polytech Nancy', objective: 600 },
  { code: 'nantes', displayName: 'Polytech Nantes - Gavy', objective: 630 },
  { code: 'nice', displayName: 'Polytech Nice Sophia', objective: 700 },
  { code: 'orleans', displayName: 'Polytech Orléans', objective: 580 },
  { code: 'paris', displayName: 'Polytech Paris-Saclay', objective: 720 },
  { code: 'sorbonne', displayName: 'Polytech Sorbonne', objective: 650 },
  { code: 'tours', displayName: 'Polytech Tours', objective: 560 },
];

let objectiveOverrides = new Map();
let schoolSettingsLoaded = false;
let schoolSettingsLoadingPromise = null;
let schoolSettingsRealtimeUnsubscribe = null;
let currentUserTeamIds = null; // Cache des IDs de teams de l'utilisateur courant
let currentUserTeamMeta = null; // { idsSet: Set<string>, namesSet: Set<string> }

function notifyAuthListeners() {
  authListeners.forEach((listener) => {
    try {
      listener(currentUser);
    } catch (error) {
      console.error('Erreur dans un listener auth Appwrite :', error);
    }
  });
}

function setCurrentUser(user) {
  const next = user ?? null;
  const prev = currentUser ?? null;
  // Ne notifie que si l'état change vraiment (évite les boucles avec 401 répétés)
  const prevId = typeof prev === 'object' && prev ? prev.$id ?? prev.id ?? null : null;
  const nextId = typeof next === 'object' && next ? next.$id ?? next.id ?? null : null;
  const changed = prevId !== nextId;
  currentUser = next;
  if (changed) notifyAuthListeners();
}

function account() {
  if (!accountInstance) {
    initializeAppwrite();
  }
  return accountInstance;
}

export function onAuthStateChange(callback) {
  if (typeof callback !== 'function') return () => {};
  authListeners.add(callback);
  callback(currentUser);
  return () => authListeners.delete(callback);
}

export function getCurrentUser() {
  return currentUser;
}

export async function loadCurrentUser({ force = false } = {}) {
  if (currentUser && !force) return currentUser;

  try {
    const user = await account().get();
    setCurrentUser(user);
    return user;
  } catch (error) {
    if (error?.code === 401 || error?.response?.code === 401) {
      // Marque comme non authentifié sans spammer les listeners si déjà null
      setCurrentUser(null);
      return null;
    }
    console.warn('Impossible de récupérer la session utilisateur Appwrite :', error);
    setCurrentUser(null);
    return null;
  }
}

function cleanAuthRedirectParams() {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
  const paramsToRemove = ['userId', 'secret', 'expire', 'state', 'auth', 'scope'];
    let mutated = false;
    paramsToRemove.forEach((param) => {
      if (url.searchParams.has(param)) {
        url.searchParams.delete(param);
        mutated = true;
      }
    });

    if (mutated) {
      const newSearch = url.searchParams.toString();
      const newUrl = `${url.pathname}${newSearch ? `?${newSearch}` : ''}${url.hash}`;
      window.history.replaceState({}, document.title, newUrl);
    }
  } catch (error) {
    console.warn('Impossible de nettoyer les paramètres OAuth Appwrite :', error);
  }
}

// OAuth Google retiré: l'application utilise désormais email/mot de passe

async function createEmailPasswordSession({ email, password }) {
  const apiPath = '/account/sessions/email';
  const sdkClient = client();
  const uri = new URL(`${sdkClient.config.endpoint}${apiPath}`);
  const headers = { 'content-type': 'application/json' };
  const payload = { email, password };

  return sdkClient.call('post', uri, headers, payload);
}

export async function loginWithEmailPassword({ email, password } = {}) {
  const normalizedEmail = (email ?? '').toString().trim().toLowerCase();
  const normalizedPassword = (password ?? '').toString();

  if (!normalizedEmail) {
    throw new Error("L'email est requis pour la connexion.");
  }

  if (!normalizedPassword) {
    throw new Error('Le mot de passe est requis pour la connexion.');
  }

  try {
    await createEmailPasswordSession({ email: normalizedEmail, password: normalizedPassword });
    await loadCurrentUser({ force: true });
    return getCurrentUser();
  } catch (error) {
    const response = error?.response ?? {};
    const code = error?.code ?? response.code;
    const message = error?.message ?? response.message ?? '';
    if (code === 401 || /invalid credentials/i.test(message)) {
      throw new Error('Email ou mot de passe invalide.');
    }
    throw toAppwriteError(error, 'Connexion impossible. Vérifiez vos identifiants.');
  }
}

export async function registerWithEmailPassword({ email, password, name } = {}) {
  const normalizedEmail = (email ?? '').toString().trim().toLowerCase();
  const normalizedPassword = (password ?? '').toString();
  const normalizedName = (name ?? '').toString().trim();

  if (!normalizedEmail) {
    throw new Error("L'email est requis pour créer un compte.");
  }

  if (!normalizedPassword || normalizedPassword.length < 8) {
    throw new Error('Le mot de passe doit contenir au moins 8 caractères.');
  }

  try {
    await account().create({
      userId: ID.unique(),
      email: normalizedEmail,
      password: normalizedPassword,
      name: normalizedName || undefined,
    });
  } catch (error) {
    throw toAppwriteError(error, "Impossible de créer le compte. L'email est peut-être déjà utilisé.");
  }

  await loginWithEmailPassword({ email: normalizedEmail, password: normalizedPassword });
  return getCurrentUser();
}

export async function logout() {
  try {
    await account().deleteSession('current');
  } catch (error) {
    console.warn('Impossible de supprimer la session Appwrite :', error);
  } finally {
    setCurrentUser(null);
  }
}

export function getUserDisplayName(user) {
  if (!user) return '';
  if (user.name?.trim()) return user.name.trim();
  const first = user.firstName?.trim() ?? '';
  const last = user.lastName?.trim() ?? '';
  const fallback = `${first} ${last}`.trim();
  if (fallback) return fallback;
  return user.email ?? user.$id ?? '';
}

async function requireAuthenticatedUser({ reason } = {}) {
  const existing = getCurrentUser();
  if (existing) return existing;

  const user = await loadCurrentUser({ force: true });
  if (user) return user;

  const defaultMessage = 'Connectez-vous pour continuer.';
  throw new Error(reason ?? defaultMessage);
}

function applySchoolSettings(documents = []) {
  const overrides = new Map();

  documents.forEach((document) => {
    const code = document.schoolCode ?? document.code ?? document.$id;
    if (!code) return;

    const rawObjective = document.objective ?? document.objectiveOverride;
    if (rawObjective == null) {
      overrides.delete(code);
      return;
    }

    const numericObjective = Number(rawObjective);
    if (Number.isNaN(numericObjective)) return;

    overrides.set(code, numericObjective);
  });

  objectiveOverrides = overrides;
  schoolSettingsLoaded = true;
}

function toAppwriteError(error, fallbackMessage) {

  if (error && typeof error === 'object') {
    const response = error.response ?? {};
    const code = error.code ?? response.code;
    const type = error.type ?? response.type;
    const message = error.message ?? response.message;
    const detailedErrors = response.errors ?? error.errors;

    if (code === 401) {
      // 401 peut provenir d'actions non autorisées sur des ressources
      return new Error("Action non autorisée. Vous n'avez pas les droits pour effectuer cette action.");
    }

    if (code === 409) {
      return new Error('Un compte existe déjà avec cet email. Essayez de vous connecter.');
    }

    if (code === 400 && type === 'general_argument_invalid') {
      return new Error('Vérifiez le format de vos informations (email valide, mot de passe ≥ 8 caractères).');
    }

    if (code === 400 && (type === 'general_bad_request' || (message && /there was an error processing your request/i.test(message)))) {
      return new Error('Impossible de traiter votre demande. Vérifiez vos informations et réessayez.');
    }

    if (code === 429 || (message && message.toLowerCase().includes('rate limit'))) {
      return new Error('Trop de tentatives sur une courte période. Réessayez dans quelques instants.');
    }

    if (code === 403 && message && message.toLowerCase().includes('disabled')) {
      return new Error("La connexion email/mot de passe est désactivée dans la console Appwrite.");
    }

    if (Array.isArray(detailedErrors) && detailedErrors.length) {
      const firstString = detailedErrors.find((entry) => typeof entry === 'string' && entry.trim());
      if (firstString) {
        // Traduction rapide des messages fréquents
        if (/invalid\s*email/i.test(firstString) || /valid email/i.test(firstString)) {
          return new Error('Email invalide. Utilisez une adresse valide.');
        }
        if (/password/i.test(firstString) && /least|minimum|8/i.test(firstString)) {
          return new Error('Le mot de passe doit contenir au moins 8 caractères.');
        }
        return new Error(firstString);
      }

      const firstMessage = detailedErrors
        .map((entry) => (entry && typeof entry === 'object' ? entry.message : null))
        .find((entry) => typeof entry === 'string' && entry.trim());
      if (firstMessage) {
        if (/invalid\s*email/i.test(firstMessage) || /valid email/i.test(firstMessage)) {
          return new Error('Email invalide. Utilisez une adresse valide.');
        }
        if (/password/i.test(firstMessage) && /least|minimum|8/i.test(firstMessage)) {
          return new Error('Le mot de passe doit contenir au moins 8 caractères.');
        }
        return new Error(firstMessage);
      }
    }

    if (detailedErrors && typeof detailedErrors === 'object' && !Array.isArray(detailedErrors)) {
      const firstKey = Object.keys(detailedErrors).find(Boolean);
      if (firstKey) {
        const value = detailedErrors[firstKey];
        if (Array.isArray(value) && value.length) {
          const first = value.find((entry) => typeof entry === 'string' && entry.trim());
          if (first) {
            if (/invalid\s*email/i.test(first) || /valid email/i.test(first)) {
              return new Error('Email invalide. Utilisez une adresse valide.');
            }
            if (/password/i.test(first) && /least|minimum|8/i.test(first)) {
              return new Error('Le mot de passe doit contenir au moins 8 caractères.');
            }
            return new Error(first);
          }
        }
        if (typeof value === 'string' && value.trim()) {
          if (/invalid\s*email/i.test(value) || /valid email/i.test(value)) {
            return new Error('Email invalide. Utilisez une adresse valide.');
          }
          if (/password/i.test(value) && /least|minimum|8/i.test(value)) {
            return new Error('Le mot de passe doit contenir au moins 8 caractères.');
          }
          return new Error(value);
        }
      }
    }

    if (message) {
      // Traduire quelques messages génériques
      if (/there was an error processing your request/i.test(message) || type === 'general_bad_request') {
        return new Error('Impossible de traiter votre demande. Vérifiez vos informations et réessayez.');
      }
      if (/invalid\s*email/i.test(message) || /valid email/i.test(message)) {
        return new Error('Email invalide. Utilisez une adresse valide.');
      }
      if (/invalid credentials/i.test(message)) {
        return new Error('Email ou mot de passe invalide.');
      }
      if (/password/i.test(message) && /least|minimum|8/i.test(message)) {
        return new Error('Le mot de passe doit contenir au moins 8 caractères.');
      }
      return new Error(message);
    }
  }

  return new Error(fallbackMessage);
}

async function listAllSchoolSettingsDocuments(databaseId, collectionId) {
  const documents = [];
  let cursor = null;
  let hasMore = true;

  while (hasMore) {
    const queries = [Query.limit(100)];
    if (cursor) {
      queries.push(Query.cursorAfter(cursor));
    }

    const response = await databases().listDocuments(databaseId, collectionId, queries);
    const batch = response.documents ?? [];
    documents.push(...batch);

    if (batch.length < 100) {
      hasMore = false;
    } else {
      cursor = batch[batch.length - 1].$id;
    }
  }

  return documents;
}

function withObjectiveOverride(school) {
  if (!school) return undefined;
  const override = objectiveOverrides.get(school.code);
  return override != null ? { ...school, objective: Number(override) } : { ...school };
}

function getObjectiveOverride(code) {
  const value = objectiveOverrides.get(code);
  return value != null ? Number(value) : undefined;
}

function getAdminTeamIdsForSchool(schoolCode) {
  const teams = [];
  const schoolTeams = appwriteConfig.schoolAdminTeams ?? {};
  const teamId = schoolTeams[schoolCode];
  if (teamId) {
    teams.push(teamId);
  }
  return teams;
}

async function loadCurrentUserTeamIds() {
  // Retourne un Set des teamIds pour lesquels l'utilisateur courant est membre
  if (currentUserTeamIds instanceof Set) return currentUserTeamIds;
  // Si pas d'utilisateur connecté, renvoie un Set vide sans appeler l'API
  const user = getCurrentUser();
  if (!user) {
    currentUserTeamIds = new Set();
    currentUserTeamMeta = { idsSet: new Set(), namesSet: new Set() };
    return currentUserTeamIds;
  }

  // Certains environnements peuvent exposer les memberships dans l'objet user
  const direct = Array.isArray(user?.memberships) ? user.memberships : Array.isArray(user?.$memberships) ? user.$memberships : null;
  let memberships = Array.isArray(direct) ? direct : [];

  if (!memberships.length) {
    try {
      if (typeof account().listMemberships === 'function') {
        const result = await account().listMemberships();
        memberships = Array.isArray(result?.memberships) ? result.memberships : Array.isArray(result) ? result : [];
      } else {
        // API indisponible dans ce SDK, on continue avec une liste vide sans lever d'erreur
        memberships = [];
      }
    } catch (e) {
      console.warn("Impossible de récupérer les équipes de l'utilisateur :", e);
      memberships = [];
    }
  }

  const ids = memberships
    .map((m) => m?.teamId ?? m?.team?.$id ?? m?.team?.id ?? null)
    .filter((v) => typeof v === 'string' && v.trim().length);

  const names = memberships
    .map((m) => m?.team?.name ?? m?.teamName ?? null)
    .filter((v) => typeof v === 'string' && v.trim().length)
    .map((v) => v.toLowerCase());

  currentUserTeamIds = new Set(ids);
  currentUserTeamMeta = { idsSet: new Set(ids), namesSet: new Set(names) };
  return currentUserTeamIds;
}

async function getAssignableAdminTeamIdsForSchool(schoolCode) {
  // Intersecte les équipes admin configurées avec les équipes du user (Appwrite n'autorise à accorder que ses propres rôles)
  const configured = getAdminTeamIdsForSchool(schoolCode);
  if (!configured.length) return [];
  // Si pas d'utilisateur connecté, inutile d'interroger les memberships
  if (!getCurrentUser()) return [];
  let userTeams = null;
  try {
    userTeams = await loadCurrentUserTeamIds();
  } catch (e) {
    userTeams = new Set();
  }
  return configured.filter((teamId) => userTeams.has(teamId));
}

// Détermine les capacités d'administration pour l'utilisateur courant
async function userHasTeam(teamOrName) {
  if (!teamOrName) return false;
  try {
    await loadCurrentUserTeamIds();
    const idsSet = currentUserTeamMeta?.idsSet ?? currentUserTeamIds ?? new Set();
    if (idsSet.has(teamOrName)) return true;
    const namesSet = currentUserTeamMeta?.namesSet ?? new Set();
    return typeof teamOrName === 'string' && namesSet.has(teamOrName.toLowerCase());
  } catch {
    return false;
  }
}

export async function isOwner() {
  const ownerTeamId = appwriteConfig.globalAdminTeamId;
  // 1) Tentative via teams/memberships
  if (ownerTeamId && (await userHasTeam(ownerTeamId))) return true;
  // 2) Fallback via email si configuré
  try {
    const user = getCurrentUser();
    if (!user) return false;
    const email = (user?.email || '').toLowerCase();
    const list = Array.isArray(appwriteConfig.ownerEmails) ? appwriteConfig.ownerEmails : [];
    return list.map((e) => String(e).toLowerCase()).includes(email);
  } catch {
    return false;
  }
}

export async function isSchoolAdmin(schoolCode) {
  if (!schoolCode) return false;
  // 1) Propriétaire a tous les droits
  if (await isOwner()) return true;
  // 2) Tentative via team de l'école
  const schoolTeamId = (appwriteConfig.schoolAdminTeams ?? {})[schoolCode];
  if (await userHasTeam(schoolTeamId)) return true;
  // 3) Fallback via email si configuré
  try {
    const user = getCurrentUser();
    if (!user) return false;
    const email = (user?.email || '').toLowerCase();
    const map = appwriteConfig.schoolAdminEmails ?? {};
    const list = Array.isArray(map[schoolCode]) ? map[schoolCode] : [];
    return list.map((e) => String(e).toLowerCase()).includes(email);
  } catch {
    return false;
  }
}

export async function canManageSchool(schoolCode) {
  // Si pas connecté, inutile de faire des vérifications supplémentaires
  if (!getCurrentUser()) return false;
  return isSchoolAdmin(schoolCode);
}

function buildAdminDocumentPermissions(schoolCode, actions = ['update', 'delete']) {
  const teams = getAdminTeamIdsForSchool(schoolCode);
  if (!teams.length) return [];

  return teams.flatMap((teamId) =>
    actions
      .map((action) => {
        if (action === 'update') return Permission.update(Role.team(teamId));
        if (action === 'delete') return Permission.delete(Role.team(teamId));
        if (action === 'read') return Permission.read(Role.team(teamId));
        if (action === 'write') return Permission.create(Role.team(teamId));
        return null;
      })
      .filter(Boolean)
  );
}

export function initializeAppwrite() {
  if (clientInstance) return clientInstance;

  if (!appwriteConfig?.endpoint || appwriteConfig.endpoint.includes('example.com')) {
    console.warn("Appwrite n'est pas configuré. Renseignez vos identifiants dans appwrite-config.js");
  }

  clientInstance = new Client();

  const { devProxy } = appwriteConfig ?? {};
  let endpointToUse = appwriteConfig.endpoint;

  if (typeof window !== 'undefined' && devProxy?.enabled) {
    const origin = window.location.origin;
    const allowedOrigins = Array.isArray(devProxy.allowedOrigins) ? devProxy.allowedOrigins : [];
    const shouldUseProxy = !allowedOrigins.length || allowedOrigins.includes(origin);

    if (shouldUseProxy && typeof devProxy.path === 'string' && devProxy.path.length) {
      const normalizedPath = devProxy.path.startsWith('/') ? devProxy.path : `/${devProxy.path}`;
      endpointToUse = `${origin}${normalizedPath}`;
    }

    try {
      const usingProxy = endpointToUse !== appwriteConfig.endpoint;
      console.info(
        `[PRC] Appwrite endpoint: ${endpointToUse} (proxy: ${usingProxy ? 'on' : 'off'}), origin: ${origin}`
      );
    } catch (_) {
      // ignore console errors
    }
  }

  clientInstance.setEndpoint(endpointToUse);
  clientInstance.setProject(appwriteConfig.projectId);

  databasesInstance = new Databases(clientInstance);
  storageInstance = new Storage(clientInstance);
  accountInstance = new Account(clientInstance);

  cleanAuthRedirectParams();
  loadCurrentUser().catch((error) => {
    console.warn('Impossible de charger la session utilisateur Appwrite au démarrage :', error);
  });

  // Diagnostic léger: ping de l'API pour aider au debug en production
  if (typeof window !== 'undefined') {
    try {
      const healthUrl = `${clientInstance.config.endpoint.replace(/\/$/, '')}/health/version`;
      fetch(healthUrl, { credentials: 'include' })
        .then(async (res) => {
          const text = await res.text().catch(() => '');
          console.info('[PRC] Health check', res.status, res.ok ? 'OK' : 'FAIL', text || '');
        })
        .catch((err) => console.warn('[PRC] Health check error', err));
    } catch (e) {
      // noop
    }
  }

  if (appwriteConfig.schoolSettingsCollectionId) {
    loadSchoolSettings().catch((error) => {
      console.warn('Impossible de charger les paramètres écoles Appwrite au démarrage :', error);
    });

    if (appwriteOptions.enableRealtime && !schoolSettingsRealtimeUnsubscribe) {
      const channel = `databases.${appwriteConfig.databaseId}.collections.${appwriteConfig.schoolSettingsCollectionId}.documents`;
      schoolSettingsRealtimeUnsubscribe = clientInstance.subscribe(channel, () => {
        loadSchoolSettings({ force: true }).catch((error) => {
          console.error('Erreur Appwrite (paramètres écoles temps réel) :', error);
        });
      });
    }
  }

  return clientInstance;
}

function client() {
  return clientInstance ?? initializeAppwrite();
}

function databases() {
  if (!databasesInstance) initializeAppwrite();
  return databasesInstance;
}

function storage() {
  if (!storageInstance) initializeAppwrite();
  return storageInstance;
}

export function getSchools() {
  return schools.map((school) => withObjectiveOverride(school));
}

export function getSchoolByCode(code) {
  const base = schools.find((school) => school.code === code);
  return withObjectiveOverride(base);
}

export function getSchoolObjective(code) {
  const override = getObjectiveOverride(code);
  if (override != null) return override;
  return schools.find((school) => school.code === code)?.objective ?? 0;
}

export async function loadSchoolSettings({ force = false } = {}) {
  if (!appwriteConfig?.databaseId || !appwriteConfig?.schoolSettingsCollectionId) {
    return;
  }

  if (schoolSettingsLoaded && !force) return;
  if (schoolSettingsLoadingPromise) return schoolSettingsLoadingPromise;

  const databaseId = appwriteConfig.databaseId;
  const collectionId = appwriteConfig.schoolSettingsCollectionId;

  schoolSettingsLoadingPromise = (async () => {
    try {
      const documents = await listAllSchoolSettingsDocuments(databaseId, collectionId);
      applySchoolSettings(documents);
    } catch (error) {
      schoolSettingsLoaded = false;
      if (force) throw error;
      console.warn('Impossible de récupérer les paramètres écoles Appwrite :', error);
    } finally {
      schoolSettingsLoadingPromise = null;
    }
  })();

  return schoolSettingsLoadingPromise;
}

export async function setSchoolObjective({ schoolCode, objective }) {
  const normalizedCode = (schoolCode ?? '').toString().trim();
  if (!normalizedCode) {
    throw new Error("Le code école est requis pour mettre à jour l'objectif.");
  }

  const numericObjective = Number(objective);
  if (!Number.isFinite(numericObjective) || numericObjective < 0) {
    throw new Error("L'objectif doit être un nombre positif ou nul.");
  }

  if (!appwriteConfig?.databaseId || !appwriteConfig?.schoolSettingsCollectionId) {
    throw new Error("La collection des paramètres écoles n'est pas configurée.");
  }

  const databaseId = appwriteConfig.databaseId;
  const collectionId = appwriteConfig.schoolSettingsCollectionId;
  const documentId = normalizedCode;

  // On tente plusieurs variantes pour couvrir les schémas possibles:
  // - objective (double requis)
  // - objectiveOverride (fallback si le schéma utilise ce nom)
  // - avec et sans schoolCode, car certaines configurations exigent schoolCode comme attribut requis
  const payloadVariants = [
    { objective: numericObjective, schoolCode: normalizedCode },
    { objective: numericObjective },
    { objectiveOverride: numericObjective, schoolCode: normalizedCode },
    { objectiveOverride: numericObjective },
  ];

  const permissions = [
    Permission.read(Role.any()),
    // Autoriser les équipes admin à lire, mettre à jour et supprimer (la création se gère au niveau collection)
    ...buildAdminDocumentPermissions(normalizedCode, ['read', 'update', 'delete']),
  ];

  try {
    // Tente une mise à jour avec les variantes de champ
    let updated = false;
    for (const variant of payloadVariants) {
      try {
        await databases().updateDocument(databaseId, collectionId, documentId, variant);
        updated = true;
        break;
      } catch (e) {
        // continue avec la variante suivante
      }
    }
    if (!updated) {
      // Si aucune mise à jour n'a fonctionné, propage l'erreur initiale pour enclencher le create
      throw { code: 404 };
    }
  } catch (error) {
    if (error?.code === 404 || error?.response?.code === 404) {
      // Le document n'existe pas: tente la création avec les variantes
      let created = false;
      let lastError = null;
      for (const variant of payloadVariants) {
        try {
          await databases().createDocument(databaseId, collectionId, documentId, variant, permissions);
          created = true;
          break;
        } catch (createError) {
          lastError = createError;
        }
      }
      if (!created) {
        // Message plus précis pour aider au diagnostic de schéma Appwrite
        const hint = "Impossible de créer l'objectif. Vérifiez la collection 'school-settings' : attribut 'objective' (double) requis, et si 'schoolCode' est requis, il doit être de type string et ≤ 16 caractères. Assurez aussi les droits Create au niveau collection pour vos équipes.";
        throw toAppwriteError(lastError, hint);
      }
    } else {
      const hint = "Impossible de mettre à jour l'objectif. Vérifiez que l'attribut ('objective' ou 'objectiveOverride') existe et est de type nombre.";
      throw toAppwriteError(error, hint);
    }
  }

  await loadSchoolSettings({ force: true });
  return getSchoolByCode(normalizedCode);
}

export function formatDistance(value) {
  const number = Number(value) || 0;
  return `${Intl.NumberFormat('fr-FR', { minimumFractionDigits: number >= 100 ? 0 : 1, maximumFractionDigits: 1 }).format(number)} km`;
}

export function formatDateTime(dateLike) {
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export async function uploadProof({ schoolCode, file }) {
  // Autoriser l'upload même sans session: on adapte les permissions
  // Ne pas déclencher d'appel réseau vers /account si l'utilisateur n'est pas déjà connu
  let user = getCurrentUser() || null;
  const safeName = file.name.replace(/[^a-z0-9.\-]/gi, '_').toLowerCase();
  const uniqueId = ID.unique();
  const storagePath = `${schoolCode}/${uniqueId}_${safeName}`;
  const teamIds = await getAssignableAdminTeamIdsForSchool(schoolCode);
  const filePermissions = [
    Permission.read(Role.any()),
    // Si utilisateur connecté: il peut gérer son fichier
    ...(user ? [Permission.update(Role.user(user.$id)), Permission.delete(Role.user(user.$id))] : []),
    // Dans tous les cas: les équipes admin peuvent gérer
    ...teamIds.flatMap((teamId) => [
      Permission.update(Role.team(teamId)),
      Permission.delete(Role.team(teamId)),
    ]),
  ];

  const response = await storage().createFile(
    appwriteConfig.proofsBucketId,
    uniqueId,
    file,
    filePermissions
  );

  const downloadUrl = storage()
    .getFileView(appwriteConfig.proofsBucketId, response.$id)
    .toString();

  return { storagePath, fileId: response.$id, downloadUrl };
}

export async function createRide({ schoolCode, schoolName, totalDistance, proofs, notes, createdAt, firstName, lastName, speciality }) {
  // Essayer de récupérer l'utilisateur (sans nouvel appel réseau si non chargé)
  let user = getCurrentUser() || null;
  const authorName = user ? getUserDisplayName(user) : [firstName, lastName].filter(Boolean).join(' ').trim();
  const documentId = ID.unique();
  const teamIds = await getAssignableAdminTeamIdsForSchool(schoolCode);
  const serializedProofs = Array.isArray(proofs)
    ? JSON.stringify(
        proofs.map((proof) => ({
          storagePath: proof.storagePath,
          fileId: proof.fileId,
          downloadUrl: proof.downloadUrl,
          distance: Number(proof.distance) || 0,
        }))
      )
    : JSON.stringify([]);
  const payload = {
    schoolCode,
    schoolName,
    totalDistance,
    proofs: serializedProofs,
    notes: notes || '',
    createdAt: (createdAt || new Date()).toISOString(),
    authorId: user ? user.$id : null,
    authorName,
    authorEmail: user?.email ?? '',
    firstName: user ? undefined : (firstName ?? ''),
    lastName: user ? undefined : (lastName ?? ''),
    speciality: user ? undefined : (speciality ?? ''),
  };

  const permissions = [
    Permission.read(Role.any()),
    // Si utilisateur connecté: il peut modifier/supprimer sa publication
    ...(user ? [Permission.update(Role.user(user.$id)), Permission.delete(Role.user(user.$id))] : []),
    // Les équipes admin gèrent toujours
    ...teamIds.flatMap((teamId) => [
      Permission.update(Role.team(teamId)),
      Permission.delete(Role.team(teamId)),
    ]),
  ];

  await databases().createDocument(
    appwriteConfig.databaseId,
    appwriteConfig.ridesCollectionId,
    documentId,
    payload,
    permissions
  );

  return documentId;
}

// Mise à jour d'une publication (trajet)
export async function updateRide(rideId, fields) {
  if (!rideId) throw new Error("Identifiant de publication manquant.");
  try {
    await databases().updateDocument(
      appwriteConfig.databaseId,
      appwriteConfig.ridesCollectionId,
      rideId,
      fields
    );
  } catch (error) {
    throw toAppwriteError(error, 'Impossible de modifier la publication.');
  }
}

// Suppression d'une publication (trajet)
export async function deleteRide(rideId) {
  if (!rideId) throw new Error("Identifiant de publication manquant.");
  try {
    // Important: pour que les équipes admin/owner puissent supprimer n'importe quelle publication,
    // configurez la collection "rides" en permissions au niveau de la collection (update/delete)
    // pour les équipes concernées, OU mettez en place une fonction backend qui ajoute ces permissions
    // aux documents après création. Sinon, un utilisateur ne peut pas accorder des rôles qu'il ne possède pas.
    await databases().deleteDocument(
      appwriteConfig.databaseId,
      appwriteConfig.ridesCollectionId,
      rideId
    );
  } catch (error) {
    throw toAppwriteError(error, 'Impossible de supprimer la publication.');
  }
}

export function subscribeToLeaderboard({ onTotalsUpdate, onLeaderboardUpdate, onDailyTop, onWeeklyTop }) {
  const cancelRealtime = appwriteOptions.enableRealtime
    ? client().subscribe(
        `databases.${appwriteConfig.databaseId}.collections.${appwriteConfig.ridesCollectionId}.documents`,
        () =>
          refreshLeaderboard({ onTotalsUpdate, onLeaderboardUpdate, onDailyTop, onWeeklyTop }).catch((error) => {
            console.error('Erreur Appwrite (leaderboard temps réel) :', error);
          })
      )
    : () => {};

  refreshLeaderboard({ onTotalsUpdate, onLeaderboardUpdate, onDailyTop, onWeeklyTop }).catch((error) => {
    console.error('Impossible de récupérer le classement Appwrite :', error);
  });

  return () => cancelRealtime();
}

export function listenToSchoolTotals(schoolCode, callback) {
  const handler = () =>
    aggregateTotalsForSchool(schoolCode, callback).catch((error) => {
      console.error(`Erreur Appwrite (stats temps réel ${schoolCode}) :`, error);
    });

  let unsubscribes = [];

  if (appwriteOptions.enableRealtime) {
    // 1) Rafraîchir sur tout changement de trajets (impacte total distance et count)
    const unsubRides = client().subscribe(
      `databases.${appwriteConfig.databaseId}.collections.${appwriteConfig.ridesCollectionId}.documents`,
      handler
    );
    unsubscribes.push(unsubRides);

    // 2) Rafraîchir aussi sur changement des paramètres d'école (objectif personnalisé)
    if (appwriteConfig.schoolSettingsCollectionId) {
      const unsubSettings = client().subscribe(
        `databases.${appwriteConfig.databaseId}.collections.${appwriteConfig.schoolSettingsCollectionId}.documents`,
        handler
      );
      unsubscribes.push(unsubSettings);
    }
  }

  // Exécution initiale
  handler();

  return () => {
    unsubscribes.forEach((u) => {
      try {
        typeof u === 'function' ? u() : u?.();
      } catch {}
    });
    unsubscribes = [];
  };
}

export async function fetchRecentRides(schoolCode, { limitCount = 6 } = {}) {
  const response = await databases().listDocuments(appwriteConfig.databaseId, appwriteConfig.ridesCollectionId, [
    Query.equal('schoolCode', schoolCode),
    Query.orderDesc('createdAt'),
    Query.limit(limitCount),
  ]);

  return response.documents.map((doc) => normalizeRide(doc.$id, doc));
}

// Recalcule une fois les totaux pour une école (sans abonnement)
export async function getSchoolTotals(schoolCode) {
  try {
    await loadSchoolSettings();
  } catch {}

  const response = await databases().listDocuments(appwriteConfig.databaseId, appwriteConfig.ridesCollectionId, [
    Query.equal('schoolCode', schoolCode),
    Query.orderDesc('createdAt'),
    Query.limit(200),
  ]);

  let totalDistance = 0;
  let ridesCount = 0;

  response.documents.forEach((doc) => {
    const ride = normalizeRide(doc.$id, doc);
    totalDistance += ride.totalDistance;
    ridesCount += 1;
  });

  const objective = getSchoolByCode(schoolCode)?.objective ?? 0;
  return { totalDistance, ridesCount, objective };
}

async function refreshLeaderboard({ onTotalsUpdate, onLeaderboardUpdate, onDailyTop, onWeeklyTop }) {
  try {
    await loadSchoolSettings();
  } catch (error) {
    console.warn('Impossible de synchroniser les objectifs personnalisés avant le rafraîchissement du classement :', error);
  }

  const response = await databases().listDocuments(appwriteConfig.databaseId, appwriteConfig.ridesCollectionId, [
    Query.orderDesc('createdAt'),
    Query.limit(200),
  ]);

  const totals = new Map();
  const daily = [];
  const weekly = [];
  const now = new Date();

  response.documents.forEach((document) => {
    const ride = normalizeRide(document.$id, document);

    if (!totals.has(ride.schoolCode)) {
      totals.set(ride.schoolCode, { distance: 0, rides: 0 });
    }

    const schoolTotal = totals.get(ride.schoolCode);
    schoolTotal.distance += ride.totalDistance;
    schoolTotal.rides += 1;

    if (isSameDay(ride.createdAt, now)) {
      daily.push(ride);
    }
    if (isSameWeek(ride.createdAt, now)) {
      weekly.push(ride);
    }
  });

  const leaderboard = buildLeaderboard(totals);
  const globalKilometers = leaderboard.reduce((acc, row) => acc + row.totalDistance, 0);
  const ridesCount = Array.from(totals.values()).reduce((acc, value) => acc + value.rides, 0);

  onTotalsUpdate?.({ globalKilometers, ridesCount });
  onLeaderboardUpdate?.(leaderboard);
  onDailyTop?.(daily.sort(sortByDistance).slice(0, 3));
  onWeeklyTop?.(weekly.sort(sortByDistance).slice(0, 3));
}

async function aggregateTotalsForSchool(schoolCode, callback) {
  try {
    await loadSchoolSettings();
  } catch (error) {
    console.warn(`Impossible de synchroniser les objectifs personnalisés pour ${schoolCode} :`, error);
  }

  const response = await databases().listDocuments(appwriteConfig.databaseId, appwriteConfig.ridesCollectionId, [
    Query.equal('schoolCode', schoolCode),
    Query.orderDesc('createdAt'),
    Query.limit(200),
  ]);

  let totalDistance = 0;
  let ridesCount = 0;

  response.documents.forEach((doc) => {
    const ride = normalizeRide(doc.$id, doc);
    totalDistance += ride.totalDistance;
    ridesCount += 1;
  });

  const objective = getSchoolByCode(schoolCode)?.objective ?? 0;
  callback?.({ totalDistance, ridesCount, objective });
}

function normalizeRide(id, data) {
  const createdAt = data.createdAt ? new Date(data.createdAt) : new Date();
  const proofs = deserializeProofs(data.proofs);
  const permissions = Array.isArray(data.$permissions) ? data.$permissions.slice() : [];
  return {
    id,
    schoolCode: data.schoolCode,
    schoolName: data.schoolName,
    totalDistance: Number(data.totalDistance) || 0,
    authorId: data.authorId ?? null,
    authorName: data.authorName ?? '',
    authorEmail: data.authorEmail ?? '',
    speciality: data.speciality ?? '',
    proofs: proofs.map((proof) => ({
      storagePath: proof.storagePath,
      fileId: proof.fileId,
      downloadUrl: proof.downloadUrl,
      distance: Number(proof.distance) || 0,
    })),
    notes: data.notes ?? '',
    createdAt,
    permissions,
  };
}

function deserializeProofs(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.warn('Impossible de parser les proofs Appwrite', error);
      return [];
    }
  }
  return [];
}

function buildLeaderboard(totals) {
  return getSchools()
    .map((school) => {
      const schoolTotals = totals.get(school.code) ?? { distance: 0, rides: 0 };
      const progress = school.objective ? Math.min(100, Math.round((schoolTotals.distance / school.objective) * 100)) : 0;
      return {
        code: school.code,
        displayName: school.displayName,
        totalDistance: schoolTotals.distance,
        rides: schoolTotals.rides,
        objective: school.objective,
        progressPercentage: progress,
      };
    })
    .sort((a, b) => b.totalDistance - a.totalDistance);
}

function isSameDay(dateA, dateB) {
  return (
    dateA.getFullYear() === dateB.getFullYear() &&
    dateA.getMonth() === dateB.getMonth() &&
    dateA.getDate() === dateB.getDate()
  );
}

function isSameWeek(dateA, dateB) {
  const startOfWeek = getStartOfWeek(dateB);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 7);
  return dateA >= startOfWeek && dateA < endOfWeek;
}

function getStartOfWeek(date) {
  const result = new Date(date);
  const day = result.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // ISO week starts on Monday
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() + diff);
  return result;
}

function sortByDistance(a, b) {
  return b.totalDistance - a.totalDistance;
}

export function setupHeaderAutoHide({ breakpoint = 900, threshold = 12 } = {}) {
  const header = document.querySelector('.site-header');
  if (!header) return;

  const body = document.body;
  const navLinks = document.querySelector('.nav-links');
  const toggle = document.querySelector('.nav-toggle');
  const mediaQuery = window.matchMedia(`(max-width: ${breakpoint}px)`);
  // Dedicated mobile query to disable auto-hide on true mobile
  const mobileQuery = window.matchMedia('(max-width: 720px)');

  let lastScrollY = window.scrollY;
  let hidden = false;
  let ticking = false;

  function showHeader() {
    if (!hidden) return;
    hidden = false;
    header.classList.remove('is-hidden');
    body.classList.remove('header-hidden');
  }

  function hideHeader() {
    if (hidden) return;
    hidden = true;
    header.classList.add('is-hidden');
    body.classList.add('header-hidden');
    if (toggle && navLinks) {
      toggle.setAttribute('aria-expanded', 'false');
      navLinks.classList.remove('open');
    }
  }

  function handleScroll() {
    // Si le menu des écoles est ouvert, conserver le header visible
    const navOpen = navLinks && navLinks.classList.contains('open');
    if (navOpen) {
      showHeader();
      lastScrollY = window.scrollY;
      return;
    }

    const currentY = window.scrollY;
    const delta = currentY - lastScrollY;

    // Sur mobile, on désactive l'auto-hide: le header se comporte comme le reste de la page
    if (mobileQuery.matches) {
      showHeader();
      lastScrollY = currentY;
      return;
    }

    if (!mediaQuery.matches) {
      showHeader();
      lastScrollY = currentY;
      return;
    }

    if (Math.abs(delta) < threshold) {
      lastScrollY = currentY;
      return;
    }

    if (delta > 0 && currentY > header.offsetHeight + 40) {
      hideHeader();
    } else if (delta < 0 || currentY <= header.offsetHeight + 10) {
      showHeader();
    }

    lastScrollY = currentY;
  }

  function requestTick() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(() => {
      handleScroll();
      ticking = false;
    });
  }

  const onMediaChange = () => {
    // Toujours afficher le header quand on sort du mode petit écran
    if (!mediaQuery.matches) {
      showHeader();
    }
    // Et sur mobile (<=720px), on force l'affichage et on ne cache jamais
    if (mobileQuery.matches) {
      showHeader();
    }
  };

  window.addEventListener('scroll', requestTick, { passive: true });
  window.addEventListener('resize', () => {
    lastScrollY = window.scrollY;
    if (!mediaQuery.matches || mobileQuery.matches) {
      showHeader();
    }
  });

  if (mediaQuery.addEventListener) {
    mediaQuery.addEventListener('change', onMediaChange);
  } else if (mediaQuery.addListener) {
    mediaQuery.addListener(onMediaChange);
  }

  // Initial state: ensure header is visible on mobile
  if (mobileQuery.matches) {
    showHeader();
  }
}

export function setupScrollToTopButton({ breakpoint = 900, offset = 400 } = {}) {
  let button = document.querySelector('.scroll-top-button');
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'scroll-top-button';
    button.setAttribute('aria-label', 'Revenir en haut de la page');
    button.innerHTML = '<span aria-hidden="true">↑</span>';
    document.body.appendChild(button);
  }

  const mediaQuery = window.matchMedia(`(max-width: ${breakpoint}px)`);
  let ticking = false;

  function updateVisibility() {
    const shouldShow = mediaQuery.matches && window.scrollY > offset;
    button.classList.toggle('visible', shouldShow);
  }

  function requestTick() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(() => {
      updateVisibility();
      ticking = false;
    });
  }

  button.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  window.addEventListener('scroll', requestTick, { passive: true });

  const handleMediaChange = () => {
    if (!mediaQuery.matches) {
      button.classList.remove('visible');
    } else {
      updateVisibility();
    }
  };

  if (mediaQuery.addEventListener) {
    mediaQuery.addEventListener('change', handleMediaChange);
  } else if (mediaQuery.addListener) {
    mediaQuery.addListener(handleMediaChange);
  }

  updateVisibility();
}
