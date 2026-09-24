import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { resolveWorldHit, isPortalSurface, isNavigableSurface, isFloorSurface, resolvePortalDestination, resolvePortalDestinationForFloor, extractYawFromQuaternion, PORTAL_EYE_HEIGHT, type ResolvedSurfaceHit, type PortalDestination } from '../lib/portalNavigation';

// Live look-through preview for Portal Navigation: a circular "window"
// hovering over the entered surface, rendered from a second camera
// positioned where a click would actually send the viewer - so you see
// the destination (including behind walls/objects you're currently facing
// away from) before committing, rather than just a flat marker. Shares
// the exact §4-§5 resolution pipeline with the actual click handler
// (resolvePortalDestination) so preview and outcome can never disagree.
// A dedicated layer (not used anywhere else in the app) that only the
// portal's own preview camera excludes - lets us keep the disc/ring
// permanently visible to the main camera with no per-frame visibility
// toggling. Toggling .visible around the off-screen render was a source
// of flicker in its own right: if anything else in the render pipeline
// (the app's optional EffectComposer/N8AO pass in particular) reads scene
// state at a slightly different point in the frame than assumed, it could
// catch the markers mid-toggle. Layers avoid the toggle entirely.
const TELEPORT_PORTAL_LAYER = 31;

// See stableHitRef's own comment inside TeleportPortalPreview for why these
// exist: raw per-frame raycasts need a little hysteresis before the preview
// disc trusts them.
const HOVER_CONFIRM_FRAMES = 2;
const HOVER_HOLD_MS = 120;
// Below this many screen pixels of movement between frames, the cursor
// counts as "not really moving" for hover-hysteresis purposes (see
// lastPointerPxRef's comment) - small enough that no deliberate mouse
// movement is ever mistaken for standing still, large enough to absorb
// mouse-hardware jitter.
const HOVER_STILL_PX = 2;

// Frosted-glass rim around the look-through disc: a glass tube that bends and blurs the edge of
// the destination view, catches a highlight along its bevel, and carries a soft white/cyan light
// that sweeps continuously around it, with a faint halo outside. Drawn in the ring's local plane
// (the disc has radius 1): glass from 0.9 to 1.12, halo out to 1.24.
const RING_INNER = 0.9;
const RING_GLASS = 1.12;
const RING_OUTER = 1.24;

