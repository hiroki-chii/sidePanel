'use strict';

const { normalize, labels } = PresenterCore;
const scripts = ['presenter/core.js', 'presenter/content.js'];
let lastCapture = 0;

async function currentTab(windowId) {
  const [tab] = await chrome.tabs.query({ active: true, ...(Number.isInteger(windowId) ? { windowId } : { currentWindow: true }) });
  if (!tab?.id || !/^(https?|file):/.test(tab.url || '')) throw new Error('通常のWebページでお使いください。Chromeの設定画面やウェブストアでは利用できません。');
  if (/^https:\/\/chrome(webstore\.google\.com|\.google\.com\/webstore)/.test(tab.url)) throw new Error('Chrome ウェブストアでは利用できません。');
  return tab;
}

async function toTab(tab, message) {
  const send = () => chrome.tabs.sendMessage(tab.id, message, { frameId: 0 });
  let state;
  try { state = await send(); } catch { /* A tab opened before installation may have no receiver. */ }
  if (state) return state;
  await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: scripts });
  return send();
}

chrome.runtime.onInstalled.addListener(async () => {
  const { config } = await chrome.storage.local.get('config');
  await chrome.storage.local.set({ config: normalize(config) });
});

chrome.commands.onCommand.addListener(async action => {
  try {
    if (action === 'allOff') { const { config } = await chrome.storage.local.get('config'); await chrome.storage.local.set({ config: { ...normalize(config), enabled: false } }); return; }
    if (!Object.hasOwn(labels, action)) return;
    const tab = await currentTab();
    // A Chrome command also grants activeTab for the snapshot zoom.
    await toTab(tab, { type: 'PC_ACTION', action });
  } catch (error) { console.info('Presenter Cursor:', error.message); }
});

async function handle(message, sender) {
  if (message.type === 'PC_CAPTURE') {
    if (!sender.tab || sender.frameId !== 0) throw new Error('ページからの撮影要求を確認できません。');
    const [active] = await chrome.tabs.query({ active: true, windowId: sender.tab.windowId });
    if (active?.id !== sender.tab.id) throw new Error('撮影対象のタブに戻ってください。');
    if (Date.now() - lastCapture < 600) throw new Error('少し待ってからズームをお試しください。');
    lastCapture = Date.now();
    let image;
    try { image = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' }); }
    catch { throw new Error('ズーム用の画像を取得できません。対象サイトへのアクセス許可を確認してください。'); }
    const [after] = await chrome.tabs.query({ active: true, windowId: sender.tab.windowId });
    if (after?.id !== sender.tab.id) throw new Error('タブが切り替わったため、撮影を中止しました。');
    return { ok: true, image };
  }
  if (message.type === 'PC_FRAME_POINTER') {
    const { path, kind, x, y, button } = message;
    if (!sender.tab || !Number.isInteger(sender.frameId) || sender.frameId <= 0 ||
        !Array.isArray(path) || !path.length || path.length > 32 ||
        !path.every(index => Number.isInteger(index) && index >= 0) ||
        !Number.isFinite(x) || !Number.isFinite(y) ||
        !(kind === 'move' || (kind === 'down' && Number.isInteger(button) && button >= 0 && button <= 5))) {
      throw new Error('フレーム入力を確認できません。');
    }
    const event = { type: 'PC_FRAME_POINTER', path, kind, x, y, ...(kind === 'down' ? { button } : {}) };
    // A direct child needs only the top frame. Nested events are translated by the matching parent.
    await chrome.tabs.sendMessage(sender.tab.id, event, path.length === 1 ? { frameId: 0 } : {});
    return { ok: true };
  }
  if (message.type === 'PC_FRAME_KEY') {
    if (!sender.tab || !Number.isInteger(sender.frameId) || sender.frameId <= 0) throw new Error('フレームを確認できません。');
    const event = { type: 'PC_FRAME_KEY', action: Object.hasOwn(labels, message.action) ? message.action : null, escape: message.escape === true, label: typeof message.label === 'string' ? message.label.slice(0, 60) : '' };
    await chrome.tabs.sendMessage(sender.tab.id, event, { frameId: 0 });
    return { ok: true };
  }
  if (sender.tab) throw new Error('この操作は拡張の設定画面から実行してください。');
  if (message.type === 'PC_STATUS' || message.type === 'PC_ACTION') {
    if (message.type === 'PC_ACTION' && !Object.hasOwn(labels, message.action) && message.action !== 'clearEffects') throw new Error('操作が見つかりません。');
    const tab = await currentTab(message.windowId);
    if (message.tabId !== undefined && message.tabId !== tab.id) throw new Error('操作対象のタブが切り替わりました。');
    return { ok: true, tabId: tab.id, state: await toTab(tab, message) };
  }
  throw new Error('操作が見つかりません。');
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!message?.type?.startsWith('PC_')) return;
  handle(message, sender).then(reply, error => reply({ ok: false, error: error.message }));
  return true;
});
