# Particle Life Lab

A fast, editable **Particle Life / Clusters** simulation. Colored particles obey a
matrix of attraction and repulsion rules. Simple local rules produce cells,
chains, hunters, membranes, and drifting ecosystems.

![No build step](https://img.shields.io/badge/build-none-72e0b5)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)

## Run

Requires any modern browser and Python 3 (only to serve ES modules):

```bash
npm run dev
# open http://localhost:4173
```

No install or bundle step. You can also use `python3 -m http.server 4173`.

## Manipulate it

- Edit any matrix cell live. **Row particles feel column particles**.
- `+1`: strong attraction. `0`: neutral. `-1`: strong repulsion.
- Change color classes (2–40), particles (1k–30k), radius (10–360), damping, force, `dt`, and edge wrap.
- Enable **Creature energy** to detect compact mixed-color groups every 10 steps. Total energy stays at 100%; activity moves energy to ambient space and incoming particles transfer ambient energy into a creature.
- Set a seed, then **Randomize matrix**. The same seed and class count produce the same matrix.
- **Download JSON** saves every important parameter. **Load JSON** restores it.
- `Space` pauses. `R` randomizes.

Matrix rules are directional: red can chase blue while blue flees red. All particles
also have a short-range collision/repulsion region, so positive attraction does not
collapse them to one point.

## Performance design

The engine is not an `O(n²)` all-pairs loop. Each frame it:

1. Inserts every particle into a typed-array **uniform spatial grid**.
2. Searches only the current cell and its eight neighbors.
3. Applies the piecewise Particle Life force curve inside the interaction radius.

Grid cell size equals interaction radius. Expected work is `O(n + local pairs)` for
roughly uniform density. Rendering batches one canvas path per color. The default is
**2,000 particles across 10 color classes**.

```bash
npm test
npm run benchmark            # 10,000 particles, 60 measured simulation frames
node scripts/benchmark.mjs 20000
```

The benchmark is headless and measures physics only. Browser FPS also appears in the
upper-left HUD and is available as `window.__particleLifeMetrics`.

## Presets

- [`presets/coral-garden.json`](presets/coral-garden.json): asymmetric pursuit loops and strong same-color clusters.
- Any live state can become a preset through **Download JSON**.

Default exploration starts with radius 80, damping 0.82, force 0.025, `dt` 1, and speed 4.
Reduce radius before raising particle count because neighbor density grows with radius².

## Share URLs

- Default state uses no query string.
- Changed scalars use short readable fields, for example `?f=0.04&v=7`.
- Matrix and mass edits use `x` and `m` deltas against the deterministic seed/type matrix.
- A fully edited matrix switches to compact `b` binary data. It is base64url, has no percent escapes, and preserves each rule within `1/32767`.
- Old `?preset=` JSON links still load.

## Source selection

Reviewed on 2026-08-23 at the pinned revisions below.

| Candidate | License | Physics / implementation | Spatial acceleration | Easy live editing | Web | Verdict |
|---|---|---|---|---|---|---|
| [hunar4321/particle-life](https://github.com/hunar4321/particle-life/tree/256278714c4f) | MIT | Mature Particle Life rules, seeds, many native presets; simple browser port | No; browser version uses group/all-pairs loops | Partial (`lil-gui`) | Yes, single HTML | **Chosen model/base**: permissive, clear, closest behavior and cheapest to adapt |
| [fnky/particle-life](https://github.com/fnky/particle-life/tree/aa2e65336b7b) | MIT | Clean JS type matrix and smooth force curve | No; nested particle loops (`O(n²)`) | Good parameter code, older npm build | Yes | Good reference, but performance ceiling |
| [HackerPoet/Particle-Life](https://github.com/HackerPoet/Particle-Life/tree/fe41df1776d4) | MIT | Polished C++/OpenGL simulator | No spatial grid in CPU universe loop | Native UI | No | Strong visuals; wrong deployment target and still all-pairs |
| [tom-mohr/particle-life](https://github.com/tom-mohr/particle-life/tree/3681fcb9519d) | GPL-3.0 | Well-factored Java physics framework | Parallel accelerator, not a spatial grid | Strong desktop app ecosystem | No | Rejected: copyleft and heavy native/JVM path |
| [Godot Particle Life Compute Shader](https://github.com/ThePathfindersCodex/Godot-Particle-Life-Compute-Shader/tree/92082de74113) | MIT | GPU compute implementation | **Yes**, spatial hash buffers and prefix offsets | Godot inspector/project | Not simple; compute support/export constraints | Best raw scale, but much heavier to run and modify |

## Attribution and license

Adapted from [Hunar Ahmad's `particle-life`](https://github.com/hunar4321/particle-life)
(MIT). The original MIT license is kept in [`LICENSE`](LICENSE); exact attribution and
changes are in [`NOTICE`](NOTICE). New adaptation code is offered under the same MIT terms.
