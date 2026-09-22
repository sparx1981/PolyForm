import * as THREE from 'three';
import { FBXLoader } from 'three-stdlib';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { USDLoader } from 'three/examples/jsm/loaders/USDLoader.js';

// Global cache for loaded model templates and promises to avoid duplicate loads
const modelCache = new Map<string, THREE.Group>();
const loadingPromises = new Map<string, Promise<THREE.Group>>();
const textureCache = new Map<string, THREE.Texture>();

// isColorData: true for albedo/emissive maps (sRGB-encoded), false for
// normal/roughness/metalness/AO/displacement maps, which store linear data
// and must NOT be sRGB-decoded or their values come out visibly wrong.
export function getCachedPlantTexture(url: string, isColorData: boolean = true): THREE.Texture {
  const cacheKey = `${url}|${isColorData ? 'srgb' : 'linear'}`;
  if (textureCache.has(cacheKey)) {
    return textureCache.get(cacheKey)!;
  }
  const texture = new THREE.TextureLoader().load(url);
  texture.colorSpace = isColorData ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  textureCache.set(cacheKey, texture);
  return texture;
}

/**
 * @param urlRemap Absolute URL -> the actual URL to fetch instead, for a GLTF whose internal
 * relative URIs (its .bin, its textures) don't reliably resolve by appending them to the
 * .gltf's own URL - a remote host's real file layout can differ from that assumption (confirmed
 * against Poly Haven: several multi-part models' textures 404 that way, even though the exact
 * same files download fine via their own dedicated CDN URL from the /files API). Keyed by the
 * absolute URL GLTFLoader will actually request (i.e. the relative URI already resolved against
 * `url`), not the bare relative path, since that's what a LoadingManager's urlModifier receives.
 */
export function loadPlantGLTF(url: string, onLoad: (model: THREE.Group) => void, onError?: (err: any) => void, urlRemap?: Record<string, string>) {
  if (modelCache.has(url)) {
    onLoad(modelCache.get(url)!.clone(true));
    return;
  }

  if (loadingPromises.has(url)) {
    loadingPromises.get(url)!.then(group => {
      onLoad(group.clone(true));
    }).catch(err => {
      onError?.(err);
    });
    return;
  }

  const promise = new Promise<THREE.Group>((resolve, reject) => {
    const manager = new THREE.LoadingManager();
    if (urlRemap) manager.setURLModifier(requested => urlRemap[requested] ?? requested);
    const loader = new GLTFLoader(manager);
    loader.load(
      url,
      (gltf) => {
        modelCache.set(url, gltf.scene);
        resolve(gltf.scene);
      },
      undefined,
      (err) => {
        console.warn('[PlantModelLoader] Could not load GLTF:', url, err);
        reject(err);
      }
    );
  });

  loadingPromises.set(url, promise);
  promise.then(scene => {
    onLoad(scene.clone(true));
  }).catch(err => {
    onError?.(err);
  });
}

export function loadPlantFBX(url: string, onLoad: (model: THREE.Group) => void, onError?: (err: any) => void) {
  if (modelCache.has(url)) {
    onLoad(modelCache.get(url)!.clone(true));
    return;
  }

  if (loadingPromises.has(url)) {
    loadingPromises.get(url)!.then(group => {
      onLoad(group.clone(true));
    }).catch(err => {
      onError?.(err);
    });
    return;
  }

  const promise = new Promise<THREE.Group>((resolve, reject) => {
    const loader = new FBXLoader();
    loader.load(
      url,
      (fbx) => {
        modelCache.set(url, fbx);
        resolve(fbx);
      },
      undefined,
      (err) => {
        console.warn('[PlantModelLoader] Could not load FBX:', url, err);
        reject(err);
      }
    );
  });

  loadingPromises.set(url, promise);
  promise.then(fbx => {
    onLoad(fbx.clone(true));
  }).catch(err => {
    onError?.(err);
  });
}

export function loadPlantUSD(url: string, onLoad: (model: THREE.Group) => void, onError?: (err: any) => void) {
  if (modelCache.has(url)) {
    onLoad(modelCache.get(url)!.clone(true));
    return;
  }

  if (loadingPromises.has(url)) {
    loadingPromises.get(url)!.then(group => {
      onLoad(group.clone(true));
    }).catch(err => {
      onError?.(err);
    });
    return;
  }

  const promise = new Promise<THREE.Group>((resolve, reject) => {
    const loader = new USDLoader();
    loader.load(
      url,
      (group) => {
        modelCache.set(url, group);
        resolve(group);
      },
      undefined,
      (err) => {
        console.warn('[PlantModelLoader] Could not load USD:', url, err);
        reject(err);
      }
    );
  });

  loadingPromises.set(url, promise);
  promise.then(group => {
    onLoad(group.clone(true));
  }).catch(err => {
    onError?.(err);
  });
}

