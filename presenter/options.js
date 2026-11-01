'use strict';
let config = PresenterCore.normalize(), saveQueue = Promise.resolve(), statusTimer;
const fields = {
  spotlight: [['radius', '光の半径', 30, 400, 5, 'px'], ['opacity', '背景の暗さ', .1, .95, .05, '%']],
  area: [['opacity', '背景の暗さ', .1, .95, .05, '%'], ['borderColor', '枠線の色', 'color'], ['borderWidth', '枠線の太さ', 0, 10, 1, 'px']],
  laser: [['color', 'レーザーの色', 'color'], ['radius', '光の半径', 2, 20, 1, 'px'], ['trailLength', '軌跡の長さ', 4, 60, 1, '']],
  ripple: [['leftColor', '左クリックの色', 'color'], ['rightColor', '右クリックの色', 'color'], ['radius', '波紋の大きさ', 10, 100, 5, 'px'], ['duration', '表示時間', 200, 2000, 50, 'ms']],
  pen: [['color', 'マーカーの色', 'color'], ['width', '線の太さ', 1, 30, 1, 'px'], ['opacity', '不透明度', .1, 1, .05, '%'], ['triggerKey', 'クリックなしで描くキー', 'select', [['Shift', 'Shift'], ['Alt', 'Alt'], ['Control', 'Ctrl'], ['Space', 'Space'], ['None', '使わない']]]],
  zoom: [['scale', '初期倍率', 1, 5, .1, '×'], ['minScale', '最小倍率', 1, 3, .1, '×'], ['maxScale', '最大倍率', 1, 5, .1, '×']],
  keycast: [['duration', '表示時間', 500, 5000, 100, 'ms']]
};
for (const [section, specs] of Object.entries(fields)) {
  const container = document.querySelector(`[data-fields="${section}"]`);
  for (const [key, title, min, max, step, unit] of specs) {
    const id = `${section}.${key}`, wrapper = document.createElement('div');
    if (min === 'color') { wrapper.className = 'inline-field'; wrapper.innerHTML = `<label for="${id}">${title}</label><input id="${id}" data-field="${id}" type="color">`; }
    else if (min === 'select') { wrapper.className = 'inline-field'; wrapper.innerHTML = `<label for="${id}">${title}</label><select id="${id}" data-field="${id}">${max.map(([v, label]) => `<option value="${v}">${label}</option>`).join('')}</select>`; }
    else { wrapper.className = 'field'; wrapper.innerHTML = `<div class="field-top"><label for="${id}">${title}</label><output for="${id}" data-output="${id}" data-unit="${unit}"></output></div><input id="${id}" data-field="${id}" type="range" min="${min}" max="${max}" step="${step}">`; }
    container.append(wrapper);
  }
}
for (const [action, title] of Object.entries(PresenterCore.labels)) {
  const row = document.createElement('label'); row.className = 'shortcut-row'; row.innerHTML = `<span>${title}</span><span class="shortcut-select"><span class="pill">Ctrl + Shift</span><select data-field="shortcuts.${action}" aria-label="${title}のキー">${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(k => `<option value="${k}">${k}</option>`).join('')}</select></span>`; document.querySelector('#shortcuts').append(row);
}
function reportError(text) { const message = document.querySelector('#settings-message'); message.textContent = text; message.hidden = !text; }
function render() {
  applyTheme(config.theme); document.querySelector('#theme').value = config.theme;
  const power = document.querySelector('#power'); power.setAttribute('aria-pressed', String(config.enabled)); power.setAttribute('aria-label', config.enabled ? '全機能をOFF' : '機能を有効にする'); power.title = power.getAttribute('aria-label');
  const status = document.querySelector('#status'); status.textContent = config.enabled ? '使用可能' : 'すべてOFF'; status.classList.toggle('off', !config.enabled);
  for (const node of document.querySelectorAll('[data-field]')) {
    const [section, key] = node.dataset.field.split('.'); node.value = config[section][key];
    const output = document.querySelector(`[data-output="${node.dataset.field}"]`);
    if (output) { const value = config[section][key], unit = output.dataset.unit; output.value = unit === '%' ? `${Math.round(value * 100)}%` : unit === '×' ? `${value.toFixed(1)}×` : `${value}${unit ? ' ' + unit : ''}`; node.setAttribute('aria-valuetext', output.value); }
  }
  for (const button of document.querySelectorAll('[data-setting]')) { const [section, key] = button.dataset.setting.split('.'); button.setAttribute('aria-checked', String(config[section][key])); }
}
function save(change) {
  document.querySelector('#save-status').textContent = '保存中…';
  saveQueue = saveQueue.then(async () => {
    const saved = await chrome.storage.local.get('config'), next = PresenterCore.normalize(saved.config);
    change(next); config = PresenterCore.normalize(next);
    await chrome.storage.local.set({ config }); reportError(''); render();
    document.querySelector('#save-status').textContent = '保存しました'; clearTimeout(statusTimer); statusTimer = setTimeout(() => { document.querySelector('#save-status').textContent = '設定は自動保存されます'; }, 1800);
  }).catch(error => { reportError(error.message); document.querySelector('#save-status').textContent = '保存できませんでした'; render(); });
  return saveQueue;
}
document.querySelectorAll('[data-field]').forEach(node => node.addEventListener('input', () => {
  const [section, key] = node.dataset.field.split('.'), value = node.type === 'range' ? Number(node.value) : node.value;
  if (section === 'shortcuts' && Object.entries(config.shortcuts).some(([name, assigned]) => name !== key && assigned === value)) { reportError('そのキーはすでに使われています。別のキーを選択してください。'); render(); return; }
  save(c => { c[section][key] = value; });
}));
document.querySelectorAll('[data-setting]').forEach(node => node.addEventListener('click', () => { const [section, key] = node.dataset.setting.split('.'); save(c => { c[section][key] = !c[section][key]; }); }));
document.querySelector('#theme').addEventListener('change', event => { const value = event.target.value; save(c => { c.theme = value; }); });
document.querySelector('#power').addEventListener('click', () => save(c => { c.enabled = !c.enabled; }));
document.querySelector('#chrome-shortcuts').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => selectPanel(button.dataset.tab)));
function selectPanel(tab) {
  if (!['effects', 'drawing', 'controls', 'guide'].includes(tab)) tab = 'effects';
  for (const node of document.querySelectorAll('[data-panel]')) node.hidden = node.dataset.panel !== tab;
  for (const button of document.querySelectorAll('[data-tab]')) { const selected = button.dataset.tab === tab; button.classList.toggle('active', selected); if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); }
  history.replaceState(null, '', `#${tab}`);
}
document.querySelector('#reset').addEventListener('click', () => { document.querySelector('#reset-confirm').hidden = false; document.querySelector('#reset-apply').focus(); });
document.querySelector('#reset-cancel').addEventListener('click', () => { document.querySelector('#reset-confirm').hidden = true; document.querySelector('#reset').focus(); });
document.querySelector('#reset-apply').addEventListener('click', async () => {
  await save(c => { c.enabled = false; }); // Clear every tab before restoring defaults.
  await save(c => Object.assign(c, structuredClone(PresenterCore.defaults)));
  document.querySelector('#reset-confirm').hidden = true;
});
chrome.storage.onChanged.addListener(changes => { if (changes.config) { config = PresenterCore.normalize(changes.config.newValue); render(); } });
colorScheme.addEventListener('change', () => applyTheme(config.theme));
(async () => { const saved = await chrome.storage.local.get('config'); config = PresenterCore.normalize(saved.config); render(); selectPanel(location.hash.slice(1)); })();
