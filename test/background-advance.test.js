import test from 'node:test';
import assert from 'node:assert/strict';
import { canAdvanceInBackground } from '../src/background-advance.js';

test('background advancement is disabled by default', () => {
  assert.equal(canAdvanceInBackground({ hidden: true, running: true, scanning: false, enabled: false }), false);
});

test('background advancement requires a hidden, running, non-scanning simulation and opt-in', () => {
  assert.equal(canAdvanceInBackground({ hidden: true, running: true, scanning: false, enabled: true }), true);
  assert.equal(canAdvanceInBackground({ hidden: false, running: true, scanning: false, enabled: true }), false);
  assert.equal(canAdvanceInBackground({ hidden: true, running: false, scanning: false, enabled: true }), false);
  assert.equal(canAdvanceInBackground({ hidden: true, running: true, scanning: true, enabled: true }), false);
});
