import {
  initializeAppwrite,
  getSchools,
  getSchoolByCode,
  formatDistance,
  formatDateTime,
  createRide,
  listenToSchoolTotals,
  fetchRecentRides,
  getSchoolTotals,
  uploadProof,
  setupHeaderAutoHide,
  setupScrollToTopButton,
  onAuthStateChange,
  loadCurrentUser,
  loginWithEmailPassword,
  logout,
  getUserDisplayName,
  getSchoolObjective,
  setSchoolObjective,
  canManageSchool,
  updateRide,
  deleteRide,
} from './core.js';
import { appwriteConfig } from './appwrite-config.js';

const params = new URLSearchParams(window.location.search);
const schoolCode = params.get('code');
const schools = getSchools();
const school = getSchoolByCode(schoolCode) ?? schools[0];
let currentUser = null;
let canManage = false;
let postsGridHandlerAttached = false;
let lastRides = [];

initializeAppwrite();

const navActiveCode = school?.code ?? '';

const navLinks = document.querySelector('#nav-links');
const addProofButton = document.querySelector('#add-proof');
const proofsWrapper = document.querySelector('#proofs-wrapper');
const rideForm = document.querySelector('#ride-form');
const feedbackEl = document.querySelector('#form-feedback');
const postsGrid = document.querySelector('#posts-grid');
const refreshPostsBtn = document.querySelector('#refresh-posts');
const schoolTitle = document.querySelector('#school-title');
const pageTitle = document.querySelector('#page-title');

populateNavigation();
setupPageContent();
setupNavigationToggle();
setupHeaderAutoHide();
setupScrollToTopButton();
setupAuthControls();
setupForm();
setupRealtimeStats();
refreshPosts();

if (refreshPostsBtn) {
  refreshPostsBtn.addEventListener('click', () => refreshPosts(true));
}

function populateNavigation() {
  if (!navLinks) return;
  navLinks.innerHTML = '';

  const homeItem = document.createElement('li');
  homeItem.innerHTML = '<a href="index.html">Accueil</a>';
  navLinks.appendChild(homeItem);

  schools.forEach((item) => {
    const li = document.createElement('li');
    li.innerHTML = `<a href="school.html?code=${item.code}" ${item.code === navActiveCode ? 'class="active"' : ''}>${item.displayName}</a>`;
    navLinks.appendChild(li);
  });
}

function setupNavigationToggle() {
  const toggle = document.querySelector('.nav-toggle');
  if (!toggle || !navLinks) return;
  const authButton = document.querySelector('#auth-button');

  const closeMenu = () => {
    toggle.setAttribute('aria-expanded', 'false');
    navLinks.classList.remove('open');
    document.body.classList.remove('menu-open');
    document.documentElement.style.removeProperty('--nav-open-top');
  };

  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', (!expanded).toString());
    const willOpen = !expanded;
    navLinks.classList.toggle('open', willOpen);
    document.body.classList.toggle('menu-open', willOpen);

    if (willOpen) {
      const rect = toggle.getBoundingClientRect();
      const top = Math.round(rect.bottom + 8);
      document.documentElement.style.setProperty('--nav-open-top', `${top}px`);
    } else {
      document.documentElement.style.removeProperty('--nav-open-top');
    }
  });

  navLinks.querySelectorAll('a').forEach((link) =>
    link.addEventListener('click', () => {
      closeMenu();
    })
  );

  // Close menu when clicking outside of it or the toggle button
  document.addEventListener('click', (event) => {
    if (!navLinks.classList.contains('open')) return;
    const target = event.target;
    if (toggle.contains(target) || navLinks.contains(target)) return;
    closeMenu();
  });

  // Close if the user clicks on the auth button
  if (authButton) {
    authButton.addEventListener('click', () => closeMenu());
  }

  // Optional: close on Escape key
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && navLinks.classList.contains('open')) {
      closeMenu();
    }
  });
}

