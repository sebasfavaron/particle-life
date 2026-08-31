#!/usr/bin/env node
import { makeRandomSelfRepelPreset } from '../src/balanced-random.js';
import { encodeShareUrl } from '../src/share-url.js';
const seed = process.argv[2] ?? 'random-self-repel-v1';
console.log(encodeShareUrl(makeRandomSelfRepelPreset(seed), 'https://sebasfavaron.github.io/particle-life/'));
