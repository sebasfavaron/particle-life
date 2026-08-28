import { ParticleLife } from './engine.js';

export const SHARE_DEFAULTS = Object.freeze({
  version: 1, seed: 'clusters', particleCount: 5000, classes: 40, interactionRadius: 80,
  damping: .82, force: .025, dt: 1, wrap: true, speed: 4, zoom: 1, showForces: false,
});
const SAFE_TEXT = /^[A-Za-z0-9._~-]+$/;
const SCALARS = [
  ['p', 'particleCount'], ['c', 'classes'], ['r', 'interactionRadius'], ['d', 'damping'],
  ['f', 'force'], ['t', 'dt'], ['v', 'speed'], ['z', 'zoom'],
];

function finite(value) { return Number.isFinite(Number(value)); }
function compactNumber(value) { return String(Number(Number(value).toFixed(6))); }
function sameNumber(left, right) { return Number(left) === Number(right); }
function base64url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
function fromBase64url(text) {
  const padded = text.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - text.length % 4) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
}
function bytesToBase64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
function bytesFromBase64url(text) {
  const padded = text.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - text.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
function encodeMatrixBinary(matrix) {
  const bytes = new Uint8Array(matrix.length * 2), view = new DataView(bytes.buffer);
  for (let index = 0; index < matrix.length; index++) view.setInt16(index * 2, Math.round(Number(matrix[index]) * 32767), true);
  return bytesToBase64url(bytes);
}
function decodeMatrixBinary(text, size) {
  let bytes;
  try { bytes = bytesFromBase64url(text); } catch { throw new Error('Invalid compact matrix.'); }
  if (bytes.length !== size * size * 2) throw new Error('Invalid compact matrix.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: size * size }, (_, index) => view.getInt16(index * 2, true) / 32767);
}
function encodeSeed(seed) {
  const text = String(seed);
  return SAFE_TEXT.test(text) ? text : `~${base64url(text)}`;
}
function decodeSeed(text) {
  if (!text) return SHARE_DEFAULTS.seed;
  try { return text.startsWith('~') ? fromBase64url(text.slice(1)) : text; }
  catch { throw new Error('Invalid compact seed.'); }
}
function defaultMatrix(seed, classes) {
  return new ParticleLife({ count: 1, seed, types: classes }).matrix;
}
function readNumber(params, key, fallback, { min = -Infinity, max = Infinity, integer = false } = {}) {
  if (!params.has(key)) return fallback;
  const value = Number(params.get(key));
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error(`Invalid ${key} parameter.`);
  return value;
}
function parseDeltas(text, size, label) {
  if (!text) return [];
  const deltas = text.split(';').map(item => item.split(','));
  if (deltas.length > size * size) throw new Error(`Too many ${label} deltas.`);
  return deltas.map(parts => {
    if (parts.length !== 3) throw new Error(`Invalid ${label} delta.`);
    const [row, col, value] = parts.map(Number);
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= size || col < 0 || col >= size || !Number.isFinite(value) || value < -1 || value > 1) throw new Error(`Invalid ${label} delta.`);
    return [row, col, value];
  });
}
function parseMassDeltas(text, size) {
  if (!text) return [];
  const deltas = text.split(';').map(item => item.split(','));
  if (deltas.length > size) throw new Error('Too many mass deltas.');
  return deltas.map(parts => {
    if (parts.length !== 2) throw new Error('Invalid mass delta.');
    const [index, value] = parts.map(Number);
    if (!Number.isInteger(index) || index < 0 || index >= size || !Number.isFinite(value) || value <= 0 || value > 5) throw new Error('Invalid mass delta.');
    return [index, value];
  });
}
function validatePreset(data) {
  if (!data || !Array.isArray(data.matrix) || data.matrix.length < 1 || data.matrix.length > 40) throw new Error('Preset must contain a 1–40 square matrix.');
  const classes = data.matrix.length;
  if (data.classes !== undefined && Number(data.classes) !== classes) throw new Error('Preset classes do not match matrix size.');
  if (!data.matrix.every(row => Array.isArray(row) && row.length === classes && row.every(finite))) throw new Error('Preset matrix must be finite and square.');
  if (data.masses !== undefined && (!Array.isArray(data.masses) || data.masses.length !== classes || data.masses.some(value => !finite(value) || Number(value) <= 0))) throw new Error('Preset masses are invalid.');
  return classes;
}
function legacyPreset(raw) {
  try {
    const data = JSON.parse(raw);
    validatePreset(data);
    return data;
  } catch (error) { throw new Error(`Invalid legacy preset: ${error.message}`); }
}

export function encodeShareUrl(data, baseUrl) {
  const classes = validatePreset(data);
  const seed = String(data.seed ?? SHARE_DEFAULTS.seed);
  const matrixDefault = defaultMatrix(seed, classes);
  const parts = [];
  if (seed !== SHARE_DEFAULTS.seed) parts.push(`s=${encodeSeed(seed)}`);
  for (const [key, field] of SCALARS) {
    const value = field === 'classes' ? classes : (data[field] ?? SHARE_DEFAULTS[field]);
    if (!sameNumber(value, SHARE_DEFAULTS[field])) parts.push(`${key}=${compactNumber(value)}`);
  }
  if (Boolean(data.wrap ?? SHARE_DEFAULTS.wrap) !== SHARE_DEFAULTS.wrap) parts.push('w=0');
  if (Boolean(data.showForces ?? SHARE_DEFAULTS.showForces) !== SHARE_DEFAULTS.showForces) parts.push('a=1');
  const matrix = data.matrix.flat();
  const matrixDeltas = [];
  for (let index = 0; index < matrix.length; index++) {
    if (Math.abs(Number(matrix[index]) - matrixDefault[index]) > 1e-6) {
      matrixDeltas.push(`${Math.floor(index / classes)},${index % classes},${compactNumber(matrix[index])}`);
    }
  }
  if (matrixDeltas.length) {
    const deltaText = matrixDeltas.join(';');
    const binary = encodeMatrixBinary(matrix);
    parts.push(deltaText.length <= binary.length ? `x=${deltaText}` : `b=${binary}`);
  }
  const masses = data.masses ?? Array(classes).fill(1);
  const massDeltas = [];
  for (let index = 0; index < classes; index++) if (Math.abs(Number(masses[index]) - 1) > 1e-6) massDeltas.push(`${index},${compactNumber(masses[index])}`);
  if (massDeltas.length) parts.push(`m=${massDeltas.join(';')}`);
  const url = new URL(baseUrl);
  return `${url.origin}${url.pathname}${parts.length ? `?${parts.join('&')}` : ''}${url.hash}`;
}

export function decodeShareUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error('Expected an absolute share URL.'); }
  const params = url.searchParams;
  if (params.has('preset')) return legacyPreset(params.get('preset'));
  const seed = decodeSeed(params.get('s'));
  const classes = readNumber(params, 'c', SHARE_DEFAULTS.classes, { min: 1, max: 40, integer: true });
  const data = {
    ...SHARE_DEFAULTS,
    seed,
    classes,
    particleCount: readNumber(params, 'p', SHARE_DEFAULTS.particleCount, { min: 100, max: 50000, integer: true }),
    interactionRadius: readNumber(params, 'r', SHARE_DEFAULTS.interactionRadius, { min: 1, max: 360 }),
    damping: readNumber(params, 'd', SHARE_DEFAULTS.damping, { min: 0, max: 1 }),
    force: readNumber(params, 'f', SHARE_DEFAULTS.force, { min: 0, max: 1 }),
    dt: readNumber(params, 't', SHARE_DEFAULTS.dt, { min: .01, max: 10 }),
    speed: readNumber(params, 'v', SHARE_DEFAULTS.speed, { min: 1, max: 100, integer: true }),
    zoom: readNumber(params, 'z', SHARE_DEFAULTS.zoom, { min: .25, max: 5 }),
    wrap: params.get('w') !== '0',
    showForces: params.get('a') === '1',
    masses: Array(classes).fill(1),
    matrix: Array.from({ length: classes }, () => Array(classes).fill(0)),
  };
  if (params.has('b') && params.has('x')) throw new Error('URL has both compact and delta matrix data.');
  const matrix = params.has('b') ? Float32Array.from(decodeMatrixBinary(params.get('b'), classes)) : defaultMatrix(seed, classes);
  for (const [row, col, value] of parseDeltas(params.get('x'), classes, 'matrix')) matrix[row * classes + col] = value;
  for (const [index, value] of parseMassDeltas(params.get('m'), classes)) data.masses[index] = value;
  data.matrix = Array.from({ length: classes }, (_, row) => Array.from(matrix.slice(row * classes, row * classes + classes)));
  return data;
}
