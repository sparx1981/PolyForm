import * as THREE from 'three';

export type Shader = Parameters<THREE.Material['onBeforeCompile']>[0];
type Patch = { key: string; apply: (shader: Shader) => void };
const chains = new WeakMap<THREE.Material, Map<symbol, Patch>>();

/** Composes patches with existing hooks; each returned cleanup is independent. */
export function patchMaterial(material: THREE.Material, patch: Patch): () => void {
  let chain = chains.get(material);
  if (!chain) {
    chain = new Map();
    chains.set(material, chain);
    const compile = material.onBeforeCompile;
    const key = material.customProgramCacheKey;
    const originalKey = key.call(material);
    material.onBeforeCompile = function (shader, renderer) {
      compile.call(this, shader, renderer);
      for (const entry of chain.values()) entry.apply(shader);
    };
    material.customProgramCacheKey = function () {
      // Capture the default key before replacing onBeforeCompile (it uses toString).
      const base = key === THREE.Material.prototype.customProgramCacheKey ? originalKey : key.call(this);
      return base + [...chain.values()].map(p => `|${p.key}`).join('');
    };
  }
  const id = Symbol(patch.key);
  chain.set(id, patch);
  material.needsUpdate = true;
  return () => { if (chain.delete(id)) material.needsUpdate = true; };
}

export function inject(source: string, anchor: string, replacement: string): string {
  if (!source.includes(anchor)) throw new Error(`PolyForm shader anchor missing: ${anchor}`);
  return source.replace(anchor, replacement);
}

export function finite(value: number, name: string, minimum = -Infinity): number {
  if (!Number.isFinite(value) || value < minimum) throw new RangeError(`${name} must be finite and >= ${minimum}`);
  return value;
}
