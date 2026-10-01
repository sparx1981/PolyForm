import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { interiorPlacementAllowed, interiorWallCorner, preserveWallAxis, wallAttachmentPoint } from './wallAttachment';
import { detectRooms } from './rooms';
import type { Shape } from '../../types';
const wall = (id: string, x: number, z: number, yaw = 0): Shape => ({ id, type: 'wall', position: [x, 1.4, z], rotation: [0, yaw, 0], args: [6, 2.8, 0.2], color: '#fff' });
describe('interior wall attachments', () => {
  it('accepts an L-house elbow while rejecting the exterior notch and other floors',()=>{
    const slab={id:'l-floor',type:'poly',position:[0,-0.1,0],rotation:[Math.PI/2,0,0],tags:['floor-slab'],color:'#fff',args:{vertices:[[0,0],[6,0],[6,2],[2,2],[2,6],[0,6]],height:0.2}} as Shape;
    expect(interiorPlacementAllowed(new THREE.Vector3(2,0,2),[slab],[])).toBe(true);
    expect(interiorPlacementAllowed(new THREE.Vector3(4,0,4),[slab],[])).toBe(false);
    expect(interiorPlacementAllowed(new THREE.Vector3(1,2.8,1),[slab],[])).toBe(false);
  });
  it('retains the chosen locked axis after a wall-face snap', () => {
    const p=preserveWallAxis(new THREE.Vector3(3,0,0.3),new THREE.Vector3(),new THREE.Vector3(1,0,0));
    expect(p.toArray()).toEqual([3,0,0]);
    const diagonal=preserveWallAxis(new THREE.Vector3(3,0,1),new THREE.Vector3(),new THREE.Vector3(1,0,1));
    expect(diagonal.x).toBeCloseTo(diagonal.z);
  });
  it('snaps to the actual inward footprint corner at an elbow',()=>{
    const north=wall('north',0,-3),shapes=[north,wall('south',0,3),wall('west',-3,0,Math.PI/2),wall('east',3,0,Math.PI/2)];
    north.wallMiterFootprint=[[-3.1,-0.1],[-2.9,0.1],[2.9,0.1],[3.1,-0.1]];
    const p=interiorWallCorner(new THREE.Vector3(2.95,0,-2.95),shapes,detectRooms(shapes,{cell:0.1}));
    expect(p).not.toBeNull();expect(p!.distanceTo(new THREE.Vector3(2.95,0,-2.95))).toBeLessThan(0.2);
  });
  it('finds the inward face even when wall directions are reversed', () => {
    for (const reversed of [false, true]) {
      const north = wall('north', 0, -3, reversed ? Math.PI : 0);
      const shapes = [north, wall('south', 0, 3), wall('west', -3, 0, Math.PI / 2), wall('east', 3, 0, Math.PI / 2)];
      const room = detectRooms(shapes, { cell: 0.1 });
      expect(wallAttachmentPoint(north, new THREE.Vector3(1, 0, -3), true, room).z).toBeCloseTo(-2.9);
    }
  });
  it('uses Euler rotations and clamps attachment positions to the wall length', () => {
    const east = wall('east', 3, 0, Math.PI / 2);
    const shapes = [wall('north', 0, -3), wall('south', 0, 3), wall('west', -3, 0, Math.PI / 2), east];
    const p = wallAttachmentPoint(east, new THREE.Vector3(2.8, 0, 2), true, detectRooms(shapes, { cell: 0.1 }));
    expect(p.x).toBeCloseTo(2.9); expect(p.z).toBeCloseTo(2);
    expect(wallAttachmentPoint(east, new THREE.Vector3(3, 0, 20), false, []).z).toBeCloseTo(3);
  });
});
