import * as THREE from 'three';

export interface PencilDrawing {
  geometry: THREE.BufferGeometry;
  /** End times of the subdivided strokes, measured in drawing distance. */
  ends: number[];
  duration: number;
  strokes: number;
}

/** Fixed irregularities follow the pencil path; they never shimmer from frame to frame. */
export function pencilDrawing(edges: THREE.BufferGeometry): PencilDrawing {
  const position = edges.attributes.position, strokes = position.count / 2;
  const order = Array.from({length:strokes},(_,i) => i);
  const height = (i:number) => Math.round(Math.min(position.getY(i*2),position.getY(i*2+1))*20);
  order.sort((a,b) => height(a)-height(b) || position.getX(a*2)-position.getX(b*2) || position.getZ(a*2)-position.getZ(b*2));
  const subdivisions = Math.max(1,Math.min(16,Math.floor(12000/Math.max(1,strokes))));
  const box = new THREE.Box3().setFromBufferAttribute(position as THREE.BufferAttribute);
  const amplitude = Math.max(0.002,Math.min(0.05,box.getSize(new THREE.Vector3()).length()*0.004));
  const positions:number[]=[], offsets:number[]=[], times:number[]=[], ends:number[]=[];
  const a=new THREE.Vector3(),b=new THREE.Vector3(),previous=new THREE.Vector3();
  const direction=new THREE.Vector3(),side=new THREE.Vector3(),normal=new THREE.Vector3(),point=new THREE.Vector3(),offset=new THREE.Vector3();
  let duration=0;
  order.forEach((index,stroke) => {
    a.fromBufferAttribute(position,index*2); b.fromBufferAttribute(position,index*2+1);
    if (stroke && b.distanceToSquared(previous)<a.distanceToSquared(previous)) { const swap=a.clone();a.copy(b);b.copy(swap); }
    const length=a.distanceTo(b), weight=Math.max(0.15,length);
    direction.subVectors(b,a).normalize();
    side.crossVectors(direction,Math.abs(direction.y)<0.9 ? new THREE.Vector3(0,1,0) : new THREE.Vector3(1,0,0)).normalize();
    normal.crossVectors(direction,side).normalize();
    const phase=index*2.399963, pressure=0.65+0.35*Math.sin(index*1.73);
    for (let segment=0;segment<subdivisions;segment++) {
      for (const t of [segment/subdivisions,(segment+1)/subdivisions]) {
        point.lerpVectors(a,b,t); positions.push(point.x,point.y,point.z);
        offset.copy(side).multiplyScalar(amplitude*pressure*(Math.sin(t*8+phase)*0.65+Math.sin(t*19+phase)*0.25));
        offset.addScaledVector(normal,amplitude*0.25*Math.sin(t*11-phase));
        offset.addScaledVector(direction,(t*2-1)*amplitude*0.8);
        offsets.push(offset.x,offset.y,offset.z); times.push(duration+t*weight);
      }
      ends.push(duration+(segment+1)/subdivisions*weight);
    }
    // Brief pen lifts separate strokes instead of drawing every object simultaneously.
    duration+=weight+0.12; previous.copy(b);
  });
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('pencilOffset',new THREE.Float32BufferAttribute(offsets,3));
  geometry.setAttribute('pencilTime',new THREE.Float32BufferAttribute(times,1));
  geometry.computeBoundingSphere();
  return {geometry,ends,duration,strokes};
}

export function pencilSeconds(strokes:number) { return 0.75 * Math.min(42,Math.max(24,strokes*0.12)); }

/** Include the current segment; the shader trims it to the moving pencil tip. */
export function pencilDrawCount(ends:number[], distance:number) {
  if (distance<=0) return 0;
  let low=0,high=ends.length;
  while(low<high) { const middle=(low+high)>>>1; if(ends[middle]<distance) low=middle+1;else high=middle; }
  return Math.min(ends.length,low+1)*2;
}

export function pencilMaterial(color:string, soft=false) {
  const progress=new THREE.Uniform(1), roughness=new THREE.Uniform(1);
  const material=new THREE.LineBasicMaterial({color,transparent:true,depthWrite:false});
  material.onBeforeCompile=shader => {
    shader.uniforms.pencilProgress=progress; shader.uniforms.pencilRoughness=roughness;
    shader.vertexShader='attribute vec3 pencilOffset; attribute float pencilTime; uniform float pencilRoughness; varying float vPencilTime;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      transformed += pencilOffset * pencilRoughness * ${soft ? '-1.4' : '1.0'};
      vPencilTime = pencilTime;`);
    shader.fragmentShader='uniform float pencilProgress; uniform float pencilRoughness; varying float vPencilTime;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`if (vPencilTime > pencilProgress) discard;
      float graphite = fract(sin(dot(floor(gl_FragCoord.xy),vec2(12.9898,78.233)))*43758.5453);
      diffuseColor.a *= mix(1.0,0.55+0.45*graphite,pencilRoughness);
      #include <opaque_fragment>`);
  };
  material.customProgramCacheKey=()=>`presentation-pencil-v1:${soft}`;
  return {material,progress,roughness};
}