function createGlassRingMaterial(view: THREE.Texture) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uView: { value: view },
      uHasView: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vLocal;
      void main() {
        vLocal = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform sampler2D uView;
      uniform float uHasView;
      varying vec2 vLocal;
      const float INNER = ${RING_INNER.toFixed(3)};
      const float GLASS = ${RING_GLASS.toFixed(3)};
      const float OUTER = ${RING_OUTER.toFixed(3)};
      const float TAU = 6.28318530718;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        float r = length(vLocal);
        vec2 dir = vLocal / max(r, 1e-4);
        float angle = atan(vLocal.y, vLocal.x);
        // Light sweeping around the rim: a bright head with a long fading tail, plus a fainter
        // counter-sweep, breathing gently.
        float phase = fract(angle / TAU - uTime * 0.22);
        float lead = smoothstep(0.93, 1.0, phase);
        float sweep = pow(1.0 - phase, 5.0) + lead * lead;
        float phase2 = fract(-angle / TAU - uTime * 0.13 + 0.5);
        float lead2 = smoothstep(0.95, 1.0, phase2);
        sweep += 0.35 * (pow(1.0 - phase2, 8.0) + lead2 * lead2);
        float breathe = 0.85 + 0.15 * sin(uTime * 2.1);

        if (r > GLASS) {
          // Soft halo outside the glass.
          float h = (r - GLASS) / (OUTER - GLASS);
          float halo = exp(-h * 4.0) * (1.0 - smoothstep(0.7, 1.0, h));
          vec3 col = mix(vec3(0.45, 0.85, 1.0), vec3(1.0), sweep * 0.6);
          float a = halo * (0.18 + 0.55 * sweep) * breathe;
          if (a < 0.003) discard;
          gl_FragColor = vec4(col * (0.8 + sweep), a);
          return;
        }

        // Across the tube: -1 at the inner edge, +1 at the outer edge; the surface bulges toward
        // the viewer like a rounded glass bead.
        float x = (r - INNER) / (GLASS - INNER) * 2.0 - 1.0;
        float bulge = sqrt(max(0.0, 1.0 - x * x));
        vec3 n = normalize(vec3(dir * x * 0.9, bulge + 0.15));

        // Refraction: the glass bends the edge of the destination view into the rim, frosted
        // by a small jittered blur.
        vec3 behind = vec3(0.0);
        float bend = INNER - 0.1 * x - 0.06 * bulge;
        for (int i = 0; i < 6; i++) {
          float fi = float(i);
          vec2 jitter = vec2(hash(vLocal * 91.0 + fi), hash(vLocal * 57.0 + fi * 3.1)) - 0.5;
          vec2 uv = 0.5 + 0.5 * (dir * bend + jitter * 0.045);
          behind += texture2D(uView, clamp(uv, 0.0, 1.0)).rgb;
        }
        behind /= 6.0;
        vec3 frost = vec3(0.86, 0.93, 1.0);
        vec3 glass = mix(frost, behind * 1.05 + frost * 0.25, 0.65 * uHasView);
        // Fine frosted grain.
        glass *= 0.94 + 0.08 * hash(floor(vLocal * 900.0));

        // Bevel lighting: a key highlight from the upper left, Fresnel brightening at the edges.
        vec3 L = normalize(vec3(-0.45, 0.6, 0.66));
        float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 28.0);
        float fresnel = pow(1.0 - n.z, 2.5);
        vec3 glow = mix(vec3(0.35, 0.82, 1.0), vec3(1.0), clamp(sweep, 0.0, 1.0)) * sweep * breathe;

        vec3 col = glass * (0.75 + 0.25 * bulge) + fresnel * 0.45 + spec * 1.2 + glow * (0.55 + 0.9 * bulge);
        // Thin bright lines where the glass meets the view and the halo.
        float edges = exp(-pow((x + 1.0) * 14.0, 2.0)) + exp(-pow((1.0 - x) * 14.0, 2.0));
        col += edges * (0.35 + 0.6 * sweep);
        float aa = smoothstep(-1.0, -0.9, x) * (1.0 - smoothstep(0.9, 1.0, x));
        float alpha = clamp(0.55 + 0.3 * fresnel + spec + 0.35 * sweep + edges * 0.4, 0.0, 1.0);
        gl_FragColor = vec4(col, alpha * max(aa, edges * 0.8));
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
}

function resolvePreviewDestination(scene: THREE.Scene, camera: THREE.Camera, hit: ResolvedSurfaceHit): PortalDestination | null {
  const params = { camEye: camera.position, camYaw: extractYawFromQuaternion(camera.quaternion),
    eyeHeight: PORTAL_EYE_HEIGHT, clearanceDMax: 3.5, maxWallThickness: 0.6 };
  if (isNavigableSurface(hit.worldNormal)) return resolvePortalDestination(scene.children, hit, params);
  if (isFloorSurface(hit.worldNormal)) return resolvePortalDestinationForFloor(scene.children, hit, params);
  return null;
}

