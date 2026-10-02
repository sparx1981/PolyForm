import * as THREE from 'three';

/**
 * The glass lens shared by Presentation mode ("Glass") and the Camera toolbar's Glass tool: its settings,
 * the refraction maths, the spring motion and the shader.
 *
 * Refraction follows the liquid-glass renderer this was modelled on: light entering the curved rim of a
 * slab of glass bends by Snell's law, and the rim of the lens shows the scene shifted by that bend.
 * The middle of the lens is flat, so it is only magnified (by a cropped camera, see loupe.ts) and stays sharp.
 */

export type GlassShape = 'circle' | 'rounded';
/** Rim profile: how the glass surface curves across its bezel. */
export const GLASS_PROFILES = [
  { id: 0, name: 'Dome', hint: 'A round, classic lens edge' },
  { id: 1, name: 'Squircle', hint: 'A softer, flatter edge with a sharper turn' },
  { id: 2, name: 'Bowl', hint: 'A dished edge that pulls the scene outward' },
  { id: 3, name: 'Lip', hint: 'A raised rim around a shallow centre' },
] as const;

export interface GlassSettings {
  loupeShape: GlassShape;
  /** Width over height of a rounded lens (1 = square). Circles ignore it. */
  loupeAspect: number;
  /** Corner roundness of a rounded lens, 0.15 (soft square) to 1 (pill). */
  loupeRoundness: number;
  glassProfile: number;
  /** Rim width as a fraction of the lens's smaller half-size. */
  glassBezel: number;
  /** Glass thickness in pixels: thicker bends light further. */
  glassThickness: number;
  glassIndex: number;
  /** Refraction strength, 0 (clear) to 2. */
  glassRefraction: number;
  /** Colour fringing at the rim, 0 to 1. */
  glassChromatic: number;
  glassSpecular: number;
  /** Direction the highlight comes from, degrees counter-clockwise from the right. */
  glassSpecularAngle: number;
  glassSpecularWidth: number;
  glassShadow: number;
  glassShadowBlur: number;
  glassTint: string;
  glassTintAmount: number;
  /** Blur toward the rim, 0 to 1. */
  glassEdgeBlur: number;
  /** Squash and stretch like liquid when the lens is pressed or dragged. */
  glassLiquid: boolean;
  /** Camera tool: the lens follows the pointer instead of being dragged. */
  loupeFollow: boolean;
}

export const DEFAULT_GLASS: GlassSettings = {
  loupeShape: 'circle', loupeAspect: 1.8, loupeRoundness: 1,
  glassProfile: 1, glassBezel: 0.34, glassThickness: 12, glassIndex: 1.5, glassRefraction: 1,
  glassChromatic: 0.5, glassSpecular: 0.8, glassSpecularAngle: 135, glassSpecularWidth: 2.5,
  glassShadow: 0.28, glassShadowBlur: 26, glassTint: '#ffffff', glassTintAmount: 0, glassEdgeBlur: 0.25,
  glassLiquid: true, loupeFollow: false,
};

export const GLASS_KEYS = Object.keys(DEFAULT_GLASS) as Array<keyof GlassSettings>;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
const STORAGE_KEY = 'polyform_glass_v1';