function setupAuthControls() {
  const authButton = document.querySelector('#auth-button');
  const authUser = document.querySelector('#auth-user');
  const modal = document.querySelector('#auth-modal');
  const form = modal?.querySelector('#auth-form');
  const emailInput = modal?.querySelector('#auth-email');
  const passwordInput = modal?.querySelector('#auth-password');
  const passwordToggle = modal?.querySelector('.password-toggle');
  const feedbackEl = modal?.querySelector('#auth-feedback');
  const titleEl = modal?.querySelector('#auth-modal-title');
  const submitButton = modal?.querySelector('[data-auth-submit]');
  const closeButtons = modal ? Array.from(modal.querySelectorAll('[data-auth-close]')) : [];

  if (!authButton || !form || !modal || !emailInput || !passwordInput || !feedbackEl || !titleEl || !submitButton) {
    return;
  }

  let isSubmitting = false;

  const clearFeedback = () => {
    feedbackEl.textContent = '';
    feedbackEl.hidden = true;
    delete feedbackEl.dataset.type;
  };

  const showFeedback = (message, type = 'error') => {
    feedbackEl.textContent = message;
    feedbackEl.dataset.type = type;
    feedbackEl.hidden = false;
  };

  const closeModal = () => {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('auth-modal-open');
    setTimeout(() => {
      modal.hidden = true;
      form.reset();
      clearFeedback();
      titleEl.textContent = 'Connexion';
      submitButton.textContent = 'Se connecter';
      passwordInput.setAttribute('autocomplete', 'current-password');
    }, 200);
  };

  const openModal = () => {
    if (!modal.hidden && modal.classList.contains('is-open')) return;
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('auth-modal-open');
    requestAnimationFrame(() => {
      modal.classList.add('is-open');
      emailInput.focus();
    });
  };

  // Toggle password visibility
  if (passwordToggle && passwordInput) {
    passwordToggle.addEventListener('click', () => {
      const isText = passwordInput.type === 'text';
      passwordInput.type = isText ? 'password' : 'text';
      passwordToggle.setAttribute('aria-pressed', String(!isText));
      passwordToggle.textContent = isText ? '👁' : '🙈';
    });
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSubmitting) return;

    clearFeedback();

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    submitButton.disabled = true;
    isSubmitting = true;

    try {
      await loginWithEmailPassword({ email, password });
    } catch (error) {
      console.error('Erreur lors de la gestion de la connexion Appwrite :', error);
      showFeedback(error?.message ?? 'Une erreur est survenue.');
      return;
    } finally {
      submitButton.disabled = false;
      isSubmitting = false;
    }
  };

  const update = (user) => {
    currentUser = user;
    if (user) {
      authButton.textContent = 'Se déconnecter';
      authButton.dataset.authenticated = 'true';
      if (authUser) {
        authUser.textContent = getUserDisplayName(user);
        authUser.hidden = false;
      }
      closeModal();
    } else {
      authButton.textContent = 'Se connecter';
      authButton.dataset.authenticated = 'false';
      if (authUser) {
        authUser.hidden = true;
        authUser.textContent = '';
      }
    }

    syncFormWithAuth(user);
    // Recalcule les droits de gestion et met à jour l'UI
    canManageSchool(school.code)
      .then((allowed) => {
        const changed = canManage !== allowed;
        canManage = allowed;
        if (changed) {
          refreshPosts(true);
          ensureGoalEditControl();
        }
      })
      .catch(() => {
        canManage = false;
        ensureGoalEditControl();
      });
  };

  onAuthStateChange(update);
  loadCurrentUser().catch((error) => {
    console.warn('Impossible de vérifier la session Appwrite :', error);
  });

  authButton.addEventListener('click', async () => {
    const isAuthenticated = authButton.dataset.authenticated === 'true';
    if (isAuthenticated) {
      try {
        authButton.disabled = true;
        await logout();
      } catch (error) {
        console.error('Erreur lors de la déconnexion Appwrite :', error);
      } finally {
        authButton.disabled = false;
      }
      return;
    }

    if (!modal.hidden) {
      closeModal();
    } else {
      openModal();
    }
  });

  form.addEventListener('submit', handleSubmit);

  closeButtons.forEach((button) => {
    button.addEventListener('click', () => closeModal());
  });

  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) {
      closeModal();
    }
  });
}

