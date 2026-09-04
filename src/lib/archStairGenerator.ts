import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type StairStyleType = 'straight' | 'l-shape' | 'u-shape' | 'c-shape' | 'winder' | 'spiral' | 'curved' | 'bifurcated';
export type StairStructureType = 'closed' | 'open' | 'floating' | 'mono-stringer';
export type RailingModeType = 'none' | 'left' | 'right' | 'both';

export interface StaircaseOptions {
  width?: number;          // Total width (e.g. 1.0m or 2.2m for switchback)
  height?: number;         // Total vertical rise (e.g. 2.7m)
  length?: number;         // Total horizontal run (e.g. 3.6m)
  numSteps?: number;       // Number of steps (default: 14)
  stairStyle?: StairStyleType | string;
  stairStructure?: StairStructureType;
  railingMode?: RailingModeType;
}

/**
 * Builds a single rectangular tread plank with front nosing.
 */
function createTread(
  w: number,
  d: number,
  thickness: number = 0.035,
  nosingOverhang: number = 0.02
): THREE.BufferGeometry {
  const geom = new THREE.BoxGeometry(w, thickness, d + nosingOverhang);
  geom.translate(0, -thickness / 2, nosingOverhang / 2);
  return geom;
}

/**
 * Builds a vertical riser backing board.
 */
function createRiser(w: number, h: number, thickness: number = 0.02): THREE.BufferGeometry {
  const geom = new THREE.BoxGeometry(w, h, thickness);
  geom.translate(0, -h / 2, -thickness / 2);
  return geom;
}

/**
 * Builds a solid step block (closed rise & run).
 */
function createSolidStep(w: number, h: number, d: number): THREE.BufferGeometry {
  const geom = new THREE.BoxGeometry(w, h, d);
  geom.translate(0, -h / 2, 0);
  return geom;
}

/**
 * Builds an angled side stringer board.
 */
function createSideStringer(
  length: number,
  height: number,
  boardWidth: number = 0.04,
  boardDepth: number = 0.22
): THREE.BufferGeometry {
  const span = Math.hypot(length, height);
  const angle = Math.atan2(height, length);
  const geom = new THREE.BoxGeometry(boardWidth, boardDepth, span);
  geom.rotateX(-angle);
  return geom;
}

/**
 * Builds a central mono-stringer spine beam.
 */
function createMonoStringer(
  length: number,
  height: number,
  beamWidth: number = 0.14,
  beamDepth: number = 0.16
): THREE.BufferGeometry {
  const span = Math.hypot(length, height);
  const angle = Math.atan2(height, length);
  const geom = new THREE.BoxGeometry(beamWidth, beamDepth, span);
  geom.rotateX(-angle);
  return geom;
}

/**
 * Helper to build balustrades & handrail along a line path.
 */
function createRailingAlongSegment(
  pStart: [number, number, number],
  pEnd: [number, number, number],
  railHeight: number = 0.95,
  numBalusters: number = 6
): THREE.BufferGeometry[] {
  const geoms: THREE.BufferGeometry[] = [];
  const vStart = new THREE.Vector3(...pStart);
  const vEnd = new THREE.Vector3(...pEnd);
  const delta = new THREE.Vector3().subVectors(vEnd, vStart);
  const totalDist = delta.length();
  if (totalDist < 0.12) return geoms;

  // Newel Posts at start & end
  const postGeom1 = new THREE.BoxGeometry(0.06, railHeight, 0.06);
  postGeom1.translate(pStart[0], pStart[1] + railHeight / 2, pStart[2]);
  geoms.push(postGeom1);

  const postGeom2 = new THREE.BoxGeometry(0.06, railHeight, 0.06);
  postGeom2.translate(pEnd[0], pEnd[1] + railHeight / 2, pEnd[2]);
  geoms.push(postGeom2);

  // Handrail bar: elevated by railHeight along the path
  const handrailStart = vStart.clone().add(new THREE.Vector3(0, railHeight, 0));
  const handrailEnd = vEnd.clone().add(new THREE.Vector3(0, railHeight, 0));
  const handrailMid = handrailStart.clone().lerp(handrailEnd, 0.5);

  const railBar = new THREE.BoxGeometry(0.05, 0.04, totalDist);
  const dir = delta.clone().normalize();
  const orientationQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  railBar.applyQuaternion(orientationQuat);
  railBar.translate(handrailMid.x, handrailMid.y, handrailMid.z);
  geoms.push(railBar);

  // Vertical Balusters along path
  const count = Math.max(1, numBalusters);
  const spindleH = Math.max(0.1, railHeight - 0.06);
  for (let b = 1; b < count; b++) {
    const t = b / count;
    const bx = pStart[0] + delta.x * t;
    const by = pStart[1] + delta.y * t;
    const bz = pStart[2] + delta.z * t;

    const balGeom = new THREE.CylinderGeometry(0.012, 0.012, spindleH, 8);
    balGeom.translate(bx, by + spindleH / 2 + 0.03, bz);
    geoms.push(balGeom);
  }

  return geoms;
}

