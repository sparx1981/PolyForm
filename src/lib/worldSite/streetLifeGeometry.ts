import * as THREE from 'three';

/**
 * Higher quality but still lightweight WorldView entourage geometry.
 * Kept procedural so Street Life remains fast and does not add model downloads.
 */

function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const nonIndexed = parts.map(p => (p.index ? p.toNonIndexed() : p));
  let count = 0;
  for (const p of nonIndexed) count += p.attributes.position!.count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  let offset = 0;
  for (const p of nonIndexed) {
    pos.set(p.attributes.position!.array as Float32Array, offset * 3);
    nor.set(p.attributes.normal!.array as Float32Array, offset * 3);
    offset += p.attributes.position!.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.computeBoundingSphere();
  return out;
}

function capsule(radius: number, length: number, radial = 18): THREE.BufferGeometry {
  const g = new THREE.CapsuleGeometry(radius, Math.max(0.01, length - radius * 2), 10, radial);
  g.translate(0, -length / 2, 0);
  return g;
}

function ellipsoid(rx: number, ry: number, rz: number, y: number, z = 0, x = 0): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 28, 20);
  g.scale(rx, ry, rz);
  g.translate(x, y, z);
  return g;
}

export const HUMAN = {
  hipY: 0.91,
  hipX: 0.102,
  thighLength: 0.43,
  shoulderY: 1.405,
  shoulderX: 0.205,
};

export function createHumanGeometry() {
  // The torso deliberately avoids the old broad spherical shoulder mass. A tapered rib cage,
  // smaller waist and separate sloping clavicle/shoulder forms produce a recognisably human outline.
  const head = ellipsoid(0.102, 0.125, 0.105, 1.655, 0.008);
  const neck = new THREE.CylinderGeometry(0.047, 0.058, 0.115, 20);
  neck.translate(0, 1.525, 0);

  const ribcage = ellipsoid(0.205, 0.275, 0.132, 1.315);
  const abdomen = ellipsoid(0.145, 0.19, 0.112, 1.105);
  const pelvis = ellipsoid(0.168, 0.135, 0.128, 0.955);

  // Sloping shoulder caps blend the neck into the upper arms without the 'coat hanger' silhouette.
  const leftShoulder = ellipsoid(0.112, 0.075, 0.105, 1.405, 0, -0.16);
  leftShoulder.rotateZ(-0.18);
  const rightShoulder = ellipsoid(0.112, 0.075, 0.105, 1.405, 0, 0.16);
  rightShoulder.rotateZ(0.18);

  const body = mergeAll([head, neck, ribcage, abdomen, pelvis, leftShoulder, rightShoulder]);
  const thigh = capsule(0.078, HUMAN.thighLength + 0.055, 20);
  const shin = capsule(0.061, 0.47, 18);
  const upperArm = capsule(0.052, 0.31, 18);
  const forearm = capsule(0.043, 0.30, 18);

  // Small rounded extremities matter disproportionately to the silhouette at close camera distances.
  const hand = ellipsoid(0.046, 0.073, 0.034, -0.055);
  const foot = ellipsoid(0.072, 0.045, 0.125, -0.035, 0.055);

  return { body, thigh, shin, upperArm, forearm, hand, foot };
}

function roundedSideProfile(points: [number, number][], width: number, bevel = 0.065) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0]![0], points[0]![1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i]![0], points[i]![1]);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 5,
    curveSegments: 8,
  });
  g.translate(0, 0, -width / 2);
  g.rotateY(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

function roundedBox(w: number, h: number, d: number, radius: number, y: number, z: number) {
  const shape = new THREE.Shape();
  const x = -w / 2, yy = -h / 2;
  shape.moveTo(x + radius, yy);
  shape.lineTo(x + w - radius, yy);
  shape.quadraticCurveTo(x + w, yy, x + w, yy + radius);
  shape.lineTo(x + w, yy + h - radius);
  shape.quadraticCurveTo(x + w, yy + h, x + w - radius, yy + h);
  shape.lineTo(x + radius, yy + h);
  shape.quadraticCurveTo(x, yy + h, x, yy + h - radius);
  shape.lineTo(x, yy + radius);
  shape.quadraticCurveTo(x, yy, x + radius, yy);
  const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: true, bevelSize: radius * 0.35, bevelThickness: radius * 0.35, bevelSegments: 4 });
  g.translate(0, 0, -d / 2);
  g.rotateY(Math.PI / 2);
  g.translate(0, y, z);
  g.computeVertexNormals();
  return g;
}

