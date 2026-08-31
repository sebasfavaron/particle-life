import test from 'node:test';
import assert from 'node:assert/strict';
import { balancedRandomMatrix, globalBalancedRandomMatrix, makeBalancedRandomPreset, makeGlobalBalancedRandomPreset, makeRandomSelfRepelPreset, makeSymmetricChasePreset, makeSymmetricRandomPreset, matrixBalance } from '../src/balanced-random.js';
import { decodeShareUrl, encodeShareUrl } from '../src/share-url.js';

test('balanced random matrix has exactly zero force bias in every row', () => {
  const matrix = balancedRandomMatrix('balanced-test', 8);
  const balance = matrixBalance(matrix);
  assert.ok(balance.rowSums.every(sum => Math.abs(sum) < 1e-12));
  assert.ok(Math.abs(balance.total) < 1e-12);
  assert.ok(matrix.flat().every(value => value >= -1 && value <= 1));
  assert.notDeepEqual(matrix[0], matrix[1]);
});
test('compact current share link retains the zero-balanced matrix', () => {
  const preset = makeBalancedRandomPreset('balanced-test');
  const decoded = decodeShareUrl(encodeShareUrl(preset, 'https://example.test/particle-life/'));
  assert.deepEqual(matrixBalance(decoded.matrix).rowSums, Array(8).fill(0));
  assert.equal(matrixBalance(decoded.matrix).total, 0);
  assert.deepEqual(decoded.masses, Array(8).fill(1));
});

test('random-self-repel preset keeps every same-color rule negative after compact encoding', () => {
  const preset = makeRandomSelfRepelPreset('self-repel-test');
  const decoded = decodeShareUrl(encodeShareUrl(preset, 'https://example.test/particle-life/'));
  for (let index = 0; index < decoded.classes; index++) assert.ok(decoded.matrix[index][index] < 0);
  assert.ok(decoded.matrix.flat().some(value => value > 0));
  assert.ok(decoded.matrix.flat().some(value => value < 0));
});

test('twelve-class balanced random preset remains zero-balanced through compact sharing', () => {
  const preset = makeBalancedRandomPreset('balanced-12-test', 12);
  const decoded = decodeShareUrl(encodeShareUrl(preset, 'https://example.test/particle-life/'));
  assert.equal(decoded.classes, 12);
  assert.ok(matrixBalance(decoded.matrix).rowSums.every(sum => Math.abs(sum) < 1e-12));
});

test('global-balance matrix has zero system sum without zeroing each row', () => {
  const matrix = globalBalancedRandomMatrix('global-balanced-test', 12);
  const balance = matrixBalance(matrix);
  assert.ok(Math.abs(balance.total) < 1e-12);
  assert.ok(balance.rowSums.some(sum => Math.abs(sum) > .01));
  const preset = makeGlobalBalancedRandomPreset('global-balanced-test', 12);
  const decoded = decodeShareUrl(encodeShareUrl(preset, 'https://example.test/particle-life/'));
  assert.ok(Math.abs(matrixBalance(decoded.matrix).total) < 1e-6);
});

test('symmetric-chase preset is equal-mass, globally balanced, and asymmetric enough to chase', () => {
  const preset = makeSymmetricChasePreset('symmetric-chase-test', 12);
  assert.deepEqual(preset.masses, Array(12).fill(1));
  assert.ok(Math.abs(matrixBalance(preset.matrix).total) < 1e-12);
  assert.ok(preset.matrix.some((row, index) => row[index] > .25));
  assert.ok(preset.matrix.some((row, rowIndex) => row.some((value, columnIndex) => rowIndex !== columnIndex && Math.abs(value - preset.matrix[columnIndex][rowIndex]) > .2)));
  const decoded = decodeShareUrl(encodeShareUrl(preset, 'https://example.test/particle-life/'));
  assert.ok(Math.abs(matrixBalance(decoded.matrix).total) < 1e-6);
});

test('physical-balance preset has reciprocal random pair forces after compact sharing', () => {
  const preset = makeSymmetricRandomPreset('physical-balance-test', 12);
  const decoded = decodeShareUrl(encodeShareUrl(preset, 'https://example.test/particle-life/'));
  assert.deepEqual(decoded.masses, Array(12).fill(1));
  for (let row = 0; row < 12; row++) for (let column = 0; column < 12; column++) assert.equal(decoded.matrix[row][column], decoded.matrix[column][row]);
  assert.ok(decoded.matrix.flat().some(value => value > 0));
  assert.ok(decoded.matrix.flat().some(value => value < 0));
});

test('symmetric-chase generator retains requested speed', () => {
  assert.equal(makeSymmetricChasePreset('speed-test', 20, 66).speed, 66);
});