/** Returns settings with every field in range and of the right type, whatever was passed in. */
export function sanitizeGlass(input: Partial<Record<keyof GlassSettings, unknown>> = {}): GlassSettings {
  const d = DEFAULT_GLASS, n = (key: keyof GlassSettings, lo: number, hi: number) => clamp(Number(input[key] ?? d[key]), lo, hi);
  return {
    loupeShape: input.loupeShape === 'rounded' ? 'rounded' : 'circle',
    loupeAspect: n('loupeAspect', 1, 3.5), loupeRoundness: n('loupeRoundness', 0.15, 1),
    glassProfile: Math.round(n('glassProfile', 0, 3)), glassBezel: n('glassBezel', 0.08, 0.6),
    glassThickness: n('glassThickness', 2, 40), glassIndex: n('glassIndex', 1.05, 2.4), glassRefraction: n('glassRefraction', 0, 2),
    glassChromatic: n('glassChromatic', 0, 1), glassSpecular: n('glassSpecular', 0, 1),
    glassSpecularAngle: n('glassSpecularAngle', 0, 360), glassSpecularWidth: n('glassSpecularWidth', 0.5, 10),
    glassShadow: n('glassShadow', 0, 0.7), glassShadowBlur: n('glassShadowBlur', 2, 60),
    glassTint: typeof input.glassTint === 'string' && /^#[0-9a-f]{6}$/i.test(input.glassTint) ? input.glassTint : d.glassTint,
    glassTintAmount: n('glassTintAmount', 0, 0.6), glassEdgeBlur: n('glassEdgeBlur', 0, 1),
    glassLiquid: typeof input.glassLiquid === 'boolean' ? input.glassLiquid : d.glassLiquid,
    loupeFollow: typeof input.loupeFollow === 'boolean' ? input.loupeFollow : d.loupeFollow,
  };
}

/** The look the user last chose, shared by both places the glass appears. Never throws. */
export function loadGlassSettings(): GlassSettings {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    return sanitizeGlass(raw ? JSON.parse(raw) : {});
  } catch { return { ...DEFAULT_GLASS }; }
}
export function saveGlassSettings(settings: GlassSettings): void {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
}

/** Lens size in pixels (half-extents and corner radius) for the current shape. `radius` is the lens's half-height. */
export function glassDimensions(settings: Pick<GlassSettings, 'loupeShape' | 'loupeAspect' | 'loupeRoundness'>, radius: number, limits?: { width: number; height: number }) {
  let hy = radius, hx = settings.loupeShape === 'circle' ? radius : radius * settings.loupeAspect;
  // Keep the lens inside the viewport: scale both down together.
  if (limits) { const k = Math.min(1, (limits.width * 0.46) / hx, (limits.height * 0.46) / hy); hx *= k; hy *= k; }
  const corner = settings.loupeShape === 'circle' ? Math.min(hx, hy) : Math.min(hx, hy) * settings.loupeRoundness;
  return { hx, hy, corner };
}

// ---- Refraction -------------------------------------------------------------------------------------------

/** Height of the glass surface across its rim: x runs 0 at the outer edge to 1 where the rim ends. */
export function glassSurfaceHeight(x: number, profile: number): number {
  const d = 1 - x;
  if (profile === 0) return Math.sqrt(Math.max(0, 1 - d * d));
  if (profile === 1) return Math.pow(Math.max(0, 1 - d ** 4), 0.25);
  const concave = 1 - Math.sqrt(Math.max(0, 1 - d * d));
  if (profile === 2) return concave;
  const a = 1 - x * 2, convex = Math.pow(Math.max(0, 1 - a ** 4), 0.25);
  const smoother = x * x * x * (x * (6 * x - 15) + 10);
  return convex * (1 - smoother) + (concave + 0.1) * smoother;
}

/**
 * How far (in pixels) the rim shifts what you see at position `t` across it (0 edge .. 1 inner end of the bezel),
 * from Snell's law at the local surface slope. Zero in a flat spot and where the ray would reflect instead.
 */
export function glassDisplacement(t: number, profile: number, bezelPx: number, thicknessPx: number, index: number): number {
  const eta = 1 / index, dx = 0.001;
  const height = glassSurfaceHeight(t, profile);
  const slope = (glassSurfaceHeight(Math.min(1, t + dx), profile) - glassSurfaceHeight(Math.max(0, t - dx), profile)) / (Math.min(1, t + dx) - Math.max(0, t - dx));
  const magnitude = Math.hypot(slope, 1);
  const nx = -slope / magnitude, ny = -1 / magnitude;
  const k = 1 - eta * eta * (1 - ny * ny);
  if (k < 0) return 0;
  const root = Math.sqrt(k);
  const rx = -(eta * ny + root) * nx, ry = eta - (eta * ny + root) * ny;
  if (Math.abs(ry) < 0.001) return 0;
  return rx * ((height * bezelPx + thicknessPx) / ry);
}

