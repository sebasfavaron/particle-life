import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePreset, decodePresetUrl, encodePresetUrl, formatPresetReport } from '../src/preset-url.js';
import { ENTITY_EXPERIMENTS, THEORY_EXPERIMENTS } from '../src/theory-presets.js';

const preset = { classes: 3, particleCount: 30, interactionRadius: 80, force: .005, dt: 2, damping: .85,
  masses: [1, .5, 2], matrix: [[.1, .8, -.2], [-.4, .2, .5], [.3, -.6, .1]] };
const url = `https://example.test/?preset=${encodeURIComponent(JSON.stringify(preset))}`;

test('decodes a URL-encoded preset without manual parsing', () => {
  assert.deepEqual(decodePresetUrl(url), preset);
});
test('rejects absent, malformed, and inconsistent presets', () => {
  assert.throws(() => decodePresetUrl('https://example.test/'), /no preset/);
  assert.throws(() => decodePresetUrl('https://example.test/?preset=%7B'), /not valid JSON/);
  assert.throws(() => decodePresetUrl(`https://example.test/?preset=${encodeURIComponent(JSON.stringify({...preset, classes: 2}))}`), /does not match/);
});
test('reports mass-adjusted chase/flee interactions', () => {
  const report = analyzePreset(preset);
  const red = report.classes[1];
  assert.equal(red.label, 'red (2)');
  assert.equal(red.gain, .005 * 2 * .85 ** 2 / .5);
  assert.ok(report.chasePairs.some(pair => pair.relation === 'cyan (1) chases red (2); red (2) flees cyan (1)'));
  assert.match(formatPresetReport(preset), /Chase\/flee pairs/);
});

test('encoder round-trips theory experiment links without manual escaping', () => {
  assert.equal(THEORY_EXPERIMENTS.length, 5);
  for (const experiment of THEORY_EXPERIMENTS) {
    const link = encodePresetUrl(experiment.preset);
    assert.match(link, /^https:\/\/sebasfavaron\.github\.io\/particle-life\/\?preset=/);
    assert.deepEqual(decodePresetUrl(link), experiment.preset);
  }
});

test('mixed-entity presets are valid deterministic encoded configurations', () => {
  assert.equal(ENTITY_EXPERIMENTS.length, 3);
  for (const experiment of ENTITY_EXPERIMENTS) {
    const link = encodePresetUrl(experiment.preset);
    assert.equal(decodePresetUrl(link).creatureEnergy, true);
    assert.equal(experiment.preset.matrix.length, 6);
  }
});
