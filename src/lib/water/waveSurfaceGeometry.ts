import * as THREE from 'three';
import { offsetOutline } from './waterBody';

/** Subdivide the exact polygon triangulation so vertex-displaced crests retain its outline. */
export function createWaveSurfaceGeometry(points: [number, number][], margin: number): THREE.BufferGeometry {
  const outline = new THREE.Shape(offsetOutline(points, margin).map(([x,z])=>new THREE.Vector2(x,-z)));
  const base=new THREE.ShapeGeometry(outline); base.rotateX(-Math.PI/2);
  const flat=base.toNonIndexed(), p=flat.getAttribute('position');
  base.computeBoundingBox();
  const extent=Math.max(base.boundingBox!.max.x-base.boundingBox!.min.x,base.boundingBox!.max.z-base.boundingBox!.min.z);
  const triangles=p.count/3;
  const depth=Math.max(0,Math.min(6,Math.ceil(Math.log2(Math.max(extent/.3,1))),Math.floor(Math.log(Math.max(1,18000/triangles))/Math.log(4))));
  const positions:number[]=[];
  type Point=[number,number,number];
  const mid=(a:Point,b:Point):Point=>[(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2];
  const divide=(a:Point,b:Point,c:Point,d:number)=>{
    if(!d){positions.push(...a,...b,...c);return;}
    const ab=mid(a,b),bc=mid(b,c),ca=mid(c,a);
    divide(a,ab,ca,d-1);divide(ab,b,bc,d-1);divide(ca,bc,c,d-1);divide(ab,bc,ca,d-1);
  };
  for(let i=0;i<p.count;i+=3){const read=(j:number):Point=>[p.getX(j),p.getY(j),p.getZ(j)];divide(read(i),read(i+1),read(i+2),depth);}
  flat.dispose();base.dispose();
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  g.computeVertexNormals();g.computeBoundingSphere();if(g.boundingSphere)g.boundingSphere.radius+=1.5;
  return g;
}
