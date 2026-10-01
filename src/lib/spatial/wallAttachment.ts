import * as THREE from 'three';
import type { Shape } from '../../types';
import type { SpatialRoom } from './rooms';
import { pointInPolygonOrNear } from '../interiors/smartFurnish';
import { wallWorldFootprint } from './wallJunctions';

/** Prefer a real mitred face corner over a centreline endpoint near room elbows. */
export function interiorWallCorner(target: THREE.Vector3, walls: readonly Shape[], rooms: readonly SpatialRoom[], reach = 0.35): THREE.Vector3 | null {
  let best: THREE.Vector3 | null = null, distance = reach;
  for (const wall of walls) {
    if (wall.type !== 'wall' || wall.hidden || Math.abs(wall.position[1]-Number(wall.args[1])/2-target.y)>0.12) continue;
    for (const [x,z] of wallWorldFootprint(wall)) {
      if (!rooms.some(room => Math.abs(room.elevation-target.y)<0.3 && pointInPolygonOrNear([x,z],room.boundary,0.08))) continue;
      const p = new THREE.Vector3(x,target.y,z), d=p.distanceTo(target);
      if(d<distance) {distance=d;best=p;}
    }
  }
  return best;
}

/** Final snap refinement may change length, but may not break the selected locked axis. */
export function preserveWallAxis(point: THREE.Vector3, start: THREE.Vector3, axis: THREE.Vector3): THREE.Vector3 {
  const direction=axis.clone().setY(0).normalize();
  return start.clone().addScaledVector(direction,point.clone().sub(start).dot(direction));
}

/** Actual room/slab polygons, including concave houses, replace the broad wall AABB. */
export function interiorPlacementAllowed(point: THREE.Vector3, shapes: readonly Shape[], rooms: readonly SpatialRoom[]): boolean {
  if (rooms.some(room => Math.abs(room.elevation-point.y)<0.3 && pointInPolygonOrNear([point.x,point.z],room.boundary,0.16))) return true;
  for (const slab of shapes) {
    if (slab.hidden || !slab.tags?.includes('floor-slab')) continue;
    const height=Number(Array.isArray(slab.args) ? slab.args[1] : slab.args?.height ?? 0.2);
    if(Math.abs(slab.position[1]+height/2-point.y)>0.3) continue;
    const q=slab.quaternion ? new THREE.Quaternion(...slab.quaternion) : new THREE.Quaternion().setFromEuler(new THREE.Euler(...(slab.rotation ?? [0,0,0])));
    let polygon: [number,number][];
    if(slab.type==='poly' && Array.isArray(slab.args?.vertices)) {
      const xy=Math.abs(new THREE.Vector3(0,0,1).applyQuaternion(q).y)>0.5;
      polygon=slab.args.vertices.map(([x,v]: [number,number])=>{const p=(xy ? new THREE.Vector3(x,v,0) : new THREE.Vector3(x,0,v)).multiply(new THREE.Vector3(...(slab.scale ?? [1,1,1]))).applyQuaternion(q);return [p.x+slab.position[0],p.z+slab.position[2]];});
    } else if(Array.isArray(slab.args)) {
      const [w,,d]=slab.args;polygon=[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]].map(([x,z])=>{const p=new THREE.Vector3(x,0,z).applyQuaternion(q);return [p.x+slab.position[0],p.z+slab.position[2]];});
    } else continue;
    if(pointInPolygonOrNear([point.x,point.z],polygon,0.15)) return true;
  }
  return false;
}

/** Project onto the visible/room-facing wall side, respecting Euler and quaternion rotations.
 * Both sides of an internal partition can be interior faces; choose the side nearest the pointer. */
export function wallAttachmentPoint(wall: Shape, target: THREE.Vector3, interior: boolean, rooms: readonly SpatialRoom[]): THREE.Vector3 {
  const q = wall.quaternion ? new THREE.Quaternion(...wall.quaternion) : new THREE.Quaternion().setFromEuler(new THREE.Euler(...(wall.rotation ?? [0, 0, 0])));
  const run = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const centre = new THREE.Vector3(...wall.position);
  const along = THREE.MathUtils.clamp(target.clone().sub(centre).dot(run), -Number(wall.args[0]) / 2, Number(wall.args[0]) / 2);
  centre.addScaledVector(run, along); centre.y = target.y;
  if (!interior) return centre;
  const half = Number(wall.args[2] ?? 0.2) / 2;
  const candidates = [-1, 1].map(side => ({
    point: centre.clone().addScaledVector(normal, side * half),
    probe: centre.clone().addScaledVector(normal, side * (half + 0.12)),
  }));
  const adjacent = rooms.filter(room => room.boundaryWallIds.includes(wall.id) && Math.abs(room.elevation - target.y) < 0.3);
  const inward = candidates.filter(candidate => adjacent.some(room => pointInPolygonOrNear([candidate.probe.x, candidate.probe.z], room.boundary, 0.02)));
  return (inward.length ? inward : candidates).sort((a, b) => a.point.distanceToSquared(target) - b.point.distanceToSquared(target))[0].point;
}
