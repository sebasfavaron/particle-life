import {
  BUILD_GRID_WGSL,
  CLEAR_CELL_HEADS_WGSL,
  COMPUTE_WORKGROUP_SIZE,
  FORCE_AND_INTEGRATE_WGSL,
  PARAMS_BUFFER_SIZE,
  PARTICLE_RENDER_WGSL,
} from './shaders.js';

const DEFAULT_PALETTE = Object.freeze([
  '#66f2d5', '#ff5577', '#ffd166', '#58a6ff',
  '#c77dff', '#ff8f40', '#9cff57', '#f55de1',
  '#67e8f9', '#f5f7ff', '#ef476f', '#06d6a0',
]);

const DEFAULT_CONFIG = Object.freeze({
  worldWidth: 1200,
  worldHeight: 800,
  particleCount: 2000,
  typeCount: 10,
  radius: 80,
  force: 0.02,
  damping: 0.70,
  dt: 1,
  beta: 0.3,
  particleSize: 1.65,
  wrap: true,
  worldScale: 1,
  seed: 1,
  maxStepsPerSubmission: 25,
});

/** Error thrown when WebGPU cannot be selected or initialized. */
export class WebGpuAvailabilityError extends Error {
  constructor(message, { code = 'webgpu-unavailable', cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'WebGpuAvailabilityError';
    this.code = code;
  }
}

/** Error thrown when an operation is attempted after the device was lost. */
export class WebGpuDeviceLostError extends WebGpuAvailabilityError {
  constructor(message = 'The WebGPU device was lost.', details = {}) {
    super(message, { code: 'device-lost', cause: details.cause });
    this.name = 'WebGpuDeviceLostError';
    this.reason = details.reason ?? 'unknown';
  }
}

/**
 * Pack the shader Params struct. Field offsets are fixed and total exactly 64 bytes.
 * This export is intentionally GPU-independent so layout tests can run without an adapter.
 */
export function packWebGpuParams(params) {
  const buffer = new ArrayBuffer(PARAMS_BUFFER_SIZE);
  const view = new DataView(buffer);
  const f32 = (offset, value) => view.setFloat32(offset, value, true);
  const u32 = (offset, value) => view.setUint32(offset, value, true);

  f32(0, params.worldWidth);
  f32(4, params.worldHeight);
  f32(8, params.radius);
  f32(12, params.force);
  f32(16, params.damping);
  f32(20, params.dt);
  f32(24, params.beta);
  f32(28, params.particleSize);
  u32(32, params.particleCount);
  u32(36, params.typeCount);
  u32(40, params.cols);
  u32(44, params.rows);
  u32(48, params.wrap ? 1 : 0);
  u32(52, params.neighborRange);
  f32(56, params.cellSize);
  f32(60, params.worldScale);
  return buffer;
}

function positiveNumber(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be a positive finite number.`);
  return value;
}

function nonNegativeNumber(value, name) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be a non-negative finite number.`);
  return value;
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer.`);
  return value;
}

function align4(value) {
  return Math.max(4, Math.ceil(value / 4) * 4);
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function parseColor(color) {
  if (Array.isArray(color) || ArrayBuffer.isView(color)) {
    if (color.length !== 3 && color.length !== 4) throw new TypeError('Palette colors need 3 or 4 channels.');
    const channels = [color[0], color[1], color[2], color.length === 4 ? color[3] : 1];
    if (!channels.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
      throw new RangeError('Palette channels must be between 0 and 1.');
    }
    return channels;
  }
  if (typeof color !== 'string' || !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color)) {
    throw new TypeError('Palette colors must be #rrggbb, #rrggbbaa, or normalized channel arrays.');
  }
  const hex = color.slice(1);
  return [
    parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255,
    hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
  ];
}

function paletteData(palette) {
  if (!Array.isArray(palette) || palette.length !== 12) throw new RangeError('palette must contain exactly 12 colors.');
  return new Float32Array(palette.flatMap(parseColor));
}

function clearColorValue(value) {
  if (value === undefined) return { r: 5 / 255, g: 7 / 255, b: 12 / 255, a: 1 };
  const channels = parseColor(value);
  return { r: channels[0], g: channels[1], b: channels[2], a: channels[3] };
}

function asTypedArray(value, Type, length, name) {
  const result = value instanceof Type ? value : new Type(value);
  if (result.length !== length) throw new RangeError(`${name} must contain exactly ${length} values.`);
  return result;
}

/**
 * WebGPU simulation and renderer for Particle Life.
 *
 * Lifecycle and integration API:
 * - `await WebGpuParticleLifeBackend.create(canvas, options)` creates and initializes it.
 * - `await backend.init()` supports explicit two-stage construction.
 * - `backend.stepMany(count)` submits bounded clear/build/force ping-pong batches.
 * - `backend.render()` draws one instanced square pass from the active state buffer.
 * - `backend.resize(width, height, options)` updates the canvas and optional world size.
 * - `backend.reset(options)` uploads a new seeded or caller-supplied particle state.
 * - `backend.updateMatrix(...)` and `backend.updateMasses(...)` update CPU mirrors and GPU buffers.
 * - `backend.configure(changes)` updates scalar physics/render settings.
 * - `backend.destroy()` releases resources. Calls after device loss or destroy throw.
 *
 * Normal stepping and rendering never map or read a GPU buffer.
 */
export class WebGpuParticleLifeBackend {
  static async create(canvas, options = {}) {
    const backend = new WebGpuParticleLifeBackend(canvas, options);
    await backend.init();
    return backend;
  }

  constructor(canvas, options = {}) {
    if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('A canvas is required.');
    this.canvas = canvas;
    this.options = { ...options };
    this.config = { ...DEFAULT_CONFIG };
    this._applyInitialConfig(options);

    this.adapter = null;
    this.device = null;
    this.context = null;
    this.format = null;
    this.buffers = null;
    this.pipelines = null;
    this.bindGroups = null;
    this.matrix = null;
    this.masses = null;
    this.kinds = null;
    this.drawOrder = null;
    this.activeStateIndex = 0;
    this.initialized = false;
    this._destroyed = false;
    this._lost = false;
    this._lossInfo = null;
    this._ignoreDeviceLoss = false;
    this._uncapturedErrorHandler = null;
    this._palette = options.palette ?? DEFAULT_PALETTE;
    this._clearColor = clearColorValue(options.clearColor);
    this._metadata = {
      type: 'webgpu',
      name: 'WebGPU',
      active: false,
      status: 'new',
      format: null,
      deviceLost: false,
      lossReason: null,
      lossMessage: null,
    };
  }

  /** Stable selector metadata. Runtime status is returned as a fresh read-only object. */
  get activeBackend() {
    return Object.freeze({ ...this._metadata });
  }

  get metadata() {
    return this.activeBackend;
  }

  async init() {
    if (this.initialized) return this;
    if (this._destroyed) throw new Error('This backend was destroyed.');
    this._metadata.status = 'initializing';

    try {
      if (globalThis.isSecureContext === false && !this.options.allowInsecureContextForTesting) {
        throw new WebGpuAvailabilityError('WebGPU requires a secure context.', { code: 'insecure-context' });
      }
      const gpu = this.options.gpu ?? globalThis.navigator?.gpu;
      if (!gpu) throw new WebGpuAvailabilityError('navigator.gpu is not available.', { code: 'api-unavailable' });

      try {
        this.adapter = await gpu.requestAdapter({
          powerPreference: this.options.powerPreference ?? 'high-performance',
        });
      } catch (cause) {
        throw new WebGpuAvailabilityError('WebGPU adapter request failed.', { code: 'adapter-request-failed', cause });
      }
      if (!this.adapter) throw new WebGpuAvailabilityError('No WebGPU adapter is available.', { code: 'adapter-unavailable' });

      try {
        this.device = await this.adapter.requestDevice(this.options.deviceDescriptor ?? {});
      } catch (cause) {
        throw new WebGpuAvailabilityError('WebGPU device request failed.', { code: 'device-request-failed', cause });
      }
      if (!this.device) throw new WebGpuAvailabilityError('No WebGPU device is available.', { code: 'device-unavailable' });

      const usage = globalThis.GPUBufferUsage;
      const textureUsage = globalThis.GPUTextureUsage;
      if (!usage || !textureUsage) {
        throw new WebGpuAvailabilityError('WebGPU usage constants are not available.', { code: 'api-incomplete' });
      }
      this._usage = usage;
      this._textureUsage = textureUsage;
      this._ignoreDeviceLoss = false;
      this._installDeviceHandlers();

      this.context = this.canvas.getContext('webgpu');
      if (!this.context) throw new WebGpuAvailabilityError('The canvas cannot create a WebGPU context.', { code: 'canvas-context-unavailable' });
      this.format = this.options.format ?? gpu.getPreferredCanvasFormat();
      this._configureContext();
      await this._createPipelines();
      this._createPaletteBuffer();
      this.reset(this.options.reset ?? this.options);

      this.initialized = true;
      this._metadata.active = true;
      this._metadata.status = 'ready';
      this._metadata.format = this.format;
      return this;
    } catch (error) {
      this._metadata.active = false;
      this._metadata.status = 'error';
      this._releaseAfterInitFailure();
      throw error;
    }
  }

  _applyInitialConfig(options) {
    const aliases = {
      width: 'worldWidth', height: 'worldHeight', count: 'particleCount', types: 'typeCount',
    };
    for (const key of Object.keys(DEFAULT_CONFIG)) {
      if (options[key] !== undefined) this.config[key] = options[key];
    }
    for (const [source, target] of Object.entries(aliases)) {
      if (options[source] !== undefined) this.config[target] = options[source];
    }
    this._validateConfig(this.config);
  }

  _validateConfig(config) {
    positiveNumber(config.worldWidth, 'worldWidth');
    positiveNumber(config.worldHeight, 'worldHeight');
    positiveInteger(config.particleCount, 'particleCount');
    positiveInteger(config.typeCount, 'typeCount');
    if (config.typeCount > 40) throw new RangeError('typeCount must not exceed 40.');
    positiveNumber(config.radius, 'radius');
    nonNegativeNumber(config.force, 'force');
    if (!Number.isFinite(config.damping) || config.damping < 0) throw new RangeError('damping must be a non-negative finite number.');
    positiveNumber(config.dt, 'dt');
    if (!Number.isFinite(config.beta) || config.beta <= 0 || config.beta >= 1) throw new RangeError('beta must be between 0 and 1.');
    positiveNumber(config.particleSize, 'particleSize');
    positiveNumber(config.worldScale, 'worldScale');
    positiveInteger(config.maxStepsPerSubmission, 'maxStepsPerSubmission');
  }

  _installDeviceHandlers() {
    const watchedDevice = this.device;
    if (watchedDevice.lost?.then) {
      watchedDevice.lost.then((info) => {
        if (this._destroyed || this._ignoreDeviceLoss || this.device !== watchedDevice) return;
        this._lost = true;
        this._lossInfo = info;
        this._metadata.active = false;
        this._metadata.status = 'lost';
        this._metadata.deviceLost = true;
        this._metadata.lossReason = info?.reason ?? 'unknown';
        this._metadata.lossMessage = info?.message ?? '';
        if (typeof this.options.onDeviceLost === 'function') {
          try { this.options.onDeviceLost(this.activeBackend); } catch (error) { console.error(error); }
        }
      }).catch(() => {});
    }
    if (typeof this.device.addEventListener === 'function') {
      this._uncapturedErrorHandler = (event) => {
        if (typeof this.options.onUncapturedError === 'function') this.options.onUncapturedError(event.error);
      };
      this.device.addEventListener('uncapturederror', this._uncapturedErrorHandler);
    }
  }

  _configureContext() {
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: this.options.alphaMode ?? 'opaque',
      usage: this._textureUsage.RENDER_ATTACHMENT,
    });
  }

  async _createPipelines() {
    const definitions = [
      ['clear', CLEAR_CELL_HEADS_WGSL],
      ['build', BUILD_GRID_WGSL],
      ['force', FORCE_AND_INTEGRATE_WGSL],
      ['render', PARTICLE_RENDER_WGSL],
    ];
    const modules = Object.fromEntries(definitions.map(([name, code]) => [
      name,
      this.device.createShaderModule({ label: `particle-life-${name}`, code }),
    ]));

    await Promise.all(Object.entries(modules).map(async ([name, module]) => {
      if (!module.getCompilationInfo) return;
      const info = await module.getCompilationInfo();
      const errors = info.messages.filter((message) => message.type === 'error');
      if (errors.length) {
        const detail = errors.map((message) => `${message.lineNum}:${message.linePos} ${message.message}`).join('\n');
        throw new Error(`WebGPU ${name} shader compilation failed:\n${detail}`);
      }
    }));

    const compute = (label, module, entryPoint) => {
      const descriptor = { label, layout: 'auto', compute: { module, entryPoint } };
      return this.device.createComputePipelineAsync
        ? this.device.createComputePipelineAsync(descriptor)
        : this.device.createComputePipeline(descriptor);
    };
    const renderDescriptor = {
      label: 'particle-life-render-pipeline',
      layout: 'auto',
      vertex: { module: modules.render, entryPoint: 'particleVertex' },
      fragment: {
        module: modules.render,
        entryPoint: 'particleFragment',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'triangle-list' },
    };

    const [clear, build, force, render] = await Promise.all([
      compute('particle-life-clear-pipeline', modules.clear, 'clearCellHeads'),
      compute('particle-life-build-pipeline', modules.build, 'buildGrid'),
      compute('particle-life-force-pipeline', modules.force, 'forceAndIntegrate'),
      this.device.createRenderPipelineAsync
        ? this.device.createRenderPipelineAsync(renderDescriptor)
        : this.device.createRenderPipeline(renderDescriptor),
    ]);
    this.pipelines = { clear, build, force, render };
  }

  _createPaletteBuffer() {
    const data = paletteData(this._palette);
    this.paletteBuffer = this.device.createBuffer({
      label: 'particle-life-palette',
      size: data.byteLength,
      usage: this._usage.UNIFORM | this._usage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.paletteBuffer, 0, data);
  }

  _gridShape() {
    const cellSize = this.config.radius;
    return {
      cellSize,
      cols: Math.max(1, Math.ceil(this.config.worldWidth / cellSize)),
      rows: Math.max(1, Math.ceil(this.config.worldHeight / cellSize)),
      neighborRange: 1,
    };
  }

  _checkBufferLimits(sizes, cellCount) {
    const limits = this.device.limits ?? {};
    const maxBuffer = limits.maxBufferSize ?? Number.MAX_SAFE_INTEGER;
    const maxStorage = limits.maxStorageBufferBindingSize ?? Number.MAX_SAFE_INTEGER;
    for (const [name, size] of Object.entries(sizes)) {
      if (size > maxBuffer) throw new RangeError(`${name} needs ${size} bytes, above maxBufferSize ${maxBuffer}.`);
      if (name !== 'params' && name !== 'palette' && size > maxStorage) {
        throw new RangeError(`${name} needs ${size} bytes, above maxStorageBufferBindingSize ${maxStorage}.`);
      }
    }
    const maxGroups = limits.maxComputeWorkgroupsPerDimension ?? Number.MAX_SAFE_INTEGER;
    const largestDispatch = Math.max(
      Math.ceil(this.config.particleCount / COMPUTE_WORKGROUP_SIZE),
      Math.ceil(cellCount / COMPUTE_WORKGROUP_SIZE),
    );
    if (largestDispatch > maxGroups) throw new RangeError('The requested particle/grid size exceeds maxComputeWorkgroupsPerDimension.');
  }

  _makeBuffer(label, size, usage) {
    return this.device.createBuffer({ label, size: align4(size), usage });
  }

  _allocateBuffers() {
    const n = this.config.particleCount;
    const grid = this._gridShape();
    this.grid = grid;
    const cellCount = grid.cols * grid.rows;
    const sizes = {
      stateA: 16 * n, stateB: 16 * n, kind: 4 * n, drawOrder: 4 * n,
      forceOut: 8 * n, matrix: 4 * this.config.typeCount ** 2,
      masses: 4 * this.config.typeCount, cellHeads: 4 * cellCount,
      emptyHeads: 4 * cellCount, next: 4 * n, params: PARAMS_BUFFER_SIZE,
    };
    this._checkBufferLimits(sizes, cellCount);
    const U = this._usage;
    return {
      stateA: this._makeBuffer('particle-life-state-a', sizes.stateA, U.STORAGE | U.COPY_DST | U.COPY_SRC),
      stateB: this._makeBuffer('particle-life-state-b', sizes.stateB, U.STORAGE | U.COPY_DST | U.COPY_SRC),
      kind: this._makeBuffer('particle-life-kind', sizes.kind, U.STORAGE | U.COPY_DST),
      drawOrder: this._makeBuffer('particle-life-draw-order', sizes.drawOrder, U.STORAGE | U.COPY_DST),
      forceOut: this._makeBuffer('particle-life-force-output', sizes.forceOut, U.STORAGE | U.COPY_SRC),
      matrix: this._makeBuffer('particle-life-matrix', sizes.matrix, U.STORAGE | U.COPY_DST),
      masses: this._makeBuffer('particle-life-masses', sizes.masses, U.STORAGE | U.COPY_DST),
      cellHeads: this._makeBuffer('particle-life-cell-heads', sizes.cellHeads, U.STORAGE | U.COPY_DST | U.COPY_SRC),
      emptyHeads: this._makeBuffer('particle-life-empty-heads', sizes.emptyHeads, U.COPY_SRC | U.COPY_DST),
      next: this._makeBuffer('particle-life-linked-list-next', sizes.next, U.STORAGE),
      params: this._makeBuffer('particle-life-params', sizes.params, U.UNIFORM | U.COPY_DST),
    };
  }

  _uploadResetData(states, kinds, drawOrder) {
    const queue = this.device.queue;
    queue.writeBuffer(this.buffers.stateA, 0, states);
    queue.writeBuffer(this.buffers.stateB, 0, states);
    queue.writeBuffer(this.buffers.kind, 0, kinds);
    queue.writeBuffer(this.buffers.drawOrder, 0, drawOrder);
    queue.writeBuffer(this.buffers.matrix, 0, this.matrix);
    queue.writeBuffer(this.buffers.masses, 0, this.masses);
    const empty = new Int32Array(this.grid.cols * this.grid.rows);
    empty.fill(-1);
    queue.writeBuffer(this.buffers.emptyHeads, 0, empty);
    queue.writeBuffer(this.buffers.cellHeads, 0, empty);
    this._writeParams();
  }

  _createBindGroups() {
    const b = this.buffers;
    const state = [b.stateA, b.stateB];
    const entry = (binding, buffer) => ({ binding, resource: { buffer } });
    const group = (label, pipeline, entries) => this.device.createBindGroup({
      label, layout: pipeline.getBindGroupLayout(0), entries,
    });

    this.bindGroups = {
      clear: group('particle-life-clear-bind-group', this.pipelines.clear, [entry(0, b.params), entry(1, b.cellHeads)]),
      build: state.map((input, index) => group(`particle-life-build-bind-group-${index}`, this.pipelines.build, [
        entry(0, b.params), entry(1, input), entry(2, b.cellHeads), entry(3, b.next),
      ])),
      force: state.map((input, index) => group(`particle-life-force-bind-group-${index}`, this.pipelines.force, [
        entry(0, b.params), entry(1, input), entry(2, state[1 - index]), entry(3, b.kind),
        entry(4, b.matrix), entry(5, b.masses), entry(6, b.cellHeads), entry(7, b.next), entry(8, b.forceOut),
      ])),
      render: state.map((input, index) => group(`particle-life-render-bind-group-${index}`, this.pipelines.render, [
        entry(0, b.params), entry(1, input), entry(2, b.kind), entry(3, b.drawOrder), entry(4, this.paletteBuffer),
      ])),
    };
  }

  _writeParams() {
    const packed = packWebGpuParams({ ...this.config, ...this.grid });
    this.device.queue.writeBuffer(this.buffers.params, 0, packed);
  }

  _generateResetData(seed) {
    const n = this.config.particleCount;
    const random = mulberry32(seed);
    const states = new Float32Array(n * 4);
    const kinds = new Uint32Array(n);
    for (let index = 0; index < n; index += 1) {
      states[index * 4] = random() * this.config.worldWidth;
      states[index * 4 + 1] = random() * this.config.worldHeight;
      kinds[index] = Math.floor(random() * this.config.typeCount);
    }
    return { states, kinds, drawOrder: this._groupedDrawOrder(kinds) };
  }

  _groupedDrawOrder(kinds) {
    const buckets = Array.from({ length: this.config.typeCount }, () => []);
    for (let index = 0; index < kinds.length; index += 1) buckets[kinds[index]].push(index);
    return Uint32Array.from(buckets.flat());
  }

  _validateParticleData(states, kinds, drawOrder) {
    for (const value of states) if (!Number.isFinite(value)) throw new RangeError('states must contain only finite numbers.');
    for (const kind of kinds) if (kind >= this.config.typeCount) throw new RangeError('kinds contains an out-of-range type.');
    const seen = new Uint8Array(this.config.particleCount);
    for (const index of drawOrder) {
      if (index >= this.config.particleCount || seen[index]) throw new RangeError('drawOrder must be a permutation of particle indices.');
      seen[index] = 1;
    }
  }

  /**
   * Upload a new state. `states` is interleaved x,y,vx,vy. If omitted, the backend
   * creates deterministic positions and zero velocities from `seed`.
   */
  reset(options = {}) {
    this._assertDeviceReady(false);
    const previousTypeCount = this.config.typeCount;
    const configChanges = {};
    const aliases = { width: 'worldWidth', height: 'worldHeight', count: 'particleCount', types: 'typeCount' };
    for (const key of Object.keys(DEFAULT_CONFIG)) if (options[key] !== undefined) configChanges[key] = options[key];
    for (const [source, target] of Object.entries(aliases)) if (options[source] !== undefined) configChanges[target] = options[source];
    Object.assign(this.config, configChanges);
    this.config.seed = (options.seed ?? this.config.seed) >>> 0;
    this._validateConfig(this.config);

    const n = this.config.particleCount;
    let generated;
    if (options.states === undefined || options.kinds === undefined) generated = this._generateResetData(this.config.seed);
    const states = options.states === undefined
      ? generated.states
      : asTypedArray(options.states, Float32Array, n * 4, 'states');
    const kinds = options.kinds === undefined
      ? generated.kinds
      : asTypedArray(options.kinds, Uint32Array, n, 'kinds');
    const drawOrder = options.drawOrder === undefined
      ? (generated && options.kinds === undefined ? generated.drawOrder : this._groupedDrawOrder(kinds))
      : asTypedArray(options.drawOrder, Uint32Array, n, 'drawOrder');
    this._validateParticleData(states, kinds, drawOrder);

    const matrixLength = this.config.typeCount ** 2;
    if (options.matrix !== undefined) {
      this.matrix = asTypedArray(options.matrix, Float32Array, matrixLength, 'matrix').slice();
    } else if (!this.matrix || previousTypeCount !== this.config.typeCount) {
      const random = mulberry32(this.config.seed ^ 0x9e3779b9);
      this.matrix = Float32Array.from({ length: matrixLength }, () => random() * 2 - 1);
    }
    if (options.masses !== undefined) {
      this.masses = asTypedArray(options.masses, Float32Array, this.config.typeCount, 'masses').slice();
    } else if (!this.masses || previousTypeCount !== this.config.typeCount) {
      this.masses = new Float32Array(this.config.typeCount).fill(1);
    }
    this._validateMatrixAndMasses();

    const oldBuffers = this.buffers;
    this.buffers = this._allocateBuffers();
    this.kinds = kinds.slice();
    this.drawOrder = drawOrder.slice();
    this.activeStateIndex = 0;
    this._uploadResetData(states, kinds, drawOrder);
    this._createBindGroups();
    this._retireBuffers(oldBuffers);
    return this;
  }

  _validateMatrixAndMasses() {
    for (const value of this.matrix) if (!Number.isFinite(value)) throw new RangeError('matrix must contain only finite numbers.');
    for (const value of this.masses) positiveNumber(value, 'mass');
  }

  /** Replace the full row-major matrix, or update one cell with (sourceType, targetType, value). */
  updateMatrix(matrixOrSource, targetType, value) {
    this._assertDeviceReady();
    if (arguments.length === 1) {
      this.matrix = asTypedArray(
        matrixOrSource, Float32Array, this.config.typeCount ** 2, 'matrix',
      ).slice();
      this._validateMatrixAndMasses();
      this.device.queue.writeBuffer(this.buffers.matrix, 0, this.matrix);
      return this;
    }
    const sourceType = matrixOrSource;
    if (!Number.isInteger(sourceType) || sourceType < 0 || sourceType >= this.config.typeCount
      || !Number.isInteger(targetType) || targetType < 0 || targetType >= this.config.typeCount
      || !Number.isFinite(value)) throw new RangeError('Invalid matrix cell update.');
    const index = sourceType * this.config.typeCount + targetType;
    this.matrix[index] = value;
    this.device.queue.writeBuffer(this.buffers.matrix, index * 4, this.matrix, index * 4, 4);
    return this;
  }

  /** Replace all masses, or update one mass with (type, value). Masses must be positive. */
  updateMasses(massesOrType, value) {
    this._assertDeviceReady();
    if (arguments.length === 1) {
      this.masses = asTypedArray(massesOrType, Float32Array, this.config.typeCount, 'masses').slice();
      this._validateMatrixAndMasses();
      this.device.queue.writeBuffer(this.buffers.masses, 0, this.masses);
      return this;
    }
    const type = massesOrType;
    if (!Number.isInteger(type) || type < 0 || type >= this.config.typeCount) throw new RangeError('Invalid mass type.');
    positiveNumber(value, 'mass');
    this.masses[type] = value;
    this.device.queue.writeBuffer(this.buffers.masses, type * 4, this.masses, type * 4, 4);
    return this;
  }

  /**
   * Update scalar settings. Particle/type count changes belong in `reset()` because they
   * need new state. Radius or world-size changes rebuild only grid storage and bind groups.
   */
  configure(changes = {}) {
    this._assertDeviceReady();
    if (changes.particleCount !== undefined || changes.count !== undefined
      || changes.typeCount !== undefined || changes.types !== undefined) {
      throw new Error('Use reset() to change particleCount or typeCount.');
    }
    const allowed = new Set([
      'worldWidth', 'worldHeight', 'width', 'height', 'radius', 'force', 'damping', 'dt',
      'beta', 'particleSize', 'wrap', 'worldScale', 'maxStepsPerSubmission', 'palette', 'clearColor',
    ]);
    for (const key of Object.keys(changes)) if (!allowed.has(key)) throw new TypeError(`Unknown configuration key: ${key}`);

    const oldGrid = this._gridShape();
    if (changes.width !== undefined) changes = { ...changes, worldWidth: changes.width };
    if (changes.height !== undefined) changes = { ...changes, worldHeight: changes.height };
    for (const key of Object.keys(DEFAULT_CONFIG)) {
      if (key !== 'particleCount' && key !== 'typeCount' && key !== 'seed' && changes[key] !== undefined) {
        this.config[key] = changes[key];
      }
    }
    this._validateConfig(this.config);

    if (changes.clearColor !== undefined) this._clearColor = clearColorValue(changes.clearColor);
    if (changes.palette !== undefined) {
      const data = paletteData(changes.palette);
      this._palette = changes.palette;
      this.device.queue.writeBuffer(this.paletteBuffer, 0, data);
    }

    const newGrid = this._gridShape();
    if (oldGrid.cols !== newGrid.cols || oldGrid.rows !== newGrid.rows) this._reallocateGridBuffers(newGrid);
    else this.grid = newGrid;
    this._writeParams();
    return this;
  }

  _reallocateGridBuffers(grid) {
    const oldHeads = this.buffers.cellHeads;
    const oldEmpty = this.buffers.emptyHeads;
    this.grid = grid;
    const bytes = 4 * grid.cols * grid.rows;
    this._checkBufferLimits({ cellHeads: bytes, emptyHeads: bytes }, grid.cols * grid.rows);
    const U = this._usage;
    this.buffers.cellHeads = this._makeBuffer('particle-life-cell-heads', bytes, U.STORAGE | U.COPY_DST | U.COPY_SRC);
    this.buffers.emptyHeads = this._makeBuffer('particle-life-empty-heads', bytes, U.COPY_SRC | U.COPY_DST);
    const empty = new Int32Array(grid.cols * grid.rows);
    empty.fill(-1);
    this.device.queue.writeBuffer(this.buffers.cellHeads, 0, empty);
    this.device.queue.writeBuffer(this.buffers.emptyHeads, 0, empty);
    this._createBindGroups();
    this._retireBuffers({ cellHeads: oldHeads, emptyHeads: oldEmpty });
  }

  /** Submit one or more simulation ticks. The return value is the submitted tick count. */
  stepMany(count = 1) {
    this._assertDeviceReady();
    if (!Number.isInteger(count) || count < 0) throw new RangeError('count must be a non-negative integer.');
    let remaining = count;
    while (remaining > 0) {
      const batch = Math.min(remaining, this.config.maxStepsPerSubmission);
      const encoder = this.device.createCommandEncoder({ label: 'particle-life-step-encoder' });
      for (let step = 0; step < batch; step += 1) {
        let pass = encoder.beginComputePass({ label: 'particle-life-clear-pass' });
        pass.setPipeline(this.pipelines.clear);
        pass.setBindGroup(0, this.bindGroups.clear);
        pass.dispatchWorkgroups(Math.ceil((this.grid.cols * this.grid.rows) / COMPUTE_WORKGROUP_SIZE));
        pass.end();

        pass = encoder.beginComputePass({ label: 'particle-life-build-pass' });
        pass.setPipeline(this.pipelines.build);
        pass.setBindGroup(0, this.bindGroups.build[this.activeStateIndex]);
        pass.dispatchWorkgroups(Math.ceil(this.config.particleCount / COMPUTE_WORKGROUP_SIZE));
        pass.end();

        pass = encoder.beginComputePass({ label: 'particle-life-force-pass' });
        pass.setPipeline(this.pipelines.force);
        pass.setBindGroup(0, this.bindGroups.force[this.activeStateIndex]);
        pass.dispatchWorkgroups(Math.ceil(this.config.particleCount / COMPUTE_WORKGROUP_SIZE));
        pass.end();
        this.activeStateIndex = 1 - this.activeStateIndex;
      }
      this.device.queue.submit([encoder.finish()]);
      remaining -= batch;
    }
    return count;
  }

  /** Wait for work already submitted to the GPU. Use for diagnostics, never each frame. */
  async waitForIdle() {
    this._assertDeviceReady();
    if (!this.device.queue.onSubmittedWorkDone) return null;
    const started = performance.now();
    await this.device.queue.onSubmittedWorkDone();
    return performance.now() - started;
  }

  /** Render all particles directly from the active GPU state. */
  render() {
    this._assertDeviceReady();
    const encoder = this.device.createCommandEncoder({ label: 'particle-life-render-encoder' });
    const pass = encoder.beginRenderPass({
      label: 'particle-life-render-pass',
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: this._clearColor,
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(this.pipelines.render);
    pass.setBindGroup(0, this.bindGroups.render[this.activeStateIndex]);
    pass.draw(6, this.config.particleCount, 0, 0);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  /**
   * Resize the physical canvas. `width` and `height` are CSS-pixel dimensions; DPR defaults
   * to the current device DPR. Pass `worldWidth`/`worldHeight` to also change simulation bounds.
   */
  resize(width, height, options = {}) {
    this._assertDeviceReady();
    positiveNumber(width, 'width');
    positiveNumber(height, 'height');
    const dpr = options.dpr ?? globalThis.devicePixelRatio ?? 1;
    positiveNumber(dpr, 'dpr');
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    this._configureContext();

    const changes = {};
    if (options.worldWidth !== undefined) changes.worldWidth = options.worldWidth;
    if (options.worldHeight !== undefined) changes.worldHeight = options.worldHeight;
    if (options.worldScale !== undefined) changes.worldScale = options.worldScale;
    if (Object.keys(changes).length) this.configure(changes);
    return { width: this.canvas.width, height: this.canvas.height, dpr };
  }

  _assertDeviceReady(requireInitialized = true) {
    if (this._destroyed) throw new Error('This backend was destroyed.');
    if (this._lost) {
      throw new WebGpuDeviceLostError(this._lossInfo?.message || 'The WebGPU device was lost.', {
        reason: this._lossInfo?.reason,
      });
    }
    if (!this.device || (requireInitialized && !this.initialized)) throw new Error('Call and await init() before using this backend.');
  }

  _retireBuffers(buffers) {
    if (!buffers) return;
    const unique = [...new Set(Object.values(buffers).filter(Boolean))];
    const destroy = () => unique.forEach((buffer) => {
      try { buffer.destroy(); } catch (_) { /* Device loss or an already destroyed buffer. */ }
    });
    const completion = this.device?.queue?.onSubmittedWorkDone?.();
    if (completion?.then) completion.then(destroy, destroy);
    else destroy();
  }

  _releaseAfterInitFailure() {
    this._ignoreDeviceLoss = true;
    try { this.context?.unconfigure?.(); } catch (_) { /* Best effort. */ }
    this._retireBuffers(this.buffers);
    try { this.paletteBuffer?.destroy(); } catch (_) { /* Best effort. */ }
    try { this.device?.destroy?.(); } catch (_) { /* Best effort. */ }
    this.context = null;
    this.buffers = null;
    this.bindGroups = null;
    this.pipelines = null;
    this.device = null;
    this.adapter = null;
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.initialized = false;
    this._metadata.active = false;
    this._metadata.status = 'destroyed';
    if (this._uncapturedErrorHandler && this.device?.removeEventListener) {
      this.device.removeEventListener('uncapturederror', this._uncapturedErrorHandler);
    }
    try { this.context?.unconfigure?.(); } catch (_) { /* Best effort. */ }
    if (this.buffers) {
      for (const buffer of new Set(Object.values(this.buffers))) {
        try { buffer.destroy(); } catch (_) { /* Best effort. */ }
      }
    }
    try { this.paletteBuffer?.destroy(); } catch (_) { /* Best effort. */ }
    try { this.device?.destroy?.(); } catch (_) { /* Best effort. */ }
    this.buffers = null;
    this.bindGroups = null;
    this.pipelines = null;
    this.context = null;
    this.device = null;
    this.adapter = null;
  }
}

export default WebGpuParticleLifeBackend;
