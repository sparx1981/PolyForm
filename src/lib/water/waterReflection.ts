import * as THREE from 'three';

/**
 * Planar reflection at a water level: the scene rendered from the camera mirrored in the water
 * plane, clipped at the surface, into a half-resolution texture. The water shader samples it at
 * the fragment's screen position, nudged by the wave normal. Grass and water are left out of the
 * reflection render (grass is the most expensive thing in the scene and barely visible there).
 */
export class WaterReflection {
  readonly target: THREE.WebGLRenderTarget;
  readonly textureMatrix = new THREE.Matrix4();
  private readonly camera = new THREE.PerspectiveCamera();
  private readonly plane = new THREE.Plane();
  private readonly hidden: THREE.Object3D[] = [];
  private renders = 0;

  constructor() {
    // The mirrored matrices are set by hand each frame; the renderer must not recompute them.
    this.camera.matrixAutoUpdate = false;
    this.camera.matrixWorldAutoUpdate = false;
    this.target = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType });
    this.target.texture.generateMipmaps = false;
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, level: number, exclude: (object: THREE.Object3D) => boolean) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const width = Math.max(64, Math.round(size.x / 2)), height = Math.max(64, Math.round(size.y / 2));
    if (this.target.width !== width || this.target.height !== height) this.target.setSize(width, height);

    // Mirror the camera in the plane y = level (as three's Reflector does).
    camera.updateMatrixWorld();
    const normal = new THREE.Vector3(0, 1, 0);
    const eye = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    const onPlane = new THREE.Vector3(eye.x, level, eye.z);
    const rotation = new THREE.Matrix4().extractRotation(camera.matrixWorld);
    const view = new THREE.Vector3().subVectors(onPlane, eye).reflect(normal).negate().add(onPlane);
    const lookAt = new THREE.Vector3(0, 0, -1).applyMatrix4(rotation).add(eye);
    const target = new THREE.Vector3().subVectors(onPlane, lookAt).reflect(normal).negate().add(onPlane);
    this.camera.position.copy(view);
    this.camera.up.set(0, 1, 0).applyMatrix4(rotation).reflect(normal);
    // lookAt reads the position from the world matrix, which is not auto-updated here.
    this.camera.updateMatrix();
    this.camera.matrixWorld.copy(this.camera.matrix);
    this.camera.lookAt(target);
    this.camera.updateMatrix();
    this.camera.matrixWorld.copy(this.camera.matrix);
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
    this.camera.projectionMatrix.copy((camera as THREE.PerspectiveCamera).projectionMatrix);
    this.camera.layers.mask = camera.layers.mask;

    // Oblique near plane at the water surface (Lengyel), so nothing below the water reflects.
    this.plane.set(new THREE.Vector3(0, 1, 0), -level).applyMatrix4(this.camera.matrixWorldInverse);
    const clip = new THREE.Vector4(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const projection = this.camera.projectionMatrix;
    const q = new THREE.Vector4(
      (Math.sign(clip.x) + projection.elements[8]) / projection.elements[0],
      (Math.sign(clip.y) + projection.elements[9]) / projection.elements[5],
      -1, (1 + projection.elements[10]) / projection.elements[14]);
    clip.multiplyScalar(2 / clip.dot(q));
    projection.elements[2] = clip.x; projection.elements[6] = clip.y;
    projection.elements[10] = clip.z + 1; projection.elements[14] = clip.w;

    // Screen-space lookup: bias from clip space to [0, 1].
    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(this.camera.projectionMatrix).multiply(this.camera.matrixWorldInverse);

    this.hidden.length = 0;
    scene.traverseVisible(object => { if (exclude(object)) this.hidden.push(object); });
    this.hidden.forEach(object => { object.visible = false; });
    const previousTarget = renderer.getRenderTarget();
    // Reuse this frame's shadow maps rather than re-rendering them for the mirror view. They
    // only exist once the scene has been drawn, so the first frames update them normally
    // (sampling a shadow map that was never created draws nothing).
    const previousShadowAuto = renderer.shadowMap.autoUpdate;
    if (++this.renders > 3) renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, this.camera);
    renderer.setRenderTarget(previousTarget);
    renderer.shadowMap.autoUpdate = previousShadowAuto;
    this.hidden.forEach(object => { object.visible = true; });
  }

  /** The mirrored camera from the last render (for debugging and tests). */
  get virtualCamera(): THREE.Camera { return this.camera; }

  dispose() { this.target.dispose(); }
}