// ---- Liquid motion ----------------------------------------------------------------------------------------

export interface Spring { value: number; velocity: number; target: number; stiffness: number; damping: number }
export const createSpring = (value: number, stiffness: number, damping: number): Spring => ({ value, velocity: 0, target: value, stiffness, damping });

/** Advance a spring by `dt` seconds in small fixed steps, so a long frame cannot blow it up. */
export function stepSpring(spring: Spring, dt: number): void {
  let left = Math.min(dt, 0.1);
  while (left > 1e-9) {
    const step = Math.min(left, 1 / 120);
    spring.velocity += ((spring.target - spring.value) * spring.stiffness - spring.velocity * spring.damping) * step;
    spring.value += spring.velocity * step;
    left -= step;
  }
}

/**
 * The lens squashes slightly when pressed and stretches along the direction it is dragged, then springs back.
 * Area stays about constant, like a drop of liquid.
 */
export class GlassMotion {
  readonly grow = createSpring(1, 300, 15);
  readonly stretchX = createSpring(0, 260, 14);
  readonly stretchY = createSpring(0, 260, 14);
  /** Scale on the lens's width and height. */
  scale = { x: 1, y: 1 };
  update(dt: number, input: { pressed: boolean; vx: number; vy: number; enabled: boolean }): { x: number; y: number } {
    if (!input.enabled) { this.grow.value = 1; this.grow.target = 1; this.grow.velocity = 0; this.stretchX.value = this.stretchY.value = 0; this.stretchX.velocity = this.stretchY.velocity = 0; this.scale = { x: 1, y: 1 }; return this.scale; }
    this.grow.target = input.pressed ? 1.09 : 1;
    // Velocity is in viewport widths/heights per second; ~1 is a fast fling.
    this.stretchX.target = clamp(Math.abs(input.vx) * 0.22, 0, 0.22);
    this.stretchY.target = clamp(Math.abs(input.vy) * 0.22, 0, 0.22);
    for (const spring of [this.grow, this.stretchX, this.stretchY]) stepSpring(spring, dt);
    const sx = this.stretchX.value, sy = this.stretchY.value;
    this.scale = { x: this.grow.value * (1 + sx - sy * 0.5), y: this.grow.value * (1 + sy - sx * 0.5) };
    return this.scale;
  }
}

// ---- Shader -----------------------------------------------------------------------------------------------

export interface GlassUniformInput {
  settings: GlassSettings;
  /** Lens half-extents and corner radius in pixels, after any squash. */
  half: [number, number];
  corner: number;
  /** Half-size of the quad the lens is drawn on (lens plus room for the shadow). */
  quad: [number, number];
  /** Pixel size of the lens image (the cropped render). */
  texel: [number, number];
  /** What shows through where the scene is transparent (the page behind the canvas). */
  backdrop?: THREE.Color;
}

export function createGlassMaterial(texture: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      view: { value: texture },
      uQuad: { value: new THREE.Vector2(1, 1) }, uHalf: { value: new THREE.Vector2(1, 1) }, uCorner: { value: 1 },
      uBezel: { value: 30 }, uThick: { value: 12 }, uIndex: { value: 1.5 }, uRefraction: { value: 1 }, uProfile: { value: 1 }, uChromatic: { value: 0.5 },
      uSpec: { value: 0.8 }, uSpecWidth: { value: 2.5 }, uSpecDir: { value: new THREE.Vector2(-0.7, 0.7) },
      uShadow: { value: 0.28 }, uShadowBlur: { value: 26 }, uShadowOffset: { value: new THREE.Vector2(0, -12) },
      uTint: { value: new THREE.Color('#ffffff') }, uBackdrop: { value: new THREE.Color(0.9, 0.9, 0.9) }, uTintAmount: { value: 0 }, uEdgeBlur: { value: 0.25 }, uTexel: { value: new THREE.Vector2(1 / 512, 1 / 512) },
    },
    transparent: true, depthTest: false, depthWrite: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: GLASS_FRAGMENT,
  });
}

