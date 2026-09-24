import {bounds,minimumGap} from './anschluss-flaechen.js';

// Serializable, immutable terrain snapshot. The same diagonal owns sampling,
// visible terrain and exact projected-triangle ground clearance tests.
export function terrainSampler(settings={}) {
  const grid=settings.terrain;
  if(!grid){const slope=settings.slope||0;return {height:(x,z)=>slope*x,surface:box=>{const a={x:box.min.x-.01,z:box.min.z-.01},b={x:box.max.x+.01,z:box.min.z-.01},c={x:box.max.x+.01,z:box.max.z+.01},d={x:box.min.x-.01,z:box.max.z+.01};for(const p of [a,b,c,d])p.y=slope*p.x;return [{points:[a,c,b]},{points:[a,d,c]}];}};}
  const {x,z,step,columns,rows,heights}=grid;
  if(![x,z,step].every(Number.isFinite)||step<=0||!Number.isInteger(columns)||!Number.isInteger(rows)||columns<2||rows<2||columns*rows>300000||!heights||heights.length!==columns*rows||!Array.from(heights).every(Number.isFinite))throw Error('Ungültiger Gelände-Snapshot.');
  const maxX=x+(columns-1)*step,maxZ=z+(rows-1)*step;
  const at=(i,j)=>({x:x+i*step,z:z+j*step,y:heights[j*columns+i]});
  const check=(X,Z)=>{if(!Number.isFinite(X)||!Number.isFinite(Z)||X<x-1e-8||X>maxX+1e-8||Z<z-1e-8||Z>maxZ+1e-8)throw Error('Zaun liegt außerhalb des Gelände-Snapshots.');};
  const surface=box=>{check(box.min.x,box.min.z);check(box.max.x,box.max.z);const out=[];for(let j=Math.max(0,Math.floor((box.min.z-z)/step));j<=Math.min(rows-2,Math.floor((box.max.z-z)/step));j++)for(let i=Math.max(0,Math.floor((box.min.x-x)/step));i<=Math.min(columns-2,Math.floor((box.max.x-x)/step));i++){const a=at(i,j),b=at(i+1,j),c=at(i+1,j+1),d=at(i,j+1);out.push({points:[a,c,b]},{points:[a,d,c]});}return out;};
  return {grid,surface,height:(X,Z)=>{check(X,Z);const u=(X-x)/step,v=(Z-z)/step,i=Math.min(columns-2,Math.max(0,Math.floor(u))),j=Math.min(rows-2,Math.max(0,Math.floor(v))),a=u-i,b=v-j,A=at(i,j).y,B=at(i+1,j).y,C=at(i+1,j+1).y,D=at(i,j+1).y;return a>=b?A+a*(B-A)+b*(C-B):A+b*(D-A)+a*(C-D);}};
}
export function terrainContact(surface,terrain){return minimumGap(terrain.surface(bounds(surface)),surface);}
export function terrainPreset(name,slope=0){
  if(!['plane','crest','hollow','crossfall'].includes(name))throw Error('Unbekannte Geländeform.');
  const columns=161,rows=161,step=.5,x=-40,z=-40,heights=[];
  for(let j=0;j<rows;j++)for(let i=0;i<columns;i++){const X=x+i*step,Z=z+j*step,bump=.48*Math.exp(-(X*X/8+Z*Z/18));heights.push(slope*X+(name==='plane'?0:name==='crest'?bump:name==='hollow'?-bump:.12*Z+.14*Math.sin(X*.7)*Math.cos(Z*.4)));}
  return {version:1,x,z,step,columns,rows,heights};
}
