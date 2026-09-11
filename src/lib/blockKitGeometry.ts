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

export type BlockShapeKind = 'rect' | 'round' | 'slope' | 'arch' | 'bow' | 'dome' | 'cone' | 'curve' | 'wedge';
export type BlockHeightKind = 'brick' | 'plate' | 'tile';

export interface BlockPart {
  id: string;
  label: string;
  category: string;
  studsX: number;
  studsZ: number;
  heightKind: BlockHeightKind;
  shapeKind: BlockShapeKind;
  // "Side / SNOT" (studs-not-on-top) pieces: a single stud on the front
  // vertical face instead of (or as well as) the top, for building
  // perpendicular to the main stud direction.
  sideStud?: boolean;
  // 'wedge': which corner the diagonal cut leaves pointed - flips the
  // triangular footprint left-to-right.
  mirror?: boolean;
  // Overrides the single top stud (used by 'round'/'dome'/'cone' pieces)
  // with one stud pointing in this direction instead of straight up -
  // e.g. horizontal for a piece that plugs into the SIDE of another block,
  // or an angled unit vector for a diagonal branch/connector stud. This is
  // the piece's PRIMARY connection point, and the placement tool (see
  // Viewport.tsx) uses it to decide how the piece should attach to
  // whatever it's being placed against.
  customStudDirection?: [number, number, number];
}

function heightFor(heightKind: BlockHeightKind): number {
  return heightKind === 'brick' ? BRICK_HEIGHT : PLATE_HEIGHT;
}

function hasStuds(heightKind: BlockHeightKind): boolean {
  return heightKind !== 'tile';
}