function syncFormWithAuth(user) {
  if (!rideForm) return;
  const isAuthenticated = Boolean(user);
  // Le formulaire reste utilisable même sans connexion,
  // mais on affiche des champs supplémentaires obligatoires.
  const anonFields = document.querySelector('#anon-fields');
  if (anonFields) anonFields.hidden = isAuthenticated;
  // Ne pas désactiver le formulaire, mais nettoie le message d'auth
  if (isAuthenticated && feedbackEl?.dataset.source === 'auth') hideFeedback();
}

function setupPageContent() {
  const yearEl = document.querySelector('#current-year');
  if (yearEl) yearEl.textContent = new Date().getFullYear().toString();
  if (schoolTitle) schoolTitle.textContent = school.displayName;
  if (pageTitle) pageTitle.textContent = `Polytech PRC – ${school.displayName}`;
}

function setupForm() {
  if (!proofsWrapper || !rideForm) return;

  addProofSlot();

  addProofButton?.addEventListener('click', () => addProofSlot());

  rideForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideFeedback();

    try {
      setFormDisabled(true);
      const rideData = await collectFormData();
      const docId = await createRide(rideData);
      showFeedback('Trajet enregistré avec succès ! Merci pour votre contribution ❤️', 'success');
      rideForm.reset();
      proofsWrapper.innerHTML = '';
      addProofSlot();
      // Rafraîchir immédiatement le flux et les stats locales
      refreshPosts();
      refreshStatsOnce();
    } catch (error) {
      console.error(error);
      const userMessage = error instanceof Error && error.message
        ? error.message
        : "Une erreur est survenue lors de l'enregistrement. Vérifiez votre connexion et réessayez.";
      showFeedback(userMessage, 'error');
    } finally {
      setFormDisabled(false);
    }
  });
}

function addProofSlot() {
  const proofIndex = proofsWrapper.childElementCount;
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'proof-item';
  fieldset.innerHTML = `
    <legend>Preuve ${proofIndex + 1}</legend>
    <div class="form-group">
      <label for="proof-image-${proofIndex}">Image (PNG, JPG, 10 Mo max)</label>
      <input id="proof-image-${proofIndex}" name="proofImage" type="file" accept="image/*" required />
    </div>
    <div class="form-group">
      <label for="proof-distance-${proofIndex}">Distance associée (km)</label>
      <input id="proof-distance-${proofIndex}" name="proofDistance" type="number" min="0" step="0.1" placeholder="0" required />
    </div>
    <button type="button" class="link-button remove-proof" aria-label="Retirer cette preuve">Retirer</button>
  `;

  fieldset.querySelector('.remove-proof')?.addEventListener('click', () => {
    fieldset.remove();
    if (!proofsWrapper.childElementCount) addProofSlot();
  });

  proofsWrapper.appendChild(fieldset);
}

async function collectFormData() {
  const proofFieldsets = Array.from(proofsWrapper.querySelectorAll('.proof-item'));
  if (!proofFieldsets.length) {
    throw new Error('Ajoutez au moins une preuve avec image et distance.');
  }

  const proofs = [];
  let totalDistance = 0;

  for (const fieldset of proofFieldsets) {
    const fileInput = fieldset.querySelector('input[type="file"]');
    const distanceInput = fieldset.querySelector('input[type="number"]');

    if (!fileInput?.files?.length) {
      throw new Error("Vous avez oublié d'insérer une image.");
    }

    const file = fileInput.files[0];
    const distance = parseFloat(distanceInput?.value ?? '0');

    if (Number.isNaN(distance) || distance <= 0) {
      throw new Error('La distance doit être un nombre positif');
    }

    const uploadResult = await uploadProof({ schoolCode: school.code, file });
    proofs.push({
      storagePath: uploadResult.storagePath,
      fileId: uploadResult.fileId,
      downloadUrl: uploadResult.downloadUrl,
      distance,
    });

    totalDistance += distance;
  }

  const notes = (document.querySelector('#ride-notes')?.value ?? '').trim();

  let firstName = '';
  let lastName = '';
  let speciality = '';
  if (!currentUser) {
    firstName = (document.querySelector('#anon-first-name')?.value ?? '').trim();
    lastName = (document.querySelector('#anon-last-name')?.value ?? '').trim();
    speciality = (document.querySelector('#anon-speciality')?.value ?? '').trim();
    if (!firstName || !lastName || !speciality) {
      throw new Error('Nom, prénom et spécialité sont requis si vous n’êtes pas connecté.');
    }
  }

  return {
    schoolCode: school.code,
    schoolName: school.displayName,
    totalDistance,
    proofs,
    notes,
    createdAt: new Date(),
    ...(currentUser ? {} : { firstName, lastName, speciality }),
  };
}

