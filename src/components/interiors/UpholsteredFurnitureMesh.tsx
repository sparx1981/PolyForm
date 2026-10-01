import React, { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { createInteriorFurnitureGeometry, type InteriorFurnitureType } from '../../lib/interiors/parametricFurniture';
import { smoothPatchNormals } from '../../lib/interiors/upholsteryNormals';
import type { Shape } from '../../types';

/** Saved sculpted upholstery with woven micro-normal detail and fabric sheen; no live solver. */
export function UpholsteredFurnitureMesh({shape,meshProps,surface,selectionHighlight}: {
  shape: Shape; meshProps: any; surface?: THREE.MeshPhysicalMaterialParameters; selectionHighlight?: React.ReactNode;
}) {
  const geometry=useMemo(()=>{
    const g=new THREE.BufferGeometry(), data=shape.geometryData!;
    g.setAttribute('position',new THREE.Float32BufferAttribute(data.positions!,3));
    if(data.normals?.length)g.setAttribute('normal',new THREE.Float32BufferAttribute(data.normals,3)); else g.computeVertexNormals();
    if(data.uvs?.length)g.setAttribute('uv',new THREE.Float32BufferAttribute(data.uvs,2));
    let groups=shape.customData.furnitureMaterialGroups;
    if (!groups?.length) {
      // Older saved interiors have the same part order but no material groups. Infer them
      // when the topology matches, preserving all saved positions and user edits.
      const template=createInteriorFurnitureGeometry(shape.customData.furnitureType as InteriorFurnitureType,shape.customData.semanticComponent?.params);
      if(template.getAttribute('position').count===g.getAttribute('position').count)groups=template.groups;
      template.dispose();
      groups ??= [{start:0,count:g.getAttribute('position').count,materialIndex:1}];
      const normals=g.getAttribute('normal') as THREE.BufferAttribute;
      for(const group of groups) if(group.materialIndex===1){
        const start=group.start*3, end=(group.start+group.count)*3;
        const smooth=smoothPatchNormals(data.positions!.slice(start,end));
        for(let i=0;i<group.count;i++)normals.setXYZ(group.start+i,smooth[i*3],smooth[i*3+1],smooth[i*3+2]);
      }
    }
    for(const group of groups)g.addGroup(group.start,group.count,group.materialIndex);
    return g;
  },[shape.geometryData,shape.customData.furnitureMaterialGroups]);
  const weave=useMemo(()=>{
    const size=64, data=new Uint8Array(size*size*4);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const nx=Math.sin(x*Math.PI/4)*0.16, ny=Math.sin(y*Math.PI/4)*0.16;
      const i=(y*size+x)*4;data[i]=(nx*.5+.5)*255;data[i+1]=(ny*.5+.5)*255;data[i+2]=Math.sqrt(1-nx*nx-ny*ny)*255;data[i+3]=255;
    }
    const t=new THREE.DataTexture(data,size,size);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(18,18);
    t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.generateMipmaps=true;t.needsUpdate=true;return t;
  },[]);
  useEffect(()=>()=>geometry.dispose(),[geometry]);
  useEffect(()=>()=>weave.dispose(),[weave]);
  return <group {...meshProps}>
    <mesh geometry={geometry} castShadow={meshProps.castShadow} receiveShadow={meshProps.receiveShadow} userData={{isShape:true,id:shape.id}}>
      <meshStandardMaterial attach="material-0" color="#76604a" roughness={0.6} opacity={surface?.opacity ?? 1} transparent={surface?.transparent ?? false} depthWrite={surface?.depthWrite ?? true} />
      <meshPhysicalMaterial attach="material-1" color={shape.color.startsWith('#') ? shape.color : '#ffffff'} roughness={0.92}
        sheen={0.5} sheenRoughness={0.85} sheenColor={surface?.color ?? '#ffffff'} {...surface} normalMap={surface?.normalMap ?? weave} normalScale={surface?.normalMap ? surface.normalScale ?? [1, 1] : [0.25, 0.25]} />
    </mesh>
    {selectionHighlight}
  </group>;
}
