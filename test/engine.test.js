import test from 'node:test'; import assert from 'node:assert/strict'; import { ParticleLife } from '../src/engine.js';
test('new default configuration supports 40 classes',()=>{const s=new ParticleLife();assert.equal(s.count,5000);assert.equal(s.types,40);assert.equal(s.radius,80);assert.equal(s.force,.025);assert.equal(s.damping,.82);assert.equal(s.dt,1);s.configure({types:40});assert.equal(s.types,40);assert.equal(s.matrix.length,1600);});
test('seed is deterministic',()=>{const a=new ParticleLife({count:100,seed:'same'}),b=new ParticleLife({count:100,seed:'same'});assert.deepEqual([...a.matrix],[...b.matrix]);assert.deepEqual([...a.x],[...b.x]);});
test('uniform grid indexes every particle once',()=>{const s=new ParticleLife({count:1000,width:800,height:600,radius:30});s.buildGrid();let seen=0;for(const h of s.head){for(let i=h;i!==-1;i=s.next[i])seen++;}assert.equal(seen,1000);assert.ok(s.head.length < s.count);});
test('preset JSON round trip',()=>{const a=new ParticleLife({count:1234,types:4,seed:'roundtrip'}),json=JSON.parse(JSON.stringify(a.exportPreset())),b=new ParticleLife();b.importPreset(json);assert.equal(b.count,1234);assert.equal(b.types,4);assert.deepEqual([...b.matrix],[...a.matrix]);});
test('step keeps wrapped particles in bounds',()=>{const s=new ParticleLife({count:2000,width:640,height:480});for(let n=0;n<5;n++)s.step();for(let i=0;i<s.count;i++){assert.ok(s.x[i]>=0&&s.x[i]<s.width);assert.ok(s.y[i]>=0&&s.y[i]<s.height);}});

function referenceStep(sim) {
  const {count, radius, width, height, types, matrix, masses, wrap, beta, force, dt, damping} = sim;
  const x=[...sim.x], y=[...sim.y], vx=[...sim.vx], vy=[...sim.vy], kind=[...sim.kind];
  const fx=Array(count).fill(0), fy=Array(count).fill(0), r2=radius*radius;
  for(let i=0;i<count;i++) for(let j=0;j<count;j++) if(i!==j) {
    let dx=x[j]-x[i],dy=y[j]-y[i];
    if(wrap){if(dx>width*.5)dx-=width;else if(dx< -width*.5)dx+=width;if(dy>height*.5)dy-=height;else if(dy< -height*.5)dy+=height;}
    const d2=dx*dx+dy*dy;if(d2<=0||d2>=r2)continue;
    const d=Math.sqrt(d2),q=d/radius,a=matrix[kind[i]*types+kind[j]];
    const curve=q<beta?q/beta-1:a*(1-Math.abs(2*q-1-beta)/(1-beta));
    fx[i]+=dx*curve/d;fy[i]+=dy*curve/d;
  }
  const out={x:[],y:[],vx:[],vy:[],fx:fx.map(Math.fround),fy:fy.map(Math.fround)};
  for(let i=0;i<count;i++){let nx=x[i]+Math.fround((vx[i]+fx[i]*force*dt/masses[kind[i]])*Math.pow(damping,dt))*dt,ny=y[i]+Math.fround((vy[i]+fy[i]*force*dt/masses[kind[i]])*Math.pow(damping,dt))*dt;if(wrap){nx=((nx%width)+width)%width;ny=((ny%height)+height)%height;}out.vx[i]=Math.fround((vx[i]+fx[i]*force*dt/masses[kind[i]])*Math.pow(damping,dt));out.vy[i]=Math.fround((vy[i]+fy[i]*force*dt/masses[kind[i]])*Math.pow(damping,dt));out.x[i]=Math.fround(nx);out.y[i]=Math.fround(ny);}return out;
}
function assertStepMatchesAllPairs(options, positions) {
  const s=new ParticleLife(options);s.x.set(positions.x);s.y.set(positions.y);s.vx.set(positions.vx);s.vy.set(positions.vy);s.kind.set(positions.kind);s.matrix.set(positions.matrix);s.masses.set(positions.masses);const expected=referenceStep(s);s.step();for(const key of ['x','y','vx','vy','fx','fy'])for(let i=0;i<s.count;i++)assert.ok(Math.abs(s[key][i]-expected[key][i])<2e-6,`${key}[${i}] ${s[key][i]} != ${expected[key][i]}`);
}
test('single-visit pairs match all-pairs force math across wrapped small grids',()=>{const positions={x:[2,88,20,75],y:[3,85,45,50],vx:[.01,-.02,.03,-.04],vy:[-.01,.02,-.03,.04],kind:[0,1,0,1],matrix:[.5,-.4,.25,.9],masses:[1,1.7]};assertStepMatchesAllPairs({count:4,types:2,width:90,height:90,radius:60,force:.02,damping:.7,seed:'pairs'},positions);assertStepMatchesAllPairs({count:4,types:2,width:90,height:90,radius:60,force:.02,damping:.7,wrap:false,seed:'pairs'},positions);assertStepMatchesAllPairs({count:4,types:2,width:90,height:90,radius:60,force:.02,damping:.7,cellScale:.5,seed:'pairs'},positions);assertStepMatchesAllPairs({count:4,types:2,width:50,height:50,radius:60,force:.02,damping:.7,cellScale:.5,seed:'pairs'},positions);});
