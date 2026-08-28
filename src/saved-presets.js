export const SAVED_PRESETS_KEY = 'particle-life:saved-presets:v1';
const MAX_SAVED_PRESETS = 30;

function finite(value) { return Number.isFinite(Number(value)); }

function validPreset(preset) {
  if (!preset || typeof preset !== 'object' || !Array.isArray(preset.matrix)) return false;
  const classes = preset.matrix.length;
  if (classes < 1 || classes > 40 || !preset.matrix.every(row => Array.isArray(row) && row.length === classes && row.every(finite))) return false;
  if (preset.classes !== undefined && Number(preset.classes) !== classes) return false;
  for (const key of ['particleCount', 'interactionRadius', 'damping', 'force', 'dt']) if (!finite(preset[key])) return false;
  if (Number(preset.particleCount) < 100 || Number(preset.interactionRadius) <= 0 || Number(preset.dt) <= 0) return false;
  if (preset.masses !== undefined && (!Array.isArray(preset.masses) || preset.masses.length !== classes || preset.masses.some(value => !finite(value) || Number(value) <= 0))) return false;
  if (preset.speed !== undefined && (!finite(preset.speed) || Number(preset.speed) < 1 || Number(preset.speed) > 100)) return false;
  if (preset.zoom !== undefined && (!finite(preset.zoom) || Number(preset.zoom) < .25 || Number(preset.zoom) > 5)) return false;
  return true;
}

function savedName(name, savedAt) {
  const text = String(name ?? '').trim().slice(0, 60);
  return text || `Saved ${new Date(savedAt).toLocaleString()}`;
}

function entryIsValid(entry) {
  return entry && typeof entry === 'object' && typeof entry.id === 'string' && entry.id &&
    typeof entry.name === 'string' && typeof entry.savedAt === 'string' && validPreset(entry.preset);
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }

export class SavedPresetStore {
  constructor(storage, { key = SAVED_PRESETS_KEY, now = () => new Date(), random = () => Math.random() } = {}) {
    this.storage = storage;
    this.key = key;
    this.now = now;
    this.random = random;
  }

  list() {
    let raw;
    try { raw = this.storage.getItem(this.key); }
    catch (_) { return { entries: [], error: 'Saved configurations are unavailable in this browser.', recoverable: false }; }
    if (!raw) return { entries: [], error: null, recoverable: false };
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (_) { return { entries: [], error: 'Invalid saved configurations were replaced.', recoverable: true }; }
    if (!Array.isArray(parsed)) return { entries: [], error: 'Invalid saved configurations were replaced.', recoverable: true };
    const entries = parsed.filter(entryIsValid);
    return {
      entries,
      error: entries.length === parsed.length ? null : 'Some invalid saved configurations were ignored.',
      recoverable: entries.length !== parsed.length,
    };
  }

  save(preset, name = '') {
    if (!validPreset(preset)) return { entry: null, error: 'This configuration cannot be saved.' };
    const current = this.list();
    if (current.error && !current.recoverable) return { entry: null, error: current.error };
    const savedAt = this.now().toISOString();
    const baseId = `${Date.parse(savedAt).toString(36)}-${this.random().toString(36).slice(2, 10)}`;
    let id = baseId, suffix = 1;
    while (current.entries.some(entry => entry.id === id)) id = `${baseId}-${suffix++}`;
    const entry = {
      id,
      name: savedName(name, savedAt),
      savedAt,
      preset: clone(preset),
    };
    const entries = [entry, ...current.entries].slice(0, MAX_SAVED_PRESETS);
    try {
      this.storage.setItem(this.key, JSON.stringify(entries));
      return { entry, error: null };
    } catch (_) {
      return { entry: null, error: 'Could not save here. Browser storage is full or blocked.' };
    }
  }

  remove(id) {
    const current = this.list();
    if (current.error && !current.recoverable) return { removed: false, error: current.error };
    const entries = current.entries.filter(entry => entry.id !== id);
    if (entries.length === current.entries.length) return { removed: false, error: null };
    try {
      this.storage.setItem(this.key, JSON.stringify(entries));
      return { removed: true, error: null };
    } catch (_) {
      return { removed: false, error: 'Could not remove this saved configuration.' };
    }
  }
}
