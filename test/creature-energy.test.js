import test from 'node:test';
import assert from 'node:assert/strict';
import { ParticleLife } from '../src/engine.js';

function setCluster(sim, indices, x, y) {
  for (const [offset, index] of indices.entries()) {
    sim.x[index] = x + (offset % 4) * 2; sim.y[index] = y + Math.floor(offset / 4) * 2;
    sim.vx[index] = 0; sim.vy[index] = 0;
  }
}
function settleDetection(sim) { for (let i = 0; i < sim.energyDetectionInterval; i++) sim.step(); }
function total(sim) { return sim.getCreatureEnergyMetrics().total; }

test('creature energy is off by default and does not change normal physics', () => {
  const options = { count: 80, types: 3, width: 300, height: 200, seed: 'same' };
  const a = new ParticleLife(options), b = new ParticleLife(options);
  for (let i = 0; i < 3; i++) { a.step(); b.step(); }
  assert.equal(a.creatureEnergy, false);
  assert.deepEqual([...a.x], [...b.x]); assert.deepEqual([...a.vx], [...b.vx]);
});
test('creature energy detects compact groups and conserves total energy while spending', () => {
  const sim = new ParticleLife({ count: 24, types: 2, width: 400, height: 300, seed: 'energy' });
  setCluster(sim, [...Array(24).keys()], 120, 120); sim.setCreatureEnergy(true); sim.creatureMinSize = 12;
  settleDetection(sim);
  const metrics = sim.getCreatureEnergyMetrics();
  assert.equal(metrics.creatures, 1);
  assert.ok(Math.abs(metrics.total - 100) < 1e-9);
  assert.ok(metrics.ambient > 0, 'interaction work transfers energy to ambient');
});
test('split, merge, and entering particles conserve creature-system energy', () => {
  const sim = new ParticleLife({ count: 24, types: 2, width: 500, height: 300, seed: 'energy-flow' });
  sim.energyCost = 0;
  setCluster(sim, [...Array(24).keys()], 100, 100); sim.setCreatureEnergy(true); sim.creatureMinSize = 12; settleDetection(sim);
  assert.equal(sim.getCreatureEnergyMetrics().creatures, 1); assert.ok(Math.abs(total(sim) - 100) < 1e-9);
  setCluster(sim, [...Array(12).keys()], 80, 100); setCluster(sim, Array.from({ length: 12 }, (_, i) => i + 12), 400, 100); settleDetection(sim);
  assert.equal(sim.getCreatureEnergyMetrics().creatures, 2); assert.ok(Math.abs(total(sim) - 100) < 1e-9);
  setCluster(sim, [...Array(24).keys()], 160, 100); settleDetection(sim);
  assert.equal(sim.getCreatureEnergyMetrics().creatures, 1); assert.ok(Math.abs(total(sim) - 100) < 1e-9);
});
test('an unbound particle joining a creature transfers bounded ambient energy', () => {
  const sim = new ParticleLife({ count: 24, types: 2, width: 1600, height: 300, seed: 'join' });
  sim.energyCost = 0; sim.creatureMinSize = 12;
  setCluster(sim, [...Array(12).keys()], 100, 100);
  for (let i = 12; i < 24; i++) setCluster(sim, [i], 500 + (i - 12) * 60, 100);
  sim.setCreatureEnergy(true); settleDetection(sim);
  const before = sim.getCreatureEnergyMetrics(); assert.equal(before.creatures, 1);
  setCluster(sim, [12], 105, 105); settleDetection(sim);
  const after = sim.getCreatureEnergyMetrics();
  assert.equal(after.creatures, 1);
  assert.ok(after.creatureEnergy > before.creatureEnergy);
  assert.ok(Math.abs(after.total - 100) < 1e-9);
});
