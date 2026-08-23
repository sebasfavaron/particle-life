import { ParticleLife } from './engine.js';

const $ = id => document.getElementById(id);
const canvas = $('world'), ctx = canvas.getContext('2d', { alpha: false });
const palette = ['#66f2d5','#ff5577','#ffd166','#58a6ff','#c77dff','#ff8f40','#9cff57','#f55de1','#67e8f9','#f5f7ff','#ef476f','#06d6a0'];
const sim = new ParticleLife();
let running = true, last = performance.now(), sampleAt = last, frames = 0, frameSum = 0;

function resize() {
  const box = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(box.width * dpr); canvas.height = Math.round(box.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  sim.resize(box.width, box.height);
}
new ResizeObserver(resize).observe(canvas);

function colorFor(value) {
  const a = Math.min(1, Math.abs(value));
  return value < 0 ? `rgba(${80+Math.round(160*a)},50,90,${0.25+0.65*a})` : `rgba(35,${90+Math.round(150*a)},${100+Math.round(100*a)},${0.25+0.65*a})`;
}
function buildMatrix() {
  const box = $('matrix'), n = sim.types; box.innerHTML = '';
  box.style.gridTemplateColumns = `18px repeat(${n},29px)`;
  box.append(document.createElement('span'));
  for (let c=0;c<n;c++) { const el=document.createElement('span'); el.className='matrix-label'; el.style.color=palette[c]; el.textContent=c+1; box.append(el); }
  for (let r=0;r<n;r++) {
    const label=document.createElement('span'); label.className='matrix-label'; label.style.color=palette[r]; label.textContent=r+1; box.append(label);
    for (let c=0;c<n;c++) {
      const input=document.createElement('input'); input.type='number'; input.min='-1'; input.max='1'; input.step='0.05'; input.className='matrix-cell';
      const index=r*n+c, refresh=()=>{ const v=sim.matrix[index]; input.value=v.toFixed(2); input.style.background=colorFor(v); };
      input.addEventListener('input',()=>{ const v=Number(input.value); if(Number.isFinite(v)){sim.matrix[index]=Math.max(-1,Math.min(1,v));input.style.background=colorFor(sim.matrix[index]);} });
      refresh(); box.append(input);
    }
  }
}
function syncControls() {
  $('seed').value=sim.seed; $('count').value=sim.count; $('types').value=sim.types; $('radius').value=sim.radius;
  $('damping').value=sim.damping; $('force').value=sim.force; $('dt').value=sim.dt; $('wrap').checked=sim.wrap;
  for (const id of ['count','types','radius','damping','force','dt']) $(id+'Out').textContent=$(id).value;
  buildMatrix();
}
function randomize() { sim.randomizeMatrix($('seed').value); buildMatrix(); }
$('randomize').onclick=randomize;
$('reset').onclick=()=>sim.resetParticles($('seed').value);
$('pause').onclick=()=>{running=!running;$('pause').textContent=running?'Pause':'Resume';};
$('seed').addEventListener('change',()=>{sim.seed=$('seed').value;});
$('count').addEventListener('input',()=>$('countOut').textContent=$('count').value);
$('count').addEventListener('change',()=>{sim.configure({count:Number($('count').value)});});
$('types').addEventListener('input',()=>$('typesOut').textContent=$('types').value);
$('types').addEventListener('change',()=>{sim.configure({types:Number($('types').value)});buildMatrix();});
for (const id of ['radius','damping','force','dt']) $(id).addEventListener('input',()=>{
  const value=Number($(id).value); $(id+'Out').textContent=value; sim[id]=value; if(id==='radius')sim.rebuildGridStorage();
});
$('wrap').onchange=()=>sim.wrap=$('wrap').checked;
$('save').onclick=()=>{ const blob=new Blob([JSON.stringify(sim.exportPreset(),null,2)],{type:'application/json'}); const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`particle-life-${sim.seed}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000); };
$('load').onclick=()=>$('file').click();
$('file').onchange=async event=>{ try { sim.importPreset(JSON.parse(await event.target.files[0].text())); syncControls(); } catch(error){ alert(error.message); } event.target.value=''; };
addEventListener('keydown',event=>{if(event.target.matches('input'))return;if(event.code==='Space'){$('pause').click();event.preventDefault();}if(event.key.toLowerCase()==='r')randomize();});

function draw() {
  ctx.fillStyle='#05070c'; ctx.fillRect(0,0,sim.width,sim.height);
  const size=1.65;
  for(let t=0;t<sim.types;t++) {
    ctx.fillStyle=palette[t%palette.length]; ctx.beginPath();
    for(let p=sim.typeOffsets[t];p<sim.typeOffsets[t+1];p++){const i=sim.drawOrder[p];ctx.rect(sim.x[i],sim.y[i],size,size);}
    ctx.fill();
  }
}
function loop(now) {
  const start=performance.now(); if(running) sim.step(); draw();
  const elapsed=performance.now()-start; frames++; frameSum+=elapsed;
  if(now-sampleAt>=500){const fps=frames*1000/(now-sampleAt);$('fps').textContent=`${fps.toFixed(0)} FPS`;$('frame').textContent=`${(frameSum/frames).toFixed(1)} ms`;$('pairs').textContent=`${sim.count.toLocaleString()} · ${sim.cols}×${sim.rows} grid`;window.__particleLifeMetrics={fps,ms:frameSum/frames,count:sim.count,grid:[sim.cols,sim.rows]};frames=0;frameSum=0;sampleAt=now;}
  last=now; requestAnimationFrame(loop);
}
syncControls(); window.particleLife=sim; requestAnimationFrame(loop);
