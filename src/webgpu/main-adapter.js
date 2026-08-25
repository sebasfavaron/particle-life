import { WebGpuParticleLifeBackend } from './webgpu-backend.js';

/**
 * Convert the current CPU ParticleLife state to the backend reset format.
 * The returned typed arrays are snapshots. Particle state is interleaved as x,y,vx,vy.
 *
 * @param {import('../engine.js').ParticleLife} sim
 * @returns {{
 *   width: number, height: number, count: number, types: number,
 *   radius: number, force: number, damping: number, dt: number,
 *   beta: number, wrap: boolean, states: Float32Array, kinds: Uint32Array,
 *   matrix: Float32Array, masses: Float32Array, drawOrder: Uint32Array
 * }}
 */
export function cpuStateToGpuUpload(sim) {
  if (!sim || !Number.isInteger(sim.count) || sim.count <= 0) {
    throw new TypeError('A CPU ParticleLife instance is required.');
  }

  const states = new Float32Array(sim.count * 4);
  for (let index = 0; index < sim.count; index += 1) {
    const offset = index * 4;
    states[offset] = sim.x[index];
    states[offset + 1] = sim.y[index];
    states[offset + 2] = sim.vx[index];
    states[offset + 3] = sim.vy[index];
  }

  return {
    width: sim.width,
    height: sim.height,
    count: sim.count,
    types: sim.types,
    radius: sim.radius,
    force: sim.force,
    damping: sim.damping,
    dt: sim.dt,
    beta: sim.beta,
    wrap: sim.wrap,
    states,
    kinds: Uint32Array.from(sim.kind),
    matrix: Float32Array.from(sim.matrix),
    masses: Float32Array.from(sim.masses),
    drawOrder: Uint32Array.from(sim.drawOrder),
  };
}

function positiveOrFallback(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Create the thin WebGPU adapter used by the main UI opt-in path.
 *
 * `sim` remains the CPU source for resets and settings. Normal `stepMany()` and
 * `render()` calls stay on the GPU and do not read GPU buffers.
 *
 * - `resetFromCpu()` uploads an exact snapshot of particle and physics state.
 * - `configureFromCpu()` syncs scalar physics, matrix, and masses. A count or type
 *   change requires new buffers, so that case performs a full CPU reset upload.
 * - `resizeFromCpu(options)` syncs canvas pixels and the CPU world's dimensions.
 *
 * WebGpuAvailabilityError instances from backend creation are not caught or wrapped.
 *
 * @param {{
 *   canvas: HTMLCanvasElement,
 *   sim: import('../engine.js').ParticleLife,
 *   palette?: string[],
 *   clearColor?: string | number[],
 *   worldScale?: number,
 *   cssWidth?: number,
 *   cssHeight?: number,
 *   dpr?: number
 * }} options
 * @returns {Promise<{
 *   stepMany(count?: number): number,
 *   render(): void,
 *   resetFromCpu(): object,
 *   configureFromCpu(): object,
 *   resizeFromCpu(options?: {cssWidth?: number, cssHeight?: number, dpr?: number, worldScale?: number}): object,
 *   destroy(): void,
 *   readonly metadata: object
 * }>}
 */
export async function createWebGpuMainAdapter({
  canvas,
  sim,
  palette,
  clearColor,
  worldScale = 1,
  cssWidth,
  cssHeight,
  dpr,
} = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('A canvas is required.');

  const initialUpload = cpuStateToGpuUpload(sim);
  let layout = {
    worldScale: positiveOrFallback(worldScale, 1),
    dpr: positiveOrFallback(dpr, positiveOrFallback(globalThis.devicePixelRatio, 1)),
    cssWidth,
    cssHeight,
  };
  layout.cssWidth = positiveOrFallback(
    layout.cssWidth,
    positiveOrFallback(canvas.clientWidth, positiveOrFallback(canvas.width / layout.dpr, sim.width / layout.worldScale)),
  );
  layout.cssHeight = positiveOrFallback(
    layout.cssHeight,
    positiveOrFallback(canvas.clientHeight, positiveOrFallback(canvas.height / layout.dpr, sim.height / layout.worldScale)),
  );

  const backend = await WebGpuParticleLifeBackend.create(canvas, {
    ...initialUpload,
    reset: initialUpload,
    palette,
    clearColor,
    worldScale: layout.worldScale,
  });

  function resetFromCpu() {
    return backend.reset(cpuStateToGpuUpload(sim));
  }

  function configureFromCpu() {
    if (backend.config.particleCount !== sim.count || backend.config.typeCount !== sim.types) {
      return resetFromCpu();
    }
    backend.configure({
      worldWidth: sim.width,
      worldHeight: sim.height,
      radius: sim.radius,
      force: sim.force,
      damping: sim.damping,
      dt: sim.dt,
      beta: sim.beta,
      wrap: sim.wrap,
      worldScale: layout.worldScale,
    });
    backend.updateMatrix(Float32Array.from(sim.matrix));
    backend.updateMasses(Float32Array.from(sim.masses));
    return backend;
  }

  function resizeFromCpu(options = {}) {
    layout = {
      cssWidth: positiveOrFallback(options.cssWidth, layout.cssWidth),
      cssHeight: positiveOrFallback(options.cssHeight, layout.cssHeight),
      dpr: positiveOrFallback(options.dpr, layout.dpr),
      worldScale: positiveOrFallback(options.worldScale, layout.worldScale),
    };
    return backend.resize(layout.cssWidth, layout.cssHeight, {
      dpr: layout.dpr,
      worldWidth: sim.width,
      worldHeight: sim.height,
      worldScale: layout.worldScale,
    });
  }

  resizeFromCpu();

  return Object.freeze({
    stepMany(count = 1) { return backend.stepMany(count); },
    render() { return backend.render(); },
    resetFromCpu,
    configureFromCpu,
    resizeFromCpu,
    destroy() { backend.destroy(); },
    get metadata() { return backend.metadata; },
  });
}
