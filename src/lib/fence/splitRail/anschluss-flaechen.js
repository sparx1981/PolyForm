// Contact of the emitted, piecewise planar surfaces. All coordinates in metres.
// Intersect projected triangles, not nominal capsules. A linear height difference
// attains its extrema at a vertex of their intersection polygon.
const EPS = 1e-10;
const cross = (a,b,c) => (b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
const area = t => cross(...t.points);
function height(tri,p) {
  const [a,b,c] = tri.points, d=cross(a,b,c);
  const u=cross(a,p,c)/d, v=cross(a,b,p)/d;
  return a.y+u*(b.y-a.y)+v*(c.y-a.y);
}
function intersection(a,b) {
  let poly=a.map(p=>({x:p.x,z:p.z}));
  const sign=Math.sign(cross(...b));
  for(let i=0;i<3 && poly.length;i++) {
    const from=b[i],to=b[(i+1)%3], next=[];
    for(let j=0;j<poly.length;j++) {
      const p=poly[j],q=poly[(j+1)%poly.length];
      const dp=sign*cross(from,to,p),dq=sign*cross(from,to,q);
      if(dp>=-EPS) next.push(p);
      if((dp>EPS&&dq<-EPS)||(dp<-EPS&&dq>EPS)) {
        const t=dp/(dp-dq); next.push({x:p.x+(q.x-p.x)*t,z:p.z+(q.z-p.z)*t});
      }
    }
    poly=next;
  }
  return poly;
}
const boundCache=new WeakMap(),faceCache=new WeakMap();
export function bounds(surface) {
  if(boundCache.has(surface)) return boundCache.get(surface);
  const min={x:Infinity,y:Infinity,z:Infinity},max={x:-Infinity,y:-Infinity,z:-Infinity};
  for(const t of surface) for(const p of t.points) for(const k of ['x','y','z']) {min[k]=Math.min(min[k],p[k]);max[k]=Math.max(max[k],p[k]);}
  const result={min,max};boundCache.set(surface,result);return result;
}
function faceBounds(t) {if(!faceCache.has(t))faceCache.set(t,bounds([t]));return faceCache.get(t);}
function overlapsXZ(a,b) {return a.min.x<=b.max.x && b.min.x<=a.max.x && a.min.z<=b.max.z && b.min.z<=a.max.z;}
export function contactSamples(lower,upper) {
  if(!overlapsXZ(bounds(lower),bounds(upper))) return [];
  const result=[];
  for(const a of lower) {
    if(area(a)>=-EPS) continue; // outward top normal: ny = -areaXZ
    const ba=faceBounds(a);
    for(const b of upper) {
      if(area(b)<=EPS || !overlapsXZ(ba,faceBounds(b))) continue;
      for(const p of intersection(a.points,b.points)) result.push({...p,gap:height(b,p)-height(a,p),lowerY:height(a,p)});
    }
  }
  return result;
}
export function minimumGap(lower,upper) {
  const samples=contactSamples(lower,upper);
  return samples.reduce((best,s)=>s.gap<best.gap?s:best,{gap:Infinity});
}
export function topAt(surface,p) {
  let y=-Infinity;
  for(const tri of surface) {
    const d=area(tri);if(d>=-EPS)continue;
    if(tri.points.every((a,i)=>Math.sign(d)*cross(a,tri.points[(i+1)%3],p)>=-1e-9)) y=Math.max(y,height(tri,p));
  }
  return y;
}
export function shear(surface,a,b,y0,y1) {
  const dx=b.x-a.x,dz=b.z-a.z,d=dx*dx+dz*dz;
  return surface.map(tri=>({...tri,points:tri.points.map(p=>{
    const t=((p.x-a.x)*dx+(p.z-a.z)*dz)/d;
    return {...p,y:p.y+(1-t)*y0+t*y1};
  })}));
}
export function settle(surface,a,b,supports) {
  const dx=b.x-a.x,dz=b.z-a.z,d=dx*dx+dz*dz;
  const constraints=supports.map(s=>contactSamples(s.surface,surface).map(p=>({
    ...p,t:((p.x-a.x)*dx+(p.z-a.z)*dz)/d,required:-p.gap+0.00005
  })));
  if(constraints.some(c=>!c.length)) throw new Error('Auflagerfläche fehlt');
  let y0=0,y1=0;
  if(supports.length===1) y0=y1=Math.max(...constraints[0].map(p=>p.required));
  else for(let i=0;i<30;i++) {
    const before=y0+y1;
    y0=Math.max(...constraints[0].map(p=>(p.required-p.t*y1)/(1-p.t)));
    y1=Math.max(...constraints[1].map(p=>(p.required-(1-p.t)*y0)/p.t));
    if(Math.abs(y0+y1-before)<1e-10) break;
  }
  const placed=shear(surface,a,b,y0,y1);
  return {surface:placed,y0,y1,contacts:supports.map(s=>({support:s.id,...minimumGap(s.surface,placed)}))};
}

// Independent mesh-side audit: signed volume AND each nondegenerate face.
// Global positive volume alone does not prove that all faces face outward.
export function meshMetrics(surface) {
  let volume=0,degenerate=0;
  const edges=new Map(),key=p=>[p.x,p.y,p.z].map(v=>Math.round(v*1e8)).join(',');
  for(const {points:[a,b,c]} of surface) {
    const ux=b.x-a.x,uy=b.y-a.y,uz=b.z-a.z,vx=c.x-a.x,vy=c.y-a.y,vz=c.z-a.z;
    if(Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)<1e-12) degenerate++;
    volume+=(a.x*(b.y*c.z-b.z*c.y)-a.y*(b.x*c.z-b.z*c.x)+a.z*(b.x*c.y-b.y*c.x))/6;
    for(const [p,q] of [[a,b],[b,c],[c,a]]) {
      const u=key(p),v=key(q),k=u<v?u+'|'+v:v+'|'+u;
      const e=edges.get(k)||{count:0,balance:0};e.count++;e.balance+=u<v?1:-1;edges.set(k,e);
    }
  }
  const badEdges=[...edges.values()].filter(e=>e.count!==2||e.balance!==0).length;
  return {volume,degenerate,badEdges,triangles:surface.length};
}