function showFeedback(message, type = 'info', source = 'feedback') {
  if (!feedbackEl) return;
  feedbackEl.textContent = message;
  feedbackEl.dataset.type = type;
  feedbackEl.dataset.source = source;
  feedbackEl.hidden = false;
}

function hideFeedback() {
  if (!feedbackEl) return;
  feedbackEl.hidden = true;
  delete feedbackEl.dataset.type;
  delete feedbackEl.dataset.source;
  feedbackEl.textContent = '';
}

function setFormDisabled(disabled) {
  if (addProofButton) addProofButton.toggleAttribute('disabled', disabled);
  if (refreshPostsBtn) refreshPostsBtn.toggleAttribute('disabled', disabled);
  if (!rideForm) return;

  rideForm.querySelectorAll('input, textarea, button').forEach((element) => {
    element.toggleAttribute('disabled', disabled);
  });
}

function setupRealtimeStats() {
  listenToSchoolTotals(school.code, ({ totalDistance, ridesCount, objective }) => {
    const totalEl = document.querySelector('#school-total');
    const countEl = document.querySelector('#school-ride-count');
    const goalEl = document.querySelector('#school-goal');

    if (totalEl) totalEl.textContent = formatDistance(totalDistance);
    if (countEl) countEl.textContent = ridesCount.toString();
    if (goalEl) goalEl.textContent = formatDistance(objective ?? getSchoolObjective(school.code));
    ensureGoalEditControl();
    // Actualise aussi le flux de publications à chaque changement (création/édition/suppression)
    // détecté par le temps réel sur la collection 'rides'.
    refreshPosts();
  });
}

function ensureGoalEditControl() {
  const goalEl = document.querySelector('#school-goal');
  if (!goalEl) return;
  let container = goalEl.parentElement;
  if (!container) return;
  let btn = container.querySelector('.goal-edit-button');
  // Si l'on n'a pas pu déterminer les memberships, on déduit un droit de gestion
  // via les permissions des dernières publications (owner ou admin école)
  let derivedCan = false;
  try {
    const globalTeam = appwriteConfig.globalAdminTeamId;
    const schoolTeam = (appwriteConfig.schoolAdminTeams ?? {})[school.code];
    if (Array.isArray(lastRides) && lastRides.length) {
      const has = lastRides.some((r) => Array.isArray(r.permissions) && r.permissions.some((p) => {
        if (typeof p !== 'string') return false;
        const pl = p.toLowerCase();
        const gt = globalTeam ? String(globalTeam).toLowerCase() : '';
        const st = schoolTeam ? String(schoolTeam).toLowerCase() : '';
        return (
          (gt && (pl.includes(`update("team:${gt}`) || pl.includes(`delete("team:${gt}`))) ||
          (st && (pl.includes(`update("team:${st}`) || pl.includes(`delete("team:${st}`)))
        );
      }));
      derivedCan = Boolean(has);
    }
  } catch {}

  if (!canManage && !derivedCan) {
    if (btn) btn.remove();
    return;
  }
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'link-button goal-edit-button';
    btn.setAttribute('aria-label', "Modifier l'objectif");
    btn.innerHTML = '<span aria-hidden="true">✏️</span>';
    btn.addEventListener('click', async () => {
      const currentText = goalEl.textContent || '';
      const currentKm = parseFloat((currentText.replace(/[^0-9.,]/g, '').replace(',', '.')) || '0');
      const input = window.prompt("Nouvel objectif (en km)", Number.isFinite(currentKm) ? String(currentKm) : '0');
      if (input == null) return; // annulé
      const value = parseFloat(String(input).replace(',', '.'));
      if (!Number.isFinite(value) || value < 0) {
        alert("Valeur invalide. Entrez un nombre positif.");
        return;
      }
      try {
        await setSchoolObjective({ schoolCode: school.code, objective: value });
        // Mise à jour immédiate de l'affichage local (le temps que le temps réel propage)
        goalEl.textContent = formatDistance(value);
      } catch (error) {
        console.error(error);
        alert(error?.message || "Impossible de mettre à jour l'objectif.");
      }
    });
    // Insère le bouton juste après la valeur
    container.appendChild(btn);
  }
}

