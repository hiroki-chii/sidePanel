'use strict';
let config = PresenterCore.normalize(), current = null, unavailable = false, busy = false;
let windowId, tabId, statusPort, revision = 0;
const modeFor = { toggleSpotlight: 'spotlight', toggleAreaSpotlight: 'area', toggleLaser: 'laser', togglePen: 'pen', toggleZoom: 'zoom' };
const message = document.querySelector('#message'), status = document.querySelector('#status'), power = document.querySelector('#power');
function notify(text, error = false) { message.textContent = text; message.hidden = !text; message.classList.toggle('error', error); }
function render() {
  power.setAttribute('aria-pressed', String(config.enabled)); power.setAttribute('aria-label', config.enabled ? '全機能をOFF' : '機能を有効にする'); power.title = power.getAttribute('aria-label');
  status.textContent = unavailable ? '利用できません' : config.enabled ? '使用可能' : 'すべてOFF'; status.classList.toggle('off', unavailable || !config.enabled);
  for (const button of document.querySelectorAll('[data-action]')) {
    const action = button.dataset.action;
    button.disabled = unavailable || !current || !config.enabled || busy;
    if (modeFor[action]) {
      button.setAttribute('aria-pressed', String(!!current?.[modeFor[action]]));
      button.querySelector('.key').textContent = `Ctrl + Shift + ${config.shortcuts[action]}`;
    }
  }
  for (const button of document.querySelectorAll('[data-setting]')) {
    const [section, key] = button.dataset.setting.split('.'); button.setAttribute('aria-checked', String(config[section][key])); button.disabled = !config.enabled || busy;
  }
}
async function updateConfig(change) {
  // Read immediately before writing, so another settings window's edits survive.
  const saved = await chrome.storage.local.get('config'); config = PresenterCore.normalize(saved.config); change(config); config = PresenterCore.normalize(config); await chrome.storage.local.set({ config }); render();
}
document.querySelector('#open-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
power.addEventListener('click', async () => { try { await updateConfig(c => { c.enabled = !c.enabled; }); if (!config.enabled) current = null; await refresh(); } catch (e) { notify(e.message, true); } });
document.querySelectorAll('[data-setting]').forEach(button => button.addEventListener('click', async () => {
  const [section, key] = button.dataset.setting.split('.'); try { await updateConfig(c => { c[section][key] = !c[section][key]; }); } catch (e) { notify(e.message, true); }
}));
document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', async () => {
  const request = revision;
  busy = true; render();
  try {
    const result = await chrome.runtime.sendMessage({ type: 'PC_ACTION', windowId, tabId, action: button.dataset.action });
    if (revision !== request) return;
    if (!result?.ok) throw new Error(result?.error || 'ページに接続できません。ページを再読み込みしてください。');
    current = result.state; notify('');
    if (current?.selecting) notify('ページに戻り、明るくする範囲をドラッグしてください。');
    else if (current?.zoom) notify('ページに戻るとズーム表示になります。ホイールで倍率調整、Escで終了。');
  } catch (e) { if (revision === request) notify(e.message, true); }
  finally { busy = false; render(); }
}));
async function refresh() {
  const request = ++revision;
  statusPort?.disconnect();
  statusPort = null;
  tabId = null;
  current = null;
  render();
  try {
    const result = await chrome.runtime.sendMessage({ type: 'PC_STATUS', windowId });
    if (request !== revision) return;
    if (!result?.ok) throw new Error(result?.error || 'ページに接続できません。');
    tabId = result.tabId;
    current = result.state;
    unavailable = false;
    notify(config.enabled ? '' : '右上の電源ボタンをオンにすると、ツールを使えます。');
    statusPort = chrome.tabs.connect(tabId, { frameId: 0, name: 'presenter-status' });
    statusPort.onMessage.addListener(state => {
      if (revision !== request) return;
      current = state;
      render();
    });
    statusPort.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError;
      if (revision !== request) return;
      current = null;
      if (error) notify('ページに接続できません。再読み込みしてください。', true);
      render();
    });
  } catch (e) {
    if (request !== revision) return;
    unavailable = true;
    notify(e.message, true);
  }
  render();
}
chrome.storage.onChanged.addListener(changes => { if (changes.config) { config = PresenterCore.normalize(changes.config.newValue); render(); } });
(async () => {
  windowId = (await chrome.windows.getCurrent()).id;
  chrome.tabs.onActivated.addListener(info => { if (info.windowId === windowId) refresh(); });
  chrome.tabs.onUpdated.addListener((id, change, tab) => {
    if (tab.windowId === windowId && tab.active && change.status === 'complete') refresh();
  });
  const saved = await chrome.storage.local.get('config');
  config = PresenterCore.normalize(saved.config);
  await refresh();
})();
