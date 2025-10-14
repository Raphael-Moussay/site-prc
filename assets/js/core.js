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
  return [...schools];
}

export function getSchoolByCode(code) {
  return schools.find((school) => school.code === code);
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