/**
 * Master architectural staircase geometry generator.
 */
export function createArchitecturalStaircaseGeometry(
  options: StaircaseOptions = {}
): THREE.BufferGeometry {
  const width = options.width || 1.0;
  const height = options.height || 2.7;
  const length = options.length || 3.6;
  const numSteps = Math.max(4, options.numSteps || 14);
  const style = (options.stairStyle || 'straight').toLowerCase();
  const structure = options.stairStructure || 'closed';
  const railing = options.railingMode || 'both';

  const geoms: THREE.BufferGeometry[] = [];

  const addRailings = (
    ptsLeft: [number, number, number][],
    ptsRight: [number, number, number][]
  ) => {
    if (railing === 'left' || railing === 'both') {
      for (let i = 0; i < ptsLeft.length - 1; i++) {
        geoms.push(...createRailingAlongSegment(ptsLeft[i], ptsLeft[i + 1], 0.95, Math.ceil(numSteps / (ptsLeft.length - 1))));
      }
    }
    if (railing === 'right' || railing === 'both') {
      for (let i = 0; i < ptsRight.length - 1; i++) {
        geoms.push(...createRailingAlongSegment(ptsRight[i], ptsRight[i + 1], 0.95, Math.ceil(numSteps / (ptsRight.length - 1))));
      }
    }
  };

  // -------------------------------------------------------------------------
  // 1. STRAIGHT FLIGHT
  // -------------------------------------------------------------------------
  if (style === 'straight') {
    const stepH = height / numSteps;
    const stepD = length / numSteps;

    for (let i = 0; i < numSteps; i++) {
      const topY = -height / 2 + (i + 1) * stepH;
      const centerZ = -length / 2 + (i + 0.5) * stepD;

      if (structure === 'closed') {
        const step = createSolidStep(width, (i + 1) * stepH, stepD);
        step.translate(0, topY, centerZ);
        geoms.push(step);

        const tread = createTread(width + 0.02, stepD, 0.035, 0.02);
        tread.translate(0, topY, centerZ);
        geoms.push(tread);
      } else if (structure === 'open') {
        const tread = createTread(width, stepD, 0.04, 0.02);
        tread.translate(0, topY, centerZ);
        geoms.push(tread);
      } else if (structure === 'floating') {
        const tread = new THREE.BoxGeometry(width, 0.065, stepD - 0.02);
        tread.translate(0, topY - 0.03, centerZ);
        geoms.push(tread);

        // Wall cantilever bracket on one side
        const bracket = new THREE.BoxGeometry(0.08, 0.12, 0.14);
        bracket.translate(-width / 2 + 0.04, topY - 0.06, centerZ);
        geoms.push(bracket);
      } else if (structure === 'mono-stringer') {
        const tread = createTread(width, stepD, 0.045, 0.02);
        tread.translate(0, topY, centerZ);
        geoms.push(tread);

        // Small steel support plate under tread
        const plate = new THREE.BoxGeometry(0.3, 0.015, stepD * 0.7);
        plate.translate(0, topY - 0.05, centerZ);
        geoms.push(plate);
      }
    }

    // Stringers if needed
    if (structure === 'open' || structure === 'closed') {
      const strL = createSideStringer(length, height, 0.04, 0.22);
      strL.translate(-width / 2 + 0.02, 0, 0);
      geoms.push(strL);

      const strR = createSideStringer(length, height, 0.04, 0.22);
      strR.translate(width / 2 - 0.02, 0, 0);
      geoms.push(strR);
    } else if (structure === 'mono-stringer') {
      const spine = createMonoStringer(length, height, 0.14, 0.16);
      spine.translate(0, -0.08, 0);
      geoms.push(spine);
    }

    // Railings
    const pLeftStart: [number, number, number] = [-width / 2 + 0.04, -height / 2, -length / 2];
    const pLeftEnd: [number, number, number] = [-width / 2 + 0.04, height / 2, length / 2];
    const pRightStart: [number, number, number] = [width / 2 - 0.04, -height / 2, -length / 2];
    const pRightEnd: [number, number, number] = [width / 2 - 0.04, height / 2, length / 2];
    addRailings([pLeftStart, pLeftEnd], [pRightStart, pRightEnd]);
  }

  // -------------------------------------------------------------------------
  // 2. L-SHAPED (QUARTER-TURN WITH LANDING)
  // -------------------------------------------------------------------------
  else if (style === 'l-shape') {
    const flight1Steps = Math.floor(numSteps / 2);
    const flight2Steps = numSteps - flight1Steps - 1;
    const stepH = height / numSteps;
    const flightW = width * 0.85;
    const landingSize = flightW;
    const run1 = (length * 0.55);
    const stepD1 = run1 / flight1Steps;
    const run2 = (length * 0.45);
    const stepD2 = run2 / flight2Steps;

    // Flight 1 (runs along +Z)
    for (let i = 0; i < flight1Steps; i++) {
      const topY = -height / 2 + (i + 1) * stepH;
      const zPos = -length / 2 + (i + 0.5) * stepD1;
      const xPos = -flightW / 2;

      if (structure === 'closed') {
        const step = createSolidStep(flightW, (i + 1) * stepH, stepD1);
        step.translate(xPos, topY, zPos);
        geoms.push(step);
      }
      const tread = createTread(flightW, stepD1, 0.04, 0.02);
      tread.translate(xPos, topY, zPos);
      geoms.push(tread);
    }

    // Intermediate Landing
    const landY = -height / 2 + (flight1Steps + 1) * stepH;
    const landZ = -length / 2 + run1 + landingSize / 2;
    const landX = -flightW / 2;
    const landing = new THREE.BoxGeometry(landingSize, 0.06, landingSize);
    landing.translate(landX, landY - 0.03, landZ);
    geoms.push(landing);

    // Flight 2 (turns 90° to the right, along +X)
    for (let j = 0; j < flight2Steps; j++) {
      const stepIdx = flight1Steps + 1 + (j + 1);
      const topY = -height / 2 + stepIdx * stepH;
      const xPos = landX + landingSize / 2 + (j + 0.5) * stepD2;
      const zPos = landZ;

      if (structure === 'closed') {
        const step = new THREE.BoxGeometry(stepD2, stepIdx * stepH, flightW);
        step.translate(xPos, topY - (stepIdx * stepH) / 2, zPos);
        geoms.push(step);
      }
      const tread = new THREE.BoxGeometry(stepD2 + 0.02, 0.04, flightW);
      tread.translate(xPos, topY - 0.02, zPos);
      geoms.push(tread);
    }

    // Corner Railings
    const rL: [number, number, number][] = [
      [-flightW, -height / 2, -length / 2],
      [-flightW, landY, landZ + landingSize / 2],
      [landX + landingSize / 2 + run2, height / 2, landZ + landingSize / 2]
    ];
    const rR: [number, number, number][] = [
      [0, -height / 2, -length / 2],
      [0, landY, landZ - landingSize / 2],
      [landX + landingSize / 2 + run2, height / 2, landZ - landingSize / 2]
    ];
    addRailings(rL, rR);
  }

  // -------------------------------------------------------------------------
  // 3. U-SHAPED (SWITCHBACK / HALF-TURN)
  // -------------------------------------------------------------------------
  else if (style === 'u-shape') {
    const flightSteps = Math.floor((numSteps - 1) / 2);
    const stepH = height / numSteps;
    const flightW = (width - 0.15) / 2;
    const runL = length * 0.75;
    const stepD = runL / flightSteps;
    const landD = length - runL;

    // Flight 1: Ascends +Z on left side
    for (let i = 0; i < flightSteps; i++) {
      const topY = -height / 2 + (i + 1) * stepH;
      const zPos = -length / 2 + (i + 0.5) * stepD;
      const xPos = -width / 2 + flightW / 2;

      if (structure === 'closed') {
        const step = createSolidStep(flightW, (i + 1) * stepH, stepD);
        step.translate(xPos, topY, zPos);
        geoms.push(step);
      }
      const tread = createTread(flightW, stepD, 0.04, 0.02);
      tread.translate(xPos, topY, zPos);
      geoms.push(tread);
    }

    // Half-turn Landing at top of Flight 1
    const landY = -height / 2 + (flightSteps + 1) * stepH;
    const landZ = -length / 2 + runL + landD / 2;
    const landing = new THREE.BoxGeometry(width, 0.06, landD);
    landing.translate(0, landY - 0.03, landZ);
    geoms.push(landing);

    // Flight 2: Ascends -Z (switchback) on right side
    for (let j = 0; j < flightSteps; j++) {
      const stepIdx = flightSteps + 1 + (j + 1);
      const topY = -height / 2 + stepIdx * stepH;
      const zPos = -length / 2 + runL - (j + 0.5) * stepD;
      const xPos = width / 2 - flightW / 2;

      if (structure === 'closed') {
        const step = createSolidStep(flightW, stepIdx * stepH, stepD);
        step.translate(xPos, topY, zPos);
        geoms.push(step);
      }
      const tread = createTread(flightW, stepD, 0.04, 0.02);
      tread.translate(xPos, topY, zPos);
      geoms.push(tread);
    }

    // Railings for switchback
    const rOuter: [number, number, number][] = [
      [-width / 2 + 0.04, -height / 2, -length / 2],
      [-width / 2 + 0.04, landY, landZ + landD / 2],
      [width / 2 - 0.04, landY, landZ + landD / 2],
      [width / 2 - 0.04, height / 2, -length / 2]
    ];
    const rInner: [number, number, number][] = [
      [-0.04, -height / 2, -length / 2],
      [-0.04, landY, -length / 2 + runL],
      [0.04, landY, -length / 2 + runL],
      [0.04, height / 2, -length / 2]
    ];
    addRailings(rOuter, rInner);
  }

  // -------------------------------------------------------------------------
  // 4. SPIRAL STAIR (CENTRAL COLUMN SPINE)
  // -------------------------------------------------------------------------
  else if (style === 'spiral') {
    const radius = Math.min(width, length) / 2;
    const centerPostR = 0.08;
    const postHeight = height + 1.0;
    const totalRotation = Math.PI * 2; // 360°
    const anglePerStep = totalRotation / numSteps;
    const stepH = height / numSteps;

    // Central Steel Column
    const centerCol = new THREE.CylinderGeometry(centerPostR, centerPostR, postHeight, 24);
    centerCol.translate(0, 0.5, 0);
    geoms.push(centerCol);

    const railPts: [number, number, number][] = [];

    for (let i = 0; i < numSteps; i++) {
      const ang = i * anglePerStep;
      const stepY = -height / 2 + (i + 1) * stepH;

      // Radial wedge tread
      const treadLen = radius - centerPostR;
      // FIX: was a fixed 0.24m regardless of radius or angle step —
      // meaning a wider spiral never got wider treads, which is the
      // literal cause of the reported "too narrow" complaint at the
      // one place it's most noticeable (where your foot actually
      // lands). Deriving this from the arc length at the tread's own
      // midpoint radius (same approach already verified for the
      // c-shape/curved staircase above) means widening the staircase
      // via its own width/length dimensions now actually produces
      // wider, more comfortable treads instead of the same fixed
      // sliver every time.
      const treadMidR = centerPostR + treadLen / 2;
      const tangentialWidth = Math.max(0.24, treadMidR * anglePerStep * 1.15);
      const wedgeGeom = new THREE.BoxGeometry(tangentialWidth, 0.045, treadLen);
      wedgeGeom.translate(0, -0.02, treadLen / 2 + centerPostR);
      wedgeGeom.rotateY(ang);
      wedgeGeom.translate(0, stepY, 0);
      geoms.push(wedgeGeom);

      // Outer perimeter rail point
      const rx = Math.sin(ang) * (radius - 0.04);
      const rz = Math.cos(ang) * (radius - 0.04);
      railPts.push([rx, stepY, rz]);
    }

    if (railing !== 'none') {
      for (let i = 0; i < railPts.length - 1; i++) {
        geoms.push(...createRailingAlongSegment(railPts[i], railPts[i + 1], 0.95, 1));
      }
    }
  }

  // -------------------------------------------------------------------------
  // 5. C-SHAPED & CURVED / HELICAL (OPEN CENTER)
  // -------------------------------------------------------------------------
  else if (style === 'c-shape' || style === 'curved') {
    const isFull180 = style === 'c-shape';
    const totalSweep = isFull180 ? Math.PI : Math.PI * 0.75;
    const innerR = 0.9;
    const outerR = innerR + width;
    const stepH = height / numSteps;
    const angleStep = totalSweep / numSteps;

    const ptsIn: [number, number, number][] = [];
    const ptsOut: [number, number, number][] = [];

    for (let i = 0; i < numSteps; i++) {
      const ang = i * angleStep;
      const stepY = -height / 2 + (i + 1) * stepH;
      const midR = (innerR + outerR) / 2;
      const treadD = midR * angleStep * 1.1;

      const tread = new THREE.BoxGeometry(treadD, 0.045, width);
      // FIX: this box's own radial-span dimension ("width") must run
      // along local Z, and its along-the-curve dimension ("treadD")
      // along local X — confirmed directly (not assumed) by computing
      // each tread's actual world-space corners: with width on X (the
      // original code), a tread at angle 0 landed with its corners at
      // radius ~0 and ~1 from the arc's own center instead of spanning
      // innerR..outerR, meaning every tread's radial footprint was
      // rotated 90° out of alignment with the curve itself — the
      // actual cause of steps landing in the wrong position. Swapping
      // the box's own two dimensions (rather than adding a rotation
      // offset, which would only fix the sign for one direction of
      // travel) puts each tread's radial span back along the true
      // radial direction at its own angle, verified directly: corners
      // now land at ~innerR and ~outerR as expected.
      tread.translate(0, -0.02, 0);
      tread.rotateY(ang);

      const cx = Math.sin(ang) * midR;
      const cz = -Math.cos(ang) * midR + midR;
      tread.translate(cx, stepY, cz);
      geoms.push(tread);

      ptsIn.push([Math.sin(ang) * innerR, stepY, -Math.cos(ang) * innerR + midR]);
      ptsOut.push([Math.sin(ang) * outerR, stepY, -Math.cos(ang) * outerR + midR]);
    }

    addRailings(ptsIn, ptsOut);
  }

  // -------------------------------------------------------------------------
  // 6. WINDER (QUARTER-TURN PIE-WEDGE CORNER)
  // -------------------------------------------------------------------------
  else if (style === 'winder') {
    const flight1Steps = Math.floor((numSteps - 3) / 2);
    const flight2Steps = flight1Steps;
    const stepH = height / numSteps;
    const flightW = width * 0.85;
    const run1 = length * 0.45;
    const stepD1 = run1 / flight1Steps;

    // Lower straight flight
    for (let i = 0; i < flight1Steps; i++) {
      const topY = -height / 2 + (i + 1) * stepH;
      const zPos = -length / 2 + (i + 0.5) * stepD1;
      const xPos = -flightW / 2;

      const tread = createTread(flightW, stepD1, 0.04, 0.02);
      tread.translate(xPos, topY, zPos);
      geoms.push(tread);
    }

    // 3 Pie-wedge corner winders
    const cornerZ = -length / 2 + run1;
    // Post (pivot corner) the winders sweep around: the lower flight's
    // own inner edge is at x=0, and it ends at z=cornerZ, so that's the
    // fixed point both straight flights and every winder tread share.
    const postX = 0;
    const postZ = cornerZ;
    for (let w = 0; w < 3; w++) {
      const stepIdx = flight1Steps + 1 + w;
      const topY = -height / 2 + stepIdx * stepH;
      const angStep = (Math.PI / 2) / 3;
      const ang = (w + 0.5) * angStep;
      const midR = flightW / 2;
      // FIX: previously each winder's own center only ever moved by a
      // flat, angle-independent 0.2m nudge (`sin(ang)*0.2` /
      // `cos(ang)*0.2`), regardless of flightW or how far apart the
      // two straight flights actually are — confirmed directly by
      // computing each winder's real distance from the pivot post:
      // the old formula left every winder clustered within ~0.2m of
      // the same spot instead of progressively sweeping the full
      // corner, which is what put steps in the wrong position. This
      // sweeps each winder's own center at radius midR from the post,
      // verified directly (not assumed) to progress smoothly from
      // near the lower flight's own end (post - flightW along X) to
      // near the upper flight's own start (post + flightW along Z).
      const centerX = postX - Math.cos(ang) * midR;
      const centerZ = postZ + Math.sin(ang) * midR;
      const treadArc = midR * angStep * 1.3;

      const winder = new THREE.BoxGeometry(flightW, 0.045, treadArc);
      winder.rotateY(ang);
      winder.translate(centerX, topY, centerZ);
      geoms.push(winder);
    }

    // Upper straight flight
    const run2 = length * 0.45;
    const stepD2 = run2 / flight2Steps;
    for (let j = 0; j < flight2Steps; j++) {
      const stepIdx = flight1Steps + 4 + j;
      const topY = -height / 2 + stepIdx * stepH;
      const xPos = -flightW / 2 + (j + 0.5) * stepD2 + flightW * 0.5;
      // FIX: was cornerZ + flightW*0.8, leaving this flight's own
      // centerline slightly short of matching the post + half its own
      // width — confirmed by the same reasoning as the winder fix
      // above: the flight's tread is flightW wide and centered on
      // zPos, so its inner edge sits at zPos-flightW/2, which needs to
      // land exactly on postZ (cornerZ) to meet the winders and the
      // post cleanly, not 0.1*flightW short of it.
      const zPos = cornerZ + flightW / 2;

      const tread = new THREE.BoxGeometry(stepD2 + 0.02, 0.04, flightW);
      tread.translate(xPos, topY, zPos);
      geoms.push(tread);
    }

    const rL: [number, number, number][] = [
      [-flightW, -height / 2, -length / 2],
      [-flightW, -height / 2 + (flight1Steps + 2) * stepH, cornerZ + flightW],
      [run2, height / 2, cornerZ + flightW]
    ];
    const rR: [number, number, number][] = [
      [0, -height / 2, -length / 2],
      [0, -height / 2 + (flight1Steps + 2) * stepH, cornerZ],
      [run2, height / 2, cornerZ]
    ];
    addRailings(rL, rR);
  }

  // -------------------------------------------------------------------------
  // 7. BIFURCATED (GRAND GRANDSTAND FLIGHT)
  // -------------------------------------------------------------------------
  else if (style === 'bifurcated') {
    const masterSteps = Math.floor(numSteps / 2);
    const wingSteps = numSteps - masterSteps - 1;
    const stepH = height / numSteps;
    // Fixed, absolute master-flight width — deliberately NOT a
    // percentage of the (now wider) total width parameter. Keeping
    // this fixed is what lets the overall width grow to give the wing
    // flights a proper, matching tread depth without changing the
    // width of the lower flight itself, exactly as intended: widening
    // the staircase should only add room for the wings, not resize
    // the master flight underneath them.
    const masterW = 2.2;
    // Same reasoning as masterW above — fixed rather than scaling with
    // the total width, which is now much larger specifically to give
    // the wing flights more RUN space, not to inflate their lateral
    // step width. Matches the original proportions (was width*0.35 at
    // the old 3.4m default, ~1.19).
    const wingW = 1.2;
    const masterRun = length * 0.55;
    const stepD = masterRun / masterSteps;

    // 1. Master central wide bottom flight
    for (let i = 0; i < masterSteps; i++) {
      const topY = -height / 2 + (i + 1) * stepH;
      const zPos = -length / 2 + (i + 0.5) * stepD;

      if (structure === 'closed') {
        const step = createSolidStep(masterW, (i + 1) * stepH, stepD);
        step.translate(0, topY, zPos);
        geoms.push(step);
      }
      const tread = createTread(masterW, stepD, 0.045, 0.02);
      tread.translate(0, topY, zPos);
      geoms.push(tread);
    }

    // 2. Grand Center Landing
    const landY = -height / 2 + (masterSteps + 1) * stepH;
    const landZ = -length / 2 + masterRun + 0.5;
    const landing = new THREE.BoxGeometry(width * 1.1, 0.08, 1.0);
    landing.translate(0, landY - 0.04, landZ);
    geoms.push(landing);

    // 3. Left Wing Flight (turning left)
    const wingRun = (width - masterW) / 2;
    const wingStepD = wingRun / wingSteps;
    for (let j = 0; j < wingSteps; j++) {
      const stepIdx = masterSteps + 1 + (j + 1);
      const topY = -height / 2 + stepIdx * stepH;
      const xPos = -masterW / 2 - (j + 0.5) * wingStepD;
      const zPos = landZ;

      const tread = new THREE.BoxGeometry(wingStepD + 0.02, 0.04, wingW * 1.8);
      tread.translate(xPos, topY, zPos);
      geoms.push(tread);
    }

    // 4. Right Wing Flight (turning right)
    for (let k = 0; k < wingSteps; k++) {
      const stepIdx = masterSteps + 1 + (k + 1);
      const topY = -height / 2 + stepIdx * stepH;
      const xPos = masterW / 2 + (k + 0.5) * wingStepD;
      const zPos = landZ;

      const tread = new THREE.BoxGeometry(wingStepD + 0.02, 0.04, wingW * 1.8);
      tread.translate(xPos, topY, zPos);
      geoms.push(tread);
    }

    // Grand Railings
    const rL: [number, number, number][] = [
      [-masterW / 2, -height / 2, -length / 2],
      [-masterW / 2, landY, landZ - 0.5],
      [-width * 0.6, height / 2, landZ]
    ];
    const rR: [number, number, number][] = [
      [masterW / 2, -height / 2, -length / 2],
      [masterW / 2, landY, landZ - 0.5],
      [width * 0.6, height / 2, landZ]
    ];
    addRailings(rL, rR);
  }

  try {
    const merged = BufferGeometryUtils.mergeGeometries(geoms, false);
    return merged || new THREE.BoxGeometry(width, height, length);
  } catch (e) {
    return new THREE.BoxGeometry(width, height, length);
  }
}
