import * as THREE from 'three';
import { indexCatalog, loadAssetManifest, loadCatalogIndex } from '../assets/catalog';
import { loadMaterialMaps } from '../assets/libraryTextures';
import { ManagedTextureManager } from '../assets/textureManager';
import type { MapSemantic, PolyHavenAssetId } from '../assets/types';
import type { RoofMaterial, WallMaterial } from './buildingStyle';

/**
 * The materials existing buildings are dressed in: real PBR library materials laid at their true
 * size on walls and roofs, plus a facade shader that punches generated windows and doors into the
 * walls (see styledGeometry.ts for what it reads). One set is shared by every building on a site.
 * Until a material's maps arrive the plain colour stands in, so buildings never wait to appear.
 */

const WALL_ASSETS: Partial<Record<WallMaterial, string>> = {
  brick: 'ph:material:brick_wall_001',
  render: 'ph:material:white_stucco',
  stone: 'ph:material:sandstone_brick_wall_01',
  concrete: 'ph:material:concrete_floor_worn_001',
  metal: 'ph:material:worn_corrugated_iron',
};
const ROOF_ASSETS: Record<RoofMaterial, string> = {
  tiles: 'ph:material:clay_roof_tiles',
  metal: 'ph:material:worn_corrugated_iron',
  flat: 'ph:material:concrete_floor_worn_001',
};
const WALL_FALLBACK: Record<WallMaterial, string> = {
  brick: '#a5573e', render: '#e6e1d6', stone: '#b7ae9d', concrete: '#a9a9a6', metal: '#aab2b8', glass: '#ffffff',
};
const ROOF_FALLBACK: Record<RoofMaterial, string> = { tiles: '#9a5a44', metal: '#8f979c', flat: '#8a8884' };
const MAPS: MapSemantic[] = ['basecolor', 'normal-gl', 'orm'];

const FACADE_VERTEX_DECL = `
attribute vec3 aWall;
attribute vec4 aS1;
attribute vec4 aS2;
varying vec3 vSbWall;
varying vec4 vSbS1;
varying vec4 vSbS2;
varying vec2 vSbUv;`;

const FACADE_FRAGMENT_DECL = `
varying vec3 vSbWall;
varying vec4 vSbS1;
varying vec4 vSbS2;
varying vec2 vSbUv;
float sbGlass = 0.0;
float sbBox(vec2 p, vec2 lo, vec2 hi) { return step(lo.x, p.x) * step(p.x, hi.x) * step(lo.y, p.y) * step(p.y, hi.y); }`;

