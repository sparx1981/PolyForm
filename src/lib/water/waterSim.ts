import * as THREE from 'three';

/**
 * Shared shallow-water surface for every water body, ported from Clearwater
 * (github.com/Aureliengmz/clearwater, MIT): a Tessendorf FFT height field over a small
 * seamlessly tiling patch, plus a caustics texture made by refracting a dense grid of sun
 * rays through that surface onto a flat bed and measuring how the grid cells compress.
 *
 * Outputs (both tile with the patch size L):
 * - surface: r = height, g/b = slope (dh/dx, dh/dz), a = |slope|² (for glint widening)
 * - caustics: rgb light concentration on the bed (1 = flat water), per-channel IOR for fringes
 */
export const WATER_PATCH = 4.6;     // metres
const N = 256, LOG_N = 8;
const TARGET_SLOPE = 0.078;
const CAUSTIC_GRID = 192, CAUSTIC_SIZE = 512, CAUSTIC_DEPTH = 1.2;
const IORS = [1.3315, 1.3335, 1.3365];

function mulberry(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Initial spectrum h0(k) and conj(h0(-k)), scaled to a target RMS slope. */
export function buildInitialSpectrum(seed = 7): Float32Array {
  const rnd = mulberry(seed);
  const gauss = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
  const kp = 2 * Math.PI / 0.62, kcut = 2 * Math.PI / 0.045, wind = [0.8, 0.6];
  const re = new Float32Array(N * N), im = new Float32Array(N * N);
  let s2 = 0;
  for (let m = 0; m < N; m++) for (let n = 0; n < N; n++) {
    const nx = n < N / 2 ? n : n - N, nz = m < N / 2 ? m : m - N;
    const kx = 2 * Math.PI * nx / WATER_PATCH, kz = 2 * Math.PI * nz / WATER_PATCH, k = Math.hypot(kx, kz);
    let power = 0;
    if (k > 1e-6) {
      const lk = Math.log(k / kp);
      const bump = Math.exp(-0.5 * (lk / 0.36) ** 2);
      const tail = 0.035 * Math.exp(-((kp / k) ** 2)) * Math.exp(-((k / kcut) ** 2));
      const swell = 0.35 * Math.exp(-0.5 * (Math.log(k / (2 * Math.PI / 1.6)) / 0.3) ** 2);
      const c = (kx * wind[0] + kz * wind[1]) / k;
      const spread = (0.3 + 0.7 * c * c) * (c < 0 ? 0.35 : 1);
      power = (bump + tail + swell) * spread / (k ** 4);
    }
    const a = Math.sqrt(power / 2), i = m * N + n;
    re[i] = gauss() * a; im[i] = gauss() * a;
    s2 += 2 * k * k * (re[i] * re[i] + im[i] * im[i]);
  }
  const scale = TARGET_SLOPE / Math.sqrt(s2);
  const data = new Float32Array(N * N * 4);
  for (let m = 0; m < N; m++) for (let n = 0; n < N; n++) {
    const i = m * N + n, j = ((N - m) % N) * N + ((N - n) % N);
    data[i * 4] = re[i] * scale; data[i * 4 + 1] = im[i] * scale;
    data[i * 4 + 2] = re[j] * scale; data[i * 4 + 3] = -im[j] * scale;
  }
  return data;
}

const quadVertex = /* glsl */ `
precision highp float;
in vec3 position;
out vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const spectrumFragment = /* glsl */ `
precision highp float;
uniform sampler2D uH0; uniform float uT, uL;
out vec4 o;
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
void main() {
  ivec2 id = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(uH0, id, 0);
  vec2 n = vec2(id); n -= step(${N / 2}.0, n) * ${N}.0;
  vec2 k = 6.28318530718 * n / uL; float kl = length(k);
  float w = sqrt(9.81 * kl + 7.4e-5 * kl * kl * kl);
  float w0 = 6.28318530718 / 60.0; w = floor(w / w0) * w0;   // loops seamlessly every 60 s
  float c = cos(w * uT), sn = sin(w * uT);
  vec2 H = cmul(s.xy, vec2(c, sn)) + cmul(s.zw, vec2(c, -sn));
  vec2 C1 = H - k.x * H;
  vec2 C2 = vec2(-k.y * H.y, k.y * H.x);
  o = vec4(C1, C2);
}`;

const fftFragment = /* glsl */ `
precision highp float;
uniform sampler2D uSrc; uniform int uP, uHoriz;
out vec4 o;
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
void main() {
  ivec2 id = ivec2(gl_FragCoord.xy);
  int j = uHoriz == 1 ? id.x : id.y;
  int k = j & (uP - 1);
  int i = ((j - (j & (2 * uP - 1))) >> 1) + k;
  bool y1 = (j & uP) != 0;
  ivec2 a = uHoriz == 1 ? ivec2(i, id.y) : ivec2(id.x, i);
  ivec2 b = uHoriz == 1 ? ivec2(i + ${N / 2}, id.y) : ivec2(id.x, i + ${N / 2});
  vec4 x0 = texelFetch(uSrc, a, 0), x1 = texelFetch(uSrc, b, 0);
  float ang = 3.14159265359 * float(k) / float(uP);
  vec2 w = vec2(cos(ang), sin(ang));
  vec4 wx = vec4(cmul(w, x1.xy), cmul(w, x1.zw));
  o = y1 ? x0 - wx : x0 + wx;
}`;

const resolveFragment = /* glsl */ `
precision highp float;
uniform sampler2D uSrc;
out vec4 o;
void main() {
  vec4 s = texelFetch(uSrc, ivec2(gl_FragCoord.xy), 0);
  vec2 slope = vec2(s.y, s.z);
  o = vec4(s.x, slope, dot(slope, slope));
}`;

const causticVertex = /* glsl */ `
precision highp float; precision highp sampler2D;
in vec3 position;
uniform sampler2D uSurf; uniform float uL, uDepth, uIor; uniform vec3 uSun; uniform vec2 uShift;
out vec2 vSrc;
void main() {
  vec2 uv = position.xy;
  ivec2 off = ivec2(gl_InstanceID % 3 - 1, gl_InstanceID / 3 - 1);
  vec4 s = textureLod(uSurf, uv, 0.0);
  vec3 n = normalize(vec3(-s.y, 1.0, -s.z));
  vec3 r = refract(-uSun, n, 1.0 / uIor);
  vec3 P = vec3(uv.x * uL, s.x, uv.y * uL);
  vec3 F = P + r * ((-uDepth - s.x) / r.y);
  vSrc = uv * uL;
  vec2 c = (F.xz - uShift) / uL + vec2(off);
  gl_Position = vec4(c * 2.0 - 1.0, 0.0, 1.0);
}`;

const causticFragment = /* glsl */ `
precision highp float;
in vec2 vSrc; uniform float uNorm; uniform vec3 uMask;
out vec4 o;
void main() {
  vec2 a = dFdx(vSrc), b = dFdy(vSrc);
  float area = abs(a.x * b.y - a.y * b.x);
  o = vec4(uMask * min(area * uNorm, 40.0), 1.0);
}`;

function pass(fragmentShader: string, uniforms: Record<string, THREE.IUniform>) {
  return new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: quadVertex, fragmentShader, uniforms, depthTest: false, depthWrite: false });
}

export class WaterSim {
  readonly surface: THREE.WebGLRenderTarget;
  readonly caustics: THREE.WebGLRenderTarget;
  private readonly h0: THREE.DataTexture;
  private readonly fftA: THREE.WebGLRenderTarget;
  private readonly fftB: THREE.WebGLRenderTarget;
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  private readonly spectrum: THREE.RawShaderMaterial;
  private readonly fft: THREE.RawShaderMaterial;
  private readonly resolve: THREE.RawShaderMaterial;
  private readonly causticMesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.RawShaderMaterial>;
  private readonly scene = new THREE.Scene();
  private causticSun = new THREE.Vector3();
  /** Where the caustic pattern is shifted to keep it registered under a slanted sun. */
  readonly causticShift = new THREE.Vector2();

  constructor() {
    const floatTarget = (size: number, wrap: THREE.Wrapping, filter: THREE.MagnificationTextureFilter, mip = false) =>
      new THREE.WebGLRenderTarget(size, size, {
        type: THREE.HalfFloatType, format: THREE.RGBAFormat, wrapS: wrap, wrapT: wrap,
        magFilter: filter, minFilter: mip ? THREE.LinearMipmapLinearFilter : filter === THREE.NearestFilter ? THREE.NearestFilter : THREE.LinearFilter,
        generateMipmaps: mip, depthBuffer: false,
      });
    this.h0 = new THREE.DataTexture(buildInitialSpectrum(), N, N, THREE.RGBAFormat, THREE.FloatType);
    this.h0.minFilter = this.h0.magFilter = THREE.NearestFilter; this.h0.needsUpdate = true;
    this.fftA = new THREE.WebGLRenderTarget(N, N, { type: THREE.FloatType, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, depthBuffer: false });
    this.fftB = this.fftA.clone();
    this.surface = floatTarget(N, THREE.RepeatWrapping, THREE.LinearFilter, true);
    this.surface.texture.anisotropy = 8;
    this.caustics = floatTarget(CAUSTIC_SIZE, THREE.RepeatWrapping, THREE.LinearFilter, true);

    this.spectrum = pass(spectrumFragment, { uH0: { value: this.h0 }, uT: { value: 0 }, uL: { value: WATER_PATCH } });
    this.fft = pass(fftFragment, { uSrc: { value: null }, uP: { value: 1 }, uHoriz: { value: 1 } });
    this.resolve = pass(resolveFragment, { uSrc: { value: null } });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.spectrum);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    // Caustic grid: one vertex per ray, drawn 9 times (3×3 tiles) so wrapped rays land correctly.
    const grid = new THREE.PlaneGeometry(1, 1, CAUSTIC_GRID, CAUSTIC_GRID);
    grid.translate(0.5, 0.5, 0);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', grid.getAttribute('position'));
    geometry.setIndex(grid.getIndex());
    geometry.instanceCount = 9;
    const material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: causticVertex, fragmentShader: causticFragment,
      uniforms: {
        uSurf: { value: this.surface.texture }, uL: { value: WATER_PATCH }, uDepth: { value: CAUSTIC_DEPTH },
        uIor: { value: IORS[1] }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uShift: { value: new THREE.Vector2() },
        uNorm: { value: (CAUSTIC_SIZE / WATER_PATCH) ** 2 }, uMask: { value: new THREE.Vector3(1, 0, 0) },
      },
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true, side: THREE.DoubleSide,
    });
    this.causticMesh = new THREE.Mesh(geometry, material);
    this.causticMesh.frustumCulled = false;
  }

  /** Advances the waves to `time` seconds and, when the sun moved, refreshes the caustics. */
  update(renderer: THREE.WebGLRenderer, time: number, sunDirection: THREE.Vector3) {
    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    const previousClearColor = renderer.getClearColor(new THREE.Color()), previousClearAlpha = renderer.getClearAlpha();
    renderer.autoClear = true;

    this.quad.material = this.spectrum;
    this.spectrum.uniforms.uT.value = time;
    renderer.setRenderTarget(this.fftA);
    renderer.render(this.scene, this.camera);
    let source = this.fftA, destination = this.fftB;
    this.quad.material = this.fft;
    for (let horizontal = 1; horizontal >= 0; horizontal--) {
      for (let s = 0; s < LOG_N; s++) {
        this.fft.uniforms.uSrc.value = source.texture;
        this.fft.uniforms.uP.value = 1 << s;
        this.fft.uniforms.uHoriz.value = horizontal;
        renderer.setRenderTarget(destination);
        renderer.render(this.scene, this.camera);
        [source, destination] = [destination, source];
      }
    }
    this.quad.material = this.resolve;
    this.resolve.uniforms.uSrc.value = source.texture;
    renderer.setRenderTarget(this.surface);
    renderer.render(this.scene, this.camera);

    this.renderCaustics(renderer, sunDirection);
    renderer.setRenderTarget(previousTarget);
    renderer.autoClear = previousAutoClear;
    renderer.setClearColor(previousClearColor, previousClearAlpha);
  }

  private renderCaustics(renderer: THREE.WebGLRenderer, sun: THREE.Vector3) {
    const direction = this.causticSun.copy(sun);
    if (direction.y < 0.05) direction.y = 0.05;
    direction.normalize();
    // Flat-surface refraction shift keeps the pattern registered with the sun direction.
    const sinI = Math.sqrt(1 - direction.y ** 2), sinT = sinI / IORS[1], tanT = sinT / Math.sqrt(1 - sinT * sinT);
    const horizontal = Math.hypot(direction.x, direction.z) || 1;
    this.causticShift.set(-direction.x / horizontal * CAUSTIC_DEPTH * tanT, -direction.z / horizontal * CAUSTIC_DEPTH * tanT);
    const uniforms = this.causticMesh.material.uniforms;
    uniforms.uSun.value.copy(direction);
    uniforms.uShift.value.copy(this.causticShift);
    renderer.setRenderTarget(this.caustics);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.autoClear = false;
    const masks = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
    for (let c = 0; c < 3; c++) {
      uniforms.uIor.value = IORS[c];
      uniforms.uMask.value.copy(masks[c]);
      renderer.render(this.causticMesh, this.camera);
    }
  }

  dispose() {
    [this.fftA, this.fftB, this.surface, this.caustics].forEach(target => target.dispose());
    this.h0.dispose();
    [this.spectrum, this.fft, this.resolve, this.causticMesh.material].forEach(material => material.dispose());
    this.quad.geometry.dispose(); this.causticMesh.geometry.dispose();
  }
}
