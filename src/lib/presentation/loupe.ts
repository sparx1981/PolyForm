import * as THREE from 'three';
/** Crop the source camera frustum around a viewport point, without moving the source camera. `radius` is the crop's half-width in pixels and `radiusY` its half-height (a circular lens passes just one). */
export function configureLoupeCamera(source: THREE.PerspectiveCamera | THREE.OrthographicCamera, target: THREE.PerspectiveCamera | THREE.OrthographicCamera, width: number, height: number, position: [
    number,
    number
], radius: number, magnification: number, radiusY: number = radius) {
    target.copy(source as any, false);
    source.getWorldPosition(target.position);
    source.getWorldQuaternion(target.quaternion);
    const view = source.view;
    const fullWidth = view?.enabled ? view.fullWidth : width;
    const fullHeight = view?.enabled ? view.fullHeight : height;
    const viewWidth = view?.enabled ? view.width : width;
    const viewHeight = view?.enabled ? view.height : height;
    const cropWidth = 2 * radius / Math.max(1, magnification) * viewWidth / width;
    const cropHeight = 2 * radiusY / Math.max(1, magnification) * viewHeight / height;
    target.setViewOffset(fullWidth, fullHeight, (view?.enabled ? view.offsetX : 0) + position[0] * viewWidth - cropWidth / 2, (view?.enabled ? view.offsetY : 0) + position[1] * viewHeight - cropHeight / 2, cropWidth, cropHeight);
    target.updateMatrixWorld();
}