export function TeleportPortalPreview({
  postprocessingActive,
  floorEnabled,
  transitionActive,
  onTravel,
}: {
  postprocessingActive: boolean;
  floorEnabled: boolean;
  transitionActive: boolean;
  onTravel: (destination: PortalDestination | null) => void;
}) {
  const { gl, scene, camera, size } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const pointer = useMemo(() => new THREE.Vector2(), []);
  const pointerInsideRef = useRef(false);
  const displayedPointerRef = useRef(new THREE.Vector2(Infinity, Infinity));
  const displayedAtRef = useRef(0);
  // Owned locally rather than lifted into Viewport's own giant Scene()
  // component (as a previous version did, via a shared `snapIndicator`
  // state + an onHoverChange callback prop): a state update anywhere
  // re-renders the ENTIRE component it lives on, and Scene() is thousands
  // of lines with hundreds of hooks. Routing every hover tick through it
  // was expensive enough on its own to read as stutter/flicker in the
  // whole viewport, not just this preview - keeping the state (and the
  // re-render it causes) confined to this small component fixes that
  // regardless of how the mesh-level flicker/hysteresis work above turns
  // out, and was diagnosed from the user's own suggestion that removing
  // the tooltip text seemed to help.
  const [hoverTooltip, setHoverTooltip] = useState<{ point: [number, number, number]; text: string } | null>(null);
  const discRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const portalCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  if (!portalCameraRef.current) {
    const cam = new THREE.PerspectiveCamera(65, 1, 0.1, 2000);
    cam.layers.disable(TELEPORT_PORTAL_LAYER);
    portalCameraRef.current = cam;
  }
  const renderTarget = useMemo(
    () => new THREE.WebGLRenderTarget(384, 384, { generateMipmaps: false }),
    []
  );
  const ringMaterial = useMemo(() => createGlassRingMaterial(renderTarget.texture), [renderTarget]);
  useEffect(() => () => ringMaterial.dispose(), [ringMaterial]);
  useEffect(() => { ringMaterial.uniforms.uHasView.value = postprocessingActive ? 0 : 1; }, [ringMaterial, postprocessingActive]);
  const frameCountRef = useRef(0);
  const destinationRef = useRef<PortalDestination | null>(null);
  const lastHitObjectRef = useRef<THREE.Object3D | null>(null);
  const hoverSyncRef = useRef<{ time: number; tooltip: string | null; point: THREE.Vector3 | null }>({ time: 0, tooltip: null, point: null });
  const lastPortalPoseRef = useRef<{ position: THREE.Vector3; quaternion: THREE.Quaternion; fov: number } | null>(null);
  const lastPortalRenderRef = useRef(0);
  // Hysteresis for the raw per-frame raycast (see the big comment where this
  // is used, below): a camera-and-mouse-static scene can still legitimately
  // return a DIFFERENT nearest hit on consecutive frames right at a grazing
  // angle - a window/door reveal edge, a stair baluster gap, a wall corner -
  // where sub-pixel jitter in `pointer` flips which of two nearly-coincident
  // faces (one right in front of the cursor, one much further behind it) the
  // ray lands on first. Passing every such raw result straight through to
  // the disc's position/scale is what read as the reported flicker: the
  // indicator popping between a near, correctly-sized disc and a huge one
  // anchored deep inside the model, or blinking off entirely for a frame.
  const stableHitRef = useRef<{ hit: ResolvedSurfaceHit; time: number } | null>(null);
  const pendingHitRef = useRef<{ object: THREE.Object3D | null; count: number }>({ object: null, count: 0 });
  // The cursor's own screen position last frame - see its use below for why
  // this, not object identity, is what actually distinguishes "the cursor
  // is grazing an edge and the ray flukily hit something else" (screen
  // position barely moved) from "the user swept the mouse to a genuinely
  // new, distant target" (screen position moved a lot), which the object-
  // identity-only version of this fix couldn't tell apart - it delayed
  // EVERY hit-object change by a frame or two, including real, continuous
  // mouse movement sliding across a wall built from many small panels
  // (each one a different object), which is what read as "less fluid".
  const lastPointerPxRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = gl.domElement;
    const trackPointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1,
        -(event.clientY - rect.top) / rect.height * 2 + 1);
      pointerInsideRef.current = true;
    };
    const leave = () => { pointerInsideRef.current = false; };
    const travel = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary) return;
      // Own portal clicks independently of Shape/kernel/ground handlers.
      event.stopImmediatePropagation();
      event.preventDefault();
      trackPointer(event);
      if (transitionActive) return;
      const samePixel = Math.hypot(
        (pointer.x - displayedPointerRef.current.x) * size.width / 2,
        (pointer.y - displayedPointerRef.current.y) * size.height / 2,
      ) <= HOVER_STILL_PX;
      if (samePixel && discRef.current?.visible && destinationRef.current &&
          performance.now() - displayedAtRef.current < HOVER_HOLD_MS) {
        onTravel(destinationRef.current);
        return;
      }
      // A press can precede the next animation frame (including on touch).
      raycaster.setFromCamera(pointer, camera);
      const intersection = raycaster.intersectObjects(scene.children, true)
        .find(hit => hit.face && isPortalSurface(hit.object));
      const hit = intersection ? resolveWorldHit(intersection, raycaster.ray.direction)
        : resolveGroundPlaneFloorHit(raycaster, scene, floorEnabled);
      onTravel(hit ? resolvePreviewDestination(scene, camera, hit) : null);
    };
    canvas.addEventListener('pointermove', trackPointer);
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('pointerdown', travel, true);
    return () => {
      canvas.removeEventListener('pointermove', trackPointer);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('pointerdown', travel, true);
    };
  }, [gl, camera, scene, floorEnabled, transitionActive, onTravel, pointer, raycaster, size.width, size.height]);

  useEffect(() => {
    discRef.current?.layers.set(TELEPORT_PORTAL_LAYER);
    ringRef.current?.layers.set(TELEPORT_PORTAL_LAYER);
    camera.layers.enable(TELEPORT_PORTAL_LAYER);
    // Never a valid raycast target - purely a visual indicator, so it must
    // not be able to intercept the hover/click hit-testing that decides
    // where the tool actually sends the viewer.
    const noRaycast = () => {};
    if (discRef.current) discRef.current.raycast = noRaycast;
    if (ringRef.current) ringRef.current.raycast = noRaycast;
    return () => {
      renderTarget.dispose();
      camera.layers.disable(TELEPORT_PORTAL_LAYER);
    };
    // This component now stays mounted for the whole teleport-tool session
    // (see its render site below) rather than being added/removed on every
    // hover-target change, so this setup/teardown - and the GPU render
    // target and camera-layer toggle it owns - only run once per session
    // instead of on every raycast that happens not to land on a valid
    // surface for a frame. Repeatedly disposing and recreating a
    // WebGLRenderTarget (and flipping the main camera's layer mask) on
    // every such gap is what was actually causing the preview to flicker
    // while the mouse moved - hover detection has brief, harmless gaps
    // (grazing a seam between two sub-meshes, a single frame between
    // adjacent surfaces) that are completely normal for real geometry, but
    // were previously each tearing this component down and rebuilding it.
  }, [renderTarget, camera]);

  useFrame((_, delta) => {
    ringMaterial.uniforms.uTime.value += delta;
    const disc = discRef.current;
    const ring = ringRef.current;
    const portalCam = portalCameraRef.current;
    if (!disc || !ring || !portalCam) return;
    if (transitionActive || !pointerInsideRef.current) {
      disc.visible = ring.visible = false;
      stableHitRef.current = null;
      destinationRef.current = null;
      pendingHitRef.current = { object: null, count: 0 };
      if (hoverSyncRef.current.tooltip !== null) {
        hoverSyncRef.current.tooltip = null;
        setHoverTooltip(null);
      }
      return;
    }

    // Raycasts against the current pointer position ONCE per rendered
    // frame - not once per native pointermove event, which is what used
    // to happen here. A mouse can report movement much faster than the
    // display refreshes, and a whole-scene raycast on every single one of
    // those events was expensive enough to starve the animation loop
    // between frames, so the preview only visibly advanced in step with
    // mouse movement instead of animating continuously on its own (a
    // "flip-book" effect - one new frame per cursor move). Sampling
    // R3F's own tracked pointer position here instead naturally caps this
    // work to the render rate.
    const now = performance.now();
    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);
    const shapeHit = intersects.find(i => isPortalSurface(i.object) && i.face);
    const rawHit = shapeHit ? resolveWorldHit(shapeHit, raycaster.ray.direction) : resolveGroundPlaneFloorHit(raycaster, scene, floorEnabled);
    const isWall = rawHit && isNavigableSurface(rawHit.worldNormal);
    const isFloor = rawHit && isFloorSurface(rawHit.worldNormal);
    const rawEnterHit = rawHit && (isWall || isFloor) ? rawHit : null;

    // Did the cursor itself actually move this frame? This, not object
    // identity, is what actually distinguishes a raycast glitch (cursor
    // still, ray flukily lands on something else) from real tracking
    // (cursor sliding across a wall built from many small panels, a
    // different object every frame, which is completely normal and must
    // never be delayed - see lastPointerPxRef's comment).
    const pointerPx = { x: pointer.x * size.width * 0.5, y: pointer.y * size.height * 0.5 };
    const lastPx = lastPointerPxRef.current;
    const pointerStill =
      !!lastPx && Math.hypot(pointerPx.x - lastPx.x, pointerPx.y - lastPx.y) < HOVER_STILL_PX;
    lastPointerPxRef.current = pointerPx;

    // Stabilize: accept the raw hit immediately whenever the cursor itself
    // is genuinely moving (deliberate mouse movement should never lag,
    // whatever object it lands on), or when it's the SAME object already
    // being shown. Only a raw hit that both changes object AND arrives
    // while the cursor is essentially still is suspect - that combination
    // is the actual signature of the grazing-angle glitch described above
    // (same screen pixel, wildly different depth/object) - and needs to
    // repeat for two consecutive frames before it's trusted. A miss is
    // held briefly across seams while moving as well. Leaving the canvas
    // hides the disc immediately; an expired miss clears the target.
    //
    const stable = stableHitRef.current;
    const rawObject = rawEnterHit?.hitObject ?? null;
    if (rawEnterHit && (!pointerStill || !stable || rawObject === stable.hit.hitObject)) {
      stableHitRef.current = { hit: rawEnterHit, time: now };
      pendingHitRef.current = { object: null, count: 0 };
    } else if (rawEnterHit) {
      const pending = pendingHitRef.current;
      if (pending.object === rawObject) {
        pending.count++;
      } else {
        pendingHitRef.current = { object: rawObject, count: 1 };
      }
      if (pendingHitRef.current.count >= HOVER_CONFIRM_FRAMES) {
        stableHitRef.current = { hit: rawEnterHit, time: now };
        pendingHitRef.current = { object: null, count: 0 };
      }
      // Otherwise keep showing the current stable hit (if any) - it's
      // still fresh since we only got here because the cursor is still.
    } else {
      pendingHitRef.current = { object: null, count: 0 };
      if (stable && now - stable.time > HOVER_HOLD_MS) {
        stableHitRef.current = null;
      }
    }
    const enterHit = stableHitRef.current?.hit ?? null;

    // Resolve before publishing the tooltip so blocked landings are visible.
    if (enterHit) {
      frameCountRef.current++;
      const changed = lastHitObjectRef.current !== enterHit.hitObject;
      lastHitObjectRef.current = enterHit.hitObject;
      if (!destinationRef.current || changed || frameCountRef.current % 6 === 0) {
        destinationRef.current = resolvePreviewDestination(scene, camera, enterHit);
      }
    } else {
      destinationRef.current = null;
    }
    // The snapIndicator tooltip is a plain React-rendered <Html> overlay
    // shared with other tools, so it still needs real state - and a state
    // update here re-renders this whole (very large) component, so it must
    // only happen when the result would actually look different: the
    // tooltip text changed, it appeared/disappeared, or the point moved far
    // enough to be worth repositioning (rate-limited on top of that). A
    // cursor sitting still now costs zero re-renders, where the previous
    // unconditional ~12/sec heartbeat kept reconciling the entire scene
    // tree for an identical result.
    const sync = hoverSyncRef.current;
    // Classify off the STABILIZED hit's own normal, not the raw `isFloor`
    // computed above - `enterHit` can be a held-over hit from a previous
    // frame (grace period or unconfirmed switch), and pairing it with this
    // frame's raw classification could label it wrong for one frame.
    const tooltip = enterHit ? (destinationRef.current?.obstructed ? 'Destination blocked' : (isFloorSurface(enterHit.worldNormal) ? 'Click to Walk Here' : 'Click to Walk Through')) : null;
    const pointMoved = !!enterHit && (!sync.point || sync.point.distanceToSquared(enterHit.worldPoint) > 1e-4);
    if (tooltip !== sync.tooltip || (pointMoved && now - sync.time > 80)) {
      sync.tooltip = tooltip;
      sync.time = now;
      sync.point = enterHit ? enterHit.worldPoint.clone() : null;
      setHoverTooltip(enterHit && tooltip ? { point: [enterHit.worldPoint.x, enterHit.worldPoint.y, enterHit.worldPoint.z], text: tooltip } : null);
    }

    if (!enterHit) {
      // No valid hover target right now - hide the indicator without
      // tearing down the render target/camera, so a momentary raycast gap
      // just blinks the marker off for a frame instead of flickering the
      // whole preview pipeline.
      disc.visible = false;
      ring.visible = false;
      return;
    }
    disc.visible = true;
    ring.visible = true;

    const hp = enterHit.worldPoint;
    const dest = destinationRef.current!;
    displayedPointerRef.current.copy(pointer);
    displayedAtRef.current = now;

    portalCam.position.copy(dest.eye);
    portalCam.quaternion.copy(dest.quaternion);
    portalCam.fov = dest.fov;
    portalCam.near = dest.near;
    portalCam.updateProjectionMatrix();

    // Scale so the portal reads at a consistent size regardless of how
    // close or far the hovered point is, and pull it toward the current
    // camera (rather than a fixed world-axis offset, which only avoids
    // z-fighting on a flat floor and re-introduces it on any wall/roof
    // face) so it never fights the actual surface for the same pixels.
    const camDist = camera.position.distanceTo(hp);
    const radius = THREE.MathUtils.clamp(camDist * 0.12, 0.5, 2.5);
    const towardCamera = camera.position.clone().sub(hp).normalize();
    const discPos = hp.clone().addScaledVector(towardCamera, Math.max(0.03, camDist * 0.01));

    disc.position.copy(discPos);
    disc.scale.setScalar(radius);
    disc.lookAt(camera.position);
    ring.position.copy(discPos);
    ring.scale.setScalar(radius);
    ring.quaternion.copy(disc.quaternion);

    // Rendering a whole second pass of the scene while this app's own
    // ambient-occlusion/fog EffectComposer is active has proven unreliable
    // (the composer manages its own render targets/clear state, and a raw
    // manual gl.render() competing with that is a known-fragile
    // combination) - skip the live look-through content in that case and
    // just show the plain indicator ring/disc instead, rather than risk
    // more flicker.
    if (postprocessingActive) return;

    // Re-rendering the whole scene from a second camera is by far the most
    // expensive thing this component does, so it only happens when the
    // rendered result would actually differ: when the destination pose or
    // framing changed (i.e. the cursor moved somewhere new), or on a slow
    // heartbeat to pick up scene edits. A stationary cursor produces an
    // identical image every time, so re-rendering it on a blind
    // every-other-frame cadence - as this used to - was pure waste, and
    // that wasted whole-scene pass (plus the shadow maps below) is what
    // left the renderer struggling to keep up while the cursor moved.
    const lastPose = lastPortalPoseRef.current;
    const poseChanged =
      !lastPose ||
      lastPose.position.distanceToSquared(portalCam.position) > 1e-8 ||
      lastPose.quaternion.angleTo(portalCam.quaternion) > 1e-4 ||
      Math.abs(lastPose.fov - portalCam.fov) > 1e-3;
    if (!poseChanged && now - lastPortalRenderRef.current < 500) return;
    if (!lastPortalPoseRef.current) {
      lastPortalPoseRef.current = { position: portalCam.position.clone(), quaternion: portalCam.quaternion.clone(), fov: portalCam.fov };
    } else {
      lastPortalPoseRef.current.position.copy(portalCam.position);
      lastPortalPoseRef.current.quaternion.copy(portalCam.quaternion);
      lastPortalPoseRef.current.fov = portalCam.fov;
    }
    lastPortalRenderRef.current = now;

    const prevRenderTarget = gl.getRenderTarget();
    const prevAutoClear = gl.autoClear;
    const prevViewport = gl.getViewport(new THREE.Vector4());
    const prevShadowAutoUpdate = gl.shadowMap.autoUpdate;
    const prevClearAlpha = gl.getClearAlpha();
    // The disc's material is blended (see its own comment), so anything the
    // portal camera doesn't cover - open sky past the geometry - would show
    // the scene behind the disc through it unless the target is cleared
    // opaque.
    gl.setClearAlpha(1);
    // Shadow maps are rendered from each LIGHT's own camera, so the ones
    // the main pass already produced are equally valid for this off-screen
    // pass - letting gl.render() rebuild them all over again just doubled
    // the shadow cost of every frame this runs on, for an identical result.
    gl.shadowMap.autoUpdate = false;
    // Explicitly clear rather than relying on autoClear, which some
    // postprocessing setups in this app turn off globally - otherwise the
    // previous contents smear through.
    gl.autoClear = true;
    // NOTE: no setViewport() here on purpose. setRenderTarget() already
    // sets the viewport to the target's own size, whereas setViewport()
    // takes CSS pixels and re-applies the renderer's pixel ratio on top -
    // so explicitly setting it to the target's pixel dimensions rendered a
    // cropped, zoomed view on any HiDPI display. It also left
    // getViewport() reporting the target's size, which drei's <Edges>
    // (fat lines) read in LineSegments2.onBeforeRender to set their
    // `resolution` uniform - so every edge material the portal camera
    // could see had its resolution clobbered by this pass.
    try {
      gl.setRenderTarget(renderTarget);
      gl.clear();
      gl.render(scene, portalCam);
    } finally {
      gl.setRenderTarget(prevRenderTarget);
      gl.setViewport(prevViewport);
      gl.autoClear = prevAutoClear;
      gl.shadowMap.autoUpdate = prevShadowAutoUpdate;
      gl.setClearAlpha(prevClearAlpha);
    }
  });

  return (
    <group>
      {/* `transparent` and `depthWrite={false}` are both load-bearing here,
          and together they are what actually stops the preview flickering.
          These two meshes are pure overlays meant to sit on top of
          everything, but as plain OPAQUE materials they landed in the
          opaque pass, which three.js draws in full before ANY transparent
          object - so this app's translucent walls (and the black edge lines
          drawn with them) were always drawn afterwards, on top of the
          portal. What kept that from being merely wrong-looking is that a
          material which skips the depth TEST still WRITES depth by default:
          the disc stamped its own camera-facing depth across the whole
          circle, so those later wall fragments were depth-rejected wherever
          the stamp happened to land nearer than the wall. The disc is a flat
          plane pushed just off a surface it is rarely parallel to, so which
          side wins varies across the circle AND changes as the cursor moves
          - the wall and its edges winking in and out per pixel, per frame,
          only while the cursor moved. Marking them transparent puts them at
          the end of the transparent pass instead (renderOrder 999 sorts them
          last), so they draw over everything exactly once, and not writing
          depth means they never affect anything drawn after them. Opacity
          stays 1, so the disc still reads as solid. */}
      <mesh ref={discRef} renderOrder={999} visible={false}>
        <circleGeometry args={[1, 48]} />
        {postprocessingActive ? (
          <meshBasicMaterial color="#0063A3" transparent opacity={0.25} toneMapped={false} depthTest={false} depthWrite={false} />
        ) : (
          <meshBasicMaterial map={renderTarget.texture} transparent toneMapped={false} depthTest={false} depthWrite={false} />
        )}
      </mesh>
      <mesh ref={ringRef} renderOrder={1000} visible={false} material={ringMaterial}>
        <ringGeometry args={[RING_INNER, RING_OUTER, 128, 1]} />
      </mesh>
      {hoverTooltip && (
        <Html position={hoverTooltip.point} center occlude={false} zIndexRange={[50, 60]} style={{ pointerEvents: 'none' }}>
          <div className="flex flex-col items-center gap-1 pointer-events-none -translate-y-4">
            <div className="w-2.5 h-2.5 rounded-full bg-fuchsia-400 border border-fuchsia-600 ring-2 ring-fuchsia-200 shadow-lg" />
            <div className="bg-black/80 text-white text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded whitespace-nowrap shadow border border-white/20">
              {hoverTooltip.text}
            </div>
          </div>
        </Html>
      )}
    </group>
  );
}

