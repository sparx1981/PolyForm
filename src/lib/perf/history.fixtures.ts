import type { PerfRun } from './profilerStore';
import { summarise } from './profilerCore';
export function historyFixture(id='run-1'):PerfRun{return {
  id,kind:'benchmark',label:'Fly-around benchmark',startedAt:'2026-10-01T09:37:00.000Z',app:{url:'https://example.com/private-model'},
  context:{scenario:'Lake walk',modelId:'model-1',revision:'abc123'},
  device:{gpu:'GPU',vendor:'Vendor',webgl:'WebGL2',maxTextureSize:8192,antialias:true,canvas:'1920x1080',pixelRatio:1.5,gpuTimer:true,cores:8,memoryGB:8,userAgent:'Private browser fingerprint'},
  settings:{shadows:true},scene:{meshes:1,instancedMeshes:0,triangles:12,lights:1,shadowLights:1,transparentMeshes:0,materials:1,textures:1,textureMemoryMB:1,geometries:1,programs:1,heaviest:[{name:'Private object',triangles:12,meshes:1}],biggestTextures:[{name:'Private texture',size:'512x512',memoryMB:1}]},
  stats:summarise(Array.from({length:60},(_,i)=>({frameMs:16,renderCpuMs:2,gpuMs:4,calls:3,triangles:12,t:i*.016}))),diagnosis:['Private object is heavy'],timeline:[{t:0,fps:62.5,gpuMs:4,calls:3,triangles:12}]
};}
