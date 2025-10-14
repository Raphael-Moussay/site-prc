import { Client, Databases, Storage, Query, ID, Permission, Role } from 'appwrite';
import { appwriteConfig, appwriteOptions } from './appwrite-config.js';

let clientInstance;
let databasesInstance;
let storageInstance;

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
  { code: 'nantes', displayName: 'Polytech Nantes', objective: 630 },
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
  if (error instanceof Error) return error;
  if (error && typeof error === 'object') {
    const message = error.message ?? error.response?.message;
    if (message) return new Error(message);
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
  if (appwriteConfig.globalAdminTeamId) {
    teams.push(appwriteConfig.globalAdminTeamId);
  }
  const schoolTeams = appwriteConfig.schoolAdminTeams ?? {};
  const teamId = schoolTeams[schoolCode];
  if (teamId) {
    teams.push(teamId);
  }
  return teams;
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
  clientInstance.setEndpoint(appwriteConfig.endpoint);
  clientInstance.setProject(appwriteConfig.projectId);

  databasesInstance = new Databases(clientInstance);
  storageInstance = new Storage(clientInstance);

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

  const payload = {
    schoolCode: normalizedCode,
    objective: numericObjective,
  };

  const permissions = [
    Permission.read(Role.any()),
    ...buildAdminDocumentPermissions(normalizedCode, ['read', 'update', 'delete']),
  ];

  try {
    await databases().updateDocument(databaseId, collectionId, documentId, payload);
  } catch (error) {
    if (error?.code === 404 || error?.response?.code === 404) {
      try {
        await databases().createDocument(databaseId, collectionId, documentId, payload, permissions);
      } catch (createError) {
        throw toAppwriteError(createError, "Impossible de créer l'objectif pour cette école.");
      }
    } else {
      throw toAppwriteError(error, "Impossible de mettre à jour l'objectif de l'école.");
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
  const safeName = file.name.replace(/[^a-z0-9.\-]/gi, '_').toLowerCase();
  const uniqueId = ID.unique();
  const storagePath = `${schoolCode}/${uniqueId}_${safeName}`;
  const filePermissions = [Permission.read(Role.any())];

  if (appwriteOptions.allowAnonymousWrites) {
    filePermissions.push(Permission.update(Role.any()), Permission.delete(Role.any()));
  }

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

export async function createRide({ schoolCode, schoolName, totalDistance, proofs, notes, createdAt }) {
  const documentId = ID.unique();
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
  };

  const permissions = [Permission.read(Role.any())];

  if (appwriteOptions.allowAnonymousWrites) {
    permissions.push(Permission.update(Role.any()), Permission.delete(Role.any()));
  }

  await databases().createDocument(
    appwriteConfig.databaseId,
    appwriteConfig.ridesCollectionId,
    documentId,
    payload,
    permissions
  );

  return documentId;
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

  const cancelRealtime = appwriteOptions.enableRealtime
    ? client().subscribe(
        `databases.${appwriteConfig.databaseId}.collections.${appwriteConfig.ridesCollectionId}.documents`,
        handler
      )
    : () => {};

  handler();

  return () => cancelRealtime();
}

export async function fetchRecentRides(schoolCode, { limitCount = 6 } = {}) {
  const response = await databases().listDocuments(appwriteConfig.databaseId, appwriteConfig.ridesCollectionId, [
    Query.equal('schoolCode', schoolCode),
    Query.orderDesc('createdAt'),
    Query.limit(limitCount),
  ]);

  return response.documents.map((doc) => normalizeRide(doc.$id, doc));
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
  return {
    id,
    schoolCode: data.schoolCode,
    schoolName: data.schoolName,
    totalDistance: Number(data.totalDistance) || 0,
    proofs: proofs.map((proof) => ({
      storagePath: proof.storagePath,
      fileId: proof.fileId,
      downloadUrl: proof.downloadUrl,
      distance: Number(proof.distance) || 0,
    })),
    notes: data.notes ?? '',
    createdAt,
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
    const currentY = window.scrollY;
    const delta = currentY - lastScrollY;

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
    if (!mediaQuery.matches) {
      showHeader();
    }
  };

  window.addEventListener('scroll', requestTick, { passive: true });
  window.addEventListener('resize', () => {
    lastScrollY = window.scrollY;
    if (!mediaQuery.matches) {
      showHeader();
    }
  });

  if (mediaQuery.addEventListener) {
    mediaQuery.addEventListener('change', onMediaChange);
  } else if (mediaQuery.addListener) {
    mediaQuery.addListener(onMediaChange);
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