/** A stud/peg mesh, oriented so it points along `direction` from `origin`. */
function buildStud(origin: THREE.Vector3, direction: THREE.Vector3): THREE.BufferGeometry {
  const stud = new THREE.CylinderGeometry(STUD_RADIUS, STUD_RADIUS, STUD_HEIGHT, 16);
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
  stud.applyQuaternion(quat);
  stud.translate(origin.x, origin.y, origin.z);
  return stud;
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
    case 'wedge': {
      // A triangular-footprint corner ramp: full height along the back
      // edge, tapering down to a single point at one front corner (the
      // OTHER front corner is cut away entirely - that's the diagonal
      // "wedge" cut). `mirror` flips which side the point ends up on.
      bodyGeo = new THREE.BufferGeometry();
      const hw = width / 2, hd = depth / 2;
      const sx = part.mirror ? -1 : 1;
      // P1 = back corner nearest the point's side (height h)
      // P2 = back corner on the far side (height h)
      // P3 = the pointed front corner (height 0) - on the same side as P1
      const p1 = [sx * hw, 0, -hd], p1h = [sx * hw, height, -hd];
      const p2 = [-sx * hw, 0, -hd], p2h = [-sx * hw, height, -hd];
      const p3 = [sx * hw, 0, hd];
      const positions = new Float32Array([
        // Bottom
        ...p1, ...p2, ...p3,
        // Back face (full height)
        ...p1, ...p2, ...p2h,
        ...p1, ...p2h, ...p1h,
        // Sloped top (tapers to the point)
        ...p1h, ...p2h, ...p3,
        // Diagonal cut face (the point's own side wall)
        ...p1, ...p1h, ...p3,
      ]);
      bodyGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      bodyGeo.computeVertexNormals();
      break;
    }
    case 'arch': {
      // A block with a semicircular archway cut through its depth. The 2D
      // profile is drawn directly in the block's own X (width) / Y (height)
      // plane and extruded along Z (depth), so no post-extrude rotation is
      // needed - an earlier version rotated this into place, which actually
      // swapped the block's height and depth extents.
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
      bodyGeo.translate(0, 0, -depth / 2);
      break;
    }
    case 'bow': {
      // A gently curved wall segment (a shallow arc extruded upward). The
      // footprint curve is drawn in X/Y then rotated so the extrusion axis
      // becomes the vertical (Y) axis; the curve isn't symmetric about its
      // own origin (it bulges further forward than it recesses at the
      // back), so it's re-centered on Z afterwards to sit correctly in its
      // stud-grid footprint cell.
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
      bodyGeo.computeBoundingBox();
      const bb = bodyGeo.boundingBox!;
      bodyGeo.translate(0, 0, -(bb.min.z + bb.max.z) / 2);
      break;
    }
    case 'curve': {
      // A quarter-round corner plate/block: straight along two edges, a
      // smooth arc across the far corner. Only meaningful for a square
      // footprint (studsX === studsZ); the arc radius is that side length.
      const radius = Math.min(width, depth);
      const hw = width / 2, hd = depth / 2;
      const cx = -hw, cz = -hd; // the inside (square) corner the arc sweeps around
      const shape = new THREE.Shape();
      shape.moveTo(cx, cz);
      shape.lineTo(cx + radius, cz);
      shape.absarc(cx, cz, radius, 0, Math.PI / 2, false);
      shape.lineTo(cx, cz);
      shape.closePath();
      bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 12 });
      bodyGeo.rotateX(-Math.PI / 2);
      bodyGeo.translate(0, height, 0);
      break;
    }
    case 'dome': {
      // A rounded foliage/nature piece - a hemisphere sitting on the
      // footprint, roughly the same overall proportions as a round brick.
      const domeRadius = Math.min(width, depth) / 2;
      bodyGeo = new THREE.SphereGeometry(domeRadius, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
      break;
    }
    case 'cone': {
      // A pointed pine-tree-style foliage piece.
      const coneRadius = Math.min(width, depth) / 2;
      bodyGeo = new THREE.ConeGeometry(coneRadius, coneRadius * 2.2, 12);
      bodyGeo.translate(0, coneRadius * 1.1, 0);
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
    // CylinderGeometry is centered on its own origin by default; shift it
    // up so its base sits at y=0 like every other part.
    bodyGeo.translate(0, height / 2, 0);
  }
  // 'dome' (thetaLength = PI/2, only the sphere's top half) and 'curve'
  // (already translated above) already have their base at y=0.
  geoms.push(bodyGeo);

  // Only flat-topped rectangular blocks get a full grid of studs - a slope
  // has no flat top to put them on (its top IS the sloped face, so a full
  // grid would float in mid-air over the lower rows), and round/arch/bow
  // are specialty pieces without a working stud face.
  if (hasStuds(part.heightKind) && part.shapeKind === 'rect') {
    for (let x = 0; x < part.studsX; x++) {
      for (let z = 0; z < part.studsZ; z++) {
        const sx = -width / 2 + STUD_UNIT * (x + 0.5);
        const sz = -depth / 2 + STUD_UNIT * (z + 0.5);
        geoms.push(buildStud(new THREE.Vector3(sx, height + STUD_HEIGHT / 2, sz), new THREE.Vector3(0, 1, 0)));
      }
    }
  } else if (hasStuds(part.heightKind) && (part.shapeKind === 'round' || part.shapeKind === 'dome' || part.shapeKind === 'cone')) {
    // These get a single centered stud, as classic round 1x1-style pieces
    // do, rather than a grid that wouldn't fit the circular top - UNLESS
    // customStudDirection says the piece's real connector points somewhere
    // else entirely (a side-facing or diagonal branch stud), in which case
    // it's positioned on the part's own mid-height "waist" instead of its
    // apex, so it reads as a branch rather than a second treetop.
    if (part.customStudDirection) {
      const dir = new THREE.Vector3(...part.customStudDirection).normalize();
      const origin = new THREE.Vector3(0, height / 2, 0).addScaledVector(dir, Math.min(width, depth) / 2);
      geoms.push(buildStud(origin, dir));
    } else {
      const apexY = part.shapeKind === 'round' ? height
        : part.shapeKind === 'cone' ? Math.min(width, depth) * 1.1
        : Math.min(width, depth) / 2; // 'dome'
      geoms.push(buildStud(new THREE.Vector3(0, apexY + STUD_HEIGHT / 2, 0), new THREE.Vector3(0, 1, 0)));
    }
  }

  if (part.sideStud) {
    // A single stud on the front (+Z) vertical face, laid on its side, for
    // building perpendicular to the normal stud direction ("SNOT" pieces).
    geoms.push(buildStud(new THREE.Vector3(0, height / 2, depth / 2 + STUD_HEIGHT / 2), new THREE.Vector3(0, 0, 1)));
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

/**
 * The direction (in the part's own local space, before any placement
 * rotation) that this part's PRIMARY connecting stud points. Every regular
 * block's primary connector points straight up (0,1,0) - the placement
 * tool in Viewport.tsx only changes its "land on top" behavior for parts
 * whose primary direction is NOT mostly vertical (side brackets, angled
 * branch studs), so normal block placement/stacking is unaffected.
 */
export function primaryStudDirection(part: BlockPart): [number, number, number] {
  if (part.sideStud) return [0, 0, 1];
  if (part.customStudDirection) return part.customStudDirection;
  return [0, 1, 0];
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
  const sizes: [number, number][] = [
    [1, 1], [1, 2], [1, 4], [2, 2], [2, 4], [2, 6],
    // Large baseplate-style plates.
    [10, 10], [16, 16], [20, 20], [32, 32]
  ];
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
  const roundParts: BlockPart[] = sizes.map(([x, z]) => ({
    id: `round-${x}x${z}`, label: `${x}x${z} Round`, category: 'Round & Curved',
    studsX: x, studsZ: z, heightKind: 'brick', shapeKind: 'round'
  }));
  const curveParts: BlockPart[] = [[2, 2]].map(([x, z]) => ({
    id: `curve-${x}x${z}`, label: `${x}x${z} Curve`, category: 'Round & Curved',
    studsX: x, studsZ: z, heightKind: 'brick', shapeKind: 'curve'
  }));
  return [...roundParts, ...curveParts];
}

function arches(): BlockPart[] {
  const sizes: [number, number][] = [[2, 1], [4, 1]];
  return sizes.map(([x, z]) => ({
    id: `arch-${x}x${z}`, label: `${x}x${z} Arch`, category: 'Arches',
    studsX: x, studsZ: z, heightKind: 'brick', shapeKind: 'arch'
  }));
}

function bows(): BlockPart[] {
  const sizes: [number, number][] = [[1, 2], [2, 2], [4, 2]];
  const bowParts: BlockPart[] = sizes.map(([x, z]) => ({
    id: `bow-${x}x${z}`, label: `${x}x${z} Bow`, category: 'Bow & Wedge',
    studsX: x, studsZ: z, heightKind: 'brick', shapeKind: 'bow'
  }));
  const wedgeParts: BlockPart[] = [
    { id: 'wedge-2x2-left', label: '2x2 Wedge Left', category: 'Bow & Wedge', studsX: 2, studsZ: 2, heightKind: 'brick', shapeKind: 'wedge', mirror: true },
    { id: 'wedge-2x2-right', label: '2x2 Wedge Right', category: 'Bow & Wedge', studsX: 2, studsZ: 2, heightKind: 'brick', shapeKind: 'wedge', mirror: false }
  ];
  return [...bowParts, ...wedgeParts];
}

function nature(): BlockPart[] {
  return [
    { id: 'tree-1x1-1', label: '1x1 Tree 1', category: 'Nature', studsX: 1, studsZ: 1, heightKind: 'brick', shapeKind: 'dome' },
    { id: 'tree-1x1-2', label: '1x1 Tree 2', category: 'Nature', studsX: 1, studsZ: 1, heightKind: 'brick', shapeKind: 'cone' },
    // A branch stud facing sideways - lets a tree piece connect to
    // something beside it rather than only stacking straight up.
    { id: 'tree-1x1-3', label: '1x1 Tree 3', category: 'Nature', studsX: 1, studsZ: 1, heightKind: 'brick', shapeKind: 'cone', customStudDirection: [0, 0, 1] },
    // A branch stud at a 45-degree angle (up and outward).
    { id: 'tree-1x1-4', label: '1x1 Tree 4', category: 'Nature', studsX: 1, studsZ: 1, heightKind: 'brick', shapeKind: 'dome', customStudDirection: [0.7071, 0.7071, 0] },
    { id: 'leaf-2x2', label: '2x2 Foliage', category: 'Nature', studsX: 2, studsZ: 2, heightKind: 'brick', shapeKind: 'dome' },
    { id: 'leaf-4x4', label: '4x4 Foliage', category: 'Nature', studsX: 4, studsZ: 4, heightKind: 'brick', shapeKind: 'dome' }
  ];
}

function sideSnot(): BlockPart[] {
  const sizes: [number, number][] = [[1, 1], [1, 2]];
  return sizes.map(([x, z]) => ({
    id: `bracket-${x}x${z}`, label: `${x}x${z} Bracket`, category: 'Side / SNOT',
    studsX: x, studsZ: z, heightKind: 'plate', shapeKind: 'rect', sideStud: true
  }));
}

export const BLOCK_CATALOG: BlockPart[] = [
  ...basics(), ...plates(), ...tiles(), ...slopes(), ...round(), ...arches(), ...bows(),
  ...nature(), ...sideSnot()
];

export function getBlockPart(id: string): BlockPart | undefined {
  return BLOCK_CATALOG.find(p => p.id === id);
}