export function updateGlassMaterial(material: THREE.ShaderMaterial, input: GlassUniformInput): void {
  const u = material.uniforms, s = input.settings, minHalf = Math.min(input.half[0], input.half[1]);
  (u.uQuad!.value as THREE.Vector2).set(...input.quad);
  (u.uHalf!.value as THREE.Vector2).set(...input.half);
  u.uCorner!.value = input.corner;
  u.uBezel!.value = Math.max(2, s.glassBezel * minHalf);
  u.uThick!.value = s.glassThickness; u.uIndex!.value = s.glassIndex;
  // Displacement is tuned for a 110 px lens, so it scales with the lens's size.
  u.uRefraction!.value = s.glassRefraction * 0.5 * (minHalf / 110);
  u.uProfile!.value = s.glassProfile; u.uChromatic!.value = s.glassChromatic;
  u.uSpec!.value = s.glassSpecular; u.uSpecWidth!.value = s.glassSpecularWidth;
  const angle = THREE.MathUtils.degToRad(s.glassSpecularAngle);
  (u.uSpecDir!.value as THREE.Vector2).set(Math.cos(angle), Math.sin(angle));
  u.uShadow!.value = s.glassShadow; u.uShadowBlur!.value = s.glassShadowBlur;
  (u.uShadowOffset!.value as THREE.Vector2).set(0, -s.glassShadowBlur * 0.45);
  if (input.backdrop) (u.uBackdrop!.value as THREE.Color).copy(input.backdrop);
  (u.uTint!.value as THREE.Color).set(s.glassTint); u.uTintAmount!.value = s.glassTintAmount;
  u.uEdgeBlur!.value = s.glassEdgeBlur;
  (u.uTexel!.value as THREE.Vector2).set(...input.texel);
}

/** Room around the lens, in pixels, for its drop shadow. */
export function glassShadowMargin(settings: GlassSettings): number {
  return settings.glassShadow > 0.005 ? settings.glassShadowBlur * 1.6 + settings.glassShadowBlur * 0.45 : 2;
}

