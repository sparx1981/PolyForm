import React, { useState, useEffect } from 'react';
import * as THREE from 'three';
import { Shape } from '../types';
import { PLANT_SPECIES_CATALOG } from '../lib/plantLibrary';
import { loadPlantGLTF, loadPlantFBX, loadPlantUSD, getCachedPlantTexture } from '../lib/plantModelLoader';

interface PlantModelMeshProps {
  shape: Shape;
  selectedId: string | null;
  meshProps: any;
  selectionHighlight?: React.ReactNode;
}

export function PlantModelMesh({ shape, selectedId, meshProps, selectionHighlight }: PlantModelMeshProps) {
  const [modelGroup, setModelGroup] = useState<THREE.Group | null>(null);

  const plantSpecies = PLANT_SPECIES_CATALOG.find(s => s.id === shape.plantSpeciesId);
  const variation = shape.plantVariation || (plantSpecies?.variations ? plantSpecies.variations[0] : 'VarA');

  useEffect(() => {
    if (!plantSpecies) return;

    if (plantSpecies.modelType === 'gltf') {
      // English Oak and other GLTF Models
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

        // Apply realistic natural oak foliage and bark materials
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
              // Foliage
              mesh.material = new THREE.MeshStandardMaterial({
                color: shape.color ? new THREE.Color(shape.color) : new THREE.Color('#2d6a4f'),
                roughness: 0.65,
                metalness: 0.05,
                side: THREE.DoubleSide,
                shadowSide: THREE.DoubleSide,
                emissive: selectedId === shape.id ? new THREE.Color('#0063A3') : new THREE.Color('#000000'),
                emissiveIntensity: selectedId === shape.id ? 0.35 : 0
              });
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
            mesh.material = new THREE.MeshStandardMaterial({
              color: shape.color ? new THREE.Color(shape.color) : new THREE.Color('#2d6a4f'),
              roughness: 0.65,
              metalness: 0.05,
              side: THREE.DoubleSide
            });
          }
        });

        setModelGroup(cloned);
      });

    } else if (plantSpecies.modelType === 'fbx') {
      // Ribbon Grass FBX Models
      const grassVariation = variation || 'VarA';
      const fbxUrl = `${plantSpecies.modelPath}${grassVariation}_LOD0.fbx`;
      const textureBase = plantSpecies.texturePath || '/models/plants/ribbon_grass/Ribbon_Grass_tbdpec3r_Mid_2K_';

      loadPlantFBX(fbxUrl, (fbx) => {
        const cloned = fbx.clone(true);

        // Load 2K Botanical PBR Texture maps
        const albedoTex = getCachedPlantTexture(`${textureBase}BaseColor.jpg`);
        const opacityTex = getCachedPlantTexture(`${textureBase}Opacity.jpg`);
        const normalTex = getCachedPlantTexture(`${textureBase}Normal.jpg`);
        const roughnessTex = getCachedPlantTexture(`${textureBase}Roughness.jpg`);
        const aoTex = getCachedPlantTexture(`${textureBase}AO.jpg`);

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

            mesh.material = new THREE.MeshStandardMaterial({
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
          }
        });

        setModelGroup(cloned);
      });
    }
  }, [shape.plantSpeciesId, variation, shape.scale, selectedId === shape.id, shape.color]);

  // If model is loading or procedural fallback
  if (!modelGroup) {
    return (
      <mesh {...meshProps}>
        <sphereGeometry args={[shape.type === 'tree' ? 0.8 : 0.35, 12, 12]} />
        <meshStandardMaterial color={shape.color || (shape.type === 'tree' ? '#2d6a4f' : '#40916c')} roughness={0.7} />
        {selectionHighlight}
      </mesh>
    );
  }

  const [px, py, pz] = shape.position || [0, 0, 0];

  return (
    <group 
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
