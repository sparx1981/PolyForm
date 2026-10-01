import { Matrix4, ShaderChunk, Uniform, Vector2, Vector3, type Material, type Texture } from 'three';

// Beer-shadow-map channels follow @takram/three-clouds (MIT). Apply extinction
// to direct sunlight only: upholstery, reflections and indoor lights retain PBR.
export function createCloudShadowUniforms() {
  return {
    pfCloudEnabled: new Uniform(false), pfCloudMap: new Uniform<Texture | null>(null),
    pfCloudMatrices: new Uniform(Array.from({length:4}, () => new Matrix4())),
    pfCloudIntervals: new Uniform(Array.from({length:4}, () => new Vector2())),
    pfCloudCount: new Uniform(0), pfCloudNear: new Uniform(0.1), pfCloudFar: new Uniform(1),
    pfCloudECEF: new Uniform(new Matrix4()), pfCloudCorrection: new Uniform(new Vector3()),
    pfCloudSun: new Uniform(new Vector3()), pfCloudRadius: new Uniform(6360000), pfCloudTop: new Uniform(0),
  };
}
export type CloudShadowUniforms = ReturnType<typeof createCloudShadowUniforms>;
let nextBinding = 0;
const bindings = new WeakMap<CloudShadowUniforms, number>();

const fragment = `
precision highp sampler2DArray;
uniform bool pfCloudEnabled;
uniform sampler2DArray pfCloudMap;
uniform mat4 pfCloudMatrices[4];
uniform vec2 pfCloudIntervals[4];
uniform int pfCloudCount;
uniform float pfCloudNear, pfCloudFar, pfCloudRadius, pfCloudTop;
uniform mat4 pfCloudECEF;
uniform vec3 pfCloudCorrection, pfCloudSun;
float pfCloudTransmission(vec3 worldPosition, float viewDepth) {
  if (!pfCloudEnabled) return 1.0;
  float depth = (viewDepth - pfCloudNear) / (pfCloudFar - pfCloudNear);
  if (depth < 0.0 || depth > 1.0) return 1.0;
  vec3 ecef = (pfCloudECEF * vec4(worldPosition,1.0)).xyz + pfCloudCorrection;
  float b = dot(ecef, pfCloudSun);
  float radius = pfCloudRadius + pfCloudTop;
  float distanceToTop = -b + sqrt(max(0.0, b*b - dot(ecef,ecef) + radius*radius));
  if (distanceToTop <= 0.0) return 1.0;
  for (int c=0; c<4; c++) {
    if (c >= pfCloudCount) break;
    if (depth < pfCloudIntervals[c].x || depth > pfCloudIntervals[c].y) continue;
    vec4 clip = pfCloudMatrices[c] * vec4(worldPosition,1.0);
    vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
    if (any(lessThan(uv,vec2(0.0))) || any(greaterThan(uv,vec2(1.0)))) return 1.0;
    vec2 texel = 1.0 / vec2(textureSize(pfCloudMap,0).xy);
    // Fixed 3x3 filtering avoids stochastic grain on walls and floors.
    float transmission = 0.0;
    for (int y=-1; y<=1; y++) for (int x=-1; x<=1; x++) {
      vec4 shadow = texture(pfCloudMap,vec3(uv+vec2(float(x),float(y))*texel,float(c)));
      float opticalDepth = min(shadow.b, shadow.g * max(0.0,distanceToTop-shadow.r));
      transmission += exp(-max(0.0,opticalDepth));
    }
    return transmission / 9.0;
  }
  return 1.0;
}
`;

/** Restore the exact previous hooks when Beta is disabled; preserve fabric/LOD hooks. */
export function attachCloudMaterialShadow(material: Material, uniforms: CloudShadowUniforms) {
  // Three caches a material's program uniforms as well as its shader. A new
  // mount needs a new key so toggling clouds cannot retain a disposed shadow map.
  if (!bindings.has(uniforms)) bindings.set(uniforms, ++nextBinding);
  const previous = material.onBeforeCompile, previousKey = material.customProgramCacheKey;
  const hook: Material['onBeforeCompile'] = function(shader, renderer) {
    previous.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = fragment + shader.fragmentShader;
    const lights = ShaderChunk.lights_fragment_begin.replace(
      'getDirectionalLightInfo( directionalLight, directLight );',
      `getDirectionalLightInfo( directionalLight, directLight );
       directLight.color *= pfCloudTransmission(((vec4(geometryPosition,1.0)-viewMatrix[3])*viewMatrix).xyz, vViewPosition.z);`,
    );
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', lights);
  };
  material.onBeforeCompile = hook;
  material.customProgramCacheKey = () => `${previousKey.call(material)}:polyform-cloud-shadow-v1:${bindings.get(uniforms)}`;
  material.needsUpdate = true;
  return () => {
    if (material.onBeforeCompile !== hook) return;
    material.onBeforeCompile = previous; material.customProgramCacheKey = previousKey; material.needsUpdate = true;
  };
}
