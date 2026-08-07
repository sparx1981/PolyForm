import React, { useState, useRef, useEffect, useMemo, useCallback, Suspense } from 'react';
import { Canvas, useThree, ThreeEvent, useFrame } from '@react-three/fiber';
import { 
  useHelper, 
  Html, 
  RoundedBox, 
  useTexture, 
  Line, 
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
import { useApp } from '../AppContext';
import { Shape, CustomLight, SceneNote, SceneState, SceneAnimation } from '../types';
import { cn, formatValue, safelyToDate } from '../lib/utils';
import { Effects } from './Effects';
import { ChevronRight, ChevronDown, X, CheckCircle2, StickyNote } from 'lucide-react';

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
function getCachedTexture(url: string): THREE.Texture {
  let tex = _polyformTextureCache.get(url);
  if (!tex) {
    tex = _polyformTextureLoader.load(
      url,
      (loaded) => {
        // Confirms the image actually decoded successfully; if this never fires the
        // surface will stay blank/black even though a Texture object exists.
        loaded.needsUpdate = true;
      },
      undefined,
      (err) => {
        // Uploaded/URL textures were rendering as solid black with no visible error -
        // most likely a failed image load (CORS, expired/invalid Storage URL, or a
        // network hiccup) leaving the GPU texture empty. Log it clearly instead of
        // failing silently so this is diagnosable from the console.
        console.error('[PolyForm] Failed to load texture, surface may appear black:', url, err);
      }
    );
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    _polyformTextureCache.set(url, tex);
  }
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

// Poly tool helpers
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
    showAllDimensions
  } = useApp();

  // Measuring Tape tool state: tapeStart persists once the user clicks the first point;
  // tapeEnd tracks the live cursor position for the preview line/label while the second
  // point hasn't been placed yet. lastMeasurement holds the most recently completed
  // measurement so its line + label stay visible after the second click.
  const [tapeStart, setTapeStart] = useState<THREE.Vector3 | null>(null);
  const [tapeEnd, setTapeEnd] = useState<THREE.Vector3 | null>(null);
  const [lastMeasurement, setLastMeasurement] = useState<{ start: [number, number, number]; end: [number, number, number]; distance: number } | null>(null);
  
  const frictionPausedUntilRef = useRef<number>(0);    const sunAnimRef = useRef<{ radius: number; angle: number } | null>(null);
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
        setPushPullState(null);
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
  const [snapIndicator, setSnapIndicator] = useState<{ point: [number, number, number]; type: 'endpoint' | 'midpoint' } | null>(null);
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
  } | null>(null);

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
      setPushPullState(null);
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isDeveloperConsoleOpen) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      
      const key = e.key.toLowerCase();

      // Numeric length entry while drawing a line (SketchUp-style inference)
      if (activeTool === 'line' && drawingStart && !e.ctrlKey && !e.metaKey) {
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
          if (activeTool === 'poly' && polyVertices.length > 0) {
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
        if (activeTool === 'poly' && polyVertices.length > 0) {
          diagLog('TOOL', 'Poly drawing cancelled', { vertexCount: polyVertices.length });
        }
        setRectangleInputState({ active: false, startPoint: null, width: '', depth: '' });
        setDrawingStart(null);
        setDrawingNormal(null);
        setDrawingOnId(null);
        setPreviewShape(null);
        setDrawingStep(0);
        setPushPullState(null);
        setAxisLock(null);
        setFaceEditMode(null);
        setSnapIndicator(null);
        setTypedLength('');
        setLastDrawTarget(null);
        setSelectedSurface(null);
        setContextMenu(null);
        setPolyVertices([]);
        setPolyPlane(null);
        setPolyNormal(null);
        setPolyCandidatePos(null);
        return;
      }

      if (e.key === 'Enter') {
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
  }, [isDeveloperConsoleOpen, activeTool, undo, redo, setActiveTool, polyVertices.length, finalizePoly, rectangleInputState.active, finalizeRectangleInput]);

  const [pointerDownInfo, setPointerDownInfo] = useState<{ time: number, pos: THREE.Vector3 } | null>(null);

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
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

    if (['rectangle', 'circle', 'line', 'triangle', 'sphere', 'cone', 'pyramid', 'donut', 'dome'].includes(activeTool)) {
      e.stopPropagation();
      
      if (drawingStep === 2) {
        // Confirm height step
        handlePointerUp(e);
        return;
      }

      // Check for mesh intersection first
      const intersects = raycaster.intersectObjects(scene.children, true);
      const shapeIntersect = intersects.find(i => i.object.userData.isShape);
      
      if (shapeIntersect && shapeIntersect.face) {
        const normal = shapeIntersect.face.normal.clone().applyQuaternion(shapeIntersect.object.quaternion).normalize();
        setDrawingStart(shapeIntersect.point.clone());
        setDrawingNormal(normal);
        setDrawingOnId(shapeIntersect.object.userData.id);
        setDrawingStep(1);
      } else {
        // Fallback to ground plane
        const ray = raycaster.ray;
        const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const target = new THREE.Vector3();
        if (ray.intersectPlane(groundPlane, target)) {
          setDrawingStart(target.clone());
          setDrawingNormal(new THREE.Vector3(0, 1, 0));
          setDrawingOnId(null);
          setDrawingStep(1);
        }
      }
    }
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (activeTool === 'tape' && tapeStart) {
      const intersects = raycaster.intersectObjects(scene.children, true);
      const shapeIntersect = intersects.find(i => i.object.userData.isShape);
      const point = (shapeIntersect ? shapeIntersect.point : e.point).clone();
      setTapeEnd(point);
      setMeasurements(`Distance: ${formatValue(tapeStart.distanceTo(point), unit, 2)}`);
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

    if (drawingStart && drawingNormal) {
      const ray = raycaster.ray;
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(drawingNormal, drawingStart);
      const target = new THREE.Vector3();
      
      if (drawingStep === 1 && ray.intersectPlane(plane, target)) {
        // --- Inference locking: endpoint/midpoint snapping + axis lock ---
        let snapHit: { point: THREE.Vector3; type: 'endpoint' | 'midpoint' } | null = null;
        if (!axisLock) {
          const snapThresholdWorld = 0.35;
          let bestDist = snapThresholdWorld;
          shapes.forEach(sh => {
            if (sh.type === 'measurement') return;
            const obj = scene.getObjectByName(sh.id);
            if (!obj) return;
            const box = new THREE.Box3().setFromObject(obj);
            if (!isFinite(box.min.x) || !isFinite(box.max.x)) return;
            const xs = [box.min.x, box.max.x], ys = [box.min.y, box.max.y], zs = [box.min.z, box.max.z];
            const corners: THREE.Vector3[] = [];
            xs.forEach(x => ys.forEach(y => zs.forEach(z => corners.push(new THREE.Vector3(x, y, z)))));
            corners.forEach(c => {
              const d = target.distanceTo(c);
              if (d < bestDist) {
                bestDist = d;
                snapHit = { point: c.clone(), type: 'endpoint' };
              }
            });
            for (let ci = 0; ci < 8; ci++) {
              for (let cj = ci + 1; cj < 8; cj++) {
                const a = corners[ci], b = corners[cj];
                const diffs = [a.x !== b.x, a.y !== b.y, a.z !== b.z].filter(Boolean).length;
                if (diffs === 1) {
                  const mid = a.clone().lerp(b, 0.5);
                  const d = target.distanceTo(mid);
                  if (d < bestDist) {
                    bestDist = d;
                    snapHit = { point: mid, type: 'midpoint' };
                  }
                }
              }
            }
          });
          if (snapHit) target.copy((snapHit as { point: THREE.Vector3; type: 'endpoint' | 'midpoint' }).point);
        }
        if (axisLock) {
          const axisVec = axisLock === 'x' ? new THREE.Vector3(1, 0, 0) : axisLock === 'y' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
          const delta = target.clone().sub(drawingStart);
          const projLength = delta.dot(axisVec);
          target.copy(drawingStart.clone().add(axisVec.multiplyScalar(projLength)));
          snapHit = null;
        }
        setSnapIndicator(snapHit ? { point: [(snapHit as any).point.x, (snapHit as any).point.y, (snapHit as any).point.z], type: (snapHit as any).type } : null);
        setLastDrawTarget(target.clone());

        // Step 1: Base Dimensions
        const up = new THREE.Vector3(0, 1, 0);
        if (Math.abs(drawingNormal.dot(up)) > 0.99) {
          up.set(0, 0, 1);
        }
        const tangent = new THREE.Vector3().crossVectors(drawingNormal, up).normalize();
        const bitangent = new THREE.Vector3().crossVectors(drawingNormal, tangent).normalize();
        
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
          const isCap = Math.abs(pushPullState.localNormal.z) > 0.9;
          if (isCap) {
            const currentHeight = (pushPullState.initialArgs as any).height || 0;
            const newHeight = currentHeight + dist;
            (newArgs as any).height = Math.max(0.001, Math.abs(newHeight));
            
            newPos[0] = pushPullState.initialPos[0] + (dist * pushPullState.normal.x) / 2;
            newPos[1] = pushPullState.initialPos[1] + (dist * pushPullState.normal.y) / 2;
            newPos[2] = pushPullState.initialPos[2] + (dist * pushPullState.normal.z) / 2;
          } else {
            // Extruding a side of a polygon - scale the vertices uniformly (like circle radius)
            // This is a simple approximation of "behaving like a circle/triangle"
            const scale = 1 + dist / 5; // slow scaling
            if (scale > 0.1) {
              const vertices = (pushPullState.initialArgs as any).vertices as [number, number][];
              // Calculate centroid for scaling
              let cx = 0, cy = 0;
              vertices.forEach(v => { cx += v[0]; cy += v[1]; });
              cx /= vertices.length;
              cy /= vertices.length;
              
              const newVertices = vertices.map(v => [
                cx + (v[0] - cx) * scale,
                cy + (v[1] - cy) * scale
              ]);
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
        if (shape.type === 'box') {
          minEdge = Math.min(...shape.args);
        } else if (shape.type === 'rect') {
          minEdge = Math.min(...shape.args);
        }
        const maxRadius = minEdge / 2;
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

  const performTunnelSplit = (parentId: string, subFaceId: string, faceIndex: number, subFaceIndex: number) => {
    const parent = shapes.find(s => s.id === parentId);
    if (!parent || parent.type !== 'box') return;

    const [W, H, D] = parent.args;
    const division = parent.surfaceDivisions?.[faceIndex];
    const [gridX, gridY] = getGridDimensions(division);
    
    let size: [number, number] = [1, 1];
    let depth = 1;
    if (faceIndex <= 3) { size = [D, H]; depth = W; }
    else if (faceIndex <= 7) { size = [W, D]; depth = H; }
    else { size = [W, H]; depth = D; }
    
    const cellW = size[0] / gridX;
    const cellH = size[1] / gridY;
    const ix = subFaceIndex % gridX;
    const iy = Math.floor(subFaceIndex / gridX);
    
    const hx = -size[0]/2 + cellW/2 + ix * cellW;
    const hy = -size[1]/2 + cellH/2 + iy * cellH;

    const parentQuat = new THREE.Quaternion(...(parent.quaternion || [0,0,0,1]));
    const parentPos = new THREE.Vector3(...parent.position);

    const newSideShapes: Shape[] = [];
    const addSideBox = (lx: number, ly: number, lw: number, lh: number) => {
      if (lw <= 0.001 || lh <= 0.001) return;
      
      const localPos = new THREE.Vector3(lx, ly, 0);
      let rot = new THREE.Euler();
      if (faceIndex <= 1) rot.set(0, Math.PI/2, 0);
      else if (faceIndex <= 3) rot.set(0, -Math.PI/2, 0);
      else if (faceIndex <= 5) rot.set(-Math.PI/2, 0, 0);
      else if (faceIndex <= 7) rot.set(Math.PI/2, 0, 0);
      else if (faceIndex <= 9) rot.set(0, 0, 0);
      else if (faceIndex <= 11) rot.set(0, Math.PI, 0);
      
      const faceQuat = new THREE.Quaternion().setFromEuler(rot);
      const faceCenterLocal = new THREE.Vector3(0, 0, depth/2).applyQuaternion(faceQuat);
      const boxLocalPos = localPos.clone().applyQuaternion(faceQuat).add(faceCenterLocal);
      boxLocalPos.add(new THREE.Vector3(0, 0, -depth/2).applyQuaternion(faceQuat));
      
      const worldPos = boxLocalPos.clone().applyQuaternion(parentQuat).add(parentPos);
      const worldQuat = parentQuat.clone().multiply(faceQuat);
      
      newSideShapes.push({
        id: Math.random().toString(36).substr(2, 9),
        type: 'box',
        position: [worldPos.x, worldPos.y, worldPos.z],
        quaternion: [worldQuat.x, worldQuat.y, worldQuat.z, worldQuat.w],
        args: [lw, lh, depth],
        color: parent.color,
        roughness: parent.roughness,
        metalness: parent.metalness,
        opacity: parent.opacity
      });
    };

    addSideBox((-size[0]/2 + (hx - cellW/2)) / 2, 0, (hx - cellW/2) - (-size[0]/2), size[1]);
    addSideBox((hx + cellW/2 + size[0]/2) / 2, 0, size[0]/2 - (hx + cellW/2), size[1]);
    addSideBox(hx, (hy + cellH/2 + size[1]/2) / 2, cellW, size[1]/2 - (hy + cellH/2));
    addSideBox(hx, (-size[1]/2 + (hy - cellH/2)) / 2, cellW, (hy - cellH/2) - (-size[1]/2));

    setShapes(prev => {
      const filtered = prev.filter(s => s.id !== parentId && s.id !== subFaceId);
      return [...filtered, ...newSideShapes];
    });
  };

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
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

      if (previewShape) {
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
      }
      
      setDrawingStart(null);
      setDrawingNormal(null);
      setDrawingOnId(null);
      setPreviewShape(null);
      setDrawingStep(0);
    }

    if (pushPullState) {
      const shape = shapes.find(s => s.id === pushPullState.id);
      if (shape) {
        const currentPos = new THREE.Vector3(...shape.position);
        const initialPos = new THREE.Vector3(...pushPullState.initialPos);
        // dist here is the movement of the center. The face movement is 2x this for boxes.
        const centerDist = currentPos.distanceTo(initialPos) * (currentPos.clone().sub(initialPos).dot(pushPullState.normal) >= 0 ? 1 : -1);
        const faceDist = pushPullState.type === 'box' || pushPullState.type === 'rect' ? centerDist * 2 : centerDist;

        if (pushPullState.isSubFace && pushPullState.parentShapeId) {
          // Heal Rule: If pushed face becomes coplanar with back face (faceDist = -parentDepth)
          if (Math.abs(faceDist) < 0.001) {
            removeShape(pushPullState.id);
          } else if (pushPullState.parentDepth && faceDist <= -pushPullState.parentDepth + 0.1) {
            // Create hole
            performTunnelSplit(pushPullState.parentShapeId, pushPullState.id, pushPullState.faceIndex!, pushPullState.subFaceIndex!);
          } else {
            // Finalize extrusion
            setShapes(prev => prev.map(s => {
              if (s.id === pushPullState.id) {
                let newType = s.type;
                if (s.type === 'rect') newType = 'box';
                else if (s.type === 'triangle') newType = 'prism';
                return { ...s, type: newType, opacity: 1, transparent: false };
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
      setPushPullState(null);
      setMeasurements('');
    }
  };

  const handleMeshDoubleClick = (e: ThreeEvent<MouseEvent>, id: string) => {
    e.stopPropagation();
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
      if (subFaceIndex !== undefined) {
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
      } else {
        // Apply to whole object
        updateShapeColor(id, activeMaterial, activePBR);
      }
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

      const localNormal = e.face?.normal.clone() || new THREE.Vector3(0, 1, 0);
      const worldNormal = localNormal.clone().applyQuaternion(e.object.quaternion).normalize();

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
          
          setPushPullState({
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
        
        setPushPullState({
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

      setPushPullState({
        id: shape.id,
        type: shape.type,
        initialPos: shape.position,
        initialArgs: shape.args,
        normal: worldNormal,
        localNormal: localNormal,
        startPoint: e.point.clone()
      });
    } else if (activeTool === 'bevel') {
      e.stopPropagation();
      setBevelState({
        id: shape.id,
        initialAmount: shape.bevelAmount || 0,
        startX: e.nativeEvent.clientX,
        type: activeBevelType, maxRadius: (shape.type === 'box' || shape.type === 'rect') ? Math.min(...shape.args) / 2 : 1
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
    } else if (['poly', 'rectangle', 'circle', 'line', 'triangle', 'sphere', 'cone', 'pyramid', 'donut', 'dome'].includes(activeTool)) {
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
        const quaternion: [number, number, number, number] = [mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w];
        const scale: [number, number, number] = [mesh.scale.x, mesh.scale.y, mesh.scale.z];
        
        setShapes(prev => prev.map(s => s.id === sId ? { 
          ...s, 
          position, 
          quaternion,
          scale 
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
        enabled={!drawingStart && !pushPullState}
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

      {(placingLightId || placingAnimationId || ['poly', 'rectangle', 'circle', 'line', 'triangle', 'sphere', 'cone', 'pyramid', 'donut', 'dome'].includes(activeTool)) && (
        <mesh 
          rotation={[-Math.PI / 2, 0, 0]} 
          position={[0, -0.01, 0]} 
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <planeGeometry args={[1000, 1000]} />
          <meshBasicMaterial transparent opacity={0} />
        </mesh>
      )}

      {(drawingStart || pushPullState) && (
        <mesh 
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <sphereGeometry args={[1000, 16, 16]} />
          <meshBasicMaterial transparent opacity={0} />
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
      {showCollaboratorCursors && collaborators.filter(c => c.uid !== user?.uid && c.cursorPosition).map(collab => {
        const color = getCollabColor(collab.email);
        return (
          <group key={collab.uid} position={[collab.cursorPosition!.x, collab.cursorPosition!.y, collab.cursorPosition!.z]}>
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
      {collaborators.filter(c => c.uid !== user?.uid && c.activeTransform).map(collab => {
        const trans = collab.activeTransform!;
        const shape = shapes.find(s => s.id === trans.id);
        if (!shape) return null;

        const pos: [number, number, number] = Array.isArray(trans.position) ? trans.position as [number, number, number] : [0, 0, 0];
        const quat = Array.isArray(trans.quaternion) ? trans.quaternion : [0, 0, 0, 1];
        const scale: [number, number, number] = Array.isArray(trans.scale) ? trans.scale as [number, number, number] : [1, 1, 1];

        return (
          <group key={collab.uid} position={pos} quaternion={new THREE.Quaternion(...quat)} scale={scale}>
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

            if (activeTool === 'pushpull') {
              e.stopPropagation();
              if (['sphere', 'donut', 'dome'].includes(shape.type)) {
                document.body.style.cursor = 'not-allowed';
                setHoveredFace(null);
              } else {
                document.body.style.cursor = 'crosshair';
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
                setHoveredFace({ shapeId: shape.id, faceIndex: e.faceIndex!, subFaceIndex });
              }
            }
            handlePointerMove(e);
          },
          onPointerOut: (e: any) => {
            if (activeTool === 'pushpull') {
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
            return (mat.startsWith('http') || mat.startsWith('data:')) ? (
              <meshStandardMaterial 
                key={idx}
                attach={`material-${idx/2}`}
                map={getCachedTexture(mat)} 
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
          (shape.color.startsWith('http') || shape.color.startsWith('data:')) ? (
            <meshStandardMaterial 
              map={getCachedTexture(shape.color)} 
              roughness={shape.roughness ?? 0.5}
              metalness={shape.metalness ?? 0}
              transparent={true}
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

  const selectionHighlight = selectedId === shape.id && (
    <mesh position={[0, 0, 0]}>
      {shape.type === 'circle' || shape.type === 'line' || shape.type === 'triangle' || shape.type === 'prism' ? (
        <cylinderGeometry args={[
          ((Array.isArray(shape.args) ? shape.args[0] : 0) || 0) + 0.02, 
          ((Array.isArray(shape.args) ? shape.args[1] : 0) || 0) + 0.02, 
          ((Array.isArray(shape.args) ? shape.args[2] : 0) || 0) + 0.02, 
          (shape.type === 'triangle' || shape.type === 'prism') ? 3 : ((Array.isArray(shape.args) ? shape.args[3] : 32) || 32)
        ]} />
      ) : (shape.type === 'box' || shape.type === 'rect') ? (
        shape.bevelAmount ? (
          <RoundedBox args={[
            ((Array.isArray(shape.args) ? shape.args[0] : 0) || 0) + 0.05, 
            ((Array.isArray(shape.args) ? shape.args[1] : 0) || 0) + 0.05, 
            ((Array.isArray(shape.args) ? shape.args[2] : 0) || 0) + 0.05
          ]} radius={shape.bevelAmount} smoothness={shape.bevelSegments || 4} />
        ) : (
          <boxGeometry args={[
            ((Array.isArray(shape.args) ? shape.args[0] : 0) || 0) + 0.05, 
            ((Array.isArray(shape.args) ? shape.args[1] : 0) || 0) + 0.05, 
            ((Array.isArray(shape.args) ? shape.args[2] : 0) || 0) + 0.05
          ]} />
        )
      ) : shape.type === 'poly' ? (
        <PolyGeometry vertices={shape.args?.vertices || []} height={((shape.args as any)?.height || 0) + 0.02} />
      ) : null}
      <meshBasicMaterial color="#0063A3" wireframe transparent opacity={0.3} />
    </mesh>
  );

        const subtractHighlight = subtractTargetId === shape.id && (
          <mesh>
            {(shape.type === 'box' || shape.type === 'rect') ? (
              <boxGeometry args={[
                ((Array.isArray(shape.args) ? shape.args[0] : 0) || 0) + 0.1, 
                ((Array.isArray(shape.args) ? shape.args[1] : 0) || 0) + 0.1, 
                ((Array.isArray(shape.args) ? shape.args[2] : 0) || 0) + 0.1
              ]} />
            ) : shape.type === 'poly' ? (
              <PolyGeometry vertices={shape.args?.vertices || []} height={((shape.args as any)?.height || 0) + 0.1} />
            ) : null}
            <meshBasicMaterial color="#ef4444" wireframe transparent opacity={0.5} />
          </mesh>
        );

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
            </RoundedBox>
          );
        }

        return (
          <mesh key={shape.id} {...meshProps}>
          {shape.type === 'circle' || shape.type === 'line' || shape.type === 'triangle' || shape.type === 'prism' ? (
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
            <PolyGeometry vertices={shape.args?.vertices || []} height={shape.args?.height || 1} />
          ) : shape.type === 'custom' ? (
            <CustomGeometry shape={shape} />
          ) : (
            <boxGeometry args={(Array.isArray(shape.args) ? shape.args : [1, 1, 1]) as any} />
          )}
          {shape.type === 'box' && shape.surfaceMaterials ? (
            [0, 2, 4, 6, 8, 10].map((idx) => {
              const mat = shape.surfaceMaterials?.[idx] || shape.color;
              return (mat.startsWith('http') || mat.startsWith('data:')) ? (
                <meshStandardMaterial 
                  key={idx}
                  attach={`material-${idx/2}`}
                  map={getCachedTexture(mat)} 
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
            (shape.color.startsWith('http') || shape.color.startsWith('data:')) ? (
              <meshStandardMaterial 
                map={getCachedTexture(shape.color)} 
                roughness={shape.roughness ?? 0.5}
                metalness={shape.metalness ?? 0}
                transparent={true}
                opacity={shape.opacity ?? 1}
                side={shape.type === 'poly' ? THREE.DoubleSide : THREE.FrontSide}
                emissive={selectedId === shape.id ? '#0063A3' : '#000000'}
                emissiveIntensity={selectedId === shape.id ? 0.5 : 0}
              />
            ) : (
              <meshStandardMaterial 
                color={shape.color} 
                roughness={shape.roughness ?? 0.5}
                metalness={shape.metalness ?? 0}
                transparent={shape.opacity !== undefined && shape.opacity < 1}
                opacity={shape.opacity ?? 1}
                side={shape.type === 'poly' ? THREE.DoubleSide : THREE.FrontSide}
                emissive={selectedId === shape.id ? '#0063A3' : '#000000'}
                emissiveIntensity={selectedId === shape.id ? 0.5 : 0}
              />
            )
          )}
          {selectionHighlight}
          {subtractHighlight}
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
          ) : (
            <boxGeometry args={previewShape.args} />
          )}
          <meshBasicMaterial color={activeMaterial} transparent opacity={0.5} />
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
                snapIndicator.type === 'endpoint' ? 'bg-green-400 rotate-45 border border-green-600' : 'bg-cyan-400 rounded-full border border-cyan-600'
              )}
            />
            <div className="bg-black/80 text-white text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded whitespace-nowrap">
              {snapIndicator.type === 'endpoint' ? 'Endpoint' : 'Midpoint'}
            </div>
          </div>
        </Html>
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
      {hoveredFace && activeTool === 'pushpull' && !pushPullState && (
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
    skyboxRotation 
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
        {skybox === 'none' ? <color attach="background" args={['#2B2B2B']} /> : null}
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

function SurfaceHighlight({ shapeId, faceIndex, subFaceIndex }: { shapeId: string, faceIndex: number, subFaceIndex?: number }) {
  const { shapes } = useApp();
  const shape = shapes.find(s => s.id === shapeId);
  if (!shape || (shape.type !== 'box' && shape.type !== 'rect' && shape.type !== 'triangle' && shape.type !== 'prism' && shape.type !== 'poly')) return null;

  if (shape.type === 'poly') {
    const height = shape.args.height || 0;
    
    // We can't easily highlight EXACT faces for extruded poly without geometry analysis,
    // so we highlight the top/bottom caps or the whole side shell.
    
    // Simplification: if height is 0, just highlight the whole thing.
    if (height === 0) {
      return (
        <group position={shape.position} quaternion={shape.quaternion ? new THREE.Quaternion(...shape.quaternion) : undefined} scale={shape.scale}>
          <mesh position={[0, 0, 0.005]}>
            <PolyGeometry vertices={shape.args.vertices} height={0.01} />
            <meshBasicMaterial color="#0063A3" transparent opacity={0.4} side={THREE.DoubleSide} />
          </mesh>
        </group>
      );
    }

    // If height > 0, we'll just show a selection-like highlight for now, 
    // but positioned at the top cap as a hint.
    const zOffset = height / 2 + 0.005;
    return (
      <group position={shape.position} quaternion={shape.quaternion ? new THREE.Quaternion(...shape.quaternion) : undefined} scale={shape.scale}>
        <mesh position={[0, 0, zOffset]}>
          <PolyGeometry vertices={shape.args.vertices} height={0.01} />
          <meshBasicMaterial color="#0063A3" transparent opacity={0.4} side={THREE.DoubleSide} />
        </mesh>
      </group>
    );
  }

  if (shape.type === 'triangle' || shape.type === 'prism') {
    const radius = shape.args[0];
    const height = shape.args[2];
    const radialSegments = shape.args[3] || 3;

    // Determine if it's a side, top, or bottom face
    // For a 3-segment prism:
    // 0-5: sides (2 triangles per side)
    // 6: top
    // 7: bottom
    
    let pos: [number, number, number] = [0, 0, 0];
    let rot: [number, number, number] = [0, 0, 0];
    let size: [number, number] = [0, 0];
    let isTriangle = false;

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
      isTriangle = true;
    } else if (faceIndex === radialSegments * 2 + 1) {
      // Bottom face
      pos = [0, -height / 2 - 0.005, 0];
      rot = [0, 0, 0];
      isTriangle = true;
    }

    return (
      <group position={shape.position} quaternion={shape.quaternion ? new THREE.Quaternion(...shape.quaternion) : undefined} scale={shape.scale}>
        <mesh position={pos} rotation={rot}>
          {isTriangle ? (
            <cylinderGeometry args={[radius, radius, 0.01, radialSegments]} />
          ) : (
            <planeGeometry args={size} />
          )}
          <meshBasicMaterial color="#0063A3" transparent opacity={0.4} side={THREE.DoubleSide} />
        </mesh>
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
           <mesh position={[localX, localY, 0]}>
             <planeGeometry args={[cellW, cellH]} />
             <meshBasicMaterial color="#0063A3" transparent opacity={0.6} side={THREE.DoubleSide} />
           </mesh>
        </group>
      </group>
    );
  }

  return (
    <group position={shape.position} quaternion={shape.quaternion ? new THREE.Quaternion(...shape.quaternion) : undefined} scale={shape.scale}>
      <mesh position={pos} rotation={rot}>
        <planeGeometry args={size} />
        <meshBasicMaterial color="#0063A3" transparent opacity={0.4} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function PolyGeometry({ vertices, height = 0 }: { vertices: [number, number][], height?: number }) {
  const geometry = useMemo(() => {
    if (!vertices || vertices.length < 3) return new THREE.BufferGeometry();
    
    // Filter out duplicate consecutive vertices which can break triangulation
    const filtered = vertices.filter((v, i) => {
      if (i === 0) return true;
      const prev = vertices[i-1];
      return v[0] !== prev[0] || v[1] !== prev[1];
    });

    if (filtered.length < 3) return new THREE.BufferGeometry();

    const shape = new THREE.Shape();
    shape.moveTo(filtered[0][0], filtered[0][1]);
    for (let i = 1; i < filtered.length; i++) {
      shape.lineTo(filtered[i][0], filtered[i][1]);
    }
    shape.closePath();
    
    try {
      if (height === 0) {
        return new THREE.ShapeGeometry(shape);
      } else {
        const geo = new THREE.ExtrudeGeometry(shape, {
          depth: height,
          bevelEnabled: false
        });
        geo.translate(0, 0, -height / 2); // Center in Z to match other primitives
        return geo;
      }
    } catch (err) {
      console.error('[PolyGeometry] Failed to create geometry:', err);
      return new THREE.BufferGeometry();
    }
  }, [vertices, height]);

  useEffect(() => {
    return () => {
      if (geometry) geometry.dispose();
    };
  }, [geometry]);

  return <primitive object={geometry} />;
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
  const [isPerspectiveOpen, setIsPerspectiveOpen] = useState(false);
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
      
      <div className="absolute top-4 left-4 flex flex-col gap-2 pointer-events-auto">
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
    </div>
  );
}

function CustomGeometry({ shape }: { shape: Shape }) {
  const geometry = useMemo(() => {
    try {
      console.log(`[CustomGeometry] Parsing geometry for ${shape.id}`);
      return new THREE.BufferGeometryLoader().parse(shape.geometryData);
    } catch (err) {
      console.error(`[CustomGeometry] Failed to parse geometry for ${shape.id}:`, err);
      return new THREE.BoxGeometry(1, 1, 1);
    }
  }, [shape.geometryData, shape.id]);

  return <primitive object={geometry} attach="geometry" />;
}

function RenderMapTexture({ lat, lng }: { lat: number, lng: number }) {
  const { worldViewAltitude, worldViewRadius, setConsoleOutput } = useApp();
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
  
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
