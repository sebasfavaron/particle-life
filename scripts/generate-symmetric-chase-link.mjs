#!/usr/bin/env node
import { makeSymmetricChasePreset, matrixBalance } from '../src/balanced-random.js';
import { encodeShareUrl } from '../src/share-url.js';
const seed = process.argv[2] ?? 'symmetric-chase-v1';
const classes = Number(process.argv[3] ?? 12);
const speed = Number(process.argv[4] ?? 10);
const preset = makeSymmetricChasePreset(seed, classes, speed);
console.error(JSON.stringify(matrixBalance(preset.matrix)));
console.log(encodeShareUrl(preset, 'https://sebasfavaron.github.io/particle-life/'));
