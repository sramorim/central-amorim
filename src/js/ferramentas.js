import { projects, categories, platformLabels } from './data.js';

const grid = document.getElementById('tools-grid');
const search = document.getElementById('tools-search');
const chips = document.getElementById('category-chips');
const count = document.getElementById('tools-count');
if (!grid) throw new Error('Grid de ferramentas não encontrado');

/* Os chips saem da taxonomia (data.js), não mais das categorias soltas de cada
   card — assim a ordem é sempre a mesma e nenhum grupo fica duplicado. */
const groups = [{ id: 'todas', label: 'Todas' }, ...categories];
let activeCat = 'todas';
let query = '';

function platformsOf(p) {
  return (p.platforms || []).map((id) => platformLabels[id] || id);
}

function card(p) {
  return `
    <article class="project-card${p.featured ? ' project-card--featured' : ''}">
      <div class="project-card-top">
        <div class="project-icon" aria-hidden="true">${p.icon}</div>
        <span class="project-status status-${p.status}">${p.statusLabel}</span>
      </div>
      ${p.featured ? '<span class="project-pin">Principal</span>' : ''}
      <h3 class="project-name">${p.name}</h3>
      <span class="project-category">${p.category}</span>
      <p class="project-summary">${p.summary || ''}</p>
      <p class="project-description">${p.description}</p>
      <a href="${p.url}" class="btn btn-${p.buttonStyle}">${p.urlLabel}</a>
    </article>`;
}

function matches(p) {
  if (activeCat !== 'todas' && p.group !== activeCat) return false;
  if (!query) return true;
  const hay = [p.name, p.summary, p.description, p.category, platformsOf(p).join(' '), p.names || '']
    .join(' ')
    .toLowerCase();
  return hay.includes(query);
}

function renderGrid() {
  const list = projects.filter(matches);
  grid.innerHTML = list.map(card).join('') ||
    '<div class="tools-empty">Nenhuma ferramenta encontrada para essa busca.</div>';
  count.textContent = list.length === projects.length
    ? `${projects.length} ferramentas disponíveis`
    : `${list.length} de ${projects.length} ferramentas`;
}

function renderChips() {
  chips.innerHTML = groups
    .map(
      (c) => `<button class="fchip${c.id === activeCat ? ' fchip--active' : ''}" data-cat="${encodeURIComponent(c.id)}"${c.hint ? ` title="${c.hint}"` : ''}>${c.label}</button>`
    )
    .join('');
  chips.querySelectorAll('.fchip').forEach((el) => {
    el.addEventListener('click', () => {
      activeCat = decodeURIComponent(el.dataset.cat);
      renderChips();
      renderGrid();
    });
  });
}

search.addEventListener('input', () => {
  query = search.value.trim().toLowerCase();
  renderGrid();
});

renderChips();
renderGrid();