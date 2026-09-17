import * as THREE from 'three';
import { finite, inject, patchMaterial } from './shaderHooks';

const declarations = /* glsl */ `
uniform float pfWindTime;
uniform float pfWindStrength;
uniform float pfWindSpeed;
uniform vec2 pfWindDirection;
uniform vec2 pfWindHeight;
vec2 pfBend;
float pfSlope;
`;
const bend = /* glsl */ `
vec4 pfOrigin = vec4(0.0, 0.0, 0.0, 1.0);
#ifdef USE_INSTANCING
  pfOrigin = instanceMatrix * pfOrigin;
#endif
pfOrigin = modelMatrix * pfOrigin;
float pfPhase = dot(pfOrigin.xz, vec2(0.73, 0.41));
float pfWave = sin(pfWindTime * pfWindSpeed + pfPhase)
  + 0.35 * sin(pfWindTime * pfWindSpeed * 2.17 + pfPhase * 1.31);
float pfH = clamp((position.y - pfWindHeight.x) / pfWindHeight.y, 0.0, 1.0);
mat4 pfPlantMatrix = modelMatrix;
#ifdef USE_INSTANCING
  pfPlantMatrix = modelMatrix * instanceMatrix;
#endif
vec3 pfWorldDirection = vec3(pfWindDirection.x, 0.0, pfWindDirection.y);
vec2 pfLocalDirection = vec2(dot(normalize(pfPlantMatrix[0].xyz), pfWorldDirection),
  dot(normalize(pfPlantMatrix[2].xyz), pfWorldDirection));
pfBend = pfLocalDirection * (pfWindStrength * pfWave);
pfSlope = (position.y > pfWindHeight.x && position.y < pfWindHeight.x + pfWindHeight.y)
  ? 2.0 * pfH / pfWindHeight.y : 0.0;
`;

/** One clock per landscape, shared by all visible and shadow programs. */
export class VegetationWind {
  constructor(readonly maxStrength = 0.4) { finite(maxStrength, 'maxStrength', 0.12); }
  readonly uniforms = {
    pfWindTime: { value: 0 }, pfWindStrength: { value: 0.12 },
    pfWindSpeed: { value: 1.6 }, pfWindDirection: { value: new THREE.Vector2(1, 0.35).normalize() },
  };

  update(deltaTime: number) { this.uniforms.pfWindTime.value += finite(deltaTime, 'deltaTime', 0); }
  setTime(seconds: number) { this.uniforms.pfWindTime.value = finite(seconds, 'time', 0); }
  configure({ strength = this.uniforms.pfWindStrength.value, speed = this.uniforms.pfWindSpeed.value,
    direction = this.uniforms.pfWindDirection.value } = {}) {
    finite(strength, 'strength', 0); finite(speed, 'speed', 0);
    if (strength > this.maxStrength) throw new RangeError('strength exceeds wind bounding budget');
    finite(direction.x, 'direction.x'); finite(direction.y, 'direction.y');
    this.uniforms.pfWindStrength.value = strength;
    this.uniforms.pfWindSpeed.value = speed;
    this.uniforms.pfWindDirection.value.copy(direction).normalize();
  }

  /** Height/strength are in mesh-local units. Attach once per material. */
  attach(material: THREE.Material, base = 0, height = 1) {
    finite(base, 'base'); finite(height, 'height', 0.0001);
    return patchMaterial(material, { key: 'pf-wind-v1', apply: shader => {
      Object.assign(shader.uniforms, this.uniforms, { pfWindHeight: { value: new THREE.Vector2(base, height) } });
      shader.vertexShader = declarations + shader.vertexShader;
      shader.vertexShader = inject(shader.vertexShader, '#include <begin_vertex>', `
        #include <begin_vertex>
        ${bend}
        transformed.xz += pfBend * pfH * pfH;
      `);
      // Normal inverse-Jacobian for the bend. Shadow shaders may omit normal chunks.
      if (shader.vertexShader.includes('#include <beginnormal_vertex>')) {
        shader.vertexShader = inject(shader.vertexShader, '#include <beginnormal_vertex>', `
          #include <beginnormal_vertex>
          { ${bend}
            objectNormal.y -= dot(objectNormal.xz, pfBend) * pfSlope;
            #ifdef USE_TANGENT
              objectTangent.xz += pfBend * pfSlope * objectTangent.y;
            #endif
          }
        `);
      }
    } });
  }

  /** Static mesh. Call cleanup before disposing/replacing its material. */
  attachMesh(mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[]>, base = 0, height = 1) {
    if (mesh.customDepthMaterial || mesh.customDistanceMaterial) throw new Error('Attach wind before other custom shadow effects.');
    const sources = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const source = sources[0];
    if (!source) throw new Error('Wind requires at least one material');
    const options = { map: source.map, alphaMap: source.alphaMap, alphaTest: source.alphaTest, side: source.side,
      displacementMap: source.displacementMap, displacementScale: source.displacementScale, displacementBias: source.displacementBias };
    const depth = new THREE.MeshDepthMaterial({ ...options, depthPacking: THREE.RGBADepthPacking });
    const distance = new THREE.MeshDistanceMaterial(options);
    const undo = [...new Set<THREE.Material>([...sources, depth, distance])].map(mat => this.attach(mat, base, height));
    mesh.customDepthMaterial = depth;
    mesh.customDistanceMaterial = distance;
    // Shader deformation is invisible to CPU bounds. Individual editor meshes are small;
    // instanced batches below use conservative expanded bounds instead.
    const oldCulling = mesh.frustumCulled;
    mesh.frustumCulled = false;
    return () => {
      undo.forEach(fn => fn());
      mesh.customDepthMaterial = undefined; mesh.customDistanceMaterial = undefined;
      mesh.frustumCulled = oldCulling;
      depth.dispose(); distance.dispose();
    };
  }
}
