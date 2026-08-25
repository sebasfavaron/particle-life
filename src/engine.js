// Particle Life engine: typed arrays + uniform spatial hash grid.
// Force curve adapted from hunar4321/particle-life (MIT); see NOTICE.
export class ParticleLife {
  constructor(options = {}) {
    this.width = options.width ?? 1200;
    this.height = options.height ?? 800;
    this.count = options.count ?? 2000;
    this.types = options.types ?? 10;
    this.radius = options.radius ?? 80;
    this.force = options.force ?? 0.02;
    this.damping = options.damping ?? 0.70;
    this.dt = options.dt ?? 1;
    this.wrap = options.wrap ?? true;
    this.seed = String(options.seed ?? 'clusters');
    this.cellScale = options.cellScale === 0.5 || options.cellScale === 1 ? options.cellScale : null;
    this.beta = 0.3;
    this.matrix = new Float32Array(this.types * this.types);
    this.masses = new Float32Array(this.types);
    for (let t = 0; t < this.types; t++) this.masses[t] = 1;
    this.randomizeMatrix(this.seed);
    this.resetParticles(this.seed);
  }

  static hashSeed(text) {
    let h = 2166136261 >>> 0;
    for (const c of String(text)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  static rng(seed) {
    let a = ParticleLife.hashSeed(seed);
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  configure(next) {
    const rebuildParticles = next.count !== undefined && next.count !== this.count;
    const rebuildMatrix = next.types !== undefined && next.types !== this.types;
    Object.assign(this, next);
    if (rebuildMatrix) {
      this.types = Math.max(1, Math.min(40, Math.round(this.types)));
      this.matrix = new Float32Array(this.types * this.types);
      this.randomizeMatrix(this.seed);
      const newMasses = new Float32Array(this.types);
      for (let t = 0; t < this.types; t++) newMasses[t] = t < this.masses.length ? this.masses[t] : 1;
      this.masses = newMasses;
    }
    if (rebuildParticles || rebuildMatrix) this.resetParticles(this.seed);
    else this.rebuildGridStorage();
  }

  randomizeMatrix(seed = this.seed) {
    this.seed = String(seed);
    const random = ParticleLife.rng(this.seed + ':matrix:' + this.types);
    for (let row = 0; row < this.types; row++) {
      for (let col = 0; col < this.types; col++) {
        // Slightly positive diagonal creates stable same-color clusters.
        const value = random() * 2 - 1;
        this.matrix[row * this.types + col] = value;
      }
    }
  }

  resetParticles(seed = this.seed) {
    this.seed = String(seed);
    const n = this.count;
    this.x = new Float32Array(n); this.y = new Float32Array(n);
    this.vx = new Float32Array(n); this.vy = new Float32Array(n);
    this.fx = new Float32Array(n); this.fy = new Float32Array(n);
    this.accX = new Float64Array(n); this.accY = new Float64Array(n);
    this.kind = new Uint8Array(n); this.next = new Int32Array(n);
    const random = ParticleLife.rng(this.seed + ':particles:' + n + ':' + this.types);
    for (let i = 0; i < n; i++) {
      this.x[i] = random() * this.width; this.y[i] = random() * this.height;
      this.vx[i] = (random() - 0.5) * 0.2; this.vy[i] = (random() - 0.5) * 0.2;
      this.kind[i] = Math.floor(random() * this.types);
    }
    const offsets = new Uint32Array(this.types + 1);
    for (let i = 0; i < n; i++) offsets[this.kind[i] + 1]++;
    for (let t = 1; t <= this.types; t++) offsets[t] += offsets[t - 1];
    this.typeOffsets = offsets; this.drawOrder = new Uint32Array(n);
    const cursor = offsets.slice(0, this.types);
    for (let i = 0; i < n; i++) this.drawOrder[cursor[this.kind[i]]++] = i;
    this.rebuildGridStorage();
  }

  resize(width, height) {
    this.width = Math.max(1, width); this.height = Math.max(1, height);
    for (let i = 0; i < this.count; i++) {
      this.x[i] = Math.min(this.width - 0.001, Math.max(0, this.x[i]));
      this.y[i] = Math.min(this.height - 0.001, Math.max(0, this.y[i]));
    }
    this.rebuildGridStorage();
  }

  rebuildGridStorage() {
    const fullCellSize = Math.max(1, this.radius);
    const fullCols = Math.max(1, Math.ceil(this.width / fullCellSize));
    const fullRows = Math.max(1, Math.ceil(this.height / fullCellSize));
    const fullCellDensity = this.count / (fullCols * fullRows);
    this.gridScale = this.cellScale ?? (fullCellDensity >= 4 ? 0.5 : 1);
    this.cellSize = fullCellSize * this.gridScale;
    this.neighborRange = Math.ceil(this.radius / this.cellSize);
    this.cols = Math.max(1, Math.ceil(this.width / this.cellSize));
    this.rows = Math.max(1, Math.ceil(this.height / this.cellSize));
    this.head = new Int32Array(this.cols * this.rows);
    this.cellMarks = new Int32Array(this.cols * this.rows);
  }

  buildGrid() {
    this.head.fill(-1);
    const inv = 1 / this.cellSize;
    for (let i = 0; i < this.count; i++) {
      const cx = Math.min(this.cols - 1, Math.max(0, Math.floor(this.x[i] * inv)));
      const cy = Math.min(this.rows - 1, Math.max(0, Math.floor(this.y[i] * inv)));
      const cell = cy * this.cols + cx;
      this.next[i] = this.head[cell]; this.head[cell] = i;
    }
  }

  step() {
    this.buildGrid();
    const { count, radius, width, height, cols, rows, types, matrix, masses, wrap } = this;
    const r2 = radius * radius, invR = 1 / radius, beta = this.beta;
    const scale = this.force * this.dt, damp = Math.pow(this.damping, this.dt);
    const x = this.x, y = this.y, vx = this.vx, vy = this.vy, kind = this.kind;
    const accX = this.accX, accY = this.accY, fxOut = this.fx, fyOut = this.fy;
    const head = this.head, next = this.next, cellMarks = this.cellMarks;
    accX.fill(0); accY.fill(0);

    // Each cell pair is visited once. cellMarks handles wrap aliases when a world has < 3 cells.
    for (let cell = 0; cell < head.length; cell++) {
      if (head[cell] === -1) continue;
      const baseX = cell % cols, baseY = Math.floor(cell / cols), stamp = cell + 1;
      for (let oy = -this.neighborRange; oy <= this.neighborRange; oy++) {
        let cy = baseY + oy;
        if (wrap) cy = (cy + rows) % rows; else if (cy < 0 || cy >= rows) continue;
        for (let ox = -this.neighborRange; ox <= this.neighborRange; ox++) {
          let cx = baseX + ox;
          if (wrap) cx = (cx + cols) % cols; else if (cx < 0 || cx >= cols) continue;
          const neighbor = cy * cols + cx;
          if (cellMarks[neighbor] === stamp) continue;
          cellMarks[neighbor] = stamp;
          if (neighbor < cell || head[neighbor] === -1) continue;

          for (let i = head[cell]; i !== -1; i = next[i]) {
            const firstJ = neighbor === cell ? next[i] : head[neighbor];
            for (let j = firstJ; j !== -1; j = next[j]) {
              let dx = x[j] - x[i], dy = y[j] - y[i];
              if (wrap) {
                if (dx > width * 0.5) dx -= width; else if (dx < -width * 0.5) dx += width;
                if (dy > height * 0.5) dy -= height; else if (dy < -height * 0.5) dy += height;
              }
              const d2 = dx * dx + dy * dy;
              if (d2 <= 0 || d2 >= r2) continue;
              const d = Math.sqrt(d2), q = d * invR;
              const curveI = q < beta ? q / beta - 1 : matrix[kind[i] * types + kind[j]] * (1 - Math.abs(2 * q - 1 - beta) / (1 - beta));
              const curveJ = q < beta ? q / beta - 1 : matrix[kind[j] * types + kind[i]] * (1 - Math.abs(2 * q - 1 - beta) / (1 - beta));
              const invD = 1 / d;
              accX[i] += dx * curveI * invD; accY[i] += dy * curveI * invD;
              accX[j] -= dx * curveJ * invD; accY[j] -= dy * curveJ * invD;
            }
          }
        }
      }
    }

    const move = this.dt;
    for (let i = 0; i < count; i++) {
      const forceX = accX[i], forceY = accY[i];
      vx[i] = (vx[i] + forceX * scale / masses[kind[i]]) * damp;
      vy[i] = (vy[i] + forceY * scale / masses[kind[i]]) * damp;
      fxOut[i] = forceX; fyOut[i] = forceY;
      let nx = x[i] + vx[i] * move, ny = y[i] + vy[i] * move;
      if (wrap) {
        nx = ((nx % width) + width) % width; ny = ((ny % height) + height) % height;
      } else {
        if (nx < 0 || nx > width) { vx[i] *= -0.8; nx = Math.min(width, Math.max(0, nx)); }
        if (ny < 0 || ny > height) { vy[i] *= -0.8; ny = Math.min(height, Math.max(0, ny)); }
      }
      x[i] = nx; y[i] = ny;
    }
  }
  exportPreset() {
    return { version: 1, seed: this.seed, particleCount: this.count, classes: this.types,
      interactionRadius: this.radius, damping: this.damping, force: this.force, dt: this.dt,
      wrap: this.wrap, masses: Array.from(this.masses),
      matrix: Array.from({ length: this.types }, (_, r) =>
        Array.from(this.matrix.slice(r * this.types, (r + 1) * this.types))) };
  }

  importPreset(data) {
    if (!data || !Array.isArray(data.matrix) || !data.matrix.length) throw new Error('Invalid preset matrix');
    const types = data.matrix.length;
    if (types < 1 || types > 40 || data.matrix.some(row => !Array.isArray(row) || row.length !== types)) throw new Error('Matrix must be square (1–40)');
    this.types = types; this.count = Math.max(100, Math.min(50000, Number(data.particleCount ?? this.count)));
    this.radius = Number(data.interactionRadius ?? this.radius); this.damping = Number(data.damping ?? this.damping);
    this.force = Number(data.force ?? this.force); this.dt = Number(data.dt ?? this.dt); this.wrap = Boolean(data.wrap ?? this.wrap);
    this.seed = String(data.seed ?? this.seed); this.matrix = Float32Array.from(data.matrix.flat().map(v => Math.max(-1, Math.min(1, Number(v)))));
    if (data.masses) { this.masses = Float32Array.from(data.masses); }
    this.resetParticles(this.seed);
  }
}
