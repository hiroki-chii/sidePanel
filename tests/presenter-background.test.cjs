const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function worker() {
  const calls = [], listeners = {}, data = {};
  let failMessage = false, captureHook = () => {}, active = { id: 10, windowId: 2, url: 'https://example.com/' };
  const chrome = {
    storage: { local: { get: async () => ({ ...data }), set: async value => Object.assign(data, value) } },
    runtime: { onInstalled: { addListener: fn => listeners.install = fn }, onMessage: { addListener: fn => listeners.message = fn } },
    commands: { onCommand: { addListener: fn => listeners.command = fn } },
    tabs: {
      query: async () => [active],
      sendMessage: async (id, message, options) => { calls.push({ kind: 'message', id, message, options }); if (failMessage) { failMessage = false; throw Error('No receiver'); } return { pen: true }; },
      captureVisibleTab: async (windowId, options) => { calls.push({ kind: 'capture', windowId, options }); captureHook(); return 'data:image/png;base64,test'; }
    },
    scripting: { executeScript: async options => calls.push({ kind: 'inject', options }) }
  };
  const context = vm.createContext({ chrome, console, structuredClone });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../presenter/core.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../presenter/background.js'), 'utf8'), context);
  return { calls, data, listeners, onCapture: fn => captureHook = fn, setActive: tab => active = tab, failNextMessage: () => failMessage = true, message: (msg, sender = {}) => new Promise(resolve => listeners.message(msg, sender, resolve)) };
}
test('worker migrates settings and routes commands to the top frame', async () => {
  const w = worker(); w.data.config = { pen: { width: 7 } }; await w.listeners.install();
  assert.equal(w.data.config.pen.width, 7); assert.equal(w.data.config.spotlight.radius, 120);
  await w.listeners.command('togglePen'); assert.equal(w.calls[0].message.action, 'togglePen'); assert.equal(w.calls[0].options.frameId, 0);
  await w.listeners.command('allOff'); assert.equal(w.data.config.enabled, false);
});
test('loaded pages receive fallback injection only when no listener is available', async () => {
  const w = worker(); w.failNextMessage();
  const response = await w.message({ type: 'PC_STATUS' });
  assert.equal(response.ok, true); assert.equal(w.calls[1].kind, 'inject');
  assert.deepEqual(Array.from(w.calls[1].options.files), ['presenter/core.js', 'presenter/content.js']); assert.equal(w.calls[1].options.target.allFrames, true);
  assert.equal(w.calls[2].options.frameId, 0);
});
test('restricted pages and unknown actions return actionable errors', async () => {
  const w = worker(); w.setActive({ id: 10, url: 'chrome://settings' });
  assert.equal((await w.message({ type: 'PC_STATUS' })).ok, false);
  w.setActive({ id: 10, url: 'https://chromewebstore.google.com/detail/test' });
  assert.equal((await w.message({ type: 'PC_ACTION', action: 'togglePen' })).ok, false);
  assert.equal((await w.message({ type: 'PC_ACTION', action: 'unknown' })).ok, false);
  assert.equal((await w.message({ type: 'PC_ACTION', action: 'togglePen' }, { tab: { id: 10 } })).ok, false);
  assert.equal(w.calls.length, 0);
});
test('captures are accepted only from the active tab top frame and rate limited', async () => {
  const w = worker();
  assert.equal((await w.message({ type: 'PC_CAPTURE' })).ok, false);
  assert.equal((await w.message({ type: 'PC_CAPTURE' }, { tab: { id: 10, windowId: 2 }, frameId: 3 })).ok, false);
  assert.equal((await w.message({ type: 'PC_CAPTURE' }, { tab: { id: 99, windowId: 2 }, frameId: 0 })).ok, false);
  const sender = { tab: { id: 10, windowId: 2 }, frameId: 0 };
  assert.equal((await w.message({ type: 'PC_CAPTURE' }, sender)).ok, true);
  assert.equal(w.calls.filter(x => x.kind === 'capture').length, 1);
  assert.equal((await w.message({ type: 'PC_CAPTURE' }, sender)).ok, false);
  const race = worker(); race.onCapture(() => race.setActive({ id: 99, windowId: 2 }));
  const result = await race.message({ type: 'PC_CAPTURE' }, sender);
  assert.equal(result.ok, false); assert.equal(result.image, undefined);
});
test('frame keyboard events use a verified tab sender and bounded payloads', async () => {
  const w = worker();
  assert.equal((await w.message({ type: 'PC_FRAME_KEY', action: 'toggleZoom' })).ok, false);
  assert.equal((await w.message({ type: 'PC_FRAME_KEY' }, { tab: { id: 10 }, frameId: 0 })).ok, false);
  const response = await w.message({ type: 'PC_FRAME_KEY', action: 'unknown', label: 'a'.repeat(1000), escape: true }, { tab: { id: 10 }, frameId: 5 });
  assert.equal(response.ok, true); assert.equal(w.calls[0].message.action, null); assert.equal(w.calls[0].message.label.length, 60); assert.equal(w.calls[0].options.frameId, 0);
});
test('presenter ignores the existing numbering command and rejects a stale panel action', async () => {
  const w = worker();
  await w.listeners.command('toggle-numbering');
  const response = await w.message({ type: 'PC_ACTION', action: 'togglePen', tabId: 11 });
  assert.equal(response.ok, false);
  assert.equal(w.calls.length, 0);
});
