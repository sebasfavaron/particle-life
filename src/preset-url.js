export const PALETTE = [
  { name: 'cyan', hex: '#66f2d5' },
  { name: 'red', hex: '#ff5577' },
  { name: 'yellow', hex: '#ffd166' },
  { name: 'blue', hex: '#58a6ff' },
  { name: 'purple', hex: '#c77dff' },
  { name: 'orange', hex: '#ff8f40' },
  { name: 'green', hex: '#9cff57' },
  { name: 'pink', hex: '#f55de1' },
  { name: 'aqua', hex: '#67e8f9' },
  { name: 'white', hex: '#f5f7ff' },
  { name: 'rose', hex: '#ef476f' },
  { name: 'mint', hex: '#06d6a0' },
];

export function classLabel(index) {
  const color = PALETTE[index % PALETTE.length];
  return `${color.name} (${index + 1})`;
}

export function decodePresetUrl(input) {
  let url;
  try { url = new URL(input); }
  catch { throw new Error('Expected an absolute URL containing a preset query parameter.'); }
  const raw = url.searchParams.get('preset');
  if (!raw) throw new Error('URL has no preset query parameter.');
  let data;
  try { data = JSON.parse(raw); }
  catch { throw new Error('The preset query parameter is not valid JSON.'); }
  validatePreset(data);
  return data;
}

export function encodePresetUrl(data, baseUrl = 'https://sebasfavaron.github.io/particle-life/') {
  validatePreset(data);
  let url;
  try { url = new URL(baseUrl); }
  catch { throw new Error('Expected an absolute base URL.'); }
  url.searchParams.set('preset', JSON.stringify(data));
  return url.toString();
}

export function validatePreset(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Preset must be a JSON object.');
  if (!Array.isArray(data.matrix) || data.matrix.length < 1) throw new Error('Preset matrix must be a non-empty square array.');
  const n = data.matrix.length;
  if (data.classes !== undefined && Number(data.classes) !== n) throw new Error(`classes (${data.classes}) does not match matrix size (${n}).`);
  if (!data.matrix.every(row => Array.isArray(row) && row.length === n && row.every(Number.isFinite))) {
    throw new Error('Preset matrix must be square and contain only finite numbers.');
  }
  if (data.masses !== undefined && (!Array.isArray(data.masses) || data.masses.length !== n || !data.masses.every(value => Number.isFinite(value) && value > 0))) {
    throw new Error('Preset masses must have one positive finite value per class.');
  }
  return data;
}

function number(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function analyzePreset(data) {
  validatePreset(data);
  const n = data.matrix.length;
  const force = number(data.force, 0.02);
  const dt = number(data.dt, 1);
  const damping = number(data.damping, 0.7);
  const masses = data.masses ?? Array(n).fill(1);
  // This is the post-damping velocity increment from one interaction whose envelope is 1.
  const gains = masses.map(mass => force * dt * Math.pow(damping, dt) / mass);
  const classes = data.matrix.map((row, index) => {
    const l2 = Math.hypot(...row);
    return {
      index, label: classLabel(index), mass: masses[index], selfRule: row[index],
      gain: gains[index], ruleL2: l2, responsePotential: gains[index] * l2,
    };
  });
  const pairs = [];
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    const aFeelsB = data.matrix[a][b], bFeelsA = data.matrix[b][a];
    const pair = {
      a, b, aLabel: classLabel(a), bLabel: classLabel(b), aFeelsB, bFeelsA,
      nonReciprocity: Math.abs(aFeelsB - bFeelsA),
      aVelocityContribution: gains[a] * aFeelsB,
      bVelocityContribution: gains[b] * bFeelsA,
    };
    if (aFeelsB > 0 && bFeelsA < 0) {
      pair.relation = `${pair.aLabel} chases ${pair.bLabel}; ${pair.bLabel} flees ${pair.aLabel}`;
      pair.chaser = { label: pair.aLabel, rule: aFeelsB, contribution: pair.aVelocityContribution };
      pair.runner = { label: pair.bLabel, rule: bFeelsA, contribution: pair.bVelocityContribution };
    } else if (aFeelsB < 0 && bFeelsA > 0) {
      pair.relation = `${pair.bLabel} chases ${pair.aLabel}; ${pair.aLabel} flees ${pair.bLabel}`;
      pair.chaser = { label: pair.bLabel, rule: bFeelsA, contribution: pair.bVelocityContribution };
      pair.runner = { label: pair.aLabel, rule: aFeelsB, contribution: pair.aVelocityContribution };
    } else if (aFeelsB > 0 && bFeelsA > 0) pair.relation = 'mutual attraction';
    else if (aFeelsB < 0 && bFeelsA < 0) pair.relation = 'mutual repulsion';
    else pair.relation = 'one-sided / neutral';
    pairs.push(pair);
  }
  return {
    settings: { classes: n, particleCount: data.particleCount, interactionRadius: data.interactionRadius, force, dt, damping, speed: data.speed },
    classes, pairs,
    chasePairs: pairs.filter(pair => pair.relation.includes('chases')).sort((a, b) => b.nonReciprocity - a.nonReciprocity),
    nonReciprocalPairs: [...pairs].sort((a, b) => b.nonReciprocity - a.nonReciprocity),
  };
}

const fixed = value => Number(value).toFixed(4);
export function formatPresetReport(data) {
  const report = analyzePreset(data);
  const out = [];
  out.push(`Preset: ${data._name ?? data.seed ?? 'unnamed'}`);
  out.push(`seed=${data.seed ?? 'n/a'} particles=${report.settings.particleCount ?? 'n/a'} classes=${report.settings.classes} radius=${report.settings.interactionRadius ?? 'n/a'}`);
  out.push(`force=${report.settings.force} dt=${report.settings.dt} damping=${report.settings.damping} speed=${report.settings.speed ?? 'n/a'}`);
  out.push('');
  out.push('Class response potential (larger = more velocity response to equal local rule input):');
  for (const item of [...report.classes].sort((a, b) => b.responsePotential - a.responsePotential)) {
    out.push(`  ${item.label}: mass=${fixed(item.mass)} self=${fixed(item.selfRule)} gain=${fixed(item.gain)} rule-L2=${fixed(item.ruleL2)} potential=${fixed(item.responsePotential)}`);
  }
  out.push('');
  out.push('Chase/flee pairs (matrix values; post-damping velocity contribution at envelope=1):');
  for (const pair of report.chasePairs) {
    out.push(`  ${pair.relation}: ${pair.chaser.label}→${pair.runner.label}=${fixed(pair.chaser.rule)} (Δv=${fixed(pair.chaser.contribution)}); ${pair.runner.label}→${pair.chaser.label}=${fixed(pair.runner.rule)} (flee |Δv|=${fixed(Math.abs(pair.runner.contribution))})`);
  }
  out.push('');
  out.push('Most non-reciprocal pairs:');
  for (const pair of report.nonReciprocalPairs.slice(0, 8)) {
    out.push(`  ${pair.aLabel} ↔ ${pair.bLabel}: ${fixed(pair.aFeelsB)} / ${fixed(pair.bFeelsA)}; gap=${fixed(pair.nonReciprocity)}; ${pair.relation}`);
  }
  return out.join('\n');
}
