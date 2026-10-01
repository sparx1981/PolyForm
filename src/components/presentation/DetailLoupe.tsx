import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { presentation } from '../../lib/presentation/store';
import { configureLoupeCamera, createLoupeMaterial } from '../../lib/presentation/loupe';
/** Mounted only while enabled. Runs after the main composer so no main render target is disturbed. */
export default function DetailLoupe({ composerActive }: {
    composerActive: boolean;
}) {
    const { gl, scene, camera, size } = useThree();
    const last = useRef(-Infinity);
    const cropped = useMemo(() => camera.clone() as THREE.PerspectiveCamera | THREE.OrthographicCamera, [camera]);
    const resources = useMemo(() => {
        const target = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType });
        const overlay = new THREE.Scene();
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), createLoupeMaterial(target.texture));
        quad.frustumCulled = false;
        overlay.add(quad);
        const overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        return { target, overlay, quad, overlayCamera };
    }, []);
    useEffect(() => () => { resources.target.dispose(); resources.quad.geometry.dispose(); resources.quad.material.dispose(); }, [resources]);
    useFrame(({ clock }) => {
        const s = presentation.get();
        const radius = Math.min(s.loupeRadius, size.width * .35, size.height * .35);
        const oldTarget = gl.getRenderTarget(), oldAuto = gl.autoClear, oldShadows = gl.shadowMap.autoUpdate;
        try {
            if (!composerActive) {
                gl.autoClear = true;
                gl.render(scene, camera);
            }
            if (clock.elapsedTime - last.current > 1 / 30) {
                configureLoupeCamera(camera as any, cropped, size.width, size.height, s.loupePosition, radius, s.loupeZoom);
                gl.shadowMap.autoUpdate = false;
                gl.autoClear = true;
                gl.setRenderTarget(resources.target);
                gl.clear();
                gl.render(scene, cropped);
                last.current = clock.elapsedTime;
            }
            gl.setRenderTarget(oldTarget);
            gl.autoClear = false;
            resources.quad.position.set(s.loupePosition[0] * 2 - 1, 1 - s.loupePosition[1] * 2, 0);
            resources.quad.scale.set(radius * 2 / size.width, radius * 2 / size.height, 1);
            gl.render(resources.overlay, resources.overlayCamera);
        }
        finally {
            gl.setRenderTarget(oldTarget);
            gl.autoClear = oldAuto;
            gl.shadowMap.autoUpdate = oldShadows;
        }
    }, 2);
    return null;
}
