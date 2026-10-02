import { describe, it, expect } from 'vitest';
import { CloudQualityGovernor, startingCloudQuality } from './cloudQuality';

const run = (g: CloudQualityGovernor, fps: number, seconds: number) => {
  let changes = 0;
  for (let t = 0; t < seconds; t += 1 / fps) if (g.update(1 / fps)) changes++;
  return changes;
};

describe('cloud quality governor', () => {
  it('starts phones low and everything else medium', () => {
    expect(startingCloudQuality(390)).toBe('low'); expect(startingCloudQuality(1440)).toBe('medium');
  });
  it('steps down while frames stay slow, but never below low', () => {
    const g = new CloudQualityGovernor('high');
    run(g, 12, 30);
    expect(g.quality).toBe('low');
    expect(run(g, 12, 30)).toBe(0);
  });
  it('ignores the settling time after a change and long stalls', () => {
    const g = new CloudQualityGovernor('medium');
    for (let i = 0; i < 20; i++) g.update(2); // hidden tab
    expect(g.quality).toBe('medium');
    for (let i = 0; i < 50; i++) g.update(1 / 60); // settling
    expect(g.quality).toBe('medium');
  });
  it('tries one level up after a long smooth stretch, and backs off for good if that is slow', () => {
    const g = new CloudQualityGovernor('low');
    run(g, 60, 20);
    expect(g.quality).toBe('medium');
    run(g, 60, 20);
    expect(g.quality).toBe('high');
    run(g, 15, 5);
    expect(g.quality).toBe('medium');
    expect(g.cap).toBe(1);
    run(g, 60, 60);
    expect(g.quality).toBe('medium');
  });
  it('does not climb on merely acceptable frame rates', () => {
    const g = new CloudQualityGovernor('medium');
    run(g, 40, 60);
    expect(g.quality).toBe('medium');
  });
});
