#!/usr/bin/env node
import { makeBalancedRandomPreset, matrixBalance } from '../src/balanced-random.js';
import { encodeShareUrl } from '../src/share-url.js';

const seed = process.argv[2] ?? 'balanced-zero-v1';
const classes = Number(process.argv[3] ?? 8);
const preset = makeBalancedRandomPreset(seed, classes);
const balance = matrixBalance(preset.matrix);
console.error(`seed=${seed} classes=${preset.classes} max-row-error=${Math.max(...balance.rowSums.map(Math.abs))} total=${balance.total}`);
console.log(encodeShareUrl(preset, 'https://sebasfavaron.github.io/particle-life/'));
