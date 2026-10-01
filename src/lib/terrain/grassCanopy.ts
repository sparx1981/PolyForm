import * as THREE from 'three';
import type { GrassField } from './bladeGrass';
import type { BladeGrassUniforms } from './bladeGrassMaterial';
import { inject } from '../graphics/shaderHooks';
/** Aggregate sward under the coarse blades. Its cost depends on the height grid, not blade density or viewing radius. */
export function createGrassCanopyGeometry(field: GrassField): THREE.BufferGeometry {
    const image = field.heights.image as {
        width: number;
        height: number;
        data: Float32Array;
    };
    const nx = Math.max(2, image.width), nz = Math.max(2, image.height);
    const positions = new Float32Array(nx * nz * 3), indices: number[] = [];
    const sample = (x: number, z: number) => image.data[Math.min(z, image.height - 1) * image.width + Math.min(x, image.width - 1)] || 0;
    for (let z = 0; z < nz; z++)
        for (let x = 0; x < nx; x++) {
            const i = (z * nx + x) * 3;
            positions[i] = field.bounds.x + x / (nx - 1) * field.bounds.z;
            positions[i + 1] = field.baseY + sample(x, z) + 0.003;
            positions[i + 2] = field.bounds.y + z / (nz - 1) * field.bounds.w;
            if (x < nx - 1 && z < nz - 1) {
                const a = z * nx + x, b = a + nx;
                indices.push(a, b, a + 1, a + 1, b, b + 1);
            }
        }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}
/** Lit, masked vegetation colour replaces visible bare soil as individual blades become sub-pixel. */
export function createGrassCanopyMaterial(shared: BladeGrassUniforms): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, shared);
        shader.vertexShader = 'varying vec3 canopyPosition;\n' + shader.vertexShader;
        shader.vertexShader = inject(shader.vertexShader, '#include <begin_vertex>', '#include <begin_vertex>\n canopyPosition=(modelMatrix*vec4(position,1.0)).xyz;');
        shader.fragmentShader = `varying vec3 canopyPosition;
      uniform sampler2D uMask; uniform vec4 uBounds;
      uniform vec3 uRootColor,uTipColor,uDryColor; uniform float uBaseHeight,uHeightVariance,uClumpSize;
      float canopyHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float canopyNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(canopyHash(i),canopyHash(i+vec2(1.,0.)),f.x),mix(canopyHash(i+vec2(0.,1.)),canopyHash(i+1.),f.x),f.y);}
    ` + shader.fragmentShader;
        shader.fragmentShader = inject(shader.fragmentShader, '#include <color_fragment>', `#include <color_fragment>
      vec2 canopyUv=(canopyPosition.xz-uBounds.xy)/uBounds.zw;
      if(any(lessThan(canopyUv,vec2(0.)))||any(greaterThan(canopyUv,vec2(1.)))) discard;
      float canopyMask=smoothstep(.35,.85,texture2D(uMask,canopyUv).r);
      float canopyDistance=distance(cameraPosition,canopyPosition);
      // Blend while the middle ring is still populated, before its sparse roots expose the soil.
      float canopyCoverage=canopyMask*smoothstep(.75,6.,canopyDistance);
      if(uBaseHeight+uHeightVariance<=.0001) discard;
      float canopyDither=fract(52.9829189*fract(dot(floor(gl_FragCoord.xy),vec2(.06711056,.00583715))));
      if(canopyDither>=canopyCoverage) discard;
      float canopyTone=canopyNoise(canopyPosition.xz/max(.3,uClumpSize));
      float canopyDry=smoothstep(.7,.95,canopyNoise(canopyPosition.xz*.12+7.));
      vec3 canopyColor=mix(uRootColor,uTipColor,.48+.12*canopyTone);
      canopyColor=mix(canopyColor,uDryColor,canopyDry*.25);
      canopyColor=mix(uRootColor*.48,canopyColor,smoothstep(1.,8.,canopyDistance));
      diffuseColor.rgb*=canopyColor*mix(.66,.9,canopyTone);
    `);
    };
    material.customProgramCacheKey = () => 'polyform-grass-canopy-v2';
    return material;
}
