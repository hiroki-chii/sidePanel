const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('updates and subsequent startups remove only the legacy frame rules', async () => {
  const rules = new Set([1, 2, 9]);
  const settings = new Set(['numberingEnabled', 'isNumberingMode', 'wheelSelectEnabled', 'theme']);
  let install, startup;
  const chrome = {
    sidePanel: { setPanelBehavior: async () => {} },
    runtime: {
      onConnect: { addListener() {} },
      onInstalled: { addListener: listener => { install = listener; } },
      onStartup: { addListener: listener => { startup = listener; } }
    },
    storage: { local: { remove: async keys => keys.forEach(key => settings.delete(key)) } },
    declarativeNetRequest: { updateDynamicRules: async ({ removeRuleIds, addRules }) => {
      assert.equal(addRules, undefined);
      removeRuleIds.forEach(id => rules.delete(id));
    } }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8'), { chrome, importScripts() {} });
  await install({ reason: 'update', previousVersion: '1.8.0' });
  assert.deepEqual([...settings], ['theme']);
  assert.deepEqual([...rules], [9]);
  rules.add(1);
  await startup();
  await startup();
  assert.deepEqual([...rules], [9]);
});