/** Sets `sbGlass` (1 = glass, 0.5 = frame or door, 0 = wall) for the fragment. */
const FACADE_FRAGMENT = `
  vec3 sbFrameColour = vec3(0.90, 0.90, 0.88);
  vec3 sbGlassColour = vec3(0.09, 0.14, 0.20);
  vec3 sbDoorColour = vec3(0.16, 0.13, 0.11);
  if (vSbWall.z > -0.5) {
    float storeyH = max(vSbS1.x, 2.2);
    float bay = max(vSbS1.y, 1.0);
    float ww = vSbS1.z;
    float wh = vSbS1.w;
    float sill = vSbS2.x;
    float eave = vSbS2.y;
    int pat = int(vSbS2.z + 0.5);
    int doorKind = int(vSbS2.w + 0.5);
    float len = max(vSbWall.y, 0.5);
    float along = vSbWall.x;
    float y = vSbUv.y;
    float floorIdx = floor(y / storeyH);
    float ly = y - floorIdx * storeyH;
    float bays = max(1.0, floor((len - 1.4) / bay));
    float spacing = len / bays;
    float lx = along - (floor(along / spacing) + 0.5) * spacing;
    float inside = step(0.5, along) * step(along, len - 0.5) * step(y, eave - 0.25);
    float win = 0.0; // 1 = glass, 2 = mullion/frame
    float fr = 0.07;
    vec2 cell = vec2(lx, ly);
    if (pat == 1) {
      win = sbBox(cell, vec2(-ww * 0.5, sill), vec2(ww * 0.5, sill + wh)) * inside;
      float core = sbBox(cell, vec2(-ww * 0.5 + fr, sill + fr), vec2(ww * 0.5 - fr, sill + wh - fr));
      float bar = step(abs(lx), 0.025) + step(abs(ly - (sill + wh * 0.5)), 0.025);
      win = win > 0.5 ? (core > 0.5 && bar < 0.5 ? 1.0 : 2.0) : 0.0;
    } else if (pat == 2) {
      float band = sbBox(vec2(along, ly), vec2(0.8, sill), vec2(len - 0.8, sill + wh)) * step(y, eave - 0.25);
      float mullion = step(abs(lx), 0.04);
      float edge = 1.0 - sbBox(vec2(along, ly), vec2(0.8 + fr, sill + fr), vec2(len - 0.8 - fr, sill + wh - fr));
      win = band > 0.5 ? ((mullion > 0.5 || edge > 0.5) ? 2.0 : 1.0) : 0.0;
    } else if (pat == 3) {
      float pane = sbBox(vec2(along, y), vec2(0.35, 0.35), vec2(len - 0.35, eave - 0.3));
      float mull = max(step(abs(lx), 0.05), step(abs(ly - storeyH * 0.5), 0.05));
      float slab = step(abs(ly), 0.28);
      win = pane > 0.5 ? ((mull > 0.5 || slab > 0.5) ? 2.0 : 1.0) : 0.0;
    } else if (pat == 4) {
      float band = sbBox(vec2(along, y), vec2(0.8, eave - 2.0), vec2(len - 0.8, eave - 0.7));
      float mull = step(abs(lx), 0.05);
      win = band > 0.5 ? (mull > 0.5 ? 2.0 : 1.0) : 0.0;
    } else if (pat == 5) {
      float top = sill + wh - ww * 0.5;
      float body = sbBox(cell, vec2(-ww * 0.5, sill), vec2(ww * 0.5, top));
      float arch = step(length(vec2(lx, ly - top)), ww * 0.5) * step(top, ly);
      float shape = max(body, arch);
      float shapeIn = max(sbBox(cell, vec2(-ww * 0.5 + fr, sill + fr), vec2(ww * 0.5 - fr, top)),
                          step(length(vec2(lx, ly - top)), ww * 0.5 - fr) * step(top, ly));
      win = shape > 0.5 ? (shapeIn > 0.5 ? 1.0 : 2.0) * inside : 0.0;
      if (floorIdx > 0.5) win = 0.0;
    } else if (pat == 6) {
      float ground = step(y, 3.2);
      float pil = step(abs(mod(along, bay * 2.0) - bay), 0.28);
      float front = sbBox(vec2(along, y), vec2(0.6, 0.45), vec2(len - 0.6, 3.0)) * ground;
      float upper = sbBox(cell, vec2(-ww * 0.5, sill), vec2(ww * 0.5, sill + wh)) * inside * (1.0 - ground);
      win = front > 0.5 ? (pil > 0.5 ? 2.0 : 1.0) : (upper > 0.5 ? 1.0 : 0.0);
    } else if (pat == 7) {
      float pane = sbBox(vec2(along, y), vec2(0.15, 0.4), vec2(len - 0.15, max(eave - 0.15, 0.6)));
      float bars = max(step(abs(mod(along, 1.2) - 0.6), 0.03), step(abs(mod(y, 1.0) - 0.5), 0.02));
      win = pane > 0.5 ? (bars > 0.5 ? 2.0 : 1.0) : 0.0;
    }
    // A door on the wall marked for it.
    float door = 0.0;
    if (vSbWall.z > 0.5 && doorKind == 1) {
      vec2 dp = vec2(along - len * 0.5, y);
      door = sbBox(dp, vec2(-0.5, 0.0), vec2(0.5, 2.1));
      if (door > 0.5) win = 0.0;
      // keep the window beside the door from overlapping its frame
      if (abs(along - len * 0.5) < 0.5 + ww * 0.5 && y < 2.4) win = win > 0.0 ? 0.0 : win;
    } else if (vSbWall.z > 0.5 && doorKind == 2) {
      vec2 dp = vec2(along - len * 0.5, y);
      door = sbBox(dp, vec2(-1.6, 0.0), vec2(1.6, 3.6));
      if (door > 0.5) win = 0.0;
    }
    if (door > 0.5) {
      diffuseColor.rgb = doorKind == 2 ? vec3(0.55, 0.57, 0.58) : sbDoorColour;
      sbGlass = 0.5;
    } else if (win > 1.5) {
      diffuseColor.rgb = sbFrameColour;
      sbGlass = 0.5;
    } else if (win > 0.5) {
      diffuseColor.rgb = sbGlassColour;
      sbGlass = 1.0;
    }
  }`;

