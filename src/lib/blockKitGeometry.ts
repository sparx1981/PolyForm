import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Original stud-block dimensioning for PolyForm's Block Picker tool - loosely
// modeled on standard interlocking building-block proportions, expressed in
// meters. Not derived from any third-party source or asset.
export const STUD_UNIT = 0.08;
export const BRICK_HEIGHT = 0.096;
export const PLATE_HEIGHT = BRICK_HEIGHT / 3;
export const STUD_RADIUS = 0.024;
export const STUD_HEIGHT = 0.017;

export type BlockShapeKind = 'rect' | 'round' | 'slope' | 'arch' | 'bow';
export type BlockHeightKind = 'brick' | 'plate' | 'tile';

export interface BlockPart {
  id: string;
  label: string;
  category: string;
  studsX: number;
  studsZ: number;
  heightKind: BlockHeightKind;
  shapeKind: BlockShapeKind;
}

function heightFor(heightKind: BlockHeightKind): number {
  return heightKind === 'brick' ? BRICK_HEIGHT : PLATE_HEIGHT;
}

function hasStuds(heightKind: BlockHeightKind): boolean {
  return heightKind !== 'tile';
}

/** Builds one part's geometry, centered on the origin with its base at y=0. */
export function buildBlockGeometry(part: BlockPart): THREE.BufferGeometry {
  const height = heightFor(part.heightKind);
  const width = part.studsX * STUD_UNIT;
  const depth = part.studsZ * STUD_UNIT;
  const geoms: THREE.BufferGeometry[] = [];

  let bodyGeo: THREE.BufferGeometry;
  switch (part.shapeKind) {
    case 'round': {
      bodyGeo = new THREE.CylinderGeometry(width / 2, width / 2, height, 24);
      break;
    }
    case 'slope': {
      // A wedge: full-height at the back edge, tapering to zero at the front.
      bodyGeo = new THREE.BufferGeometry();
      const hw = width / 2, hd = depth / 2;
      const positions = new Float32Array([
        // Bottom face
        -hw, 0, -hd,  hw, 0, -hd,  hw, 0, hd,
        -hw, 0, -hd,  hw, 0, hd,  -hw, 0, hd,
        // Back face (full height)
        -hw, 0, -hd,  hw, 0, -hd,  hw, height, -hd,
        -hw, 0, -hd,  hw, height, -hd,  -hw, height, -hd,
        // Sloped top face
        -hw, height, -hd,  hw, height, -hd,  hw, 0, hd,
        -hw, height, -hd,  hw, 0, hd,  -hw, 0, hd,
        // Left face
        -hw, 0, -hd,  -hw, height, -hd,  -hw, 0, hd,
        // Right face
        hw, 0, -hd,  hw, 0, hd,  hw, height, -hd,
      ]);
      bodyGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      bodyGeo.computeVertexNormals();
      break;
    }
    case 'arch': {
      // A block with a semicircular archway cut through its depth.
      const shape = new THREE.Shape();
      shape.moveTo(-hwSafe(width), 0);
      shape.lineTo(hwSafe(width), 0);
      shape.lineTo(hwSafe(width), height);
      shape.lineTo(-hwSafe(width), height);
      shape.closePath();
      const archRadius = Math.min(width, height) * 0.35;
      const holePath = new THREE.Path();
      holePath.absarc(0, archRadius, archRadius, Math.PI, 0, true);
      holePath.lineTo(archRadius, 0);
      holePath.lineTo(-archRadius, 0);
      shape.holes.push(holePath);
      bodyGeo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
      bodyGeo.rotateX(-Math.PI / 2);
      bodyGeo.translate(0, 0, -depth / 2);
      break;
    }
    case 'bow': {
      // A gently curved wall segment (a shallow arc extruded upward).
      const segments = 8;
      const bowDepth = depth * 0.5;
      const bowShape = new THREE.Shape();
      bowShape.moveTo(-width / 2, 0);
      bowShape.quadraticCurveTo(0, bowDepth, width / 2, 0);
      bowShape.lineTo(width / 2, -depth * 0.15);
      bowShape.quadraticCurveTo(0, bowDepth - depth * 0.15, -width / 2, -depth * 0.15);
      bowShape.closePath();
      bodyGeo = new THREE.ExtrudeGeometry(bowShape, { depth: height, bevelEnabled: false, curveSegments: segments });
      bodyGeo.rotateX(-Math.PI / 2);
      break;
    }
    case 'rect':
    default: {
      bodyGeo = new THREE.BoxGeometry(width, height, depth);
      bodyGeo.translate(0, height / 2, 0);
      break;
    }
  }
  if (part.shapeKind === 'round') {
    bodyGeo.translate(0, height / 2, 0);
  }
  geoms.push(bodyGeo);

  if (hasStuds(part.heightKind) && part.shapeKind !== 'round' && part.shapeKind !== 'arch' && part.shapeKind !== 'bow') {
    for (let x = 0; x < part.studsX; x++) {
      for (let z = 0; z < part.studsZ; z++) {
        const studGeo = new THREE.CylinderGeometry(STUD_RADIUS, STUD_RADIUS, STUD_HEIGHT, 16);
        const sx = -width / 2 + STUD_UNIT * (x + 0.5);
        const sz = -depth / 2 + STUD_UNIT * (z + 0.5);
        studGeo.translate(sx, height + STUD_HEIGHT / 2, sz);
        geoms.push(studGeo);
      }
    }
  }

  const normalized = geoms.map(g => {
    const cloned = g.index ? g.toNonIndexed() : g;
    // Every geometry to merge must share the same attribute set.
    if (!cloned.attributes.uv) {
      cloned.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(cloned.attributes.position.count * 2), 2));
    }
    return cloned;
  });

  return BufferGeometryUtils.mergeGeometries(normalized, false) || bodyGeo;
}

