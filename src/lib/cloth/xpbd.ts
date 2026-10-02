/**
 * A small, deterministic CPU cloth solver shared by live curtains and by the offline drape bake.
 *
 * Extended position-based dynamics (Macklin, Müller & Chentanez 2016) in the "small steps" form
 * (Macklin et al. 2019): many substeps with one pass over the constraints each. Stiffness is a
 * compliance in s²/kg, so cloth behaves the same whatever the step size or iteration count (a plain
 * position-based solver gets stiffer the more iterations it runs). Constraints are:
 *   - distance (stretch and shear) along every mesh edge and any extra edges you pass in,
 *   - dihedral bending between triangles that share an edge (Müller et al. 2007),
 *   - long-range tethers to pinned particles (Kim et al. 2012), which stop a hanging sheet stretching,
 * and external forces are gravity plus wind acting on the surface through each triangle's normal
 * (drag and lift, Keckeisen et al. 2004), so wind passes over edge-on cloth and fills face-on cloth.
 *
 * The solver has no random numbers and a fixed update order, so the same inputs give bit-identical results.
 */

export interface ClothCollider {
  /**
   * Push a point (x, y, z in `p`) out of the collider if it is within `radius` of or inside it, and
   * return true when it moved. `p` is updated in place.
   */
  resolve(p: Float64Array, radius: number): boolean;
}

/** An oriented box: `rotation` is a row-major 3x3 turning box-local vectors into world ones. */
export class BoxCollider implements ClothCollider {
  private readonly inverse: number[];
  constructor(readonly centre: [number, number, number], readonly half: [number, number, number], rotation?: number[]) {
    const r = rotation ?? [1, 0, 0, 0, 1, 0, 0, 0, 1];
    // Rotation matrices are orthonormal, so the inverse is the transpose.
    this.inverse = [r[0]!, r[3]!, r[6]!, r[1]!, r[4]!, r[7]!, r[2]!, r[5]!, r[8]!];
    this.rotation = r;
  }
  readonly rotation: number[];
  resolve(p: Float64Array, radius: number): boolean {
    const dx = p[0]! - this.centre[0], dy = p[1]! - this.centre[1], dz = p[2]! - this.centre[2];
    const m = this.inverse;
    const lx = m[0]! * dx + m[1]! * dy + m[2]! * dz, ly = m[3]! * dx + m[4]! * dy + m[5]! * dz, lz = m[6]! * dx + m[7]! * dy + m[8]! * dz;
    const hx = this.half[0] + radius, hy = this.half[1] + radius, hz = this.half[2] + radius;
    if (Math.abs(lx) >= hx || Math.abs(ly) >= hy || Math.abs(lz) >= hz) return false;
    // Inside the inflated box: leave through the nearest face.
    const px = hx - Math.abs(lx), py = hy - Math.abs(ly), pz = hz - Math.abs(lz);
    let ox = lx, oy = ly, oz = lz;
    if (py <= px && py <= pz) oy = Math.sign(ly || 1) * hy;
    else if (px <= pz) ox = Math.sign(lx || 1) * hx;
    else oz = Math.sign(lz || 1) * hz;
    const r = this.rotation;
    p[0] = this.centre[0] + r[0]! * ox + r[1]! * oy + r[2]! * oz;
    p[1] = this.centre[1] + r[3]! * ox + r[4]! * oy + r[5]! * oz;
    p[2] = this.centre[2] + r[6]! * ox + r[7]! * oy + r[8]! * oz;
    return true;
  }
}

/** A half-space: points on the far side of the plane (against `normal`) are pushed back to it. */
export class PlaneCollider implements ClothCollider {
  constructor(readonly point: [number, number, number], readonly normal: [number, number, number]) {}
  resolve(p: Float64Array, radius: number): boolean {
    const [nx, ny, nz] = this.normal;
    const d = (p[0]! - this.point[0]) * nx + (p[1]! - this.point[1]) * ny + (p[2]! - this.point[2]) * nz - radius;
    if (d >= 0) return false;
    p[0]! -= d * nx; p[1]! -= d * ny; p[2]! -= d * nz;
    return true;
  }
}

