#!/usr/bin/env node
import { decodePresetUrl, formatPresetReport } from '../src/preset-url.js';

const args = process.argv.slice(2);
const json = args[0] === '--json';
const input = args.find(arg => arg !== '--json');
if (!input || args.length > 2) {
  console.error('Usage: npm run analyze-preset -- [--json] <shared-particle-life-url>');
  process.exitCode = 2;
} else {
  try {
    const preset = decodePresetUrl(input);
    console.log(json ? JSON.stringify(preset, null, 2) : formatPresetReport(preset));
  } catch (error) {
    console.error(`Preset decode failed: ${error.message}`);
    process.exitCode = 1;
  }
}
