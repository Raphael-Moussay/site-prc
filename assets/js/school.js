import {
  initializeAppwrite,
  getSchools,
  getSchoolByCode,
  formatDistance,
  formatDateTime,
  createRide,
  listenToSchoolTotals,
  fetchRecentRides,
  uploadProof,
  setupHeaderAutoHide,
  setupScrollToTopButton,
  getSchoolObjective,
} from './core.js';

const params = new URLSearchParams(window.location.search);
const schoolCode = params.get('code');
const schools = getSchools();
const school = getSchoolByCode(schoolCode) ?? schools[0];

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

  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', (!expanded).toString());
    navLinks.classList.toggle('open', !expanded);
  });

  navLinks.querySelectorAll('a').forEach((link) =>
    link.addEventListener('click', () => {
      toggle.setAttribute('aria-expanded', 'false');
      navLinks.classList.remove('open');
    })
  );
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
      refreshPosts();
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

  return {
    schoolCode: school.code,
    schoolName: school.displayName,
    totalDistance,
    proofs,
    notes,
    createdAt: new Date(),
  };
}

function showFeedback(message, type = 'info') {
  if (!feedbackEl) return;
  feedbackEl.textContent = message;
  feedbackEl.dataset.type = type;
  feedbackEl.hidden = false;
}

function hideFeedback() {
  if (!feedbackEl) return;
  feedbackEl.hidden = true;
  delete feedbackEl.dataset.type;
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
  });
}

async function refreshPosts(force = false) {
  try {
    postsGrid?.classList.add('loading');
    const rides = await fetchRecentRides(school.code, { force });
    renderPosts(rides);
  } catch (error) {
    console.error(error);
    if (postsGrid) postsGrid.innerHTML = '<p class="empty-state">Impossible de charger les publications. Réessayez plus tard.</p>';
  } finally {
    postsGrid?.classList.remove('loading');
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
}

function renderRideCard(ride) {
  const proofsHtml = ride.proofs
    .map(
      (proof) => `
        <figure class="ride-proof">
          <img src="${proof.downloadUrl}" alt="Preuve de trajet pour ${ride.schoolName}" loading="lazy" />
          <figcaption>${formatDistance(proof.distance)}</figcaption>
        </figure>
      `
    )
    .join('');

  return `
    <article class="ride-card">
      <header>
        <h3>${ride.schoolName}</h3>
        <span>${formatDistance(ride.totalDistance)}</span>
      </header>
      <time datetime="${ride.createdAt.toISOString()}">${formatDateTime(ride.createdAt)}</time>
      ${ride.notes ? `<p class="ride-notes">${ride.notes}</p>` : ''}
      <div class="ride-proofs">${proofsHtml}</div>
    </article>
  `;
}
