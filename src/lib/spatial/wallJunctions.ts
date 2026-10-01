import * as THREE from 'three';
import type { Shape } from '../../types';

type Point = [number, number];
type Footprint = [Point, Point, Point, Point];
type End = 'start' | 'end';
const qOf = (s: Shape) => s.quaternion ? new THREE.Quaternion(...s.quaternion) : new THREE.Quaternion().setFromEuler(new THREE.Euler(...(s.rotation ?? [0,0,0])));
export function wallWorldFootprint(s: Shape): Footprint {
  const [length,,thickness = 0.2] = s.args as number[];
  const local = s.wallMiterFootprint ?? [[-length/2,-thickness/2],[-length/2,thickness/2],[length/2,thickness/2],[length/2,-thickness/2]];
  const q = qOf(s);
  return local.map(([x,z]) => { const p = new THREE.Vector3(x,0,z).applyQuaternion(q); return [p.x+s.position[0],p.z+s.position[2]]; }) as Footprint;
}
const cross = (a: Point,b: Point) => a[0]*b[1]-a[1]*b[0];
const sub = (a: Point,b: Point): Point => [a[0]-b[0],a[1]-b[1]];
function intersection(a: Point,u: Point,b: Point,v: Point): {point: Point; t: number; other: number} | null {
  const den = cross(u,v); if (Math.abs(den)<1e-7) return null;
  const d = sub(b,a), t = cross(d,v)/den;
  return {point:[a[0]+t*u[0],a[1]+t*u[1]],t,other:cross(d,u)/den};
}
function contains(p: Point, polygon: Point[], tolerance = 1e-5): boolean {
  let inside = false;
  for (let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const a=polygon[j],b=polygon[i],ab=sub(b,a),ap=sub(p,a);
    const t=Math.max(0,Math.min(1,(ap[0]*ab[0]+ap[1]*ab[1])/(ab[0]**2+ab[1]**2 || 1)));
    if (Math.hypot(ap[0]-t*ab[0],ap[1]-t*ab[1])<=tolerance) return true;
    if ((a[1]>p[1]) !== (b[1]>p[1]) && p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]) inside=!inside;
  }
  return inside;
}
const sameLevel = (a: Shape,b: Shape) => Math.abs((a.position[1]-Number(a.args[1])/2)-(b.position[1]-Number(b.args[1])/2))<0.06;
const capIndices = (end: End) => end === 'start' ? [0,1] : [3,2];
const centre = (fp: Footprint,end: End): Point => { const [a,b]=capIndices(end);return [(fp[a][0]+fp[b][0])/2,(fp[a][1]+fp[b][1])/2]; };
const distance = (a: Point,b: Point) => Math.hypot(a[0]-b[0],a[1]-b[1]);
const run = (s: Shape): Point => { const d=new THREE.Vector3(1,0,0).applyQuaternion(qOf(s));return [d.x,d.z]; };

/** Resolve open partition corners and abutments too, without altering stored walls,
 * openings, closed exterior mitres or the editable wall dimensions. */