export interface ClothWindForce {
  /** Air velocity in m/s. */
  velocity: [number, number, number];
  /** Pressure on the face-on surface; roughly half the air density times a drag coefficient. */
  drag?: number;
  /** Sideways drag along the surface, much smaller than the pressure on it. */
  lift?: number;
}

export interface ClothSettings {
  /** Stretch and shear compliance (s²/kg). 0 is inextensible; cloth is around 1e-7 to 1e-5. */
  stretchCompliance?: number;
  /** Bending compliance, relative to the mesh (see solveBending). Larger is softer: velvet around 1e-3, stiff canvas near 1e-6. */
  bendCompliance?: number;
  /** Fraction of velocity lost per second (air and internal friction). */
  damping?: number;
  /** Fraction of a contact's sliding motion removed (0 slides freely, 1 sticks). */
  friction?: number;
  /** Distance from a collider surface at which cloth rests, i.e. its half-thickness. */
  thickness?: number;
  gravity?: number;
  /** Mass per square metre, kg/m². Heavier cloth falls the same but holds wind less. */
  density?: number;
}

export interface ClothInput {
  /** xyz per particle. */
  positions: ArrayLike<number>;
  /** Three indices per triangle. */
  triangles: ArrayLike<number>;
  /** Particles that never move (a curtain's heading). */
  pinned?: ArrayLike<number>;
  /** Extra distance constraints as index pairs, e.g. both diagonals of a grid for shear. */
  extraEdges?: ArrayLike<number>;
  /** Stop a free particle stretching beyond its rest distance to the nearest pin (default true). */
  tethers?: boolean;
  settings?: ClothSettings;
}

const DEFAULTS: Required<ClothSettings> = {
  stretchCompliance: 2e-7, bendCompliance: 1e-3, damping: 0.6, friction: 0.5, thickness: 0.01, gravity: 9.81, density: 0.25,
};

export class XpbdCloth {
  readonly count: number;
  readonly positions: Float64Array;
  readonly previous: Float64Array;
  readonly velocities: Float64Array;
  readonly settings: Required<ClothSettings>;
  private readonly triangles: Uint32Array;
  private readonly invMass: Float64Array;
  private readonly edges: Uint32Array;
  private readonly restLength: Float64Array;
  private readonly edgeLambda: Float64Array;
  private readonly bends: Uint32Array;      // 4 per constraint: shared edge (a, b) then far vertices (c, d)
  private readonly bendRest: Float64Array;
  private readonly bendLambda: Float64Array;
  private readonly tetherParticle: Uint32Array;
  private readonly tetherAnchor: Uint32Array;
  private readonly tetherLength: Float64Array;
  private readonly scratch = new Float64Array(3);
  time = 0;

