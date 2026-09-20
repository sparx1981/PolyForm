import { useEffect, useRef, useState } from 'react';
import type * as THREE from 'three';
import { ManagedTextureManager, type TextureHandle } from './textureManager';
import type { MapSemantic } from './types';
import type { ResolvedBindingMaps } from './useMaterialBindings';

const RUNTIME_SEMANTICS: MapSemantic[] = ['basecolor', 'normal-gl', 'orm', 'specular', 'transmission', 'height'];

const isDefaultUv = (uv: ResolvedBindingMaps['uv'] | undefined) =>
  !uv || (uv.repeat[0] === 1 && uv.repeat[1] === 1 && uv.offset[0] === 0 && uv.offset[1] === 0 && uv.rotation === 0);

export function useManagedBindingTextures(
  renderer: THREE.WebGLRenderer,
  bindings: Record<string, ResolvedBindingMaps>,
): Record<string, Partial<Record<MapSemantic, THREE.Texture>>> {
  const managerRef = useRef<ManagedTextureManager | null>(null);
  const [textures, setTextures] = useState<Record<string, Partial<Record<MapSemantic, THREE.Texture>>>>({});

  useEffect(() => {
    const manager = new ManagedTextureManager(renderer);
    managerRef.current = manager;
    return () => {
      manager.dispose();
      managerRef.current = null;
    };
  }, [renderer]);

  useEffect(() => {
    const manager = managerRef.current;
    if (!manager) return;
    let active = true;
    const handles: TextureHandle[] = [];
    const ownedClones: THREE.Texture[] = [];
    void Promise.all(Object.entries(bindings).map(async ([bindingId, binding]) => {
      const loaded: Partial<Record<MapSemantic, THREE.Texture>> = {};
      const uvIsDefault = isDefaultUv(binding.uv);
      await Promise.all(RUNTIME_SEMANTICS.map(async semantic => {
        const variant = binding.maps[semantic];
        if (!variant) return;
        let handle: TextureHandle;
        try {
          handle = await manager.acquire(variant);
        } catch (error) {
          // One missing derivative must not discard the other PBR channels.
          console.warn(`[Materials] Could not load ${semantic} for ${bindingId}`, error);
          return;
        }
        if (!active) {
          handle.release();
          manager.evictUnused();
          return;
        }
        handles.push(handle);
        if (uvIsDefault) {
          loaded[semantic] = handle.texture;
        } else {
          // The shared handle is reference-counted across every binding using this
          // same source image; mutating its .repeat/.offset directly would leak the
          // change into every other object using the same material. Clone it (a
          // separate GPU upload, but the only way to give this one binding its own
          // tiling without disturbing the others) and configure the clone instead.
          const clone = handle.texture.clone();
          clone.repeat.set(binding.uv.repeat[0], binding.uv.repeat[1]);
          clone.offset.set(binding.uv.offset[0], binding.uv.offset[1]);
          clone.rotation = binding.uv.rotation;
          clone.needsUpdate = true;
          ownedClones.push(clone);
          loaded[semantic] = clone;
        }
      }));
      return [bindingId, loaded] as const;
    })).then(entries => {
      if (active) setTextures(Object.fromEntries(entries));
    });
    return () => {
      active = false;
      for (const handle of handles) handle.release();
      for (const clone of ownedClones) clone.dispose();
      manager.evictUnused();
    };
  }, [bindings, renderer]);

  return textures;
}
