// Standalone WGSL modules for the WebGPU particle-life backend.
// Params is a 64-byte uniform. Keep its JS packing in this exact field order.

export const COMPUTE_WORKGROUP_SIZE = 64;
export const PARAMS_BUFFER_SIZE = 64;

const PARAMS_WGSL = /* wgsl */ `
struct Params {
  worldSize: vec2<f32>,
  radius: f32,
  force: f32,
  damping: f32,
  dt: f32,
  beta: f32,
  particleSize: f32,
  particleCount: u32,
  typeCount: u32,
  cols: u32,
  rows: u32,
  wrap: u32,
  neighborRange: u32,
  cellSize: f32,
  worldScale: f32,
}
`;

/** Bindings: 0 params, 1 cellHeads. Dispatch ceil(cols * rows / 64). */
export const CLEAR_CELL_HEADS_WGSL = /* wgsl */ `
${PARAMS_WGSL}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> cellHeads: array<atomic<i32>>;

@compute @workgroup_size(${COMPUTE_WORKGROUP_SIZE})
fn clearCellHeads(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let cellIndex = invocation.x;
  if (cellIndex >= params.cols * params.rows) {
    return;
  }
  atomicStore(&cellHeads[cellIndex], -1);
}
`;

/** Bindings: 0 params, 1 active state, 2 cellHeads, 3 linked-list next. */
export const BUILD_GRID_WGSL = /* wgsl */ `
${PARAMS_WGSL}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> states: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> cellHeads: array<atomic<i32>>;
@group(0) @binding(3) var<storage, read_write> next: array<i32>;

@compute @workgroup_size(${COMPUTE_WORKGROUP_SIZE})
fn buildGrid(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let particleIndex = invocation.x;
  if (particleIndex >= params.particleCount) {
    return;
  }

  let position = states[particleIndex].xy;
  let lastCell = vec2<i32>(i32(params.cols) - 1, i32(params.rows) - 1);
  let cell = clamp(
    vec2<i32>(floor(position / params.cellSize)),
    vec2<i32>(0, 0),
    lastCell,
  );
  let cellIndex = u32(cell.y) * params.cols + u32(cell.x);
  next[particleIndex] = atomicExchange(&cellHeads[cellIndex], i32(particleIndex));
}
`;

/**
 * Bindings: 0 params, 1 active state, 2 next state, 3 kinds, 4 matrix,
 * 5 masses, 6 cellHeads, 7 linked-list next, 8 force output.
 */
