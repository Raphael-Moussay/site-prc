import {
  initializeAppwrite,
  getSchools,
  formatDistance,
  formatDateTime,
  subscribeToLeaderboard,
  setupHeaderAutoHide,
  setupScrollToTopButton,
  onAuthStateChange,
  loadCurrentUser,
  loginWithEmailPassword,
  registerWithEmailPassword,
  logout,
  getUserDisplayName,
} from './core.js';

initializeAppwrite();

document.addEventListener('DOMContentLoaded', () => {
  populateNavigation();
  hydrateFooter();
  setupNavigationToggle();
  setupHeaderAutoHide();
  setupScrollToTopButton();
  setupAuthControls();
  setupCtaSchoolSelector();
  subscribeToLeaderboard({
    onTotalsUpdate: updateTotals,
    onLeaderboardUpdate: renderLeaderboard,
    onDailyTop: renderDailyTop,
    onWeeklyTop: renderWeeklyTop,
  });
});

function populateNavigation() {
  const navList = document.querySelector('#nav-links');
  if (!navList) return;

  const schools = getSchools();

  navList.innerHTML = '';

  const homeItem = document.createElement('li');
  homeItem.innerHTML = '<a href="index.html" class="active">Accueil</a>';
  navList.appendChild(homeItem);

  schools.forEach((school) => {
    const li = document.createElement('li');
    li.innerHTML = `<a href="school.html?code=${school.code}">${school.displayName}</a>`;
    navList.appendChild(li);
  });
}

function hydrateFooter() {
  const yearEl = document.querySelector('#current-year');
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }
}