function hwSafe(width: number): number {
  return width / 2;
}

export const BLOCK_CATEGORIES = [
  'Basics', 'Plates & Jumpers', 'Tiles', 'Slopes & Angles', 'Round & Curved',
  'Arches', 'Bow & Wedge', 'Nature', 'Side / SNOT'
] as const;

function basics(): BlockPart[] {
  const sizes: [number, number][] = [[1, 1], [1, 2], [1, 3], [1, 4], [1, 6], [1, 8], [2, 2], [2, 3], [2, 4], [2, 6], [2, 8]];
  return sizes.map(([x, z]) => ({
    id: `brick-${x}x${z}`, label: `${x}x${z} Block`, category: 'Basics',
    studsX: x, studsZ: z, heightKind: 'brick', shapeKind: 'rect'
  }));
}

function plates(): BlockPart[] {
  const sizes: [number, number][] = [[1, 1], [1, 2], [1, 4], [2, 2], [2, 4], [2, 6]];
  return sizes.map(([x, z]) => ({
    id: `plate-${x}x${z}`, label: `${x}x${z} Plate`, category: 'Plates & Jumpers',
    studsX: x, studsZ: z, heightKind: 'plate', shapeKind: 'rect'
  }));
}

function tiles(): BlockPart[] {
  const sizes: [number, number][] = [[1, 1], [1, 2], [2, 2], [2, 4]];
  return sizes.map(([x, z]) => ({
    id: `tile-${x}x${z}`, label: `${x}x${z} Tile`, category: 'Tiles',
    studsX: x, studsZ: z, heightKind: 'tile', shapeKind: 'rect'
  }));
}

function slopes(): BlockPart[] {
  const sizes: [number, number][] = [[1, 2], [1, 3], [2, 2], [2, 3]];
  return sizes.map(([x, z]) => ({
    id: `slope-${x}x${z}`, label: `${x}x${z} Slope`, category: 'Slopes & Angles',
    studsX: x, studsZ: z, heightKind: 'brick', shapeKind: 'slope'
  }));
}

function round(): BlockPart[] {
  const sizes: [number, number][] = [[1, 1], [2, 2], [4, 4]];
  return sizes.map(([x, z]) => ({
    id: `round-${x}x${z}`, label: `${x}x${z} Round`, category: 'Round & Curved',
    studsX: x, studsZ: z, heightKind: 'brick', shapeKind: 'round'
  }));
}

function arches(): BlockPart[] {
  const sizes: [number, number][] = [[2, 1], [4, 1]];
  return sizes.map(([x, z]) => ({
    id: `arch-${x}x${z}`, label: `${x}x${z} Arch`, category: 'Arches',
    studsX: x, studsZ: z, heightKind: 'brick', shapeKind: 'arch'
  }));
}

function bows(): BlockPart[] {
  const sizes: [number, number][] = [[4, 2]];
  return sizes.map(([x, z]) => ({
    id: `bow-${x}x${z}`, label: `${x}x${z} Bow`, category: 'Bow & Wedge',
    studsX: x, studsZ: z, heightKind: 'brick', shapeKind: 'bow'
  }));
}

export const BLOCK_CATALOG: BlockPart[] = [
  ...basics(), ...plates(), ...tiles(), ...slopes(), ...round(), ...arches(), ...bows()
];

export function getBlockPart(id: string): BlockPart | undefined {
  return BLOCK_CATALOG.find(p => p.id === id);
}
