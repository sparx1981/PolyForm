import * as THREE from 'three';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import type { EnvironmentState, MapVariant } from './types';

interface EnvironmentResource {
  source: THREE.Texture;
  target: THREE.WebGLRenderTarget;
}

export class EnvironmentManager {
  private readonly cache = new Map<string, Promise<EnvironmentResource>>();
  private request = 0;
  private current: EnvironmentResource | null = null;
  private readonly rgbe = new RGBELoader();
  private readonly exr = new EXRLoader();

  constructor(private readonly renderer: THREE.WebGLRenderer) {}

  async apply(scene: THREE.Scene, state: EnvironmentState, variant: MapVariant | null): Promise<boolean> {
    const request = ++this.request;
    if (!state.ref || !variant) {
      scene.environment = null;
      scene.background = null;
      this.current = null;
      return true;
    }
    try {
      const resource = await this.load(`${state.ref.assetId}@${state.ref.revision}:${variant.sha256}`, variant);
      if (request !== this.request) return false;
      resource.target.texture.mapping = THREE.CubeUVReflectionMapping;
      scene.environment = resource.target.texture;
      scene.background = state.background ? resource.source : null;
      scene.backgroundBlurriness = state.blur;
      scene.environmentIntensity = state.intensity;
      scene.backgroundIntensity = state.backgroundIntensity;
      scene.environmentRotation.y = state.rotationRadians;
      scene.backgroundRotation.y = state.rotationRadians;
      this.current = resource;
      return true;
    } catch {
      // Deliberately retain the previous successful environment.
      return false;
    }
  }

  dispose(): void {
    for (const promise of this.cache.values()) void promise.then(resource => {
      resource.source.dispose();
      resource.target.dispose();
    });
    this.cache.clear();
    this.current = null;
  }

  private load(key: string, variant: MapVariant): Promise<EnvironmentResource> {
    const existing = this.cache.get(key);
    if (existing) return existing;
    const promise = (variant.format === 'exr' ? this.exr.loadAsync(variant.url) : this.rgbe.loadAsync(variant.url))
      .then(source => {
        source.mapping = THREE.EquirectangularReflectionMapping;
        source.colorSpace = THREE.LinearSRGBColorSpace;
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        const target = pmrem.fromEquirectangular(source);
        pmrem.dispose();
        return { source, target };
      })
      .catch(error => {
        this.cache.delete(key);
        throw error;
      });
    this.cache.set(key, promise);
    return promise;
  }
}
