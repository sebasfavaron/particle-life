import { ParticleLife } from './engine.js';
import { createWebGpuMainAdapter } from './webgpu/main-adapter.js';

const $ = id => document.getElementById(id);
// One root-level layer avoids the independently scrolling sidebar and its zoomed coordinates.
const appTooltip = document.createElement('div');
appTooltip.id = 'appTooltip';
appTooltip.role = 'tooltip';
appTooltip.hidden = true;
document.body.append(appTooltip);
let tooltipIcon = null;

function placeTooltip(icon) {
  const source = icon.querySelector('.tip');
  if(!source) return;
  appTooltip.textContent = source.textContent;
  appTooltip.hidden = false;
  appTooltip.style.visibility = 'hidden';
  appTooltip.style.left = '0';
  appTooltip.style.top = '0';
  const iconBox = icon.getBoundingClientRect();
  const tipBox = appTooltip.getBoundingClientRect();
  const margin = 6;
  const left = Math.max(margin, Math.min(innerWidth - tipBox.width - margin, iconBox.left));
  const above = iconBox.top - tipBox.height - margin;
  const top = above >= margin ? above : Math.min(innerHeight - tipBox.height - margin, iconBox.bottom + margin);
  appTooltip.style.left = `${left}px`;
  appTooltip.style.top = `${top}px`;
  appTooltip.style.visibility = '';
}
function hideTooltip() { tooltipIcon = null; appTooltip.hidden = true; }
document.addEventListener('pointerover', event => {
  const icon = event.target.closest('.info-icon');
  if(!icon || icon === tooltipIcon) return;
  tooltipIcon = icon;
  placeTooltip(icon);
});
document.addEventListener('pointerout', event => {
  const icon = event.target.closest('.info-icon');
  if(icon && !icon.contains(event.relatedTarget)) hideTooltip();
});
addEventListener('resize', () => { if(tooltipIcon) placeTooltip(tooltipIcon); });
addEventListener('scroll', () => { if(tooltipIcon) placeTooltip(tooltipIcon); });
document.querySelector('aside').addEventListener('scroll', () => { if(tooltipIcon) placeTooltip(tooltipIcon); });
const stage = document.querySelector('main');
const canvas = $('world'), gpuCanvas = $('worldGpu'), ctx = canvas.getContext('2d', { alpha: false });
const gpuButton = $('gpu'), backendHud = $('backend');
const palette = ['#66f2d5','#ff5577','#ffd166','#58a6ff','#c77dff','#ff8f40','#9cff57','#f55de1','#67e8f9','#f5f7ff','#ef476f','#06d6a0'];
const DEFAULT_WORLD_SCALE = 1;
const box = canvas.getBoundingClientRect();
const initialWidth = Math.round(box.width) || 1200, initialHeight = Math.round(box.height) || 800;
const sim = new ParticleLife({ width: initialWidth * DEFAULT_WORLD_SCALE, height: initialHeight * DEFAULT_WORLD_SCALE });
let running = true, last = performance.now(), sampleAt = last, frames = 0, frameSum = 0, stepsPerFrame = 10, scanning = false, showForces = false, worldScale = DEFAULT_WORLD_SCALE, baseW = 1200, baseH = 800;
let gpu = null, gpuActive = false, gpuStarting = false, gpuFramePending = false;
const MAX_FRAME_MS = 20; // safety budget per frame
let stepTimeEstimate = 0; // ms per step (rolling avg), zero = uncalibrated
let firstFrame = true;

