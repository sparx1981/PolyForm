import * as THREE from 'three';
export interface QualitySnapshot {
    scene: THREE.Scene;
    camera: THREE.Camera;
    raster: string;
    warnings: string[];
    dispose: () => void;
}
export const qualityCapture: {
    current: (() => QualitySnapshot) | null;
} = { current: null };
/** Copies only visible model surfaces; never transfers live geometry, material hooks or editor helpers. */
export function freezeQualityScene(source: THREE.Scene, sourceCamera: THREE.Camera, raster = ''): QualitySnapshot {
    source.updateMatrixWorld(true);
    const scene = new THREE.Scene(), warnings = new Set<string>();
    const geometry = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    scene.background = source.background instanceof THREE.Color ? source.background.clone() : new THREE.Color('#c1d0db');
    // PMREM/CubeUV targets cannot be consumed as equirectangular path-tracing environments.
    if (source.environment?.mapping === THREE.EquirectangularReflectionMapping)
        scene.environment = source.environment;
    else
        warnings.add('The procedural sky and clouds use a still environment approximation.');
    scene.environmentIntensity = source.environmentIntensity;
    scene.environmentRotation.copy(source.environmentRotation);
    let triangles = 0;
    try {
        source.traverseVisible(object => {
            if ((object as THREE.Light).isLight) {
                const light = object as THREE.Light;
                if ((light as THREE.AmbientLight).isAmbientLight || (light as THREE.HemisphereLight).isHemisphereLight)
                    return;
                const copy = light.clone(false);
                copy.position.setFromMatrixPosition(light.matrixWorld);
                light.getWorldQuaternion(copy.quaternion);
                scene.add(copy);
                if ('target' in copy) {
                    const target = (light as THREE.DirectionalLight).target;
                    const dest = (copy as THREE.DirectionalLight).target;
                    dest.position.setFromMatrixPosition(target.matrixWorld);
                    scene.add(dest);
                }
                return;
            }
            const mesh = object as THREE.Mesh;
            if (!mesh.isMesh || mesh.userData.isHelper || mesh.userData.presentationOverlay || mesh.userData.presentationAux)
                return;
            if (mesh.userData.isTreeImpostor) {
                warnings.add('Distant tree cards are omitted from quality stills; Save raster retains them.');
                return;
            }
            if (mesh.userData.isGrass || (mesh.geometry as THREE.InstancedBufferGeometry).isInstancedBufferGeometry) {
                warnings.add('Procedural grass is omitted from quality stills; use Save raster to retain it.');
                return;
            }
            const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            if (list.some(m => !('isMeshStandardMaterial' in m) && !('isMeshBasicMaterial' in m) && !('isMeshPhysicalMaterial' in m))) {
                warnings.add('Custom shader surfaces such as animated water are omitted; Save raster retains them.');
                return;
            }
            if (list.some(m => m.clippingPlanes?.length))
                throw new Error('Quality stills require an uncut model. Turn off section/cut views, or save the raster image.');
            list.forEach(m => Object.values(m).forEach(value => { if (value instanceof THREE.Texture)
                textures.add(value); }));
            if (textures.size > 64)
                throw new Error('This view exceeds the quality still texture budget. Use fewer unique materials or save the raster image.');
            const count = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1;
            triangles += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3 * count;
            if (triangles > 2000000)
                throw new Error('This view exceeds the quality still geometry budget. Reduce vegetation or save the raster image.');
            if (list.some(m => m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile))
                warnings.add('Wind and fabric shader deformation are frozen in their rest pose.');
            if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
                warnings.add('Animated characters are omitted from quality stills.');
                return;
            }
            const geo = mesh.geometry.clone();
            geometry.add(geo);
            const mats = list.map(m => {
                let copy: THREE.MeshStandardMaterial;
                if ((m as THREE.MeshBasicMaterial).isMeshBasicMaterial) {
                    const basic = m as THREE.MeshBasicMaterial;
                    copy = new THREE.MeshStandardMaterial({ color: basic.color, map: basic.map, alphaMap: basic.alphaMap, alphaTest: basic.alphaTest, opacity: basic.opacity, transparent: basic.transparent, side: basic.side, roughness: 1 });
                }
                else
                    copy = (m as THREE.MeshStandardMaterial).clone();
                copy.onBeforeCompile = THREE.Material.prototype.onBeforeCompile;
                copy.customProgramCacheKey = THREE.Material.prototype.customProgramCacheKey;
                materials.add(copy);
                return copy;
            });
            const local = new THREE.Matrix4();
            for (let i = 0; i < count; i++) {
                const copy = new THREE.Mesh(geo, Array.isArray(mesh.material) ? mats : mats[0]);
                if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
                    (mesh as THREE.InstancedMesh).getMatrixAt(i, local);
                    copy.matrix.multiplyMatrices(mesh.matrixWorld, local);
                    if ((mesh as THREE.InstancedMesh).instanceColor) {
                        const colour = new THREE.Color();
                        (mesh as THREE.InstancedMesh).getColorAt(i, colour);
                        copy.material = mats.map(m => { const tint = m.clone(); tint.color.multiply(colour); materials.add(tint); return tint; });
                        if (!Array.isArray(mesh.material))
                            copy.material = (copy.material as THREE.MeshStandardMaterial[])[0];
                    }
                }
                else
                    copy.matrix.copy(mesh.matrixWorld);
                copy.matrixAutoUpdate = false;
                scene.add(copy);
            }
        });
    }
    catch (error) {
        geometry.forEach(g => g.dispose());
        materials.forEach(m => m.dispose());
        throw error;
    }
    const camera = sourceCamera.clone();
    sourceCamera.getWorldPosition(camera.position);
    sourceCamera.getWorldQuaternion(camera.quaternion);
    camera.updateMatrixWorld();
    return { scene, camera, raster, warnings: [...warnings], dispose: () => { geometry.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); } };
}
