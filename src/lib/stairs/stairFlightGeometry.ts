import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { StairStyleType, StairStructureType, RailingModeType } from '../archStairGenerator';

/**
 * stairFlightGeometry.ts
 * ----------------------
 * StairFix Phase 1/2: single source of truth for per-style staircase flight
 * geometry.
 *
 * BEFORE this refactor, the correct per-style algorithms (straight, l-shape,
 * u-shape, c-shape, winder, spiral, curved, bifurcated) lived only inside
 * `archStairGenerator.ts`'s `createArchitecturalStaircaseGeometry`, and the
 * parametric entry point (`createParametricStaircaseGeometry` in
 * `parametricStairs.ts`) had its own, separate, straight-run-only
 * implementation. Because `Viewport.tsx` calls the parametric entry point
 * directly whenever `shape.isParametric` is true (without ever routing
 * through `createArchitecturalStaircaseGeometry`), every parametric
 * staircase silently rendered as a straight flight regardless of the style
 * the user selected.
 *
 * AFTER this refactor, `buildStairFlightGeometry()` is the ONLY place the
 * 8 per-style algorithms are implemented. Both the static path
 * (`createArchitecturalStaircaseGeometry`) and the parametric path
 * (`createParametricStaircaseGeometry`, for every style except the
 * legacy-preserved 'straight' fast-path) call this exact same function with
 * the exact same style identifiers. A style mismatch between static and
 * parametric output is now a structural impossibility rather than something
 * that has to be caught by a test.
 *
 * Do not duplicate any of this logic elsewhere. If a 9th style is ever
 * added, it goes here, once.
 */

export interface StairFlightParams {
  /** One of the 8 supported style identifiers (see archStairGenerator.ts). */
  style: StairStyleType | string;
  width: number;
  height: number;
  length: number;
  numSteps: number;
  structure: StairStructureType;
  railing: RailingModeType;
}

/** Builds a single rectangular tread plank with front nosing. */
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

/** Builds a solid step block (closed rise & run). */
function createSolidStep(w: number, h: number, d: number): THREE.BufferGeometry {
  const geom = new THREE.BoxGeometry(w, h, d);
  geom.translate(0, -h / 2, 0);
  return geom;
}

/** Builds an angled side stringer board. */
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

/** Builds a central mono-stringer spine beam. */
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

/** Builds balustrades & handrail along a line path. */
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

  const postGeom1 = new THREE.BoxGeometry(0.06, railHeight, 0.06);
  postGeom1.translate(pStart[0], pStart[1] + railHeight / 2, pStart[2]);
  geoms.push(postGeom1);

  const postGeom2 = new THREE.BoxGeometry(0.06, railHeight, 0.06);
  postGeom2.translate(pEnd[0], pEnd[1] + railHeight / 2, pEnd[2]);
  geoms.push(postGeom2);

  const handrailStart = vStart.clone().add(new THREE.Vector3(0, railHeight, 0));
  const handrailEnd = vEnd.clone().add(new THREE.Vector3(0, railHeight, 0));
  const handrailMid = handrailStart.clone().lerp(handrailEnd, 0.5);

  const railBar = new THREE.BoxGeometry(0.05, 0.04, totalDist);
  const dir = delta.clone().normalize();
  const orientationQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  railBar.applyQuaternion(orientationQuat);
  railBar.translate(handrailMid.x, handrailMid.y, handrailMid.z);
  geoms.push(railBar);

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
 * Builds the correct flight/tread/riser/stringer/railing geometry for
 * exactly one of the 8 supported staircase styles. Pure function: given the
 * same params, always returns geometrically equivalent output — this is
 * what makes static/parametric parity testable and guaranteed.
 */
