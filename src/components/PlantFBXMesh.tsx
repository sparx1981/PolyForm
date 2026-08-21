import React, { useState, useEffect } from 'react';
import * as THREE from 'three';
import { Shape } from '../types';
import { PLANT_SPECIES_CATALOG } from '../lib/plantLibrary';
import { loadPlantFBX, getCachedPlantTexture } from '../lib/plantModelLoader';

interface PlantFBXMeshProps {
  shape: Shape;
  selectedId: string | null;
  meshProps: any;
  selectionHighlight?: React.ReactNode;
}

export function PlantFBXMesh({ shape, selectedId, meshProps, selectionHighlight }: PlantFBXMeshProps) {
  const [modelGroup, setModelGroup] = useState<THREE.Group | null>(null);

  const plantSpecies = PLANT_SPECIES_CATALOG.find(s => s.id === shape.plantSpeciesId);
  const variation = shape.plantVariation || (plantSpecies?.variations ? plantSpecies.variations[0] : 'VarA');

  useEffect(() => {
    if (!plantSpecies || plantSpecies.modelType !== 'fbx' || !plantSpecies.modelPath) return;

    // For Ribbon Grass, variation matches: Ribbon_Grass_tbdpec3r_Mid_tbdpec3r_VarA_LOD0.fbx
    const fbxUrl = `${plantSpecies.modelPath}${variation}_LOD0.fbx`;
    const textureBase = plantSpecies.texturePath || '/models/plants/ribbon_grass/Ribbon_Grass_tbdpec3r_Mid_2K_';

    loadPlantFBX(fbxUrl, (fbx) => {
      const cloned = fbx.clone(true);

      // Load PBR Texture maps
      const albedoTex = getCachedPlantTexture(`${textureBase}BaseColor.jpg`);
      const opacityTex = getCachedPlantTexture(`${textureBase}Opacity.jpg`);
      const normalTex = getCachedPlantTexture(`${textureBase}Normal.jpg`);
      const roughnessTex = getCachedPlantTexture(`${textureBase}Roughness.jpg`);
      const aoTex = getCachedPlantTexture(`${textureBase}AO.jpg`);

      // Scale model appropriately based on shape scale and botanical dimensions (FBX units are cm -> 0.015m)
      const scaleMultiplier = (shape.scale ? shape.scale[0] : 1) * 0.015;

      cloned.scale.set(scaleMultiplier, scaleMultiplier, scaleMultiplier);

      // Apply double-sided botanical materials with alpha test for grass blades
      cloned.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.material = new THREE.MeshStandardMaterial({
            map: albedoTex,
            alphaMap: opacityTex,
            transparent: true,
            alphaTest: 0.25,
            normalMap: normalTex,
            roughnessMap: roughnessTex,
            aoMap: aoTex,
            roughness: 0.55,
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
  }, [shape.plantSpeciesId, variation, shape.scale, selectedId === shape.id]);

  if (!modelGroup) {
    // Fallback procedural bush while loading or if model is loading
    return (
      <mesh {...meshProps}>
        <sphereGeometry args={[0.35, 12, 12]} />
        <meshStandardMaterial color={shape.color || '#40916c'} roughness={0.7} />
      </mesh>
    );
  }

  return (
    <group 
      position={shape.position} 
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
