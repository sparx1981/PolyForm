import type { PerfRun } from './profilerStore';
export const MAX_HISTORY_RUNS = 100;
export const MAX_HISTORY_BYTES = 20_000_000;
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const numbers=(v:unknown,keys:string[])=>record(v)&&keys.every(k=>typeof v[k]==='number'&&Number.isFinite(v[k])&&Number(v[k])>=0);
const distribution=(v:unknown)=>numbers(v,['avg','p50','p95','p99','max','min']);
export function isPerfRun(value:unknown):value is PerfRun {
  if(!record(value))return false;
  const {device:d,scene:s,stats:t}=value;
  if(!record(d)||!record(s)||!record(t)||!record(value.app)||typeof value.app.url!=='string')return false;
  return typeof value.id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value.id)&&['benchmark','recording'].includes(String(value.kind))
    &&typeof value.label==='string'&&value.label.length<=160&&typeof value.startedAt==='string'&&Number.isFinite(Date.parse(value.startedAt))
    &&['gpu','vendor','webgl','canvas','userAgent'].every(k=>typeof d[k]==='string')&&numbers(d,['maxTextureSize','pixelRatio'])&&typeof d.gpuTimer==='boolean'
    &&numbers(s,['meshes','instancedMeshes','triangles','lights','shadowLights','transparentMeshes','materials','textures','textureMemoryMB','geometries','programs'])
    &&Array.isArray(s.heaviest)&&s.heaviest.length<=100&&s.heaviest.every(v=>record(v)&&typeof v.name==='string'&&numbers(v,['triangles','meshes']))
    &&Array.isArray(s.biggestTextures)&&s.biggestTextures.length<=100&&s.biggestTextures.every(v=>record(v)&&typeof v.name==='string'&&typeof v.size==='string'&&numbers(v,['memoryMB']))
    &&numbers(t,['frames','durationS','fpsAvg','fps1Low','hitches'])&&distribution(t.frameMs)&&distribution(t.renderCpuMs)&&(t.gpuMs===null||distribution(t.gpuMs))&&numbers(t.calls,['avg','max'])&&numbers(t.triangles,['avg','max'])
    &&record(value.settings)&&Object.keys(value.settings).length<=200&&Object.values(value.settings).every(v=>typeof v==='boolean'||typeof v==='string'&&v.length<=500||typeof v==='number'&&Number.isFinite(v))
    &&Array.isArray(value.diagnosis)&&value.diagnosis.length<=30&&value.diagnosis.every(v=>typeof v==='string'&&v.length<=1000)
    &&Array.isArray(value.timeline)&&value.timeline.length<=600&&value.timeline.every(v=>numbers(v,['t','fps','calls','triangles'])&&record(v)&&(v.gpuMs===null||numbers(v,['gpuMs'])))
    &&(value.context===undefined||record(value.context)&&typeof value.context.scenario==='string'&&value.context.scenario.length<=120&&typeof value.context.revision==='string'&&value.context.revision.length<=100&&(value.context.modelId===null||typeof value.context.modelId==='string'&&value.context.modelId.length<=256));
}
export function parseHistory(json:string):PerfRun[]{
  if(new TextEncoder().encode(json).length>MAX_HISTORY_BYTES)throw new Error('History file exceeds 20 MB.');
  const data:unknown=JSON.parse(json),values=Array.isArray(data)?data:record(data)&&data.schemaVersion===1&&Array.isArray(data.runs)?data.runs:[data];
  if(values.length>MAX_HISTORY_RUNS||!values.every(isPerfRun))throw new Error('History must contain up to 100 valid PolyForm performance runs.');
  return values;
}
export function mergeHistory(existing:PerfRun[],incoming:PerfRun[]):PerfRun[]{
  const unique=new Map(existing.map(r=>[r.id,r]));incoming.forEach(r=>unique.set(r.id,r));
  return [...unique.values()].sort((a,b)=>Date.parse(a.startedAt)-Date.parse(b.startedAt)).slice(-MAX_HISTORY_RUNS);
}
/** Cloud payloads omit URLs, browser UA, names and free-text findings. No model geometry is stored. */
export function cloudRun(run:PerfRun):PerfRun{
  if(!isPerfRun(run))throw new Error('Invalid benchmark run.');
  return {...run,app:{url:''},device:{...run.device,userAgent:''},scene:{...run.scene,heaviest:[],biggestTextures:[]},diagnosis:[],context:run.context??{scenario:'',modelId:null,revision:'unknown'}};
}
