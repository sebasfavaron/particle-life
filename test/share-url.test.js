import test from 'node:test';
import assert from 'node:assert/strict';
import { ParticleLife } from '../src/engine.js';
import { decodeShareUrl, encodeShareUrl, SHARE_DEFAULTS } from '../src/share-url.js';

const base = 'https://example.test/particle-life/';
function exported(options = {}) {
  const sim = new ParticleLife(options);
  return { ...sim.exportPreset(), speed: SHARE_DEFAULTS.speed, zoom: SHARE_DEFAULTS.zoom, showForces: SHARE_DEFAULTS.showForces };
}
function core(data) {
  return {
    seed: data.seed, particleCount: data.particleCount, classes: data.classes, interactionRadius: data.interactionRadius,
    damping: data.damping, force: data.force, dt: data.dt, wrap: data.wrap, speed: data.speed, zoom: data.zoom,
    showForces: data.showForces, creatureEnergy: data.creatureEnergy, masses: data.masses, matrix: data.matrix,
  };
}

test('default share URL is just the base URL', () => {
  assert.equal(encodeShareUrl(exported(), base), base);
});
test('scalar, matrix, and mass deltas are readable and round-trip', () => {
  const preset = exported({ count: 7000, types: 3, radius: 92, force: .04, damping: .9, dt: 1.5, wrap: false, seed: 'delta-seed' });
  preset.speed = 7; preset.zoom = 1.3; preset.showForces = true;
  preset.matrix[1][2] = Math.fround(.35); preset.masses[2] = 1.5;
  const url = encodeShareUrl(preset, base);
  assert.match(url, /\?s=delta-seed&p=7000&c=3&r=92&d=0.9&f=0.04&t=1.5&v=7&z=1.3&w=0&a=1&x=1,2,0.35&m=2,1.5$/);
  assert.ok(!url.includes('%'));
  assert.deepEqual(core(decodeShareUrl(url)), core(preset));
});
test('random deterministic matrices do not become URL payload', () => {
  const preset = exported({ seed: 'a-new-random-matrix' });
  const url = encodeShareUrl(preset, base);
  assert.equal(url, `${base}?s=a-new-random-matrix`);
  assert.deepEqual(core(decodeShareUrl(url)), core(preset));
});
test('a fully edited 40-class matrix uses a short binary fallback', () => {
  const preset = exported();
  preset.matrix = Array.from({ length: 40 }, () => Array(40).fill(.25));
  const url = encodeShareUrl(preset, base);
  assert.match(url, /\?b=[A-Za-z0-9_-]+$/);
  assert.ok(!url.includes('%'));
  assert.ok(url.length < 5000, `binary URL was ${url.length} bytes`);
  const restored = decodeShareUrl(url);
  for (const row of restored.matrix) for (const value of row) assert.ok(Math.abs(value - .25) < 1 / 32767);
});
test('arbitrary seed text uses base64url, never percent escapes', () => {
  const preset = exported({ seed: 'space / emoji ✨' });
  const url = encodeShareUrl(preset, base);
  assert.match(url, /\?s=~[A-Za-z0-9_-]+$/);
  assert.ok(!url.includes('%'));
  assert.equal(decodeShareUrl(url).seed, preset.seed);
});
test('creature energy is an opt-in compact share field', () => {
  const preset = exported(); preset.creatureEnergy = true;
  const url = encodeShareUrl(preset, base);
  assert.equal(url, `${base}?g=1`);
  assert.equal(decodeShareUrl(url).creatureEnergy, true);
});
test('legacy JSON preset URLs continue to load', () => {
  const preset = exported({ types: 2, seed: 'legacy' });
  const legacy = `${base}?preset=${encodeURIComponent(JSON.stringify(preset))}`;
  assert.deepEqual(decodeShareUrl(legacy), preset);
});
test('invalid compact values fail locally', () => {
  assert.throws(() => decodeShareUrl(`${base}?c=41`), /Invalid c/);
  assert.throws(() => decodeShareUrl(`${base}?x=0,99,0.2`), /Invalid matrix delta/);
});
