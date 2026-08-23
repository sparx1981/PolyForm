import React, { useState, useRef, useEffect, useMemo, useCallback, Suspense } from 'react';
import { Canvas, useThree, ThreeEvent, useFrame } from '@react-three/fiber';
import { 
  useHelper, 
  Html, 
  RoundedBox, 
  useTexture, 
  Line, 
  Edges,
  PerspectiveCamera, 
  OrbitControls, 
  Grid, 
  TransformControls, 
  ContactShadows, 
  Environment 
} from '@react-three/drei';
import { EffectComposer, SSAO } from '@react-three/postprocessing';
import { Effect, EffectAttribute } from 'postprocessing';
import * as THREE from 'three';
import { SUBTRACTION, Evaluator, Brush } from 'three-bvh-csg';
import { doc, updateDoc } from 'firebase/firestore';
import { db, isQuotaLocked, handleFirestoreError, OperationType } from '../firebase';
// @ts-ignore
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib';
// @ts-ignore
import { RectAreaLightHelper } from 'three/examples/jsm/helpers/RectAreaLightHelper';
// @ts-ignore
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter';
// @ts-ignore
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter'; import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils';
import { 
  createWallGeometry, 
  createWallWithOpeningsGeometry,
  WallOpening,
  createDoorGeometry, 
  createWindowGeometry, 
  createStepGeometry, 
  createStaircaseGeometry 
} from '../lib/archGeometry';
import {
  createTreeGeometry,
  createBushGeometry,
  createFenceGeometry,
  createRailingGeometry,
  createLampGeometry,
  createBenchGeometry,
  createRockGeometry
} from '../lib/landscapeGeometry';
import { PLANT_SPECIES_CATALOG } from '../lib/plantLibrary';
import { PlantModelMesh } from './PlantModelMesh';
import { useApp } from '../AppContext';
import { Shape, CustomLight, SceneNote, SceneState, SceneAnimation, isTextureUrl } from '../types';
import { getLandscapeCanvas, LANDSCAPE_TEXTURES } from '../lib/landscapeTextures';
import { cn, formatValue, safelyToDate } from '../lib/utils';
import { Effects } from './Effects';
import { ChevronRight, ChevronDown, X, CheckCircle2, StickyNote, Palette, Layers } from 'lucide-react';
import StyleLibraryModal from './StyleLibraryModal';
import { KernelGeometry } from './KernelGeometry';
import { useLineBinding } from '../tools/lineToolBinding';

// Module-level texture cache: avoids re-creating (and re-downloading) a THREE.Texture
// on every render when a material/light uses an image URL as its map. Previously each
// inline "new THREE.TextureLoader().load(url)" call ran on every React re-render, which
// could recreate the texture before the previous one finished loading - the likely cause
// of uploaded/URL textures failing to display or flickering on a surface.
// Stable portal target + zIndexRange for the New Note overlay (drei <Html>).
// Passing fresh object/array literals as props (e.g. portal={{ current: document.body }} or
// zIndexRange={[1000, 2000]}) creates a new reference every render. Because typing in the note
// textarea updates React state -> re-renders Viewport -> creates new literals -> drei's <Html>
// tears down and remounts its portaled DOM node every keystroke. Fast typing then only keeps the
// last character, since prior keystrokes land on a node that's about to be discarded. Using
// stable, module-level references fixes it.
const _polyformBodyPortalRef: { current: HTMLElement | null } = { current: typeof document !== 'undefined' ? document.body : null };
const _polyformNoteZIndexRange: [number, number] = [1000, 2000];
const _polyformTextureCache = new Map<string, THREE.Texture>();
const _polyformTextureLoader = new THREE.TextureLoader();
_polyformTextureLoader.setCrossOrigin('anonymous');

function createFallbackTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillRect(32, 32, 32, 32);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

function getCachedTexture(url: string): THREE.Texture {
  if (!url) return createFallbackTexture();
  let tex = _polyformTextureCache.get(url);
  if (tex) {
    if (tex.wrapS !== THREE.RepeatWrapping || tex.wrapT !== THREE.RepeatWrapping) {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.needsUpdate = true;
    }
    return tex;
  }

  // 1. Direct canvas lookup for landscape presets or generated canvases
  const knownCanvas = getLandscapeCanvas(url);
  if (knownCanvas) {
    const canvasTex = new THREE.CanvasTexture(knownCanvas);
    canvasTex.wrapS = THREE.RepeatWrapping;
    canvasTex.wrapT = THREE.RepeatWrapping;
    canvasTex.colorSpace = THREE.SRGBColorSpace;
    canvasTex.generateMipmaps = true;
    canvasTex.needsUpdate = true;
    _polyformTextureCache.set(url, canvasTex);
    return canvasTex;
  }

  // 2. Direct preset check by ID
  const preset = LANDSCAPE_TEXTURES.find(t => t.id === url);
  if (preset) {
    const dataUrl = preset.generate();
    const genCanvas = getLandscapeCanvas(preset.id);
    if (genCanvas) {
      const canvasTex = new THREE.CanvasTexture(genCanvas);
      canvasTex.wrapS = THREE.RepeatWrapping;
      canvasTex.wrapT = THREE.RepeatWrapping;
      canvasTex.colorSpace = THREE.SRGBColorSpace;
      canvasTex.generateMipmaps = true;
      canvasTex.needsUpdate = true;
      _polyformTextureCache.set(url, canvasTex);
      _polyformTextureCache.set(dataUrl, canvasTex);
      return canvasTex;
    }
  }

  // 3. Direct Image Element loading for data: and blob: URLs to bypass CORS/iframe restrictions
  if (url.startsWith('data:image') || url.startsWith('blob:')) {
    const liveCanvas = document.createElement('canvas');
    liveCanvas.width = 512;
    liveCanvas.height = 512;
    const ctx = liveCanvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#3a6644';
      ctx.fillRect(0, 0, 512, 512);
    }
    const canvasTex = new THREE.CanvasTexture(liveCanvas);
    canvasTex.wrapS = THREE.RepeatWrapping;
    canvasTex.wrapT = THREE.RepeatWrapping;
    canvasTex.colorSpace = THREE.SRGBColorSpace;
    canvasTex.generateMipmaps = true;
    canvasTex.needsUpdate = true;
    _polyformTextureCache.set(url, canvasTex);

    const img = new Image();
    img.onload = () => {
      if (ctx) {
        liveCanvas.width = img.naturalWidth || 512;
        liveCanvas.height = img.naturalHeight || 512;
        ctx.drawImage(img, 0, 0);
      }
      canvasTex.needsUpdate = true;
      window.dispatchEvent(new CustomEvent('polyform-texture-loaded', { detail: { url } }));
    };
    img.onerror = (err) => {
      console.warn('[PolyForm] Error decoding procedural data URL texture:', err);
    };
    img.src = url;
    if (img.complete && img.naturalWidth > 0) {
      if (ctx) {
        liveCanvas.width = img.naturalWidth;
        liveCanvas.height = img.naturalHeight;
        ctx.drawImage(img, 0, 0);
      }
      canvasTex.needsUpdate = true;
    }
    return canvasTex;
  }

  // 4. External HTTP/HTTPS URLs with crossOrigin support and fallback
  tex = _polyformTextureLoader.load(
    url,
    (loaded) => {
      loaded.wrapS = THREE.RepeatWrapping;
      loaded.wrapT = THREE.RepeatWrapping;
      loaded.colorSpace = THREE.SRGBColorSpace;
      loaded.generateMipmaps = true;
      loaded.needsUpdate = true;
      window.dispatchEvent(new CustomEvent('polyform-texture-loaded', { detail: { url } }));
    },
    undefined,
    (err) => {
      console.warn('[PolyForm] Texture URL unreachable or expired, applying fallback texture:', typeof url === 'string' ? url.slice(0, 100) : url, err);
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#f1f5f9';
        ctx.fillRect(0, 0, 64, 64);
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(0, 0, 32, 32);
        ctx.fillRect(32, 32, 32, 32);
      }
      if (tex) {
        tex.image = canvas;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.generateMipmaps = true;
        tex.needsUpdate = true;
      }
    }
  );
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  _polyformTextureCache.set(url, tex);
  return tex;
}

const fogFragmentShader = `
  uniform vec3 color1;
  uniform vec3 color2;
  uniform vec3 color3;
  uniform float density;
  uniform float height;
  uniform float heightEnd;
  uniform float time;
  uniform float speed;
  uniform int colorCount;
  uniform int fogType; // 0: standard, 1: super-mega
  uniform mat4 projectionMatrixInverse;
  uniform mat4 viewMatrixInverse;

  // Noise functions for volumetric effect
  float hash(float n) { return fract(sin(n) * 43758.5453123); }
  float noise(vec3 x) {
    vec3 p = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    float n = p.x + p.y * 57.0 + 113.0 * p.z;
    return mix(mix(mix(hash(n + 0.0), hash(n + 1.0), f.x),
                   mix(hash(n + 57.0), hash(n + 58.0), f.x), f.y),
               mix(mix(hash(n + 113.0), hash(n + 114.0), f.x),
                   mix(hash(n + 170.0), hash(n + 171.0), f.x), f.y), f.z);
  }

  float fbm(vec3 p) {
    float f = 0.0;
    f += 0.5000 * noise(p); p = p * 2.02;
    f += 0.2500 * noise(p); p = p * 2.03;
    f += 0.1250 * noise(p); p = p * 2.01;
    f += 0.0625 * noise(p);
    return f;
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    float depth = readDepth(uv);
    
    // Reconstruct world position
    float z = depth * 2.0 - 1.0;
    vec4 clipSpacePosition = vec4(uv * 2.0 - 1.0, z, 1.0);
    vec4 viewSpacePosition = projectionMatrixInverse * clipSpacePosition;
    viewSpacePosition /= viewSpacePosition.w;
    vec4 worldSpacePosition = viewMatrixInverse * viewSpacePosition;
    vec3 worldPos = worldSpacePosition.xyz;
    vec3 cameraPos = viewMatrixInverse[3].xyz;
    vec3 rayDir = normalize(worldPos - cameraPos);
    float dist = length(worldPos - cameraPos);

    if (fogType == 1) { // Super Mega Volumetric Fog
      float totalDensity = 0.0;
      int steps = 16;
      float stepSize = min(dist, 50.0) / float(steps);
      vec3 p = cameraPos;
      
      for (int i = 0; i < 16; i++) {
        float h = p.y;
        float hFactor = clamp(1.0 - (h - height) / max(0.01, heightEnd - height), 0.0, 1.0);
        
        if (hFactor > 0.0) {
          float n = fbm(p * 0.1 + time * speed * 0.01);
          totalDensity += n * hFactor * density * stepSize;
        }
        p += rayDir * stepSize;
        if (length(p - cameraPos) > dist) break;
      }
      
      float fogFactor = exp(-totalDensity);
      outputColor = vec4(mix(color1, inputColor.rgb, fogFactor), inputColor.a);
      return;
    }

    // Standard Fog (existing logic)
    if (depth >= 1.0) {
      outputColor = inputColor;
      return;
    }

    // Height based falloff
    float heightRange = max(0.01, heightEnd - height);
    float heightFactor = clamp(1.0 - (worldPos.y - height) / heightRange, 0.0, 1.0);
    
    // Animation
    float noiseVal = sin(worldPos.x * 0.05 + time * speed * 0.05) * cos(worldPos.z * 0.05 + time * speed * 0.05) * 0.3;
    float fogFactor = exp2(-density * density * dist * dist * 1.442695);
    
    // Apply height factor to fog factor
    fogFactor = mix(1.0, fogFactor, heightFactor);
    
    // Add noise for animation
    fogFactor = clamp(fogFactor + noiseVal * (1.0 - fogFactor) * heightFactor, 0.0, 1.0);
    
    vec3 fogColor;
    if (colorCount == 2) {
      float mixFactor = clamp((worldPos.y - height) / heightRange, 0.0, 1.0);
      fogColor = mix(color1, color2, mixFactor);
    } else {
      float mixFactor = clamp((worldPos.y - height) / heightRange, 0.0, 1.0);
      if (mixFactor < 0.5) {
        fogColor = mix(color1, color2, mixFactor * 2.0);
      } else {
        fogColor = mix(color2, color3, (mixFactor - 0.5) * 2.0);
      }
    }

    outputColor = vec4(mix(fogColor, inputColor.rgb, fogFactor), inputColor.a);
  }
`;

RectAreaLightUniformsLib.init();

class FogEffectImpl extends Effect {
  camera: THREE.Camera;

  constructor({ color1, color2, color3, density, height, heightEnd, speed, colorCount, fogType, camera }: any) {
    super('FogEffect', fogFragmentShader, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map([
        ['color1', new THREE.Uniform(new THREE.Color(color1))],
        ['color2', new THREE.Uniform(new THREE.Color(color2))],
        ['color3', new THREE.Uniform(new THREE.Color(color3))],
        ['density', new THREE.Uniform(density)],
        ['height', new THREE.Uniform(height)],
        ['heightEnd', new THREE.Uniform(heightEnd)],
        ['time', new THREE.Uniform(0)],
        ['speed', new THREE.Uniform(speed)],
        ['colorCount', new THREE.Uniform(colorCount)],
        ['fogType', new THREE.Uniform(fogType)],
        ['projectionMatrixInverse', new THREE.Uniform(new THREE.Matrix4().copy(camera.projectionMatrixInverse))],
        ['viewMatrixInverse', new THREE.Uniform(new THREE.Matrix4().copy(camera.matrixWorld))]
      ])
    });
    this.camera = camera;
  }

  update(renderer: any, inputBuffer: any, deltaTime: any) {
    if (this.uniforms.get('speed')!.value > 0) {
      this.uniforms.get('time')!.value += deltaTime;
    }
    this.uniforms.get('projectionMatrixInverse')!.value.copy(this.camera.projectionMatrixInverse);
    this.uniforms.get('viewMatrixInverse')!.value.copy(this.camera.matrixWorld);
  }
}

const FogEffect = React.forwardRef(({ settings, camera }: any, ref) => {
  const effect = useMemo(() => new FogEffectImpl({
    color1: settings?.colors?.[0] || '#ffffff',
    color2: settings?.colors?.[1] || '#ffffff',
    color3: settings?.colors?.[2] || '#ffffff',
    density: settings.type === 'super-mega' ? settings.superMegaDensity : settings.density,
    height: settings.height,
    heightEnd: settings.heightEnd,
    speed: settings.animate ? settings.speed : 0,
    colorCount: settings.colorCount,
    fogType: settings.type === 'super-mega' ? 1 : 0,
    camera
  }), [settings, camera]);
  
  return <primitive ref={ref} object={effect} dispose={null} />;
});

function Fog() {
  const { fogSettings } = useApp();
  const { scene } = useThree();

  useEffect(() => {
    if (fogSettings.enabled) {
      // We use the custom post-processing effect for both types now
      // but we still set a basic scene fog for objects that might not be in the composer
      scene.fog = new THREE.FogExp2(
        fogSettings?.colors?.[0] || '#ffffff', 
        fogSettings.type === 'super-mega' ? fogSettings.superMegaDensity : fogSettings.density
      );
    } else {
      scene.fog = null;
    }
  }, [fogSettings, scene]);

  return null;
}

const COLORS = [
  '#ffffff', '#ef4444', '#f97316', '#f59e0b', 
  '#eab308', '#84cc16', '#22c55e', '#10b981',
  '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6',
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
  '#ec4899', '#f43f5e', '#71717a', '#18181b'
];

const getGridDimensions = (division: number | [number, number] | undefined): [number, number] => {
  if (division === undefined) return [1, 1];
  if (Array.isArray(division)) return division;
  return [division, division];
};

const closestDivisionFit = (frac: number): number | null => {
  for (let n = 2; n <= 10; n++) {
    for (let k = 1; k < n; k++) {
      if (Math.abs(frac - k / n) < 0.02) return n;
    }
  }
  return null;
};

const tryAutoDivideOnLineCrossing = (p1: THREE.Vector3, p2: THREE.Vector3, worldNormal: THREE.Vector3, allShapes: Shape[]): { shapeId: string; faceIdx: number; gridX: number; gridY: number } | null => {
  const AXES: [THREE.Vector3, number][] = [
    [new THREE.Vector3(1, 0, 0), 0], [new THREE.Vector3(-1, 0, 0), 2],
    [new THREE.Vector3(0, 1, 0), 4], [new THREE.Vector3(0, -1, 0), 6],
    [new THREE.Vector3(0, 0, 1), 8], [new THREE.Vector3(0, 0, -1), 10],
  ];
  const EPS_PLANE = 0.06, EPS_EDGE = 0.06, EPS_ALIGN = 0.06;
  for (const s of allShapes) {
    if (s.type !== 'box') continue;
    const boxArgs = Array.isArray(s.args) ? s.args as number[] : [1, 1, 1];
    const [W, H, D] = boxArgs;
    const qArr = (s as any).quaternion || [0, 0, 0, 1];
    const quat = new THREE.Quaternion(qArr[0], qArr[1], qArr[2], qArr[3]);
    const invQuat = quat.clone().invert();
    const origin = new THREE.Vector3(s.position[0], s.position[1], s.position[2]);
    for (const [axis, faceKey] of AXES) {
      const worldFaceNormal = axis.clone().applyQuaternion(quat);
      if (worldFaceNormal.dot(worldNormal) < 0.98) continue;
      const l1 = p1.clone().sub(origin).applyQuaternion(invQuat);
      const l2 = p2.clone().sub(origin).applyQuaternion(invQuat);
      let u1: number, v1: number, u2: number, v2: number, halfU: number, halfV: number, depth1: number, depth2: number, halfDepth: number;
      if (faceKey === 0 || faceKey === 2) {
        u1 = l1.z; v1 = l1.y; u2 = l2.z; v2 = l2.y; halfU = D / 2; halfV = H / 2; depth1 = l1.x; depth2 = l2.x; halfDepth = W / 2;
      } else if (faceKey === 4 || faceKey === 6) {
        u1 = l1.x; v1 = l1.z; u2 = l2.x; v2 = l2.z; halfU = W / 2; halfV = D / 2; depth1 = l1.y; depth2 = l2.y; halfDepth = H / 2;
      } else {
        u1 = l1.x; v1 = l1.y; u2 = l2.x; v2 = l2.y; halfU = W / 2; halfV = H / 2; depth1 = l1.z; depth2 = l2.z; halfDepth = D / 2;
      }
      const sign = (faceKey === 0 || faceKey === 4 || faceKey === 8) ? 1 : -1;
      if (Math.abs(depth1 - sign * halfDepth) > EPS_PLANE) continue;
      if (Math.abs(depth2 - sign * halfDepth) > EPS_PLANE) continue;
      if (Math.abs(u1) > halfU + EPS_EDGE || Math.abs(v1) > halfV + EPS_EDGE) continue;
      if (Math.abs(u2) > halfU + EPS_EDGE || Math.abs(v2) > halfV + EPS_EDGE) continue;
      const onBoundary = (u: number, v: number) => Math.abs(Math.abs(u) - halfU) < EPS_EDGE || Math.abs(Math.abs(v) - halfV) < EPS_EDGE;
      if (!onBoundary(u1, v1) || !onBoundary(u2, v2)) continue;

      let gridX: number | null = null;
      let gridY: number | null = null;
      if (Math.abs(u1 - u2) < EPS_ALIGN && Math.abs(v1 - v2) > halfV) {
        const frac = ((u1 + u2) / 2 + halfU) / (2 * halfU);
        gridX = closestDivisionFit(frac);
      } else if (Math.abs(v1 - v2) < EPS_ALIGN && Math.abs(u1 - u2) > halfU) {
        const frac = ((v1 + v2) / 2 + halfV) / (2 * halfV);
        gridY = closestDivisionFit(frac);
      } else {
        continue;
      }
      if (gridX === null && gridY === null) continue;

      const existing = s.surfaceDivisions?.[faceKey];
      const [curGX, curGY] = getGridDimensions(existing);
      if (gridX !== null && curGX > 1) continue;
      if (gridY !== null && curGY > 1) continue;
      const finalGX = gridX !== null ? gridX : curGX;
      const finalGY = gridY !== null ? gridY : curGY;
      if (finalGX === curGX && finalGY === curGY) continue;
      return { shapeId: s.id, faceIdx: faceKey, gridX: finalGX, gridY: finalGY };
    }
  }
  return null;
};

// Poly tool helpers
const computeArcPoints = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, segments: number = 32): THREE.Vector3[] | null => {
  const a = p1.clone().sub(p0);
  const b = p2.clone().sub(p0);
  const axb = a.clone().cross(b);
  const axbLenSq = axb.lengthSq();
  if (axbLenSq < 1e-8) return null;
  const aLenSq = a.lengthSq();
  const bLenSq = b.lengthSq();
  const term1 = axb.clone().cross(a).multiplyScalar(bLenSq);
  const term2 = b.clone().cross(axb).multiplyScalar(aLenSq);
  const center = p0.clone().add(term1.add(term2).multiplyScalar(1 / (2 * axbLenSq)));
  const radius = center.distanceTo(p0);
  if (radius < 1e-6) return null;
  const u = p0.clone().sub(center).normalize();
  const w = axb.clone().normalize();
  const v = w.clone().cross(u).normalize();
  const angleOf = (p: THREE.Vector3) => {
    const vec = p.clone().sub(center);
    return Math.atan2(vec.dot(v), vec.dot(u));
  };
  const normalizeAngle = (ang: number) => {
    let a2 = ang % (Math.PI * 2);
    if (a2 < 0) a2 += Math.PI * 2;
    return a2;
  };
  const a1n = normalizeAngle(angleOf(p1));
  const a2n = normalizeAngle(angleOf(p2));
  let sweep = a1n;
  if (!(a2n > 0 && a2n < a1n)) {
    sweep = a1n - Math.PI * 2;
  }
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * sweep;
    pts.push(center.clone().add(u.clone().multiplyScalar(radius * Math.cos(t))).add(v.clone().multiplyScalar(radius * Math.sin(t))));
  }
  return pts;
};

type Pt2 = { x: number; y: number };

function pointInPolygon2D(pt: Pt2, poly: Pt2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
      (pt.x < (xj - xi) * (pt.y - yi) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function distanceToPolygonEdges2D(pt: Pt2, poly: Pt2[]): number {
  let min = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const abx = b.x - a.x, aby = b.y - a.y;
    const lenSq = (abx * abx + aby * aby) || 1;
    let t = ((pt.x - a.x) * abx + (pt.y - a.y) * aby) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + t * abx, cy = a.y + t * aby;
    const d = Math.hypot(pt.x - cx, pt.y - cy);
    if (d < min) min = d;
  }
  return min;
}

function lineIntersect2D(a1: Pt2, a2: Pt2, b1: Pt2, b2: Pt2): Pt2 | null {
  const d1x = a2.x - a1.x, d1y = a2.y - a1.y;
  const d2x = b2.x - b1.x, d2y = b2.y - b1.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / denom;
  return { x: a1.x + t * d1x, y: a1.y + t * d1y };
}

// Offsets a closed 2D polygon outward (positive distance) or inward (negative distance)
// by shifting each edge along its normal and re-intersecting adjacent edges (miter join).
function computeOffsetPolygon(points: Pt2[], distance: number): Pt2[] {
  const n = points.length;
  if (n < 3 || distance === 0) return points;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const p1 = points[i], p2 = points[(i + 1) % n];
    area += p1.x * p2.y - p2.x * p1.y;
  }
  const sign = area >= 0 ? 1 : -1;
  const edges: { p1: Pt2; p2: Pt2 }[] = [];
  for (let i = 0; i < n; i++) {
    const p1 = points[i], p2 = points[(i + 1) % n];
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const nx = sign * uy, ny = sign * -ux;
    edges.push({
      p1: { x: p1.x + nx * distance, y: p1.y + ny * distance },
      p2: { x: p2.x + nx * distance, y: p2.y + ny * distance },
    });
  }
  const result: Pt2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = edges[(i - 1 + n) % n];
    const curr = edges[i];
    const ip = lineIntersect2D(prev.p1, prev.p2, curr.p1, curr.p2);
    result.push(ip || curr.p1);
  }
  return result;
}

const checkSelfIntersection = (points: THREE.Vector2[]): boolean => {
  const n = points.length;
  if (n < 4) return false;
  
  const intersect = (p1: THREE.Vector2, p2: THREE.Vector2, p3: THREE.Vector2, p4: THREE.Vector2) => {
    const denominator = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
    if (denominator === 0) return false;
    let ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / denominator;
    let ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / denominator;
    return (ua >= 0 && ua <= 1) && (ub >= 0 && ub <= 1);
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (intersect(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n])) return true;
    }
  }
  return false;
};

const projectToPlane = (vertices: THREE.Vector3[], origin: THREE.Vector3, normal: THREE.Vector3): THREE.Vector2[] => {
  const up = new THREE.Vector3(0, 1, 0);
  if (Math.abs(normal.dot(up)) > 0.99) up.set(0, 0, 1);
  const tangent = new THREE.Vector3().crossVectors(normal, up).normalize();
  const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
  
  return vertices.map(v => {
    const diff = v.clone().sub(origin);
    return new THREE.Vector2(diff.dot(tangent), diff.dot(bitangent));
  });
};

const CAMERA_VIEWS: Record<string, { pos: [number, number, number], target: [number, number, number] }> = {
  perspective: { pos: [5, 5, 5], target: [0, 0, 0] },
  plan: { pos: [0, 10, 0], target: [0, 0, 0] },
  front: { pos: [0, 0, 10], target: [0, 0, 0] },
  rear: { pos: [0, 0, -10], target: [0, 0, 0] },
  left: { pos: [-10, 0, 0], target: [0, 0, 0] },
  right: { pos: [10, 0, 0], target: [0, 0, 0] }
};


function getOffsetFaceBasis(faceKey: number): { normal: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3 } {
  switch (faceKey) {
    case 0: return { normal: new THREE.Vector3(1, 0, 0), u: new THREE.Vector3(0, 1, 0), v: new THREE.Vector3(0, 0, 1) };
    case 2: return { normal: new THREE.Vector3(-1, 0, 0), u: new THREE.Vector3(0, 0, 1), v: new THREE.Vector3(0, 1, 0) };
    case 4: return { normal: new THREE.Vector3(0, 1, 0), u: new THREE.Vector3(0, 0, 1), v: new THREE.Vector3(1, 0, 0) };
    case 6: return { normal: new THREE.Vector3(0, -1, 0), u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 0, 1) }; 
    case 8: return { normal: new THREE.Vector3(0, 0, 1), u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 1, 0) };
    case 10: return { normal: new THREE.Vector3(0, 0, -1), u: new THREE.Vector3(0, 1, 0), v: new THREE.Vector3(1, 0, 0) };
    default: return { normal: new THREE.Vector3(0, 1, 0), u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 0, 1) };
  }
}
function boxHalfExtentAlongAxis(axis: THREE.Vector3, args: number[]): number {
  const hw = (args[0] || 1) / 2, hh = (args[1] || 1) / 2, hd = (args[2] || 1) / 2;
  if (Math.abs(axis.x) > 0.5) return hw;
  if (Math.abs(axis.y) > 0.5) return hh;
  return hd;
}
function getOffsetSourcePoly2D(srcShape: Shape, faceKey: number): { poly2D: Pt2[]; normalLocal: THREE.Vector3; uLocal: THREE.Vector3; vLocal: THREE.Vector3; faceOriginLocal: THREE.Vector3 } {
  const isBoxLike = srcShape.type === 'box' || srcShape.type === 'rect';
  const isDisc = srcShape.type === 'circle' || srcShape.type === 'triangle' || srcShape.type === 'prism';
  if (isBoxLike) {
    const args = Array.isArray((srcShape as any).args) ? (srcShape as any).args as number[] : [1, 1, 1];
    const { normal, u, v } = getOffsetFaceBasis(faceKey);
    const halfU = boxHalfExtentAlongAxis(u, args);
    const halfV = boxHalfExtentAlongAxis(v, args);
    const halfN = boxHalfExtentAlongAxis(normal, args);
    const poly2D: Pt2[] = [{ x: -halfU, y: -halfV }, { x: halfU, y: -halfV }, { x: halfU, y: halfV }, { x: -halfU, y: halfV }];
    return { poly2D, normalLocal: normal, uLocal: u, vLocal: v, faceOriginLocal: normal.clone().multiplyScalar(halfN) };
  } else if (isDisc) {
    const args = Array.isArray((srcShape as any).args) ? (srcShape as any).args as number[] : [1, 1, 1];
    const radius = args[0] || 1;
    const sides = (srcShape.type === 'triangle' || srcShape.type === 'prism') ? 3 : (args[3] || 32);
    const verts = regularPolygonVertices(radius, sides);
    // CylinderGeometry in Three.js has top cap at local +Y, with vertices in X-Z: (r*sin(a), r*cos(a))
    // With normal = (0,1,0), u = (1,0,0), v = (0,0,-1): u x v = (0,1,0) = normal (Right-handed basis)
    // poly2D coordinates: x = px, y = -pz -> in 3D: x*u + y*v = (px, 0, pz)
    const poly2D: Pt2[] = verts.map((p: [number, number]) => ({ x: p[0], y: -p[1] }));
    const height = args[2] || 0.01;
    const normal = new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3(1, 0, 0);
    const v = new THREE.Vector3(0, 0, -1);
    return { poly2D, normalLocal: normal, uLocal: u, vLocal: v, faceOriginLocal: normal.clone().multiplyScalar(height / 2) };
  } else {
    const vertices = (((srcShape as any).args && (srcShape as any).args.vertices) || []) as [number, number][];
    const poly2D: Pt2[] = vertices.map((v: [number, number]) => ({ x: v[0], y: v[1] }));
    const height = (((srcShape as any).args && (srcShape as any).args.height) || 0);
    const normal = new THREE.Vector3(0, 0, 1);
    return { poly2D, normalLocal: normal, uLocal: new THREE.Vector3(1, 0, 0), vLocal: new THREE.Vector3(0, 1, 0), faceOriginLocal: normal.clone().multiplyScalar(height > 0 ? height / 2 : 0) };
  }
}

function ArchGeometry({ shape, shapes = [] }: { shape: Shape; shapes?: Shape[] }) {
  const args = Array.isArray(shape.args) ? (shape.args as number[]) : [];

  // Compute hash of relevant openings so wall geometry only updates when its hosted openings move/change
  const openingsHash = useMemo(() => {
    if (shape.type !== 'wall') return '';
    const relevant = shapes.filter(s => (s.type === 'door' || s.type === 'window') && !s.hidden);
    return relevant.map(s => `${s.id}-${s.hostWallId}-${s.archStyle || ''}-${(s.position || []).join(',')}-${JSON.stringify(s.args)}`).join('|');
  }, [shape.id, shape.type, shapes]);

  const geometry = useMemo(() => {
    switch (shape.type) {
      case 'wall': {
        const wallLength = args[0] || 3.0;
        const wallHeight = args[1] || 2.8;
        const wallThick = args[2] || 0.2;
        const wallPos = new THREE.Vector3(...shape.position);
        const wallQuat = new THREE.Quaternion(...(shape.quaternion || [0, 0, 0, 1]));
        const invWallQuat = wallQuat.clone().invert();

        const openings: WallOpening[] = [];
        for (const s of shapes) {
          if (s.type !== 'door' && s.type !== 'window') continue;
          if (s.hidden) continue;

          const sPos = new THREE.Vector3(...s.position);
          const sArgs = Array.isArray(s.args) ? s.args : [1, 1, 1];
          const sWidth = sArgs[0] || (s.type === 'door' ? 0.9 : 1.2);
          const sHeight = sArgs[1] || (s.type === 'door' ? 2.1 : 1.2);
          const sDepth = sArgs[2] || (s.type === 'door' ? 0.15 : 0.12);

          const isHosted = s.hostWallId === shape.id;
          const localPos = sPos.clone().sub(wallPos).applyQuaternion(invWallQuat);

          // Spatial check: is the opening hosted on or overlapping this wall?
          const inX = Math.abs(localPos.x) <= wallLength / 2 + 0.2;
          const inY = Math.abs(localPos.y) <= wallHeight / 2 + 0.5;
          const inZ = Math.abs(localPos.z) <= wallThick / 2 + 0.35;

          if (isHosted || (inX && inY && inZ)) {
            openings.push({
              id: s.id,
              type: s.type,
              localX: localPos.x,
              localY: localPos.y,
              width: sWidth,
              height: sHeight,
              depth: sDepth
            });
          }
        }

        return createWallWithOpeningsGeometry(wallLength, wallHeight, wallThick, openings);
      }
      case 'door': {
        const dWidth = args[0] || 0.9;
        const dHeight = args[1] || 2.1;
        const dDepth = args[2] || 0.15;
        return createDoorGeometry(dWidth, dHeight, dDepth, shape.archStyle || 'flush');
      }
      case 'window': {
        const wWidth = args[0] || 1.2;
        const wHeight = args[1] || 1.2;
        const wDepth = args[2] || 0.12;
        return createWindowGeometry(wWidth, wHeight, wDepth, shape.archStyle || 'cross');
      }
      case 'step':
        return createStepGeometry(args[0] || 1.0, args[1] || 0.18, args[2] || 0.30);
      case 'staircase':
        return createStaircaseGeometry(args[0] || 1.0, args[1] || 2.16, args[2] || 3.6, args[3] || 12);
      default:
        return new THREE.BoxGeometry(1, 1, 1);
    }
  }, [shape.type, shape.position, shape.quaternion, shape.archStyle, args[0], args[1], args[2], args[3], openingsHash]);

  useEffect(() => {
    return () => {
      if (geometry) geometry.dispose();
    };
  }, [geometry]);

  return <primitive object={geometry} attach="geometry" />;
}

function LandscapeFeatureGeometry({ shape }: { shape: Shape }) {
  const geometry = useMemo(() => {
    switch (shape.type) {
      case 'tree':
        return createTreeGeometry(shape.plantSpeciesId || 'english_oak');
      case 'bush':
        return createBushGeometry(shape.plantSpeciesId || 'boxwood_hedge_bush');
      case 'fence':
        return createFenceGeometry(Array.isArray(shape.args) ? shape.args[0] : 2.4, Array.isArray(shape.args) ? shape.args[1] : 1.1);
      case 'railing':
        return createRailingGeometry(Array.isArray(shape.args) ? shape.args[0] : 2.0, Array.isArray(shape.args) ? shape.args[1] : 1.0);
      case 'lamp':
        return createLampGeometry(Array.isArray(shape.args) ? shape.args[1] : 3.2);
      case 'bench':
        return createBenchGeometry(Array.isArray(shape.args) ? shape.args[0] : 1.8);
      case 'rock':
        return createRockGeometry(Array.isArray(shape.args) ? shape.args[0] : 1.2);
      default:
        return new THREE.BoxGeometry(1, 1, 1);
    }
  }, [shape.type, shape.args, shape.plantSpeciesId]);

  useEffect(() => {
    return () => {
      if (geometry) geometry.dispose();
    };
  }, [geometry]);

  return <primitive object={geometry} attach="geometry" />;
}

function MiniShapeMesh({ shape }: { shape: Shape }) {
  if (shape.hidden) return null;
  const args = Array.isArray(shape.args) ? (shape.args as number[]) : [];
  const materialProps: any = {
    color: (shape as any).color || '#cccccc',
    roughness: (shape as any).roughness ?? 0.6,
    metalness: (shape as any).metalness ?? 0,
    transparent: ((shape as any).opacity ?? 1) < 1,
    opacity: (shape as any).opacity ?? 1,
    side: THREE.DoubleSide
  };
  const pos = shape.position as [number, number, number];
  const quat = (shape.quaternion as [number, number, number, number]) || [0, 0, 0, 1];
  switch (shape.type) {
    case 'box':
    case 'rect':
      return (
        <mesh position={pos} quaternion={quat}>
          <boxGeometry args={[args[0] || 1, args[1] || 1, args[2] || 1]} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
      );
    case 'wall':
    case 'door':
    case 'window':
    case 'step':
    case 'staircase':
      return (
        <mesh position={pos} quaternion={quat}>
          <ArchGeometry shape={shape} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
      );
    case 'circle':
      return (
        <mesh position={pos} quaternion={quat}>
          <cylinderGeometry args={[args[0] || 1, args[0] || 1, args[2] || 0.01, args[3] || 32]} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
      );
    case 'triangle':
      return (
        <mesh position={pos} quaternion={quat}>
          <cylinderGeometry args={[args[0] || 1, args[0] || 1, args[2] || 0.01, 3]} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
      );
    case 'sphere':
      return (
        <mesh position={pos} quaternion={quat}>
          <sphereGeometry args={[args[0] || 1, args[1] || 16, args[2] || 16]} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
      );
    case 'cone':
      return (
        <mesh position={pos} quaternion={quat}>
          <coneGeometry args={[args[0] || 1, args[1] || 1, args[2] || 32]} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
      );
    case 'pyramid':
      return (
        <mesh position={pos} quaternion={quat}>
          <coneGeometry args={[args[0] || 1, args[1] || 1, args[2] || 4]} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
      );
    case 'donut':
      return (
        <mesh position={pos} quaternion={quat}>
          <torusGeometry args={[args[0] || 1, args[1] || 0.3, args[2] || 16, args[3] || 100]} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
      );
    case 'dome':
      return (
        <mesh position={pos} quaternion={quat}>
          <sphereGeometry args={[args[0] || 1, args[1] || 32, args[2] || 32, args[3] || 0, args[4] || Math.PI * 2, args[5] || 0, args[6] || Math.PI / 2]} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
      );
    case 'custom':
      return (
        <mesh position={pos} quaternion={quat}>
          <CustomGeometry shape={shape} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
      );
    case 'tree':
    case 'bush':
    case 'fence':
    case 'railing':
    case 'lamp':
    case 'bench':
    case 'rock':
      return (
        <mesh position={pos} quaternion={quat}>
          <LandscapeFeatureGeometry shape={shape} />
          <meshStandardMaterial {...materialProps} />
        </mesh>
      );
    default:
      return null;
  }
}

function computeMiniViewBounds(shapes: Shape[]) {
  const box = new THREE.Box3();
  let has = false;
  shapes.forEach(shape => {
    if (shape.hidden) return;
    const args = Array.isArray(shape.args) ? (shape.args as number[]) : [];
    let r = 1;
    switch (shape.type) {
      case 'box':
      case 'rect':
        r = Math.sqrt(Math.pow(args[0] || 1, 2) + Math.pow(args[1] || 1, 2) + Math.pow(args[2] || 1, 2)) / 2;
        break;
      case 'circle':
      case 'triangle':
        r = Math.max(args[0] || 1, (args[2] || 0.01) / 2);
        break;
      case 'sphere':
        r = args[0] || 1;
        break;
      case 'cone':
      case 'pyramid':
        r = Math.max(args[0] || 1, (args[1] || 1) / 2);
        break;
      case 'donut':
        r = (args[0] || 1) + (args[1] || 0.3);
        break;
      case 'dome':
        r = args[0] || 1;
        break;
      case 'custom': {
        try {
          const geo = new THREE.BufferGeometryLoader().parse((shape as any).geometryData);
          geo.computeBoundingSphere();
          r = geo.boundingSphere ? geo.boundingSphere.radius : 1;
        } catch {
          r = 1;
        }
        break;
      }
      default:
        r = 1;
    }
    const pos = shape.position as [number, number, number];
    box.union(new THREE.Box3(
      new THREE.Vector3(pos[0] - r, pos[1] - r, pos[2] - r),
      new THREE.Vector3(pos[0] + r, pos[1] + r, pos[2] + r)
    ));
    has = true;
  });
  if (!has) return { center: new THREE.Vector3(0, 0, 0), radius: 8 };
  const center = new THREE.Vector3();
  box.getCenter(center);
  const size = new THREE.Vector3();
  box.getSize(size);
  const radius = Math.max(size.length() / 2, 2);
  return { center, radius };
}

function MiniScene({ view }: { view: 'top' | 'front' | 'right' }) {
  const { shapes, theme, activeTool } = useApp();
  const { center, radius } = React.useMemo(() => computeMiniViewBounds(shapes), [shapes]);
  const dist = radius * 2.2 + 4;
  const camPos: [number, number, number] =
    view === 'top' ? [center.x, center.y + dist, center.z + 0.01] :
    view === 'front' ? [center.x, center.y, center.z + dist] :
    [center.x + dist, center.y, center.z];
  const target: [number, number, number] = [center.x, center.y, center.z];
  const gridSize = Math.max(radius * 5, 60);
  return (
    <>
      <PerspectiveCamera makeDefault position={camPos} fov={35} />
      <OrbitControls
        target={target}
        enableRotate={false}
        enablePan={true}
        enableZoom={true}
        zoomToCursor
        mouseButtons={{
          LEFT: activeTool === 'pan' ? THREE.MOUSE.PAN : (activeTool === 'zoom' ? THREE.MOUSE.DOLLY : null),
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN
        }}
      />
      <ambientLight intensity={0.8} />
      <directionalLight position={[10, 20, 10]} intensity={0.7} />
      <gridHelper args={[gridSize, 60, theme === 'dark' ? '#444444' : '#cccccc', theme === 'dark' ? '#2a2a2a' : '#e5e5e5']} />
      {shapes.filter(s => !s.hidden).map(shape => <MiniShapeMesh key={shape.id} shape={shape} />)}
    </>
  );
}

function FaceGrid({ shape, faceIndex, gridSize, isSelected, showGrid }: { shape: Shape, faceIndex: number, gridSize: number | [number, number], isSelected?: boolean, showGrid?: boolean }) {
  if (shape.type !== 'box' && shape.type !== 'rect') return null;
  
  const args = Array.isArray(shape.args) ? shape.args : [1, 1, 1];
  const w = args[0] || 1;
  const h = args[1] || 1;
  const d = args[2] || 1;
  
  let pos: [number, number, number] = [0, 0, 0];
  let rot: [number, number, number] = [0, 0, 0];
  let size: [number, number] = [1, 1];
  
  if (faceIndex <= 1) { pos = [w/2 + 0.005, 0, 0]; rot = [0, Math.PI/2, 0]; size = [d, h]; }
  else if (faceIndex <= 3) { pos = [-w/2 - 0.005, 0, 0]; rot = [0, -Math.PI/2, 0]; size = [d, h]; }
  else if (faceIndex <= 5) { pos = [0, h/2 + 0.005, 0]; rot = [-Math.PI/2, 0, 0]; size = [w, d]; }
  else if (faceIndex <= 7) { pos = [0, -h/2 - 0.005, 0]; rot = [Math.PI/2, 0, 0]; size = [w, d]; }
  else if (faceIndex <= 9) { pos = [0, 0, d/2 + 0.005]; rot = [0, 0, 0]; size = [w, h]; }
  else if (faceIndex <= 11) { pos = [0, 0, -d/2 - 0.005]; rot = [0, Math.PI, 0]; size = [w, h]; }

  const [gridX, gridY] = getGridDimensions(gridSize);
  
  return (
    <group position={shape.position} quaternion={shape.quaternion ? new THREE.Quaternion(...shape.quaternion) : undefined} scale={shape.scale}>
      {/* Base selection highlight */}
      {isSelected && (
        <mesh position={pos} rotation={rot}>
          <planeGeometry args={size} />
          <meshBasicMaterial color="#0063A3" transparent opacity={0.15} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* Grid cells */}
      {showGrid && (
        <group position={pos} rotation={rot}>
          {Array.from({ length: gridY }).map((_, row) => (
            Array.from({ length: gridX }).map((_, col) => {
              const subIndex = col + row * gridX;
              const key = `${faceIndex}-${subIndex}`;
              const material = shape.surfaceMaterials?.[key];
              const cellW = size[0] / gridX;
              const cellH = size[1] / gridY;
              const x = -size[0]/2 + cellW/2 + col * cellW;
              const y = -size[1]/2 + cellH/2 + row * cellH;

              if (!material && !isSelected) return null;

              return (
                <mesh key={subIndex} position={[x, y, 0.001]}>
                  <planeGeometry args={[cellW, cellH]} />
                  <meshBasicMaterial 
                    color={material || "#0063A3"} 
                    transparent={!material} 
                    opacity={material ? 1 : 0.05} 
                    side={THREE.DoubleSide} 
                  />
                </mesh>
              );
            })
          ))}
        </group>
      )}

      {/* Grid lines */}
      {showGrid && (gridX > 1 || gridY > 1) && (
        <group position={pos} rotation={rot}>
          {Array.from({ length: gridX + 1 }).map((_, i) => (
            <mesh key={`v-${i}`} position={[(-size[0]/2) + (i * size[0]/gridX), 0, 0.002]}>
              <boxGeometry args={[0.002, size[1], 0.002]} />
              <meshBasicMaterial color="#0063A3" transparent opacity={0.5} />
            </mesh>
          ))}
          {Array.from({ length: gridY + 1 }).map((_, i) => (
            <mesh key={`h-${i}`} position={[0, (-size[1]/2) + (i * size[1]/gridY), 0.002]}>
              <boxGeometry args={[size[0], 0.002, 0.002]} />
              <meshBasicMaterial color="#0063A3" transparent opacity={0.5} />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}

function Scene() {
  const { 
    activeTool, 
    setActiveTool,
    isDeveloperConsoleOpen,
    shapes, 
    setShapes,
    setShapesSilent,
    commitHistory,
    addShape, 
    removeShape,
    selectedId, 
    setSelectedId, 
    activeMaterial, 
    activePBR,
    updateShapeColor,
    updateShapeDimensions,
    setMeasurements,
    unit,
    theme,
    setRightPanelVisible,
    setPanelVisibility,
    shadowsEnabled,
    showLightsource,
    lightPosition,
    setLightPosition,
    isWorldViewActive,
    worldViewLocation,
    worldViewAltitude,
    selectedIds,
    currentModelId,
    setSelectedIds,
    selectedSurface,
    setSelectedSurface,
    activeTagId,
    setActiveTagId,
    tags,
    setTags,
    recordAction,
    scenes,
    setScenes,
    shadowOpacity,
    setShadowOpacity,
    ambientOcclusionEnabled,
    setAmbientOcclusionEnabled,
    activeBevelType,
    setActiveBevelType,
    contextMenu,
    setContextMenu,
    undo,
    redo,
    skybox,
    skyboxBlur,
    setSkyboxBlur,
    environmentIntensity,
    skyboxRotation,
    sunIntensity,
    setSunIntensity,
    customLights,
    setCustomLights,
    selectedLightId,
    setSelectedLightId,
    fogSettings,
    setFogSettings,
    animateSun,
    sunSpeed,
    gridEnabled,
    setGridEnabled,
    floorEnabled,
    setFloorEnabled,
    floorColor,
    placingLightId,
    setPlacingLightId,
    animations,
    setAnimations,
    placingAnimationId,
    setPlacingAnimationId,
    placingNoteId,
    setPlacingNoteId,
    notes,
    setNotes,
    collaborators,
    setCollaborators,
    chatMessages,
    setChatMessages,
    deformationSettings,
    setDeformationSettings,
    subtractCutterId,
    setSubtractCutterId,
    subtractTargetId,
    setSubtractTargetId,
    showCollaboratorCursors,
    user,
    setUser,
    consoleOutput,
    setConsoleOutput,
    focusOnMapTrigger,
    allNotesVisible,
    defaultCameraPosition,
    setDefaultCameraPosition,
    defaultCameraTarget,
    setDefaultCameraTarget,
    setZoom,
    rectangleInputState,
    setRectangleInputState,
    syncStatus,
    isDiagnosticLogOpen,
    setIsDiagnosticLogOpen,
    lastInteractionData,
    setLastInteractionData,
    diagLog,
    contactFrictionEnabled,
    autoOrbitEnabled,
    orbitRotationSpeed,
    isAIGenerateOpen,
    edgeLinesEnabled,
    edgeLinesColor,
    edgeLinesOpacity,
    edgeLinesThickness,
    showAllDimensions,
    landscapeSculptSettings,
    setLandscapeSculptSettings,
    landscapeRoadSettings,
    setLandscapeRoadSettings,
    activePlantSpecies,
    activePlantVariation,
    activePlantScale,
    kernelHost,
    kernelRevision,
    bumpKernel
  } = useApp();

  // Routes the line tool's drag into the geometry kernel. §4.1
  const lineBinding = useLineBinding(kernelHost, bumpKernel);

  const [roadPoints, setRoadPoints] = useState<THREE.Vector3[]>([]);
  const [sculptCursorPos, setSculptCursorPos] = useState<THREE.Vector3 | null>(null);
  const isSculptingDragRef = useRef(false);

  // Helper for applying sculpting brush deformation to a terrain shape
  const applyTerrainSculpt = (hitPoint: THREE.Vector3, isContinuous = false) => {
    const terrainShape = (selectedId ? shapes.find(s => s.id === selectedId && s.type === 'terrain' && s.terrainData) : null) || shapes.find(s => s.type === 'terrain' && s.terrainData);
    if (!terrainShape || !terrainShape.terrainData) return;

    const terrain = terrainShape.terrainData;
    const { gridX, gridY, width, depth } = terrain;
    const heights = [...terrain.heights];
    const { mode, radius, intensity, masked } = landscapeSculptSettings;
    const factor = isContinuous ? intensity * 0.35 : intensity * 0.8;

    const terrainPos = new THREE.Vector3(...terrainShape.position);
    // Convert world hit point to local terrain mesh coordinate
    const localHit = hitPoint.clone().sub(terrainPos);

    let modified = false;
    for (let j = 0; j < gridY; j++) {
      for (let i = 0; i < gridX; i++) {
        const vx = (i / (gridX - 1) - 0.5) * width;
        // In PlaneGeometry rotated by -PI/2 around X, Z coordinates follow this row position
        const vz = (j / (gridY - 1) - 0.5) * depth;
        const idx = j * gridX + i;
        const currentH = heights[idx] !== undefined ? heights[idx] : 0;

        const dist = Math.hypot(vx - localHit.x, vz - localHit.z);
        if (dist <= radius) {
          // If masked mode is enabled, skip boundary edges
          if (masked && (i <= 1 || i >= gridX - 2 || j <= 1 || j >= gridY - 2)) {
            continue;
          }

          // Smooth radial falloff (cosine kernel)
          const falloff = 0.5 * (1 + Math.cos((Math.PI * dist) / radius));
          const delta = factor * falloff;

          if (mode === 'push') {
            heights[idx] = Math.max(-25, currentH - delta);
          } else if (mode === 'pull') {
            heights[idx] = Math.min(50, currentH + delta);
          } else if (mode === 'smooth') {
            // Average with neighboring points
            let sum = 0;
            let count = 0;
            for (let dj = -1; dj <= 1; dj++) {
              for (let di = -1; di <= 1; di++) {
                const ni = i + di;
                const nj = j + dj;
                if (ni >= 0 && ni < gridX && nj >= 0 && nj < gridY) {
                  sum += heights[nj * gridX + ni];
                  count++;
                }
              }
            }
            const avg = count > 0 ? sum / count : currentH;
            heights[idx] = THREE.MathUtils.lerp(currentH, avg, Math.min(1, delta * 2.5));
          } else if (mode === 'flatten') {
            const targetElevation = Math.max(-15, Math.min(50, localHit.y));
            heights[idx] = THREE.MathUtils.lerp(currentH, targetElevation, Math.min(1, delta * 2.5));
          } else if (mode === 'pinch') {
            const targetElevation = Math.max(-15, Math.min(50, localHit.y));
            const direction = currentH >= targetElevation ? 1 : -1;
            heights[idx] = THREE.MathUtils.lerp(currentH, currentH + direction * delta * 0.8, 0.5);
          }
          modified = true;
        }
      }
    }

    if (modified) {
      setShapes(prev => prev.map(s => {
        if (s.id === terrainShape.id) {
          return {
            ...s,
            terrainData: {
              ...s.terrainData!,
              heights
            }
          };
        }
        return s;
      }));
    }
  };

  const finalizeRoadCreation = (pts: THREE.Vector3[]) => {
    if (pts.length < 2) {
      setRoadPoints([]);
      return;
    }

    const { width, embankment, roadColor } = landscapeRoadSettings;

    // Create a 3D road strip following the plotted path
    const curvePoints = pts.map(p => [p.x, p.y + 0.05, p.z] as [number, number, number]);
    const totalDist = pts.reduce((acc, p, idx) => {
      if (idx === 0) return 0;
      return acc + p.distanceTo(pts[idx - 1]);
    }, 0);

    const roadShape: Shape = {
      id: Math.random().toString(36).substr(2, 9),
      name: `Road Pathway (${formatValue(totalDist, unit, 1)})`,
      type: 'custom',
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      color: roadColor,
      args: {
        isRoad: true,
        path: curvePoints,
        width,
        embankment
      },
      roughness: 0.8,
      metalness: 0.1
    };

    addShape(roadShape);
    commitHistory();
    setRoadPoints([]);
    setMeasurements(`Road created: ${formatValue(totalDist, unit, 1)} long, ${formatValue(width, unit, 1)} wide`);
    setConsoleOutput(prev => [...prev, `[Landscapes] Created road pathway (${formatValue(totalDist, unit, 1)}) with ${pts.length} waypoints`]);
  };

  // Measuring Tape tool state: tapeStart persists once the user clicks the first point;
  // tapeEnd tracks the live cursor position for the preview line/label while the second
  // point hasn't been placed yet. lastMeasurement holds the most recently completed
  // measurement so its line + label stay visible after the second click.
  const [tapeStart, setTapeStart] = useState<THREE.Vector3 | null>(null);
  const [tapeEnd, setTapeEnd] = useState<THREE.Vector3 | null>(null);
  const [lastMeasurement, setLastMeasurement] = useState<{ start: [number, number, number]; end: [number, number, number]; distance: number } | null>(null);
  const [arcStart, setArcStart] = useState<THREE.Vector3 | null>(null);
  const [arcEnd, setArcEnd] = useState<THREE.Vector3 | null>(null);
  const [arcBulge, setArcBulge] = useState<THREE.Vector3 | null>(null);
  const [arcStep, setArcStep] = useState<0 | 1 | 2>(0);
  const [offsetPreviewPoints, setOffsetPreviewPoints] = useState<THREE.Vector3[] | null>(null);
  const [offsetPreviewDistance, setOffsetPreviewDistance] = useState<number>(0);
  const [offsetFaceKey, setOffsetFaceKey] = useState<number | null>(null);
  
  const frictionPausedUntilRef = useRef<number>(0);
  const sunAnimRef = useRef<{ radius: number; angle: number } | null>(null);
  const pointerUpHandledRef = useRef<boolean>(false);
  const hasReachedFrictionRef = useRef<boolean>(false);
  const lastValidPosRef = useRef<THREE.Vector3 | null>(null);
  const { raycaster, mouse, camera, scene, gl } = useThree();
  const directionalLightRef = useRef<THREE.DirectionalLight>(null!);
  const transformRef = useRef<any>(null);
  const selectedIdRef = useRef(selectedId);
  const selectedLightIdRef = useRef(selectedLightId);
  const isDraggingRef = useRef(false);

  const checkCollision = (id: string, mesh: THREE.Mesh) => {
    const box = new THREE.Box3().setFromObject(mesh);
    // Shrink slightly to avoid grazing contacts triggering it too easily
    box.expandByScalar(-0.01); 

    for (const child of scene.children) {
      if (child instanceof THREE.Mesh && child.userData.isShape && child.userData.id !== id) {
        const otherBox = new THREE.Box3().setFromObject(child);
        if (box.intersectsBox(otherBox)) {
          return true;
        }
      }
    }
    return false;
  };

  const getSceneObjectById = (id: string | null) => {
    if (!id) return null;
    let found: THREE.Object3D | null = null;
    scene.traverse(obj => {
      if (obj.userData?.id === id) found = obj;
    });
    return found;
  };

  const captureDiagnosticData = (sIdOverride?: string | null) => {
    const sId = sIdOverride === undefined ? selectedIdRef.current : sIdOverride;
    const sLId = selectedLightIdRef.current;
    let targetData: any = null;
    let meshFound = false;
    let meshId: string | null = null;
    let meshWorldPosition: [number, number, number] | null = null;
    let meshLocalPosition: [number, number, number] | null = null;
    let matrixAutoUpdateValue = false;
    let parentId: string | null = null;

    if (sId) {
      const obj = getSceneObjectById(sId) as THREE.Mesh;
      if (obj) {
        meshFound = true;
        meshId = obj.userData?.id || null;
        obj.updateMatrixWorld(true);
        const wp = new THREE.Vector3();
        obj.getWorldPosition(wp);
        meshWorldPosition = [wp.x, wp.y, wp.z];
        meshLocalPosition = [obj.position.x, obj.position.y, obj.position.z];
        matrixAutoUpdateValue = !!obj.matrixAutoUpdate;
        parentId = obj.parent?.userData?.id || null;

        targetData = {
          type: (obj as any).type,
          name: obj.name,
          position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
          rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z, order: obj.rotation.order },
          quaternion: { x: obj.quaternion.x, y: obj.quaternion.y, z: obj.quaternion.z, w: obj.quaternion.w },
          scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
          matrix: obj.matrix.toArray(),
          matrixWorld: obj.matrixWorld.toArray(),
          up: { x: obj.up.x, y: obj.up.y, z: obj.up.z },
          parentType: obj.parent ? (obj.parent as any).type : 'none'
        };
      }
    } else if (sLId) {
      const obj = getSceneObjectById(sLId);
      if (obj) {
        meshFound = true;
        meshId = obj.userData?.id || null;
        obj.updateMatrixWorld(true);
        const wp = new THREE.Vector3();
        obj.getWorldPosition(wp);
        meshWorldPosition = [wp.x, wp.y, wp.z];
        meshLocalPosition = [obj.position.x, obj.position.y, obj.position.z];
        matrixAutoUpdateValue = !!obj.matrixAutoUpdate;
        parentId = obj.parent?.userData?.id || null;

        targetData = {
          type: (obj as any).type,
          name: obj.name,
          position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
          quaternion: { x: obj.quaternion.x, y: obj.quaternion.y, z: obj.quaternion.z, w: obj.quaternion.w },
          matrixWorld: obj.matrixWorld.toArray()
        };
      }
    }

    setLastInteractionData({
      ndc: { x: mouse.x, y: mouse.y },
      ray: {
        origin: [raycaster.ray.origin.x, raycaster.ray.origin.y, raycaster.ray.origin.z],
        direction: [raycaster.ray.direction.x, raycaster.ray.direction.y, raycaster.ray.direction.z]
      },
      camera: {
        position: [camera.position.x, camera.position.y, camera.position.z],
        rotation: [camera.rotation.x, camera.rotation.y, camera.rotation.z]
      },
      target: sId || sLId || null,
      targetData,
      meshFound,
      meshId,
      meshWorldPosition,
      meshLocalPosition,
      transformControlsAttached: transformRef.current?.object?.userData?.id || null,
      matrixAutoUpdate: matrixAutoUpdateValue,
      parentId,
      threeRevision: THREE.REVISION,
      timestamp: Date.now()
    });
  };

  useEffect(() => {
    selectedIdRef.current = selectedId;
    captureDiagnosticData(selectedId);
  }, [selectedId]);

  useEffect(() => {
    selectedLightIdRef.current = selectedLightId;
    captureDiagnosticData();
  }, [selectedLightId]);

  // Middle mouse button shortcut to orbit
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 1) { // Middle mouse button
        // Cancel active tool operations
        setDrawingStart(null);
        setDrawingNormal(null);
        setDrawingOnId(null);
        setPreviewShape(null);
        setDrawingStep(0);
        setPushPullStateSync(null);
        setAxisLock(null);
        setFaceEditMode(null);
        setSnapIndicator(null);
        setTypedLength('');
        setLastDrawTarget(null);
        setSelectedSurface(null);
        setContextMenu(null);

        if (activeTool !== 'orbit') {
          setActiveTool('orbit');
        }
      }
    };
    window.addEventListener('mousedown', handleMouseDown);
    return () => window.removeEventListener('mousedown', handleMouseDown);
  }, [activeTool, setActiveTool]);

  // Show light helper if enabled
  useHelper(showLightsource ? directionalLightRef : null, THREE.DirectionalLightHelper, 1, 'yellow');

  const lastCursorUpdateRef = useRef<number>(0);
  const lastTransformBroadcastRef = useRef<number>(0);

  useFrame((state) => {
    if (!animateSun) { sunAnimRef.current = null; } if (animateSun) {
      if (!sunAnimRef.current) { sunAnimRef.current = { radius: Math.sqrt(lightPosition[0] * lightPosition[0] + lightPosition[2] * lightPosition[2]) || 10, angle: Math.atan2(lightPosition[2], lightPosition[0]) }; } sunAnimRef.current.angle += state.clock.getDelta() * sunSpeed * 0.5;
      const radius = sunAnimRef.current.radius; const time = sunAnimRef.current.angle;
      setLightPosition([
        Math.cos(time) * radius,
        lightPosition[1],
        Math.sin(time) * radius
      ]);
    }

    // Broadcast cursor position
    if (showCollaboratorCursors && user && currentModelId && !currentModelId.startsWith('new') && !isQuotaLocked()) {
      const collabId = `${currentModelId}_${user.email.toLowerCase()}`;
      const collabRef = doc(db, 'collaborations', collabId);
      
      // Use the first intersection point if available
      const intersections = state.raycaster.intersectObjects(state.scene.children, true);
      const point = intersections[0]?.point || new THREE.Vector3(0, 0, 0);
      
      const now = Date.now();
      if (now - lastCursorUpdateRef.current > 1000) { // 1fps sync
        lastCursorUpdateRef.current = now;
        updateDoc(collabRef, {
          cursorPosition: { x: point.x, y: point.y, z: point.z },
          lastSeen: now
        }).catch((err) => {
          handleFirestoreError(err, OperationType.UPDATE, `collaborations/${collabId}`);
        });
      }
    }
  });

  const [hoveredFace, setHoveredFace] = useState<{ shapeId: string, faceIndex: number, subFaceIndex?: number } | null>(null);
  const [drawingStart, setDrawingStart] = useState<THREE.Vector3 | null>(null);
  const [drawingNormal, setDrawingNormal] = useState<THREE.Vector3 | null>(null);
  const [drawingOnId, setDrawingOnId] = useState<string | null>(null);
  const [drawingStep, setDrawingStep] = useState<0 | 1 | 2>(0); // 0: idle, 1: base, 2: height
  const [tempBaseArgs, setTempBaseArgs] = useState<any>(null);
  const [axisLock, setAxisLock] = useState<'x' | 'y' | 'z' | null>(null);
  const [snapIndicator, setSnapIndicator] = useState<{ point: [number, number, number]; type: 'endpoint' | 'midpoint' | 'center'; tooltip?: string } | null>(null);
  const [trackingGuide, setTrackingGuide] = useState<{ source: [number, number, number]; target: [number, number, number]; color: string; label?: string } | null>(null);
  const awakenedRefPointsRef = useRef<Array<{ point: THREE.Vector3; type: 'endpoint' | 'midpoint' | 'center'; time: number; screenPos: { x: number; y: number } }>>([]);
  const inferenceLockRef = useRef<{ point: THREE.Vector3; type: 'endpoint' | 'midpoint' | 'center'; since: number; locked: boolean } | null>(null);
  const [typedLength, setTypedLength] = useState<string>('');
  const [lastDrawTarget, setLastDrawTarget] = useState<THREE.Vector3 | null>(null);
  const [faceEditMode, setFaceEditMode] = useState<string | null>(null); // shapeId
  const [placingNotePos, setPlacingNotePos] = useState<THREE.Vector3 | null>(null);
  const noteTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [polyVertices, setPolyVertices] = useState<THREE.Vector3[]>([]);
  const [polyPlane, setPolyPlane] = useState<THREE.Plane | null>(null);
  const [polyNormal, setPolyNormal] = useState<THREE.Vector3 | null>(null);
  const [polyHoveredVertex, setPolyHoveredVertex] = useState<number | null>(null);
  const [polyCandidatePos, setPolyCandidatePos] = useState<THREE.Vector3 | null>(null);
  const [polyPlaneOnId, setPolyPlaneOnId] = useState<string | null>(null);

  const [wallVertices, setWallVertices] = useState<THREE.Vector3[]>([]);
  const [wallPlane, setWallPlane] = useState<THREE.Plane | null>(null);
  const [wallCandidatePos, setWallCandidatePos] = useState<THREE.Vector3 | null>(null);
  const [wallHoveredVertex, setWallHoveredVertex] = useState<number | null>(null);
  const wallDragStartRef = useRef<{ point: THREE.Vector3; time: number } | null>(null);

  const [fenceVertices, setFenceVertices] = useState<THREE.Vector3[]>([]);
  const [fencePlane, setFencePlane] = useState<THREE.Plane | null>(null);
  const [fenceCandidatePos, setFenceCandidatePos] = useState<THREE.Vector3 | null>(null);
  const [fenceHoveredVertex, setFenceHoveredVertex] = useState<number | null>(null);

  const [previewShape, setPreviewShape] = useState<{ 
    type: Shape['type'], 
    position: [number, number, number], 
    quaternion: [number, number, number, number],
    args: any 
  } | null>(null);
  
  // Push/Pull state
  const [pushPullState, setPushPullState] = useState<{
    id: string;
    type: Shape['type'];
    initialPos: [number, number, number];
    initialArgs: any;
    normal: THREE.Vector3;
    localNormal: THREE.Vector3;
    startPoint: THREE.Vector3;
    isSubFace?: boolean;
    parentShapeId?: string;
    faceIndex?: number;
    subFaceIndex?: number;
    parentDepth?: number;
    customBounds?: { minU: number; maxU: number; minV: number; maxV: number };
    edgeIndex?: number; // Task #148: which polygon boundary edge (vertices[i]->vertices[i+1]) was clicked, for single-wall push/pull
    clickCommitArmed?: boolean;
  } | null>(null);
  // Task #158 fix: ref mirrors pushPullState synchronously so the SAME-tick pointerup
  // right after a pointerdown-created state can see it (React state updates are async,
  // so on a plain click the closure value in handlePointerUp would otherwise still be stale/null).
  const pushPullStateRef = useRef(pushPullState);
  const setPushPullStateSync = (val: any) => {
    pushPullStateRef.current = typeof val === 'function' ? val(pushPullStateRef.current) : val;
    setPushPullState(val);
  };

  // Bevel state
  const [bevelState, setBevelState] = useState<{
    id: string;
    initialAmount: number;
    startX: number;
    type: 'radius' | 'chamfer'; maxRadius: number;
  } | null>(null);

  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null);
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, []);


  useEffect(() => {
    const handleExportAdvanced = (e: any) => {
      const { format } = e.detail;
      const exportScene = new THREE.Scene();
      scene.children.forEach(child => {
        if (child instanceof THREE.Mesh && child.userData.isShape) {
          const clone = child.clone();
          exportScene.add(clone);
        }
      });

      if (format === 'stl') {
        const exporter = new STLExporter();
        const result = exporter.parse(exportScene);
        const blob = new Blob([result], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'model.stl';
        link.click();
      } else {
        const exporter = new GLTFExporter();
        exporter.parse(
          exportScene,
          (gltf) => {
            const output = JSON.stringify(gltf, null, 2);
            const blob = new Blob([output], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'model.gltf';
            link.click();
          },
          (error) => {
            console.error('An error happened during export', error);
          },
          { binary: false, trs: true }
        );
      }
    };

    const handleExport = () => {
      handleExportAdvanced({ detail: { format: 'gltf' } });
    };

    window.addEventListener('export-scene', handleExport);
    window.addEventListener('export-scene-advanced', handleExportAdvanced);
    
    const handleSetCamera = (e: any) => {
      const { position, target, zoom } = e.detail;
      camera.position.set(...(position as [number, number, number]));
      
      if (zoom !== undefined) {
        camera.zoom = zoom;
        camera.updateProjectionMatrix();
      }

      const controls = scene.userData.controls;
      if (controls) {
        controls.target.set(...(target as [number, number, number]));
        controls.update();
      }
    };
    window.addEventListener('set-camera', handleSetCamera);

    const handleCaptureDefaultCamera = () => {
      const controls = scene.userData.controls;
      if (controls) {
        setDefaultCameraPosition([camera.position.x, camera.position.y, camera.position.z]);
        setDefaultCameraTarget([controls.target.x, controls.target.y, controls.target.z]);
      }
    };
    window.addEventListener('capture-default-camera', handleCaptureDefaultCamera);

    return () => {
      window.removeEventListener('export-scene', handleExport);
      window.removeEventListener('export-scene-advanced', handleExportAdvanced);
      window.removeEventListener('set-camera', handleSetCamera);
      window.removeEventListener('capture-default-camera', handleCaptureDefaultCamera);
    };
  }, [scene, camera]);

  useEffect(() => {
    if (focusOnMapTrigger > 0) {
      const controls = scene.userData.controls;
      if (controls) {
        console.log(`[WorldView] Focusing camera on map center: [0, ${worldViewAltitude}, 0]`);
        // Bird's eye view
        camera.position.set(20, worldViewAltitude + 100, 20);
        controls.target.set(0, worldViewAltitude, 0);
        controls.update();
      } else {
        console.warn("[WorldView] Could not focus on map: OrbitControls not found in scene userData.");
      }
    }
  }, [focusOnMapTrigger, worldViewAltitude, camera, scene]);

  // Tool cleanup and state management
  useEffect(() => {
    // Cancel Push/Pull if tool changes
    if (activeTool !== 'pushpull') {
      setPushPullStateSync(null);
    }
    // Cancel Rectangle Input if tool changes
    if (activeTool !== 'rectangle') {
      setRectangleInputState({ active: false, startPoint: null, width: '', depth: '' });
    }
    // Cancel Poly trace if tool changes
    if (activeTool !== 'poly') {
      setPolyVertices([]);
      setPolyPlane(null);
      setPolyNormal(null);
      setPolyCandidatePos(null);
    }
    if (activeTool !== 'wall') {
      setWallVertices([]);
      setWallPlane(null);
      setWallCandidatePos(null);
      setWallHoveredVertex(null);
    }
    if (activeTool !== 'fence' && activeTool !== 'railing') {
      setFenceVertices([]);
      setFencePlane(null);
      setFenceCandidatePos(null);
      setFenceHoveredVertex(null);
    }
  }, [activeTool]);

  const finalizeRectangleInput = () => {
    if (!rectangleInputState.active || !rectangleInputState.startPoint) return;
    
    const w = parseFloat(rectangleInputState.width) || 0;
    const d = parseFloat(rectangleInputState.depth) || 0;
    
    if (w > 0 && d > 0) { const normal = rectangleInputState.normal ? new THREE.Vector3(rectangleInputState.normal.x, rectangleInputState.normal.y, rectangleInputState.normal.z) : new THREE.Vector3(0, 1, 0); const up = new THREE.Vector3(0, 1, 0); if (Math.abs(normal.dot(up)) > 0.99) { up.set(0, 0, 1); } const tangent = new THREE.Vector3().crossVectors(normal, up).normalize(); const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize(); const start = new THREE.Vector3(rectangleInputState.startPoint.x, rectangleInputState.startPoint.y, rectangleInputState.startPoint.z);
      
      const centerX = start.clone().add(tangent.clone().multiplyScalar(w / 2)).add(bitangent.clone().multiplyScalar(d / 2));
      centerX.add(normal.clone().multiplyScalar(0.005));
      
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
      
      const newShape: Shape = {
        id: Math.random().toString(36).substr(2, 9),
        type: 'rect',
        position: [centerX.x, centerX.y, centerX.z],
        quaternion: [quat.x, quat.y, quat.z, quat.w],
        args: [w, 0.01, d],
        color: activeMaterial,
        roughness: activePBR.roughness,
        metalness: activePBR.metalness,
        opacity: activePBR.opacity
      };
      
      addShape(newShape);
      commitHistory();
      recordAction(`sdk.createRectangle({ width: ${w}, height: ${d}, position: [${centerX.x.toFixed(2)}, ${centerX.y.toFixed(2)}, ${centerX.z.toFixed(2)}] });`);
    }
    
    setRectangleInputState({ active: false, startPoint: null, width: '', depth: '' });
  };

  const finalizePoly = useCallback(() => {
    if (polyVertices.length < 3) return;
    
    // Check self-intersection
    const origin = polyVertices[0];
    const normal = polyNormal || new THREE.Vector3(0, 1, 0);
    const p2d = projectToPlane(polyVertices, origin, normal);
    
    diagLog('TOOL', 'Finalizing Poly', { 
      vertexCount: polyVertices.length, 
      normal: [normal.x, normal.y, normal.z],
      isGroundDoc: !polyPlaneOnId 
    });

    if (checkSelfIntersection(p2d)) {
      setConsoleOutput(prev => [...prev, "[ERROR] Shape cannot cross itself."]);
      diagLog('ERROR', 'Poly failed: Self-intersection detected');
      return;
    }

    // Geometry triangulation check - fail fast if Three.js would crash
    const testShape = new THREE.Shape();
    if (p2d.length >= 3) {
      testShape.moveTo(p2d[0].x, p2d[0].y);
      for (let i = 1; i < p2d.length; i++) {
        testShape.lineTo(p2d[i].x, p2d[i].y);
      }
      testShape.closePath();
      try {
        const testGeo = new THREE.ShapeGeometry(testShape);
        testGeo.dispose();
      } catch (e) {
        setConsoleOutput(prev => [...prev, "[ERROR] Invalid polygon geometry (complex self-intersection or overlapping points)."]);
        diagLog('ERROR', 'Poly failed: Triangulation failed', { error: e instanceof Error ? e.message : String(e) });
        return;
      }
    }

    // Geometry triangulation
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    
    const newShape: Shape = {
      id: Math.random().toString(36).substr(2, 9),
      type: 'poly',
      position: [origin.x, origin.y, origin.z],
      quaternion: [quat.x, quat.y, quat.z, quat.w],
      args: { vertices: p2d.map(p => [p.x, p.y]) },
      color: activeMaterial,
      roughness: activePBR.roughness,
      metalness: activePBR.metalness,
      opacity: activePBR.opacity
    };

    addShape(newShape);
    commitHistory();
    setActiveTool('select');
    setSelectedId(newShape.id);
    
    diagLog('SDK', 'Poly shape created', { id: newShape.id, vertexCount: p2d.length });
    
    setPolyVertices([]);
    setPolyPlane(null);
    setPolyNormal(null);
    setPolyCandidatePos(null);
    
    recordAction(`sdk.createPoly({ vertices: ${JSON.stringify(newShape.args.vertices)} });`);
  }, [polyVertices, polyNormal, polyPlaneOnId, activeMaterial, activePBR, addShape, commitHistory, setActiveTool, setSelectedId, diagLog, recordAction, setConsoleOutput, setPolyVertices, setPolyPlane, setPolyNormal, setPolyCandidatePos]);

  const finalizeWallChain = useCallback(() => {
    setWallVertices([]);
    setWallPlane(null);
    setWallCandidatePos(null);
    setWallHoveredVertex(null);
    setMeasurements('');
    wallDragStartRef.current = null;
  }, [setMeasurements]);

  const createWallSegment = useCallback((pA: THREE.Vector3, pB: THREE.Vector3, wallHeight = 2.8, wallThickness = 0.2) => {
    const dist = pA.distanceTo(pB);
    if (dist < 0.1) return null;

    const center = pA.clone().lerp(pB, 0.5);
    center.y = Math.max(pA.y, pB.y) + wallHeight / 2;

    const dir = new THREE.Vector3().subVectors(pB, pA);
    const angle = Math.atan2(dir.z, dir.x);
    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angle);

    const newShape: Shape = {
      id: Math.random().toString(36).substr(2, 9),
      type: 'wall',
      position: [center.x, center.y, center.z],
      quaternion: [quat.x, quat.y, quat.z, quat.w],
      args: [dist, wallHeight, wallThickness],
      color: activeMaterial || '#e2e8f0',
      roughness: activePBR.roughness,
      metalness: activePBR.metalness,
      opacity: activePBR.opacity,
      name: `Wall ${shapes.filter(s => s.type === 'wall').length + 1}`
    };

    addShape(newShape);
    commitHistory();
    recordAction(`sdk.createWall({ length: ${dist.toFixed(2)}, height: ${wallHeight.toFixed(2)}, thickness: ${wallThickness.toFixed(2)}, position: [${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)}] });`);
    return newShape;
  }, [activeMaterial, activePBR, addShape, commitHistory, shapes, recordAction]);

  const finalizeFenceChain = useCallback(() => {
    setFenceVertices([]);
    setFencePlane(null);
    setFenceCandidatePos(null);
    setFenceHoveredVertex(null);
    setMeasurements('');
  }, [setMeasurements]);

  const createFenceRailingSegment = useCallback((pA: THREE.Vector3, pB: THREE.Vector3, tool: 'fence' | 'railing') => {
    const dist = pA.distanceTo(pB);
    if (dist < 0.1) return null;

    const center = pA.clone().lerp(pB, 0.5);
    const height = tool === 'fence' ? 1.1 : 1.0;

    const dir = new THREE.Vector3().subVectors(pB, pA);
    const angle = Math.atan2(dir.z, dir.x);
    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angle);

    const defaultColor = tool === 'fence' ? '#854d0e' : '#475569';
    const color = (activeMaterial && activeMaterial !== '#ffffff' && activeMaterial !== '#8b5a2b' && activeMaterial !== '#38bdf8') ? activeMaterial : defaultColor;

    const count = shapes.filter(s => s.type === tool).length + 1;
    const name = tool === 'fence' ? `Fence Section ${count} (${formatValue(dist, unit, 1)})` : `Railing Section ${count} (${formatValue(dist, unit, 1)})`;

    const newShape: Shape = {
      id: Math.random().toString(36).substr(2, 9),
      name,
      type: tool,
      position: [center.x, center.y, center.z],
      quaternion: [quat.x, quat.y, quat.z, quat.w],
      args: [dist, height],
      color,
      roughness: activePBR.roughness ?? 0.7,
      metalness: activePBR.metalness ?? 0.1,
      opacity: activePBR.opacity ?? 1
    };

    addShape(newShape);
    commitHistory();
    recordAction(`sdk.addShape(${JSON.stringify(newShape)});`);
    return newShape;
  }, [activeMaterial, activePBR, addShape, commitHistory, shapes, recordAction, unit]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isDeveloperConsoleOpen) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) { if (e.key === 'Enter' && rectangleInputState.active) { e.preventDefault(); finalizeRectangleInput(); } else if (e.key === 'Escape' && rectangleInputState.active) { e.preventDefault(); setRectangleInputState({ active: false, startPoint: null, width: '', depth: '' }); } return; }
      
      const key = e.key.toLowerCase();

      // Numeric length entry while drawing a line (SketchUp-style inference)
      if (['line', 'circle', 'triangle', 'sphere', 'cone', 'pyramid', 'donut', 'dome'].includes(activeTool) && drawingStart && !e.ctrlKey && !e.metaKey) { 
        if (/^[0-9.]$/.test(e.key)) {
          e.preventDefault();
          setTypedLength(prev => prev + e.key);
          return;
        }
        if (e.key === 'Backspace' && typedLength.length > 0) {
          e.preventDefault();
          setTypedLength(prev => prev.slice(0, -1));
          return;
        }
      }


      // Undo/Redo
      if (e.ctrlKey || e.metaKey) {
        if (key === 'z') {
          e.preventDefault();
          if (activeTool === 'wall' && wallVertices.length > 0) {
            setWallVertices(prev => prev.slice(0, -1));
            if (wallVertices.length <= 1) {
              finalizeWallChain();
            }
            return;
          } else if ((activeTool === 'fence' || activeTool === 'railing') && fenceVertices.length > 0) {
            setFenceVertices(prev => prev.slice(0, -1));
            if (fenceVertices.length <= 1) {
              finalizeFenceChain();
            }
            return;
          } else if (activeTool === 'poly' && polyVertices.length > 0) {
            setPolyVertices(prev => prev.slice(0, -1));
            if (polyVertices.length === 1) {
              setPolyPlane(null);
              setPolyNormal(null);
            }
          } else {
            undo();
          }
          return;
        }
        if (key === 'y') {
          e.preventDefault();
          redo();
          return;
        }
      }

      // Escape
      if (e.key === 'Escape') {
        if (activeTool === 'wall' && wallVertices.length > 0) {
          diagLog('TOOL', 'Wall drawing cancelled', { vertexCount: wallVertices.length });
        }
        if ((activeTool === 'fence' || activeTool === 'railing') && fenceVertices.length > 0) {
          diagLog('TOOL', `${activeTool} drawing cancelled`, { vertexCount: fenceVertices.length });
        }
        if (activeTool === 'poly' && polyVertices.length > 0) {
          diagLog('TOOL', 'Poly drawing cancelled', { vertexCount: polyVertices.length });
        }
        setRectangleInputState({ active: false, startPoint: null, width: '', depth: '' });
        setDrawingStart(null);
        setDrawingNormal(null);
        setDrawingOnId(null);
        setPreviewShape(null);
        setDrawingStep(0);
        setPushPullStateSync(null);
        setAxisLock(null);
        setFaceEditMode(null);
        setSnapIndicator(null);
        setTrackingGuide(null);
        awakenedRefPointsRef.current = [];
        setTypedLength('');
        setLastDrawTarget(null);
        setSelectedSurface(null);
        setContextMenu(null);
        setPolyVertices([]);
        setPolyPlane(null);
        setPolyNormal(null);
        setPolyCandidatePos(null);
        setWallVertices([]);
        setWallPlane(null);
        setWallCandidatePos(null);
        setWallHoveredVertex(null);
        setFenceVertices([]);
        setFencePlane(null);
        setFenceCandidatePos(null);
        setFenceHoveredVertex(null);
        wallDragStartRef.current = null;
        setArcStart(null);
        setArcEnd(null);
        setArcBulge(null);
        setArcStep(0);
        setOffsetPreviewPoints(null);
        return;
      }

      if (e.key === 'Enter') {
        if (activeTool === 'wall' && wallVertices.length > 0) {
          e.preventDefault();
          finalizeWallChain();
          return;
        }
        if ((activeTool === 'fence' || activeTool === 'railing') && fenceVertices.length > 0) {
          e.preventDefault();
          finalizeFenceChain();
          return;
        }
        if (activeTool === 'line' && drawingStart && drawingNormal && typedLength.trim() && lastDrawTarget) {
          e.preventDefault();
          const raw = parseFloat(typedLength);
          if (!isNaN(raw) && raw > 0) {
            const worldLen = unit === 'mm' ? raw / 1000 : unit === 'cm' ? raw / 100 : raw;
            const dir = new THREE.Vector3().subVectors(lastDrawTarget, drawingStart);
            if (dir.lengthSq() < 1e-8) dir.set(1, 0, 0);
            dir.normalize();
            const endPoint = drawingStart.clone().add(dir.clone().multiplyScalar(worldLen));
            const linePos = drawingStart.clone().lerp(endPoint, 0.5).add(drawingNormal.clone().multiplyScalar(0.01));
            const quatLine2 = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
            addShape({
              id: Math.random().toString(36).substr(2, 9),
              type: 'line',
              position: [linePos.x, linePos.y, linePos.z],
              quaternion: [quatLine2.x, quatLine2.y, quatLine2.z, quatLine2.w],
              args: [0.01, 0.01, worldLen, 8],
              color: activeMaterial,
              roughness: activePBR.roughness,
              metalness: activePBR.metalness,
              opacity: activePBR.opacity
            } as Shape);
            setDrawingStart(null);
            setDrawingNormal(null);
            setDrawingOnId(null);
            setPreviewShape(null);
            setDrawingStep(0);
            setTypedLength('');
            setSnapIndicator(null);
            setLastDrawTarget(null);
          }
          return;
        }

        if (['circle', 'triangle', 'sphere', 'cone', 'pyramid', 'donut', 'dome'].includes(activeTool) && drawingStep === 1 && drawingStart && drawingNormal && typedLength.trim()) {
          e.preventDefault();
          const raw = parseFloat(typedLength);
          if (!isNaN(raw) && raw > 0) {
            const worldRadius = unit === 'mm' ? raw / 1000 : unit === 'cm' ? raw / 100 : raw;

            const up = new THREE.Vector3(0, 1, 0);
            if (Math.abs(drawingNormal.dot(up)) > 0.99) { up.set(0, 0, 1); }
            const tangent = new THREE.Vector3().crossVectors(drawingNormal, up).normalize();
            const zAxis = new THREE.Vector3().crossVectors(tangent, drawingNormal).normalize();
            const basisMatrix = new THREE.Matrix4().makeBasis(tangent, drawingNormal, zAxis);
            const quat = new THREE.Quaternion().setFromRotationMatrix(basisMatrix);
            const quatArray: [number, number, number, number] = [quat.x, quat.y, quat.z, quat.w];
            const offsetPos = drawingStart.clone().add(drawingNormal.clone().multiplyScalar(0.005));

            let newShape: { type: string; position: [number, number, number]; quaternion: [number, number, number, number]; args: number[] } | null = null;

            if (activeTool === 'circle') {
              newShape = { type: 'circle', position: [offsetPos.x, offsetPos.y, offsetPos.z], quaternion: quatArray, args: [worldRadius, worldRadius, 0.01, 32] };
            } else if (activeTool === 'triangle') {
              newShape = { type: 'triangle', position: [offsetPos.x, offsetPos.y, offsetPos.z], quaternion: quatArray, args: [worldRadius, worldRadius, 0.01, 3] };
            } else if (activeTool === 'sphere') {
              newShape = { type: 'sphere', position: [drawingStart.x, drawingStart.y, drawingStart.z], quaternion: [0, 0, 0, 1], args: [worldRadius, 32, 32] };
            } else if (activeTool === 'cone') {
              newShape = { type: 'cone', position: [offsetPos.x, offsetPos.y, offsetPos.z], quaternion: quatArray, args: [worldRadius, 0.01, 32] };
            } else if (activeTool === 'pyramid') {
              newShape = { type: 'pyramid', position: [offsetPos.x, offsetPos.y, offsetPos.z], quaternion: quatArray, args: [worldRadius, 0.01, 4] };
            } else if (activeTool === 'donut') {
              newShape = { type: 'donut', position: [offsetPos.x, offsetPos.y, offsetPos.z], quaternion: quatArray, args: [worldRadius, 0.01, 16, 100] };
            } else if (activeTool === 'dome') {
              newShape = { type: 'dome', position: [offsetPos.x, offsetPos.y, offsetPos.z], quaternion: quatArray, args: [worldRadius, 32, 32, 0, Math.PI * 2, 0, Math.PI / 2] };
            }

            if (newShape) {
              const needsHeight = ['cone', 'pyramid', 'donut', 'dome'].includes(activeTool);
              if (needsHeight) {
                setPreviewShape(newShape as any);
                setTypedLength('');
                setDrawingStep(2);
              } else {
                addShape({
                  id: Math.random().toString(36).substr(2, 9),
                  type: newShape.type as any,
                  position: newShape.position,
                  quaternion: newShape.quaternion,
                  args: newShape.args,
                  color: activeMaterial,
                  roughness: activePBR.roughness,
                  metalness: activePBR.metalness,
                  opacity: activePBR.opacity
                } as Shape);
                setDrawingStart(null);
                setDrawingNormal(null);
                setDrawingOnId(null);
                setPreviewShape(null);
                setDrawingStep(0);
                setTypedLength('');
                setSnapIndicator(null);
                setLastDrawTarget(null);
              }
            }
          }
          return;
        }

        if (['cone', 'pyramid', 'donut', 'dome'].includes(activeTool) && drawingStep === 2 && previewShape && drawingStart && drawingNormal && typedLength.trim()) {
          e.preventDefault();
          const rawH = parseFloat(typedLength);
          if (!isNaN(rawH) && rawH > 0) {
            const worldHeight = unit === 'mm' ? rawH / 1000 : unit === 'cm' ? rawH / 100 : rawH;
            const newArgs2 = [...previewShape.args];
            let newPos2 = [...previewShape.position] as [number, number, number];

            if (activeTool === 'cone' || activeTool === 'pyramid') {
              newArgs2[1] = worldHeight;
              newPos2 = [
                drawingStart.x + drawingNormal.x * (worldHeight / 2),
                drawingStart.y + drawingNormal.y * (worldHeight / 2),
                drawingStart.z + drawingNormal.z * (worldHeight / 2)
              ];
            } else if (activeTool === 'donut') {
              newArgs2[1] = worldHeight;
            }
            // dome: height drag is a no-op in this app (matches mouse-drag behavior), commit as-is

            addShape({
              id: Math.random().toString(36).substr(2, 9),
              type: previewShape.type as any,
              position: newPos2,
              quaternion: previewShape.quaternion,
              args: newArgs2,
              color: activeMaterial,
              roughness: activePBR.roughness,
              metalness: activePBR.metalness,
              opacity: activePBR.opacity
            } as Shape);

            setDrawingStart(null);
            setDrawingNormal(null);
            setDrawingOnId(null);
            setPreviewShape(null);
            setDrawingStep(0);
            setTypedLength('');
            setSnapIndicator(null);
            setLastDrawTarget(null);
          }
          return;
        }

        if (activeTool === 'poly' && polyVertices.length >= 3) {
          e.preventDefault();
          finalizePoly();
          return;
        }
        if (rectangleInputState.active) {
          e.preventDefault();
          finalizeRectangleInput();
          return;
        }
      }

      // Axis Lock
      if (activeTool === 'move') {
        if (key === 'x') setAxisLock(prev => prev === 'x' ? null : 'x');
        if (key === 'y') setAxisLock(prev => prev === 'y' ? null : 'y');
        if (key === 'z') setAxisLock(prev => prev === 'z' ? null : 'z');
      } else if (drawingStart && ['rectangle', 'circle', 'line', 'triangle', 'sphere', 'cone', 'pyramid', 'donut', 'dome'].includes(activeTool) && (key === 'x' || key === 'y' || key === 'z')) {
        setAxisLock(prev => prev === key ? null : (key as 'x' | 'y' | 'z'));
        return;
      }

      // Tool Shortcuts
      if (key === ' ') {
        e.preventDefault();
        setActiveTool('select');
      } else if (key === 'e') {
        setActiveTool('eraser');
      } else if (key === 'b') {
        setActiveTool('paint');
      } else if (key === 'r') {
        setActiveTool('rectangle');
      } else if (key === 'c') {
        setActiveTool('circle');
      } else if (key === 'l') {
        setActiveTool('line');
      } else if (key === 'p') {
        setActiveTool('pushpull');
      } else if (key === 'm' || key === 'g') {
        setActiveTool('move');
      } else if (key === 'q') {
        setActiveTool('rotate');
      } else if (key === 's') {
        setActiveTool('scale');
      } else if (key === 'o') {
        setActiveTool('orbit');
      } else if (key === 'h') {
        setActiveTool('pan');
      } else if (key === 'z') {
        setActiveTool('zoom');
      } else if (key === 'n') {
        setActiveTool('note');
      } else if (key === 'd') {
        setActiveTool('deform');
      } else if (key === 'x') {
        setActiveTool('subtract');
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isDeveloperConsoleOpen, activeTool, undo, redo, setActiveTool, polyVertices.length, finalizePoly, wallVertices.length, finalizeWallChain, fenceVertices.length, finalizeFenceChain, rectangleInputState.active, finalizeRectangleInput]);

  const [pointerDownInfo, setPointerDownInfo] = useState<{ time: number, pos: THREE.Vector3 } | null>(null);

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    pointerUpHandledRef.current = false;
    setPointerDownInfo({ time: Date.now(), pos: e.point.clone() });

    if (activeTool === 'poly') {
      e.stopPropagation();
      
      // If clicking first vertex -> finalize
      if (polyHoveredVertex === 0 && polyVertices.length >= 3) {
        finalizePoly();
        return;
      }
      
      let pointToPlace = polyCandidatePos?.clone();
      
      if (polyVertices.length === 0) {
        // First vertex determines plane
        const intersects = raycaster.intersectObjects(scene.children, true);
        const shapeIntersect = intersects.find(i => i.object.userData.isShape);
        
        let normal = new THREE.Vector3(0, 1, 0);
        let onId = null;
        let p = new THREE.Vector3();

        if (shapeIntersect && shapeIntersect.face) {
          normal = shapeIntersect.face.normal.clone().applyQuaternion(shapeIntersect.object.quaternion).normalize();
          onId = shapeIntersect.object.userData.id;
          p = shapeIntersect.point.clone();
          diagLog("TOOL", "Poly starting on surface", { surfaceId: onId, normal: [normal.x, normal.y, normal.z] });
        } else {
          // Snap to ground
          const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
          if (raycaster.ray.intersectPlane(ground, p)) {
             // Valid ground hit
             diagLog("TOOL", "Poly starting on ground plane");
          } else {
             // Fallback to e.point if parallel or something weird
             p = e.point.clone();
             diagLog("WARN", "Poly starting with fallback point (no plane intersection)");
          }
        }
        
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, p);
        setPolyPlane(plane);
        setPolyNormal(normal);
        setPolyPlaneOnId(onId);
        setPolyVertices([p]);
      } else if (polyPlane && polyNormal) {
        // Subsequent vertices
        if (!pointToPlace) pointToPlace = e.point.clone();
        const newVertices = [...polyVertices, pointToPlace];
        setPolyVertices(newVertices);
        diagLog("TOOL", "Poly vertex added", { 
          index: newVertices.length, 
          pos: [pointToPlace.x, pointToPlace.y, pointToPlace.z],
          totalVertices: newVertices.length
        });
      }
      return;
    }

    if (activeTool === 'wall') {
      e.stopPropagation();
      
      // If clicking first vertex -> close loop & finalize
      if (wallHoveredVertex === 0 && wallVertices.length >= 2) {
        const prev = wallVertices[wallVertices.length - 1];
        createWallSegment(prev, wallVertices[0]);
        finalizeWallChain();
        return;
      }

      let pointToPlace = wallCandidatePos?.clone();

      if (wallVertices.length === 0) {
        // First vertex determines plane
        const intersects = raycaster.intersectObjects(scene.children, true);
        const shapeIntersect = intersects.find(i => i.object.userData.isShape);

        let normal = new THREE.Vector3(0, 1, 0);
        let p = new THREE.Vector3();

        if (shapeIntersect && shapeIntersect.face) {
          normal = shapeIntersect.face.normal.clone().applyQuaternion(shapeIntersect.object.quaternion).normalize();
          p = shapeIntersect.point.clone();
        } else {
          const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
          if (!raycaster.ray.intersectPlane(ground, p)) {
            p = e.point.clone();
          }
        }

        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, p);
        setWallPlane(plane);
        setWallVertices([p]);
        wallDragStartRef.current = { point: p.clone(), time: Date.now() };
        diagLog("TOOL", "Wall started at point", { pos: [p.x, p.y, p.z] });
      } else {
        if (!pointToPlace) pointToPlace = e.point.clone();
        const prev = wallVertices[wallVertices.length - 1];
        if (prev.distanceTo(pointToPlace) >= 0.15) {
          createWallSegment(prev, pointToPlace);
          setWallVertices(prevVerts => [...prevVerts, pointToPlace]);
          wallDragStartRef.current = { point: pointToPlace.clone(), time: Date.now() };
          diagLog("TOOL", "Wall segment placed", { 
            from: [prev.x, prev.y, prev.z], 
            to: [pointToPlace.x, pointToPlace.y, pointToPlace.z] 
          });
        }
      }
      return;
    }

    if (activeTool === 'fence' || activeTool === 'railing') {
      e.stopPropagation();

      // If clicking first vertex -> close loop & finalize
      if (fenceHoveredVertex === 0 && fenceVertices.length >= 2) {
        const prev = fenceVertices[fenceVertices.length - 1];
        createFenceRailingSegment(prev, fenceVertices[0], activeTool);
        finalizeFenceChain();
        setMeasurements(`Closed ${activeTool} path loop.`);
        return;
      }

      // If double-click -> finalize
      if (e.nativeEvent.detail === 2) {
        finalizeFenceChain();
        return;
      }

      let pointToPlace = fenceCandidatePos?.clone();

      if (fenceVertices.length === 0) {
        // First vertex determines plane
        const intersects = raycaster.intersectObjects(scene.children, true);
        const shapeIntersect = intersects.find(i => i.object.userData.isShape);

        let normal = new THREE.Vector3(0, 1, 0);
        let p = new THREE.Vector3();

        if (shapeIntersect && shapeIntersect.face) {
          normal = shapeIntersect.face.normal.clone().applyQuaternion(shapeIntersect.object.quaternion).normalize();
          p = shapeIntersect.point.clone();
        } else {
          const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
          if (!raycaster.ray.intersectPlane(ground, p)) {
            p = e.point.clone();
          }
        }

        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, p);
        setFencePlane(plane);
        setFenceVertices([p]);
        diagLog("TOOL", `${activeTool} started at point`, { pos: [p.x, p.y, p.z] });
        setMeasurements(`${activeTool === 'fence' ? 'Fence' : 'Railing'} Path: Click next point · Click start point to close loop · Double-click/Enter to finish.`);
      } else {
        if (!pointToPlace) pointToPlace = e.point.clone();
        const prev = fenceVertices[fenceVertices.length - 1];
        if (prev.distanceTo(pointToPlace) >= 0.15) {
          createFenceRailingSegment(prev, pointToPlace, activeTool);
          const nextVerts = [...fenceVertices, pointToPlace];
          setFenceVertices(nextVerts);
          diagLog("TOOL", `${activeTool} segment placed`, { 
            from: [prev.x, prev.y, prev.z], 
            to: [pointToPlace.x, pointToPlace.y, pointToPlace.z] 
          });
          setMeasurements(`${activeTool === 'fence' ? 'Fence' : 'Railing'} Path: ${nextVerts.length} points placed · Click next point · Double-click/Enter to finish.`);
        }
      }
      return;
    }

    if (placingLightId) {
      e.stopPropagation();
      const intersects = raycaster.intersectObjects(scene.children, true);
      const shapeIntersect = intersects.find(i => i.object.userData.isShape);
      const point = shapeIntersect ? shapeIntersect.point : e.point;
      
      setCustomLights(prev => prev.map(l => l.id === placingLightId ? { ...l, position: [point.x, point.y, point.z] } : l));
      setPlacingLightId(null);
      return;
    }

    if (placingAnimationId) {
      e.stopPropagation();
      const intersects = raycaster.intersectObjects(scene.children, true);
      const shapeIntersect = intersects.find(i => i.object.userData.isShape);
      const point = shapeIntersect ? shapeIntersect.point : e.point;
      
      setAnimations(prev => prev.map(a => a.id === placingAnimationId ? { ...a, position: [point.x, point.y, point.z] } : a));
      setPlacingAnimationId(null);
      return;
    }

    if (activeTool === 'landscape_sculpt' || activeTool === 'landscape_mask') {
      e.stopPropagation();
      const intersects = raycaster.intersectObjects(scene.children, true);
      const shapeIntersect = intersects.find(i => i.object.userData.isShape);
      const hitPoint = shapeIntersect ? shapeIntersect.point.clone() : e.point.clone();
      applyTerrainSculpt(hitPoint, false);
      isSculptingDragRef.current = true;
      return;
    }

    if (activeTool === 'landscape_road' || activeTool === 'landscape_zone') {
      e.stopPropagation();
      const intersects = raycaster.intersectObjects(scene.children, true);
      const shapeIntersect = intersects.find(i => i.object.userData.isShape);
      const hitPoint = shapeIntersect ? shapeIntersect.point.clone() : e.point.clone();

      if (e.nativeEvent.detail === 2 || (roadPoints.length > 0 && hitPoint.distanceTo(roadPoints[roadPoints.length - 1]) < 0.2)) {
        // Double-click or click very close -> finalize road
        finalizeRoadCreation(roadPoints);
      } else {
        const nextPts = [...roadPoints, hitPoint];
        setRoadPoints(nextPts);
        setMeasurements(`Road Path: ${nextPts.length} points placed · Click to add curve points · Double click to finalize.`);
      }
      return;
    }

    if (activeTool === 'tape') {
      e.stopPropagation();
      const intersects = raycaster.intersectObjects(scene.children, true);
      const shapeIntersect = intersects.find(i => i.object.userData.isShape);
      const point = (shapeIntersect ? shapeIntersect.point : e.point).clone();

      if (!tapeStart) {
        setTapeStart(point);
        setTapeEnd(point);
        setMeasurements('Click second point to measure.');
      } else {
        const distance = tapeStart.distanceTo(point);
        addShape({
          id: Math.random().toString(36).substr(2, 9),
          type: 'measurement',
          position: [(tapeStart.x + point.x) / 2, (tapeStart.y + point.y) / 2, (tapeStart.z + point.z) / 2],
          args: {
            start: [tapeStart.x, tapeStart.y, tapeStart.z],
            end: [point.x, point.y, point.z],
            distance,
          },
          color: '#FFD700',
        } as Shape);
        setMeasurements(`Distance: ${formatValue(distance, unit, 2)}`);
        setTapeStart(null);
        setTapeEnd(null);
      }
      return;
    }
    if (activeTool === 'arc') {
      e.stopPropagation();
      const intersects = raycaster.intersectObjects(scene.children, true);
      const shapeIntersect = intersects.find(i => (i.object.userData?.isShape || i.object.userData?.id) && i.object !== e.object);
      let point: THREE.Vector3;
      if (shapeIntersect) {
        point = shapeIntersect.point.clone();
      } else if (e.point) {
        point = e.point.clone();
      } else {
        const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const groundHit = new THREE.Vector3();
        raycaster.ray.intersectPlane(groundPlane, groundHit);
        point = groundHit;
      }

      if (arcStep === 0) {
        setArcStart(point);
        setArcEnd(point);
        setArcStep(1);
        setMeasurements(`Arc Start: (${point.x.toFixed(2)}, ${point.z.toFixed(2)}) — Click to set chord endpoint.`);
      } else if (arcStep === 1) {
        setArcEnd(point);
        setArcBulge(point);
        setArcStep(2);
        setMeasurements('Click or drag to adjust arc curvature / bulge.');
      } else if (arcStep === 2 && arcStart && arcEnd) {
        let arcPts = computeArcPoints(arcStart, arcEnd, point);
        if (!arcPts || arcPts.length < 2) {
          // Linear fallback if perfectly collinear
          arcPts = [arcStart.clone(), point.clone(), arcEnd.clone()];
        }
        const newArcId = Math.random().toString(36).substr(2, 9);
        const newArcShape: Shape = {
          id: newArcId,
          name: `Arc Line ${shapes.filter(s => s.type === 'arc').length + 1}`,
          type: 'arc',
          position: [0, 0, 0],
          quaternion: [0, 0, 0, 1],
          args: {
            start: [arcStart.x, arcStart.y, arcStart.z],
            end: [arcEnd.x, arcEnd.y, arcEnd.z],
            through: [point.x, point.y, point.z],
            points: arcPts.map(p => [p.x, p.y, p.z]),
          },
          color: activeMaterial || '#22c55e',
        } as Shape;
        addShape(newArcShape);
        setSelectedId(newArcId);
        setSelectedIds([newArcId]);
        commitHistory();
        setMeasurements(`Arc created (${formatValue(arcStart.distanceTo(arcEnd), unit, 2)} chord).`);
        setArcStart(null);
        setArcEnd(null);
        setArcBulge(null);
        setArcStep(0);
      }
      return;
    }


    if (activeTool === 'door' || activeTool === 'window') {
      e.stopPropagation();

      let targetWall: Shape | null = null;
      let worldPos: THREE.Vector3 | null = null;
      let quatArray: [number, number, number, number] = [0, 0, 0, 1];
      const width = activeTool === 'door' ? 0.9 : 1.2;
      const height = activeTool === 'door' ? 2.1 : 1.2;
      let depth = 0.2;

      if (previewShape && previewShape.type === activeTool) {
        worldPos = new THREE.Vector3(...previewShape.position);
        quatArray = previewShape.quaternion;
        depth = Array.isArray(previewShape.args) ? (previewShape.args[2] || 0.2) : 0.2;
        if ((previewShape as any).hostWallId) {
          targetWall = shapes.find(s => s.id === (previewShape as any).hostWallId) || null;
        }
      }

      if (!worldPos) {
        const intersects = raycaster.intersectObjects(scene.children, true);
        const shapeIntersect = intersects.find(i => i.object.userData.isShape);
        let hitPoint: THREE.Vector3 | null = null;

        if (shapeIntersect && shapeIntersect.object.userData.id) {
          const hitShape = shapes.find(s => s.id === shapeIntersect.object.userData.id);
          if (hitShape && hitShape.type === 'wall') {
            targetWall = hitShape;
            hitPoint = shapeIntersect.point.clone();
          }
        }

        if (!targetWall) {
          const ray = raycaster.ray;
          const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
          const groundHit = new THREE.Vector3();
          if (ray.intersectPlane(groundPlane, groundHit)) {
            hitPoint = groundHit;
            let minWallDist = 1.2;
            for (const sh of shapes) {
              if (sh.type !== 'wall') continue;
              const wPos = new THREE.Vector3(...sh.position);
              const wQuat = new THREE.Quaternion(...(sh.quaternion || [0, 0, 0, 1]));
              const wArgs = Array.isArray(sh.args) ? sh.args : [3.0, 2.8, 0.2];
              const wLen = wArgs[0] || 3.0;

              const invQuat = wQuat.clone().invert();
              const localP = groundHit.clone().sub(wPos).applyQuaternion(invQuat);

              if (Math.abs(localP.x) <= wLen / 2 + 0.5 && Math.abs(localP.z) <= 0.85) {
                const d = Math.abs(localP.z);
                if (d < minWallDist) {
                  minWallDist = d;
                  targetWall = sh;
                }
              }
            }
          }
        }

        if (targetWall && hitPoint) {
          const wallPos = new THREE.Vector3(...targetWall.position);
          const wallQuat = new THREE.Quaternion(...(targetWall.quaternion || [0, 0, 0, 1]));
          const wallArgs = Array.isArray(targetWall.args) ? targetWall.args : [3.0, 2.8, 0.2];
          const wallLen = wallArgs[0] || 3.0;
          const wallH = wallArgs[1] || 2.8;
          const wallT = wallArgs[2] || 0.2;
          depth = wallT;

          const invQuat = wallQuat.clone().invert();
          const localHit = hitPoint.clone().sub(wallPos).applyQuaternion(invQuat);

          const maxLocalX = Math.max(0, wallLen / 2 - width / 2);
          const localX = Math.max(-maxLocalX, Math.min(maxLocalX, localHit.x));
          const localY = activeTool === 'door'
            ? (-wallH / 2 + height / 2)
            : (-wallH / 2 + 0.9 + height / 2);

          const localPos = new THREE.Vector3(localX, localY, 0);
          worldPos = localPos.applyQuaternion(wallQuat).add(wallPos);
          quatArray = [wallQuat.x, wallQuat.y, wallQuat.z, wallQuat.w];
        } else if (hitPoint) {
          const groundY = hitPoint.y + (activeTool === 'door' ? height / 2 : 1.5);
          worldPos = new THREE.Vector3(hitPoint.x, groundY, hitPoint.z);
          quatArray = [0, 0, 0, 1];
        }
      }

      if (worldPos) {
        const shapeColor = (activeMaterial && activeMaterial !== '#ffffff' && activeMaterial !== '#8b5a2b' && activeMaterial !== '#38bdf8') ? activeMaterial : '#ffffff';
        const newDoorWindowShape: Shape = {
          id: Math.random().toString(36).substr(2, 9),
          name: activeTool === 'door' ? 'Door' : 'Window',
          type: activeTool,
          position: [worldPos.x, worldPos.y, worldPos.z],
          quaternion: quatArray,
          args: [width, height, depth],
          color: shapeColor,
          archStyle: activeTool === 'door' ? 'flush' : 'cross',
          roughness: 0.4,
          metalness: 0.05,
          opacity: 1,
          hostWallId: targetWall ? targetWall.id : undefined
        };

        addShape(newDoorWindowShape);
        commitHistory();
        setSelectedId(newDoorWindowShape.id);
        setSelectedIds([newDoorWindowShape.id]);
        setPreviewShape(null);
        setActiveTool('select');
        setMeasurements(`${activeTool === 'door' ? 'Door' : 'Window'} placed & wall opening cut. Use Move tool to reposition.`);
        recordAction(`sdk.addShape(${JSON.stringify(newDoorWindowShape)});`);
      }
      return;
    }

    if (['tree', 'bush', 'lamp', 'bench', 'rock'].includes(activeTool)) {
      e.stopPropagation();
      const intersects = raycaster.intersectObjects(scene.children, true);
      const shapeIntersect = intersects.find(i => i.object.userData.isShape);
      let hitPoint = shapeIntersect ? shapeIntersect.point.clone() : e.point.clone();
      if (!shapeIntersect) {
        const ray = raycaster.ray;
        const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const groundHit = new THREE.Vector3();
        if (ray.intersectPlane(groundPlane, groundHit)) {
          hitPoint = groundHit;
        }
      }

      const colorMap: Record<string, string> = {
        tree: '#2d6a4f',
        bush: '#40916c',
        fence: '#854d0e',
        railing: '#475569',
        lamp: '#1e293b',
        bench: '#9a3412',
        rock: '#78716c'
      };

      const nameMap: Record<string, string> = {
        tree: 'Landscape Tree',
        bush: 'Garden Bush',
        fence: 'Post & Rail Fence',
        railing: 'Safety Railing',
        lamp: 'Street Lamp Post',
        bench: 'Park Bench',
        rock: 'Landscape Boulder'
      };

      const species = (activeTool === 'tree' || activeTool === 'bush') 
        ? PLANT_SPECIES_CATALOG.find(s => s.id === activePlantSpecies)
        : null;

      const newShape: Shape = {
        id: Math.random().toString(36).substr(2, 9),
        name: species ? species.name : (nameMap[activeTool] || 'Landscape Feature'),
        type: activeTool as any,
        position: [hitPoint.x, hitPoint.y, hitPoint.z],
        quaternion: [0, 0, 0, 1],
        scale: (activeTool === 'tree' || activeTool === 'bush') ? [activePlantScale, activePlantScale, activePlantScale] : [1, 1, 1],
        args: [1, 1, 1],
        color: species ? (species.foliageColor || colorMap[activeTool]) : (colorMap[activeTool] || '#2d6a4f'),
        roughness: 0.7,
        metalness: 0.1,
        plantSpeciesId: (activeTool === 'tree' || activeTool === 'bush') ? activePlantSpecies : undefined,
        plantVariation: (activeTool === 'tree' || activeTool === 'bush') ? activePlantVariation : undefined
      };

      addShape(newShape);
      commitHistory();
      setMeasurements(`Placed ${newShape.name} at [${hitPoint.x.toFixed(1)}, ${hitPoint.y.toFixed(1)}, ${hitPoint.z.toFixed(1)}]`);
      return;
    }

    if (['rectangle', 'circle', 'line', 'triangle', 'sphere', 'cone', 'pyramid', 'donut', 'dome', 'step', 'staircase'].includes(activeTool)) {
      e.stopPropagation();
      
      if (drawingStep === 2) {
        // Confirm height step
        handlePointerUp(e);
        return;
      }

      // Check if snapped to an indicator or candidate first
      let startPoint: THREE.Vector3 | null = null;
      let startNormal: THREE.Vector3 | null = null;
      let startOnId: string | null = null;

      if (snapIndicator) {
        startPoint = new THREE.Vector3(...snapIndicator.point);
      }

      // Check for mesh intersection first
      const intersects = raycaster.intersectObjects(scene.children, true);
      const shapeIntersect = intersects.find(i => i.object.userData.isShape);
      
      if (shapeIntersect && shapeIntersect.face) {
        const normal = shapeIntersect.face.normal.clone().applyQuaternion(shapeIntersect.object.quaternion).normalize();
        startNormal = normal;
        startOnId = shapeIntersect.object.userData.id;
        if (!startPoint) {
          startPoint = shapeIntersect.point.clone();
        }
      } else {
        // Fallback to ground plane
        const ray = raycaster.ray;
        const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const target = new THREE.Vector3();
        if (ray.intersectPlane(groundPlane, target)) {
          if (!startPoint) {
            startPoint = target.clone();
          }
          startNormal = new THREE.Vector3(0, 1, 0);
        }
      }

      if (startPoint && startNormal) {
        setDrawingStart(startPoint);
        setDrawingNormal(startNormal);
        setDrawingOnId(startOnId);
        setDrawingStep(1);
        setTrackingGuide(null);
      }
    }
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (activeTool === 'landscape_sculpt' || activeTool === 'landscape_mask') {
      const intersects = raycaster.intersectObjects(scene.children, true);
      const shapeIntersect = intersects.find(i => i.object.userData.isShape);
      const hitPoint = shapeIntersect ? shapeIntersect.point.clone() : e.point.clone();
      setSculptCursorPos(hitPoint);
      if (isSculptingDragRef.current) {
        applyTerrainSculpt(hitPoint, true);
      }
      return;
    }

    if (activeTool === 'tape' && tapeStart) {
      const intersects = raycaster.intersectObjects(scene.children, true);
      const shapeIntersect = intersects.find(i => i.object.userData.isShape);
      const point = (shapeIntersect ? shapeIntersect.point : e.point).clone();
      setTapeEnd(point);
      setMeasurements(`Distance: ${formatValue(tapeStart.distanceTo(point), unit, 2)}`);
    }
    if (activeTool === 'arc' && arcStep === 1 && arcStart) {
      const intersects = raycaster.intersectObjects(scene.children, true);
      const shapeIntersect = intersects.find(i => i.object.userData?.isShape || i.object.userData?.id);
      const point = shapeIntersect ? shapeIntersect.point.clone() : (e.point ? e.point.clone() : new THREE.Vector3());
      setArcEnd(point);
      setMeasurements(`Arc Chord: ${formatValue(arcStart.distanceTo(point), unit, 2)} (Click to set endpoint)`);
    }

    if (activeTool === 'arc' && arcStep === 2 && arcStart && arcEnd) {
      const intersects = raycaster.intersectObjects(scene.children, true);
      const shapeIntersect = intersects.find(i => i.object.userData?.isShape || i.object.userData?.id);
      const point = shapeIntersect ? shapeIntersect.point.clone() : (e.point ? e.point.clone() : new THREE.Vector3());
      setArcBulge(point);
      setMeasurements(`Arc Curvature: Adjust bulge & click to place`);
    }

    if (activeTool === 'offset') {
        const evObj: any = (e as any).object;
        const evId = evObj && evObj.userData && evObj.userData.isShape ? evObj.userData.id : null;
        if (evId && evId !== selectedId) {
          const rcShape = shapes.find(s => s.id === evId && (s.type === 'poly' || s.type === 'box' || s.type === 'rect' || s.type === 'circle' || s.type === 'triangle' || s.type === 'prism'));
          if (rcShape) { setSelectedId(evId); setSelectedIds([evId]); }
        }
      }
      if (activeTool === 'offset' && selectedId) {
        const srcShape = shapes.find(s => s.id === selectedId && (s.type === 'poly' || s.type === 'box' || s.type === 'rect' || s.type === 'circle' || s.type === 'triangle' || s.type === 'prism'));
        if (srcShape) {
          const qArr = (srcShape as any).quaternion || [0, 0, 0, 1];
          const baseQuat = new THREE.Quaternion(qArr[0], qArr[1], qArr[2], qArr[3]);
          const center = new THREE.Vector3(srcShape.position[0], srcShape.position[1], srcShape.position[2]);
          const isBoxLike = srcShape.type === 'box' || srcShape.type === 'rect';
          let faceKey = 4;
          if (isBoxLike) {
            const evObj2: any = (e as any).object;
            const isSelfHover = evObj2 && evObj2.userData && evObj2.userData.id === srcShape.id;
            const fi = isSelfHover ? (e as any).faceIndex : undefined;
            faceKey = typeof fi === 'number' ? Math.floor(fi / 2) * 2 : (typeof offsetFaceKey === 'number' ? offsetFaceKey : 4);
          }
          const { poly2D, normalLocal, uLocal, vLocal, faceOriginLocal } = getOffsetSourcePoly2D(srcShape, faceKey);
          const normal = normalLocal.clone().applyQuaternion(baseQuat);
          const origin = center.clone().add(faceOriginLocal.clone().applyQuaternion(baseQuat));
          const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);
          const hit = new THREE.Vector3();
          if (raycaster.ray.intersectPlane(plane, hit)) {
            const rel = hit.clone().sub(origin);
            const uWorld = uLocal.clone().applyQuaternion(baseQuat);
            const vWorld = vLocal.clone().applyQuaternion(baseQuat);
            const cursorLocal = { x: rel.dot(uWorld), y: rel.dot(vWorld) };
            const inside = pointInPolygon2D(cursorLocal, poly2D);
            const dist = distanceToPolygonEdges2D(cursorLocal, poly2D);
            const signedDist = inside ? -dist : dist;
            const offsetPoly = computeOffsetPolygon(poly2D, signedDist);
            const worldPts = offsetPoly.map(p => origin.clone().add(uWorld.clone().multiplyScalar(p.x)).add(vWorld.clone().multiplyScalar(p.y)));
            if (worldPts.length > 0) worldPts.push(worldPts[0].clone());
            setOffsetPreviewPoints(worldPts);
            setOffsetPreviewDistance(signedDist);
            setOffsetFaceKey(faceKey);
            setMeasurements(`Offset: ${formatValue(Math.abs(signedDist), unit, 2)}${inside ? ' (inward)' : ' (outward)'} - click to confirm.`);
          } else {
            setOffsetPreviewPoints(null);
          }
        } else {
          setOffsetPreviewPoints(null);
        }
      }
      if (activeTool === 'poly' && polyPlane && polyNormal) {
      const ray = raycaster.ray;
      const target = new THREE.Vector3();
      if (ray.intersectPlane(polyPlane, target)) {
        let finalPos = target.clone();
        
        // Basic snapping
        if (!e.shiftKey) {
          const snapThreshold = 0.5;
          let snapTarget: THREE.Vector3 | null = null;
          let bestDist = snapThreshold;

          // Snap to existing vertices in current poly
          if (polyVertices.length > 0) {
            const d = finalPos.distanceTo(polyVertices[0]);
            const startSnapThreshold = 0.8; // Stronger snap for start point
            if (d < startSnapThreshold) {
              snapTarget = polyVertices[0].clone();
              bestDist = d;
              setPolyHoveredVertex(0);
            } else {
              setPolyHoveredVertex(null);
            }
          }

          // Snap to other shapes' origins (simplified snapping)
          if (!snapTarget) {
            shapes.forEach(sh => {
              const shPos = new THREE.Vector3(...sh.position);
              const d = finalPos.distanceTo(shPos);
              if (d < bestDist) {
                snapTarget = shPos.clone();
                bestDist = d;
              }
            });
          }

          if (snapTarget) finalPos = snapTarget;
        }

        setPolyCandidatePos(finalPos);
      }
    }

    if (activeTool === 'wall') {
      const plane = wallPlane || new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const target = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(plane, target)) {
        let finalPos = target.clone();
        
        // 1. Check start vertex snap to close wall loop
        let isClosingLoop = false;
        if (wallVertices.length >= 2) {
          const d = target.distanceTo(wallVertices[0]);
          if (d < 0.65) {
            finalPos = wallVertices[0].clone();
            setWallHoveredVertex(0);
            isClosingLoop = true;
          } else {
            setWallHoveredVertex(null);
          }
        } else {
          setWallHoveredVertex(null);
        }

        // 2. Default to 90-degree orthogonal angles, allow free angle if Shift is held down
        if (!e.shiftKey && wallVertices.length > 0 && !isClosingLoop) {
          const lastVertex = wallVertices[wallVertices.length - 1];
          const dx = target.x - lastVertex.x;
          const dz = target.z - lastVertex.z;

          if (wallVertices.length >= 2) {
            // Include both relative 90° angles (to previous wall) and world X/Z axes
            const prevCorner = wallVertices[wallVertices.length - 2];
            const pdx = lastVertex.x - prevCorner.x;
            const pdz = lastVertex.z - prevCorner.z;
            const pLen = Math.hypot(pdx, pdz);

            const candidates: THREE.Vector3[] = [];

            // World X-axis alignment
            candidates.push(new THREE.Vector3(target.x, lastVertex.y, lastVertex.z));
            // World Z-axis alignment
            candidates.push(new THREE.Vector3(lastVertex.x, lastVertex.y, target.z));

            if (pLen > 0.001) {
              // Relative parallel (continuation)
              const uParX = pdx / pLen;
              const uParZ = pdz / pLen;
              const dotPar = dx * uParX + dz * uParZ;
              candidates.push(new THREE.Vector3(lastVertex.x + dotPar * uParX, lastVertex.y, lastVertex.z + dotPar * uParZ));

              // Relative perpendicular (90° / -90° turn)
              const uPerpX = -uParZ;
              const uPerpZ = uParX;
              const dotPerp = dx * uPerpX + dz * uPerpZ;
              candidates.push(new THREE.Vector3(lastVertex.x + dotPerp * uPerpX, lastVertex.y, lastVertex.z + dotPerp * uPerpZ));
            }

            // Find closest 90° candidate to cursor target
            let bestCand = candidates[0];
            let minD = target.distanceTo(bestCand);
            for (let i = 1; i < candidates.length; i++) {
              const d = target.distanceTo(candidates[i]);
              if (d < minD) {
                minD = d;
                bestCand = candidates[i];
              }
            }
            finalPos = bestCand;
          } else {
            // First wall segment: lock strictly along dominant World X or Z axis
            if (Math.abs(dx) >= Math.abs(dz)) {
              finalPos.x = target.x;
              finalPos.z = lastVertex.z;
            } else {
              finalPos.x = lastVertex.x;
              finalPos.z = target.z;
            }
          }
        } else if (!e.shiftKey && wallVertices.length === 0) {
          // Snap to other shapes' origins when initiating first wall point
          let bestDist = 0.5;
          let snapTarget: THREE.Vector3 | null = null;
          shapes.forEach(sh => {
            const shPos = new THREE.Vector3(...sh.position);
            const d = finalPos.distanceTo(shPos);
            if (d < bestDist) {
              snapTarget = shPos.clone();
              bestDist = d;
            }
          });
          if (snapTarget) finalPos = snapTarget;
        }

        setWallCandidatePos(finalPos);

        if (wallVertices.length > 0) {
          const lastVertex = wallVertices[wallVertices.length - 1];
          const dist = lastVertex.distanceTo(finalPos);
          const angleMode = e.shiftKey ? 'Free Angle' : '90° Locked';
          if (dist >= 0.05) {
            setMeasurements(`Wall: Length ${formatValue(dist, unit, 2)} × Height 2.80m × Thickness 0.20m (${angleMode} · ${e.shiftKey ? 'Release Shift for 90° lock' : 'Hold Shift for free angles'} · Double-click/Esc to finish)`);
          }
        } else {
          setMeasurements(`Wall: Click or Drag to start drawing wall (90° default · Hold Shift for free angles)`);
        }
      }
    }

    if (activeTool === 'fence' || activeTool === 'railing') {
      const plane = fencePlane || new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const target = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(plane, target)) {
        let finalPos = target.clone();

        // 1. Check start vertex snap to close fence loop
        let isClosingLoop = false;
        if (fenceVertices.length >= 2) {
          const d = target.distanceTo(fenceVertices[0]);
          if (d < 0.65) {
            finalPos = fenceVertices[0].clone();
            setFenceHoveredVertex(0);
            isClosingLoop = true;
          } else {
            setFenceHoveredVertex(null);
          }
        } else {
          setFenceHoveredVertex(null);
        }

        // 2. Axis snapping if not closing loop
        if (!isClosingLoop && fenceVertices.length > 0 && !e.shiftKey) {
          const lastVertex = fenceVertices[fenceVertices.length - 1];
          const dx = Math.abs(finalPos.x - lastVertex.x);
          const dz = Math.abs(finalPos.z - lastVertex.z);
          const snapThreshold = 0.35;
          if (dx < snapThreshold) {
            finalPos.x = lastVertex.x;
          } else if (dz < snapThreshold) {
            finalPos.z = lastVertex.z;
          }
        }

        setFenceCandidatePos(finalPos);

        if (fenceVertices.length > 0) {
          const lastVertex = fenceVertices[fenceVertices.length - 1];
          const dist = lastVertex.distanceTo(finalPos);
          setMeasurements(`${activeTool === 'fence' ? 'Fence' : 'Railing'}: Section ${formatValue(dist, unit, 2)} (${fenceVertices.length} placed) · Click next point · Double-click/Enter to finish`);
        } else {
          setMeasurements(`${activeTool === 'fence' ? 'Fence' : 'Railing'}: Click terrain or ground to start drawing path`);
        }
      }
    }

    if (activeTool === 'door' || activeTool === 'window') {
      const intersects = raycaster.intersectObjects(scene.children, true);
      const shapeIntersect = intersects.find(i => i.object.userData.isShape);

      let targetWall: Shape | null = null;
      let hitPoint: THREE.Vector3 | null = null;

      if (shapeIntersect && shapeIntersect.object.userData.id) {
        const hitShape = shapes.find(s => s.id === shapeIntersect.object.userData.id);
        if (hitShape && hitShape.type === 'wall') {
          targetWall = hitShape;
          hitPoint = shapeIntersect.point.clone();
        }
      }

      if (!targetWall) {
        const ray = raycaster.ray;
        const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const groundHit = new THREE.Vector3();
        if (ray.intersectPlane(groundPlane, groundHit)) {
          hitPoint = groundHit;
          let minWallDist = 1.0;
          for (const sh of shapes) {
            if (sh.type !== 'wall') continue;
            const wPos = new THREE.Vector3(...sh.position);
            const wQuat = new THREE.Quaternion(...(sh.quaternion || [0, 0, 0, 1]));
            const wArgs = Array.isArray(sh.args) ? sh.args : [3.0, 2.8, 0.2];
            const wLen = wArgs[0] || 3.0;

            const invQuat = wQuat.clone().invert();
            const localP = groundHit.clone().sub(wPos).applyQuaternion(invQuat);

            if (Math.abs(localP.x) <= wLen / 2 + 0.5 && Math.abs(localP.z) <= 0.8) {
              const d = Math.abs(localP.z);
              if (d < minWallDist) {
                minWallDist = d;
                targetWall = sh;
              }
            }
          }
        }
      }

      if (targetWall && hitPoint) {
        const wallPos = new THREE.Vector3(...targetWall.position);
        const wallQuat = new THREE.Quaternion(...(targetWall.quaternion || [0, 0, 0, 1]));
        const wallArgs = Array.isArray(targetWall.args) ? targetWall.args : [3.0, 2.8, 0.2];
        const wallLen = wallArgs[0] || 3.0;
        const wallH = wallArgs[1] || 2.8;
        const wallT = wallArgs[2] || 0.2;

        const invQuat = wallQuat.clone().invert();
        const localHit = hitPoint.clone().sub(wallPos).applyQuaternion(invQuat);

        const width = activeTool === 'door' ? 0.9 : 1.2;
        const height = activeTool === 'door' ? 2.1 : 1.2;
        const depth = wallT;

        const maxLocalX = Math.max(0, wallLen / 2 - width / 2);
        const localX = Math.max(-maxLocalX, Math.min(maxLocalX, localHit.x));
        const localY = activeTool === 'door'
          ? (-wallH / 2 + height / 2)
          : (-wallH / 2 + 0.9 + height / 2);

        const localPos = new THREE.Vector3(localX, localY, 0);
        const worldPos = localPos.applyQuaternion(wallQuat).add(wallPos);
        const quatArray: [number, number, number, number] = [wallQuat.x, wallQuat.y, wallQuat.z, wallQuat.w];

        setPreviewShape({
          type: activeTool,
          position: [worldPos.x, worldPos.y, worldPos.z],
          quaternion: quatArray,
          args: [width, height, depth],
          hostWallId: targetWall.id
        } as any);

        setMeasurements(
          activeTool === 'door'
            ? `Door: ${formatValue(width, unit, 2)} × ${formatValue(height, unit, 2)} on Wall (Click to insert & cut opening)`
            : `Window: ${formatValue(width, unit, 2)} × ${formatValue(height, unit, 2)} (Sill ${formatValue(0.9, unit, 2)}) on Wall (Click to insert & cut opening)`
        );
      } else if (hitPoint) {
        const width = activeTool === 'door' ? 0.9 : 1.2;
        const height = activeTool === 'door' ? 2.1 : 1.2;
        const depth = 0.15;
        const groundY = hitPoint.y + (activeTool === 'door' ? height / 2 : 1.5);
        setPreviewShape({
          type: activeTool,
          position: [hitPoint.x, groundY, hitPoint.z],
          quaternion: [0, 0, 0, 1],
          args: [width, height, depth]
        });
        setMeasurements(`Click on a wall to insert ${activeTool} and cut opening.`);
      }
      return;
    }

    if (drawingStart && drawingNormal) {
      const ray = raycaster.ray;
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(drawingNormal, drawingStart);
      const target = new THREE.Vector3();
      
      const denom = ray.direction.dot(plane.normal);
      const hasValidPlaneHit = Math.abs(denom) > 1e-4;
      const planeT = hasValidPlaneHit ? -plane.distanceToPoint(ray.origin) / denom : -1;

      if (drawingStep === 1 && hasValidPlaneHit && planeT > 0 && planeT < 300) {
        target.copy(ray.origin).addScaledVector(ray.direction, planeT);

        // Screen-space coordinates for pixel-precise inference
        const rect = gl.domElement.getBoundingClientRect();
        const mouseScreenX = ((mouse.x + 1) / 2) * rect.width;
        const mouseScreenY = ((-mouse.y + 1) / 2) * rect.height;

        const projectToScreen = (p: THREE.Vector3) => {
          const v = p.clone().project(camera);
          const inFront = v.z < 1.0;
          return {
            x: ((v.x + 1) / 2) * rect.width,
            y: ((-v.y + 1) / 2) * rect.height,
            inFront
          };
        };

        // Coordinate basis on drawing plane
        const up = new THREE.Vector3(0, 1, 0);
        if (Math.abs(drawingNormal.dot(up)) > 0.99) {
          up.set(0, 0, 1);
        }
        const tangent = new THREE.Vector3().crossVectors(drawingNormal, up).normalize();
        const bitangent = new THREE.Vector3().crossVectors(drawingNormal, tangent).normalize();

        // Collect geometric candidate points
        const candidates: Array<{ point: THREE.Vector3; type: 'endpoint' | 'midpoint' | 'center'; screenDist: number }> = [];
        shapes.forEach(sh => {
          if (sh.type === 'measurement') {
            if (sh.args && Array.isArray(sh.args.start) && Array.isArray(sh.args.end)) {
              const mStart = new THREE.Vector3(sh.args.start[0], sh.args.start[1], sh.args.start[2]);
              const mEnd = new THREE.Vector3(sh.args.end[0], sh.args.end[1], sh.args.end[2]);
              const mMid = mStart.clone().lerp(mEnd, 0.5);
              [
                { p: mStart, t: 'endpoint' as const },
                { p: mEnd, t: 'endpoint' as const },
                { p: mMid, t: 'midpoint' as const }
              ].forEach(({ p, t }) => {
                const pr = projectToScreen(p);
                if (pr.inFront) {
                  const sd = Math.hypot(pr.x - mouseScreenX, pr.y - mouseScreenY);
                  candidates.push({ point: p.clone(), type: t, screenDist: sd });
                }
              });
            }
            return;
          }
          const obj = scene.getObjectByName(sh.id);
          if (!obj) return;
          const box = new THREE.Box3().setFromObject(obj);
          if (!isFinite(box.min.x) || !isFinite(box.max.x)) return;
          const xs = [box.min.x, box.max.x], ys = [box.min.y, box.max.y], zs = [box.min.z, box.max.z];
          const corners: THREE.Vector3[] = [];
          xs.forEach(x => ys.forEach(y => zs.forEach(z => corners.push(new THREE.Vector3(x, y, z)))));
          corners.forEach(c => {
            const pr = projectToScreen(c);
            if (pr.inFront) {
              candidates.push({ point: c.clone(), type: 'endpoint', screenDist: Math.hypot(pr.x - mouseScreenX, pr.y - mouseScreenY) });
            }
          });
          for (let ci = 0; ci < 8; ci++) {
            for (let cj = ci + 1; cj < 8; cj++) {
              const a = corners[ci], b = corners[cj];
              const diffs = [a.x !== b.x, a.y !== b.y, a.z !== b.z].filter(Boolean).length;
              if (diffs === 1) {
                const mid = a.clone().lerp(b, 0.5);
                const pr = projectToScreen(mid);
                if (pr.inFront) {
                  candidates.push({ point: mid, type: 'midpoint', screenDist: Math.hypot(pr.x - mouseScreenX, pr.y - mouseScreenY) });
                }
              }
            }
          }
          const faceCenters: THREE.Vector3[] = [
            new THREE.Vector3(box.min.x, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2),
            new THREE.Vector3(box.max.x, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2),
            new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2),
            new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2),
            new THREE.Vector3((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, box.min.z),
            new THREE.Vector3((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, box.max.z),
          ];
          faceCenters.forEach(fc => {
            const pr = projectToScreen(fc);
            if (pr.inFront) {
              candidates.push({ point: fc, type: 'center', screenDist: Math.hypot(pr.x - mouseScreenX, pr.y - mouseScreenY) });
            }
          });
        });

        // Evaluate snap target
        candidates.sort((a, b) => a.screenDist - b.screenDist);
        const snapRadiusPx = 18.0;
        const bestCandidate = candidates.length > 0 && candidates[0].screenDist <= snapRadiusPx ? candidates[0] : null;

        // Awaken reference points when hovered
        if (bestCandidate) {
          const existingIdx = awakenedRefPointsRef.current.findIndex(p => p.point.distanceTo(bestCandidate.point) < 0.05);
          if (existingIdx >= 0) {
            awakenedRefPointsRef.current[existingIdx].time = performance.now();
          } else {
            awakenedRefPointsRef.current.push({
              point: bestCandidate.point.clone(),
              type: bestCandidate.type,
              time: performance.now(),
              screenPos: { x: mouseScreenX, y: mouseScreenY }
            });
            if (awakenedRefPointsRef.current.length > 2) {
              awakenedRefPointsRef.current.shift();
            }
          }
        }

        let currentGuide: { source: [number, number, number]; target: [number, number, number]; color: string; label?: string } | null = null;
        let snapHit: { point: THREE.Vector3; type: 'endpoint' | 'midpoint' | 'center'; tooltip?: string } | null = null;

        if (bestCandidate && !axisLock) {
          // Direct Snap to candidate point projected onto the drawing plane
          const projectedToPlane = new THREE.Vector3();
          plane.projectPoint(bestCandidate.point, projectedToPlane);
          target.copy(projectedToPlane);
          snapHit = {
            point: bestCandidate.point.clone(),
            type: bestCandidate.type,
            tooltip: bestCandidate.type === 'endpoint' ? 'Endpoint' : bestCandidate.type === 'midpoint' ? 'Midpoint' : 'Center'
          };
        } else if (!axisLock && awakenedRefPointsRef.current.length > 0) {
          // Cardinal alignment inference tracking rays from awakened reference points
          let bestAlignmentDist = 14.0;
          let alignedTarget: THREE.Vector3 | null = null;

          for (const ref of awakenedRefPointsRef.current) {
            const Q = ref.point;
            const Q_plane = new THREE.Vector3();
            plane.projectPoint(Q, Q_plane);

            const diffQ = target.clone().sub(Q_plane);
            const distTangent = diffQ.dot(tangent);
            const distBitangent = diffQ.dot(bitangent);

            // Ray 1: Along Tangent through Q (Red Axis on ground)
            const ptOnRay1 = Q_plane.clone().addScaledVector(tangent, distTangent);
            const pr1 = projectToScreen(ptOnRay1);
            if (pr1.inFront) {
              const d1 = Math.hypot(pr1.x - mouseScreenX, pr1.y - mouseScreenY);
              if (d1 < bestAlignmentDist) {
                bestAlignmentDist = d1;
                alignedTarget = ptOnRay1;
                currentGuide = {
                  source: [Q.x, Q.y, Q.z],
                  target: [ptOnRay1.x, ptOnRay1.y, ptOnRay1.z],
                  color: '#ef4444',
                  label: 'From Point on Red Axis'
                };
              }
            }

            // Ray 2: Along Bitangent through Q (Green Axis)
            const ptOnRay2 = Q_plane.clone().addScaledVector(bitangent, distBitangent);
            const pr2 = projectToScreen(ptOnRay2);
            if (pr2.inFront) {
              const d2 = Math.hypot(pr2.x - mouseScreenX, pr2.y - mouseScreenY);
              if (d2 < bestAlignmentDist) {
                bestAlignmentDist = d2;
                alignedTarget = ptOnRay2;
                currentGuide = {
                  source: [Q.x, Q.y, Q.z],
                  target: [ptOnRay2.x, ptOnRay2.y, ptOnRay2.z],
                  color: '#22c55e',
                  label: 'From Point on Green Axis'
                };
              }
            }
          }

          if (alignedTarget) {
            target.copy(alignedTarget);
          }
        }

        if (axisLock) {
          const axisVec = axisLock === 'x' ? new THREE.Vector3(1, 0, 0) : axisLock === 'y' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
          const delta = target.clone().sub(drawingStart);
          const projLength = delta.dot(axisVec);
          target.copy(drawingStart.clone().addScaledVector(axisVec, projLength));
          snapHit = null;
        }

        setSnapIndicator(snapHit ? { point: [snapHit.point.x, snapHit.point.y, snapHit.point.z], type: snapHit.type, tooltip: snapHit.tooltip } : null);
        setTrackingGuide(currentGuide);
        setLastDrawTarget(target.clone());

        // Step 1: Base Dimensions
        const diff = new THREE.Vector3().subVectors(target, drawingStart);
        const xDist = diff.dot(tangent);
        const yDist = diff.dot(bitangent);
        
        // Build rotation directly from the tangent/normal/bitangent basis used for the
        // drag-plane math above, instead of THREE's arbitrary shortest-arc twist. This keeps
        // the drawn shape's local X/Z axes aligned with the actual drag directions (tangent/
        // bitangent) on every face, including vertical faces reached after rotating the camera.
        const zAxis = new THREE.Vector3().crossVectors(tangent, drawingNormal).normalize();
        const basisMatrix = new THREE.Matrix4().makeBasis(tangent, drawingNormal, zAxis);
        const quat = new THREE.Quaternion().setFromRotationMatrix(basisMatrix);
        const quatArray: [number, number, number, number] = [quat.x, quat.y, quat.z, quat.w];

        if (activeTool === 'rectangle') {
          const centerX = drawingStart.clone().add(tangent.clone().multiplyScalar(xDist / 2)).add(bitangent.clone().multiplyScalar(yDist / 2));
          centerX.add(drawingNormal.clone().multiplyScalar(0.005));
          setPreviewShape({
            type: 'rect',
            position: [centerX.x, centerX.y, centerX.z],
            quaternion: quatArray,
            args: [Math.abs(xDist), 0.01, Math.abs(yDist)]
          });
          setMeasurements(`${formatValue(Math.abs(xDist), unit, 1)} x ${formatValue(Math.abs(yDist), unit, 1)}`);
        } else if (activeTool === 'circle') {
          const radius = drawingStart.distanceTo(target);
          const pos = drawingStart.clone().add(drawingNormal.clone().multiplyScalar(0.005));
          setPreviewShape({
            type: 'circle',
            position: [pos.x, pos.y, pos.z],
            quaternion: quatArray,
            args: [radius, radius, 0.01, 32]
          });
          setMeasurements(`Radius: ${formatValue(radius, unit, 1)}`);
        } else if (activeTool === 'triangle') {
          const radius = drawingStart.distanceTo(target);
          const pos = drawingStart.clone().add(drawingNormal.clone().multiplyScalar(0.005));
          setPreviewShape({
            type: 'triangle',
            position: [pos.x, pos.y, pos.z],
            quaternion: quatArray,
            args: [radius, radius, 0.01, 3]
          });
          setMeasurements(`Side: ${formatValue(radius, unit, 1)}`);
        } else if (activeTool === 'line') {
          const dist = drawingStart.distanceTo(target);
          const pos = drawingStart.clone().lerp(target, 0.5).add(drawingNormal.clone().multiplyScalar(0.01));
          const dir = new THREE.Vector3().subVectors(target, drawingStart).normalize();
          const quatLine = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
          setPreviewShape({
            type: 'line',
            position: [pos.x, pos.y, pos.z],
            quaternion: [quatLine.x, quatLine.y, quatLine.z, quatLine.w],
            args: [0.01, 0.01, dist, 8]
          });
          setMeasurements(`Length: ${formatValue(dist, unit, 1)}`);
        } else if (activeTool === 'sphere') {
          const radius = drawingStart.distanceTo(target);
          setPreviewShape({
            type: 'sphere',
            position: [drawingStart.x, drawingStart.y, drawingStart.z],
            quaternion: [0, 0, 0, 1],
            args: [radius, 32, 32]
          });
          setMeasurements(`Radius: ${formatValue(radius, unit, 1)}`);
        } else if (activeTool === 'cone') {
          const radius = drawingStart.distanceTo(target);
          const conePos = drawingStart.clone().add(drawingNormal.clone().multiplyScalar(0.005));
          setPreviewShape({
            type: 'cone',
            position: [conePos.x, conePos.y, conePos.z],
            quaternion: quatArray,
            args: [radius, 0.01, 32] // Height is small for now
          });
          setMeasurements(`Radius: ${formatValue(radius, unit, 1)}`);
        } else if (activeTool === 'pyramid') {
          const radius = drawingStart.distanceTo(target);
          const pyramidPos = drawingStart.clone().add(drawingNormal.clone().multiplyScalar(0.005));
          setPreviewShape({
            type: 'pyramid',
            position: [pyramidPos.x, pyramidPos.y, pyramidPos.z],
            quaternion: quatArray,
            args: [radius, 0.01, 4]
          });
          setMeasurements(`Base: ${formatValue(radius, unit, 1)}`);
        } else if (activeTool === 'donut') {
          const radius = drawingStart.distanceTo(target);
          const donutPos = drawingStart.clone().add(drawingNormal.clone().multiplyScalar(0.005));
          setPreviewShape({
            type: 'donut',
            position: [donutPos.x, donutPos.y, donutPos.z],
            quaternion: quatArray,
            args: [radius, 0.01, 16, 100]
          });
          setMeasurements(`Major Radius: ${formatValue(radius, unit, 1)}`);
        } else if (activeTool === 'dome') {
          const radius = drawingStart.distanceTo(target);
          const domePos = drawingStart.clone().add(drawingNormal.clone().multiplyScalar(0.005));
          setPreviewShape({
            type: 'dome',
            position: [domePos.x, domePos.y, domePos.z],
            quaternion: quatArray,
            args: [radius, 32, 32, 0, Math.PI * 2, 0, Math.PI / 2]
          });
          setMeasurements(`Radius: ${formatValue(radius, unit, 1)}`);
        } else if (activeTool === 'step') {
          const stepPos = target.clone().add(drawingNormal.clone().multiplyScalar(0.09));
          setPreviewShape({
            type: 'step',
            position: [stepPos.x, stepPos.y, stepPos.z],
            quaternion: quatArray,
            args: [1.0, 0.18, 0.30]
          });
          setMeasurements(`Step: 1.00m × 0.30m × 0.18m`);
        } else if (activeTool === 'staircase') {
          const stairPos = target.clone().add(drawingNormal.clone().multiplyScalar(1.08));
          setPreviewShape({
            type: 'staircase',
            position: [stairPos.x, stairPos.y, stairPos.z],
            quaternion: quatArray,
            args: [1.0, 2.16, 3.6, 12]
          });
          setMeasurements(`Staircase: 12 Steps (Rise 2.16m, Run 3.60m)`);
        }
      } else if (drawingStep === 2 && previewShape) {
        // Step 2: Height
        const ray = raycaster.ray;
        const p1 = drawingStart;
        const v1 = drawingNormal;
        const p2 = ray.origin;
        const v2 = ray.direction;
        
        const v12 = new THREE.Vector3().subVectors(p1, p2);
        const d12 = v1.dot(v2);
        const d11 = v1.dot(v1);
        const d22 = v2.dot(v2);
        const d1 = v1.dot(v12);
        const d2 = v2.dot(v12);
        
        const denom = d11 * d22 - d12 * d12;
        if (Math.abs(denom) > 1e-6) {
          const height = Math.abs((d12 * d2 - d1 * d22) / denom);
          const newArgs = [...previewShape.args];
          const newPos = [...previewShape.position] as [number, number, number];

          if (activeTool === 'cone' || activeTool === 'pyramid') {
            newArgs[1] = height;
            newPos[0] = drawingStart.x + drawingNormal.x * (height / 2);
            newPos[1] = drawingStart.y + drawingNormal.y * (height / 2);
            newPos[2] = drawingStart.z + drawingNormal.z * (height / 2);
            setMeasurements(`Height: ${formatValue(height, unit, 1)}`);
          } else if (activeTool === 'donut') {
            newArgs[1] = height;
            setMeasurements(`Tube Radius: ${formatValue(height, unit, 1)}`);
          } else if (activeTool === 'dome') {
            // Adjust dome height factor or similar
            setMeasurements(`Height: ${formatValue(height, unit, 1)}`);
          }

          setPreviewShape({
            ...previewShape,
            args: newArgs,
            position: newPos
          });
        }
      }
    }

    if (pushPullState) {
      const ray = raycaster.ray;
      const p1 = pushPullState.startPoint;
      const v1 = pushPullState.normal;
      const p2 = ray.origin;
      const v2 = ray.direction;
      
      const v12 = new THREE.Vector3().subVectors(p1, p2);
      const d12 = v1.dot(v2);
      const d11 = v1.dot(v1);
      const d22 = v2.dot(v2);
      const d1 = v1.dot(v12);
      const d2 = v2.dot(v12);
      
      const denom = d11 * d22 - d12 * d12;
      if (Math.abs(denom) > 1e-6) {
        let dist = (d12 * d2 - d1 * d22) / denom;
        
        // Determine which axis to extrude along based on the LOCAL normal
        const axisIndex = Math.abs(pushPullState.localNormal.x) > 0.9 ? 0 : (Math.abs(pushPullState.localNormal.y) > 0.9 ? 1 : 2);
        
        // Snap to back face (Heal Rule preview)
        if (pushPullState.isSubFace && pushPullState.parentDepth) {
          const threshold = 0.15; // Even more generous threshold
          if (dist < -pushPullState.parentDepth + threshold && dist > -pushPullState.parentDepth - threshold) {
            dist = -pushPullState.parentDepth;
          }
        }

        const isRetracting = dist < 0;
        const newArgs = Array.isArray(pushPullState.initialArgs) ? [...pushPullState.initialArgs] : { ...pushPullState.initialArgs };
        const newPos = [...pushPullState.initialPos] as [number, number, number];
        
        // Update dimensions and position
        if (pushPullState.type === 'poly') {
          const polyInitialHeight = (pushPullState.initialArgs as any)?.height || 0;
          const isCap = polyInitialHeight === 0 || Math.abs(pushPullState.localNormal.z) > 0.5;
          if (isCap) {
            const currentHeight = polyInitialHeight;
            const newHeight = polyInitialHeight === 0 ? Math.abs(dist) : Math.max(0.001, currentHeight + dist);
            (newArgs as any).height = Math.max(0.001, newHeight);
            
            newPos[0] = pushPullState.initialPos[0] + (dist * pushPullState.normal.x) / 2;
            newPos[1] = pushPullState.initialPos[1] + (dist * pushPullState.normal.y) / 2;
            newPos[2] = pushPullState.initialPos[2] + (dist * pushPullState.normal.z) / 2;
          } else {
            // Task #148: push/pull only the ONE boundary edge that was actually clicked,
            // keeping every other vertex exactly where it was -- matching how pushing one
            // face of a box only changes that one dimension. The previous fix (Task #140)
            // offset every vertex outward by the same amount, which still inflated/deflated
            // the whole polygon and looked just like the Scale tool.
            const vertices = (pushPullState.initialArgs as any).vertices as [number, number][];
            const ei = pushPullState.edgeIndex;
            if (vertices && vertices.length >= 3 && ei !== undefined && ei < vertices.length) {
              const n = vertices.length;
              const a = vertices[ei];
              const b = vertices[(ei + 1) % n];
              const prev = vertices[(ei - 1 + n) % n];
              const next2 = vertices[(ei + 2) % n];

              const ex = b[0] - a[0], ey = b[1] - a[1];
              const elen = Math.hypot(ex, ey) || 1;
              let nx = -ey / elen, ny = ex / elen;
              let cx = 0, cy = 0;
              vertices.forEach(v => { cx += v[0]; cy += v[1]; });
              cx /= n; cy /= n;
              const midx = (a[0] + b[0]) / 2, midy = (a[1] + b[1]) / 2;
              if (nx * (midx - cx) + ny * (midy - cy) < 0) { nx = -nx; ny = -ny; }

              const a2x = a[0] + nx * dist, a2y = a[1] + ny * dist;

              const intersect = (p1x: number, p1y: number, d1x: number, d1y: number, p2x: number, p2y: number, d2x: number, d2y: number, fx: number, fy: number): [number, number] => {
                const denom = d1x * d2y - d1y * d2x;
                if (Math.abs(denom) < 1e-9) return [fx, fy];
                const t = ((p2x - p1x) * d2y - (p2y - p1y) * d2x) / denom;
                return [p1x + d1x * t, p1y + d1y * t];
              };

              const prevDx = a[0] - prev[0], prevDy = a[1] - prev[1];
              const nextDx = next2[0] - b[0], nextDy = next2[1] - b[1];
              const newA = intersect(prev[0], prev[1], prevDx, prevDy, a2x, a2y, ex, ey, a2x, a2y);
              const newB = intersect(b[0], b[1], nextDx, nextDy, a2x, a2y, ex, ey, a2x, a2y);

              const newVertices = vertices.map((v, i) => {
                if (i === ei) return newA;
                if (i === (ei + 1) % n) return newB;
                return v;
              });
              (newArgs as any).vertices = newVertices;
            }
          }
        } else if (pushPullState.type === 'circle' || pushPullState.type === 'triangle' || pushPullState.type === 'prism') {
        // Cylinder/Triangle prism axis is Y in Three.js default
        const isCap = Math.abs(pushPullState.localNormal.y) > 0.9;
          
          if (isCap) {
            const newDepth = pushPullState.initialArgs[2] + dist;
            newArgs[2] = Math.max(0.001, Math.abs(newDepth));
            // Move center along the normal for depth extrusion
            newPos[0] = pushPullState.initialPos[0] + (dist * pushPullState.normal.x) / 2;
            newPos[1] = pushPullState.initialPos[1] + (dist * pushPullState.normal.y) / 2;
            newPos[2] = pushPullState.initialPos[2] + (dist * pushPullState.normal.z) / 2;
          } else {
            // Extruding a side of a cylinder/prism
            const newRadius = pushPullState.initialArgs[0] + dist;
            newArgs[0] = Math.max(0.01, newRadius);
            newArgs[1] = Math.max(0.01, newRadius);
            // Center stays same for radial expansion
            newPos[0] = pushPullState.initialPos[0];
            newPos[1] = pushPullState.initialPos[1];
            newPos[2] = pushPullState.initialPos[2];
          }
        } else {
          // Box or Rect
          const currentSize = pushPullState.isSubFace ? 0 : (pushPullState.initialArgs[axisIndex] || 0.01);
          const newSize = currentSize + dist;
          newArgs[axisIndex] = Math.max(0.001, Math.abs(newSize));
          
          // Move center along the WORLD normal
          newPos[0] = pushPullState.initialPos[0] + (dist * pushPullState.normal.x) / 2;
          newPos[1] = pushPullState.initialPos[1] + (dist * pushPullState.normal.y) / 2;
          newPos[2] = pushPullState.initialPos[2] + (dist * pushPullState.normal.z) / 2;
        }
        
        setShapesSilent(prev => prev.map(s => {
          if (s.id === pushPullState.id) {
            const isHealed = pushPullState.isSubFace && pushPullState.parentDepth && dist <= -pushPullState.parentDepth + 0.1;
            let newType = s.type;
            if (Math.abs(dist) > 0.01) {
              if (s.type === 'rect') newType = 'box';
              else if (s.type === 'triangle') newType = 'prism';
            }
            return { 
              ...s, 
              type: newType,
              position: newPos, 
              args: newArgs,
              opacity: isRetracting && pushPullState.isSubFace ? 0.6 : 1,
              transparent: isRetracting && pushPullState.isSubFace,
              color: isHealed ? '#ff0000' : s.color // Bright red for heal
            };
          }
          return s;
        }));

        // Unit Display
        setMeasurements(formatValue(Math.abs(dist), unit, 2));
      }
    }
    if (bevelState) {
      const deltaX = e.nativeEvent.clientX - bevelState.startX;
      const amount = Math.max(0, bevelState.initialAmount + deltaX * (bevelState.maxRadius > 0 ? bevelState.maxRadius / 300 : 0.001));
      
      const shape = shapes.find(s => s.id === bevelState.id);
      if (shape) {
        let minEdge = 1;
        if (shape.type === 'box' || shape.type === 'rect') {
          minEdge = Math.min(...shape.args);
        }
        const maxRadius =
          (shape.type === 'circle' || shape.type === 'triangle' || shape.type === 'prism')
            ? Math.max(0.01, Math.min(shape.args[0], shape.args[2] / 2))
            : shape.type === 'poly'
              ? Math.max(0.01, ((shape.args as any)?.height || 1) / 2)
              : minEdge / 2;
        const clampedAmount = Math.min(amount, maxRadius);
        
        let segments = 3;
        if (bevelState.type === 'radius') {
          // Cap smoothness at 8 - visually indistinguishable from higher values but far
          // cheaper to rebuild every pointermove during a drag. The old formula
          // (clampedAmount * 200) could ask RoundedBox for 100+ segments on a modest
          // drag, rebuilding a very dense geometry on every mouse-move frame - this was
          // the cause of Radius bevel feeling much slower than Chamfer.
          segments = Math.min(8, Math.max(3, Math.floor(clampedAmount * 20)));
        } else {
          segments = 1;
        }

        setShapesSilent(prev => prev.map(s => s.id === bevelState.id ? {
          ...s,
          bevelAmount: clampedAmount,
          bevelType: bevelState.type,
          bevelSegments: segments
        } : s));
        
        setMeasurements(`Bevel: ${formatValue(clampedAmount, unit, 1)}`);
      }
    }
  };

  const performTunnelSplit = (
    parentId: string, 
    subFaceId?: string, 
    faceIndex: number = 4, 
    subFaceIndex?: number,
    customBounds?: { minU: number; maxU: number; minV: number; maxV: number },
    cutDepth?: number
  ) => {
    const parent = shapes.find(s => s.id === parentId);
    if (!parent || (parent.type !== 'box' && parent.type !== 'rect')) return;

    const args = Array.isArray(parent.args) ? parent.args : [1, 1, 1];
    const [W, H, D] = args;
    
    let size: [number, number] = [1, 1];
    let depth = 1;
    if (faceIndex <= 3) { size = [D, H]; depth = W; }
    else if (faceIndex <= 7) { size = [W, D]; depth = H; }
    else { size = [W, H]; depth = D; }
    
    let minU = 0, maxU = 0, minV = 0, maxV = 0;
    if (customBounds) {
      minU = customBounds.minU;
      maxU = customBounds.maxU;
      minV = customBounds.minV;
      maxV = customBounds.maxV;
    } else if (subFaceIndex !== undefined) {
      const division = parent.surfaceDivisions?.[faceIndex];
      const [gridX, gridY] = getGridDimensions(division);
      const cellW = size[0] / gridX;
      const cellH = size[1] / gridY;
      const ix = subFaceIndex % gridX;
      const iy = Math.floor(subFaceIndex / gridX);
      const hx = -size[0]/2 + cellW/2 + ix * cellW;
      const hy = -size[1]/2 + cellH/2 + iy * cellH;
      minU = hx - cellW / 2;
      maxU = hx + cellW / 2;
      minV = hy - cellH / 2;
      maxV = hy + cellH / 2;
    } else {
      return;
    }

    minU = Math.max(-size[0]/2, Math.min(size[0]/2, minU));
    maxU = Math.max(-size[0]/2, Math.min(size[0]/2, maxU));
    minV = Math.max(-size[1]/2, Math.min(size[1]/2, minV));
    maxV = Math.max(-size[1]/2, Math.min(size[1]/2, maxV));

    const holeW = maxU - minU;
    const holeH = maxV - minV;
    if (holeW <= 0.001 || holeH <= 0.001) return;

    const actualCutDepth = (cutDepth !== undefined && cutDepth > 0 && cutDepth < depth - 0.02) ? cutDepth : depth;
    const isThroughCut = actualCutDepth >= depth - 0.02;

    const parentQuat = new THREE.Quaternion(...(parent.quaternion || [0,0,0,1]));
    const parentPos = new THREE.Vector3(...parent.position);

    let rot = new THREE.Euler();
    if (faceIndex <= 1) rot.set(0, Math.PI/2, 0);
    else if (faceIndex <= 3) rot.set(0, -Math.PI/2, 0);
    else if (faceIndex <= 5) rot.set(-Math.PI/2, 0, 0);
    else if (faceIndex <= 7) rot.set(Math.PI/2, 0, 0);
    else if (faceIndex <= 9) rot.set(0, 0, 0);
    else if (faceIndex <= 11) rot.set(0, Math.PI, 0);
    
    const faceQuat = new THREE.Quaternion().setFromEuler(rot);
    const worldQuat = parentQuat.clone().multiply(faceQuat);

    const newSideShapes: Shape[] = [];
    const addPiece = (lx: number, ly: number, lw: number, lh: number, pieceDepth: number, zCenterOffset: number) => {
      if (lw <= 0.001 || lh <= 0.001 || pieceDepth <= 0.001) return;
      
      const localPos = new THREE.Vector3(lx, ly, zCenterOffset);
      const worldPos = localPos.clone().applyQuaternion(faceQuat).applyQuaternion(parentQuat).add(parentPos);
      
      newSideShapes.push({
        id: Math.random().toString(36).substr(2, 9),
        type: 'box',
        position: [worldPos.x, worldPos.y, worldPos.z],
        quaternion: [worldQuat.x, worldQuat.y, worldQuat.z, worldQuat.w],
        args: [lw, lh, pieceDepth],
        color: parent.color,
        roughness: parent.roughness,
        metalness: parent.metalness,
        opacity: parent.opacity
      });
    };

    const frameZ = depth / 2 - actualCutDepth / 2;

    // 1. Left side piece
    const leftW = minU - (-size[0]/2);
    if (leftW > 0.001) {
      addPiece(-size[0]/2 + leftW/2, 0, leftW, size[1], actualCutDepth, frameZ);
    }
    // 2. Right side piece
    const rightW = (size[0]/2) - maxU;
    if (rightW > 0.001) {
      addPiece(maxU + rightW/2, 0, rightW, size[1], actualCutDepth, frameZ);
    }
    // 3. Top piece (between minU and maxU)
    const topH = (size[1]/2) - maxV;
    if (topH > 0.001) {
      addPiece((minU + maxU)/2, maxV + topH/2, holeW, topH, actualCutDepth, frameZ);
    }
    // 4. Bottom piece (between minU and maxU)
    const bottomH = minV - (-size[1]/2);
    if (bottomH > 0.001) {
      addPiece((minU + maxU)/2, -size[1]/2 + bottomH/2, holeW, bottomH, actualCutDepth, frameZ);
    }

    // 5. If this is a pocket/recess (not a through cut), add the solid backing base:
    if (!isThroughCut) {
      const baseDepth = depth - actualCutDepth;
      const baseZ = -depth / 2 + baseDepth / 2;
      addPiece(0, 0, size[0], size[1], baseDepth, baseZ);
    }

    setShapes(prev => {
      const filtered = prev.filter(s => s.id !== parentId && (!subFaceId || s.id !== subFaceId));
      return [...filtered, ...newSideShapes];
    });
  };

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    if (e?.stopPropagation) e.stopPropagation();
    if (pointerUpHandledRef.current) return;
    pointerUpHandledRef.current = true;

    if (isSculptingDragRef.current) {
      isSculptingDragRef.current = false;
      commitHistory();
    }

    // Task #158 fix: use the ref (always current) instead of the closure variable.
    // On a plain click, pointerdown creates pushPullState and pointerup fires in the
    // same synchronous browser event tick, before React has re-rendered -- so the
    // closure's pushPullState would still read as null/stale here without this.
    const pushPullState = pushPullStateRef.current;

    if (activeTool === 'wall' && wallDragStartRef.current) {
      const dragInfo = wallDragStartRef.current;
      const currPos = wallCandidatePos ? wallCandidatePos.clone() : e.point.clone();
      const dragDist = dragInfo.point.distanceTo(currPos);
      const dragTime = Date.now() - dragInfo.time;

      if (dragDist >= 0.35 && dragTime > 60) {
        if (wallVertices.length <= 1) {
          createWallSegment(dragInfo.point, currPos);
          setWallVertices([currPos]);
          setWallPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -currPos.y));
        } else {
          const lastVertex = wallVertices[wallVertices.length - 2];
          createWallSegment(lastVertex, currPos);
          setWallVertices(prev => [...prev.slice(0, -1), currPos]);
        }
      }
      wallDragStartRef.current = null;
    }

    // Detect single click for Rectangle Input
    if (activeTool === 'rectangle' && pointerDownInfo) {
      const timeDiff = Date.now() - pointerDownInfo.time;
      const distDiff = e.point.distanceTo(pointerDownInfo.pos);
      if (timeDiff < 250 && distDiff < 0.1) {
                setRectangleInputState({ active: true, startPoint: e.point.clone(), normal: drawingNormal ? { x: drawingNormal.x, y: drawingNormal.y, z: drawingNormal.z } : null, width: '', depth: '' });
        setDrawingStart(null);
        setDrawingNormal(null);
        setDrawingStep(0);
        setPreviewShape(null);
        setPointerDownInfo(null);
        return;
      }
    }
    setPointerDownInfo(null);

    if (bevelState) {
      commitHistory();
      const shape = shapes.find(s => s.id === bevelState.id);
      if (shape) {
        recordAction(`const obj = sdk.getObjectByName("${shape.id}");\nif (obj) {\n  sdk.setBevel(obj, {\n    amount: ${shape.bevelAmount},\n    type: "${shape.bevelType}",\n    segments: ${shape.bevelSegments}\n  });\n}`);
      }
      setBevelState(null);
      setMeasurements('');
    }
    if (drawingStart && drawingNormal) {
      const needsHeight = ['cone', 'pyramid', 'donut', 'dome'].includes(activeTool);
      
      if (needsHeight && drawingStep === 1) {
        setDrawingStep(2);
        return;
      }

      if (previewShape && previewShape.type === 'line') {
        // A line is now a real EDGE in the geometry kernel, not a thin
        // cylinder Shape. That is what lets four lines in a closed loop
        // derive a surface, and a fifth across it split that surface in two.
        //
        // Reconstruct the endpoints from the preview: its position is the
        // midpoint, its quaternion the direction, args[2] the length.
        const lq = new THREE.Quaternion(
          previewShape.quaternion[0], previewShape.quaternion[1],
          previewShape.quaternion[2], previewShape.quaternion[3]
        );
        const ldir = new THREE.Vector3(0, 1, 0).applyQuaternion(lq);
        const lmid = new THREE.Vector3(
          previewShape.position[0], previewShape.position[1], previewShape.position[2]
        );
        const llen = Array.isArray(previewShape.args) ? (previewShape.args[2] as number) : 0;
        const half = llen / 2;
        lineBinding.commitDrag(
          lmid.clone().addScaledVector(ldir, -half),
          lmid.clone().addScaledVector(ldir, half)
        );
      } else if (previewShape) {
        addShape({
          id: Math.random().toString(36).substr(2, 9),
          type: previewShape.type,
          position: previewShape.position,
          quaternion: previewShape.quaternion,
          args: previewShape.args,
          color: activeMaterial,
          roughness: activePBR.roughness,
          metalness: activePBR.metalness,
          opacity: activePBR.opacity
        });
      } else if (['step', 'staircase'].includes(activeTool)) {
        // Direct click placement fallback
        const pos = drawingStart.clone();
        let args: any = [1, 1, 1];
        let offsetHeight = 0;
        if (activeTool === 'step') {
          args = [1.0, 0.18, 0.30];
          offsetHeight = 0.09;
        } else if (activeTool === 'staircase') {
          args = [1.0, 2.16, 3.6, 12];
          offsetHeight = 1.08;
        }
        pos.add(drawingNormal.clone().multiplyScalar(offsetHeight));
        addShape({
          id: Math.random().toString(36).substr(2, 9),
          type: activeTool as Shape['type'],
          position: [pos.x, pos.y, pos.z],
          quaternion: [0, 0, 0, 1],
          args,
          color: activeMaterial,
          roughness: activePBR.roughness,
          metalness: activePBR.metalness,
          opacity: activePBR.opacity
        });
      }
      if (previewShape && previewShape.type === 'line' && drawingNormal) {
        const lineQuat = new THREE.Quaternion(previewShape.quaternion[0], previewShape.quaternion[1], previewShape.quaternion[2], previewShape.quaternion[3]);
        const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(lineQuat);
        const mid = new THREE.Vector3(previewShape.position[0], previewShape.position[1], previewShape.position[2]);
        const lineArgs = previewShape.args as number[];
        const halfLen = (Array.isArray(lineArgs) ? lineArgs[2] : 0) / 2;
        const lp1 = mid.clone().addScaledVector(dir, -halfLen);
        const lp2 = mid.clone().addScaledVector(dir, halfLen);
        const crossing = tryAutoDivideOnLineCrossing(lp1, lp2, drawingNormal.clone(), shapes);
        if (crossing) {
          const otherIdx = crossing.faceIdx % 2 === 0 ? crossing.faceIdx + 1 : crossing.faceIdx - 1;
          setShapes(prev => prev.map(s => {
            if (s.id !== crossing.shapeId) return s;
            const sd = s.surfaceDivisions || {};
            return { ...s, surfaceDivisions: { ...sd, [crossing.faceIdx]: [crossing.gridX, crossing.gridY], [otherIdx]: [crossing.gridX, crossing.gridY] } };
          }));
        }
      }
      
      setDrawingStart(null);
      setDrawingNormal(null);
      setDrawingOnId(null);
      setPreviewShape(null);
      setDrawingStep(0);
      setTrackingGuide(null);
      awakenedRefPointsRef.current = [];
    }

    if (pushPullState) {
      const shape = shapes.find(s => s.id === pushPullState.id);
      if (shape) {
        const currentPos = new THREE.Vector3(...shape.position);
        const initialPos = new THREE.Vector3(...pushPullState.initialPos);
        // dist here is the movement of the center. The face movement is 2x this for centered extrusions (box, rect, poly, circle, triangle, prism).
        const centerDist = currentPos.distanceTo(initialPos) * (currentPos.clone().sub(initialPos).dot(pushPullState.normal) >= 0 ? 1 : -1);
        const faceDist = centerDist * 2;

        // Task #158: click-to-start / click-to-commit support, alongside the existing
        // click-and-drag gesture. If the mouse barely moved between down and up (a plain
        // click, not a drag) and we haven't already armed this gesture, don't finalize yet --
        // arm it and keep pushPullState alive so hovering continues to live-preview the push,
        // and the NEXT click (handled in handleMeshPointerDown below) commits it. A real
        // click-and-drag still finalizes immediately here since faceDist is already non-trivial
        // by the time the button is released.
        if (Math.abs(faceDist) < 0.02 && !pushPullState.clickCommitArmed) {
          setPushPullStateSync({ ...pushPullState, clickCommitArmed: true });
          return;
        }

        if (pushPullState.isSubFace && pushPullState.parentShapeId) {
          // Heal Rule / Through-Cut / Pocket Rebate Rule:
          if (Math.abs(faceDist) < 0.001) {
            removeShape(pushPullState.id);
          } else if (pushPullState.parentDepth && faceDist <= -pushPullState.parentDepth + 0.1) {
            // Create hole / through-cut cavity
            performTunnelSplit(pushPullState.parentShapeId, pushPullState.id, pushPullState.faceIndex ?? 4, pushPullState.subFaceIndex, pushPullState.customBounds);
            commitHistory();
          } else if (faceDist < -0.01 && pushPullState.parentDepth) {
            // Create recessed pocket / rebate
            performTunnelSplit(pushPullState.parentShapeId, pushPullState.id, pushPullState.faceIndex ?? 4, pushPullState.subFaceIndex, pushPullState.customBounds, Math.abs(faceDist));
            commitHistory();
          } else {
            // Finalize extrusion (step/boss upwards)
            setShapes(prev => prev.map(s => {
              if (s.id === pushPullState.id) {
                let newType = s.type;
                if (s.type === 'rect') newType = 'box';
                else if (s.type === 'triangle') newType = 'prism';
                return { ...s, type: newType, opacity: 1, transparent: false, parentShapeId: undefined };
              }
              return s;
            }));
            commitHistory();
          }
        } else {
          // Whole face push/pull
          if (Math.abs(faceDist) > 0.01) {
            // Check if it shrunk to near zero
            const minArg = Array.isArray(shape.args) ? Math.min(...shape.args) : (shape.args.height || 0.1);
            if (minArg < 0.01) {
              removeShape(shape.id);
            } else {
              setShapes(prev => prev.map(s => {
                if (s.id === pushPullState.id) {
                  let newType = s.type;
                  if (s.type === 'rect') newType = 'box';
                  else if (s.type === 'triangle') newType = 'prism';
                  return { ...s, type: newType };
                }
                return s;
              }));
              commitHistory();
            }
          }
        }
      }
      setPushPullStateSync(null);
      setMeasurements('');
    }
  };

  const handleMeshDoubleClick = (e: ThreeEvent<MouseEvent>, id: string) => {
    e.stopPropagation();
    if (activeTool === 'wall' && wallVertices.length > 0) {
      finalizeWallChain();
      return;
    }
    if (activeTool === 'select') {
      if (e.faceIndex !== undefined) {
        const shape = shapes.find(s => s.id === id);
        let subFaceIndex: number | undefined = undefined;
        if (shape && shape.surfaceDivisions && shape.surfaceDivisions[e.faceIndex] && e.uv) {
          const division = shape.surfaceDivisions[e.faceIndex];
          const [gridX, gridY] = getGridDimensions(division);
          const ix = Math.floor(e.uv.x * gridX);
          const iy = Math.floor(e.uv.y * gridY);
          subFaceIndex = ix + iy * gridX;
        }
        setSelectedSurface({ shapeId: id, faceIndex: e.faceIndex, subFaceIndex });
        setFaceEditMode(id);
        setSelectedId(null);
        setSelectedIds([]);
        setSelectedLightId(null);
      }
    }
  };

  const handleMeshClick = (e: ThreeEvent<MouseEvent>, id: string) => {
    e.stopPropagation();
    
    const shape = shapes.find(s => s.id === id);
    let subFaceIndex: number | undefined = undefined;
    if (shape && shape.surfaceDivisions && e.faceIndex !== undefined && shape.surfaceDivisions[e.faceIndex] && e.uv) {
      const division = shape.surfaceDivisions[e.faceIndex];
      const [gridX, gridY] = getGridDimensions(division);
      const ix = Math.floor(e.uv.x * gridX);
      const iy = Math.floor(e.uv.y * gridY);
      subFaceIndex = ix + iy * gridX;
    }

    if (activeTagId) {
      setShapes(prev => prev.map(s => {
        if (s.id === id) {
          const currentTags = s.tags || [];
          if (currentTags.includes(activeTagId)) return s;
          return { ...s, tags: [...currentTags, activeTagId] };
        }
        return s;
      }));
      return;
    }

    if (activeTool === 'select') {
      if (e.shiftKey) {
        setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
        setSelectedId(null);
      } else {
        setSelectedId(id === selectedId ? null : id);
        setSelectedIds([id]);
      }
      if (subFaceIndex !== undefined) {
        setSelectedSurface({ shapeId: id, faceIndex: e.faceIndex!, subFaceIndex });
      } else {
        setSelectedSurface(null);
      }
      setSelectedLightId(null);
    } else if (activeTool === 'paint') {
    if (!e.shiftKey && subFaceIndex !== undefined) {
      // Apply to sub-face
      const key = `${e.faceIndex}-${subFaceIndex}`;
      setShapes(prev => prev.map(s => {
        if (s.id === id) {
          return {
            ...s,
            surfaceMaterials: {
              ...(s.surfaceMaterials || {}),
              [key]: activeMaterial
            }
          };
        }
        return s;
      }));
    } else if (!e.shiftKey && shape && shape.type === 'box' && !shape.bevelAmount && e.faceIndex !== undefined) {
      // Apply to a single box face (each face = 2 triangles; normalize to the even index the renderer expects)
      const faceKey = Math.floor(e.faceIndex / 2) * 2;
      setShapes(prev => prev.map(s => {
        if (s.id === id) {
          return {
            ...s,
            surfaceMaterials: {
              ...(s.surfaceMaterials || {}),
              [faceKey]: activeMaterial
            }
          };
        }
        return s;
      }));
    } else {
      // Apply to whole object (default for shapes without per-face support, or forced via Shift+click)
      updateShapeColor(id, activeMaterial, activePBR);
    }
  } else if (activeTool === 'offset') {
      if (offsetPreviewPoints && offsetPreviewPoints.length > 2 && selectedId) {
        const srcShape = shapes.find(s => s.id === selectedId && (s.type === 'poly' || s.type === 'box' || s.type === 'rect' || s.type === 'circle' || s.type === 'triangle' || s.type === 'prism'));
        if (srcShape) {
          const qArr = (srcShape as any).quaternion || [0, 0, 0, 1];
          const baseQuat = new THREE.Quaternion(qArr[0], qArr[1], qArr[2], qArr[3]);
          const center = new THREE.Vector3(srcShape.position[0], srcShape.position[1], srcShape.position[2]);
          const isBoxLike = srcShape.type === 'box' || srcShape.type === 'rect';
      const isSolidType = isBoxLike || srcShape.type === 'circle' || srcShape.type === 'triangle' || srcShape.type === 'prism';
          const faceKey = isBoxLike ? (typeof offsetFaceKey === 'number' ? offsetFaceKey : 4) : 4;
          const { poly2D: srcPoly2D, normalLocal, uLocal, vLocal, faceOriginLocal } = getOffsetSourcePoly2D(srcShape, faceKey);
      // Only keep the original solid underneath the new ring/inner when it is a genuinely thick 3D
      // object (e.g. offsetting one face of an already-extruded box/prism) -- for a flat, freshly-drawn
      // primitive (the default ~0.01 thickness) keeping it around just sits a nearly-coincident duplicate
      // under the ring, which raycasting can hit instead of the ring/inner (Task #147: hover highlight
      // showing the whole surface, and losing the ability to hover/push-pull the offset ring's inner face).
      const isSolid = isSolidType && faceOriginLocal.length() > 0.05;
          const normalWorld = normalLocal.clone().applyQuaternion(baseQuat);
          const uWorld = uLocal.clone().applyQuaternion(baseQuat);
          const vWorld = vLocal.clone().applyQuaternion(baseQuat);
          const faceOrigin = center.clone().add(faceOriginLocal.clone().applyQuaternion(baseQuat));
          const innerPts2D: [number, number][] = offsetPreviewPoints.slice(0, -1).map((p: THREE.Vector3) => { const rel = p.clone().sub(faceOrigin); return [rel.dot(uWorld), rel.dot(vWorld)] as [number, number]; });
          const outerPts2D: [number, number][] = srcPoly2D.map(p => [p.x, p.y] as [number, number]);
          const signedAreaOf = (pts: [number, number][]) => { let a = 0; for (let i = 0; i < pts.length; i++) { const p1 = pts[i], p2 = pts[(i + 1) % pts.length]; a += p1[0] * p2[1] - p2[0] * p1[1]; } return a / 2; };
          const holePts = ((signedAreaOf(innerPts2D) < 0) === (signedAreaOf(outerPts2D) < 0)) ? [...innerPts2D].reverse() : innerPts2D;
          const overlayOffset = isSolid ? 0.003 : 0;
          const overlayPos = faceOrigin.clone().add(normalWorld.clone().multiplyScalar(overlayOffset));
          const ringQuat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(uWorld, vWorld, normalWorld));
          const ringId = Math.random().toString(36).substring(2, 9);
          const innerId = Math.random().toString(36).substring(2, 9);

          const boxArgs = Array.isArray(srcShape.args) ? srcShape.args : [1, 1, 1];
          const depth = (faceKey <= 3) ? boxArgs[0] : (faceKey <= 7 ? boxArgs[1] : boxArgs[2]);
          const minU = Math.min(...innerPts2D.map(p => p[0]));
          const maxU = Math.max(...innerPts2D.map(p => p[0]));
          const minV = Math.min(...innerPts2D.map(p => p[1]));
          const maxV = Math.max(...innerPts2D.map(p => p[1]));

          const ringShape: Shape = { 
            ...srcShape, 
            id: ringId, 
            type: 'poly', 
            position: [overlayPos.x, overlayPos.y, overlayPos.z], 
            quaternion: [ringQuat.x, ringQuat.y, ringQuat.z, ringQuat.w], 
            bevelAmount: 0, 
            args: { vertices: outerPts2D, height: 0, holes: [holePts] },
            parentShapeId: isSolid ? srcShape.id : undefined,
            parentDepth: isSolid ? depth : undefined,
            faceIndex: isSolid ? faceKey : undefined,
            isRingSection: true
          };
          const innerShape: Shape = { 
            ...srcShape, 
            id: innerId, 
            type: 'poly', 
            position: [overlayPos.x, overlayPos.y, overlayPos.z], 
            quaternion: [ringQuat.x, ringQuat.y, ringQuat.z, ringQuat.w], 
            bevelAmount: 0, 
            args: { vertices: innerPts2D, height: 0 },
            parentShapeId: isSolid ? srcShape.id : undefined,
            parentDepth: isSolid ? depth : undefined,
            faceIndex: isSolid ? faceKey : undefined,
            customBounds: isSolid ? { minU, maxU, minV, maxV } : undefined
          };
          if (!isSolid) { removeShape(selectedId); }
          addShape(ringShape);
          addShape(innerShape);
          setSelectedId(innerId);
          setSelectedIds([innerId]);
          commitHistory();
        }
      }
      setOffsetPreviewPoints(null);
      setOffsetPreviewDistance(null);
      setOffsetFaceKey(null);
      setMeasurements('');
    } else if (activeTool === 'eraser') {
      if (subFaceIndex !== undefined) {
        const key = `${e.faceIndex}-${subFaceIndex}`;
        setShapes(prev => prev.map(s => {
          if (s.id === id) {
            const newSurfaceMaterials = { ...(s.surfaceMaterials || {}) };
            delete newSurfaceMaterials[key];
            return { ...s, surfaceMaterials: newSurfaceMaterials };
          }
          return s;
        }));
      } else {
        removeShape(id);
      }
    }
  };


  const handleContextMenu = (e: any, id: string, type: 'shape' | 'light' | 'surface' = 'shape') => {
    e.stopPropagation();
    if (e.nativeEvent) e.nativeEvent.preventDefault();
    else if (e.preventDefault) e.preventDefault();
    
    const clientX = e.nativeEvent?.clientX || e.clientX;
    const clientY = e.nativeEvent?.clientY || e.clientY;

    if (type === 'light') {
      setSelectedLightId(id);
      setSelectedId(null);
      setSelectedIds([]);
      setSelectedSurface(null);
      setContextMenu({ x: clientX, y: clientY, type: 'light', data: id });
      return;
    }

    // Check if we clicked on a surface
    let subFaceIndex: number | undefined = undefined;
    const shape = shapes.find(s => s.id === id);
    if (shape && e.faceIndex !== undefined) {
      if (shape.surfaceDivisions && shape.surfaceDivisions[e.faceIndex] && e.uv) {
        const division = shape.surfaceDivisions[e.faceIndex];
        const [gridX, gridY] = getGridDimensions(division);
        const eps = 0.0001;
        const ix = Math.min(gridX - 1, Math.max(0, Math.floor((e.uv.x + eps) * gridX)));
        const iy = Math.min(gridY - 1, Math.max(0, Math.floor((e.uv.y + eps) * gridY)));
        subFaceIndex = ix + iy * gridX;
      }
      
      const surface = { shapeId: id, faceIndex: e.faceIndex, subFaceIndex };
      setSelectedSurface(surface);
      setSelectedId(id);
      setSelectedIds([id]);
      setContextMenu({ x: clientX, y: clientY, type: 'surface', data: surface });
      return;
    }

    // If we have multiple objects selected and clicked on one of them
    if (selectedIds.length >= 2 && selectedIds.includes(id)) {
      setContextMenu({ x: clientX, y: clientY, type: 'multi', data: selectedIds });
    }
    // Otherwise, select the object and show context menu for it
    else {
      setSelectedId(id);
      setSelectedIds([id]);
      setSelectedSurface(null);
      setContextMenu({ x: clientX, y: clientY, type: 'multi', data: [id] });
    }
  };


  const handleApplyMaterialToSurface = (material: string) => {
    if (!selectedSurface) return;
    setShapes(prev => prev.map(s => {
      if (s.id === selectedSurface.shapeId) {
        const surfaceMaterials = s.surfaceMaterials || {};
        return { ...s, surfaceMaterials: { ...surfaceMaterials, [selectedSurface.faceIndex]: material } };
      }
      return s;
    }));
    setContextMenu(null);
  };

  const handleMeshPointerDown = (e: ThreeEvent<PointerEvent>, shape: Shape) => {
    pointerUpHandledRef.current = false;
    if (placingLightId) {
      e.stopPropagation();
      setCustomLights(prev => prev.map(l => l.id === placingLightId ? { ...l, position: [e.point.x, e.point.y, e.point.z] } : l));
      setPlacingLightId(null);
      return;
    }

    if (placingAnimationId) {
      e.stopPropagation();
      setAnimations(prev => prev.map(a => a.id === placingAnimationId ? { ...a, position: [e.point.x, e.point.y, e.point.z] } : a));
      setPlacingAnimationId(null);
      return;
    }

    if (activeTool === 'note') {
      e.stopPropagation();
      setPlacingNotePos(e.point.clone());
      return;
    }

    if (activeTool === 'subtract') {
       e.stopPropagation();
       if (!subtractTargetId) {
         setSubtractTargetId(shape.id);
         setConsoleOutput(prev => [...prev, `[INFO] Target selected: ${shape.type}. Now select the cutter.`]);
       } else if (subtractTargetId === shape.id) {
         setSubtractTargetId(null);
         setConsoleOutput(prev => [...prev, `[INFO] Target deselected.`]);
       } else {
         performCSGOperation(subtractTargetId, shape.id, 'SUBTRACTION');
         setSubtractTargetId(null);
       }
       return;
    }
    
    // Task #158: if a push/pull gesture is already armed (waiting for a second click
    // to commit, per the click-to-start/click-to-commit UX below), treat this next click
    // as the commit rather than starting a brand new push/pull from scratch.
    if (activeTool === 'pushpull' && pushPullState && (pushPullState as any).clickCommitArmed) {
      e.stopPropagation();
      handlePointerUp(e as any);
      return;
    }
    if (activeTool === 'pushpull') {
      e.stopPropagation();
      
      let subFaceIndex: number | undefined = undefined;
      let gridX = 1;
      let gridY = 1;
      if (shape.surfaceDivisions && e.faceIndex !== undefined && shape.surfaceDivisions[e.faceIndex] && e.uv) {
        const division = shape.surfaceDivisions[e.faceIndex];
        [gridX, gridY] = getGridDimensions(division);
        const eps = 0.0001;
        const ix = Math.min(gridX - 1, Math.max(0, Math.floor((e.uv.x + eps) * gridX)));
        const iy = Math.min(gridY - 1, Math.max(0, Math.floor((e.uv.y + eps) * gridY)));
        subFaceIndex = ix + iy * gridX;
      }

      const shapeQuat = new THREE.Quaternion(...(shape.quaternion || [0, 0, 0, 1]));
      let localNormal = e.face?.normal ? e.face.normal.clone() : (shape.type === 'poly' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0));

      if (shape.type === 'poly') {
        const polyH = (shape.args as any)?.height || 0;
        if (polyH === 0) {
          // Flat poly / offset surface / ring: local normal is strictly +Z
          localNormal = new THREE.Vector3(0, 0, 1);
        } else if (Math.abs(localNormal.z) > 0.5) {
          // Top or bottom cap of extruded poly
          localNormal = localNormal.z >= 0 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 0, -1);
        }
      } else if (shape.type === 'circle' || shape.type === 'triangle' || shape.type === 'prism') {
        if (Math.abs(localNormal.y) > 0.5) {
          localNormal = localNormal.y >= 0 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, -1, 0);
        }
      } else if (shape.type === 'box' || shape.type === 'rect') {
        const ax = Math.abs(localNormal.x), ay = Math.abs(localNormal.y), az = Math.abs(localNormal.z);
        if (ax >= ay && ax >= az) {
          localNormal = new THREE.Vector3(Math.sign(localNormal.x) || 1, 0, 0);
        } else if (ay >= ax && ay >= az) {
          localNormal = new THREE.Vector3(0, Math.sign(localNormal.y) || 1, 0);
        } else {
          localNormal = new THREE.Vector3(0, 0, Math.sign(localNormal.z) || 1);
        }
      }

      const worldNormal = localNormal.clone().applyQuaternion(shapeQuat).normalize();

      if (shape.type === 'prism') {
        const radialSegments = shape.args[3] || 3;
        if (e.faceIndex !== undefined && e.faceIndex < radialSegments * 2) {
          // Side face of a prism - create a new box for extrusion
          const radius = shape.args[0];
          const height = shape.args[2];
          const sideWidth = 2 * radius * Math.sin(Math.PI / radialSegments);
          
          const sideIndex = Math.floor(e.faceIndex / 2);
          const angle = (sideIndex * (2 * Math.PI / radialSegments)) + (Math.PI / radialSegments);
          
          const dist = radius * Math.cos(Math.PI / radialSegments);
          const localFacePos = new THREE.Vector3(
            dist * Math.sin(angle),
            0,
            dist * Math.cos(angle)
          );
          
          const worldPos = localFacePos.clone().applyQuaternion(new THREE.Quaternion(...(shape.quaternion || [0,0,0,1]))).add(new THREE.Vector3(...shape.position));
          
          const newId = Math.random().toString(36).substr(2, 9);
          const newShape: Shape = {
            id: newId,
            type: 'box',
            position: [worldPos.x, worldPos.y, worldPos.z],
            quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0)).multiply(new THREE.Quaternion(...(shape.quaternion || [0,0,0,1]))).toArray() as [number, number, number, number],
            args: [sideWidth, height, 0.01],
            color: shape.color,
            roughness: shape.roughness,
            metalness: shape.metalness,
            opacity: shape.opacity
          };
          
          addShape(newShape);
          
          setPushPullStateSync({
            id: newId,
            type: 'box',
            initialPos: newShape.position,
            initialArgs: newShape.args,
            normal: worldNormal,
            localNormal: new THREE.Vector3(0, 0, 1),
            startPoint: e.point.clone(),
            isSubFace: true,
            parentShapeId: shape.id,
            faceIndex: e.faceIndex,
            parentDepth: radius
          });
          return;
        }
      }

      if (subFaceIndex !== undefined && e.faceIndex !== undefined && shape.type === 'box') {
        // ... (existing sub-face logic)
        // Create new shape for extrusion
        const w = shape.args[0];
        const h = shape.args[1];
        const d = shape.args[2];
        
        let size: [number, number] = [1, 1];
        if (e.faceIndex <= 3) size = [d, h];
        else if (e.faceIndex <= 7) size = [w, d];
        else size = [w, h];
        
        const cellW = size[0] / gridX;
        const cellH = size[1] / gridY;
        
        // Calculate cell center in local coordinates of the face
        const ix = subFaceIndex % gridX;
        const iy = Math.floor(subFaceIndex / gridX);
        const localFaceX = -size[0]/2 + cellW/2 + ix * cellW;
        const localFaceY = -size[1]/2 + cellH/2 + iy * cellH;
        
        // Map face local to box local
        let boxLocalPos = new THREE.Vector3();
        let boxLocalArgs: [number, number, number] = [0.01, 0.01, 0.01];
        
        if (e.faceIndex <= 1) { 
          boxLocalPos.set(w/2, localFaceY, -localFaceX); 
          boxLocalArgs = [0.01, cellH, cellW];
        } else if (e.faceIndex <= 3) { 
          boxLocalPos.set(-w/2, localFaceY, localFaceX); 
          boxLocalArgs = [0.01, cellH, cellW];
        } else if (e.faceIndex <= 5) { 
          boxLocalPos.set(localFaceX, h/2, -localFaceY); 
          boxLocalArgs = [cellW, 0.01, cellH];
        } else if (e.faceIndex <= 7) { 
          boxLocalPos.set(localFaceX, -h/2, localFaceY); 
          boxLocalArgs = [cellW, 0.01, cellH];
        } else if (e.faceIndex <= 9) { 
          boxLocalPos.set(localFaceX, localFaceY, d/2); 
          boxLocalArgs = [cellW, cellH, 0.01];
        } else if (e.faceIndex <= 11) { 
          boxLocalPos.set(-localFaceX, localFaceY, -d/2); 
          boxLocalArgs = [cellW, cellH, 0.01];
        }
        
        const worldPos = boxLocalPos.clone().applyQuaternion(new THREE.Quaternion(...(shape.quaternion || [0,0,0,1]))).add(new THREE.Vector3(...shape.position));
        
        const newId = Math.random().toString(36).substr(2, 9);
        const newShape: Shape = {
          id: newId,
          type: 'box',
          position: [worldPos.x, worldPos.y, worldPos.z],
          quaternion: shape.quaternion,
          args: boxLocalArgs,
          color: shape.surfaceMaterials?.[`${e.faceIndex}-${subFaceIndex}`] || shape.color,
          roughness: shape.roughness,
          metalness: shape.metalness,
          opacity: shape.opacity
        };
        
        addShape(newShape);
        
        const depth = (e.faceIndex <= 1 || e.faceIndex >= 2 && e.faceIndex <= 3) ? w : (e.faceIndex <= 7 ? h : d);
        
        setPushPullStateSync({
          id: newId,
          type: 'box',
          initialPos: newShape.position,
          initialArgs: newShape.args,
          normal: worldNormal,
          localNormal: localNormal,
          startPoint: e.point.clone(),
          isSubFace: true,
          parentShapeId: shape.id,
          faceIndex: e.faceIndex,
          subFaceIndex: subFaceIndex,
          parentDepth: depth
        });
        return;
      }

      // Task #148: if this is a poly-type side wall (not a top/bottom cap), figure out
      // which boundary edge was actually clicked so Push/Pull can move just that one
      // wall -- matching how pushing one face of a box only changes that one dimension,
      // instead of inflating/deflating the whole polygon (which looked like the Scale tool).
      let clickedEdgeIndex: number | undefined = undefined;
      const polyHeight = (shape.args as any)?.height || 0;
      if (shape.type === 'poly' && polyHeight > 0 && Math.abs(localNormal.z) <= 0.9 && (shape.args as any)?.vertices) {
        const invQuat = new THREE.Quaternion(...(shape.quaternion || [0, 0, 0, 1])).invert();
        const localHit = e.point.clone().sub(new THREE.Vector3(...shape.position)).applyQuaternion(invQuat);
        const verts = (shape.args as any).vertices as [number, number][];
        let bestDist = Infinity, bestIdx = 0;
        for (let i = 0; i < verts.length; i++) {
          const a = verts[i], b = verts[(i + 1) % verts.length];
          const abx = b[0] - a[0], aby = b[1] - a[1];
          const apx = localHit.x - a[0], apy = localHit.y - a[1];
          const abLen2 = abx * abx + aby * aby || 1;
          let t = (apx * abx + apy * aby) / abLen2;
          t = Math.max(0, Math.min(1, t));
          const cx = a[0] + t * abx, cy = a[1] + t * aby;
          const dx = localHit.x - cx, dy = localHit.y - cy;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestDist) { bestDist = d2; bestIdx = i; }
        }
        clickedEdgeIndex = bestIdx;
      }

      setPushPullStateSync({
        id: shape.id,
        type: shape.type,
        initialPos: shape.position,
        initialArgs: shape.args,
        normal: worldNormal,
        localNormal: localNormal,
        startPoint: e.point.clone(),
        edgeIndex: clickedEdgeIndex,
        isSubFace: !!shape.parentShapeId,
        parentShapeId: shape.parentShapeId,
        parentDepth: shape.parentDepth,
        faceIndex: shape.faceIndex,
        customBounds: shape.customBounds
      });
    } else if (activeTool === 'bevel') {
      e.stopPropagation();
      setBevelState({
        id: shape.id,
        initialAmount: shape.bevelAmount || 0,
        startX: e.nativeEvent.clientX,
        type: activeBevelType, maxRadius: (shape.type === 'box' || shape.type === 'rect')
          ? Math.min(...shape.args) / 2
          : (shape.type === 'circle' || shape.type === 'triangle' || shape.type === 'prism')
            ? Math.max(0.01, Math.min(shape.args[0], shape.args[2] / 2))
            : shape.type === 'poly'
              ? Math.max(0.01, ((shape.args as any)?.height || 1) / 2)
              : 1
      });
    } else if (activeTool === 'paint') {
      e.stopPropagation();
      handleMeshClick(e as any, shape.id);
    } else if (['move', 'rotate', 'scale'].includes(activeTool)) {
      e.stopPropagation();
      setSelectedId(shape.id);
      setSelectedIds([shape.id]);
    } else if (activeTool === 'tape') {
      handlePointerDown(e);
    } else if (['poly', 'rectangle', 'circle', 'line', 'arc', 'triangle', 'sphere', 'cone', 'pyramid', 'donut', 'dome', 'wall', 'door', 'window', 'step', 'staircase', 'landscape_sculpt', 'landscape_mask', 'landscape_road', 'landscape_zone', 'landscape_plot', 'landscape_form', 'landscape_embed', 'landscape_texture', 'tree', 'bush', 'fence', 'railing', 'lamp', 'bench', 'rock'].includes(activeTool)) {
      handlePointerDown(e);
    }
  };

  const [transformInfo, setTransformInfo] = useState<{ x: number, y: number, z: number } | null>(null);

  const handleTransformObjectChange = () => {
    const sId = selectedIdRef.current;
    
    // Capture Diagnostic Data LIVE
    captureDiagnosticData();

    if (sId) {
      const mesh = getSceneObjectById(sId) as THREE.Mesh;
      if (mesh) {
        if (contactFrictionEnabled && activeTool === 'move') {
          const now = Date.now();
          if (now < frictionPausedUntilRef.current) {
            if (lastValidPosRef.current) {
              mesh.position.copy(lastValidPosRef.current);
            }
            return;
          }

          const isColliding = checkCollision(sId, mesh);
          if (isColliding && !hasReachedFrictionRef.current) {
            hasReachedFrictionRef.current = true;
            frictionPausedUntilRef.current = now + 200; // Pause for 200ms
            if (lastValidPosRef.current) {
              mesh.position.copy(lastValidPosRef.current);
            }
            return;
          }
          if (!isColliding) {
            hasReachedFrictionRef.current = false;
          }
          lastValidPosRef.current = mesh.position.clone();
        }

        mesh.matrixAutoUpdate = true;
        setTransformInfo({
          x: mesh.position.x,
          y: mesh.position.y,
          z: mesh.position.z
        });

        // Broadcast transform to collaborators (Throttled: 1000ms)
        if (currentModelId && user?.email && !isQuotaLocked()) {
          const now = Date.now();
          if (now - lastTransformBroadcastRef.current > 1000) {
            lastTransformBroadcastRef.current = now;
            const collabId = `${currentModelId}_${user.email.toLowerCase()}`;
            updateDoc(doc(db, 'collaborations', collabId), {
              activeTransform: {
                id: sId,
                position: [mesh.position.x, mesh.position.y, mesh.position.z],
                quaternion: [mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w],
                scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z]
              }
            }).catch(err => {
              if (!String(err).includes('Quota exceeded')) {
                console.warn('Failed to broadcast transform:', err);
              }
            });
          }
        }
      }
    }
  };

  const handleTransformChangeEnd = () => {
    isDraggingRef.current = false;
    const sId = selectedIdRef.current;
    if (sId) {
      const mesh = getSceneObjectById(sId) as THREE.Mesh;
      if (mesh) {
        mesh.matrixAutoUpdate = true;
        const position: [number, number, number] = [mesh.position.x, mesh.position.y, mesh.position.z];
        let quaternion: [number, number, number, number] = [mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w];
        const scale: [number, number, number] = [mesh.scale.x, mesh.scale.y, mesh.scale.z];
        
        const currentShape = shapes.find(s => s.id === sId);
        let updatedHostWallId = currentShape?.hostWallId;

        // If a door or window was repositioned with Move tool, snap/re-host to nearest wall
        if (currentShape && (currentShape.type === 'door' || currentShape.type === 'window')) {
          const meshPos = new THREE.Vector3(...position);
          let closestWall: Shape | null = null;
          let minDistance = 0.85;

          for (const sh of shapes) {
            if (sh.type !== 'wall' || sh.id === sId) continue;
            const wPos = new THREE.Vector3(...sh.position);
            const wQuat = new THREE.Quaternion(...(sh.quaternion || [0, 0, 0, 1]));
            const wArgs = Array.isArray(sh.args) ? sh.args : [3.0, 2.8, 0.2];
            const wLen = wArgs[0] || 3.0;

            const invQuat = wQuat.clone().invert();
            const localP = meshPos.clone().sub(wPos).applyQuaternion(invQuat);

            if (Math.abs(localP.x) <= wLen / 2 + 0.5 && Math.abs(localP.z) <= 0.85) {
              const d = Math.abs(localP.z);
              if (d < minDistance) {
                minDistance = d;
                closestWall = sh;
              }
            }
          }

          if (closestWall) {
            updatedHostWallId = closestWall.id;
            const wQuat = closestWall.quaternion || [0, 0, 0, 1];
            quaternion = [wQuat[0], wQuat[1], wQuat[2], wQuat[3]];
            mesh.quaternion.set(wQuat[0], wQuat[1], wQuat[2], wQuat[3]);
          } else {
            updatedHostWallId = undefined;
          }
        }

        setShapes(prev => prev.map(s => s.id === sId ? { 
          ...s, 
          position, 
          quaternion,
          scale,
          hostWallId: updatedHostWallId
        } : s));

        // Clear active transform from presence
        if (currentModelId && user?.email) {
          const collabId = `${currentModelId}_${user.email.toLowerCase()}`;
          updateDoc(doc(db, 'collaborations', collabId), {
            activeTransform: null
          }).catch(() => {});
        }
        
        recordAction(`const obj = sdk.getObjectByName("${sId}");\nif (obj) {\n  obj.position = [${position.map(p => p.toFixed(2)).join(', ')}];\n  obj.quaternion = [${quaternion.map(q => q.toFixed(2)).join(', ')}];\n  obj.scale = [${scale.map(s => s.toFixed(2)).join(', ')}];\n}`);
      }
    }
    captureDiagnosticData();
    setTransformInfo(null);
  };

  const isTransforming = ['move', 'rotate', 'scale'].includes(activeTool);

  const performCSGOperation = (targetId: string, cutterId: string, operation: 'SUBTRACTION') => {
    console.log(`[CSG] Starting subtraction: Target=${targetId}, Cutter=${cutterId}`);
    const targetMesh = getSceneObjectById(targetId) as THREE.Mesh;
    const cutterMesh = getSceneObjectById(cutterId) as THREE.Mesh;
    
    if (!targetMesh || !cutterMesh) {
      console.error("[CSG] Target or Cutter mesh not found in scene.");
      return;
    }

    try {
      const evaluator = new Evaluator();
      
      // Ensure we use the latest matrix world
      targetMesh.updateMatrixWorld(true);
      cutterMesh.updateMatrixWorld(true);

      const targetBrush = new Brush(mergeVertices(targetMesh.geometry.clone()), targetMesh.material);
      // We keep targetBrush at identity because we want the result in its local space
      targetBrush.updateMatrixWorld();

      const cutterBrush = new Brush(mergeVertices(cutterMesh.geometry.clone()), cutterMesh.material);
      // Transform cutter into target's local space
      const targetInv = targetMesh.matrixWorld.clone().invert();
      const cutterInTargetSpace = cutterMesh.matrixWorld.clone().premultiply(targetInv);
      cutterBrush.applyMatrix4(cutterInTargetSpace);
      cutterBrush.updateMatrixWorld();

      console.log("[CSG] Brushes initialized in local space. Performing evaluation...");
      const resultBrush = evaluator.evaluate(targetBrush, cutterBrush, SUBTRACTION);
      console.log("[CSG] Evaluation complete.");

      // Result geometry is already in target's local space
      const position: [number, number, number] = [targetMesh.position.x, targetMesh.position.y, targetMesh.position.z];
      const quaternion: [number, number, number, number] = [targetMesh.quaternion.x, targetMesh.quaternion.y, targetMesh.quaternion.z, targetMesh.quaternion.w];
      const scale: [number, number, number] = [targetMesh.scale.x, targetMesh.scale.y, targetMesh.scale.z];
      
      // Serialize geometry for state
      const geometryData = resultBrush.geometry.toJSON();
      console.log("[CSG] Geometry serialized to JSON.");

      setShapes(prev => prev.map(s => s.id === targetId ? {
        ...s,
        type: 'custom',
        position,
        quaternion,
        scale,
        geometryData
      } : s));

      setConsoleOutput(prev => [...prev, `[SUCCESS] CSG Subtraction completed.`]);
      removeShape(cutterId);
      recordAction(`sdk.performCSG("${targetId}", "${cutterId}", "SUBTRACTION");`);
    } catch (error: any) {
      console.error("[CSG] Operation failed:", error);
      setConsoleOutput(prev => [...prev, `[ERROR] CSG Operation failed: ${error.message}`]);
    }
  };

  // Handle snapshot requests
  useEffect(() => {
    const handleRequestSnapshot = (e: any) => {
      console.log("[Viewport] Snapshot requested.");
      const { callback } = e.detail;
      try {
        // Create an optimized preview (small resolution for faster storage upload)
        const canvas = gl.domElement;
        const tempCanvas = document.createElement('canvas');
        const maxDim = 512; // Cap resolution at 512px for model previews
        let w = canvas.width;
        let h = canvas.height;
        
        if (w > h) {
          if (w > maxDim) {
            h *= maxDim / w;
            w = maxDim;
          }
        } else {
          if (h > maxDim) {
            w *= maxDim / h;
            h = maxDim;
          }
        }
        
        tempCanvas.width = w;
        tempCanvas.height = h;
        const ctx = tempCanvas.getContext('2d');
        
        gl.render(scene, camera);
        if (ctx) {
          ctx.drawImage(canvas, 0, 0, w, h);
          const dataUrl = tempCanvas.toDataURL('image/jpeg', 0.3); // 0.3 quality + downscaled for ultra fast upload
          console.log("[Viewport] Small preview snapshot generated for cloud upload.");
          callback(dataUrl);
        } else {
          const dataUrl = canvas.toDataURL('image/jpeg', 0.1);
          callback(dataUrl);
        }
      } catch (err) {
        console.error("[Viewport] Snapshot generation failed:", err);
        callback('');
      }
    };

    const handleRequestSceneSave = (e: any) => {
      console.log("[Viewport] Scene save requested:", e.detail.name);
      const { name } = e.detail;
      try {
        gl.render(scene, camera);
        const previewUrl = gl.domElement.toDataURL('image/jpeg', 0.5);
        
        const newScene = {
          id: Math.random().toString(36).substr(2, 9),
          name,
          cameraPosition: [camera.position.x, camera.position.y, camera.position.z] as [number, number, number],
          cameraTarget: [0, 0, 0] as [number, number, number], 
          previewUrl,
          timestamp: new Date().toISOString()
        };
        
        setScenes(prev => {
          // Avoid potential duplicates if triggered twice rapidly (within 1s)
          const exists = prev.some(s => s.name === name && s.timestamp && (Date.now() - new Date(s.timestamp).getTime()) < 1000);
          if (exists) {
            console.warn("[Viewport] Possible scene duplication blocked.");
            return prev;
          }
          return [...prev, newScene];
        });
      } catch (err) {
        console.error("[Viewport] Scene save failed:", err);
      }
    };

    const handleDiagnosticSnapshotRequest = () => {
      captureDiagnosticData();
    };

    window.addEventListener('request-snapshot', handleRequestSnapshot);
    window.addEventListener('request-scene-save', handleRequestSceneSave);
    
    // SDK Advanced Geometry listeners
    const handleCSGRequest = (e: any) => {
      const { targetId, cutterId, operation } = e.detail;
      performCSGOperation(targetId, cutterId, operation);
    };

    const handleDeformRequest = (e: any) => {
      const { id, settings } = e.detail;
      const mesh = getSceneObjectById(id) as THREE.Mesh;
      if (mesh) {
        // Apply a center deformation if triggered via SDK
        const center = new THREE.Vector3(0, 0, 0);
        const positionAttr = mesh.geometry.attributes.position;
        if (positionAttr) {
          for (let i = 0; i < positionAttr.count; i++) {
            const v = new THREE.Vector3().fromBufferAttribute(positionAttr, i);
            const dist = v.distanceTo(center);
            if (dist < settings.radius) {
              const force = (1 - dist / settings.radius) * settings.strength;
              const normal = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.normal, i);
              if (settings.direction === 'outward') v.addScaledVector(normal, force);
              else v.addScaledVector(normal, -force);
              positionAttr.setXYZ(i, v.x, v.y, v.z);
            }
          }
          positionAttr.needsUpdate = true;
          mesh.geometry.computeVertexNormals();
          
          // Save to state
          const bufferGeo = new THREE.BufferGeometry().copy(mesh.geometry);
          setShapes(prev => prev.map(s => s.id === id ? {
            ...s,
            type: 'custom',
            geometryData: bufferGeo.toJSON()
          } : s));
        }
      }
    };

    window.addEventListener('request-csg', handleCSGRequest);
    window.addEventListener('request-deform', handleDeformRequest);
    
    const handleTriggerViewReset = (e: any) => {
      const view = e.detail.view;
      let position = CAMERA_VIEWS[view]?.pos || CAMERA_VIEWS.perspective.pos;
      let target = CAMERA_VIEWS[view]?.target || CAMERA_VIEWS.perspective.target;
      
      if (view === 'perspective' || !view) {
        position = defaultCameraPosition;
        target = defaultCameraTarget;
      }

      window.dispatchEvent(new CustomEvent('set-camera', { 
        detail: { position, target } 
      }));
    };
    window.addEventListener('trigger-view-reset', handleTriggerViewReset);
    window.addEventListener('request-diagnostic-snapshot', handleDiagnosticSnapshotRequest);

    return () => {
      window.removeEventListener('request-snapshot', handleRequestSnapshot);
      window.removeEventListener('request-scene-save', handleRequestSceneSave);
      window.removeEventListener('request-csg', handleCSGRequest);
      window.removeEventListener('request-deform', handleDeformRequest);
      window.removeEventListener('trigger-view-reset', handleTriggerViewReset);
      window.removeEventListener('request-diagnostic-snapshot', handleDiagnosticSnapshotRequest);
    };
  }, [gl, scene, camera, setScenes, setShapes]);

  const handleTransformLightChange = () => {
    // Capture Diagnostic Data LIVE
    captureDiagnosticData();
  };

  const handleTransformLightEnd = () => {
    isDraggingRef.current = false;
    const sLId = selectedLightIdRef.current;
    if (sLId) {
      const lightObj = getSceneObjectById(sLId);
      if (lightObj) {
        const { position } = lightObj;
        setCustomLights(prev => prev.map(l => 
          l.id === sLId ? { ...l, position: [position.x, position.y, position.z] } : l
        ));
        commitHistory();
      }
    }
  };

  const selectedLight = customLights.find(l => l.id === selectedLightId);

  return (
    <>

      <PerspectiveCamera 
        makeDefault 
        position={defaultCameraPosition} 
        near={0.1} 
        far={5000} 
      />
      <OrbitControls 
        makeDefault 
        zoomToCursor
        autoRotate={autoOrbitEnabled}
        autoRotateSpeed={orbitRotationSpeed * 2}
        ref={(ref) => { 
          if (ref) {
            scene.userData.controls = ref;
            // Update zoom level state when camera changes
            ref.addEventListener('change', () => {
              if (activeTool === 'zoom') {
                const dist = ref.object.position.distanceTo(ref.target);
                // Use a heuristic for zoom level: RefDistance (10) / distance
                const z = 10 / dist;
                setZoom(z);
              }
            });
          }
        }}
        mouseButtons={{
          LEFT: activeTool === 'orbit' ? THREE.MOUSE.ROTATE : (activeTool === 'pan' ? THREE.MOUSE.PAN : (activeTool === 'zoom' ? THREE.MOUSE.DOLLY : null)),
          MIDDLE: THREE.MOUSE.ROTATE,
          RIGHT: THREE.MOUSE.PAN
        }}
        enabled={!drawingStart && !pushPullState && !isSculptingDragRef.current && activeTool !== 'landscape_sculpt' && activeTool !== 'landscape_mask'}
        minPolarAngle={floorEnabled ? 0 : -Math.PI}
        maxPolarAngle={floorEnabled ? Math.PI / 2 : Math.PI}
      />
      
      <Fog />
      
      <ambientLight intensity={(skybox === 'none' ? (theme === 'dark' ? 0.4 : 0.6) : (theme === 'dark' ? 0.2 : 0.3)) * (1.2 - shadowOpacity)} />
      <directionalLight 
        ref={directionalLightRef}
        position={lightPosition} 
        intensity={sunIntensity} 
        castShadow={shadowsEnabled} 
        shadow-mapSize={[1024, 1024]}
      />
      
      {showLightsource && (
        <group position={lightPosition}>
          <mesh>
            <sphereGeometry args={[0.2, 16, 16]} />
            <meshBasicMaterial color="yellow" />
          </mesh>
          <line>
            <bufferGeometry attach="geometry" setFromPoints={[new THREE.Vector3(0,0,0), new THREE.Vector3().subVectors(new THREE.Vector3(0,0,0), new THREE.Vector3(...lightPosition)).normalize().multiplyScalar(2)]} />
            <lineBasicMaterial attach="material" color="yellow" />
          </line>
        </group>
      )}
      
      {gridEnabled && (
        <Grid 
          infiniteGrid 
          fadeDistance={500} 
          fadeStrength={5} 
          sectionSize={10} 
          sectionThickness={1} 
          sectionColor={theme === 'dark' ? "#374151" : "#e5e7eb"}
          cellSize={1}
          cellThickness={0.5}
          cellColor={theme === 'dark' ? "#1f2937" : "#f3f4f6"}
        />
      )}

      {floorEnabled && (
        <mesh 
          rotation={[-Math.PI / 2, 0, 0]} 
          position={[0, -0.02, 0]} 
          receiveShadow
          onPointerDown={(e) => {
            if (placingLightId) handlePointerDown(e);
            else if (activeTool === 'select') {
              setSelectedId(null);
              setSelectedIds([]);
              setSelectedLightId(null);
              setSelectedSurface(null);
            }
          }}
        >
          <planeGeometry args={[100, 100]} />
          <meshStandardMaterial 
            color={floorColor} 
            roughness={0.8}
            metalness={0.1}
          />
        </mesh>
      )}

      {/* Background click handler for deselection */}
      <mesh 
        rotation={[-Math.PI / 2, 0, 0]} 
        position={[0, -0.05, 0]} 
        onPointerDown={(e) => {
          if (activeTool === 'select') {
            setSelectedId(null);
            setSelectedIds([]);
            setSelectedLightId(null);
            setSelectedSurface(null);
          }
        }}
      >
        <planeGeometry args={[2000, 2000]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>

      {(placingLightId || placingAnimationId || ['poly', 'rectangle', 'circle', 'line', 'triangle', 'sphere', 'cone', 'pyramid', 'donut', 'dome', 'wall', 'door', 'window', 'step', 'staircase', 'landscape_sculpt', 'landscape_mask', 'landscape_road', 'landscape_zone', 'landscape_plot', 'landscape_form', 'landscape_embed', 'landscape_texture', 'tree', 'bush', 'fence', 'railing', 'lamp', 'bench', 'rock'].includes(activeTool)) && (
        <mesh 
          rotation={[-Math.PI / 2, 0, 0]} 
          position={[0, -0.01, 0]} 
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (activeTool === 'wall' && wallVertices.length > 0) {
              finalizeWallChain();
            } else if (activeTool === 'poly' && polyVertices.length >= 3) {
              finalizePoly();
            } else if ((activeTool === 'landscape_road' || activeTool === 'landscape_zone') && roadPoints.length >= 2) {
              finalizeRoadCreation(roadPoints);
            }
          }}
        >
          <planeGeometry args={[1000, 1000]} />
          <meshBasicMaterial transparent opacity={0} />
        </mesh>
      )}

      {(drawingStart || pushPullState || isSculptingDragRef.current || (activeTool === 'wall' && wallVertices.length > 0) || (activeTool === 'poly' && polyVertices.length > 0) || ((activeTool === 'landscape_road' || activeTool === 'landscape_zone') && roadPoints.length > 0)) && (
        <mesh 
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (activeTool === 'wall' && wallVertices.length > 0) {
              finalizeWallChain();
            } else if (activeTool === 'poly' && polyVertices.length >= 3) {
              finalizePoly();
            } else if ((activeTool === 'landscape_road' || activeTool === 'landscape_zone') && roadPoints.length >= 2) {
              finalizeRoadCreation(roadPoints);
            }
          }}
        >
          <sphereGeometry args={[1000, 16, 16]} />
          <meshBasicMaterial transparent opacity={0} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* Render grids and selection highlights for all shapes */}
      {shapes.map(shape => {
      if (shape.hidden) return null;
        if (shape.type === 'measurement') return null;
        const divisions = shape.surfaceDivisions || {};
        const materials = shape.surfaceMaterials || {};
        const facesWithGrids = new Set([
          ...Object.keys(divisions).map(Number),
          ...Object.keys(materials).filter(k => k.includes('-')).map(k => parseInt(k.split('-')[0]))
        ]);

        return Array.from(facesWithGrids).map(faceIdx => (
          <FaceGrid 
            key={`${shape.id}-${faceIdx}`}
            shape={shape}
            faceIndex={faceIdx}
            gridSize={divisions[faceIdx] || 1}
            isSelected={selectedSurface?.shapeId === shape.id && selectedSurface?.faceIndex === faceIdx}
            showGrid={true}
          />
        ));
      })}

      {/* Render selection highlight for non-divided surfaces */}
      {selectedSurface && !(shapes.find(s => s.id === selectedSurface.shapeId)?.surfaceDivisions?.[selectedSurface.faceIndex]) && (
        <FaceGrid 
          shape={shapes.find(s => s.id === selectedSurface.shapeId)!} 
          faceIndex={selectedSurface.faceIndex} 
          gridSize={1}
          isSelected={true}
          showGrid={false}
        />
      )}

      {customLights.map(light => (
        <CustomLightComponent 
          key={light.id} 
          light={light} 
          shadowsEnabled={shadowsEnabled} 
          showLightsource={showLightsource}
          activeTool={activeTool}
          selectedId={selectedId}
          selectedLightId={selectedLightId}
          setSelectedLightId={setSelectedLightId}
          setSelectedId={setSelectedId}
          setSelectedIds={setSelectedIds}
          setSelectedSurface={setSelectedSurface}
          handleContextMenu={handleContextMenu}
          isDragging={isDraggingRef.current}
        />
      ))}

      {/* Collaboration cursors */}
      {showCollaboratorCursors && collaborators.filter(c => c.uid !== user?.uid && c.cursorPosition).map((collab, idx) => {
        const color = getCollabColor(collab.email);
        return (
          <group key={`cursor-${collab.uid || collab.id || idx}`} position={[collab.cursorPosition!.x, collab.cursorPosition!.y, collab.cursorPosition!.z]}>
            <Html>
              <div className="relative flex flex-col items-start pointer-events-none select-none" style={{ transform: 'translate(-4px, -4px)' }}>
                {/* Custom Triangle Cursor */}
                <svg width="75" height="75" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.5))' }}>
                  <path d="M5.65376 12.3673H5.46026L5.31717 12.4976L0.500002 16.8829L0.500002 1.19841L11.7841 12.3673H5.65376Z" fill={color} stroke="white" strokeWidth="0.8"/>
                </svg>
                
                {/* Name Pill */}
                <div 
                  className="ml-12 -mt-6 px-6 py-3 text-white text-[20px] font-bold rounded-full whitespace-nowrap shadow-2xl ring-2 ring-white/50 backdrop-blur-md uppercase tracking-wider"
                  style={{ backgroundColor: color }}
                >
                  {collab.displayName || collab.email.split('@')[0]}
                </div>
              </div>
            </Html>
          </group>
        );
      })}

      {/* Collaborative Ghosts */}
      {collaborators.filter(c => c.uid !== user?.uid && c.activeTransform).map((collab, idx) => {
        const trans = collab.activeTransform!;
        const shape = shapes.find(s => s.id === trans.id);
        if (!shape) return null;

        const pos: [number, number, number] = Array.isArray(trans.position) ? trans.position as [number, number, number] : [0, 0, 0];
        const quat = Array.isArray(trans.quaternion) ? trans.quaternion : [0, 0, 0, 1];
        const scale: [number, number, number] = Array.isArray(trans.scale) ? trans.scale as [number, number, number] : [1, 1, 1];

        return (
          <group key={`ghost-${collab.uid || collab.id || idx}`} position={pos} quaternion={new THREE.Quaternion(...quat)} scale={scale}>
             <mesh>
                {(shape.type === 'box' || shape.type === 'rect') ? (
                  <boxGeometry args={(Array.isArray(shape.args) ? shape.args : [1, 1, 1]) as any} />
                ) : shape.type === 'sphere' ? (
                  <sphereGeometry args={(Array.isArray(shape.args) ? shape.args : [1, 16, 16]) as any} />
                ) : (
                  <sphereGeometry args={[1, 16, 16] as any} />
                )}
                <meshBasicMaterial color={shape.color} transparent opacity={0.3} wireframe />
             </mesh>
             <Html distanceFactor={10}>
                <div title={`${collab.displayName} is moving`} className="bg-black/60 text-white text-[8px] px-1.5 py-0.5 rounded whitespace-nowrap">
                   {collab.displayName} is moving
                </div>
             </Html>
          </group>
        );
      })}

      {/* Spatial Notes */}
      {notes.filter(n => allNotesVisible && n.visible !== false).map(note => (
        <group key={note.id} position={[note.position.x, note.position.y, note.position.z]}>
          <Html distanceFactor={12} transform sprite zIndexRange={[0, 10]}>
            <div 
              className={cn(
                "p-4 rounded-2xl shadow-2xl border transition-all cursor-pointer min-w-[250px] space-y-2 select-none",
                note.completed 
                  ? "bg-gray-50/90 dark:bg-gray-900/90 border-gray-200 dark:border-gray-800" 
                  : "bg-white/95 dark:bg-gray-800/95 border-trimble-blue dark:border-trimble-blue shadow-modus-4"
              )}
              onClick={(e) => {
                e.stopPropagation();
                setNotes(prev => prev.map(n => n.id === note.id ? { ...n, completed: !n.completed } : n));
              }}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Note - {note.authorName}</div>
                {note.completed && <CheckCircle2 size={12} className="text-green-500" />}
              </div>
              <p className={cn(
                "text-sm leading-relaxed text-gray-900 dark:text-white", 
                note.completed && "line-through text-gray-400 dark:text-gray-500"
              )}>
                {note.text}
              </p>
              <div className="pt-2 flex justify-end">
                 <div className="text-[8px] text-gray-400 dark:text-gray-500">
                   {safelyToDate(note.createdAt).toLocaleDateString()}
                 </div>
              </div>
            </div>
          </Html>
        </group>
      ))}

      <Effects />

      <group>
        <mesh position={[50, 0, 0]}>
          <boxGeometry args={[100, 0.1, 0.1]} />
          <meshBasicMaterial color="#ef4444" />
        </mesh>
        <mesh position={[0, 0, 50]}>
          <boxGeometry args={[0.1, 0.1, 100]} />
          <meshBasicMaterial color="#22c55e" />
        </mesh>
        <mesh position={[0, 50, 0]}>
          <boxGeometry args={[0.1, 100, 0.1]} />
          <meshBasicMaterial color="#3b82f6" />
        </mesh>
      </group>

      {/* WorldView Map Overlay */}
      {isWorldViewActive && (
        <RenderMapTexture lat={worldViewLocation.lat} lng={worldViewLocation.lng} />
      )}

      {placingNotePos && (
        <Html fullscreen zIndexRange={_polyformNoteZIndexRange} portal={_polyformBodyPortalRef}>
          <div className="fixed inset-0 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[4px]">
            <div 
              className="bg-white/95 dark:bg-gray-800/95 p-6 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-[560px] max-w-[92vw] space-y-5 animate-in zoom-in-95 duration-200" 
              onPointerDown={e => e.stopPropagation()}
              style={{ pointerEvents: 'auto' }}
            >
              <div className="flex items-center justify-between pb-4 border-b border-gray-100 dark:border-gray-800">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-2xl bg-trimble-blue/10 flex items-center justify-center">
                    <StickyNote size={20} className="text-trimble-blue" />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-wide leading-none">New Design Note</h4>
                    <p className="text-[10px] text-gray-400 mt-1 font-medium italic">Describe your design intent or leave a comment for collaborators</p>
                  </div>
                </div>
                <div className="text-[10px] text-trimble-blue font-bold px-3 py-1 bg-trimble-blue/10 rounded-full border border-trimble-blue/20 shadow-sm transition-all hover:bg-trimble-blue/20">
                  COORD: {placingNotePos.x.toFixed(2)}, {placingNotePos.y.toFixed(2)}, {placingNotePos.z.toFixed(2)}
                </div>
              </div>
              <textarea
                autoFocus
                ref={noteTextareaRef}
                defaultValue=""
                placeholder="Type your note here..."
                className="w-full h-28 p-4 text-sm bg-gray-50/50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded-xl focus:ring-2 focus:ring-trimble-blue/20 focus:border-trimble-blue outline-none text-gray-900 dark:text-white resize-none transition-all placeholder:text-gray-400 font-medium"
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    const _noteText = (noteTextareaRef.current?.value || '').trim();
                    if (_noteText) {
                      const newNote: SceneNote = {
                        id: Math.random().toString(36).substr(2, 9),
                        text: _noteText,
                        position: { x: placingNotePos.x, y: placingNotePos.y, z: placingNotePos.z },
                        authorUid: user?.uid || 'anonymous',
                        authorName: user?.displayName || 'Anonymous',
                        createdAt: Date.now(),
                        completed: false
                      };
                      setNotes(prev => [...prev, newNote]);
                      recordAction(`sdk.addNote("${_noteText}", [${placingNotePos.x}, ${placingNotePos.y}, ${placingNotePos.z}]);`);
                    }
                    setPlacingNotePos(null);
                  }
                  if (e.key === 'Escape') setPlacingNotePos(null);
                }}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setPlacingNotePos(null)}
                  className="flex-1 py-2 text-xs font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const _noteText = (noteTextareaRef.current?.value || '').trim();
                    if (_noteText) {
                      const newNote: SceneNote = {
                        id: Math.random().toString(36).substr(2, 9),
                        text: _noteText,
                        position: { x: placingNotePos.x, y: placingNotePos.y, z: placingNotePos.z },
                        authorUid: user?.uid || 'anonymous',
                        authorName: user?.displayName || 'Anonymous',
                        createdAt: Date.now(),
                        completed: false
                      };
                      setNotes(prev => [...prev, newNote]);
                      recordAction(`sdk.addNote("${_noteText}", [${placingNotePos.x}, ${placingNotePos.y}, ${placingNotePos.z}]);`);
                    }
                    setPlacingNotePos(null);
                  }}
                  className="flex-1 py-2 text-xs font-bold bg-trimble-blue text-white hover:bg-trimble-blue/90 rounded-lg shadow-md transition-colors"
                >
                  Place Note
                </button>
              </div>
              <p className="text-[10px] text-gray-400 italic">Press Enter to save, Esc to cancel.</p>
            </div>
          </div>
        </Html>
      )}

      {/*
        Kernel-derived geometry, rendered ALONGSIDE the Shape[] primitives
        below. The kernel owns drawn geometry (lines, arcs, rectangles,
        polygons); Shape[] keeps primitives, plants and terrain.

        `revision` is the invalidation signal and is not optional: the kernel
        Graph is mutated in place, so React's identity check on it never fires.
      */}
      <KernelGeometry graph={kernelHost.graph} revision={kernelRevision} />

      {shapes.map((shape) => {
      if (shape.hidden) return null;
        const isVisible = !shape.tags || shape.tags.length === 0 || shape.tags.some(tagId => {
          const tag = tags.find(t => t.id === tagId);
          return tag ? tag.visible : true;
        });

        if (!isVisible) return null;

        if (shape.type === 'measurement') {
          const mArgs: any = shape.args || {};
          const mStart: [number, number, number] = mArgs.start || [0, 0, 0];
          const mEnd: [number, number, number] = mArgs.end || [0, 0, 0];
          const mDist: number = mArgs.distance ?? 0;
          const isSel = selectedId === shape.id;
          return (
            <group key={shape.id}>
              <Line
                points={[mStart, mEnd]}
                color={isSel ? '#FFFFFF' : (shape.color || '#FFD700')}
                lineWidth={isSel ? 3 : 2}
              />
              <Html
                position={[(mStart[0] + mEnd[0]) / 2, (mStart[1] + mEnd[1]) / 2, (mStart[2] + mEnd[2]) / 2]}
                center
                occlude={false}
              >
                <div
                  onClick={(e: any) => { e.stopPropagation(); setSelectedId(shape.id); setSelectedIds([shape.id]); }}
                  className={`text-white text-xs font-medium px-2 py-1 rounded whitespace-nowrap shadow-lg border cursor-pointer transition-colors ${isSel ? 'bg-trimble-blue border-white' : 'bg-black/80 border-yellow-500/50 hover:border-yellow-400'}`}
                >
                  {formatValue(mDist, unit, 2)}
                </div>
              </Html>
            </group>
          );
        }
        if (shape.type === 'arc') {
          const aargs: any = shape.args || {};
          const apts: [number, number, number][] = aargs.points || [];
          if (apts.length < 2) return null;
          const isSel = selectedId === shape.id || selectedIds.includes(shape.id);
          let totalLen = 0;
          for (let i = 1; i < apts.length; i++) {
            totalLen += Math.hypot(apts[i][0] - apts[i - 1][0], apts[i][1] - apts[i - 1][1], apts[i][2] - apts[i - 1][2]);
          }
          const midPt = apts[Math.floor(apts.length / 2)] || apts[0];
          const arcColor = isSel ? '#0063A3' : (shape.color || '#22c55e');
          return (
            <group 
              key={shape.id}
              onClick={(e: any) => {
                e.stopPropagation();
                setSelectedId(shape.id);
                setSelectedIds([shape.id]);
              }}
            >
              <Line
                points={apts}
                color={arcColor}
                lineWidth={isSel ? 5 : 3.5}
              />
              {/* Endpoint visual anchors */}
              <mesh position={apts[0]}>
                <sphereGeometry args={[0.04, 16, 16]} />
                <meshBasicMaterial color={isSel ? '#38bdf8' : arcColor} />
              </mesh>
              <mesh position={apts[apts.length - 1]}>
                <sphereGeometry args={[0.04, 16, 16]} />
                <meshBasicMaterial color={isSel ? '#38bdf8' : arcColor} />
              </mesh>
              {(showAllDimensions || isSel) && (
                <Html position={midPt} center occlude={false}>
                  <div
                    onClick={(e: any) => { e.stopPropagation(); setSelectedId(shape.id); setSelectedIds([shape.id]); }}
                    className={`text-white text-xs font-medium px-2 py-1 rounded whitespace-nowrap shadow-lg border cursor-pointer transition-colors ${isSel ? 'bg-trimble-blue border-white' : 'bg-black/80 border-green-500/50 hover:border-green-400'}`}
                  >
                    {formatValue(totalLen, unit, 2)}
                  </div>
                </Html>
              )}
            </group>
          );
        }


        const meshProps = {
          name: shape.id,
          position: (isDraggingRef.current && selectedId === shape.id) ? undefined : shape.position,
          quaternion: (isDraggingRef.current && selectedId === shape.id) ? undefined : (shape.quaternion ? new THREE.Quaternion(...shape.quaternion) : undefined),
          rotation: (isDraggingRef.current && selectedId === shape.id) ? undefined : ((!shape.quaternion && shape.rotation) ? shape.rotation : undefined),
          scale: (isDraggingRef.current && selectedId === shape.id) ? undefined : (shape.scale || [1, 1, 1]),
          castShadow: shadowsEnabled,
          receiveShadow: shadowsEnabled,
          userData: { isShape: true, id: shape.id },
          onClick: (e: any) => handleMeshClick(e, shape.id),
          onDoubleClick: (e: any) => handleMeshDoubleClick(e, shape.id),
          onContextMenu: (e: any) => handleContextMenu(e, shape.id),
          onPointerDown: (e: any) => handleMeshPointerDown(e, shape),
          onPointerMove: (e: any) => {
            if (activeTool === 'tape' && tapeStart) {
              const point = e.point.clone();
              setTapeEnd(point);
              setMeasurements(`Distance: ${formatValue(tapeStart.distanceTo(point), unit, 2)}`);
              return;
            }
            if (activeTool === 'arc' && arcStep === 1 && arcStart) {
              const point = e.point.clone();
              setArcEnd(point);
              setMeasurements(`Arc Chord: ${formatValue(arcStart.distanceTo(point), unit, 2)} (Click to set endpoint)`);
              return;
            }
            if (activeTool === 'arc' && arcStep === 2 && arcStart && arcEnd) {
              const point = e.point.clone();
              setArcBulge(point);
              setMeasurements(`Arc Curvature: Adjust bulge & click to place`);
              return;
            }
            if (activeTool === 'deform' && e.buttons === 1) {
              e.stopPropagation();
              const { radius, strength, direction } = deformationSettings;
              const point = e.point;
              const object = e.object;
              if (object instanceof THREE.Mesh) {
                const geometry = object.geometry;
                const positionAttr = geometry.attributes.position;
                const normalAttr = geometry.attributes.normal;
                
                if (positionAttr) {
                  const worldMatrix = object.matrixWorld;
                  const inverseWorldMatrix = new THREE.Matrix4().copy(worldMatrix).invert();
                  const localPoint = point.clone().applyMatrix4(inverseWorldMatrix);
                  
                  let changed = false;
                  for (let i = 0; i < positionAttr.count; i++) {
                    const v = new THREE.Vector3().fromBufferAttribute(positionAttr, i);
                    const dist = v.distanceTo(localPoint);
                    if (dist < radius) {
                      const force = (1 - dist / radius) * strength * 0.2;
                      const normal = new THREE.Vector3().fromBufferAttribute(normalAttr || new THREE.BufferAttribute(new Float32Array(positionAttr.count * 3), 3), i);
                      
                      if (direction === 'outward') v.addScaledVector(normal, force);
                      else if (direction === 'inward') v.addScaledVector(normal, -force);
                      else {
                        const toPoint = v.clone().sub(localPoint).normalize();
                        v.addScaledVector(toPoint, force);
                      }
                      positionAttr.setXYZ(i, v.x, v.y, v.z);
                      changed = true;
                    }
                  }
                  if (changed) {
                    positionAttr.needsUpdate = true;
                    geometry.computeVertexNormals();
                  }
                }
              }
            }

            if (['pushpull', 'offset', 'paint', 'select', 'eraser'].includes(activeTool)) {
              e.stopPropagation();
              if (['sphere', 'donut', 'dome'].includes(shape.type)) {
                document.body.style.cursor = 'not-allowed';
                setHoveredFace(null);
              } else {
                document.body.style.cursor = activeTool === 'pushpull' ? 'crosshair' : activeTool === 'offset' ? 'copy' : 'pointer';
                let subFaceIndex: number | undefined = undefined;
                if (shape.surfaceDivisions && e.faceIndex !== undefined && shape.surfaceDivisions[e.faceIndex] && e.uv) {
                  const division = shape.surfaceDivisions[e.faceIndex];
                  const [gridX, gridY] = getGridDimensions(division);
                  // Use a small epsilon to ensure we don't fall off the edge at corners
                  const eps = 0.0001;
                  const ix = Math.min(gridX - 1, Math.max(0, Math.floor((e.uv.x + eps) * gridX)));
                  const iy = Math.min(gridY - 1, Math.max(0, Math.floor((e.uv.y + eps) * gridY)));
                  subFaceIndex = ix + iy * gridX;
                } else if (shape.type === 'prism' || shape.type === 'triangle') {
                  // For prisms, we use faceIndex directly to highlight the side/cap
                  subFaceIndex = undefined;
                }
                setHoveredFace({ shapeId: shape.id, faceIndex: e.faceIndex ?? 4, subFaceIndex });
              }
            }
            handlePointerMove(e);
          },
          onPointerOut: (e: any) => {
            if (['pushpull', 'offset', 'paint', 'select', 'eraser'].includes(activeTool)) {
              document.body.style.cursor = 'auto';
              setHoveredFace(null);
            }
          },
          onPointerUp: (e: any) => {
            if (activeTool === 'deform' && e.object instanceof THREE.Mesh) {
              const geometry = e.object.geometry;
              const shapeId = e.object.userData.id;
              if (shapeId) {
                console.log(`[Deform] Saving modified geometry for ${shapeId}`);
                // Ensure we save as plain BufferGeometry to preserve vertex modifications
                const bufferGeo = new THREE.BufferGeometry().copy(geometry);
                setShapes(prev => prev.map(s => s.id === shapeId ? {
                  ...s,
                  type: 'custom',
                  geometryData: bufferGeo.toJSON()
                } : s));
                commitHistory();
                recordAction(`sdk.deformObject("${shapeId}", ${JSON.stringify(deformationSettings)});`);
              }
            }
            handlePointerUp(e);
          },
        };

        const materialElements = shape.type === 'box' && shape.surfaceMaterials && !shape.bevelAmount ? (
          [0, 2, 4, 6, 8, 10].map((idx) => {
            const mat = shape.surfaceMaterials?.[idx] || shape.color;
            return isTextureUrl(mat) ? (
              <meshStandardMaterial 
                key={idx}
                attach={`material-${idx/2}`}
                map={getCachedTexture(mat)} 
                color="#ffffff"
                roughness={shape.roughness ?? 0.5}
                metalness={shape.metalness ?? 0}
                transparent={shape.opacity !== undefined && shape.opacity < 1}
                opacity={shape.opacity ?? 1}
                emissive={selectedId === shape.id ? '#0063A3' : '#000000'}
                emissiveIntensity={selectedId === shape.id ? 0.5 : 0}
              />
            ) : (
              <meshStandardMaterial 
                key={idx}
                attach={`material-${idx/2}`}
                color={mat} 
                roughness={shape.roughness ?? 0.5}
                metalness={shape.metalness ?? 0}
                transparent={shape.opacity !== undefined && shape.opacity < 1}
                opacity={shape.opacity ?? 1}
                emissive={selectedId === shape.id ? '#0063A3' : '#000000'}
                emissiveIntensity={selectedId === shape.id ? 0.5 : 0}
              />
            );
          })
        ) : (
          isTextureUrl(shape.color) ? (
            <meshStandardMaterial 
              map={getCachedTexture(shape.color)} 
              color="#ffffff"
              roughness={shape.roughness ?? 0.5}
              metalness={shape.metalness ?? 0}
              transparent={shape.opacity !== undefined && shape.opacity < 1}
              opacity={shape.opacity ?? 1}
              emissive={selectedId === shape.id ? '#0063A3' : '#000000'}
              emissiveIntensity={selectedId === shape.id ? 0.5 : 0}
            />
          ) : (
            <meshStandardMaterial 
              color={shape.color} 
              roughness={shape.roughness || 0.5}
              metalness={shape.metalness || 0}
              transparent={shape.opacity !== undefined && shape.opacity < 1}
              opacity={shape.opacity || 1}
              emissive={selectedId === shape.id ? '#0063A3' : '#000000'}
              emissiveIntensity={selectedId === shape.id ? 0.5 : 0}
            />
          )
        );

  const selectionHighlight = null;

        const subtractHighlight = subtractTargetId === shape.id && (
          <mesh>
            {(shape.type === 'box' || shape.type === 'rect') ? (
              <boxGeometry args={[
                ((Array.isArray(shape.args) ? shape.args[0] : 0) || 0) + 0.1, 
                ((Array.isArray(shape.args) ? shape.args[1] : 0) || 0) + 0.1, 
                ((Array.isArray(shape.args) ? shape.args[2] : 0) || 0) + 0.1
              ]} />
            ) : shape.type === 'poly' ? (
              <PolyGeometry vertices={shape.args?.vertices || []} height={((shape.args as any)?.height || 0) + 0.1} holes={(shape.args as any)?.holes} />
            ) : null}
            <meshBasicMaterial color="#ef4444" wireframe transparent opacity={0.5} />
          </mesh>
        );

        if ((shape.type === 'tree' || shape.type === 'bush') && shape.plantSpeciesId) {
          const plantSpecies = PLANT_SPECIES_CATALOG.find(s => s.id === shape.plantSpeciesId);
          if (plantSpecies?.modelType === 'fbx' || plantSpecies?.modelType === 'usd') {
            return (
              <PlantModelMesh
                key={shape.id}
                shape={shape}
                selectedId={selectedId}
                meshProps={meshProps}
                selectionHighlight={selectionHighlight}
              />
            );
          }
        }

        if ((shape.type === 'box' || shape.type === 'rect') && shape.bevelAmount) {
          return (
            <RoundedBox
              key={shape.id}
              {...meshProps}
              args={shape.args}
              radius={shape.bevelAmount}
              smoothness={shape.bevelSegments || 4}
            >
              {materialElements}
              {selectionHighlight}
              {subtractHighlight}
              {/* Task #149: SketchUp-style dark edge lines between adjacent faces */}
              {edgeLinesEnabled && (
                <Edges 
                  threshold={15} 
                  color={edgeLinesColor} 
                  lineWidth={edgeLinesThickness}
                  linewidth={edgeLinesThickness}
                  transparent={edgeLinesOpacity < 1} 
                  opacity={edgeLinesOpacity} 
                  depthTest={true} 
                  polygonOffset 
                  polygonOffsetFactor={-2} 
                  polygonOffsetUnits={-2} 
                  renderOrder={2} 
                />
              )}
            </RoundedBox>
          );
        }

        return (
          <mesh key={shape.id} {...meshProps}>
          {(shape.type === 'circle' || shape.type === 'triangle' || shape.type === 'prism') && shape.bevelAmount ? (
            <PolyGeometry
              vertices={regularPolygonVertices(
                Array.isArray(shape.args) ? shape.args[0] : 1,
                (shape.type === 'triangle' || shape.type === 'prism') ? 3 : (Array.isArray(shape.args) ? (shape.args[3] || 32) : 32)
              )}
              height={Array.isArray(shape.args) ? shape.args[2] : 1}
              bevelAmount={shape.bevelAmount}
              bevelSegments={shape.bevelSegments || 4}
              uprightY
            />
          ) : shape.type === 'circle' || shape.type === 'line' || shape.type === 'triangle' || shape.type === 'prism' ? (
            <cylinderGeometry args={[
              Array.isArray(shape.args) ? shape.args[0] : 1,
              Array.isArray(shape.args) ? shape.args[1] : 1,
              Array.isArray(shape.args) ? shape.args[2] : 1,
              (shape.type === 'triangle' || shape.type === 'prism') ? 3 : (Array.isArray(shape.args) ? (shape.args[3] || 32) : 32)
            ]} />
          ) : shape.type === 'sphere' ? (
            <sphereGeometry args={(Array.isArray(shape.args) ? shape.args : [1, 32, 32]) as any} />
          ) : shape.type === 'cone' || shape.type === 'pyramid' ? (
            <coneGeometry args={(Array.isArray(shape.args) ? shape.args : [1, 1, 32]) as any} />
          ) : shape.type === 'donut' ? (
            <torusGeometry args={(Array.isArray(shape.args) ? shape.args : [1, 0.4, 16, 100]) as any} />
          ) : shape.type === 'dome' ? (
            <sphereGeometry args={(Array.isArray(shape.args) ? shape.args : [1, 32, 32]) as any} />
          ) : shape.type === 'poly' ? (
            <PolyGeometry vertices={shape.args?.vertices || []} height={shape.args?.height ?? 0} bevelAmount={shape.bevelAmount || 0} bevelSegments={shape.bevelSegments || 4} holes={(shape.args as any)?.holes} />
          ) : ['wall', 'door', 'window', 'step', 'staircase'].includes(shape.type) ? (
            <ArchGeometry shape={shape} shapes={shapes} />
          ) : ['tree', 'bush', 'fence', 'railing', 'lamp', 'bench', 'rock'].includes(shape.type) ? (
            <LandscapeFeatureGeometry shape={shape} />
          ) : shape.type === 'custom' ? (
            <CustomGeometry shape={shape} />
          ) : shape.type === 'terrain' ? (
            <TerrainGeometry terrainData={shape.terrainData} />
          ) : (
            <boxGeometry args={(Array.isArray(shape.args) ? shape.args : [1, 1, 1]) as any} />
          )}
          {shape.type === 'door' || shape.type === 'window' ? (
            <>
              {/* Material 0: Frame and solid panels (White / custom finish) */}
              <meshStandardMaterial 
                attach="material-0"
                color={shape.color || '#ffffff'} 
                roughness={shape.roughness ?? 0.4}
                metalness={shape.metalness ?? 0.05}
                transparent={shape.opacity !== undefined && shape.opacity < 1}
                opacity={shape.opacity ?? 1}
                side={THREE.DoubleSide}
                emissive={selectedId === shape.id ? '#0063A3' : '#000000'}
                emissiveIntensity={selectedId === shape.id ? 0.35 : 0}
              />
              {/* Material 1: Crystal Clear See-Through Architectural Glass */}
              <meshStandardMaterial 
                attach="material-1"
                color="#e0f2fe" 
                roughness={0.05}
                metalness={0.1}
                transparent={true}
                opacity={0.20}
                depthWrite={false}
                side={THREE.DoubleSide}
                emissive={selectedId === shape.id ? '#0063A3' : '#000000'}
                emissiveIntensity={selectedId === shape.id ? 0.2 : 0}
              />
              {/* Material 2: Architectural Brushed Hardware (Knobs / Lever Handles / Pulls) */}
              <meshStandardMaterial 
                attach="material-2"
                color="#94a3b8" 
                roughness={0.2}
                metalness={0.85}
                side={THREE.DoubleSide}
                emissive={selectedId === shape.id ? '#0063A3' : '#000000'}
                emissiveIntensity={selectedId === shape.id ? 0.35 : 0}
              />
            </>
          ) : shape.type === 'box' && shape.surfaceMaterials ? (
            [0, 2, 4, 6, 8, 10].map((idx) => {
              const mat = shape.surfaceMaterials?.[idx] || shape.color;
              return isTextureUrl(mat) ? (
                <meshStandardMaterial 
                  key={idx}
                  attach={`material-${idx/2}`}
                  map={getCachedTexture(mat)} 
                  color="#ffffff"
                  roughness={shape.roughness ?? 0.5}
                  metalness={shape.metalness ?? 0}
                  transparent={shape.opacity !== undefined && shape.opacity < 1}
                  opacity={shape.opacity ?? 1}
                  side={shape.type === 'poly' ? THREE.DoubleSide : THREE.FrontSide}
                  emissive={selectedId === shape.id ? '#0063A3' : '#000000'}
                  emissiveIntensity={selectedId === shape.id ? 0.5 : 0}
                />
              ) : (
                <meshStandardMaterial 
                  key={idx}
                  attach={`material-${idx/2}`}
                  color={mat} 
                  roughness={shape.roughness ?? 0.5}
                  metalness={shape.metalness ?? 0}
                  transparent={shape.opacity !== undefined && shape.opacity < 1}
                  opacity={shape.opacity ?? 1}
                  side={shape.type === 'poly' ? THREE.DoubleSide : THREE.FrontSide}
                  emissive={selectedId === shape.id ? '#0063A3' : '#000000'}
                  emissiveIntensity={selectedId === shape.id ? 0.5 : 0}
                />
              );
            })
          ) : (
            (() => {
              const isTerrainHeatmap = shape.type === 'terrain' && !!shape.terrainData?.shadingMode && shape.terrainData.shadingMode !== 'default';
              const resolvedTexUrl = !isTerrainHeatmap ? (
                (shape.type === 'terrain')
                  ? (isTextureUrl(shape.terrainData?.textureUrl) ? shape.terrainData!.textureUrl! : (isTextureUrl(shape.color) ? shape.color : (shape.terrainData?.textureUrl || 'lush_grass')))
                  : (isTextureUrl(shape.color) ? shape.color : '')
              ) : '';

              if (resolvedTexUrl) {
                return (
                  <meshStandardMaterial 
                    map={getCachedTexture(resolvedTexUrl)} 
                    color="#ffffff"
                    roughness={shape.roughness ?? 0.8}
                    metalness={shape.metalness ?? 0.05}
                    transparent={shape.opacity !== undefined && shape.opacity < 1}
                    opacity={shape.opacity ?? 1}
                    side={(shape.type === 'poly' || shape.type === 'terrain' || (shape.type === 'custom' && shape.args?.isRoad)) ? THREE.DoubleSide : THREE.FrontSide}
                    emissive={selectedId === shape.id ? '#0063A3' : '#000000'}
                    emissiveIntensity={selectedId === shape.id ? 0.5 : 0}
                  />
                );
              }

              return (
                <meshStandardMaterial 
                  color={isTerrainHeatmap ? '#ffffff' : (shape.color || '#ffffff')} 
                  vertexColors={isTerrainHeatmap}
                  roughness={shape.roughness ?? 0.8}
                  metalness={shape.metalness ?? 0.05}
                  transparent={shape.opacity !== undefined && shape.opacity < 1}
                  opacity={shape.opacity ?? 1}
                  side={(shape.type === 'poly' || shape.type === 'terrain' || (shape.type === 'custom' && shape.args?.isRoad)) ? THREE.DoubleSide : THREE.FrontSide}
                  emissive={selectedId === shape.id ? '#0063A3' : '#000000'}
                  emissiveIntensity={selectedId === shape.id ? 0.5 : 0}
                />
              );
            })()
          )}
          {selectionHighlight}
          {subtractHighlight}
          {/* Task #149: SketchUp-style dark edge lines between adjacent faces */}
          {edgeLinesEnabled && (
            <Edges 
              threshold={15} 
              color={edgeLinesColor} 
              lineWidth={edgeLinesThickness}
              linewidth={edgeLinesThickness}
              transparent={edgeLinesOpacity < 1} 
              opacity={edgeLinesOpacity} 
              depthTest={true} 
              polygonOffset 
              polygonOffsetFactor={-2} 
              polygonOffsetUnits={-2} 
              renderOrder={2} 
            />
          )}
        </mesh>
      );
    })}

      {selectedId && isTransforming && (
        <>
          <TransformControls 
            ref={transformRef}
            object={getSceneObjectById(selectedId)} 
            mode={activeTool === 'move' ? 'translate' : (activeTool === 'rotate' ? 'rotate' : 'scale')}
            showX={!axisLock || axisLock === 'x'}
            showY={!axisLock || axisLock === 'y'}
            showZ={!axisLock || axisLock === 'z'}
            onMouseDown={() => { isDraggingRef.current = true; }}
            onMouseUp={handleTransformChangeEnd}
            onObjectChange={handleTransformObjectChange}
            translationSnap={unit === 'm' ? 0.01 : 1}
            rotationSnap={Math.PI / 24}
            scaleSnap={0.01}
          />
          {activeTool === 'move' && transformInfo && (
            <Html position={getSceneObjectById(selectedId)?.position.clone().add(new THREE.Vector3(0, 1.2, 0)) || [0, 0, 0]}>
              <div className="bg-black/80 backdrop-blur-md text-white px-3 py-1.5 rounded-lg text-xs font-mono whitespace-nowrap pointer-events-none border border-white/20 shadow-xl flex gap-3">
                <span className="text-red-400">X: {(transformInfo.x * 1000).toFixed(0)}mm</span>
                <span className="text-green-400">Y: {(transformInfo.y * 1000).toFixed(0)}mm</span>
                <span className="text-blue-400">Z: {(transformInfo.z * 1000).toFixed(0)}mm</span>
              </div>
            </Html>
          )}
        </>
      )}

      {activeTool === 'move' && selectedLightId && (
        <TransformControls 
          ref={transformRef}
          object={getSceneObjectById(selectedLightId)} 
          mode="translate"
          onMouseDown={() => { isDraggingRef.current = true; }}
          onObjectChange={handleTransformLightChange}
          onMouseUp={handleTransformLightEnd}
        />
      )}

      {previewShape && (
        <mesh 
          position={previewShape.position}
          quaternion={new THREE.Quaternion(...previewShape.quaternion)}
        >
          {previewShape.type === 'circle' || previewShape.type === 'line' || previewShape.type === 'triangle' ? (
            <cylinderGeometry args={previewShape.args} />
          ) : previewShape.type === 'sphere' ? (
            <sphereGeometry args={previewShape.args} />
          ) : previewShape.type === 'cone' || previewShape.type === 'pyramid' ? (
            <coneGeometry args={previewShape.args} />
          ) : previewShape.type === 'donut' ? (
            <torusGeometry args={previewShape.args} />
          ) : previewShape.type === 'dome' ? (
            <sphereGeometry args={previewShape.args} />
          ) : ['wall', 'door', 'window', 'step', 'staircase'].includes(previewShape.type) ? (
            <ArchGeometry shape={previewShape as any} shapes={shapes} />
          ) : (
            <boxGeometry args={previewShape.args} />
          )}
          {previewShape.type === 'door' || previewShape.type === 'window' ? (
            <>
              <meshBasicMaterial attach="material-0" color="#ffffff" transparent opacity={0.7} />
              <meshBasicMaterial attach="material-1" color="#bae6fd" transparent opacity={0.25} />
              <meshBasicMaterial attach="material-2" color="#cbd5e1" transparent opacity={0.7} />
            </>
          ) : (
            <meshBasicMaterial color={activeMaterial} transparent opacity={0.5} />
          )}
        </mesh>
      )}

      {shadowsEnabled && (
        <ContactShadows position={[0, 0, 0]} opacity={shadowOpacity} scale={10} blur={1.5} far={0.8} />
      )}

      {/* Show All Dimensions - per-shape labels, toggled from the Measure tool popout */}
      {showAllDimensions && shapes.map((shape) => {
        if (shape.hidden) return null;
        const args = Array.isArray(shape.args) ? (shape.args as number[]) : [];
        let label: string | null = null;
        switch (shape.type) {
          case 'rect':
          case 'box':
            label = `${formatValue(args[0] || 0, unit, 1)} x ${formatValue(args[1] || 0, unit, 1)} x ${formatValue(args[2] || 0, unit, 1)}`;
            break;
          case 'wall':
            label = `Wall: ${formatValue(args[0] || 0, unit, 1)} × ${formatValue(args[1] || 0, unit, 1)}`;
            break;
          case 'door':
            label = `Door: ${formatValue(args[0] || 0, unit, 1)} × ${formatValue(args[1] || 0, unit, 1)}`;
            break;
          case 'window':
            label = `Window: ${formatValue(args[0] || 0, unit, 1)} × ${formatValue(args[1] || 0, unit, 1)}`;
            break;
          case 'step':
            label = `Step: ${formatValue(args[0] || 0, unit, 1)} × ${formatValue(args[2] || 0, unit, 1)}`;
            break;
          case 'staircase':
            label = `Staircase: ${args[3] || 12} steps`;
            break;
          case 'sphere':
          case 'dome':
            label = `Radius: ${formatValue(args[0] || 0, unit, 1)}`;
            break;
          case 'cone':
            label = `Radius: ${formatValue(args[0] || 0, unit, 1)}`;
            break;
          case 'pyramid':
            label = `Base: ${formatValue(args[0] || 0, unit, 1)}`;
            break;
          case 'donut':
            label = `Major Radius: ${formatValue(args[0] || 0, unit, 1)}`;
            break;
          case 'circle':
            label = `Radius: ${formatValue(args[0] || 0, unit, 1)}`;
            break;
          case 'triangle':
            label = `Side: ${formatValue(args[0] || 0, unit, 1)}`;
            break;
          case 'tree':
            label = `Tree: 4.2m`;
            break;
          case 'bush':
            label = `Bush: 1.0m`;
            break;
          case 'fence':
            label = `Fence: 2.4m × 1.1m`;
            break;
          case 'railing':
            label = `Railing: 2.0m × 1.0m`;
            break;
          case 'lamp':
            label = `Lamp Post: 3.2m`;
            break;
          case 'bench':
            label = `Park Bench: 1.8m`;
            break;
          case 'rock':
            label = `Rock: 1.2m`;
            break;
          default:
            label = null;
        }
        if (!label || !Array.isArray(shape.position)) return null;

        return (
          <Html
            key={`dim-${shape.id}`}
            position={[shape.position[0], shape.position[1] + 0.6, shape.position[2]]}
            center
            occlude={false}
          >
            <div className="bg-black/80 text-white text-xs font-medium px-2 py-1 rounded whitespace-nowrap pointer-events-none shadow-lg border border-cyan-500/40">
              {label}
            </div>
          </Html>
        );
      })}

      {/* Inference Locking: snap indicator */}
      {snapIndicator && (
        <Html position={snapIndicator.point} center occlude={false} zIndexRange={[50, 60]}>
          <div className="flex flex-col items-center gap-1 pointer-events-none -translate-y-4">
            <div
              className={cn(
                'w-2.5 h-2.5 shadow-lg',
                snapIndicator.type === 'endpoint' ? 'bg-green-400 rotate-45 border border-green-600' : snapIndicator.type === 'midpoint' ? 'bg-cyan-400 rounded-full border border-cyan-600' : 'bg-fuchsia-400 rounded-full border border-fuchsia-600 ring-2 ring-fuchsia-200'
              )}
            />
            <div className="bg-black/80 text-white text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded whitespace-nowrap shadow border border-white/20">
              {snapIndicator.tooltip || (snapIndicator.type === 'endpoint' ? 'Endpoint' : snapIndicator.type === 'midpoint' ? 'Midpoint' : 'Center')}
            </div>
          </div>
        </Html>
      )}

      {/* Inference Tracking Guide line */}
      {trackingGuide && (
        <group>
          <Line
            points={[trackingGuide.source, trackingGuide.target]}
            color={trackingGuide.color}
            lineWidth={1.5}
            dashed
            dashScale={10}
            transparent
            opacity={0.85}
          />
          {trackingGuide.label && (
            <Html position={trackingGuide.target} center occlude={false} zIndexRange={[50, 60]}>
              <div className="bg-black/85 text-white text-[9px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap -translate-y-4 pointer-events-none border border-white/20 shadow-md">
                {trackingGuide.label}
              </div>
            </Html>
          )}
        </group>
      )}

      {/* Inference Locking: axis-lock guide line */}
      {axisLock && drawingStart && (
        <Line
          points={[
            [drawingStart.x - (axisLock === 'x' ? 500 : 0), drawingStart.y - (axisLock === 'y' ? 500 : 0), drawingStart.z - (axisLock === 'z' ? 500 : 0)],
            [drawingStart.x + (axisLock === 'x' ? 500 : 0), drawingStart.y + (axisLock === 'y' ? 500 : 0), drawingStart.z + (axisLock === 'z' ? 500 : 0)],
          ]}
          color={axisLock === 'x' ? '#ef4444' : axisLock === 'y' ? '#22c55e' : '#3b82f6'}
          lineWidth={1.5}
          dashed
          dashScale={8}
          transparent
          opacity={0.6}
        />
      )}

      {/* Inference Locking: typed-length HUD while drawing a line */}
      {typedLength && drawingStart && lastDrawTarget && (
        <Html
          position={[(drawingStart.x + lastDrawTarget.x) / 2, (drawingStart.y + lastDrawTarget.y) / 2 + 0.4, (drawingStart.z + lastDrawTarget.z) / 2]}
          center
          occlude={false}
        >
          <div className="bg-trimble-blue text-white text-xs font-bold px-2 py-1 rounded whitespace-nowrap shadow-lg border border-white/30">
            {typedLength}{unit === 'mm' ? ' mm' : unit === 'cm' ? ' cm' : ' m'}<span className="animate-pulse">|</span>
          </div>
        </Html>
      )}

      {/* Measuring Tape Preview (in-progress) */}
      {tapeStart && tapeEnd && (
        <group>
          <Line
            points={[[tapeStart.x, tapeStart.y, tapeStart.z], [tapeEnd.x, tapeEnd.y, tapeEnd.z]]}
            color="#FFD700"
            lineWidth={2}
          />
          <Html
            position={[(tapeStart.x + tapeEnd.x) / 2, (tapeStart.y + tapeEnd.y) / 2, (tapeStart.z + tapeEnd.z) / 2]}
            center
            occlude={false}
          >
            <div className="bg-black/80 text-white text-xs font-medium px-2 py-1 rounded whitespace-nowrap shadow-lg border border-yellow-500/50">
              {formatValue(tapeStart.distanceTo(tapeEnd), unit, 2)}
            </div>
          </Html>
        </group>
      )}
      {activeTool === 'arc' && arcStep === 1 && arcStart && arcEnd && (
        <group>
          <Line
            points={[[arcStart.x, arcStart.y, arcStart.z], [arcEnd.x, arcEnd.y, arcEnd.z]]}
            color='#38bdf8'
            lineWidth={3}
          />
          <mesh position={[arcStart.x, arcStart.y, arcStart.z]}>
            <sphereGeometry args={[0.06, 16, 16]} />
            <meshBasicMaterial color="#38bdf8" />
          </mesh>
          <mesh position={[arcEnd.x, arcEnd.y, arcEnd.z]}>
            <sphereGeometry args={[0.06, 16, 16]} />
            <meshBasicMaterial color="#38bdf8" />
          </mesh>
          <Html position={[(arcStart.x + arcEnd.x) / 2, (arcStart.y + arcEnd.y) / 2 + 0.2, (arcStart.z + arcEnd.z) / 2]} center>
            <div className="bg-black/80 text-cyan-300 font-mono text-[10px] px-1.5 py-0.5 rounded shadow pointer-events-none whitespace-nowrap">
              Chord: {formatValue(arcStart.distanceTo(arcEnd), unit, 2)}
            </div>
          </Html>
        </group>
      )}

      {activeTool === 'arc' && arcStep === 2 && arcStart && arcEnd && arcBulge && (() => {
        let previewPts = computeArcPoints(arcStart, arcEnd, arcBulge);
        if (!previewPts || previewPts.length < 2) {
          previewPts = [arcStart, arcBulge, arcEnd];
        }
        return (
          <group>
            <Line
              points={previewPts.map(p => [p.x, p.y, p.z])}
              color='#22c55e'
              lineWidth={3.5}
            />
            {/* Guide line to bulge control point */}
            <Line
              points={[[arcStart.x, arcStart.y, arcStart.z], [arcBulge.x, arcBulge.y, arcBulge.z], [arcEnd.x, arcEnd.y, arcEnd.z]]}
              color='#eab308'
              lineWidth={1}
              dashed
              dashScale={10}
            />
            <mesh position={[arcStart.x, arcStart.y, arcStart.z]}>
              <sphereGeometry args={[0.06, 16, 16]} />
              <meshBasicMaterial color="#22c55e" />
            </mesh>
            <mesh position={[arcEnd.x, arcEnd.y, arcEnd.z]}>
              <sphereGeometry args={[0.06, 16, 16]} />
              <meshBasicMaterial color="#22c55e" />
            </mesh>
            <mesh position={[arcBulge.x, arcBulge.y, arcBulge.z]}>
              <sphereGeometry args={[0.06, 16, 16]} />
              <meshBasicMaterial color="#eab308" />
            </mesh>
          </group>
        );
      })()}

      {/* Landscape Sculpting Cursor Preview */}
      {(activeTool === 'landscape_sculpt' || activeTool === 'landscape_mask') && sculptCursorPos && (
        <group position={[sculptCursorPos.x, sculptCursorPos.y + 0.05, sculptCursorPos.z]}>
          {/* Circular ring denoting brush radius */}
          {(() => {
            const rad = landscapeSculptSettings.radius;
            const segments = 48;
            const ringPts: [number, number, number][] = [];
            for (let i = 0; i <= segments; i++) {
              const theta = (i / segments) * Math.PI * 2;
              ringPts.push([Math.cos(theta) * rad, 0, Math.sin(theta) * rad]);
            }
            const brushColor = 
              landscapeSculptSettings.mode === 'pull' ? '#ef4444' :
              landscapeSculptSettings.mode === 'push' ? '#3b82f6' :
              landscapeSculptSettings.mode === 'smooth' ? '#10b981' :
              landscapeSculptSettings.mode === 'flatten' ? '#f59e0b' : '#8b5cf6';
            return (
              <>
                <Line points={ringPts} color={brushColor} lineWidth={3} />
                <mesh position={[0, 0, 0]}>
                  <sphereGeometry args={[0.08, 16, 16]} />
                  <meshBasicMaterial color={brushColor} />
                </mesh>
              </>
            );
          })()}
        </group>
      )}

      {/* Landscape Road Drawing Preview */}
      {(activeTool === 'landscape_road' || activeTool === 'landscape_zone') && roadPoints.length > 0 && (
        <group>
          {roadPoints.length >= 2 && (
            <Line
              points={roadPoints.map(p => [p.x, p.y + 0.05, p.z] as [number, number, number])}
              color="#f59e0b"
              lineWidth={3.5}
            />
          )}
          {roadPoints.map((pt, idx) => (
            <mesh key={idx} position={[pt.x, pt.y + 0.08, pt.z]}>
              <cylinderGeometry args={[0.12, 0.12, 0.08, 16]} />
              <meshBasicMaterial color={idx === 0 ? "#22c55e" : idx === roadPoints.length - 1 ? "#ef4444" : "#f59e0b"} />
            </mesh>
          ))}
        </group>
      )}

      {activeTool === 'offset' && offsetPreviewPoints && offsetPreviewPoints.length > 2 && (
        <Line
          points={offsetPreviewPoints.map(p => [p.x, p.y, p.z] as [number, number, number])}
          color={offsetPreviewDistance < 0 ? '#f59e0b' : '#22c55e'}
          lineWidth={2}
        />
      )}

      {/* Poly Drawing Preview */}
      {activeTool === 'poly' && polyVertices.length > 0 && (
        <group>
          {/* Completed Segments */}
          {polyVertices.length >= 2 && (
            <Line
              points={polyVertices.map(v => [v.x, v.y, v.z])}
              color="#0063A3"
              lineWidth={2}
            />
          )}
          {/* Active Preview Segment */}
          {polyCandidatePos && (
            <Line
              points={[
                [polyVertices[polyVertices.length - 1].x, polyVertices[polyVertices.length - 1].y, polyVertices[polyVertices.length - 1].z],
                [polyCandidatePos.x, polyCandidatePos.y, polyCandidatePos.z]
              ]}
              color={polyHoveredVertex === 0 ? "#FFD700" : "#0063A3"}
              lineWidth={polyHoveredVertex === 0 ? 4 : 2}
            />
          )}
          {/* Ghost Closing Line */}
          {polyVertices.length >= 2 && polyCandidatePos && (
             <Line
               points={[
                 [polyCandidatePos.x, polyCandidatePos.y, polyCandidatePos.z],
                 [polyVertices[0].x, polyVertices[0].y, polyVertices[0].z]
               ]}
               color={polyHoveredVertex === 0 ? "#FFD700" : "#0063A3"}
               lineWidth={(polyHoveredVertex === 0 || polyVertices.length >= 3) ? (polyHoveredVertex === 0 ? 6 : 2) : 1}
               dashed={polyHoveredVertex !== 0}
               dashSize={0.1}
               gapSize={0.05}
             />
          )}
          {/* Vertices */}
          {polyVertices.map((v, i) => (
            <mesh key={i} position={v}>
              <sphereGeometry args={[i === 0 && polyHoveredVertex === 0 ? 0.08 : 0.04, 16, 16]} />
              <meshBasicMaterial color={i === 0 && polyHoveredVertex === 0 ? "#FFD700" : "#0063A3"} />
            </mesh>
          ))}
        </group>
      )}

      {/* Wall Drawing Preview (Poly-style continuous 3D wall placement) */}
      {activeTool === 'wall' && wallVertices.length > 0 && (
        <group>
          {/* Active 3D Wall Box Preview */}
          {wallCandidatePos && (() => {
            const lastV = wallVertices[wallVertices.length - 1];
            const dist = lastV.distanceTo(wallCandidatePos);
            if (dist < 0.05) return null;
            const wallH = 2.8;
            const wallT = 0.2;
            const center = lastV.clone().lerp(wallCandidatePos, 0.5);
            center.y = Math.max(lastV.y, wallCandidatePos.y) + wallH / 2;
            const dir = new THREE.Vector3().subVectors(wallCandidatePos, lastV);
            const angle = Math.atan2(dir.z, dir.x);
            const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angle);

            return (
              <group>
                <mesh position={center} quaternion={quat}>
                  <boxGeometry args={[dist, wallH, wallT]} />
                  <meshStandardMaterial 
                    color={activeMaterial || '#3b82f6'} 
                    roughness={activePBR.roughness} 
                    metalness={activePBR.metalness}
                    transparent 
                    opacity={0.65} 
                  />
                </mesh>
                {/* Baseline Guide */}
                <Line
                  points={[
                    [lastV.x, lastV.y + 0.02, lastV.z],
                    [wallCandidatePos.x, wallCandidatePos.y + 0.02, wallCandidatePos.z]
                  ]}
                  color={wallHoveredVertex === 0 ? "#FFD700" : "#3b82f6"}
                  lineWidth={3}
                />
              </group>
            );
          })()}

          {/* Ghost Closing Line if looping back to start vertex */}
          {wallVertices.length >= 2 && wallCandidatePos && (
            <Line
              points={[
                [wallCandidatePos.x, wallCandidatePos.y + 0.02, wallCandidatePos.z],
                [wallVertices[0].x, wallVertices[0].y + 0.02, wallVertices[0].z]
              ]}
              color={wallHoveredVertex === 0 ? "#FFD700" : "#94a3b8"}
              lineWidth={wallHoveredVertex === 0 ? 4 : 1.5}
              dashed={wallHoveredVertex !== 0}
              dashSize={0.15}
              gapSize={0.08}
            />
          )}

          {/* Corner Node Markers */}
          {wallVertices.map((v, i) => (
            <mesh key={i} position={[v.x, v.y + 0.05, v.z]}>
              <cylinderGeometry args={[i === 0 && wallHoveredVertex === 0 ? 0.12 : 0.06, i === 0 && wallHoveredVertex === 0 ? 0.12 : 0.06, 0.1, 16]} />
              <meshBasicMaterial color={i === 0 && wallHoveredVertex === 0 ? "#FFD700" : (i === 0 ? "#22c55e" : "#3b82f6")} />
            </mesh>
          ))}
        </group>
      )}

      {/* Fence / Railing Path Drawing Preview */}
      {(activeTool === 'fence' || activeTool === 'railing') && fenceVertices.length > 0 && (
        <group>
          {/* Active 3D Segment Preview */}
          {fenceCandidatePos && (() => {
            const lastV = fenceVertices[fenceVertices.length - 1];
            const dist = lastV.distanceTo(fenceCandidatePos);
            if (dist < 0.08) return null;
            const height = activeTool === 'fence' ? 1.1 : 1.0;
            const center = lastV.clone().lerp(fenceCandidatePos, 0.5);
            const dir = new THREE.Vector3().subVectors(fenceCandidatePos, lastV);
            const angle = Math.atan2(dir.z, dir.x);
            const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angle);

            return (
              <group>
                <mesh position={[center.x, center.y, center.z]} quaternion={quat}>
                  {activeTool === 'fence' ? (
                    <primitive object={createFenceGeometry(dist, height)} attach="geometry" />
                  ) : (
                    <primitive object={createRailingGeometry(dist, height)} attach="geometry" />
                  )}
                  <meshStandardMaterial 
                    color={activeTool === 'fence' ? '#854d0e' : '#475569'} 
                    roughness={0.7} 
                    metalness={0.1}
                    transparent 
                    opacity={0.65} 
                  />
                </mesh>
                {/* Baseline Guide */}
                <Line
                  points={[
                    [lastV.x, lastV.y + 0.02, lastV.z],
                    [fenceCandidatePos.x, fenceCandidatePos.y + 0.02, fenceCandidatePos.z]
                  ]}
                  color={fenceHoveredVertex === 0 ? "#FFD700" : (activeTool === 'fence' ? "#854d0e" : "#475569")}
                  lineWidth={3}
                />
              </group>
            );
          })()}

          {/* Ghost Closing Line when snapping to first vertex */}
          {fenceVertices.length >= 2 && fenceCandidatePos && (
            <Line
              points={[
                [fenceCandidatePos.x, fenceCandidatePos.y + 0.02, fenceCandidatePos.z],
                [fenceVertices[0].x, fenceVertices[0].y + 0.02, fenceVertices[0].z]
              ]}
              color={fenceHoveredVertex === 0 ? "#FFD700" : "#94a3b8"}
              lineWidth={fenceHoveredVertex === 0 ? 4 : 1.5}
              dashed={fenceHoveredVertex !== 0}
              dashSize={0.15}
              gapSize={0.08}
            />
          )}

          {/* Placed Waypoints */}
          {fenceVertices.map((v, i) => (
            <mesh key={i} position={[v.x, v.y + 0.04, v.z]}>
              <cylinderGeometry args={[i === 0 && fenceHoveredVertex === 0 ? 0.12 : 0.06, i === 0 && fenceHoveredVertex === 0 ? 0.12 : 0.06, 0.08, 16]} />
              <meshBasicMaterial color={i === 0 && fenceHoveredVertex === 0 ? "#FFD700" : (i === 0 ? "#22c55e" : (activeTool === 'fence' ? "#854d0e" : "#475569"))} />
            </mesh>
          ))}
        </group>
      )}

      {(ambientOcclusionEnabled || (fogSettings.enabled && (fogSettings.type === 'super-mega' || (fogSettings.type === 'standard' && fogSettings.colorCount > 1)))) && (
        <EffectComposer enableNormalPass={ambientOcclusionEnabled}>
          {ambientOcclusionEnabled && (
            <SSAO 
              intensity={15} 
              radius={0.3} 
              luminanceInfluence={0.6} 
            />
          )}
          {fogSettings.enabled && (fogSettings.type === 'super-mega' || (fogSettings.type === 'standard' && fogSettings.colorCount > 1)) && (
            <FogEffect 
              settings={fogSettings} 
              camera={camera}
            />
          )}
        </EffectComposer>
      )}
      {hoveredFace && ['pushpull', 'offset', 'paint', 'select', 'eraser'].includes(activeTool) && !pushPullState && (
        <SurfaceHighlight 
          shapeId={hoveredFace.shapeId} 
          faceIndex={hoveredFace.faceIndex} 
          subFaceIndex={hoveredFace.subFaceIndex} 
        />
      )}

    </>
  );
}

function EnvironmentLighting() {
  const { 
    skybox, 
    skyboxBlur, 
    environmentIntensity, 
    skyboxRotation,
    theme
  } = useApp();
  const { gl, scene } = useThree();

  useEffect(() => {
    const rotation = (skyboxRotation * Math.PI) / 180;
    // @ts-ignore - backgroundRotation is available in recent Three.js
    scene.backgroundRotation.set(0, rotation, 0);
    // @ts-ignore - environmentRotation is available in recent Three.js
    scene.environmentRotation.set(0, rotation, 0);
    // @ts-ignore - environmentIntensity is available in recent Three.js
    scene.environmentIntensity = environmentIntensity;
  }, [skyboxRotation, environmentIntensity, scene, skybox]);

  // Hardware fallback detection
  const isHDRSupported = gl.capabilities.isWebGL2;
  
  if (skybox === 'none' || !isHDRSupported) {
    return (
      <>
        {skybox === 'none' ? <color attach="background" args={[theme === 'light' ? '#e5e5e5' : '#2B2B2B']} /> : null}
        <hemisphereLight intensity={0.5} groundColor="#444444" />
      </>
    );
  }

  return (
    <Environment 
      preset={
        skybox === 'golden-hour' ? 'sunset' : 
        skybox === 'sunrise' ? 'dawn' :
        skybox === 'twilight' ? 'night' :
        skybox === 'woodland' ? 'forest' :
        skybox === 'cyberspace-neon' ? 'apartment' :
        skybox === 'studio' ? 'studio' :
        'city'
      } 
      background 
      blur={skyboxBlur}
    />
  );
}

// At component level — allocate once, reuse every frame
const _lightDir = new THREE.Vector3();

const COLLAB_COLORS = [
  '#f43f5e', // rose-500
  '#ec4899', // pink-500
  '#d946ef', // fuchsia-500
  '#a855f7', // purple-500
  '#8b5cf6', // violet-500
  '#6366f1', // indigo-500
  '#3b82f6', // blue-500
  '#0ea5e9', // sky-500
  '#06b6d4', // cyan-500
  '#14b8a6', // teal-500
  '#10b981', // emerald-500
  '#22c55e', // green-500
  '#84cc16', // lime-500
  '#eab308', // yellow-500
  '#f59e0b', // amber-500
  '#f97316', // orange-500
  '#ef4444', // red-500
];

const getCollabColor = (email: string) => {
  if (!email) return COLLAB_COLORS[0];
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = email.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLLAB_COLORS[Math.abs(hash) % COLLAB_COLORS.length];
};

function ProjectorLight({ light, baseColor, shadowsEnabled }: { light: CustomLight, baseColor: THREE.Color, shadowsEnabled: boolean }) {
  const { diagLog } = useApp();
  const { invalidate } = useThree();
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const [videoTexture, setVideoTexture] = useState<THREE.VideoTexture | null>(null);
  const [error, setError] = useState(false);
  const spinRef = useRef(false);
  const speedRef = useRef(1);
  // Refs so useFrame always reads the live texture, never a stale closure
  const textureRef = useRef<THREE.Texture | null>(null);
  const videoTextureRef = useRef<THREE.VideoTexture | null>(null);
  const frameCountRef = useRef(0);
  const lightRef = useRef<THREE.SpotLight>(null!);

  // Fix 2: Directly assign refs in render body to prevent stale closures and avoid controlled increment loop
  spinRef.current = !!light.rotateTexture;
  speedRef.current = light.textureRotationSpeed || 1;

  // Diagnostic Render log
  diagLog("RENDER", "ProjectorLight render", {
    rotateTexture: light.rotateTexture,
    textureRotationSpeed: light.textureRotationSpeed,
    projectorMode: light.projectorMode,
    map: light.map,
    spinRef: spinRef.current,
    speedRef: speedRef.current,
    hasTexture: !!texture,
    hasVideoTexture: !!videoTexture,
    textureRef: !!textureRef.current,
    videoTextureRef: !!videoTextureRef.current
  });

  // Keep texture refs in sync with state
  useEffect(() => { 
    diagLog("EFFECT", "textureRef sync", { texture: !!texture });
    textureRef.current = texture; 
  }, [texture]);
  
  useEffect(() => { 
    diagLog("EFFECT", "videoTextureRef sync", { videoTexture: !!videoTexture });
    videoTextureRef.current = videoTexture; 
  }, [videoTexture]);

  useEffect(() => {
    diagLog("EFFECT", "projectorMode/map change", { mode: light.projectorMode, map: light.map });
    if (light.projectorMode === 'texture' && light.map) {
      setError(false);
      const loader = new THREE.TextureLoader();
      loader.crossOrigin = 'anonymous';
      loader.load(
        light.map,
        (tex) => {
          diagLog("TEXTURE", "Texture loaded successfully", {
            uuid: tex.uuid,
            src: light.map,
            center: [tex.center.x, tex.center.y],
            wrapS: tex.wrapS,
            wrapT: tex.wrapT
          });
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          tex.center.set(0.5, 0.5);
          setTexture(tex);
          setVideoTexture(null);
        },
        undefined,
        (err) => {
          diagLog("ERROR", "Failed to load projector texture", { error: String(err) });
          console.error("Failed to load projector texture:", err);
          setError(true);
          setTexture(null);
        }
      );
    } else if (light.projectorMode === 'video' && light.map) {
      setError(false);
      try {
        const video = document.createElement('video');
        video.src = light.map;
        video.crossOrigin = 'anonymous';
        video.loop = true;
        video.muted = true;
        
        diagLog("TEXTURE", "VideoTexture creation started", { src: light.map });
        
        video.play().then(() => {
          diagLog("TEXTURE", "Video playing", { src: light.map });
        }).catch(e => {
          diagLog("ERROR", "Video play failed", { error: String(e) });
          console.error("Video play failed:", e);
        });
        
        const vTex = new THREE.VideoTexture(video);
        diagLog("TEXTURE", "VideoTexture created", { 
          src: video.src, 
          readyState: video.readyState,
          uuid: vTex.uuid
        });
        
        vTex.colorSpace = THREE.SRGBColorSpace;
        vTex.center.set(0.5, 0.5);
        setVideoTexture(vTex);
        setTexture(null);
      } catch (err) {
        diagLog("ERROR", "Failed to load projector video", { error: String(err) });
        console.error("Failed to load projector video:", err);
        setError(true);
        setVideoTexture(null);
      }
    } else {
      setTexture(null);
      setVideoTexture(null);
      setError(false);
    }
  }, [light.map, light.projectorMode]);

  // Animation loop — reads from refs, never stale state
  useFrame((state, delta) => {
    if (!spinRef.current || !lightRef.current) return;

    // Fix 1: Ensure frame loop runs in 'demand' mode by invalidating
    invalidate();

    // Compute unit vector from light position → target position
    _lightDir
      .subVectors(lightRef.current.target.position, lightRef.current.position)
      .normalize();

    // Rotate the light's `up` vector around that axis by delta * speed.
    // Three.js rebuilds the spotlight's shadow camera every frame using
    // camera.lookAt(target), which respects `light.up` as the up-vector.
    // Spinning `up` around the aim axis is the ONLY thing that actually
    // rolls the projected SpotLight.map without drifting the aim direction.
    lightRef.current.up.applyAxisAngle(_lightDir, delta * speedRef.current);

    // NOTE: Remove all texture.rotation code — it has zero effect on SpotLight.map.
    // NOTE: Remove rotateZ() — it changes the transform matrix but NOT `up`,
    //       so Three.js resets the roll every frame when rebuilding the shadow camera.
  });

  const map = (light.projectorMode === 'texture' || light.projectorMode === 'video' || (!light.projectorMode && light.map)) ? (texture || videoTexture) : null;
  return (
    <spotLight 
      ref={lightRef}
      position={light.position} 
      color={map ? "#ffffff" : baseColor} 
      intensity={light.intensity * (light.scale || 1)} 
      castShadow={shadowsEnabled}
      target-position={light.target || [0, 0, 0]}
      distance={(light.distance || 50) * (light.scale || 1)}
      angle={light.angle || Math.PI / 3}
      penumbra={light.penumbra || 0}
      decay={light.decay || 2}
      map={map}
    />
  );
}

function CustomLightComponent({ 
  light, 
  shadowsEnabled, 
  showLightsource,
  activeTool,
  selectedId,
  selectedLightId,
  setSelectedLightId,
  setSelectedId,
  setSelectedIds,
  setSelectedSurface,
  handleContextMenu,
  isDragging
}: { 
  light: CustomLight, 
  shadowsEnabled: boolean, 
  showLightsource: boolean,
  activeTool: string,
  selectedId: string | null,
  selectedLightId: string | null,
  setSelectedLightId: (id: string | null) => void,
  setSelectedId: (id: string | null) => void,
  setSelectedIds: (ids: string[]) => void,
  setSelectedSurface: (surface: any) => void,
  handleContextMenu: (e: any, id: string, type: any) => void,
  isDragging: boolean
}) {
  const baseColor = useMemo(() => {
    const color = new THREE.Color(light.color);
    const contrast = light.contrast !== undefined ? light.contrast : 0.5;
    if (contrast < 0.5) {
      color.multiplyScalar(contrast * 2);
    } else if (contrast > 0.5) {
      color.lerp(new THREE.Color('#ffffff'), (contrast - 0.5) * 2);
    }
    return color;
  }, [light.color, light.contrast]);

  const rectRef = useRef<any>(null);

  useFrame((state, delta) => {
    if (light.type === 'rect' && light.animateRotationY && rectRef.current) {
      const speed = light.rotationYSpeed || 1;
      rectRef.current.rotation.y += delta * speed;
    }
  });

  return (
    <React.Fragment>
      {light.type === 'point' && (
        <pointLight 
          position={(isDragging && selectedLightId === light.id) ? undefined : light.position} 
          color={baseColor} 
          intensity={light.intensity * (light.scale || 1)} 
          distance={(light.distance || 50) * (light.scale || 1)}
          castShadow={shadowsEnabled}
        />
      )}
      {light.type === 'directional' && (
        <directionalLight 
          position={(isDragging && selectedLightId === light.id) ? undefined : light.position} 
          color={baseColor} 
          intensity={light.intensity * (light.scale || 1)} 
          castShadow={shadowsEnabled}
          target-position={light.target || [0, 0, 0]}
        />
      )}
      {light.type === 'spot' && (
        <spotLight 
          position={(isDragging && selectedLightId === light.id) ? undefined : light.position} 
          color={baseColor} 
          intensity={light.intensity * (light.scale || 1)} 
          castShadow={shadowsEnabled}
          target-position={light.target || [0, 0, 0]}
          distance={(light.distance || 50) * (light.scale || 1)}
          angle={light.angle || Math.PI / 3}
          penumbra={light.penumbra || 0}
          decay={light.decay || 2}
        />
      )}
      {light.type === 'projector' && light.map && (
        <Suspense fallback={null}>
          <ProjectorLight light={light} baseColor={baseColor} shadowsEnabled={shadowsEnabled} />
        </Suspense>
      )}
      {light.type === 'rect' && (
        <rectAreaLight 
          ref={rectRef}
          position={(isDragging && selectedLightId === light.id) ? undefined : light.position} 
          color={baseColor} 
          intensity={light.intensity} 
          width={light.width || 1}
          height={light.height || 1}
          rotation={[
            (light.rotationX || 0) * Math.PI / 180,
            (light.rotationY || light.rectRotation || 0) * Math.PI / 180,
            (light.rotationZ || 0) * Math.PI / 180
          ]}
        />
      )}
      {(showLightsource || (activeTool === 'move' && !selectedId) || activeTool === 'select') && (
        <mesh 
          position={(isDragging && selectedLightId === light.id) ? undefined : light.position}
          userData={{ id: light.id, type: 'light' }}
          onClick={(e) => {
            e.stopPropagation();
            if (activeTool === 'select' || activeTool === 'move') {
              setSelectedLightId(light.id);
              setSelectedId(null);
              setSelectedIds([]);
            }
          }}
        >
          <sphereGeometry args={[0.2 * (light.scale || 1), 16, 16]} />
          <meshBasicMaterial 
            color={light.color} 
            transparent 
            opacity={0.8}
            wireframe={activeTool === 'select'}
          />
        </mesh>
      )}
    </React.Fragment>
  );
}

const stippleTexture = (() => {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, 8, 8);
      ctx.fillStyle = '#0063A3';
      ctx.fillRect(0, 0, 1.5, 1.5);
      ctx.fillRect(4, 4, 1.5, 1.5);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(24, 24);
    return tex;
  } catch {
    return null;
  }
})();

function StippledPolyMesh({ vertices, holes, height = 0.005 }: { vertices: [number, number][], holes?: [number, number][][], height?: number }) {
  const outerLoop: [number, number, number][] = [...vertices, vertices[0]].map(v => [v[0], v[1], 0.002]);
  return (
    <group>
      <mesh position={[0, 0, 0]}>
        <PolyGeometry vertices={vertices} height={height} holes={holes} />
        <meshBasicMaterial color="#0063A3" transparent opacity={0.12} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {stippleTexture && (
        <mesh position={[0, 0, 0.001]}>
          <PolyGeometry vertices={vertices} height={height} holes={holes} />
          <meshBasicMaterial color="#0063A3" map={stippleTexture} transparent opacity={0.85} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}
      <Line points={outerLoop} color="#0063A3" lineWidth={2.5} />
      {(holes || []).map((hole, hIdx) => {
        const holeLoop: [number, number, number][] = [...hole, hole[0]].map(v => [v[0], v[1], 0.002]);
        return <Line key={hIdx} points={holeLoop} color="#0063A3" lineWidth={2.5} />;
      })}
    </group>
  );
}

function StippledPlaneMesh({ width, height }: { width: number, height: number }) {
  const halfW = width / 2;
  const halfH = height / 2;
  const borderPoints: [number, number, number][] = [
    [-halfW, -halfH, 0.002],
    [halfW, -halfH, 0.002],
    [halfW, halfH, 0.002],
    [-halfW, halfH, 0.002],
    [-halfW, -halfH, 0.002],
  ];
  return (
    <group>
      <mesh position={[0, 0, 0]}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial color="#0063A3" transparent opacity={0.12} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {stippleTexture && (
        <mesh position={[0, 0, 0.001]}>
          <planeGeometry args={[width, height]} />
          <meshBasicMaterial color="#0063A3" map={stippleTexture} transparent opacity={0.85} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}
      <Line points={borderPoints} color="#0063A3" lineWidth={2.5} />
    </group>
  );
}

function StippledDiscMesh({ radius, segments }: { radius: number, segments: number }) {
  const edgePts: [number, number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (i % segments) * ((Math.PI * 2) / segments);
    edgePts.push([Math.cos(angle) * radius, 0.002, Math.sin(angle) * radius]);
  }
  return (
    <group>
      <mesh position={[0, 0, 0]}>
        <cylinderGeometry args={[radius, radius, 0.005, segments]} />
        <meshBasicMaterial color="#0063A3" transparent opacity={0.12} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {stippleTexture && (
        <mesh position={[0, 0.001, 0]}>
          <cylinderGeometry args={[radius, radius, 0.005, segments]} />
          <meshBasicMaterial color="#0063A3" map={stippleTexture} transparent opacity={0.85} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}
      <Line points={edgePts} color="#0063A3" lineWidth={2.5} />
    </group>
  );
}

function SurfaceHighlight({ shapeId, faceIndex, subFaceIndex }: { shapeId: string, faceIndex: number, subFaceIndex?: number }) {
  const { shapes } = useApp();
  const shape = shapes.find(s => s.id === shapeId);
  if (!shape || (shape.type !== 'box' && shape.type !== 'rect' && shape.type !== 'triangle' && shape.type !== 'prism' && shape.type !== 'poly' && shape.type !== 'circle')) return null;

  if (shape.type === 'poly') {
    const height = shape.args.height || 0;
    const zOffset = height > 0 ? height / 2 + 0.005 : 0.005;
    return (
      <group position={shape.position} quaternion={shape.quaternion ? new THREE.Quaternion(...shape.quaternion) : undefined} scale={shape.scale}>
        <group position={[0, 0, zOffset]}>
          <StippledPolyMesh vertices={shape.args.vertices} holes={(shape.args as any).holes} />
        </group>
      </group>
    );
  }

  if (shape.type === 'triangle' || shape.type === 'prism' || shape.type === 'circle') {
    const radius = shape.args[0];
    const height = shape.args[2] || 0.01;
    const radialSegments = (shape.type === 'triangle' || shape.type === 'prism') ? 3 : (shape.args[3] || 32);

    let pos: [number, number, number] = [0, 0, 0];
    let rot: [number, number, number] = [0, 0, 0];
    let size: [number, number] = [0, 0];
    let isCap = false;

    if (faceIndex < radialSegments * 2) {
      // Side face
      const sideIndex = Math.floor(faceIndex / 2);
      const angle = (sideIndex * (2 * Math.PI / radialSegments)) + (Math.PI / radialSegments);
      const sideWidth = 2 * radius * Math.sin(Math.PI / radialSegments);
      const dist = radius * Math.cos(Math.PI / radialSegments);
      
      pos = [
        dist * Math.sin(angle),
        0,
        dist * Math.cos(angle)
      ];
      rot = [0, angle, 0];
      size = [sideWidth, height];
    } else if (faceIndex === radialSegments * 2) {
      // Top face
      pos = [0, height / 2 + 0.005, 0];
      rot = [0, 0, 0];
      isCap = true;
    } else if (faceIndex === radialSegments * 2 + 1) {
      // Bottom face
      pos = [0, -height / 2 - 0.005, 0];
      rot = [0, 0, 0];
      isCap = true;
    }

    return (
      <group position={shape.position} quaternion={shape.quaternion ? new THREE.Quaternion(...shape.quaternion) : undefined} scale={shape.scale}>
        <group position={pos} rotation={rot}>
          {isCap ? (
            <StippledDiscMesh radius={radius} segments={radialSegments} />
          ) : (
            <StippledPlaneMesh width={size[0]} height={size[1]} />
          )}
        </group>
      </group>
    );
  }

  let w = 1, h = 1, d = 1;
  if (Array.isArray(shape.args)) {
    [w, h, d] = shape.args;
  }
  let pos: [number, number, number] = [0, 0, 0];
  let rot: [number, number, number] = [0, 0, 0];
  let size: [number, number] = [0, 0];

  if (faceIndex <= 1) { pos = [w/2 + 0.005, 0, 0]; rot = [0, Math.PI/2, 0]; size = [d, h]; }
  else if (faceIndex <= 3) { pos = [-w/2 - 0.005, 0, 0]; rot = [0, -Math.PI/2, 0]; size = [d, h]; }
  else if (faceIndex <= 5) { pos = [0, h/2 + 0.005, 0]; rot = [-Math.PI/2, 0, 0]; size = [w, d]; }
  else if (faceIndex <= 7) { pos = [0, -h/2 - 0.005, 0]; rot = [Math.PI/2, 0, 0]; size = [w, d]; }
  else if (faceIndex <= 9) { pos = [0, 0, d/2 + 0.005]; rot = [0, 0, 0]; size = [w, h]; }
  else if (faceIndex <= 11) { pos = [0, 0, -d/2 - 0.005]; rot = [0, Math.PI, 0]; size = [w, h]; }

  if (subFaceIndex !== undefined && shape.surfaceDivisions?.[faceIndex]) {
    const division = shape.surfaceDivisions[faceIndex];
    const gridX = Array.isArray(division) ? division[0] : division;
    const gridY = Array.isArray(division) ? division[1] : division;
    
    const cellW = size[0] / gridX;
    const cellH = size[1] / gridY;
    const ix = subFaceIndex % gridX;
    const iy = Math.floor(subFaceIndex / gridX);
    
    const localX = -size[0]/2 + cellW/2 + ix * cellW;
    const localY = -size[1]/2 + cellH/2 + iy * cellH;
    
    return (
      <group position={shape.position} quaternion={shape.quaternion ? new THREE.Quaternion(...shape.quaternion) : undefined} scale={shape.scale}>
        <group rotation={rot} position={pos}>
           <group position={[localX, localY, 0]}>
             <StippledPlaneMesh width={cellW} height={cellH} />
           </group>
        </group>
      </group>
    );
  }

  return (
    <group position={shape.position} quaternion={shape.quaternion ? new THREE.Quaternion(...shape.quaternion) : undefined} scale={shape.scale}>
      <group position={pos} rotation={rot}>
        <StippledPlaneMesh width={size[0]} height={size[1]} />
      </group>
    </group>
  );
}

function regularPolygonVertices(radius: number, segments: number): [number, number][] {
  const verts: [number, number][] = [];
  const n = Math.max(3, Math.round(segments));
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2; // No half-segment offset: must match THREE.CylinderGeometry's own vertex placement (theta starts at 0), or offset outlines misalign with the real triangle/circle mesh (Task #142/#143)
    verts.push([radius * Math.sin(angle), radius * Math.cos(angle)]);
  }
  return verts;
}

function normalizePolyWinding(pts: [number, number][], ccw: boolean): [number, number][] {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % pts.length];
    area += p1[0] * p2[1] - p2[0] * p1[1];
  }
  const isCCW = area > 0;
  return isCCW === ccw ? pts : [...pts].reverse();
}

function PolyGeometry({ vertices, height = 0, bevelAmount = 0, bevelSegments = 4, uprightY = false, holes = undefined }: { vertices: [number, number][], height?: number, bevelAmount?: number, bevelSegments?: number, uprightY?: boolean, holes?: [number, number][][] }) {
  const geometry = useMemo(() => {
    if (!vertices || vertices.length < 3) return new THREE.BufferGeometry();
    
    // Filter out duplicate consecutive vertices which can break triangulation
    const filtered = vertices.filter((v, i) => {
      if (i === 0) return true;
      const prev = vertices[i-1];
      return v[0] !== prev[0] || v[1] !== prev[1];
    });

    if (filtered.length < 3) return new THREE.BufferGeometry();

    const outerCCW = normalizePolyWinding(filtered, true);
    const shape = new THREE.Shape();
    shape.moveTo(outerCCW[0][0], outerCCW[0][1]);
    for (let i = 1; i < outerCCW.length; i++) {
      shape.lineTo(outerCCW[i][0], outerCCW[i][1]);
    }
    shape.closePath();
    
    if (holes && holes.length > 0) {
      for (const holePts of holes) {
        if (!holePts || holePts.length < 3) continue;
        const holeCW = normalizePolyWinding(holePts, false);
        const path = new THREE.Path();
        path.moveTo(holeCW[0][0], holeCW[0][1]);
        for (let i = 1; i < holeCW.length; i++) {
          path.lineTo(holeCW[i][0], holeCW[i][1]);
        }
        path.closePath();
        shape.holes.push(path);
      }
    }
    
    try {
      if (height === 0) {
        return new THREE.ShapeGeometry(shape);
      } else {
        const safeBevel = Math.max(0, Math.min(bevelAmount, height / 2 - 0.001));
        const geo = new THREE.ExtrudeGeometry(shape, {
          depth: height,
          bevelEnabled: safeBevel > 0,
          bevelThickness: safeBevel,
          bevelSize: safeBevel,
          bevelSegments: Math.max(1, bevelSegments),
          bevelOffset: 0
        });
        geo.translate(0, 0, -height / 2); // Center in Z to match other primitives
        if (uprightY) geo.rotateX(-Math.PI / 2); // Re-orient extrusion axis from Z to Y for cylinder/prism-style shapes
        return geo;
      }
    } catch (err) {
      console.error('[PolyGeometry] Failed to create geometry:', err);
      return new THREE.BufferGeometry();
    }
  }, [vertices, height, bevelAmount, bevelSegments, uprightY, holes]);

  useEffect(() => {
    return () => {
      if (geometry) geometry.dispose();
    };
  }, [geometry]);

  return <primitive object={geometry} attach="geometry" />;
}

function CustomGeometry({ shape }: { shape: Shape }) {
  const geometry = useMemo(() => {
    // 1. Roadway Strip 3D Geometry
    if (shape.args?.isRoad && Array.isArray(shape.args?.path) && shape.args.path.length >= 2) {
      const pathPts = shape.args.path.map((p: any) => new THREE.Vector3(p[0], p[1], p[2]));
      const width = typeof shape.args.width === 'number' ? shape.args.width : 4.0;
      const embankment = !!shape.args.embankment;

      // Sample path finely using CatmullRomCurve3 if >= 2 points
      let samplePoints: THREE.Vector3[] = [];
      if (pathPts.length === 2) {
        const steps = 24;
        for (let s = 0; s <= steps; s++) {
          samplePoints.push(new THREE.Vector3().lerpVectors(pathPts[0], pathPts[1], s / steps));
        }
      } else {
        const curve = new THREE.CatmullRomCurve3(pathPts, false, 'centripetal');
        samplePoints = curve.getPoints(Math.max(36, pathPts.length * 16));
      }

      const vertices: number[] = [];
      const normals: number[] = [];
      const uvs: number[] = [];
      const indices: number[] = [];

      let totalLen = 0;
      const dists: number[] = [0];
      for (let i = 1; i < samplePoints.length; i++) {
        totalLen += samplePoints[i].distanceTo(samplePoints[i - 1]);
        dists.push(totalLen);
      }

      for (let i = 0; i < samplePoints.length; i++) {
        const curr = samplePoints[i];
        let tangent = new THREE.Vector3();
        if (i === 0) {
          tangent.subVectors(samplePoints[1], curr).normalize();
        } else if (i === samplePoints.length - 1) {
          tangent.subVectors(curr, samplePoints[i - 1]).normalize();
        } else {
          tangent.subVectors(samplePoints[i + 1], samplePoints[i - 1]).normalize();
        }

        const up = new THREE.Vector3(0, 1, 0);
        let side = new THREE.Vector3().crossVectors(tangent, up).normalize();
        if (side.lengthSq() < 0.001) side = new THREE.Vector3(1, 0, 0);

        const vFrac = dists[i] / (totalLen || 1);
        const halfW = width / 2;

        if (embankment) {
          // 4 vertices per cross-section: Outer left slope, Left road edge, Right road edge, Outer right slope
          const p0 = curr.clone().addScaledVector(side, -halfW - 0.8).add(new THREE.Vector3(0, -0.22, 0));
          const p1 = curr.clone().addScaledVector(side, -halfW).add(new THREE.Vector3(0, 0.05, 0));
          const p2 = curr.clone().addScaledVector(side, halfW).add(new THREE.Vector3(0, 0.05, 0));
          const p3 = curr.clone().addScaledVector(side, halfW + 0.8).add(new THREE.Vector3(0, -0.22, 0));

          vertices.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z);
          normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
          uvs.push(0, vFrac * totalLen, 0.2, vFrac * totalLen, 0.8, vFrac * totalLen, 1, vFrac * totalLen);
        } else {
          // 2 main top vertices with slight thickness
          const pLeft = curr.clone().addScaledVector(side, -halfW).add(new THREE.Vector3(0, 0.05, 0));
          const pRight = curr.clone().addScaledVector(side, halfW).add(new THREE.Vector3(0, 0.05, 0));

          vertices.push(pLeft.x, pLeft.y, pLeft.z, pRight.x, pRight.y, pRight.z);
          normals.push(0, 1, 0, 0, 1, 0);
          uvs.push(0, vFrac * totalLen, 1, vFrac * totalLen);
        }
      }

      const numCols = embankment ? 4 : 2;
      for (let i = 0; i < samplePoints.length - 1; i++) {
        for (let c = 0; c < numCols - 1; c++) {
          const row1 = i * numCols;
          const row2 = (i + 1) * numCols;
          const a = row1 + c;
          const b = row1 + c + 1;
          const c_idx = row2 + c + 1;
          const d = row2 + c;

          indices.push(a, b, c_idx);
          indices.push(a, c_idx, d);
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      return geo;
    }

    // 2. Custom JSON BufferGeometry
    if (shape.geometryData) {
      try {
        const loader = new THREE.BufferGeometryLoader();
        return loader.parse(shape.geometryData);
      } catch (err) {
        console.warn('Error parsing custom geometryData:', err);
      }
    }

    // Fallback
    return new THREE.BoxGeometry(1, 1, 1);
  }, [shape.args, shape.geometryData]);

  useEffect(() => {
    return () => {
      if (geometry) geometry.dispose();
    };
  }, [geometry]);

  return <primitive object={geometry} attach="geometry" />;
}

function TerrainGeometry({ terrainData }: { terrainData?: any }) {
  const geometry = useMemo(() => {
    if (!terrainData || !terrainData.heights) {
      return new THREE.PlaneGeometry(20, 20, 32, 32);
    }
    const { gridX, gridY, width, depth, heights, shadingMode } = terrainData;
    const geo = new THREE.PlaneGeometry(width, depth, gridX - 1, gridY - 1);
    geo.rotateX(-Math.PI / 2); // Orient horizontally in XZ plane with Y as elevation

    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      if (heights[i] !== undefined) {
        pos.setY(i, heights[i]);
      }
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();

    // If texture repeating scale is provided, adjust the UV coordinates
    const uvAttr = geo.attributes.uv;
    const texScale = terrainData.textureScale !== undefined ? terrainData.textureScale : 8;
    if (uvAttr && texScale > 0) {
      for (let i = 0; i < uvAttr.count; i++) {
        uvAttr.setXY(i, uvAttr.getX(i) * texScale, uvAttr.getY(i) * texScale);
      }
      uvAttr.needsUpdate = true;
    }

    // Generate vertex colors if elevation, slope, or contour shading is requested
    if (shadingMode && shadingMode !== 'default') {
      const colors: number[] = [];
      const normals = geo.attributes.normal;
      
      let minH = Infinity, maxH = -Infinity;
      for (let i = 0; i < heights.length; i++) {
        if (heights[i] < minH) minH = heights[i];
        if (heights[i] > maxH) maxH = heights[i];
      }
      const rangeH = (maxH - minH) || 1;

      for (let i = 0; i < pos.count; i++) {
        const h = pos.getY(i);
        const normY = normals ? normals.getY(i) : 1; // 1 = flat horizontal, < 0.7 = steep
        const hFrac = Math.max(0, Math.min(1, (h - minH) / rangeH));

        if (shadingMode === 'slope') {
          // Green on flats, warm rock on medium slope, dark cliff on steep slope
          if (normY > 0.85) {
            colors.push(0.3, 0.65, 0.2);
          } else if (normY > 0.6) {
            colors.push(0.55, 0.5, 0.4);
          } else {
            colors.push(0.25, 0.25, 0.3);
          }
        } else if (shadingMode === 'contours') {
          // Stepped contour band lines
          const band = Math.sin(h * Math.PI * 4);
          if (band > 0.8) {
            colors.push(0.9, 0.8, 0.2);
          } else {
            colors.push(0.25 + hFrac * 0.3, 0.45 + hFrac * 0.25, 0.2);
          }
        } else {
          // 'elevation' mode: Lush green valley -> Stone mountain -> Snowy crest
          if (hFrac < 0.35) {
            colors.push(0.25, 0.55 + hFrac * 0.3, 0.15);
          } else if (hFrac < 0.75) {
            const t = (hFrac - 0.35) / 0.4;
            colors.push(0.35 + t * 0.25, 0.45 - t * 0.1, 0.25 + t * 0.15);
          } else {
            const t = (hFrac - 0.75) / 0.25;
            colors.push(0.6 + t * 0.38, 0.6 + t * 0.38, 0.65 + t * 0.34);
          }
        }
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    }

    return geo;
  }, [terrainData]);

  useEffect(() => {
    return () => {
      if (geometry) geometry.dispose();
    };
  }, [geometry]);

  return <primitive object={geometry} attach="geometry" />;
}

export default function Viewport() {
  const { 
    theme, 
    contextMenu, 
    setContextMenu, 
    selectedIds, 
    removeShape, 
    selectedSurface, 
    activeMaterial, 
    activePBR, 
    setShapes, 
    addShape,
    commitHistory,
    setMeasurements,
    skybox, 
    activeTagId, 
    shapes, 
    tags, 
    setSelectedId, 
    setSelectedSurface,
    recordAction,
    activeTool,
    selectedId,
    customLights,
    setCustomLights,
    selectedLightId,
    setSelectedLightId,
    ambientOcclusionEnabled,
    setAmbientOcclusionEnabled,
    setRightPanelVisible,
    setPanelVisibility,
    defaultCameraPosition,
    defaultCameraTarget,
    setSelectedIds,
    showCollaboratorCursors,
    unit
  } = useApp();
  const [styleLibraryTargetId, setStyleLibraryTargetId] = useState<string | null>(null);
  const [isPerspectiveOpen, setIsPerspectiveOpen] = useState(false);
  const [quadView, setQuadView] = useState(false);
  const [panelViews, setPanelViews] = useState<Array<'perspective' | 'top' | 'front' | 'right'>>(['perspective', 'top', 'front', 'right']);
  const [perspectiveTimeout, setPerspectiveTimeout] = useState<NodeJS.Timeout | null>(null);
  const [metadataShapeId, setMetadataShapeId] = useState<string | null>(null);
  const [metadataLightId, setMetadataLightId] = useState<string | null>(null);
  const [metadataTimeout, setMetadataTimeout] = useState<NodeJS.Timeout | null>(null);
  const [showDivideModal, setShowDivideModal] = useState(false);
  const [isHoveringMetadata, setIsHoveringMetadata] = useState(false);
  const [editingDimIndex, setEditingDimIndex] = useState<number | null>(null);
  const [editingPosIndex, setEditingPosIndex] = useState<number | null>(null);
  const [editingRotIndex, setEditingRotIndex] = useState<number | null>(null);
  const [dimValue, setDimValue] = useState('');
  const [posValue, setPosValue] = useState('');
  const [rotValue, setRotValue] = useState('');
  const [isMetadataMaterialPickerOpen, setIsMetadataMaterialPickerOpen] = useState(false);
  const [isDividePopupOpen, setIsDividePopupOpen] = useState(false);
  const [divideValueX, setDivideValueX] = useState('2');
  const [divideValueY, setDivideValueY] = useState('2');
  const [divideValueSingle, setDivideValueSingle] = useState('2');

  const handleDivideSurface = (gridX: number, gridY: number) => {
    if (!selectedSurface) return;
    setShapes(prev => prev.map(s => {
      if (s.id === selectedSurface.shapeId) {
        const surfaceDivisions = s.surfaceDivisions || {};
        const faceIdx = selectedSurface.faceIndex;
        // Apply to both triangles of the box face
        const otherIdx = faceIdx % 2 === 0 ? faceIdx + 1 : faceIdx - 1;
        
        recordAction(`sdk.divideSurface("${s.id}", ${faceIdx}, [${gridX}, ${gridY}]);`);

        return { 
          ...s, 
          surfaceDivisions: { 
            ...surfaceDivisions, 
            [faceIdx]: [gridX, gridY],
            [otherIdx]: [gridX, gridY]
          } 
        };
      }
      return s;
    }));
    setIsDividePopupOpen(false);
    setContextMenu(null);
  };

  const handleDeleteSurface = () => {
    if (!selectedSurface) return;
    console.log(`Deleting surface ${selectedSurface.faceIndex} of ${selectedSurface.shapeId}`);
    setContextMenu(null);
  };

  const handleApplyMaterialToSurface = (material: string) => {
    if (!selectedSurface) return;
    setShapes(prev => prev.map(s => {
      if (s.id === selectedSurface.shapeId) {
        const surfaceMaterials = s.surfaceMaterials || {};
        return { ...s, surfaceMaterials: { ...surfaceMaterials, [selectedSurface.faceIndex]: material } };
      }
      return s;
    }));
    setContextMenu(null);
  };

  const handlePerspectiveEnter = () => {
    if (perspectiveTimeout) clearTimeout(perspectiveTimeout);
    setIsPerspectiveOpen(true);
  };

  const handlePerspectiveLeave = () => {
    const timeout = setTimeout(() => {
      setIsPerspectiveOpen(false);
    }, 300);
    setPerspectiveTimeout(timeout);
  };

  const handleViewChange = (view: string) => {
    let position = CAMERA_VIEWS[view]?.pos || CAMERA_VIEWS.perspective.pos;
    let target = CAMERA_VIEWS[view]?.target || CAMERA_VIEWS.perspective.target;
    
    if (view === 'perspective' || !view) {
      position = defaultCameraPosition;
      target = defaultCameraTarget;
    }

    window.dispatchEvent(new CustomEvent('set-camera', { 
      detail: { position, target } 
    }));
    setIsPerspectiveOpen(false);
  };

  useEffect(() => {
    const handleReset = () => {
      window.dispatchEvent(new CustomEvent('set-camera', { 
        detail: { position: [80, 80, 80], target: [0, 0, 0] } 
      }));
    };
    window.addEventListener('reset-camera', handleReset);
    return () => window.removeEventListener('reset-camera', handleReset);
  }, []);

  const duplicateObject = (id: string) => {
    const shape = shapes.find(s => s.id === id);
    if (!shape) return;

    const newShape = {
      ...shape,
      id: Math.random().toString(36).substr(2, 9),
      position: [shape.position[0] + 1, shape.position[1], shape.position[2] + 1] as [number, number, number],
      name: `${shape.name || shape.type} (Copy)`
    };

    setShapes(prev => [...prev, newShape]);
    setSelectedId(newShape.id);
    recordAction(`sdk.duplicateObject("${id}");`);
  };

  const duplicateMultiple = (ids: string[]) => {
    const newShapes: Shape[] = [];
    ids.forEach(id => {
      const shape = shapes.find(s => s.id === id);
      if (shape) {
        newShapes.push({
          ...shape,
          id: Math.random().toString(36).substr(2, 9),
          position: [shape.position[0] + 1, shape.position[1], shape.position[2] + 1] as [number, number, number],
          name: `${shape.name || shape.type} (Copy)`
        });
      }
    });
    if (newShapes.length > 0) {
      setShapes(prev => [...prev, ...newShapes]);
      setSelectedIds(newShapes.map(s => s.id));
      recordAction(`sdk.duplicateObjects(${JSON.stringify(ids)});`);
    }
  };

  return (
    <div className={cn(
      "flex-1 relative overflow-hidden transition-colors duration-300",
      theme === 'dark' ? "bg-gray-900" : "bg-[#f8f9fa]"
    )}>
      {quadView ? (
        <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-px bg-black/30 z-0">
          {panelViews.map((view, idx) => (
            <div key={idx} className="relative overflow-hidden bg-inherit">
              {view === 'perspective' ? (
                <Canvas
                  shadows={{ type: THREE.PCFShadowMap }}
                  dpr={[1, 2]}
                  gl={{ preserveDrawingBuffer: true }}
                  frameloop="always"
                >
                  <React.Suspense fallback={null}>
                    <EnvironmentLighting />
                    <Scene />
                  </React.Suspense>
                </Canvas>
              ) : (
                <Canvas dpr={[1, 2]} frameloop="always">
                  <MiniScene view={view} />
                </Canvas>
              )}
              {idx !== 0 && (<select
                value={view}
                onChange={(e) => {
                  const next = [...panelViews];
                  next[idx] = e.target.value as 'perspective' | 'top' | 'front' | 'right';
                  setPanelViews(next);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                className={cn(
            "absolute top-2 left-2 z-10 backdrop-blur-sm px-3 py-1.5 rounded border text-[10px] font-bold uppercase outline-none cursor-pointer appearance-none transition-all hover:bg-white/90",
            theme === 'dark' ? "bg-gray-800/80 border-gray-700 text-gray-300" : "bg-white/80 border-gray-200 text-gray-600"
          )}
              >
                <option value="perspective">Perspective</option>
                <option value="top">Top</option>
                <option value="front">Front</option>
                <option value="right">Right</option>
              </select>)}
            </div>
          ))}
        </div>
      ) : (
        <Canvas 
        shadows={{ type: THREE.PCFShadowMap }} 
        dpr={[1, 2]} 
        gl={{ preserveDrawingBuffer: true }}
        frameloop="always"
      >
        <React.Suspense fallback={null}>
          <EnvironmentLighting />
          <Scene />
        </React.Suspense>
      </Canvas>
      )}

      {contextMenu && (
        <div 
          className={cn(
            "fixed z-[100] border shadow-xl rounded-md py-1 min-w-[140px] transition-colors duration-200",
            theme === 'dark' ? "bg-gray-800 border-gray-700 text-gray-200" : "bg-white border-gray-200 text-gray-800"
          )}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.type === 'light' ? (
            <>
              <button 
                onClick={() => {
                  const light = customLights.find(l => l.id === contextMenu.data);
                  if (light) {
                    const newLight = {
                      ...light,
                      id: Math.random().toString(36).substr(2, 9),
                      position: [light.position[0] + 2, light.position[1], light.position[2] + 2] as [number, number, number]
                    };
                    setCustomLights(prev => [...prev, newLight]);
                  }
                  setContextMenu(null);
                }}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors",
                  theme === 'dark' ? "hover:bg-gray-700" : "hover:bg-gray-100"
                )}
              >
                Duplicate Light
              </button>
              <button 
                onClick={() => {
                  setMetadataLightId(contextMenu.data);
                  setContextMenu(null);
                }}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors",
                  theme === 'dark' ? "hover:bg-gray-700" : "hover:bg-gray-100"
                )}
              >
                View Meta Data
              </button>
              <button 
                onClick={() => {
                  setCustomLights(prev => prev.filter(l => l.id === contextMenu.data));
                  setContextMenu(null);
                }}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors text-red-500",
                  theme === 'dark' ? "hover:bg-gray-700" : "hover:bg-gray-100"
                )}
              >
                Delete Light
              </button>
            </>
          ) : contextMenu.type === 'surface' ? (
            <>
              <button 
                onClick={() => {
                  duplicateObject(contextMenu.data.shapeId);
                  setContextMenu(null);
                }}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors",
                  theme === 'dark' ? "hover:bg-gray-700" : "hover:bg-gray-100"
                )}
              >
                Duplicate Object
              </button>
              <div className="relative group/meta">
                <button 
                  onMouseEnter={() => {
                    if (metadataTimeout) clearTimeout(metadataTimeout);
                    setMetadataShapeId(contextMenu.data.shapeId);
                  }}
                  onMouseLeave={() => {
                    const timeout = setTimeout(() => {
                      if (!isHoveringMetadata) {
                        setMetadataShapeId(null);
                      }
                    }, 200);
                    setMetadataTimeout(timeout);
                  }}
                  className={cn(
                    "w-full text-left px-3 py-1.5 text-xs flex items-center justify-between transition-colors",
                    theme === 'dark' ? "hover:bg-gray-700" : "hover:bg-gray-100"
                  )}
                >
                  <span>View Object Information</span>
                  <ChevronRight size={12} />
                </button>
                
                {metadataShapeId === contextMenu.data.shapeId && (
                  <div 
                    onMouseEnter={() => {
                      if (metadataTimeout) clearTimeout(metadataTimeout);
                      setIsHoveringMetadata(true);
                    }}
                    onMouseLeave={() => {
                      setIsHoveringMetadata(false);
                      setMetadataShapeId(null);
                    }}
                    className={cn(
                      "absolute left-full top-0 ml-1 p-3 rounded-md border shadow-xl min-w-[220px] z-[110]",
                      theme === 'dark' ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"
                    )}
                  >
                    {(() => {
                      const shape = shapes.find(s => s.id === metadataShapeId);
                      if (!shape) return null;
                      return (
                        <div className="space-y-3">
                          <div className="flex flex-col">
                            <span className="text-[9px] font-bold text-gray-400 uppercase">Object Name</span>
                            <input 
                              type="text"
                              value={shape.name || shape.id.slice(0, 8)}
                              onChange={(e) => {
                                const newName = e.target.value;
                                setShapes(prev => prev.map(s => s.id === shape.id ? { ...s, name: newName } : s));
                              }}
                              className="text-xs font-medium bg-transparent border-none outline-none focus:ring-1 focus:ring-trimble-blue rounded px-1 -ml-1"
                            />
                          </div>

                          <div className="flex flex-col">
                            <span className="text-[9px] font-bold text-gray-400 uppercase">Object ID</span>
                            <span className="text-[10px] font-mono text-gray-500 break-all">{shape.id}</span>
                          </div>

                          <div className="flex flex-col">
                            <span className="text-[9px] font-bold text-gray-400 uppercase">Object Type</span>
                            <span className="text-xs font-medium">{shape.type.toUpperCase()}</span>
                          </div>

                          <div className="flex flex-col">
                            <span className="text-[9px] font-bold text-gray-400 uppercase">Volume</span>
                            <span className="text-xs font-medium text-gray-600">
                              {(() => {
                                const args = shape.args;
                                let vol = 0;
                                switch (shape.type) {
                                  case 'box':
                                  case 'rect': vol = args[0] * args[1] * args[2]; break;
                                  case 'sphere':
                                  case 'dome':
                                    vol = (4/3) * Math.PI * Math.pow(args[0], 3);
                                    if (shape.type === 'dome') vol /= 2;
                                    break;
                                  case 'prism':
                                  case 'triangle':
                                    vol = Math.PI * Math.pow(args[1], 2) * args[0];
                                    if (shape.type === 'triangle') vol /= 2;
                                    break;
                                  case 'cone':
                                  case 'pyramid': vol = (1/3) * Math.PI * Math.pow(args[1], 2) * args[0]; break;
                                  default: vol = args[0] * args[1] * args[2] || 0;
                                }
                                return `${(vol * 1000000).toFixed(0)} cm³`;
                              })()}
                            </span>
                          </div>

                          <div className="flex flex-col">
                            <span className="text-[9px] font-bold text-gray-400 uppercase">Tags</span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {shape.tags && shape.tags.length > 0 ? (
                                shape.tags.map(tId => {
                                  const t = tags.find(tag => tag.id === tId);
                                  return t ? (
                                    <span key={tId} className="px-1 py-0.5 rounded-[2px] text-[7px] font-bold text-white uppercase" style={{ backgroundColor: t.color }}>
                                      {t.name}
                                    </span>
                                  ) : null;
                                })
                              ) : (
                                <span className="text-[8px] text-gray-400 italic">No tags</span>
                              )}
                            </div>
                          </div>
                          
                          <div className="flex flex-col">
                            <span className="text-[9px] font-bold text-gray-400 uppercase">Dimensions ({unit === 'mm' ? 'mm' : unit === 'cm' ? 'cm' : 'm'})</span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {Array.isArray(shape.args) && shape.args.slice(0, 3).map((arg: number, idx: number) => (
                                <div key={idx} className="flex items-center gap-1">
                                  {editingDimIndex === idx ? (
                                    <input 
                                      autoFocus
                                      type="text"
                                      value={dimValue}
                                      onChange={(e) => setDimValue(e.target.value)}
                                      onBlur={() => {
                                        const val = parseFloat(dimValue);
                                        if (!isNaN(val)) {
                                          const newArgs = [...shape.args];
                                          newArgs[idx] = val / 1000;
                                          setShapes(prev => prev.map(s => s.id === shape.id ? { ...s, args: newArgs } : s));
                                        }
                                        setEditingDimIndex(null);
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') e.currentTarget.blur();
                                      }}
                                      className="w-12 px-1 py-0.5 border rounded text-[10px] outline-none focus:border-trimble-blue"
                                    />
                                  ) : (
                                    <button 
                                      onClick={() => {
                                        setEditingDimIndex(idx);
                                        setDimValue((arg * 1000).toFixed(0));
                                      }}
                                      className="px-1.5 py-0.5 bg-gray-50 hover:bg-gray-100 rounded border border-gray-200 text-[10px] font-medium transition-colors"
                                    >
                                      {(arg * 1000).toFixed(0)}
                                    </button>
                                  )}
                                  {idx < 2 && idx < shape.args.length - 1 && <span className="text-gray-300">×</span>}
                                </div>
                              ))}
                              {shape.type === 'poly' && (
                                <div className="flex items-center gap-1">
                                  <span className="text-[9px] font-bold text-gray-400 uppercase">Height:</span>
                                  {editingDimIndex === 99 ? (
                                    <input 
                                      autoFocus
                                      type="text"
                                      value={dimValue}
                                      onChange={(e) => setDimValue(e.target.value)}
                                      onBlur={() => {
                                        const val = parseFloat(dimValue);
                                        if (!isNaN(val)) {
                                          setShapes(prev => prev.map(s => s.id === shape.id ? { 
                                            ...s, 
                                            args: { ...s.args, height: val / 1000 } 
                                          } : s));
                                        }
                                        setEditingDimIndex(null);
                                      }}
                                      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                      className="w-12 px-1 py-0.5 border rounded text-[10px] outline-none focus:border-trimble-blue"
                                    />
                                  ) : (
                                    <button 
                                      onClick={() => {
                                        setEditingDimIndex(99);
                                        setDimValue(((shape.args.height || 0) * 1000).toFixed(0));
                                      }}
                                      className="px-1.5 py-0.5 bg-gray-50 hover:bg-gray-100 rounded border border-gray-200 text-[10px] font-medium transition-colors"
                                    >
                                      {((shape.args.height || 0) * 1000).toFixed(0)}
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-col">
                            <span className="text-[9px] font-bold text-gray-400 uppercase">Position (X, Y, Z)</span>
                            <div className="flex gap-2 mt-1">
                              {shape.position.map((pos: number, idx: number) => (
                                <div key={idx} className="flex flex-col gap-0.5">
                                  <span className="text-[8px] text-gray-400 uppercase font-bold">{['X', 'Y', 'Z'][idx]}</span>
                                  {editingPosIndex === idx ? (
                                    <input 
                                      autoFocus
                                      type="text"
                                      value={posValue}
                                      onChange={(e) => setPosValue(e.target.value)}
                                      onBlur={() => {
                                        const val = parseFloat(posValue);
                                        if (!isNaN(val)) {
                                          const newPos = [...shape.position];
                                          newPos[idx] = val;
                                          setShapes(prev => prev.map(s => s.id === shape.id ? { ...s, position: newPos as [number, number, number] } : s));
                                        }
                                        setEditingPosIndex(null);
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') e.currentTarget.blur();
                                      }}
                                      className="w-14 px-1 py-0.5 border rounded text-[10px] bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-trimble-blue outline-none"
                                    />
                                  ) : (
                                    <button 
                                      onClick={() => {
                                        setEditingPosIndex(idx);
                                        setPosValue(pos.toString());
                                      }}
                                      className="text-[10px] font-mono text-trimble-blue bg-trimble-blue/5 px-1.5 py-0.5 rounded border border-trimble-blue/10 hover:bg-trimble-blue/10 transition-colors"
                                    >
                                      {pos.toFixed(3)}
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="flex flex-col">
                            <span className="text-[9px] font-bold text-gray-400 uppercase">Rotation (X, Y, Z) deg</span>
                            <div className="flex gap-2 mt-1">
                              {['x', 'y', 'z'].map((axis, idx) => {
                                const rotationArr = shape.rotation || [0, 0, 0];
                                const currentVal = rotationArr[idx] * (180 / Math.PI);
                                
                                return (
                                  <div key={axis} className="flex flex-col gap-0.5">
                                    <span className="text-[8px] text-gray-400 uppercase font-bold">{axis.toUpperCase()}</span>
                                    {editingRotIndex === idx ? (
                                      <input 
                                        autoFocus
                                        type="text"
                                        value={rotValue}
                                        onChange={(e) => setRotValue(e.target.value)}
                                        onBlur={() => {
                                          const val = parseFloat(rotValue);
                                          if (!isNaN(val)) {
                                            const newRot = [...(shape.rotation || [0, 0, 0])] as [number, number, number];
                                            newRot[idx] = val * (Math.PI / 180);
                                            setShapes(prev => prev.map(s => s.id === shape.id ? { ...s, rotation: newRot, quaternion: undefined } : s));
                                          }
                                          setEditingRotIndex(null);
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') e.currentTarget.blur();
                                        }}
                                        className="w-14 px-1 py-0.5 border rounded text-[10px] bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-trimble-blue outline-none"
                                      />
                                    ) : (
                                      <button 
                                        onClick={() => {
                                          setEditingRotIndex(idx);
                                          setRotValue(currentVal.toFixed(1));
                                        }}
                                        className="text-[10px] font-mono text-amber-500 bg-amber-500/5 px-1.5 py-0.5 rounded border border-amber-500/10 hover:bg-amber-500/10 transition-colors"
                                      >
                                        {currentVal.toFixed(1)}°
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          <div className="flex flex-col">
                            <span className="text-[9px] font-bold text-gray-400 uppercase">Volume</span>
                            <span className="text-xs font-medium">
                              {(() => {
                                if (shape.type === 'box' || shape.type === 'rect') {
                                  const vol = shape.args[0] * shape.args[1] * shape.args[2];
                                  return (vol * 1000000).toFixed(2) + ' cm³';
                                }
                                if (shape.type === 'sphere') {
                                  const r = shape.args[0];
                                  const vol = (4/3) * Math.PI * Math.pow(r, 3);
                                  return (vol * 1000000).toFixed(2) + ' cm³';
                                }
                                return 'N/A';
                              })()}
                            </span>
                          </div>

                          <div className="flex flex-col">
                            <span className="text-[9px] font-bold text-gray-400 uppercase">Tags (Click to remove)</span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {shape.tags?.map(tid => {
                                const tag = tags.find(t => t.id === tid);
                                if (!tag) return null;
                                return (
                                  <button 
                                    key={tid}
                                    onClick={() => {
                                      setShapes(prev => prev.map(s => s.id === shape.id ? { 
                                        ...s, 
                                        tags: s.tags?.filter(t => t !== tid) 
                                      } : s));
                                    }}
                                    className="px-1.5 py-0.5 rounded-full text-[9px] font-medium flex items-center gap-1 transition-all hover:scale-105"
                                    style={{ backgroundColor: `${tag.color}20`, color: tag.color, border: `1px solid ${tag.color}40` }}
                                  >
                                    {tag.name}
                                    <X size={8} />
                                  </button>
                                );
                              })}
                              {(!shape.tags || shape.tags.length === 0) && <span className="text-[10px] text-gray-400 italic">None</span>}
                            </div>
                          </div>

                          <div className="flex flex-col relative">
                            <span className="text-[9px] font-bold text-gray-400 uppercase">Material</span>
                            <button 
                              onClick={() => setIsMetadataMaterialPickerOpen(!isMetadataMaterialPickerOpen)}
                              className="flex items-center gap-2 mt-1 p-1 hover:bg-gray-50 rounded transition-colors"
                            >
                              <div className="w-3 h-3 rounded-full shadow-sm" style={{ backgroundColor: shape.color }} />
                              <span className="text-xs font-medium">{shape.color}</span>
                            </button>

                            {isMetadataMaterialPickerOpen && (
                              <div className={cn(
                                "absolute top-full left-0 mt-1 p-2 rounded-md border shadow-lg grid grid-cols-5 gap-1 z-[120]",
                                theme === 'dark' ? "bg-gray-700 border-gray-600" : "bg-white border-gray-100"
                              )}>
                                {COLORS.map(c => (
                                  <button 
                                    key={c}
                                    onClick={() => {
                                      setShapes(prev => prev.map(s => s.id === shape.id ? { ...s, color: c } : s));
                                      setIsMetadataMaterialPickerOpen(false);
                                    }}
                                    className="w-4 h-4 rounded-sm border border-gray-200"
                                    style={{ backgroundColor: c }}
                                  />
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="pt-2 border-t border-gray-100 mt-1 flex items-center justify-end">
                            <button 
                              onClick={() => {
                                navigator.clipboard.writeText(shape.id);
                                alert('ID copied to clipboard');
                              }}
                              className="text-[8px] text-trimble-blue hover:underline"
                            >
                              Copy ID
                            </button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
              {(() => {
                const shape = shapes.find(sh => sh.id === contextMenu.data.shapeId);
                if (shape && (shape.type === 'door' || shape.type === 'window')) {
                  return (
                    <button 
                      onClick={() => {
                        setStyleLibraryTargetId(shape.id);
                        setContextMenu(null);
                      }}
                      className={cn(
                        "w-full text-left px-3 py-2 text-xs font-bold flex items-center gap-2 transition-colors border-b border-gray-100 dark:border-gray-800 text-trimble-blue",
                        theme === 'dark' ? "hover:bg-gray-700 bg-trimble-blue/10" : "hover:bg-gray-100 bg-trimble-blue/5"
                      )}
                    >
                      <Palette size={14} className="text-trimble-blue shrink-0" />
                      <span>Change Style...</span>
                    </button>
                  );
                }
                return null;
              })()}
              <button 
                onClick={() => { const st = shapes.find(sh => sh.id === contextMenu.data.shapeId)?.type; if (st === 'box' || st === 'rect') setIsDividePopupOpen(true); }} disabled={(() => { const st = shapes.find(sh => sh.id === contextMenu.data.shapeId)?.type; return st !== 'box' && st !== 'rect'; })()} title={(() => { const st = shapes.find(sh => sh.id === contextMenu.data.shapeId)?.type; return (st === 'box' || st === 'rect') ? undefined : 'Only available on box/rectangle faces'; })()}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors",
                  theme === 'dark' ? "hover:bg-gray-700" : "hover:bg-gray-100"
                )}
              >
                Divide Surface...
              </button>
              <button 
                onClick={() => handleApplyMaterialToSurface(activeMaterial)}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors",
                  theme === 'dark' ? "hover:bg-gray-700" : "hover:bg-gray-100"
                )}
              >
                Apply Material
              </button>
              <button 
                onClick={handleDeleteSurface}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors text-red-500",
                  theme === 'dark' ? "hover:bg-gray-700" : "hover:bg-gray-100"
                )}
              >
                Delete
              </button>
            </>
          ) : (
            <>
              {(() => {
                if (Array.isArray(contextMenu.data) && contextMenu.data.length === 1) {
                  const singleShape = shapes.find(s => s.id === contextMenu.data[0]);
                  if (singleShape && (singleShape.type === 'door' || singleShape.type === 'window')) {
                    return (
                      <button 
                        onClick={() => {
                          setStyleLibraryTargetId(singleShape.id);
                          setContextMenu(null);
                        }}
                        className={cn(
                          "w-full text-left px-3 py-2 text-xs font-bold flex items-center gap-2 transition-colors border-b border-gray-100 dark:border-gray-800 text-trimble-blue",
                          theme === 'dark' ? "hover:bg-gray-700 bg-trimble-blue/10" : "hover:bg-gray-100 bg-trimble-blue/5"
                        )}
                      >
                        <Palette size={14} className="text-trimble-blue shrink-0" />
                        <span>Change Style...</span>
                      </button>
                    );
                  }
                }
                return null;
              })()}
              <button 
                onClick={() => {
                  const groupId = Math.random().toString(36).substr(2, 9);
                  setShapes(prev => prev.map(s => {
                    if (contextMenu.data.includes(s.id)) {
                      return { ...s, groupId };
                    }
                    return s;
                  }));
                  alert(`Grouped ${contextMenu.data.length} objects.`);
                  setContextMenu(null);
                }}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors",
                  theme === 'dark' ? "hover:bg-gray-700" : "hover:bg-gray-100"
                )}
              >
                Group Them
              </button>
              <button 
                onClick={() => {
                  if (activeTagId) {
                    setShapes(prev => prev.map(s => {
                      if (contextMenu.data.includes(s.id)) {
                        const currentTags = s.tags || [];
                        if (currentTags.includes(activeTagId)) return s;
                        return { ...s, tags: [...currentTags, activeTagId] };
                      }
                      return s;
                    }));
                  } else {
                    alert('Please select a tag in the Tags panel first.');
                  }
                  setContextMenu(null);
                }}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors",
                  theme === 'dark' ? "hover:bg-gray-700" : "hover:bg-gray-100"
                )}
              >
                Tag Them
              </button>
              <button 
                onClick={() => {
                  setShapes(prev => prev.map(s => {
                    if (contextMenu.data.includes(s.id)) {
                      return { 
                        ...s, 
                        color: activeMaterial,
                        roughness: activePBR.roughness,
                        metalness: activePBR.metalness,
                        opacity: activePBR.opacity
                      };
                    }
                    return s;
                  }));
                  setContextMenu(null);
                }}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors",
                  theme === 'dark' ? "hover:bg-gray-700" : "hover:bg-gray-100"
                )}
              >
                Allocate Material
              </button>
              <button 
                onClick={() => {
                  setRightPanelVisible(true);
                  // Ensure entity panel is visible
                  setPanelVisibility(prev => ({ ...prev, entity: true }));
                  setContextMenu(null);
                }}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-xs flex items-center justify-between transition-colors",
                  theme === 'dark' ? "hover:bg-gray-700" : "hover:bg-gray-100"
                )}
              >
                <span>Entity Properties</span>
                <ChevronRight size={12} />
              </button>
              <div className="h-px bg-gray-100 my-1 mx-2" />
              <button 
                onClick={() => {
                  contextMenu.data.forEach((id: string) => removeShape(id));
                  setContextMenu(null);
                }}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors text-red-500",
                  theme === 'dark' ? "hover:bg-gray-700" : "hover:bg-gray-100"
                )}
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}
      
      <div className="absolute top-4 left-4 flex flex-row items-start gap-2 pointer-events-auto">
        <div 
          className="relative"
          onMouseEnter={handlePerspectiveEnter}
          onMouseLeave={handlePerspectiveLeave}
        >
          <button 
            onClick={() => handleViewChange('perspective')}
            className={cn(
              "backdrop-blur-sm px-3 py-1.5 rounded border text-[10px] font-bold uppercase transition-all hover:bg-white/90",
              theme === 'dark' ? "bg-gray-800/80 border-gray-700 text-gray-300" : "bg-white/80 border-gray-200 text-gray-600"
            )}
          >
            Perspective
          </button>
          
          {isPerspectiveOpen && (
            <div className={cn(
              "absolute top-full left-0 mt-1 w-32 rounded border shadow-lg overflow-hidden z-[60]",
              theme === 'dark' ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"
            )}>
              {['Plan', 'Front Elevation', 'Rear Elevation', 'Left Elevation', 'Right Elevation'].map((view) => (
                <button
                  key={view}
                  onClick={() => handleViewChange(view.split(' ')[0].toLowerCase())}
                  className={cn(
                    "w-full text-left px-3 py-2 text-[10px] font-medium hover:bg-trimble-blue hover:text-white transition-colors",
                    theme === 'dark' ? "text-gray-300" : "text-gray-600"
                  )}
                >
                  {view}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={() => setQuadView(v => !v)}
          title="Toggle 4-way split view"
          className={cn(
            "backdrop-blur-sm px-3 py-1.5 rounded border text-[10px] font-bold uppercase transition-all hover:bg-white/90 ",
            quadView ? "bg-trimble-blue border-trimble-blue text-white" : (theme === 'dark' ? "bg-gray-800/80 border-gray-700 text-gray-300" : "bg-white/80 border-gray-200 text-gray-600")
          )}
        >
          <span className="">Split View</span>
        </button>
      </div>
      {isDividePopupOpen && selectedSurface && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/20 backdrop-blur-[2px]">
          <div className={cn(
            "p-4 rounded-lg border shadow-2xl w-64 animate-in zoom-in-95 duration-200",
            theme === 'dark' ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"
          )}>
            <h3 className="text-sm font-bold mb-3">Divide Surface</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase">X Sections</label>
                  <input 
                    autoFocus
                    type="number" 
                    min="1" 
                    max="20"
                    value={divideValueX}
                    onChange={(e) => setDivideValueX(e.target.value)}
                    className={cn(
                      "w-full px-2 py-1.5 border rounded text-xs outline-none focus:border-trimble-blue",
                      theme === 'dark' ? "bg-gray-700 border-gray-600 text-gray-200" : "bg-white border-gray-200 text-gray-700"
                    )}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase">Y Sections</label>
                  <input 
                    type="number" 
                    min="1" 
                    max="20"
                    value={divideValueY}
                    onChange={(e) => setDivideValueY(e.target.value)}
                    className={cn(
                      "w-full px-2 py-1.5 border rounded text-xs outline-none focus:border-trimble-blue",
                      theme === 'dark' ? "bg-gray-700 border-gray-600 text-gray-200" : "bg-white border-gray-200 text-gray-700"
                    )}
                  />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button 
                  onClick={() => setIsDividePopupOpen(false)}
                  className="flex-1 py-2 text-xs font-medium text-gray-500 hover:text-gray-700"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => handleDivideSurface(parseInt(divideValueX), parseInt(divideValueY))}
                  className="flex-1 py-2 text-xs font-bold bg-trimble-blue text-white rounded hover:bg-trimble-dark-blue transition-all"
                >
                  Divide
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTool === 'move' && !selectedId && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 pointer-events-none">
          <div className="bg-black/80 text-white px-4 py-2 rounded-full text-xs font-medium animate-bounce">
            Click an object to move it
          </div>
        </div>
      )}
      {showDivideModal && selectedSurface && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000]">
          <div className={cn(
            "p-6 rounded-lg shadow-xl w-64 space-y-4",
            theme === 'dark' ? "bg-gray-800 text-white" : "bg-white text-gray-900"
          )}>
            <h3 className="text-sm font-bold uppercase tracking-wider">Divide Surface</h3>
            <p className="text-xs text-gray-500">How many equal sections should this surface be divided into?</p>
            <div className="space-y-2">
              <input 
                type="number" 
                min="2" 
                max="10" 
                value={divideValueSingle}
                onChange={(e) => setDivideValueSingle(e.target.value)}
                autoFocus
                className={cn(
                  "w-full px-3 py-2 border rounded text-sm outline-none focus:border-trimble-blue",
                  theme === 'dark' ? "bg-gray-700 border-gray-600" : "bg-white border-gray-200"
                )}
              />
              <div className="flex gap-2">
                <button 
                  onClick={() => setShowDivideModal(false)}
                  className="flex-1 px-3 py-2 text-xs font-bold uppercase border border-gray-200 rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    const val = parseInt(divideValueSingle);
                    if (val >= 2) {
                      setShapes(prev => prev.map(s => s.id === selectedSurface.shapeId ? {
                        ...s,
                        surfaceDivisions: {
                          ...(s.surfaceDivisions || {}),
                          [selectedSurface.faceIndex]: val
                        }
                      } : s));
                      setShowDivideModal(false);
                    }
                  }}
                  className="flex-1 px-3 py-2 text-xs font-bold uppercase bg-trimble-blue text-white rounded hover:bg-trimble-dark-blue"
                >
                  Divide
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Style Library Modal for Doors and Windows */}
      <StyleLibraryModal 
        isOpen={!!styleLibraryTargetId}
        targetShape={shapes.find(s => s.id === styleLibraryTargetId) || null}
        onClose={() => setStyleLibraryTargetId(null)}
        theme={theme}
        onApplyStyle={(styleId, dims) => {
          if (!styleLibraryTargetId) return;
          setShapes(prev => prev.map(s => {
            if (s.id === styleLibraryTargetId) {
              const updatedArgs = dims || s.args;
              return {
                ...s,
                archStyle: styleId,
                args: updatedArgs
              };
            }
            return s;
          }));
          commitHistory();
          setMeasurements(`Updated style to ${styleId.toUpperCase()}`);
          setStyleLibraryTargetId(null);
        }}
      />
    </div>
  );
}

function RenderMapTexture({ lat, lng }: { lat: number, lng: number }) {
  const { worldViewAltitude, worldViewRadius, setConsoleOutput, googleMapsApiKey } = useApp();
  const apiKey = googleMapsApiKey || '';
  
  // Calculate zoom based on worldViewRadius to cover the requested ground area
  const zoom = useMemo(() => {
    // TileWidth = (156543 * cos(lat) * 640) / 2^zoom
    // We want TileWidth >= worldViewRadius * 2
    const targetWidth = worldViewRadius * 2;
    const z = Math.log2((156543.03392 * Math.cos(lat * Math.PI / 180) * 640) / targetWidth);
    // Google Static Maps allows zoom 1-20
    return Math.max(1, Math.min(20, Math.floor(z)));
  }, [lat, worldViewRadius]);

  // Calculate resolution at selected zoom
  const groundResolution = useMemo(() => {
    return (156543.03392 * Math.cos(lat * Math.PI / 180)) / Math.pow(2, zoom);
  }, [lat, zoom]);

  // Size of the 640x640 tile in meters
  const tileSizeMeters = useMemo(() => {
    return groundResolution * 640;
  }, [groundResolution]);

  const url = useMemo(() => {
    if (!apiKey) {
      const msg = "[WorldView] ERROR: VITE_GOOGLE_MAPS_API_KEY is missing! Map overlay cannot be loaded.";
      console.error(msg);
      setConsoleOutput(prev => [...prev, msg]);
      return null;
    }
    
    const baseUrl = "https://maps.googleapis.com/maps/api/staticmap";
    const params = new URLSearchParams({
      center: `${lat},${lng}`,
      zoom: zoom.toString(),
      size: "640x640",
      maptype: "satellite",
      key: apiKey,
      scale: "2",
      _cb: Date.now().toString()
    });
    const finalUrl = `${baseUrl}?${params.toString()}`;
    console.log(`[WorldView] Static Map URL generated (Lat: ${lat}, Lng: ${lng}, Zoom: ${zoom})`);
    return finalUrl;
  }, [lat, lng, apiKey, zoom, setConsoleOutput]);

  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const [loadStatus, setLoadStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  useEffect(() => {
    if (!url) return;
    
    setLoadStatus('loading');
    console.log("[WorldView] Starting texture load...");
    
    let attempts = 0;
    const maxAttempts = 3;

    const loadTexture = () => {
      const loader = new THREE.TextureLoader();
      loader.setCrossOrigin('anonymous');
      
      const startTime = performance.now();
      loader.load(
        url,
        (tex) => {
          const duration = (performance.now() - startTime).toFixed(2);
          tex.colorSpace = THREE.SRGBColorSpace;
          setTexture(tex);
          setLoadStatus('success');
          console.log(`[WorldView] Map texture loaded successfully in ${duration}ms.`);
          setConsoleOutput(prev => [...prev, `[SUCCESS] Map texture loaded (Zoom 18)`]);
        },
        (xhr) => {
          if (xhr.lengthComputable) {
            const percent = (xhr.loaded / xhr.total) * 100;
            console.log(`[WorldView] Loading: ${percent.toFixed(0)}%`);
          }
        },
        (err) => {
          const duration = (performance.now() - startTime).toFixed(2);
          console.warn(`[WorldView] Map texture attempt ${attempts + 1} failed after ${duration}ms.`);
          if (attempts < maxAttempts) {
            attempts++;
            setTimeout(loadTexture, 2000 * attempts);
          } else {
            setLoadStatus('error');
            const msg = "[WorldView] Map texture failed after multiple attempts. Check network/API keys/CORS.";
            console.error(msg, err);
            setConsoleOutput(prev => [...prev, `[ERROR] Map overlay failed to load.`]);
          }
        }
      );
    };

    loadTexture();
  }, [url, setConsoleOutput]);

  if (!texture) return null;

  return (
    <mesh 
      rotation={[-Math.PI / 2, 0, 0]} 
      position={[0, worldViewAltitude - 0.01, 0]}
      receiveShadow
    >
      <planeGeometry args={[tileSizeMeters, tileSizeMeters]} />
      <meshStandardMaterial 
        map={texture} 
        transparent 
        opacity={0.9} 
        polygonOffset 
        polygonOffsetFactor={1}
        depthWrite={false}
      />
    </mesh>
  );
}
