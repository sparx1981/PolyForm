import * as THREE from 'three';
import { finite } from './shaderHooks';

export type WeatherKind = 'rain' | 'snow' | 'clouds' | 'mist';
export interface WeatherLayerOptions {
  count: number;
  size: number;
  opacity: number;
  speed: number;
  gravity: number;
  turbulence: number;
  color: THREE.ColorRepresentation;
}
export interface WeatherOptions {
  bounds?: THREE.Vector3;
  wind?: THREE.Vector2;
  seed?: number;
  layers?: Partial<Record<WeatherKind, Partial<WeatherLayerOptions>>>;
}
export const WEATHER_DEFAULTS: Record<WeatherKind, WeatherLayerOptions> = {
  rain: { count: 12000, size: 0.3, opacity: 0.45, speed: 14, gravity: 9.81, turbulence: 0.02, color: '#b9d7ee' },
  snow: { count: 6000, size: 0.12, opacity: 0.8, speed: 0.8, gravity: 0.3, turbulence: 0.7, color: '#ffffff' },
  clouds: { count: 100, size: 14, opacity: 0.13, speed: 0, gravity: 0, turbulence: 0.35, color: '#e2e8ee' },
  mist: { count: 180, size: 7, opacity: 0.065, speed: 0, gravity: 0, turbulence: 0.12, color: '#ced7df' },
};

