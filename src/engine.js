// Particle Life engine: typed arrays + uniform spatial hash grid.
// Force curve adapted from hunar4321/particle-life (MIT); see NOTICE.
export class ParticleLife {
  constructor(options = {}) {
    this.width = options.width ?? 1200;
    this.height = options.height ?? 800;
    this.count = options.count ?? 5000;
    this.types = options.types ?? 40;
    this.radius = options.radius ?? 80;
    this.force = options.force ?? 0.025;
    this.damping = options.damping ?? 0.82;
    this.dt = options.dt ?? 1;
    this.wrap = options.wrap ?? true;
    this.seed = String(options.seed ?? 'clusters');
    this.cellScale = options.cellScale === 0.5 || options.cellScale === 1 ? options.cellScale : null;
    this.beta = 0.3;
    this.creatureEnergy = Boolean(options.creatureEnergy ?? false);
    this.energyTotal = 100;
    this.energyDetectionInterval = 10;
    this.creatureMinSize = 24;
    this.creatureLinkScale = 0.14;
    this.energyCost = 0.00003;
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
    this.resetCreatureEnergy();
  }

  resetCreatureEnergy() {
    this.particleCreature = new Int32Array(this.count); this.particleCreature.fill(-1);
    this.energyScale = new Float32Array(this.count); this.energyScale.fill(1);
    this.creatures = new Map(); this.ambientEnergy = this.energyTotal;
    this.energyStep = 0; this.nextCreatureId = 1; this.energyInitialized = false;
  }

  setCreatureEnergy(enabled) {
    const next = Boolean(enabled);
    if (next === this.creatureEnergy) return;
    this.creatureEnergy = next;
    this.resetCreatureEnergy();
  }

  getCreatureEnergyMetrics() {
    let creatureEnergy = 0;
    for (const creature of this.creatures.values()) creatureEnergy += creature.energy;
    return { enabled: this.creatureEnergy, creatures: this.creatures.size, ambient: this.ambientEnergy,
      creatureEnergy, total: this.ambientEnergy + creatureEnergy };
  }

  refreshEnergyScale() {
    this.energyScale.fill(1);
    if (!this.creatureEnergy) return;
    const nominal = this.energyTotal / Math.max(1, this.count);
    for (let i = 0; i < this.count; i++) {
      const creature = this.creatures.get(this.particleCreature[i]);
      if (creature) this.energyScale[i] = Math.max(0.15, Math.min(1.25, creature.energy / Math.max(1, creature.size) / nominal));
    }
  }

  detectCreatures() {
    const { count, radius, cellSize, cols, rows, wrap, width, height, head, next } = this;
    const linkRadius = Math.max(1, radius * this.creatureLinkScale), link2 = linkRadius * linkRadius;
    const range = Math.ceil(linkRadius / cellSize), parent = new Int32Array(count), sizes = new Int32Array(count);
    for (let i = 0; i < count; i++) { parent[i] = i; sizes[i] = 1; }
    const find = value => { let root = value; while (parent[root] !== root) root = parent[root]; while (parent[value] !== value) { const above = parent[value]; parent[value] = root; value = above; } return root; };
    const unite = (a, b) => { let left = find(a), right = find(b); if (left === right) return; if (sizes[left] < sizes[right]) [left, right] = [right, left]; parent[right] = left; sizes[left] += sizes[right]; };
    const marks = new Int32Array(head.length);
    for (let i = 0; i < count; i++) {
      const cx0 = Math.min(cols - 1, Math.max(0, Math.floor(this.x[i] / cellSize))), cy0 = Math.min(rows - 1, Math.max(0, Math.floor(this.y[i] / cellSize))), stamp = i + 1;
      for (let oy = -range; oy <= range; oy++) {
        let cy = cy0 + oy; if (wrap) cy = (cy + rows) % rows; else if (cy < 0 || cy >= rows) continue;
        for (let ox = -range; ox <= range; ox++) {
          let cx = cx0 + ox; if (wrap) cx = (cx + cols) % cols; else if (cx < 0 || cx >= cols) continue;
          const cell = cy * cols + cx; if (marks[cell] === stamp) continue; marks[cell] = stamp;
          for (let j = head[cell]; j !== -1; j = next[j]) {
            if (j <= i) continue;
            let dx = this.x[j] - this.x[i], dy = this.y[j] - this.y[i];
            if (wrap) { if (dx > width * .5) dx -= width; else if (dx < -width * .5) dx += width; if (dy > height * .5) dy -= height; else if (dy < -height * .5) dy += height; }
            if (dx * dx + dy * dy < link2) unite(i, j);
          }
        }
      }
    }
    const roots = new Int32Array(count), rootSizes = new Int32Array(count), oldMembership = this.particleCreature;
    for (let i = 0; i < count; i++) { const root = find(i); roots[i] = root; rootSizes[root]++; }
    const byRoot = new Map();
    for (let i = 0; i < count; i++) if (rootSizes[roots[i]] >= this.creatureMinSize) {
      let component = byRoot.get(roots[i]);
      if (!component) { component = { root: roots[i], size: rootSizes[roots[i]], previous: new Map(), id: null, energy: 0 }; byRoot.set(roots[i], component); }
      const oldId = oldMembership[i]; if (oldId >= 0) component.previous.set(oldId, (component.previous.get(oldId) ?? 0) + 1);
    }
    const components = [...byRoot.values()];
    if (!this.energyInitialized) {
      for (const component of components) component.id = this.nextCreatureId++;
      const unit = this.energyTotal / Math.max(1, count);
      for (const component of components) component.energy = component.size * unit;
    } else {
      const claimed = new Set();
      for (const component of [...components].sort((a, b) => b.size - a.size)) {
        const candidate = [...component.previous.entries()].filter(([id]) => this.creatures.has(id) && !claimed.has(id)).sort((a, b) => b[1] - a[1])[0];
        component.id = candidate ? candidate[0] : this.nextCreatureId++;
        if (candidate) claimed.add(component.id);
      }
      for (const [oldId, creature] of this.creatures) {
        for (const component of components) {
          const retained = component.previous.get(oldId) ?? 0;
          if (retained) component.energy += creature.energy * retained / Math.max(1, creature.size);
        }
      }
      let ambient = this.energyTotal - components.reduce((sum, component) => sum + component.energy, 0);
      const unit = this.energyTotal / Math.max(1, count);
      for (const component of components) {
        const returning = [...component.previous.values()].reduce((sum, value) => sum + value, 0);
        const bonus = Math.min(ambient, Math.max(0, component.size - returning) * unit);
        component.energy += bonus; ambient -= bonus;
      }
    }
    const assigned = new Int32Array(count); assigned.fill(-1); this.creatures = new Map();
    for (const component of components) this.creatures.set(component.id, { id: component.id, size: component.size, energy: component.energy });
    for (let i = 0; i < count; i++) { const component = byRoot.get(roots[i]); if (component) assigned[i] = component.id; }
    this.particleCreature = assigned; this.energyInitialized = true;
    let creatureEnergy = 0; for (const creature of this.creatures.values()) creatureEnergy += creature.energy;
    this.ambientEnergy = Math.max(0, this.energyTotal - creatureEnergy);
    this.refreshEnergyScale();
  }

