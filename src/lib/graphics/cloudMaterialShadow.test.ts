import { expect, it, vi } from 'vitest';
import { MeshPhysicalMaterial, ShaderLib, Uniform, type WebGLRenderer, type WebGLProgramParametersWithUniforms } from 'three';
import { attachCloudMaterialShadow, createCloudShadowUniforms } from './cloudMaterialShadow';

it('attenuates directional lighting while preserving fabric hooks, uniforms and indoor lights', () => {
  const material = new MeshPhysicalMaterial();
  const fabric = new Uniform(0.5);
  material.onBeforeCompile = shader => { shader.uniforms.fabric = fabric; shader.vertexShader += '\n// fabric deformation'; };
  const original = material.onBeforeCompile, key = material.customProgramCacheKey;
  const uniforms = createCloudShadowUniforms();
  const restore = attachCloudMaterialShadow(material, uniforms);
  const shader = {vertexShader:ShaderLib.physical.vertexShader, fragmentShader:ShaderLib.physical.fragmentShader, uniforms:{}} as WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as WebGLRenderer);
  expect(shader.uniforms.fabric).toBe(fabric);
  expect(shader.vertexShader).toContain('fabric deformation');
  expect(shader.uniforms.pfCloudMap).toBe(uniforms.pfCloudMap);
  expect(shader.fragmentShader).toContain('getDirectionalLightInfo( directionalLight, directLight );\n       directLight.color *= pfCloudTransmission');
  expect(shader.fragmentShader).toContain('getPointLightInfo( pointLight, geometryPosition, directLight );');
  expect(shader.fragmentShader).toContain('transmission / 9.0');
  expect(material.customProgramCacheKey()).toContain('polyform-cloud-shadow');
  restore();
  expect(material.onBeforeCompile).toBe(original);
  expect(material.customProgramCacheKey).toBe(key);
  material.dispose();
});

it('does not overwrite a subsequent material hook when detaching', () => {
  const material = new MeshPhysicalMaterial();
  const restore = attachCloudMaterialShadow(material, createCloudShadowUniforms());
  const replacement = vi.fn(); material.onBeforeCompile = replacement;
  restore(); expect(material.onBeforeCompile).toBe(replacement);
  material.dispose();
});

it('invalidates cached uniforms on remount while sharing programs within one mount', () => {
  const first = new MeshPhysicalMaterial(), second = new MeshPhysicalMaterial();
  const uniforms = createCloudShadowUniforms();
  const restore = attachCloudMaterialShadow(first, uniforms);
  attachCloudMaterialShadow(second, uniforms);
  const before = first.customProgramCacheKey();
  expect(second.customProgramCacheKey()).toBe(before);
  restore(); attachCloudMaterialShadow(first, createCloudShadowUniforms());
  expect(first.customProgramCacheKey()).not.toBe(before);
  first.dispose(); second.dispose();
});