function currentDpr() { return Math.min(devicePixelRatio || 1, 2); }
function resize() {
  const box = stage.getBoundingClientRect(), dpr = currentDpr();
  baseW = Math.max(1, box.width); baseH = Math.max(1, box.height);
  canvas.width = Math.round(baseW * dpr); canvas.height = Math.round(baseH * dpr);
  const renderScale = dpr / worldScale;
  ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
  sim.resize(baseW * worldScale, baseH * worldScale);
  syncGpuConfiguration();
}
function syncZoomLabel() { $('zoomLabel').textContent = `Zoom ×${worldScale.toFixed(2)}`; }
function setWorldScale(s, { persist = true } = {}) {
  worldScale = Math.max(0.25, Math.min(5, s));
  syncZoomLabel();
  const dpr = currentDpr();
  canvas.width = Math.round(baseW * dpr); canvas.height = Math.round(baseH * dpr);
  const renderScale = dpr / worldScale;
  ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
  sim.resize(baseW * worldScale, baseH * worldScale);
  syncGpuConfiguration();
  if(persist) scheduleURL();
}
function setBackendStatus(message) { backendHud.textContent = message; }
function fallbackToCpu(reason) {
  const failed = gpu;
  gpu = null; gpuActive = false; gpuStarting = false; gpuFramePending = false;
  try { failed?.destroy(); } catch (_) { /* Device may already be lost. */ }
  gpuCanvas.hidden = true; canvas.hidden = false;
  sim.resetParticles(sim.seed);
  gpuButton.disabled = true; gpuButton.textContent = 'GPU unavailable';
  gpuButton.title = reason;
  setBackendStatus(`CPU fallback · ${reason}`);
}
function syncGpuConfiguration() {
  if (!gpuActive || !gpu) return;
  try {
    gpu.configureFromCpu();
    gpu.resizeFromCpu({ cssWidth: baseW, cssHeight: baseH, dpr: currentDpr(), worldScale });
  } catch (error) {
    fallbackToCpu(`GPU update failed: ${error.message}`);
  }
}
function resetGpuFromCpu() {
  if (!gpuActive || !gpu) return;
  try { gpu.resetFromCpu(); gpu.render(); }
  catch (error) { fallbackToCpu(`GPU reset failed: ${error.message}`); }
}
async function startGpu() {
  if (gpuActive || gpuStarting) return;
  if (!navigator.gpu || !isSecureContext) {
    fallbackToCpu('WebGPU needs a secure browser context and adapter');
    return;
  }
  gpuStarting = true; gpuButton.disabled = true; gpuButton.textContent = 'Starting GPU…';
  setBackendStatus('WebGPU starting…');
  let candidate = null;
  try {
    candidate = await createWebGpuMainAdapter({
      canvas: gpuCanvas, sim, palette, worldScale, cssWidth: baseW, cssHeight: baseH, dpr: currentDpr(),
      onDeviceLost(metadata) { fallbackToCpu(`GPU device lost: ${metadata.lossReason}`); },
      onUncapturedError(error) { console.error('WebGPU error', error); setBackendStatus(`GPU error: ${error.message}`); },
    });
    candidate.resetFromCpu();
    candidate.resizeFromCpu({ cssWidth: baseW, cssHeight: baseH, dpr: currentDpr(), worldScale });
    gpu = candidate; gpuActive = true; gpuStarting = false;
    showForces = false; syncForcesButton();
    gpuCanvas.hidden = false; canvas.hidden = true;
    gpu.render();
    gpuButton.textContent = 'GPU active'; gpuButton.disabled = true; gpuButton.title = 'WebGPU is running';
    setBackendStatus('WebGPU active');
    window.__particleLifeBackend = gpu.metadata;
  } catch (error) {
    try { candidate?.destroy(); } catch (_) { /* Best effort after partial initialization. */ }
    gpuStarting = false;
    fallbackToCpu(`WebGPU unavailable: ${error.message}`);
  }
}
gpuButton.onclick = startGpu;
new ResizeObserver(resize).observe(stage);

