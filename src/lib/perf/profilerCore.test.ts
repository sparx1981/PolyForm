import { describe, expect, it } from 'vitest';
import { compareRuns, diagnose, distribution, percentile, summarise, timeline, type FrameSample } from './profilerCore';

const sample = (i: number, frameMs: number, extra: Partial<FrameSample> = {}): FrameSample =>
  ({ frameMs, renderCpuMs: 2, gpuMs: 5, calls: 100, triangles: 50000, t: i * frameMs / 1000, ...extra });
const run = (n: number, ms: number, extra: Partial<FrameSample> = {}) => Array.from({ length: n }, (_, i) => sample(i, ms, extra));

describe('profiler maths', () => {
  it('percentile and distribution', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([], 50)).toBe(0);
    const d = distribution([10, 20, 30]);
    expect(d.avg).toBe(20); expect(d.min).toBe(10); expect(d.max).toBe(30); expect(d.p50).toBe(20);
  });
  it('summarises fps, 1% low and hitches', () => {
    const samples = [...run(190, 10), ...Array.from({ length: 10 }, (_, i) => sample(190 + i, 50))];
    const s = summarise(samples);
    expect(s.frames).toBe(200);
    expect(s.hitches).toBe(10);
    expect(s.fps1Low).toBeCloseTo(20, 0);
    expect(s.fpsAvg).toBeCloseTo(83.3, 0);
    expect(s.gpuMs?.avg).toBe(5);
  });
  it('computes 1% low from the average of the worst one percent of frame times', () => {
    const samples = [
      ...run(198, 10),
      sample(198, 40),
      sample(199, 80),
    ];
    const s = summarise(samples);
    expect(s.fps1Low).toBeCloseTo(1000 / 60, 2);
    // A simple 1/p99 reciprocal would return 25 fps here, which overstates the low.
    expect(s.fps1Low).toBeLessThan(20);
  });

  it('reports no gpu distribution without timer data', () => {
    expect(summarise(run(50, 16, { gpuMs: null })).gpuMs).toBeNull();
  });
  it('buckets the timeline by second', () => {
    const t = timeline(run(200, 10));
    expect(t.length).toBeGreaterThanOrEqual(2);
    expect(t[0]!.fps).toBeCloseTo(100, 0);
  });
});

describe('diagnosis', () => {
  it('flags GPU-bound frames', () => {
    const d = diagnose({ stats: summarise(run(100, 30, { gpuMs: 28 })) });
    expect(d[0]).toMatch(/GPU-bound/);
  });
  it('flags CPU-bound frames', () => {
    const d = diagnose({ stats: summarise(run(100, 30, { gpuMs: 4, renderCpuMs: 20 })) });
    expect(d[0]).toMatch(/CPU-bound/);
  });
  it('says so when there is no GPU timer', () => {
    expect(diagnose({ stats: summarise(run(100, 16, { gpuMs: null })) }).join(' ')).toMatch(/not available/);
  });
  it('flags heavy scenes and is quiet when healthy', () => {
    expect(diagnose({ stats: summarise(run(100, 16, { calls: 4000, triangles: 5e6 })) }).join(' ')).toMatch(/draw-call[\s\S]*triangle/);
    expect(diagnose({ stats: summarise(run(100, 16)) })).toEqual(['No bottleneck found: frame time is healthy.']);
  });
  it('asks for a longer run when there are few frames', () => {
    expect(diagnose({ stats: summarise(run(5, 16)) })[0]).toMatch(/Too few/);
  });
});

describe('compareRuns', () => {
  it('marks improvements', () => {
    const rows = compareRuns(summarise(run(100, 33)), summarise(run(100, 16)));
    expect(rows.find(r => r.metric === 'Average fps')?.better).toBe(true);
    expect(rows.find(r => r.metric === 'Frame time p95 (ms)')?.change).toBeLessThan(0);
  });
});
