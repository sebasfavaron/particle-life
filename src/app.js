import { ParticleLife } from './engine.js';

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
const canvas = $('world'), ctx = canvas.getContext('2d', { alpha: false });
const palette = ['#66f2d5','#ff5577','#ffd166','#58a6ff','#c77dff','#ff8f40','#9cff57','#f55de1','#67e8f9','#f5f7ff','#ef476f','#06d6a0'];
const box = canvas.getBoundingClientRect();
const sim = new ParticleLife({ width: Math.round(box.width) || 1200, height: Math.round(box.height) || 800 });
let running = true, last = performance.now(), sampleAt = last, frames = 0, frameSum = 0, stepsPerFrame = 1, scanning = false, showForces = false, worldScale = 1, baseW = 1200, baseH = 800;
const MAX_FRAME_MS = 20; // safety budget per frame
let stepTimeEstimate = 0; // ms per step (rolling avg), zero = uncalibrated
let firstFrame = true;

function resize() {
  const box = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
  baseW = box.width; baseH = box.height;
  canvas.width = Math.round(baseW * dpr); canvas.height = Math.round(baseH * dpr);
  const renderScale = dpr / worldScale;
  ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
  sim.resize(baseW * worldScale, baseH * worldScale);
}
function setWorldScale(s) {
  worldScale = Math.max(0.25, Math.min(5, s));
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(baseW * dpr); canvas.height = Math.round(baseH * dpr);
  const renderScale = dpr / worldScale;
  ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
  sim.resize(baseW * worldScale, baseH * worldScale);
  scheduleURL();
}
new ResizeObserver(resize).observe(canvas);

function colorFor(value) {
  const a = Math.min(1, Math.abs(value));
  return value < 0 ? `rgba(${80+Math.round(160*a)},50,90,${0.25+0.65*a})` : `rgba(35,${90+Math.round(150*a)},${100+Math.round(100*a)},${0.25+0.65*a})`;
}
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
      input.addEventListener('input',()=>{ const v=Number(input.value); if(Number.isFinite(v)){sim.matrix[index]=Math.max(-1,Math.min(1,v));input.style.background=colorFor(sim.matrix[index]);input.title=v.toFixed(2); scheduleURL();} });
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
      refresh(); scheduleURL();
    });
    refresh(); box.append(input);
  }
}
function syncControls() {
  $('seed').value=sim.seed; $('count').value=sim.count; $('types').value=sim.types; $('radius').value=sim.radius;
  $('damping').value=sim.damping; $('force').value=sim.force; $('dt').value=sim.dt; $('wrap').checked=sim.wrap;
  for (const id of ['count','types','radius','damping','force','dt']) $(id+'Out').textContent=$(id).value;
  buildMatrix();
}
function randomize() {
  const newSeed = Date.now().toString(36) + Math.random().toString(36).slice(2,6);
  $('seed').value = newSeed;
  sim.seed = newSeed;
  sim.randomizeMatrix(newSeed);
  buildMatrix();
}
$('randomize').onclick=()=>{ randomize(); scheduleURL(); };
$('rndmass').onclick=()=>{
  for(let t=0;t<sim.types;t++) sim.masses[t]=0.5+Math.random()*2.5;
  buildMatrix(); scheduleURL();
};
$('rndall').onclick=()=>{
  randomize();
  for(let t=0;t<sim.types;t++) sim.masses[t]=0.5+Math.random()*2.5;
  buildMatrix(); scheduleURL();
};
$('reset').onclick=()=>{ sim.resetParticles($('seed').value); scheduleURL(); };
$('pause').onclick=()=>{running=!running;$('pause').textContent=running?'Pause':'Resume';};
$('seed').addEventListener('change',()=>{sim.seed=$('seed').value; scheduleURL();});
$('count').addEventListener('input',()=>$('countOut').textContent=$('count').value);
$('count').addEventListener('change',()=>{sim.configure({count:Number($('count').value)}); scheduleURL();});
$('types').addEventListener('input',()=>$('typesOut').textContent=$('types').value);
$('types').addEventListener('change',()=>{sim.configure({types:Number($('types').value)});buildMatrix(); scheduleURL();});
for (const id of ['radius','damping','force','dt']) $(id).addEventListener('input',()=>{
  const value=Number($(id).value); $(id+'Out').textContent=value; sim[id]=value; if(id==='radius')sim.rebuildGridStorage(); scheduleURL();
});
$('wrap').onchange=()=>{ sim.wrap=$('wrap').checked; scheduleURL(); };
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
    if($(k+'Out')) $(k+'Out').textContent = v;
    sim[k] = v;
    if(k==='radius') sim.rebuildGridStorage();
  }
  scheduleURL();
};
$('speed').addEventListener('input',()=>{stepsPerFrame=Number($('speed').value);$('speedOut').textContent=stepsPerFrame;stepTimeEstimate=0; scheduleURL();});
// update URL bar to reflect current preset
function updateURL() {
  const d = sim.exportPreset();
  d._name = document.title.replace(' - Particle Life Lab','') || d.seed;
  d._author = 'ballbox-first';
  d.speed = stepsPerFrame;
  const json = JSON.stringify(d);
  const url = location.origin + location.pathname + '?preset=' + encodeURIComponent(json);
  history.replaceState(null, '', url);
}
// debounced auto-update on any change
let urlDirty = false;
function scheduleURL() { if(!urlDirty){ urlDirty=true; requestAnimationFrame(()=>{ urlDirty=false; updateURL(); }); } }

