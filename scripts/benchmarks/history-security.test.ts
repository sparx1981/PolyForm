import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore';
import { historyFixture } from '../../src/lib/perf/history.fixtures';
let env:RulesTestEnvironment;
const enabled=!!process.env.FIRESTORE_EMULATOR_HOST;
describe.skipIf(!enabled)('Private benchmark history rules',()=>{
  beforeAll(async()=>{env=await initializeTestEnvironment({projectId:'demo-polyform-history',firestore:{host:'127.0.0.1',port:Number(process.env.FIRESTORE_EMULATOR_HOST?.split(':').at(-1)),rules:readFileSync('firestore.rules','utf8')}});},30000);
  beforeEach(async()=>env.clearFirestore());afterAll(async()=>env?.cleanup());
  const payload=()=>({schemaVersion:1,id:'run-1',kind:'benchmark',label:'Benchmark',startedAt:'2026-10-01T10:00:00.000Z',context:{scenario:'Meadow',modelId:null,revision:'abc'},device:{gpu:'GPU',gpuTimer:true,pixelRatio:1,userAgent:''},settings:{shadows:true},scene:{triangles:12,heaviest:[],biggestTextures:[]},stats:{frames:100,frameMs:{avg:16},fpsAvg:62.5},diagnosis:[],timeline:[],savedAt:serverTimestamp()});
  it('allows owner creates/updates/limited live queries but rejects other accounts and anonymous access',async()=>{
    const db=env.authenticatedContext('owner').firestore(),ref=doc(db,'users','owner','perfRuns','run-1');
    await assertSucceeds(setDoc(ref,payload()));await assertSucceeds(setDoc(ref,payload()));
    expect((await assertSucceeds(getDocs(query(collection(db,'users','owner','perfRuns'),orderBy('startedAt','desc'),limit(100))))).size).toBe(1);
    await assertFails(getDocs(collection(db,'users','owner','perfRuns')));
    for(const ctx of [env.unauthenticatedContext(),env.authenticatedContext('other')]){const other=doc(ctx.firestore(),'users','owner','perfRuns','run-1');await assertFails(getDoc(other));await assertFails(setDoc(other,payload()));await assertFails(getDocs(query(collection(ctx.firestore(),'users','owner','perfRuns'),limit(100))));}
  });
  it('round-trips the actual client service without exposing local names or URLs',async()=>{
    const db=env.authenticatedContext('owner').firestore();
    vi.doMock('../../src/firebase',()=>({db,auth:{currentUser:{uid:'owner'}}}));
    const service=await import('../../src/lib/perf/historyCloud');
    const run=historyFixture();await service.saveBenchmarkCloud('owner',run);
    await expect(service.saveBenchmarkCloud('other',run)).rejects.toThrow('Sign in');
    let stop:(()=>void)|undefined;
    try {
      const loaded=await new Promise<import('../../src/lib/perf/profilerStore').PerfRun[]>((resolve,reject)=>{stop=service.watchBenchmarkCloud('owner',resolve,reject);});
      expect(loaded).toHaveLength(1);expect(loaded[0].context).toEqual(run.context);expect(loaded[0].app.url).toBe('');expect(loaded[0].scene.heaviest).toEqual([]);expect(loaded[0].stats).toEqual(run.stats);
    } finally {stop?.();}
  });
  it('validates updates and rejects malformed records, names and URLs',async()=>{
    const db=env.authenticatedContext('owner').firestore(),ref=doc(db,'users','owner','perfRuns','run-1');
    await assertSucceeds(setDoc(ref,payload()));
    for(const invalid of [{...payload(),schemaVersion:2},{...payload(),id:'different'},{...payload(),context:{}},{...payload(),app:{url:'private'}},{...payload(),scene:{triangles:12,heaviest:[{name:'private'}],biggestTextures:[]}},{...payload(),timeline:Array(601).fill(0)},{...payload(),stats:{frames:-1,fpsAvg:1,frameMs:{avg:16}}}])await assertFails(setDoc(ref,invalid));
  });
});
