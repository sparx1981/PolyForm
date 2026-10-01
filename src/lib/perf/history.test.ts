// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cloudRun, isPerfRun, mergeHistory, parseHistory } from './history';
import { comparisonWarnings, perfStore, type PerfRun } from './profilerStore';
import { historyFixture } from './history.fixtures';
afterEach(()=>{perfStore.clearRuns();vi.restoreAllMocks();});
describe('Benchmark history',()=>{
  it('loads legacy single logs and versioned history but rejects malformed metrics',()=>{
    const legacy=historyFixture();delete legacy.context;
    expect(parseHistory(JSON.stringify(legacy))).toHaveLength(1);
    expect(parseHistory(JSON.stringify({schemaVersion:1,runs:[historyFixture()]}))).toHaveLength(1);
    expect(isPerfRun({...historyFixture(),stats:{fpsAvg:'fake'}})).toBe(false);
    expect(()=>parseHistory(JSON.stringify({...historyFixture(),timeline:[{t:-1}]}))).toThrow('valid');
    expect(()=>parseHistory('x'.repeat(20_000_001))).toThrow('20 MB');
  });
  it('deduplicates IDs, sorts chronologically and bounds history to the newest 100',()=>{
    const runs=Array.from({length:105},(_,i)=>({...historyFixture(`run-${i}`),startedAt:new Date(1_700_000_000_000+i*1000).toISOString()}));
    expect(mergeHistory([],runs)).toHaveLength(100);expect(mergeHistory([],runs)[0].id).toBe('run-5');
    expect(mergeHistory([runs[0]],[{...runs[0],label:'Updated'}])).toHaveLength(1);
  });
  it('strips cloud URLs, browser fingerprint, names and free text without mutating the local run',()=>{
    const original=historyFixture(),safe=cloudRun(original);
    expect(safe.app.url).toBe('');expect(safe.device.userAgent).toBe('');expect(safe.scene.heaviest).toEqual([]);expect(safe.scene.biggestTextures).toEqual([]);expect(safe.diagnosis).toEqual([]);
    expect(safe.context).toEqual(original.context);expect(original.scene.heaviest[0].name).toBe('Private object');
  });
  it('warns about model/scenario/workload/GPU-timer/quality changes and missing legacy context',()=>{
    const before=historyFixture(),after={...before,kind:'recording' as const,context:{...before.context!,modelId:'model-2',scenario:'Interior'},settings:{shadows:false},device:{...before.device,gpuTimer:false}};
    const warnings=comparisonWarnings(before,after).join(' ');
    expect(warnings).toContain('Model changed');expect(warnings).toContain('Scenario changed');expect(warnings).toContain('different workloads');expect(warnings).toContain('timing availability');expect(warnings).toContain('settings changed');
    expect(comparisonWarnings({...before,context:undefined},after).join(' ')).toContain('Older run');
  });
  it('retains imported runs in memory when browser storage is blocked',()=>{
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('blocked');});
    perfStore.importRuns([historyFixture()]);expect(perfStore.getState().runs).toHaveLength(1);
  });
  it('captures scenario/model context at start rather than at finish',()=>{
    perfStore.setContext({scenario:'Start',modelId:'model-a'});perfStore.startBenchmark();
    perfStore.setContext({scenario:'End',modelId:'model-b'});
    for(let i=0;i<12;i++)perfStore.pushSample({frameMs:16,renderCpuMs:2,gpuMs:4,calls:3,triangles:12,t:i*.016});
    const fixture=historyFixture(),run=perfStore.finish({device:fixture.device,settings:fixture.settings,scene:fixture.scene});
    expect(run?.context).toMatchObject({scenario:'Start',modelId:'model-a'});expect(isPerfRun(run)).toBe(true);
  });
});
