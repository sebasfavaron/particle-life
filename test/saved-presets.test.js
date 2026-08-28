import test from 'node:test';
import assert from 'node:assert/strict';
import { SAVED_PRESETS_KEY, SavedPresetStore } from '../src/saved-presets.js';

const preset = {
  version: 1, seed: 'saved-seed', particleCount: 5000, classes: 3, interactionRadius: 80,
  damping: .82, force: .025, dt: 1, wrap: true, masses: [1, 1.5, .75],
  matrix: [[.2, -.4, .8], [.1, .3, -.6], [.7, -.2, .5]], speed: 4, zoom: 1.3, showForces: true,
};
class MemoryStorage {
  constructor() { this.data = new Map(); }
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, value); }
}
function store(storage = new MemoryStorage()) {
  return new SavedPresetStore(storage, { now: () => new Date('2026-08-29T03:00:00.000Z'), random: () => .123456 });
}

test('saves and restores the complete URL-compatible configuration', () => {
  const s = store();
  const result = s.save(preset, 'Aurora');
  assert.equal(result.error, null);
  assert.equal(result.entry.name, 'Aurora');
  const saved = s.list();
  assert.equal(saved.error, null);
  assert.equal(saved.entries.length, 1);
  assert.deepEqual(saved.entries[0].preset, preset);
  assert.notEqual(saved.entries[0].preset, preset);
  assert.match(saved.entries[0].id, /^[a-z0-9]+-[a-z0-9]+$/);
});
test('uses a readable default name when none is supplied', () => {
  const result = store().save(preset);
  assert.match(result.entry.name, /^Saved /);
});
test('ignores malformed stored entries without breaking valid saved configurations', () => {
  const memory = new MemoryStorage();
  const s = store(memory);
  memory.setItem(SAVED_PRESETS_KEY, JSON.stringify([{ id: 'bad', name: 'Bad', savedAt: 'now', preset: {} }, { id: 'good', name: 'Good', savedAt: 'now', preset }]));
  const result = s.list();
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].name, 'Good');
  assert.match(result.error, /ignored/);
});
test('replaces malformed storage with a fresh saved configuration', () => {
  const memory = new MemoryStorage();
  memory.setItem(SAVED_PRESETS_KEY, '{broken');
  const result = store(memory).save(preset, 'Recovered');
  assert.equal(result.error, null);
  assert.deepEqual(store(memory).list().entries.map(entry => entry.name), ['Recovered']);
});
test('keeps storage failures local', () => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const s = store(blocked);
  assert.match(s.list().error, /unavailable/);
  assert.match(s.save(preset).error, /unavailable/);
});
test('deletes one named saved configuration', () => {
  const s = store();
  const first = s.save(preset, 'First').entry;
  const second = s.save({ ...preset, seed: 'other' }, 'Second').entry;
  assert.equal(s.remove(first.id).removed, true);
  assert.deepEqual(s.list().entries.map(entry => entry.id), [second.id]);
});
