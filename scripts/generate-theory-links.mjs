#!/usr/bin/env node
import { encodePresetUrl } from '../src/preset-url.js';
import { THEORY_EXPERIMENTS } from '../src/theory-presets.js';

const baseUrl = process.argv[2] ?? 'https://sebasfavaron.github.io/particle-life/';
for (const experiment of THEORY_EXPERIMENTS) {
  console.log(`${experiment.id}. ${experiment.name}`);
  console.log(`Prediction: ${experiment.prediction}`);
  console.log(encodePresetUrl(experiment.preset, baseUrl));
  console.log('');
}
