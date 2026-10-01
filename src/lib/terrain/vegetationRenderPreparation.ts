import type { Camera, Scene } from 'three';
interface Registry { previous: Scene['onBeforeRender']; hook: Scene['onBeforeRender']; callbacks: Set<(camera: Camera) => void> }
const registries = new WeakMap<Scene, Registry>();
/** Compact instance attributes before Three uploads buffers, separately for each render camera. */
export function registerVegetationPreparation(scene: Scene, callback: (camera: Camera) => void): () => void {
  let registry = registries.get(scene);
  if (!registry) {
    const previous = scene.onBeforeRender;
    const callbacks = new Set<(camera: Camera) => void>();
    const hook: Scene['onBeforeRender'] = function(...args) {
      previous.apply(scene,args);
      callbacks.forEach(prepare => prepare(args[2]));
    };
    registry = { previous, hook, callbacks };
    registries.set(scene,registry); scene.onBeforeRender=hook;
  }
  const owned=registry;
  owned.callbacks.add(callback);
  return () => {
    owned.callbacks.delete(callback);
    if (!owned.callbacks.size) {
      if (scene.onBeforeRender===owned.hook) scene.onBeforeRender=owned.previous;
      registries.delete(scene);
    }
  };
}
