import { performance } from 'node:perf_hooks'; import { ParticleLife } from '../src/engine.js';
const count=Number(process.argv[2]||10000),warmup=10,frames=60;
const sim=new ParticleLife({count,width:1280,height:720,radius:24,types:6,seed:'benchmark'});
for(let i=0;i<warmup;i++)sim.step();const samples=[];
for(let i=0;i<frames;i++){const t=performance.now();sim.step();samples.push(performance.now()-t);}
samples.sort((a,b)=>a-b);const mean=samples.reduce((a,b)=>a+b,0)/frames,p95=samples[Math.floor(frames*.95)];
console.log(JSON.stringify({particleCount:count,frames,meanMs:+mean.toFixed(2),p95Ms:+p95.toFixed(2),simulationFps:+(1000/mean).toFixed(1),grid:`${sim.cols}x${sim.rows}`,algorithm:'uniform-grid'},null,2));
if(!Number.isFinite(mean)||mean>1000)process.exitCode=1;
