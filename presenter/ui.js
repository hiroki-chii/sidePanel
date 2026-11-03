'use strict';
const paths = {
  cursor: '<path d="m5 3 14 10-7 1-3 7z"/><path d="m13 14 4 6"/>',
  power: '<path d="M12 2v10M5 5a9 9 0 1 0 14 0"/>',
  spotlight: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  area: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><rect x="7" y="7" width="10" height="10" rx="1"/>',
  laser: '<path d="M3 20c3-1 1-6 5-7s2-6 7-6"/><circle cx="18" cy="5" r="2"/><path d="M18 1V0m4 5h2m-3-3 1-1"/>',
  pen: '<path d="m15 4 5 5M4 16 16 4a2 2 0 0 1 4 4L8 20l-5 1zM4 16l4 4"/>',
  zoom: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6M10 7v6m-3-3h6"/>',
  settings: '<path d="m9 3 1-1h4l1 3 3 1 3 1v4l-2 2-1 3-1 3h-4l-2-2-3-1-3-1v-4l2-2z"/><circle cx="12" cy="11" r="3"/>',
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M5 9h1m3 0h1m3 0h1m3 0h1M5 12h1m3 0h1m3 0h1m3 0h1M7 16h10"/>',
  gesture: '<path d="m3 8 6 10L21 3M4 3h5M4 3v5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 8a3 3 0 0 1 6 1c0 2-3 2-3 4m0 3h.01"/>',
  ripple: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 0-4 2 2 0 0 1 0-4h3a4 4 0 0 0 4-4c0-4-5-6-9-6z"/><path d="M6 11h.01M9 7h.01m5 0h.01"/>'
};
function renderIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(node => { node.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[node.dataset.icon] || paths.cursor}</svg>`; });
}
let uiTheme = 'system';
function applyTheme(theme) {
  uiTheme = ['light', 'dark'].includes(theme) ? theme : 'system';
  const root = document.documentElement;
  root.classList.toggle('light-theme', uiTheme === 'light');
  root.classList.toggle('dark-theme', uiTheme === 'dark');
  const select = document.querySelector('#theme');
  if (select) select.value = uiTheme;
}
chrome.storage.local.get('theme').then(saved => applyTheme(saved.theme));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.theme) applyTheme(changes.theme.newValue);
});
renderIcons();
