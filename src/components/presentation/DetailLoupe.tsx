import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { presentation } from '../../lib/presentation/store';
import { configureLoupeCamera } from '../../lib/presentation/loupe';
import { createGlassMaterial, glassDimensions, glassShadowMargin, GlassMotion, updateGlassMaterial } from '../../lib/presentation/glass';

/** Longest side of the lens image, in pixels. */
const IMAGE_SIDE = 512;

/** The display colour of the page behind the (transparent) canvas, for parts of the scene with no background of their own. */
function resolveBackdrop(canvas: HTMLElement, into: THREE.Color) {
    try {
        for (let el: HTMLElement | null = canvas; el; el = el.parentElement) {
            const c = getComputedStyle(el).backgroundColor;
            const m = /rgba?\(([^)]+)\)/.exec(c);
            if (!m) continue;
            const [r, g, b, a = 1] = m[1]!.split(/[ ,/]+/).filter(Boolean).map(Number);
            if (a > 0.5 && [r, g, b].every(Number.isFinite)) { into.setRGB(r! / 255, g! / 255, b! / 255, THREE.LinearSRGBColorSpace); return; }
        }
    } catch { /* keep the previous colour */ }
}

/**
 * The glass lens: a magnified second view of the scene, drawn through a refracting, specular, softly shadowed
 * glass shape. Used by Presentation mode and by the Camera toolbar's Glass tool, with the same settings.
 * Mounted only while enabled. Runs after the main composer so no main render target is disturbed.
 */
export default function DetailLoupe({ composerActive }: {
    composerActive: boolean;
}) {
    const { gl, scene, camera, size } = useThree();
    const last = useRef(-Infinity);
    const pointerInside = useRef(false);
    const previous = useRef<{ x: number; y: number } | null>(null);
    const cropped = useMemo(() => camera.clone() as THREE.PerspectiveCamera | THREE.OrthographicCamera, [camera]);
    const motion = useMemo(() => new GlassMotion(), []);
    const backdrop = useRef(new THREE.Color(0.9, 0.9, 0.9));
    const backdropAt = useRef(-Infinity);
    const resources = useMemo(() => {
        const target = new THREE.WebGLRenderTarget(IMAGE_SIDE, IMAGE_SIDE, { type: THREE.HalfFloatType });
        const overlay = new THREE.Scene();
        const material = createGlassMaterial(target.texture);
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
        quad.frustumCulled = false;
        overlay.add(quad);
        const overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        return { target, overlay, quad, material, overlayCamera };
    }, []);
    useEffect(() => () => { resources.target.dispose(); resources.quad.geometry.dispose(); resources.material.dispose(); }, [resources]);

    // "Always follow the cursor": the lens sits under the pointer while it is over the viewport.
    useEffect(() => {
        const canvas = gl.domElement;
        const move = (e: PointerEvent) => {
            if (!presentation.get().loupeFollow) return;
            const rect = canvas.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            pointerInside.current = true;
            presentation.set({ loupePosition: [Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))] });
        };
        const leave = () => { pointerInside.current = false; };
        canvas.addEventListener('pointermove', move);
        canvas.addEventListener('pointerleave', leave);
        return () => { canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerleave', leave); };
    }, [gl]);

    useFrame(({ clock }, delta) => {
        const s = presentation.get();
        const oldTarget = gl.getRenderTarget(), oldAuto = gl.autoClear, oldShadows = gl.shadowMap.autoUpdate;
        try {
            if (!composerActive) {
                gl.autoClear = true;
                gl.render(scene, camera);
            }
            // Following the cursor, the lens only shows while the pointer is over the view.
            if (s.loupeFollow && !pointerInside.current) { previous.current = null; return; }
            const base = Math.min(s.loupeRadius, size.width * .35, size.height * .35);
            const dims = glassDimensions(s, base, size);
            // Squash and stretch: pressed, or being dragged / following a moving pointer.
            const now = { x: s.loupePosition[0], y: s.loupePosition[1] };
            const dt = Math.max(delta, 1 / 240);
            const velocity = previous.current ? { x: (now.x - previous.current.x) / dt, y: (now.y - previous.current.y) / dt } : { x: 0, y: 0 };
            previous.current = now;
            const scale = motion.update(delta, { pressed: s.loupePressed, vx: velocity.x, vy: velocity.y, enabled: s.glassLiquid });

            // The lens image is cropped for the undeformed lens and stretched with it, like a drop.
            const aspect = dims.hx / dims.hy;
            const width = aspect >= 1 ? IMAGE_SIDE : Math.max(64, Math.round(IMAGE_SIDE * aspect));
            const height = aspect >= 1 ? Math.max(64, Math.round(IMAGE_SIDE / aspect)) : IMAGE_SIDE;
            if (resources.target.width !== width || resources.target.height !== height) resources.target.setSize(width, height);
            if (clock.elapsedTime - last.current > 1 / 45) {
                configureLoupeCamera(camera as any, cropped, size.width, size.height, s.loupePosition, dims.hx, s.loupeZoom, dims.hy);
                gl.shadowMap.autoUpdate = false;
                gl.autoClear = true;
                gl.setRenderTarget(resources.target);
                gl.clear();
                gl.render(scene, cropped);
                last.current = clock.elapsedTime;
            }
            gl.setRenderTarget(oldTarget);
            gl.autoClear = false;
            const half: [number, number] = [dims.hx * scale.x, dims.hy * scale.y];
            const margin = glassShadowMargin(s);
            const quad: [number, number] = [half[0] + margin, half[1] + margin];
            if (clock.elapsedTime - backdropAt.current > 1) {
                backdropAt.current = clock.elapsedTime;
                resolveBackdrop(gl.domElement, backdrop.current);
            }
            updateGlassMaterial(resources.material, { backdrop: backdrop.current, settings: s, half, corner: dims.corner * Math.min(scale.x, scale.y), quad, texel: [1 / width, 1 / height] });
            resources.quad.position.set(s.loupePosition[0] * 2 - 1, 1 - s.loupePosition[1] * 2, 0);
            resources.quad.scale.set(quad[0] * 2 / size.width, quad[1] * 2 / size.height, 1);
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