  constructor(input: ClothInput) {
    this.settings = { ...DEFAULTS, ...input.settings };
    this.count = input.positions.length / 3;
    this.positions = Float64Array.from(input.positions);
    this.previous = this.positions.slice();
    this.velocities = new Float64Array(this.count * 3);
    this.triangles = Uint32Array.from(input.triangles);
    // Lumped mass: a third of the area of every triangle around a particle, times the cloth's density.
    const mass = new Float64Array(this.count);
    for (let t = 0; t < this.triangles.length; t += 3) {
      const a = this.triangles[t]!, b = this.triangles[t + 1]!, c = this.triangles[t + 2]!;
      const area = this.triangleArea(this.positions, a, b, c);
      for (const i of [a, b, c]) mass[i] = mass[i]! + (area / 3) * this.settings.density;
    }
    this.invMass = new Float64Array(this.count);
    for (let i = 0; i < this.count; i++) this.invMass[i] = mass[i]! > 1e-12 ? 1 / mass[i]! : 0;
    const pinned = input.pinned ? Array.from(input.pinned) : [];
    for (const i of pinned) this.invMass[i] = 0;

    // Distance constraints: every unique triangle edge plus any extra edges.
    const seen = new Set<number>(), edgeList: number[] = [];
    const addEdge = (a: number, b: number) => {
      const lo = Math.min(a, b), hi = Math.max(a, b), key = lo * this.count + hi;
      if (a === b || seen.has(key)) return;
      seen.add(key); edgeList.push(lo, hi);
    };
    for (let t = 0; t < this.triangles.length; t += 3) {
      const a = this.triangles[t]!, b = this.triangles[t + 1]!, c = this.triangles[t + 2]!;
      addEdge(a, b); addEdge(b, c); addEdge(c, a);
    }
    if (input.extraEdges) for (let e = 0; e < input.extraEdges.length; e += 2) addEdge(input.extraEdges[e]!, input.extraEdges[e + 1]!);
    this.edges = Uint32Array.from(edgeList);
    this.restLength = new Float64Array(this.edges.length / 2);
    for (let e = 0; e < this.restLength.length; e++) this.restLength[e] = this.distance(this.positions, this.edges[e * 2]!, this.edges[e * 2 + 1]!);
    this.edgeLambda = new Float64Array(this.restLength.length);

    // Bending: every interior edge shared by exactly two triangles.
    const owners = new Map<number, number[]>();
    for (let t = 0; t < this.triangles.length; t += 3) for (let k = 0; k < 3; k++) {
      const a = this.triangles[t + k]!, b = this.triangles[t + (k + 1) % 3]!, c = this.triangles[t + (k + 2) % 3]!;
      const key = Math.min(a, b) * this.count + Math.max(a, b);
      const list = owners.get(key) ?? []; list.push(c, a, b); owners.set(key, list);
    }
    const bendList: number[] = [];
    for (const [key, list] of [...owners].sort((x, y) => x[0] - y[0])) {
      if (list.length !== 6) continue;
      bendList.push(Math.floor(key / this.count), key % this.count, list[0]!, list[3]!);
    }
    this.bends = Uint32Array.from(bendList);
    this.bendRest = new Float64Array(this.bends.length / 4);
    for (let k = 0; k < this.bendRest.length; k++) this.bendRest[k] = this.dihedral(this.positions, k) ?? 0;
    this.bendLambda = new Float64Array(this.bendRest.length);

    // Tethers: each free particle may not stray further from its nearest pin than it started.
    const particles: number[] = [], anchors: number[] = [], lengths: number[] = [];
    if (input.tethers !== false && pinned.length) {
      for (let i = 0; i < this.count; i++) {
        if (this.invMass[i] === 0) continue;
        let best = -1, bestDistance = Infinity;
        for (const pin of pinned) { const d = this.distance(this.positions, i, pin); if (d < bestDistance) { bestDistance = d; best = pin; } }
        if (best >= 0) { particles.push(i); anchors.push(best); lengths.push(bestDistance); }
      }
    }
    this.tetherParticle = Uint32Array.from(particles);
    this.tetherAnchor = Uint32Array.from(anchors);
    this.tetherLength = Float64Array.from(lengths);
  }