function colorFor(value) {
  const a = Math.min(1, Math.abs(value));
  return value < 0 ? `rgba(${80+Math.round(160*a)},50,90,${0.25+0.65*a})` : `rgba(35,${90+Math.round(150*a)},${100+Math.round(100*a)},${0.25+0.65*a})`;
}
function paintRange(input) {
  const min = Number(input.min), max = Number(input.max), value = Number(input.value);
  const progress = max > min && Number.isFinite(value) ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
  input.style.setProperty('--range-fill', `${progress * 100}%`);
}
function paintRanges() { document.querySelectorAll('.controls input[type=range]').forEach(paintRange); }
document.addEventListener('input', event => { if(event.target.matches('.controls input[type=range]')) paintRange(event.target); });
function buildMatrix() {
  const box = $('matrix'), n = sim.types; box.innerHTML = '';
  const uiScale = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui')) || 1;
  box.style.gridTemplateColumns = `${18 * uiScale}px repeat(${n},${29 * uiScale}px)`;
  box.append(document.createElement('span'));
  for (let c=0;c<n;c++) { const el=document.createElement('span'); el.className='matrix-label'; el.style.color=palette[c]; el.textContent=c+1; box.append(el); }
  for (let r=0;r<n;r++) {
    const label=document.createElement('span'); label.className='matrix-label'; label.style.color=palette[r]; label.textContent=r+1; box.append(label);
    for (let c=0;c<n;c++) {
      const input=document.createElement('input'); input.type='number'; input.min='-1'; input.max='1'; input.step='0.05'; input.className='matrix-cell';
      const index=r*n+c, refresh=()=>{ const v=sim.matrix[index]; input.value=v.toFixed(2); input.style.background=colorFor(v); input.title=v.toFixed(2); };
      input.addEventListener('input',()=>{ const v=Number(input.value); if(Number.isFinite(v)){sim.matrix[index]=Math.max(-1,Math.min(1,v));input.style.background=colorFor(sim.matrix[index]);input.title=v.toFixed(2); syncGpuConfiguration(); scheduleURL();} });
      refresh(); box.append(input);
    }
  }
  // masses row — diagonal: class color + green-red weight
  const massLabel=document.createElement('span'); massLabel.className='matrix-label'; massLabel.textContent='M';
  massLabel.title='Mass per class (weight)'; box.append(massLabel);
  for (let t=0;t<n;t++) {
    const input=document.createElement('input'); input.type='number'; input.min='0.1'; input.max='5'; input.step='0.1'; input.className='matrix-cell mass-input';
    const refresh=()=>{
      const v=sim.masses[t];
      input.value=v.toFixed(1);
      input.title = v.toFixed(1);
      // green-red intensity: 0.1=red, 1=green, 5=red
      const tNorm = Math.abs(v - 1) / 4;
      const r = Math.round(Math.min(1, tNorm * 2) * 200);
      const g = Math.round(Math.max(0, 1 - tNorm * 2) * 200);
      const weightColor = `rgb(${r},${g},80)`;
      input.style.background = `linear-gradient(135deg, ${palette[t]}88 50%, ${weightColor} 50%)`;
    };
    input.addEventListener('input',()=>{
      const v=Number(input.value);
      if(Number.isFinite(v) && v>=0.1 && v<=5) sim.masses[t]=v;
      refresh(); syncGpuConfiguration(); scheduleURL();
    });
    refresh(); box.append(input);
  }
}
function syncControls() {
  $('seed').value=sim.seed; $('count').value=sim.count; $('types').value=sim.types; $('radius').value=sim.radius;
  $('damping').value=sim.damping; $('force').value=sim.force; $('dt').value=sim.dt; $('wrap').checked=sim.wrap;
  for (const id of ['count','types','radius','damping','force','dt']) $(id+'Out').textContent=$(id).value;
  paintRanges();
  buildMatrix();
}
function randomize() {
  const newSeed = Date.now().toString(36) + Math.random().toString(36).slice(2,6);
  $('seed').value = newSeed;
  sim.seed = newSeed;
  sim.randomizeMatrix(newSeed);
  buildMatrix();
  syncGpuConfiguration();
}
const matrixHelpDialog = $('matrixHelpDialog');
$('matrixHelp').onclick = () => matrixHelpDialog.showModal();
$('matrixHelpClose').onclick = () => matrixHelpDialog.close();
matrixHelpDialog.addEventListener('click', event => { if(event.target === matrixHelpDialog) matrixHelpDialog.close(); });
$('randomize').onclick=()=>{ randomize(); scheduleURL(); };
$('rndmass').onclick=()=>{
  for(let t=0;t<sim.types;t++) sim.masses[t]=0.5+Math.random()*2.5;
  buildMatrix(); syncGpuConfiguration(); scheduleURL();
};
$('reset').onclick=()=>{ sim.resetParticles($('seed').value); resetGpuFromCpu(); scheduleURL(); };
$('pause').onclick=()=>{running=!running;$('pause').textContent=running?'Pause':'Resume';};
$('seed').addEventListener('change',()=>{sim.seed=$('seed').value; scheduleURL();});
$('count').addEventListener('input',()=>$('countOut').textContent=$('count').value);
$('count').addEventListener('change',()=>{sim.configure({count:Number($('count').value)}); resetGpuFromCpu(); scheduleURL();});
$('types').addEventListener('input',()=>$('typesOut').textContent=$('types').value);
$('types').addEventListener('change',()=>{sim.configure({types:Number($('types').value)});buildMatrix(); resetGpuFromCpu(); scheduleURL();});
for (const id of ['radius','damping','force','dt']) $(id).addEventListener('input',()=>{
  const value=Number($(id).value); $(id+'Out').textContent=value; sim[id]=value; if(id==='radius')sim.rebuildGridStorage(); syncGpuConfiguration(); scheduleURL();
});
let showRadiusPreview = false, forceSliderHovered = false, forceSliderHeld = false;
const radiusControl = $('radius'), forceControl = $('force');
radiusControl.addEventListener('pointerdown', () => { showRadiusPreview = true; });
for (const event of ['pointerup', 'pointercancel']) addEventListener(event, () => { showRadiusPreview = false; forceSliderHeld = false; syncForcesButton(); });
radiusControl.addEventListener('blur', () => { showRadiusPreview = false; });
forceControl.addEventListener('pointerenter', () => { forceSliderHovered = true; syncForcesButton(); });
forceControl.addEventListener('pointerleave', () => { forceSliderHovered = false; syncForcesButton(); });
forceControl.addEventListener('pointerdown', () => { forceSliderHeld = true; syncForcesButton(); });
forceControl.addEventListener('blur', () => { forceSliderHeld = false; syncForcesButton(); });
$('wrap').onchange=()=>{ sim.wrap=$('wrap').checked; syncGpuConfiguration(); scheduleURL(); };
/* Nudge parameters: can cause crashes, investigate later.
$('nudge').onclick=()=>{
  const steps = { count: 1000, radius: 2, damping: 0.02, force: 0.005, dt: 0.1 };
  for(const [k,step] of Object.entries(steps)){
    const el = $(k);
    if(!el) continue;
    const min=Number(el.min), max=Number(el.max), cur=Number(el.value);
    const delta = Math.random()<0.5 ? -step : step;
    const raw = cur + delta;
    // snap to slider step
    const s = Number(el.step);
    const v = Math.max(min, Math.min(max, Math.round(raw/s)*s));
    el.value = v;
    paintRange(el);
    if($(k+'Out')) $(k+'Out').textContent = v;
    sim[k] = v;
    if(k==='radius') sim.rebuildGridStorage();
  }
  scheduleURL();
};
*/
$('speed').addEventListener('input',()=>{stepsPerFrame=Number($('speed').value);$('speedOut').textContent=stepsPerFrame;stepTimeEstimate=0; scheduleURL();});
// update URL bar to reflect current preset
function updateURL() {
  const d = sim.exportPreset();
  d._name = document.title.replace(' - Particle Life Lab','') || d.seed;
  d._author = 'ballbox-first';
  d.speed = stepsPerFrame;
  d.zoom = worldScale;
  d.showForces = showForces;
  const json = JSON.stringify(d);
  const url = location.origin + location.pathname + '?preset=' + encodeURIComponent(json);
  history.replaceState(null, '', url);
}
// debounced auto-update on any change
let urlDirty = false;
function scheduleURL() { if(!urlDirty){ urlDirty=true; requestAnimationFrame(()=>{ urlDirty=false; updateURL(); }); } }