/** One wall material per kind. Glass walls have no picture; the facade shader draws them. */
function makeWallMaterial(kind: WallMaterial): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: WALL_FALLBACK[kind], roughness: kind === 'glass' ? 0.2 : 0.9, metalness: kind === 'glass' ? 0.1 : 0, vertexColors: true,
  });
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>${FACADE_VERTEX_DECL}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSbWall = aWall; vSbS1 = aS1; vSbS2 = aS2; vSbUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>${FACADE_FRAGMENT_DECL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FACADE_FRAGMENT}`)
      // Glass is smooth and a little reflective; frames and doors are painted.
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nif (sbGlass > 0.9) roughnessFactor = 0.08; else if (sbGlass > 0.4) roughnessFactor = 0.55;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nif (sbGlass > 0.4) metalnessFactor = sbGlass > 0.9 ? 0.25 : 0.0;');
  };
  material.customProgramCacheKey = () => 'pf-facade';
  return material;
}

export interface StyleKit {
  wall(kind: WallMaterial): THREE.MeshStandardMaterial;
  roof(kind: RoofMaterial): THREE.MeshStandardMaterial;
}

type Slot = { material: THREE.MeshStandardMaterial; assetId: string | undefined };

/** Builds a kit and starts loading its maps. Nothing is shared between renderers. */
export function createStyleKit(gl: THREE.WebGLRenderer): StyleKit {
  const walls = new Map<WallMaterial, Slot>();
  const roofs = new Map<RoofMaterial, Slot>();
  let manager: ManagedTextureManager | null = null;
  let catalogPromise: Promise<ReturnType<typeof indexCatalog>> | null = null;

  const load = (slot: Slot) => {
    const id = slot.assetId;
    if (!id) return;
    void (async () => {
      try {
        manager ??= new ManagedTextureManager(gl);
        catalogPromise ??= loadCatalogIndex().then(indexCatalog);
        const summary = (await catalogPromise).get(id as PolyHavenAssetId);
        if (!summary) return;
        const m = slot.material;
        // The physical size of one tile decides how the picture is laid on the walls (uv is in metres).
        const tile = (await loadAssetManifest(summary)).physicalTileMeters ?? [1, 1];
        await loadMaterialMaps(manager, summary, MAPS, (semantic, texture) => {
          texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
          texture.repeat.set(1 / tile[0], 1 / tile[1]);
          texture.anisotropy = 4;
          if (semantic === 'basecolor') { m.map = texture; m.color.set('#ffffff'); }
          else if (semantic === 'normal-gl') m.normalMap = texture;
          else if (semantic === 'orm') { m.roughnessMap = texture; m.metalnessMap = texture; m.roughness = 1; m.metalness = id.includes('metal') ? 1 : 0; }
          m.needsUpdate = true;
        }, new AbortController().signal);
      } catch (error) {
        console.warn('[World site] Could not load a building material', error);
      }
    })();
  };

  return {
    wall(kind) {
      let slot = walls.get(kind);
      if (!slot) {
        slot = { material: makeWallMaterial(kind), assetId: WALL_ASSETS[kind] };
        walls.set(kind, slot);
        load(slot);
      }
      return slot.material;
    },
    roof(kind) {
      let slot = roofs.get(kind);
      if (!slot) {
        const material = new THREE.MeshStandardMaterial({ color: ROOF_FALLBACK[kind], roughness: 0.9, metalness: 0, vertexColors: true });
        slot = { material, assetId: ROOF_ASSETS[kind] };
        roofs.set(kind, slot);
        load(slot);
      }
      return slot.material;
    },
  };
}
