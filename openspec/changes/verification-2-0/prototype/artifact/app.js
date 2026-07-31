'use strict';

const shell = document.querySelector('.report-shell');
const viewButtons = Array.from(document.querySelectorAll('[data-view]'));
const viewPanels = Array.from(document.querySelectorAll('[data-view-panel]'));
const variantButtons = Array.from(document.querySelectorAll('[data-variant]'));
const contentState = document.querySelector('#content-state');

const variantCopy = {
  green: {
    title: 'Green',
    copy: 'All approved cases and six domains passed with fresh, intact evidence.',
    score: '40',
    repairs: '0',
    summary: '6 passed'
  },
  red: {
    title: 'Failed',
    copy: 'Three required readings failed and each failure has retained evidence.',
    score: '34',
    repairs: '3',
    summary: '2 failed'
  },
  blocked: {
    title: 'Blocked',
    copy: 'Runtime is ready, but two cases have missing integrity evidence.',
    score: '32',
    repairs: '2',
    summary: '2 blocked'
  },
  flaky: {
    title: 'Flaky',
    copy: 'A P0 case passed only after an identical-fingerprint retry.',
    score: '38',
    repairs: '1',
    summary: '1 flaky'
  },
  'pass-after-fix': {
    title: 'Pass after fix',
    copy: 'The repaired case passed retest and the regression baseline is complete.',
    score: '40',
    repairs: '0',
    summary: '6 passed'
  }
};

for (const button of viewButtons) {
  button.addEventListener('click', () => {
    const view = button.dataset.view;
    shell.dataset.specnavScreen = view === 'overview'
      ? 'verification-overview'
      : view === 'catalog'
        ? 'test-case-catalog'
        : 'test-case-results';
    for (const item of viewButtons) {
      item.setAttribute('aria-pressed', String(item === button));
    }
    for (const panel of viewPanels) {
      panel.hidden = panel.dataset.viewPanel !== view;
    }
  });
}

for (const button of variantButtons) {
  button.addEventListener('click', () => {
    const variant = button.dataset.variant;
    const copy = variantCopy[variant];
    shell.dataset.specnavVariant = variant;
    document.querySelector('[data-verdict-title]').textContent = copy.title;
    document.querySelector('[data-verdict-copy]').textContent = copy.copy;
    document.querySelector('[data-verdict-score]').textContent = copy.score;
    document.querySelector('[data-open-repairs]').textContent = copy.repairs;
    document.querySelector('[data-summary-badge]').textContent = copy.summary;
    for (const item of variantButtons) {
      item.setAttribute('aria-pressed', String(item === button));
    }
  });
}

contentState.addEventListener('change', () => {
  shell.dataset.specnavState = contentState.value;
});
