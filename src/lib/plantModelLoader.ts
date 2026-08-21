import * as THREE from 'three';
import { FBXLoader } from 'three-stdlib';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { USDLoader } from 'three/examples/jsm/loaders/USDLoader.js';

// Global cache for loaded model templates and promises to avoid duplicate loads
const modelCache = new Map<string, THREE.Group>();
const loadingPromises = new Map<string, Promise<THREE.Group>>();
const textureCache = new Map<string, THREE.Texture>();

export function getCachedPlantTexture(url: string): THREE.Texture {
  if (textureCache.has(url)) {
    return textureCache.get(url)!;
  }
  const texture = new THREE.TextureLoader().load(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  textureCache.set(url, texture);
  return texture;
}

export function loadPlantGLTF(url: string, onLoad: (model: THREE.Group) => void, onError?: (err: any) => void) {
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
    const loader = new GLTFLoader();
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

