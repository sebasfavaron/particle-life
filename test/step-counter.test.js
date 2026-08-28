import test from 'node:test';
import assert from 'node:assert/strict';
import { formatStepCount } from '../src/step-counter.js';
test('formats individual and compact delivered step counts', () => {
  assert.equal(formatStepCount(0), '0');
  assert.equal(formatStepCount(999), '999');
  assert.equal(formatStepCount(1000), '1.0k');
  assert.equal(formatStepCount(1250), '1.3k');
  assert.equal(formatStepCount(9999), '10.0k');
  assert.equal(formatStepCount(10000), '10k');
  assert.equal(formatStepCount(1_200_000), '1.2M');
});
