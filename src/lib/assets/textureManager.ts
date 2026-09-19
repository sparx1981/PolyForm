import * as THREE from 'three';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import type { MapVariant } from './types';

export interface TextureHandle {
  texture: THREE.Texture;
  release(): void;
}

interface CacheEntry {
  promise: Promise<THREE.Texture>;
  texture?: THREE.Texture;
  refs: number;
  lastUsed: number;
  failedAt?: number;
}

export class ManagedTextureManager {
  private readonly entries = new Map<string, CacheEntry>();
  private disposed = false;
  private readonly ktx2: KTX2Loader;
  private readonly ktx2Supported: boolean;
  private readonly exr = new EXRLoader();
  private readonly image = new THREE.TextureLoader();

  constructor(renderer: THREE.WebGLRenderer, transcoderPath = '/basis/') {
    this.ktx2 = new KTX2Loader().setTranscoderPath(transcoderPath);
    try {
      this.ktx2.detectSupport(renderer);
      this.ktx2Supported = true;
    } catch {
      // Headless/jsdom renderers have no WebGL extensions. Use the manifest fallback
      // image there; real WebGL clients still take the compressed KTX2 path.
      this.ktx2Supported = false;
    }
    this.image.setCrossOrigin('anonymous');
  }

  private key(variant: MapVariant): string {
    return `${variant.sha256}:${variant.encoding}:${variant.uvChannel}`;
  }

  async acquire(variant: MapVariant): Promise<TextureHandle> {
    if (this.disposed) throw new Error('Texture manager disposed');
    const key = this.key(variant);
    let entry = this.entries.get(key);
    if (entry?.failedAt && Date.now() - entry.failedAt > 30_000) {
      this.entries.delete(key);
      entry = undefined;
    }
    if (!entry) {
      const created: CacheEntry = { refs: 0, lastUsed: Date.now(), promise: Promise.resolve(null as unknown as THREE.Texture) };
      created.promise = this.load(variant).then(texture => {
        if (this.disposed) {
          texture.dispose();
          throw new Error('Texture manager disposed');
        }
        texture.colorSpace = variant.encoding === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        texture.channel = variant.uvChannel;
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.needsUpdate = true;
        created.texture = texture;
        return texture;
      }).catch(error => {
        created.failedAt = Date.now();
        throw error;
      });
      entry = created;
      this.entries.set(key, entry);
    }
    entry.refs += 1;
    entry.lastUsed = Date.now();
    try {
      const texture = await entry.promise;
      let released = false;
      return {
        texture,
        release: () => {
          if (released) return;
          released = true;
          const current = this.entries.get(key);
          if (current) {
            current.refs = Math.max(0, current.refs - 1);
            current.lastUsed = Date.now();
          }
        },
      };
    } catch (error) {
      entry.refs = Math.max(0, entry.refs - 1);
      throw error;
    }
  }

  evictUnused(maxEntries = 64): void {
    const unused = [...this.entries.entries()].filter(([, entry]) => entry.refs === 0)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    while (this.entries.size > maxEntries && unused.length) {
      const [key, entry] = unused.shift()!;
      entry.texture?.dispose();
      this.entries.delete(key);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.entries.values()) entry.texture?.dispose();
    this.entries.clear();
    this.ktx2.dispose();
  }

  private async load(variant: MapVariant): Promise<THREE.Texture> {
    try {
      if (variant.format === 'ktx2' && this.ktx2Supported) return await this.ktx2.loadAsync(variant.url);
      if (variant.format === 'exr') return await this.exr.loadAsync(variant.url);
      return await this.image.loadAsync(variant.url);
    } catch (error) {
      if (!variant.fallbackUrl) throw error;
      return this.image.loadAsync(variant.fallbackUrl);
    }
  }
}
