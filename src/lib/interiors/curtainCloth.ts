import * as THREE from 'three';
import { PlaneCollider, XpbdCloth, gridTopology, type ClothCollider } from '../cloth/xpbd';

export interface CurtainDimensions {
  width: number; height: number; openAmount: number; fullness: number; foldDepth: number;
}
export interface ClothWind { x: number; z: number; speed: number }
const columns = 24, rows = 28;

/** Shared static relaxation lets saved cloth bakes survive the native curtain style upgrade. */
export function relaxCurtainPositions(positions: number[] | Float32Array, width: number, height: number, strength: number) {
  const amount = THREE.MathUtils.clamp(strength, 0, 1);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i+1];
    const free = THREE.MathUtils.clamp(1 - y / height, 0, 1);
    const centre = Math.max(0, 1 - (2 * x / width)**2);
    positions[i+2] += Math.sin(x * 4.3 + y * 1.2) * 0.025 * amount * free;
    positions[i+1] = Math.max(y > 0 ? 0.003 : 0, y - height * 0.01 * amount * free * centre);
  }
}

/** Broad, irregular gathered folds with smooth indexed normals, shared by saved and live curtains. */
export function createCurtainPanels(p: CurtainDimensions): THREE.PlaneGeometry[] {
  const gap = p.width * THREE.MathUtils.clamp(p.openAmount, 0, 1) * 0.62;
  const width = Math.max(0.12, (p.width - gap) / 2);
  const folds = THREE.MathUtils.clamp(width * 2.5 * Math.sqrt(p.fullness), 1.5, 4.5);
  return [-1, 1].map(side => {
    const g = new THREE.PlaneGeometry(width, p.height, columns, rows);
    const position = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < position.count; i++) {
      const u = (i % (columns + 1)) / columns, v = Math.floor(i / (columns + 1)) / rows;
      const phase = u * Math.PI * 2 * folds + side * 0.4 + v * 0.45 * Math.sin(u * Math.PI);
      const depth = p.foldDepth * (0.7 + 0.3 * Math.cos(u * Math.PI * 2 + side));
      position.setXYZ(i, (u - 0.5) * width + side * (gap + width) / 2,
        p.height * (1 - v), Math.sin(phase) * depth + Math.sin(phase * 0.47 + v) * depth * v * 0.3);
    }
    g.computeVertexNormals();
    g.computeBoundingSphere();
    if (g.boundingSphere) g.boundingSphere.radius += p.height;
    return g;
  });
}

/**
 * Live curtain fabric on the shared XPBD solver (see lib/cloth/xpbd.ts): stretch and shear with compliance,
 * dihedral bending measured from the gathered rest folds, long-range tethers to the rod, and wind that acts
 * on the surface, so a curtain billows into the room when the air hits it face-on and ignores a breeze
 * skimming past. The heading is pinned to the rod; the glass and floor are planes. This is a thin cloth
 * surface, not a volumetric soft-body or a room airflow simulation.
 */
export class CurtainCloth {
  readonly positions: Float32Array;
  readonly rest: Float32Array;
  private readonly solver: XpbdCloth;
  private readonly colliders: ClothCollider[];
  private accumulator = 0;
  private time = 0;
  constructor(readonly geometry: THREE.PlaneGeometry) {
    this.positions = geometry.getAttribute('position').array as Float32Array;
    this.rest = this.positions.slice();
    const { extraEdges } = gridTopology(columns, rows);
    this.solver = new XpbdCloth({
      positions: this.rest,
      triangles: geometry.index!.array,
      extraEdges,
      pinned: Array.from({ length: columns + 1 }, (_, i) => i),
      settings: { density: 0.25, stretchCompliance: 4e-7, bendCompliance: 2e-3, damping: 1.4, thickness: 0, friction: 0.2 },
    });
    // The window glass behind the curtain and the floor under its hem; the rod attachments stay exact.
    this.colliders = [new PlaneCollider([0, 0.003, 0], [0, 1, 0]), new PlaneCollider([0, 0, -0.09], [0, 0, 1])];
  }
  update(delta: number, wind: ClothWind, walker?: { x: number; y: number; z: number; speed: number }) {
    const dt = 1 / 60;
    this.accumulator += Math.min(Math.max(delta, 0), 0.1);
    let moved = false;
    const solved = this.solver.positions;
    while (this.accumulator + 1e-9 >= dt) {
      moved = true;
      this.accumulator -= dt; this.time += dt;
      const gust = 0.75 + 0.25 * Math.sin(this.time * wind.speed * 1.7);
      // Artist wind strengths become air speed: z blows the curtain into the room, x skims across its face.
      const air = { velocity: [wind.x * gust * WIND_SPEED, 0, Math.sign(wind.z) * Math.abs(wind.z) * gust * WIND_SPEED] as [number, number, number], drag: 0.9, lift: 0.08 };
      this.solver.step(dt, {
        substeps: 2, colliders: this.colliders, wind: air,
        extraAcceleration: (i, out) => {
          // Gusty turbulence along the cloth and the wake of someone walking past.
          const x = solved[i * 3]!, y = solved[i * 3 + 1]!, z = solved[i * 3 + 2]!;
          const ripple = Math.sin(x * 3.2 + y * 2.1 - this.time * wind.speed * 2);
          out[2]! += wind.z * 0.5 * gust * ripple * 0.22;
          if (walker && walker.speed > 0) out[2]! += walker.speed * Math.exp(-((x - walker.x) ** 2 + (y - walker.y + 0.7) ** 2 + (z - walker.z) ** 2) / 0.8) * 9;
        },
      });
    }
    if (moved) {
      for (let i = 0; i < solved.length; i++) this.positions[i] = solved[i]!;
      geometryUpdated(this.geometry);
    }
  }
}

/** Air speed (m/s) per unit of artist wind strength. */
const WIND_SPEED = 0.55;

function geometryUpdated(geometry: THREE.BufferGeometry) {
  geometry.getAttribute('position').needsUpdate = true;
  geometry.computeVertexNormals();
}