  /** Total of the particles' kinetic energy: a settled sheet is near zero. */
  kineticEnergy(): number {
    let e = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.invMass[i] === 0) continue;
      const v = this.velocities;
      e += (v[i * 3]! ** 2 + v[i * 3 + 1]! ** 2 + v[i * 3 + 2]! ** 2) / (2 * this.invMass[i]!);
    }
    return e;
  }

  /**
   * Advance by `dt` seconds in `substeps` equal substeps. Colliders are tried in order; `wind` is
   * sampled per triangle each substep.
   */
  step(dt: number, options: { substeps?: number; colliders?: readonly ClothCollider[]; wind?: ClothWindForce; extraAcceleration?: (index: number, out: Float64Array) => void } = {}): void {
    const substeps = Math.max(1, options.substeps ?? 8), h = dt / substeps;
    const colliders = options.colliders ?? [];
    const { stretchCompliance, bendCompliance, damping, gravity, thickness, friction } = this.settings;
    const p = this.positions, prev = this.previous, v = this.velocities, w = this.invMass, s = this.scratch;
    const stretchAlpha = stretchCompliance / (h * h), bendAlpha = bendCompliance / (h * h);
    const keep = Math.exp(-damping * h);
    for (let n = 0; n < substeps; n++) {
      this.time += h;
      if (options.wind) this.applyWind(options.wind, h);
      for (let i = 0; i < this.count; i++) {
        const k = i * 3;
        prev[k] = p[k]!; prev[k + 1] = p[k + 1]!; prev[k + 2] = p[k + 2]!;
        if (w[i] === 0) continue;
        s[0] = 0; s[1] = 0; s[2] = 0;
        options.extraAcceleration?.(i, s);
        v[k] = (v[k]! + s[0]! * h) * keep;
        v[k + 1] = (v[k + 1]! - gravity * h + s[1]! * h) * keep;
        v[k + 2] = (v[k + 2]! + s[2]! * h) * keep;
        p[k] = p[k]! + v[k]! * h; p[k + 1] = p[k + 1]! + v[k + 1]! * h; p[k + 2] = p[k + 2]! + v[k + 2]! * h;
      }
      this.edgeLambda.fill(0); this.bendLambda.fill(0);
      this.solveDistance(stretchAlpha);
      this.solveBending(bendAlpha);
      this.solveTethers();
      if (colliders.length) this.collide(colliders, thickness, friction);
      for (let i = 0; i < this.count; i++) {
        if (w[i] === 0) continue;
        const k = i * 3;
        v[k] = (p[k]! - prev[k]!) / h; v[k + 1] = (p[k + 1]! - prev[k + 1]!) / h; v[k + 2] = (p[k + 2]! - prev[k + 2]!) / h;
      }
    }
  }

  private triangleArea(p: Float64Array, a: number, b: number, c: number): number {
    const ux = p[b * 3]! - p[a * 3]!, uy = p[b * 3 + 1]! - p[a * 3 + 1]!, uz = p[b * 3 + 2]! - p[a * 3 + 2]!;
    const vx = p[c * 3]! - p[a * 3]!, vy = p[c * 3 + 1]! - p[a * 3 + 1]!, vz = p[c * 3 + 2]! - p[a * 3 + 2]!;
    return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }

  private distance(p: Float64Array, a: number, b: number): number {
    return Math.hypot(p[a * 3]! - p[b * 3]!, p[a * 3 + 1]! - p[b * 3 + 1]!, p[a * 3 + 2]! - p[b * 3 + 2]!);
  }

  private solveDistance(alpha: number): void {
    const p = this.positions, w = this.invMass, edges = this.edges;
    for (let e = 0; e < this.restLength.length; e++) {
      const a = edges[e * 2]!, b = edges[e * 2 + 1]!, wa = w[a]!, wb = w[b]!;
      if (wa + wb === 0) continue;
      const dx = p[a * 3]! - p[b * 3]!, dy = p[a * 3 + 1]! - p[b * 3 + 1]!, dz = p[a * 3 + 2]! - p[b * 3 + 2]!;
      const len = Math.hypot(dx, dy, dz);
      if (len < 1e-12) continue;
      const c = len - this.restLength[e]!;
      const dl = (-c - alpha * this.edgeLambda[e]!) / (wa + wb + alpha);
      this.edgeLambda[e] = this.edgeLambda[e]! + dl;
      const f = dl / len;
      p[a * 3] = p[a * 3]! + wa * f * dx; p[a * 3 + 1] = p[a * 3 + 1]! + wa * f * dy; p[a * 3 + 2] = p[a * 3 + 2]! + wa * f * dz;
      p[b * 3] = p[b * 3]! - wb * f * dx; p[b * 3 + 1] = p[b * 3 + 1]! - wb * f * dy; p[b * 3 + 2] = p[b * 3 + 2]! - wb * f * dz;
    }
  }

  private solveTethers(): void {
    const p = this.positions;
    for (let t = 0; t < this.tetherParticle.length; t++) {
      const i = this.tetherParticle[t]!, a = this.tetherAnchor[t]!;
      const dx = p[i * 3]! - p[a * 3]!, dy = p[i * 3 + 1]! - p[a * 3 + 1]!, dz = p[i * 3 + 2]! - p[a * 3 + 2]!;
      const len = Math.hypot(dx, dy, dz), over = len - this.tetherLength[t]!;
      // Unilateral: it stops over-stretching but never pulls inward.
      if (over <= 0 || len < 1e-12) continue;
      const f = over / len;
      p[i * 3] = p[i * 3]! - dx * f; p[i * 3 + 1] = p[i * 3 + 1]! - dy * f; p[i * 3 + 2] = p[i * 3 + 2]! - dz * f;
    }
  }

  /** Dihedral angle of bend constraint `k` for positions `p`, or undefined for a degenerate pair. */
  dihedral(p: Float64Array, k: number): number | undefined {
    return this.prepareBend(k, this.bufLarge, p) === 0 ? undefined : Math.acos(this.bufLarge[39]!);
  }

  /** Gradient of the dihedral angle of constraint `k` with respect to its four particles (12 numbers), for tests. */
  bendGradient(k: number): number[] | undefined {
    const buf = this.bufLarge;
    return this.prepareBend(k, buf) === 2 ? Array.from(buf.slice(15, 27)) : undefined;
  }

  /**
   * Fills buf with the bend's edge, normals and the four gradients (offsets 15..26) and stores cos, l1, l2 at
   * 39..41. Returns 0 for a degenerate pair, 1 for an exactly flat one (angle known, no usable gradient), else 2.
   */
  private prepareBend(k: number, buf: Float64Array, p: Float64Array = this.positions): 0 | 1 | 2 {
    const a = this.bends[k * 4]!, b = this.bends[k * 4 + 1]!, c = this.bends[k * 4 + 2]!, d = this.bends[k * 4 + 3]!;
    const ax = p[a * 3]!, ay = p[a * 3 + 1]!, az = p[a * 3 + 2]!;
    buf[0] = p[b * 3]! - ax; buf[1] = p[b * 3 + 1]! - ay; buf[2] = p[b * 3 + 2]! - az;
    buf[3] = p[c * 3]! - ax; buf[4] = p[c * 3 + 1]! - ay; buf[5] = p[c * 3 + 2]! - az;
    buf[6] = p[d * 3]! - ax; buf[7] = p[d * 3 + 1]! - ay; buf[8] = p[d * 3 + 2]! - az;
    cross3(buf, 9, buf, 0, buf, 3); cross3(buf, 12, buf, 0, buf, 6);
    const l1 = Math.hypot(buf[9]!, buf[10]!, buf[11]!), l2 = Math.hypot(buf[12]!, buf[13]!, buf[14]!);
    if (l1 < 1e-12 || l2 < 1e-12) return 0;
    for (let i = 0; i < 3; i++) { buf[9 + i] = buf[9 + i]! / l1; buf[12 + i] = buf[12 + i]! / l2; }
    const dot = Math.max(-1, Math.min(1, buf[9]! * buf[12]! + buf[10]! * buf[13]! + buf[11]! * buf[14]!));
    buf[39] = dot; buf[40] = l1; buf[41] = l2;
    const sine = Math.sqrt(Math.max(0, 1 - dot * dot));
    if (sine < 1e-4) return 1;
    bendGradients(buf, dot, l1, l2, sine, 15, 18, 21, 24, 27, 30, 33, 36);
    return 2;
  }

  // Scratch for the bending solve: allocation-free so live curtains stay fast.
  private readonly bufLarge = new Float64Array(48);

  private solveBending(alpha: number): void {
    const p = this.positions, w = this.invMass, buf = this.bufLarge;
    for (let k = 0; k < this.bendRest.length; k++) {
      if (this.prepareBend(k, buf) !== 2) continue;
      const a = this.bends[k * 4]!, b = this.bends[k * 4 + 1]!, c = this.bends[k * 4 + 2]!, d = this.bends[k * 4 + 3]!;
      let weighted = w[a]! * (buf[15]! * buf[15]! + buf[16]! * buf[16]! + buf[17]! * buf[17]!)
        + w[b]! * (buf[18]! * buf[18]! + buf[19]! * buf[19]! + buf[20]! * buf[20]!)
        + w[c]! * (buf[21]! * buf[21]! + buf[22]! * buf[22]! + buf[23]! * buf[23]!)
        + w[d]! * (buf[24]! * buf[24]! + buf[25]! * buf[25]! + buf[26]! * buf[26]!);
      // The mass-weighted gradient size depends on the mesh, so bending compliance is relative to it: this
      // makes bendCompliance mean the same on a coarse curtain and a fine bed sheet (c/h² of 1 halves
      // the correction; 1e-3 is soft velvet, 1e-6 near-rigid card at the usual substep size).
      if (weighted < 1e-14) continue;
      const scaled = alpha * weighted;
      const constraint = Math.acos(buf[39]!) - this.bendRest[k]!;
      const dl = (-constraint - scaled * this.bendLambda[k]!) / (weighted + scaled);
      this.bendLambda[k] = this.bendLambda[k]! + dl;
      for (let i = 0; i < 4; i++) {
        const id = i === 0 ? a : i === 1 ? b : i === 2 ? c : d, m = w[id]! * dl, o = 15 + i * 3;
        p[id * 3] = p[id * 3]! + m * buf[o]!; p[id * 3 + 1] = p[id * 3 + 1]! + m * buf[o + 1]!; p[id * 3 + 2] = p[id * 3 + 2]! + m * buf[o + 2]!;
      }
    }
  }

  /** Wind as a force on each triangle, shared among its three corners. */
  private applyWind(wind: ClothWindForce, h: number): void {
    const p = this.positions, v = this.velocities, w = this.invMass, t = this.triangles;
    const drag = wind.drag ?? 0.6, lift = wind.lift ?? 0.12;
    for (let k = 0; k < t.length; k += 3) {
      const a = t[k]!, b = t[k + 1]!, c = t[k + 2]!;
      const ux = p[b * 3]! - p[a * 3]!, uy = p[b * 3 + 1]! - p[a * 3 + 1]!, uz = p[b * 3 + 2]! - p[a * 3 + 2]!;
      const vx = p[c * 3]! - p[a * 3]!, vy = p[c * 3 + 1]! - p[a * 3 + 1]!, vz = p[c * 3 + 2]! - p[a * 3 + 2]!;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const twice = Math.hypot(nx, ny, nz);
      if (twice < 1e-12) continue;
      const area = twice / 2;
      nx /= twice; ny /= twice; nz /= twice;
      // Air speed relative to the triangle's own motion.
      const rx = wind.velocity[0] - (v[a * 3]! + v[b * 3]! + v[c * 3]!) / 3;
      const ry = wind.velocity[1] - (v[a * 3 + 1]! + v[b * 3 + 1]! + v[c * 3 + 1]!) / 3;
      const rz = wind.velocity[2] - (v[a * 3 + 2]! + v[b * 3 + 2]! + v[c * 3 + 2]!) / 3;
      const normal = rx * nx + ry * ny + rz * nz;
      // Pressure along the normal grows with the square of the face-on speed; the part along the surface is a light drag.
      const pressure = drag * area * normal * Math.abs(normal);
      const fx = pressure * nx + lift * area * (rx - normal * nx);
      const fy = pressure * ny + lift * area * (ry - normal * ny);
      const fz = pressure * nz + lift * area * (rz - normal * nz);
      for (let corner = 0; corner < 3; corner++) {
        const i = corner === 0 ? a : corner === 1 ? b : c;
        if (w[i] === 0) continue;
        v[i * 3] = v[i * 3]! + (fx / 3) * w[i]! * h; v[i * 3 + 1] = v[i * 3 + 1]! + (fy / 3) * w[i]! * h; v[i * 3 + 2] = v[i * 3 + 2]! + (fz / 3) * w[i]! * h;
      }
    }
  }

  private collide(colliders: readonly ClothCollider[], thickness: number, friction: number): void {
    const p = this.positions, prev = this.previous, w = this.invMass, s = this.scratch;
    for (let i = 0; i < this.count; i++) {
      if (w[i] === 0) continue;
      const k = i * 3;
      s[0] = p[k]!; s[1] = p[k + 1]!; s[2] = p[k + 2]!;
      let hit = false;
      for (const collider of colliders) if (collider.resolve(s, thickness)) hit = true;
      if (!hit) continue;
      // Contact friction: take back some of the sliding the particle did this substep, along the surface only.
      const mx = s[0]! - p[k]!, my = s[1]! - p[k + 1]!, mz = s[2]! - p[k + 2]!, push = Math.hypot(mx, my, mz);
      if (push > 1e-12 && friction > 0) {
        const nx = mx / push, ny = my / push, nz = mz / push;
        const dx = s[0]! - prev[k]!, dy = s[1]! - prev[k + 1]!, dz = s[2]! - prev[k + 2]!;
        const along = dx * nx + dy * ny + dz * nz;
        const tx = dx - along * nx, ty = dy - along * ny, tz = dz - along * nz;
        const slide = Math.hypot(tx, ty, tz);
        // Coulomb: friction can remove at most `friction` times the push-out as sliding.
        const remove = slide > 1e-12 ? Math.min(1, (friction * push) / slide) : 0;
        s[0] = s[0]! - tx * remove; s[1] = s[1]! - ty * remove; s[2] = s[2]! - tz * remove;
      }
      p[k] = s[0]!; p[k + 1] = s[1]!; p[k + 2] = s[2]!;
    }
  }
}

