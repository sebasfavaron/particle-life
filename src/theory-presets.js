const common = {
  version: 1,
  particleCount: 5000,
  classes: 5,
  interactionRadius: 85,
  damping: 0.85,
  force: 0.005,
  dt: 2,
  wrap: true,
  masses: [1.5, 0.91, 1.12, 0.61, 1.44],
  speed: 13,
  zoom: 2.2,
  showForces: false,
};

function preset(name, seed, matrix, changes = {}) {
  return { ...common, ...changes, _name: name, _author: 'theory-generator', seed, matrix };
}

export const THEORY_EXPERIMENTS = [
  {
    id: 'A', name: 'Reciprocal garden',
    prediction: 'Control. Reciprocal rules should make calmer, more settled clumps than chase systems.',
    preset: preset('A — Reciprocal garden', 'theory-a-reciprocal', [
      [.75,.10,.05,-.15,.05], [.10,-.20,.45,-.45,.15], [.05,.45,.70,-.60,.30],
      [-.15,-.45,-.60,-.10,-.25], [.05,.15,.30,-.25,.45],
    ]),
  },
  {
    id: 'B', name: 'One chase',
    prediction: 'Red chases yellow while yellow flees. Expect mobile red/yellow fronts, but fewer ecosystem roles.',
    preset: preset('B — One chase', 'theory-b-one-chase', [
      [.75,.10,.05,-.15,.05], [.10,-.70,.96,-.45,.15], [.05,-.28,.70,-.60,.30],
      [-.15,-.45,-.60,-.10,-.25], [.05,.15,.30,-.25,.45],
    ]),
  },
  {
    id: 'C', name: 'Nomad hub',
    prediction: 'Add a purple class with near-zero self-rule that chases red/yellow and flees blue. Expect continual re-wiring between clusters.',
    preset: preset('C — Nomad hub', 'theory-c-nomad-hub', [
      [.80,.15,-.05,-.15,-.10], [.20,-.78,.97,-.71,.41], [-.10,-.27,.72,-.99,-.67],
      [-.15,.73,-.86,-.24,.08], [-.10,.76,.78,-.73,-.02],
    ]),
  },
  {
    id: 'D', name: 'Closed pursuit loop',
    prediction: 'Red→yellow→purple→red is a closed non-reciprocal loop. Expect travelling rings, spirals, or endlessly incomplete captures.',
    preset: preset('D — Closed pursuit loop', 'theory-d-loop', [
      [.65,.00,.00,-.10,.00], [.00,.05,.92,-.30,-.42], [.00,-.42,.12,-.20,.92],
      [-.10,-.30,-.20,.10,.00], [.00,.92,-.42,.00,.05],
    ]),
  },
  {
    id: 'E', name: 'Overdrive nomad hub',
    prediction: 'Negative control. Same role network as C, but extra force and speed. It may become noise instead of readable life.',
    preset: preset('E — Overdrive nomad hub', 'theory-e-overdrive', [
      [.80,.15,-.05,-.15,-.10], [.20,-.78,.97,-.71,.41], [-.10,-.27,.72,-.99,-.67],
      [-.15,.73,-.86,-.24,.08], [-.10,.76,.78,-.73,-.02],
    ], { force: .010, damping: .88, speed: 19 }),
  },
];


export const ENTITY_EXPERIMENTS = [
  {
    id: 'M1', name: 'Morphing colonies',
    prediction: 'Cyan, yellow, and purple mutually build mixed cores. Red, blue, and orange form a chase chain that should shear, feed, and recombine those cores.',
    preset: preset('M1 — Morphing colonies', 'morph-m1-colonies', [
      [.55,.35,.62,-.45,.62,.25], [.70,-.38,.88,-.82,.66,.20], [.62,-.30,.48,-.68,.75,.42],
      [.10,.84,-.20,-.25,.70,-.65], [.60,.68,.72,-.74,.04,.48], [.35,.64,.44,.82,.58,-.20],
    ], { classes: 6, masses: [1.35,.86,1.12,.68,1.30,1.00], creatureEnergy: true, speed: 11 }),
  },
  {
    id: 'M2', name: 'Relay cells',
    prediction: 'A stronger three-way pursuit relay should produce more frequent component hand-offs, but may become too fragmented.',
    preset: preset('M2 — Relay cells', 'morph-m2-relay', [
      [.45,.20,.70,-.55,.65,.10], [.75,-.40,.85,-.90,.60,.30], [.65,-.25,.40,-.70,.80,.50],
      [.05,.90,-.15,-.30,.75,-.80], [.72,.70,.75,-.80,.00,.65], [.10,.55,.45,.90,.55,-.10],
    ], { classes: 6, masses: [1.40,.82,1.08,.64,1.28,1.02], creatureEnergy: true, speed: 11 }),
  },
  {
    id: 'M3', name: 'Soft metamorphosis',
    prediction: 'Stronger mutual core rules and softer chases should preserve colorful bodies longer, with slower merging and shedding.',
    preset: preset('M3 — Soft metamorphosis', 'morph-m3-soft', [
      [.65,.20,.50,-.40,.50,.35], [.65,-.20,.65,-.65,.65,.45], [.50,-.10,.60,-.50,.65,.50],
      [.10,.70,-.10,-.10,.70,-.50], [.50,.70,.65,-.70,.10,.55], [.35,.70,.55,.80,.60,.05],
    ], { classes: 6, masses: [1.38,.90,1.12,.70,1.30,1.05], creatureEnergy: true, speed: 11 }),
  },
];
