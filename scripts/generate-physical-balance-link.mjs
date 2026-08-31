#!/usr/bin/env node
import { makeSymmetricRandomPreset } from '../src/balanced-random.js';
import { encodeShareUrl } from '../src/share-url.js';
const seed = process.argv[2] ?? 'physical-balance-v1';
const classes = Number(process.argv[3] ?? 12);
console.log(encodeShareUrl(makeSymmetricRandomPreset(seed, classes), 'https://sebasfavaron.github.io/particle-life/'));