export const FORCE_AND_INTEGRATE_WGSL = /* wgsl */ `
${PARAMS_WGSL}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> statesIn: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> statesOut: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> kinds: array<u32>;
@group(0) @binding(4) var<storage, read> matrix: array<f32>;
@group(0) @binding(5) var<storage, read> masses: array<f32>;
@group(0) @binding(6) var<storage, read_write> cellHeads: array<atomic<i32>>;
@group(0) @binding(7) var<storage, read> next: array<i32>;
@group(0) @binding(8) var<storage, read_write> forceOut: array<vec2<f32>>;

fn wrappedIndex(index: i32, size: u32) -> u32 {
  let signedSize = i32(size);
  return u32(((index % signedSize) + signedSize) % signedSize);
}

fn minimumImage(delta: f32, extent: f32) -> f32 {
  var result = delta;
  if (result > extent * 0.5) {
    result -= extent;
  } else if (result < -extent * 0.5) {
    result += extent;
  }
  return result;
}

fn wrappedPosition(position: f32, extent: f32) -> f32 {
  return position - floor(position / extent) * extent;
}

@compute @workgroup_size(${COMPUTE_WORKGROUP_SIZE})
fn forceAndIntegrate(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let particleIndex = invocation.x;
  if (particleIndex >= params.particleCount) {
    return;
  }

  let state = statesIn[particleIndex];
  let sourceKind = kinds[particleIndex];
  let position = state.xy;
  let baseCell = clamp(
    vec2<i32>(floor(position / params.cellSize)),
    vec2<i32>(0, 0),
    vec2<i32>(i32(params.cols) - 1, i32(params.rows) - 1),
  );
  let range = i32(params.neighborRange);
  let stencilWidth = params.neighborRange * 2u + 1u;

  var xStart: i32;
  var yStart: i32;
  var xCount: u32;
  var yCount: u32;
  if (params.wrap != 0u) {
    // Consecutive modulo indices are unique while count <= dimension.
    xStart = baseCell.x - range;
    yStart = baseCell.y - range;
    xCount = min(params.cols, stencilWidth);
    yCount = min(params.rows, stencilWidth);
  } else {
    xStart = max(0, baseCell.x - range);
    yStart = max(0, baseCell.y - range);
    let xEnd = min(i32(params.cols) - 1, baseCell.x + range);
    let yEnd = min(i32(params.rows) - 1, baseCell.y + range);
    xCount = u32(xEnd - xStart + 1);
    yCount = u32(yEnd - yStart + 1);
  }

  var acceleration = vec2<f32>(0.0, 0.0);
  let radiusSquared = params.radius * params.radius;

  for (var yOffset = 0u; yOffset < yCount; yOffset++) {
    var cellY: u32;
    if (params.wrap != 0u) {
      cellY = wrappedIndex(yStart + i32(yOffset), params.rows);
    } else {
      cellY = u32(yStart + i32(yOffset));
    }

    for (var xOffset = 0u; xOffset < xCount; xOffset++) {
      var cellX: u32;
      if (params.wrap != 0u) {
        cellX = wrappedIndex(xStart + i32(xOffset), params.cols);
      } else {
        cellX = u32(xStart + i32(xOffset));
      }

      var neighborIndex = atomicLoad(&cellHeads[cellY * params.cols + cellX]);
      loop {
        if (neighborIndex < 0) {
          break;
        }

        let targetIndex = u32(neighborIndex);
        var displacement = statesIn[targetIndex].xy - position;
        if (params.wrap != 0u) {
          displacement.x = minimumImage(displacement.x, params.worldSize.x);
          displacement.y = minimumImage(displacement.y, params.worldSize.y);
        }

        let distanceSquared = dot(displacement, displacement);
        if (distanceSquared > 0.0 && distanceSquared < radiusSquared) {
          let distance = sqrt(distanceSquared);
          let q = distance / params.radius;
          let direction = displacement / distance;
          var curve: f32;
          if (q < params.beta) {
            // Universal repulsion. The matrix must not affect this branch.
            curve = q / params.beta - 1.0;
          } else {
            let envelope = 1.0 - abs(2.0 * q - 1.0 - params.beta) / (1.0 - params.beta);
            let targetKind = kinds[targetIndex];
            curve = envelope * matrix[sourceKind * params.typeCount + targetKind];
          }
          acceleration += direction * curve;
        }

        neighborIndex = next[targetIndex];
      }
    }
  }

  forceOut[particleIndex] = acceleration;
  let mass = masses[sourceKind];
  let damping = pow(params.damping, params.dt);
  var velocity = (state.zw + acceleration * (params.force * params.dt / mass)) * damping;
  var nextPosition = position + velocity * params.dt;

  if (params.wrap != 0u) {
    nextPosition.x = wrappedPosition(nextPosition.x, params.worldSize.x);
    nextPosition.y = wrappedPosition(nextPosition.y, params.worldSize.y);
  } else {
    if (nextPosition.x < 0.0 || nextPosition.x > params.worldSize.x) {
      velocity.x *= -0.8;
      nextPosition.x = clamp(nextPosition.x, 0.0, params.worldSize.x);
    }
    if (nextPosition.y < 0.0 || nextPosition.y > params.worldSize.y) {
      velocity.y *= -0.8;
      nextPosition.y = clamp(nextPosition.y, 0.0, params.worldSize.y);
    }
  }

  statesOut[particleIndex] = vec4<f32>(nextPosition, velocity);
}
`;

/** Bindings: 0 params, 1 active state, 2 kinds, 3 draw order, 4 palette. */
export const PARTICLE_RENDER_WGSL = /* wgsl */ `
${PARAMS_WGSL}

struct Palette {
  colors: array<vec4<f32>, 12>,
}

struct ParticleVertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> states: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> kinds: array<u32>;
@group(0) @binding(3) var<storage, read> drawOrder: array<u32>;
@group(0) @binding(4) var<uniform> palette: Palette;

const QUAD_CORNERS = array<vec2<f32>, 6>(
  vec2<f32>(0.0, 0.0),
  vec2<f32>(1.0, 0.0),
  vec2<f32>(0.0, 1.0),
  vec2<f32>(0.0, 1.0),
  vec2<f32>(1.0, 0.0),
  vec2<f32>(1.0, 1.0),
);

@vertex
fn particleVertex(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> ParticleVertexOutput {
  let particleIndex = drawOrder[instanceIndex];
  let squareSize = params.particleSize * params.worldScale;
  let worldPosition = states[particleIndex].xy + QUAD_CORNERS[vertexIndex] * squareSize;
  let normalized = worldPosition / params.worldSize;

  var output: ParticleVertexOutput;
  output.position = vec4<f32>(normalized.x * 2.0 - 1.0, 1.0 - normalized.y * 2.0, 0.0, 1.0);
  output.color = palette.colors[kinds[particleIndex] % 12u];
  return output;
}

@fragment
fn particleFragment(input: ParticleVertexOutput) -> @location(0) vec4<f32> {
  return input.color;
}
`;

/** Named bundle for backends that prefer one import. Each value is standalone WGSL. */
export const PARTICLE_LIFE_SHADERS = Object.freeze({
  clear: CLEAR_CELL_HEADS_WGSL,
  build: BUILD_GRID_WGSL,
  forceAndIntegrate: FORCE_AND_INTEGRATE_WGSL,
  particleRender: PARTICLE_RENDER_WGSL,
});
