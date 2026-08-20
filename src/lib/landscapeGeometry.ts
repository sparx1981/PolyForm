import * as THREE from 'three';
// @ts-ignore
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils';

export function createTreeGeometry(type: string = 'standard'): THREE.BufferGeometry {
  const geometries: THREE.BufferGeometry[] = [];

  // Trunk
  const trunk = new THREE.CylinderGeometry(0.18, 0.28, 2.0, 10);
  trunk.translate(0, 1.0, 0);
  geometries.push(trunk);

  // Multi-tier lush foliage
  const tier1 = new THREE.SphereGeometry(1.35, 14, 14);
  tier1.scale(1, 0.75, 1);
  tier1.translate(0, 2.3, 0);
  geometries.push(tier1);

  const tier2 = new THREE.SphereGeometry(1.05, 14, 14);
  tier2.scale(1, 0.75, 1);
  tier2.translate(0, 3.0, 0);
  geometries.push(tier2);

  const tier3 = new THREE.SphereGeometry(0.7, 12, 12);
  tier3.scale(1, 0.8, 1);
  tier3.translate(0, 3.65, 0);
  geometries.push(tier3);

  const merged = mergeGeometries(geometries);
  geometries.forEach(g => g.dispose());
  return merged || new THREE.BoxGeometry(1, 1, 1);
}

export function createBushGeometry(): THREE.BufferGeometry {
  const geometries: THREE.BufferGeometry[] = [];

  const main = new THREE.SphereGeometry(0.65, 14, 14);
  main.scale(1.1, 0.9, 1.0);
  main.translate(0, 0.55, 0);
  geometries.push(main);

  const left = new THREE.SphereGeometry(0.48, 12, 12);
  left.scale(1.0, 0.85, 1.0);
  left.translate(-0.35, 0.42, 0.2);
  geometries.push(left);

  const right = new THREE.SphereGeometry(0.52, 12, 12);
  right.scale(1.0, 0.85, 1.0);
  right.translate(0.35, 0.46, -0.15);
  geometries.push(right);

  const back = new THREE.SphereGeometry(0.42, 12, 12);
  back.translate(0.1, 0.4, 0.3);
  geometries.push(back);

  const merged = mergeGeometries(geometries);
  geometries.forEach(g => g.dispose());
  return merged || new THREE.BoxGeometry(1, 1, 1);
}

export function createFenceGeometry(length: number = 2.4, height: number = 1.1): THREE.BufferGeometry {
  const geometries: THREE.BufferGeometry[] = [];
  const postWidth = 0.12;

  // Left Post
  const leftPost = new THREE.BoxGeometry(postWidth, height, postWidth);
  leftPost.translate(-length / 2 + postWidth / 2, height / 2, 0);
  geometries.push(leftPost);

  // Right Post
  const rightPost = new THREE.BoxGeometry(postWidth, height, postWidth);
  rightPost.translate(length / 2 - postWidth / 2, height / 2, 0);
  geometries.push(rightPost);

  // Bottom Rail
  const bottomRail = new THREE.BoxGeometry(length, 0.08, 0.05);
  bottomRail.translate(0, height * 0.35, 0);
  geometries.push(bottomRail);

  // Top Rail
  const topRail = new THREE.BoxGeometry(length, 0.08, 0.05);
  topRail.translate(0, height * 0.82, 0);
  geometries.push(topRail);

  const merged = mergeGeometries(geometries);
  geometries.forEach(g => g.dispose());
  return merged || new THREE.BoxGeometry(1, 1, 1);
}

export function createRailingGeometry(length: number = 2.0, height: number = 1.0): THREE.BufferGeometry {
  const geometries: THREE.BufferGeometry[] = [];

  // Top Handrail
  const topRail = new THREE.BoxGeometry(length, 0.05, 0.08);
  topRail.translate(0, height - 0.025, 0);
  geometries.push(topRail);

  // 3 Vertical Posts (Left, Center, Right)
  const postPositions = [-length / 2 + 0.05, 0, length / 2 - 0.05];
  for (const px of postPositions) {
    const post = new THREE.CylinderGeometry(0.025, 0.025, height - 0.05, 10);
    post.translate(px, (height - 0.05) / 2, 0);
    geometries.push(post);
  }

  // 4 Horizontal Safety Infill Rods
  const rodLevels = [0.2, 0.4, 0.6, 0.8];
  for (const rL of rodLevels) {
    const rod = new THREE.CylinderGeometry(0.01, 0.01, length - 0.1, 8);
    rod.rotateZ(Math.PI / 2);
    rod.translate(0, height * rL, 0);
    geometries.push(rod);
  }

  const merged = mergeGeometries(geometries);
  geometries.forEach(g => g.dispose());
  return merged || new THREE.BoxGeometry(1, 1, 1);
}

export function createLampGeometry(height: number = 3.2): THREE.BufferGeometry {
  const geometries: THREE.BufferGeometry[] = [];

  // Base Plinth
  const base = new THREE.CylinderGeometry(0.2, 0.25, 0.3, 14);
  base.translate(0, 0.15, 0);
  geometries.push(base);

  // Main Pole
  const pole = new THREE.CylinderGeometry(0.05, 0.07, height - 0.7, 14);
  pole.translate(0, 0.3 + (height - 0.7) / 2, 0);
  geometries.push(pole);

  // Lantern Housing
  const lantern = new THREE.CylinderGeometry(0.22, 0.14, 0.45, 8);
  lantern.translate(0, height - 0.25, 0);
  geometries.push(lantern);

  // Lantern Cap
  const cap = new THREE.ConeGeometry(0.28, 0.2, 8);
  cap.translate(0, height + 0.05, 0);
  geometries.push(cap);

  const merged = mergeGeometries(geometries);
  geometries.forEach(g => g.dispose());
  return merged || new THREE.BoxGeometry(1, 1, 1);
}

export function createBenchGeometry(length: number = 1.8): THREE.BufferGeometry {
  const geometries: THREE.BufferGeometry[] = [];

  // Wooden Seat Slats
  const seat = new THREE.BoxGeometry(length, 0.04, 0.45);
  seat.translate(0, 0.46, 0);
  geometries.push(seat);

  // Wooden Backrest Slats
  const backrest = new THREE.BoxGeometry(length, 0.38, 0.04);
  backrest.translate(0, 0.76, -0.2);
  geometries.push(backrest);

  // Metal Cast Supports (Left and Right)
  const legPositions = [-length / 2 + 0.15, length / 2 - 0.15];
  for (const lx of legPositions) {
    const leg = new THREE.BoxGeometry(0.06, 0.46, 0.48);
    leg.translate(lx, 0.23, 0);
    geometries.push(leg);

    const backStrut = new THREE.BoxGeometry(0.06, 0.45, 0.06);
    backStrut.translate(lx, 0.68, -0.2);
    geometries.push(backStrut);
  }

  const merged = mergeGeometries(geometries);
  geometries.forEach(g => g.dispose());
  return merged || new THREE.BoxGeometry(1, 1, 1);
}

export function createRockGeometry(size: number = 1.2): THREE.BufferGeometry {
  const geo = new THREE.DodecahedronGeometry(size * 0.7, 1);
  const pos = geo.attributes.position;
  
  // Seeded deterministic vertex displacement for faceted boulder look
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const noise = Math.sin(x * 3.5 + y * 2.1) * Math.cos(z * 4.2) * 0.12;
    pos.setXYZ(i, x * (1 + noise), y * (1 + noise), z * (1 + noise));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  geo.scale(1.15, 0.85, 1.05);
  geo.translate(0, size * 0.45, 0);
  return geo;
}
