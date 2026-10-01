import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { qualityRenderSize } from './pathTracing';
import { freezeQualityScene } from './qualitySnapshot';

describe('Path-tracing frozen scene fidelity',()=>{
  it('bakes morph targets and current skinned poses, without baking a child twice',()=>{
    const scene=new THREE.Scene(),geo=new THREE.BoxGeometry();
    geo.morphAttributes.position=[geo.attributes.position.clone()];
    for(let i=0;i<geo.attributes.position.count;i++)geo.morphAttributes.position[0].setY(i,geo.attributes.position.getY(i)+2);
    const mesh=new THREE.Mesh(geo,new THREE.MeshStandardMaterial());mesh.morphTargetInfluences![0]=.5;mesh.position.x=7;
    mesh.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial()));scene.add(mesh);
    const skinGeo=new THREE.BoxGeometry();
    const indices=new Uint16Array(skinGeo.attributes.position.count*4),weights=new Float32Array(indices.length);
    for(let i=0;i<weights.length;i+=4)weights[i]=1;
    skinGeo.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));skinGeo.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
    const skin=new THREE.SkinnedMesh(skinGeo,new THREE.MeshStandardMaterial()),bone=new THREE.Bone();
    skin.add(bone);skin.bind(new THREE.Skeleton([bone]));bone.position.y=3;scene.add(skin);scene.updateMatrixWorld(true);skin.skeleton.update();
    const snap=freezeQualityScene(scene,new THREE.PerspectiveCamera());
    try {
      const copies=snap.scene.children as THREE.Mesh[];expect(copies).toHaveLength(3);
      expect(copies[0].geometry.attributes.position.getY(0)).toBeCloseTo(geo.attributes.position.getY(0)+1);
      expect(copies[0].matrix.elements[12]).toBe(7);
      expect(copies[2].geometry.attributes.position.getY(0)).toBeCloseTo(skinGeo.attributes.position.getY(0)+3);
      expect(copies[2].geometry.morphAttributes.position).toBeUndefined();
      expect(geo.attributes.position.getY(0)).toBe(.5);
    } finally {snap.dispose();}
  });
  it('keeps physical material properties, maps, exposure and environment settings',()=>{
    const scene=new THREE.Scene(),texture=new THREE.Texture();texture.mapping=THREE.EquirectangularReflectionMapping;
    scene.environment=texture;scene.environmentIntensity=2;scene.environmentRotation.y=.8;scene.backgroundIntensity=.4;
    const material=new THREE.MeshPhysicalMaterial({transmission:1,ior:1.45,thickness:.2,roughness:.08,map:texture});
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(),material));
    const dispose=vi.spyOn(texture,'dispose'),snap=freezeQualityScene(scene,new THREE.PerspectiveCamera(),'',1.7);
    const copied=(snap.scene.children[0] as THREE.Mesh).material as THREE.MeshPhysicalMaterial;
    expect(copied).not.toBe(material);expect(copied).toMatchObject({transmission:1,ior:1.45,thickness:.2,roughness:.08,map:texture});
    expect(snap.exposure).toBe(1.7);expect(snap.scene.environmentIntensity).toBe(2);expect(snap.scene.environmentRotation.y).toBe(.8);expect(snap.scene.backgroundIntensity).toBe(.4);
    snap.dispose();expect(dispose).not.toHaveBeenCalled();
  });
  it('omits camera-excluded layers and invisible materials',()=>{
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());mesh.layers.set(2);scene.add(mesh);
    const hidden=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());hidden.material.visible=false;scene.add(hidden);
    const snap=freezeQualityScene(scene,camera);expect(snap.scene.children).toHaveLength(0);snap.dispose();
  });
  it('preserves portrait, orthographic and cropped view proportions with bounded sizes',()=>{
    const camera=new THREE.PerspectiveCamera(50,2);
    expect(qualityRenderSize(camera,2048)).toEqual({width:2048,height:1024});
    camera.aspect=.5;camera.updateProjectionMatrix();expect(qualityRenderSize(camera,512)).toEqual({width:256,height:512});
    const ortho=new THREE.OrthographicCamera(-3,3,1,-1);expect(qualityRenderSize(ortho,1024)).toEqual({width:1024,height:341});
    camera.setViewOffset(1000,1000,0,0,500,1000);expect(qualityRenderSize(camera,2048)).toEqual({width:1024,height:2048});
    camera.projectionMatrix.elements[0]=0;expect(qualityRenderSize(camera,99999)).toEqual({width:1024,height:1024});
  });
});
