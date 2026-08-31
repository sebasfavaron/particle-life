import { ParticleLife } from './engine.js';

export function balancedRandomMatrix(seed, classes = 8) {
  if (!Number.isInteger(classes) || classes < 2 || classes % 2) throw new Error('classes must be an even integer of at least 2.');
  const random = ParticleLife.rng(`${seed}:balanced-zero-matrix:${classes}`);
  const matrix = [];
  for (let row = 0; row < classes; row++) {
    const values = [];
    for (let pair = 0; pair < classes / 2; pair++) {
      const magnitude = Math.round((.08 + random() * .87) * 32767);
      const signed = (random() < .5 ? -1 : 1) * magnitude;
      values.push(signed, -signed);
    }
    for (let index = values.length - 1; index > 0; index--) {
      const swap = Math.floor(random() * (index + 1));
      [values[index], values[swap]] = [values[swap], values[index]];
    }
    matrix.push(values.map(value => value / 32767));
  }
  return matrix;
}

export function makeBalancedRandomPreset(seed = 'balanced-zero-v1', classes = 8) {
  return {
    version: 1, seed, particleCount: 5000, classes, interactionRadius: 85,
    damping: .85, force: .005, dt: 2, wrap: true, masses: Array(classes).fill(1),
    speed: 10, zoom: 2.2, showForces: false, creatureEnergy: false,
    matrix: balancedRandomMatrix(seed, classes),
  };
}

export function matrixBalance(matrix) {
  const rowSums = matrix.map(row => row.reduce((sum, value) => sum + value, 0));
  return { rowSums, total: rowSums.reduce((sum, value) => sum + value, 0) };
}


export function randomSelfRepelMatrix(seed, classes = 8) {
  if (!Number.isInteger(classes) || classes < 1 || classes > 40) throw new Error('classes must be an integer from 1 to 40.');
  const random = ParticleLife.rng(`${seed}:random-self-repel:${classes}`);
  return Array.from({ length: classes }, (_, row) => Array.from({ length: classes }, (_, column) => {
    if (row === column) return -(.15 + random() * .85);
    return random() * 2 - 1;
  }));
}

export function makeRandomSelfRepelPreset(seed = 'random-self-repel-v1') {
  const classes = 8;
  return {
    version: 1, seed, particleCount: 5000, classes, interactionRadius: 85,
    damping: .85, force: .005, dt: 2, wrap: true, masses: Array(classes).fill(1),
    speed: 10, zoom: 2.2, showForces: false, creatureEnergy: false,
    matrix: randomSelfRepelMatrix(seed, classes),
  };
}


export function globalBalancedRandomMatrix(seed, classes = 12) {
  if (!Number.isInteger(classes) || classes < 1 || classes > 40) throw new Error('classes must be an integer from 1 to 40.');
  const random = ParticleLife.rng(`${seed}:global-balanced-zero-matrix:${classes}`);
  const values = Array.from({ length: classes * classes }, () => Math.round((random() * 2 - 1) * 25000));
  const total = values.reduce((sum, value) => sum + value, 0);
  const baseCorrection = Math.trunc(total / values.length);
  for (let index = 0; index < values.length; index++) values[index] -= baseCorrection;
  const remainder = values.reduce((sum, value) => sum + value, 0);
  values[0] -= remainder;
  return Array.from({ length: classes }, (_, row) => values.slice(row * classes, row * classes + classes).map(value => value / 32767));
}

export function makeGlobalBalancedRandomPreset(seed = 'global-balanced-zero-v1', classes = 12) {
  return {
    version: 1, seed, particleCount: 5000, classes, interactionRadius: 85,
    damping: .85, force: .005, dt: 2, wrap: true, masses: Array(classes).fill(1),
    speed: 10, zoom: 2.2, showForces: false, creatureEnergy: false,
    matrix: globalBalancedRandomMatrix(seed, classes),
  };
}


export function symmetricChaseMatrix(seed, classes = 12) {
  if (!Number.isInteger(classes) || classes < 2 || classes > 40) throw new Error('classes must be an integer from 2 to 40.');
  const random = ParticleLife.rng(`${seed}:symmetric-chase:${classes}`);
  const symmetric = Array.from({ length: classes }, () => Array(classes).fill(0));
  const chase = Array.from({ length: classes }, () => Array(classes).fill(0));
  let diagonalSum = 0, pairSum = 0;
  for (let index = 0; index < classes; index++) {
    symmetric[index][index] = .30 + random() * .35;
    diagonalSum += symmetric[index][index];
  }
  for (let row = 0; row < classes; row++) for (let column = row + 1; column < classes; column++) {
    const stableRule = random() * .8 - .4;
    symmetric[row][column] = symmetric[column][row] = stableRule;
    pairSum += stableRule;
    const chaseRule = random() * .9 - .45;
    chase[row][column] = chaseRule; chase[column][row] = -chaseRule;
  }
  // Center only the symmetric part: all diagonal cohesion remains, while total system force bias becomes zero.
  const symmetricOffset = (diagonalSum + 2 * pairSum) / (classes * (classes - 1));
  for (let row = 0; row < classes; row++) for (let column = 0; column < classes; column++) if (row !== column) symmetric[row][column] -= symmetricOffset;
  const ints = symmetric.flatMap((row, rowIndex) => row.map((value, columnIndex) => Math.round((value + chase[rowIndex][columnIndex]) * 32767)));
  const total = ints.reduce((sum, value) => sum + value, 0);
  ints[0] -= total;
  return Array.from({ length: classes }, (_, row) => ints.slice(row * classes, row * classes + classes).map(value => value / 32767));
}

export function makeSymmetricChasePreset(seed = 'symmetric-chase-v1', classes = 12, speed = 10) {
  return {
    version: 1, seed, particleCount: 5000, classes, interactionRadius: 85,
    damping: .86, force: .0045, dt: 2, wrap: true, masses: Array(classes).fill(1),
    speed, zoom: 2.2, showForces: false, creatureEnergy: false,
    matrix: symmetricChaseMatrix(seed, classes),
  };
}


export function symmetricRandomMatrix(seed, classes = 12) {
  if (!Number.isInteger(classes) || classes < 1 || classes > 40) throw new Error('classes must be an integer from 1 to 40.');
  const random = ParticleLife.rng(`${seed}:symmetric-random:${classes}`);
  const matrix = Array.from({ length: classes }, () => Array(classes).fill(0));
  for (let row = 0; row < classes; row++) for (let column = row; column < classes; column++) {
    const value = Math.round((random() * 2 - 1) * 30000) / 32767;
    matrix[row][column] = matrix[column][row] = value;
  }
  return matrix;
}

export function makeSymmetricRandomPreset(seed = 'physical-balance-v1', classes = 12) {
  return {
    version: 1, seed, particleCount: 5000, classes, interactionRadius: 85,
    damping: .85, force: .005, dt: 2, wrap: true, masses: Array(classes).fill(1),
    speed: 10, zoom: 2.2, showForces: false, creatureEnergy: false,
    matrix: symmetricRandomMatrix(seed, classes),
  };
}