function setupNavigationToggle() {
  const toggle = document.querySelector('.nav-toggle');
  const navLinks = document.querySelector('#nav-links');
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

function setupAuthControls() {
  const authButton = document.querySelector('#auth-button');
  const authUser = document.querySelector('#auth-user');
  const modal = document.querySelector('#auth-modal');
  const form = modal?.querySelector('#auth-form');
  const emailInput = modal?.querySelector('#auth-email');
  const passwordInput = modal?.querySelector('#auth-password');
  const nameGroup = modal?.querySelector('#auth-name-group');
  const nameInput = modal?.querySelector('#auth-name');
  const toggleModeButton = modal?.querySelector('#auth-toggle-mode');
  const feedbackEl = modal?.querySelector('#auth-feedback');
  const titleEl = modal?.querySelector('#auth-modal-title');
  const submitButton = modal?.querySelector('[data-auth-submit]');
  const closeButtons = modal ? Array.from(modal.querySelectorAll('[data-auth-close]')) : [];

  if (!authButton || !form || !modal || !emailInput || !passwordInput || !feedbackEl || !titleEl || !submitButton) {
    return;
  }

  let mode = 'login';
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
      mode = 'login';
      nameGroup?.setAttribute('hidden', '');
      titleEl.textContent = 'Connexion';
      submitButton.textContent = 'Se connecter';
      toggleModeButton?.setAttribute('data-mode', 'login');
      toggleModeButton && (toggleModeButton.textContent = 'Créer un compte');
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

  const setMode = (nextMode) => {
    mode = nextMode;
    if (mode === 'signup') {
      titleEl.textContent = 'Créer un compte';
      submitButton.textContent = "S'inscrire";
      toggleModeButton?.setAttribute('data-mode', 'signup');
      toggleModeButton && (toggleModeButton.textContent = 'Déjà un compte ? Se connecter');
      nameGroup?.removeAttribute('hidden');
      passwordInput.setAttribute('autocomplete', 'new-password');
    } else {
      titleEl.textContent = 'Connexion';
      submitButton.textContent = 'Se connecter';
      toggleModeButton?.setAttribute('data-mode', 'login');
      toggleModeButton && (toggleModeButton.textContent = 'Créer un compte');
      nameGroup?.setAttribute('hidden', '');
      passwordInput.setAttribute('autocomplete', 'current-password');
    }
    clearFeedback();
  };

  const handleAuthResult = (user) => {
    if (user) {
      closeModal();
    }
  };

  const update = (user) => {
    if (user) {
      authButton.textContent = 'Se déconnecter';
      authButton.dataset.authenticated = 'true';
      if (authUser) {
        authUser.textContent = getUserDisplayName(user);
        authUser.hidden = false;
      }
      handleAuthResult(user);
    } else {
      authButton.textContent = 'Se connecter';
      authButton.dataset.authenticated = 'false';
      if (authUser) {
        authUser.hidden = true;
        authUser.textContent = '';
      }
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSubmitting) return;

    clearFeedback();

    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const name = nameInput?.value.trim();

    submitButton.disabled = true;
    toggleModeButton && (toggleModeButton.disabled = true);
    isSubmitting = true;

    try {
      if (mode === 'signup') {
        await registerWithEmailPassword({ email, password, name });
      } else {
        await loginWithEmailPassword({ email, password });
      }
    } catch (error) {
      console.error('Erreur lors de la gestion de la connexion Appwrite :', error);
      showFeedback(error?.message ?? 'Une erreur est survenue.');
      return;
    } finally {
      submitButton.disabled = false;
      toggleModeButton && (toggleModeButton.disabled = false);
      isSubmitting = false;
    }
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

  toggleModeButton?.addEventListener('click', () => {
    setMode(mode === 'login' ? 'signup' : 'login');
  });

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

function updateTotals({ globalKilometers = 0, ridesCount = 0 }) {
  const globalTotalEl = document.querySelector('#global-total');
  const ridesCountEl = document.querySelector('#rides-count');
  const schoolsCountEl = document.querySelector('#schools-count');
  const leaderboardUpdatedEl = document.querySelector('#leaderboard-updated');

  if (globalTotalEl) globalTotalEl.textContent = formatDistance(globalKilometers);
  if (ridesCountEl) ridesCountEl.textContent = ridesCount.toString();
  if (schoolsCountEl) schoolsCountEl.textContent = getSchools().length.toString();
  if (leaderboardUpdatedEl) leaderboardUpdatedEl.textContent = `Mise à jour : ${formatDateTime(new Date())}`;
}

function renderLeaderboard(rows) {
  const tbody = document.querySelector('#leaderboard-body');
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5">Aucun trajet enregistré pour le moment.</td></tr>';
    return;
  }

  tbody.innerHTML = rows
    .map(
      (row, index) => `
        <tr>
          <td>${index + 1}</td>
          <td><a href="school.html?code=${row.code}">${row.displayName}</a></td>
          <td>${formatDistance(row.totalDistance)}</td>
          <td>${formatDistance(row.objective)}</td>
          <td>
            <div class="progress">
              <div class="progress-bar" style="width: ${row.progressPercentage}%"></div>
            </div>
            <span class="progress-label">${row.progressPercentage}%</span>
          </td>
        </tr>
      `
    )
    .join('');
}

function renderDailyTop(rides) {
  renderTopList('#daily-top-rides', rides);
}

function renderWeeklyTop(rides) {
  renderTopList('#weekly-top-rides', rides);
}

function renderTopList(selector, rides) {
  const list = document.querySelector(selector);
  if (!list) return;

  if (!rides.length) {
    list.innerHTML = '<li>Aucun trajet enregistré pour cette période.</li>';
    return;
  }

  list.innerHTML = rides
    .map(
      (ride) => `
        <li>
          <div>
            <strong>${ride.schoolName}</strong> – ${formatDistance(ride.totalDistance)}
          </div>
          <small>Par ${getRideAuthorLabel(ride)} • ${formatDateTime(ride.createdAt)}</small>
        </li>
      `
    )
    .join('');
}

function getRideAuthorLabel(ride) {
  if (!ride) return 'Participant';
  const name = ride.authorName?.trim();
  if (name) return name;
  const email = ride.authorEmail?.trim();
  if (email) return email;
  return 'Participant';
}

function setupCtaSchoolSelector() {
  const select = document.querySelector('#cta-school-select');
  const submitButton = document.querySelector('#cta-school-submit');
  if (!select || !submitButton) return;

  const schools = getSchools();
  const fragment = document.createDocumentFragment();

  schools.forEach((school) => {
    const option = document.createElement('option');
    option.value = school.code;
    option.textContent = school.displayName;
    fragment.appendChild(option);
  });

  select.appendChild(fragment);

  const navigateToSchool = () => {
    const selectedCode = select.value;
    if (!selectedCode) {
      select.setCustomValidity('Choisissez votre école pour continuer.');
      select.reportValidity();
      window.setTimeout(() => select.setCustomValidity(''), 2000);
      return;
    }

    window.location.href = `school.html?code=${selectedCode}`;
  };

  submitButton.addEventListener('click', navigateToSchool);

  select.addEventListener('change', () => {
    select.setCustomValidity('');
  });

  select.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      navigateToSchool();
    }
  });
}