const WORLD_SCALE_STEPS = [0.25, 0.33, 0.42, 0.55, 0.71, 1, 1.3, 1.69, 2.2, 2.86, 3.71, 5];
function stepWorldScale(direction) {
  const next = direction > 0
    ? WORLD_SCALE_STEPS.find(value => value > worldScale + 0.001) ?? WORLD_SCALE_STEPS.at(-1)
    : [...WORLD_SCALE_STEPS].reverse().find(value => value < worldScale - 0.001) ?? WORLD_SCALE_STEPS[0];
  setWorldScale(next);
}
$('zoomIn').onclick=()=>stepWorldScale(1);
$('zoomOut').onclick=()=>stepWorldScale(-1);
$('share').onclick=()=>{
  updateURL();
  const url = location.href;
  function copied(){
    const btn = $('share'); btn.textContent='✓ Copied!'; btn.className='primary copied';
    setTimeout(()=>{ btn.innerHTML='Copy URL'; btn.className='primary'; },1500);
  }
  // Try clipboard API first, fallback to execCommand
  if(navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(copied).catch(()=>{
      // fallback: textarea trick
      const ta = document.createElement('textarea');
      ta.value = url; ta.style.position='fixed'; ta.style.opacity='0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); copied(); } catch(e) {}
      document.body.removeChild(ta);
    });
  } else {
    const ta = document.createElement('textarea');
    ta.value = url; ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); copied(); } catch(e) {}
    document.body.removeChild(ta);
  }
};
addEventListener('keydown',event=>{if(event.target.matches('input'))return;if(event.code==='Space'){$('pause').click();event.preventDefault();}if(event.key.toLowerCase()==='r')randomize();});

