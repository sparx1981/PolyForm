import {meshMetrics,bounds,surfaceCrossings} from './anschluss-flaechen.js';
import {terrainSampler,terrainContact} from './zaun-terrain.js';
export const dist=(a,b)=>Math.hypot(b.x-a.x,b.z-a.z);
export const mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});
export function frame(a,b){const l=dist(a,b);if(l<1e-7)throw Error('Bauteil ohne Länge');return {t:{x:(b.x-a.x)/l,z:(b.z-a.z)/l},n:{x:-(b.z-a.z)/l,z:(b.x-a.x)/l},l};}
export function writer(){const surface=[];const tri=(a,b,c,uv=[[0,0],[1,0],[0,1]])=>surface.push({points:[a,b,c],uv});return {surface,tri,quad(a,b,c,d,uv=[[0,0],[0,1],[1,1],[1,0]]){tri(a,b,c,uv.slice(0,3));tri(a,c,d,[uv[0],uv[2],uv[3]]);},finish(){if(meshMetrics(surface).volume<0)for(const t of surface){t.points.reverse();t.uv.reverse();}return surface;}};}
// One closed, profile-owned member. Stations own the actual shoulders and tenons.
export function loft(a,b,stations,baseY=0){const f=frame(a,b),w=writer(),rings=stations.map(s=>s.profile.map(([u,v])=>({x:a.x+f.t.x*s.s+f.n.x*u,z:a.z+f.t.z*s.s+f.n.z*u,y:baseY+v+(s.y||0)})));
  for(let j=0;j<rings.length-1;j++)for(let i=0;i<rings[j].length;i++){const k=(i+1)%rings[j].length;w.quad(rings[j][i],rings[j][k],rings[j+1][k],rings[j+1][i],[[i*.035,stations[j].s],[(i+1)*.035,stations[j].s],[(i+1)*.035,stations[j+1].s],[i*.035,stations[j+1].s]]);}
  for(const j of [0,rings.length-1]){const r=rings[j],c=r.reduce((v,p)=>({x:v.x+p.x/r.length,y:v.y+p.y/r.length,z:v.z+p.z/r.length}),{x:0,y:0,z:0});for(let i=0;i<r.length;i++){j===0?w.tri(c,r[(i+1)%r.length],r[i]):w.tri(c,r[i],r[(i+1)%r.length]);w.surface.at(-1).endGrain=true;}}
  return w.finish();
}
export function box(a,b,width,bottom,top){const p=[[-width/2,bottom],[width/2,bottom],[width/2,top],[-width/2,top]];return loft(a,b,[{s:0,profile:p},{s:dist(a,b),profile:p}]);}
export function pole(c,r,bottom,top,seed=0){const w=writer(),p=Array.from({length:8},(_,i)=>{const a=i*Math.PI/4+seed*.17;return{x:c.x+Math.cos(a)*r,z:c.z+Math.sin(a)*r};});for(let i=0;i<8;i++){const a=p[i],b=p[(i+1)%8];w.quad({...a,y:bottom},{...b,y:bottom},{...b,y:top},{...a,y:top});w.tri({...c,y:top},{...a,y:top},{...b,y:top});w.tri({...c,y:bottom},{...b,y:bottom},{...a,y:bottom});}return w.finish();}
// Boundary of a cell complex: internal faces are not emitted. Holes go through
// the post's longitudinal faces, leaving continuous cheeks and bearing ledges.
export function mortisePost(c,t,width,depth,bottom,top,slots){const n={x:-t.z,z:t.x},ys=[...new Set([bottom,top,...slots.flatMap(s=>[s.y,s.y+s.h])])].sort((a,b)=>a-b),zs=[...new Set([-depth/2,depth/2,...slots.flatMap(s=>[-s.w/2,s.w/2])])].sort((a,b)=>a-b),w=writer();
  const solid=(i,j)=>i>=0&&i<ys.length-1&&j>=0&&j<zs.length-1&&!slots.some(s=>(ys[i]+ys[i+1])/2>s.y&&(ys[i]+ys[i+1])/2<s.y+s.h&&Math.abs((zs[j]+zs[j+1])/2)<s.w/2);
  const p=(x,y,z)=>({x:c.x+t.x*x+n.x*z,y,z:c.z+t.z*x+n.z*z});
  for(let i=0;i<ys.length-1;i++)for(let j=0;j<zs.length-1;j++)if(solid(i,j)){const y=ys[i],Y=ys[i+1],z=zs[j],Z=zs[j+1],x=-width/2,X=width/2;
    w.quad(p(x,y,z),p(x,Y,z),p(x,Y,Z),p(x,y,Z));w.quad(p(X,y,Z),p(X,Y,Z),p(X,Y,z),p(X,y,z));
    if(!solid(i-1,j))w.quad(p(x,y,Z),p(X,y,Z),p(X,y,z),p(x,y,z));
    if(!solid(i+1,j))w.quad(p(x,Y,z),p(X,Y,z),p(X,Y,Z),p(x,Y,Z));
    if(!solid(i,j-1))w.quad(p(x,y,z),p(X,y,z),p(X,Y,z),p(x,Y,z));
    if(!solid(i,j+1))w.quad(p(x,Y,Z),p(X,Y,Z),p(X,y,Z),p(x,y,Z));
  }return w.finish();
}
export function transformSurface(surface,fn){return surface.map(t=>({...t,points:t.points.map(fn)}));}
export function translateY(surface,dy){return transformSurface(surface,p=>({...p,y:p.y+dy}));}
export function slopeSurface(surface,slope){return transformSurface(surface,p=>({...p,y:p.y+slope*p.x}));}
export function touchDistance(a,b){let best={gap:Infinity};const sub=(p,q)=>({x:p.x-q.x,y:p.y-q.y,z:p.z-q.z}),dot=(p,q)=>p.x*q.x+p.y*q.y+p.z*q.z;
  for(const [A,B] of [[a,b],[b,a]])for(const t of A)for(const p of t.points)for(const tri of B){const [v,w,u]=tri.points,e=sub(w,v),f=sub(u,v),n={x:e.y*f.z-e.z*f.y,y:e.z*f.x-e.x*f.z,z:e.x*f.y-e.y*f.x},nn=dot(n,n);if(nn<1e-16)continue;const d=dot(n,sub(p,v))/nn,q={x:p.x-n.x*d,y:p.y-n.y*d,z:p.z-n.z*d},g=sub(q,v),ee=dot(e,e),ff=dot(f,f),ef=dot(e,f),den=ee*ff-ef*ef,s=(ff*dot(g,e)-ef*dot(g,f))/den,r=(ee*dot(g,f)-ef*dot(g,e))/den;
    let gap;if(s>=0&&r>=0&&s+r<=1)gap=Math.abs(d)*Math.sqrt(nn);else{gap=Infinity;for(const [v,w] of [[tri.points[0],tri.points[1]],[tri.points[1],tri.points[2]],[tri.points[2],tri.points[0]]]){const e=sub(w,v),s=Math.max(0,Math.min(1,dot(sub(p,v),e)/dot(e,e)));gap=Math.min(gap,Math.hypot(p.x-v.x-s*e.x,p.y-v.y-s*e.y,p.z-v.z-s*e.z));}}
    if(gap<best.gap)best={gap,x:p.x,z:p.z,lowerY:p.y};if(gap<1e-9)return best;
  }
  const clamp=x=>Math.max(0,Math.min(1,x));
  for(const A of a)for(const B of b)for(let i=0;i<3;i++)for(let j=0;j<3;j++){const p=A.points[i],q=A.points[(i+1)%3],r=B.points[j],s=B.points[(j+1)%3],u=sub(q,p),v=sub(s,r),w=sub(p,r),aa=dot(u,u),bb=dot(u,v),cc=dot(v,v),dd=dot(u,w),ee=dot(v,w),den=aa*cc-bb*bb;let t=den<1e-16?0:clamp((bb*ee-cc*dd)/den),k=cc<1e-16?0:clamp((bb*t+ee)/cc);t=aa<1e-16?0:clamp((bb*k-dd)/aa);const gap=Math.hypot(w.x+t*u.x-k*v.x,w.y+t*u.y-k*v.y,w.z+t*u.z-k*v.z);if(gap<best.gap)best={gap,x:p.x+t*u.x,z:p.z+t*u.z,lowerY:p.y+t*u.y};if(gap<1e-9)return best;}
  return best;
}
export function notchedStile(a,b,width,notchLength,notchTop,top){const f=frame(a,b),xs=[0,notchLength,f.l],ys=[-.6,notchTop,top],w=writer(),p=(x,y,z)=>({x:a.x+f.t.x*x+f.n.x*z,y,z:a.z+f.t.z*x+f.n.z*z}),solid=(i,j)=>i>=0&&i<2&&j>=0&&j<2&&!(i===0&&j===0);
  for(let i=0;i<2;i++)for(let j=0;j<2;j++)if(solid(i,j)){const x=xs[i],X=xs[i+1],y=ys[j],Y=ys[j+1],z=-width/2,Z=width/2;w.quad(p(x,y,z),p(X,y,z),p(X,Y,z),p(x,Y,z));w.quad(p(x,Y,Z),p(X,Y,Z),p(X,y,Z),p(x,y,Z));if(!solid(i-1,j))w.quad(p(x,y,Z),p(x,y,z),p(x,Y,z),p(x,Y,Z));if(!solid(i+1,j))w.quad(p(X,y,z),p(X,y,Z),p(X,Y,Z),p(X,Y,z));if(!solid(i,j-1))w.quad(p(x,y,Z),p(X,y,Z),p(X,y,z),p(x,y,z));if(!solid(i,j+1))w.quad(p(x,Y,z),p(X,Y,z),p(X,Y,Z),p(x,Y,Z));}return w.finish();
}
export function auditParts(parts,contacts=[],slope=0){const collisions=[],badMeshes=[],groundViolations=[],terrain=terrainSampler(typeof slope==='object'?slope:{slope});let minimumGroundGapM=Infinity;
  for(const p of parts){const m=meshMetrics(p.surface);if(m.volume<=0||m.degenerate||m.badEdges)badMeshes.push({id:p.id,...m});if(!p.buried&&p.kind!=='stone'&&p.kind!=='stake'){const gap=terrainContact(p.surface,terrain).gap;minimumGroundGapM=Math.min(minimumGroundGapM,gap);if(gap<-.000001)groundViolations.push(p.id);}}
  // Every pair, without role exclusions. Touch is allowed, volume crossing isn't.
  const spatial=parts.map(part=>({part,box:bounds(part.surface)})).sort((a,b)=>a.box.min.x-b.box.min.x);
  for(let i=0;i<spatial.length;i++)for(let j=i+1;j<spatial.length;j++){const {part:a,box:A}=spatial[i],{part:b,box:B}=spatial[j];if(B.min.x>=A.max.x-1e-6)break;if(['y','z'].some(k=>A.max[k]<=B.min[k]+1e-6||B.max[k]<=A.min[k]+1e-6))continue;if(surfaceCrossings(a.surface,b.surface))collisions.push({a:a.id,b:b.id});}
  const invalidContacts=contacts.filter(c=>!Number.isFinite(c.gap)||Math.abs(c.gap)>.0002);
  return {valid:!collisions.length&&!badMeshes.length&&!groundViolations.length&&!invalidContacts.length,collisions,badMeshes,groundViolations,invalidContacts,constructionErrors:[],minimumGroundGapM,contactCount:contacts.length,maxGap:Math.max(0,...contacts.map(c=>c.gap)),triangles:parts.reduce((n,p)=>n+p.surface.length,0)};
}
