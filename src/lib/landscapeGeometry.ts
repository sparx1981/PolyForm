import * as THREE from 'three';
// @ts-ignore
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils';

export function createTreeGeometry(speciesId: string = 'english_oak'): THREE.BufferGeometry {
  const geometries: THREE.BufferGeometry[] = [];

  switch (speciesId) {
    case 'mediterranean_cypress': {
      // Columnar slender tree
      const trunk = new THREE.CylinderGeometry(0.12, 0.20, 1.2, 8);
      trunk.translate(0, 0.6, 0);
      geometries.push(trunk);

      const foliage = new THREE.ConeGeometry(0.9, 6.5, 12);
      foliage.translate(0, 4.0, 0);
      geometries.push(foliage);
      break;
    }

    case 'scots_pine': {
      // Tall bare trunk with high umbrella canopy
      const trunk = new THREE.CylinderGeometry(0.15, 0.26, 4.5, 8);
      trunk.translate(0, 2.25, 0);
      geometries.push(trunk);

      const crown1 = new THREE.SphereGeometry(1.6, 12, 10);
      crown1.scale(1.3, 0.5, 1.3);
      crown1.translate(0, 4.8, 0);
      geometries.push(crown1);

      const crown2 = new THREE.SphereGeometry(1.1, 10, 8);
      crown2.scale(1.1, 0.5, 1.1);
      crown2.translate(0.4, 5.4, -0.3);
      geometries.push(crown2);
      break;
    }

    case 'silver_birch': {
      // Slender delicate tree
      const trunk = new THREE.CylinderGeometry(0.10, 0.18, 3.2, 8);
      trunk.translate(0, 1.6, 0);
      geometries.push(trunk);

      const t1 = new THREE.SphereGeometry(1.1, 12, 10);
      t1.scale(0.8, 1.2, 0.8);
      t1.translate(0, 3.5, 0);
      geometries.push(t1);

      const t2 = new THREE.SphereGeometry(0.8, 10, 8);
      t2.scale(0.7, 1.1, 0.7);
      t2.translate(0, 4.5, 0);
      geometries.push(t2);
      break;
    }

    case 'japanese_maple': {
      // Multi-stem low spreading canopy
      const stem1 = new THREE.CylinderGeometry(0.08, 0.14, 1.6, 6);
      stem1.rotateZ(0.2);
      stem1.translate(-0.15, 0.8, 0);
      geometries.push(stem1);

      const stem2 = new THREE.CylinderGeometry(0.07, 0.12, 1.5, 6);
      stem2.rotateZ(-0.25);
      stem2.translate(0.2, 0.75, 0.1);
      geometries.push(stem2);

      const dome = new THREE.SphereGeometry(1.7, 12, 10);
      dome.scale(1.4, 0.6, 1.3);
      dome.translate(0, 2.3, 0);
      geometries.push(dome);
      break;
    }

    case 'olive_tree': {
      // Gnarled wide sculptural trunk with wide spherical umbrella
      const trunk = new THREE.CylinderGeometry(0.28, 0.42, 1.4, 8);
      trunk.translate(0, 0.7, 0);
      geometries.push(trunk);

      const branch = new THREE.CylinderGeometry(0.12, 0.18, 1.2, 6);
      branch.rotateZ(0.35);
      branch.translate(0.3, 1.4, 0);
      geometries.push(branch);

      const crown = new THREE.SphereGeometry(1.65, 12, 10);
      crown.scale(1.3, 0.75, 1.25);
      crown.translate(0.1, 2.2, 0);
      geometries.push(crown);
      break;
    }

    case 'weeping_willow': {
      const trunk = new THREE.CylinderGeometry(0.22, 0.35, 2.2, 8);
      trunk.translate(0, 1.1, 0);
      geometries.push(trunk);

      const dome = new THREE.CylinderGeometry(1.8, 2.4, 3.2, 12);
      dome.translate(0, 3.0, 0);
      geometries.push(dome);
      break;
    }

    default: {
      // English Oak / Standard Broadleaf
      const trunk = new THREE.CylinderGeometry(0.18, 0.28, 2.0, 10);
      trunk.translate(0, 1.0, 0);
      geometries.push(trunk);

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
      break;
    }
  }

  const merged = mergeGeometries(geometries);
  geometries.forEach(g => g.dispose());
  return merged || new THREE.BoxGeometry(1, 1, 1);
}

export function createBushGeometry(speciesId: string = 'boxwood_hedge_bush'): THREE.BufferGeometry {
  const geometries: THREE.BufferGeometry[] = [];

  if (speciesId === 'lavender_shrub') {
    const main = new THREE.SphereGeometry(0.45, 12, 10);
    main.scale(1.1, 0.8, 1.1);
    main.translate(0, 0.35, 0);
    geometries.push(main);

    for (let i = 0; i < 5; i++) {
      const spike = new THREE.CylinderGeometry(0.04, 0.08, 0.35, 6);
      const angle = (i / 5) * Math.PI * 2;
      spike.translate(Math.cos(angle) * 0.25, 0.55, Math.sin(angle) * 0.25);
      geometries.push(spike);
    }
  } else if (speciesId === 'hydrangea_bush') {
    const main = new THREE.SphereGeometry(0.75, 14, 14);
    main.scale(1.2, 0.85, 1.1);
    main.translate(0, 0.65, 0);
    geometries.push(main);
  } else {
    // Standard / Boxwood cluster
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
  }

  const merged = mergeGeometries(geometries);
  geometries.forEach(g => g.dispose());
  return merged || new THREE.BoxGeometry(1, 1, 1);
}

export function createFenceGeometry(length: number = 2.4, height: number = 1.1): THREE.BufferGeometry {
  const geometries: THREE.BufferGeometry[] = [];
  const postWidth = 0.12;
  const postSpacing = Math.min(2.0, Math.max(0.8, length / Math.max(1, Math.round(length / 2.0))));
  const numPosts = Math.max(2, Math.round(length / postSpacing) + 1);
  const actualSpacing = length / (numPosts - 1);

  // Vertical Posts spaced along the segment
  for (let i = 0; i < numPosts; i++) {
    const px = -length / 2 + i * actualSpacing;
    const post = new THREE.BoxGeometry(postWidth, height, postWidth);
    post.translate(px, height / 2, 0);
    geometries.push(post);

    // Decorative pyramid cap on top of post
    const cap = new THREE.ConeGeometry(postWidth * 0.75, 0.08, 4);
    cap.rotateY(Math.PI / 4);
    cap.translate(px, height + 0.04, 0);
    geometries.push(cap);
  }

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

  // Vertical Posts spaced ~1.2m apart
  const numPosts = Math.max(2, Math.round(length / 1.2) + 1);
  const step = length / (numPosts - 1);
  for (let i = 0; i < numPosts; i++) {
    const px = -length / 2 + i * step;
    const post = new THREE.CylinderGeometry(0.025, 0.025, height - 0.05, 10);
    post.translate(px, (height - 0.05) / 2, 0);
    geometries.push(post);
  }

  // Horizontal Safety Infill Rods
  const rodLevels = [0.22, 0.42, 0.62, 0.82];
  for (const rL of rodLevels) {
    const rod = new THREE.CylinderGeometry(0.01, 0.01, length, 8);
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
