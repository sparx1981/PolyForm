import { expect, it } from 'vitest';
import { advanceBetaDay, getBetaTime, publishBetaTime, subscribeBetaTime } from './betaDayCycle';

it('wraps midnight without advancing the seasonal date', () => {
  const date = new Date('2026-06-21T23:30:00Z');
  advanceBetaDay(date, 5, 0.2);
  expect(date.toISOString()).toBe('2026-06-21T00:30:00.000Z');
});
it('uses elapsed time and speed, independently of frame count', () => {
  const coarse = new Date('2026-06-21T12:00:00Z'), fine = new Date(coarse);
  advanceBetaDay(coarse, 10, 0.2);
  for (let i = 0; i < 600; i++) advanceBetaDay(fine, 1/60, 0.2);
  expect(+fine).toBe(+coarse);
  expect(coarse.getUTCHours()).toBe(14);
  advanceBetaDay(coarse, 120, 0.2);
  expect(coarse.getUTCHours()).toBe(14);
});
it('ignores invalid or paused steps and publishes without saving model settings', () => {
  const date = new Date('2026-06-21T12:00:00Z');
  for (const [delta, speed] of [[0,1],[-1,1],[NaN,1],[1,Infinity],[1,0]]) advanceBetaDay(date, delta, speed);
  expect(date.toISOString()).toBe('2026-06-21T12:00:00.000Z');
  let count = 0;
  const unsubscribe = subscribeBetaTime(() => count++);
  publishBetaTime('test-seed', date); publishBetaTime('test-seed', date);
  expect(count).toBe(1); expect(getBetaTime()).toEqual({seed:'test-seed',date:'2026-06-21T12:00'});
  unsubscribe(); advanceBetaDay(date,1,1); publishBetaTime('test-seed',date);
  expect(count).toBe(1);
});