$('zoomIn').onclick=()=>setWorldScale(worldScale/1.3);
$('zoomOut').onclick=()=>setWorldScale(worldScale*1.3);
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

$('forces').onclick=()=>{ showForces=!showForces; $('forces').className=showForces?'active':'secondary'; };
$('scan').onclick=()=>{
  const n = prompt('Steps to simulate (no render):', '10000');
  const total = parseInt(n);
  if(!Number.isFinite(total) || total<1) return;
  const was = running; running=false; scanning=true;
  const chunk = 500;
  let done = 0;
  $('pause').textContent='Scanning…';
  function batch() {
    let end = Math.min(done + chunk, total);
    // extend last chunk for heavy scans
    const batchSize = total > 50000 ? 2000 : chunk;
    end = Math.min(done + batchSize, total);
    for(; done < end; done++) sim.step();
    if(done < total) {
      $('fps').textContent=`Scan ${(done/total*100).toFixed(0)}%`;
      requestAnimationFrame(batch);
    } else {
      scanning=false; running=was;
      $('pause').textContent=was?'Pause':'Resume';
      draw();
    }
  }
  requestAnimationFrame(batch);
};

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
  if(showForces) {
    const scale=8, maxArrows=2000;
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
function loop(now) {
  if(firstFrame){ firstFrame=false; resize(); }
  const start=performance.now();
  if(running && !scanning) {
    // auto-cap steps to stay within frame budget
    const budget = Math.max(1, stepsPerFrame);
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
  draw();
  const elapsed=performance.now()-start; frames++; frameSum+=elapsed;
  if(now-sampleAt>=500){
    const msPerStep = stepTimeEstimate > 0 ? stepTimeEstimate : frameSum/frames/stepsPerFrame;
    const fps=frames*1000/(now-sampleAt);
    $('fps').textContent=`${fps.toFixed(0)} FPS`;
    $('frame').textContent=`${(frameSum/frames).toFixed(1)} ms`;
    $('pairs').textContent=`${sim.count.toLocaleString()} ${stepsPerFrame>1?'· steps='+stepsPerFrame:''}`;
    window.__particleLifeMetrics={fps,ms:frameSum/frames,count:sim.count,grid:[sim.cols,sim.rows]};
    frames=0;frameSum=0;sampleAt=now;
  }
  // calibrate step time on first few frames
  if(stepTimeEstimate===0 && running && stepsPerFrame>1) {
    stepTimeEstimate = (performance.now()-start)/Math.max(1,stepsPerFrame);
  }
  requestAnimationFrame(loop);
}
resize(); // sync pre-resize — ensures fill covers canvas
syncControls(); window.particleLife=sim;
// auto-reset speed to 1 when tab becomes visible again
addEventListener('visibilitychange', ()=>{
  if(document.hidden && stepsPerFrame>1) {
    // when leaving, store speed and set to 1
    window._savedSpeed = stepsPerFrame;
    stepsPerFrame = 1;
    $('speed').value = 1;
    $('speedOut').textContent = '1';
  } else if(!document.hidden && window._savedSpeed) {
    // when returning, restore — but also reset step time estimate so it calibrates fresh
    stepsPerFrame = window._savedSpeed;
    $('speed').value = window._savedSpeed;
    $('speedOut').textContent = String(window._savedSpeed);
    stepTimeEstimate = 0;
    window._savedSpeed = null;
  }
});
function loadSearchPreset(){
  const q = new URLSearchParams(location.search);
  const raw = q.get('preset');
  console.log('LOAD: search='+location.search+' hasPreset='+!!raw);
  if(!raw) return;
  try {
    const data = JSON.parse(raw);
    console.log('Preset loaded: classes='+data.classes+' count='+data.particleCount+' seed='+data.seed+' matrix='+(data.matrix?data.matrix.length+'x'+data.matrix[0].length:'BAD'));
    sim.importPreset(data);
    if(data.speed){ stepsPerFrame=data.speed; $('speed').value=data.speed; $('speedOut').textContent=String(data.speed); }
    syncControls();
  } catch(e){ console.warn('Invalid preset URL', e); }
}
loadSearchPreset();
addEventListener('pageshow', loadSearchPreset);
addEventListener('popstate', loadSearchPreset);
requestAnimationFrame(loop);