  spendCreatureEnergy() {
    if (!this.creatureEnergy || !this.creatures.size) return;
    const costs = new Map();
    for (let i = 0; i < this.count; i++) {
      const id = this.particleCreature[i]; if (id < 0) continue;
      const effort = Math.hypot(this.accX[i], this.accY[i]) + .05 * Math.hypot(this.vx[i], this.vy[i]);
      costs.set(id, (costs.get(id) ?? 0) + effort * this.energyCost);
    }
    for (const [id, cost] of costs) {
      const creature = this.creatures.get(id); const spent = Math.min(creature.energy, cost);
      creature.energy -= spent; this.ambientEnergy += spent;
    }
    this.refreshEnergyScale();
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
    if (this.creatureEnergy && this.energyStep++ % this.energyDetectionInterval === 0) this.detectCreatures();
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
            const source = kind[i];
            const firstJ = neighbor === cell ? next[i] : head[neighbor];
            for (let j = firstJ; j !== -1; j = next[j]) {
              let dx = x[j] - x[i], dy = y[j] - y[i];
              if (wrap) {
                if (dx > width * 0.5) dx -= width; else if (dx < -width * 0.5) dx += width;
                if (dy > height * 0.5) dy -= height; else if (dy < -height * 0.5) dy += height;
              }
              const d2 = dx * dx + dy * dy;
              if (d2 <= 0 || d2 >= r2) continue;
              const d = Math.sqrt(d2), q = d * invR, invD = 1 / d;
              const directionX = dx * invD, directionY = dy * invD, target = kind[j];
              if (q < beta) {
                const curve = q / beta - 1;
                const forceX = directionX * curve, forceY = directionY * curve;
                accX[i] += forceX; accY[i] += forceY;
                accX[j] -= forceX; accY[j] -= forceY;
              } else {
                const envelope = 1 - Math.abs(2 * q - 1 - beta) / (1 - beta);
                const forceX = directionX * envelope, forceY = directionY * envelope;
                const influenceI = matrix[source * types + target], influenceJ = matrix[target * types + source];
                accX[i] += forceX * influenceI; accY[i] += forceY * influenceI;
                accX[j] -= forceX * influenceJ; accY[j] -= forceY * influenceJ;
              }
            }
          }
        }
      }
    }

    const move = this.dt;
    for (let i = 0; i < count; i++) {
      const forceX = accX[i], forceY = accY[i];
      const creatureScale = this.creatureEnergy ? this.energyScale[i] : 1;
      vx[i] = (vx[i] + forceX * scale * creatureScale / masses[kind[i]]) * damp;
      vy[i] = (vy[i] + forceY * scale * creatureScale / masses[kind[i]]) * damp;
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
    this.spendCreatureEnergy();
  }
  exportPreset() {
    return { version: 1, seed: this.seed, particleCount: this.count, classes: this.types,
      interactionRadius: this.radius, damping: this.damping, force: this.force, dt: this.dt,
      wrap: this.wrap, creatureEnergy: this.creatureEnergy, masses: Array.from(this.masses),
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
    this.creatureEnergy = Boolean(data.creatureEnergy ?? false);
    this.resetParticles(this.seed);
  }
}
