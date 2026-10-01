import { describe, it, expect, vi } from 'vitest';
import { Scene, PerspectiveCamera } from 'three';
import { registerVegetationPreparation } from './vegetationRenderPreparation';
describe('per-camera vegetation preparation',()=>{
  it('prepares each render camera before geometry uploads, preserving existing hooks',()=>{
    const scene=new Scene(), main=new PerspectiveCamera(), mirror=new PerspectiveCamera();
    const previous=vi.fn();scene.onBeforeRender=previous;
    const prepare=vi.fn();const remove=registerVegetationPreparation(scene,prepare);
    scene.onBeforeRender(null as never,scene,main,null as never,null as never,null as never);
    scene.onBeforeRender(null as never,scene,mirror,null as never,null as never,null as never);
    expect(prepare.mock.calls).toEqual([[main],[mirror]]);expect(previous).toHaveBeenCalledTimes(2);
    remove();expect(scene.onBeforeRender).toBe(previous);
  });
  it('supports several meadows unmounting in any order without calling disposed batches',()=>{
    const scene=new Scene(), camera=new PerspectiveCamera(), first=vi.fn(),second=vi.fn();
    const previous=scene.onBeforeRender;
    const removeFirst=registerVegetationPreparation(scene,first),removeSecond=registerVegetationPreparation(scene,second);
    removeFirst();scene.onBeforeRender(null as never,scene,camera,null as never,null as never,null as never);
    expect(first).not.toHaveBeenCalled();expect(second).toHaveBeenCalledOnce();
    removeSecond();expect(scene.onBeforeRender).toBe(previous);
  });
});
