import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Shape } from '../types';
import { PLANT_SPECIES_CATALOG } from '../lib/plantLibrary';
import { loadPlantGLTF, loadPlantFBX, loadPlantUSD, getCachedPlantTexture } from '../lib/plantModelLoader';
import { createTreeGeometry, createBushGeometry } from '../lib/landscapeGeometry';
import { VegetationWind } from '../lib/graphics/VegetationWind';

interface PlantModelMeshProps {
  shape: Shape;
  selectedId: string | null;
  meshProps: any;
  selectionHighlight?: React.ReactNode;
}

export function PlantModelMesh({ shape, selectedId, meshProps, selectionHighlight }: PlantModelMeshProps) {
  const [modelGroup, setModelGroup] = useState<THREE.Group | null>(null);
  const groupRef = useRef<THREE.Group>(null);
  const wind = useMemo(() => new VegetationWind(), []);
  const fallbackRef = useRef<THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>>(null);
  const fallbackGeom = useMemo(() => shape.type === 'tree'
    ? createTreeGeometry(shape.plantSpeciesId || 'english_oak')
    : createBushGeometry(shape.plantSpeciesId || 'ribbon_grass'), [shape.type, shape.plantSpeciesId]);
  useEffect(() => () => fallbackGeom.dispose(), [fallbackGeom]);
  useEffect(() => {
    if (!fallbackRef.current) return;
    fallbackGeom.computeBoundingBox();
    const box = fallbackGeom.boundingBox!;
    return wind.attachMesh(fallbackRef.current, box.min.y, Math.max(0.001, box.max.y - box.min.y));
  }, [wind, fallbackGeom, modelGroup]);

  const plantSpecies = PLANT_SPECIES_CATALOG.find(s => s.id === shape.plantSpeciesId);
  const variation = shape.plantVariation || (plantSpecies?.variations ? plantSpecies.variations[0] : 'VarC');

  useFrame((state) => wind.setTime(state.clock.elapsedTime));

  useEffect(() => {
    let cancelled = false;
    const cleanups: (() => void)[] = [];
    const ownedMaterials: THREE.Material[] = [];
    const ownedGeometry: THREE.BufferGeometry[] = [];
    setModelGroup(null);
    const finish = (group: THREE.Group) => {
      group.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return;
        const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[]>;
        ownedMaterials.push(...(Array.isArray(mesh.material) ? mesh.material : [mesh.material]));
        mesh.geometry.computeBoundingBox();
        const box = mesh.geometry.boundingBox!;
        cleanups.push(wind.attachMesh(mesh, box.min.y, Math.max(0.001, box.max.y - box.min.y)));
      });
      setModelGroup(group);
    };
    if (!plantSpecies) return;

    if (plantSpecies.modelType === 'gltf') {
      // English Oak and other GLTF Tree Models
      const gltfVariation = (variation || 'a').toLowerCase();
      const gltfUrl = `${plantSpecies.modelPath}${gltfVariation}.glb`;

      loadPlantGLTF(gltfUrl, (gltfGroup) => {
        if (cancelled) return;
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

            // Preserve imported PBR maps and alpha cutouts instead of replacing the
            // scan's materials with untextured colors. Never mutate cached materials.
            const originals = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            const materials = originals.map(original => {
              const isTrunk = /trunk|bark/i.test(`${mesh.name} ${original.name}`);
              const mat = original instanceof THREE.MeshStandardMaterial
                ? original.clone() : new THREE.MeshStandardMaterial({ roughness: isTrunk ? 0.9 : 0.65 });
              if (!mat.map) mat.color.set(isTrunk ? (plantSpecies.trunkColor || '#4e3629') : (shape.color || '#2d6a4f'));
              if (!isTrunk) {
                mat.side = mat.shadowSide = THREE.DoubleSide;
                if (mat.alphaMap || mat.alphaTest > 0) { mat.alphaTest = Math.max(mat.alphaTest, 0.25); mat.transparent = false; }
              }
              mat.emissive.set(selectedId === shape.id ? '#0063A3' : '#000000');
              mat.emissiveIntensity = selectedId === shape.id ? 0.35 : 0;
              return mat;
            });
            mesh.material = Array.isArray(mesh.material) ? materials : materials[0];
          }
        });

        finish(cloned);
      });

    } else if (plantSpecies.modelType === 'usd') {
      // Legacy USD loader fallback
      const usdVariation = variation || 'A';
      const usdUrl = `${plantSpecies.modelPath}${usdVariation}.usd`;

      loadPlantUSD(usdUrl, (usdGroup) => {
        if (cancelled) return;
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
            mesh.material = mat;
          }
        });

        finish(cloned);
      });

    } else if (plantSpecies.modelType === 'fbx') {
      // Ribbon Grass FBX Models
      const validVariations = ['VarC', 'VarD', 'VarE', 'VarF'];
      const grassVariation = validVariations.includes(variation) ? variation : 'VarC';
      const fbxUrl = `${plantSpecies.modelPath}${grassVariation}_LOD0.fbx`;
      const textureBase = plantSpecies.texturePath || '/models/plants/ribbon_grass/Ribbon_Grass_tbdpec3r_Mid_2K_';

      loadPlantFBX(fbxUrl, (fbx) => {
        if (cancelled) return;
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
            mesh.geometry = mesh.geometry.clone();
            ownedGeometry.push(mesh.geometry);
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
              transparent: false,
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
            mesh.material = bladeMat;
          }
        });

        finish(cloned);
      }, (err) => {
        console.warn('[PlantModelMesh] Falling back to procedural geometry for:', plantSpecies.id, err);
      });
    }
    return () => {
      cancelled = true;
      cleanups.forEach(cleanup => cleanup());
      ownedMaterials.forEach(material => material.dispose());
      ownedGeometry.forEach(geometry => geometry.dispose());
    };
  }, [shape.plantSpeciesId, variation, shape.scale, selectedId === shape.id, shape.color, wind]);

  // Immediate high-realism procedural fallback while loading (never a placeholder sphere)
  if (!modelGroup) {
    return (
      <mesh {...meshProps} ref={fallbackRef}>
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
