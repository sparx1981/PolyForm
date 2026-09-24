import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { defaultGraphicsSettings } from './graphicsSettings';
import { glassWeatherTargets, makeWetGlass, stepGlassWeather, wetGlassUniforms } from './wetGlass';

describe('wet glass', () => {
  it('is dry unless rain or snow is falling', () => {
    const weather = defaultGraphicsSettings().weather;
    expect(glassWeatherTargets(weather)).toEqual({ rain: 0, snow: 0 });
    weather.enabled = true;
    expect(glassWeatherTargets(weather)).toEqual({ rain: 0, snow: 0 });
    weather.layers.rain.enabled = true;
    expect(glassWeatherTargets(weather).rain).toBeCloseTo(0.75);
    weather.layers.rain.count = 30000;
    expect(glassWeatherTargets(weather).rain).toBe(1);
    weather.enabled = false;
    expect(glassWeatherTargets(weather).rain).toBe(0);
  });

  it('wets up gradually and wraps time', () => {
    wetGlassUniforms.uGlassRain.value = 0; wetGlassUniforms.uGlassTime.value = 3599.9;
    stepGlassWeather({ rain: 1, snow: 0 }, 0.5);
    expect(wetGlassUniforms.uGlassRain.value).toBeGreaterThan(0);
    expect(wetGlassUniforms.uGlassRain.value).toBeLessThan(0.5);
    expect(wetGlassUniforms.uGlassTime.value).toBeLessThan(1);
  });

  it('patches every shader anchor it relies on', () => {
    const material = makeWetGlass(new THREE.MeshPhysicalMaterial({ transmission: 1 }));
    const lib = THREE.ShaderLib.physical;
    const shader = { uniforms: THREE.UniformsUtils.clone(lib.uniforms), vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader } as any;
    expect(() => material.onBeforeCompile(shader, undefined as any)).not.toThrow();
    expect(shader.fragmentShader).toContain('material.thickness = thickness + gH');
    expect(shader.uniforms.uGlassRain).toBe(wetGlassUniforms.uGlassRain);
  });
});