const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const cross3=(a,b)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
// Surfaces are immutable compiler outputs. A changed surface gets a new array;
// caching only derived arithmetic never changes the collision tolerances.
const geometryCache=new WeakMap(),rayDirection={x:.932,y:.271,z:.238};
function compiledFaces(surface){
  if(geometryCache.has(surface))return geometryCache.get(surface);
  const faces=surface.map(tri=>{const [a,b,c]=tri.points,e1=sub(b,a),e2=sub(c,a),n=cross3(e1,e2),norm=Math.hypot(n.x,n.y,n.z),aa=dot(e1,e1),ab=dot(e1,e2),bb=dot(e2,e2),h=cross3(rayDirection,e2);return {tri,a,b,c,e1,e2,n,norm,aa,ab,bb,den:aa*bb-ab*ab,h,det:dot(e1,h),box:faceBounds(tri),inset:norm<1e-12?null:{x:(a.x+b.x+c.x)/3-n.x/norm*2e-6,y:(a.y+b.y+c.y)/3-n.y/norm*2e-6,z:(a.z+b.z+c.z)/3-n.z/norm*2e-6}};});
  geometryCache.set(surface,faces);return faces;
}
function overlap3(a,b){return a.max.x>=b.min.x&&b.max.x>=a.min.x&&a.max.y>=b.min.y&&b.max.y>=a.min.y&&a.max.z>=b.min.z&&b.max.z>=a.min.z;}
function segmentCrossesFace(p,q,f){
  if(f.norm<1e-12)return false;
  const d0=dot(f.n,sub(p,f.a))/f.norm,d1=dot(f.n,sub(q,f.a))/f.norm;
  if(!((d0>1e-6&&d1<-1e-6)||(d0<-1e-6&&d1>1e-6)))return false;
  const t=d0/(d0-d1),v={x:p.x+t*(q.x-p.x)-f.a.x,y:p.y+t*(q.y-p.y)-f.a.y,z:p.z+t*(q.z-p.z)-f.a.z},ve1=dot(v,f.e1),ve2=dot(v,f.e2),u=(f.bb*ve1-f.ab*ve2)/f.den,w=(f.aa*ve2-f.ab*ve1)/f.den;
  return u>1e-9&&w>1e-9&&u+w<1-1e-9;
}
export function insideSolid(p,surface){const b=bounds(surface);if(['x','y','z'].some(k=>p[k]<=b.min[k]+1e-7||p[k]>=b.max[k]-1e-7))return false;
  const dir=rayDirection,hits=[];
  for(const f of compiledFaces(surface)){const {a,e1,e2,h,det}=f;if(Math.abs(det)<1e-12)continue;const s=sub(p,a),u=dot(s,h)/det;if(u<-1e-9||u>1+1e-9)continue;const q=cross3(s,e1),v=dot(dir,q)/det;if(v<-1e-9||u+v>1+1e-9)continue;const t=dot(e2,q)/det;if(Math.abs(t)<1e-7)return false;if(t>0&&!hits.some(x=>Math.abs(x-t)<1e-7))hits.push(t);}
  return hits.length%2===1;
}
export function surfaceCrossings(a,b) {
  const ba=bounds(a),bb=bounds(b);
  if(!overlap3(ba,bb))return false;
  const A=compiledFaces(a),B=compiledFaces(b),candidates=B.filter(f=>overlap3(f.box,ba));
  for(const fa of A){if(!overlap3(fa.box,bb))continue;for(const fb of candidates) {
    if(!overlap3(fa.box,fb.box))continue;
    for(let i=0;i<3;i++) if(segmentCrossesFace(fa.tri.points[i],fa.tri.points[(i+1)%3],fb)||segmentCrossesFace(fb.tri.points[i],fb.tri.points[(i+1)%3],fa))return true;
  }
  }
  // Covers containment and coplanar/aligned overlap, which edge crossing alone
  // cannot prove. Samples are just inside each outward face, not on its boundary.
  for(const [from,to] of [[A,b],[B,a]])for(const face of from){if(face.inset&&insideSolid(face.inset,to))return true;}
  return false;
}
