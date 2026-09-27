import { projects, categories, platformLabels } from './data.js';
import { mountCatalog, projectCard } from './catalog.js';

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

function matches(p) {
  if (activeCat !== 'todas' && p.group !== activeCat) return false;
  if (!query) return true;
  const hay = [p.name, p.summary, p.description, p.category, platformsOf(p).join(' '), p.names || '']
    .join(' ')
    .toLowerCase();
  return hay.includes(query);
}

function renderGrid() {
  /* O card consulta o catálogo do servidor: publicada continua igual, paga e
     bloqueada ganham cadeado. Nada sai da lista. */
  const list = projects.filter(matches).map(projectCard).filter(Boolean);
  grid.innerHTML = list.join('') ||
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
/* Espera o catálogo do servidor antes do primeiro desenho, para o visitante
   não ver um piscar de "tudo liberado" antes do cadeado aparecer. */
mountCatalog(() => renderGrid());