export function buildStairFlightGeometry(params: StairFlightParams): THREE.BufferGeometry {
  const width = params.width;
  const height = params.height;
  const length = params.length;
  const numSteps = Math.max(4, params.numSteps || 14);
  const style = (params.style || 'straight').toString().toLowerCase();
  const structure = params.structure || 'closed';
  const railing = params.railing || 'both';

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

        const bracket = new THREE.BoxGeometry(0.08, 0.12, 0.14);
        bracket.translate(-width / 2 + 0.04, topY - 0.06, centerZ);
        geoms.push(bracket);
      } else if (structure === 'mono-stringer') {
        const tread = createTread(width, stepD, 0.045, 0.02);
        tread.translate(0, topY, centerZ);
        geoms.push(tread);

        const plate = new THREE.BoxGeometry(0.3, 0.015, stepD * 0.7);
        plate.translate(0, topY - 0.05, centerZ);
        geoms.push(plate);
      }
    }

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

    const landY = -height / 2 + (flight1Steps + 1) * stepH;
    const landZ = -length / 2 + run1 + landingSize / 2;
    const landX = -flightW / 2;
    const landing = new THREE.BoxGeometry(landingSize, 0.06, landingSize);
    landing.translate(landX, landY - 0.03, landZ);
    geoms.push(landing);

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

    const landY = -height / 2 + (flightSteps + 1) * stepH;
    const landZ = -length / 2 + runL + landD / 2;
    const landing = new THREE.BoxGeometry(width, 0.06, landD);
    landing.translate(0, landY - 0.03, landZ);
    geoms.push(landing);

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
    const totalRotation = Math.PI * 2;
    const anglePerStep = totalRotation / numSteps;
    const stepH = height / numSteps;

    const centerCol = new THREE.CylinderGeometry(centerPostR, centerPostR, postHeight, 24);
    centerCol.translate(0, 0.5, 0);
    geoms.push(centerCol);

    const railPts: [number, number, number][] = [];

    for (let i = 0; i < numSteps; i++) {
      const ang = i * anglePerStep;
      const stepY = -height / 2 + (i + 1) * stepH;

      const treadLen = radius - centerPostR;
      const treadMidR = centerPostR + treadLen / 2;
      const tangentialWidth = Math.max(0.24, treadMidR * anglePerStep * 1.15);
      const wedgeGeom = new THREE.BoxGeometry(tangentialWidth, 0.045, treadLen);
      wedgeGeom.translate(0, -0.02, treadLen / 2 + centerPostR);
      wedgeGeom.rotateY(ang);
      wedgeGeom.translate(0, stepY, 0);
      geoms.push(wedgeGeom);

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

    for (let i = 0; i < flight1Steps; i++) {
      const topY = -height / 2 + (i + 1) * stepH;
      const zPos = -length / 2 + (i + 0.5) * stepD1;
      const xPos = -flightW / 2;

      const tread = createTread(flightW, stepD1, 0.04, 0.02);
      tread.translate(xPos, topY, zPos);
      geoms.push(tread);
    }

    const cornerZ = -length / 2 + run1;
    const postX = 0;
    const postZ = cornerZ;
    for (let w = 0; w < 3; w++) {
      const stepIdx = flight1Steps + 1 + w;
      const topY = -height / 2 + stepIdx * stepH;
      const angStep = (Math.PI / 2) / 3;
      const ang = (w + 0.5) * angStep;
      const midR = flightW / 2;
      const centerX = postX - Math.cos(ang) * midR;
      const centerZ = postZ + Math.sin(ang) * midR;
      const treadArc = midR * angStep * 1.3;

      const winder = new THREE.BoxGeometry(flightW, 0.045, treadArc);
      winder.rotateY(ang);
      winder.translate(centerX, topY, centerZ);
      geoms.push(winder);
    }

    const run2 = length * 0.45;
    const stepD2 = run2 / flight2Steps;
    for (let j = 0; j < flight2Steps; j++) {
      const stepIdx = flight1Steps + 4 + j;
      const topY = -height / 2 + stepIdx * stepH;
      const xPos = -flightW / 2 + (j + 0.5) * stepD2 + flightW * 0.5;
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
    const masterW = 2.2;
    const wingW = 1.2;
    const masterRun = length * 0.55;
    const stepD = masterRun / masterSteps;

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

    const landY = -height / 2 + (masterSteps + 1) * stepH;
    const landBackZ = -length / 2 + masterRun;
    const landDepth = wingW + 0.3;
    const landZ = landBackZ + landDepth / 2;
    const landing = new THREE.BoxGeometry(masterW + 0.6, 0.08, landDepth);
    landing.translate(0, landY - 0.04, landZ);
    geoms.push(landing);

    const wingStepD = stepD;
    const wingStartX = masterW / 2 + 0.1;
    const wingZ = landZ;

    for (let j = 0; j < wingSteps; j++) {
      const stepIdx = masterSteps + 1 + (j + 1);
      const topY = -height / 2 + stepIdx * stepH;
      const xPos = -(wingStartX + (j + 0.5) * wingStepD);

      if (structure === 'closed') {
        const prevY = j === 0 ? landY : -height / 2 + (stepIdx - 1) * stepH;
        const riser = new THREE.BoxGeometry(wingStepD + 0.02, topY - prevY, wingW);
        riser.translate(xPos, (topY + prevY) / 2, wingZ);
        geoms.push(riser);
      }
      const tread = new THREE.BoxGeometry(wingStepD + 0.02, 0.04, wingW);
      tread.translate(xPos, topY, wingZ);
      geoms.push(tread);
    }

    for (let k = 0; k < wingSteps; k++) {
      const stepIdx = masterSteps + 1 + (k + 1);
      const topY = -height / 2 + stepIdx * stepH;
      const xPos = wingStartX + (k + 0.5) * wingStepD;

      if (structure === 'closed') {
        const prevY = k === 0 ? landY : -height / 2 + (stepIdx - 1) * stepH;
        const riser = new THREE.BoxGeometry(wingStepD + 0.02, topY - prevY, wingW);
        riser.translate(xPos, (topY + prevY) / 2, wingZ);
        geoms.push(riser);
      }
      const tread = new THREE.BoxGeometry(wingStepD + 0.02, 0.04, wingW);
      tread.translate(xPos, topY, wingZ);
      geoms.push(tread);
    }

    const wingRun = wingSteps * wingStepD;
    const wingTopX = wingStartX + wingRun;
    const railZ = wingZ + wingW / 2;
    const nearZ = wingZ - wingW / 2;
    const rL1: [number, number, number][] = [
      [-masterW / 2, -height / 2, -length / 2],
      [-masterW / 2, landY, landBackZ],
      [-masterW / 2, landY, nearZ]
    ];
    const rR1: [number, number, number][] = [
      [masterW / 2, -height / 2, -length / 2],
      [masterW / 2, landY, landBackZ],
      [masterW / 2, landY, nearZ]
    ];
    addRailings(rL1, rR1);

    const rL2: [number, number, number][] = [
      [-wingStartX, landY, railZ],
      [-wingTopX, height / 2, railZ]
    ];
    const rR2: [number, number, number][] = [
      [wingStartX, landY, railZ],
      [wingTopX, height / 2, railZ]
    ];
    addRailings(rL2, rR2);
  }

  try {
    const merged = BufferGeometryUtils.mergeGeometries(geoms.map(g => g.index ? g.toNonIndexed() : g), false);
    return merged || new THREE.BoxGeometry(width, height, length);
  } catch (e) {
    return new THREE.BoxGeometry(width, height, length);
  }
}