export function resolveWallJunctions(shapes: Shape[]): Map<string, Shape> {
  const walls=shapes.filter(s=>s.type==='wall' && !s.hidden && Array.isArray(s.args));
  const partition=(s: Shape)=>s.tags?.includes('wall-interior') && !s.wallMiterFootprint;
  const footprints=new Map(walls.map(s=>[s.id,wallWorldFootprint(s)]));
  const joined=new Set<string>();
  for(let i=0;i<walls.length;i++) for(let j=i+1;j<walls.length;j++) {
    const a=walls[i],b=walls[j];
    if(!partition(a)||!partition(b)||!sameLevel(a,b)) continue;
    const ua=run(a),ub=run(b);
    if(Math.abs(cross(ua,ub))<0.15) continue;
    const fa=footprints.get(a.id)!,fb=footprints.get(b.id)!;
    const reach=Math.max(Number(a.args[2]),Number(b.args[2]))*1.6+0.02;
    for(const ea of ['start','end'] as End[]) for(const eb of ['start','end'] as End[]) {
      if(joined.has(`${a.id}:${ea}`)||joined.has(`${b.id}:${eb}`)||distance(centre(fa,ea),centre(fb,eb))>reach) continue;
      const ai=capIndices(ea),bi=capIndices(eb);
      // Faces must correspond along a continuous path: reverse when both ends are alike.
      if(ea===eb) bi.reverse();
      const points=ai.map((index,k)=>intersection(fa[index],ua,fb[bi[k]],ub)?.point);
      if(points.some(p=>!p || distance(p,centre(fa,ea))>reach*3)) continue;
      ai.forEach((index,k)=>{fa[index]=points[k]!;fb[bi[k]]=points[k]!;});
      joined.add(`${a.id}:${ea}`);joined.add(`${b.id}:${eb}`);
    }
  }
  // An abutting partition ends at the receiving wall's visible face, rather than
  // protruding to its centreline or through the far face with an extended box.
  for(const wall of walls.filter(partition)) {
    const fp=footprints.get(wall.id)!,u=run(wall);
    const reach=Math.max(0.3,Number(wall.args[2])*1.6);
    for(const end of ['start','end'] as End[]) {
      if(joined.has(`${wall.id}:${end}`)) continue;
      const indices=capIndices(end),at=centre(fp,end);
      let best: {points: Point[]; score: number} | undefined;
      for(const host of walls) {
        if(host.id===wall.id || !sameLevel(wall,host) || Math.abs(cross(u,run(host)))<0.1) continue;
        const polygon=footprints.get(host.id)!;
        for(let i=0;i<4;i++) {
          const a=polygon[i],v=sub(polygon[(i+1)%4],a);
          const hits=indices.map(index=>intersection(fp[index],u,a,v));
          if(hits.some(hit=>!hit || hit.other< -0.001 || hit.other>1.001 || Math.abs(hit.t)>reach)) continue;
          const points=hits.map(h=>h!.point),mid: Point=[(points[0][0]+points[1][0])/2,(points[0][1]+points[1][1])/2];
          if(distance(at,mid)>reach) continue;
          // Prefer the entry face nearest the partition body if both faces qualify.
          const towardsBody=(end==='end' ? -1 : 1)*(hits[0]!.t+hits[1]!.t)/2;
          const score=distance(at,mid)-towardsBody*2;
          if(!best||score<best.score) best={points,score};
        }
      }
      if(best) indices.forEach((index,k)=>{fp[index]=best!.points[k];});
    }
  }
  return new Map(walls.map(s=>{
    if(!partition(s)) return [s.id,s];
    const q=qOf(s).invert();
    const fp=footprints.get(s.id)!.map(([x,z])=>{const p=new THREE.Vector3(x-s.position[0],0,z-s.position[2]).applyQuaternion(q);return [p.x,p.z] as Point;}) as Footprint;
    return [s.id,{...s,wallMiterFootprint:fp}];
  }));
}

/** Split edge lines at neighbouring wall boundaries and omit buried pieces.
 * True exposed corners and opening outlines remain visible. */
export function exposedWallEdges(positions: ArrayLike<number>,wall: Shape,neighbours: Shape[]): number[] {
  const q=qOf(wall),inverse=q.clone().invert(),offset=new THREE.Vector3(...wall.position),out:number[]=[];
  const hosts=neighbours.filter(s=>s.id!==wall.id && s.type==='wall' && !s.hidden).map(s=>({s,fp:wallWorldFootprint(s)}));
  for(let i=0;i+5<positions.length;i+=6) {
    const a=new THREE.Vector3(positions[i],positions[i+1],positions[i+2]).applyQuaternion(q).add(offset);
    const b=new THREE.Vector3(positions[i+3],positions[i+4],positions[i+5]).applyQuaternion(q).add(offset);
    const delta=b.clone().sub(a),cuts=[0,1];
    for(const {s,fp} of hosts) {
      if(Math.max(a.y,b.y)<s.position[1]-Number(s.args[1])/2-1e-5 || Math.min(a.y,b.y)>s.position[1]+Number(s.args[1])/2+1e-5) continue;
      for(let k=0;k<4;k++) {const hit=intersection([a.x,a.z],[delta.x,delta.z],fp[k],sub(fp[(k+1)%4],fp[k]));if(hit && hit.t>0 && hit.t<1 && hit.other>=-1e-5 && hit.other<=1+1e-5) cuts.push(hit.t);}
    }
    cuts.sort((x,y)=>x-y);
    for(let k=1;k<cuts.length;k++) {
      const lo=cuts[k-1],hi=cuts[k];if(hi-lo<1e-7) continue;
      const mid=a.clone().addScaledVector(delta,(lo+hi)/2);
      if(hosts.some(({s,fp})=>mid.y>=s.position[1]-Number(s.args[1])/2-1e-5 && mid.y<=s.position[1]+Number(s.args[1])/2+1e-5 && contains([mid.x,mid.z],fp))) continue;
      for(const t of [lo,hi]) { const p=a.clone().addScaledVector(delta,t).sub(offset).applyQuaternion(inverse);out.push(p.x,p.y,p.z); }
    }
  }
  return out;
}

