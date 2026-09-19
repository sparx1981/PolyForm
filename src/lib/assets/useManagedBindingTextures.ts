import { useEffect, useRef, useState } from 'react';
import type * as THREE from 'three';
import { ManagedTextureManager, type TextureHandle } from './textureManager';
import type { MapSemantic } from './types';
import type { ResolvedBindingMaps } from './useMaterialBindings';

const RUNTIME_SEMANTICS: MapSemantic[] = ['basecolor', 'normal-gl', 'orm', 'specular', 'transmission', 'height'];

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
    void Promise.all(Object.entries(bindings).map(async ([bindingId, binding]) => {
      const loaded: Partial<Record<MapSemantic, THREE.Texture>> = {};
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
        loaded[semantic] = handle.texture;
      }));
      return [bindingId, loaded] as const;
    })).then(entries => {
      if (active) setTextures(Object.fromEntries(entries));
    });
    return () => {
      active = false;
      for (const handle of handles) handle.release();
      manager.evictUnused();
    };
  }, [bindings, renderer]);

  return textures;
}