function cross3(out: Float64Array, o: number, a: Float64Array, ia: number, b: Float64Array, ib: number): void {
  const ax = a[ia]!, ay = a[ia + 1]!, az = a[ia + 2]!, bx = b[ib]!, by = b[ib + 1]!, bz = b[ib + 2]!;
  out[o] = ay * bz - az * by; out[o + 1] = az * bx - ax * bz; out[o + 2] = ax * by - ay * bx;
}

/**
 * Gradients of the dihedral angle (Müller et al. 2007, eq. 25-27) into buf at g1..g4, from the edge, the two far
 * vertices and the two unit normals already in buf (layout shared with solveBending).
 */
function bendGradients(buf: Float64Array, dot: number, l1: number, l2: number, sine: number, g1: number, g2: number, g3: number, g4: number, t1: number, t2: number, t3: number, t4: number): void {
  const E = 0, U = 3, V = 6, N1 = 9, N2 = 12;
  // q3 = (e x n2 + (n1 x e) d) / l1
  cross3(buf, t1, buf, E, buf, N2); cross3(buf, t2, buf, N1, buf, E);
  // q4 = (e x n1 + (n2 x e) d) / l2
  cross3(buf, t3, buf, E, buf, N1); cross3(buf, t4, buf, N2, buf, E);
  for (let i = 0; i < 3; i++) {
    buf[g3 + i] = (buf[t1 + i]! + buf[t2 + i]! * dot) / l1;
    buf[g4 + i] = (buf[t3 + i]! + buf[t4 + i]! * dot) / l2;
  }
  // q2 = -(u x n2 + (n1 x u) d) / l1 - (v x n1 + (n2 x v) d) / l2
  cross3(buf, t1, buf, U, buf, N2); cross3(buf, t2, buf, N1, buf, U);
  cross3(buf, t3, buf, V, buf, N1); cross3(buf, t4, buf, N2, buf, V);
  for (let i = 0; i < 3; i++) {
    buf[g2 + i] = -(buf[t1 + i]! + buf[t2 + i]! * dot) / l1 - (buf[t3 + i]! + buf[t4 + i]! * dot) / l2;
    buf[g1 + i] = -buf[g2 + i]! - buf[g3 + i]! - buf[g4 + i]!;
  }
  // dC/dp = (1/sin) * q for this triangle winding (see the finite-difference test).
  for (let i = 0; i < 3; i++) { buf[g1 + i] = buf[g1 + i]! / sine; buf[g2 + i] = buf[g2 + i]! / sine; buf[g3 + i] = buf[g3 + i]! / sine; buf[g4 + i] = buf[g4 + i]! / sine; }
}

/** Triangles and extra shear edges for a (columns+1) x (rows+1) grid of particles, row-major. */
export function gridTopology(columns: number, rows: number): { triangles: number[]; extraEdges: number[] } {
  const triangles: number[] = [], extraEdges: number[] = [];
  const at = (x: number, y: number) => y * (columns + 1) + x;
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const a = at(x, y), b = at(x + 1, y), c = at(x, y + 1), d = at(x + 1, y + 1);
    // Alternate the diagonal so there is no preferred shear direction.
    if ((x + y) % 2 === 0) { triangles.push(a, c, b, b, c, d); extraEdges.push(a, d); }
    else { triangles.push(a, c, d, a, d, b); extraEdges.push(b, c); }
  }
  return { triangles, extraEdges };
}
