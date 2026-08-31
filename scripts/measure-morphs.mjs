#!/usr/bin/env node
import { ParticleLife } from '../src/engine.js';
import { ENTITY_EXPERIMENTS } from '../src/theory-presets.js';

const steps = Number(process.argv[2] ?? 500);
const sampleEvery = Number(process.argv[3] ?? 50);
if (!Number.isInteger(steps) || steps < 10 || !Number.isInteger(sampleEvery) || sampleEvery < 10) {
  console.error('Usage: node scripts/measure-morphs.mjs [steps>=10] [sampleEvery>=10]'); process.exit(2);
}
function snapshot(sim) {
  const components = new Map();
  for (let i = 0; i < sim.count; i++) {
    const id = sim.particleCreature[i]; if (id < 0) continue;
    let component = components.get(id);
    if (!component) { component = { members: new Set(), colors: Array(sim.types).fill(0) }; components.set(id, component); }
    component.members.add(i); component.colors[sim.kind[i]]++;
  }
  return components;
}
function jaccard(a, b) { let shared = 0; for (const value of a) if (b.has(value)) shared++; return shared / Math.max(1, a.size + b.size - shared); }
function colorChange(a, b) {
  const totalA = a.colors.reduce((sum, value) => sum + value, 0), totalB = b.colors.reduce((sum, value) => sum + value, 0);
  return a.colors.reduce((sum, value, index) => sum + Math.abs(value / totalA - b.colors[index] / totalB), 0) / 2;
}
function measure(experiment) {
  const sim = new ParticleLife({ width: 1600, height: 1000, count: experiment.preset.particleCount, types: experiment.preset.classes, creatureEnergy: true });
  sim.importPreset(experiment.preset); sim.creatureEnergy = true;
  let prior = null, samples = 0, componentSum = 0, mixedSum = 0, transitions = 0, comparisons = 0;
  for (let step = 1; step <= steps; step++) {
    sim.step();
    if (step % sampleEvery !== 0) continue;
    const current = snapshot(sim); samples++; componentSum += current.size;
    mixedSum += [...current.values()].filter(component => component.colors.filter(Boolean).length >= 3).length;
    if (prior) for (const [id, component] of current) {
      const before = prior.get(id); if (!before) { transitions++; continue; }
      comparisons++; if (jaccard(component.members, before.members) < .85 || colorChange(component, before) > .12) transitions++;
    }
    prior = current;
  }
  return { id: experiment.id, name: experiment.name, samples, meanComponents: componentSum / samples,
    meanMixedComponents: mixedSum / samples, transitionRate: transitions / Math.max(1, comparisons),
    final: sim.getCreatureEnergyMetrics() };
}
for (const experiment of ENTITY_EXPERIMENTS) console.log(JSON.stringify(measure(experiment)));