const vertexShader = /* glsl */ `
attribute vec4 seed;
uniform float time;
uniform vec3 bounds;
uniform vec2 wind;
uniform float fallSpeed;
uniform float gravity;
uniform float turbulence;
uniform float particleSize;
uniform float pixelScale;
uniform float maxPointSize;
uniform float kind;
varying float particleAlpha;
varying float angle;
void main() {
  vec3 p = (seed.xyz - 0.5) * bounds;
  float age = time;
  particleAlpha = 1.0;
  if (kind < 1.5) {
    // Solve H = v*t + 0.5*g*t^2. Stable also as gravity approaches zero.
    float velocity = max(0.01, fallSpeed * mix(0.8, 1.2, seed.w));
    float lifetime = 2.0 * bounds.y / (velocity + sqrt(velocity*velocity + 2.0*gravity*bounds.y));
    age = mod(time + seed.y * lifetime, lifetime);
    float drop = velocity * age + 0.5 * gravity * age * age;
    p.y = bounds.y * 0.5 - drop;
    particleAlpha = smoothstep(0.0, 0.025, age / lifetime) * (1.0 - smoothstep(0.96, 1.0, age / lifetime));
  } else {
    // Volumes are independent layers: clouds at the top, mist at the bottom.
    p.y = kind < 2.5 ? bounds.y * (0.28 + seed.y * 0.18) : bounds.y * (-0.47 + seed.y * 0.10);
  }
  p.xz += wind * age + turbulence * vec2(sin(time * 0.73 + seed.w * 91.0), cos(time * 0.51 + seed.x * 77.0));
  p.xz = mod(p.xz + bounds.xz * 0.5, bounds.xz) - bounds.xz * 0.5;
  vec2 edge = 1.0 - abs(p.xz) / (bounds.xz * 0.5);
  particleAlpha *= smoothstep(0.0, 0.08, min(edge.x, edge.y));
  vec4 view = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * view;
  float perspective = projectionMatrix[2][3] == -1.0 ? 1.0 / max(0.1, -view.z) : 1.0;
  gl_PointSize = clamp(particleSize * pixelScale * abs(projectionMatrix[1][1]) * perspective, 1.0, maxPointSize);
  if (view.z >= 0.0) { gl_PointSize = 1.0; particleAlpha = 0.0; }
  vec3 viewVelocity = mat3(modelViewMatrix) * vec3(wind.x, -(fallSpeed + gravity * age), wind.y);
  angle = atan(viewVelocity.y, viewVelocity.x) - 1.570796327;
}
`;
const fragmentShader = /* glsl */ `
uniform vec3 tint;
uniform float opacity;
uniform float kind;
varying float particleAlpha;
varying float angle;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float alpha;
  if (kind < 0.5) {
    float c = cos(angle), s = sin(angle);
    p = mat2(c, -s, s, c) * p;
    alpha = (1.0 - smoothstep(0.025, 0.075, abs(p.x))) * (1.0 - smoothstep(0.25, 0.5, abs(p.y)));
  } else if (kind < 1.5) {
    alpha = 1.0 - smoothstep(0.18, 0.5, length(p));
  } else {
    float r = length(p);
    float billow = 0.85 + 0.15 * sin(p.x * 19.0 + sin(p.y * 14.0));
    alpha = exp(-r*r*12.0) * (1.0 - smoothstep(0.32, 0.5, r)) * billow;
  }
  alpha *= opacity * particleAlpha;
  if (alpha < 0.002) discard;
  gl_FragColor = vec4(tint, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Analytic GPU particles: no per-frame attribute writes, simulation loops or readbacks. */
export class WeatherSystem {
  readonly group = new THREE.Group();
  private layers = new Map<WeatherKind, { points: THREE.Points; options: WeatherLayerOptions }>();
  private shared = { time: { value: 0 }, bounds: { value: new THREE.Vector3(80, 40, 80) },
    wind: { value: new THREE.Vector2(1.2, 0.3) }, pixelScale: { value: 540 }, maxPointSize: { value: 64 } };
  private seed: number;
  private parent?: THREE.Object3D;

  constructor(options: WeatherOptions = {}) {
    this.seed = options.seed ?? 12345;
    if (options.bounds) this.setBounds(options.bounds);
    if (options.wind) this.setWind(options.wind);
    for (const kind of Object.keys(options.layers ?? {}) as WeatherKind[]) this.configureLayer(kind, options.layers![kind]!);
  }

  init(parent: THREE.Object3D, renderer: THREE.WebGLRenderer) {
    this.parent = parent; parent.add(this.group);
    const gl = renderer.getContext();
    this.shared.maxPointSize.value = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1];
    this.resize(renderer);
    return this;
  }

  resize(renderer: THREE.WebGLRenderer) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.shared.pixelScale.value = size.y * 0.5;
  }
  setBounds(size: THREE.Vector3) {
    size.toArray().forEach(v => finite(v, 'bounds', 0.01));
    this.shared.bounds.value.copy(size);
  }
  setWind(wind: THREE.Vector2) {
    wind.toArray().forEach(v => finite(v, 'wind'));
    this.shared.wind.value.copy(wind);
  }
  setCenter(position: THREE.Vector3) { this.group.position.copy(position); }

  configureLayer(kind: WeatherKind, changes: Partial<WeatherLayerOptions>) {
    const old = this.layers.get(kind);
    const options = { ...WEATHER_DEFAULTS[kind], ...old?.options, ...changes };
    for (const key of ['count', 'size', 'opacity', 'speed', 'gravity', 'turbulence'] as const) finite(options[key], key, 0);
    if (!Number.isInteger(options.count) || options.count > 200000) throw new RangeError('count must be an integer <= 200000');
    if (options.opacity > 1) throw new RangeError('opacity must be <= 1');
    if (old && old.options.count === options.count) {
      old.options = options;
      this.applyOptions(old.points.material as THREE.ShaderMaterial, options);
      return;
    }
    if (old) { old.points.removeFromParent(); old.points.geometry.dispose(); (old.points.material as THREE.Material).dispose(); }
    const geometry = new THREE.BufferGeometry();
    const data = new Float32Array(options.count * 4);
    let state = this.seed >>> 0;
    for (let i = 0; i < data.length; i++) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; data[i] = state / 4294967296; }
    geometry.setAttribute('seed', new THREE.BufferAttribute(data, 4));
    // Position is only required for the draw count; the GPU derives actual positions.
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(options.count * 3), 3));
    const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, transparent: true,
      depthWrite: false, depthTest: true, uniforms: { ...this.shared,
        kind: { value: ['rain', 'snow', 'clouds', 'mist'].indexOf(kind) }, tint: { value: new THREE.Color(options.color) },
        opacity: { value: options.opacity }, fallSpeed: { value: options.speed }, gravity: { value: options.gravity },
        turbulence: { value: options.turbulence }, particleSize: { value: options.size } } });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false; // CPU positions are intentionally static.
    points.raycast = () => {}; // Editor picking passes through weather.
    points.name = `weather-${kind}`;
    this.group.add(points); this.layers.set(kind, { points, options });
  }
  private applyOptions(material: THREE.ShaderMaterial, options: WeatherLayerOptions) {
    material.uniforms.tint.value.set(options.color);
    for (const [uniform, option] of [['opacity', 'opacity'], ['fallSpeed', 'speed'], ['gravity', 'gravity'],
      ['turbulence', 'turbulence'], ['particleSize', 'size']] as const) material.uniforms[uniform].value = options[option];
  }
  setEnabled(kind: WeatherKind, enabled: boolean) { const layer = this.layers.get(kind); if (layer) layer.points.visible = enabled; }
  update(deltaTime: number) { this.shared.time.value += finite(deltaTime, 'deltaTime', 0); }
  dispose() {
    this.group.removeFromParent();
    for (const { points } of this.layers.values()) { points.geometry.dispose(); (points.material as THREE.Material).dispose(); }
    this.layers.clear(); this.group.clear(); this.parent = undefined;
  }
}
