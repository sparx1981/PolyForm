import * as THREE from 'three';

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

/** Position-based fabric: stretch/shear constraints, weak bending, pinned heading and free hem.
 * This is a thin cloth surface, not a volumetric soft-body or a room airflow simulation. */
export class CurtainCloth {
  readonly positions: Float32Array;
  readonly rest: Float32Array;
  private previous: Float32Array;
  private edges: { a: number; b: number; length: number; stiffness: number }[] = [];
  private accumulator = 0;
  private time = 0;
  constructor(readonly geometry: THREE.PlaneGeometry) {
    this.positions = geometry.getAttribute('position').array as Float32Array;
    this.rest = this.positions.slice();
    this.previous = this.rest.slice();
    const edge = (a: number, b: number, stiffness: number) => {
      const ia = a * 3, ib = b * 3;
      this.edges.push({ a, b, stiffness, length: Math.hypot(this.rest[ia] - this.rest[ib], this.rest[ia+1] - this.rest[ib+1], this.rest[ia+2] - this.rest[ib+2]) });
    };
    for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) {
      const a = y * (columns + 1) + x;
      if (x < columns) edge(a, a + 1, 1);
      if (y < rows) edge(a, a + columns + 1, 1);
      if (x < columns && y < rows) { edge(a, a + columns + 2, 0.7); edge(a + 1, a + columns + 1, 0.7); }
      if (x < columns - 1) edge(a, a + 2, 0.025);
      if (y < rows - 1) edge(a, a + 2 * (columns + 1), 0.025);
    }
  }
  update(delta: number, wind: ClothWind, walker?: { x: number; y: number; z: number; speed: number }) {
    const dt = 1 / 60;
    this.accumulator += Math.min(Math.max(delta, 0), 0.1);
    let moved = false;
    while (this.accumulator + 1e-9 >= dt) {
      moved = true;
      this.accumulator -= dt; this.time += dt;
      const gust = 0.75 + 0.25 * Math.sin(this.time * wind.speed * 1.7);
      const damping = Math.exp(-2.8 * dt);
      for (let n = columns + 1; n < this.positions.length / 3; n++) {
        const i = n * 3, x = this.positions[i], y = this.positions[i+1], z = this.positions[i+2];
        const ripple = 1 + 0.22 * Math.sin(x * 3.2 + y * 2.1 - this.time * wind.speed * 2);
        const wake = walker && walker.speed > 0 ? walker.speed * Math.exp(-((x - walker.x)**2 + (y - walker.y + 0.7)**2 + (z - walker.z)**2) / 0.8) : 0;
        const forceX = wind.x * gust * ripple * 0.65;
        const forceZ = wind.z * Math.abs(wind.z) * gust * ripple * 0.7 + wake * 9;
        for (let axis = 0; axis < 3; axis++) {
          const current = this.positions[i+axis];
          const force = axis === 0 ? forceX : axis === 1 ? -9.81 : forceZ;
          this.positions[i+axis] += (current - this.previous[i+axis]) * damping + force * dt * dt;
          this.previous[i+axis] = current;
        }
      }
      for (let iteration = 0; iteration < 5; iteration++) {
        for (const e of this.edges) {
          const a = e.a * 3, b = e.b * 3;
          const wa = e.a > columns ? 1 : 0, wb = e.b > columns ? 1 : 0;
          if (!wa && !wb) continue;
          const dx = this.positions[b] - this.positions[a], dy = this.positions[b+1] - this.positions[a+1], dz = this.positions[b+2] - this.positions[a+2];
          const length = Math.hypot(dx, dy, dz);
          const correction = (length - e.length) / Math.max(length, 1e-8) * e.stiffness / (wa + wb);
          for (let axis = 0; axis < 3; axis++) {
            const difference = axis === 0 ? dx : axis === 1 ? dy : dz;
            this.positions[a+axis] += difference * correction * wa;
            this.positions[b+axis] -= difference * correction * wb;
          }
        }
        // Glass/wall clearance and floor contact; rod attachments remain exact.
        for (let n = columns + 1; n < this.positions.length / 3; n++) {
          this.positions[n*3+1] = Math.max(0.003, this.positions[n*3+1]);
          this.positions[n*3+2] = Math.max(-0.09, this.positions[n*3+2]);
        }
      }
    }
    if (moved) geometryUpdated(this.geometry);
  }
}

function geometryUpdated(geometry: THREE.BufferGeometry) {
  geometry.getAttribute('position').needsUpdate = true;
  geometry.computeVertexNormals();
}