function previewingForces() { return forceSliderHovered || forceSliderHeld; }
function syncForcesButton() { $('forces').className = showForces || previewingForces() ? 'active' : 'secondary'; }
$('forces').onclick=()=>{
  if(gpuActive) { setBackendStatus('WebGPU active · force arrows need CPU mode'); return; }
  showForces=!showForces; syncForcesButton(); scheduleURL();
};
$('scan').onclick=()=>{
  const n = prompt('Steps to simulate (no render):', '10000');
  const total = parseInt(n);
  if(!Number.isFinite(total) || total<1) return;
  const was = running; running=false; scanning=true;
  const chunk = total > 50000 ? 2000 : 500;
  let done = 0;
  $('pause').textContent='Scanning…';
  const finish = () => {
    scanning=false; running=was;
    $('pause').textContent=was?'Pause':'Resume';
    if(gpuActive) gpu?.render(); else draw();
  };
  async function gpuBatch() {
    if(!gpuActive || !gpu) { finish(); return; }
    const count = Math.min(chunk, total - done);
    try {
      gpu.stepMany(count);
      await gpu.waitForIdle(); // scan is explicit throughput work; do not queue an unbounded GPU backlog.
      done += count;
    } catch (error) {
      fallbackToCpu(`GPU scan failed: ${error.message}`); finish(); return;
    }
    if(done < total) {
      $('fps').textContent=`GPU scan ${(done/total*100).toFixed(0)}%`;
      requestAnimationFrame(() => { void gpuBatch(); });
    } else finish();
  }
  function cpuBatch() {
    const end = Math.min(done + chunk, total);
    for(; done < end; done++) sim.step();
    if(done < total) {
      $('fps').textContent=`Scan ${(done/total*100).toFixed(0)}%`;
      requestAnimationFrame(cpuBatch);
    } else finish();
  }
  if(gpuActive) void gpuBatch(); else requestAnimationFrame(cpuBatch);
};

