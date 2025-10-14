import { initializeAppwrite, getSchools, formatDistance, formatDateTime, subscribeToLeaderboard } from './core.js';

initializeAppwrite();

document.addEventListener('DOMContentLoaded', () => {
  populateNavigation();
  hydrateFooter();
  setupNavigationToggle();
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
          <small>${formatDateTime(ride.createdAt)}</small>
        </li>
      `
    )
    .join('');
}
