import { expect, it } from 'vitest';
import { normalizeGraphicsSettings } from './graphicsSettings';
import { defaultBetaEnvironment, normalizeBetaEnvironment } from './betaEnvironment';
import { Matrix4, Vector3 } from 'three';
import { tilesToSiteMatrix, ecef, enuBasis } from '../worldSite/googleTiles';

it('leaves older models off and round trips every Beta control', () => {
  expect(normalizeGraphicsSettings({}).beta.enabled).toBe(false);
  const beta = { ...defaultBetaEnvironment(), enabled:true, clouds:true, flare:true, grading:true, layers:3, quality:'high' as const, date:'2026-01-15T23:40', grade:'warm' as const };
  expect(normalizeGraphicsSettings(JSON.parse(JSON.stringify({beta}))).beta).toEqual(beta);
});
it('rejects invalid astronomy dates and clamps imported quality and physical ranges', () => {
  const result = normalizeBetaEnvironment({ date:'NaN', latitude:900, longitude:NaN, layers:50, quality:'ultra', coverage:-4, exposure:Infinity });
  expect(result.latitude).toBe(89.9); expect(result.longitude).toBe(defaultBetaEnvironment().longitude);
  expect(result.layers).toBe(3); expect(result.coverage).toBe(0); expect(result.quality).toBe('auto');
  expect(result.date).toBe(defaultBetaEnvironment().date); expect(result.exposure).toBe(3);
});
it('maps local east, up and south into ECEF without Google visual lift', () => {
  const lat=51.5,lng=-0.1,height=25;
  const toECEF = new Matrix4().fromArray(tilesToSiteMatrix(lat,lng,height)).invert();
  const origin = new Vector3().applyMatrix4(toECEF);
  expect(origin.distanceTo(new Vector3(...ecef(lat,lng,height)))).toBeLessThan(1e-7);
  const basis = enuBasis(lat,lng);
  for (const [local,expected] of [[new Vector3(1,0,0),new Vector3(...basis.east)],[new Vector3(0,1,0),new Vector3(...basis.up)],[new Vector3(0,0,1),new Vector3(...basis.north).negate()]])
    expect(local.applyMatrix4(toECEF).sub(origin).distanceTo(expected)).toBeLessThan(1e-7);
});

it('keeps physical sky and stars on and intensity fixed when loading older models', () => {
  const result = normalizeBetaEnvironment({ sky:false, stars:false, starIntensity:0, animateDayCycle:true, dayCycleSpeed:200 });
  expect(result.sky).toBe(true); expect(result.stars).toBe(true); expect(result.starIntensity).toBe(10);
  expect(result.animateDayCycle).toBe(true); expect(result.dayCycleSpeed).toBe(2);
  expect(normalizeBetaEnvironment({dayCycleSpeed:NaN}).dayCycleSpeed).toBe(0.2);
  expect(normalizeBetaEnvironment({dayCycleSpeed:0}).dayCycleSpeed).toBe(0.05);
});

it('lets a stored exposure up to 10 through and keeps the brighter default for models without one', () => {
  expect(normalizeBetaEnvironment({ exposure: 8 }).exposure).toBe(8);
  expect(normalizeBetaEnvironment({ exposure: 40 }).exposure).toBe(10);
  expect(normalizeBetaEnvironment({}).exposure).toBe(3);
});
