// Procedural, mip-filtered fibre relief; no displacement changes checked solids.
export function fenceMaterials(THREE){const canvas=document.createElement('canvas');canvas.width=256;canvas.height=1024;const ctx=canvas.getContext('2d'),data=ctx.createImageData(256,1024),rough=ctx.createImageData(256,1024);
  for(let y=0;y<1024;y++)for(let x=0;x<256;x++){const u=x/256,v=y/1024,warp=u+.007*Math.sin(v*Math.PI*2)+.003*Math.sin(v*Math.PI*8+u*12),fibre=Math.sin(warp*Math.PI*126+Math.sin(warp*71)*2),fine=Math.sin(warp*Math.PI*410+Math.sin(v*6.283)*.8),wide=Math.sin(warp*6.283*13+Math.cos(v*6.283*2)*.25),crack=Math.pow(Math.max(0,Math.sin(warp*6.283*27+Math.sin(v*6.283)*.4)),36)*(.3+.7*Math.pow(Math.sin(v*6.283*2),2)),tone=Math.max(85,Math.min(250,204+fibre*13+fine*5+wide*18-crack*62)),i=(y*256+x)*4;
    data.data.set([tone,tone,tone,255],i);const r=225+crack*25-fine*4;rough.data.set([r,r,r,255],i);
  }ctx.putImageData(data,0,0);const roughCanvas=document.createElement('canvas');roughCanvas.width=256;roughCanvas.height=1024;roughCanvas.getContext('2d').putImageData(rough,0,0);
  const map=new THREE.CanvasTexture(canvas),roughnessMap=new THREE.CanvasTexture(roughCanvas);map.colorSpace=THREE.SRGBColorSpace;for(const t of [map,roughnessMap]){t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(2,.55);t.anisotropy=4;}
  const wood=new THREE.MeshStandardMaterial({map,roughnessMap,bumpMap:roughnessMap,bumpScale:.0025,vertexColors:true,roughness:1});
  const end=document.createElement('canvas');end.width=end.height=128;const ectx=end.getContext('2d'),ed=ectx.createImageData(128,128);for(let y=0;y<128;y++)for(let x=0;x<128;x++){const dx=(x-52)/128,dz=(y-71)/128,r=Math.hypot(dx,dz),angle=Math.atan2(dz,dx),v=210-26*Math.pow(Math.max(0,Math.sin(r*235+Math.sin(angle*5)*.7)),5);ed.data.set([v,v,v,255],(y*128+x)*4);}ectx.putImageData(ed,0,0);const endMap=new THREE.CanvasTexture(end);endMap.colorSpace=THREE.SRGBColorSpace;const woodEnd=new THREE.MeshStandardMaterial({map:endMap,vertexColors:true,roughness:1});
  endMap.wrapS=endMap.wrapT=THREE.RepeatWrapping;
  const stone=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1}),binding=new THREE.MeshStandardMaterial({color:'#776e58',roughness:1}),metal=new THREE.MeshStandardMaterial({color:'#414744',roughness:.75,metalness:.65});
  return {wood,woodEnd,stone,binding,metal};
}
