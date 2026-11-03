const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const panelSource = fs.readFileSync(path.join(__dirname, '../sidepanel.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function classes() {
  const values = new Set();
  return { toggle(name, on) { if (on) values.add(name); else values.delete(name); }, contains: name => values.has(name) };
}
function fullscreenHarness(initialState) {
  let win = { id: 7, state: initialState }, click, boundsChanged;
  const attrs = {}, updates = [], notices = [];
  const button = { classList: classes(), setAttribute: (key, value) => { attrs[key] = value; }, addEventListener: (_, handler) => { click = handler; } };
  const chrome = { windows: {
    getCurrent: async () => ({ ...win }),
    update: async (id, update) => { updates.push({ id, ...update }); win = { ...win, ...update }; return { ...win }; },
    onBoundsChanged: { addListener: handler => { boundsChanged = handler; } }
  } };
  const context = { dom: { navFullscreen: button }, chrome, console: { error() {} }, showToast: text => notices.push(text) };
  vm.runInNewContext(panelSource.match(/function setupFullscreen\(\) \{[\s\S]*?\n\}/)[0] + '\nsetupFullscreen();', context);
  return { button, attrs, updates, notices, chrome, click: () => click(), external: async state => { win.state = state; await boundsChanged(); } };
}
for (const initial of ['normal', 'maximized']) {
  test('fullscreen returns to the previous ' + initial + ' window state', async () => {
    const h = fullscreenHarness(initial);
    await tick();
    assert.equal(h.attrs['aria-pressed'], 'false');
    await h.click();
    assert.equal(h.updates[0].state, 'fullscreen');
    assert.equal(h.attrs['aria-pressed'], 'true');
    assert.equal(h.button.title, '全画面表示を終了');
    await h.click();
    assert.equal(h.updates[1].state, initial);
    assert.equal(h.attrs['aria-pressed'], 'false');
    assert.equal(h.button.disabled, false);
  });
}
test('external fullscreen changes update the button and preserve the latest window state', async () => {
  const h = fullscreenHarness('normal');
  await tick();
  await h.external('maximized');
  await h.external('fullscreen');
  assert.equal(h.attrs['aria-pressed'], 'true');
  await h.click();
  assert.equal(h.updates[0].state, 'maximized');
  await h.external('fullscreen');
  await h.external('normal');
  assert.equal(h.attrs['aria-pressed'], 'false');
  assert.equal(h.button.classList.contains('active'), false);
});
test('opening a panel in an already fullscreen window supports exiting and handles errors', async () => {
  const h = fullscreenHarness('fullscreen');
  await tick();
  assert.equal(h.attrs['aria-pressed'], 'true');
  await h.click();
  assert.equal(h.updates[0].state, 'maximized');
  h.chrome.windows.update = async () => { throw new Error('Window closed'); };
  await h.click();
  assert.equal(h.button.disabled, false);
  assert.equal(h.notices.length, 1);
});
test('a saved Web View selection restores the tab and bookmark panels', () => {
  const element = () => ({ classList: classes(), style: {}, replaceChildren() {} });
  const dom = Object.fromEntries(['navMain', 'navTools', 'navPresenter', 'navSummary', 'tabsPanel', 'bookmarksPanel', 'toolsPanel', 'summaryPanel', 'presenterPanel', 'addressBarContainer'].map(key => [key, element()]));
  const state = { activeTab: 'web', isSplitView: false };
  let saves = 0;
  const context = { dom, state, applySplitView() {}, saveAppState() { saves++; } };
  vm.runInNewContext(panelSource.match(/function switchTab\(tab\) \{[\s\S]*?\n\}/)[0] + "\nswitchTab('web');", context);
  assert.equal(state.activeTab, 'tabs');
  assert.equal(state.isSplitView, true);
  assert.equal(dom.tabsPanel.classList.contains('active'), true);
  assert.equal(dom.bookmarksPanel.classList.contains('active'), true);
  assert.equal(dom.addressBarContainer.style.display, 'flex');
  assert.equal(saves, 1);
});
test('Presenter Cursor follows the shared stored theme and subsequent changes', async () => {
  const root = { classList: classes() }, select = {};
  let listener;
  const context = {
    document: { documentElement: root, querySelector: () => select, querySelectorAll: () => [] },
    chrome: { storage: {
      local: { get: async key => { assert.equal(key, 'theme'); return { theme: 'light' }; } },
      onChanged: { addListener: handler => { listener = handler; } }
    } }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../presenter/ui.js'), 'utf8'), context);
  await tick();
  assert.equal(root.classList.contains('light-theme'), true);
  listener({ theme: { newValue: 'dark' } }, 'local');
  assert.equal(root.classList.contains('dark-theme'), true);
  assert.equal(root.classList.contains('light-theme'), false);
  assert.equal(select.value, 'dark');
  listener({ theme: { newValue: 'light' } }, 'sync');
  assert.equal(select.value, 'dark');
  listener({ theme: {} }, 'local');
  assert.equal(root.classList.contains('dark-theme'), false);
  assert.equal(root.classList.contains('light-theme'), false);
  assert.equal(select.value, 'system');
});