// Portal Navigation's floor support needs to work even when there's no
// authored floor/slab Shape under the cursor - many scenes (especially
// early-stage or purely exterior ones) stand on the app's generic ground
// plane rather than a modeled floor. When no real isShape hit exists along
// the ray at all, fall back to the mathematical y=0 ground plane, exactly
// like the app's other ground-level tools already do for their own
// fallbacks (see the door/window placement handlers elsewhere in this
// file), and treat it as an upward-facing floor.
//
// This is only a legitimate stand-in for the app's actual, visible ground
// plane (the `floorEnabled` mesh, a 100x100 square centered on the
// origin) - it must not fire when that ground isn't even turned on, or
// for a shallow/grazing ray whose mathematical y=0 crossing lands far
// outside that square (e.g. clicking toward the horizon/sky with nothing
// underneath), or it will "successfully" resolve a destination that has
// nothing actually rendered there - a real, if less common, way to still
// end up teleported into empty 3D space.
const GROUND_PLANE_FALLBACK_HALF_EXTENT = 50; // matches the floorEnabled mesh's 100x100 footprint

function resolveGroundPlaneFloorHit(raycaster: THREE.Raycaster, scene: THREE.Scene, floorEnabled: boolean): ResolvedSurfaceHit | null {
  if (!floorEnabled) return null;
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const point = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(ground, point)) return null;
  if (Math.abs(point.x) > GROUND_PLANE_FALLBACK_HALF_EXTENT || Math.abs(point.z) > GROUND_PLANE_FALLBACK_HALF_EXTENT) return null;
  return {
    worldPoint: point,
    worldNormal: new THREE.Vector3(0, 1, 0),
    hitObject: scene,
    isBackface: false,
  };
}