function drawRadiusPreview() {
  const x = sim.width / 2, y = sim.height / 2, radius = sim.radius;
  ctx.save();
  ctx.fillStyle = '#ffd16614';
  ctx.strokeStyle = '#ffd166dd';
  ctx.lineWidth = 1.5 * worldScale;
  ctx.setLineDash([4 * worldScale, 3 * worldScale]);
  ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(x, y, 2 * worldScale, 0, Math.PI * 2); ctx.fillStyle = '#ffd166'; ctx.fill();
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + radius, y); ctx.stroke();
  ctx.fillStyle = '#ffd166';
  ctx.font = `${11 * worldScale}px ui-monospace, monospace`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(`interaction radius: ${radius}`, x, y - radius - 6 * worldScale);
  ctx.restore();
}
function draw() {
  // fill ALL physical pixels regardless of transform/dpr
  ctx.save(); ctx.setTransform(1,0,0,1,0,0);
  ctx.fillStyle='#05070c'; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.restore();
  const size=1.65*worldScale;
  for(let t=0;t<sim.types;t++) {
    ctx.fillStyle=palette[t%palette.length]; ctx.beginPath();
    for(let p=sim.typeOffsets[t];p<sim.typeOffsets[t+1];p++){const i=sim.drawOrder[p];ctx.rect(sim.x[i],sim.y[i],size,size);}
    ctx.fill();
  }
  if(showRadiusPreview) drawRadiusPreview();
  if(showForces || previewingForces()) {
    const scale = 8 * (1 + 0.2 * (worldScale - 1)), maxArrows = showForces ? 2000 : 500;
    let drawn=0;
    for(let t=0;t<sim.types;t++) {
      ctx.strokeStyle=palette[t%palette.length]+'bb'; ctx.lineWidth=1.8; ctx.beginPath();
      for(let p=sim.typeOffsets[t];p<sim.typeOffsets[t+1];p++){
        if(drawn>=maxArrows) break;
        const i=sim.drawOrder[p], fx=sim.fx[i], fy=sim.fy[i], m=Math.sqrt(fx*fx+fy*fy);
        if(m<0.001) continue;
        const len = Math.min(m*scale, 20);
        ctx.moveTo(sim.x[i],sim.y[i]);
        ctx.lineTo(sim.x[i]+fx/m*len, sim.y[i]+fy/m*len);
        drawn++;
      }
      ctx.stroke();
      if(drawn>=maxArrows) break;
    }
  }
}
function queueGpuStep(count, { render = !document.hidden } = {}) {
  if(!gpuActive || !gpu || gpuFramePending || count < 1) return false;
  try {
    gpu.stepMany(count);
    if(render) gpu.render();
    gpuFramePending = true;
    gpu.waitForIdle().then(() => { gpuFramePending = false; }, error => {
      gpuFramePending = false;
      fallbackToCpu(`GPU step failed: ${error.message}`);
    });
    return true;
  } catch(error) {
    fallbackToCpu(`GPU step failed: ${error.message}`);
    return false;
  }
}
function loop(now) {
  if(firstFrame){ firstFrame=false; resize(); }
  const start=performance.now();
  if(running && !scanning) {
    if(gpuActive) {
      queueGpuStep(document.hidden ? 1 : Math.max(1, stepsPerFrame));
    } else {
      // Background work stays intentionally tiny; the timer below keeps it alive if RAF is throttled.
      const budget = document.hidden ? 1 : Math.max(1, stepsPerFrame);
      let capped;
      if(stepTimeEstimate > 0) {
        // leave half the frame for draw
        const room = MAX_FRAME_MS - (performance.now() - start);
        capped = Math.min(budget, Math.max(1, Math.floor(room / stepTimeEstimate)));
      } else {
        capped = Math.min(budget, 5); // safe first guess
      }
      for(let s=0;s<capped;s++) sim.step();
    }
  }
  if(!document.hidden && !gpuActive) draw();
  const elapsed=performance.now()-start; frames++; frameSum+=elapsed;
  if(!document.hidden && now-sampleAt>=500){
    const fps=frames*1000/(now-sampleAt);
    $('fps').textContent=`${fps.toFixed(0)} FPS`;
    $('frame').textContent=gpuActive ? `GPU ${gpuFramePending ? 'busy' : 'ready'}` : `${(frameSum/frames).toFixed(1)} ms`;
    $('pairs').textContent=`${sim.count.toLocaleString()} ${stepsPerFrame>1?'· steps='+stepsPerFrame:''}`;
    window.__particleLifeMetrics={fps,ms:frameSum/frames,count:sim.count,grid:[sim.cols,sim.rows],backend:gpuActive?'webgpu':'cpu',gpuBusy:gpuFramePending};
    frames=0;frameSum=0;sampleAt=now;
  }
  // Calibrate CPU step time only. GPU queue completion is tracked separately.
  if(!gpuActive && stepTimeEstimate===0 && running && stepsPerFrame>1) {
    stepTimeEstimate = (performance.now()-start)/Math.max(1,stepsPerFrame);
  }
  requestAnimationFrame(loop);
}

