import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Smooth a non-indexed cloth/upholstery patch without changing its saved triangle order. */
export function smoothPatchNormals(positions: ArrayLike<number>): number[] {
  const source=new THREE.BufferGeometry();source.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  const welded=mergeVertices(source,1e-5);welded.computeVertexNormals();
  const normals=welded.getAttribute('normal'), index=welded.getIndex()!, result:number[]=[];
  for(let i=0;i<index.count;i++){const j=index.getX(i);result.push(normals.getX(j),normals.getY(j),normals.getZ(j));}
  source.dispose();welded.dispose();return result;
}
