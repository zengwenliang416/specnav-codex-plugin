'use strict';

const CATALOG_FILTER_SCRIPT = `
  (() => {
    const root = document.querySelector('[data-report-component="case-filter"]');
    if (!root) return;
    const search = root.querySelector('input[type="search"]');
    const priority = root.querySelector('select');
    const rows = [...document.querySelectorAll('[data-case-row]')];
    const apply = () => {
      const query = search.value.trim().toLowerCase();
      const selected = priority.value;
      for (const row of rows) {
        row.hidden = !(
          (!query || row.dataset.search.includes(query))
          && (!selected || row.dataset.priority === selected)
        );
      }
    };
    root.addEventListener('input', apply);
    root.addEventListener('change', apply);
    root.addEventListener('submit', (event) => event.preventDefault());
  })();
  `;

module.exports = Object.freeze({
  'catalog-filter': CATALOG_FILTER_SCRIPT
});