resize(); // sync pre-resize — ensures fill covers canvas
syncZoomLabel();
window.particleLife=sim;
// Hidden tabs skip rendering and spend the saved time on physics. Browsers can still throttle
// timers, but each delivered callback advances as far as a near-full-core work budget allows.
const BACKGROUND_STEP_MS = 100, BACKGROUND_WORK_BUDGET_MS = 90, BACKGROUND_MAX_STEPS = 1000;
let backgroundStepTimer = null;
function advanceInBackground() {
  if(!document.hidden || !running || scanning) return;
  if(gpuActive) { queueGpuStep(Math.min(BACKGROUND_MAX_STEPS, Math.max(1, stepsPerFrame)), { render: false }); return; }
  const started = performance.now();
  let steps = 0;
  while(running && !scanning && steps < BACKGROUND_MAX_STEPS && performance.now() - started < BACKGROUND_WORK_BUDGET_MS) {
    sim.step();
    steps++;
  }
}
function startBackgroundSteps() {
  if(backgroundStepTimer === null) backgroundStepTimer = setInterval(advanceInBackground, BACKGROUND_STEP_MS);
}
function stopBackgroundSteps() {
  if(backgroundStepTimer !== null) clearInterval(backgroundStepTimer);
  backgroundStepTimer = null;
}
addEventListener('visibilitychange', ()=>{
  if(document.hidden) startBackgroundSteps();
  else { stopBackgroundSteps(); stepTimeEstimate = 0; }
});
if(document.hidden) startBackgroundSteps();
function loadSearchPreset(){
  const q = new URLSearchParams(location.search);
  const raw = q.get('preset');
  console.log('LOAD: search='+location.search+' hasPreset='+!!raw);
  if(raw) try {
    const data = JSON.parse(raw);
    console.log('Preset loaded: classes='+data.classes+' count='+data.particleCount+' seed='+data.seed+' matrix='+(data.matrix?data.matrix.length+'x'+data.matrix[0].length:'BAD'));
    if(Number.isFinite(Number(data.zoom))) setWorldScale(Number(data.zoom), { persist: false });
    sim.importPreset(data);
    if(data.speed){ stepsPerFrame=data.speed; $('speed').value=data.speed; $('speedOut').textContent=String(data.speed); }
    if(typeof data.showForces === 'boolean') showForces = data.showForces;
  } catch(e){ console.warn('Invalid preset URL', e); }
  syncControls();
  syncForcesButton();
  resetGpuFromCpu();
}
function initializeGpu() {
  if(!navigator.gpu || !isSecureContext) {
    gpuButton.disabled = true; gpuButton.textContent = 'GPU unavailable';
    gpuButton.title = 'WebGPU needs a secure browser context and adapter';
    setBackendStatus('CPU · WebGPU unavailable');
    return;
  }
  gpuButton.disabled = false; gpuButton.textContent = 'Use GPU';
  startGpu();
}
loadSearchPreset();
initializeGpu();
document.body.classList.remove('booting');
addEventListener('pageshow', loadSearchPreset);
addEventListener('popstate', loadSearchPreset);
requestAnimationFrame(loop);
