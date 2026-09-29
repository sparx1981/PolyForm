import { NoteCard } from './NoteCard';
import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback, Suspense } from 'react';
import { actionLabel, sdkLiteral } from '../lib/macroRecorder';
import { TextMesh } from './TextMesh';
import { SiteBuildingMesh, SiteGhosts } from './SiteBuildingMesh';
import { GoogleTilesLayer } from './GoogleTilesLayer';
import { useGoogleTilesStatus } from '../lib/worldSite/googleTilesStatus';
import { buildingLook } from '../lib/worldSite/googleTiles';
import { gridHeightAt } from '../lib/worldSite/terrain';
import { RouteDrawPreview, SiteStreetLifeLayer } from './SiteStreetLife';
import { routeTool, withDrawnRoute } from '../lib/worldSite/streets';
import { removedBuildings } from '../lib/worldSite/buildings';
import { findSiteGround, siteSatelliteUrl } from '../lib/worldSite/site';
import { TextPlacementDialog } from './TextPlacementDialog';
import { setTextPlacement } from '../lib/textPlacement';
import PresentationDriver from './presentation/PresentationDriver';
import { cutForDormers, dormerFingerprint, layoutsOf } from '../lib/dormers';
import { SceneWeather } from './graphics/SceneWeather';
import { InstancedVegetation } from './graphics/InstancedVegetation';
import { SurfaceDepthBinding } from './graphics/SurfaceDepthBinding';
import { FenceMesh, FenceEditHandles, fenceWorldPoints, terrainUnder } from './FenceMesh';
import { groundUnderRay } from '../lib/terrain/groundRay';
import { GlassWeatherDriver, WetGlassMaterial, useGlassWeather } from './graphics/WetGlass';
import { WaterMesh } from './WaterMesh';
import { WaterEditHandles } from './WaterEditHandles';
import { PatioMesh } from './landscape/PatioMesh';
import { ProtractorTool, ProtractorMeasurement, type ProtractorArgs } from './ProtractorTool';
import { PatioDrawTool, PatioEditHandles, patioGroundHelpers, wallFaces, type SnappedPoint, type PatioClosure } from './landscape/PatioTool';
import { buildCloseTargets, joinedEdges, patioWorldPath, snapPatioToBuilding, trimAgainstPatios } from '../lib/patio/patioClosure';
import { makePatioShape, patioLevel, patioWallEdges } from '../lib/patio/patioPlacement';
import { balconyFrame, balconyWarnings, type BalconyPlacement } from '../lib/patio/balcony';
import { DEFAULT_BALCONY, DEFAULT_BALCONY_LOOK } from '../lib/patio/patioTypes';
import { BalconyPlaceTool } from './landscape/BalconyTool';
import { WaterDrawPreview } from './WaterDrawPreview';
import { terrainsWithWaterBasins, defaultWaterLevel } from '../lib/water/waterBody';
import { sampleTerrainElevation } from '../lib/archRoomAssembly';
import { fenceStyleInfo } from '../lib/fence/fenceTypes';
import { shouldHideAutoNormalMap, terrainGeometryDeps } from '../lib/graphics/depthGeometry';
import { LampLightBinding } from './graphics/LampLightBinding';
import { batchablePlant } from '../lib/graphics/vegetationEligibility';
import { pickHostedFixture } from '../lib/hostedFixturePicking';
import { createPortal } from 'react-dom';
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
  Environment,
  GizmoHelper,
  GizmoViewport
} from '@react-three/drei';
import { EffectComposer, N8AO, GodRays } from '@react-three/postprocessing';
import { Effect, EffectAttribute } from 'postprocessing';
import * as THREE from 'three';
import { SUBTRACTION, ADDITION, INTERSECTION, Evaluator, Brush } from 'three-bvh-csg';
import { edgesOffPlanes, joinedEndPlanes, sameShapePart, wallRuns } from '../lib/wallRuns';
import { singleSidedGeometry } from '../lib/edgeLines';
import { cutTerrainUnderFootprints } from '../lib/terrain/terrainCut';
import { COMBINE_SOLIDS_EVENT, setCombinePicks, useCombinePicks, type CombineSolid } from '../tools/combinePicks';
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
import { openingCutsWall, openingSpanOnWall } from '../lib/wallOpeningSpan';
import {
  scanSceneForTargetHeight,
  calculateParametricStairs,
  createParametricStaircaseGeometry
} from '../lib/parametricStairs';
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
import { getBlockPart, buildBlockGeometry, primaryStudDirection, STUD_UNIT, BRICK_HEIGHT, PLATE_HEIGHT, BlockPart } from '../lib/blockKitGeometry';
import { PlantModelMesh } from './PlantModelMesh';
import { useApp } from '../AppContext';
import { Shape, CustomLight, SceneNote, SceneState, SceneAnimation, isTextureUrl, RoadModifier, PadModifier, TerrainModifier, ToolType } from '../types';
import CutFillVolumeOverlay from './terrain/CutFillVolumeOverlay';
import RoadSplineOverlay from './terrain/RoadSplineOverlay';
import ParametricPadOverlay from './terrain/ParametricPadOverlay';
import { ProceduralGrass } from './terrain/ProceduralGrass';
import { ProceduralWildflowers } from './terrain/ProceduralWildflowers';
import { getSnowyEnvironmentTexture } from '../lib/snowyEnvironment';
import BlockPickerOverlay from './BlockPickerOverlay';
import { deduplicateKnots, clampSplineGradeWithTransitions, sanitizeElevation } from '../lib/terrain/math';
import { applyPadGradingToTerrain } from '../lib/terrain/padGeometry';
import { applyRoadGradingToTerrain } from '../lib/terrain/roadGeometry';
import { createTerrainShape } from '../lib/terrain/terrainFactory';
import { getLandscapeCanvas, LANDSCAPE_TEXTURES } from '../lib/landscapeTextures';
import { getRoofTileCanvas } from '../lib/roofTileGenerator';
import { cn, formatValue, safelyToDate } from '../lib/utils';
import { Effects } from './Effects';
import { ChevronRight, ChevronDown, X, CheckCircle2, StickyNote, Palette, Layers, Lasso, SquareDashed } from 'lucide-react';
import StyleLibraryModal from './StyleLibraryModal';
import { LampStylePicker } from './graphics/LampStylePicker';
import { findLampStyle } from '../lib/lampStyles';
import { KernelGeometry, type KernelFaceBinding } from './KernelGeometry';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { useLineBinding } from '../tools/lineToolBinding';
import { Button } from './ui/Surface';
import { runtimeImageUrl, useMaterialBindings } from '../lib/assets/useMaterialBindings';
import { useAssetCatalog } from '../lib/assets/useAssetCatalog';
import { isMaterialAssetId } from '../lib/assets/types';
import { loadAssetManifest } from '../lib/assets/catalog';
import { chooseTier } from '../lib/assets/materialResolver';
import { EnvironmentManager } from '../lib/assets/environmentManager';
import { useManagedBindingTextures } from '../lib/assets/useManagedBindingTextures';
import { DimensionMark, LeaderMark, AreaMark } from './AnnotationMarks';
import { makeDimensionArgs, measureFace, isDimensionShape, isAreaLabelShape, isLeaderShape, type AreaLabelArgs, type DimensionArgs, type LeaderArgs } from '../tools/annotations';
import { type FaceFinish, paintFace, paintFaces, setFaceSurfaceDepth, setFacesSurfaceDepth, deleteFaceAndEdges, deleteGroupFacesAndEdges, groupContaining, setGroupHidden, faceGroups, duplicateGroup, objectInfoSummary, type ObjectInfoSummary } from '../tools/kernelSelection';
import { tessellateFace, mergeBuffers } from '../lib/geometry/tessellate';
import { snapshot } from '../lib/geometry/heal';
import { applyBoolean, planBoolean, BOOLEAN_LABELS, orderedShapeGroups, isFlatShape, type BooleanOp, type BooleanPlan, type BooleanRejection } from '../tools/kernelBoolean';
import { planCurvedMerge, isCurvedPiece, type MergeResult, type MergeRejection } from '../tools/convertedWallMerge';
import { analyzeWallConversion, buildWallShapes, captureFaces, floorFacesWithin, graphSignature, heightWarnings, outerRing, planWithThickness, type WallConversionPlan, type WallConversionRejection } from '../tools/kernelConvertToWall';
import { divideRectangularFace, isSimpleRectangularFace } from '../lib/geometry/divideSurface';
import { derive } from '../lib/geometry/derive';
import { loopVertexIds, getVertex, loopPoints, edgePoints } from '../lib/geometry/topology';
import {
  axisSources, featureEdges, guideCrossings, guideOffset, guideSegment, isGuideShape,
  makeGuideArgs, offsetAtDistance, pickGuideSource, type GuideArgs, type GuideSource, type V3,
} from '../tools/tapeGuides';
import { SectionCutter } from './SectionCutter';
import { SectionPlaneMesh } from './SectionPlaneMesh';
import { activeSection, dragDistance, isSectionShape, moveSection, sectionOnFace, type SectionArgs } from '../tools/sectionPlanes';
import { usePresentation } from '../lib/presentation/store';
import { explodeGroup, isGroupShape, makeGroup, makeUnique } from '../tools/kernelGroups';
import {
  axisLock as makeAxisLock, computeSnap, edgeLock, SnapMemory, type AxisName, type HoverEdge, type SnapGuide, type SnapInput, type SnapKind, type SnapLine, type SnapResult,
} from '../tools/snapEngine';
import { ArcTool, type ArcToolState } from '../tools/arcTool';
import { arcPointAt } from '../lib/geometry/curve';
import { KernelGroupMesh } from './KernelGroupMesh';
import { commitKernelFollowMe, outlineEdges, pathFromEdge, pathFromFace, previewFollowMe, type FollowMePath } from '../tools/kernelFollowMe';
import { createPushPullBinding, commitKernelPushPull } from '../tools/kernelPushPull';
import { PushPullPreview } from './PushPullPreview';
import { createFaceOffsetBinding, commitKernelFaceOffset } from '../tools/kernelFaceOffset';
import { createChamferBinding } from '../tools/kernelChamfer';
import { createFilletBinding } from '../tools/kernelFillet';
import { FaceOffsetPreview } from './FaceOffsetPreview';
import { ChamferPreview } from './ChamferPreview';
import { createGroupTransformBinding } from '../tools/kernelGroupTransform';
import { buildExportScene, collectModelItems, downloadBlob, exportFileName, isModelObject } from '../lib/export/modelExport';
import { buildSkp } from '../lib/export/skpExport';
import { GroupTransformPreview } from './GroupTransformPreview';
import { LassoOverlay } from './LassoOverlay';
import { boundsOfFaces } from '../lib/geometry/grouptransform';
import type { EdgeId, FaceId, Mat4, Vec3 } from '../lib/geometry/types';
import { SunShadowRig } from './graphics/SunShadowRig';
import { buildRoomAssembly, groundSlabFootprints, orientRoomWallsToExterior, computeOutwardWallNormal2D, computeWallCornerPoint, computeWallFaceCorner } from '../lib/archRoomAssembly';
import { WallJustification } from '../tools/inference/types';
import { buildRoofShapeForRoom, buildNextFloorLevel, getRoomBoundingEnvelope } from '../lib/archRoofGenerator';
import { applyStairwellHolesToSlabs, computeHolesForSlab } from '../lib/archStairwell';
import { updateTimberFramesIfPresent } from '../lib/timberFrameGenerator';
import { smoothstep, type PortalDestination } from '../lib/portalNavigation';
import { TeleportPortalPreview } from './PortalNavigationPreview';
import WalkModeController from './walk/WalkModeController';
import WalkModeOverlay from './walk/WalkModeOverlay';
import LookModeController from './camera/LookModeController';
import LookModeOverlay from './camera/LookModeOverlay';
import { InstancedTimberFraming } from './InstancedTimberFraming';
import { BezierTool } from '../tools/bezier/BezierTool';
import { KernelBezierHost } from '../tools/bezier/KernelBezierHost';
import { tessellateEntireCurve, tessellateBezierSpan } from '../tools/bezier/tessellate';
import { checkSelfIntersection, projectToPlane } from '../lib/planarPolygon';
import {
  acceptsTypedKey, drawingBasis, formatTyped, parseTypedAngle, parseTypedFactor, parseTypedLength, parseTypedRectangle,
  parseTypedSides, parseTypedVector, pointAlong, rectangleRing, regularRing,
} from '../tools/typedEntry';
import { commitBezierSurface, type BezierKnotInput } from '../tools/bezier/bezierSurface';
import { BezierKnot, BezierCurveState } from '../tools/bezier/types';
import { createScaleFigureGeometry, SCALE_FIGURE_CHARACTERS } from '../lib/scaleFigureGeometry';

/** Tools whose START point should snap to kernel geometry on hover. §4.2 */
const KERNEL_SNAP_TOOLS: string[] = [
  'line', 'poly', 'bezier', 'arc', 'rectangle', 'circle', 'polygon', 'triangle', 'measurement',
];

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

function bufferGeometryToShapeData(geom: THREE.BufferGeometry): { positions: number[]; normals: number[]; uvs?: number[] } {
  return {
    positions: Array.from(geom.attributes.position?.array || []),
    normals: geom.attributes.normal?.array ? Array.from(geom.attributes.normal.array) : [],
    uvs: geom.attributes.uv?.array ? Array.from(geom.attributes.uv.array) : undefined,
  };
}

function blockPartHeight(part: BlockPart): number {
  return part.heightKind === 'brick' ? BRICK_HEIGHT : PLATE_HEIGHT;
}

/** World-space AABB for a block, given its footprint part, base position and
 * 90°-step rotation (rotation only ever swaps X/Z extents at these steps). */
function blockWorldBounds(part: BlockPart, position: [number, number, number], rotationSteps: number): THREE.Box3 {
  const swapped = ((rotationSteps % 4) + 4) % 4 % 2 === 1;
  const width = (swapped ? part.studsZ : part.studsX) * STUD_UNIT;
  const depth = (swapped ? part.studsX : part.studsZ) * STUD_UNIT;
  const height = blockPartHeight(part);
  const [x, y, z] = position;
  return new THREE.Box3(
    new THREE.Vector3(x - width / 2, y, z - depth / 2),
    new THREE.Vector3(x + width / 2, y + height, z + depth / 2)
  );
}

/**
 * Snaps a block's footprint CENTER so that its CORNER lands on the world
 * stud grid, not so that the center itself lands on a grid line. Real
 * interlocking-block snapping aligns edges, not centers: since every
 * footprint is an integer number of studs wide, corner-snapping is what
 * makes two DIFFERENT-sized blocks (e.g. a 1-wide next to a 2-wide) sit
 * flush against each other. Center-snapping only works when both blocks'
 * widths have the same odd/even parity - otherwise it leaves a gap or
 * forces an overlap, since half of an odd stud count isn't a whole
 * multiple of the grid.
 */
function snapBlockFootprintCenter(part: BlockPart, rotationSteps: number, hitX: number, hitZ: number): [number, number] {
  const swapped = ((rotationSteps % 4) + 4) % 4 % 2 === 1;
  const width = (swapped ? part.studsZ : part.studsX) * STUD_UNIT;
  const depth = (swapped ? part.studsX : part.studsZ) * STUD_UNIT;
  const minX = Math.round((hitX - width / 2) / STUD_UNIT) * STUD_UNIT;
  const minZ = Math.round((hitZ - depth / 2) / STUD_UNIT) * STUD_UNIT;
  return [minX + width / 2, minZ + depth / 2];
}

/** Whether a candidate block placement would overlap an already-placed
 * block-kit shape. Uses a small inward epsilon so blocks that are merely
 * touching edge-to-edge (the normal, desired case when stacking/butting
 * blocks together) are never flagged as overlapping. */
function blockPlacementOverlaps(
  candidatePart: BlockPart,
  candidatePosition: [number, number, number],
  candidateRotationSteps: number,
  shapes: Shape[]
): boolean {
  const EPS = 0.004; // ~4mm inward tolerance
  const candidateBox = blockWorldBounds(candidatePart, candidatePosition, candidateRotationSteps);
  for (const other of shapes) {
    if (!other.tags?.includes('block-kit')) continue;
    const otherPartId = other.tags.find(t => t !== 'block-kit' && !t.startsWith('block-category-'));
    const otherPart = otherPartId ? getBlockPart(otherPartId) : undefined;
    if (!otherPart) continue;
    const otherRotationSteps = Math.round(((other.rotation?.[1] || 0) / (Math.PI / 2)));
    const otherBox = blockWorldBounds(otherPart, other.position, otherRotationSteps);
    const overlapX = Math.min(candidateBox.max.x, otherBox.max.x) - Math.max(candidateBox.min.x, otherBox.min.x);
    const overlapY = Math.min(candidateBox.max.y, otherBox.max.y) - Math.max(candidateBox.min.y, otherBox.min.y);
    const overlapZ = Math.min(candidateBox.max.z, otherBox.max.z) - Math.max(candidateBox.min.z, otherBox.min.z);
    if (overlapX > EPS && overlapY > EPS && overlapZ > EPS) return true;
  }
  return false;
}

/**
 * Of the 4 Y-axis rotation steps, which one points `part`'s primary stud
 * as close as possible to directly opposite `worldNormal` - i.e. plugging
 * INTO the face that normal belongs to, the way a real interlocking piece
 * has to be turned to face what it's attaching to.
 */
function bestAutoRotationSteps(part: BlockPart, worldNormal: THREE.Vector3): number {
  const localDir = new THREE.Vector3(...primaryStudDirection(part));
  const targetDir = worldNormal.clone().negate();
  const up = new THREE.Vector3(0, 1, 0);
  let bestSteps = 0;
  let bestDot = -Infinity;
  for (let steps = 0; steps < 4; steps++) {
    const rotated = localDir.clone().applyAxisAngle(up, steps * (Math.PI / 2));
    const dot = rotated.dot(targetDir);
    if (dot > bestDot) { bestDot = dot; bestSteps = steps; }
  }
  return bestSteps;
}

/**
 * Where a block being placed should land, and how it should be rotated,
 * given what its raycast landed on. Hitting the TOP of another block-kit
 * piece keeps the existing, working "stack on top" behavior completely
 * unchanged (snappedY = the hit point's own height, rotation left up to
 * the user) - that's deliberately untouched here.
 *
 * Hitting a SIDE (or bottom) face instead means attaching alongside at
 * that piece's own base height rather than at the arbitrary height the
 * ray happened to hit partway up its side. And for a part whose primary
 * connecting stud ISN'T a plain top stud (brackets, a tree's branch
 * stud), it also auto-rotates the piece so that stud faces directly into
 * the hit surface - the same "full auto-alignment" a real interlocking
 * piece gets from physically only fitting one way against what it's
 * plugging into, rather than requiring the user to manually spin it with
 * arrow keys until it happens to line up.
 */
function resolveBlockAttachment(
  intersect: THREE.Intersection,
  hitShape: Shape,
  hitPointY: number,
  part: BlockPart,
  currentRotationSteps: number
): { y: number; rotationSteps: number } {
  let worldNormal = new THREE.Vector3(0, 1, 0);
  if (intersect.face) {
    worldNormal = intersect.face.normal.clone().transformDirection(intersect.object.matrixWorld).normalize();
  }
  const isTopHit = worldNormal.y > 0.7;
  if (isTopHit) {
    return { y: hitPointY, rotationSteps: currentRotationSteps };
  }
  const isDirectionalPart = Math.abs(primaryStudDirection(part)[1]) < 0.9;
  return {
    y: hitShape.position[1],
    rotationSteps: isDirectionalPart ? bestAutoRotationSteps(part, worldNormal) : currentRotationSteps
  };
}

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
  const knownCanvas = getLandscapeCanvas(url) || getRoofTileCanvas(url);
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

// Loader for the non-albedo PBR map slots (normal/roughness/metalness/AO/
// displacement). These store linear data, not color, so unlike
// getCachedTexture() above this must never set SRGBColorSpace - doing so
// would visibly distort normals and mis-scale roughness/metalness/AO values.
const _polyformPBRMapCache = new Map<string, THREE.Texture>();
/**
 * The finish the paint tool applies to kernel faces: a library material, or the active
 * roughness/metalness/opacity (null for a plain default colour).
 */
function faceFinishFor(bindingId: string | null | undefined, pbr: { roughness?: number; metalness?: number; opacity?: number } | undefined): FaceFinish | null {
  const p = pbr ?? { roughness: 0.5, metalness: 0, opacity: 1 };
  const plainDefault = (p.roughness ?? 0.5) === 0.5 && (p.metalness ?? 0) === 0 && (p.opacity ?? 1) === 1;
  if (!bindingId && plainDefault) return null;
  return { bindingId: bindingId ?? null, roughness: bindingId ? undefined : p.roughness,
    metalness: bindingId ? undefined : p.metalness, opacity: p.opacity ?? 1 };
}

function getCachedPBRMapTexture(url?: string): THREE.Texture | undefined {
  if (!url) return undefined;
  let tex = _polyformPBRMapCache.get(url);
  if (tex) return tex;
  tex = _polyformTextureLoader.load(url, (loaded) => {
    loaded.wrapS = THREE.RepeatWrapping;
    loaded.wrapT = THREE.RepeatWrapping;
    loaded.colorSpace = THREE.NoColorSpace;
    loaded.needsUpdate = true;
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  _polyformPBRMapCache.set(url, tex);
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
  // Sun-tinted fog: brightens and warms the fog color when the view ray points
  // toward the sun, the everyday effect of atmospheric scattering (the sky and any
  // haze glow brighter in the sun's direction, most obviously near sunrise/sunset).
  // Reuses this same shader/fog pass rather than a separate effect.
  uniform vec3 sunDirection;
  uniform vec3 sunColor;
  uniform float sunStrength;

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

    // How directly this ray looks toward the sun - a tight, high-power falloff so
    // the tint stays a glow around the sun's direction rather than washing out the
    // whole sky. sunStrength (from Sun Intensity) keeps a dim/off sun from tinting
    // fog it isn't actually lighting.
    float sunAmount = pow(max(dot(rayDir, sunDirection), 0.0), 10.0) * clamp(sunStrength, 0.0, 1.0);

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
      vec3 tintedFog = mix(color1, sunColor, sunAmount);
      outputColor = vec4(mix(tintedFog, inputColor.rgb, fogFactor), inputColor.a);
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

    fogColor = mix(fogColor, sunColor, sunAmount);

    outputColor = vec4(mix(fogColor, inputColor.rgb, fogFactor), inputColor.a);
  }
`;

RectAreaLightUniformsLib.init();

class FogEffectImpl extends Effect {
  camera: THREE.Camera;

  constructor({ color1, color2, color3, density, height, heightEnd, speed, colorCount, fogType, camera, sunPosition, sunColor, sunStrength }: any) {
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
        ['viewMatrixInverse', new THREE.Uniform(new THREE.Matrix4().copy(camera.matrixWorld))],
        ['sunDirection', new THREE.Uniform(new THREE.Vector3(...sunPosition).normalize())],
        ['sunColor', new THREE.Uniform(new THREE.Color(sunColor))],
        ['sunStrength', new THREE.Uniform(sunStrength)]
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

const FogEffect = React.forwardRef(({ settings, camera, sunPosition, sunIntensity }: any, ref) => {
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
    camera,
    sunPosition: sunPosition || [5, 5, 5],
    // A fixed warm daylight tint rather than a per-scene setting: sun-tinted fog is
    // meant as a subtle, always-sensible enhancement to the existing fog pass, not
    // another color to configure.
    sunColor: '#fff4dd',
    // Ties the tint's strength to the sun's own configured brightness (Sun Intensity,
    // 0-50 in the Lighting panel) so a dim/disabled sun doesn't tint fog it isn't
    // actually lighting; halved and clamped since the shader's own falloff already
    // does the heavy lifting of keeping this subtle.
    sunStrength: Math.min(1, (sunIntensity ?? 1) / 2)
  }), [settings, camera, sunPosition, sunIntensity]);
  
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
        // Walls from scripts may carry only `rotation`; without it every opening lands in the wrong place.
        const wallQuat = shape.quaternion
          ? new THREE.Quaternion(...shape.quaternion)
          : new THREE.Quaternion().setFromEuler(new THREE.Euler(...(shape.rotation || [0, 0, 0])));
        const invWallQuat = wallQuat.clone().invert();

        const openings: WallOpening[] = [];
        const portholeWindows: { localX: number; localY: number; radius: number }[] = [];
        for (const s of shapes) {
          if (s.type !== 'door' && s.type !== 'window') continue;
          if (s.hidden) continue;

          const sArgs = Array.isArray(s.args) ? s.args : [1, 1, 1];
          const sWidth = sArgs[0] || (s.type === 'door' ? 0.9 : 1.2);
          const sHeight = sArgs[1] || (s.type === 'door' ? 2.1 : 1.2);
          const sDepth = sArgs[2] || (s.type === 'door' ? 0.15 : 0.12);

          // The stretch of the opening that crosses this piece, so a window spanning several
          // pieces of a curved wall is cut through all of them.
          const span = openingSpanOnWall(shape, s);
          if (span && openingCutsWall(shape, s, span)) {
            // A porthole's round frame doesn't match the rectangular hole
            // every other style uses - cut a round hole via CSG below
            // instead, so the reveal around the ring is the wall's own
            // material (and recolors with the wall) rather than a separate
            // rectangular cutout with mismatched corners.
            if (s.type === 'window' && s.archStyle === 'porthole') {
              const sPos = new THREE.Vector3(...s.position);
              const localPos = sPos.sub(wallPos).applyQuaternion(invWallQuat);
              portholeWindows.push({ localX: localPos.x, localY: localPos.y, radius: Math.min(sWidth, sHeight) / 2 });
              continue;
            }
            openings.push({
              id: s.id,
              type: s.type,
              localX: span.localX,
              localY: span.localY,
              width: span.width,
              height: sHeight,
              depth: sDepth
            });
          }
        }

        let wallGeom = createWallWithOpeningsGeometry(wallLength, wallHeight, wallThick, openings, shape.wallStyle || shape.archStyle, shape.wallMiterFootprint);

        if (portholeWindows.length > 0) {
          try {
            let currentBrush = new Brush(mergeVertices(wallGeom.clone()));
            currentBrush.updateMatrixWorld();
            const evaluator = new Evaluator();
            for (const win of portholeWindows) {
              const cutterGeo = new THREE.CylinderGeometry(win.radius, win.radius, wallThick + 0.4, 48);
              cutterGeo.rotateX(Math.PI / 2);
              cutterGeo.translate(win.localX, win.localY, 0);
              const cutterBrush = new Brush(cutterGeo);
              cutterBrush.updateMatrixWorld();
              const result = evaluator.evaluate(currentBrush, cutterBrush, SUBTRACTION);
              if (result && result.geometry) currentBrush = result;
            }
            const cutGeom = mergeVertices(currentBrush.geometry);
            cutGeom.computeVertexNormals();
            wallGeom = cutGeom;
          } catch (csgErr) {
            console.warn('Porthole wall cutout error:', csgErr);
          }
        }

        return wallGeom;
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
        if (shape.isParametric) {
          return createParametricStaircaseGeometry({
            targetHeight: shape.parametricData?.targetHeight || args[1] || 2.16,
            idealStepHeight: shape.parametricData?.idealStepHeight,
            strideConstant: shape.parametricData?.strideConstant,
            width: args[0] || 1.0,
            // StairFix: this was the actual trigger of the style-mismatch bug —
            // stairStyle was never forwarded here, so every parametric
            // staircase fell through to the parametric generator's default
            // (straight-run) behavior no matter which of the 8 styles was
            // selected in the Style Library.
            stairStyle: shape.stairStyle || shape.archStyle || 'straight',
            stairStructure: shape.stairStructure || 'closed',
            railingMode: shape.railingMode || 'both'
          }).geometry;
        }
        return createStaircaseGeometry(
          args[0] || 1.0, 
          args[1] || 2.16, 
          args[2] || 3.6, 
          args[3] || 14,
          {
            stairStyle: shape.stairStyle || shape.archStyle || 'straight',
            stairStructure: shape.stairStructure || 'closed',
            railingMode: shape.railingMode || 'both',
            isParametric: shape.isParametric,
            idealStepHeight: shape.parametricData?.idealStepHeight,
            strideConstant: shape.parametricData?.strideConstant
          }
        );
      case 'scale_figure': {
        const charId = shape.archStyle || 'architect-alex';
        const customH = Array.isArray(shape.args) ? shape.args[1] : (typeof shape.args === 'number' ? shape.args : undefined);
        return createScaleFigureGeometry(charId, customH);
      }
      default:
        return new THREE.BoxGeometry(1, 1, 1);
    }
  }, [
    shape.type, 
    shape.position, 
    shape.quaternion, 
    shape.archStyle, 
    shape.wallStyle,
    shape.stairStyle, 
    shape.stairStructure, 
    shape.railingMode, 
    shape.isParametric,
    shape.parametricData?.targetHeight,
    shape.parametricData?.stepCount,
    shape.parametricData?.actualStepHeight,
    shape.parametricData?.treadDepth,
    args[0],
    args[1],
    args[2],
    args[3],
    openingsHash,
    shape.wallMiterFootprint
  ]);

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
        return createRailingGeometry(Array.isArray(shape.args) ? shape.args[0] : 2.0, Array.isArray(shape.args) ? shape.args[1] : 1.0, Array.isArray(shape.args) ? shape.args[2] ?? 0 : 0);
      case 'lamp':
        return createLampGeometry(Array.isArray(shape.args) ? shape.args[1] : 3.2, shape.archStyle || 'classic');
      case 'bench':
        return createBenchGeometry(Array.isArray(shape.args) ? shape.args[0] : 1.8);
      case 'rock':
        return createRockGeometry(Array.isArray(shape.args) ? shape.args[0] : 1.2);
      default:
        return new THREE.BoxGeometry(1, 1, 1);
    }
  }, [shape.type, shape.args, shape.plantSpeciesId, shape.archStyle]);

  useEffect(() => {
    return () => {
      if (geometry) geometry.dispose();
    };
  }, [geometry]);

  return <primitive object={geometry} attach="geometry" />;
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

/**
 * The main perspective view's scene, for the split-view panels. They draw this same live scene
 * (terrain, kernel-drawn geometry, water, plants, materials, lights, weather — everything) from
 * their own cameras, instead of a simplified copy of the basic shapes, so every change in the
 * main view shows up in them too. Three.js scenes can be drawn by several renderers: each
 * uploads its own copies of the geometry and textures.
 */
export const mainSceneRef: { current: THREE.Scene | null } = { current: null };

/** Registers the main view's scene for the split-view panels. */
function ShareMainScene() {
  const scene = useThree(state => state.scene);
  useEffect(() => {
    mainSceneRef.current = scene;
    return () => { if (mainSceneRef.current === scene) mainSceneRef.current = null; };
  }, [scene]);
  return null;
}

/**
 * Draws the main scene with this panel's camera, every other frame. The main view's
 * environment map and sky belong to the main renderer (render targets it generated), so this
 * panel uses its own neutral environment over a plain background. Other main-renderer-only
 * textures (water and portal reflections) show blank here.
 */
function MirrorMainScene({ background }: { background: string }) {
  const frame = useRef(0);
  const color = useMemo(() => new THREE.Color(background), [background]);
  const gl = useThree(state => state.gl);
  // A neutral studio environment of this panel's own, so materials read much as they do in the
  // main view (the main view's environment map lives in the main renderer only).
  const environment = useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    return texture;
  }, [gl]);
  useEffect(() => () => environment.dispose(), [environment]);
  useFrame(({ gl, camera, scene: own }) => {
    const main = mainSceneRef.current;
    if (!main) { gl.render(own, camera); return; }
    if (frame.current++ % 2) return;
    const savedBackground = main.background, savedEnvironment = main.environment;
    main.background = color;
    main.environment = environment;
    try {
      gl.render(main, camera);
    } finally {
      main.background = savedBackground;
      main.environment = savedEnvironment;
    }
  }, 1);
  return null;
}

/** World bounds of everything modelled in the main scene (shapes, kernel geometry, terrain). */
function mainSceneBounds(fallback: { center: THREE.Vector3; radius: number }) {
  const main = mainSceneRef.current;
  if (!main) return fallback;
  const box = new THREE.Box3();
  main.updateMatrixWorld();
  main.traverseVisible(object => {
    if (!(object as THREE.Mesh).isMesh) return;
    if (object.userData?.isShape || object.userData?.isKernelGeometry) box.expandByObject(object);
  });
  if (box.isEmpty()) return fallback;
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  return { center: sphere.center, radius: Math.max(1, sphere.radius) };
}

/**
 * World bounds of the modelled objects in the main scene whose shape id passes `include`
 * (kernel-drawn surfaces count as the id 'kernel'). Null when nothing matches.
 */
export function modelledBounds(include: (id: string) => boolean): THREE.Box3 | null {
  const main = mainSceneRef.current;
  if (!main) return null;
  const box = new THREE.Box3();
  main.updateMatrixWorld();
  main.traverseVisible(object => {
    if (!(object as THREE.Mesh).isMesh) return;
    let id: string | null = null;
    for (let o: THREE.Object3D | null = object; o && id === null; o = o.parent) {
      if (o.userData?.isKernelGeometry) id = 'kernel';
      else if (o.userData?.isShape) id = String(o.userData.id);
    }
    if (id !== null && include(id)) box.expandByObject(object);
  });
  return box.isEmpty() ? null : box;
}

function MiniScene({ view }: { view: 'top' | 'front' | 'right' }) {
  const { shapes, theme, activeTool, kernelRevision } = useApp();
  const fallback = React.useMemo(() => computeMiniViewBounds(shapes), [shapes]);
  // Re-frame when the model changes (a moment later, once the main view has drawn it).
  const [bounds, setBounds] = useState(fallback);
  useEffect(() => {
    const timer = window.setTimeout(() => setBounds(mainSceneBounds(fallback)), 150);
    return () => window.clearTimeout(timer);
  }, [fallback, kernelRevision]);
  const { center, radius } = bounds;
  const dist = radius * 2.2 + 4;
  const camPos: [number, number, number] =
    view === 'top' ? [center.x, center.y + dist, center.z + 0.01] :
    view === 'front' ? [center.x, center.y, center.z + dist] :
    [center.x + dist, center.y, center.z];
  const target: [number, number, number] = [center.x, center.y, center.z];
  return (
    <>
      <PerspectiveCamera makeDefault position={camPos} fov={35} far={Math.max(2000, dist * 4)} />
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
      <MirrorMainScene background={theme === 'dark' ? '#1f2937' : '#eef2f6'} />
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

/** Whether a pointer event on the ground also hit a drawn surface or an object. */
function pressHitsGeometry(e: { intersections?: { object: THREE.Object3D }[] }): boolean {
  return !!e.intersections?.some(i => {
    let o: THREE.Object3D | null = i.object;
    while (o) {
      if (o.userData?.isKernelGeometry || o.userData?.isShape) return true;
      o = o.parent;
    }
    return false;
  });
}

/**
 * Edge lines like drei's Edges (drawn from the parent mesh's geometry), leaving out the lines
 * lying in the given planes: where a wall piece joins the next piece of its run.
 */
function RunEdges({ planes, singleSided = false, ...props }: { planes: { point: THREE.Vector3; normal: THREE.Vector3 }[]; singleSided?: boolean } & Record<string, any>) {
  const ref = useRef<any>(null);
  const seed = useMemo(() => [0, 0, 0, 1, 0, 0], []);
  const memo = useRef<{ geometry: THREE.BufferGeometry | null; key: string }>({ geometry: null, key: '' });
  const key = planes.map(p => `${p.point.toArray().map(v => v.toFixed(4))}|${p.normal.toArray().map(v => v.toFixed(4))}`).join(';') + (singleSided ? '|1' : '');
  useLayoutEffect(() => {
    const line = ref.current;
    const geometry = line?.parent?.geometry as THREE.BufferGeometry | undefined;
    if (!line || !geometry) return;
    if (memo.current.geometry === geometry && memo.current.key === key) return;
    memo.current = { geometry, key };
    // A double-sided mesh (roofs) would otherwise draw every triangle's edges.
    const source = singleSided ? singleSidedGeometry(geometry) : geometry;
    const kept = edgesOffPlanes(new THREE.EdgesGeometry(source, 15).attributes.position.array, planes);
    if (source !== geometry) source.dispose();
    line.geometry.setPositions(kept.length ? kept : [0, 0, 0, 0, 0, 0]);
    line.visible = kept.length > 0;
    line.computeLineDistances();
  });
  return <Line segments points={seed} ref={ref} raycast={() => null} {...props} />;
}

function Scene() {
  const { graphicsSettings } = useApp();
  const { assets: groundMaterialAssets } = useAssetCatalog('material');
  const { 
    activeTool, 
    setActiveTool,
    isDeveloperConsoleOpen,
    shapes, 
    setShapes,
    duplicateObject,
    duplicateMultiple,
    setShapesSilent,
    commitHistory,
    addShape, 
    removeShape,
    selectedId, 
    setSelectedId, 
    activeMaterial,
    activeMaterialBindingId,
    materialBindings,
    setMaterialBindings,
    activePBR,
    activeSurfaceDepth,
    updateShapeColor,
    updateShapeDimensions,
    setMeasurements,
    setViewportToast,
    setPlacingNotePos,
    unit,
    theme,
    setRightPanelVisible,
    setPanelVisibility,
    shadowsEnabled,
    showLightsource,
    lightPosition,
    setLightPosition,
    sunOrbitCenter,
    pickingSunCenter,
    setPickingSunCenter,
    setSunOrbitCenter,
    isWorldViewActive,
    worldViewLocation,
    worldViewAltitude,
    googleMapsApiKey,
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
    godRaysEnabled,
    godRaysIntensity,
    activeBevelType,
    setActiveBevelType,
    activeBevelAmount,
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
    axisIndicatorEnabled,
    miniAxisIndicatorEnabled,
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
    kernelSubtractTarget,
    setKernelSubtractTarget,
    selectionShapeMode,
    setSelectionShapeMode,
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
    contactFrictionStrength,
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
    activeScaleFigureCharacter,
    activeScaleFigureHeight,
    activeBlockPart,
    setActiveBlockPart,
    blockPlacementDraft,
    setBlockPlacementDraft,
    blockPreventOverlap,
    kernelHost,
    kernelRevision,
    bumpKernel,
    selectedFaceIds,
    setSelectedFaceIds,
    wallToolSettings,
    setWallToolSettings,
    wallJustification,
    setWallJustification,
    activeStory,
    setActiveStory,
    commitUpdatedFraming,
    cameraDepthClippingEnabled,
    cameraNear,
    cameraFar,
    wallTransparency,
    exteriorWallTransparency,
    interiorWallTransparency,
    roofTransparency,
    floorTransparency,
    fixturesTransparency,
    terrainModifiers,
    setTerrainModifiers,
    selectedModifierId,
    setSelectedModifierId,
    activeSplineDraft,
    setActiveSplineDraft,
    activePadDraft,
    setActivePadDraft,
    civilRoadSettings,
    civilPadSettings,
    civilStripingSettings,
    addTerrainModifier,
    updateTerrainModifier,
    fenceToolSettings,
    waterToolSettings,
    patioToolSettings,
    walkModePhase,
    setWalkModePhase,
    walkMovementSpeed,
    walkMouseSensitivity,
    walkBridgeRef,
    guidesVisible,
    groupEdit,
    enterGroupEdit,
    exitGroupEdit,
  } = useApp();

  const usedMaterialBindings = useMemo(() => {
    const ids = new Set<string>();
    for (const shape of shapes) {
      if (shape.materialBindingId) ids.add(shape.materialBindingId);
      if (shape.patioData?.surfaceMaterialId) ids.add(shape.patioData.surfaceMaterialId);
      for (const id of Object.values(shape.surfaceMaterialBindings ?? {})) if (id) ids.add(id);
    }
    // Library materials painted onto kernel-drawn faces.
    for (const face of kernelHost.graph.faces.values()) {
      const bindingId = (face.attributes.custom.finish as { bindingId?: string | null } | undefined)?.bindingId;
      if (bindingId) ids.add(bindingId);
    }
    return Object.fromEntries([...ids].filter(id => materialBindings[id]).map(id => [id, materialBindings[id]]));
  }, [shapes, materialBindings, kernelHost, kernelRevision]);
  const { resolved: resolvedMaterialBindings } = useMaterialBindings(usedMaterialBindings, '2k');

  const { raycaster, mouse, camera, scene, gl } = useThree();
  // Walls joined into runs (a curved wall of many pieces, or pieces in line) act as one wall.
  const wallRunInfo = useMemo(() => wallRuns(shapes), [shapes]);
  // Ground-floor slab outlines: the terrain mesh is cut away under them.
  const slabFootprintsKey = useMemo(() => JSON.stringify(groundSlabFootprints(shapes).map(f => f.poly.map(p => [+p[0].toFixed(3), +p[1].toFixed(3)]))), [shapes]);
  const slabFootprints = useMemo(() => JSON.parse(slabFootprintsKey) as [number, number][][], [slabFootprintsKey]);
  const managedBindingTextures = useManagedBindingTextures(gl, resolvedMaterialBindings);
  /** Library material textures for kernel faces (same pipeline as shapes' bindingMaterial). */
  const kernelBindingFor = useCallback((bindingId: string): KernelFaceBinding | undefined => {
    const binding = resolvedMaterialBindings[bindingId];
    if (!binding) return undefined;
    const textures = managedBindingTextures[bindingId];
    const ormUrl = runtimeImageUrl(binding.maps.orm);
    const orm = textures?.orm ?? getCachedPBRMapTexture(ormUrl) ?? null;
    return {
      map: textures?.basecolor ?? getCachedPBRMapTexture(runtimeImageUrl(binding.maps.basecolor)),
      normalMap: textures?.['normal-gl'] ?? getCachedPBRMapTexture(runtimeImageUrl(binding.maps['normal-gl'])) ?? null,
      normalScale: new THREE.Vector2(binding.normalStrength ?? 1, binding.normalStrength ?? 1),
      roughnessMap: orm, metalnessMap: orm, aoMap: orm,
      roughness: binding.roughness, metalness: binding.metalness, color: binding.color,
    };
  }, [resolvedMaterialBindings, managedBindingTextures]);
  const activeFaceFinish = () => faceFinishFor(activeMaterialBindingId, activePBR);
  const batchedPlants = useMemo(() => {
    const selected = new Set([...selectedIds, ...(selectedId ? [selectedId] : [])]);
    return shapes.filter(shape => batchablePlant(shape, selected, tags, graphicsSettings.vegetation.instancing, activeTool));
  }, [shapes, selectedIds, selectedId, tags, graphicsSettings.vegetation.instancing, activeTool]);
  const batchedPlantIds = useMemo(() => new Set(batchedPlants.map(shape => shape.id)), [batchedPlants]);

  // Shared by every click path that can complete a "Pick Sun Centre"
  // pick (Shape mesh, kernel face, the floor plane, and the always-
  // present background plane — four separate onPointerDown handlers,
  // one shared implementation). Moves the visible sun along with the
  // pick, not just the invisible orbit centre: sunOrbitCenter only ever
  // fed the ORBIT math (see the useFrame block below), which only runs
  // while animateSun is on — with it off, picking a new centre changed
  // no visible position at all, confirmed directly as the cause of
  // "sun location is not updating." Preserving the sun's own current
  // offset from the old centre and re-applying it to the new one keeps
  // the sun's relative position (and, once animating, its orbit radius)
  // unchanged — it moves WITH the pick rather than snapping to the
  // pick point itself, which would put it at ground level.
  const pickSunCenter = (point: { x: number; z: number }) => {
    const dx = lightPosition[0] - sunOrbitCenter[0];
    const dz = lightPosition[2] - sunOrbitCenter[2];
    setSunOrbitCenter([point.x, sunOrbitCenter[1], point.z]);
    setLightPosition([point.x + dx, lightPosition[1], point.z + dz]);
    setPickingSunCenter(false);
  };

  // Routes the line tool's drag into the geometry kernel. §4.1
  const lineBinding = useLineBinding(kernelHost, bumpKernel);
  // Exact, un-offset endpoints of the line being previewed. See where this is
  // written for why the preview's own transform cannot be used.
  const kernelLineEndsRef = useRef<{ from: THREE.Vector3; to: THREE.Vector3 } | null>(null);
  /**
   * True corners of the shape being previewed, captured before the preview's
   * z-fighting offset is applied — same reason as the line tool's endpoints.
   */
  const kernelRingRef = useRef<THREE.Vector3[] | null>(null);
  const pushPullRef = useRef(createPushPullBinding(kernelHost, bumpKernel));
  /** The last distance pushed (signed along the face's normal), and when a bare click last landed, for double-click repeat. */
  const lastPushPullRef = useRef<{ distance: number | null; clickAt: number }>({ distance: null, clickAt: 0 });
  const faceOffsetRef = useRef(createFaceOffsetBinding(kernelHost, bumpKernel));
  const chamferRef = useRef(createChamferBinding(kernelHost, bumpKernel));
  const filletRef = useRef(createFilletBinding(kernelHost, bumpKernel));
  const [chamferPreview, setChamferPreview] = useState<{ faces: FaceId[]; amount: number; boundaries?: Vec3[][] } | null>(null);
  /**
   * A dedicated, impossible-to-miss banner for things like "Radius isn't
   * supported yet" — separate from `measurements`, which the status bar
   * shows only as a small, easy-to-miss monospace readout in its corner.
   * That is fine for a live drag amount, but a message the user actively
   * needs to notice (an unsupported tool, a failed operation) deserves its
   * own clearly visible space rather than competing for attention with a
   * number that updates constantly during ordinary use.
   *
   * The state itself and its render both live OUTSIDE this component now
   * (in AppContext, rendered from the outer Viewport() function) — see
   * AppContext.tsx's own doc comment on `viewportToast` for why: this
   * component, Scene(), is rendered by react-three-fiber's own reconciler,
   * not react-dom's, and a plain <div> created from within it — even via
   * createPortal — is rejected outright as "not part of the THREE
   * namespace." That was a real, reproduced crash, not a hypothetical one.
   */
  const showToast = useCallback((message: string, durationMs = 3000) => {
    setViewportToast(message);
    window.setTimeout(() => setViewportToast((current: string | null) => (current === message ? null : current)), durationMs);
  }, [setViewportToast]);
  const [faceOffsetPreview, setFaceOffsetPreview] = useState<
    { faceId: FaceId; distance: number } | null
  >(null);
  /**
   * Live extrusion preview. Held in state, not a ref, because it has to
   * re-render on every pointer move — the whole point is that the user can
   * see the result before committing.
   */
  const [pushPullPreview, setPushPullPreview] = useState<
    { rings: { x: number; y: number; z: number }[][]; normal: { x: number; y: number; z: number }; distance: number } | null
  >(null);

  // FaceId is a branded number; selection is stored as plain numbers in
  // AppState so it stays serialisable. Convert at this one boundary.
  const kernelSelectedSet = useMemo(
    () => new Set(selectedFaceIds as FaceId[]),
    [selectedFaceIds],
  );

  /**
   * Clicking a kernel face. Routes by active tool, mirroring what the same
   * tools already do to Shapes.
   *
   * Selecting a face clears the Shape selection and vice versa: they are
   * different representations, and a selection spanning both would have to be
   * understood by every consumer of either.
   */

  /** Tracks the last kernel-face click, so a second click on the SAME face
   *  within the window reads as a double-click rather than two singles. */
  const lastKernelClickRef = useRef<{ faceId: FaceId; time: number } | null>(null);
  const DOUBLE_CLICK_MS = 350;

  /**
   * Right-click on a kernel face — resolves to its whole group (same
   * click-selects-the-group semantics used everywhere else for kernel
   * objects) and opens the SAME context-menu UI Shapes already use, just
   * with a `'kernel'` type and its own small set of options. The menu
   * itself already lives safely in the outer Viewport() function — see
   * its own render further down — so this only needs to set the SAME
   * shared `contextMenu` context state Shapes already use.
   */
  const handleKernelFaceContextMenu = useCallback((faceId: FaceId, event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    event.nativeEvent?.preventDefault();
    const clientX = event.nativeEvent?.clientX ?? 0;
    const clientY = event.nativeEvent?.clientY ?? 0;
    // Right-clicking inside a selection of several shapes keeps it (for Merge / Subtract /
    // Intersect); otherwise the clicked shape becomes the selection, as before.
    const current = kernelSelectedSetRef.current;
    if (current.has(faceId) && orderedShapeGroups(kernelHost.graph, [...current]).length > 1) {
      setSelectedId(null);
      setSelectedIds([]);
      setContextMenu({ x: clientX, y: clientY, type: 'kernel', data: [...current], faceId });
      return;
    }
    const group = groupContaining(kernelHost.graph, faceId);
    setSelectedFaceIds(group);
    setSelectedId(null);
    setSelectedIds([]);
    setContextMenu({ x: clientX, y: clientY, type: 'kernel', data: group, faceId });
  }, [kernelHost, setContextMenu, setSelectedFaceIds, setSelectedId, setSelectedIds]);

  const handleKernelFaceClick = useCallback((faceId: FaceId, event: { shiftKey?: boolean; point?: THREE.Vector3 }) => {
    if ((window as any).__polyformLassoIgnoreClickUntil && Date.now() < (window as any).__polyformLassoIgnoreClickUntil) {
      return;
    }
    // These tools handle their own clicks on the canvas (see their effects below): a click
    // on a face there picks a profile, a path or a point, never the selection.
    if (activeTool === 'followme' || activeTool === 'tape' || activeTool === 'section' || activeTool === 'dimensions' || activeTool === 'leader') return;
    if (activeTool === 'combine') {
      // Combine: each click adds (or removes) a whole shape or object, in order; the first leads.
      const group = groupContaining(kernelHost.graph, faceId);
      const groupSet = new Set<number>(group);
      setCombinePicks(prev => prev.some(p => p.kind === 'kernel' && groupSet.has(p.face))
        ? prev.filter(p => !(p.kind === 'kernel' && groupSet.has(p.face)))
        : [...prev, { kind: 'kernel', face: faceId }]);
      return;
    }
    if (activeTool === 'paint') {
      // Matches select-tool semantics: a plain click acts on the whole
      // object (paints every face of the group the clicked one belongs
      // to), and shift-click narrows to just the one surface — the same
      // relationship as "click selects the group, double-click drills into
      // one face," just using shift as the modifier since paint has no
      // natural "double-click" gesture of its own.
      //
      // A pre-existing multi-face selection (built by shift-clicking faces
      // with a non-paint tool active, the same mechanism used to move/scale
      // a custom set of faces) takes priority over "paint the clicked face's
      // whole object": painting then applies to every selected face, however
      // many separate primitives they came from — the height map carried by
      // the active material included, same as its color.
      if (event.shiftKey) {
        if (kernelHost.transact(() => {
          if (!paintFace(kernelHost.graph, faceId, activeMaterial, activeFaceFinish())) return false;
          setFaceSurfaceDepth(kernelHost.graph, faceId, activeSurfaceDepth ?? null);
          return true;
        })) bumpKernel();
      } else if (kernelSelectedSet.size > 1) {
        if (kernelHost.transact(() => {
          if (paintFaces(kernelHost.graph, kernelSelectedSet, activeMaterial, activeFaceFinish()) === 0) return false;
          setFacesSurfaceDepth(kernelHost.graph, kernelSelectedSet, activeSurfaceDepth ?? null);
          return true;
        })) bumpKernel();
      } else {
        const group = groupContaining(kernelHost.graph, faceId);
        if (kernelHost.transact(() => {
          if (paintFaces(kernelHost.graph, group, activeMaterial, activeFaceFinish()) === 0) return false;
          setFacesSurfaceDepth(kernelHost.graph, group, activeSurfaceDepth ?? null);
          return true;
        })) bumpKernel();
      }
      return;
    }
    if (activeTool === 'eraser') {
      if (event.shiftKey) {
        // Shift-click deletes a single surface/face
        kernelHost.transact(() => { deleteFaceAndEdges(kernelHost.graph, faceId); return true; });
        bumpKernel();
        setSelectedFaceIds(prev => prev.filter(f => f !== faceId));
      } else {
        // Plain click on an object deletes all of that object's surfaces
        const group = groupContaining(kernelHost.graph, faceId);
        kernelHost.transact(() => { deleteGroupFacesAndEdges(kernelHost.graph, group); return true; });
        bumpKernel();
        const groupSet = new Set(group);
        setSelectedFaceIds(prev => prev.filter(f => !groupSet.has(f as FaceId)));
      }
      return;
    }

    setSelectedId(null);
    setSelectedIds([]);

    if (event.shiftKey) {
      // Shift-click adds or removes exactly the clicked face, group logic
      // aside -- a user building a custom multi-face selection is choosing
      // deliberately, face by face.
      setSelectedFaceIds(prev =>
        prev.includes(faceId) ? prev.filter(f => f !== faceId) : [...prev, faceId],
      );
      lastKernelClickRef.current = null;
      return;
    }

    const now = Date.now();
    const last = lastKernelClickRef.current;
    const isDoubleClick = !!last && last.faceId === faceId && now - last.time < DOUBLE_CLICK_MS;

    if (isDoubleClick) {
      // Second click on the SAME face: drill down to just that surface.
      setSelectedFaceIds([faceId]);
      lastKernelClickRef.current = null;
    } else {
      // A plain click selects the whole connected object -- pushing/pulling
      // a rectangle into a box and then clicking one wall should select the
      // box, not one of its six faces; that is what most users mean by
      // "click on it." Drilling into one face is what double-click is for.
      setSelectedFaceIds(groupContaining(kernelHost.graph, faceId));
      lastKernelClickRef.current = { faceId, time: now };
    }
  }, [activeTool, activeMaterial, activeSurfaceDepth, kernelSelectedSet, kernelHost, bumpKernel, setSelectedFaceIds, setSelectedId, setSelectedIds]);

  // ---- Move/scale/rotate for a kernel face-group selection ----
  //
  // The existing TransformControls wiring above drives exactly one Shape's
  // position/quaternion/scale and writes the result back on release --
  /**
   * Shrinks a Box3 slightly on every axis, without ever flipping it
   * inside-out — which a flat `expandByScalar(-N)` genuinely does the
   * instant an axis's own size is less than 2*N. Confirmed directly:
   * a kernel face (a flat, 2D polygon with literally zero thickness
   * along its own normal) fed straight into
   * `box.expandByScalar(-0.02)` comes back with that axis's min
   * greater than its max — box3.isEmpty() correctly reports that as
   * empty, and checkCollision's own early-return then treats it as
   * "never colliding," no matter how far the drag actually crosses
   * into another object. This was the entire reason friction silently
   * never fired for anything not yet given real volume via push/pull.
   */
  const safeShrinkBox3 = (box: THREE.Box3, amount: number): THREE.Box3 => {
    const size = new THREE.Vector3();
    box.getSize(size);
    const shrinkX = Math.min(amount, size.x * 0.49);
    const shrinkY = Math.min(amount, size.y * 0.49);
    const shrinkZ = Math.min(amount, size.z * 0.49);
    box.min.x += shrinkX; box.max.x -= shrinkX;
    box.min.y += shrinkY; box.max.y -= shrinkY;
    box.min.z += shrinkZ; box.max.z -= shrinkZ;
    return box;
  };

  /**
   * Ensures a Box3 has at least `minSize` thickness on every axis,
   * expanding symmetrically around its own center wherever it's
   * currently thinner than that. Needed for a second, separate reason
   * friction never fired for flat objects (a rectangle lying flat on
   * the ground, or any single, un-extruded kernel face): confirmed
   * directly by logging both boxes live during an actual drag that
   * moving an object that's resting exactly on Y=0 can drift its own Y
   * by a tiny, entirely invisible amount (thousandths of a unit) from
   * the drag/raycasting math itself — and when the OTHER object is
   * also flat and sitting at exactly Y=0, that drift alone is enough
   * to make their zero-thickness Y-ranges never overlap at all, even
   * while the two objects visibly, fully overlap on screen from the
   * camera's own perspective. Giving both boxes a small minimum
   * thickness before the intersection test absorbs that drift without
   * meaningfully loosening the check for objects that already have
   * real volume.
   */
  const ensureMinThickness = (box: THREE.Box3, minSize: number): THREE.Box3 => {
    const size = new THREE.Vector3();
    box.getSize(size);
    if (size.x < minSize) { const pad = (minSize - size.x) / 2; box.min.x -= pad; box.max.x += pad; }
    if (size.y < minSize) { const pad = (minSize - size.y) / 2; box.min.y -= pad; box.max.y += pad; }
    if (size.z < minSize) { const pad = (minSize - size.z) / 2; box.min.z -= pad; box.max.z += pad; }
    return box;
  };

  const checkCollision = useCallback((id: string, target: THREE.Object3D | THREE.Box3) => {
    let box: THREE.Box3;
    if (target instanceof THREE.Box3) {
      box = target.clone();
    } else {
      target.updateWorldMatrix(true, true);
      box = new THREE.Box3().setFromObject(target);
    }
    if (box.isEmpty()) return false;
    // Shrink slightly to avoid grazing contacts triggering false positives
    const testBox = ensureMinThickness(safeShrinkBox3(box.clone(), 0.005), 0.1);

    let collided = false;
    scene.traverse(child => {
      if (collided) return;
      // Skip the target object and any of its hierarchy
      let curr: THREE.Object3D | null = child;
      let isSelf = false;
      while (curr) {
        if (curr.userData?.id === id || (target instanceof THREE.Object3D && curr === target)) {
          isSelf = true;
          break;
        }
        curr = curr.parent;
      }
      if (isSelf) return;

      // Check if child is a valid visible scene shape, group or mesh
      if (child instanceof THREE.Mesh && child.geometry) {
        // NOTE: all kernel faces render as ONE combined mesh with no
        // per-face userData.id, so a kernel-vs-kernel caller can never
        // use this to distinguish "this other specific kernel face"
        // from "every kernel face in the scene, including the one
        // being dragged" — a known, still-open limitation (see the
        // note at handleGroupTransformChange's own isColliding line).
        // Shape objects DO have their own real, individual
        // userData.id, so Shape-vs-anything collision below is fully
        // reliable regardless.
        const isShape = child.userData?.isShape || child.userData?.isKernelGeometry || child.userData?.id || (child.parent && child.parent.userData?.isShape);
        if (isShape) {
          child.updateWorldMatrix(true, false);
          const otherBox = ensureMinThickness(new THREE.Box3().setFromObject(child), 0.1);
          if (!otherBox.isEmpty() && testBox.intersectsBox(otherBox)) {
            collided = true;
          }
        }
      }
    });
    return collided;
  }, [scene]);

  const getSceneObjectById = useCallback((id: string | null) => {
    if (!id) return null;
    let found: THREE.Object3D | null = null;
    scene.traverse(obj => {
      if (obj.userData?.id === id) found = obj;
    });
    return found;
  }, [scene]);

  // there is no way to hand it "these six faces" and have it mean anything
  // (grouptransform.ts's own doc comment goes into why). This attaches the
  // SAME gizmo to an invisible dummy pivot object instead, and translates
  // its movement into calls on the group-transform binding, which applies
  // the result to the kernel graph on release.
  const groupPivotRef = useRef<THREE.Object3D>(null);
  const [groupPivotReady, setGroupPivotReady] = useState(false);
  const groupTransformActiveRef = useRef(false);
  const groupTransformStartRef = useRef<{ x: number; y: number; z: number } | null>(null);
  // Populated at drag-begin from the actual selected kernel faces' own
  // bounds — needed because the group-transform gizmo is attached to an
  // invisible, geometry-less dummy pivot object, so a Box3 built
  // directly from that pivot is always empty and can never register a
  // collision (confirmed directly: Box3().setFromObject on a bare
  // Object3D with no geometry/children returns isEmpty()===true, every
  // time, regardless of where the pivot actually is). That emptiness is
  // the entire reason friction silently never triggered for kernel
  // shapes — the collision check was structurally correct but always
  // had nothing real to test against.
  const groupTransformStartBoundsRef = useRef<{ min: THREE.Vector3; max: THREE.Vector3 } | null>(null);
  const groupTransformBindingRef = useRef(createGroupTransformBinding(kernelHost, bumpKernel));
  const [groupTransformPreview, setGroupTransformPreview] = useState<
    { faces: FaceId[]; matrix: Mat4 } | null
  >(null);

  // Keeps the dummy pivot synced to the selection's current bounds center
  // whenever the model or selection changes -- but never mid-drag, where
  // fighting TransformControls would fling the gizmo out from under the
  // user's cursor.
  useEffect(() => {
    if (groupTransformActiveRef.current) return;
    if (kernelSelectedSet.size === 0 || !groupPivotRef.current) return;
    const b = boundsOfFaces(kernelHost.graph, [...kernelSelectedSet]);
    if (!b) return;
    groupPivotRef.current.position.set(b.center.x, b.center.y, b.center.z);
    groupPivotRef.current.quaternion.identity();
    groupPivotRef.current.scale.set(1, 1, 1);
  }, [kernelSelectedSet, kernelRevision, kernelHost]);

  const handleGroupTransformBegin = useCallback(() => {
    if (kernelSelectedSet.size === 0 || !groupPivotRef.current) return;
    groupTransformActiveRef.current = true;
    groupTransformStartRef.current = {
      x: groupPivotRef.current.position.x,
      y: groupPivotRef.current.position.y,
      z: groupPivotRef.current.position.z,
    };
    const bounds = boundsOfFaces(kernelHost.graph, [...kernelSelectedSet]);
    groupTransformStartBoundsRef.current = bounds
      ? {
          min: new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.min.z),
          max: new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
        }
      : null;
    groupTransformBindingRef.current.begin([...kernelSelectedSet]);
  }, [kernelSelectedSet, kernelHost]);

  const handleGroupTransformChange = useCallback(() => {
    const pivot = groupPivotRef.current;
    const binding = groupTransformBindingRef.current;
    if (!pivot || !binding.active) return;

    if (activeTool === 'move') {
      const start = groupTransformStartRef.current;
      if (!start) return;

      if (contactFrictionEnabled) {
        const now = Date.now();
        if (now < frictionPausedUntilRef.current) {
          if (lastValidPosRef.current) {
            pivot.position.copy(lastValidPosRef.current);
          }
          return;
        }

        // FIX: was `new THREE.Box3().setFromObject(pivot)` — pivot is
        // the invisible, geometry-less dummy Object3D the gizmo is
        // attached to (see groupTransformStartBoundsRef's own doc
        // comment above for why), so that box was always empty and
        // never registered a collision, no matter how far the drag
        // actually crossed into another object. Building the box from
        // the real, original kernel-face bounds and offsetting it by
        // however far the pivot has actually moved gives a real,
        // non-empty box that represents where the selected geometry
        // would truly end up.
        const startBounds = groupTransformStartBoundsRef.current;
        const start = groupTransformStartRef.current;
        let pivotBox: THREE.Box3;
        if (startBounds && start) {
          const dx = pivot.position.x - start.x;
          const dy = pivot.position.y - start.y;
          const dz = pivot.position.z - start.z;
          pivotBox = new THREE.Box3(
            startBounds.min.clone().add(new THREE.Vector3(dx, dy, dz)),
            startBounds.max.clone().add(new THREE.Vector3(dx, dy, dz)),
          );
        } else {
          pivotBox = new THREE.Box3().setFromObject(pivot);
        }
        safeShrinkBox3(pivotBox, 0.02);
        // Guard against the false-positive this fix would otherwise
        // introduce: the ORIGINAL kernel faces stay fully rendered at
        // their un-moved position throughout the whole drag (confirmed
        // directly — KernelGeometry only adds a highlight overlay for
        // selectedFaces, it never hides or fades the real geometry).
        // Early in a drag, the translated pivotBox above can still
        // overlap that original footprint, which checkCollision has no
        // way to tell apart from a genuine external collision, since
        // it isn't a distinct scene object with its own userData.id to
        // skip. Treating "still overlapping where this same group
        // started" as not-a-collision avoids that false trigger, at
        // the cost of not detecting a real collision with some other
        // object that happens to already be touching the start
        // position — an acceptable trade against firing friction on
        // literally every group move attempt.
        const startBoxForOverlapGuard = startBounds
          ? new THREE.Box3(startBounds.min.clone(), startBounds.max.clone())
          : null;
        const stillOverlapsOwnStart = !!startBoxForOverlapGuard && startBoxForOverlapGuard.intersectsBox(pivotBox);
        // NOTE: a dedicated kernel-vs-kernel bounds check (comparing
        // against specifically the non-selected faces) was attempted
        // here and reverted — verified directly that it produced a
        // worse regression than the plain check below: it read as
        // colliding on every single frame of the drag, immediately
        // freezing movement entirely. The actual cause needs its own
        // investigation (how kernel faces group into the graph
        // wasn't what this fix assumed), so this still shares the
        // known, pre-existing limitation that a combined kernel mesh
        // with no per-face id can't distinguish "hit another kernel
        // object" from "hit myself, still in the scene" — a real
        // Shape-vs-kernel or Shape-vs-Shape collision, though, IS
        // reliably detected below, since Shape objects do have their
        // own real, individual userData.id.
        const isColliding = !stillOverlapsOwnStart && checkCollision('kernel-group-transform', pivotBox);
        if (isColliding && !hasReachedFrictionRef.current) {
          hasReachedFrictionRef.current = true;
          const pauseMs = Math.round(60 + ((contactFrictionStrength ?? 50) / 100) * 440);
          frictionPausedUntilRef.current = now + pauseMs;
          if (lastValidPosRef.current) {
            pivot.position.copy(lastValidPosRef.current);
          }
          return;
        }
        if (!isColliding) {
          hasReachedFrictionRef.current = false;
        }
        lastValidPosRef.current = pivot.position.clone();
      }

      binding.updateTranslate({
        x: pivot.position.x - start.x,
        y: pivot.position.y - start.y,
        z: pivot.position.z - start.z,
      });
    } else if (activeTool === 'scale') {
      // The pivot's scale was reset to (1,1,1) at begin, so its current
      // scale IS this drag's factor.
      binding.updateScale({ x: pivot.scale.x, y: pivot.scale.y, z: pivot.scale.z });
    } else if (activeTool === 'rotate') {
      // The pivot's rotation was reset to identity at begin, so its current
      // quaternion IS this drag's rotation. Extracted to axis+angle since
      // that is what rotateFaces expects.
      const q = pivot.quaternion;
      const w = Math.min(1, Math.max(-1, q.w));
      const angle = 2 * Math.acos(w);
      const s = Math.sqrt(1 - w * w);
      const axis = s < 1e-6 ? { x: 1, y: 0, z: 0 } : { x: q.x / s, y: q.y / s, z: q.z / s };
      binding.updateRotate(axis, angle);
    }

    const session = binding.session;
    if (session) setGroupTransformPreview({ faces: session.faces, matrix: session.matrix });
  }, [activeTool, contactFrictionEnabled, contactFrictionStrength, checkCollision]);

  const handleGroupTransformEnd = useCallback(() => {
    groupTransformActiveRef.current = false;
    if (groupTransformBindingRef.current.commit()) offerGroupTransformAdjust();
    setGroupTransformPreview(null);
  }, []);

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
  // A guide being pulled off an edge, guide or axis (see tools/tapeGuides.ts): the line it's
  // parallel to, and how far off it the pointer has moved it.
  const [tapeGuide, setTapeGuide] = useState<{ linePoint: THREE.Vector3; dir: THREE.Vector3; offset: THREE.Vector3; label: string } | null>(null);
  // The edge a click would pull a guide off, highlighted under the pointer.
  const [tapeHover, setTapeHover] = useState<GuideSource | null>(null);
  // Guides the drawing tools snap to, and where they cross.
  const guideSegments = useMemo(
    () => (guidesVisible ? shapes.filter(s => !s.hidden).map(guideSegment).filter((g): g is [THREE.Vector3, THREE.Vector3] => g !== null) : []),
    [shapes, guidesVisible],
  );
  const guideCrossingPoints = useMemo(() => guideCrossings(guideSegments), [guideSegments]);
  const [lastMeasurement, setLastMeasurement] = useState<{ start: [number, number, number]; end: [number, number, number]; distance: number } | null>(null);
  const [offsetPreviewPoints, setOffsetPreviewPoints] = useState<THREE.Vector3[] | null>(null);
  const [offsetPreviewDistance, setOffsetPreviewDistance] = useState<number>(0);
  const [offsetFaceKey, setOffsetFaceKey] = useState<number | null>(null);
  
  const frictionPausedUntilRef = useRef<number>(0);
  const sunAnimRef = useRef<{ radius: number; angle: number } | null>(null);
  const pointerUpHandledRef = useRef<boolean>(false);
  const hasReachedFrictionRef = useRef<boolean>(false);
  const lastValidPosRef = useRef<THREE.Vector3 | null>(null);
  const blockLastValidDraftRef = useRef<{ position: [number, number, number]; rotationSteps: number } | null>(null);

  /**
   * Fillet/chamfer/offset/push-pull drags attach their pointermove/pointerup
   * listeners to `window` (see handleKernelFacePointerDown below) so the
   * drag tracks correctly even once the cursor leaves the canvas. Each
   * drag's own `finish()` removes them on a normal pointerup, but nothing
   * previously ran that cleanup if this component unmounted mid-drag
   * (switching views, an error boundary trip) — the listener, and every
   * closure it holds over kernel/session state, would leak indefinitely.
   * Each drag registers its own removal function here and unregisters it
   * from inside `finish()`; this effect's cleanup catches whatever is still
   * outstanding on unmount.
   */
  const activeDragCleanupsRef = useRef<Set<() => void>>(new Set());
  useEffect(() => {
    const cleanups = activeDragCleanupsRef.current;
    return () => {
      cleanups.forEach((fn) => fn());
      cleanups.clear();
    };
  }, []);

  /**
   * Push/pull starts on PRESS, not click.
   *
   * onClick fires on release, so beginning there started the drag after the
   * gesture had already ended: the face never moved, and the session stayed
   * open until some later pointer-up committed it against a stale distance.
   * That is the "nothing happens, then a later action resolves it".
   *
   * The completing pointer-up is bound to the WINDOW, because a drag that
   * starts on a face is routinely released somewhere else — a handler on the
   * face itself would simply never fire.
   */
  /**
   * The kernel-solid equivalent of performCSGOperation above — subtracts
   * one kernel group (the cutter) from another (the target), matching
   * that function's own scope exactly rather than attempting a true
   * B-rep boolean: kernel faces are tessellated into ordinary triangle
   * geometry (via the same tessellateFace/mergeBuffers pipeline
   * KernelGeometry.tsx already uses to render them), then run through
   * the SAME three-bvh-csg Evaluator/Brush/SUBTRACTION as the Shape-based
   * tool — so the result has the identical capabilities and limitations
   * the old tool already has, just for kernel geometry instead of Shape
   * meshes.
   *
   * The result, like the old tool's own, is NOT a kernel solid — it
   * becomes a plain 'custom' Shape holding the resulting static mesh.
   * There is no way to feed a boolean result back into the B-rep kernel
   * as an editable solid without a genuine B-rep boolean algorithm (face
   * splitting, intersection curves, re-stitching) — a substantially
   * larger undertaking than matching the old tool's own scope, which is
   * exactly what was asked for here.
   *
   * Both the target's and the cutter's own kernel faces/edges are
   * deleted from the graph — the cutter is "consumed" by the operation,
   * matching removeShape(cutterId) in the Shape-based version above.
   */
  const performKernelCSGSubtraction = (targetFaces: FaceId[], cutterFaces: FaceId[]) => {
    console.log(`[CSG] Starting kernel subtraction: target=${targetFaces.length} faces, cutter=${cutterFaces.length} faces`);
    try {
      const buildBrush = (faceIds: FaceId[]) => {
        const meshes = faceIds
          .map((id) => tessellateFace(kernelHost.graph, id))
          .filter((m): m is NonNullable<typeof m> => m !== null);
        if (meshes.length === 0) return null;
        const merged = mergeBuffers(meshes);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(merged.position, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(merged.normal, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(merged.uv, 2));
        geo.setIndex(new THREE.BufferAttribute(merged.index, 1));
        // Kernel face positions are already world-space (§6.3, same as
        // KernelGeometry.tsx's own rendering) — no transform needed, both
        // brushes are built directly at identity.
        return new Brush(mergeVertices(geo));
      };

      const targetBrush = buildBrush(targetFaces);
      const cutterBrush = buildBrush(cutterFaces);
      if (!targetBrush || !cutterBrush) {
        setConsoleOutput(prev => [...prev, `[ERROR] Kernel CSG failed: could not tessellate target or cutter.`]);
        return;
      }
      targetBrush.updateMatrixWorld();
      cutterBrush.updateMatrixWorld();

      const evaluator = new Evaluator();
      const resultBrush = evaluator.evaluate(targetBrush, cutterBrush, SUBTRACTION);
      // Same fix, same reasoning, as performCSGOperation's identical
      // step above — see that function's own doc comment for the full
      // explanation of why this is needed at all (the raw CSG result's
      // triangles don't share vertices/normals the way one flat face
      // normally does, so every internal triangulation seam renders as
      // a visible edge line without this).
      resultBrush.geometry = mergeVertices(resultBrush.geometry);
      // See healTJunctions's own doc comment for the actual root cause
      // of the persistent "extra edge lines" reports — this must run
      // BEFORE removeDegenerateCSGTriangles below, since it's the one
      // that actually resolves the reported artifact; the degenerate-
      // triangle cleanup addresses a separate, smaller one.
      healTJunctions(resultBrush.geometry);
      // See removeDegenerateCSGTriangles's own doc comment above — a
      // separate artifact from the seam issue just above: degenerate,
      // zero-area triangles in the raw CSG result render as a fan of
      // real, visible sliver-edge lines converging on one point.
      removeDegenerateCSGTriangles(resultBrush.geometry);
      resultBrush.geometry.computeVertexNormals();
      const geometryData = resultBrush.geometry.toJSON();

      const before = snapshot(kernelHost.graph);
      deleteGroupFacesAndEdges(kernelHost.graph, [...targetFaces, ...cutterFaces]);
      kernelHost.recordUndo(before);
      bumpKernel();

      const newShape: Shape = {
        id: Math.random().toString(36).substr(2, 9),
        name: 'CSG Result',
        type: 'custom',
        position: [0, 0, 0],
        quaternion: [0, 0, 0, 1],
        scale: [1, 1, 1],
        color: activeMaterial,
        args: [],
        geometryData,
      };
      addShape(newShape);
      commitHistory();

      setConsoleOutput(prev => [...prev, `[SUCCESS] Kernel CSG Subtraction completed.`]);
      recordAction(actionLabel("Subtract (drawn geometry)"));
    } catch (error: any) {
      console.error("[CSG] Kernel operation failed:", error);
      setConsoleOutput(prev => [...prev, `[ERROR] Kernel CSG Operation failed: ${error.message}`]);
    }
  };

  /**
   * Subtracts a kernel solid and a Shape mesh from one another, in
   * either direction — the case neither performCSGOperation (Shape↔
   * Shape only) nor performKernelCSGSubtraction (kernel↔kernel only)
   * can handle.
   *
   * Root cause this exists to fix: the subtract tool tracks a Shape
   * target via subtractTargetId and a kernel target via
   * kernelSubtractTarget — two entirely separate pieces of state that
   * never communicated. Clicking a Shape then a kernel solid (or vice
   * versa) armed one variable's own target while the other click's own
   * logic checked a DIFFERENT variable, still empty — so neither side
   * ever saw a complete target+cutter pair, and the subtract silently
   * never fired. This function is the actual subtraction logic for
   * that mixed case; the two click handlers now detect a mismatched
   * pair and route here instead of leaving both variables "half-armed"
   * forever.
   *
   * A Shape-kind target keeps the result anchored in that Shape's own
   * local space (position/quaternion/scale preserved, matching
   * performCSGOperation's own behavior) — a kernel-kind target keeps
   * the result at world-space identity (matching
   * performKernelCSGSubtraction's own behavior), since kernel geometry
   * has no separate local transform of its own to preserve.
   */
  const performMixedCSGSubtraction = (
    target: { kind: 'shape'; id: string } | { kind: 'kernel'; faces: FaceId[] },
    cutter: { kind: 'shape'; id: string } | { kind: 'kernel'; faces: FaceId[] },
  ) => {
    console.log(`[CSG] Starting mixed subtraction: target=${target.kind}, cutter=${cutter.kind}`);
    try {
      const buildKernelBrush = (faces: FaceId[]): THREE.BufferGeometry | null => {
        const meshes = faces
          .map((id) => tessellateFace(kernelHost.graph, id))
          .filter((m): m is NonNullable<typeof m> => m !== null);
        if (meshes.length === 0) return null;
        const merged = mergeBuffers(meshes);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(merged.position, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(merged.normal, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(merged.uv, 2));
        geo.setIndex(new THREE.BufferAttribute(merged.index, 1));
        return geo; // already world-space, identity transform
      };

      let targetBrush: Brush;
      let resultTransform: { position: [number, number, number]; quaternion: [number, number, number, number]; scale: [number, number, number] };
      let targetShapeMesh: THREE.Mesh | null = null;

      if (target.kind === 'shape') {
        const mesh = getSceneObjectById(target.id) as THREE.Mesh;
        if (!mesh) {
          setConsoleOutput(prev => [...prev, `[ERROR] Mixed CSG failed: target Shape not found.`]);
          return;
        }
        targetShapeMesh = mesh;
        mesh.updateMatrixWorld(true);
        targetBrush = new Brush(mergeVertices(mesh.geometry.clone()), mesh.material);
        targetBrush.updateMatrixWorld();
        resultTransform = {
          position: [mesh.position.x, mesh.position.y, mesh.position.z],
          quaternion: [mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w],
          scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z],
        };
      } else {
        const geo = buildKernelBrush(target.faces);
        if (!geo) {
          setConsoleOutput(prev => [...prev, `[ERROR] Mixed CSG failed: could not tessellate kernel target.`]);
          return;
        }
        targetBrush = new Brush(mergeVertices(geo));
        targetBrush.updateMatrixWorld();
        resultTransform = { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] };
      }

      let cutterBrush: Brush;
      if (cutter.kind === 'shape') {
        const mesh = getSceneObjectById(cutter.id) as THREE.Mesh;
        if (!mesh) {
          setConsoleOutput(prev => [...prev, `[ERROR] Mixed CSG failed: cutter Shape not found.`]);
          return;
        }
        mesh.updateMatrixWorld(true);
        cutterBrush = new Brush(mergeVertices(mesh.geometry.clone()), mesh.material);
        if (target.kind === 'shape' && targetShapeMesh) {
          // Cutter must land in the SAME local space the result will be
          // kept in — the target Shape's own local space.
          const targetInv = targetShapeMesh.matrixWorld.clone().invert();
          const cutterInTargetSpace = mesh.matrixWorld.clone().premultiply(targetInv);
          cutterBrush.applyMatrix4(cutterInTargetSpace);
        } else {
          // Kernel target lives at world-space identity, so the cutter
          // needs its own full world transform applied directly.
          cutterBrush.applyMatrix4(mesh.matrixWorld);
        }
        cutterBrush.updateMatrixWorld();
      } else {
        const geo = buildKernelBrush(cutter.faces);
        if (!geo) {
          setConsoleOutput(prev => [...prev, `[ERROR] Mixed CSG failed: could not tessellate kernel cutter.`]);
          return;
        }
        cutterBrush = new Brush(mergeVertices(geo));
        if (target.kind === 'shape' && targetShapeMesh) {
          // Kernel cutter is world-space; transform it INTO the Shape
          // target's own local space, same reasoning as the Shape-cutter
          // branch above, just the source space is already-world instead
          // of needing its own matrixWorld first.
          const targetInv = targetShapeMesh.matrixWorld.clone().invert();
          cutterBrush.applyMatrix4(targetInv);
        }
        // Kernel target + kernel cutter is handled by
        // performKernelCSGSubtraction, never reaches here — no further
        // transform needed for a kernel target's own identity space.
        cutterBrush.updateMatrixWorld();
      }

      const evaluator = new Evaluator();
      const resultBrush = evaluator.evaluate(targetBrush, cutterBrush, SUBTRACTION);
      // Same three-step cleanup pipeline as both same-kind subtract
      // functions — see healTJunctions's and removeDegenerateCSGTriangles's
      // own doc comments for the full reasoning behind each step.
      resultBrush.geometry = mergeVertices(resultBrush.geometry);
      healTJunctions(resultBrush.geometry);
      removeDegenerateCSGTriangles(resultBrush.geometry);
      resultBrush.geometry.computeVertexNormals();
      const geometryData = resultBrush.geometry.toJSON();

      // Remove whichever side(s) were kernel geometry, in one undo step.
      const kernelFacesToRemove: FaceId[] = [
        ...(target.kind === 'kernel' ? target.faces : []),
        ...(cutter.kind === 'kernel' ? cutter.faces : []),
      ];
      if (kernelFacesToRemove.length > 0) {
        const before = snapshot(kernelHost.graph);
        deleteGroupFacesAndEdges(kernelHost.graph, kernelFacesToRemove);
        kernelHost.recordUndo(before);
        bumpKernel();
      }

      if (target.kind === 'shape') {
        setShapes(prev => prev.map(s => s.id === target.id ? {
          ...s,
          type: 'custom',
          ...resultTransform,
          geometryData,
        } : s));
      } else {
        const newShape: Shape = {
          id: Math.random().toString(36).substr(2, 9),
          name: 'CSG Result',
          type: 'custom',
          ...resultTransform,
          color: activeMaterial,
          args: [],
          geometryData,
        };
        addShape(newShape);
      }
      if (cutter.kind === 'shape') {
        removeShape(cutter.id);
      }
      commitHistory();

      setConsoleOutput(prev => [...prev, `[SUCCESS] Mixed CSG Subtraction completed.`]);
      recordAction(actionLabel("Subtract (drawn geometry and objects)"));
    } catch (error: any) {
      console.error("[CSG] Mixed operation failed:", error);
      setConsoleOutput(prev => [...prev, `[ERROR] Mixed CSG Operation failed: ${error.message}`]);
    }
  };

  /**
   * Combine tool with 3D objects: merges, subtracts or intersects them in click order (the
   * first leads: Subtract cuts every later one out of it, and the result takes its place,
   * material and transform). Kernel solids and Shapes mix freely. One undo step.
   */
  const performSolidCombine = (picks: CombineSolid[], op: BooleanOp): boolean => {
    try {
      const kernelGeometry = (faces: FaceId[]): THREE.BufferGeometry | null => {
        const meshes = faces.map(id => tessellateFace(kernelHost.graph, id)).filter((m): m is NonNullable<typeof m> => m !== null);
        if (!meshes.length) return null;
        const merged = mergeBuffers(meshes);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(merged.position, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(merged.normal, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(merged.uv, 2));
        geo.setIndex(new THREE.BufferAttribute(merged.index, 1));
        return geo; // world space
      };
      const [lead, ...rest] = picks;
      if (!lead || !rest.length) return false;
      // The result lives in the lead's space: a Shape's own local space, or world space for kernel geometry.
      let leadMesh: THREE.Mesh | null = null;
      let result: Brush;
      if (lead.kind === 'shape') {
        leadMesh = getSceneObjectById(lead.id) as THREE.Mesh;
        if (!leadMesh?.geometry) { setMeasurements('Combine: the first object could not be found.'); return false; }
        leadMesh.updateMatrixWorld(true);
        result = new Brush(mergeVertices(leadMesh.geometry.clone()), leadMesh.material);
      } else {
        const geo = kernelGeometry(lead.faces);
        if (!geo) { setMeasurements('Combine: the first shape could not be read.'); return false; }
        result = new Brush(mergeVertices(geo));
      }
      result.updateMatrixWorld();
      const toLead = leadMesh ? leadMesh.matrixWorld.clone().invert() : new THREE.Matrix4();
      const evaluator = new Evaluator();
      const operation = op === 'merge' ? ADDITION : op === 'intersect' ? INTERSECTION : SUBTRACTION;
      for (const pick of rest) {
        let brush: Brush;
        if (pick.kind === 'shape') {
          const mesh = getSceneObjectById(pick.id) as THREE.Mesh;
          if (!mesh?.geometry) { setMeasurements('Combine: one of the objects could not be found.'); return false; }
          mesh.updateMatrixWorld(true);
          brush = new Brush(mergeVertices(mesh.geometry.clone()), mesh.material);
          brush.applyMatrix4(mesh.matrixWorld.clone().premultiply(toLead));
        } else {
          const geo = kernelGeometry(pick.faces);
          if (!geo) { setMeasurements('Combine: one of the shapes could not be read.'); return false; }
          brush = new Brush(mergeVertices(geo));
          brush.applyMatrix4(toLead);
        }
        brush.updateMatrixWorld();
        result = evaluator.evaluate(result, brush, operation);
        result.updateMatrixWorld();
      }
      result.geometry = mergeVertices(result.geometry);
      healTJunctions(result.geometry);
      removeDegenerateCSGTriangles(result.geometry);
      result.geometry.computeVertexNormals();
      if (!result.geometry.getAttribute('position')?.count) {
        setMeasurements(op === 'intersect' ? 'Intersect: those objects do not all overlap, so nothing would be left.' : 'Combine: nothing would be left.');
        return false;
      }
      const geometryData = result.geometry.toJSON();

      const kernelFaces = picks.flatMap(p => p.kind === 'kernel' ? p.faces : []);
      if (kernelFaces.length) {
        const before = snapshot(kernelHost.graph);
        deleteGroupFacesAndEdges(kernelHost.graph, kernelFaces);
        kernelHost.recordUndo(before);
        bumpKernel();
      }
      const others = new Set(rest.flatMap(p => p.kind === 'shape' ? [p.id] : []));
      let resultId: string;
      if (lead.kind === 'shape' && leadMesh) {
        resultId = lead.id;
        const m = leadMesh;
        setShapes(prev => prev.filter(s => !others.has(s.id)).map(s => s.id === lead.id ? {
          ...s, type: 'custom',
          position: [m.position.x, m.position.y, m.position.z],
          quaternion: [m.quaternion.x, m.quaternion.y, m.quaternion.z, m.quaternion.w],
          scale: [m.scale.x, m.scale.y, m.scale.z],
          geometryData,
        } : s));
      } else {
        resultId = Math.random().toString(36).substr(2, 9);
        const newShape: Shape = {
          id: resultId, name: `${BOOLEAN_LABELS[op]} Result`, type: 'custom',
          position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1],
          color: kernelHost.graph.faces.size >= 0 ? activeMaterial : activeMaterial, args: [], geometryData,
        };
        setShapes(prev => [...prev.filter(s => !others.has(s.id)), newShape]);
      }
      commitHistory();
      setSelectedIds([resultId]);
      setMeasurements(`${BOOLEAN_LABELS[op]}: done.`);
      recordAction(`// Combine (${op}) of ${picks.length} objects`);
      return true;
    } catch (error: any) {
      console.error('[CSG] Combine failed:', error);
      setMeasurements(`Combine failed: ${error?.message ?? error}`);
      return false;
    }
  };

  const performSolidCombineRef = useRef(performSolidCombine);
  performSolidCombineRef.current = performSolidCombine;
  useEffect(() => {
    const onCombine = (e: Event) => {
      const { picks, op } = (e as CustomEvent<{ picks: CombineSolid[]; op: BooleanOp }>).detail;
      if (performSolidCombineRef.current(picks, op)) setCombinePicks([]);
    };
    window.addEventListener(COMBINE_SOLIDS_EVENT, onCombine);
    return () => window.removeEventListener(COMBINE_SOLIDS_EVENT, onCombine);
  }, []);

  const handleKernelFacePointerDown = useCallback((faceId: FaceId, event: { point?: THREE.Vector3 }) => {
    // Return value tells KernelGeometry whether to stop propagation. Only
    // push/pull claims the press; every other tool needs it to keep
    // travelling down to the invisible ground plane where drawing-tool
    // starts (rectangle, circle, line, triangle...) are actually handled —
    // stopping unconditionally here was why none of them could start on a
    // kernel wall at all.
    //
    // The whole body is wrapped in try/catch deliberately: this fires from
    // R3F's own pointer-event dispatch on a <mesh>, not a regular React DOM
    // event — and React's error boundaries only ever catch errors thrown
    // during RENDER, never inside an event handler. An uncaught throw here
    // would previously propagate straight out with nothing to catch it,
    // which is consistent with a "white screen" report having no visible
    // fallback UI at all. Whatever the underlying cause turns out to be,
    // this ensures a future one can never take down the whole app the same
    // way — it surfaces as a toast instead.
    try {
    if (pickingSunCenter) {
      // Same reasoning as the identical check in handleMeshPointerDown —
      // this covers a click landing on KERNEL geometry instead, a
      // separate click path from a Shape mesh's onPointerDown.
      if (!event.point) return false;
      pickSunCenter(event.point);
      return true;
    }
    if (activeTool === 'arealabel') {
      if (!event.point) return false;
      const measured = measureFace(kernelHost.graph, faceId);
      if (!measured) { setMeasurements('Could not measure that face.'); return true; }
      const face = kernelHost.graph.faces.get(faceId);
      const n = face?.plane.normal;
      const lift = 0.05;
      const anchor: [number, number, number] = [event.point.x, event.point.y, event.point.z];
      const args: AreaLabelArgs = {
        kind: 'area', faceId, anchor,
        position: n ? [anchor[0] + n.x * lift, anchor[1] + n.y * lift, anchor[2] + n.z * lift] : anchor,
        area: measured.area, perimeter: measured.perimeter,
      };
      addShape({ id: Math.random().toString(36).substr(2, 9), name: 'Area label', type: 'measurement', position: anchor, args, color: '#10b981' } as Shape);
      setMeasurements(`Area ${measured.area.toFixed(2)} m². The label updates if the face changes.`);
      return true;
    }
    if (activeTool === 'note') {
      // Mirrors the identical Shape-mesh case in handleMeshPointerDown —
      // this one covers a click landing on KERNEL geometry instead, which
      // is a completely separate click path (KernelGeometry's own
      // onFacePointerDown, not a Shape mesh's onPointerDown). Without
      // this, placing a note on kernel-derived geometry (anything drawn
      // then pushed/pulled) silently did nothing at all: the click never
      // reached the Shape-only code that used to be the only place this
      // tool was handled.
      if (!event.point) return false;
      setPlacingNotePos(event.point.clone());
      return true;
    }
    if (activeTool === 'text' || activeTool === 'text3d') {
      const face = kernelHost.graph.faces.get(faceId);
      if (!event.point || !face) return false;
      startTextPlacement(event.point.clone(), new THREE.Vector3(face.plane.normal.x, face.plane.normal.y, face.plane.normal.z));
      return true;
    }

    if (activeTool === 'subtract') {
      // Same click-target-then-click-cutter flow as the Shape-based
      // version in handleMeshPointerDown, just resolving to a whole
      // kernel solid (via groupContaining) rather than a single Shape —
      // see performKernelCSGSubtraction's own doc comment for how the
      // actual subtraction works. setSelectedFaceIds gives the armed
      // target the same highlight color KernelGeometry already uses for
      // an ordinary selection — the old tool's own red wireframe overlay
      // has no equivalent for kernel faces without changing
      // KernelGeometry's own props, but this reuses what's already there
      // to give the same "target is armed" feedback.
      const group = groupContaining(kernelHost.graph, faceId);
      if (subtractTargetId) {
        // A Shape was already armed as the target (via the Shape-mesh
        // click handler, further below) — this kernel-face click is the
        // cutter. See performMixedCSGSubtraction's own doc comment for
        // why this cross-check exists at all: without it, this click
        // would only ever check kernelSubtractTarget (still empty),
        // arming a completely separate, second "target" that nothing
        // ever paired against subtractTargetId.
        performMixedCSGSubtraction({ kind: 'shape', id: subtractTargetId }, { kind: 'kernel', faces: group });
        setSubtractTargetId(null);
        setKernelSubtractTarget(null);
        setSelectedFaceIds([]);
      } else if (!kernelSubtractTarget) {
        setKernelSubtractTarget(group);
        setSelectedFaceIds(group);
        setConsoleOutput(prev => [...prev, `[INFO] Target selected (kernel solid). Now select the cutter.`]);
      } else if (kernelSubtractTarget.includes(faceId)) {
        setKernelSubtractTarget(null);
        setSelectedFaceIds([]);
        setConsoleOutput(prev => [...prev, `[INFO] Target deselected.`]);
      } else {
        performKernelCSGSubtraction(kernelSubtractTarget, group);
        setKernelSubtractTarget(null);
        setSelectedFaceIds([]);
      }
      return true;
    }

    if (activeTool === 'bevel') {
      // Fillets or chamfers the whole solid the clicked face belongs to —
      // the same click-selects-the-group resolution used everywhere else,
      // since either operation is inherently whole-solid, not per-face.
      //
      // Drag sensitivity is scaled to the SOLID's own size, not a fixed
      // pixels-per-unit ratio — the old Shape-based bevel tool did the
      // same thing (its own `maxRadius / 300`, mentioned in this
      // function's earlier history). A fixed ratio meant a large model
      // needed an impractically long drag to reach a meaningful amount
      // relative to its own size.
      const groupBoundsHalfMinDimension = (faces: FaceId[]): number => {
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (const fid of faces) {
          const f = kernelHost.graph.faces.get(fid);
          if (!f) continue;
          for (const vid of loopVertexIds(kernelHost.graph, f.outerLoop)) {
            const p = getVertex(kernelHost.graph, vid).position;
            if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
            if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
          }
        }
        if (!isFinite(minX)) return 1;
        const dims = [maxX - minX, maxY - minY, maxZ - minZ].filter((d) => d > 1e-6);
        return dims.length > 0 ? Math.min(...dims) / 2 : 1;
      };

      if (activeBevelType === 'radius') {
        const group = groupContaining(kernelHost.graph, faceId);
        const begun = filletRef.current.begin(group);
        if (!begun.ok) {
          showToast(
            begun.reason
              ? `This surface can't be rounded: ${begun.reason}`
              : "This surface is not part of a solid that can be rounded.",
          );
          return false;
        }
        // The Radius Strength slider (activeBevelAmount) was previously
        // never read anywhere outside the settings panel that displays
        // it — confirmed directly, zero references to it in this file —
        // so it had no effect on the actual fillet at all, matching the
        // report that adjusting it changes nothing. Applying it here as
        // the starting amount means it takes effect immediately, even
        // before any drag happens; the drag below then adjusts UP or
        // DOWN from this baseline instead of always starting at 0.
        filletRef.current.update(activeBevelAmount);
        setChamferPreview({ faces: group, amount: activeBevelAmount });
        setMeasurements('Move the cursor to set the radius, then release.');
        const dragSensitivity = groupBoundsHalfMinDimension(group) / 300;

        let dragStartClientX = 0;
        let dragStarted = false;

        const onMove = (ev: PointerEvent) => {
          if (!dragStarted) {
            dragStartClientX = ev.clientX;
            dragStarted = true;
            return;
          }
          const deltaPx = ev.clientX - dragStartClientX;
          const amount = Math.max(0, activeBevelAmount + deltaPx * dragSensitivity);
          filletRef.current.update(amount);
          setMeasurements(`${formatValue(amount, unit, 2)} — release to confirm.`);
          // Reuses ChamferPreview's own wireframe-of-shrunk-faces
          // approach: filletSolid's face-shrinking step is IDENTICAL
          // math to chamferSolid's (both call the same 2D mitre inset),
          // so the same preview component works correctly here too —
          // it only ever draws the flat, shrunk-face boundary, not the
          // curved corners, which is a fair approximation of "how much
          // material this removes" for either operation.
          //
          // When re-applying to an already-filleted solid, `group` is
          // the CURRENT set of faces — which includes every tiny
          // corner-patch and edge-strip face the previous fillet built,
          // not just the original 6 flat faces. Feeding those into
          // computeChamferInsets tries to 2D-mitre-inset each of those
          // small patches independently, which produces a dense,
          // self-intersecting tangle of wireframe at every rounded
          // corner — confirmed directly as the cause of the reported
          // "messy" preview. Same fix as chamfer's own onMove: when
          // re-applying, build the preview from the RECONSTRUCTED
          // original boundary instead of the current (already-rounded)
          // faces, matching what commit() will actually shrink.
          const reapplyFrom = filletRef.current.session?.reapplyFrom;
          setChamferPreview(
            reapplyFrom
              ? { faces: group, amount, boundaries: reapplyFrom as Vec3[][] }
              : { faces: group, amount },
          );
        };

        // Only removes the window listeners — no state updates, no commit.
        // Registered so an unmount mid-drag (not a normal pointerup) can
        // stop the listener without touching React state on an unmounting
        // component or silently committing a still-in-progress edit.
        const removeListeners = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', finish);
          activeDragCleanupsRef.current.delete(removeListeners);
        };
        const finish = () => {
          removeListeners();
          setChamferPreview(null);
          const result = filletRef.current.commit();
          if (!result.ok) {
            showToast(result.reason ? `Rounding failed: ${result.reason}` : 'Rounding failed.');
          }
          setMeasurements('');
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', finish, { once: true });
        activeDragCleanupsRef.current.add(removeListeners);
        return true;
      }

      const group = groupContaining(kernelHost.graph, faceId);
      const begun = chamferRef.current.begin(group);
      if (!begun.ok) {
        showToast(
          begun.reason
            ? `This surface can't be chamfered: ${begun.reason}`
            : "This surface is not part of a solid that can be chamfered.",
        );
        return false;
      }
      // See the matching comment in the 'radius' branch above — same
      // fix, same reasoning: activeBevelAmount (Chamfer Strength) was
      // never read anywhere outside its own slider before this.
      chamferRef.current.update(activeBevelAmount);
      setChamferPreview({ faces: group, amount: activeBevelAmount });
      setMeasurements('Move the cursor to set the chamfer amount, then release.');
      const dragSensitivity = groupBoundsHalfMinDimension(group) / 300;

      let dragStartClientX = 0;
      let dragStarted = false;

      const onMove = (ev: PointerEvent) => {
        if (!dragStarted) {
          dragStartClientX = ev.clientX;
          dragStarted = true;
          return;
        }
        const deltaPx = ev.clientX - dragStartClientX;
        const amount = Math.max(0, activeBevelAmount + deltaPx * dragSensitivity);
        chamferRef.current.update(amount);
        setMeasurements(`${formatValue(amount, unit, 2)} — release to confirm.`);
        // When re-applying to an already-chamfered solid, the session
        // carries the ORIGINAL boundary chamferSolid will actually
        // reconstruct and re-shrink — the preview must be built from
        // THAT, not from `group` (the current, already-shrunk faces),
        // or it shows an entirely different, much smaller shrink than
        // what commit() will produce. See ChamferPreview's own doc
        // comment on its `boundaries` prop for the full reasoning.
        const reapplyFrom = chamferRef.current.session?.reapplyFrom;
        setChamferPreview(
          reapplyFrom
            ? { faces: group, amount, boundaries: reapplyFrom as Vec3[][] }
            : { faces: group, amount },
        );
      };

      const removeListeners = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', finish);
        activeDragCleanupsRef.current.delete(removeListeners);
      };
      const finish = () => {
        removeListeners();
        setChamferPreview(null);
        const result = chamferRef.current.commit();
        if (!result.ok) {
          showToast(result.reason ? `Chamfer failed: ${result.reason}` : 'Chamfer failed.');
        }
        setMeasurements('');
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', finish, { once: true });
      activeDragCleanupsRef.current.add(removeListeners);
      return true;
    }

    if (activeTool === 'offset') {
      // Reshapes the CLICKED FACE'S OWN boundary by inserting a new offset
      // ring INSIDE (or around) it, leaving the original untouched — this
      // is what splits the face into an outer frame and an inner shape,
      // both independently selectable, matching the app's original Offset
      // tool exactly. A previous version of this wiring instead inflated
      // the whole 3D solid uniformly (no split, no second surface) — that
      // was the wrong operation under the right name; see faceOffset.ts's
      // own doc comment for the full story.
      if (!faceOffsetRef.current.begin(faceId)) return false;
      setMeasurements('Move the cursor to reshape, then release.');

      const ndc = new THREE.Vector2();
      const dragRay = new THREE.Raycaster();

      const onMove = (ev: PointerEvent) => {
        const rect = gl.domElement.getBoundingClientRect();
        ndc.set(
          ((ev.clientX - rect.left) / rect.width) * 2 - 1,
          -((ev.clientY - rect.top) / rect.height) * 2 + 1,
        );
        dragRay.setFromCamera(ndc, camera);
        const f = kernelHost.graph.faces.get(faceId);
        if (!f) return;
        const plane = new THREE.Plane(
          new THREE.Vector3(f.plane.normal.x, f.plane.normal.y, f.plane.normal.z),
          -(f.plane.normal.x * f.plane.point.x + f.plane.normal.y * f.plane.point.y + f.plane.normal.z * f.plane.point.z),
        );
        const hit = new THREE.Vector3();
        if (!dragRay.ray.intersectPlane(plane, hit)) return;

        const cursor2D = faceOffsetRef.current.projectToSessionPlane({ x: hit.x, y: hit.y, z: hit.z });
        if (!cursor2D) return;
        const dist = faceOffsetRef.current.update(cursor2D);
        setMeasurements(
          `${formatValue(Math.abs(dist), unit, 2)} ${dist < 0 ? '(inward)' : '(outward)'} — release to confirm.`,
        );
        setFaceOffsetPreview({ faceId, distance: dist });
      };

      const removeListeners = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', finish);
        activeDragCleanupsRef.current.delete(removeListeners);
      };
      const finish = () => {
        removeListeners();
        const offsetSession = faceOffsetRef.current.session;
        const distance = offsetSession?.distance ?? 0;
        if (offsetSession) {
          recordAction(actionLabel('Offset tool'), { sdk: `sdk.drawing.offset(${offsetSession.faceId}, ${JSON.stringify(distance)});` });
        }
        const ok = faceOffsetRef.current.commit();
        if (ok && offsetSession) {
          const offsetFace = offsetSession.faceId;
          offerKernelAdjust('offset', 'Offset distance', typed => {
            const d = lengthOrError(typed, true);
            if (typeof d === 'string') return d;
            return () => commitKernelFaceOffset(kernelHost, offsetFace, inDragDirection(d, distance));
          });
        }
        setFaceOffsetPreview(null);
        setMeasurements(ok || Math.abs(distance) < 1e-3 ? '' : 'That offset is larger than the shape allows, so nothing was changed.');
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', finish, { once: true });
      activeDragCleanupsRef.current.add(removeListeners);
      return true;
    }

    if (activeTool !== 'pushpull') return false;
    const grab = event.point ?? kernelHost.graph.faces.get(faceId)?.plane.point;
    if (!grab) return false;

    // Double-click repeats the last distance on the face under the pointer (Ctrl: as a copy).
    const native = (event as { nativeEvent?: { ctrlKey?: boolean; metaKey?: boolean } }).nativeEvent;
    const pressCopy = !!(native?.ctrlKey || native?.metaKey);
    const last = lastPushPullRef.current;
    if (last.distance !== null && last.clickAt > 0 && Date.now() - last.clickAt < 400) {
      lastPushPullRef.current = { ...last, clickAt: 0 };
      if (commitKernelPushPull(kernelHost, faceId, last.distance, { copy: pressCopy })) {
        bumpKernel();
        recordAction(actionLabel('Push/Pull tool'), { sdk: `sdk.drawing.pushPull(${faceId}, ${JSON.stringify(last.distance)});` });
        setMeasurements(`Repeated ${formatValue(Math.abs(last.distance), unit, 2)}`);
      } else {
        setMeasurements('Could not repeat the push/pull on that face.');
      }
      return true;
    }

    pushPullRef.current.begin(faceId, { x: grab.x, y: grab.y, z: grab.z });
    setMeasurements('Drag to push or pull, then release.');

    // Track the drag on the WINDOW, not the canvas.
    //
    // The canvas pointer-move logic hangs off a large invisible ground plane.
    // The moment geometry is raised, the cursor is over the geometry and the
    // plane stops receiving moves — so the distance never updated, and the
    // commit applied zero. That is why push/pull did nothing on a fresh
    // surface. A window listener sees the whole drag wherever it goes.
    const ndc = new THREE.Vector2();
    const dragRay = new THREE.Raycaster();

    const onMove = (ev: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      ndc.set(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      );
      // A private raycaster: reusing the shared one would disturb hover and
      // selection mid-drag.
      dragRay.setFromCamera(ndc, camera);
      const dist = pushPullRef.current.update({
        origin: { x: dragRay.ray.origin.x, y: dragRay.ray.origin.y, z: dragRay.ray.origin.z },
        direction: { x: dragRay.ray.direction.x, y: dragRay.ray.direction.y, z: dragRay.ray.direction.z },
      });
      if (dist !== null) {
        setMeasurements(formatValue(Math.abs(dist), unit, 2));
        const live = pushPullRef.current.session;
        if (live) setPushPullPreview({ rings: live.rings, normal: live.normal, distance: dist });
      }
    };

    const removeListeners = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      activeDragCleanupsRef.current.delete(removeListeners);
    };
    const finish = (ev?: PointerEvent) => {
      removeListeners();
      const pushed = pushPullRef.current.session;
      const pushedFace = pushed?.faceId;
      const pushedDistance = pushed?.distance ?? 0;
      // Ctrl held on release pushes a copy: the face stays and the extrusion stacks on it.
      const copy = !!(ev && (ev.ctrlKey || ev.metaKey)) || pressCopy;
      if (pushed) {
        recordAction(actionLabel('Push/Pull tool'), { sdk: `sdk.drawing.pushPull(${pushed.faceId}, ${JSON.stringify(pushed.distance)});` });
      }
      if (pushPullRef.current.commit({ copy }) && pushedFace !== undefined) {
        lastPushPullRef.current = { distance: pushedDistance, clickAt: 0 };
        // Type a distance now to redo it exactly (a minus sign pushes the other way).
        offerKernelAdjust('pushpull', 'Extrude distance', typed => {
          const d = lengthOrError(typed, true);
          if (typeof d === 'string') return d;
          return () => commitKernelPushPull(kernelHost, pushedFace, inDragDirection(d, pushedDistance), { copy });
        });
      } else if (pushed && Math.abs(pushedDistance) < kernelHost.tolerances.MIN_EDGE_LENGTH) {
        // A click with no drag: a second click straight after repeats the last distance.
        lastPushPullRef.current = { ...lastPushPullRef.current, clickAt: Date.now() };
      }
      setPushPullPreview(null);
      setMeasurements('');
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish, { once: true });
    activeDragCleanupsRef.current.add(removeListeners);
    return true;
    } catch (err) {
      console.error('[handleKernelFacePointerDown] uncaught error:', err);
      showToast(
        err instanceof Error ? `Something went wrong: ${err.message}` : 'Something went wrong with that action.',
      );
      return false;
    }
  }, [
    activeTool, activeBevelType, activeBevelAmount, kernelHost, setMeasurements, camera, gl, unit, showToast, setPlacingNotePos,
    // pickingSunCenter/pickSunCenter, and especially kernelSubtractTarget/
    // setKernelSubtractTarget/performKernelCSGSubtraction/setSelectedFaceIds/
    // setConsoleOutput below, were all missing from this list — meaning
    // this whole callback was memoized and NEVER re-created when any of
    // them changed. kernelSubtractTarget specifically stayed frozen at
    // whatever it was when activeTool (the only thing that DID trigger a
    // re-memoization) last changed — so every click after the very first
    // one inside a single "stay on the subtract tool" session saw a
    // stale kernelSubtractTarget still equal to null, and treated every
    // click as "set the target" instead of ever reaching "perform the
    // subtraction". Confirmed directly as the cause of "does not seem to
    // register/change anything" until switching tools away and back —
    // that's exactly what forced a fresh memoization with the actually-
    // current value.
    pickingSunCenter, pickSunCenter,
    kernelSubtractTarget, setKernelSubtractTarget, performKernelCSGSubtraction, setSelectedFaceIds, setConsoleOutput,
    subtractTargetId, setSubtractTargetId, performMixedCSGSubtraction,
  ]);
  const directionalLightRef = useRef<THREE.DirectionalLight>(null!);
  // The sun's own screen-space marker for GodRays (see the <GodRays> mount below) -
  // separate from the showLightsource debug sphere, since this one needs to always
  // exist (not just when that debug toggle is on) for the effect to have something
  // to reference.
  const sunMeshRef = useRef<THREE.Mesh>(null!);
  const transformRef = useRef<any>(null);
  const selectedIdRef = useRef(selectedId);
  const selectedLightIdRef = useRef(selectedLightId);
  const isDraggingRef = useRef(false);
  const kernelSelectedSetRef = useRef(kernelSelectedSet);
  const blockPlacementDraftRef = useRef(blockPlacementDraft);

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
    blockLastValidDraftRef.current = null;
  }, [activeBlockPart?.partId, activeTool]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
    captureDiagnosticData(selectedId);
  }, [selectedId]);

  useEffect(() => {
    selectedLightIdRef.current = selectedLightId;
    captureDiagnosticData();
  }, [selectedLightId]);

  useEffect(() => {
    kernelSelectedSetRef.current = kernelSelectedSet;
  }, [kernelSelectedSet]);

  useEffect(() => {
    blockPlacementDraftRef.current = blockPlacementDraft;
  }, [blockPlacementDraft]);

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
      // Orbit relative to sunOrbitCenter, not the origin — see
      // AppContext's own comment on that state for why. radius/angle are
      // computed relative to the centre, and the resulting position is
      // offset back by that same centre, so picking a new centre
      // re-centres the whole orbit around it instead of always circling
      // [0,0,0].
      if (!sunAnimRef.current) {
        const dx = lightPosition[0] - sunOrbitCenter[0];
        const dz = lightPosition[2] - sunOrbitCenter[2];
        sunAnimRef.current = { radius: Math.sqrt(dx * dx + dz * dz) || 10, angle: Math.atan2(dz, dx) };
      } sunAnimRef.current.angle += state.clock.getDelta() * sunSpeed * 0.5;
      const radius = sunAnimRef.current.radius; const time = sunAnimRef.current.angle;
      setLightPosition([
        sunOrbitCenter[0] + Math.cos(time) * radius,
        lightPosition[1],
        sunOrbitCenter[2] + Math.sin(time) * radius
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
  const [snapIndicator, setSnapIndicator] = useState<{ point: [number, number, number]; type: SnapKind; tooltip?: string; color?: string } | null>(null);
  // Lines the snap engine wants drawn (the inference in force, the lock), and the edge under the pointer.
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
  const [snapHoverEdge, setSnapHoverEdge] = useState<HoverEdge | null>(null);
  // Kept fresh every render (not gated behind an effect's own dependency
  // list) so handleSetCamera below - defined once, early in this
  // component, and otherwise stuck with whatever effectiveCameraNear/Far
  // were at mount - can always restore the app's CURRENT baseline near/far
  // when a view change or Reset follows a Portal Navigation transition
  // (which sets camera.near dynamically, per-destination).
  const effectiveCameraDefaultsRef = useRef({ near: 0.1, far: 5000 });
  const [portalTransitionActive, setPortalTransitionActive] = useState(false);
  // The tool active just before Walk Mode was entered, so exiting (ESC)
  // can restore it (spec §5.5) - tracked here rather than inside
  // WalkModeController since that component only exists while
  // activeTool === 'walk', by which point the previous tool is already gone.
  const preWalkToolRef = useRef<ToolType>('orbit');
  useEffect(() => {
    if (activeTool !== 'walk' && activeTool !== 'look') preWalkToolRef.current = activeTool;
  }, [activeTool]);
  const portalTransitionRef = useRef<{
    startTime: number;
    duration: number;
    from: { position: THREE.Vector3; quaternion: THREE.Quaternion; fov: number; near: number };
    to: { position: THREE.Vector3; quaternion: THREE.Quaternion; fov: number; near: number; target: THREE.Vector3 };
  } | null>(null);
  const [trackingGuide, setTrackingGuide] = useState<{ source: [number, number, number]; target: [number, number, number]; color: string; label?: string } | null>(null);
  const inferenceLockRef = useRef<{ point: THREE.Vector3; type: 'endpoint' | 'midpoint' | 'center'; since: number; locked: boolean } | null>(null);
  const [typedLength, setTypedLength] = useState<string>('');

  // Starts (or, mid-flight, restarts from the current interpolated pose)
  // the Portal Navigation camera transition. See the useFrame driver below
  // for the actual per-frame interpolation.
  const startPortalTransition = useCallback((destination: PortalDestination) => {
    const controls = scene.userData.controls;
    const cam = camera as THREE.PerspectiveCamera;

    // Whether or not a transition was already running, the camera's live
    // position/quaternion/fov/near already reflect wherever it currently
    // is (the frame driver below mutates them directly every tick) - so
    // starting fresh from `cam.*` naturally continues smoothly from an
    // interrupted mid-flight transition with no special-casing needed.
    const fromPos = cam.position.clone();
    const fromQuat = cam.quaternion.clone();
    const fromFov = cam.fov || 50;
    const fromNear = cam.near;

    const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const duration = reducedMotion ? 0 : 200; // within the spec's 150-250ms band

    portalTransitionRef.current = {
      startTime: performance.now(),
      duration,
      from: { position: fromPos, quaternion: fromQuat, fov: fromFov, near: fromNear },
      to: {
        position: destination.eye.clone(),
        quaternion: destination.quaternion.clone(),
        fov: destination.fov,
        near: destination.near,
        target: destination.target.clone(),
      },
    };
    if (controls) controls.enabled = false;
    setPortalTransitionActive(true);
  }, [camera, scene]);

  useFrame(() => {
    const active = portalTransitionRef.current;
    if (!active) return;
    const cam = camera as THREE.PerspectiveCamera;
    const t = active.duration <= 0 ? 1 : (performance.now() - active.startTime) / active.duration;
    const eased = smoothstep(t);

    cam.position.lerpVectors(active.from.position, active.to.position, eased);
    cam.quaternion.slerpQuaternions(active.from.quaternion, active.to.quaternion, eased);
    cam.fov = THREE.MathUtils.lerp(active.from.fov, active.to.fov, eased);
    cam.near = THREE.MathUtils.lerp(active.from.near, active.to.near, eased);
    cam.updateProjectionMatrix();

    if (t >= 1) {
      const controls = scene.userData.controls;
      if (controls) {
        controls.target.copy(active.to.target);
        controls.enabled = true;
        controls.update();
      }
      portalTransitionRef.current = null;
      setPortalTransitionActive(false);
    }
  });
  // The global keydown handler below is a single useEffect whose own
  // dependency array only lists a handful of the values it actually reads
  // (activeTool, a few vertex-array lengths, etc.) - widening it to cover
  // everything the handler branches on would tear down and re-add a
  // window-level listener on every keystroke while typing a length or
  // every vertex added while drawing, which is exactly the listener-churn
  // problem already fixed elsewhere in this file (see selectedIdRef
  // above it). These refs mirror the remaining values that handler needs
  // but doesn't declare, kept fresh every render, so its closure always
  // reads the current value instead of whatever was current when the
  // effect last re-ran.
  const typedLengthRef = useRef(typedLength);
  /** The step just done, adjustable with a typed value (see the typed-values block below). */
  const lastTypedStepRef = useRef<{ tool: string; stillLatest: () => boolean; apply: (typed: string) => string | null } | null>(null);
  const typedWantedRef = useRef<() => boolean>(() => false);
  const typedEnterRef = useRef<(typed: string) => boolean>(() => false);
  useEffect(() => {
    // A typed value belongs to one tool's step: switching tools drops both.
    lastTypedStepRef.current = null;
    typedLengthRef.current = '';
    setTypedLength('');
  }, [activeTool]);
  const drawingStartRef = useRef(drawingStart);
  // Esc closes an open group when nothing is being drawn (read by the keydown handler).
  const exitGroupEditRef = useRef(exitGroupEdit);
  exitGroupEditRef.current = exitGroupEdit;
  const groupEditOpenRef = useRef(false);
  groupEditOpenRef.current = !!groupEdit;
  const drawingNormalRef = useRef(drawingNormal);
  const drawingStepRef = useRef(drawingStep);
  const activeSplineDraftRef = useRef(activeSplineDraft);
  useEffect(() => {
    typedLengthRef.current = typedLength;
  }, [typedLength]);
  useEffect(() => {
    drawingStartRef.current = drawingStart;
  }, [drawingStart]);
  useEffect(() => {
    drawingNormalRef.current = drawingNormal;
  }, [drawingNormal]);
  useEffect(() => {
    drawingStepRef.current = drawingStep;
  }, [drawingStep]);
  useEffect(() => {
    activeSplineDraftRef.current = activeSplineDraft;
  }, [activeSplineDraft]);
  const [lastDrawTarget, setLastDrawTarget] = useState<THREE.Vector3 | null>(null);
  const lastDrawTargetRef = useRef(lastDrawTarget);
  useEffect(() => {
    lastDrawTargetRef.current = lastDrawTarget;
  }, [lastDrawTarget]);
  const [faceEditMode, setFaceEditMode] = useState<string | null>(null); // shapeId
  // placingNotePos/setPlacingNotePos now come from context (see
  // AppContext.tsx's own doc comment) — Scene() still SETS this on click
  // (below), but no longer renders the dialog itself or owns its state.
  const [polyVertices, setPolyVertices] = useState<THREE.Vector3[]>([]);
  const [polyPlane, setPolyPlane] = useState<THREE.Plane | null>(null);
  const [polyNormal, setPolyNormal] = useState<THREE.Vector3 | null>(null);
  const [polyHoveredVertex, setPolyHoveredVertex] = useState<number | null>(null);
  const [polyCandidatePos, setPolyCandidatePos] = useState<THREE.Vector3 | null>(null);
  const [polyPlaneOnId, setPolyPlaneOnId] = useState<string | null>(null);

  // Bézier Curve Tool State
  const bezierToolRef = useRef<BezierTool>(new BezierTool());
  const [bezierKnots, setBezierKnots] = useState<BezierKnot[]>([]);
  const bezierKnotsRef = useRef(bezierKnots);
  useEffect(() => {
    bezierKnotsRef.current = bezierKnots;
  }, [bezierKnots]);
  const [bezierResolution, setBezierResolution] = useState<number>(24);
  const [bezierActivePlane, setBezierActivePlane] = useState<THREE.Plane | null>(null);
  const [bezierHoveredKnotIndex, setBezierHoveredKnotIndex] = useState<number | null>(null);
  const [bezierCandidatePos, setBezierCandidatePos] = useState<THREE.Vector3 | null>(null);
  const [isDraggingBezierHandle, setIsDraggingBezierHandle] = useState<boolean>(false);
  const [bezierPlaneOnId, setBezierPlaneOnId] = useState<string | null>(null);

  const [wallVertices, setWallVertices] = useState<THREE.Vector3[]>([]);
  const [wallPlane, setWallPlane] = useState<THREE.Plane | null>(null);
  const [wallCandidatePos, setWallCandidatePos] = useState<THREE.Vector3 | null>(null);
  const [wallHoveredVertex, setWallHoveredVertex] = useState<number | null>(null);
  const wallDragStartRef = useRef<{ point: THREE.Vector3; time: number } | null>(null);
  // Ids of the wall shapes created for the CURRENT wall-drawing chain, in click order - lets
  // closeWallLoopAndAssembleRoom match each loop edge to its exact wall by position in this
  // list instead of a nearest-distance guess, which could mismatch a wall from a different,
  // nearby room sharing the same story tag and warp/miter it against the wrong neighbors.
  const wallChainShapeIdsRef = useRef<string[]>([]);
  const lastWallClickTimeRef = useRef<number>(0);

  const [fenceVertices, setFenceVertices] = useState<THREE.Vector3[]>([]);
  const [fencePlane, setFencePlane] = useState<THREE.Plane | null>(null);
  const [fenceCandidatePos, setFenceCandidatePos] = useState<THREE.Vector3 | null>(null);
  const [fenceHoveredVertex, setFenceHoveredVertex] = useState<number | null>(null);

  const [previewShape, setPreviewShape] = useState<{ 
    type: Shape['type'], 
    position: [number, number, number], 
    quaternion: [number, number, number, number],
    args: any,
    stairStyle?: string,
    stairStructure?: string,
    railingMode?: string,
    archStyle?: string,
    color?: string
  } | null>(null);
  const previewShapeRef = useRef(previewShape);
  useEffect(() => {
    previewShapeRef.current = previewShape;
  }, [previewShape]);
  const [stairRotationAngle, setStairRotationAngle] = useState<number>(0);
  const [polygonSides, setPolygonSides] = useState<number>(6);
  
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
    const handleClearScene = () => {
      setWallVertices([]);
      setPolyVertices([]);
      setBezierKnots([]);
      setFenceVertices([]); liveFenceIdRef.current = null;
      setRoadPoints([]);
      setDrawingStart(null);
      setPreviewShape(null);
      setPushPullState(null);
      pushPullStateRef.current = null;
      setBevelState(null);
      setHoveredFace(null);
      setContextMenu(null);
      setChamferPreview(null);
      setFaceOffsetPreview(null);
      setPushPullPreview(null);
      setPlacingNotePos(null);
    };
    window.addEventListener('clear-3d-space', handleClearScene);
    return () => window.removeEventListener('clear-3d-space', handleClearScene);
  }, []);


  useEffect(() => {
    const handleExportAdvanced = (e: any) => {
      const { format, modelName, names, components } = e.detail as {
        format: 'gltf' | 'stl' | 'skp'; modelName?: string | null; names?: Record<string, string>; components?: Record<string, string>;
      };
      // Just the model - drawn geometry included, grid/sky/lights/previews left out - each
      // piece once, at its world position (see lib/export/modelExport.ts).
      const items = collectModelItems(scene, id => names?.[id], id => components?.[id]);
      if (items.length === 0) {
        alert('There is nothing in the model to export yet.');
        return;
      }

      if (format === 'skp') {
        try {
          const { bytes, faces, skipped } = buildSkp(items, kernelHost.graph);
          downloadBlob(new Blob([bytes], { type: 'application/octet-stream' }), exportFileName(modelName, 'skp'));
          console.log(`[Export] SketchUp file written: ${faces} faces${skipped ? `, ${skipped} tiny slivers left out` : ''}`);
        } catch (err) {
          console.error('[Export] SketchUp export failed', err);
          alert(`Couldn't write the SketchUp file: ${err instanceof Error ? err.message : String(err)}`);
        }
        return;
      }

      const exportScene = buildExportScene(items);
      if (format === 'stl') {
        const result = new STLExporter().parse(exportScene, { binary: true });
        downloadBlob(new Blob([result], { type: 'application/octet-stream' }), exportFileName(modelName, 'stl'));
      } else {
        const exporter = new GLTFExporter();
        exporter.parse(
          exportScene,
          (gltf) => {
            const output = JSON.stringify(gltf, null, 2);
            downloadBlob(new Blob([output], { type: 'application/json' }), exportFileName(modelName, 'gltf'));
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

    const handleRequestSceneRaw = (e: any) => {
      if (e.detail && typeof e.detail.callback === 'function') {
        e.detail.callback(scene);
      }
    };

    window.addEventListener('export-scene', handleExport);
    window.addEventListener('export-scene-advanced', handleExportAdvanced);
    window.addEventListener('request-scene-raw', handleRequestSceneRaw);
    
    const handleSetCamera = (e: any) => {
      // Any explicit camera placement (a named view, or Reset) should land
      // on the app's normal baseline framing, not whatever a Portal
      // Navigation transition happened to leave cam.fov/near/far at -
      // otherwise the destination looks broken (wrong FOV, near-clipped
      // geometry) and can read as "the click did nothing" even though the
      // position/target did move. A transition still mid-flight is also
      // cancelled outright rather than left to fight this jump next frame.
      portalTransitionRef.current = null;
      setPortalTransitionActive(false);

      const { position, target, zoom } = e.detail;
      camera.position.set(...(position as [number, number, number]));

      if ((camera as any).isPerspectiveCamera) {
        const cam = camera as THREE.PerspectiveCamera;
        cam.fov = 50; // three.js default - the app never overrides this outside a portal transition
        cam.near = effectiveCameraDefaultsRef.current.near;
        cam.far = effectiveCameraDefaultsRef.current.far;
      }

      if (zoom !== undefined) {
        camera.zoom = zoom;
      }
      camera.updateProjectionMatrix();

      const controls = scene.userData.controls;
      if (controls) {
        controls.target.set(...(target as [number, number, number]));
        controls.enabled = true;
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
      window.removeEventListener('request-scene-raw', handleRequestSceneRaw);
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
      setFenceVertices([]); liveFenceIdRef.current = null;
      setFencePlane(null);
      setFenceCandidatePos(null);
      setFenceHoveredVertex(null);
    }
    if (activeTool !== 'teleport') {
      setSnapIndicator(null);
    }
  }, [activeTool]);

  // Listen for external polygon side count changes
  useEffect(() => {
    const handleSetSides = (e: CustomEvent<{ sides: number }>) => {
      if (e.detail && typeof e.detail.sides === 'number' && e.detail.sides >= 3) {
        setPolygonSides(Math.min(64, Math.max(3, Math.round(e.detail.sides))));
      }
    };
    window.addEventListener('polyform:set-polygon-sides' as any, handleSetSides);
    return () => {
      window.removeEventListener('polyform:set-polygon-sides' as any, handleSetSides);
    };
  }, []);

  /** Rectangle's width/depth boxes (status bar), after a single click: in the display unit, as a drawn surface. */
  const finalizeRectangleInput = () => {
    if (!rectangleInputState.active || !rectangleInputState.startPoint) return;
    const size = parseTypedRectangle(`${rectangleInputState.width},${rectangleInputState.depth}`, unit);
    if (size) {
      const n = rectangleInputState.normal;
      const normal = n ? new THREE.Vector3(n.x, n.y, n.z) : new THREE.Vector3(0, 1, 0);
      const p = rectangleInputState.startPoint;
      const start = new THREE.Vector3(p.x, p.y, p.z);
      const ring = rectangleRing(start, normal, size.x, size.y);
      commitKernelRing('rectangle', 'Rectangle', ring, shapeRingRemaker('rectangle', start, normal, ring));
    } else if (rectangleInputState.width || rectangleInputState.depth) {
      setMeasurements('Enter a width and a depth, each not 0.');
      return;
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

    // A drawn surface in the geometry kernel, like Rectangle / Circle / Polygon, so Offset,
    // Push/Pull, Convert To Wall and Merge all work on it. One undo step.
    // Flattened onto the drawing plane: clicks can land a hair above or below it (grid lines,
    // axes), and a surface only forms when every corner lies on one plane.
    const drawingPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal.clone().normalize(), origin);
    const polyPoints = polyVertices.map(v => {
      const q = drawingPlane.projectPoint(v, new THREE.Vector3());
      return { x: q.x, y: q.y, z: q.z };
    });
    recordAction(actionLabel('Polygon tool'), { sdk: `sdk.drawing.surface(${JSON.stringify(polyPoints.map(p => [p.x, p.y, p.z]))});` });
    const committed = kernelHost.commitIsolatedRing(polyPoints);
    if (!committed.ok) {
      setConsoleOutput(prev => [...prev, `[ERROR] Could not create the shape: ${committed.reason ?? 'unknown error'}.`]);
      diagLog('ERROR', 'Poly failed: kernel commit', { reason: committed.reason });
      return;
    }
    bumpKernel();
    setActiveTool('select');
    setSelectedId(null);
    setSelectedIds([]);
    setSelectedFaceIds(committed.faces);

    diagLog('SDK', 'Poly surface created', { faces: committed.faces.length, vertexCount: p2d.length });

    setPolyVertices([]);
    setPolyPlane(null);
    setPolyNormal(null);
    setPolyCandidatePos(null);
  }, [polyVertices, polyNormal, polyPlaneOnId, kernelHost, bumpKernel, setActiveTool, setSelectedId, setSelectedIds, setSelectedFaceIds, diagLog, setConsoleOutput, setPolyVertices, setPolyPlane, setPolyNormal, setPolyCandidatePos]);

  const finalizeWallChain = useCallback(() => {
    setWallVertices([]);
    setWallPlane(null);
    setWallCandidatePos(null);
    setWallHoveredVertex(null);
    setSnapIndicator(null);
    setTrackingGuide(null);
    setMeasurements('');
    wallDragStartRef.current = null;
    wallChainShapeIdsRef.current = [];
  }, [setMeasurements]);

  const findWallObstacleIntersection = useCallback((pA: THREE.Vector3, pB: THREE.Vector3) => {
    const totalDist = pA.distanceTo(pB);
    if (totalDist < 0.15) return null;

    let closestHit: { hitPoint: THREE.Vector3; obstacleWall: Shape; dist: number } | null = null;
    let minDist = totalDist;

    shapes.forEach(sh => {
      if (sh.hidden || sh.type !== 'wall') return;
      const wL = Array.isArray(sh.args) ? sh.args[0] || 3.0 : 3.0;
      const wH = Array.isArray(sh.args) ? sh.args[1] || 2.8 : 2.8;
      const wPos = new THREE.Vector3(...sh.position);
      const wQuat = sh.quaternion ? new THREE.Quaternion(...sh.quaternion) : new THREE.Quaternion();

      // Check vertical story level overlap
      const wallMinY = wPos.y - wH / 2;
      const wallMaxY = wPos.y + wH / 2;
      if (pA.y < wallMinY - 0.4 || pA.y > wallMaxY + 0.4) return;

      const vRun = new THREE.Vector3(1, 0, 0).applyQuaternion(wQuat).normalize();
      const wP1 = wPos.clone().sub(vRun.clone().multiplyScalar(wL / 2));
      const wP2 = wPos.clone().add(vRun.clone().multiplyScalar(wL / 2));

      // 2D line segment intersection in XZ plane
      const x1 = pA.x, z1 = pA.z;
      const x2 = pB.x, z2 = pB.z;
      const x3 = wP1.x, z3 = wP1.z;
      const x4 = wP2.x, z4 = wP2.z;

      const denom = (x1 - x2) * (z3 - z4) - (z1 - z2) * (x3 - x4);
      if (Math.abs(denom) < 1e-5) return;

      const t = ((x1 - x3) * (z3 - z4) - (z1 - z3) * (x3 - x4)) / denom;
      const u = -((x1 - x2) * (z1 - z3) - (z1 - z2) * (x1 - x3)) / denom;

      if (t > 0.08 && t <= 1.0 && u >= -0.02 && u <= 1.02) {
        const hitX = x1 + t * (x2 - x1);
        const hitZ = z1 + t * (z2 - z1);
        const hitPt = new THREE.Vector3(hitX, pA.y, hitZ);
        const distFromStart = pA.distanceTo(hitPt);

        if (distFromStart < minDist) {
          minDist = distFromStart;
          closestHit = { hitPoint: hitPt, obstacleWall: sh, dist: distFromStart };
        }
      }
    });

    return closestHit;
  }, [shapes]);

  const createWallSegment = useCallback((pA: THREE.Vector3, pB: THREE.Vector3, wallHeight?: number, wallThickness?: number, justification?: WallJustification) => {
    // Prevent interior and multi-story walls from passing through existing obstacle walls
    const obstacle = findWallObstacleIntersection(pA, pB);
    const effectivePB = obstacle ? obstacle.hitPoint.clone() : pB;

    const dist = pA.distanceTo(effectivePB);
    if (dist < 0.1) return null;

    const actualHeight = wallHeight ?? (wallToolSettings?.height || 2.8);
    const actualThickness = wallThickness ?? (wallToolSettings?.thickness || 0.2);
    const actualJustification = justification ?? (wallJustification || 'exterior');

    const dir = new THREE.Vector3().subVectors(effectivePB, pA);
    const angle = Math.atan2(dir.z, dir.x);
    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angle);

    // Calculate justification offset (perpendicular to wall vector)
    const normal = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    let offsetScalar = 0;
    if (actualJustification === 'exterior') {
      offsetScalar = actualThickness / 2;
    } else if (actualJustification === 'interior') {
      offsetScalar = -actualThickness / 2;
    }

    const center = pA.clone().lerp(effectivePB, 0.5);
    center.add(normal.clone().multiplyScalar(offsetScalar));
    const baseY = Math.max(pA.y, effectivePB.y);
    center.y = baseY + actualHeight / 2;

    // Storey from the height above the ground under the wall (not above y = 0), so walls drawn
    // on raised terrain are ground-floor walls rather than an upper storey.
    const groundAt = (x: number, z: number) => {
      const terrain = shapes.find(t => t.type === 'terrain' && !t.hidden && t.terrainData
        && Math.abs(x - t.position[0]) <= t.terrainData.width / 2 && Math.abs(z - t.position[2]) <= t.terrainData.depth / 2);
      return terrain ? sampleTerrainElevation(x, z, terrain) : 0;
    };
    const groundY = Math.min(groundAt(pA.x, pA.z), groundAt(effectivePB.x, effectivePB.z));
    const derivedStory = Math.max(1, Math.round((baseY - groundY) / 2.8) + 1);

    const wallCount = shapes.filter(s => s.type === 'wall').length + 1;
    let wallName = `Exterior Wall ${wallCount}`;
    if (actualJustification === 'interior') {
      wallName = `Interior Wall St-${derivedStory} #${wallCount}`;
    } else if (actualJustification === 'center') {
      wallName = `Center Wall St-${derivedStory} #${wallCount}`;
    }

    const newShape: Shape = {
      id: Math.random().toString(36).substr(2, 9),
      type: 'wall',
      position: [center.x, center.y, center.z],
      quaternion: [quat.x, quat.y, quat.z, quat.w],
      // Extend past each endpoint by half the thickness so a chained wall's box overlaps its
      // neighbor's at the shared corner vertex instead of leaving a thickness-sized gap there.
      args: [dist + actualThickness, actualHeight, actualThickness],
      color: activeMaterial || '#e2e8f0',
      roughness: activePBR.roughness,
      metalness: activePBR.metalness,
      opacity: activePBR.opacity,
      name: wallName,
      tags: ['wall', `wall-${actualJustification}`, `story-${derivedStory}`]
    };

    addShape(newShape);
    commitHistory();
    recordAction(actionLabel(`Wall tool: ${dist.toFixed(2)} m wall`));
    return newShape;
  }, [activeMaterial, activePBR, addShape, commitHistory, shapes, recordAction, wallToolSettings, wallJustification, activeStory]);

  // Helper to test if a 2D position lies inside an existing enclosed room or floor slab
  const isPointInsideRoom = useCallback((point: THREE.Vector3): boolean => {
    const wallShapes = shapes.filter(s => s.type === 'wall' && !s.hidden);
    if (wallShapes.length === 0) return false;

    // 1. Check floor slab shapes
    const floorSlabs = shapes.filter(s => (s.tags?.includes('floor-slab') || s.type === 'poly') && !s.hidden);
    for (const slab of floorSlabs) {
      if (Array.isArray(slab.args) && slab.args.length >= 3) {
        const [w, , d] = slab.args;
        const hw = (w || 1) / 2 + 0.15;
        const hd = (d || 1) / 2 + 0.15;
        if (Math.abs(point.x - slab.position[0]) <= hw && Math.abs(point.z - slab.position[2]) <= hd) {
          return true;
        }
      }
    }

    // 2. Check room envelope derived from walls
    const envelope = getRoomBoundingEnvelope(wallShapes);
    if (envelope) {
      const margin = 0.20; // allowance for clicking right along interior wall faces
      if (
        point.x >= envelope.minX - margin &&
        point.x <= envelope.maxX + margin &&
        point.z >= envelope.minZ - margin &&
        point.z <= envelope.maxZ + margin
      ) {
        return true;
      }
    }

    return false;
  }, [shapes]);

  const closeWallLoopAndAssembleRoom = useCallback(() => {
    if (wallVertices.length < 2) return;

    // Sanitize wall vertices: ensure we don't have duplicate near-identical points at the end.
    // The click that triggered this (landing back near the start point) already created its own
    // interactive wall segment via the normal per-click flow before this ever runs - popping
    // that near-duplicate vertex here without also dropping the stray wall drawn for it would
    // leave that extra, slightly-off segment sitting in the scene alongside the proper closing
    // wall created just below, doubling up geometry right at the closed corner.
    let cleanVertices = [...wallVertices];
    let staleClosingWallId: string | null = null;
    if (cleanVertices.length >= 3) {
      const last = cleanVertices[cleanVertices.length - 1];
      if (last.distanceTo(cleanVertices[0]) < 0.25) {
        cleanVertices.pop();
        staleClosingWallId = wallChainShapeIdsRef.current.pop() ?? null;
      }
    }

    if (cleanVertices.length >= 2) {
      const prev = cleanVertices[cleanVertices.length - 1];
      if (prev.distanceTo(cleanVertices[0]) >= 0.15) {
        const closingWall = createWallSegment(prev, cleanVertices[0]);
        if (closingWall) wallChainShapeIdsRef.current.push(closingWall.id);
      }
    }

    // Automatically assemble room floor slab and terrain integration
    const terrainShape = shapes.find(s => s.type === 'terrain') || null;
    const loopVectors = cleanVertices.length >= 3 ? [...cleanVertices] : [...wallVertices];
    const roomPoly2D: [number, number][] = loopVectors.map(v => [v.x, v.z]);
    // Exact wall-to-edge correspondence, in click order, for the mitering pass below - falls
    // back to a nearest-distance guess only when the chain bookkeeping doesn't line up (e.g. a
    // room assembled some other way than the interactive click-to-draw flow).
    const chainShapeIds = [...wallChainShapeIdsRef.current];
    const assembly = buildRoomAssembly(
      loopVectors,
      terrainShape,
      wallToolSettings,
      {
        wallHeight: wallToolSettings?.height || 2.8,
        wallThickness: wallToolSettings?.thickness || 0.2,
        justification: wallJustification,
        story: activeStory || 1
      }
    );

    setShapes(prevShapes => {
      let next = staleClosingWallId ? prevShapes.filter(s => s.id !== staleClosingWallId) : [...prevShapes];
      if (assembly.slabShape) {
        next.push(assembly.slabShape);
      }
      if (assembly.foundationShape) {
        next.push(assembly.foundationShape);
      }

      // Re-align all room perimeter walls: base on top of the floor slab (datumZ), and
      // recompute each wall's justification offset against the TRUE outward normal of its
      // matched loop edge (rather than trusting the offset direction guessed per-click while
      // drawing, which flips between correct and backwards depending on whether the room was
      // drawn clockwise or counter-clockwise - the actual cause of corners either overlapping
      // or gapping depending on draw direction).
      const loopLen = loopVectors.length;
      const currentStoryTag = `story-${activeStory || 1}`;
      const wallsForStory = next.filter(s => s.type === 'wall' && s.tags?.includes(currentStoryTag));

      // Match each loop edge to the wall shape actually drawn for it, and record enough about
      // that wall (its own justification offset line and direction) to miter its corners
      // against its neighbors below - a wall's own centerline no longer passes through the
      // raw drawn vertices once justification has shifted it sideways, so a corner can only be
      // closed exactly by intersecting each pair of neighboring walls' own offset lines, not by
      // guessing a fixed extension that only happens to work at exactly 90 degrees.
      const useExactChainMatch = chainShapeIds.length === loopLen;
      interface EdgeWall { shapeId: string; thickness: number; wallH: number; linePoint: THREE.Vector2; dir: THREE.Vector2; outwardNormal: THREE.Vector2; }
      const edgeWalls: (EdgeWall | null)[] = loopVectors.map((pA, i) => {
        const pB = loopVectors[(i + 1) % loopLen];
        let best: Shape | null = null;
        if (useExactChainMatch) {
          // The chain ids are the walls drawn for this loop: trust them whatever storey tag they carry.
          best = next.find(s => s.type === 'wall' && s.id === chainShapeIds[i]) ?? null;
        } else {
          const midX = (pA.x + pB.x) / 2;
          const midZ = (pA.z + pB.z) / 2;
          let bestDist = Infinity;
          for (const s of wallsForStory) {
            const d = Math.hypot(s.position[0] - midX, s.position[2] - midZ);
            if (d < bestDist) { bestDist = d; best = s; }
          }
          const thicknessGuess = Array.isArray(best?.args) ? (best!.args[2] || 0.2) : 0.2;
          if (bestDist >= Math.max(thicknessGuess * 4, 0.5)) best = null;
        }
        if (!best) return null;
        const thickness0 = Array.isArray(best.args) ? (best.args[2] || 0.2) : 0.2;
        const wallH = Array.isArray(best.args) ? (best.args[1] || 2.8) : 2.8;
        const dir2D = new THREE.Vector2(pB.x - pA.x, pB.z - pA.z).normalize();
        const trueNormal = computeOutwardWallNormal2D(pA, pB, roomPoly2D);
        const outwardNormal2D = new THREE.Vector2(trueNormal.x, trueNormal.z);
        const offsetScalar = best.tags?.includes('wall-exterior') ? thickness0 / 2
          : best.tags?.includes('wall-interior') ? -thickness0 / 2 : 0;
        const linePoint = new THREE.Vector2(pA.x, pA.z).addScaledVector(outwardNormal2D, offsetScalar);
        return { shapeId: best.id, thickness: thickness0, wallH, linePoint, dir: dir2D, outwardNormal: outwardNormal2D };
      });

      // The exact point where each vertex's two flanking walls' CENTERLINE offset lines meet -
      // used only to report a wall's nominal length (for the UI / opening placement), not for
      // its rendered geometry.
      const cornerPoints: THREE.Vector2[] = loopVectors.map((pV, i) => {
        const before = edgeWalls[(i - 1 + loopLen) % loopLen];
        const after = edgeWalls[i];
        return computeWallCornerPoint(
          pV,
          before ? { offsetPoint: before.linePoint, dir: before.dir } : null,
          after ? { offsetPoint: after.linePoint, dir: after.dir } : null
        );
      });

      // The wall's true OUTER and INNER face corners at each vertex - where this wall's own
      // exterior (or interior) face-line actually meets its neighbors', not an extended-box
      // approximation. The outer corner computed at a shared vertex is the exact same point for
      // both flanking walls, so their rendered polygons share a flush edge with zero gap and
      // zero overlap, at any angle.
      const outerCornerPoints: THREE.Vector2[] = loopVectors.map((pV, i) => {
        const before = edgeWalls[(i - 1 + loopLen) % loopLen];
        const after = edgeWalls[i];
        return computeWallFaceCorner(pV, before, after, 1);
      });
      const innerCornerPoints: THREE.Vector2[] = loopVectors.map((pV, i) => {
        const before = edgeWalls[(i - 1 + loopLen) % loopLen];
        const after = edgeWalls[i];
        return computeWallFaceCorner(pV, before, after, -1);
      });

      // Temporary diagnostic: prints exactly which edges resolved to a wall (and via which
      // matching strategy) so a reported corner gap/overlap can be checked against real data
      // instead of guessed at from a screenshot. Safe to remove once the corner issue is
      // confirmed fixed.
      diagLog('WALL_MITER', `Closing room: ${loopLen} edges, chain ids=${chainShapeIds.length}, exactMatch=${useExactChainMatch}`, {
        loopLen, chainShapeIds, useExactChainMatch,
        edges: edgeWalls.map((ew, i) => ew
          ? { i, shapeId: ew.shapeId, thickness: ew.thickness, linePoint: [ew.linePoint.x, ew.linePoint.y], dir: [ew.dir.x, ew.dir.y] }
          : { i, shapeId: null }),
        cornerPoints: cornerPoints.map(p => [p.x, p.y]),
        outerCornerPoints: outerCornerPoints.map(p => [p.x, p.y]),
        innerCornerPoints: innerCornerPoints.map(p => [p.x, p.y]),
      });

      const updatesByShapeId = new Map<string, Shape>();
      // Each wall's true mitered footprint (outer-start, inner-start, inner-end, outer-end), in
      // WORLD space - converted to the wall's own local space once its FINAL orientation is
      // known below, since orientRoomWallsToExterior may still flip the wall's quaternion.
      const worldFootprintByShapeId = new Map<string, [THREE.Vector2, THREE.Vector2, THREE.Vector2, THREE.Vector2]>();
      for (let i = 0; i < loopLen; i++) {
        const ew = edgeWalls[i];
        if (!ew) continue;
        const start = cornerPoints[i];
        const end = cornerPoints[(i + 1) % loopLen];
        const length = start.distanceTo(end);
        if (length < 0.01) continue;
        const angle = Math.atan2(ew.dir.y, ew.dir.x);
        const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angle);
        const midX = (start.x + end.x) / 2;
        const midZ = (start.y + end.y) / 2;
        const original = next.find(s => s.id === ew.shapeId)!;
        updatesByShapeId.set(ew.shapeId, {
          ...original,
          position: [midX, assembly.datumZ + ew.wallH / 2, midZ],
          quaternion: [quat.x, quat.y, quat.z, quat.w] as [number, number, number, number],
          args: [length, ew.wallH, ew.thickness],
        });
        worldFootprintByShapeId.set(ew.shapeId, [
          outerCornerPoints[i], innerCornerPoints[i],
          innerCornerPoints[(i + 1) % loopLen], outerCornerPoints[(i + 1) % loopLen],
        ]);
      }

      next = next.map(s => updatesByShapeId.get(s.id) ?? s);

      const oriented = orientRoomWallsToExterior(next, roomPoly2D);
      const flipped = oriented.filter((s, idx) => s.type === 'wall' && s.quaternion !== next[idx]?.quaternion).map(s => s.id);
      if (flipped.length) {
        diagLog('WALL_MITER', `orientRoomWallsToExterior flipped ${flipped.length} wall(s)`, { flipped });
      }

      // Convert each wall's world-space mitered footprint into its own local space (X = along
      // length, Z = thickness, origin at its now-final position), using its FINAL quaternion so
      // the footprint matches whatever orientRoomWallsToExterior settled on above.
      const withMiterFootprints = oriented.map(s => {
        const worldFootprint = worldFootprintByShapeId.get(s.id);
        if (!worldFootprint) return s;
        const pos = new THREE.Vector3(...s.position);
        const invQuat = new THREE.Quaternion(...(s.quaternion || [0, 0, 0, 1])).invert();
        const localFootprint = worldFootprint.map(p => {
          const local = new THREE.Vector3(p.x - pos.x, 0, p.y - pos.z).applyQuaternion(invQuat);
          return [local.x, local.z] as [number, number];
        }) as [[number, number], [number, number], [number, number], [number, number]];
        return { ...s, wallMiterFootprint: localFootprint };
      });

      return assembly.updatedTerrainData && assembly.modifiedTerrainShapeId
        ? withMiterFootprints.map(s => s.id === assembly.modifiedTerrainShapeId ? { ...s, terrainData: assembly.updatedTerrainData! } : s)
        : withMiterFootprints;
    });

    commitHistory();
    finalizeWallChain();
    setMeasurements('Watertight Room Created: Monolithic floor slab & terrain excavation assembled.');
  }, [wallVertices, createWallSegment, shapes, wallToolSettings, wallJustification, activeStory, addShape, setShapes, commitHistory, finalizeWallChain, setMeasurements]);

  // Listen for external close room requests from toolbar/palette
  useEffect(() => {
    const handleCloseRoomEvent = () => {
      if (activeTool === 'wall') {
        if (wallVertices.length >= 2) {
          closeWallLoopAndAssembleRoom();
        } else {
          finalizeWallChain();
        }
      }
    };
    window.addEventListener('polyform:close-wall-room', handleCloseRoomEvent);
    return () => {
      window.removeEventListener('polyform:close-wall-room', handleCloseRoomEvent);
    };
  }, [activeTool, wallVertices, closeWallLoopAndAssembleRoom, finalizeWallChain]);

  const finalizeCivilRoadDraft = useCallback(() => {
    if (activeSplineDraft.length < 2) return;
    const sanitizedDraft = activeSplineDraft.map(p => [p[0], sanitizeElevation(p[1]), p[2]] as [number, number, number]);
    const deduped = deduplicateKnots(sanitizedDraft, 0.15);
    if (deduped.length < 2) return;
    const finalPoints = clampSplineGradeWithTransitions(deduped, civilRoadSettings.maxGradePercent);

    const newRoad: RoadModifier = {
      id: `road-${Date.now()}`,
      name: `Road ${terrainModifiers.filter(m => m.type === 'road').length + 1}`,
      type: 'road',
      enabled: true,
      points: finalPoints,
      width: civilRoadSettings.width,
      maxGradePercent: civilRoadSettings.maxGradePercent,
      bankingAngle: 0,
      profile: {
        width: civilRoadSettings.curbWidth,
        height: civilRoadSettings.curbHeight,
        ditchWidth: civilRoadSettings.ditchWidth,
        ditchDepth: civilRoadSettings.ditchDepth,
        hasCurb: civilRoadSettings.hasCurb,
        hasDitch: civilRoadSettings.hasDitch,
      },
      markings: civilRoadSettings.markings,
    };
    addTerrainModifier(newRoad);
    setSelectedModifierId(newRoad.id);
    setActiveSplineDraft([]);
    setMeasurements(`Created Spline Road (${newRoad.points.length} alignment knots).`);

    // Immediately grade terrain underneath the new road corridor to prevent clashes
    const terrainShape = shapes.find(s => s.type === 'terrain' && s.terrainData);
    if (terrainShape) {
      const updated = applyRoadGradingToTerrain(terrainShape, newRoad);
      if (updated) {
        setShapes(prev => prev.map(s => s.id === terrainShape.id ? { ...s, terrainData: updated } : s));
      }
    }
  }, [activeSplineDraft, civilRoadSettings, terrainModifiers, addTerrainModifier, setSelectedModifierId, setActiveSplineDraft, setMeasurements, shapes, setShapes]);

  const closeBezierLoop = useCallback(() => {
    let currentKnots = bezierKnots.length > 0 ? bezierKnots : bezierToolRef.current.getKnots();
    // A double-click (or a click on the start point) can leave extra knots on top of the last
    // one or the first one: drop them so the loop closes cleanly.
    currentKnots = currentKnots.filter((k, i) => i === 0 || k.point.distanceTo(currentKnots[i - 1].point) > 0.02);
    while (currentKnots.length > 2 && currentKnots[currentKnots.length - 1].point.distanceTo(currentKnots[0].point) < 0.02) currentKnots = currentKnots.slice(0, -1);
    if (currentKnots.length < 2) return;

    const normal = (bezierActivePlane ? bezierActivePlane.normal.clone() : new THREE.Vector3(0, 1, 0)).normalize();
    const knots: BezierKnotInput[] = currentKnots.map(k => ({
      point: [k.point.x, k.point.y, k.point.z],
      handleIn: k.handleIn ? [k.handleIn.x, k.handleIn.y, k.handleIn.z] : null,
      handleOut: k.handleOut ? [k.handleOut.x, k.handleOut.y, k.handleOut.z] : null,
      mode: k.mode,
    }));
    recordAction(actionLabel('Bézier tool'), {
      sdk: `sdk.drawing.bezier(${JSON.stringify({ knots, resolution: bezierResolution, normal: [normal.x, normal.y, normal.z] })});`,
    });
    // Tessellated, flattened onto the drawing plane and committed as a kernel surface like the
    // other shape tools, with the knots kept on the surface for editing the curve later.
    const committed = commitBezierSurface(kernelHost, knots, bezierResolution, { x: normal.x, y: normal.y, z: normal.z });
    if (!committed.ok) {
      if (committed.reason === 'too few points') return;
      setMeasurements(committed.reason === 'crosses itself'
        ? 'A closed Bézier shape cannot cross itself.'
        : `Could not create the Bézier surface: ${committed.reason ?? 'unknown error'}.`);
      return;
    }
    const ringCount = committed.points;
    bumpKernel();
    setActiveTool('select');
    setSelectedId(null);
    setSelectedIds([]);
    setSelectedFaceIds(committed.faces);

    diagLog('SDK', 'Bézier closed loop surface created', { faces: committed.faces.length, vertexCount: ringCount });
    setMeasurements(`Created Bézier surface (${ringCount} points) ready for Offset or Push/Pull.`);

    setBezierKnots([]);
    setBezierActivePlane(null);
    setBezierCandidatePos(null);
    setBezierHoveredKnotIndex(null);
    setSnapIndicator(null);
    setIsDraggingBezierHandle(false);
    bezierToolRef.current.activate();
  }, [bezierKnots, bezierResolution, bezierActivePlane, kernelHost, bumpKernel, setActiveTool, setSelectedId, setSelectedIds, setSelectedFaceIds, setMeasurements, diagLog]);

  const finishBezierOpenPath = useCallback(() => {
    const currentKnots = bezierKnots.length > 0 ? bezierKnots : bezierToolRef.current.getKnots();
    if (currentKnots.length < 2) return;

    const tessPts = tessellateEntireCurve(currentKnots, false, bezierResolution);
    if (tessPts.length < 2) return;

    const newShape: Shape = {
      id: Math.random().toString(36).substr(2, 9),
      name: `Bézier Curve ${shapes.filter(s => s.type === 'bezier').length + 1}`,
      type: 'bezier',
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      args: {
        points: tessPts.map(p => [p.x, p.y, p.z]),
        bezierKnots: currentKnots.map(k => ({
          point: [k.point.x, k.point.y, k.point.z],
          handleIn: k.handleIn ? [k.handleIn.x, k.handleIn.y, k.handleIn.z] : null,
          handleOut: k.handleOut ? [k.handleOut.x, k.handleOut.y, k.handleOut.z] : null,
          mode: k.mode
        })),
        isClosed: false,
        resolution: bezierResolution
      },
      color: activeMaterial || '#0063A3',
      roughness: activePBR.roughness,
      metalness: activePBR.metalness,
      opacity: activePBR.opacity
    };

    addShape(newShape);
    commitHistory();
    setActiveTool('select');
    setSelectedId(newShape.id);
    setSelectedIds([newShape.id]);

    setMeasurements(`Created open Bézier curve path (${tessPts.length} points).`);

    setBezierKnots([]);
    setBezierActivePlane(null);
    setBezierCandidatePos(null);
    setBezierHoveredKnotIndex(null);
    setSnapIndicator(null);
    setIsDraggingBezierHandle(false);
    bezierToolRef.current.activate();
  }, [bezierKnots, bezierResolution, activeMaterial, activePBR, addShape, commitHistory, setActiveTool, setSelectedId, setSelectedIds, setMeasurements, shapes]);

  // Listen for external Bézier commands (from Modifier Palette or Toolbar)
  useEffect(() => {
    const handleCloseBezier = () => {
      if (activeTool === 'bezier') closeBezierLoop();
    };
    const handleFinishBezier = () => {
      if (activeTool === 'bezier') finishBezierOpenPath();
    };
    const handleSetRes = (e: any) => {
      if (e.detail?.resolution) {
        setBezierResolution(e.detail.resolution);
        bezierToolRef.current.updateResolution(e.detail.resolution);
      }
    };
    const handleCancelBezier = () => {
      if (activeTool === 'bezier') {
        setBezierKnots([]);
        setBezierActivePlane(null);
        setBezierCandidatePos(null);
        setBezierHoveredKnotIndex(null);
        setSnapIndicator(null);
        setIsDraggingBezierHandle(false);
        bezierToolRef.current.activate();
      }
    };

    window.addEventListener('polyform:close-bezier-loop', handleCloseBezier);
    window.addEventListener('polyform:finish-bezier-path', handleFinishBezier);
    window.addEventListener('polyform:set-bezier-resolution', handleSetRes);
    window.addEventListener('polyform:cancel-bezier', handleCancelBezier);

    return () => {
      window.removeEventListener('polyform:close-bezier-loop', handleCloseBezier);
      window.removeEventListener('polyform:finish-bezier-path', handleFinishBezier);
      window.removeEventListener('polyform:set-bezier-resolution', handleSetRes);
      window.removeEventListener('polyform:cancel-bezier', handleCancelBezier);
    };
  }, [activeTool, closeBezierLoop, finishBezierOpenPath]);

  // Terrains as drawn: ponds and lakes dig their basins on the fly (never saved into the terrain).
  const dugTerrains = useMemo(() => terrainsWithWaterBasins(shapes), [shapes]);
  const siteGhosts = useMemo(() => {
    const ground = findSiteGround(shapes);
    return ground?.terrainData?.site?.showRemoved ? removedBuildings(ground.terrainData.siteExisting, shapes) : [];
  }, [shapes]);

  // The imported site's Google layer and building styling (WorldView > 3D Site).
  const googleStatus = useGoogleTilesStatus();
  const siteGround = useMemo(() => findSiteGround(shapes), [shapes]);
  const siteInfo = siteGround?.terrainData?.site;
  const googleLayer = siteInfo?.googleContext && siteGround ? { site: siteInfo, groundId: siteGround.id } : null;
  const googleBuildings = useMemo(
    () => (googleLayer ? shapes.filter(s => s.type === 'site_building' && !!s.siteBuildingData && !s.hidden) : []),
    [shapes, googleLayer?.site.googleContext], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const googleGroundAt = useCallback((x: number, z: number) => {
    const t = siteGround?.terrainData;
    if (!siteGround || !t) return 0;
    return siteGround.position[1] + gridHeightAt(t, x - siteGround.position[0], z - siteGround.position[2]);
  }, [siteGround]);
  const siteSatelliteForStyle = siteInfo?.styledBuildings ? siteSatelliteUrl(siteInfo, googleMapsApiKey || '') : null;
  const siteStyleFor = (shape: Shape) => {
    if (!siteInfo?.styledBuildings || !shape.siteBuildingData) return undefined;
    return { look: buildingLook(shape.siteBuildingData), satelliteUrl: siteSatelliteForStyle, size: siteInfo.size };
  };

  /**
   * The fence tool builds one editable fence from the clicked path, live: it appears at the
   * second click and grows with each click, so finishing (Enter, double-click, Escape or
   * clicking the first point) never discards what was drawn.
   */
  const liveFenceIdRef = useRef<string | null>(null);
  const glassWeather = useGlassWeather();
  const commitFenceRun = useCallback((vertices: THREE.Vector3[], closed: boolean) => {
    if (vertices.length < 2) return;
    const cx = vertices.reduce((sum, v) => sum + v.x, 0) / vertices.length;
    const cz = vertices.reduce((sum, v) => sum + v.z, 0) / vertices.length;
    const settings = fenceToolSettings;
    let length = 0;
    for (let i = 1; i < vertices.length; i++) length += Math.hypot(vertices[i].x - vertices[i - 1].x, vertices[i].z - vertices[i - 1].z);
    if (closed) length += Math.hypot(vertices[0].x - vertices[vertices.length - 1].x, vertices[0].z - vertices[vertices.length - 1].z);
    const points = vertices.map(v => [v.x - cx, v.z - cz] as [number, number]);
    const liveId = liveFenceIdRef.current;
    const live = liveId ? shapes.find(s => s.id === liveId && s.fenceData) : undefined;
    if (live) {
      setShapes(prev => prev.map(s => s.id !== live.id ? s : {
        ...s,
        name: s.name.replace(/\([^)]*\)$/, `(${formatValue(length, unit, 1)})`),
        position: [cx, 0, cz], rotation: [0, 0, 0], quaternion: undefined, scale: [1, 1, 1],
        args: [length, settings.height],
        fenceData: { ...s.fenceData!, points, closed },
      }));
      diagLog('TOOL', 'Fence extended', { points: vertices.length, closed, length });
      return;
    }
    const count = shapes.filter(s => s.type === 'fence').length + 1;
    const newShape: Shape = {
      id: Math.random().toString(36).substr(2, 9),
      name: `${fenceStyleInfo(settings.style).label} Fence ${count} (${formatValue(length, unit, 1)})`,
      type: 'fence',
      position: [cx, 0, cz],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      args: [length, settings.height],
      color: settings.color,
      fenceData: {
        points,
        closed,
        style: settings.style,
        height: settings.height,
        seed: Math.floor(Math.random() * 12) + 1,
        finish: settings.finish,
        color: settings.color,
      },
    };
    liveFenceIdRef.current = newShape.id;
    addShape(newShape);
    commitHistory();
    recordAction(actionLabel(`Add ${newShape.name}`), {
      sdk: `sdk.landscape.addFence(${JSON.stringify(vertices.map(v => [v.x, v.z]))}, ${JSON.stringify({
        id: newShape.id, name: newShape.name, closed, style: settings.style, height: settings.height,
        color: settings.color, finish: settings.finish, seed: newShape.fenceData!.seed,
      })});`,
    });
    diagLog('TOOL', 'Fence placed', { style: settings.style, points: vertices.length, closed, length });
  }, [fenceToolSettings, shapes, setShapes, unit, addShape, commitHistory, recordAction, diagLog]);

  /** Ground height for the pond outline preview (the terrain as drawn, basins included). */
  const waterPreviewGround = useCallback((x: number, z: number) => {
    const terrain = shapes.find(s => s.type === 'terrain' && !s.hidden && s.terrainData
      && Math.abs(x - s.position[0]) <= s.terrainData.width / 2 && Math.abs(z - s.position[2]) <= s.terrainData.depth / 2);
    return terrain ? sampleTerrainElevation(x, z, dugTerrains.get(terrain.id) ?? terrain) : 0;
  }, [shapes, dugTerrains]);

  /** Where a pointer ray meets the ground, for the fence and water tools (see groundUnderRay). */
  const pointerGround = (ray: THREE.Ray) => groundUnderRay(ray, waterPreviewGround);

  /** The route tool adds a walking or driving route to the imported site (see lib/worldSite/streets.ts). */
  const commitSiteRoute = useCallback((vertices: THREE.Vector3[], closed: boolean) => {
    if (!findSiteGround(shapes)) {
      setMeasurements('Routes belong to an imported 3D site: import one in World View first.');
      return;
    }
    const pts = vertices.map(v => [+v.x.toFixed(2), +v.z.toFixed(2)] as [number, number]);
    if (closed && pts.length > 2) pts.push([...pts[0]!]);
    if (pts.length < 2) return;
    const kind = routeTool.kind;
    setShapes(prev => withDrawnRoute(prev, kind, pts));
    commitHistory();
    recordAction(actionLabel(kind === 'road' ? 'Add driving route' : 'Add walking route'), {
      sdk: `sdk.worldView.addRoute(${JSON.stringify(kind)}, ${JSON.stringify(pts)});`,
    });
    setMeasurements(`${kind === 'road' ? 'Driving' : 'Walking'} route added. ${kind === 'road' ? 'Cars' : 'People'} use it when street life is shown.`);
  }, [shapes, setShapes, commitHistory, recordAction, setMeasurements]);

  /** The water tool fills the clicked outline, digging a basin into the terrain under it. */
  const commitWaterBody = useCallback((vertices: THREE.Vector3[]) => {
    if (vertices.length < 3) {
      setMeasurements('Water outline needs at least 3 points.');
      return;
    }
    const outline = vertices.map(v => ({ x: v.x, z: v.z }));
    const cx = outline.reduce((sum, p) => sum + p.x, 0) / outline.length;
    const cz = outline.reduce((sum, p) => sum + p.z, 0) / outline.length;
    const terrain = shapes.find(s => s.type === 'terrain' && !s.hidden && s.terrainData
      && Math.abs(cx - s.position[0]) <= s.terrainData.width / 2 && Math.abs(cz - s.position[2]) <= s.terrainData.depth / 2);
    const level = terrain
      ? defaultWaterLevel(outline, (x, z) => sampleTerrainElevation(x, z, terrain))
      : vertices[0].y + 0.02;
    const xs = outline.map(p => p.x), zs = outline.map(p => p.z);
    const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
    const kind = extent > 30 ? 'Lake' : 'Pond';
    const count = shapes.filter(s => s.type === 'water').length + 1;
    const newShape: Shape = {
      id: Math.random().toString(36).substr(2, 9),
      name: `${kind} ${count}`,
      type: 'water',
      position: [cx, level, cz],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      args: [],
      color: '#3d7a8c',
      waterData: {
        points: outline.map(p => [p.x - cx, p.z - cz] as [number, number]),
        depth: waterToolSettings.depth,
        clarity: waterToolSettings.clarity,
        dig: true,
      },
    };
    addShape(newShape);
    commitHistory();
    recordAction(actionLabel(`Add ${newShape.name}`), {
      sdk: `sdk.landscape.addPond(${JSON.stringify(outline.map(p => [p.x, p.z]))}, ${JSON.stringify({
        id: newShape.id, name: newShape.name, depth: waterToolSettings.depth, clarity: waterToolSettings.clarity, level,
      })});`,
    });
    diagLog('TOOL', `${kind} placed`, { points: vertices.length, level, extent });
  }, [shapes, waterToolSettings, addShape, commitHistory, recordAction, diagLog, setMeasurements]);

  // Ground for the patio tool: as drawn (for the cursor), and before patio levelling (for
  // building patios and decks, so levelling never feeds back into itself). The latter is only
  // rebuilt when a terrain itself changes, so editing a patio doesn't rebuild every other one.
  const patioDrawnGround = useMemo(() => patioGroundHelpers(shapes, dugTerrains, sampleTerrainElevation).drawnGround, [shapes, dugTerrains]);
  const originalGroundRef = useRef<{ terrains: Shape[]; groundAt: (x: number, z: number) => number } | null>(null);
  const terrainShapes = shapes.filter(s => s.type === 'terrain');
  if (!originalGroundRef.current || originalGroundRef.current.terrains.length !== terrainShapes.length
    || originalGroundRef.current.terrains.some((t, i) => t !== terrainShapes[i])) {
    originalGroundRef.current = { terrains: terrainShapes, groundAt: patioGroundHelpers(terrainShapes, new Map(), sampleTerrainElevation).originalGround };
  }
  const patioOriginalGround = originalGroundRef.current.groundAt;

  /**
   * A drawn outline becomes a patio or deck: level with the house floor when drawn against it
   * (or with a neighbouring patio it joins), trimmed back where it overlaps an existing patio.
   */
  const commitPatio = useCallback((points: SnappedPoint[], bulges: number[], closure?: PatioClosure) => {
    if (points.length < 3) return;
    const settings = patioToolSettings;
    let world = points.map(p => p.p);
    // Building floor first, then a neighbouring patio's level; a fence leaves the ground level.
    const walls = points.filter(p => p.wall).map(p => p.wall!.floor);
    const neighbourLevels = points.filter(p => p.target?.kind === 'patio' && p.target.level !== undefined).map(p => p.target!.level!);
    const joinLevels: number[] = closure?.level !== undefined ? [closure.level] : walls.length ? walls : neighbourLevels.slice(0, 1);
    const kind = settings.kind;
    const targets = buildCloseTargets(shapes, patioOriginalGround);
    // Never overlap an existing patio or deck: share its edge instead.
    const others = shapes.filter(s => s.type === 'patio' && !s.hidden && s.patioData?.kind !== 'balcony').map(patioWorldPath).filter((p): p is NonNullable<typeof p> => !!p);
    const trimmed = trimAgainstPatios(world, bulges, others);
    if (trimmed && trimmed.points.length < 3) {
      setMeasurements('That outline is entirely covered by an existing patio or deck, so nothing was added.');
      return;
    }
    let joinedByClosure = closure?.joined;
    if (trimmed) {
      world = trimmed.points;
      bulges = trimmed.bulges;
      joinedByClosure = undefined;
      setMeasurements('Trimmed back to the existing patio it overlapped, so the two share an edge.');
    }
    // An edge along a wall, fence or patio gets no kerb, railing or steps.
    const alongWall = patioWallEdges(world, bulges, wallFaces(shapes));
    const alongTarget = joinedEdges(world, bulges, targets);
    if (!joinLevels.length) {
      // Sharing an edge with a patio (e.g. after trimming) takes that patio's level.
      const neighbour = targets.find(t => t.kind === 'patio' && joinedEdges(world, bulges, [t]).some(Boolean));
      if (neighbour?.level !== undefined) joinLevels.push(neighbour.level);
    }
    const level = patioLevel(world, bulges, kind, settings.deckHeight, joinLevels, patioOriginalGround);
    const count = shapes.filter(s => s.type === 'patio' && s.patioData?.kind === kind).length + 1;
    const patioInputs = {
      id: Math.random().toString(36).substr(2, 9),
      name: `${kind === 'deck' ? 'Deck' : 'Patio'} ${count}`,
      world,
      bulges,
      level,
      wallEdges: world.map((_, i) => !!(alongWall[i] || alongTarget[i] || joinedByClosure?.[i])),
      kind,
      template: settings.template,
    };
    const newShape = makePatioShape(patioInputs);
    addShape(newShape);
    commitHistory();
    setSelectedId(newShape.id);
    recordAction(actionLabel(`Add ${newShape.name}`), {
      sdk: `sdk.landscape.addPatio(${JSON.stringify(world)}, ${JSON.stringify({
        id: patioInputs.id, name: patioInputs.name, kind, bulges, level, wallEdges: patioInputs.wallEdges, settings: settings.template,
      })});`,
    });
    diagLog('TOOL', `${newShape.name} placed`, { points: world.length, level, againstWall: joinLevels.length > 0, closedAlong: !!closure, trimmed: !!trimmed });
  }, [patioToolSettings, patioOriginalGround, shapes, addShape, commitHistory, setSelectedId, recordAction, diagLog, setMeasurements]);

  /** A balcony placed at a door: on the outside of its wall, which it then moves with. */
  const commitBalcony = useCallback((placement: BalconyPlacement) => {
    const template = { ...DEFAULT_BALCONY_LOOK, ...patioToolSettings.template };
    const balcony = {
      ...DEFAULT_BALCONY, ...template.balcony, hostOpeningId: placement.openingId,
      level: undefined, railGaps: undefined, stepFlight: undefined,
      depth: patioToolSettings.balconyDepth, margin: patioToolSettings.balconyMargin,
      ...(() => {
        // Left and right reach from the door's centre, for the width sliders.
        const opening = shapes.find(s => s.id === placement.openingId);
        const half = (Array.isArray(opening?.args) ? (opening!.args as number[])[0] ?? 0.9 : 0.9) / 2;
        return { widthLeft: half + patioToolSettings.balconyMargin, widthRight: half + patioToolSettings.balconyMargin };
      })(),
      front: template.balcony?.front ?? 'curve', curvedWall: placement.curved,
    };
    const count = shapes.filter(s => s.type === 'patio' && s.patioData?.kind === 'balcony').length + 1;
    const newShape: Shape = {
      ...makePatioShape({
        id: Math.random().toString(36).substr(2, 9),
        name: `${balcony.support === 'juliet' ? 'Juliet balcony' : 'Balcony'} ${count}`,
        world: placement.world,
        bulges: placement.world.map(() => 0),
        level: placement.level,
        wallEdges: placement.wallEdges,
        kind: 'balcony',
        template: { ...template, balcony },
      }),
      hostWallId: placement.wallId,
    };
    addShape(newShape);
    commitHistory();
    setSelectedId(newShape.id);
    recordAction(actionLabel(`Add ${newShape.name || newShape.type}`));
    const warnings = balconyWarnings(newShape.patioData!);
    setMeasurements(warnings.length ? `${newShape.name} placed. ${warnings.join(' ')}` : `${newShape.name} placed. Set its widths, depth and levels in the panel; it moves with its wall.`);
    diagLog('TOOL', `${newShape.name} placed`, { level: placement.level, wall: placement.wallId, opening: placement.openingId });
  }, [patioToolSettings, shapes, addShape, commitHistory, setSelectedId, recordAction, diagLog, setMeasurements]);

  const finalizeFenceChain = useCallback((closed = false) => {
    // The fence already exists (built live); closing is the only change finishing can make.
    if (activeTool === 'fence' && closed) commitFenceRun(fenceVertices, true);
    liveFenceIdRef.current = null;
    if (activeTool === 'water') commitWaterBody(fenceVertices);
    if (activeTool === 'site_route') commitSiteRoute(fenceVertices, closed);
    setFenceVertices([]);
    setFencePlane(null);
    setFenceCandidatePos(null);
    setFenceHoveredVertex(null);
    setMeasurements('');
  }, [setMeasurements, activeTool, commitFenceRun, commitWaterBody, commitSiteRoute, fenceVertices]);

  /** The first modelled surface under the cursor for the railing tool (not other railings), else the ground. */
  const railingSurfaceUnderCursor = (): THREE.Vector3 | null => {
    const hit = raycaster.intersectObjects(scene.children, true).find(i => {
      if (!i.object.visible || !(i.object as THREE.Mesh).isMesh) return false;
      for (let o: THREE.Object3D | null = i.object; o; o = o.parent) {
        if (o.userData?.isShape || o.userData?.isKernelGeometry) {
          return shapes.find(s => s.id === o!.userData.id)?.type !== 'railing';
        }
      }
      return false;
    });
    return hit ? hit.point.clone() : pointerGround(raycaster.ray);
  };

  const createFenceRailingSegment = useCallback((pA: THREE.Vector3, pB: THREE.Vector3, tool: 'fence' | 'railing') => {
    // Length along the ground plan; a railing section also records how much it rises end to
    // end, so it follows a slope instead of hanging level from its midpoint.
    const dist = Math.hypot(pB.x - pA.x, pB.z - pA.z);
    if (dist < 0.1) return null;
    const rise = pB.y - pA.y;

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
      args: tool === 'railing' ? [dist, height, rise] : [dist, height],
      color,
      roughness: activePBR.roughness ?? 0.7,
      metalness: activePBR.metalness ?? 0.1,
      opacity: activePBR.opacity ?? 1
    };

    addShape(newShape);
    commitHistory();
    recordAction(actionLabel(`Add ${newShape.name || newShape.type}`));
    return newShape;
  }, [activeMaterial, activePBR, addShape, commitHistory, shapes, recordAction, unit]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Walk Mode owns all keyboard input while active (WASD, Space, Escape,
      // arrows) - every other tool's single-key shortcuts below (w, d, s for
      // Scale, undo/redo, delete, etc.) must be suppressed so they don't fire
      // while the player is just trying to walk. See WalkModeController.
      if (activeTool === 'walk') return;
      // The patio and protractor tools take their own keys (Enter, Esc, Backspace, typed angles).
      if (activeTool === 'patio' || activeTool === 'protractor') return;
      if (isDeveloperConsoleOpen) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) { if (e.key === 'Enter' && rectangleInputState.active) { e.preventDefault(); finalizeRectangleInput(); } else if (e.key === 'Escape' && rectangleInputState.active) { e.preventDefault(); setRectangleInputState({ active: false, startPoint: null, width: '', depth: '' }); } return; }
      
      const key = e.key.toLowerCase();

      // Arrow keys rotate the pending block 90° at a time before it's placed
      // (the ghost under the cursor updates live); a click places it.
      // Escape exits block-placement mode entirely.
      if (activeTool === 'block_picker' && blockPlacementDraftRef.current) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const dir = e.key === 'ArrowLeft' ? -1 : 1;
          setBlockPlacementDraft(prev => prev ? { ...prev, rotationSteps: (prev.rotationSteps + dir + 4) % 4 } : prev);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setBlockPlacementDraft(null);
          setActiveBlockPart(null);
          setActiveTool('select');
          setMeasurements('Block placement cancelled.');
          return;
        }
      }

      // Arrow keys to adjust polygon sides when polygon tool is active
      if (activeTool === 'polygon') {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setPolygonSides(prev => {
            const next = Math.min(64, prev + 1);
            setMeasurements(`Polygon sides: ${next}`);
            return next;
          });
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setPolygonSides(prev => {
            const next = Math.max(3, prev - 1);
            setMeasurements(`Polygon sides: ${next}`);
            return next;
          });
          return;
        }
      }

      // Typed value (see tools/typedEntry.ts): while drawing, between chain clicks, or right after
      // a step. It shows in the status bar; Enter applies it, Escape clears it.
      if (!e.ctrlKey && !e.metaKey && !e.altKey && typedWantedRef.current() && acceptsTypedKey(e.key, typedLengthRef.current)) {
        e.preventDefault();
        const next = e.key === 'Backspace' ? typedLengthRef.current.slice(0, -1) : typedLengthRef.current + e.key;
        typedLengthRef.current = next;
        setTypedLength(next);
        setMeasurements(next ? `Typed: ${next}   (Enter to apply · Esc to clear)` : '');
        return;
      }

      // Delete the current selection. Placed after the numeric-length
      // Backspace handling above, and gated on nothing being actively
      // drawn — Backspace's OTHER job (erasing a typed length mid-gesture)
      // takes priority and returns before this is ever reached.
      if ((e.key === 'Delete' || e.key === 'Backspace') && !drawingStartRef.current) {
        if (kernelSelectedSetRef.current.size > 0) {
          e.preventDefault();
          kernelHost.transact(() => { deleteGroupFacesAndEdges(kernelHost.graph, [...kernelSelectedSetRef.current]); return true; });
          setSelectedFaceIds([]);
          bumpKernel();
          return;
        }
        if (selectedIdRef.current) {
          e.preventDefault();
          removeShape(selectedIdRef.current);
          setSelectedId(null);
          setSelectedIds([]);
          return;
        }
      }


      // Undo/Redo
      if (e.ctrlKey || e.metaKey) {
        if (key === 'z') {
          e.preventDefault();
          if (activeTool === 'wall' && wallVertices.length > 0) {
            // Undoing a vertex mid-chain must also remove the wall segment that click created
            // and drop its id from the chain tracking - otherwise a stray, never-updated wall
            // is left in the scene, and the length mismatch this leaves in
            // wallChainShapeIdsRef silently falls back to the old nearest-distance edge match
            // (which can grab a wall from a different, nearby room) for the rest of this room.
            if (wallVertices.length > 1) {
              const undoneWallId = wallChainShapeIdsRef.current.pop();
              if (undoneWallId) removeShape(undoneWallId);
            }
            setWallVertices(prev => prev.slice(0, -1));
            if (wallVertices.length <= 1) {
              finalizeWallChain();
            }
            return;
          } else if ((activeTool === 'fence' || activeTool === 'railing' || activeTool === 'water' || activeTool === 'site_route') && fenceVertices.length > 0) {
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
          } else if (activeTool === 'bezier' && bezierKnotsRef.current.length > 0) {
            const next = bezierKnotsRef.current.slice(0, -1);
            setBezierKnots(next);
            bezierToolRef.current.setState({ ...bezierToolRef.current.getState(), knots: next });
            if (next.length === 0) {
              setBezierActivePlane(null);
            }
            return;
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
      if (e.key === 'Escape' && typedLengthRef.current) {
        e.preventDefault();
        typedLengthRef.current = '';
        setTypedLength('');
        setMeasurements('');
        return;
      }

      if (e.key === 'Escape') {
        // Nothing in progress: Esc closes the group being edited.
        if (groupEditOpenRef.current && !drawingStartRef.current && wallVertices.length === 0 && polyVertices.length === 0) {
          exitGroupEditRef.current();
        }
        if (activeTool === 'wall' && wallVertices.length > 0) {
          diagLog('TOOL', 'Wall drawing cancelled', { vertexCount: wallVertices.length });
        }
        if ((activeTool === 'fence' || activeTool === 'railing' || activeTool === 'water' || activeTool === 'site_route') && fenceVertices.length > 0) {
          diagLog('TOOL', `${activeTool} drawing cancelled`, { vertexCount: fenceVertices.length });
        }
        if (activeTool === 'poly' && polyVertices.length > 0) {
          diagLog('TOOL', 'Poly drawing cancelled', { vertexCount: polyVertices.length });
        }
        if (activeTool === 'bezier' && bezierKnotsRef.current.length > 0) {
          diagLog('TOOL', 'Bézier drawing cancelled', { knotCount: bezierKnotsRef.current.length });
        }
        if (activeTool === 'road' && activeSplineDraftRef.current.length > 0) {
          setActiveSplineDraft([]);
          setMeasurements('Road alignment draft cancelled.');
        }
        if ((activeTool === 'pad-rect' || activeTool === 'pad-circle') && activePadDraft) {
          setActivePadDraft(null);
        }
        setSelectedModifierId(null);
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
        setTapeStart(null);
        setTapeEnd(null);
        setTapeGuide(null);
        setFollowMeProfile(null);
        setFollowMeHover(null);
        setSectionHover(null);
        setTypedLength('');
        setLastDrawTarget(null);
        setSelectedSurface(null);
        setContextMenu(null);
        setPolyVertices([]);
        setPolyPlane(null);
        setPolyNormal(null);
        setPolyCandidatePos(null);
        setBezierKnots([]);
        setBezierActivePlane(null);
        setBezierCandidatePos(null);
        setBezierHoveredKnotIndex(null);
        setIsDraggingBezierHandle(false);
        bezierToolRef.current.activate();
        setWallVertices([]);
        setWallPlane(null);
        setWallCandidatePos(null);
        setWallHoveredVertex(null);
        setFenceVertices([]); liveFenceIdRef.current = null;
        setFencePlane(null);
        setFenceCandidatePos(null);
        setFenceHoveredVertex(null);
        wallDragStartRef.current = null;
        // The arc in progress (the tool stays selected), and any held snap lock.
        if (arcToolRef.current && arcToolRef.current.current.phase !== 'inactive') setArcState(arcToolRef.current.escape());
        arcPlaneRef.current = null;
        arcFilletRef.current = [];
        arcFilletChosenRef.current = false;
        edgeLockRef.current = null;
        shiftLineRef.current = null;
        setOffsetPreviewPoints(null);
        return;
      }

      if (e.key === 'Enter') {
        // Shadows the closed-over state below with the refs' current
        // values for the rest of this block. This handler is one big
        // useEffect whose own dependency array only lists a handful of
        // the values it reads (see the comment by typedLengthRef above),
        // so a bare read of typedLength/drawingStart/drawingNormal/
        // lastDrawTarget/drawingStep/previewShape/bezierKnots/
        // activeSplineDraft here would reflect whatever was current the
        // last time the effect itself re-ran (typically on activeTool
        // change) rather than the actual state at the moment Enter
        // confirms a typed length mid-drawing. Shadowing once up front
        // means every existing read below - already correct in its own
        // logic - picks up the live value with no other changes needed.
        const typedLength = typedLengthRef.current;
        const drawingStart = drawingStartRef.current;
        const drawingNormal = drawingNormalRef.current;
        const lastDrawTarget = lastDrawTargetRef.current;
        const drawingStep = drawingStepRef.current;
        const previewShape = previewShapeRef.current;
        const bezierKnots = bezierKnotsRef.current;
        const activeSplineDraft = activeSplineDraftRef.current;
        if (typedLength.trim() && typedEnterRef.current(typedLength.trim())) {
          e.preventDefault();
          typedLengthRef.current = '';
          setTypedLength('');
          return;
        }
        if (activeTool === 'bezier') {
          e.preventDefault();
          if (typedLength.trim()) {
            const raw = typedLength.trim();
            // Check for segment count like '36s'
            const segMatch = /^(\d+)\s*s$/i.exec(raw);
            if (segMatch) {
              const segs = parseInt(segMatch[1], 10);
              if (segs >= 2 && segs <= 1000) {
                setBezierResolution(segs);
                bezierToolRef.current.updateResolution(segs);
                setMeasurements(`Bézier resolution set to ${segs} segments per span.`);
                setTypedLength('');
                return;
              }
            }
            // Check for length value
            const lenVal = parseFloat(raw);
            if (!isNaN(lenVal) && lenVal > 0) {
              const worldLen = unit === 'mm' ? lenVal / 1000 : unit === 'cm' ? lenVal / 100 : lenVal;
              bezierToolRef.current.setTangentLength(worldLen);
              setBezierKnots([...bezierToolRef.current.getKnots()]);
              setMeasurements(`Bézier tangent handle length locked to ${formatValue(worldLen, unit, 2)}.`);
              setTypedLength('');
              return;
            }
          }
          // Enter closes the shape (Shift+Enter leaves the curve open).
          if (bezierKnots.length >= 3 && !e.shiftKey) {
            closeBezierLoop();
            return;
          }
          if (bezierKnots.length >= 2) {
            finishBezierOpenPath();
            return;
          }
        }
        if (activeTool === 'wall' && wallVertices.length > 0) {
          e.preventDefault();
          finalizeWallChain();
          return;
        }
        if (activeTool === 'road' && activeSplineDraft.length >= 2) {
          e.preventDefault();
          finalizeCivilRoadDraft();
          return;
        }
        if ((activeTool === 'fence' || activeTool === 'railing' || activeTool === 'water' || activeTool === 'site_route') && fenceVertices.length > 0) {
          e.preventDefault();
          finalizeFenceChain();
          return;
        }
        // Primitives (objects): a typed radius while dragging. Line and the shape tools are handled
        // by typedEnterRef above, through the same kernel paths as the mouse.
        if (['sphere', 'cone', 'pyramid', 'donut', 'dome'].includes(activeTool) && drawingStep === 1 && drawingStart && drawingNormal && typedLength.trim()) {
          e.preventDefault();

          const typedRadius = parseTypedLength(typedLength, unit);
          if (typedRadius !== null && typedRadius > 0) {
            const worldRadius = typedRadius;

            const up = new THREE.Vector3(0, 1, 0);
            if (Math.abs(drawingNormal.dot(up)) > 0.99) { up.set(0, 0, 1); }
            const tangent = new THREE.Vector3().crossVectors(drawingNormal, up).normalize();
            const zAxis = new THREE.Vector3().crossVectors(tangent, drawingNormal).normalize();
            const basisMatrix = new THREE.Matrix4().makeBasis(tangent, drawingNormal, zAxis);
            const quat = new THREE.Quaternion().setFromRotationMatrix(basisMatrix);
            const quatArray: [number, number, number, number] = [quat.x, quat.y, quat.z, quat.w];
            const offsetPos = drawingStart.clone().add(drawingNormal.clone().multiplyScalar(0.005));

            let newShape: { type: string; position: [number, number, number]; quaternion: [number, number, number, number]; args: number[] } | null = null;

            if (activeTool === 'sphere') {
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
                const typedId = Math.random().toString(36).substr(2, 9);
                addShape({
                  id: typedId,
                  type: newShape.type as any,
                  position: newShape.position,
                  quaternion: newShape.quaternion,
                  args: newShape.args,
                  color: activeMaterial,
                  roughness: activePBR.roughness,
                  metalness: activePBR.metalness,
                  opacity: activePBR.opacity
                } as Shape);
                offerPrimitiveAdjust(typedId, newShape.type, drawingStart.clone(), drawingNormal.clone());
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
          const typedHeight = parseTypedLength(typedLength, unit);
          if (typedHeight !== null && typedHeight > 0) {
            const worldHeight = typedHeight;
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

            const heightId = Math.random().toString(36).substr(2, 9);
            addShape({
              id: heightId,
              type: previewShape.type as any,
              position: newPos2,
              quaternion: previewShape.quaternion,
              args: newArgs2,
              color: activeMaterial,
              roughness: activePBR.roughness,
              metalness: activePBR.metalness,
              opacity: activePBR.opacity
            } as Shape);
            offerPrimitiveAdjust(heightId, previewShape.type, drawingStart.clone(), drawingNormal.clone());

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
      } else if (
        (key === 'x' || key === 'y' || key === 'z') && (
          (drawingStartRef.current && ['rectangle', 'circle', 'line', 'triangle', 'sphere', 'cone', 'pyramid', 'donut', 'dome'].includes(activeTool))
          // Poly, Bézier and Arc keep their own points, not a drawing start: they lock once a point is placed.
          || (['poly', 'bezier', 'arc'].includes(activeTool) && lastSnapFromRef.current !== null)
        )
      ) {
        edgeLockRef.current = null;
        setAxisLock(prev => prev === key ? null : (key as 'x' | 'y' | 'z'));
        return;
      }

      // Tool Shortcuts
      if (activeTool === 'bezier' && (key === 'c' || key === 'C')) {
        e.preventDefault();
        if (bezierKnotsRef.current.length >= 2) {
          closeBezierLoop();
        }
        return;
      }

      if (activeTool === 'wall' && (key === 'c' || e.key === 'Enter')) {
        e.preventDefault();
        if (wallVertices.length >= 2) {
          closeWallLoopAndAssembleRoom();
        } else {
          finalizeWallChain();
        }
        return;
      }

      // Keys a tool uses for itself while it's active don't also switch tools: X/Y/Z lock an axis
      // in Move; Tab/J, T and H set a wall's justification, thickness and height; R and the
      // arrow/bracket keys turn stairs; and L in Select switches between lasso and box selection
      // (everywhere else L picks the Line tool).
      const toolOwnsKey =
        (activeTool === 'move' && (key === 'x' || key === 'y' || key === 'z'))
        || (activeTool === 'wall' && (e.key === 'Tab' || key === 'j' || key === 't' || key === 'h'))
        || ((activeTool === 'staircase' || activeTool === 'step') && key === 'r')
        || ((activeTool === 'select' || activeTool === 'lasso') && key === 'l');

      if (toolOwnsKey) {
        // Handled by the tool-specific blocks below.
      } else if (key === ' ') {
        e.preventDefault();
        setActiveTool('select');
      } else if (key === 'e') {
        setActiveTool('eraser');
      } else if (key === 'b') {
        setActiveTool('paint');
      } else if (key === 'r') {
        setActiveTool('rectangle');
      } else if (key === 'c' && activeTool !== 'wall' && activeTool !== 'bezier') {
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
      } else if (key === 'w') {
        setActiveTool('wall');
      }

      // Staircase & Step Tool specific in-flight rotation shortcuts
      if (activeTool === 'staircase' || activeTool === 'step') {
        if (e.key === 'ArrowLeft' || e.key === 'Left' || e.key === '[') {
          e.preventDefault();
          const step = e.shiftKey ? Math.PI / 12 : Math.PI / 2; // 15° with shift, 90° by default
          setStairRotationAngle(prev => {
            const next = (prev + step) % (Math.PI * 2);
            const deg = Math.round(((next * 180) / Math.PI) % 360);
            const normDeg = deg < 0 ? deg + 360 : deg;
            if (activeTool === 'step') {
              setMeasurements(`Single Step: 1.00m × 0.30m (Rise 0.18m) | Angle: ${normDeg}° [Use ← / → to rotate] | Click to place`);
            } else {
              setMeasurements(`Staircase: 12 Steps (Rise 2.16m, Run 3.60m) | Angle: ${normDeg}° [Use ← / → to rotate] | Click to place`);
            }
            // Update live preview shape quaternion immediately
            const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), next);
            setPreviewShape(p => p ? { ...p, quaternion: [quat.x, quat.y, quat.z, quat.w] } : null);
            return next;
          });
          return;
        } else if (e.key === 'ArrowRight' || e.key === 'Right' || e.key === ']' || key === 'r') {
          e.preventDefault();
          const step = e.shiftKey ? Math.PI / 12 : Math.PI / 2; // 15° with shift, 90° by default
          setStairRotationAngle(prev => {
            const next = (prev - step + Math.PI * 2) % (Math.PI * 2);
            const deg = Math.round(((next * 180) / Math.PI) % 360);
            const normDeg = deg < 0 ? deg + 360 : deg;
            if (activeTool === 'step') {
              setMeasurements(`Single Step: 1.00m × 0.30m (Rise 0.18m) | Angle: ${normDeg}° [Use ← / → to rotate] | Click to place`);
            } else {
              setMeasurements(`Staircase: 12 Steps (Rise 2.16m, Run 3.60m) | Angle: ${normDeg}° [Use ← / → to rotate] | Click to place`);
            }
            // Update live preview shape quaternion immediately
            const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), next);
            setPreviewShape(p => p ? { ...p, quaternion: [quat.x, quat.y, quat.z, quat.w] } : null);
            return next;
          });
          return;
        }
      }

      // In Select, L switches between lasso and box (marquee) selection
      if (key === 'l' && (activeTool === 'select' || activeTool === 'lasso') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const target = e.target as HTMLElement;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
          return;
        }
        e.preventDefault();
        setActiveTool('select');
        setSelectionShapeMode(prev => {
          const next = prev === 'lasso' ? 'marquee' : 'lasso';
          setMeasurements(`Selection Mode: ${next === 'lasso' ? 'Freehand Lasso' : 'Marquee Window'}`);
          return next;
        });
        return;
      }

      // Wall Tool specific in-flight shortcuts
      if (activeTool === 'wall') {
        if (e.key === 'Tab' || key === 'j') {
          e.preventDefault();
          const cycle: WallJustification[] = ['exterior', 'center', 'interior'];
          const current = wallJustification || 'exterior';
          const nextIdx = (cycle.indexOf(current) + 1) % cycle.length;
          const nextJust = cycle[nextIdx];
          setWallJustification(nextJust);
          setWallToolSettings(prev => ({ ...prev, justification: nextJust }));
          setMeasurements(`Wall Justification set to: ${nextJust.toUpperCase()} · Thickness: ${((wallToolSettings?.thickness || 0.2) * 1000).toFixed(0)}mm`);
        } else if (key === 't') {
          e.preventDefault();
          const currT = wallToolSettings?.thickness || 0.20;
          let nextT = 0.20;
          if (Math.abs(currT - 0.10) < 0.02) nextT = 0.20;
          else if (Math.abs(currT - 0.20) < 0.02) nextT = 0.30;
          else nextT = 0.10;
          setWallToolSettings(prev => ({ ...prev, thickness: nextT }));
          setMeasurements(`Wall Thickness set to: ${(nextT * 1000).toFixed(0)}mm · Justification: ${(wallJustification || 'exterior').toUpperCase()}`);
        } else if (key === 'h') {
          e.preventDefault();
          const currH = wallToolSettings?.height || 2.80;
          let nextH = 2.80;
          if (Math.abs(currH - 2.40) < 0.05) nextH = 2.80;
          else if (Math.abs(currH - 2.80) < 0.05) nextH = 3.20;
          else nextH = 2.40;
          setWallToolSettings(prev => ({ ...prev, height: nextH }));
          setMeasurements(`Wall Height set to: ${nextH.toFixed(2)}m · Thickness: ${((wallToolSettings?.thickness || 0.2) * 1000).toFixed(0)}mm`);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isDeveloperConsoleOpen, activeTool, undo, redo, setActiveTool, setSelectionShapeMode, polyVertices.length, finalizePoly, wallVertices.length, finalizeWallChain, fenceVertices.length, finalizeFenceChain, rectangleInputState.active, finalizeRectangleInput, wallJustification, wallToolSettings, setWallJustification, setWallToolSettings, closeWallLoopAndAssembleRoom, setMeasurements, closeBezierLoop, finishBezierOpenPath]);

  const [pointerDownInfo, setPointerDownInfo] = useState<{ time: number, pos: THREE.Vector3 } | null>(null);

  /** The Text tools: remember where the click landed and on what, then ask for the words. */
  const startTextPlacement = (point: THREE.Vector3, normal: THREE.Vector3) => {
    const towards = camera.position.clone().sub(point);
    setTextPlacement({
      kind: activeTool as 'text' | 'text3d',
      point: [point.x, point.y, point.z],
      normal: [normal.x, normal.y, normal.z],
      towardsViewer: [towards.x, towards.y, towards.z],
    });
  };

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    // Walk Mode handles its own placement click and pointer-lock entirely
    // through native listeners on the canvas element (see
    // WalkModeController) - every other tool's click behavior below
    // (selection, drawing, deselect-on-background, etc.) must not run
    // while it's active.
    // The patio tool draws through its own canvas listeners too (see PatioDrawTool).
    if (activeTool === 'walk' || activeTool === 'look' || activeTool === 'patio' || activeTool === 'protractor') return;
    pointerUpHandledRef.current = false;
    setPointerDownInfo({ time: Date.now(), pos: e.point.clone() });

    // Portal clicks are owned by TeleportPortalPreview's canvas listener.
    if (activeTool === 'teleport') return;

    if (activeTool === 'text' || activeTool === 'text3d') {
      e.stopPropagation();
      startTextPlacement(e.point.clone(), new THREE.Vector3(0, 1, 0));
      return;
    }

    if (activeTool === 'bezier') {
      e.stopPropagation();

      // What the pointer means: a corner, a crossing, a point on an edge, a line from the last
      // knot (tools/snapEngine.ts), or its own position.
      const clickSnap = snapCurve('bezier');

      // If clicking first knot -> finalize and close loop
      if ((bezierHoveredKnotIndex === 0 || clickSnap.kind === 'close') && bezierKnots.length >= 2) {
        clearSnapLocks();
        closeBezierLoop();
        return;
      }

      const intersects = raycaster.intersectObjects(scene.children, true);
      const shapeIntersect = intersects.find(i => (i.object.userData?.isShape || i.object.userData?.id) && i.object !== e.object);

      let normal = new THREE.Vector3(0, 1, 0);
      let onId: string | null = null;
      let p = new THREE.Vector3();

      if (shapeIntersect && shapeIntersect.face) {
        normal = shapeIntersect.face.normal.clone().applyQuaternion(shapeIntersect.object.quaternion).normalize();
        onId = shapeIntersect.object.userData.id;
        p = shapeIntersect.point.clone();
      } else {
        const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        if (raycaster.ray.intersectPlane(ground, p)) {
          // valid ground plane hit
        } else {
          p = e.point ? e.point.clone() : new THREE.Vector3();
        }
      }

      p = snappedOr(p, clickSnap);
      clearSnapLocks();

      if (bezierKnots.length === 0) {
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, p);
        setBezierActivePlane(plane);
        setBezierPlaneOnId(onId);
        bezierToolRef.current.activate();
        bezierToolRef.current.onPointerDown(p, e.altKey, plane);
        setBezierKnots([...bezierToolRef.current.getKnots()]);
        setIsDraggingBezierHandle(true);
        setMeasurements(`Bézier Knot #1 placed · Click & drag for C1 smooth handles · Alt for broken tangent`);
      } else {
        const res = bezierToolRef.current.onPointerDown(p, e.altKey, bezierActivePlane || undefined);
        if (res.closed) {
          closeBezierLoop();
        } else {
          setBezierKnots([...bezierToolRef.current.getKnots()]);
          setIsDraggingBezierHandle(true);
          setMeasurements(`Bézier Knot #${bezierKnots.length + 1} placed · Click & drag for C1 smooth handles · Alt for broken tangent${bezierKnots.length + 1 >= 3 ? ' · Enter, double-click or click the start point to close (Shift+Enter leaves it open)' : ''}`);
        }
      }
      return;
    }

    if (activeTool === 'poly') {
      e.stopPropagation();

      // What the pointer means (tools/snapEngine.ts): a corner, a crossing, a point on an edge,
      // a line from the last vertex - or where it is.
      const clickSnap = snapCurve('poly');

      // If clicking first vertex -> finalize
      if ((polyHoveredVertex === 0 || clickSnap.kind === 'close') && polyVertices.length >= 3) {
        clearSnapLocks();
        finalizePoly();
        return;
      }

      let pointToPlace = clickSnap.kind !== 'none' ? clickSnap.point.clone() : polyCandidatePos?.clone();
      clearSnapLocks();
      
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
        setPolyVertices([snappedOr(p, clickSnap)]);
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
      // ONLY ignore non-primary (e.g. right click) mouse buttons
      if (e.nativeEvent && (e.nativeEvent as MouseEvent).button !== undefined && (e.nativeEvent as MouseEvent).button !== 0) {
        return;
      }
      e.stopPropagation();

      const now = Date.now();
      if (now - lastWallClickTimeRef.current < 120) {
        return;
      }
      lastWallClickTimeRef.current = now;
      
      let pointToPlace = wallCandidatePos?.clone();
      const startV = wallVertices[0] || new THREE.Vector3(9999, 9999, 9999);
      const distToStart = (pointToPlace || e.point).distanceTo(startV);
      const isStartClicked = wallVertices.length >= 2 && (wallHoveredVertex === 0 || distToStart < 0.75 || (wallCandidatePos && wallCandidatePos.distanceTo(startV) < 0.5));

      // If clicking first vertex -> close loop & finalize & assemble room
      if (isStartClicked) {
        closeWallLoopAndAssembleRoom();
        return;
      }

      if (wallVertices.length === 0) {
        let p = pointToPlace ? pointToPlace.clone() : e.point.clone();
        if (!pointToPlace) {
          let basePlaneY = ((activeStory || 1) - 1) * 2.8;
          const intersects = raycaster.intersectObjects(scene.children, true);
          const hitShapeObj = intersects.find(i => i.object.userData?.isShape || i.object.name?.includes('terrain') || (i.object as any).isMesh);
          if (hitShapeObj) {
            const hitId = hitShapeObj.object.userData?.id;
            const hitSh = shapes.find(s => s.id === hitId);
            if (hitSh && hitSh.type === 'wall') {
              const wH = Array.isArray(hitSh.args) ? hitSh.args[1] || 2.8 : 2.8;
              basePlaneY = hitSh.position[1] - wH / 2;
            } else if (hitSh && (hitSh.type === 'poly' || hitSh.tags?.includes('floor-slab'))) {
              basePlaneY = hitSh.position[1];
            } else if ((hitSh && hitSh.type === 'terrain') || hitShapeObj.object.name?.includes('terrain')) {
              basePlaneY = hitShapeObj.point.y;
              p = hitShapeObj.point.clone();
            }
          }
          const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), -basePlaneY);
          if (!raycaster.ray.intersectPlane(ground, p)) {
            p = e.point.clone();
          }
        }

        // Enforce: Interior walls must only be drawn inside an existing room
        if (wallJustification === 'interior') {
          if (!isPointInsideRoom(p)) {
            setMeasurements('Interior walls must be drawn inside an existing room.');
            return;
          }
        }

        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), p);
        setWallPlane(plane);
        setWallVertices([p]);
        wallChainShapeIdsRef.current = [];
        diagLog("TOOL", "Wall started at point", { pos: [p.x, p.y, p.z] });
      } else {
        placeWallPoint(pointToPlace ?? e.point.clone());
      }
      return;
    }

    if (activeTool === 'fence' || activeTool === 'railing' || activeTool === 'water' || activeTool === 'site_route') {
      e.stopPropagation();

      // If clicking first vertex -> close loop & finalize
      if (fenceHoveredVertex === 0 && fenceVertices.length >= 2) {
        if (activeTool === 'railing') {
          createFenceRailingSegment(fenceVertices[fenceVertices.length - 1], fenceVertices[0], activeTool);
        }
        finalizeFenceChain(true);
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

        const groundHit = activeTool === 'railing' ? railingSurfaceUnderCursor() : pointerGround(raycaster.ray);
        if (groundHit) {
          // Fences and ponds sit on the ground; a level plane keeps later points from drifting.
          p = groundHit;
        } else if (shapeIntersect && shapeIntersect.face) {
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
        setMeasurements(`${activeTool === 'fence' ? 'Fence' : activeTool === 'water' ? 'Water outline' : activeTool === 'site_route' ? (routeTool.kind === 'road' ? 'Driving route' : 'Walking route') : 'Railing'} Path: Click next point · Click start point to close loop · Double-click/Enter to finish.`);
      } else {
        placeFencePoint(pointToPlace ?? e.point.clone());
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

    if (activeTool === 'terrain') {
      e.stopPropagation();
      const existing = shapes.find(s => s.type === 'terrain' && !s.hidden);
      if (existing) {
        setSelectedId(existing.id);
        setSelectedIds([existing.id]);
        setMeasurements(`Base Terrain: ${existing.name || 'Site Terrain'} selected. Use Landscape Toolbar to configure dimensions, topography & textures.`);
      } else {
        const newTerrain = createTerrainShape({
          width: 50,
          depth: 50,
          resolution: 32,
          topography: 'flat',
          position: [0, 0, 0]
        });
        if (newTerrain.materialBindingId) {
          const defaultGroundAsset = groundMaterialAssets.find(a => a.id === newTerrain.materialBindingId);
          if (defaultGroundAsset && isMaterialAssetId(defaultGroundAsset.id)) {
            const assetId = defaultGroundAsset.id;
            setMaterialBindings(prev => prev[assetId]?.ref.revision === defaultGroundAsset.revision
              ? prev
              : { ...prev, [assetId]: { ref: { assetId, revision: defaultGroundAsset.revision } } });
          }
        }
        addShape(newTerrain);
        setSelectedId(newTerrain.id);
        setSelectedIds([newTerrain.id]);
        commitHistory();
        setMeasurements(`Created Base Terrain Canvas (50m × 50m). Now use Spline Road and Building Pad tools to design site infrastructure.`);
      }
      return;
    }

    if (activeTool === 'road') {
      e.stopPropagation();
      const intersects = raycaster.intersectObjects(scene.children, true);
      const shapeIntersect = intersects.find(i => i.object.userData.isShape);
      const hitPoint = shapeIntersect ? shapeIntersect.point.clone() : e.point.clone();
      const pt: [number, number, number] = [hitPoint.x, hitPoint.y, hitPoint.z];

      if (e.nativeEvent.detail === 2 || (activeSplineDraft.length > 0 && hitPoint.distanceTo(new THREE.Vector3(...activeSplineDraft[activeSplineDraft.length - 1])) < 0.25)) {
        finalizeCivilRoadDraft();
      } else {
        const sanitizedPt: [number, number, number] = [hitPoint.x, sanitizeElevation(hitPoint.y, 0), hitPoint.z];
        if (activeSplineDraft.length > 0) {
          const lastPt = activeSplineDraft[activeSplineDraft.length - 1];
          const dist = Math.hypot(sanitizedPt[0] - lastPt[0], sanitizedPt[2] - lastPt[2]);
          if (dist < 0.15) {
            // Coincident knot deduplication: ignore points closer than 0.15m
            return;
          }
        }
        const nextPts = [...activeSplineDraft, sanitizedPt];
        setActiveSplineDraft(nextPts);
        setMeasurements(`Civil Road Alignment: ${nextPts.length} knots placed · Click next knot · Double-click / Enter to finalize.`);
      }
      return;
    }

    if (activeTool === 'pad-rect' || activeTool === 'pad-circle') {
      e.stopPropagation();
      const intersects = raycaster.intersectObjects(scene.children, true);
      const shapeIntersect = intersects.find(i => i.object.userData.isShape);
      const hitPoint = shapeIntersect ? shapeIntersect.point.clone() : e.point.clone();
      const primitive = activeTool === 'pad-rect' ? 'rectangle' : 'circle';
      const targetElev = sanitizeElevation(civilPadSettings.targetElevation, 0);

      const padSpec: PadModifier = {
        id: `pad-${Date.now()}`,
        name: `${primitive === 'rectangle' ? 'Building' : 'Circular'} Pad`,
        type: 'pad',
        enabled: true,
        center: [hitPoint.x, targetElev, hitPoint.z],
        primitive,
        dimensions: [civilPadSettings.dimensions[0], civilPadSettings.dimensions[1]],
        rotationY: 0,
        targetElevation: targetElev,
        batterDistance: civilPadSettings.batterDistance,
        batterProfile: civilPadSettings.batterProfile,
      };

      setActivePadDraft(null);
      setSelectedModifierId(null);

      // Immediately adjust terrain height to match placed pad footprint and batter slope
      const terrainShape = shapes.find(s => s.type === 'terrain' && s.terrainData);
      if (terrainShape) {
        const updated = applyPadGradingToTerrain(terrainShape, padSpec);
        if (updated) {
          setShapes(prev => prev.map(s => s.id === terrainShape.id ? { ...s, terrainData: updated } : s));
          addTerrainModifier(padSpec);
          setSelectedModifierId(padSpec.id);
          commitHistory();
          setMeasurements(`Graded terrain to ${primitive === 'rectangle' ? 'building' : 'circular'} pad platform (${civilPadSettings.dimensions[0]}m × ${civilPadSettings.dimensions[1]}m) at EL ${targetElev >= 0 ? '+' : ''}${targetElev}m.`);
        } else {
          setMeasurements(`Pad location is outside the terrain boundaries.`);
        }
      } else {
        setMeasurements(`No terrain canvas found. Create or select a terrain canvas first.`);
      }
      return;
    }

    if (activeTool === 'striping') {
      e.stopPropagation();
      if (selectedModifierId) {
        const targetPad = terrainModifiers.find(m => m.id === selectedModifierId && m.type === 'pad');
        if (targetPad) {
          updateTerrainModifier(targetPad.id, {
            surfaceModifier: {
              id: `surf-${targetPad.id}`,
              name: `${targetPad.name} Striping`,
              type: 'surface',
              enabled: true,
              hostPadId: targetPad.id,
              pattern: 'parking-striping',
              parkingConfig: { ...civilStripingSettings },
            }
          });
          setMeasurements(`Applied parking stall striping to ${targetPad.name}.`);
        }
      } else {
        // If clicking a pad without selecting first
        const intersects = raycaster.intersectObjects(scene.children, true);
        const shapeIntersect = intersects.find(i => i.object.userData.isShape);
        const hitPoint = shapeIntersect ? shapeIntersect.point.clone() : e.point.clone();
        const nearestPad = terrainModifiers.find(m => {
          if (m.type !== 'pad') return false;
          const padCenter = new THREE.Vector3(m.center[0], m.targetElevation, m.center[2]);
          return hitPoint.distanceTo(padCenter) < Math.max(m.dimensions[0], m.dimensions[1]);
        });
        if (nearestPad) {
          updateTerrainModifier(nearestPad.id, {
            surfaceModifier: {
              id: `surf-${nearestPad.id}`,
              name: `${nearestPad.name} Striping`,
              type: 'surface',
              enabled: true,
              hostPadId: nearestPad.id,
              pattern: 'parking-striping',
              parkingConfig: { ...civilStripingSettings },
            }
          });
          setSelectedModifierId(nearestPad.id);
          setMeasurements(`Applied parking stall striping to ${nearestPad.name}.`);
        }
      }
      return;
    }

    // The Tape Measure has its own pointer handling on the canvas (see the tape effect below).
    if (activeTool === 'tape' || activeTool === 'dimensions' || activeTool === 'leader') return;
    if (activeTool === 'arc') {
      e.stopPropagation();
      const tool = arcToolRef.current!;
      const phase = tool.current.phase;
      if (phase === 'second') {
        // Third click: the bulge (or nothing more to decide when tangent) - draw it.
        const cursor = arcBulgeCursor();
        if (cursor) tool.move(cursor);
        const after = tool.click(cursor ?? new THREE.Vector3(tool.current.p1!.x, tool.current.p1!.y, tool.current.p1!.z));
        setArcState(after);
        if (after.lastError) setMeasurements(`Arc: ${after.lastError}`);
        else if (after.phase === 'ready') {
          arcPlaneRef.current = null;
          arcFilletChosenRef.current = false;
          arcFilletRef.current = [];
          clearSnapLocks();
          bumpKernel();
          recordAction(actionLabel('Arc'));
          setMeasurements('Arc drawn. Click to start another.');
        }
        return;
      }
      if (phase === 'first') {
        // Second click: the other end of the chord.
        const r = arcSnap();
        const end = r.point;
        const st = tool.current;
        if (st.p0 && distance3(st.p0, end) < 1e-6) return;
        tool.setFilletCorner(arcFilletChosenRef.current ? arcFilletRef.current.find(t => t.end.distanceTo(end) < 1e-6)?.corner ?? null : null);
        const after = tool.click(end);
        setArcState(after);
        clearSnapLocks();
        setMeasurements(tool.hasTangent
          ? 'Tangent arc (cyan). Move to bulge, or click to draw it.'
          : 'Move to bulge the arc; type a bulge (0.5) or a radius (2r) and press Enter; click to draw it.');
        return;
      }
      // First click: the start. The plane comes from the face clicked, else the ground.
      const intersects = raycaster.intersectObjects(scene.children, true);
      const hit = intersects.find(i => (i.object.userData?.isShape || i.object.userData?.id || i.object.userData?.isKernelGeometry) && i.object !== e.object && i.face);
      let normal = new THREE.Vector3(0, 1, 0);
      let point = new THREE.Vector3();
      if (hit && hit.face) {
        normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
        point = hit.point.clone();
      } else if (!raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), point)) {
        point = e.point ? e.point.clone() : new THREE.Vector3();
      }
      arcPlaneRef.current = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point);
      const start = snapHere(snapCursor(arcPlaneRef.current), arcPlaneRef.current, null);
      const p0 = start.kind === 'none' ? point : start.point.clone();
      arcPlaneRef.current = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, p0);
      const after = tool.click(p0);
      // The corners this start could round: if the end is put where the fillet meets the other
      // edge, the arc is tangent to both and drawing it trims the corner.
      arcFilletRef.current = kernelHost.filletTargets(p0).map(t => ({ corner: new THREE.Vector3(t.corner.x, t.corner.y, t.corner.z), end: new THREE.Vector3(t.end.x, t.end.y, t.end.z) }));
      arcFilletChosenRef.current = false;
      clearSnapLocks();
      setArcState(after);
      setMeasurements(tool.hasTangent
        ? 'Arc starts tangent to the edge (cyan). Click the other end.'
        : `Arc start. Click the other end${arcFilletRef.current.length ? ' - or the pink point to round the corner' : ''}.`);
      return;
    }

    if (activeTool === 'door' || activeTool === 'window') {
      e.stopPropagation();

      let targetWall: Shape | null = null;
      let targetRoof: Shape | null = null;
      let worldPos: THREE.Vector3 | null = null;
      let quatArray: [number, number, number, number] = [0, 0, 0, 1];
      const width = activeTool === 'door' ? 0.9 : 1.2;
      const height = activeTool === 'door' ? 2.1 : 1.2;
      let depth = 0.2;
      let windowStyle = activeTool === 'door' ? 'flush' : 'cross';

      if (previewShape && previewShape.type === activeTool) {
        worldPos = new THREE.Vector3(...previewShape.position);
        quatArray = previewShape.quaternion;
        depth = Array.isArray(previewShape.args) ? (previewShape.args[2] || 0.2) : 0.2;
        if ((previewShape as any).archStyle) {
          windowStyle = (previewShape as any).archStyle;
        }
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
          const isRoof = hitShape && (
            hitShape.tags?.some((t: string) => t.includes('roof')) ||
            hitShape.name?.toLowerCase().includes('roof')
          );

          if (activeTool === 'window' && (isRoof || (shapeIntersect.face && Math.abs(shapeIntersect.face.normal.y) < 0.95 && Math.abs(shapeIntersect.face.normal.y) > 0.05))) {
            targetRoof = hitShape || null;
            hitPoint = shapeIntersect.point.clone();
            const faceNorm = shapeIntersect.face?.normal 
              ? shapeIntersect.face.normal.clone().applyQuaternion(shapeIntersect.object.quaternion).normalize()
              : new THREE.Vector3(0, 1, 0);

            const up = new THREE.Vector3(0, 1, 0);
            let right = new THREE.Vector3().crossVectors(up, faceNorm).normalize();
            if (right.lengthSq() < 0.001) right = new THREE.Vector3(1, 0, 0);
            const uphill = new THREE.Vector3().crossVectors(faceNorm, right).normalize();
            const rotMatrix = new THREE.Matrix4().makeBasis(right, uphill, faceNorm);
            const roofQuat = new THREE.Quaternion().setFromRotationMatrix(rotMatrix);

            worldPos = hitPoint.clone().add(faceNorm.clone().multiplyScalar(0.04));
            quatArray = [roofQuat.x, roofQuat.y, roofQuat.z, roofQuat.w];
            windowStyle = 'velux-roof';
          } else if (hitShape && hitShape.type === 'wall') {
            targetWall = hitShape;
            hitPoint = shapeIntersect.point.clone();
          }
        }

        if (!targetWall && !targetRoof) {
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
          const snapTolerance = Math.min(0.25, wallLen * 0.12);
          const inferenceTargets = [
            { ratio: 0.25, localX: -wallLen * 0.25, label: 'Wall 25% Point (1/4 Width)' },
            { ratio: 0.50, localX: 0, label: 'Wall Mid-point (50% Width)' },
            { ratio: 0.75, localX: wallLen * 0.25, label: 'Wall 75% Point (3/4 Width)' },
          ];

          let matchedTarget: { ratio: number; localX: number; label: string } | null = null;
          let bestDist = Infinity;
          for (const target of inferenceTargets) {
            if (Math.abs(target.localX) <= maxLocalX) {
              const dist = Math.abs(localHit.x - target.localX);
              if (dist <= snapTolerance && dist < bestDist) {
                bestDist = dist;
                matchedTarget = target;
              }
            }
          }

          const localX = matchedTarget ? matchedTarget.localX : Math.max(-maxLocalX, Math.min(maxLocalX, localHit.x));
          const localY = activeTool === 'door'
            ? (-wallH / 2 + height / 2)
            : (-wallH / 2 + 0.9 + height / 2);

          const localPos = new THREE.Vector3(localX, localY, 0);
          worldPos = localPos.applyQuaternion(wallQuat).add(wallPos);
          quatArray = [wallQuat.x, wallQuat.y, wallQuat.z, wallQuat.w];
        } else if (hitPoint && !worldPos) {
          const groundY = hitPoint.y + (activeTool === 'door' ? height / 2 : 1.5);
          worldPos = new THREE.Vector3(hitPoint.x, groundY, hitPoint.z);
          quatArray = [0, 0, 0, 1];
        }
      }

      if (worldPos) {
        const shapeColor = (activeMaterial && activeMaterial !== '#ffffff' && activeMaterial !== '#8b5a2b' && activeMaterial !== '#38bdf8') ? activeMaterial : '#ffffff';
        const newDoorWindowShape: Shape = {
          id: Math.random().toString(36).substr(2, 9),
          name: windowStyle === 'velux-roof' ? 'Velux Roof Window' : activeTool === 'door' ? 'Door' : 'Window',
          type: activeTool,
          position: [worldPos.x, worldPos.y, worldPos.z],
          quaternion: quatArray,
          args: [width, height, depth],
          color: shapeColor,
          archStyle: windowStyle,
          roughness: 0.4,
          metalness: 0.05,
          opacity: 1,
          hostWallId: targetWall ? targetWall.id : (targetRoof ? targetRoof.id : undefined)
        };

        const hasExistingFraming = shapes.some(s => s.tags?.includes('timber-frame') || s.name?.startsWith('Timber ') || s.id.startsWith('tf-'));
        const targetHostId = targetWall ? targetWall.id : (targetRoof ? targetRoof.id : undefined);
        const hostHasFraming = targetHostId ? shapes.some(s => s.parentWallOrRoofId === targetHostId || s.id.includes(`tf-wall-${targetHostId}`) || s.id.includes(`tf-roof-${targetHostId}`)) : false;

        if (hasExistingFraming || hostHasFraming) {
          commitUpdatedFraming([...shapes, newDoorWindowShape]);
          commitHistory();
        } else {
          addShape(newDoorWindowShape);
          commitHistory();
        }
        setSelectedId(newDoorWindowShape.id);
        setSelectedIds([newDoorWindowShape.id]);
        setPreviewShape(null);
        setSnapIndicator(null);
        // Persist active tool across consecutive placements (matches Wall tool continuous behavior)
        setMeasurements(windowStyle === 'velux-roof' 
          ? 'Velux Roof Skylight placed on roof pitch & updated framing committed. Click to place another, or switch tool.'
          : `${activeTool === 'door' ? 'Door' : 'Window'} placed & wall opening cut (updated timber framing committed). Click to place another, or switch tool.`);
        recordAction(actionLabel(`Add ${newDoorWindowShape.name || newDoorWindowShape.type}`));
      }
      return;
    }

    if (activeTool === 'staircase' || activeTool === 'step') {
      e.stopPropagation();
      if (previewShape && (previewShape.type === 'staircase' || previewShape.type === 'step')) {
        const isStaircase = activeTool === 'staircase';
        const newShape: Shape = {
          id: Math.random().toString(36).substr(2, 9),
          name: isStaircase ? 'Staircase Flight' : 'Step',
          type: activeTool,
          position: previewShape.position,
          quaternion: previewShape.quaternion,
          args: previewShape.args || (isStaircase ? [1.0, 2.16, 3.6, 12] : [1.0, 0.18, 0.30]),
          color: activeMaterial || '#cbd5e1',
          roughness: activePBR.roughness ?? 0.6,
          metalness: activePBR.metalness ?? 0.05,
          stairStyle: (previewShape as any).stairStyle || 'straight',
          stairStructure: (previewShape as any).stairStructure || 'closed',
          railingMode: (previewShape as any).railingMode || 'both',
          isParametric: (previewShape as any).isParametric ?? (isStaircase ? true : undefined),
          parametricData: (previewShape as any).parametricData,
          tags: ['architecture', activeTool],
        };

        const updatedShapes = applyStairwellHolesToSlabs([...shapes, newShape]);
        setShapes(updatedShapes);
        commitHistory();
        setPreviewShape(null);
        setActiveTool('select');
        setMeasurements(`${isStaircase ? 'Parametric Staircase' : 'Step'} placed. Right-click on stairs to configure styles and parametric rise.`);
        recordAction(actionLabel(`Add ${newShape.name || newShape.type}`));
      }
      return;
    }

    if (activeTool === 'scale_figure') {
      e.stopPropagation();
      const intersects = raycaster.intersectObjects(scene.children, true);
      const shapeIntersect = intersects.find(i => 
        !i.object.userData.isHelper &&
        !i.object.userData.isPreview &&
        !i.object.userData.isGizmo &&
        (i.object.userData.isShape || i.object.userData.isKernelGeometry)
      );
      let hitPoint = shapeIntersect ? shapeIntersect.point.clone() : (e.point ? e.point.clone() : new THREE.Vector3());
      if (!shapeIntersect) {
        const ray = raycaster.ray;
        const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const groundHit = new THREE.Vector3();
        if (ray.intersectPlane(groundPlane, groundHit)) {
          hitPoint = groundHit;
        }
      }

      const char = SCALE_FIGURE_CHARACTERS.find(c => c.id === activeScaleFigureCharacter) || SCALE_FIGURE_CHARACTERS[0];
      const targetH = activeScaleFigureHeight && activeScaleFigureHeight > 0.5 ? activeScaleFigureHeight : char.height;

      const newShape: Shape = {
        id: Math.random().toString(36).substr(2, 9),
        name: `${char.name} (${targetH.toFixed(2)}m)`,
        type: 'scale_figure',
        position: [hitPoint.x, hitPoint.y, hitPoint.z],
        quaternion: [0, 0, 0, 1],
        args: [char.width, targetH, char.depth],
        color: char.primaryColor,
        roughness: 0.65,
        metalness: 0.1,
        archStyle: char.id,
        tags: ['scale-figure', 'architecture', char.category.toLowerCase().replace(/\s+/g, '-')]
      };

      addShape(newShape);
      commitHistory();
      setMeasurements(`Placed ${char.name} at [${hitPoint.x.toFixed(2)}, ${hitPoint.y.toFixed(2)}, ${hitPoint.z.toFixed(2)}] (${targetH.toFixed(2)}m eye-level benchmark)`);
      recordAction(actionLabel(`Add ${newShape.name || newShape.type}`));
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
        plantSpeciesId: (activeTool === 'tree' || activeTool === 'bush') ? activePlantSpecies
          : activeTool === 'rock' ? 'ph_boulder_01' : undefined,
        plantVariation: (activeTool === 'tree' || activeTool === 'bush') ? activePlantVariation : undefined
      };

      addShape(newShape);
      commitHistory();
      setMeasurements(`Placed ${newShape.name} at [${hitPoint.x.toFixed(1)}, ${hitPoint.y.toFixed(1)}, ${hitPoint.z.toFixed(1)}]`);
      return;
    }

    if (activeTool === 'block_picker' && activeBlockPart) {
      e.stopPropagation();
      const part = getBlockPart(activeBlockPart.partId);
      if (!part) return;

      const intersects = raycaster.intersectObjects(scene.children, true);
      const shapeIntersect = intersects.find(i => i.object.userData.isShape);
      let hitPoint = shapeIntersect ? shapeIntersect.point.clone() : e.point.clone();
      let snappedY = 0;
      let rotationSteps = blockPlacementDraft?.rotationSteps ?? activeBlockPart.rotationSteps ?? 0;
      if (!shapeIntersect) {
        const ray = raycaster.ray;
        const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const groundHit = new THREE.Vector3();
        if (ray.intersectPlane(groundPlane, groundHit)) hitPoint = groundHit;
      } else {
        // Block-to-block snap: land on top of whatever block was clicked
        // (or, for a side-face hit, attach alongside it at its own base
        // height and auto-rotated to face it, for parts with a
        // horizontal/angled primary stud) - see resolveBlockAttachment.
        const hitShape = shapes.find(s => s.id === shapeIntersect.object.userData.id);
        if (hitShape?.tags?.includes('block-kit')) {
          const attachment = resolveBlockAttachment(shapeIntersect, hitShape, hitPoint.y, part, rotationSteps);
          snappedY = attachment.y;
          rotationSteps = attachment.rotationSteps;
        }
      }

      // Grid snap: align the footprint's CORNER to the stud grid (not its
      // center - see snapBlockFootprintCenter) so blocks of different
      // sizes still sit flush against each other.
      const [snappedX, snappedZ] = snapBlockFootprintCenter(part, rotationSteps, hitPoint.x, hitPoint.z);
      const placementPosition: [number, number, number] = [snappedX, snappedY, snappedZ];

      if (blockPreventOverlap && blockPlacementOverlaps(part, placementPosition, rotationSteps, shapes)) {
        setMeasurements(`Can't place ${part.label} here - it would overlap another block.`);
        return;
      }

      const geom = buildBlockGeometry(part);
      // Shape rendering prefers `quaternion` over `rotation` whenever a
      // quaternion is present (even an identity one), so the placed block's
      // orientation must be expressed as a quaternion here to actually match
      // the ghost preview, which rotates via a plain Euler `rotation` prop.
      const placementQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotationSteps * (Math.PI / 2), 0));
      // Random-colour mode (sdk.blockKit.place(partId, [colours])) rerolls
      // a fresh pick for every block actually placed, not just once when
      // the tool was armed.
      const placementColor = activeBlockPart.randomPalette && activeBlockPart.randomPalette.length > 0
        ? activeBlockPart.randomPalette[Math.floor(Math.random() * activeBlockPart.randomPalette.length)]
        : activeBlockPart.color;
      const newShape: Shape = {
        id: Math.random().toString(36).substr(2, 9),
        name: part.label,
        type: 'custom',
        position: placementPosition,
        rotation: [0, rotationSteps * (Math.PI / 2), 0],
        quaternion: [placementQuat.x, placementQuat.y, placementQuat.z, placementQuat.w],
        args: [1, 1, 1],
        color: placementColor,
        roughness: 0.4,
        metalness: 0.02,
        tags: ['block-kit', part.id, `block-category-${part.category.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`],
        geometryData: bufferGeometryToShapeData(geom)
      };
      addShape(newShape);
      commitHistory();
      setBlockPlacementDraft({ position: placementPosition, rotationSteps });
      setMeasurements(`Placed ${part.label}. Arrow keys rotate the next block - click to place another, Esc to stop.`);
      return;
    }

    if (['rectangle', 'circle', 'polygon', 'line', 'triangle', 'sphere', 'cone', 'pyramid', 'donut', 'dome'].includes(activeTool)) {
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

      // Check for mesh intersection first.
      //
      // Picks whichever relevant hit is NEAREST along the ray, not "a Shape
      // always wins if one exists anywhere on the ray" — the previous
      // version only ever looked for `userData.isShape`, so it silently
      // ignored kernel-rendered geometry entirely and fell through to the
      // ground-plane fallback whenever the nearest thing hit was a kernel
      // wall. `intersectObjects` already returns hits nearest-first.
      const intersects = raycaster.intersectObjects(scene.children, true);
      const relevantIntersect = intersects.find(
        i => i.object.userData.isShape || i.object.userData.isKernelGeometry,
      );

      if (relevantIntersect?.face && relevantIntersect.object.userData.isShape) {
        const normal = relevantIntersect.face.normal.clone().applyQuaternion(relevantIntersect.object.quaternion).normalize();
        startNormal = normal;
        startOnId = relevantIntersect.object.userData.id;
        if (!startPoint) {
          startPoint = relevantIntersect.point.clone();
        }
      } else if (
        relevantIntersect?.object.userData.isKernelGeometry &&
        typeof relevantIntersect.faceIndex === 'number'
      ) {
        const faceOfTriangle: number[] | undefined = relevantIntersect.object.userData.faceOfTriangle;
        const kernelFaceId = faceOfTriangle?.[relevantIntersect.faceIndex];
        const kernelFace = kernelFaceId !== undefined ? kernelHost.graph.faces.get(kernelFaceId as never) : null;
        if (kernelFace) {
          // The kernel's own stored normal, already correctly oriented —
          // no quaternion transform needed, since KernelGeometry mounts
          // with no transform of its own.
          startNormal = new THREE.Vector3(kernelFace.plane.normal.x, kernelFace.plane.normal.y, kernelFace.plane.normal.z);
          if (!startPoint) {
            startPoint = relevantIntersect.point.clone();
          }
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

  // ---------------------------------------------------------------------------
  // Snapping and inference (tools/snapEngine.ts): one function for Line, Arc, Bézier, Poly and
  // the shape tools. It finds corners, crossings, points on edges and guides; directions from
  // where you are drawing from; and holds a line when a lock is on.
  //
  // Locks (while a segment is being drawn): arrow keys hold an axis (Right red, Left green, Up
  // blue) and the X / Y / Z keys do the same; Down holds a line parallel, then perpendicular, to
  // the edge you are resting on; holding Shift keeps whatever inference is showing. A lock still
  // snaps to corners and crossings on its line.
  // ---------------------------------------------------------------------------
  const snapMemoryRef = useRef(new SnapMemory(300));
  const lastSnapRef = useRef<SnapResult | null>(null);
  const lastSnapFromRef = useRef<THREE.Vector3 | null>(null);
  const shiftLineRef = useRef<SnapLine | null>(null);
  const edgeLockRef = useRef<{ mode: 'parallel' | 'perpendicular'; edge: HoverEdge } | null>(null);
  const publishedSnapRef = useRef('');
  const shapeSnapRef = useRef<{ shapes: Shape[]; points: NonNullable<SnapInput['extraPoints']> } | null>(null);
  const axisLockRef = useRef(axisLock);
  axisLockRef.current = axisLock;
  const setMeasurementsRef = useRef(setMeasurements);
  setMeasurementsRef.current = setMeasurements;
  const AXES_NAMES: Record<AxisName, string> = { x: 'red axis', z: 'green axis', y: 'blue axis' };
  const activeToolSnapRef = useRef(activeTool);
  activeToolSnapRef.current = activeTool;

  /** The corners, edge middles and centres of the model's objects (not its drawn geometry). */
  const shapeSnapPoints = (): NonNullable<SnapInput['extraPoints']> => {
    const cached = shapeSnapRef.current;
    if (cached && cached.shapes === shapes) return cached.points;
    const points: { point: THREE.Vector3; kind: 'endpoint' | 'midpoint' | 'center'; label?: string }[] = [];
    for (const sh of shapes) {
      if (sh.hidden) continue;
      if (isGuideShape(sh)) {
        const c = (sh.args as { kind?: string; centre?: [number, number, number] }).centre;
        if ((sh.args as { kind?: string }).kind === 'protractor' && c) points.push({ point: new THREE.Vector3(...c), kind: 'endpoint', label: 'Guide centre' });
        continue;
      }
      if (isSectionShape(sh)) continue;
      const a = sh.args as { start?: [number, number, number]; end?: [number, number, number] } | undefined;
      if (sh.type === 'measurement') {
        if (a && Array.isArray(a.start) && Array.isArray(a.end)) {
          const st = new THREE.Vector3(...a.start), en = new THREE.Vector3(...a.end);
          points.push({ point: st, kind: 'endpoint' }, { point: en, kind: 'endpoint' }, { point: st.clone().lerp(en, 0.5), kind: 'midpoint' });
        }
        continue;
      }
      const obj = scene.getObjectByName(sh.id);
      if (!obj) continue;
      const box = new THREE.Box3().setFromObject(obj);
      if (!isFinite(box.min.x) || !isFinite(box.max.x)) continue;
      const corners: THREE.Vector3[] = [];
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
      for (const c of corners) points.push({ point: c, kind: 'endpoint' });
      for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
        const ca = corners[i]!, cb = corners[j]!;
        if ([ca.x !== cb.x, ca.y !== cb.y, ca.z !== cb.z].filter(Boolean).length === 1) points.push({ point: ca.clone().lerp(cb, 0.5), kind: 'midpoint' });
      }
      const mid = box.getCenter(new THREE.Vector3());
      for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
        points.push({ point: new THREE.Vector3(mid.x + d[0] * (box.max.x - box.min.x) / 2, mid.y + d[1] * (box.max.y - box.min.y) / 2, mid.z + d[2] * (box.max.z - box.min.z) / 2), kind: 'center' });
      }
    }
    shapeSnapRef.current = { shapes, points };
    return points;
  };

  /** The snap for the pointer now. `from` is where the segment being drawn started. */
  const snapHere = (cursor: THREE.Vector3, plane: THREE.Plane | null, from: THREE.Vector3 | null, opts: { closePoint?: THREE.Vector3 | null } = {}): SnapResult => {
    const rect = gl.domElement.getBoundingClientRect();
    let lockLine: SnapLine | null = null;
    if (from) {
      if (axisLockRef.current) lockLine = makeAxisLock(from, axisLockRef.current as AxisName);
      else if (edgeLockRef.current) lockLine = edgeLock(from, edgeLockRef.current.edge, edgeLockRef.current.mode, plane);
      else if (shiftLineRef.current) lockLine = shiftLineRef.current;
    }
    const result = computeSnap({
      graph: kernelHost.graph, revision: kernelRevision, camera,
      size: { width: rect.width, height: rect.height },
      pointer: { x: ((mouse.x + 1) / 2) * rect.width, y: ((-mouse.y + 1) / 2) * rect.height },
      ray: raycaster.ray, cursor, plane, from,
      extraPoints: shapeSnapPoints(),
      guides: guidesVisible ? guideSegments : [], guideCrossings: guidesVisible ? guideCrossingPoints : [],
      memory: snapMemoryRef.current, lockLine, closePoint: opts.closePoint ?? null,
    });
    snapMemoryRef.current.update(result, performance.now());
    lastSnapRef.current = result;
    lastSnapFromRef.current = from;
    return result;
  };

  /** Shows what the snap found: the marker and its name, the lines, the edge under the pointer. */
  const publishSnap = (r: SnapResult | null) => {
    const marker = r && r.kind !== 'none' ? (r.marker ?? r.point) : null;
    const key = r
      ? `${r.kind}|${r.label}|${marker ? marker.toArray().map(v => v.toFixed(3)).join(',') : ''}|${r.guides.map(g => `${g.a.toArray().map(v => v.toFixed(2))}>${g.b.toArray().map(v => v.toFixed(2))}${g.dashed}`).join(';')}|${r.hoverEdge ? `${r.hoverEdge.id}:${r.hoverEdge.a.toArray().map(v => v.toFixed(2))}` : ''}`
      : '';
    if (key === publishedSnapRef.current) return;
    publishedSnapRef.current = key;
    setSnapIndicator(marker && r ? { point: [marker.x, marker.y, marker.z], type: r.kind as SnapKind, tooltip: r.label, ...(r.line ? { color: r.line.color } : {}) } : null);
    setSnapGuides(r ? r.guides : []);
    setSnapHoverEdge(r ? r.hoverEdge : null);
  };

  const snapCursor = (plane: THREE.Plane | null): THREE.Vector3 => {
    const hit = new THREE.Vector3();
    if (plane && raycaster.ray.intersectPlane(plane, hit)) return hit;
    return raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit) ? hit : raycaster.ray.at(50, new THREE.Vector3());
  };

  /** Where Poly, Bézier and Arc are drawing from, on what plane, and what would close them. */
  const curveSnapContext = (tool: string): { from: THREE.Vector3 | null; plane: THREE.Plane | null; closePoint: THREE.Vector3 | null } => {
    if (tool === 'poly') {
      return { from: polyVertices.length ? polyVertices[polyVertices.length - 1]! : null, plane: polyPlane, closePoint: polyVertices.length >= 3 ? polyVertices[0]! : null };
    }
    if (tool === 'bezier') {
      return { from: bezierKnots.length ? bezierKnots[bezierKnots.length - 1]!.point : null, plane: bezierActivePlane, closePoint: bezierKnots.length >= 2 ? bezierKnots[0]!.point : null };
    }
    const st = arcToolRef.current?.current;
    if (tool === 'arc' && st && st.phase === 'first' && st.p0) {
      return { from: new THREE.Vector3(st.p0.x, st.p0.y, st.p0.z), plane: arcPlaneRef.current, closePoint: null };
    }
    return { from: null, plane: tool === 'arc' ? arcPlaneRef.current : null, closePoint: null };
  };

  /** The snap for Poly, Bézier or Arc now (and shown). */
  const snapCurve = (tool: string): SnapResult => {
    const ctx = curveSnapContext(tool);
    const r = snapHere(snapCursor(ctx.plane), ctx.plane, ctx.from, { closePoint: ctx.closePoint });
    publishSnap(r);
    return r;
  };
  /** A click's point: the snapped one when the snap found something, else what the tool had. */
  const snappedOr = (raw: THREE.Vector3, r: SnapResult): THREE.Vector3 => (r.kind === 'none' ? raw : r.point.clone());

  // Locks are for one segment: drop them when the tool changes or a point is placed.
  const clearSnapLocks = () => {
    edgeLockRef.current = null;
    shiftLineRef.current = null;
    setAxisLock(null);
  };
  useEffect(() => {
    clearSnapLocks();
    snapMemoryRef.current.clear();
    lastSnapRef.current = null;
    lastSnapFromRef.current = null;
    publishSnap(null);
  }, [activeTool]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const ARROW_TOOLS = ['line', 'poly', 'bezier', 'arc', 'rectangle', 'circle', 'triangle'];
    const SHIFT_TOOLS = ['line', 'poly', 'bezier', 'arc'];
    const editing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    };
    const onDown = (ev: KeyboardEvent) => {
      if (editing(ev.target)) return;
      const tool = activeToolSnapRef.current;
      if (ev.key === 'Shift') {
        // Hold what the pointer is inferring for as long as Shift is down.
        const line = lastSnapRef.current?.line;
        if (!ev.repeat && line && lastSnapFromRef.current && SHIFT_TOOLS.includes(tool)) shiftLineRef.current = line;
        return;
      }
      if (!ARROW_TOOLS.includes(tool) || !lastSnapFromRef.current || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const axisFor: Record<string, AxisName> = { ArrowRight: 'x', ArrowLeft: 'z', ArrowUp: 'y' };
      const axis = axisFor[ev.key];
      if (axis) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        edgeLockRef.current = null;
        const already = axisLockRef.current === axis;
        setAxisLock(already ? null : axis);
        setMeasurementsRef.current(already ? 'Lock released.' : `Locked to the ${AXES_NAMES[axis]}. Press the same arrow (or Esc) to release; corners and crossings on the line still snap.`);
        return;
      }
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        // Off -> parallel to the edge rested on -> perpendicular to it -> off.
        setAxisLock(null);
        const cur = edgeLockRef.current;
        if (cur?.mode === 'parallel') edgeLockRef.current = { mode: 'perpendicular', edge: cur.edge };
        else if (cur) edgeLockRef.current = null;
        else {
          const edge = snapMemoryRef.current.edge ?? lastSnapRef.current?.hoverEdge ?? null;
          edgeLockRef.current = edge ? { mode: 'parallel', edge } : null;
        }
        setMeasurementsRef.current(
          edgeLockRef.current?.mode === 'parallel' ? 'Locked parallel to the edge. Press Down again for perpendicular.'
            : edgeLockRef.current?.mode === 'perpendicular' ? 'Locked perpendicular to the edge. Press Down again to release.'
            : 'Rest the pointer on an edge for a moment, then press Down to lock parallel to it.',
        );
      }
    };
    const onUp = (ev: KeyboardEvent) => { if (ev.key === 'Shift') shiftLineRef.current = null; };
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    return () => {
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup', onUp, true);
    };
  }, []);

  // The Arc tool (tools/arcTool.ts): chord, then bulge, tangent to the edge it starts on.
  const arcToolRef = useRef<ArcTool | null>(null);
  const arcPlaneRef = useRef<THREE.Plane | null>(null);
  const arcFilletRef = useRef<{ corner: THREE.Vector3; end: THREE.Vector3 }[]>([]);
  const arcFilletChosenRef = useRef(false);
  const [arcState, setArcState] = useState<ArcToolState | null>(null);
  if (!arcToolRef.current) arcToolRef.current = new ArcTool(kernelHost, undefined, unit);
  const distance3 = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

  /** The snap for the arc's chord ends, with the pink "round this corner" point taking priority. */
  const arcSnap = (): SnapResult => {
    const r = snapCurve('arc');
    arcFilletChosenRef.current = false;
    const st = arcToolRef.current!.current;
    if (st.phase !== 'first' || arcFilletRef.current.length === 0) return r;
    const rect = gl.domElement.getBoundingClientRect();
    const px = { x: ((mouse.x + 1) / 2) * rect.width, y: ((-mouse.y + 1) / 2) * rect.height };
    for (const t of arcFilletRef.current) {
      const v = t.end.clone().project(camera);
      if (v.z >= 1) continue;
      const d = Math.hypot(((v.x + 1) / 2) * rect.width - px.x, ((-v.y + 1) / 2) * rect.height - px.y);
      if (d > 14) continue;
      arcFilletChosenRef.current = true;
      const over: SnapResult = { ...r, point: t.end.clone(), marker: t.end.clone(), kind: 'fillet', label: 'Round the corner (tangent to both edges)', guides: [], line: null };
      publishSnap(over);
      return over;
    }
    return r;
  };

  /** Where the pointer is, for bulging the arc: on the plane it is drawn in (or one facing the camera through the chord). */
  const arcBulgeCursor = (): THREE.Vector3 | null => {
    const st = arcToolRef.current!.current;
    if (!st.p0 || !st.p1) return null;
    const p0 = new THREE.Vector3(st.p0.x, st.p0.y, st.p0.z), p1 = new THREE.Vector3(st.p1.x, st.p1.y, st.p1.z);
    let plane = arcPlaneRef.current;
    if (!plane || Math.abs(plane.distanceToPoint(p0)) > 1e-4 || Math.abs(plane.distanceToPoint(p1)) > 1e-4) {
      const c = p1.clone().sub(p0).normalize();
      const view = raycaster.ray.direction.clone();
      const n = view.sub(c.clone().multiplyScalar(view.dot(c)));
      if (n.lengthSq() < 1e-9) return null;
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n.normalize(), p0);
    }
    const hit = new THREE.Vector3();
    return raycaster.ray.intersectPlane(plane, hit) ? hit : null;
  };

  // Start and stop the arc tool with the toolbar tool.
  useEffect(() => {
    const tool = arcToolRef.current!;
    if (activeTool === 'arc') setArcState(tool.activate('twoPoint'));
    else { tool.deactivate(); setArcState(null); }
    arcPlaneRef.current = null;
    arcFilletRef.current = [];
    arcFilletChosenRef.current = false;
  }, [activeTool]);

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    // See handlePointerDown's identical guard - Walk Mode's own placement
    // hover lives entirely in WalkModeController.
    if (activeTool === 'walk' || activeTool === 'look' || activeTool === 'patio' || activeTool === 'protractor') return;
    if (activeTool === 'teleport') {
      // Portal Navigation's own hover tracking no longer happens here at
      // all - see TeleportPortalPreview's useFrame. Raycasting against the
      // whole scene on every native pointermove event (which can fire much
      // faster than the display refreshes) was itself expensive enough to
      // saturate the main thread between animation frames, so the preview
      // (and the rest of the viewport) only visibly updated in step with
      // mouse movement instead of animating smoothly on its own - a
      // "flip-book" effect one frame per cursor move, rather than a truly
      // live preview. Doing the same raycast once per rendered frame
      // instead (driven by R3F's own tracked pointer position) decouples
      // it from however fast the mouse happens to report movement.
      e.stopPropagation();
      return;
    }

    if (activeTool === 'block_picker' && activeBlockPart) {
      const part = getBlockPart(activeBlockPart.partId);
      if (part) {
        const intersects = raycaster.intersectObjects(scene.children, true);
        const shapeIntersect = intersects.find(i => i.object.userData.isShape);
        let hitPoint = shapeIntersect ? shapeIntersect.point.clone() : e.point.clone();
        let snappedY = 0;
        let rotationSteps = blockPlacementDraft?.rotationSteps ?? activeBlockPart.rotationSteps ?? 0;
        if (!shapeIntersect) {
          const ray = raycaster.ray;
          const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
          const groundHit = new THREE.Vector3();
          if (ray.intersectPlane(groundPlane, groundHit)) hitPoint = groundHit;
        } else {
          const hitShape = shapes.find(s => s.id === shapeIntersect.object.userData.id);
          if (hitShape?.tags?.includes('block-kit')) {
            // Full auto-alignment: as the ghost hovers near a side face,
            // it snaps its rotation to face that surface automatically
            // (see resolveBlockAttachment) for parts with a horizontal or
            // angled primary stud - no manual rotation needed for those.
            const attachment = resolveBlockAttachment(shapeIntersect, hitShape, hitPoint.y, part, rotationSteps);
            snappedY = attachment.y;
            rotationSteps = attachment.rotationSteps;
          }
        }
        const [snappedX, snappedZ] = snapBlockFootprintCenter(part, rotationSteps, hitPoint.x, hitPoint.z);
        const candidatePosition: [number, number, number] = [snappedX, snappedY, snappedZ];

        // Friction: a candidate cell that would overlap an existing block
        // is rejected and the ghost "sticks" at the last non-overlapping
        // cell instead of jumping through - so blocks feel like they're
        // touching rather than passing through each other while dragging.
        const wouldOverlap = blockPreventOverlap && blockPlacementOverlaps(part, candidatePosition, rotationSteps, shapes);
        const resolvedPosition = wouldOverlap && blockLastValidDraftRef.current
          ? blockLastValidDraftRef.current.position
          : candidatePosition;
        if (!wouldOverlap) {
          blockLastValidDraftRef.current = { position: candidatePosition, rotationSteps };
        }
        setBlockPlacementDraft({ position: resolvedPosition, rotationSteps, blocked: wouldOverlap });
      }
      return;
    }

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

    if (activeTool === 'arc') {
      const tool = arcToolRef.current!;
      const phase = tool.current.phase;
      if (phase === 'second') {
        publishSnap(null);
        const cursor = arcBulgeCursor();
        if (cursor) {
          const st = tool.move(cursor);
          setArcState(st);
          if (st.preview) {
            const r = st.preview.radius;
            setMeasurements(`Arc: radius ${formatValue(r, unit, 2)}${st.tangentActive ? ' (tangent)' : st.halfCircle ? ' (half circle)' : ''} - click to draw`);
          }
        }
      } else {
        const r = arcSnap();
        if (phase === 'first') setArcState(tool.move(r.point));
      }
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
      if (activeTool === 'bezier') {
        const plane = bezierActivePlane || new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const ray = raycaster.ray;
        const target = new THREE.Vector3();
        if (ray.intersectPlane(plane, target)) {
          // The shared snap: corners, crossings, points on an edge, lines from the last knot.
          const bezierSnap = isDraggingBezierHandle ? null : snapCurve('bezier');
          let finalPos = bezierSnap ? snappedOr(target.clone(), bezierSnap) : target.clone();
          setBezierCandidatePos(finalPos);

          if (isDraggingBezierHandle) {
            bezierToolRef.current.onPointerMove(finalPos, e.altKey);
            const updatedKnots = bezierToolRef.current.getKnots();
            setBezierKnots([...updatedKnots]);
            const activeK = updatedKnots[updatedKnots.length - 1];
            if (activeK && activeK.handleOut) {
              const len = activeK.handleOut.distanceTo(activeK.point);
              setMeasurements(`Tangent Handle: ${len.toFixed(2)}m · ${activeK.mode === 'broken' ? 'Broken (Alt)' : 'Symmetric (Mirrored)'} · Release to place`);
            }
          } else {
            // Check snap to knot 0
            if (bezierKnots.length >= 2) {
              const origin = bezierKnots[0].point;
              const d = finalPos.distanceTo(origin);
              // About 12 pixels on screen at any zoom (never under 5 cm).
              const pixels = gl.domElement.clientHeight || 1;
              const cam = camera as THREE.PerspectiveCamera & THREE.OrthographicCamera;
              const metresPerPixel = cam.isPerspectiveCamera
                ? (2 * cam.position.distanceTo(origin) * Math.tan((cam.fov * Math.PI) / 360)) / (pixels * (cam.zoom || 1))
                : (cam.top - cam.bottom) / ((cam.zoom || 1) * pixels);
              const closeReach = Math.max(0.05, 12 * metresPerPixel);
              bezierToolRef.current.setCloseReach(closeReach);
              if (d < closeReach || bezierSnap?.kind === 'close') {
                setBezierHoveredKnotIndex(0);
                setMeasurements('Start point: click, press Enter or double-click to close the shape');
              } else {
                setBezierHoveredKnotIndex(null);
              }
            }
          }
        }
      }
      if (activeTool === 'poly' && polyPlane && polyNormal) {
      const ray = raycaster.ray;
      const target = new THREE.Vector3();
      if (ray.intersectPlane(polyPlane, target)) {
        let finalPos = target.clone();
        
        // The shared snap (tools/snapEngine.ts), in screen pixels: corners, crossings, points on
        // an edge, lines from the last vertex, the start point to close on.
        const polySnap = snapCurve('poly');
        finalPos = snappedOr(finalPos, polySnap);
        setPolyHoveredVertex(polyVertices.length >= 3 && polySnap.kind === 'close' ? 0 : null);

        setPolyCandidatePos(finalPos);
      }
    }

    if (activeTool === 'wall') {
      // The 90° lock: on by default, and Shift frees it. With the lock off in the tool's settings it behaves as if Shift were held.
      const wallFreeAngle = e.shiftKey || wallToolSettings?.lockRightAngles === false;
      let basePlaneY = ((activeStory || 1) - 1) * 2.8;
      if (!wallPlane) {
        const intersects = raycaster.intersectObjects(scene.children, true);
        const hitShapeObj = intersects.find(i => i.object.userData?.isShape || i.object.name?.includes('terrain') || (i.object as any).isMesh);
        if (hitShapeObj) {
          const hitId = hitShapeObj.object.userData?.id;
          const hitSh = shapes.find(s => s.id === hitId);
          if (hitSh && hitSh.type === 'wall') {
            const wH = Array.isArray(hitSh.args) ? hitSh.args[1] || 2.8 : 2.8;
            basePlaneY = hitSh.position[1] - wH / 2;
          } else if (hitSh && (hitSh.type === 'poly' || hitSh.tags?.includes('floor-slab'))) {
            basePlaneY = hitSh.position[1];
          } else if ((hitSh && hitSh.type === 'terrain') || hitShapeObj.object.name?.includes('terrain')) {
            basePlaneY = hitShapeObj.point.y;
          }
        }
      }
      const plane = wallPlane || new THREE.Plane(new THREE.Vector3(0, 1, 0), -basePlaneY);
      const target = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(plane, target)) {
        let finalPos = target.clone();
        
        // 1. Check start vertex snap to close wall loop
        let isClosingLoop = false;
        if (wallVertices.length >= 2) {
           const d = target.distanceTo(wallVertices[0]);
           const startNdc = wallVertices[0].clone().project(camera);
           const pointerNdc = (e as any).pointer;
           const ndcDist = pointerNdc ? Math.hypot(startNdc.x - pointerNdc.x, startNdc.y - pointerNdc.y) : 999;
          
           if (d < 0.75 || (pointerNdc && startNdc.z < 1 && ndcDist < 0.08)) {
             finalPos = wallVertices[0].clone();
             setWallHoveredVertex(0);
             isClosingLoop = true;
             // Suppress redundant black snap badge & tracking label to prevent UI clutter
             setSnapIndicator(null);
             const lastV = wallVertices[wallVertices.length - 1];
             setTrackingGuide({ source: [lastV.x, lastV.y, lastV.z], target: [wallVertices[0].x, wallVertices[0].y, wallVertices[0].z], color: '#0063A3' });
           } else {
             setWallHoveredVertex(null);
           }
         } else {
           setWallHoveredVertex(null);
         }

        // 2. Default to 90-degree orthogonal angles, allow free angle if Shift is held down
        if (!wallFreeAngle && wallVertices.length > 0 && !isClosingLoop) {
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

            // 2b. Check inference alignment with start node (wallVertices[0])
            let alignedWithStart = false;
            if (Math.abs(target.x - wallVertices[0].x) < 0.40) {
              finalPos.x = wallVertices[0].x;
              alignedWithStart = true;
              setTrackingGuide({ source: [wallVertices[0].x, wallVertices[0].y, wallVertices[0].z], target: [finalPos.x, finalPos.y, finalPos.z], color: '#06b6d4', label: 'Aligned with Start (X)' });
            } else if (Math.abs(target.z - wallVertices[0].z) < 0.40) {
              finalPos.z = wallVertices[0].z;
              alignedWithStart = true;
              setTrackingGuide({ source: [wallVertices[0].x, wallVertices[0].y, wallVertices[0].z], target: [finalPos.x, finalPos.y, finalPos.z], color: '#06b6d4', label: 'Aligned with Start (Z)' });
            }

            // 2c. Check midpoint snapping on placed wall segments
            let midpointSnapped = false;
            for (let sIdx = 0; sIdx < wallVertices.length - 1; sIdx++) {
              const segMid = wallVertices[sIdx].clone().lerp(wallVertices[sIdx + 1], 0.5);
              if (target.distanceTo(segMid) < 0.45) {
                finalPos = segMid.clone();
                midpointSnapped = true;
                setSnapIndicator({ point: [segMid.x, segMid.y + 0.1, segMid.z], type: 'midpoint', tooltip: 'Wall Midpoint' });
                break;
              }
            }

            // 2d. Snap to attaching wall at endpoint
            let wallAttached = false;
            if (!alignedWithStart && !midpointSnapped) {
              let bestAttachDist = 0.65;
              let attachTarget: THREE.Vector3 | null = null;
              let attachTooltip = '';
              shapes.forEach(sh => {
                if (sh.hidden || sh.type !== 'wall') return;
                const wL = Array.isArray(sh.args) ? sh.args[0] || 3.0 : 3.0;
                const wH = Array.isArray(sh.args) ? sh.args[1] || 2.8 : 2.8;
                const wT = Array.isArray(sh.args) ? sh.args[2] || 0.2 : 0.2;
                const wPos = new THREE.Vector3(...sh.position);
                const wQuat = sh.quaternion ? new THREE.Quaternion(...sh.quaternion) : new THREE.Quaternion();

                const vRun = new THREE.Vector3(1, 0, 0).applyQuaternion(wQuat).normalize();
                const vNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(wQuat).normalize();

                const pA = wPos.clone().sub(vRun.clone().multiplyScalar(wL / 2));
                const toTarget = target.clone().sub(pA);
                const proj = toTarget.dot(vRun);
                const t = Math.max(0, Math.min(wL, proj));
                const centerlinePt = pA.clone().add(vRun.clone().multiplyScalar(t));
                centerlinePt.y = lastVertex.y;

                const innerFacePt = centerlinePt.clone().sub(vNormal.clone().multiplyScalar(wT / 2));
                const dInner = target.distanceTo(innerFacePt);
                const dCenter = target.distanceTo(centerlinePt);

                if (wallJustification === 'interior' && dInner < bestAttachDist) {
                  bestAttachDist = dInner;
                  attachTarget = innerFacePt.clone();
                  attachTooltip = 'Attached to Wall Interior Face';
                } else if (dCenter < bestAttachDist) {
                  bestAttachDist = dCenter;
                  attachTarget = centerlinePt.clone();
                  attachTooltip = 'Attached to Wall Centerline';
                }
              });

              if (attachTarget) {
                finalPos = attachTarget;
                wallAttached = true;
                setSnapIndicator({ point: [attachTarget.x, attachTarget.y + 0.1, attachTarget.z], type: 'center', tooltip: attachTooltip });
              }
            }

            if (!alignedWithStart && !midpointSnapped && !wallAttached) {
              setSnapIndicator(null);
              setTrackingGuide(null);
            }
          } else {
            // First wall segment: lock strictly along dominant World X or Z axis
            if (Math.abs(dx) >= Math.abs(dz)) {
              finalPos.x = target.x;
              finalPos.z = lastVertex.z;
            } else {
              finalPos.x = lastVertex.x;
              finalPos.z = target.z;
            }
            setSnapIndicator(null);
            setTrackingGuide(null);
          }
        }

        // Prevent wall segment from passing through existing obstacle walls
        if (wallVertices.length > 0 && !isClosingLoop) {
          const lastV = wallVertices[wallVertices.length - 1];
          const obstacle = findWallObstacleIntersection(lastV, finalPos);
          if (obstacle) {
            finalPos = obstacle.hitPoint.clone();
            setSnapIndicator({
              point: [finalPos.x, finalPos.y + 0.1, finalPos.z],
              type: 'endpoint',
              tooltip: 'Attached to Intersecting Wall (Pass-through Prevented)'
            });
          }
        } else if (!wallFreeAngle && wallVertices.length === 0) {
          // Snap to existing walls (interior face / centerline) or shape origins on any story level
          let bestDist = 0.65;
          let snapTarget: THREE.Vector3 | null = null;
          let snapTooltip = 'Shape Origin';
          let snapType: 'endpoint' | 'midpoint' | 'center' = 'endpoint';

          shapes.forEach(sh => {
            if (sh.hidden) return;
            if (sh.type === 'wall') {
              const wL = Array.isArray(sh.args) ? sh.args[0] || 3.0 : 3.0;
              const wH = Array.isArray(sh.args) ? sh.args[1] || 2.8 : 2.8;
              const wT = Array.isArray(sh.args) ? sh.args[2] || 0.2 : 0.2;
              const wPos = new THREE.Vector3(...sh.position);
              const wQuat = sh.quaternion ? new THREE.Quaternion(...sh.quaternion) : new THREE.Quaternion();

              const vRun = new THREE.Vector3(1, 0, 0).applyQuaternion(wQuat).normalize();
              const vNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(wQuat).normalize();

              const pA = wPos.clone().sub(vRun.clone().multiplyScalar(wL / 2));
              const toTarget = finalPos.clone().sub(pA);
              const proj = toTarget.dot(vRun);
              const t = Math.max(0, Math.min(wL, proj));
              const centerlinePt = pA.clone().add(vRun.clone().multiplyScalar(t));
              centerlinePt.y = wPos.y - wH / 2;

              const innerFacePt = centerlinePt.clone().sub(vNormal.clone().multiplyScalar(wT / 2));
              const dInner = finalPos.distanceTo(innerFacePt);
              const dCenter = finalPos.distanceTo(centerlinePt);

              if (wallJustification === 'interior' && dInner < bestDist) {
                bestDist = dInner;
                snapTarget = innerFacePt.clone();
                snapTooltip = 'Attached to Interior Face of Wall';
                snapType = 'center';
              } else if (dCenter < bestDist) {
                bestDist = dCenter;
                snapTarget = centerlinePt.clone();
                snapTooltip = 'Attached to Wall Centerline';
                snapType = 'center';
              }
            } else {
              const shPos = new THREE.Vector3(...sh.position);
              const d = finalPos.distanceTo(shPos);
              if (d < bestDist) {
                snapTarget = shPos.clone();
                bestDist = d;
                snapTooltip = 'Shape Origin';
                snapType = 'endpoint';
              }
            }
          });

          if (snapTarget) {
            finalPos = snapTarget;
            setSnapIndicator({ point: [snapTarget.x, snapTarget.y + 0.1, snapTarget.z], type: snapType, tooltip: snapTooltip });
          } else {
            setSnapIndicator(null);
          }
          setTrackingGuide(null);
        } else if (wallFreeAngle) {
          setSnapIndicator(null);
          setTrackingGuide(null);
        }

        setWallCandidatePos(finalPos);

        if (isClosingLoop) {
          setMeasurements('🟢 Snap to Start Node · Click, press C, or press Enter to Close Room Loop & Assemble Floor Slab');
        } else if (wallVertices.length > 0) {
          const lastVertex = wallVertices[wallVertices.length - 1];
          const dist = lastVertex.distanceTo(finalPos);
          const angleMode = wallFreeAngle ? 'Free Angle' : '90° Locked';
          const tMm = ((wallToolSettings?.thickness || 0.2) * 1000).toFixed(0);
          const hM = (wallToolSettings?.height || 2.8).toFixed(2);
          const justStr = (wallJustification || 'exterior').toUpperCase();
          if (dist >= 0.05) {
            setMeasurements(`Wall: ${formatValue(dist, unit, 2)} × ${hM}m H × ${tMm}mm T · [${justStr}] (${angleMode} · Tab/J: Justify · T: Thickness · H: Height · C: Close · Esc: Cancel)`);
          }
        } else {
          const tMm = ((wallToolSettings?.thickness || 0.2) * 1000).toFixed(0);
          const justStr = (wallJustification || 'exterior').toUpperCase();
          setMeasurements(`Wall: Click or Drag to start · ${tMm}mm T · [${justStr}] (Tab/J: Justify · T: Thickness · H: Height)`);
        }
      }
    }

    if (activeTool === 'fence' || activeTool === 'railing' || activeTool === 'water' || activeTool === 'site_route') {
      const plane = fencePlane || new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const target = new THREE.Vector3();
      // Fences and ponds follow the ground. Railings stand on whatever is under the cursor
      // (a slab edge, a wall top, a deck, or the ground), never on a plane in mid air.
      const groundHit = activeTool === 'railing' ? railingSurfaceUnderCursor() : pointerGround(raycaster.ray);
      if (groundHit) target.copy(groundHit);
      if (groundHit || raycaster.ray.intersectPlane(plane, target)) {
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
          setMeasurements(`${activeTool === 'fence' ? 'Fence' : activeTool === 'water' ? 'Water outline' : activeTool === 'site_route' ? (routeTool.kind === 'road' ? 'Driving route' : 'Walking route') : 'Railing'}: Section ${formatValue(dist, unit, 2)} (${fenceVertices.length} placed) · Click next point · Double-click/Enter to finish`);
        } else {
          setMeasurements(`${activeTool === 'fence' ? 'Fence' : activeTool === 'water' ? 'Water outline' : activeTool === 'site_route' ? (routeTool.kind === 'road' ? 'Driving route' : 'Walking route') : 'Railing'}: Click terrain or ground to start drawing path`);
        }
      }
    }

    if (activeTool === 'door' || activeTool === 'window') {
      const intersects = raycaster.intersectObjects(scene.children, true);
      const shapeIntersect = intersects.find(i => i.object.userData.isShape);

      let targetWall: Shape | null = null;
      let targetRoof: Shape | null = null;
      let hitPoint: THREE.Vector3 | null = null;
      let roofQuat: THREE.Quaternion | null = null;
      let roofFaceNorm: THREE.Vector3 | null = null;

      if (shapeIntersect && shapeIntersect.object.userData.id) {
        const hitShape = shapes.find(s => s.id === shapeIntersect.object.userData.id);
        const isRoof = hitShape && (
          hitShape.tags?.some((t: string) => t.includes('roof')) ||
          hitShape.name?.toLowerCase().includes('roof')
        );

        if (activeTool === 'window' && (isRoof || (shapeIntersect.face && Math.abs(shapeIntersect.face.normal.y) < 0.95 && Math.abs(shapeIntersect.face.normal.y) > 0.05))) {
          targetRoof = hitShape || null;
          hitPoint = shapeIntersect.point.clone();
          roofFaceNorm = shapeIntersect.face?.normal 
            ? shapeIntersect.face.normal.clone().applyQuaternion(shapeIntersect.object.quaternion).normalize()
            : new THREE.Vector3(0, 1, 0);

          const up = new THREE.Vector3(0, 1, 0);
          let right = new THREE.Vector3().crossVectors(up, roofFaceNorm).normalize();
          if (right.lengthSq() < 0.001) right = new THREE.Vector3(1, 0, 0);
          const uphill = new THREE.Vector3().crossVectors(roofFaceNorm, right).normalize();
          const rotMatrix = new THREE.Matrix4().makeBasis(right, uphill, roofFaceNorm);
          roofQuat = new THREE.Quaternion().setFromRotationMatrix(rotMatrix);
        } else if (hitShape && hitShape.type === 'wall') {
          targetWall = hitShape;
          hitPoint = shapeIntersect.point.clone();
        }
      }

      if (!targetWall && !targetRoof) {
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

      if (targetRoof && hitPoint && roofQuat && roofFaceNorm) {
        setSnapIndicator(null);
        const width = 1.2;
        const height = 1.2;
        const depth = 0.2;
        const worldPos = hitPoint.clone().add(roofFaceNorm.clone().multiplyScalar(0.04));
        const quatArray: [number, number, number, number] = [roofQuat.x, roofQuat.y, roofQuat.z, roofQuat.w];

        setPreviewShape({
          type: 'window',
          archStyle: 'velux-roof',
          position: [worldPos.x, worldPos.y, worldPos.z],
          quaternion: quatArray,
          args: [width, height, depth],
          hostWallId: targetRoof.id
        } as any);

        setMeasurements(`Velux Roof Skylight: ${formatValue(width, unit, 2)} × ${formatValue(height, unit, 2)} on Roof Slope (Click to insert)`);
      } else if (targetWall && hitPoint) {
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
        const snapTolerance = Math.min(0.25, wallLen * 0.12);
        const inferenceTargets = [
          { ratio: 0.25, localX: -wallLen * 0.25, label: 'Wall 25% Point (1/4 Width)' },
          { ratio: 0.50, localX: 0, label: 'Wall Mid-point (50% Width)' },
          { ratio: 0.75, localX: wallLen * 0.25, label: 'Wall 75% Point (3/4 Width)' },
        ];

        let matchedTarget: { ratio: number; localX: number; label: string } | null = null;
        let bestDist = Infinity;
        for (const target of inferenceTargets) {
          if (Math.abs(target.localX) <= maxLocalX) {
            const dist = Math.abs(localHit.x - target.localX);
            if (dist <= snapTolerance && dist < bestDist) {
              bestDist = dist;
              matchedTarget = target;
            }
          }
        }

        const localX = matchedTarget ? matchedTarget.localX : Math.max(-maxLocalX, Math.min(maxLocalX, localHit.x));
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

        if (matchedTarget) {
          const snapWorldPos = new THREE.Vector3(matchedTarget.localX, localY, 0)
            .applyQuaternion(wallQuat)
            .add(wallPos);
          setSnapIndicator({
            point: [snapWorldPos.x, snapWorldPos.y, snapWorldPos.z],
            type: 'midpoint',
            tooltip: `Inference Lock: ${matchedTarget.label}`
          });
          setMeasurements(
            activeTool === 'door'
              ? `Door: ${formatValue(width, unit, 2)} × ${formatValue(height, unit, 2)} — Locked to ${matchedTarget.label} (Click to insert & cut opening)`
              : `Window: ${formatValue(width, unit, 2)} × ${formatValue(height, unit, 2)} — Locked to ${matchedTarget.label} (Click to insert & cut opening)`
          );
        } else {
          setSnapIndicator(null);
          setMeasurements(
            activeTool === 'door'
              ? `Door: ${formatValue(width, unit, 2)} × ${formatValue(height, unit, 2)} on Wall (Click to insert & cut opening)`
              : `Window: ${formatValue(width, unit, 2)} × ${formatValue(height, unit, 2)} (Sill ${formatValue(0.9, unit, 2)}) on Wall (Click to insert & cut opening)`
          );
        }
      } else if (hitPoint) {
        setSnapIndicator(null);
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
        setMeasurements(`Click on a wall or roof to insert ${activeTool}.`);
      }
      return;
    }

    if (activeTool === 'scale_figure') {
      const ray = raycaster.ray;
      const intersects = raycaster.intersectObjects(scene.children, true);
      const shapeIntersect = intersects.find(i => 
        !i.object.userData.isHelper &&
        !i.object.userData.isPreview &&
        !i.object.userData.isGizmo &&
        (i.object.userData.isShape || i.object.userData.isKernelGeometry)
      );

      let hitPoint: THREE.Vector3 | null = null;
      if (shapeIntersect) {
        hitPoint = shapeIntersect.point.clone();
      } else {
        const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const groundHit = new THREE.Vector3();
        if (ray.intersectPlane(groundPlane, groundHit)) {
          hitPoint = groundHit;
        }
      }

      if (hitPoint) {
        const char = SCALE_FIGURE_CHARACTERS.find(c => c.id === activeScaleFigureCharacter) || SCALE_FIGURE_CHARACTERS[0];
        const targetH = activeScaleFigureHeight && activeScaleFigureHeight > 0.5 ? activeScaleFigureHeight : char.height;

        setPreviewShape({
          type: 'scale_figure',
          position: [hitPoint.x, hitPoint.y, hitPoint.z],
          quaternion: [0, 0, 0, 1],
          args: [char.width, targetH, char.depth],
          archStyle: char.id,
          color: char.primaryColor
        });
        setMeasurements(`Scale Figure: ${char.name} (${targetH.toFixed(2)}m eye-level) — Click to place benchmark`);
      }
      return;
    }

    if (activeTool === 'staircase' || activeTool === 'step') {
      const ray = raycaster.ray;
      const intersects = raycaster.intersectObjects(scene.children, true);
      const shapeIntersect = intersects.find(i => 
        !i.object.userData.isHelper &&
        !i.object.userData.isPreview &&
        !i.object.userData.isGizmo &&
        (i.object.userData.isShape || 
         i.object.userData.isKernelGeometry || 
         ((i.object as any).isMesh && i.object.name !== 'previewMesh'))
      );

      let hitPoint: THREE.Vector3 | null = null;
      let surfaceElevation = 0;

      if (shapeIntersect) {
        hitPoint = shapeIntersect.point.clone();
        surfaceElevation = shapeIntersect.point.y;
      } else {
        const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const groundHit = new THREE.Vector3();
        if (ray.intersectPlane(groundPlane, groundHit)) {
          hitPoint = groundHit;
          surfaceElevation = 0;
        }
      }

      if (hitPoint) {
        if (snapIndicator) {
          hitPoint = new THREE.Vector3(...snapIndicator.point);
          surfaceElevation = snapIndicator.point[1];
        }

        const isStaircase = activeTool === 'staircase';
        const width = 1.0;
        let height = isStaircase ? 2.16 : 0.18;
        let length = isStaircase ? 3.60 : 0.30;
        let parametricCalc: any = null;
        let scanResult: any = null;

        if (isStaircase) {
          scanResult = scanSceneForTargetHeight(shapes, surfaceElevation, [hitPoint.x, surfaceElevation, hitPoint.z]);
          parametricCalc = calculateParametricStairs({
            targetHeight: scanResult.targetHeight,
            width: 1.0,
            source: scanResult.source,
            sourceDescription: scanResult.description
          });
          height = parametricCalc.targetHeight;
          length = parametricCalc.totalRun;
        }

        const stairPos = new THREE.Vector3(hitPoint.x, surfaceElevation + height / 2, hitPoint.z);

        const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), stairRotationAngle);
        const quatArray: [number, number, number, number] = [quat.x, quat.y, quat.z, quat.w];

        setPreviewShape({
          type: activeTool,
          position: [stairPos.x, stairPos.y, stairPos.z],
          quaternion: quatArray,
          args: isStaircase ? [width, height, length, parametricCalc?.stepCount || 12] : [width, height, length],
          stairStyle: 'straight',
          stairStructure: 'closed',
          railingMode: 'both',
          isParametric: isStaircase,
          parametricData: parametricCalc || undefined,
        } as any);

        const deg = Math.round(((stairRotationAngle * 180) / Math.PI) % 360);
        const normDeg = deg < 0 ? deg + 360 : deg;
        if (isStaircase && parametricCalc && scanResult) {
          setMeasurements(`Parametric Staircase: ${parametricCalc.stepCount} Steps (Riser: ${(parametricCalc.actualStepHeight * 100).toFixed(1)}cm, Tread: ${(parametricCalc.treadDepth * 100).toFixed(1)}cm) | Rise: ${parametricCalc.targetHeight.toFixed(2)}m (${scanResult.description}) | Angle: ${normDeg}° [← / → rotate] | Click to place`);
        } else {
          setMeasurements(`Step: 1.00m × 0.30m (Rise 0.18m) | Angle: ${normDeg}° [Use ← / → to rotate] | Click to place`);
        }
      }
      return;
    }

    if (activeTool === 'pad-rect' || activeTool === 'pad-circle') {
      const intersects = raycaster.intersectObjects(scene.children, true);
      const shapeIntersect = intersects.find(i => i.object.userData.isShape);
      const hitPoint = shapeIntersect ? shapeIntersect.point.clone() : e.point.clone();
      const primitive = activeTool === 'pad-rect' ? 'rectangle' : 'circle';
      setActivePadDraft({
        center: [hitPoint.x, civilPadSettings.targetElevation, hitPoint.z],
        dimensions: [civilPadSettings.dimensions[0], civilPadSettings.dimensions[1]],
        primitive,
      });
      setMeasurements(`Grading Pad: Click to place ${primitive} pad (${civilPadSettings.dimensions[0]}m × ${civilPadSettings.dimensions[1]}m) at EL ${civilPadSettings.targetElevation >= 0 ? '+' : ''}${civilPadSettings.targetElevation}m`);
      return;
    }

    if (activeTool === 'road' && activeSplineDraft.length > 0) {
      const intersects = raycaster.intersectObjects(scene.children, true);
      const shapeIntersect = intersects.find(i => i.object.userData.isShape);
      const hitPoint = shapeIntersect ? shapeIntersect.point.clone() : e.point.clone();
      const lastKnot = new THREE.Vector3(...activeSplineDraft[activeSplineDraft.length - 1]);
      const dist = lastKnot.distanceTo(hitPoint);
      setMeasurements(`Road Alignment: ${activeSplineDraft.length} knots · Span to cursor: ${dist.toFixed(2)}m · Click next knot · Double-click / Enter to finalize`);
    }

    if (activeTool === 'terrain') {
      const existing = shapes.find(s => s.type === 'terrain' && !s.hidden);
      if (existing) {
        setMeasurements(`Base Terrain: Active (${existing.terrainData?.width || 50}m × ${existing.terrainData?.depth || 50}m) · Click to select · Configure in Landscape Toolbar`);
      } else {
        setMeasurements(`Base Terrain Canvas: Click in 3D viewport to add 50m × 50m site terrain · Or configure in Landscape Toolbar`);
      }
      return;
    }

    // ---- Hover snapping, BEFORE a drag begins ----
    //
    // The snap pass below lives inside `if (drawingStart && drawingNormal)`,
    // so it only ran while a line was being dragged. The END of a line
    // therefore snapped and its START never did: at pointer-down there was no
    // drawingStart, so no candidates were computed and snapIndicator was null.
    //
    // That is why a rectangle is easy — each line starts where you can see the
    // last one — while joining two parallel lines is fiddly at both ends.
    if (!drawingStart && KERNEL_SNAP_TOOLS.includes(activeTool) && !['poly', 'bezier', 'arc'].includes(activeTool)) {
      // Before the first click: where a shape or line could start (corners, crossings, points on
      // an edge or a guide). No plane yet, so the ground stands in for the pointer's position.
      publishSnap(snapHere(snapCursor(null), null, null));
    } else if ((activeTool === 'poly' && polyVertices.length === 0) || (activeTool === 'bezier' && bezierKnots.length === 0)) {
      snapCurve(activeTool);
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

        // One shared snap (tools/snapEngine.ts): points, crossings, directions from where the
        // line started, and the locks (arrows, X / Y / Z, Shift).
        const snap = snapHere(target, plane, drawingStart);
        target.copy(snap.point);
        publishSnap(snap);
        setTrackingGuide(null);
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
          // Shift constrains the rectangle to a square — matches the
          // standard convention other drawing tools use (many CAD apps,
          // Figma): take the larger of the two drag distances, keep
          // each axis's own sign so the square still extends in the
          // direction the cursor is actually in, not always toward one
          // fixed corner.
          let xDistConstrained = xDist;
          let yDistConstrained = yDist;
          if (e.shiftKey) {
            const side = Math.max(Math.abs(xDist), Math.abs(yDist));
            xDistConstrained = Math.sign(xDist || 1) * side;
            yDistConstrained = Math.sign(yDist || 1) * side;
          }
          // A rectangle is four edges. Capturing the corners here lets it be
          // committed to the kernel instead of as a flat Shape, which is what
          // makes it splittable and push/pullable like any drawn surface.
          kernelRingRef.current = [
            drawingStart.clone(),
            drawingStart.clone().addScaledVector(tangent, xDistConstrained),
            drawingStart.clone().addScaledVector(tangent, xDistConstrained).addScaledVector(bitangent, yDistConstrained),
            drawingStart.clone().addScaledVector(bitangent, yDistConstrained),
          ];
          const centerX = drawingStart.clone().add(tangent.clone().multiplyScalar(xDistConstrained / 2)).add(bitangent.clone().multiplyScalar(yDistConstrained / 2));
          centerX.add(drawingNormal.clone().multiplyScalar(0.005));
          setPreviewShape({
            type: 'rect',
            position: [centerX.x, centerX.y, centerX.z],
            quaternion: quatArray,
            args: [Math.abs(xDistConstrained), 0.01, Math.abs(yDistConstrained)]
          });
          setMeasurements(e.shiftKey
            ? `${formatValue(Math.abs(xDistConstrained), unit, 1)} x ${formatValue(Math.abs(yDistConstrained), unit, 1)} (square)`
            : `${formatValue(Math.abs(xDist), unit, 1)} x ${formatValue(Math.abs(yDist), unit, 1)}`);
        } else if (activeTool === 'circle') {
          const radius = drawingStart.distanceTo(target);
          // A circle is a closed ring of straight edges — the same
          // tessellation the arc tool uses. 32 segments matches the preview.
          kernelRingRef.current = Array.from({ length: 32 }, (_, i) => {
            const a = (i / 32) * Math.PI * 2;
            return drawingStart.clone()
              .addScaledVector(tangent, Math.sin(a) * radius)
              .addScaledVector(zAxis, Math.cos(a) * radius);
          });
          const pos = drawingStart.clone().add(drawingNormal.clone().multiplyScalar(0.005));
          setPreviewShape({
            type: 'circle',
            position: [pos.x, pos.y, pos.z],
            quaternion: quatArray,
            args: [radius, radius, 0.01, 32]
          });
          setMeasurements(`Radius: ${formatValue(radius, unit, 1)}`);
        } else if (activeTool === 'polygon') {
          const radius = drawingStart.distanceTo(target);
          const sides = Math.min(64, Math.max(3, polygonSides || 6));
          kernelRingRef.current = Array.from({ length: sides }, (_, i) => {
            const a = (i / sides) * Math.PI * 2;
            return drawingStart.clone()
              .addScaledVector(tangent, Math.sin(a) * radius)
              .addScaledVector(zAxis, Math.cos(a) * radius);
          });
          const pos = drawingStart.clone().add(drawingNormal.clone().multiplyScalar(0.005));
          setPreviewShape({
            type: 'circle',
            position: [pos.x, pos.y, pos.z],
            quaternion: quatArray,
            args: [radius, radius, 0.01, sides]
          });
          setMeasurements(`Polygon (${sides}s) Radius: ${formatValue(radius, unit, 1)} [↑/↓ keys: sides]`);
        } else if (activeTool === 'triangle') {
          const radius = drawingStart.distanceTo(target);
          // Match the PREVIEW exactly, or the committed triangle is a
          // different triangle. Two details decide it:
          //   * the preview's basis is makeBasis(tangent, normal, zAxis) with
          //     zAxis = cross(tangent, normal) — the opposite handedness to
          //     `bitangent`, which is cross(normal, tangent). Using bitangent
          //     mirrors the shape.
          //   * three's CylinderGeometry places vertices at
          //     x = r*sin(theta), z = r*cos(theta) — sin on X, cos on Z, not
          //     the other way round.
          kernelRingRef.current = [0, 1, 2].map(i => {
            const a = (i / 3) * Math.PI * 2;
            return drawingStart.clone()
              .addScaledVector(tangent, Math.sin(a) * radius)
              .addScaledVector(zAxis, Math.cos(a) * radius);
          });
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
          // Record the TRUE endpoints before the preview is built. The preview
          // is lifted 0.01 along the normal to avoid z-fighting, so
          // reconstructing endpoints from it puts every edge 0.01 off the
          // plane — and the next line, snapped to that displaced vertex and
          // lifted again, compounds the error. That is why lines looked joined
          // but left a gap.
          kernelLineEndsRef.current = { from: drawingStart.clone(), to: target.clone() };
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
        } else if ((activeTool as string) === 'step') {
          const stepPos = target.clone().add(drawingNormal.clone().multiplyScalar(0.09));
          setPreviewShape({
            type: 'step',
            position: [stepPos.x, stepPos.y, stepPos.z],
            quaternion: quatArray,
            args: [1.0, 0.18, 0.30]
          });
          setMeasurements(`Step: 1.00m × 0.30m × 0.18m`);
        } else if ((activeTool as string) === 'staircase') {
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
        
        // Apply tactile contact friction during push/pull extrusion against adjacent shapes/surfaces
        if (contactFrictionEnabled) {
          const now = Date.now();
          if (now < frictionPausedUntilRef.current) {
            return;
          }
          const mesh = getSceneObjectById(pushPullState.id);
          if (mesh) {
            const isColliding = checkCollision(pushPullState.id, mesh as THREE.Mesh);
            if (isColliding && !hasReachedFrictionRef.current) {
              hasReachedFrictionRef.current = true;
              const pauseMs = Math.round(60 + ((contactFrictionStrength ?? 50) / 100) * 440);
              frictionPausedUntilRef.current = now + pauseMs;
              return;
            }
            if (!isColliding) {
              hasReachedFrictionRef.current = false;
            }
          }
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
    if (activeTool === 'walk' || activeTool === 'look' || activeTool === 'patio' || activeTool === 'protractor') return;

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

    if (activeTool === 'bezier') {
      bezierToolRef.current.onPointerUp();
      setIsDraggingBezierHandle(false);
      setBezierKnots([...bezierToolRef.current.getKnots()]);
    }

    if (activeTool === 'wall') {
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
        recordAction(actionLabel(`Bevel ${shape.name || shape.id}`));
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
        // Use the endpoints captured during preview, NOT the preview's own
        // transform, which is offset for z-fighting.
        // The capture only happens inside the preview branch, which needs a
        // valid plane hit in range. If the ray grazed the plane the ref is
        // null — and silently skipping there is why lines occasionally failed
        // to appear. Fall back to the preview transform with the z-fighting
        // lift removed: slightly less exact, but a line drawn always lands.
        let lineFrom = kernelLineEndsRef.current?.from ?? null;
        let lineTo = kernelLineEndsRef.current?.to ?? null;

        if (!lineFrom || !lineTo) {
          const lq = new THREE.Quaternion(
            previewShape.quaternion[0], previewShape.quaternion[1],
            previewShape.quaternion[2], previewShape.quaternion[3]
          );
          const ldir = new THREE.Vector3(0, 1, 0).applyQuaternion(lq);
          const lmid = new THREE.Vector3(
            previewShape.position[0], previewShape.position[1], previewShape.position[2]
          );
          if (drawingNormal) lmid.addScaledVector(drawingNormal, -0.01);
          const llen = Array.isArray(previewShape.args) ? (previewShape.args[2] as number) : 0;
          lineFrom = lmid.clone().addScaledVector(ldir, -llen / 2);
          lineTo = lmid.clone().addScaledVector(ldir, llen / 2);
        }

        commitKernelLine(lineFrom, lineTo);
        kernelLineEndsRef.current = null;
      } else if (
        previewShape &&
        ['rect', 'circle', 'triangle'].includes(previewShape.type) &&
        kernelRingRef.current
      ) {
        // Emit the ring as ISOLATED edges — deliberately NOT the same
        // sticky insertEdge path a line drawn with the Line tool uses.
        // Rectangle/Circle/Triangle draw a single, complete shape as one
        // gesture; the shape still snaps onto an existing vertex the
        // user deliberately targets, but it no longer splits (or gets
        // split by) unrelated geometry it merely happens to cross —
        // that used to turn two overlapping rectangles into three
        // faces (two L-shaped remainders plus a shared sliver) instead
        // of leaving both rectangles intact and independently
        // selectable. See insertIsolatedEdge's own doc comment for the
        // full reasoning, and why the Line/Arc tool keeps the original
        // behaviour instead — dividing a surface is what THAT tool is
        // for.
        const ring = kernelRingRef.current;
        kernelRingRef.current = null;
        // One shape, one undo step; its new faces are marked as isolated shapes so push/pull
        // keeps them isolated too (see KernelLineHost.commitIsolatedShape). A typed size right
        // after redraws it at that size.
        const ringTool = activeTool in RING_TOOLS ? activeTool : previewShape.type === 'rect' ? 'rectangle' : previewShape.type === 'triangle' ? 'triangle' : 'circle';
        commitKernelRing(ringTool, RING_TOOLS[ringTool] ?? 'Shape', ring, shapeRingRemaker(ringTool, drawingStart.clone(), drawingNormal.clone(), ring));
      } else if (previewShape) {
        const primitiveId = Math.random().toString(36).substr(2, 9);
        if (['sphere', 'cone', 'pyramid', 'donut', 'dome'].includes(previewShape.type)) {
          offerPrimitiveAdjust(primitiveId, previewShape.type, drawingStart.clone(), drawingNormal.clone());
        }
        addShape({
          id: primitiveId,
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
    // Double-click a group or component to edit inside it.
    if (activeTool === 'select') {
      const target = shapes.find(sh => sh.id === id);
      if (target && isGroupShape(target)) {
        enterGroupEdit(id);
        setMeasurements(`Editing ${target.name ?? 'the group'}: draw and edit as usual. Press Esc (with nothing drawing) or Close to finish.`);
        return;
      }
    }
    if (activeTool === 'select' && (wallRunInfo.runOf.get(id)?.length ?? 1) > 1) {
      // Double-click a piece of a wall run: just that piece.
      setSelectedId(id);
      setSelectedIds([id]);
      setSelectedSurface(null);
      setMeasurements('Selected one piece of the wall. Click the wall again to select all of it.');
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
    if ((window as any).__polyformLassoIgnoreClickUntil && Date.now() < (window as any).__polyformLassoIgnoreClickUntil) {
      return;
    }
    if (activeTool === 'followme' || activeTool === 'section') return; // these tools pick faces themselves, not objects
    
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
      // A piece of a wall run selects the whole run (double-click picks the single piece).
      const run = shape?.type === 'wall' ? (wallRunInfo.runOf.get(id) ?? [id]) : [id];
      if (e.shiftKey) {
        setSelectedIds(prev => prev.includes(id) ? prev.filter(i => !run.includes(i)) : [...prev, ...run.filter(r => !prev.includes(r))]);
        setSelectedId(null);
      } else if (run.length > 1) {
        const alreadyRun = selectedIds.length === run.length && run.every(r => selectedIds.includes(r));
        setSelectedId(alreadyRun ? null : id);
        setSelectedIds(alreadyRun ? [] : run);
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
      setSelectedModifierId(null);
    } else if (activeTool === 'paint') {
    const paintRun = shape?.type === 'wall' ? wallRunInfo.runOf.get(id) : undefined;
    if (paintRun && paintRun.length > 1 && subFaceIndex === undefined) {
      // A wall run is painted as one wall: Shift paints just the curve (or straight stretch)
      // it is in, Alt just this piece.
      const ids = e.altKey ? [id] : e.shiftKey ? sameShapePart(wallRunInfo, id) : paintRun;
      updateShapeColor(ids, activeMaterial, activePBR, activeSurfaceDepth);
      setMeasurements(e.altKey ? 'Painted one piece of the wall.' : e.shiftKey
        ? `Painted the ${wallRunInfo.curved.has(id) ? 'curved' : 'straight'} part of the wall (${ids.length} piece${ids.length === 1 ? '' : 's'}).`
        : `Painted the whole wall (${ids.length} pieces). Shift+click paints just the curved or straight part; Alt+click one piece.`);
    } else if (!e.shiftKey && subFaceIndex !== undefined) {
      // Apply to sub-face
      const key = `${e.faceIndex}-${subFaceIndex}`;
      setShapes(prev => prev.map(s => {
        if (s.id === id) {
          return {
            ...s,
            surfaceMaterials: {
              ...(s.surfaceMaterials || {}),
              [key]: activeMaterial
            },
            surfaceMaterialBindings: {
              ...(s.surfaceMaterialBindings || {}),
              [key]: activeMaterialBindingId ?? '',
            },
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
            },
            surfaceMaterialBindings: {
              ...(s.surfaceMaterialBindings || {}),
              [faceKey]: activeMaterialBindingId ?? '',
            },
          };
        }
        return s;
      }));
    } else {
      // Apply to whole object (default for shapes without per-face support, or forced via Shift+click)
      updateShapeColor(id, activeMaterial, activePBR, activeSurfaceDepth);
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
      if (e.shiftKey) {
        // Shift + click deletes a single surface
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
          commitHistory();
        } else if (shape && shape.surfaceMaterials && e.faceIndex !== undefined) {
          const faceKey = Math.floor(e.faceIndex / 2) * 2;
          setShapes(prev => prev.map(s => {
            if (s.id === id) {
              const newSurfaceMaterials = { ...(s.surfaceMaterials || {}) };
              delete newSurfaceMaterials[faceKey];
              delete newSurfaceMaterials[e.faceIndex!];
              const newSurfaceDivisions = { ...(s.surfaceDivisions || {}) };
              delete newSurfaceDivisions[faceKey];
              delete newSurfaceDivisions[e.faceIndex!];
              return { ...s, surfaceMaterials: newSurfaceMaterials, surfaceDivisions: newSurfaceDivisions };
            }
            return s;
          }));
          commitHistory();
        } else if (shape && shape.surfaceDivisions && e.faceIndex !== undefined) {
          const faceKey = Math.floor(e.faceIndex / 2) * 2;
          setShapes(prev => prev.map(s => {
            if (s.id === id) {
              const newDivs = { ...(s.surfaceDivisions || {}) };
              delete newDivs[faceKey];
              delete newDivs[e.faceIndex!];
              return { ...s, surfaceDivisions: newDivs };
            }
            return s;
          }));
          commitHistory();
        } else {
          removeShape(id);
          commitHistory();
          if (selectedId === id) setSelectedId(null);
          setSelectedIds(prev => prev.filter(i => i !== id));
        }
      } else {
        // Plain click deletes all surfaces of that object
        removeShape(id);
        commitHistory();
        if (selectedId === id) setSelectedId(null);
        setSelectedIds(prev => prev.filter(i => i !== id));
      }
    }
  };


  const handleContextMenu = (e: any, id: string, type: 'shape' | 'light' | 'surface' = 'shape') => {
    e.stopPropagation();
    if (e.nativeEvent) e.nativeEvent.preventDefault();
    else if (e.preventDefault) e.preventDefault();
    
    const clientX = e.nativeEvent?.clientX ?? e.clientX;
    const clientY = e.nativeEvent?.clientY ?? e.clientY;

    if (type === 'light') {
      setSelectedLightId(id);
      setSelectedId(null);
      setSelectedIds([]);
      setSelectedSurface(null);
      setContextMenu({ x: clientX, y: clientY, type: 'light', data: id });
      return;
    }

    // A height-mapped wall can win the raycast just in front of a hosted
    // door/window. Give the fixture under this pointer its own context menu.
    const clickedShape = shapes.find(s => s.id === id);
    if (clickedShape?.type === 'wall' && Number.isFinite(clientX) && Number.isFinite(clientY)) {
      const bounds = gl.domElement.getBoundingClientRect();
      if (bounds.width > 0 && bounds.height > 0) {
        const pointer = new THREE.Vector2(
          ((clientX - bounds.left) / bounds.width) * 2 - 1,
          -((clientY - bounds.top) / bounds.height) * 2 + 1,
        );
        const fixtureId = pickHostedFixture(id, shapes, camera, pointer, getSceneObjectById);
        if (fixtureId) {
          setSelectedId(fixtureId);
          setSelectedIds([fixtureId]);
          setSelectedSurface(null);
          setContextMenu({ x: clientX, y: clientY, type: 'multi', data: [fixtureId] });
          return;
        }
      }
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

    if (pickingSunCenter) {
      // Same click-to-place priority as placingLightId/placingAnimationId
      // just above — a one-off pick takes over whatever the click would
      // otherwise have done, the same way those do.
      e.stopPropagation();
      pickSunCenter(e.point);
      return;
    }

    if (activeTool === 'note') {
      e.stopPropagation();
      setPlacingNotePos(e.point.clone());
      return;
    }

    if (activeTool === 'text' || activeTool === 'text3d') {
      e.stopPropagation();
      const normal = e.face ? e.face.normal.clone().transformDirection(e.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
      startTextPlacement(e.point.clone(), normal);
      return;
    }

    if (activeTool === 'combine') {
      e.stopPropagation();
      setCombinePicks(prev => prev.some(p => p.kind === 'shape' && p.id === shape.id)
        ? prev.filter(p => !(p.kind === 'shape' && p.id === shape.id))
        : [...prev, { kind: 'shape', id: shape.id }]);
      return;
    }

    if (activeTool === 'subtract') {
       e.stopPropagation();
       if (kernelSubtractTarget) {
         // A kernel solid was already armed as the target (via
         // handleKernelFacePointerDown, above) — this Shape click is the
         // cutter. See performMixedCSGSubtraction's own doc comment for
         // why this cross-check exists.
         performMixedCSGSubtraction({ kind: 'kernel', faces: kernelSubtractTarget }, { kind: 'shape', id: shape.id });
         setKernelSubtractTarget(null);
         setSelectedFaceIds([]);
         setSubtractTargetId(null);
       } else if (!subtractTargetId) {
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
            : shape.type === 'cylinder'
              ? Math.max(0.01, Math.min(shape.args[0], shape.args[1], shape.args[2] / 2))
              : shape.type === 'poly'
                ? Math.max(0.01, ((shape.args as any)?.height || 1) / 2)
                : 1
      });
    } else if (activeTool === 'paint') {
      e.stopPropagation();
      handleMeshClick(e as any, shape.id);
    } else if (activeTool === 'eraser') {
      // Delete on click, after pointer down/up have completed. Removing the
      // front mesh here makes the same gesture click the object behind it.
      e.stopPropagation();
    } else if (['move', 'rotate', 'scale'].includes(activeTool)) {
      e.stopPropagation();
      setSelectedId(shape.id);
      setSelectedIds([shape.id]);
    } else if (activeTool === 'tape' || activeTool === 'teleport') {
      handlePointerDown(e);
    } else if (['poly', 'rectangle', 'circle', 'polygon', 'line', 'arc', 'triangle', 'sphere', 'cone', 'pyramid', 'donut', 'dome', 'wall', 'door', 'window', 'step', 'staircase', 'scale_figure', 'landscape_sculpt', 'landscape_mask', 'landscape_road', 'landscape_zone', 'landscape_plot', 'landscape_form', 'landscape_embed', 'landscape_texture', 'tree', 'bush', 'fence', 'railing', 'water', 'site_route', 'lamp', 'bench', 'rock', 'block_picker'].includes(activeTool)) {
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
        if (contactFrictionEnabled && (activeTool === 'move' || activeTool === 'select')) {
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
            const pauseMs = Math.round(80 + ((contactFrictionStrength ?? 50) / 100) * 440);
            frictionPausedUntilRef.current = now + pauseMs; // Scale friction pause by user strength setting
            if (lastValidPosRef.current) {
              mesh.position.copy(lastValidPosRef.current);
            }
            return;
          }
          if (isColliding && lastValidPosRef.current) {
            // Apply slight physical drag resistance when colliding
            const resistance = ((contactFrictionStrength ?? 50) / 100) * 0.4;
            mesh.position.lerp(lastValidPosRef.current, resistance);
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

  /** Where the object was when the gizmo was grabbed, for adjusting the move with a typed value. */
  const transformStartRef = useRef<{ id: string; position: [number, number, number]; quaternion: [number, number, number, number]; scale: [number, number, number] } | null>(null);

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

        setShapes(prev => {
          const updated = prev.map(s => s.id === sId ? { 
            ...s, 
            position, 
            quaternion,
            scale,
            hostWallId: updatedHostWallId
          } : s);
          const withCutouts = applyStairwellHolesToSlabs(updated);
          return updateTimberFramesIfPresent(withCutouts);
        });

        // Clear active transform from presence
        if (currentModelId && user?.email) {
          const collabId = `${currentModelId}_${user.email.toLowerCase()}`;
          updateDoc(doc(db, 'collaborations', collabId), {
            activeTransform: null
          }).catch(() => {});
        }
        
        recordAction(actionLabel(`Move/rotate/scale ${sId}`));
        const start = transformStartRef.current;
        if (start && start.id === sId) offerTransformAdjust(sId, activeTool, start, { position, quaternion, scale });
      }
    }
    captureDiagnosticData();
    setTransformInfo(null);
  };

  const isTransforming = ['move', 'rotate', 'scale'].includes(activeTool);

  /**
   * Heals T-junctions in a raw CSG result — shared by both
   * performCSGOperation and performKernelCSGSubtraction below, called
   * BEFORE removeDegenerateCSGTriangles (see that function's own doc
   * comment for a different, separate artifact).
   *
   * The actual root cause of the persistent "extra edge lines" reports,
   * traced directly by reading Three.js's own EdgesGeometry source
   * rather than assuming: any edge that appears only ONCE in the whole
   * mesh (no matching sibling from a neighboring triangle) is drawn
   * UNCONDITIONALLY, with no angle check at all. mergeVertices and
   * removeDegenerateCSGTriangles both address a different problem
   * (coplanar triangles not sharing normals, and zero-area slivers) —
   * neither touches this one, which is why those fixes alone left the
   * lines still visible.
   *
   * A T-junction is the actual cause: one face's own triangulation
   * splits an edge at a point where the cutting shape's boundary
   * crossed it, but the face on the OTHER side of that same edge either
   * isn't split at all, or is split at a DIFFERENT point — confirmed
   * directly by inspecting the unmatched edges themselves, several of
   * which are colinear fragments that together span exactly one
   * neighboring face's own unsplit (or differently-split) edge.
   *
   * The fix: repeatedly find any vertex in the mesh that lies strictly
   * between a triangle edge's own two endpoints (not just at them), and
   * subdivide that triangle at every such point (a fan of new triangles
   * along the split edge, all sharing the triangle's third, opposite
   * vertex). All independent splits found in one pass are batched
   * together before re-scanning, rather than one at a time — verified
   * directly this converges in 2 passes on every case tried so far,
   * against dozens of passes and a slower per-split approach tried
   * first. Verified directly (not assumed) that this never changes the
   * mesh's own total surface area or bounding box — splitting a
   * triangle changes how many pieces represent a face, never what
   * shape or how much of it exists.
   */
  function healTJunctions(geometry: THREE.BufferGeometry, maxPasses = 12): void {
    const PRECISION = 1e4;
    const posKey = (v: THREE.Vector3) =>
      `${Math.round(v.x * PRECISION)},${Math.round(v.y * PRECISION)},${Math.round(v.z * PRECISION)}`;

    for (let pass = 0; pass < maxPasses; pass++) {
      const index = geometry.index;
      const posAttr = geometry.attributes.position;
      if (!index || !posAttr) return;
      const normalAttr = geometry.getAttribute('normal');
      const uvAttr = geometry.getAttribute('uv');
      const triCount = index.count / 3;

      const allPositions: THREE.Vector3[] = [];
      const seen = new Set<string>();
      for (let i = 0; i < posAttr.count; i++) {
        const p = new THREE.Vector3().fromBufferAttribute(posAttr, i);
        const k = posKey(p);
        if (!seen.has(k)) { seen.add(k); allPositions.push(p); }
      }

      const newPositions: number[] = [];
      const newNormals: number[] | null = normalAttr ? [] : null;
      const newUvs: number[] | null = uvAttr ? [] : null;
      const newIndices: number[] = [];
      let anySplit = false;

      for (let i = 0; i < posAttr.count; i++) {
        newPositions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
        if (normalAttr && newNormals) newNormals.push(normalAttr.getX(i), normalAttr.getY(i), normalAttr.getZ(i));
        if (uvAttr && newUvs) newUvs.push(uvAttr.getX(i), uvAttr.getY(i));
      }

      const addVertex = (P: THREE.Vector3, aIdx: number, bIdx: number, tFrac: number): number => {
        const newIdx = newPositions.length / 3;
        newPositions.push(P.x, P.y, P.z);
        if (normalAttr && newNormals) {
          for (let k = 0; k < 3; k++) {
            const va = normalAttr.array[aIdx * 3 + k], vb = normalAttr.array[bIdx * 3 + k];
            newNormals.push(va + (vb - va) * tFrac);
          }
        }
        if (uvAttr && newUvs) {
          for (let k = 0; k < 2; k++) {
            const va = uvAttr.array[aIdx * 2 + k], vb = uvAttr.array[bIdx * 2 + k];
            newUvs.push(va + (vb - va) * tFrac);
          }
        }
        return newIdx;
      };

      for (let t = 0; t < triCount; t++) {
        const vi = [index.getX(t * 3), index.getX(t * 3 + 1), index.getX(t * 3 + 2)];
        const pts = vi.map((i) => new THREE.Vector3().fromBufferAttribute(posAttr, i));
        const hashes = pts.map(posKey);
        if (hashes[0] === hashes[1] || hashes[1] === hashes[2] || hashes[2] === hashes[0]) {
          // Degenerate — leave as-is here; removeDegenerateCSGTriangles
          // (called right after this) is what actually strips these out.
          newIndices.push(vi[0]!, vi[1]!, vi[2]!);
          continue;
        }

        let splitEdge = -1;
        let splitPoints: THREE.Vector3[] | null = null;
        for (let j = 0; j < 3; j++) {
          const jn = (j + 1) % 3;
          const A = pts[j]!, B = pts[jn]!;
          const segLen = A.distanceTo(B);
          if (segLen < 1e-9) continue;
          const dir = B.clone().sub(A).normalize();
          const found: { P: THREE.Vector3; proj: number }[] = [];
          for (const P of allPositions) {
            const kP = posKey(P);
            if (kP === hashes[j] || kP === hashes[jn]) continue;
            const proj = P.clone().sub(A).dot(dir);
            if (proj <= 1e-6 || proj >= segLen - 1e-6) continue;
            const closest = A.clone().addScaledVector(dir, proj);
            if (closest.distanceTo(P) > 1e-4) continue;
            found.push({ P, proj });
          }
          if (found.length > 0) {
            found.sort((a, b) => a.proj - b.proj);
            splitEdge = j;
            splitPoints = found.map((f) => f.P);
            break; // one edge's splits per triangle per pass; any remaining edge is handled next pass
          }
        }

        if (splitEdge === -1 || !splitPoints) {
          newIndices.push(vi[0]!, vi[1]!, vi[2]!);
          continue;
        }

        anySplit = true;
        const j = splitEdge, jn = (j + 1) % 3, jc = 3 - j - jn;
        const a = vi[j]!, b = vi[jn]!, c = vi[jc]!;
        const A = pts[j]!, B = pts[jn]!;
        const segLen = A.distanceTo(B);

        let prevIdx = a;
        for (const P of splitPoints) {
          const tFrac = A.distanceTo(P) / segLen;
          const newIdx = addVertex(P, a, b, tFrac);
          newIndices.push(prevIdx, newIdx, c);
          prevIdx = newIdx;
        }
        newIndices.push(prevIdx, b, c);
      }

      geometry.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
      if (normalAttr && newNormals) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(newNormals, 3));
      if (uvAttr && newUvs) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(newUvs, 2));
      geometry.setIndex(newIndices);

      if (!anySplit) return;
    }
  }

  /**
   * Removes degenerate (zero-area, or literally two-of-three-vertices-
   * identical) triangles from a CSG result, shared by both
   * performCSGOperation and performKernelCSGSubtraction below.
   *
   * Confirmed directly as the cause of the reported "fan of extra edge
   * lines converging on one point" artifact, distinct from — and not
   * fixed by — the mergeVertices/computeVertexNormals step both
   * functions already do. A degenerate triangle (two of its three
   * vertices coincide, so it has zero area and is itself invisible)
   * still has a well-formed THIRD edge, from the shared/degenerate
   * vertex to its one distinct vertex. That edge's own "face normal",
   * computed from a triangle with zero area, comes out as (0,0,0) —
   * comparing that to any real neighboring face's normal registers as
   * a full 90-degree angle, well past the Edges component's own
   * threshold, so that sliver edge renders as a real, visible line
   * fanning out from the shared vertex — even though the triangle
   * producing it is otherwise invisible. Traced and confirmed directly:
   * removing these degenerate triangles (never legitimate geometry —
   * true B-rep faces never come out this way) eliminates the fan
   * artifact entirely, without discarding anything a viewer would
   * actually see.
   */
  function removeDegenerateCSGTriangles(geometry: THREE.BufferGeometry): void {
    const index = geometry.index;
    const posAttr = geometry.attributes.position;
    if (!index || !posAttr) return;
    const triCount = index.count / 3;
    const keptIndices: number[] = [];
    const areaThreshold = 1e-10;
    const pa = new THREE.Vector3(), pb = new THREE.Vector3(), pc = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), cross = new THREE.Vector3();
    for (let t = 0; t < triCount; t++) {
      const a = index.getX(t * 3), b = index.getX(t * 3 + 1), c = index.getX(t * 3 + 2);
      if (a === b || b === c || a === c) continue;
      pa.fromBufferAttribute(posAttr, a);
      pb.fromBufferAttribute(posAttr, b);
      pc.fromBufferAttribute(posAttr, c);
      ab.subVectors(pb, pa);
      ac.subVectors(pc, pa);
      cross.crossVectors(ab, ac);
      if (cross.length() * 0.5 < areaThreshold) continue;
      keptIndices.push(a, b, c);
    }
    geometry.setIndex(keptIndices);
  }

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

      // The raw CSG result's own faces come out with each triangle
      // carrying its own separately-computed normal, rather than
      // adjacent coplanar triangles sharing identical vertices/normals
      // the way a single flat face's own triangulation normally does —
      // that shared-normal property is exactly what lets the renderer's
      // Edges component correctly skip drawing a line between two
      // triangles that are actually part of the same flat surface.
      // Without it, every one of a face's own internal triangulation
      // seams renders as a visible edge line — confirmed directly as the
      // cause of the reported "extra edge lines"/"surfaces split into
      // sub-surfaces that don't need to be" fan-triangulation artifact.
      // mergeVertices RETURNS a new geometry rather than mutating in
      // place, per its own documented behavior (same reason it's used
      // as `new Brush(mergeVertices(...))` for the input brushes above)
      // — the result must be assigned back, or this silently discards
      // the merged geometry and changes nothing at all.
      resultBrush.geometry = mergeVertices(resultBrush.geometry);
      // See healTJunctions's own doc comment for the actual root cause
      // of the persistent "extra edge lines" reports — must run before
      // removeDegenerateCSGTriangles below, same reasoning as the
      // kernel-subtract version above.
      healTJunctions(resultBrush.geometry);
      // See removeDegenerateCSGTriangles's own doc comment for the full
      // explanation — a separate artifact from the seam issue above.
      removeDegenerateCSGTriangles(resultBrush.geometry);
      resultBrush.geometry.computeVertexNormals();

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
      recordAction(actionLabel(`Subtract ${cutterId} from ${targetId}`));
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

  const effectiveCameraNear = cameraDepthClippingEnabled ? Math.max(0.01, cameraNear) : 0.1;
  const effectiveCameraFar = cameraDepthClippingEnabled ? Math.max(effectiveCameraNear + 0.1, cameraFar) : 5000;
  effectiveCameraDefaultsRef.current = { near: effectiveCameraNear, far: effectiveCameraFar };

  const fogPostprocessingActive = fogSettings.enabled && (fogSettings.type === 'super-mega' || (fogSettings.type === 'standard' && fogSettings.colorCount > 1));
  const postprocessingActive = ambientOcclusionEnabled || godRaysEnabled || fogPostprocessingActive;

  useEffect(() => {
    if (camera && (camera as any).isPerspectiveCamera) {
      camera.near = effectiveCameraNear;
      camera.far = effectiveCameraFar;
      camera.updateProjectionMatrix();
    }
  }, [camera, effectiveCameraNear, effectiveCameraFar]);

  // ─── Typed values (see tools/typedEntry.ts) ───────────────────────────────────
  // Type a number and press Enter to make the step exact: while dragging, between the clicks of a
  // wall / fence / pond / railing chain, or right after letting go (which redoes the step you just
  // did at that size). Each tool that can be adjusted afterwards leaves a TypedStep behind.
  const latestShapesRef = useRef(shapes);
  latestShapesRef.current = shapes;
  const unitRef = useRef(unit);
  unitRef.current = unit;

  /** A kernel step is still the latest one while the kernel's undo stack hasn't moved. */
  const kernelGuard = () => {
    const id = kernelHost.topUndoId;
    return () => kernelHost.topUndoId === id;
  };
  /** Undo the last kernel step and commit it again with new terms (back to the old one if that fails). */
  const redoKernelStep = (commit: () => boolean): boolean => {
    if (!kernelHost.undo()) return false;
    const ok = commit();
    if (!ok) kernelHost.redo();
    bumpKernel();
    return ok;
  };
  /** A typed size keeps the drag's direction; a minus sign reverses it. */
  const inDragDirection = (value: number, dragged: number) => (dragged < 0 ? -value : value);

  /** Leaves an adjustable kernel step: `remake` turns a typed value into the new commit, or an error. */
  const offerKernelAdjust = (tool: string, what: string, remake: (typed: string) => (() => boolean) | string) => {
    lastTypedStepRef.current = {
      tool,
      stillLatest: kernelGuard(),
      apply: typed => {
        const commit = remake(typed);
        if (typeof commit === 'string') return commit;
        recordAction(actionLabel(`${what} set to ${typed}`));
        if (!redoKernelStep(commit)) return `Could not change the ${what.toLowerCase()} to ${typed}.`;
        offerKernelAdjust(tool, what, remake);
        setMeasurements(`${what}: ${typed}`);
        return null;
      },
    };
  };

  /** Leaves an adjustable object: `change` turns a typed value into the object's new fields, or an error. */
  const offerShapeAdjust = (tool: string, id: string, what: string, change: (shape: Shape, typed: string) => Partial<Shape> | string) => {
    lastTypedStepRef.current = {
      tool,
      stillLatest: () => latestShapesRef.current.some(s => s.id === id),
      apply: typed => {
        const shape = latestShapesRef.current.find(s => s.id === id);
        if (!shape) return 'That object is gone.';
        const patch = change(shape, typed);
        if (typeof patch === 'string') return patch;
        recordAction(actionLabel(`${what} set to ${typed}`));
        setShapes(prev => updateTimberFramesIfPresent(applyStairwellHolesToSlabs(prev.map(s => (s.id === id ? { ...s, ...patch } : s)))));
        commitHistory();
        setMeasurements(`${what}: ${typed}`);
        return null;
      },
    };
  };

  const lengthOrError = (typed: string, allowNegative = false): number | string => {
    const v = parseTypedLength(typed, unitRef.current);
    if (v === null || (!allowNegative && v <= 0) || v === 0) return 'Type a length, e.g. 2.5, 300mm or 8\'6".';
    return v;
  };

  /** A line, as the Line tool draws it, left adjustable to a typed length. */
  const commitKernelLine = (from: THREE.Vector3, to: THREE.Vector3) => {
    recordAction(actionLabel('Line tool'), {
      sdk: `sdk.drawing.line(${JSON.stringify([from.x, from.y, from.z])}, ${JSON.stringify([to.x, to.y, to.z])});`,
    });
    if (!lineBinding.commitDrag(from, to)) return;
    offerKernelAdjust('line', 'Line length', typed => {
      const len = lengthOrError(typed);
      if (typeof len === 'string') return len;
      const end = pointAlong(from, to, len);
      return () => lineBinding.commitDrag(from, end);
    });
  };

  /** A whole shape (Rectangle / Circle / Polygon / Triangle) as one isolated ring, left adjustable. */
  const commitKernelRing = (tool: string, label: string, ring: THREE.Vector3[], remakeRing: (typed: string) => THREE.Vector3[] | string) => {
    recordAction(actionLabel(`${label} tool`), { sdk: `sdk.drawing.shape(${JSON.stringify(ring.map(p => [p.x, p.y, p.z]))});` });
    if (!kernelHost.commitIsolatedShape(ring.map(p => ({ x: p.x, y: p.y, z: p.z })))) return;
    bumpKernel();
    offerKernelAdjust(tool, `${label} size`, typed => {
      const next = remakeRing(typed);
      if (typeof next === 'string') return next;
      return () => kernelHost.commitIsolatedShape(next.map(p => ({ x: p.x, y: p.y, z: p.z }))) !== null;
    });
  };

  /** The ring a shape tool draws from its centre (or corner) and size. */
  const shapeRingRemaker = (tool: string, start: THREE.Vector3, normal: THREE.Vector3, ring: THREE.Vector3[]) => {
    if (tool === 'rectangle') {
      const { tangent, bitangent } = drawingBasis(normal);
      const sx = Math.sign(ring[1]!.clone().sub(ring[0]!).dot(tangent)) || 1;
      const sy = Math.sign(ring[3]!.clone().sub(ring[0]!).dot(bitangent)) || 1;
      return (typed: string) => {
        const size = parseTypedRectangle(typed, unitRef.current);
        if (!size) return 'Type width,depth - e.g. 4,3 or 4000,3000.';
        return rectangleRing(start, normal, sx * Math.abs(size.x), sy * Math.abs(size.y));
      };
    }
    let radius = ring[0]!.distanceTo(start);
    let sides = ring.length;
    return (typed: string) => {
      const n = tool === 'polygon' ? parseTypedSides(typed) : null;
      if (n !== null) sides = n;
      else {
        const r = lengthOrError(typed);
        if (typeof r === 'string') return tool === 'polygon' ? 'Type a radius (e.g. 1.5) or a number of sides (e.g. 8s).' : r;
        radius = Math.abs(r);
      }
      return regularRing(start, normal, radius, sides);
    };
  };

  /** A primitive object (sphere, cone...) left adjustable: its radius, or its height if it has one. */
  const offerPrimitiveAdjust = (id: string, type: string, base: THREE.Vector3, normal: THREE.Vector3) => {
    const hasHeight = type === 'cone' || type === 'pyramid' || type === 'donut';
    offerShapeAdjust(type, id, hasHeight ? (type === 'donut' ? 'Tube' : 'Height') : 'Radius', (shape, typed) => {
      const v = lengthOrError(typed);
      if (typeof v === 'string') return v;
      const args = Array.isArray(shape.args) ? [...shape.args] : [];
      if (!hasHeight) {
        args[0] = v;
        return { args };
      }
      args[1] = v;
      if (type === 'donut') return { args };
      const c = base.clone().addScaledVector(normal, v / 2);
      return { args, position: [c.x, c.y, c.z] };
    });
  };

  /** Wall chain: the next corner, as a click would place it. */
  const placeWallPoint = (pointToPlace: THREE.Vector3) => {
    if (wallVertices.length > 0) pointToPlace.y = wallVertices[0].y;
    if (wallJustification === 'interior' && !isPointInsideRoom(pointToPlace)) {
      setMeasurements('Interior walls cannot extend outside the room boundary.');
      return;
    }
    const prev = wallVertices[wallVertices.length - 1];
    if (prev.distanceTo(pointToPlace) < 0.10) return;
    const newSegment = createWallSegment(prev, pointToPlace);
    if (newSegment) wallChainShapeIdsRef.current.push(newSegment.id);
    setWallVertices(prevVerts => [...prevVerts, pointToPlace]);
    diagLog('TOOL', 'Wall segment placed', { from: [prev.x, prev.y, prev.z], to: [pointToPlace.x, pointToPlace.y, pointToPlace.z] });
  };

  /** Fence / railing / pond chain: the next point, as a click would place it. */
  const placeFencePoint = (pointToPlace: THREE.Vector3) => {
    const prev = fenceVertices[fenceVertices.length - 1];
    if (prev.distanceTo(pointToPlace) < 0.15) return;
    // Railings are placed section by section; fences are one run that grows with each click.
    if (activeTool === 'railing') createFenceRailingSegment(prev, pointToPlace, activeTool);
    const nextVerts = [...fenceVertices, pointToPlace];
    if (activeTool === 'fence') commitFenceRun(nextVerts, false);
    setFenceVertices(nextVerts);
    diagLog('TOOL', `${activeTool} segment placed`, { from: [prev.x, prev.y, prev.z], to: [pointToPlace.x, pointToPlace.y, pointToPlace.z] });
    setMeasurements(`${activeTool === 'fence' ? 'Fence' : activeTool === 'water' ? 'Water outline' : activeTool === 'site_route' ? (routeTool.kind === 'road' ? 'Driving route' : 'Walking route') : 'Railing'} Path: ${nextVerts.length} points placed · Click next point, or type a length and press Enter · Enter to finish`);
  };

  /** Ends a drag-drawing gesture whose result was committed from a typed value. */
  const endDrawing = () => {
    kernelRingRef.current = null;
    kernelLineEndsRef.current = null;
    setDrawingStart(null);
    setDrawingNormal(null);
    setDrawingOnId(null);
    setPreviewShape(null);
    setDrawingStep(0);
    setSnapIndicator(null);
    setLastDrawTarget(null);
    setTrackingGuide(null);
  };

  const RING_TOOLS: Record<string, string> = { rectangle: 'Rectangle', circle: 'Circle', polygon: 'Polygon', triangle: 'Triangle' };

  /** A moved, turned or resized object: type a distance (or <x,y,z> / [x,y,z]), an angle or a factor. */
  function offerTransformAdjust(
    id: string, tool: string,
    start: { position: [number, number, number]; quaternion: [number, number, number, number]; scale: [number, number, number] },
    end: { position: [number, number, number]; quaternion: [number, number, number, number]; scale: [number, number, number] },
  ) {
    if (tool === 'move') {
      const from = new THREE.Vector3(...start.position);
      const dir = new THREE.Vector3(...end.position).sub(from);
      offerShapeAdjust('move', id, 'Move', (_shape, typed) => {
        const vector = parseTypedVector(typed, unitRef.current);
        if (vector) {
          const p = vector.kind === 'relative' ? from.clone().add(vector.v) : vector.v;
          return { position: [p.x, p.y, p.z] };
        }
        const len = lengthOrError(typed, true);
        if (typeof len === 'string') return 'Type a distance, an offset <x, y, z> or a point [x, y, z].';
        if (dir.lengthSq() < 1e-10) return 'Drag it a little first to show the direction, then type the distance.';
        const p = from.clone().addScaledVector(dir.clone().normalize(), len);
        return { position: [p.x, p.y, p.z] };
      });
    } else if (tool === 'rotate') {
      const q0 = new THREE.Quaternion(...start.quaternion);
      const delta = new THREE.Quaternion(...end.quaternion).multiply(q0.clone().invert());
      const angle = 2 * Math.acos(Math.min(1, Math.abs(delta.w)));
      const axis = angle > 1e-6
        ? new THREE.Vector3(delta.x, delta.y, delta.z).normalize().multiplyScalar(delta.w < 0 ? -1 : 1)
        : new THREE.Vector3(0, 1, 0);
      offerShapeAdjust('rotate', id, 'Rotation', (_shape, typed) => {
        const deg = parseTypedAngle(typed);
        if (deg === null) return 'Type an angle in degrees, e.g. 90 or 45deg.';
        const q = new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(deg)).multiply(q0);
        return { quaternion: [q.x, q.y, q.z, q.w], rotation: undefined };
      });
    } else if (tool === 'scale') {
      const ratio = end.scale.map((v, i) => v / (start.scale[i] || 1));
      const changed = ratio.map(r => Math.abs(r - 1) > 1e-3);
      const uniform = !changed.some(Boolean);
      offerShapeAdjust('scale', id, 'Scale', (_shape, typed) => {
        const f = parseTypedFactor(typed);
        if (f === null) return 'Type a scale factor, e.g. 2 or 0.5.';
        return { scale: start.scale.map((v, i) => (uniform || changed[i] ? v * f : v)) as [number, number, number] };
      });
    }
  }

  /** A moved, turned or resized drawn group: the same, redone in the kernel. */
  function offerGroupTransformAdjust() {
    const last = groupTransformBindingRef.current.lastCommitted;
    if (!last) return;
    const binding = groupTransformBindingRef.current;
    const redo = (apply: () => void) => () => { binding.begin(last.faces, last.pivot); apply(); return binding.commit(); };
    if (last.kind === 'translate' && last.params.delta) {
      const d = new THREE.Vector3(last.params.delta.x, last.params.delta.y, last.params.delta.z);
      offerKernelAdjust('move', 'Move', typed => {
        const vector = parseTypedVector(typed, unitRef.current);
        let v: THREE.Vector3;
        if (vector?.kind === 'relative') v = vector.v;
        else if (vector) return 'Drawn geometry moves by an offset: type <x, y, z> or a distance.';
        else {
          const len = lengthOrError(typed, true);
          if (typeof len === 'string') return 'Type a distance or an offset <x, y, z>.';
          if (d.lengthSq() < 1e-10) return 'Drag it a little first to show the direction, then type the distance.';
          v = d.clone().normalize().multiplyScalar(len);
        }
        return redo(() => binding.updateTranslate({ x: v.x, y: v.y, z: v.z }));
      });
    } else if (last.kind === 'rotate' && last.params.axis) {
      const axis = last.params.axis;
      const sense = (last.params.radians ?? 0) < 0 ? -1 : 1;
      offerKernelAdjust('rotate', 'Rotation', typed => {
        const deg = parseTypedAngle(typed);
        if (deg === null) return 'Type an angle in degrees, e.g. 90.';
        return redo(() => binding.updateRotate(axis, sense * THREE.MathUtils.degToRad(deg)));
      });
    } else if (last.kind === 'scale' && last.params.factor) {
      const f0 = last.params.factor;
      const changed = [f0.x, f0.y, f0.z].map(v => Math.abs(v - 1) > 1e-3);
      const uniform = !changed.some(Boolean);
      offerKernelAdjust('scale', 'Scale', typed => {
        const f = parseTypedFactor(typed);
        if (f === null) return 'Type a scale factor, e.g. 2 or 0.5.';
        const pick = (i: number) => (uniform || changed[i] ? f : 1);
        return redo(() => binding.updateScale({ x: pick(0), y: pick(1), z: pick(2) }));
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Tape Measure: measure between two points, or pull a guide off an edge, a guide or an axis
  // (see tools/tapeGuides.ts). Handled on the canvas itself, so every surface - and empty
  // space - behaves the same.
  // ---------------------------------------------------------------------------
  const TAPE_GUIDE_COLOR = '#0e7490';
  /** Meshes denser than this don't offer their edges to the tape (terrain, plants). */
  const TAPE_EDGE_TRIANGLE_LIMIT = 20000;

  /** What's under the pointer for the Tape Measure. */
  const tapeProbe = (ev: PointerEvent, withPick: boolean) => {
    const rect = gl.domElement.getBoundingClientRect();
    const px = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    const size = { width: rect.width, height: rect.height };
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2((px.x / size.width) * 2 - 1, -(px.y / size.height) * 2 + 1), camera);
    const isModel = (o: THREE.Object3D) => {
      for (let p: THREE.Object3D | null = o; p; p = p.parent) {
        const u = p.userData ?? {};
        if (u.type === 'light') return false;
        if (u.isShape || u.isKernelGeometry || typeof u.id === 'string') return true;
      }
      return false;
    };
    let surface: THREE.Intersection | undefined;
    let model: THREE.Intersection | undefined;
    for (const hit of rc.intersectObjects(scene.children, true)) {
      const o = hit.object as THREE.Mesh & { isLine2?: boolean; isLineSegments2?: boolean };
      if (!o.isMesh || o.isLine2 || o.isLineSegments2 || o.name === 'previewMesh'
        || o.userData.isHelper || o.userData.isPreview || o.userData.isGizmo) continue;
      if (!surface) surface = hit;
      if (isModel(o)) { model = hit; break; }
    }
    // Nothing under the pointer: the ground.
    const point = surface?.point.clone() ?? rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());

    let pick: ReturnType<typeof pickGuideSource> = null;
    if (withPick) {
      const sources: GuideSource[] = [...axisSources()];
      for (const [a, b] of guideSegments) sources.push({ a, b, endless: true, label: 'Guide' });
      for (const edge of kernelHost.graph.edges.values()) {
        if (edge.hidden) continue;
        const [a, b] = edgePoints(kernelHost.graph, edge);
        sources.push({ a: new THREE.Vector3(a.x, a.y, a.z), b: new THREE.Vector3(b.x, b.y, b.z), endless: false, label: 'Edge' });
      }
      const mesh = model?.object as THREE.Mesh | undefined;
      if (mesh && !mesh.userData.isKernelGeometry && !(mesh as THREE.InstancedMesh).isInstancedMesh) {
        const g = mesh.geometry as THREE.BufferGeometry;
        const triangles = (g.index ? g.index.count : g.getAttribute('position')?.count ?? 0) / 3;
        if (triangles <= TAPE_EDGE_TRIANGLE_LIMIT) sources.push(...featureEdges(mesh));
      }
      pick = pickGuideSource(sources, px, camera, size);
    }
    return { ray: rc.ray, point, modelPoint: model?.point.clone() ?? null, pick };
  };

  /** The corner of a picked edge nearest the pointer. */
  const tapeCorner = (pick: NonNullable<ReturnType<typeof pickGuideSource>>) =>
    (pick.point.distanceTo(pick.source.a) <= pick.point.distanceTo(pick.source.b) ? pick.source.a : pick.source.b).clone();

  const commitTapeGuide = (draft: NonNullable<typeof tapeGuide>, offset: THREE.Vector3) => {
    const distance = offset.length();
    if (distance < 1e-4) {
      setMeasurements('Move away from the line first (or type a distance), then click.');
      return;
    }
    const guideAt = (o: THREE.Vector3, d: number): Partial<Shape> => {
      const p = draft.linePoint.clone().add(o);
      const args: GuideArgs = makeGuideArgs(p, draft.dir, d);
      return { name: `Guide ${formatValue(d, unit, 2)}`, position: [p.x, p.y, p.z], args };
    };
    const id = Math.random().toString(36).substr(2, 9);
    addShape({ id, type: 'measurement', color: TAPE_GUIDE_COLOR, ...guideAt(offset, distance) } as Shape);
    setTapeGuide(null);
    setMeasurements(`Guide placed ${formatValue(distance, unit, 2)} from the ${draft.label.toLowerCase()}. Type a distance and press Enter to change it.`);
    offerShapeAdjust('tape', id, 'Guide distance', (_shape, typed) => {
      const len = lengthOrError(typed, true);
      if (typeof len === 'string') return len;
      const o = offsetAtDistance(offset, draft.dir, len);
      return o ? guideAt(o, Math.abs(len)) : 'Could not tell which side to put the guide on.';
    });
  };

  const tapeClickRef = useRef<(ev: PointerEvent) => void>(() => {});
  tapeClickRef.current = (ev) => {
    if (tapeGuide) {
      commitTapeGuide(tapeGuide, tapeGuide.offset);
      return;
    }
    const probe = tapeProbe(ev, true);
    const pick = probe.pick;
    if (tapeStart) {
      const point = pick?.onCorner ? tapeCorner(pick) : probe.point;
      if (!point) return;
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
      return;
    }
    // The body of an edge, a guide or an axis: pull a guide off it.
    if (pick && !pick.onCorner) {
      const dir = pick.source.b.clone().sub(pick.source.a).normalize();
      setTapeGuide({ linePoint: pick.point.clone(), dir, offset: new THREE.Vector3(), label: pick.source.label });
      setTapeHover(null);
      setMeasurements(`Move away from the ${pick.source.label.toLowerCase()} and click to place a guide parallel to it, or type a distance and press Enter. Esc cancels.`);
      return;
    }
    // A corner or anywhere else: measure from there.
    const start = pick?.onCorner ? tapeCorner(pick) : probe.point;
    if (!start) return;
    setTapeStart(start);
    setTapeEnd(start);
    setMeasurements('Click second point to measure.');
  };

  const tapeMoveRef = useRef<(ev: PointerEvent) => void>(() => {});
  tapeMoveRef.current = (ev) => {
    if (tapeGuide) {
      const probe = tapeProbe(ev, false);
      const offset = guideOffset(tapeGuide.linePoint, tapeGuide.dir, probe.ray, probe.modelPoint);
      setTapeGuide({ ...tapeGuide, offset });
      setMeasurements(`Guide: ${formatValue(offset.length(), unit, 2)}   (click to place · type a distance · Esc cancels)`);
      return;
    }
    const probe = tapeProbe(ev, true);
    const pick = probe.pick;
    if (tapeStart) {
      const point = pick?.onCorner ? tapeCorner(pick) : probe.point;
      if (!point) return;
      setTapeEnd(point);
      setMeasurements(`Distance: ${formatValue(tapeStart.distanceTo(point), unit, 2)}`);
      return;
    }
    const hover = pick && !pick.onCorner ? pick.source : null;
    const same = (x: GuideSource | null, y: GuideSource | null) =>
      x === y || (!!x && !!y && x.a.equals(y.a) && x.b.equals(y.b));
    if (!same(hover, tapeHover)) setTapeHover(hover);
    setMeasurements(hover
      ? `${hover.label}: click, then move away to place a guide parallel to it`
      : pick?.onCorner ? 'Corner: click to measure from here' : 'Click to start measuring, or click an edge to pull a guide off it');
  };

  useEffect(() => {
    if (activeTool !== 'tape') {
      setTapeGuide(null);
      setTapeHover(null);
      setTapeStart(null);
      setTapeEnd(null);
      return;
    }
    const el = gl.domElement;
    let down: { x: number; y: number } | null = null;
    let frame = 0;
    let lastMove: PointerEvent | null = null;
    const onDown = (ev: PointerEvent) => { if (ev.button === 0) down = { x: ev.clientX, y: ev.clientY }; };
    const onUp = (ev: PointerEvent) => {
      if (ev.button !== 0 || !down) return;
      // A press that moved is a drag of the view, not a click.
      const isClick = Math.hypot(ev.clientX - down.x, ev.clientY - down.y) < 5;
      down = null;
      if (isClick) tapeClickRef.current(ev);
    };
    const onMove = (ev: PointerEvent) => {
      lastMove = ev;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (lastMove) tapeMoveRef.current(lastMove);
      });
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointermove', onMove);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointermove', onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [activeTool, gl]);

  // ---------------------------------------------------------------------------
  // Dimension and Leader Label (see tools/annotations.ts). Dimension: click two points, then
  // move out to where the line should sit and click. Leader: click what to point at, click
  // where the text goes, type it. Both use the Tape Measure's picking, so corners snap.
  // ---------------------------------------------------------------------------
  const [dimDraft, setDimDraft] = useState<{ start: THREE.Vector3; end: THREE.Vector3 | null; cursor: THREE.Vector3; offset: THREE.Vector3 } | null>(null);
  const [leaderDraft, setLeaderDraft] = useState<{ target: THREE.Vector3; anchor: THREE.Vector3 | null; cursor: THREE.Vector3; typing: boolean; text: string } | null>(null);

  const annotationPoint = (ev: PointerEvent) => {
    const probe = tapeProbe(ev, true);
    const point = probe.pick?.onCorner ? tapeCorner(probe.pick) : probe.point;
    return { point, probe };
  };

  const annotationClickRef = useRef<(ev: PointerEvent) => void>(() => {});
  annotationClickRef.current = (ev) => {
    if (leaderDraft?.typing) return;
    const { point } = annotationPoint(ev);
    if (!point) return;
    if (activeTool === 'dimensions') {
      if (!dimDraft) {
        setDimDraft({ start: point, end: null, cursor: point, offset: new THREE.Vector3() });
        setMeasurements('Click the second point.');
      } else if (!dimDraft.end) {
        if (point.distanceTo(dimDraft.start) < 1e-4) { setMeasurements('Pick a second point away from the first.'); return; }
        setDimDraft({ ...dimDraft, end: point, cursor: point });
        setMeasurements('Move out to where the dimension line goes, then click.');
      } else {
        const t = (v: THREE.Vector3): [number, number, number] => [v.x, v.y, v.z];
        const args = makeDimensionArgs(t(dimDraft.start), t(dimDraft.end), t(dimDraft.offset));
        addShape({
          id: Math.random().toString(36).substr(2, 9), name: `Dimension ${formatValue(args.distance, unit, 2)}`, type: 'measurement',
          position: t(dimDraft.start), args, color: '#0284c7',
        } as Shape);
        setMeasurements(`Dimension placed: ${formatValue(args.distance, unit, 2)}`);
        setDimDraft(null);
      }
    } else if (activeTool === 'leader') {
      if (!leaderDraft) {
        setLeaderDraft({ target: point, anchor: null, cursor: point, typing: false, text: '' });
        setMeasurements('Click where the text should go.');
      } else if (!leaderDraft.anchor) {
        setLeaderDraft({ ...leaderDraft, anchor: point, typing: true });
        setMeasurements('Type the label, then press Enter. Esc cancels.');
      }
    }
  };

  const annotationMoveRef = useRef<(ev: PointerEvent) => void>(() => {});
  annotationMoveRef.current = (ev) => {
    if (activeTool === 'dimensions' && dimDraft) {
      const { point, probe } = annotationPoint(ev);
      if (!point) return;
      if (!dimDraft.end) {
        setDimDraft({ ...dimDraft, cursor: point });
        setMeasurements(`Distance: ${formatValue(dimDraft.start.distanceTo(point), unit, 2)}`);
      } else {
        const dir = dimDraft.end.clone().sub(dimDraft.start).normalize();
        const offset = guideOffset(dimDraft.start, dir, probe.ray, probe.modelPoint);
        setDimDraft({ ...dimDraft, offset });
        setMeasurements(`Dimension ${formatValue(dimDraft.start.distanceTo(dimDraft.end), unit, 2)} - click to place`);
      }
    } else if (activeTool === 'leader' && leaderDraft && !leaderDraft.anchor) {
      const { point } = annotationPoint(ev);
      if (point) setLeaderDraft({ ...leaderDraft, cursor: point });
    }
  };

  const commitLeader = () => {
    if (!leaderDraft?.anchor) return;
    const text = leaderDraft.text.trim();
    if (!text) { setLeaderDraft(null); return; }
    const t = (v: THREE.Vector3): [number, number, number] => [v.x, v.y, v.z];
    const args: LeaderArgs = { kind: 'leader', target: t(leaderDraft.target), anchor: t(leaderDraft.anchor), text };
    addShape({
      id: Math.random().toString(36).substr(2, 9), name: `Label: ${text.slice(0, 24)}`, type: 'measurement',
      position: args.anchor, args, color: '#f59e0b',
    } as Shape);
    setLeaderDraft(null);
    setMeasurements('Label placed.');
  };

  useEffect(() => {
    if (activeTool !== 'dimensions' && activeTool !== 'leader') {
      setDimDraft(null);
      setLeaderDraft(null);
      return;
    }
    const el = gl.domElement;
    let down: { x: number; y: number } | null = null;
    let frame = 0;
    let lastMove: PointerEvent | null = null;
    const onDown = (ev: PointerEvent) => { if (ev.button === 0) down = { x: ev.clientX, y: ev.clientY }; };
    const onUp = (ev: PointerEvent) => {
      if (ev.button !== 0 || !down) return;
      const isClick = Math.hypot(ev.clientX - down.x, ev.clientY - down.y) < 5;
      down = null;
      if (isClick) annotationClickRef.current(ev);
    };
    const onMove = (ev: PointerEvent) => {
      lastMove = ev;
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; if (lastMove) annotationMoveRef.current(lastMove); });
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') { setDimDraft(null); setLeaderDraft(null); }
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointermove', onMove);
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointermove', onMove);
      window.removeEventListener('keydown', onKey);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [activeTool, gl]);

  // ---------------------------------------------------------------------------
  // Follow Me: click the shape, then click the path - an edge (the whole run of lines and
  // arcs through it) or a face (its outline, all the way round). Hovering the path shows it
  // and the swept result as a wireframe. See tools/kernelFollowMe.ts.
  // ---------------------------------------------------------------------------
  const [followMeProfile, setFollowMeProfile] = useState<FaceId | null>(null);
  const [followMeHover, setFollowMeHover] = useState<{ path: FollowMePath; pathSegments: [V3, V3][]; preview: [V3, V3][] | null; reason: string | null } | null>(null);

  /** The drawn face and drawn edge under the pointer. */
  const followMeProbe = (ev: PointerEvent, exclude: ReadonlySet<EdgeId>) => {
    const rect = gl.domElement.getBoundingClientRect();
    const px = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    const size = { width: rect.width, height: rect.height };
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2((px.x / size.width) * 2 - 1, -(px.y / size.height) * 2 + 1), camera);
    let face: FaceId | null = null;
    for (const hit of rc.intersectObjects(scene.children, true)) {
      const o = hit.object as THREE.Mesh & { isLine2?: boolean; isLineSegments2?: boolean };
      if (!o.isMesh || o.isLine2 || o.isLineSegments2 || !o.visible) continue;
      const mat = o.material as THREE.Material;
      if (!Array.isArray(o.material) && mat.transparent && mat.opacity === 0) continue; // invisible catch planes
      if (o.userData.isKernelGeometry && hit.faceIndex != null) face = (o.userData.faceOfTriangle as FaceId[])[hit.faceIndex] ?? null;
      break;
    }
    const ids: EdgeId[] = [];
    const sources: GuideSource[] = [];
    for (const [id, edge] of kernelHost.graph.edges) {
      if (edge.hidden || exclude.has(id)) continue;
      const [a, b] = edgePoints(kernelHost.graph, edge);
      ids.push(id);
      sources.push({ a: new THREE.Vector3(a.x, a.y, a.z), b: new THREE.Vector3(b.x, b.y, b.z), endless: true, label: 'Edge' });
    }
    const pick = pickGuideSource(sources, px, camera, size);
    return { face, edge: pick ? ids[sources.indexOf(pick.source)] ?? null : null };
  };

  const endFollowMe = () => {
    setFollowMeProfile(null);
    setFollowMeHover(null);
  };

  const followMeClickRef = useRef<(ev: PointerEvent) => void>(() => {});
  followMeClickRef.current = (ev) => {
    if (followMeProfile === null || !kernelHost.graph.faces.has(followMeProfile)) {
      const { face } = followMeProbe(ev, new Set());
      if (face === null) {
        setMeasurements('Follow Me: click a flat shape you drew (the profile to sweep).');
        return;
      }
      setFollowMeProfile(face);
      setSelectedFaceIds([face]);
      setMeasurements('Follow Me: now click the path - an edge, or a face to go round its edge. Esc to start again.');
      return;
    }
    const hover = followMeHover;
    if (!hover) {
      setMeasurements('Follow Me: click an edge or a face to sweep along.');
      return;
    }
    if (hover.reason) {
      setMeasurements(`Follow Me: ${hover.reason}`);
      return;
    }
    const r = commitKernelFollowMe(kernelHost, followMeProfile, hover.path);
    if (!r.ok) {
      setMeasurements(`Follow Me: ${r.reason}`);
      return;
    }
    recordAction(actionLabel('Follow Me'));
    bumpKernel();
    setSelectedFaceIds([]);
    endFollowMe();
    setMeasurements('Follow Me: done. Click another shape to sweep again.');
  };

  const followMeMoveRef = useRef<(ev: PointerEvent) => void>(() => {});
  followMeMoveRef.current = (ev) => {
    if (followMeProfile === null || !kernelHost.graph.faces.has(followMeProfile)) return;
    const outline = outlineEdges(kernelHost.graph, followMeProfile);
    const { face, edge } = followMeProbe(ev, outline);
    const path = edge !== null
      ? pathFromEdge(kernelHost.graph, edge, outline)
      : face !== null && face !== followMeProfile ? pathFromFace(kernelHost.graph, face) : null;
    if (!path) {
      if (followMeHover) setFollowMeHover(null);
      return;
    }
    if (followMeHover && followMeHover.path.edges.length === path.edges.length && followMeHover.path.edges.every((e, i) => e === path.edges[i])) return;
    const v = (p: { x: number; y: number; z: number }): V3 => [p.x, p.y, p.z];
    const pathSegments: [V3, V3][] = [];
    for (let i = 0; i + 1 < path.points.length; i++) pathSegments.push([v(path.points[i]!), v(path.points[i + 1]!)]);
    if (path.closed && path.points.length > 2) pathSegments.push([v(path.points[path.points.length - 1]!), v(path.points[0]!)]);
    const preview = previewFollowMe(kernelHost, followMeProfile, path);
    const ok = 'segments' in preview;
    setFollowMeHover({
      path,
      pathSegments,
      preview: ok ? preview.segments.map(([a, b]) => [v(a), v(b)] as [V3, V3]) : null,
      reason: ok ? null : preview.reason,
    });
    setMeasurements(ok ? 'Follow Me: click to sweep along this path.' : `Follow Me: ${preview.reason}`);
  };

  useEffect(() => {
    if (activeTool !== 'followme') {
      endFollowMe();
      return;
    }
    setMeasurements('Follow Me: click a flat shape you drew (the profile to sweep), then the path.');
    const el = gl.domElement;
    let down: { x: number; y: number } | null = null;
    let frame = 0;
    let lastMove: PointerEvent | null = null;
    const onDown = (ev: PointerEvent) => { if (ev.button === 0) down = { x: ev.clientX, y: ev.clientY }; };
    const onUp = (ev: PointerEvent) => {
      if (ev.button !== 0 || !down) return;
      const isClick = Math.hypot(ev.clientX - down.x, ev.clientY - down.y) < 5;
      down = null;
      if (isClick) followMeClickRef.current(ev);
    };
    const onMove = (ev: PointerEvent) => {
      lastMove = ev;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (lastMove) followMeMoveRef.current(lastMove);
      });
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointermove', onMove);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointermove', onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [activeTool, gl]);

  // ---------------------------------------------------------------------------
  // Section Plane tool: hover a face to line a plane up with it, click to place it (it becomes
  // the active cut). Drag an existing plane's square to slide it along its direction.
  // See tools/sectionPlanes.ts and SectionCutter.tsx.
  // ---------------------------------------------------------------------------
  const { active: presentationActive } = usePresentation();
  const activeSectionArgs = useMemo(() => activeSection(shapes)?.args ?? null, [shapes]);
  const [sectionHover, setSectionHover] = useState<SectionArgs | null>(null);
  const sectionDragRef = useRef<{ id: string; start: SectionArgs; from: THREE.Vector3; distance: number } | null>(null);

  /** What the Section tool is pointing at: a placed plane's square, or a face of the model. */
  const sectionProbe = (ev: PointerEvent) => {
    const rect = gl.domElement.getBoundingClientRect();
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1), camera);
    for (const hit of rc.intersectObjects(scene.children, true)) {
      const o = hit.object as THREE.Mesh & { isLine2?: boolean; isLineSegments2?: boolean };
      if (!o.isMesh || o.isLine2 || o.isLineSegments2) continue;
      if (o.userData.isSectionPlaneQuad && o.userData.sectionId) return { ray: rc.ray, plane: o.userData.sectionId as string, point: hit.point, face: null };
      if (!isModelObject(o) || !hit.face) continue;
      const normal = hit.face.normal.clone().transformDirection(o.matrixWorld);
      return { ray: rc.ray, plane: null, point: hit.point, face: normal };
    }
    return { ray: rc.ray, plane: null, point: null, face: null };
  };

  /** A plane square big enough to cover the model. */
  const sectionSize = () => {
    const box = new THREE.Box3();
    for (const item of collectModelItems(scene)) {
      item.geometry.computeBoundingBox();
      for (const m of item.matrices) box.union(item.geometry.boundingBox!.clone().applyMatrix4(m));
    }
    return box.isEmpty() ? 6 : Math.min(200, Math.max(2, box.getSize(new THREE.Vector3()).length() * 1.1));
  };

  const sectionDownRef = useRef<(ev: PointerEvent) => boolean>(() => false);
  sectionDownRef.current = (ev) => {
    const probe = sectionProbe(ev);
    if (!probe.plane || !probe.point) return false;
    const shape = shapes.find(sh => sh.id === probe.plane);
    if (!shape) return false;
    const start = shape.args as SectionArgs;
    sectionDragRef.current = { id: shape.id, start, from: probe.point.clone(), distance: 0 };
    const controls = scene.userData.controls;
    if (controls) controls.enabled = false;
    setSectionHover(null);
    setMeasurements('Section: drag to slide the plane; let go to place it.');
    return true;
  };

  const sectionMoveRef = useRef<(ev: PointerEvent) => void>(() => {});
  sectionMoveRef.current = (ev) => {
    const drag = sectionDragRef.current;
    if (drag) {
      const rect = gl.domElement.getBoundingClientRect();
      const rc = new THREE.Raycaster();
      rc.setFromCamera(new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1), camera);
      drag.distance = dragDistance(drag.from, new THREE.Vector3(...drag.start.normal), rc.ray);
      const moved = moveSection(drag.start, drag.distance);
      // Live, without an undo step per frame: the one step is added when the drag ends.
      setShapesSilent(prev => prev.map(sh => (sh.id === drag.id ? { ...sh, args: moved, position: moved.point } : sh)));
      setMeasurements(`Section moved ${formatValue(drag.distance, unit, 2)}`);
      return;
    }
    const probe = sectionProbe(ev);
    if (probe.face && probe.point) {
      setSectionHover(sectionOnFace(probe.point, probe.face, camera.position, sectionSize()));
      setMeasurements('Section: click to cut here. Drag a placed plane to move it.');
    } else {
      setSectionHover(null);
      setMeasurements(probe.plane ? 'Section: drag to slide this plane along its direction.' : 'Section: point at a wall, floor or other face.');
    }
  };

  const sectionUpRef = useRef<(ev: PointerEvent, isClick: boolean) => void>(() => {});
  sectionUpRef.current = (ev, isClick) => {
    const drag = sectionDragRef.current;
    if (drag) {
      sectionDragRef.current = null;
      const controls = scene.userData.controls;
      if (controls) controls.enabled = true;
      const moved = moveSection(drag.start, drag.distance);
      setShapes(prev => prev.map(sh => (sh.id === drag.id ? { ...sh, args: moved, position: moved.point } : sh)));
      recordAction(actionLabel('Move section plane'));
      return;
    }
    if (!isClick) return;
    const probe = sectionProbe(ev);
    if (!probe.face || !probe.point) return;
    const args = sectionOnFace(probe.point, probe.face, camera.position, sectionSize());
    const id = Math.random().toString(36).substr(2, 9);
    const count = shapes.filter(isSectionShape).length;
    setShapes(prev => [
      // One section cuts at a time: the new one takes over.
      ...prev.map(sh => (isSectionShape(sh) && (sh.args as SectionArgs).active ? { ...sh, args: { ...(sh.args as SectionArgs), active: false } } : sh)),
      { id, name: `Section ${count + 1}`, type: 'measurement', position: args.point, args, color: '#f97316' } as Shape,
    ]);
    recordAction(actionLabel('Add section plane'));
    setSectionHover(null);
    setMeasurements('Section placed. Drag its square to move it; select it to flip it or turn it off.');
  };

  useEffect(() => {
    if (activeTool !== 'section') {
      setSectionHover(null);
      return;
    }
    const el = gl.domElement;
    let down: { x: number; y: number } | null = null;
    let frame = 0;
    let lastMove: PointerEvent | null = null;
    const onDown = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      down = { x: ev.clientX, y: ev.clientY };
      sectionDownRef.current(ev);
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.button !== 0 || !down) return;
      const isClick = Math.hypot(ev.clientX - down.x, ev.clientY - down.y) < 5;
      down = null;
      sectionUpRef.current(ev, isClick);
    };
    const onMove = (ev: PointerEvent) => {
      lastMove = ev;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (lastMove) sectionMoveRef.current(lastMove);
      });
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointermove', onMove);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointermove', onMove);
      if (frame) cancelAnimationFrame(frame);
      if (sectionDragRef.current) {
        sectionDragRef.current = null;
        const controls = scene.userData.controls;
        if (controls) controls.enabled = true;
      }
    };
  }, [activeTool, gl]);

  typedWantedRef.current = () => {
    if (lastTypedStepRef.current?.tool === activeTool) return true;
    if (activeTool === 'tape' && tapeGuide) return true;
    if (activeTool === 'arc' && arcState && arcState.phase !== 'ready' && arcState.phase !== 'inactive') return true;
    if (drawingStart && (activeTool === 'line' || activeTool in RING_TOOLS
      || ['sphere', 'cone', 'pyramid', 'donut', 'dome'].includes(activeTool))) return true;
    if (activeTool === 'wall' && wallVertices.length > 0) return true;
    if ((activeTool === 'fence' || activeTool === 'railing' || activeTool === 'water' || activeTool === 'site_route') && fenceVertices.length > 0) return true;
    if (activeTool === 'bezier' && bezierKnots.length > 0) return true;
    return false;
  };

  /** Enter with a typed value: returns true when it was used (or refused with a message). */
  typedEnterRef.current = (typed: string) => {
    const u = unitRef.current;
    const fail = (message: string) => { setMeasurements(message); return true; };

    // While a drag is still held down.
    if (drawingStart && drawingNormal) {
      if (activeTool === 'line') {
        const len = lengthOrError(typed);
        if (typeof len === 'string') return fail(len);
        const from = drawingStart.clone();
        const to = pointAlong(from, lastDrawTarget ?? from.clone().add(drawingBasis(drawingNormal).tangent), len);
        endDrawing();
        commitKernelLine(from, to);
        setMeasurements(`Length: ${formatTyped(len, u)}`);
        return true;
      }
      if (activeTool in RING_TOOLS) {
        const start = drawingStart.clone();
        const normal = drawingNormal.clone();
        if (activeTool === 'polygon') {
          const sides = parseTypedSides(typed);
          if (sides !== null) { setPolygonSides(sides); setMeasurements(`Polygon sides set to ${sides}`); return true; }
        }
        const current = kernelRingRef.current ?? (activeTool === 'rectangle'
          ? rectangleRing(start, normal, 1, 1)
          : regularRing(start, normal, 1, activeTool === 'circle' ? 32 : activeTool === 'triangle' ? 3 : Math.min(64, Math.max(3, polygonSides || 6))));
        const ring = shapeRingRemaker(activeTool, start, normal, current)(typed);
        if (typeof ring === 'string') return fail(ring);
        endDrawing();
        commitKernelRing(activeTool, RING_TOOLS[activeTool]!, ring, shapeRingRemaker(activeTool, start, normal, ring));
        return true;
      }
      return false; // the primitives' own typed sizes (below in the keydown handler)
    }

    // The arc: a bulge (0.5, 300mm), a radius (2r), or a segment count (12s) for the arc being drawn.
    if (activeTool === 'arc' && arcToolRef.current) {
      const tool = arcToolRef.current;
      const before = tool.current;
      if (before.phase === 'first' && !/s$/i.test(typed)) return fail('Set the other end of the chord first, then type a bulge or a radius (2r). 12s sets the number of segments.');
      for (const ch of typed) tool.type(ch);
      const after = tool.enter();
      setArcState(after);
      if (after.lastError) return fail(`Arc: ${after.lastError}`);
      if (after.phase === 'ready') {
        arcPlaneRef.current = null;
        arcFilletRef.current = [];
        clearSnapLocks();
        bumpKernel();
        recordAction(actionLabel('Arc'));
        setMeasurements(`Arc drawn (${typed}).`);
      } else {
        setMeasurements(`Arc segments: ${after.segments}`);
      }
      return true;
    }

    // A guide being pulled: place it that far from its line, on the side the pointer is.
    if (activeTool === 'tape' && tapeGuide) {
      const len = lengthOrError(typed, true);
      if (typeof len === 'string') return fail(len);
      const offset = offsetAtDistance(tapeGuide.offset, tapeGuide.dir, len);
      if (!offset) return fail('Move the pointer to the side the guide should go, then type the distance.');
      commitTapeGuide(tapeGuide, offset);
      return true;
    }

    // Between the clicks of a chain: the next point, that far towards the cursor.
    if (activeTool === 'wall' && wallVertices.length > 0) {
      const len = lengthOrError(typed);
      if (typeof len === 'string') return fail(len);
      const last = wallVertices[wallVertices.length - 1];
      const towards = wallCandidatePos ?? last.clone().add(new THREE.Vector3(1, 0, 0));
      const flat = new THREE.Vector3(towards.x, last.y, towards.z);
      placeWallPoint(pointAlong(last, flat, len));
      return true;
    }
    if ((activeTool === 'fence' || activeTool === 'railing' || activeTool === 'water' || activeTool === 'site_route') && fenceVertices.length > 0) {
      const len = lengthOrError(typed);
      if (typeof len === 'string') return fail(len);
      const last = fenceVertices[fenceVertices.length - 1];
      const towards = fenceCandidatePos ?? last.clone().add(new THREE.Vector3(1, 0, 0));
      const next = pointAlong(last, new THREE.Vector3(towards.x, last.y, towards.z), len);
      // Along the ground: the point sits on the ground there, as a click would.
      if (activeTool !== 'railing') next.y = towards.y;
      placeFencePoint(next);
      return true;
    }

    // Right after a step: redo it at the typed size.
    const step = lastTypedStepRef.current;
    if (step && step.tool === activeTool) {
      if (!step.stillLatest()) {
        lastTypedStepRef.current = null;
        return fail('Something else has changed since, so there is nothing to adjust. Draw again, then type.');
      }
      const error = step.apply(typed);
      if (error) setMeasurements(error);
      return true;
    }
    return false;
  };

  return (
    <>

      <PerspectiveCamera 
        makeDefault 
        position={defaultCameraPosition} 
        near={effectiveCameraNear} 
        far={effectiveCameraFar} 
      />
      <OrbitControls 
        makeDefault 
        zoomToCursor
        autoRotate={autoOrbitEnabled && activeTool !== 'walk' && activeTool !== 'look'}
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
        enabled={!drawingStart && !pushPullState && !isSculptingDragRef.current && activeTool !== 'landscape_sculpt' && activeTool !== 'landscape_mask' && activeTool !== 'walk' && activeTool !== 'look' && !portalTransitionActive}
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
      />
      <ShareMainScene />
      <PresentationDriver />
      {/* The active section plane cuts the model (presentation mode does its own cuts). */}
      <SectionCutter section={presentationActive ? null : activeSectionArgs} />
      <SunShadowRig lightRef={directionalLightRef} sunPosition={lightPosition} enabled={shadowsEnabled} walking={walkModePhase === 'walking'} />
      
      {godRaysEnabled && (
        <mesh ref={sunMeshRef} position={lightPosition}>
          <sphereGeometry args={[0.4, 16, 16]} />
          <meshBasicMaterial color="#fff6d8" toneMapped={false} />
        </mesh>
      )}

      {showLightsource && (
        <group position={lightPosition}>
          <mesh>
            <sphereGeometry args={[0.2, 16, 16]} />
            <meshBasicMaterial color="yellow" />
          </mesh>
          <line>
            {/*
              Points toward sunOrbitCenter, not the hardcoded origin this
              used to subtract against — the sun's own orbit was already
              fixed to revolve around sunOrbitCenter (see the useFrame
              block above), but this line's own direction was never
              updated to match, so picking a new centre correctly moved
              the sun but left this visual indicator still aimed at
              [0,0,0] regardless — confirmed as the actual cause of "the
              light source line doesn't get updated."
            */}
            <bufferGeometry attach="geometry" setFromPoints={[new THREE.Vector3(0,0,0), new THREE.Vector3(sunOrbitCenter[0], sunOrbitCenter[1], sunOrbitCenter[2]).sub(new THREE.Vector3(...lightPosition)).normalize().multiplyScalar(2)]} />
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

      {miniAxisIndicatorEnabled && (
        <GizmoHelper
          alignment="bottom-left"
          margin={[60, 60]}
        >
          <group onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
            <GizmoViewport
              axisColors={['#ef4444', '#22c55e', '#3b82f6']}
              labelColor="#ffffff"
              disabled={walkModePhase !== 'inactive'}
            />
          </group>
        </GizmoHelper>
      )}

      {floorEnabled && (
        <mesh 
          rotation={[-Math.PI / 2, 0, 0]} 
          position={[0, -0.02, 0]} 
          receiveShadow
          onPointerDown={(e) => {
            if (pickingSunCenter) {
              // Covers a click landing on EMPTY GROUND — a separate
              // click path from either handleMeshPointerDown or
              // handleKernelFacePointerDown (this is a plain ground-
              // plane mesh, not a Shape or kernel face). Without this,
              // picking a sun centre only worked when the click
              // happened to land on existing geometry.
              e.stopPropagation();
              pickSunCenter(e.point);
              return;
            }
            if (placingLightId || activeTool === 'scale_figure' || activeTool === 'teleport') handlePointerDown(e);
            else if (activeTool === 'select' || true) {
              if ((window as any).__polyformLassoIgnoreClickUntil && Date.now() < (window as any).__polyformLassoIgnoreClickUntil) {
                return;
              }
              // Flat shapes lie exactly on the ground, so one press hits both: the shape's own
              // handler decides the selection (Shift-click, Combine Shapes add to it).
              if (pressHitsGeometry(e)) return;
              setSelectedId(null);
              setSelectedIds([]);
              setSelectedFaceIds([]);
              setSelectedLightId(null);
              setSelectedSurface(null);
              setSelectedModifierId(null);
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
          if (pickingSunCenter) {
            // Same reasoning as the identical check on the floor mesh
            // just above — this is the ALWAYS-present fallback ground
            // plane (2000x2000, invisible), which is what a click hits
            // when floorEnabled is off.
            e.stopPropagation();
            pickSunCenter(e.point);
            return;
          }
          if (activeTool === 'scale_figure' || activeTool === 'teleport') {
            handlePointerDown(e);
            return;
          }
          if (activeTool === 'select' || true) {
            if ((window as any).__polyformLassoIgnoreClickUntil && Date.now() < (window as any).__polyformLassoIgnoreClickUntil) {
              return;
            }
            if (pressHitsGeometry(e)) return;
            setSelectedId(null);
            setSelectedIds([]);
            setSelectedFaceIds([]);
            setSelectedLightId(null);
            setSelectedSurface(null);
            setSelectedModifierId(null);
          }
        }}
      >
        <planeGeometry args={[2000, 2000]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>

      {(placingLightId || placingAnimationId || ['text', 'text3d', 'terrain', 'poly', 'bezier', 'rectangle', 'circle', 'polygon', 'arc', 'line', 'triangle', 'sphere', 'cone', 'pyramid', 'donut', 'dome', 'wall', 'door', 'window', 'step', 'staircase', 'scale_figure', 'landscape_sculpt', 'landscape_mask', 'landscape_road', 'landscape_zone', 'landscape_plot', 'landscape_form', 'landscape_embed', 'landscape_texture', 'tree', 'bush', 'fence', 'railing', 'water', 'site_route', 'lamp', 'bench', 'rock', 'road', 'pad-rect', 'pad-circle', 'striping', 'block_picker', 'teleport'].includes(activeTool)) && (
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
            } else if (activeTool === 'bezier' && bezierKnots.length >= 3) {
              closeBezierLoop();
            } else if (activeTool === 'bezier' && bezierKnots.length >= 2) {
              finishBezierOpenPath();
            } else if ((activeTool === 'landscape_road' || activeTool === 'landscape_zone') && roadPoints.length >= 2) {
              finalizeRoadCreation(roadPoints);
            } else if (activeTool === 'road' && activeSplineDraft.length >= 2) {
              finalizeCivilRoadDraft();
            }
          }}
        >
          <planeGeometry args={[1000, 1000]} />
          <meshBasicMaterial transparent opacity={0} />
        </mesh>
      )}

      {(drawingStart || pushPullState || isSculptingDragRef.current || (activeTool === 'wall' && wallVertices.length > 0) || (activeTool === 'poly' && polyVertices.length > 0) || (activeTool === 'bezier' && bezierKnots.length > 0) || ((activeTool === 'landscape_road' || activeTool === 'landscape_zone') && roadPoints.length > 0) || (activeTool === 'road' && activeSplineDraft.length > 0)) && (
        <mesh 
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (activeTool === 'wall' && wallVertices.length > 0) {
              finalizeWallChain();
            } else if (activeTool === 'poly' && polyVertices.length >= 3) {
              finalizePoly();
            } else if (activeTool === 'bezier' && bezierKnots.length >= 3) {
              closeBezierLoop();
            } else if (activeTool === 'bezier' && bezierKnots.length >= 2) {
              finishBezierOpenPath();
            } else if ((activeTool === 'landscape_road' || activeTool === 'landscape_zone') && roadPoints.length >= 2) {
              finalizeRoadCreation(roadPoints);
            } else if (activeTool === 'road' && activeSplineDraft.length >= 2) {
              finalizeCivilRoadDraft();
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
      {/* The shape can be gone for a render when an edit replaces it (e.g. merging wall pieces). */}
      {selectedSurface && shapes.some(s => s.id === selectedSurface.shapeId) && !(shapes.find(s => s.id === selectedSurface.shapeId)?.surfaceDivisions?.[selectedSurface.faceIndex]) && (
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
            <div className="w-[290px] shadow-xl rounded-xl select-none" onPointerDown={e => e.stopPropagation()}>
              <NoteCard note={note} number={notes.findIndex(n => n.id === note.id) + 1} date={safelyToDate(note.createdAt).toLocaleDateString()}
                onComplete={() => setNotes(prev => prev.map(n => n.id === note.id ? { ...n, completed: !n.completed, completedAt: !n.completed ? Date.now() : undefined, completedBy: !n.completed ? user?.displayName : undefined } : n))}
              />
            </div>
          </Html>
        </group>
      ))}

      <Effects />
      <SceneWeather />
      <InstancedVegetation plants={batchedPlants} onSelect={handleMeshClick} onContextMenu={handleContextMenu} />

      {axisIndicatorEnabled && (
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
      )}

      {/* WorldView Map Overlay */}
      {isWorldViewActive && (
        <RenderMapTexture lat={worldViewLocation.lat} lng={worldViewLocation.lng} />
      )}

      {/* Buildings deleted from an imported site, drawn as ghosts when "show existing" is on. */}
      {siteGhosts.length > 0 && <SiteGhosts removed={siteGhosts} />}

      {/* Moving cars and people on an imported site (presentations, or the editor if turned on). */}
      <SiteStreetLifeLayer shapes={shapes} />

      {/* Google's Photorealistic 3D Tiles around the site: a viewing layer (WorldView > 3D Site). */}
      {googleLayer && googleMapsApiKey && (
        <GoogleTilesLayer site={googleLayer.site} apiKey={googleMapsApiKey} buildings={googleBuildings} groundAt={googleGroundAt} />
      )}

      {/*
        Toast render moved to the outer Viewport() function — see
        showToast's own doc comment above for why this can't render here.
      */}

      {/*
        New Note dialog moved to the outer Viewport() function — the SAME
        fix as viewportToast, for the SAME reason: this used to be a
        createPortal call right here, inside Scene(), which react-three-
        fiber renders with its own custom reconciler, not react-dom's. A
        plain <div> created that way is rejected outright as "not part of
        the THREE namespace" -- a real, reproduced crash, not a
        hypothetical one. placingNotePos is still SET here (a few lines
        up, from the actual 3D click), but the dialog itself now renders
        from Viewport(), which react-dom actually renders.
      */}

      {/*
        Kernel-derived geometry, rendered ALONGSIDE the Shape[] primitives
        below. The kernel owns drawn geometry (lines, arcs, rectangles,
        polygons); Shape[] keeps primitives, plants and terrain.

        `revision` is the invalidation signal and is not optional: the kernel
        Graph is mutated in place, so React's identity check on it never fires.
      */}
      <KernelGeometry
        graph={kernelHost.graph}
        revision={kernelRevision}
        selectedFaces={kernelSelectedSet}
        onFaceClick={handleKernelFaceClick}
        onFacePointerDown={handleKernelFacePointerDown}
        onFaceContextMenu={handleKernelFaceContextMenu}
        showEdges={edgeLinesEnabled}
        edgeColor={edgeLinesColor}
        edgeOpacity={edgeLinesOpacity}
        edgeLineWidth={edgeLinesThickness}
        bindingFor={kernelBindingFor}
      />

      {/* Editing inside a group: the rest of the drawing, set aside, shown faded. */}
      {groupEdit && (
        <KernelGroupMesh shape={{ kernelGraph: groupEdit.mainGraph } as Shape} groupProps={{}} opacity={0.25} />
      )}

      <LassoOverlay getSceneObjectById={getSceneObjectById} />

      {faceOffsetPreview && (
        <FaceOffsetPreview
          graph={kernelHost.graph}
          faceId={faceOffsetPreview.faceId}
          distance={faceOffsetPreview.distance}
        />
      )}

      {chamferPreview && (
        <ChamferPreview
          graph={kernelHost.graph}
          faces={chamferPreview.faces}
          amount={chamferPreview.amount}
          boundaries={chamferPreview.boundaries}
        />
      )}

      {pushPullPreview && (
        <PushPullPreview
          rings={pushPullPreview.rings}
          normal={pushPullPreview.normal}
          distance={pushPullPreview.distance}
        />
      )}

      {/* Instanced Timber Framing for performant GPU rendering */}
      <InstancedTimberFraming
        shapes={shapes}
        tags={tags}
        selectedId={selectedId}
        selectedIds={selectedIds}
        onSelectShape={(id) => {
          setSelectedId(id);
          setSelectedIds([id]);
          setSelectedSurface(null);
          setSelectedFaceIds([]);
        }}
        shadowsEnabled={shadowsEnabled}
        edgeLinesEnabled={edgeLinesEnabled}
        edgeLinesColor={edgeLinesColor}
        edgeLinesOpacity={edgeLinesOpacity}
        edgeLinesThickness={edgeLinesThickness}
      />

      {shapes.map((shape) => {
      if (shape.hidden) return null;
        // Google's own ground stands in for the editable one once it is actually showing (its data still drives heights).
        if (googleLayer?.site.googleGround === 'google' && googleStatus.state === 'showing' && shape.id === googleLayer.groundId) return null;
        if (batchedPlantIds.has(shape.id)) return null;
        if (shape.tags?.includes('timber-frame') || shape.id.startsWith('tf-')) {
          // Rendered via InstancedTimberFraming for batch instancing performance
          return null;
        }
        const isVisible = !shape.tags || shape.tags.length === 0 || shape.tags.some(tagId => {
          const tag = tags.find(t => t.id === tagId);
          return tag ? tag.visible : true;
        });

        if (!isVisible) return null;

        if (isSectionShape(shape)) {
          const sectionId = shape.id;
          return (
            <SectionPlaneMesh key={shape.id} id={shape.id} args={shape.args as SectionArgs} selected={selectedId === shape.id}
              pickable={activeTool === 'section' || activeTool === 'select'}
              onSelect={activeTool === 'select' ? () => { setSelectedId(sectionId); setSelectedIds([sectionId]); } : undefined} />
          );
        }
        // Guides hide together (Scene Helpers > Guides).
        if (isGuideShape(shape) && !guidesVisible) return null;
        if (shape.type === 'measurement' && (shape.args as any)?.kind === 'guide') {
          const g = shape.args as GuideArgs;
          const isSel = selectedId === shape.id;
          return (
            <Line key={shape.id} points={[g.start, g.end]} dashed dashSize={0.3} gapSize={0.2}
              color={isSel ? '#FFFFFF' : (shape.color || '#0e7490')} lineWidth={isSel ? 2.5 : 1.5}
              onClick={(e: any) => { if (activeTool !== 'select') return; e.stopPropagation(); setSelectedId(shape.id); setSelectedIds([shape.id]); }} />
          );
        }
        if (isDimensionShape(shape)) {
          return (
            <DimensionMark key={shape.id} args={shape.args as DimensionArgs} unit={unit} selected={selectedId === shape.id} color={shape.color}
              onSelect={activeTool === 'select' ? () => { setSelectedId(shape.id); setSelectedIds([shape.id]); } : undefined} />
          );
        }
        if (isLeaderShape(shape)) {
          return (
            <LeaderMark key={shape.id} args={shape.args as LeaderArgs} selected={selectedId === shape.id} color={shape.color}
              onSelect={activeTool === 'select' ? () => { setSelectedId(shape.id); setSelectedIds([shape.id]); } : undefined} />
          );
        }
        if (isAreaLabelShape(shape)) {
          return (
            <AreaMark key={shape.id} args={shape.args as AreaLabelArgs} graph={kernelHost.graph} unit={unit} selected={selectedId === shape.id}
              onSelect={activeTool === 'select' ? () => { setSelectedId(shape.id); setSelectedIds([shape.id]); } : undefined} />
          );
        }
        if (shape.type === 'measurement' && (shape.args as any)?.kind === 'protractor') {
          return (
            <ProtractorMeasurement key={shape.id} args={shape.args as ProtractorArgs} selected={selectedId === shape.id}
              onSelect={() => { setSelectedId(shape.id); setSelectedIds([shape.id]); }} />
          );
        }
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
                  className={`text-white text-xs font-medium px-2 py-1 rounded whitespace-nowrap shadow-lg border cursor-pointer transition-colors ${isSel ? 'bg-polyform-blue border-white' : 'bg-black/80 border-yellow-500/50 hover:border-yellow-400'}`}
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
                    className={`text-white text-xs font-medium px-2 py-1 rounded whitespace-nowrap shadow-lg border cursor-pointer transition-colors ${isSel ? 'bg-polyform-blue border-white' : 'bg-black/80 border-green-500/50 hover:border-green-400'}`}
                  >
                    {formatValue(totalLen, unit, 2)}
                  </div>
                </Html>
              )}
            </group>
          );
        }

        if (shape.type === 'bezier') {
          const bargs: any = shape.args || {};
          const bknots: BezierKnot[] = (bargs.bezierKnots || []).map((k: any) => ({
            point: new THREE.Vector3(...k.point),
            handleIn: k.handleIn ? new THREE.Vector3(...k.handleIn) : null,
            handleOut: k.handleOut ? new THREE.Vector3(...k.handleOut) : null,
            mode: k.mode || 'mirrored'
          }));

          let displayPts: [number, number, number][] = bargs.points || [];
          if ((!displayPts || displayPts.length < 2) && bknots.length >= 2) {
            const tess = tessellateEntireCurve(bknots, bargs.isClosed || false, bargs.resolution || 24);
            displayPts = tess.map(p => [p.x, p.y, p.z]);
          }
          if (!displayPts || displayPts.length < 2) return null;

          const isSel = selectedId === shape.id || selectedIds.includes(shape.id);
          const curveColor = isSel ? '#0063A3' : (shape.color || '#0284c7');

          let totalLen = 0;
          for (let i = 1; i < displayPts.length; i++) {
            totalLen += Math.hypot(
              displayPts[i][0] - displayPts[i - 1][0],
              displayPts[i][1] - displayPts[i - 1][1],
              displayPts[i][2] - displayPts[i - 1][2]
            );
          }
          const midPt = displayPts[Math.floor(displayPts.length / 2)] || displayPts[0];

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
                points={displayPts}
                color={curveColor}
                lineWidth={isSel ? 5 : 3.5}
              />
              {/* Knots & Tangent handles when selected */}
              {bknots.map((knot, kIdx) => (
                <group key={kIdx}>
                  {/* Anchor Knot Marker */}
                  <mesh position={knot.point}>
                    <boxGeometry args={[0.08, 0.08, 0.08]} />
                    <meshBasicMaterial color={isSel ? '#38bdf8' : curveColor} />
                  </mesh>

                  {/* Handles when selected */}
                  {isSel && knot.handleOut && (
                    <group>
                      <Line
                        points={[[knot.point.x, knot.point.y, knot.point.z], [knot.handleOut.x, knot.handleOut.y, knot.handleOut.z]]}
                        color={knot.mode === 'broken' ? '#f59e0b' : '#38bdf8'}
                        lineWidth={2}
                      />
                      <mesh position={knot.handleOut}>
                        <sphereGeometry args={[0.045, 16, 16]} />
                        <meshBasicMaterial color={knot.mode === 'broken' ? '#f59e0b' : '#38bdf8'} />
                      </mesh>
                    </group>
                  )}

                  {isSel && knot.handleIn && (
                    <group>
                      <Line
                        points={[[knot.point.x, knot.point.y, knot.point.z], [knot.handleIn.x, knot.handleIn.y, knot.handleIn.z]]}
                        color={knot.mode === 'broken' ? '#f59e0b' : '#38bdf8'}
                        lineWidth={2}
                      />
                      <mesh position={knot.handleIn}>
                        <sphereGeometry args={[0.045, 16, 16]} />
                        <meshBasicMaterial color={knot.mode === 'broken' ? '#f59e0b' : '#38bdf8'} />
                      </mesh>
                    </group>
                  )}
                </group>
              ))}

              {(showAllDimensions || isSel) && (
                <Html position={midPt} center occlude={false}>
                  <div
                    onClick={(e: any) => { e.stopPropagation(); setSelectedId(shape.id); setSelectedIds([shape.id]); }}
                    className={`text-white text-xs font-medium px-2 py-1 rounded whitespace-nowrap shadow-lg border cursor-pointer transition-colors ${isSel ? 'bg-polyform-blue border-white' : 'bg-black/80 border-blue-500/50 hover:border-blue-400'}`}
                  >
                    {formatValue(totalLen, unit, 2)} ({bargs.resolution || 24}s)
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
                recordAction(actionLabel(`Deform ${shapeId}`));
              }
            }
            handlePointerUp(e);
          },
        };

        const isWallShape = shape.type === 'wall' || (shape.type !== 'door' && shape.type !== 'window' && (shape.tags?.some(t => t.includes('wall')) || shape.name?.toLowerCase().includes('wall')));
        const isRoofShape = (
          shape.tags?.some(t => t.includes('roof') && !t.includes('timber')) ||
          (shape.name?.toLowerCase().includes('roof') || shape.name?.toLowerCase().includes('gable') || shape.name?.toLowerCase().includes('hip')) ||
          shape.roofData !== undefined ||
          shape.roofTileData !== undefined
        ) && !shape.tags?.includes('timber-frame') && !shape.tags?.includes('timber-framing') && !shape.name?.toLowerCase().startsWith('timber ');

        const isFloorShape = (
          shape.tags?.some(t => t.includes('floor') || t.includes('slab') || t.includes('deck')) ||
          shape.name?.toLowerCase().includes('floor') ||
          shape.name?.toLowerCase().includes('slab') ||
          shape.name?.toLowerCase().includes('deck') ||
          (shape.type === 'poly' && !isWallShape && !isRoofShape)
        ) && !isWallShape && !isRoofShape && !shape.tags?.includes('timber-frame');

        const isFixtureShape = (
          shape.type === 'door' ||
          shape.type === 'window' ||
          shape.tags?.some(t => t.includes('door') || t.includes('window') || t.includes('fixture')) ||
          shape.name?.toLowerCase().includes('door') ||
          shape.name?.toLowerCase().includes('window')
        );

        let effectiveOpacity = shape.opacity ?? 1;
        if (isWallShape) {
          const isInterior = shape.tags?.includes('interior-wall') ||
            shape.tags?.includes('wall-interior') ||
            shape.name?.toLowerCase().includes('interior') ||
            (shape as any).wallCategory === 'interior' ||
            (shape as any).wallJustification === 'interior' ||
            ((shape.args && typeof shape.args === 'object' && !Array.isArray(shape.args) && (shape.args as any).thickness) ? (shape.args as any).thickness <= 0.12 : false);

          let maxTransparency = 0;
          if (wallTransparency > 0) {
            maxTransparency = Math.max(maxTransparency, wallTransparency);
          }
          if (isInterior && interiorWallTransparency > 0) {
            maxTransparency = Math.max(maxTransparency, interiorWallTransparency);
          } else if (!isInterior && exteriorWallTransparency > 0) {
            maxTransparency = Math.max(maxTransparency, exteriorWallTransparency);
          }
          if (shape.opacity !== undefined && shape.opacity < 1) {
            maxTransparency = Math.max(maxTransparency, 1 - shape.opacity);
          }
          if (maxTransparency > 0) {
            effectiveOpacity = Math.max(0, Math.min(1, 1 - maxTransparency));
          }
        } else if (isRoofShape) {
          let maxTransparency = 0;
          if (roofTransparency > 0) {
            maxTransparency = Math.max(maxTransparency, roofTransparency);
          }
          if (shape.opacity !== undefined && shape.opacity < 1) {
            maxTransparency = Math.max(maxTransparency, 1 - shape.opacity);
          }
          if (maxTransparency > 0) {
            effectiveOpacity = Math.max(0, Math.min(1, 1 - maxTransparency));
          }
        } else if (isFloorShape) {
          let maxTransparency = 0;
          if (floorTransparency > 0) {
            maxTransparency = Math.max(maxTransparency, floorTransparency);
          }
          if (shape.opacity !== undefined && shape.opacity < 1) {
            maxTransparency = Math.max(maxTransparency, 1 - shape.opacity);
          }
          if (maxTransparency > 0) {
            effectiveOpacity = Math.max(0, Math.min(1, 1 - maxTransparency));
          }
        } else if (isFixtureShape) {
          let maxTransparency = 0;
          if (fixturesTransparency > 0) {
            maxTransparency = Math.max(maxTransparency, fixturesTransparency);
          }
          if (shape.opacity !== undefined && shape.opacity < 1) {
            maxTransparency = Math.max(maxTransparency, 1 - shape.opacity);
          }
          if (maxTransparency > 0) {
            effectiveOpacity = Math.max(0, Math.min(1, 1 - maxTransparency));
          }
        }

        const bindingMaterial = (bindingId?: string) => {
          const binding = bindingId ? resolvedMaterialBindings[bindingId] : undefined;
          if (!binding) return undefined;
          const textures = bindingId ? managedBindingTextures[bindingId] : undefined;
          const ormUrl = runtimeImageUrl(binding.maps.orm);
          return {
            baseColorUrl: runtimeImageUrl(binding.maps.basecolor),
            baseColorTexture: textures?.basecolor,
            color: binding.color,
            roughness: binding.roughness,
            metalness: binding.metalness,
            opacity: binding.opacity,
            depth: binding.depth,
            pbr: {
              normalMap: textures?.['normal-gl'] ?? getCachedPBRMapTexture(runtimeImageUrl(binding.maps['normal-gl'])),
              normalScale: binding.maps['normal-gl'] ? new THREE.Vector2(binding.normalStrength, binding.normalStrength) : undefined,
              roughnessMap: textures?.orm ?? getCachedPBRMapTexture(ormUrl),
              metalnessMap: textures?.orm ?? getCachedPBRMapTexture(ormUrl),
              aoMap: textures?.orm ?? getCachedPBRMapTexture(ormUrl),
              aoMapIntensity: ormUrl ? 1 : undefined,
              specularIntensityMap: textures?.specular ?? getCachedPBRMapTexture(runtimeImageUrl(binding.maps.specular)),
              transmissionMap: textures?.transmission ?? getCachedPBRMapTexture(runtimeImageUrl(binding.maps.transmission)),
              transmission: binding.maps.transmission ? 1 : undefined,
            },
          };
        };
        const objectBinding = bindingMaterial(shape.materialBindingId);

        // Optional PBR map slots beyond the diffuse/albedo map. Spread onto
        // every physical material below - undefined props are no-ops.
        const hideAutoNormalOnDisabledDepth = shouldHideAutoNormalMap(shape);
        const pbrMapProps = {
          normalMap: objectBinding?.pbr.normalMap ?? (hideAutoNormalOnDisabledDepth ? null : getCachedPBRMapTexture(shape.normalMapUrl)),
          normalScale: objectBinding?.pbr.normalScale ?? ((!hideAutoNormalOnDisabledDepth && shape.normalMapUrl) ? new THREE.Vector2(shape.normalScale ?? 1, shape.normalScale ?? 1) : undefined),
          roughnessMap: objectBinding?.pbr.roughnessMap ?? getCachedPBRMapTexture(shape.roughnessMapUrl),
          metalnessMap: objectBinding?.pbr.metalnessMap ?? getCachedPBRMapTexture(shape.metalnessMapUrl),
          aoMap: objectBinding?.pbr.aoMap ?? getCachedPBRMapTexture(shape.aoMapUrl),
          aoMapIntensity: objectBinding?.pbr.aoMapIntensity ?? (shape.aoMapUrl ? (shape.aoMapIntensity ?? 1) : undefined),
          specularIntensityMap: objectBinding?.pbr.specularIntensityMap,
          transmissionMap: objectBinding?.pbr.transmissionMap,
          transmission: objectBinding?.pbr.transmission,
          displacementMap: shape.surfaceDepthEnabled === undefined ? getCachedPBRMapTexture(shape.displacementMapUrl) : null,
          displacementScale: shape.displacementMapUrl ? (shape.displacementScale ?? 0.1) : undefined,
        };

        const materialElements = shape.type === 'box' && shape.surfaceMaterials && !shape.bevelAmount ? (
          [0, 2, 4, 6, 8, 10].map((idx) => {
            const mat = shape.surfaceMaterials?.[idx] || shape.color;
            const faceBinding = bindingMaterial(shape.surfaceMaterialBindings?.[idx] ?? shape.materialBindingId);
            const textureUrl = faceBinding?.baseColorUrl ?? (isTextureUrl(mat) ? mat : undefined);
            return textureUrl ? (
              <meshPhysicalMaterial
                key={idx}
                attach={`material-${idx/2}`}
                map={faceBinding?.baseColorTexture ?? getCachedTexture(textureUrl)}
                color={faceBinding?.color ?? '#ffffff'}
                roughness={faceBinding?.roughness ?? shape.roughness ?? 0.5}
                metalness={faceBinding?.metalness ?? shape.metalness ?? 0}
                {...(faceBinding?.pbr ?? pbrMapProps)}
                transparent={effectiveOpacity < 1 || (faceBinding?.opacity ?? 1) < 1}
                opacity={Math.min(effectiveOpacity, faceBinding?.opacity ?? 1)}
                depthWrite={Math.min(effectiveOpacity, faceBinding?.opacity ?? 1) >= 0.85}
                side={effectiveOpacity < 1 ? THREE.DoubleSide : (shape.type === 'poly' ? THREE.DoubleSide : THREE.FrontSide)}
                emissive={selectedId === shape.id ? '#0063A3' : '#000000'}
                emissiveIntensity={selectedId === shape.id ? 0.5 : 0}
              />
            ) : (
              <meshPhysicalMaterial
                key={idx}
                attach={`material-${idx/2}`}
                color={faceBinding?.color ?? mat}
                roughness={faceBinding?.roughness ?? shape.roughness ?? 0.5}
                metalness={faceBinding?.metalness ?? shape.metalness ?? 0}
                {...(faceBinding?.pbr ?? pbrMapProps)}
                transparent={effectiveOpacity < 1 || (faceBinding?.opacity ?? 1) < 1}
                opacity={Math.min(effectiveOpacity, faceBinding?.opacity ?? 1)}
                depthWrite={Math.min(effectiveOpacity, faceBinding?.opacity ?? 1) >= 0.85}
                side={effectiveOpacity < 1 ? THREE.DoubleSide : (shape.type === 'poly' ? THREE.DoubleSide : THREE.FrontSide)}
                emissive={selectedId === shape.id ? '#0063A3' : '#000000'}
                emissiveIntensity={selectedId === shape.id ? 0.5 : 0}
              />
            );
          })
        ) : (
          (objectBinding?.baseColorUrl || isTextureUrl(shape.color)) ? (
            <meshPhysicalMaterial
              map={objectBinding?.baseColorTexture ?? getCachedTexture(objectBinding?.baseColorUrl ?? shape.color)}
              color={objectBinding?.color ?? '#ffffff'}
              roughness={objectBinding?.roughness ?? shape.roughness ?? 0.5}
              metalness={objectBinding?.metalness ?? shape.metalness ?? 0}
              {...pbrMapProps}
              transparent={effectiveOpacity < 1 || (shape.opacity !== undefined && shape.opacity < 1)}
              opacity={Math.min(effectiveOpacity, objectBinding?.opacity ?? 1)}
              depthWrite={effectiveOpacity >= 0.85}
              side={effectiveOpacity < 1 ? THREE.DoubleSide : THREE.FrontSide}
              emissive={selectedId === shape.id ? '#0063A3' : '#000000'}
              emissiveIntensity={selectedId === shape.id ? 0.5 : 0}
            />
          ) : (
            <meshPhysicalMaterial
              color={objectBinding?.color ?? shape.color}
              roughness={objectBinding?.roughness ?? (shape.roughness || 0.5)}
              metalness={objectBinding?.metalness ?? (shape.metalness || 0)}
              {...pbrMapProps}
              transparent={effectiveOpacity < 1 || (shape.opacity !== undefined && shape.opacity < 1)}
              opacity={Math.min(effectiveOpacity, objectBinding?.opacity ?? 1)}
              depthWrite={effectiveOpacity >= 0.85}
              side={effectiveOpacity < 1 ? THREE.DoubleSide : THREE.FrontSide}
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

        if (shape.type === 'patio' && shape.patioData) {
          return (
            <React.Fragment key={shape.id}>
              <PatioMesh shape={shape} groundAt={patioOriginalGround} meshProps={meshProps} selectionHighlight={selectionHighlight}
                surfaceBinding={bindingMaterial(shape.patioData.surfaceMaterialId)} />
              {/* Balconies are shaped with the panel's sliders, so they get no corner handles. */}
              {selectedId === shape.id && shape.patioData.kind !== 'balcony' && (activeTool === 'select' || activeTool === 'lasso' || activeTool === 'patio') && (
                <PatioEditHandles shape={shape} />
              )}
            </React.Fragment>
          );
        }

        if (shape.type === 'water' && shape.waterData) {
          const [wx, , wz] = shape.position;
          const waterTerrain = shapes.find(s => s.type === 'terrain' && !s.hidden && s.terrainData
            && Math.abs(wx - s.position[0]) <= s.terrainData.width / 2 && Math.abs(wz - s.position[2]) <= s.terrainData.depth / 2);
          return (
            <React.Fragment key={shape.id}>
              <WaterMesh
                shape={shape}
                terrain={waterTerrain ? dugTerrains.get(waterTerrain.id) ?? waterTerrain : undefined}
                meshProps={meshProps}
                selectionHighlight={selectionHighlight}
              />
              {selectedId === shape.id && (activeTool === 'select' || activeTool === 'lasso') && (
                <WaterEditHandles shape={shape} terrain={waterTerrain ? dugTerrains.get(waterTerrain.id) ?? waterTerrain : undefined} />
              )}
            </React.Fragment>
          );
        }

        if (shape.type === 'fence' && shape.fenceData) {
          const fenceTerrain = terrainUnder(fenceWorldPoints(shape), shapes);
          const fenceGround = fenceTerrain ? dugTerrains.get(fenceTerrain.id) ?? fenceTerrain : undefined;
          return (
            <React.Fragment key={shape.id}>
              <FenceMesh
                shape={shape}
                terrain={fenceGround}
                selected={selectedId === shape.id}
                meshProps={meshProps}
                selectionHighlight={selectionHighlight}
              />
              {selectedId === shape.id && (activeTool === 'select' || activeTool === 'lasso') && <FenceEditHandles shape={shape} terrain={fenceGround} />}
            </React.Fragment>
          );
        }

        if (shape.type === 'site_building' && shape.siteBuildingData) {
          return (
            <SiteBuildingMesh key={shape.id} shape={shape} meshProps={meshProps}
              selected={selectedId === shape.id || selectedIds.includes(shape.id)}
              style={siteStyleFor(shape)} />
          );
        }

        if ((shape.type === 'text' || shape.type === 'text3d') && shape.textData) {
          return <TextMesh key={shape.id} shape={shape} meshProps={meshProps} selectionHighlight={selectionHighlight} />;
        }

        if ((shape.type === 'tree' || shape.type === 'bush' || shape.type === 'rock') && shape.plantSpeciesId) {
          {
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

        if (isGroupShape(shape)) {
          // Open for editing: its faces are in the drawing kernel right now.
          if (groupEdit?.shapeId === shape.id) return null;
          return (
            <KernelGroupMesh key={shape.id} shape={shape} groupProps={meshProps}
              showEdges={edgeLinesEnabled} edgeColor={edgeLinesColor} edgeOpacity={edgeLinesOpacity}
              edgeLineWidth={edgeLinesThickness} bindingFor={kernelBindingFor} />
          );
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
              {/* Task #149: dark edge lines between adjacent faces */}
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
          {((shape.surfaceDepthEnabled && shape.displacementMapUrl) || (objectBinding?.depth?.enabled && shape.materialBindingId && managedBindingTextures[shape.materialBindingId]?.height)) &&
            <SurfaceDepthBinding shape={dugTerrains.get(shape.id) ?? shape} materialDepth={objectBinding?.depth}
              heightTexture={shape.materialBindingId ? managedBindingTextures[shape.materialBindingId]?.height : undefined} />}
          {shape.type === 'lamp' && <LampLightBinding shape={shape} />}
          {((shape.type === 'circle' || shape.type === 'triangle' || shape.type === 'prism')
              // A tapered cylinder (radiusTop !== radiusBottom) can't be represented by
              // PolyGeometry's constant-cross-section extrude bevel, so it falls back to
              // the plain, unbevelled cylinderGeometry branch below instead.
              || (shape.type === 'cylinder' && Array.isArray(shape.args) && shape.args[0] === shape.args[1])
            ) && shape.bevelAmount ? (
            <PolyGeometry
              vertices={regularPolygonVertices(
                Array.isArray(shape.args) ? shape.args[0] : 1,
                (shape.type === 'triangle' || shape.type === 'prism') ? 3 : (Array.isArray(shape.args) ? (shape.args[3] || 32) : 32)
              )}
              height={Array.isArray(shape.args) ? shape.args[2] : 1}
              bevelAmount={shape.bevelAmount}
              bevelSegments={shape.bevelSegments || 4}
              bevelType={shape.bevelType || 'radius'}
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
          ) : shape.type === 'cylinder' ? (
            <cylinderGeometry args={(Array.isArray(shape.args) ? shape.args : [1, 1, 1, 32]) as any} />
          ) : shape.type === 'poly' ? (
            <PolyGeometry vertices={shape.args?.vertices || []} height={shape.args?.height ?? 0} bevelAmount={shape.bevelAmount || 0} bevelSegments={shape.bevelSegments || 4} bevelType={shape.bevelType || 'radius'} holes={computeHolesForSlab(shape, shapes)} />
          ) : ['wall', 'door', 'window', 'step', 'staircase', 'scale_figure'].includes(shape.type) ? (
            <ArchGeometry shape={shape} shapes={shapes} />
          ) : ['tree', 'bush', 'fence', 'railing', 'lamp', 'bench', 'rock'].includes(shape.type) ? (
            <LandscapeFeatureGeometry shape={shape} />
          ) : shape.type === 'custom' ? (
            <CustomGeometry shape={shape} />
          ) : shape.type === 'terrain' ? (
            <TerrainGeometry terrainData={dugTerrains.get(shape.id)?.terrainData ?? shape.terrainData}
              {...(() => {
                // Ground-floor slab outlines in this terrain's own frame.
                const local = slabFootprints.map(f => f.map(([x, z]) => [x - shape.position[0], z - shape.position[2]] as [number, number]));
                return { footprints: local, footprintsKey: `${slabFootprintsKey}@${shape.position[0]},${shape.position[2]}` };
              })()} />
          ) : (
            <boxGeometry args={(Array.isArray(shape.args) ? shape.args : [1, 1, 1]) as any} />
          )}
          {shape.type === 'door' || shape.type === 'window' ? (
            <>
              {/* Material 0: frame and panels use the same applied material as other shapes. */}
              <meshPhysicalMaterial
                attach="material-0"
                map={objectBinding?.baseColorTexture ?? (objectBinding?.baseColorUrl || isTextureUrl(shape.color)
                  ? getCachedTexture(objectBinding?.baseColorUrl ?? shape.color)
                  : null)}
                color={objectBinding?.color ?? (isTextureUrl(shape.color) ? '#ffffff' : (shape.color || '#ffffff'))}
                roughness={objectBinding?.roughness ?? shape.roughness ?? 0.4}
                metalness={objectBinding?.metalness ?? shape.metalness ?? 0.05}
                {...pbrMapProps}
                transparent={effectiveOpacity < 1 || (objectBinding?.opacity ?? shape.opacity ?? 1) < 1}
                opacity={Math.min(effectiveOpacity, objectBinding?.opacity ?? 1)}
                depthWrite={Math.min(effectiveOpacity, objectBinding?.opacity ?? 1) >= 0.85}
                side={THREE.DoubleSide}
                emissive={selectedId === shape.id ? '#0063A3' : '#000000'}
                emissiveIntensity={selectedId === shape.id ? 0.35 : 0}
              />
              {/* Material 1: glass; wet with rain or snow when the weather has any. */}
              {glassWeather && effectiveOpacity >= 1 ? (
                <WetGlassMaterial attach="material-1" selected={selectedId === shape.id} />
              ) : <meshStandardMaterial 
                attach="material-1"
                color="#e0f2fe" 
                roughness={0.05}
                metalness={0.1}
                transparent={true}
                opacity={Math.min(0.20, effectiveOpacity * 0.20)}
                depthWrite={false}
                side={THREE.DoubleSide}
                emissive={selectedId === shape.id ? '#0063A3' : '#000000'}
                emissiveIntensity={selectedId === shape.id ? 0.2 : 0}
              />}
              {/* Material 2: Architectural Brushed Hardware (Knobs / Lever Handles / Pulls) */}
              <meshStandardMaterial 
                attach="material-2"
                color="#94a3b8" 
                roughness={0.2}
                metalness={0.85}
                transparent={effectiveOpacity < 1 || (shape.opacity !== undefined && shape.opacity < 1)}
                opacity={effectiveOpacity}
                side={THREE.DoubleSide}
                emissive={selectedId === shape.id ? '#0063A3' : '#000000'}
                emissiveIntensity={selectedId === shape.id ? 0.35 : 0}
              />
            </>
          ) : shape.type === 'box' && shape.surfaceMaterials ? (
            materialElements
          ) : (
            objectBinding ? (
              <meshPhysicalMaterial
                map={objectBinding.baseColorTexture ?? (objectBinding.baseColorUrl ? getCachedTexture(objectBinding.baseColorUrl) : null)}
                color={objectBinding.color}
                roughness={objectBinding.roughness}
                metalness={objectBinding.metalness}
                {...objectBinding.pbr}
                transparent={effectiveOpacity < 1 || objectBinding.opacity < 1}
                opacity={Math.min(effectiveOpacity, objectBinding.opacity)}
                depthWrite={effectiveOpacity >= 0.85}
                side={(effectiveOpacity < 1 || ['poly', 'terrain', 'custom'].includes(shape.type)) ? THREE.DoubleSide : THREE.FrontSide}
                emissive={selectedId === shape.id ? '#0063A3' : '#000000'}
                emissiveIntensity={selectedId === shape.id ? 0.5 : 0}
              />
            ) :
            (() => {
              const isTerrainHeatmap = shape.type === 'terrain' && !!shape.terrainData?.shadingMode && shape.terrainData.shadingMode !== 'default';
              const site = shape.type === 'terrain' ? shape.terrainData?.site : undefined;
              const resolvedTexUrl = isTerrainHeatmap ? '' : site ? (
                // Imported ground: plain white-model grey, or the satellite picture of exactly this site.
                site.groundStyle === 'satellite' ? (siteSatelliteUrl(site, googleMapsApiKey || '') ?? '') : ''
              ) : !isTerrainHeatmap ? (
                (shape.type === 'terrain')
                  ? (isTextureUrl(shape.terrainData?.textureUrl) ? shape.terrainData!.textureUrl! : (isTextureUrl(shape.color) ? shape.color : (shape.terrainData?.textureUrl || 'lush_grass')))
                  : (isTextureUrl(shape.textureUrl) ? shape.textureUrl! : (isTextureUrl(shape.color) ? shape.color : ''))
              ) : '';

              if (resolvedTexUrl) {
                return (
                  <meshStandardMaterial
                    map={getCachedTexture(resolvedTexUrl)}
                    color="#ffffff"
                    roughness={shape.roughness ?? 0.8}
                    metalness={shape.metalness ?? 0.05}
                    {...pbrMapProps}
                    transparent={effectiveOpacity < 1 || (shape.opacity !== undefined && shape.opacity < 1)}
                    opacity={effectiveOpacity}
                    depthWrite={effectiveOpacity >= 0.85}
                    side={(effectiveOpacity < 1 || shape.type === 'poly' || shape.type === 'terrain' || shape.type === 'custom' || shape.tags?.some(t => t.includes('roof'))) ? THREE.DoubleSide : THREE.FrontSide}
                    emissive={selectedId === shape.id ? '#0063A3' : '#000000'}
                    emissiveIntensity={selectedId === shape.id ? 0.5 : 0}
                  />
                );
              }

              const hasVertexColors = isTerrainHeatmap || shape.type === 'scale_figure' || shape.type === 'bush' || shape.type === 'tree' || Boolean(shape.geometryData?.colors && shape.geometryData.colors.length > 0);

              return (
                <meshStandardMaterial
                  color={hasVertexColors ? '#ffffff' : (shape.color || '#ffffff')}
                  vertexColors={hasVertexColors}
                  roughness={shape.type === 'bush' || shape.type === 'tree' ? 0.75 : (shape.roughness ?? 0.8)}
                  metalness={shape.type === 'bush' || shape.type === 'tree' ? 0.04 : (shape.metalness ?? 0.05)}
                  {...(hasVertexColors ? {} : pbrMapProps)}
                  transparent={effectiveOpacity < 1 || (shape.opacity !== undefined && shape.opacity < 1)}
                  opacity={effectiveOpacity}
                  depthWrite={effectiveOpacity >= 0.85}
                  side={(effectiveOpacity < 1 || shape.type === 'poly' || shape.type === 'terrain' || shape.type === 'bush' || shape.type === 'tree' || shape.type === 'custom' || shape.tags?.some(t => t.includes('roof'))) ? THREE.DoubleSide : THREE.FrontSide}
                  emissive={selectedId === shape.id ? '#0063A3' : '#000000'}
                  emissiveIntensity={selectedId === shape.id ? 0.5 : 0}
                />
              );
            })()
          )}
          {selectionHighlight}
          {subtractHighlight}
          {/* Task #149: dark edge lines between adjacent faces */}
          {edgeLinesEnabled && (() => {
            const lineProps = {
              color: edgeLinesColor, lineWidth: edgeLinesThickness, linewidth: edgeLinesThickness,
              transparent: edgeLinesOpacity < 1, opacity: edgeLinesOpacity, depthTest: true,
              polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, renderOrder: 2,
            };
            // A piece of a wall run draws no lines where it joins the next piece.
            const ends = shape.type === 'wall' ? wallRunInfo.joined.get(shape.id) : undefined;
            if (ends && (ends.start || ends.end)) {
              return <RunEdges planes={joinedEndPlanes(shape, ends)} {...lineProps} />;
            }
            // Custom meshes (roofs, parapets, combined objects) are often stored double-sided.
            if (shape.type === 'custom') return <RunEdges planes={[]} singleSided {...lineProps} />;
            return <Edges threshold={15} {...lineProps} />;
          })()}
        </mesh>
      );
    })}

      {glassWeather && <GlassWeatherDriver />}

      {/* Procedural Grass Instances for active terrain shapes */}
      {shapes
        .filter(s => s.type === 'terrain' && !s.hidden && s.terrainData?.grass?.enabled)
        .map(terrainShape => (
          <ProceduralGrass
            key={`procedural-grass-${terrainShape.id}`}
            terrainShape={dugTerrains.get(terrainShape.id) ?? terrainShape}
            shapes={shapes}
            terrainModifiers={terrainModifiers}
          />
        ))}

      {/* Procedural Wildflower Instances for active terrain shapes */}
      {shapes
        .filter(s => s.type === 'terrain' && !s.hidden && s.terrainData?.flowers?.enabled)
        .map(terrainShape => (
          <ProceduralWildflowers
            key={`procedural-flowers-${terrainShape.id}`}
            terrainShape={dugTerrains.get(terrainShape.id) ?? terrainShape}
            shapes={shapes}
            terrainModifiers={terrainModifiers}
          />
        ))}

      {/*
        Invisible dummy the group-transform gizmo below is attached to.
        Mounted unconditionally (not just while transforming) so the
        callback ref can populate groupPivotRef before TransformControls
        ever needs it -- attaching TransformControls to a null object on
        its very first render is the failure this avoids.
      */}
      <object3D
        ref={(node) => {
          groupPivotRef.current = node;
          if (node && !groupPivotReady) setGroupPivotReady(true);
        }}
      />
      {kernelSelectedSet.size > 0 && isTransforming && groupPivotReady && groupPivotRef.current && (
        <TransformControls
          object={groupPivotRef.current}
          mode={activeTool === 'move' ? 'translate' : (activeTool === 'rotate' ? 'rotate' : 'scale')}
          showX={!axisLock || axisLock === 'x'}
          showY={!axisLock || axisLock === 'y'}
          showZ={!axisLock || axisLock === 'z'}
          onMouseDown={handleGroupTransformBegin}
          onMouseUp={handleGroupTransformEnd}
          onObjectChange={handleGroupTransformChange}
          translationSnap={unit === 'm' ? 0.01 : 1}
          rotationSnap={Math.PI / 24}
          scaleSnap={0.01}
        />
      )}
      {groupTransformPreview && (
        <GroupTransformPreview
          graph={kernelHost.graph}
          faces={groupTransformPreview.faces}
          matrix={groupTransformPreview.matrix}
        />
      )}

      {selectedId && isTransforming && (
        <>
          <TransformControls 
            ref={transformRef}
            object={getSceneObjectById(selectedId)} 
            mode={activeTool === 'move' ? 'translate' : (activeTool === 'rotate' ? 'rotate' : 'scale')}
            showX={!axisLock || axisLock === 'x'}
            showY={!axisLock || axisLock === 'y'}
            showZ={!axisLock || axisLock === 'z'}
            onMouseDown={() => {
              isDraggingRef.current = true;
              const grabbed = shapes.find(s => s.id === selectedId);
              transformStartRef.current = grabbed ? {
                id: grabbed.id,
                position: [...grabbed.position] as [number, number, number],
                quaternion: grabbed.quaternion ? [...grabbed.quaternion] as [number, number, number, number]
                  : new THREE.Quaternion().setFromEuler(new THREE.Euler(...(grabbed.rotation ?? [0, 0, 0]))).toArray() as [number, number, number, number],
                scale: [...(grabbed.scale ?? [1, 1, 1])] as [number, number, number],
              } : null;
            }}
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
          renderOrder={5}
          raycast={() => null}
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
          ) : ['wall', 'door', 'window', 'step', 'staircase', 'scale_figure'].includes(previewShape.type) ? (
            <ArchGeometry shape={previewShape as any} shapes={shapes} />
          ) : (
            <boxGeometry args={previewShape.args} />
          )}
          {/*
            depthTest disabled deliberately: this preview relied only on a
            small (0.005 unit) manual offset along the drawing normal to sit
            in front of whatever surface it is drawn on. That was enough
            when every surface rendered at its exact depth, but kernel faces
            now carry their own polygonOffset (needed so a coplanar edge
            line reliably wins its OWN depth fight — see KernelGeometry).
            The two small offsets could come out comparably sized depending
            on view angle and distance, so which one "won" per pixel became
            inconsistent — occasional flicker while drawing on a kernel
            surface, worst on vertical faces viewed at a shallow angle. A
            live preview has no reason to ever lose a depth fight against
            the thing it is being drawn onto.
          */}
          {previewShape.type === 'door' || previewShape.type === 'window' ? (
            <>
              <meshBasicMaterial attach="material-0" color="#ffffff" transparent opacity={0.7} depthTest={false} />
              <meshBasicMaterial attach="material-1" color="#bae6fd" transparent opacity={0.25} depthTest={false} />
              <meshBasicMaterial attach="material-2" color="#cbd5e1" transparent opacity={0.7} depthTest={false} />
            </>
          ) : previewShape.type === 'scale_figure' ? (
            <meshBasicMaterial 
              vertexColors={true}
              transparent 
              opacity={0.8} 
              side={THREE.DoubleSide} 
              depthTest={false} 
            />
          ) : previewShape.type === 'staircase' || previewShape.type === 'step' ? (
            <meshBasicMaterial 
              color="#0284c7" 
              transparent 
              opacity={0.65} 
              side={THREE.DoubleSide} 
              depthTest={false} 
            />
          ) : (
            <meshBasicMaterial color={activeMaterial} transparent opacity={0.5} depthTest={false} />
          )}
          {/*
            This preview never had an outline at all — just the
            semi-transparent fill above. That's invisible-to-hard-to-see
            against a light background whenever the active material is
            white or a near-white, confirmed directly as the cause: the
            fill alone gives no edge to see the shape's actual bounds by,
            which committed shapes never have this problem because they
            get an Edges child from edgeLinesEnabled (see the shapes.map
            render further down) — the live preview simply never got the
            same treatment. depthTest disabled for the same reason as the
            fill's own depthTest={false} above: this preview should never
            lose a depth fight against the surface it's being drawn onto.
          */}
          <Edges threshold={15} color="#000000" transparent opacity={0.6} depthTest={false} renderOrder={6} />
        </mesh>
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
          case 'custom':
            // A CSG-result 'custom' shape has no meaningful args (it holds
            // a raw geometryData mesh instead) — so this was falling
            // straight to the default/null case below, and the label
            // never rendered at all. Computing the bounding box of the
            // actual parsed geometry is the only way to get a real
            // dimension for this shape type, since there's no [w,h,d]
            // array to read like every other shape type has.
            if (shape.geometryData) {
              try {
                const loader = new THREE.BufferGeometryLoader();
                const geo = loader.parse(shape.geometryData as any);
                geo.computeBoundingBox();
                if (geo.boundingBox) {
                  const size = new THREE.Vector3();
                  geo.boundingBox.getSize(size);
                  label = `${formatValue(size.x, unit, 1)} × ${formatValue(size.y, unit, 1)} × ${formatValue(size.z, unit, 1)}`;
                }
                geo.dispose();
              } catch {
                label = null;
              }
            }
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

      {/* Show All Dimensions: each balcony's floor height above the ground below its front. */}
      {showAllDimensions && shapes.map((shape) => {
        const data = shape.patioData;
        if (shape.hidden || shape.type !== 'patio' || data?.kind !== 'balcony' || data.points.length < 3) return null;
        const frame = balconyFrame(shape);
        const [px, floorY, pz] = shape.position;
        // The middle of the front edge (or the outline's centre for other shapes).
        const front: [number, number] = frame
          ? [frame.centre[0] + frame.right[0] * (frame.rightReach - frame.left) / 2 + frame.out[0] * frame.depth,
             frame.centre[1] + frame.right[1] * (frame.rightReach - frame.left) / 2 + frame.out[1] * frame.depth]
          : [px + data.points.reduce((m, p) => m + p[0], 0) / data.points.length, pz + data.points.reduce((m, p) => m + p[1], 0) / data.points.length];
        const groundY = patioDrawnGround(front[0], front[1]);
        const height = floorY - groundY;
        if (height < 0.05) return null;
        const top = new THREE.Vector3(front[0], floorY, front[1]);
        const bottom = new THREE.Vector3(front[0], groundY, front[1]);
        const tick = frame ? new THREE.Vector3(frame.right[0] * 0.15, 0, frame.right[1] * 0.15) : new THREE.Vector3(0.15, 0, 0);
        return (
          <group key={`balcony-height-${shape.id}`}>
            <Line points={[bottom, top]} color="#06b6d4" lineWidth={1.5} depthTest={false} renderOrder={40} />
            <Line points={[top.clone().sub(tick), top.clone().add(tick)]} color="#06b6d4" lineWidth={1.5} depthTest={false} renderOrder={40} />
            <Line points={[bottom.clone().sub(tick), bottom.clone().add(tick)]} color="#06b6d4" lineWidth={1.5} depthTest={false} renderOrder={40} />
            <Html position={[front[0], (floorY + groundY) / 2, front[1]]} center occlude={false}>
              <div className="bg-black/80 text-white text-xs font-medium px-2 py-1 rounded whitespace-nowrap pointer-events-none shadow-lg border border-cyan-500/40">
                {shape.name ?? 'Balcony'}: {formatValue(height, unit, 2)} above ground
              </div>
            </Html>
          </group>
        );
      })}

      {/*
        Show All Dimensions for kernel groups — the identical Shape-only
        gap as the note tool and the context menu had earlier this
        session: this whole feature only ever considered the legacy
        `shapes` array. Kernel geometry has no fixed "type" or "args" the
        way a Shape does (it's an arbitrary user-drawn graph, not a
        parametric primitive), so there's no per-type label to look up —
        the closest equivalent is each group's own bounding-box extent,
        computed directly from its vertex positions.
      */}
      {showAllDimensions && faceGroups(kernelHost.graph).map((group) => {
        if (group.faces.length === 0) return null;
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (const fid of group.faces) {
          const f = kernelHost.graph.faces.get(fid);
          if (!f) continue;
          for (const vid of loopVertexIds(kernelHost.graph, f.outerLoop)) {
            const p = getVertex(kernelHost.graph, vid).position;
            if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
            if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
          }
        }
        if (!isFinite(minX)) return null;
        const w = maxX - minX, h = maxY - minY, d = maxZ - minZ;
        const label = `${formatValue(w, unit, 2)} × ${formatValue(d, unit, 2)} × ${formatValue(h, unit, 2)}`;
        const cx = (minX + maxX) / 2, cy = maxY + 0.3, cz = (minZ + maxZ) / 2;

        return (
          <Html
            key={`kernel-dim-${group.id}`}
            position={[cx, cy, cz]}
            center
            occlude={false}
          >
            <div className="bg-black/80 text-white text-xs font-medium px-2 py-1 rounded whitespace-nowrap pointer-events-none shadow-lg border border-cyan-500/40">
              {label}
            </div>
          </Html>
        );
      })}

      {/* Inference lines: the direction in force, a held lock, and the edge under the pointer */}
      {snapGuides.map((g, i) => (
        <Line key={`snap-guide-${i}`} points={[g.a.toArray(), g.b.toArray()]} color={g.color} lineWidth={g.dashed ? 1.5 : 2}
          dashed={g.dashed} dashSize={0.25} gapSize={0.15} depthTest={false} renderOrder={18} raycast={() => null} />
      ))}
      {snapHoverEdge && KERNEL_SNAP_TOOLS.includes(activeTool) && (
        <Line points={[snapHoverEdge.a.toArray(), snapHoverEdge.b.toArray()]} color="#f59e0b" lineWidth={3} depthTest={false} renderOrder={17} raycast={() => null} />
      )}

      {/* Inference Locking: snap indicator */}
      {snapIndicator && (
        <Html position={snapIndicator.point} center occlude={false} zIndexRange={[50, 60]}>
          <div className="flex flex-col items-center gap-1 pointer-events-none -translate-y-4">
            {(() => {
              const t = snapIndicator.type;
              const base = 'w-2.5 h-2.5 shadow-lg';
              if (t === 'endpoint' || t === 'close' || t === 'origin') return <div className={cn(base, 'bg-green-400 rotate-45 border border-green-600')} />;
              if (t === 'midpoint') return <div className={cn(base, 'bg-cyan-400 rounded-full border border-cyan-600')} />;
              if (t === 'center') return <div className={cn(base, 'bg-fuchsia-400 rounded-full border border-fuchsia-600 ring-2 ring-fuchsia-200')} />;
              if (t === 'edge' || t === 'guide') return <div className={cn(base, 'bg-red-500 border border-red-700')} />;
              if (t === 'intersection') return <div className={cn(base, 'bg-green-500 border border-green-800 ring-2 ring-green-200')} />;
              return <div className={cn(base, 'rounded-full border border-white/70')} style={{ backgroundColor: snapIndicator.color ?? '#a855f7' }} />;
            })()}
            <div className="bg-black/80 text-white text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded whitespace-nowrap shadow border border-white/20">
              {snapIndicator.tooltip || (snapIndicator.type === 'endpoint' ? 'Endpoint' : snapIndicator.type === 'midpoint' ? 'Midpoint' : 'Center')}
            </div>
          </div>
        </Html>
      )}

      {activeTool === 'teleport' && (
        <TeleportPortalPreview
          floorEnabled={floorEnabled}
          transitionActive={portalTransitionActive}
          onTravel={(destination) => {
            if (!destination) {
              setMeasurements('Portal Navigation: Click a wall, window, door, or floor to travel there.');
            } else if (destination.obstructed) {
              showToast('Destination space is obstructed or inaccessible.');
            } else {
              startPortalTransition(destination);
              setMeasurements('Portal Navigation: Click another surface to keep moving, or switch tool to stop.');
            }
          }}
          postprocessingActive={postprocessingActive}
        />
      )}

      {/* Walk Mode (spec polyform-walk-mode-spec.md): entirely self-contained
          - owns its own placement click/hover, pointer lock, physics loop and
          camera while active, rather than threading into the handlers above
          (which all early-return for activeTool==='walk' - see their own
          comments). */}
      {activeTool === 'walk' && (
        <WalkModeController
          scene={scene}
          camera={camera as THREE.PerspectiveCamera}
          gl={gl}
          shapes={shapes}
          floorEnabled={floorEnabled}
          phase={walkModePhase}
          setPhase={setWalkModePhase}
          movementSpeed={walkMovementSpeed}
          mouseSensitivity={walkMouseSensitivity}
          bridge={walkBridgeRef.current}
          onExit={() => setActiveTool(preWalkToolRef.current)}
          onToast={setViewportToast}
        />
      )}

      {/* Look Mode: camera direction / orientation control without walking or physics */}
      {activeTool === 'look' && (
        <LookModeController
          scene={scene}
          camera={camera as THREE.PerspectiveCamera}
          gl={gl}
          mouseSensitivity={walkMouseSensitivity}
          onExit={() => setActiveTool(preWalkToolRef.current)}
          onToast={setViewportToast}
        />
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
      {/* The Move tool's axis line; the drawing tools' locks are drawn by the snap engine (snapGuides). */}
      {axisLock && drawingStart && activeTool === 'move' && (
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
          <div className="bg-polyform-blue text-white text-xs font-bold px-2 py-1 rounded whitespace-nowrap shadow-lg border border-white/30">
            {typedLength}{unit === 'mm' ? ' mm' : unit === 'cm' ? ' cm' : ' m'}<span className="animate-pulse">|</span>
          </div>
        </Html>
      )}

      {/* Measuring Tape Preview (in-progress) */}
      {activeTool === 'dimensions' && dimDraft && (
        dimDraft.end
          ? <DimensionMark args={makeDimensionArgs([dimDraft.start.x, dimDraft.start.y, dimDraft.start.z], [dimDraft.end.x, dimDraft.end.y, dimDraft.end.z], [dimDraft.offset.x, dimDraft.offset.y, dimDraft.offset.z])} unit={unit} selected={false} />
          : <Line points={[dimDraft.start.toArray(), dimDraft.cursor.toArray()]} color="#0284c7" lineWidth={1.5} dashed dashSize={0.15} gapSize={0.1} depthTest={false} renderOrder={20} raycast={() => null} />
      )}
      {activeTool === 'leader' && leaderDraft && (
        <>
          <Line points={[leaderDraft.target.toArray(), (leaderDraft.anchor ?? leaderDraft.cursor).toArray()]} color="#f59e0b" lineWidth={1.5} depthTest={false} renderOrder={20} raycast={() => null} />
          {leaderDraft.typing && leaderDraft.anchor && (
            <Html position={leaderDraft.anchor} center occlude={false} zIndexRange={[60, 70]}>
              <input
                autoFocus
                value={leaderDraft.text}
                onChange={(e) => setLeaderDraft({ ...leaderDraft, text: e.target.value })}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') commitLeader();
                  if (e.key === 'Escape') setLeaderDraft(null);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                placeholder="Label text"
                className="w-40 px-2 py-1 text-xs rounded border border-amber-500 bg-white text-gray-900 shadow-lg outline-none"
              />
            </Html>
          )}
        </>
      )}
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
      {/* Tape Measure: the edge a click would pull a guide off */}
      {activeTool === 'tape' && tapeHover && !tapeGuide && !tapeStart && (
        <Line points={[tapeHover.a.toArray(), tapeHover.b.toArray()]} color="#d946ef" lineWidth={4} depthTest={false} renderOrder={20} raycast={() => null} />
      )}
      {/* Tape Measure: the guide being pulled, and how far it is from its line */}
      {tapeGuide && (() => {
        const at = tapeGuide.linePoint.clone().add(tapeGuide.offset);
        const reach = 100;
        const a = at.clone().addScaledVector(tapeGuide.dir, -reach);
        const b = at.clone().addScaledVector(tapeGuide.dir, reach);
        return (
          <group>
            <Line points={[a.toArray(), b.toArray()]} color={TAPE_GUIDE_COLOR} lineWidth={1.5} dashed dashSize={0.3} gapSize={0.2} raycast={() => null} />
            <Line points={[tapeGuide.linePoint.toArray(), at.toArray()]} color="#d946ef" lineWidth={1.5} raycast={() => null} />
            <Html position={tapeGuide.linePoint.clone().lerp(at, 0.5).toArray()} center occlude={false}>
              <div className="bg-black/80 text-white text-xs font-medium px-2 py-1 rounded whitespace-nowrap shadow-lg border border-cyan-500/50 pointer-events-none">
                {formatValue(tapeGuide.offset.length(), unit, 2)}
              </div>
            </Html>
          </group>
        );
      })()}
      {/* Section tool: where a click would place a plane */}
      {activeTool === 'section' && sectionHover && <SectionPlaneMesh args={sectionHover} preview />}
      {/* Follow Me: the path under the pointer, and the sweep it would make */}
      {activeTool === 'followme' && followMeHover && (
        <group>
          <Line segments points={followMeHover.pathSegments.flat()} color="#d946ef" lineWidth={4} depthTest={false} renderOrder={20} raycast={() => null} />
          {followMeHover.preview && followMeHover.preview.length > 0 && (
            <Line segments points={followMeHover.preview.flat()} color="#0891b2" lineWidth={1.5} depthTest={false} renderOrder={19} raycast={() => null} />
          )}
        </group>
      )}
      {/* Arc: the chord, and the arc it will make (cyan when tangent, pink when it rounds a corner) */}
      {activeTool === 'arc' && arcState && arcState.p0 && (() => {
        const p0 = arcState.p0!;
        const end = arcState.p1 ?? arcState.cursor;
        const color = arcFilletChosenRef.current ? '#d946ef' : arcState.tangentActive ? '#06b6d4' : '#22c55e';
        const spec = arcState.preview;
        const pts: [number, number, number][] = [];
        if (spec) {
          const n = Math.max(8, spec.segments * 2);
          for (let i = 0; i <= n; i++) { const q = arcPointAt(spec, i / n); pts.push([q.x, q.y, q.z]); }
        }
        return (
          <group>
            {end && <Line points={[[p0.x, p0.y, p0.z], [end.x, end.y, end.z]]} color="#38bdf8" lineWidth={1.5} dashed dashSize={0.2} gapSize={0.15} depthTest={false} raycast={() => null} />}
            {pts.length > 1 && <Line points={pts} color={color} lineWidth={3.5} depthTest={false} renderOrder={19} raycast={() => null} />}
            <mesh position={[p0.x, p0.y, p0.z]}><sphereGeometry args={[0.06, 16, 16]} /><meshBasicMaterial color={color} /></mesh>
            {arcState.p1 && <mesh position={[arcState.p1.x, arcState.p1.y, arcState.p1.z]}><sphereGeometry args={[0.06, 16, 16]} /><meshBasicMaterial color={color} /></mesh>}
            {/* The corners this start could round: put the other end on a pink point */}
            {arcState.phase === 'first' && arcFilletRef.current.map((t, i) => (
              <mesh key={i} position={t.end.toArray()}><sphereGeometry args={[0.07, 16, 16]} /><meshBasicMaterial color="#d946ef" /></mesh>
            ))}
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

      {/* Bézier Curve Drawing Preview */}
      {activeTool === 'bezier' && bezierKnots.length > 0 && (() => {
        const completedCurve = bezierKnots.length >= 2
          ? tessellateEntireCurve(bezierKnots, false, bezierResolution)
          : [];

        const lastKnot = bezierKnots[bezierKnots.length - 1];
        let candidateSpanPts: THREE.Vector3[] = [];
        if (bezierCandidatePos && !isDraggingBezierHandle && lastKnot) {
          const tempTargetKnot: BezierKnot = {
            point: bezierCandidatePos.clone(),
            handleIn: null,
            handleOut: null,
            mode: 'mirrored'
          };
          candidateSpanPts = tessellateBezierSpan(lastKnot, tempTargetKnot, bezierResolution);
        }

        let closingSpanPts: THREE.Vector3[] = [];
        if (bezierKnots.length >= 2 && bezierCandidatePos && bezierHoveredKnotIndex === 0) {
          const firstKnot = bezierKnots[0];
          closingSpanPts = tessellateBezierSpan(lastKnot, firstKnot, bezierResolution);
        }

        return (
          <group>
            {/* Completed Curve Spans */}
            {completedCurve.length >= 2 && (
              <Line
                points={completedCurve.map(p => [p.x, p.y, p.z])}
                color="#0063A3"
                lineWidth={3.5}
              />
            )}

            {/* Live Candidate Span */}
            {candidateSpanPts.length >= 2 && (
              <Line
                points={candidateSpanPts.map(p => [p.x, p.y, p.z])}
                color={bezierHoveredKnotIndex === 0 ? '#FFD700' : '#0284c7'}
                lineWidth={2.5}
                dashed={true}
                dashSize={0.15}
                gapSize={0.08}
              />
            )}

            {/* Ghost Loop Closure Span */}
            {closingSpanPts.length >= 2 && (
              <Line
                points={closingSpanPts.map(p => [p.x, p.y, p.z])}
                color="#FFD700"
                lineWidth={4}
              />
            )}

            {/* Knots & Tangent Handles */}
            {bezierKnots.map((knot, kIdx) => (
              <group key={kIdx}>
                {/* Anchor Node */}
                <mesh position={knot.point}>
                  <boxGeometry args={[kIdx === 0 && bezierHoveredKnotIndex === 0 ? 0.12 : 0.08, kIdx === 0 && bezierHoveredKnotIndex === 0 ? 0.12 : 0.08, kIdx === 0 && bezierHoveredKnotIndex === 0 ? 0.12 : 0.08]} />
                  <meshBasicMaterial color={kIdx === 0 && bezierHoveredKnotIndex === 0 ? '#FFD700' : '#0063A3'} />
                </mesh>

                {/* Tangent Handle Out */}
                {knot.handleOut && (
                  <group>
                    <Line
                      points={[[knot.point.x, knot.point.y, knot.point.z], [knot.handleOut.x, knot.handleOut.y, knot.handleOut.z]]}
                      color={knot.mode === 'broken' ? '#f59e0b' : '#38bdf8'}
                      lineWidth={2}
                    />
                    <mesh position={knot.handleOut}>
                      <sphereGeometry args={[0.045, 16, 16]} />
                      <meshBasicMaterial color={knot.mode === 'broken' ? '#f59e0b' : '#38bdf8'} />
                    </mesh>
                  </group>
                )}

                {/* Tangent Handle In */}
                {knot.handleIn && (
                  <group>
                    <Line
                      points={[[knot.point.x, knot.point.y, knot.point.z], [knot.handleIn.x, knot.handleIn.y, knot.handleIn.z]]}
                      color={knot.mode === 'broken' ? '#f59e0b' : '#38bdf8'}
                      lineWidth={2}
                    />
                    <mesh position={knot.handleIn}>
                      <sphereGeometry args={[0.045, 16, 16]} />
                      <meshBasicMaterial color={knot.mode === 'broken' ? '#f59e0b' : '#38bdf8'} />
                    </mesh>
                  </group>
                )}
              </group>
            ))}
          </group>
        );
      })()}

      {/* Wall Drawing Preview (Poly-style continuous 3D wall placement) */}
      {activeTool === 'wall' && wallVertices.length > 0 && (
        <group>
          {/* Active 3D Wall Box Preview */}
          {wallCandidatePos && (() => {
            const lastV = wallVertices[wallVertices.length - 1];
            const dist = lastV.distanceTo(wallCandidatePos);
            if (dist < 0.05) return null;
            const wallH = wallToolSettings?.height || 2.8;
            const wallT = wallToolSettings?.thickness || 0.2;
            const dir = new THREE.Vector3().subVectors(wallCandidatePos, lastV);
            const angle = Math.atan2(dir.z, dir.x);
            const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angle);

            // Compute justification offset
            const normal = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
            let offsetScalar = 0;
            if (wallJustification === 'exterior') {
              offsetScalar = wallT / 2;
            } else if (wallJustification === 'interior') {
              offsetScalar = -wallT / 2;
            }

            const center = lastV.clone().lerp(wallCandidatePos, 0.5);
            center.add(normal.clone().multiplyScalar(offsetScalar));
            center.y = Math.max(lastV.y, wallCandidatePos.y) + wallH / 2;

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
                  color={wallHoveredVertex === 0 ? "#22c55e" : "#3b82f6"}
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
              color={wallHoveredVertex === 0 ? "#22c55e" : "#94a3b8"}
              lineWidth={wallHoveredVertex === 0 ? 4 : 1.5}
              dashed={wallHoveredVertex !== 0}
              dashSize={0.15}
              gapSize={0.08}
            />
          )}

          {/* Start Node Beacon Ring & Badge when ready to close loop */}
          {wallVertices.length >= 2 && (
            <group position={[wallVertices[0].x, wallVertices[0].y, wallVertices[0].z]}>
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
                <ringGeometry args={[0.2, 0.38, 32]} />
                <meshBasicMaterial 
                  color={wallHoveredVertex === 0 ? "#0063A3" : "#0284c7"} 
                  side={THREE.DoubleSide} 
                  transparent 
                  opacity={wallHoveredVertex === 0 ? 0.95 : 0.45} 
                />
              </mesh>
              {wallHoveredVertex === 0 && (
                <Html position={[0, 0.45, 0]} center occlude={false}>
                  <div 
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      closeWallLoopAndAssembleRoom();
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeWallLoopAndAssembleRoom();
                    }}
                    className="px-2.5 py-1 rounded-full text-[10px] font-bold shadow-xl flex items-center gap-1.5 border border-sky-300 ring-2 ring-sky-200 cursor-pointer whitespace-nowrap transition-all transform hover:scale-105 bg-polyform-blue text-white select-none"
                    title="Click to Close Room & Assemble Floor Slab (or press C / Enter)"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                    <span>Close Room</span>
                    <span className="opacity-85 font-mono text-[9px] bg-white/20 px-1 py-0.2 rounded">C / ↵</span>
                  </div>
                </Html>
              )}
            </group>
          )}

          {/* Corner Node Markers */}
          {wallVertices.map((v, i) => (
            <mesh key={i} position={[v.x, v.y + 0.05, v.z]}>
              <cylinderGeometry args={[i === 0 ? 0.10 : 0.06, i === 0 ? 0.10 : 0.06, 0.1, 16]} />
              <meshBasicMaterial color={i === 0 ? (wallHoveredVertex === 0 ? "#22c55e" : "#f59e0b") : "#3b82f6"} />
            </mesh>
          ))}
        </group>
      )}

      {activeTool === 'protractor' && (
        <ProtractorTool onCommit={args => {
          addShape({ id: Math.random().toString(36).substr(2, 9), name: `Protractor ${Math.abs(args.angle).toFixed(1)}°`, type: 'measurement',
            position: args.centre, args, color: '#0ea5e9' } as Shape);
          commitHistory();
          setMeasurements(`Angle: ${Math.abs(args.angle).toFixed(1)}° · guide line placed`);
        }} />
      )}

      {activeTool === 'patio' && patioToolSettings.kind !== 'balcony' && (
        <PatioDrawTool groundAt={patioDrawnGround} onCommit={commitPatio} paused={patioToolSettings.placingSteps} />
      )}
      {activeTool === 'patio' && patioToolSettings.kind === 'balcony' && (
        <BalconyPlaceTool onCommit={commitBalcony} juliet={(patioToolSettings.template.balcony ?? DEFAULT_BALCONY).support === 'juliet'}
          depth={patioToolSettings.balconyDepth} margin={patioToolSettings.balconyMargin}
          front={patioToolSettings.template.balcony?.front ?? 'curve'} />
      )}

      {activeTool === 'site_route' && (
        <RouteDrawPreview shapes={shapes} vertices={fenceVertices} candidate={fenceCandidatePos} groundAt={waterPreviewGround} />
      )}

      {/* Fence / Railing Path Drawing Preview */}
      {activeTool === 'water' && (
        <WaterDrawPreview vertices={fenceVertices} candidate={fenceCandidatePos} closing={fenceHoveredVertex === 0} groundAt={waterPreviewGround} />
      )}
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

      {/* PolyForm Terrain Studio - Civil Overlays */}
      <CutFillVolumeOverlay />
      <RoadSplineOverlay />
      <ParametricPadOverlay />
      <BlockPickerOverlay />

      {postprocessingActive && (
        // autoClear is normally left at its default (true); GodRays specifically
        // needs it off - it renders an extra internal occlusion pass, and without
        // this, occlusion by scene geometry looks wrong (see the console warning
        // @react-three/postprocessing's own GodRays logs if this is missing).
        <EffectComposer autoClear={!godRaysEnabled}>
          {ambientOcclusionEnabled && (
            // N8AO (GTAO-style) instead of the older SSAO effect: SSAO's fixed
            // world-space sample radius caused halo/self-occlusion artifacts that
            // changed with camera distance and object scale. screenSpaceRadius
            // scales the radius in screen space instead, so contact shadows stay
            // consistent whether the user is zoomed into a doorknob or looking at
            // a whole building - this is what actually fixes the reported artifacts.
            <N8AO
              aoRadius={1}
              distanceFalloff={1}
              intensity={3}
              screenSpaceRadius
              quality="medium"
            />
          )}
          {fogPostprocessingActive && (
            <FogEffect 
              settings={fogSettings} 
              camera={camera}
              sunPosition={lightPosition}
              sunIntensity={sunIntensity}
            />
          )}
          {godRaysEnabled && (
            <GodRays
              sun={sunMeshRef}
              density={0.85}
              decay={0.9}
              weight={0.4 * godRaysIntensity}
              exposure={0.5 * godRaysIntensity}
              clampMax={1}
              blur
              samples={60}
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
    theme,
    environment,
  } = useApp();
  const { gl, scene } = useThree();
  const { assets: environmentAssets } = useAssetCatalog('hdri');
  const managerRef = useRef<EnvironmentManager | null>(null);

  useEffect(() => {
    const manager = new EnvironmentManager(gl);
    managerRef.current = manager;
    return () => {
      manager.dispose();
      managerRef.current = null;
    };
  }, [gl]);

  useEffect(() => {
    const manager = managerRef.current;
    if (!manager) return;
    if (!environment.ref) {
      void manager.apply(scene, environment, null);
      return;
    }
    const controller = new AbortController();
    const summary = environmentAssets.find(asset => asset.id === environment.ref?.assetId);
    if (summary && summary.revision === environment.ref.revision) {
      void loadAssetManifest(summary, controller.signal).then(manifest => {
        const tier = chooseTier(manifest, environment.quality);
        const variant = manifest.tiers[tier]?.environment ?? null;
        return manager.apply(scene, environment, variant);
      }).catch(() => false);
    }
    return () => controller.abort();
  }, [environment, environmentAssets, scene]);

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
  
  const snowyMap = useMemo(() => {
    if (skybox === 'snowy') {
      return getSnowyEnvironmentTexture();
    }
    return null;
  }, [skybox]);

  if (environment.ref) return <hemisphereLight intensity={0.25} groundColor="#444444" />;

  if (skybox === 'none' || !isHDRSupported) {
    return (
      <>
        {skybox === 'none' ? <color attach="background" args={[theme === 'light' ? '#e5e5e5' : '#2B2B2B']} /> : null}
        <hemisphereLight intensity={0.5} groundColor="#444444" />
      </>
    );
  }

  if (skybox === 'snowy' && snowyMap) {
    return (
      <Environment 
        map={snowyMap}
        background 
        blur={skyboxBlur}
      />
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

    // Guards the async TextureLoader callback below: if light.map/mode
    // changes again before a load resolves, this run's callback must not
    // overwrite whatever a LATER run already set - without this, two
    // loads racing (e.g. the user picks two images in quick succession)
    // let whichever happens to resolve last win, regardless of which one
    // is actually still selected.
    let cancelled = false;
    let createdVideo: HTMLVideoElement | null = null;

    if (light.projectorMode === 'texture' && light.map) {
      setError(false);
      const loader = new THREE.TextureLoader();
      loader.crossOrigin = 'anonymous';
      loader.load(
        light.map,
        (tex) => {
          if (cancelled) {
            // Superseded by a newer map/mode change before this resolved.
            tex.dispose();
            return;
          }
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
          if (cancelled) return;
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
        createdVideo = video;
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

    // Disposes whatever THIS run created, on the next map/mode change or
    // unmount - without it, switching a projector light's image or video
    // (or clearing it) left the previous texture/video decoding and
    // holding GPU/network resources indefinitely, since neither
    // setTexture/setVideoTexture nor a plain state overwrite ever called
    // .dispose() on what they replaced.
    return () => {
      cancelled = true;
      textureRef.current?.dispose();
      videoTextureRef.current?.dispose();
      if (createdVideo) {
        createdVideo.pause();
        createdVideo.removeAttribute('src');
        createdVideo.load();
      }
    };
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
  const lightTarget = useMemo(() => {
    const target = new THREE.Object3D();
    target.position.set(...(light.target ?? [0, 0, 0]));
    target.updateMatrixWorld(true);
    return target;
  }, [light.target?.[0], light.target?.[1], light.target?.[2]]);

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
          target={lightTarget}
        />
      )}
      {light.type === 'spot' && (
        <spotLight 
          position={(isDragging && selectedLightId === light.id) ? undefined : light.position} 
          color={baseColor} 
          intensity={light.intensity * (light.scale || 1)} 
          castShadow={shadowsEnabled}
          target={lightTarget}
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

function PolyGeometry({ vertices, height = 0, bevelAmount = 0, bevelSegments = 4, bevelType = 'radius', uprightY = false, holes = undefined }: { vertices: [number, number][], height?: number, bevelAmount?: number, bevelSegments?: number, bevelType?: 'radius' | 'chamfer', uprightY?: boolean, holes?: [number, number][][] }) {
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
        // three.js's own multi-segment bevel already interpolates each ring via
        // cos/sin (a genuine quarter-circle profile), so a high segment count IS a
        // rounded "radius" bevel for free. A true "chamfer" is a single flat angled
        // cut - one segment, no curve - which is why forcing segments=1 here is the
        // whole fix, not a new bevel algorithm.
        const effectiveBevelSegments = bevelType === 'chamfer' ? 1 : Math.max(4, bevelSegments);
        const geo = new THREE.ExtrudeGeometry(shape, {
          depth: height,
          bevelEnabled: safeBevel > 0,
          bevelThickness: safeBevel,
          bevelSize: safeBevel,
          bevelSegments: effectiveBevelSegments,
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
  }, [vertices, height, bevelAmount, bevelSegments, bevelType, uprightY, holes]);

  useEffect(() => {
    return () => {
      if (geometry) geometry.dispose();
    };
  }, [geometry]);

  return <primitive object={geometry} attach="geometry" />;
}

function CustomGeometry({ shape }: { shape: Shape }) {
  const { shapes } = useApp();

  // The roof-cutout CSG branch below needs to know about hosted Velux
  // windows, but depending on the whole `shapes` array (as this memo used
  // to) reran that CSG evaluation for EVERY roof on EVERY shape edit
  // anywhere in the scene - moving an unrelated box triggered the same
  // Evaluator/Brush work as actually moving a hosted window. This
  // fingerprint changes only when a window relevant to THIS shape
  // actually changes, so it can be used as the memo's real dependency
  // instead of the raw array.
  const hostedWindowsFingerprint = useMemo(() => {
    if (!shapes || shapes.length === 0) return '';
    const hosted = shapes.filter(s =>
      s.type === 'window' && !s.hidden &&
      (s.hostWallId ? s.hostWallId === shape.id : (s.archStyle === 'velux-roof' || s.name?.toLowerCase().includes('velux')))
    );
    if (hosted.length === 0) return '';
    return JSON.stringify(hosted.map(w => [w.id, w.position, w.quaternion, w.rotation, w.args]));
  }, [shapes, shape.id]);

  // Dormers open up the roof they sit on: the roof itself, and its tiles, fascias and soffits.
  // Like the windows above, only a change to this roof's dormers reruns the cut.
  const dormerRoof = useMemo(() => {
    if (shape.tags?.includes('roof-extra') || shape.tags?.includes('roof-deck')) return undefined;
    if (shape.roofData?.extras) return shape;
    const parent = shape.parentShapeId ? shapes.find(s => s.id === shape.parentShapeId) : undefined;
    return parent?.roofData?.extras ? parent : undefined;
  }, [shapes, shape]);
  const dormerRoofRef = useRef(dormerRoof);
  dormerRoofRef.current = dormerRoof;
  const dormerKey = useMemo(() => dormerFingerprint(dormerRoof), [dormerRoof]);

  const geometry = useMemo(() => {
    const withDormers = (g: THREE.BufferGeometry): THREE.BufferGeometry => {
      const roof = dormerRoofRef.current;
      if (!dormerKey || !roof) return g;
      try {
        const layouts = layoutsOf(roof);
        if (!layouts.length) return g;
        const tiles = !!shape.tags?.includes('roof-tiles');
        const offset = new THREE.Vector3(...shape.position).sub(new THREE.Vector3(...roof.position));
        return cutForDormers(tiles ? g : mergeVertices(g), layouts, offset, tiles ? 'tiles' : 'solid', { Brush, Evaluator, SUBTRACTION });
      } catch (err) {
        console.warn('Dormer roof cut-out error:', err);
        return g;
      }
    };
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

    // 2. Custom JSON BufferGeometry or Raw Positions/Normals (e.g. Roofs)
    if (shape.geometryData) {
      let baseGeo: THREE.BufferGeometry | null = null;
      if (Array.isArray(shape.geometryData.positions) && shape.geometryData.positions.length > 0) {
        baseGeo = new THREE.BufferGeometry();
        baseGeo.setAttribute('position', new THREE.Float32BufferAttribute(shape.geometryData.positions, 3));
        if (Array.isArray(shape.geometryData.normals) && shape.geometryData.normals.length > 0) {
          baseGeo.setAttribute('normal', new THREE.Float32BufferAttribute(shape.geometryData.normals, 3));
        } else {
          baseGeo.computeVertexNormals();
        }
        if (Array.isArray(shape.geometryData.uvs) && shape.geometryData.uvs.length > 0) {
          baseGeo.setAttribute('uv', new THREE.Float32BufferAttribute(shape.geometryData.uvs, 2));
        }
        if (Array.isArray(shape.geometryData.colors) && shape.geometryData.colors.length > 0) {
          baseGeo.setAttribute('color', new THREE.Float32BufferAttribute(shape.geometryData.colors, 3));
        }
        if (Array.isArray(shape.geometryData.indices) && shape.geometryData.indices.length > 0) {
          baseGeo.setIndex(shape.geometryData.indices);
        }
      } else {
        try {
          const loader = new THREE.BufferGeometryLoader();
          baseGeo = loader.parse(shape.geometryData);
        } catch (err) {
          console.warn('Error parsing custom geometryData:', err);
        }
      }

      if (baseGeo) {
        // Cut rectangular apertures for any hosted Velux roof windows/skylights
        const isRoof = shape.tags?.some((t: string) => t.includes('roof')) || shape.name?.toLowerCase().includes('roof');
        if (isRoof && shapes && shapes.length > 0) {
          const hostedWindows = shapes.filter(s =>
            s.type === 'window' && !s.hidden &&
            (s.hostWallId ? s.hostWallId === shape.id : (s.archStyle === 'velux-roof' || s.name?.toLowerCase().includes('velux')))
          );

          if (hostedWindows.length > 0) {
            try {
              let currentBrush = new Brush(mergeVertices(baseGeo.clone()));
              currentBrush.updateMatrixWorld();
              const evaluator = new Evaluator();

              const roofPos = new THREE.Vector3(...shape.position);
              const roofQuat = shape.quaternion 
                ? new THREE.Quaternion(...shape.quaternion) 
                : new THREE.Quaternion().setFromEuler(new THREE.Euler(...(shape.rotation || [0, 0, 0])));
              const invRoofQuat = roofQuat.clone().invert();

              let cutsApplied = 0;
              for (const win of hostedWindows) {
                const winPos = new THREE.Vector3(...win.position);
                const winQuat = win.quaternion
                  ? new THREE.Quaternion(...win.quaternion)
                  : new THREE.Quaternion().setFromEuler(new THREE.Euler(...(win.rotation || [0, 0, 0])));
                const winArgs = Array.isArray(win.args) ? win.args : [1.2, 1.2, 0.4];
                const winW = Math.max(0.4, (winArgs[0] || 1.2) * 0.95);
                const winH = Math.max(0.4, (winArgs[1] || 1.2) * 0.95);
                const winD = Math.max(0.8, (winArgs[2] || 0.4) * 4.0);

                const relPos = winPos.clone().sub(roofPos).applyQuaternion(invRoofQuat);
                const relQuat = invRoofQuat.clone().multiply(winQuat);

                // A round porthole needs a round hole - a box cutter (used
                // for every other style) leaves a rectangular reveal around
                // the ring, exposing the host's raw material in the corners
                // instead of a flush fit (the same issue already fixed for
                // portholes hosted on ordinary walls, which use a separate
                // code path from this roof/pediment cutout).
                let cutterGeo: THREE.BufferGeometry;
                if (win.archStyle === 'porthole') {
                  const radius = Math.min(winArgs[0] || 0.8, winArgs[1] || 0.8) / 2;
                  cutterGeo = new THREE.CylinderGeometry(radius, radius, winD, 48);
                  cutterGeo.rotateX(Math.PI / 2);
                } else {
                  cutterGeo = new THREE.BoxGeometry(winW, winH, winD);
                }
                cutterGeo.applyQuaternion(relQuat);
                cutterGeo.translate(relPos.x, relPos.y, relPos.z);

                const cutterBrush = new Brush(cutterGeo);
                cutterBrush.updateMatrixWorld();

                const result = evaluator.evaluate(currentBrush, cutterBrush, SUBTRACTION);
                if (result && result.geometry) {
                  currentBrush = result;
                  cutsApplied++;
                }
              }

              if (cutsApplied > 0 && currentBrush.geometry) {
                const cutGeom = mergeVertices(currentBrush.geometry);
                cutGeom.computeVertexNormals();
                return withDormers(cutGeom);
              }
            } catch (csgErr) {
              console.warn('Velux roof window cutout error:', csgErr);
            }
          }
        }
        return withDormers(baseGeo);
      }
    }

    // Fallback
    return new THREE.BoxGeometry(1, 1, 1);
  }, [shape.args, shape.geometryData, shape.position, shape.quaternion, shape.rotation, shape.id, hostedWindowsFingerprint, dormerKey]);

  useEffect(() => {
    return () => {
      if (geometry) geometry.dispose();
    };
  }, [geometry]);

  return <primitive object={geometry} attach="geometry" />;
}

function TerrainGeometry({ terrainData, footprints, footprintsKey = '' }: { terrainData?: any; footprints?: [number, number][][]; footprintsKey?: string }) {
  const geometry = useMemo(() => {
    if (!terrainData || !terrainData.heights) {
      return new THREE.PlaneGeometry(20, 20, 32, 32);
    }
    const { gridX, gridY, width, depth, heights, shadingMode } = terrainData;
    const geo = new THREE.PlaneGeometry(width, depth, gridX - 1, gridY - 1);
    geo.rotateX(-Math.PI / 2); // Orient horizontally in XZ plane with Y as elevation

    const pos = geo.attributes.position;
    if (pos) {
      for (let i = 0; i < pos.count; i++) {
        if (heights[i] !== undefined) {
          pos.setY(i, heights[i]);
        }
      }
      pos.needsUpdate = true;
    }
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
    if (shadingMode && shadingMode !== 'default' && pos) {
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

    // No ground inside a building: cut away under ground-floor slabs.
    if (footprints && footprints.length) {
      const cut = cutTerrainUnderFootprints(geo, footprints);
      if (cut !== geo) { geo.dispose(); return cut; }
    }
    return geo;
  // Only fields that shape the mesh: grass and wildflower edits must not rebuild the terrain.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...terrainGeometryDeps(terrainData), footprintsKey]);

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
    activeMaterialBindingId,
    activeSurfaceDepth,
    setShapes, 
    addShape,
    duplicateObject,
    commitHistory,
    commitUpdatedFraming,
    setMeasurements,
    viewportToast,
    selectionShapeMode,
    setSelectionShapeMode,
    selectionFilter,
    setSelectionFilter,
    selectionCriteria,
    setSelectionCriteria,
    selectedFaceIds,
    placingNotePos,
    setPlacingNotePos,
    setNotes,
    user,
    kernelHost,
    bumpKernel,
    setSelectedFaceIds,
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
    unit,
    wallToolSettings,
    setWallToolSettings,
    wallJustification,
    setWallJustification,
    activeStory,
    setActiveStory,
    isToolModifierDocked,
    setIsToolModifierDocked,
    setActiveTool,
    kernelRevision,
    registerWallConversionUndo,
    enterGroupEdit,
    exitGroupEdit,
    groupEdit,
  } = useApp();
  // Local to Viewport() now, alongside the dialog itself (moved from
  // Scene() — see AppContext.tsx's own doc comment on `placingNotePos`).
  const noteTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [styleLibraryTargetId, setStyleLibraryTargetId] = useState<string | null>(null);
  const [lampStyleTargetId, setLampStyleTargetId] = useState<string | null>(null);
  // objectInfoTarget lives HERE, in the outer Viewport() component, not in
  // Scene(): the button that sets it (the kernel context menu's "View
  // Object Information") and the modal that displays it are BOTH rendered
  // from Viewport()'s own return — a state declared inside the separate
  // Scene() function is invisible here, a plain JS scoping fact, not a
  // React quirk. Getting this backwards is exactly what crashed the app
  // outright ("objectInfoTarget is not defined") rather than merely
  // rendering wrong — a ReferenceError, not a warning, because the two
  // are genuinely different functions with no shared scope at all.
  const [objectInfoTarget, setObjectInfoTarget] = useState<ObjectInfoSummary | null>(null);
  // Same scoping rule as objectInfoTarget just above (see its own comment):
  // this lives in Viewport(), not Scene(), because the modal that reads it
  // is rendered from here.
  const [divideSurfaceTarget, setDivideSurfaceTarget] = useState<FaceId | null>(null);
  // Convert To Wall: the plan is worked out when the kernel context menu
  // opens, so the menu only offers it when the shape actually qualifies,
  // and the dialog then confirms it (and asks for a height when the ring
  // has not been pulled up yet).
  const wallConversion = useMemo(() => {
    if (!contextMenu || contextMenu.type !== 'kernel' || contextMenu.faceId === undefined) return null;
    const result = analyzeWallConversion(kernelHost.graph, contextMenu.faceId, contextMenu.data);
    // Nothing ring-like at all: keep the menu free of the option.
    return result.ok || (result as WallConversionRejection).nearMiss ? result : null;
    // kernelRevision: the graph is mutated in place.
  }, [contextMenu, kernelHost, kernelRevision]);
  const [convertWallPlan, setConvertWallPlan] = useState<WallConversionPlan | null>(null);
  // Combine tool: the chosen operation, applied to the shapes and objects clicked (in order).
  // Flat drawn shapes combine into a flat shape; 3D objects (and pulled-up shapes) combine as solids.
  const [combineMode, setCombineMode] = useState<BooleanOp>('merge');
  const combinePicks = useCombinePicks();
  const combineResolved = useMemo((): CombineSolid[] => {
    if (activeTool !== 'combine') return [];
    const out: CombineSolid[] = [];
    for (const p of combinePicks) {
      if (p.kind === 'kernel') {
        if (kernelHost.graph.faces.has(p.face)) out.push({ kind: 'kernel', faces: groupContaining(kernelHost.graph, p.face) });
      } else if (shapes.some(s => s.id === p.id)) out.push(p);
    }
    return out;
    // kernelRevision: the graph is mutated in place.
  }, [activeTool, combinePicks, kernelHost, kernelRevision, shapes]);
  const combineFlat = combineResolved.length > 0 && combineResolved.every(p => p.kind === 'kernel' && isFlatShape(kernelHost.graph, p.faces));
  const combineGroups = useMemo(
    () => combineFlat ? combineResolved.map(p => (p as { faces: FaceId[] }).faces) : [],
    [combineFlat, combineResolved],
  );
  // Highlight the picks.
  useEffect(() => {
    if (activeTool !== 'combine') return;
    setSelectedFaceIds(combineResolved.flatMap(p => p.kind === 'kernel' ? p.faces : []));
    setSelectedIds(combineResolved.flatMap(p => p.kind === 'shape' ? [p.id] : []));
    setSelectedId(null);
  }, [activeTool, combineResolved, setSelectedFaceIds, setSelectedIds, setSelectedId]);
  useEffect(() => { if (activeTool !== 'combine') setCombinePicks([]); }, [activeTool]);
  // The old Subtract tool is now Combine's Subtract.
  useEffect(() => {
    if (activeTool === 'subtract') { setCombineMode('subtract'); setActiveTool('combine'); }
  }, [activeTool, setActiveTool]);
  const combinePlan = useMemo((): BooleanPlan | BooleanRejection | null => {
    if (combineResolved.length < 2) return null;
    if (combineFlat) return planBoolean(kernelHost.graph, combineGroups, combineMode);
    if (combineResolved.some(p => p.kind === 'kernel' && isFlatShape(kernelHost.graph, p.faces))) {
      return { ok: false, reason: 'Flat shapes combine only with other flat shapes. Pull a flat shape up first to combine it with 3D objects.' };
    }
    return null;
  }, [combineResolved, combineFlat, combineGroups, combineMode, kernelHost]);
  const combineReady = combineResolved.length >= 2 && (combineFlat ? !!combinePlan?.ok : !combinePlan);
  const applyCombine = useCallback(() => {
    if (!combineReady) return;
    if (!combineFlat) {
      window.dispatchEvent(new CustomEvent(COMBINE_SOLIDS_EVENT, { detail: { picks: combineResolved, op: combineMode } }));
      return;
    }
    if (!combinePlan || !combinePlan.ok) return;
    let faces: FaceId[] = [];
    kernelHost.transact(() => {
      faces = applyBoolean({ graph: kernelHost.graph, tolerances: kernelHost.tolerances, index: kernelHost.spatialIndex }, combinePlan as BooleanPlan, kernelHost.deriveOptions);
      return true;
    });
    kernelHost.refreshIndex();
    bumpKernel();
    setCombinePicks(faces.length ? [{ kind: 'kernel', face: faces[0] }] : []);
    setMeasurements(`${BOOLEAN_LABELS[combineMode]}: done.`);
  }, [combineReady, combineFlat, combineResolved, combinePlan, combineMode, kernelHost, bumpKernel, setMeasurements]);
  useEffect(() => {
    if (activeTool !== 'combine') return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'Enter') { e.preventDefault(); applyCombine(); }
      else if (e.key === 'Escape') setCombinePicks([]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTool, applyCombine]);
  const [convertWallHeight, setConvertWallHeight] = useState('2.4');
  const [convertWallThickness, setConvertWallThickness] = useState('200');
  const [convertWallSlab, setConvertWallSlab] = useState(true);
  /**
   * "Snap To Building" for a patio or deck: edges drawn a little short of (or
   * past) a wall, fence or another patio are pulled onto it, closing the gaps
   * a hand-traced outline can leave.
   */
  // ---------------------------------------------------------------------------
  // Groups and components (tools/kernelGroups.ts): right-click menu entries.
  // ---------------------------------------------------------------------------
  const menuButton = cn(
    "w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors",
    theme === 'dark' ? "hover:bg-gray-700" : "hover:bg-gray-100",
  );

  /** Drawn faces -> one object (a group, or the first copy of a new component). */
  const makeKernelGroup = (faceIds: number[], component: boolean) => {
    const count = shapes.filter(s => s.type === 'kernel_group' && (component ? !!s.componentId : !s.componentId)).length;
    const made = makeGroup(kernelHost, faceIds as FaceId[], { component, name: `${component ? 'Component' : 'Group'} ${count + 1}` });
    if (!made) return;
    registerWallConversionUndo(made.link);
    setShapes(prev => [...prev, made.shape]);
    setSelectedFaceIds([]);
    setSelectedId(made.shape.id);
    setSelectedIds([made.shape.id]);
    bumpKernel();
    recordAction(actionLabel(component ? 'Make Component' : 'Make Group'));
    setMeasurements(`${made.shape.name}: move, copy and tag it as one object. Double-click it to edit inside.`);
  };

  const kernelGroupMenuItems = (faceIds: number[]) => (
    <>
      <button className={menuButton} onClick={() => { makeKernelGroup(faceIds, false); setContextMenu(null); }}>
        Make Group
      </button>
      <button className={menuButton} onClick={() => { makeKernelGroup(faceIds, true); setContextMenu(null); }}>
        Make Component
      </button>
    </>
  );

  // The toolbar's Make Component button: the selected drawn faces become a component.
  const makeKernelGroupRef = useRef(makeKernelGroup);
  makeKernelGroupRef.current = makeKernelGroup;
  useEffect(() => {
    if (activeTool !== 'component') return;
    if (selectedFaceIds.length > 0) makeKernelGroupRef.current(selectedFaceIds, true);
    else setMeasurements('Make Component: select some drawn faces first (or right-click them > Make Component).');
    setActiveTool('select');
  }, [activeTool]); // eslint-disable-line react-hooks/exhaustive-deps

  const groupObjectMenuItems = (shapeId: string) => {
    const shape = shapes.find(s => s.id === shapeId);
    if (!shape || !isGroupShape(shape)) return null;
    const kind = shape.componentId ? 'Component' : 'Group';
    return (
      <>
        <button className={menuButton} onClick={() => { setContextMenu(null); enterGroupEdit(shape.id); }}>
          Edit {kind}
        </button>
        <button className={menuButton} onClick={() => {
          setContextMenu(null);
          const link = explodeGroup(kernelHost, shape);
          if (!link) return;
          registerWallConversionUndo(link);
          setShapes(prev => prev.filter(s => s.id !== shape.id));
          setSelectedId(null);
          setSelectedIds([]);
          bumpKernel();
          recordAction(actionLabel(`Explode ${shape.name ?? kind}`));
          setMeasurements(`${shape.name ?? kind} exploded back into drawn faces.`);
        }}>
          Explode
        </button>
        {shape.componentId ? (
          <button className={menuButton} onClick={() => {
            setContextMenu(null);
            setShapes(prev => prev.map(s => (s.id === shape.id ? makeUnique(s) : s)));
            recordAction(actionLabel('Make Unique'));
            setMeasurements('This copy is now its own component: editing it no longer changes the others.');
          }}>
            Make Unique
          </button>
        ) : (
          <button className={menuButton} onClick={() => {
            setContextMenu(null);
            setShapes(prev => prev.map(s => (s.id === shape.id ? { ...s, componentId: Math.random().toString(36).substr(2, 9), componentName: s.name ?? 'Component' } : s)));
            recordAction(actionLabel('Make Component'));
            setMeasurements('Now a component: copies you make of it share their inside.');
          }}>
            Make Component
          </button>
        )}
      </>
    );
  };

  const patioSnapMenuItem = (shapeId: string) => {
    const patio = shapes.find(s => s.id === shapeId);
    if (!patio || patio.type !== 'patio' || !patio.patioData || patio.patioData.kind === 'balcony') return null;
    const ground = patioGroundHelpers(shapes, new Map(), sampleTerrainElevation).originalGround;
    const result = snapPatioToBuilding(patio, shapes, ground);
    if (!result.shape) {
      return (
        <div className="w-full px-3 py-1.5 text-xs cursor-not-allowed" aria-disabled="true">
          <div className="text-gray-400">Snap To Building</div>
          <div className={cn("text-[10px] leading-snug mt-0.5 max-w-[220px]", theme === 'dark' ? "text-gray-500" : "text-gray-400")}>
            Nothing to snap: no edge is within 300 mm of (and not already on) a wall, fence or patio.
          </div>
        </div>
      );
    }
    const snapped = result.shape;
    return (
      <button
        onClick={() => {
          setShapes(prev => prev.map(s => s.id === patio.id ? snapped : s));
          setSelectedSurface(null);
          setMeasurements(`Snapped ${result.moved} edge${result.moved === 1 ? '' : 's'} of ${patio.name ?? 'the patio'} onto the building.`);
          setContextMenu(null);
        }}
        className={cn(
          "w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors",
          theme === 'dark' ? "hover:bg-gray-700" : "hover:bg-gray-100"
        )}
      >
        Snap To Building ({result.moved} edge{result.moved === 1 ? '' : 's'})
      </button>
    );
  };

  const curvedMergeMenuItems = (shapeId: string) => {
    // Curved pieces from Convert To Wall: a door or window sits on
    // one flat piece, so offer to merge neighbours into a flat
    // section wide enough for one.
    const piece = shapes.find(s => s.id === shapeId);
    if (!piece || !isCurvedPiece(piece)) return null;
    const pieceWidth = Array.isArray(piece.args) ? (piece.args[0] as number) : 0;
    const options = [
      { label: 'Merge Pieces For A Door', width: 1.1 },
      { label: 'Merge Pieces For A Window', width: 0.7 },
    ].filter(o => pieceWidth < o.width);
    return options.map(o => {
      const plan = planCurvedMerge(shapes, piece.id, o.width, () => Math.random().toString(36).substr(2, 9));
      if (!plan.ok) {
        return (
          <div key={o.label} className="w-full px-3 py-1.5 text-xs cursor-not-allowed" aria-disabled="true">
            <div className="text-gray-400">{o.label}</div>
            <div className={cn("text-[10px] leading-snug mt-0.5 max-w-[220px]", theme === 'dark' ? "text-gray-500" : "text-gray-400")}>
              {(plan as MergeRejection).reason}
            </div>
          </div>
        );
      }
      const merge = plan as MergeResult;
      return (
        <button
          key={o.label}
          onClick={() => {
            const removed = new Set(merge.removeIds);
            const moved = new Map(merge.rehosted.map(r => [r.id, r]));
            setShapes(prev => {
              const next: Shape[] = [];
              for (const s of prev) {
                if (s.id === piece.id) next.push(merge.merged);
                else if (!removed.has(s.id)) next.push(moved.get(s.id) ?? s);
              }
              return next;
            });
            setSelectedSurface(null);
            setSelectedIds([merge.merged.id]);
            setSelectedId(merge.merged.id);
            setMeasurements(`Merged ${merge.removeIds.length} curved pieces into one flat wall ${merge.width.toFixed(2)} m wide.`);
            setContextMenu(null);
          }}
          className={cn(
            "w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors",
            theme === 'dark' ? "hover:bg-gray-700" : "hover:bg-gray-100"
          )}
        >
          {o.label} ({merge.removeIds.length} pieces, {merge.width.toFixed(2)} m)
        </button>
      );
    });
  };

  /** The terrain under a conversion's walls, if any. */
  const convertTerrain = (plan: WallConversionPlan) => {
    const first = plan.pieces[0]!;
    return shapes.find(t => t.type === 'terrain' && !t.hidden && t.terrainData
      && Math.abs(first.start.x - t.position[0]) <= t.terrainData.width / 2
      && Math.abs(first.start.z - t.position[2]) <= t.terrainData.depth / 2) ?? null;
  };
  /** Storey from the height above the ground under the walls, as the Wall tool does. */
  const convertStorey = (plan: WallConversionPlan) => {
    const first = plan.pieces[0]!;
    const terrain = convertTerrain(plan);
    const groundY = terrain ? sampleTerrainElevation(first.start.x, first.start.z, terrain) : 0;
    return Math.max(1, Math.round((plan.baseY - groundY) / 2.8) + 1);
  };

  const convertToWalls = useCallback((plan: WallConversionPlan, height: number, withSlab = false) => {
    const g = kernelHost.graph;
    // The analysis may be stale if the geometry changed while the dialog was open.
    if (plan.sourceFaces.some(id => !g.faces.has(id))) {
      setMeasurements('Convert To Wall: the shape changed. Right-click it again.');
      return;
    }
    // With a slab, the drawn floor inside the walls is replaced by it.
    const floorFaces = withSlab ? floorFacesWithin(g, plan) : [];
    const before = snapshot(g);
    const removed = captureFaces(g, [...plan.sourceFaces, ...floorFaces]);
    deleteGroupFacesAndEdges(g, [...plan.sourceFaces, ...floorFaces]);
    kernelHost.refreshIndex();
    const after = snapshot(g);

    const story = convertStorey(plan);
    const terrain = convertTerrain(plan);

    // Floor slab and foundation as the Wall tool makes them: the slab's top is the finished
    // floor (levelled with the ground), and the walls stand on it.
    let assembly: ReturnType<typeof buildRoomAssembly> | null = null;
    if (withSlab) {
      const ring = outerRing(plan).map(p => new THREE.Vector3(p.x, plan.baseY, p.z));
      assembly = buildRoomAssembly(ring, terrain, wallToolSettings, { wallHeight: height, wallThickness: plan.thickness, story });
      plan = { ...plan, baseY: assembly.datumZ };
    }

    const walls = buildWallShapes(plan, {
      height,
      color: plan.color || activeMaterial || '#e2e8f0',
      story,
      pbr: activePBR,
      makeId: () => Math.random().toString(36).substr(2, 9),
      existingWallCount: shapes.filter(s => s.type === 'wall').length,
    });
    registerWallConversionUndo({
      wallIds: walls.map(w => w.id),
      before,
      after,
      beforeSig: graphSignature(before.graph),
      afterSig: graphSignature(g),
      removed,
    });
    setShapes(prev => {
      const next = [...prev, ...walls];
      if (assembly) {
        next.push(assembly.slabShape);
        if (assembly.foundationShape) next.push(assembly.foundationShape);
        if (assembly.updatedTerrainData && assembly.modifiedTerrainShapeId) {
          const id = assembly.modifiedTerrainShapeId, data = assembly.updatedTerrainData;
          return next.map(s => s.id === id ? { ...s, terrainData: data } : s);
        }
      }
      return next;
    });
    setSelectedFaceIds([]);
    setSelectedIds(walls.map(w => w.id));
    bumpKernel();
    setMeasurements(`Converted to ${walls.length} wall${walls.length === 1 ? '' : 's'} (${Math.round(plan.thickness * 1000)} mm thick, ${height.toFixed(2)} m high)${assembly ? ', with a floor slab and foundation' : ''}.`);
    recordAction(`// Convert To Wall: ${walls.length} walls, thickness ${plan.thickness.toFixed(3)}, height ${height.toFixed(2)}`);
  }, [kernelHost, shapes, activeMaterial, activePBR, wallToolSettings, registerWallConversionUndo, setShapes, setSelectedFaceIds, setSelectedIds, bumpKernel, setMeasurements, recordAction]);
  const [divideColumns, setDivideColumns] = useState(2);
  const [divideRows, setDivideRows] = useState(2);
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
        
        recordAction(actionLabel(`Divide face ${faceIdx} of ${s.id} into ${gridX} x ${gridY}`));

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
        detail: { position: defaultCameraPosition, target: defaultCameraTarget } 
      }));
    };
    window.addEventListener('reset-camera', handleReset);
    return () => window.removeEventListener('reset-camera', handleReset);
  }, [defaultCameraPosition, defaultCameraTarget]);

  // duplicateObject/duplicateMultiple now come from useApp() above —
  // moved into AppContext.tsx so this component and RightPanelStack's
  // own Outliner duplicate buttons share the exact same implementation
  // instead of two copies that had already drifted apart.

  return (
    <div id="polyform-viewport" className={cn(
      "flex-1 relative overflow-hidden transition-colors duration-300",
      theme === 'dark' ? "bg-gray-900" : "bg-[#f8f9fa]"
    )}>
      {/*
        Rendered directly here (no portal needed) precisely because this
        div IS already inside react-dom's own tree — see showToast's doc
        comment in Scene() for why the SAME render used to crash the whole
        app when it lived inside Scene() instead. position:fixed escapes
        this div's own overflow-hidden regardless, since nothing here sets
        a CSS transform that would otherwise contain it.
      */}
      {viewportToast && (
        <div
          className="fixed top-6 left-1/2 -translate-x-1/2 z-[1000] pointer-events-none"
          role="status"
          aria-live="polite"
        >
          <div className="bg-gray-900 text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-xl border border-gray-700 max-w-md text-center">
            {viewportToast}
          </div>
        </div>
      )}

      {/* Editing inside a group or component */}
      {groupEdit && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[999]">
          <div className="flex items-center gap-3 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg shadow-xl border border-gray-700">
            <span>Editing <strong>{groupEdit.name}</strong>{shapes.find(s => s.id === groupEdit.shapeId)?.componentId ? ' - every copy will change' : ''}</span>
            <button onClick={() => exitGroupEdit()} className="px-2 py-0.5 rounded bg-polyform-blue hover:opacity-90 text-xs font-medium">
              Close
            </button>
          </div>
        </div>
      )}

      {activeTool === 'walk' && <WalkModeOverlay />}
      {activeTool === 'look' && <LookModeOverlay />}

      <TextPlacementDialog />

      {placingNotePos && (
        // Rendered directly here — no portal needed, since this whole
        // function IS already inside react-dom's own tree. See
        // AppContext.tsx's own doc comment on `placingNotePos` for why
        // this can no longer live inside Scene().
        <div
          className="fixed inset-0 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm"
          style={{ zIndex: 1000 }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="New design note"
            className="w-[560px] max-w-[92vw] flex flex-col rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-[0_24px_60px_-12px_rgba(15,23,42,0.35)] overflow-hidden"
            onPointerDown={e => e.stopPropagation()}
            style={{ pointerEvents: 'auto' }}
          >
            <header className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-gray-200 dark:border-gray-800">
              <div className="flex items-start gap-3 min-w-0">
                <div className="shrink-0 w-10 h-10 rounded-xl bg-polyform-blue/10 text-polyform-blue flex items-center justify-center">
                  <StickyNote size={18} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-gray-900 dark:text-white">New design note</h2>
                  <p className="mt-0.5 text-xs leading-relaxed text-gray-600 dark:text-gray-400">
                    Describe your intent, or leave a comment for collaborators.
                  </p>
                </div>
              </div>
              <span className="shrink-0 text-[11px] font-medium tabular-nums px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                {placingNotePos.x.toFixed(2)}, {placingNotePos.y.toFixed(2)}, {placingNotePos.z.toFixed(2)}
              </span>
            </header>

            <div className="px-6 py-5">
              <label htmlFor="polyform-note-text" className="sr-only">Note text</label>
              <textarea
                id="polyform-note-text"
                autoFocus
                ref={noteTextareaRef}
                defaultValue=""
                placeholder="What should someone know about this part of the model?"
                className="w-full h-28 p-3 text-sm rounded-xl resize-none transition-colors bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 outline-none focus:border-polyform-blue focus:ring-1 focus:ring-polyform-blue/30"
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
                      recordAction(`sdk.addNote(${JSON.stringify(_noteText)}, ${sdkLiteral([placingNotePos.x, placingNotePos.y, placingNotePos.z])});`);
                    }
                    setPlacingNotePos(null);
                  }
                  if (e.key === 'Escape') setPlacingNotePos(null);
                }}
              />
            </div>

            <footer className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-950/30">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Enter to save · Esc to cancel
              </p>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={() => setPlacingNotePos(null)}>Cancel</Button>
                <Button
                  variant="primary"
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
                      recordAction(`sdk.addNote(${JSON.stringify(_noteText)}, ${sdkLiteral([placingNotePos.x, placingNotePos.y, placingNotePos.z])});`);
                    }
                    setPlacingNotePos(null);
                  }}
                >
                  Place note
                </Button>
              </div>
            </footer>
          </div>
        </div>
      )}

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
                              className="text-xs font-medium bg-transparent border-none outline-none focus:ring-1 focus:ring-polyform-blue rounded px-1 -ml-1"
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
                                      className="w-12 px-1 py-0.5 border rounded text-[10px] outline-none focus:border-polyform-blue"
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
                                      className="w-12 px-1 py-0.5 border rounded text-[10px] outline-none focus:border-polyform-blue"
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
                                      className="w-14 px-1 py-0.5 border rounded text-[10px] bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-polyform-blue outline-none"
                                    />
                                  ) : (
                                    <button 
                                      onClick={() => {
                                        setEditingPosIndex(idx);
                                        setPosValue(pos.toString());
                                      }}
                                      className="text-[10px] font-mono text-polyform-blue bg-polyform-blue/5 px-1.5 py-0.5 rounded border border-polyform-blue/10 hover:bg-polyform-blue/10 transition-colors"
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
                                        className="w-14 px-1 py-0.5 border rounded text-[10px] bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-polyform-blue outline-none"
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
                              className="text-[8px] text-polyform-blue hover:underline"
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
                if (shape && (shape.type === 'door' || shape.type === 'window' || shape.type === 'staircase' || shape.type === 'step' || shape.type === 'wall')) {
                  return (
                    <button 
                      onClick={() => {
                        setStyleLibraryTargetId(shape.id);
                        setContextMenu(null);
                      }}
                      className={cn(
                        "w-full text-left px-3 py-2 text-xs font-bold flex items-center gap-2 transition-colors border-b border-gray-100 dark:border-gray-800 text-polyform-blue",
                        theme === 'dark' ? "hover:bg-gray-700 bg-polyform-blue/10" : "hover:bg-gray-100 bg-polyform-blue/5"
                      )}
                    >
                      <Palette size={14} className="text-polyform-blue shrink-0" />
                      <span>Change Style...</span>
                    </button>
                  );
                }
                return null;
              })()}
              {(() => {
                const shape = shapes.find(sh => sh.id === contextMenu.data.shapeId);
                if (shape && shape.type === 'lamp') {
                  return (
                    <button
                      onClick={() => {
                        setLampStyleTargetId(shape.id);
                        setContextMenu(null);
                      }}
                      className={cn(
                        "w-full text-left px-3 py-2 text-xs font-bold flex items-center gap-2 transition-colors border-b border-gray-100 dark:border-gray-800 text-polyform-blue",
                        theme === 'dark' ? "hover:bg-gray-700 bg-polyform-blue/10" : "hover:bg-gray-100 bg-polyform-blue/5"
                      )}
                    >
                      <Palette size={14} className="text-polyform-blue shrink-0" />
                      <span>Change Style...</span>
                    </button>
                  );
                }
                return null;
              })()}
              {curvedMergeMenuItems(contextMenu.data.shapeId)}
              {patioSnapMenuItem(contextMenu.data.shapeId)}
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
          ) : contextMenu.type === 'kernel' ? (
            <>
              {/*
                Kernel groups don't have names, tags, or per-object
                metadata the way Shapes do yet, so this stays deliberately
                small: the operations already exist and are already
                tested (paintFaces, setGroupHidden,
                deleteGroupFacesAndEdges) — this just gives them a
                right-click entry point, rather than inventing new ones.
                Un-hiding a hidden kernel group happens via the Outliner's
                existing group-level visibility toggle, matching how that
                already works for Shapes.
              */}
              <button
                onClick={() => {
                  if (kernelHost.transact(() => {
                    if (paintFaces(kernelHost.graph, contextMenu.data, activeMaterial, faceFinishFor(activeMaterialBindingId, activePBR)) === 0) return false;
                    setFacesSurfaceDepth(kernelHost.graph, contextMenu.data, activeSurfaceDepth ?? null);
                    return true;
                  })) bumpKernel();
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
                  // Offset clear of the group's own bounding box, so the
                  // duplicate never lands overlapping (or accidentally
                  // snapping onto) the shape it was copied from —
                  // duplicateGroup's own doc comment on its `offset`
                  // parameter is explicit that this placement decision is
                  // deliberately the caller's, not something it computes
                  // itself.
                  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
                  for (const fid of contextMenu.data) {
                    const f = kernelHost.graph.faces.get(fid);
                    if (!f) continue;
                    for (const p of loopPoints(kernelHost.graph, f.outerLoop)) {
                      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
                      if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
                    }
                  }
                  const width = isFinite(minX) ? (maxX - minX) : 1;
                  const offset = { x: width + 1, y: 0, z: 0 };
                  let result: { newFaceIds: FaceId[] } = { newFaceIds: [] };
                  kernelHost.transact(() => {
                    result = duplicateGroup(
                      { graph: kernelHost.graph, tolerances: kernelHost.tolerances, index: kernelHost.spatialIndex },
                      contextMenu.data,
                      offset,
                      kernelHost.deriveOptions,
                    );
                    return result.newFaceIds.length > 0;
                  });
                  bumpKernel();
                  setSelectedFaceIds(result.newFaceIds);
                  setContextMenu(null);
                }}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors",
                  theme === 'dark' ? "hover:bg-gray-700" : "hover:bg-gray-100"
                )}
              >
                Duplicate
              </button>
              <button
                onClick={() => {
                  const summary = objectInfoSummary(kernelHost.graph, contextMenu.data);
                  setObjectInfoTarget(summary);
                  setContextMenu(null);
                }}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors",
                  theme === 'dark' ? "hover:bg-gray-700" : "hover:bg-gray-100"
                )}
              >
                View Object Information
              </button>
              {contextMenu.faceId !== undefined && isSimpleRectangularFace(kernelHost.graph, contextMenu.faceId) && (
                <button
                  onClick={() => {
                    setDivideSurfaceTarget(contextMenu.faceId);
                    setDivideColumns(2);
                    setDivideRows(2);
                    setContextMenu(null);
                  }}
                  className={cn(
                    "w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors",
                    theme === 'dark' ? "hover:bg-gray-700" : "hover:bg-gray-100"
                  )}
                >
                  Divide Surface
                </button>
              )}
              {wallConversion && (wallConversion.ok ? (
                <button
                  onClick={() => {
                    const plan = wallConversion as WallConversionPlan;
                    setConvertWallPlan(plan);
                    setConvertWallHeight(String(plan.height !== null
                      ? +plan.height.toFixed(3)
                      : (wallToolSettings?.height || 2.4)));
                    setConvertWallThickness(String(Math.round(plan.thickness * 1000)));
                    // Floor slab and foundation: on by default for walls standing on the ground.
                    setConvertWallSlab(convertStorey(plan) === 1);
                    setContextMenu(null);
                  }}
                  className={cn(
                    "w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors",
                    theme === 'dark' ? "hover:bg-gray-700" : "hover:bg-gray-100"
                  )}
                >
                  Convert To Wall
                </button>
              ) : (
                // Looks like an attempt at walls but fails a check: shown
                // greyed out with the reason, so the fix is obvious.
                <div className="w-full px-3 py-1.5 text-xs cursor-not-allowed" aria-disabled="true">
                  <div className="text-gray-400">Convert To Wall</div>
                  <div className={cn("text-[10px] leading-snug mt-0.5 max-w-[220px]", theme === 'dark' ? "text-gray-500" : "text-gray-400")}>
                    {(wallConversion as WallConversionRejection).reason}
                  </div>
                </div>
              ))}
              {Array.isArray(contextMenu.data) && contextMenu.data.length > 0 && kernelGroupMenuItems(contextMenu.data)}
              {(() => {
                // Merge / Subtract / Intersect when the menu covers two or more shapes.
                const groups = orderedShapeGroups(kernelHost.graph, contextMenu.data);
                if (groups.length < 2) return null;
                return (['merge', 'subtract', 'intersect'] as BooleanOp[]).map(op => {
                  const plan = planBoolean(kernelHost.graph, groups, op);
                  const label = `${BOOLEAN_LABELS[op]} ${groups.length} Shapes`;
                  if (!plan.ok) {
                    return (
                      <div key={op} className="w-full px-3 py-1.5 text-xs cursor-not-allowed" aria-disabled="true">
                        <div className="text-gray-400">{label}</div>
                        <div className={cn("text-[10px] leading-snug mt-0.5 max-w-[220px]", theme === 'dark' ? "text-gray-500" : "text-gray-400")}>
                          {(plan as BooleanRejection).reason}
                        </div>
                      </div>
                    );
                  }
                  return (
                    <button
                      key={op}
                      onClick={() => {
                        let faces: FaceId[] = [];
                        kernelHost.transact(() => {
                          faces = applyBoolean({ graph: kernelHost.graph, tolerances: kernelHost.tolerances, index: kernelHost.spatialIndex }, plan as BooleanPlan, kernelHost.deriveOptions);
                          return true;
                        });
                        kernelHost.refreshIndex();
                        bumpKernel();
                        setSelectedFaceIds(faces);
                        setContextMenu(null);
                      }}
                      className={cn(
                        "w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors",
                        theme === 'dark' ? "hover:bg-gray-700" : "hover:bg-gray-100"
                      )}
                    >
                      {label}
                    </button>
                  );
                });
              })()}
              <button
                onClick={() => {
                  if (kernelHost.transact(() => setGroupHidden(kernelHost.graph, contextMenu.data, true) > 0)) bumpKernel();
                  setContextMenu(null);
                }}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors",
                  theme === 'dark' ? "hover:bg-gray-700" : "hover:bg-gray-100"
                )}
              >
                Hide
              </button>
              <button
                onClick={() => {
                  kernelHost.transact(() => { deleteGroupFacesAndEdges(kernelHost.graph, contextMenu.data); return true; });
                  bumpKernel();
                  setSelectedFaceIds([]);
                  setContextMenu(null);
                }}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors text-red-600 dark:text-red-400",
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
                  if (singleShape && (singleShape.type === 'door' || singleShape.type === 'window' || singleShape.type === 'staircase' || singleShape.type === 'step' || singleShape.type === 'wall')) {
                    return (
                      <button 
                        onClick={() => {
                          setStyleLibraryTargetId(singleShape.id);
                          setContextMenu(null);
                        }}
                        className={cn(
                          "w-full text-left px-3 py-2 text-xs font-bold flex items-center gap-2 transition-colors border-b border-gray-100 dark:border-gray-800 text-polyform-blue",
                          theme === 'dark' ? "hover:bg-gray-700 bg-polyform-blue/10" : "hover:bg-gray-100 bg-polyform-blue/5"
                        )}
                      >
                        <Palette size={14} className="text-polyform-blue shrink-0" />
                        <span>Change Style...</span>
                      </button>
                    );
                  }
                }
                return null;
              })()}
              {Array.isArray(contextMenu.data) && contextMenu.data.length === 1 && curvedMergeMenuItems(contextMenu.data[0])}
              {Array.isArray(contextMenu.data) && contextMenu.data.length === 1 && patioSnapMenuItem(contextMenu.data[0])}
              {Array.isArray(contextMenu.data) && contextMenu.data.length === 1 && groupObjectMenuItems(contextMenu.data[0])}
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

      {objectInfoTarget && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40"
          onClick={() => setObjectInfoTarget(null)}
        >
          <div
            className={cn(
              "rounded-lg shadow-2xl border p-5 min-w-[280px] max-w-[360px]",
              theme === 'dark' ? "bg-gray-800 border-gray-700 text-gray-200" : "bg-white border-gray-200 text-gray-800"
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold">Object Information</h3>
              <button
                onClick={() => setObjectInfoTarget(null)}
                className={cn(
                  "text-xs px-2 py-0.5 rounded",
                  theme === 'dark' ? "hover:bg-gray-700" : "hover:bg-gray-100"
                )}
              >
                ✕
              </button>
            </div>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between"><span className="opacity-70">Faces</span><span>{objectInfoTarget.faceCount}</span></div>
              <div className="flex justify-between"><span className="opacity-70">Edges</span><span>{objectInfoTarget.edgeCount}</span></div>
              <div className="flex justify-between"><span className="opacity-70">Vertices</span><span>{objectInfoTarget.vertexCount}</span></div>
              <div className="flex justify-between"><span className="opacity-70">Dimensions</span><span>{formatValue(objectInfoTarget.width, unit, 2)} × {formatValue(objectInfoTarget.depth, unit, 2)} × {formatValue(objectInfoTarget.height, unit, 2)}</span></div>
              <div className="flex justify-between"><span className="opacity-70">Surface area</span><span>{objectInfoTarget.surfaceArea.toFixed(2)} {unit}²</span></div>
              {objectInfoTarget.materials.length > 0 && (
                <div className="pt-1">
                  <div className="opacity-70 mb-1">Materials</div>
                  <div className="flex flex-wrap gap-1">
                    {objectInfoTarget.materials.map((m) => (
                      <span
                        key={m}
                        className="inline-block w-4 h-4 rounded border border-gray-400"
                        style={{ backgroundColor: m }}
                        title={m}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTool === 'combine' && (
        <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-[60] pointer-events-auto max-w-[calc(100%-2rem)]">
          <div className={cn(
            "rounded-lg shadow-xl border px-3 py-2 flex flex-wrap items-center gap-2 text-xs",
            theme === 'dark' ? "bg-gray-800 border-gray-700 text-gray-200" : "bg-white border-gray-200 text-gray-800"
          )}>
            {(['merge', 'subtract', 'intersect'] as BooleanOp[]).map(op => (
              <button key={op} onClick={() => setCombineMode(op)}
                className={cn("px-2 py-1 rounded border font-semibold",
                  combineMode === op ? "border-polyform-blue bg-polyform-blue/10 text-polyform-blue"
                    : (theme === 'dark' ? "border-gray-600 hover:bg-gray-700" : "border-gray-200 hover:bg-gray-100"))}>
                {BOOLEAN_LABELS[op]}
              </button>
            ))}
            <span className={cn("text-[11px] max-w-[260px]", theme === 'dark' ? "text-gray-400" : "text-gray-500")}>
              {combineResolved.length === 0 ? 'Click the shapes or objects to combine: flat drawn shapes, or 3D objects. The first one leads (Subtract keeps it).'
                : combineResolved.length === 1 ? '1 picked. Click another.'
                : combinePlan && !combinePlan.ok ? (combinePlan as BooleanRejection).reason
                : `${combineResolved.length} ${combineFlat ? 'flat shapes' : 'objects'} picked. Press Enter or Apply.`}
            </span>
            <button onClick={applyCombine} disabled={!combineReady}
              className="px-2 py-1 rounded bg-polyform-blue text-white font-semibold disabled:opacity-40">Apply</button>
            <button onClick={() => setCombinePicks([])} disabled={!combineResolved.length}
              className={cn("px-2 py-1 rounded disabled:opacity-40", theme === 'dark' ? "hover:bg-gray-700" : "hover:bg-gray-100")}>Clear</button>
          </div>
        </div>
      )}

      {convertWallPlan && (() => {
        const thicknessMm = parseFloat(convertWallThickness);
        const resized = Number.isFinite(thicknessMm) ? planWithThickness(convertWallPlan, thicknessMm / 1000) : null;
        const plan = resized?.ok ? resized : convertWallPlan;
        const thicknessError = !resized ? 'Enter a thickness in millimetres.' : resized.ok ? null : (resized as WallConversionRejection).reason;
        const height = plan.height ?? parseFloat(convertWallHeight);
        const heightValid = Number.isFinite(height) && height >= 0.1;
        const warnings = [...plan.warnings, ...(heightValid ? heightWarnings(height, plan.baseY) : [])];
        const onGround = convertStorey(plan) === 1;
        return (
          <div
            className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40"
            onClick={() => setConvertWallPlan(null)}
          >
            <div
              className={cn(
                "rounded-lg shadow-2xl border p-5 w-[360px] max-w-[calc(100vw-2rem)]",
                theme === 'dark' ? "bg-gray-800 border-gray-700 text-gray-200" : "bg-white border-gray-200 text-gray-800"
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-sm font-bold mb-3">Convert To Wall</h3>
              <div className="space-y-2 mb-3 text-xs">
                <div className="flex justify-between"><span>Walls</span><span>{plan.pieces.length}</span></div>
                <label className="flex items-center justify-between">
                  <span>Thickness (mm)</span>
                  <input
                    type="number"
                    min={20}
                    step={10}
                    value={convertWallThickness}
                    onChange={(e) => setConvertWallThickness(e.target.value)}
                    className={cn(
                      "w-20 px-2 py-1 rounded border text-xs text-right",
                      thicknessError ? "border-red-400" : theme === 'dark' ? "bg-gray-900 border-gray-700" : "bg-white border-gray-300",
                      theme === 'dark' && "bg-gray-900"
                    )}
                  />
                </label>
                {thicknessError ? (
                  <p className="text-[11px] text-red-500">{thicknessError}</p>
                ) : Math.abs(plan.thickness - convertWallPlan.thickness) > 1e-6 && (
                  <p className={cn("text-[11px]", theme === 'dark' ? "text-gray-400" : "text-gray-500")}>The outside face stays where it was drawn; the walls grow or shrink inwards.</p>
                )}
                {plan.height !== null ? (
                  <div className="flex justify-between"><span>Height</span><span>{plan.height.toFixed(2)} m</span></div>
                ) : (
                  <label className="flex items-center justify-between">
                    <span>Height (m)</span>
                    <input
                      type="number"
                      min={0.1}
                      step={0.1}
                      value={convertWallHeight}
                      onChange={(e) => setConvertWallHeight(e.target.value)}
                      className={cn(
                        "w-20 px-2 py-1 rounded border text-xs text-right",
                        theme === 'dark' ? "bg-gray-900 border-gray-700" : "bg-white border-gray-300"
                      )}
                    />
                  </label>
                )}
              </div>
              {warnings.length > 0 && (
                <ul className="mb-4 space-y-1.5 text-[11px] leading-snug">
                  {warnings.map((w, i) => (
                    <li
                      key={i}
                      className={cn(
                        "rounded px-2 py-1.5",
                        w.level === 'warning'
                          ? (theme === 'dark' ? "bg-amber-900/40 text-amber-200" : "bg-amber-50 text-amber-800")
                          : (theme === 'dark' ? "bg-gray-700/60 text-gray-300" : "bg-gray-100 text-gray-600")
                      )}
                    >
                      {w.message}
                    </li>
                  ))}
                </ul>
              )}
              {onGround ? (
                <label className="flex items-start gap-2 mb-3 text-xs cursor-pointer">
                  <input type="checkbox" className="mt-0.5" checked={convertWallSlab} onChange={(e) => setConvertWallSlab(e.target.checked)} />
                  <span>
                    Also add floor slab and foundation
                    <span className={cn("block text-[11px]", theme === 'dark' ? "text-gray-400" : "text-gray-500")}>
                      As the Wall tool does: a 200 mm slab (replacing the drawn floor) with the walls standing on it, a foundation below, and the ground levelled round it.
                    </span>
                  </span>
                </label>
              ) : null}
              <p className={cn("text-[11px] mb-4", theme === 'dark' ? "text-gray-400" : "text-gray-500")}>
                The original shape is replaced by the walls. Undo brings it back.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setConvertWallPlan(null)}
                  className={cn(
                    "px-3 py-1.5 text-xs rounded",
                    theme === 'dark' ? "hover:bg-gray-700" : "hover:bg-gray-100"
                  )}
                >
                  Cancel
                </button>
                <button
                  disabled={!heightValid || !!thicknessError}
                  onClick={() => {
                    convertToWalls(plan, height, onGround && convertWallSlab);
                    setConvertWallPlan(null);
                  }}
                  className="px-3 py-1.5 text-xs rounded bg-polyform-blue text-white hover:opacity-90 disabled:opacity-40"
                >
                  Convert
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {divideSurfaceTarget !== null && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40"
          onClick={() => setDivideSurfaceTarget(null)}
        >
          <div
            className={cn(
              "rounded-lg shadow-2xl border p-5 min-w-[260px]",
              theme === 'dark' ? "bg-gray-800 border-gray-700 text-gray-200" : "bg-white border-gray-200 text-gray-800"
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold mb-3">Divide Surface</h3>
            <div className="space-y-3 mb-4">
              <label className="flex items-center justify-between text-xs">
                <span>Columns</span>
                <input
                  type="number"
                  min={1}
                  value={divideColumns}
                  onChange={(e) => setDivideColumns(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  className={cn(
                    "w-16 px-2 py-1 rounded border text-xs text-right",
                    theme === 'dark' ? "bg-gray-900 border-gray-700" : "bg-white border-gray-300"
                  )}
                />
              </label>
              <label className="flex items-center justify-between text-xs">
                <span>Rows</span>
                <input
                  type="number"
                  min={1}
                  value={divideRows}
                  onChange={(e) => setDivideRows(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  className={cn(
                    "w-16 px-2 py-1 rounded border text-xs text-right",
                    theme === 'dark' ? "bg-gray-900 border-gray-700" : "bg-white border-gray-300"
                  )}
                />
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDivideSurfaceTarget(null)}
                className={cn(
                  "px-3 py-1.5 text-xs rounded",
                  theme === 'dark' ? "hover:bg-gray-700" : "hover:bg-gray-100"
                )}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const ctx = { graph: kernelHost.graph, tolerances: kernelHost.tolerances, index: kernelHost.spatialIndex };
                  let result: ReturnType<typeof divideRectangularFace> = { ok: false } as ReturnType<typeof divideRectangularFace>;
                  kernelHost.transact(() => {
                    result = divideRectangularFace(ctx, divideSurfaceTarget, divideColumns, divideRows);
                    if (result.ok) derive(kernelHost.graph, result.touched, kernelHost.deriveOptions);
                    return result.ok;
                  });
                  if (result.ok) {
                    bumpKernel();
                  } else {
                    setMeasurements(result.reason ? `Could not divide: ${result.reason}` : 'Could not divide surface.');
                  }
                  setDivideSurfaceTarget(null);
                }}
                className="px-3 py-1.5 text-xs rounded bg-polyform-blue text-white hover:opacity-90"
              >
                Divide
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="absolute top-4 left-4 max-w-[calc(100%-2rem)] flex flex-row flex-wrap items-start gap-2 pointer-events-auto">
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
              "absolute top-full left-0 mt-1 w-32 rounded border shadow-lg overflow-hidden z-[150]",
              theme === 'dark' ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"
            )}>
              {['Plan', 'Front Elevation', 'Rear Elevation', 'Left Elevation', 'Right Elevation'].map((view) => (
                <button
                  key={view}
                  onClick={() => handleViewChange(view.split(' ')[0].toLowerCase())}
                  className={cn(
                    "w-full text-left px-3 py-2 text-[10px] font-medium hover:bg-polyform-blue hover:text-white transition-colors",
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
            quadView ? "bg-polyform-blue border-polyform-blue text-white" : (theme === 'dark' ? "bg-gray-800/80 border-gray-700 text-gray-300" : "bg-white/80 border-gray-200 text-gray-600")
          )}
        >
          <span className="">Split View</span>
        </button>

        {(activeTool === 'select' || activeTool === 'lasso') && (
          <div className={cn(
            "backdrop-blur-sm px-2 py-1 rounded border flex items-center gap-1.5 shadow-sm text-[10px]",
            theme === 'dark' ? "bg-gray-800/90 border-gray-700 text-gray-200" : "bg-white/90 border-gray-200 text-gray-700"
          )}>
            <div className="flex items-center gap-1 bg-black/5 dark:bg-white/10 p-0.5 rounded">
              <button
                onClick={() => {
                  setSelectionShapeMode('lasso');
                  setMeasurements('Selection tool: Freehand Lasso (draw freeform loop)');
                }}
                className={cn(
                  "px-2 py-0.5 rounded font-semibold transition-all flex items-center gap-1",
                  selectionShapeMode === 'lasso'
                    ? "bg-polyform-blue text-white shadow-xs"
                    : "text-gray-500 hover:text-gray-800 dark:hover:text-white"
                )}
                title="Lasso: Draw a custom loop around shapes or surfaces (Hotkey: L)"
              >
                <Lasso size={11} />
                <span>Lasso</span>
              </button>
              <button
                onClick={() => {
                  setSelectionShapeMode('marquee');
                  setMeasurements('Selection tool: Marquee Window (drag rectangular box)');
                }}
                className={cn(
                  "px-2 py-0.5 rounded font-semibold transition-all flex items-center gap-1",
                  selectionShapeMode === 'marquee'
                    ? "bg-polyform-blue text-white shadow-xs"
                    : "text-gray-500 hover:text-gray-800 dark:hover:text-white"
                )}
                title="Marquee: Drag a rectangular window (Hotkey: L)"
              >
                <SquareDashed size={11} />
                <span>Marquee</span>
              </button>
            </div>

            <button
              onClick={() => {
                setSelectionCriteria(prev => prev === 'crossing' ? 'window' : 'crossing');
              }}
              className={cn(
                "px-2 py-0.5 rounded border text-[9px] font-bold uppercase transition-all",
                selectionCriteria === 'crossing'
                  ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                  : "bg-blue-500/15 border-blue-500/30 text-blue-600 dark:text-blue-400"
              )}
              title={selectionCriteria === 'crossing' ? "Crossing: selects objects touching or inside path" : "Window: only selects objects 100% inside path"}
            >
              {selectionCriteria}
            </button>

            {(selectedIds.length > 0 || selectedFaceIds.length > 0) && (
              <span className="font-mono text-[9px] text-gray-500 dark:text-gray-400 pl-0.5">
                {selectedIds.length + selectedFaceIds.length} sel
              </span>
            )}
          </div>
        )}
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
                      "w-full px-2 py-1.5 border rounded text-xs outline-none focus:border-polyform-blue",
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
                      "w-full px-2 py-1.5 border rounded text-xs outline-none focus:border-polyform-blue",
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
                  className="flex-1 py-2 text-xs font-bold bg-polyform-blue text-white rounded hover:bg-polyform-dark-blue transition-all"
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
          <div className="bg-slate-950/85 text-white px-4 py-2 rounded-full text-xs font-medium shadow-lg shadow-slate-950/20 animate-in fade-in slide-in-from-bottom-2 duration-300">
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
                  "w-full px-3 py-2 border rounded text-sm outline-none focus:border-polyform-blue",
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
                  className="flex-1 px-3 py-2 text-xs font-bold uppercase bg-polyform-blue text-white rounded hover:bg-polyform-dark-blue"
                >
                  Divide
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Style Library Modal for Doors, Windows, and Staircases */}
      <StyleLibraryModal 
        isOpen={!!styleLibraryTargetId}
        targetShape={shapes.find(s => s.id === styleLibraryTargetId) || null}
        allShapes={shapes}
        onClose={() => setStyleLibraryTargetId(null)}
        theme={theme}
        onApplyStyle={(styleId, dims, extraOptions) => {
          if (!styleLibraryTargetId) return;
          const target = shapes.find(s => s.id === styleLibraryTargetId);
          const isDoorOrWindow = target && (
            target.type === 'door' || 
            target.type === 'window' || 
            target.tags?.some(t => t.includes('door') || t.includes('window'))
          );
          const hasTimberFraming = shapes.some(s => s.tags?.includes('timber-frame') || s.name?.startsWith('Timber ') || s.id.startsWith('tf-'));

          const nextShapes = shapes.map(s => {
            if (s.id === styleLibraryTargetId) {
              const updatedArgs = dims || s.args;
              const targetChar = s.type === 'scale_figure' ? SCALE_FIGURE_CHARACTERS.find(c => c.id === styleId) : undefined;
              return {
                ...s,
                archStyle: styleId,
                color: targetChar ? targetChar.primaryColor : s.color,
                name: targetChar ? `${targetChar.name} (${(Array.isArray(updatedArgs) ? updatedArgs[1] : targetChar.height).toFixed(2)}m)` : s.name,
                stairStyle: styleId,
                wallStyle: styleId,
                stairStructure: extraOptions?.stairStructure || s.stairStructure,
                railingMode: extraOptions?.railingMode || s.railingMode,
                isParametric: extraOptions?.isParametric !== undefined ? extraOptions.isParametric : s.isParametric,
                parametricData: extraOptions?.parametricData !== undefined ? extraOptions.parametricData : s.parametricData,
                args: updatedArgs
              };
            }
            return s;
          });
          const nextWithStairwells = applyStairwellHolesToSlabs(nextShapes);

          if (isDoorOrWindow && hasTimberFraming) {
            commitUpdatedFraming(nextWithStairwells);
            commitHistory();
          } else {
            setShapes(nextWithStairwells);
            commitHistory();
          }

          setMeasurements(`Updated style to ${styleId.toUpperCase()}${extraOptions?.isParametric ? ' (Parametric Mode Active)' : ''}${isDoorOrWindow && hasTimberFraming ? ' · Framing Committed' : ''}`);
          setStyleLibraryTargetId(null);
        }}
      />

      {/* Style picker for light fixtures - exterior and interior models to choose from */}
      <LampStylePicker
        isOpen={!!lampStyleTargetId}
        targetShape={shapes.find(s => s.id === lampStyleTargetId) || null}
        theme={theme}
        onClose={() => setLampStyleTargetId(null)}
        onApplyStyle={(styleId) => {
          if (!lampStyleTargetId) return;
          const styleDef = findLampStyle(styleId);
          setShapes(shapes.map(s => {
            if (s.id !== lampStyleTargetId) return s;
            // The placement tool drops a lamp wherever the user clicked, which is
            // floor/ground height the overwhelming majority of the time - there's no
            // ceiling-surface-aware placement mode. A style that mounts to the
            // ceiling (a pendant, a downlight, a troffer) needs to actually sit up
            // near a ceiling, not hang its fixture down from a floor-level pivot -
            // that was rendering ceiling fixtures below the floor. Only lift it when
            // the shape still looks floor-level; a lamp someone has already
            // deliberately raised (e.g. onto an upper story) is left alone.
            const position = (styleDef.mount === 'ceiling' && s.position[1] < 2.0)
              ? [s.position[0], 2.4, s.position[2]] as [number, number, number]
              : s.position;
            return { ...s, archStyle: styleId, position };
          }));
          commitHistory();
          setMeasurements(`Updated light style to ${styleId.toUpperCase()}`);
          setLampStyleTargetId(null);
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