export function createCarGeometry() {
  // A modern compact crossover: smooth shoulder line, wheel-arch-friendly lower body and a clearly
  // separate glasshouse. The extra pieces are still instanced, so visual quality does not multiply draw calls per car.
  const body = roundedSideProfile([
    [-2.12, 0.32], [-2.17, 0.49], [-2.11, 0.69], [-1.78, 0.80],
    [-1.25, 0.88], [1.30, 0.88], [1.80, 0.80], [2.10, 0.66], [2.16, 0.48], [2.08, 0.32],
  ], 1.76, 0.075);

  const cabin = roundedSideProfile([
    [-1.43, 0.93], [-0.92, 1.43], [0.50, 1.42], [1.04, 0.94],
  ], 1.48, 0.045);

  // Roof skin keeps the glazing from reading as one black block.
  const roof = roundedBox(1.54, 0.075, 1.86, 0.10, 1.435, -0.20);

  const wheels: THREE.BufferGeometry[] = [];
  const hubs: THREE.BufferGeometry[] = [];
  for (const z of [-1.31, 1.31]) for (const x of [-0.86, 0.86]) {
    const tyre = new THREE.CylinderGeometry(0.335, 0.335, 0.205, 32);
    tyre.rotateZ(Math.PI / 2); tyre.translate(x, 0.34, z); wheels.push(tyre);
    const hub = new THREE.CylinderGeometry(0.175, 0.175, 0.216, 24);
    hub.rotateZ(Math.PI / 2); hub.translate(x, 0.34, z); hubs.push(hub);
  }

  // Four side windows, front/rear screens and body-coloured pillars create proper vehicle readability.
  const windows: THREE.BufferGeometry[] = [];
  for (const x of [-0.755, 0.755]) {
    for (const z of [-0.55, 0.25]) windows.push(roundedBox(0.035, 0.43, 0.63, 0.055, 1.17, z));
  }
  const windscreen = roundedBox(1.36, 0.43, 0.035, 0.06, 1.17, 0.79);
  const rearScreen = roundedBox(1.34, 0.40, 0.035, 0.06, 1.17, -1.00);
  windows.push(windscreen, rearScreen);

  const pillars: THREE.BufferGeometry[] = [];
  for (const x of [-0.765, 0.765]) pillars.push(roundedBox(0.05, 0.50, 0.075, 0.025, 1.18, -0.15));

  // Separate lamp clusters instead of full-width bars.
  const frontLights: THREE.BufferGeometry[] = [];
  const rearLights: THREE.BufferGeometry[] = [];
  for (const x of [-0.55, 0.55]) {
    frontLights.push(roundedBox(0.43, 0.115, 0.035, 0.04, 0.67, 2.115));
    rearLights.push(roundedBox(0.45, 0.12, 0.035, 0.04, 0.68, -2.105));
  }
  const grille = roundedBox(0.92, 0.18, 0.03, 0.045, 0.47, 2.13);

  return {
    body,
    cabin,
    roof,
    windows: mergeAll(windows),
    pillars: mergeAll(pillars),
    wheels: mergeAll(wheels),
    hubs: mergeAll(hubs),
    frontLights: mergeAll(frontLights),
    rearLights: mergeAll(rearLights),
    grille,
  };
}

export function disposeEntourageGeometry(set: Record<string, THREE.BufferGeometry>) {
  Object.values(set).forEach(g => g.dispose());
}
