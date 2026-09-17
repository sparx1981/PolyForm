import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Shape } from '../types';
import { PLANT_SPECIES_CATALOG } from '../lib/plantLibrary';
import { loadPlantGLTF, loadPlantFBX, loadPlantUSD, getCachedPlantTexture } from '../lib/plantModelLoader';
import { createTreeGeometry, createBushGeometry } from '../lib/landscapeGeometry';

interface PlantModelMeshProps {
  shape: Shape;
  selectedId: string | null;
  meshProps: any;
  selectionHighlight?: React.ReactNode;
}

/**
 * Attaches gentle wind foliage shader animation to a standard material
 * similar to the wind wave calculation on Procedural Grass.
 */
function applyFoliageWindAnimation(mat: THREE.MeshStandardMaterial, windStrength: number = 0.07, heightThreshold: number = 0.8) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uWindStrength = { value: windStrength };
    shader.vertexShader = `
      uniform float uTime;
      uniform float uWindStrength;
    ` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      if (position.y > ${heightThreshold.toFixed(2)}) {
        float swayFactor = (position.y - ${heightThreshold.toFixed(2)}) * 0.05 * uWindStrength;
        float wave1 = sin(uTime * 2.2 + position.x * 0.8 + position.z * 0.8) * swayFactor;
        float wave2 = cos(uTime * 3.4 + position.z * 1.3) * (swayFactor * 0.45);
        transformed.x += wave1;
        transformed.z += wave2;
      }
      `
    );
    mat.userData.shader = shader;
  };
}

export function PlantModelMesh({ shape, selectedId, meshProps, selectionHighlight }: PlantModelMeshProps) {
  const [modelGroup, setModelGroup] = useState<THREE.Group | null>(null);
  const groupRef = useRef<THREE.Group>(null);

  const plantSpecies = PLANT_SPECIES_CATALOG.find(s => s.id === shape.plantSpeciesId);
  const variation = shape.plantVariation || (plantSpecies?.variations ? plantSpecies.variations[0] : 'VarC');

  // Real-time foliage wind animation loop matching Procedural Grass wind dynamics
  useFrame((state) => {
    if (!modelGroup) return;
    const time = state.clock.getElapsedTime();
    modelGroup.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
        if (mat?.userData?.shader?.uniforms?.uTime) {
          mat.userData.shader.uniforms.uTime.value = time;
        }
      }
    });
  });

  useEffect(() => {
    if (!plantSpecies) return;

    if (plantSpecies.modelType === 'gltf') {
      // English Oak and other GLTF Tree Models
      const gltfVariation = (variation || 'a').toLowerCase();
      const gltfUrl = `${plantSpecies.modelPath}${gltfVariation}.glb`;

      loadPlantGLTF(gltfUrl, (gltfGroup) => {
        const cloned = gltfGroup.clone(true);

        // Compute bounding box and normalize tree scale
        const box = new THREE.Box3().setFromObject(cloned);
        const size = new THREE.Vector3();
        box.getSize(size);
        const height = size.y > 0 ? size.y : 12;

        // Target height based on defaultHeight (e.g. 12m) and user scale
        const userScale = (shape.scale ? shape.scale[1] : 1) || 1;
        const targetHeight = (plantSpecies.defaultHeight || 12.0) * userScale;
        const uniformScale = targetHeight / height;

        cloned.scale.set(uniformScale, uniformScale, uniformScale);
        cloned.position.set(0, 0, 0);

        // Apply realistic natural oak foliage and bark materials with wind animation
        cloned.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            mesh.castShadow = true;
            mesh.receiveShadow = true;

            const isTrunk = mesh.name.toLowerCase().includes('trunk') || mesh.name.toLowerCase().includes('bark');

            if (isTrunk) {
              mesh.material = new THREE.MeshStandardMaterial({
                color: shape.color ? new THREE.Color(shape.color) : new THREE.Color('#4e3629'),
                roughness: 0.9,
                metalness: 0.05,
                emissive: selectedId === shape.id ? new THREE.Color('#0063A3') : new THREE.Color('#000000'),
                emissiveIntensity: selectedId === shape.id ? 0.35 : 0
              });
            } else {
              // High fidelity foliage with wind sway
              const foliageMat = new THREE.MeshStandardMaterial({
                color: shape.color ? new THREE.Color(shape.color) : new THREE.Color('#2d6a4f'),
                roughness: 0.65,
                metalness: 0.05,
                side: THREE.DoubleSide,
                shadowSide: THREE.DoubleSide,
                emissive: selectedId === shape.id ? new THREE.Color('#0063A3') : new THREE.Color('#000000'),
                emissiveIntensity: selectedId === shape.id ? 0.35 : 0
              });
              applyFoliageWindAnimation(foliageMat, 0.12, 1.5);
              mesh.material = foliageMat;
            }
          }
        });

        setModelGroup(cloned);
      });

    } else if (plantSpecies.modelType === 'usd') {
      // Legacy USD loader fallback
      const usdVariation = variation || 'A';
      const usdUrl = `${plantSpecies.modelPath}${usdVariation}.usd`;

      loadPlantUSD(usdUrl, (usdGroup) => {
        const cloned = usdGroup.clone(true);
        const box = new THREE.Box3().setFromObject(cloned);
        const size = new THREE.Vector3();
        box.getSize(size);
        const height = size.y > 0 ? size.y : 15;
        const userScale = (shape.scale ? shape.scale[1] : 1) || 1;
        const targetHeight = (plantSpecies.defaultHeight || 12.0) * userScale;
        const uniformScale = targetHeight / height;

        cloned.scale.set(uniformScale, uniformScale, uniformScale);
        cloned.position.set(0, 0, 0);

        cloned.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            const mat = new THREE.MeshStandardMaterial({
              color: shape.color ? new THREE.Color(shape.color) : new THREE.Color('#2d6a4f'),
              roughness: 0.65,
              metalness: 0.05,
              side: THREE.DoubleSide
            });
            applyFoliageWindAnimation(mat, 0.08, 0.8);
            mesh.material = mat;
          }
        });

        setModelGroup(cloned);
      });

    } else if (plantSpecies.modelType === 'fbx') {
      // Ribbon Grass FBX Models
      const validVariations = ['VarC', 'VarD', 'VarE', 'VarF'];
      const grassVariation = validVariations.includes(variation) ? variation : 'VarC';
      const fbxUrl = `${plantSpecies.modelPath}${grassVariation}_LOD0.fbx`;
      const textureBase = plantSpecies.texturePath || '/models/plants/ribbon_grass/Ribbon_Grass_tbdpec3r_Mid_2K_';

      loadPlantFBX(fbxUrl, (fbx) => {
        const cloned = fbx.clone(true);

        // Load 2K Botanical PBR Texture maps
        const albedoTex = getCachedPlantTexture(`${textureBase}BaseColor.jpg`);
        const opacityTex = getCachedPlantTexture(`${textureBase}Opacity.jpg`, false);
        const normalTex = getCachedPlantTexture(`${textureBase}Normal.jpg`, false);
        const roughnessTex = getCachedPlantTexture(`${textureBase}Roughness.jpg`, false);
        const aoTex = getCachedPlantTexture(`${textureBase}AO.jpg`, false);

        // Compute bounding box and normalize grass scale
        const box = new THREE.Box3().setFromObject(cloned);
        const size = new THREE.Vector3();
        box.getSize(size);
        const nativeHeight = size.y > 0 ? size.y : 54.0;

        // Target height based on defaultHeight (e.g. 0.55m) and user scale
        const userScale = (shape.scale ? shape.scale[1] : 1) || 1;
        const targetHeight = (plantSpecies.defaultHeight || 0.55) * userScale;
        const uniformScale = targetHeight / nativeHeight;

        cloned.scale.set(uniformScale, uniformScale, uniformScale);
        cloned.position.set(0, 0, 0);

        // Apply double-sided botanical materials with alpha test for high-fidelity blades
        cloned.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            mesh.castShadow = true;
            mesh.receiveShadow = true;

            // Remove any vertex colors that could tint or conflict with the albedo texture
            if (mesh.geometry.attributes.color) {
              mesh.geometry.deleteAttribute('color');
            }

            // aoMap requires a second UV channel - reuse the primary UVs
            const uvAttr = mesh.geometry.attributes.uv;
            if (uvAttr && !mesh.geometry.attributes.uv2) {
              mesh.geometry.setAttribute('uv2', uvAttr);
            }

            const bladeMat = new THREE.MeshStandardMaterial({
              map: albedoTex,
              alphaMap: opacityTex,
              transparent: true,
              alphaTest: 0.25,
              normalMap: normalTex,
              roughnessMap: roughnessTex,
              aoMap: aoTex,
              roughness: 0.6,
              metalness: 0.02,
              side: THREE.DoubleSide,
              shadowSide: THREE.DoubleSide,
              emissive: selectedId === shape.id ? new THREE.Color('#0063A3') : new THREE.Color('#000000'),
              emissiveIntensity: selectedId === shape.id ? 0.35 : 0
            });
            applyFoliageWindAnimation(bladeMat, 0.09, 0.05);
            mesh.material = bladeMat;
          }
        });

        setModelGroup(cloned);
      }, (err) => {
        console.warn('[PlantModelMesh] Falling back to procedural geometry for:', plantSpecies.id, err);
      });
    }
  }, [shape.plantSpeciesId, variation, shape.scale, selectedId === shape.id, shape.color]);

  // Immediate high-realism procedural fallback while loading (never a placeholder sphere)
  if (!modelGroup) {
    const fallbackGeom = shape.type === 'tree'
      ? createTreeGeometry(shape.plantSpeciesId || 'english_oak')
      : createBushGeometry(shape.plantSpeciesId || 'ribbon_grass');

    return (
      <mesh {...meshProps}>
        <primitive object={fallbackGeom} attach="geometry" />
        <meshStandardMaterial
          vertexColors
          color="#ffffff"
          roughness={0.75}
          metalness={0.04}
          side={THREE.DoubleSide}
        />
        {selectionHighlight}
      </mesh>
    );
  }

  const [px, py, pz] = shape.position || [0, 0, 0];

  return (
    <group 
      ref={groupRef}
      position={[px, py, pz]}
      rotation={shape.rotation ? [shape.rotation[0], shape.rotation[1], shape.rotation[2]] : undefined}
      quaternion={shape.quaternion ? new THREE.Quaternion(...shape.quaternion) : undefined}
      userData={meshProps.userData}
      onClick={meshProps.onClick}
      onContextMenu={meshProps.onContextMenu}
    >
      <primitive object={modelGroup} />
      {selectionHighlight}
    </group>
  );
}