async function refreshPosts(force = false) {
  try {
    postsGrid?.classList.add('loading');
    const rides = await fetchRecentRides(school.code, { force });
    lastRides = rides;
    renderPosts(rides);
  } catch (error) {
    console.error(error);
    if (postsGrid) postsGrid.innerHTML = '<p class="empty-state">Impossible de charger les publications. Réessayez plus tard.</p>';
  } finally {
    postsGrid?.classList.remove('loading');
  }
}

async function refreshStatsOnce() {
  try {
    const { totalDistance, ridesCount, objective } = await getSchoolTotals(school.code);
    const totalEl = document.querySelector('#school-total');
    const countEl = document.querySelector('#school-ride-count');
    const goalEl = document.querySelector('#school-goal');
    if (totalEl) totalEl.textContent = formatDistance(totalDistance);
    if (countEl) countEl.textContent = ridesCount.toString();
    if (goalEl) goalEl.textContent = formatDistance(objective ?? getSchoolObjective(school.code));
    ensureGoalEditControl();
  } catch (error) {
    console.error('Impossible de rafraîchir les stats:', error);
  }
}

function renderPosts(rides) {
  if (!postsGrid) return;

  if (!rides.length) {
    postsGrid.innerHTML = '<p class="empty-state">Soyez le premier à déclarer un trajet !</p>';
    return;
  }

  postsGrid.innerHTML = rides
    .map((ride) => renderRideCard(ride))
    .join('');

  // Event delegation for edit/delete actions (attach once)
  if (!postsGridHandlerAttached) {
    postsGrid.addEventListener('click', async (event) => {
    const delBtn = event.target.closest?.('[data-action="delete-ride"]');
    if (delBtn) {
      const rideId = delBtn.getAttribute('data-ride-id');
      if (!rideId) return;
      const ride = (lastRides || []).find((r) => r.id === rideId);
      if (!canShowActionsForRide(ride ?? {})) {
        alert("Vous n'avez pas les droits pour supprimer cette publication.");
        return;
      }
      const confirmMsg = 'Supprimer cette publication ? Cette action est irréversible.';
      if (!window.confirm(confirmMsg)) return;
      try {
        await deleteRide(rideId);
        await refreshPosts(true);
        await refreshStatsOnce();
      } catch (error) {
        console.error(error);
        alert(error?.message || 'Suppression impossible.');
      }
      return;
    }

    const editBtn = event.target.closest?.('[data-action="edit-ride"]');
    if (editBtn) {
      const rideId = editBtn.getAttribute('data-ride-id');
      const currentDistance = parseFloat(editBtn.getAttribute('data-distance') || '0');
      const currentNotes = editBtn.getAttribute('data-notes') || '';
      if (!rideId) return;
      const ride = (lastRides || []).find((r) => r.id === rideId);
      if (!canShowActionsForRide(ride ?? {})) {
        alert("Vous n'avez pas les droits pour modifier cette publication.");
        return;
      }
      const distanceInput = window.prompt('Nouvelle distance (km)', String(currentDistance));
      if (distanceInput == null) return;
      const newDistance = parseFloat(String(distanceInput).replace(',', '.'));
      if (!Number.isFinite(newDistance) || newDistance <= 0) {
        alert('Distance invalide.');
        return;
      }
      const notesInput = window.prompt('Nouveau commentaire (optionnel)', currentNotes);
      try {
        await updateRide(rideId, { totalDistance: newDistance, notes: notesInput ?? '' });
        await refreshPosts(true);
        await refreshStatsOnce();
      } catch (error) {
        console.error(error);
        alert(error?.message || 'Modification impossible.');
      }
    }
    });
    postsGridHandlerAttached = true;
  }
}

