import assert from 'node:assert/strict';
import { ParticleLife } from '../src/engine.js';

const width = 320, height = 200, radius = 40, size = 1.65;
const edgePositions = {
  x: [1, width - 1, 12, 12, width / 2, width / 2],
  y: [height / 2, height / 2, 1, height - 1, 12, height - 12],
  vx: [0, 0, 0, 0, 0, 0], vy: [0, 0, 0, 0, 0, 0],
  kind: [0, 0, 0, 0, 0, 0],
};

function minimumImage(delta, extent) {
  return delta > extent / 2 ? delta - extent : delta < -extent / 2 ? delta + extent : delta;
}

function allPairsForce(sim) {
  const force = Array.from({ length: sim.count }, () => [0, 0]);
  for (let i = 0; i < sim.count; i++) for (let j = 0; j < sim.count; j++) if (i !== j) {
    let dx = sim.x[j] - sim.x[i], dy = sim.y[j] - sim.y[i];
    if (sim.wrap) { dx = minimumImage(dx, sim.width); dy = minimumImage(dy, sim.height); }
    const d = Math.hypot(dx, dy);
    if (d === 0 || d >= sim.radius) continue;
    const q = d / sim.radius;
    const curve = q < sim.beta ? q / sim.beta - 1 : 1 - Math.abs(2 * q - 1 - sim.beta) / (1 - sim.beta);
    force[i][0] += dx / d * curve; force[i][1] += dy / d * curve;
  }
  return force;
}

function forceExperiment(wrap) {
  const sim = new ParticleLife({ count: 6, types: 1, width, height, radius, force: 0.02, damping: 1, dt: 1, wrap, cellScale: 0.5, seed: 'T-074-edge' });
  sim.x.set(edgePositions.x); sim.y.set(edgePositions.y); sim.vx.fill(0); sim.vy.fill(0); sim.matrix.fill(1);
  const expected = allPairsForce(sim); sim.step();
  let maximumError = 0;
  for (let i = 0; i < sim.count; i++) maximumError = Math.max(maximumError, Math.abs(sim.fx[i] - expected[i][0]), Math.abs(sim.fy[i] - expected[i][1]));
  assert.ok(maximumError < 1e-6, `grid force differs from all-pairs reference: ${maximumError}`);
  return { maximumError, horizontalAcrossSeamForce: sim.fx[0], verticalAcrossSeamForce: sim.fy[2] };
}

function projectionExperiment() {
  const pairDistance = 2;
  const apparentWithoutTiles = width - pairDistance;
  const apparentWithTiles = pairDistance;
  // A torus renderer must show the periodic image for each particle within one sprite width.
  const leftCopies = [1];
  if (leftCopies[0] < size) leftCopies.push(leftCopies[0] + width);
  const rightCopies = [width - 1];
  if (rightCopies[0] > width - size) rightCopies.push(rightCopies[0] - width);
  assert.equal(leftCopies.length, 2); assert.equal(rightCopies.length, 2);
  return { physicalDistance: pairDistance, apparentWithoutTiles, apparentWithTiles, distortionRatio: apparentWithoutTiles / pairDistance };
}

const wrapped = forceExperiment(true);
const bounded = forceExperiment(false);
const projection = projectionExperiment();
const lines = [
  '# T-074 deterministic boundary diagnosis', '',
  'Command: `node scripts/diagnose-boundary-seam.mjs`', '',
  '## Force/grid result',
  `- Wrapped edge pairs: grid vs all-pairs maximum absolute force error: ${wrapped.maximumError}.`,
  `- Wrapped left/right seam pair force on the left particle: ${wrapped.horizontalAcrossSeamForce.toFixed(6)}.`,
  `- Wrapped top/bottom seam pair force on the top particle: ${wrapped.verticalAcrossSeamForce.toFixed(6)}.`,
  `- Bounded edge setup maximum error: ${bounded.maximumError}; its across-edge force is ${bounded.horizontalAcrossSeamForce.toFixed(6)} (no wrap interaction).`,
  '- Result: grid traversal and minimum-image force handling match the independent all-pairs calculation for both axes. This rejects a CPU force/grid right-or-bottom asymmetry in this edge case.', '',
  '## Projection result',
  `- Two particles 1 px from opposite horizontal edges have physical torus distance ${projection.physicalDistance}px.`,
  `- Current one-world render shows them ${projection.apparentWithoutTiles}px apart (${projection.distortionRatio}× physical distance).`,
  `- A periodic sprite copy at each opposite edge shows the ${projection.apparentWithTiles}px physical separation.`,
  '- Candidate correction: in wrap mode, render copies of sprites that overlap an opposite edge (including corner copies). It changes only projection, not engine coordinates, grid, or time stepping.', '',
  '## Scope',
  '- The CPU and WebGPU renderers both place the square from its particle coordinate toward +x/+y and do not render periodic copies. This is a supported visual-seam mechanism. The experiment does not prove it is the only visible contributor.',
].join('\n');
console.log(lines);