const GLASS_FRAGMENT = /* glsl */ `
  uniform sampler2D view;
  uniform vec2 uQuad, uHalf, uShadowOffset, uSpecDir, uTexel;
  uniform float uCorner, uBezel, uThick, uIndex, uRefraction, uProfile, uChromatic, uSpec, uSpecWidth, uShadow, uShadowBlur, uTintAmount, uEdgeBlur;
  uniform vec3 uTint, uBackdrop;
  varying vec2 vUv;

  float rr(vec2 p, vec2 h, float r){ vec2 q=abs(p)-h+vec2(r); return length(max(q,vec2(0.)))+min(max(q.x,q.y),0.)-r; }

  float surf(float x){
    float d=1.-x, d2=d*d;
    if(uProfile<.5) return sqrt(max(0.,1.-d2));
    if(uProfile<1.5) return pow(max(0.,1.-d2*d2),.25);
    float concave=1.-sqrt(max(0.,1.-d2));
    if(uProfile<2.5) return concave;
    float a=1.-x*2., a2=a*a;
    float convex=pow(max(0.,1.-a2*a2),.25);
    float s=x*x*x*(x*(6.*x-15.)+10.);
    return mix(convex,concave+.1,s);
  }

  // Snell's law at the local slope of the rim; returns the shift in pixels (0 where the ray would reflect).
  float displacement(float t){
    float eta=1./uIndex, e=.001;
    float x1=max(t-e,0.), x2=min(t+e,1.);
    float slope=(surf(x2)-surf(x1))/max(x2-x1,1e-6);
    float mag=sqrt(slope*slope+1.);
    float nx=-slope/mag, ny=-1./mag;
    float k=1.-eta*eta*(1.-ny*ny);
    if(k<0.) return 0.;
    float ks=sqrt(k);
    float rx=-(eta*ny+ks)*nx, ry=eta-(eta*ny+ks)*ny;
    if(abs(ry)<.001) return 0.;
    return rx*((surf(t)*uBezel+uThick)/ry);
  }

  // rgb is the scene colour, a how much of the pixel the scene covers; the page shows through the rest.
  vec4 sampleView(vec2 pos){
    vec2 uv=clamp(pos/(2.*uHalf)+.5,vec2(.002),vec2(.998));
    vec4 s=texture2D(view,uv);
    return vec4(s.rgb/max(s.a,.001),s.a);
  }
  vec4 sampleBlur(vec2 pos,float radius){
    if(radius<.4) return sampleView(pos);
    vec4 c=sampleView(pos)*.2;
    for(int i=0;i<8;i++){
      float a=float(i)*.785398;
      c+=sampleView(pos+vec2(cos(a),sin(a))*radius)*.1;
    }
    return c;
  }

  void main(){
    vec2 p=(vUv-.5)*2.*uQuad;
    float sd=rr(p,uHalf,uCorner);
    float inside=1.-smoothstep(-.9,.7,sd);
    float shadow=0.;
    if(uShadow>.001){
      float sd2=rr(p-uShadowOffset,uHalf,uCorner);
      shadow=uShadow*(1.-smoothstep(-uShadowBlur*.35,uShadowBlur,sd2));
    }
    if(inside<=.001){ gl_FragColor=vec4(0.,0.,0.,shadow); return; }

    float edge=max(-sd,0.);
    vec3 colour;
    float cover=1.;
    // Outward normal of the lens shape at this pixel.
    vec2 g=vec2(rr(p+vec2(1.,0.),uHalf,uCorner)-rr(p-vec2(1.,0.),uHalf,uCorner), rr(p+vec2(0.,1.),uHalf,uCorner)-rr(p-vec2(0.,1.),uHalf,uCorner));
    vec2 n=g/(length(g)+1e-5);
    if(edge>=uBezel){
      vec4 s=sampleView(p); colour=s.rgb; cover=s.a;
    } else {
      float t=edge/uBezel;
      float shift=min(displacement(t)*uRefraction, uBezel*.8);
      float blur=uEdgeBlur*7.*(1.-t)*(1.-t);
      float fringe=shift*uChromatic*.4;
      vec4 r=sampleBlur(p-n*(shift-fringe),blur), g=sampleBlur(p-n*shift,blur), b=sampleBlur(p-n*(shift+fringe),blur);
      colour=vec3(r.r,g.g,b.b); cover=(r.a+g.a+b.a)/3.;
    }
    colour=mix(colour,uTint,uTintAmount);

    // Specular rim light from the chosen direction: strongest where the rim faces it.
    float facing=abs(dot(n,uSpecDir));
    float taper=mix(.08,1.,facing*facing);
    float rim=max(uSpecWidth*taper,.001), extent=rim+uSpecWidth*taper*.8;
    if(edge<extent){
      float st=clamp(edge/rim,0.,1.);
      float rc=sqrt(1.-(1.-st)*(1.-st));
      float it=facing*rc*(1.-smoothstep(rim,extent,edge));
      float spec=it*it;
      float lum=dot(colour,vec3(.299,.587,.114));
      colour=mix(colour,mix(vec3(lum),colour,1.+spec*1.4),spec);
      colour=mix(colour,vec3(1.),spec*uSpec);
    }

    gl_FragColor=vec4(colour,inside+shadow*(1.-inside));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    // The page behind the canvas is already in display colours, so it is blended in after tone mapping.
    gl_FragColor.rgb=mix(uBackdrop,gl_FragColor.rgb,cover);
  }
`;