function rideHasTeamPermission(ride, type, teamIdOrName) {
  if (!Array.isArray(ride.permissions) || !teamIdOrName) return false;
  const t = String(teamIdOrName).toLowerCase();
  return ride.permissions.some((p) => typeof p === 'string' && p.toLowerCase().includes(`${type}("team:`) && p.toLowerCase().includes(`team:${t}`));
}

function rideHasUserPermission(ride, type, userId) {
  if (!Array.isArray(ride.permissions) || !userId) return false;
  const u = String(userId).toLowerCase();
  return ride.permissions.some((p) => typeof p === 'string' && p.toLowerCase().includes(`${type}("user:`) && p.toLowerCase().includes(`user:${u}`));
}

function canShowActionsForRide(ride) {
  if (canManage) return true;
  if (!currentUser) return false;
  const globalTeam = appwriteConfig.globalAdminTeamId;
  const schoolTeam = (appwriteConfig.schoolAdminTeams ?? {})[school.code];
  // Montre si le document a explicitement des permissions pour l'équipe propriétaire/admin
  const canByGlobalTeam = rideHasTeamPermission(ride, 'update', globalTeam) || rideHasTeamPermission(ride, 'delete', globalTeam);
  const canBySchoolTeam = rideHasTeamPermission(ride, 'update', schoolTeam) || rideHasTeamPermission(ride, 'delete', schoolTeam);
  return Boolean(canByGlobalTeam || canBySchoolTeam);
}

function renderRideCard(ride) {
  const authorLabel = getRideAuthorLabel(ride);
  const proofs = Array.isArray(ride.proofs)
    ? ride.proofs
    : (() => { try { return JSON.parse(ride.proofs || '[]'); } catch { return []; } })();

  const proofsHtml = proofs
    .map((proof) => {
      const d = typeof proof?.distance === 'number' ? proof.distance : parseFloat(String(proof?.distance ?? '0'));
      const perProofDistance = Number.isFinite(d) ? d : 0;
      const url = proof?.downloadUrl || '';
      return `
        <figure class="ride-proof">
          <img src="${url}" alt="Preuve de trajet pour ${ride.schoolName}" loading="lazy" />
          <figcaption>${formatDistance(perProofDistance)}</figcaption>
        </figure>
      `;
    })
    .join('');

  const controls = canShowActionsForRide(ride)
    ? `
      <div class="ride-actions">
        <button class="link-button" type="button" data-action="edit-ride" data-ride-id="${ride.id}" data-distance="${ride.totalDistance}" data-notes="${ride.notes?.replace(/"/g, '&quot;') ?? ''}">Modifier</button>
        <button class="link-button" type="button" data-action="delete-ride" data-ride-id="${ride.id}">Supprimer</button>
      </div>
    `
    : '';

  return `
    <article class="ride-card">
      <header>
        <h3>${ride.schoolName}</h3>
        <span>${formatDistance(ride.totalDistance)}</span>
      </header>
      <div class="ride-meta">
        <span class="ride-author">Publié par ${authorLabel}</span>
        <time datetime="${ride.createdAt.toISOString()}">${formatDateTime(ride.createdAt)}</time>
      </div>
      ${ride.notes ? `<p class="ride-notes">${ride.notes}</p>` : ''}
      <div class="ride-proofs">${proofsHtml}</div>
      ${controls}
    </article>
  `;
}

function getRideAuthorLabel(ride) {
  if (!ride) return 'Participant';
  const name = ride.authorName?.trim();
  if (name) return name;
  const email = ride.authorEmail?.trim();
  if (email) return email;
  return 'Participant';
}
