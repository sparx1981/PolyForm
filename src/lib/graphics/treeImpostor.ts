import * as THREE from 'three';
import type { PlantPrimitive } from './plantAssets';
import { inject, patchMaterial } from './shaderHooks';
export const TREE_CARD_START = 20, TREE_CARD_END = 32;
export interface TreeViewUniforms {
    pfTreeCamera: {
        value: THREE.Vector3;
    };
    pfTreeForward: {
        value: THREE.Vector3;
    };
    pfTreePixels: {
        value: number;
    };
    pfTreePerspective: {
        value: number;
    };
}
export function createTreeViewUniforms(): TreeViewUniforms {
    return { pfTreeCamera: { value: new THREE.Vector3() }, pfTreeForward: { value: new THREE.Vector3(0, 0, -1) }, pfTreePixels: { value: 1 }, pfTreePerspective: { value: 1 } };
}
export function updateTreeView(uniforms: TreeViewUniforms, camera: THREE.Camera, height: number) {
    camera.getWorldPosition(uniforms.pfTreeCamera.value);
    camera.getWorldDirection(uniforms.pfTreeForward.value);
    uniforms.pfTreePerspective.value = (camera as THREE.PerspectiveCamera).isPerspectiveCamera ? 1 : 0;
    uniforms.pfTreePixels.value = height * camera.projectionMatrix.elements[5] / 2;
}
/** Primary-view fade is shared by geometry and cards, including secondary reflection cameras. */
export function attachTreeFade(material: THREE.Material, view: TreeViewUniforms, height: number, card: boolean) {
    return patchMaterial(material, { key: `tree-fade-v1:${height}:${card}`, apply: shader => {
            Object.assign(shader.uniforms, view, { pfTreeHeight: { value: height } });
            shader.vertexShader = `uniform vec3 pfTreeCamera,pfTreeForward; uniform float pfTreePixels,pfTreePerspective,pfTreeHeight; varying float pfTreeCoverage;\n` + shader.vertexShader;
            shader.vertexShader = inject(shader.vertexShader, '#include <begin_vertex>', `#include <begin_vertex>
      mat4 pfTreeWorld=modelMatrix;
      #ifdef USE_INSTANCING
      pfTreeWorld=modelMatrix*instanceMatrix;
      #endif
      vec3 pfTreeBase=(pfTreeWorld*vec4(0.,0.,0.,1.)).xyz;
      float pfTreeDepth=mix(1.,max(.01,dot(pfTreeBase-pfTreeCamera,pfTreeForward)),pfTreePerspective);
      float pfTreeScreen=pfTreeHeight*length(pfTreeWorld[1].xyz)*pfTreePixels/pfTreeDepth;
      pfTreeCoverage=smoothstep(${TREE_CARD_START}.,${TREE_CARD_END}.,pfTreeScreen);
    `);
            shader.fragmentShader = 'varying float pfTreeCoverage;\n' + shader.fragmentShader;
            shader.fragmentShader = inject(shader.fragmentShader, '#include <color_fragment>', `#include <color_fragment>
      float pfTreeDither=fract(52.9829189*fract(dot(floor(gl_FragCoord.xy),vec2(.06711056,.00583715))));
      if(${card ? 'pfTreeDither < pfTreeCoverage' : 'pfTreeDither >= pfTreeCoverage'}) discard;
    `);
        } });
}
export interface TreeAtlas {
    primitive: PlantPrimitive;
    height: number;
    dispose: () => void;
}
const bakeQueues = new WeakMap<THREE.WebGLRenderer, Promise<void>>();
const caches = new WeakMap<THREE.WebGLRenderer, Map<string, Promise<TreeAtlas>>>();
/** Only six catalogue species qualify. One two-channel atlas per renderer/species, independent of cells. */
export function loadTreeAtlas(renderer: THREE.WebGLRenderer, species: string): Promise<TreeAtlas> {
    let cache = caches.get(renderer);
    if (!cache) {
        cache = new Map();
        caches.set(renderer, cache);
        const owned = cache;
        renderer.domElement.addEventListener('webglcontextlost', () => { owned.forEach(p => p.then(a => a.dispose()).catch(() => { })); owned.clear(); caches.delete(renderer); }, { once: true });
    }
    let promise = cache.get(species);
    if (!promise) {
        promise = import('./plantAssets').then(async ({ loadPlantPrimitives }) => { const primitives = await loadPlantPrimitives(species, undefined, 2); const task = (bakeQueues.get(renderer) ?? Promise.resolve()).then(() => bakeTreeAtlas(renderer, primitives)); bakeQueues.set(renderer, task.then(() => { }, () => { })); return task; });
        cache.set(species, promise);
        promise.catch(() => cache!.delete(species));
    }
    return promise;
}
/** No scene lighting is baked: base colour and world normals respond to the live sun, stars and cloud shadows. */
export async function bakeTreeAtlas(renderer: THREE.WebGLRenderer, primitives: PlantPrimitive[]): Promise<TreeAtlas> {
    const scene = new THREE.Scene(), owned: THREE.Material[] = [], normals: THREE.Material[] = [];
    primitives.forEach(p => {
        const m = p.material;
        const basic = new THREE.MeshBasicMaterial({ map: m.map, alphaMap: m.alphaMap, alphaTest: m.alphaTest, color: m.color, vertexColors: m.vertexColors, side: THREE.DoubleSide });
        owned.push(basic);
        const normal = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
        normal.onBeforeCompile = shader => {
            shader.uniforms.pfBakeMap = { value: m.map };
            shader.uniforms.pfBakeAlpha = { value: m.alphaMap };
            shader.uniforms.pfBakeUv = { value: m.map?.matrix ?? new THREE.Matrix3() };
            shader.uniforms.pfBakeAlphaUv = { value: m.alphaMap?.matrix ?? new THREE.Matrix3() };
            shader.vertexShader = 'varying vec2 pfBakeTexcoord;\n' + shader.vertexShader;
            shader.vertexShader = inject(shader.vertexShader, '#include <begin_vertex>', '#include <begin_vertex>\n pfBakeTexcoord=uv;');
            shader.fragmentShader = '#include <common>\nvarying vec2 pfBakeTexcoord; uniform sampler2D pfBakeMap,pfBakeAlpha; uniform mat3 pfBakeUv,pfBakeAlphaUv;\n' + shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace('void main() {', `void main() {
        float coverage=1.;
        ${m.map ? 'coverage*=texture2D(pfBakeMap,(pfBakeUv*vec3(pfBakeTexcoord,1.)).xy).a;' : ''}
        ${m.alphaMap ? 'coverage*=texture2D(pfBakeAlpha,(pfBakeAlphaUv*vec3(pfBakeTexcoord,1.)).xy).g;' : ''}
        if(coverage<${Math.max(.01, m.alphaTest).toFixed(4)}) discard;
      `).replace('normalize( normal ) * 0.5 + 0.5', 'normalize( inverseTransformDirection( normal, viewMatrix ) ) * 0.5 + 0.5');
        };
        normal.customProgramCacheKey = () => `tree-bake-normal:${Boolean(m.map)}:${Boolean(m.alphaMap)}:${m.alphaTest}`;
        normals.push(normal);
        scene.add(new THREE.Mesh(p.geometry, basic));
    });
    const box = new THREE.Box3().setFromObject(scene), centre = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const width = Math.max(size.x, size.z) * 1.12, height = size.y * 1.06;
    const camera = new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, .01, Math.max(100, size.length() * 10));
    const colour = new THREE.WebGLRenderTarget(1024, 512), normal = new THREE.WebGLRenderTarget(1024, 512);
    const targets = [colour, normal], clear = new THREE.Color();
    try {
        for (let view = 0; view < 8; view++) {
            // Yield between views to avoid one long generation task on a phone. Never mutate the renderer across an await.
            await new Promise<void>(resolve => typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => resolve()) : setTimeout(resolve, 0));
            if (renderer.getContext().isContextLost())
                throw new Error('Tree atlas context lost');
            const oldTarget = renderer.getRenderTarget(), oldAlpha = renderer.getClearAlpha(), oldAuto = renderer.autoClear, oldTone = renderer.toneMapping;
            renderer.getClearColor(clear);
            try {
                const angle = view * Math.PI / 4, distance = Math.max(20, size.length() * 2);
                camera.position.set(centre.x + Math.sin(angle) * distance, centre.y, centre.z + Math.cos(angle) * distance);
                camera.lookAt(centre);
                renderer.autoClear = false;
                renderer.toneMapping = THREE.NoToneMapping;
                targets.forEach((target, channel) => {
                    scene.children.forEach((mesh, i) => { (mesh as THREE.Mesh).material = channel ? normals[i] : owned[i]; });
                    target.viewport.set(view % 4 * 256, Math.floor(view / 4) * 256, 256, 256);
                    target.scissor.copy(target.viewport);
                    target.scissorTest = true;
                    renderer.setRenderTarget(target);
                    renderer.setClearColor(0, 0);
                    renderer.clear();
                    renderer.render(scene, camera);
                });
            }
            finally {
                renderer.setRenderTarget(oldTarget);
                renderer.setClearColor(clear, oldAlpha);
                renderer.autoClear = oldAuto;
                renderer.toneMapping = oldTone;
            }
        }
    }
    catch (error) {
        targets.forEach(t => t.dispose());
        throw error;
    }
    finally {
        owned.forEach(m => m.dispose());
        normals.forEach(m => m.dispose());
    }
    const geometry = new THREE.PlaneGeometry(width, height, 1, 4);
    geometry.translate(centre.x, centre.y, centre.z);
    const material = new THREE.MeshStandardMaterial({ map: colour.texture, alphaTest: .22, side: THREE.DoubleSide, roughness: .85 });
    material.onBeforeCompile = shader => {
        shader.uniforms.pfTreeNormals = { value: normal.texture };
        shader.uniforms.pfTreeCentre = { value: centre };
        shader.vertexShader = 'uniform vec3 pfTreeCentre; varying vec2 pfTreeViews; varying float pfTreeYaw;\n' + shader.vertexShader;
        shader.vertexShader = inject(shader.vertexShader, '#include <begin_vertex>', `#include <begin_vertex>
      mat4 atlasWorld=modelMatrix;
      #ifdef USE_INSTANCING
      atlasWorld=modelMatrix*instanceMatrix;
      #endif
      vec3 atlasCentre=(atlasWorld*vec4(pfTreeCentre,1.)).xyz;
      vec3 atlasView=normalize(vec3(cameraPosition.x-atlasCentre.x,0.,cameraPosition.z-atlasCentre.z));
      pfTreeYaw=atan(atlasWorld[2].x,atlasWorld[2].z);
      float atlasAngle=mod((atan(atlasView.x,atlasView.z)-pfTreeYaw)/.7853981634+16.,8.);
      pfTreeViews=vec2(floor(atlasAngle),fract(atlasAngle));
      vec3 atlasRight=vec3(atlasView.z,0.,-atlasView.x);
      vec3 atlasPoint=atlasCentre+atlasRight*(transformed.x-pfTreeCentre.x)*length(atlasWorld[0].xyz)+vec3(0.,(transformed.y-pfTreeCentre.y)*length(atlasWorld[1].xyz),0.);
      transformed=(inverse(atlasWorld)*vec4(atlasPoint,1.)).xyz;
    `);
        shader.fragmentShader = 'uniform sampler2D pfTreeNormals; varying vec2 pfTreeViews; varying float pfTreeYaw;\n' + shader.fragmentShader;
        shader.fragmentShader = inject(shader.fragmentShader, '#include <map_fragment>', `
      vec2 atlasLocal=clamp(vMapUv,vec2(.5/256.),vec2(1.-.5/256.));
      float atlasNext=mod(pfTreeViews.x+1.,8.);
      vec2 atlasA=(atlasLocal+vec2(mod(pfTreeViews.x,4.),floor(pfTreeViews.x/4.)))/vec2(4.,2.);
      vec2 atlasB=(atlasLocal+vec2(mod(atlasNext,4.),floor(atlasNext/4.)))/vec2(4.,2.);
      vec4 atlasColour=mix(texture2D(map,atlasA),texture2D(map,atlasB),pfTreeViews.y);
      // The render target stores premultiplied edge colour; restore it before alpha testing.
      atlasColour.rgb/=max(atlasColour.a,.01);
      diffuseColor*=atlasColour;
    `);
        shader.fragmentShader = inject(shader.fragmentShader, '#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      vec4 atlasNormalA=texture2D(pfTreeNormals,atlasA),atlasNormalB=texture2D(pfTreeNormals,atlasB);
      vec4 atlasEncoded=mix(atlasNormalA,atlasNormalB,pfTreeViews.y);
      vec3 atlasNormal=atlasEncoded.rgb/max(atlasEncoded.a,.01)*2.-1.;
      if(dot(atlasNormal,atlasNormal)<.0001) atlasNormal=vec3(0.,1.,0.);
      atlasNormal=normalize(atlasNormal);
      atlasNormal=vec3(cos(pfTreeYaw)*atlasNormal.x+sin(pfTreeYaw)*atlasNormal.z,atlasNormal.y,-sin(pfTreeYaw)*atlasNormal.x+cos(pfTreeYaw)*atlasNormal.z);
      normal=normalize(mat3(viewMatrix)*atlasNormal);
    `);
    };
    material.customProgramCacheKey = () => 'polyform-tree-atlas-v1';
    return { primitive: { geometry, material }, height: size.y, dispose: () => { geometry.dispose(); material.dispose(); targets.forEach(t => t.dispose()); } };
}
/** Billboard deformation is invisible to triangle raycasts. Use a conservative crown volume for instance picking. */
export function treeCardRaycast(mesh: THREE.InstancedMesh) {
    mesh.geometry.computeBoundingBox();
    const source = mesh.geometry.boundingBox!.clone();
    const width = source.max.x - source.min.x, centre = (source.max.z + source.min.z) / 2;
    source.min.z = centre - width / 2;
    source.max.z = centre + width / 2;
    source.expandByScalar(.5);
    const matrix = new THREE.Matrix4(), box = new THREE.Box3(), point = new THREE.Vector3();
    mesh.raycast = (raycaster, hits) => {
        for (let i = 0; i < mesh.count; i++) {
            mesh.getMatrixAt(i, matrix);
            matrix.premultiply(mesh.matrixWorld);
            box.copy(source).applyMatrix4(matrix);
            if (!raycaster.ray.intersectBox(box, point))
                continue;
            const distance = raycaster.ray.origin.distanceTo(point);
            if (distance >= raycaster.near && distance <= raycaster.far)
                hits.push({ distance, point: point.clone(), object: mesh, instanceId: i });
        }
    };
}
