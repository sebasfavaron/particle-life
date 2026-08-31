#!/usr/bin/env node
import { makeGlobalBalancedRandomPreset, matrixBalance } from '../src/balanced-random.js';
import { encodeShareUrl } from '../src/share-url.js';
const seed = process.argv[2] ?? 'global-balanced-zero-v1';
const classes = Number(process.argv[3] ?? 12);
const preset = makeGlobalBalancedRandomPreset(seed, classes);
const balance = matrixBalance(preset.matrix);
console.error(`seed=${seed} classes=${classes} max-row-bias=${Math.max(...balance.rowSums.map(Math.abs))} total=${balance.total}`);
console.log(encodeShareUrl(preset, 'https://sebasfavaron.github.io/particle-life/'));
