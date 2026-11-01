const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../presenter/core.js');

function recognize(...coordinates) {
  return PresenterCore.recognizeGesture(coordinates.map(([x, y]) => ({ x, y })));
}

test('horizontal swipes work with sparse events in either direction', () => {
  assert.equal(recognize([180, 60], [132, 64]), 'undoDrawing');
  assert.equal(recognize([50, 60], [75, 55], [106, 62]), 'redoDrawing');
});

test('a click, small drift and a diagonal drag do not edit history', () => {
  assert.equal(recognize([60, 60], [60, 60]), null);
  assert.equal(recognize([60, 60], [75, 62]), null);
  assert.equal(recognize([60, 60], [130, 118]), null);
});

test('shakes and V shapes keep their own actions', () => {
  assert.equal(recognize([0, 0], [120, 2], [0, 0], [120, 2], [0, 0]), 'clearDrawing');
  assert.equal(recognize([0, 0], [25, 25], [50, 50], [75, 25], [100, 0]), 'togglePen');
});
