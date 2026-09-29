import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { TilesRenderer } from '3d-tiles-renderer/three';
import { GoogleCloudAuthPlugin, GLTFExtensionsPlugin, TileFlatteningPlugin } from '3d-tiles-renderer/plugins';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import type { Shape, SiteBuildingSnapshot, WorldSiteInfo } from '../types';
import { cutoutPlanes, estimateLift, tilesToSiteMatrix } from '../lib/worldSite/googleTiles';
import { explainTileError, setGoogleTilesStatus } from '../lib/worldSite/googleTilesStatus';
import { growRing, siteEditSets, worldRing, type Ring } from '../lib/worldSite/siteEdits';

// Google's Photorealistic 3D Tiles around an imported World View site (see
// lib/worldSite/googleTiles.ts). A viewing layer only: it can't be picked, measured or exported.
// Over the site it is either cut away (the editable satellite ground shows there) or, in
// 'google' ground mode, kept, with Google's buildings flattened under the editable ones.

const TILES_URL = 'https://tile.googleapis.com/v1/3dtiles/root.json';
const noRaycast = () => {};

interface Props {
  site: WorldSiteInfo;
  apiKey: string;
  /** Every shape in the model, and the imported buildings as they were (for pressing Google's flat where they were). */
  shapes: Shape[];
  existing: SiteBuildingSnapshot[] | undefined;
  /** Changes when the drawn (kernel) geometry changes. */
  kernelRevision: number;
  /** The editable ground's height (model y) at a plan point. */
  groundAt: (x: number, z: number) => number;
}

type TileMesh = THREE.Mesh & { userData: { pfRaycast?: THREE.Mesh['raycast'] } };

/** Anything drawn in the model that is not a site building, the ground, or something that only stands on it. */
const SKIP_TYPES = new Set(['terrain', 'measurement', 'text', 'text3d', 'tree', 'bush', 'rock', 'fence', 'railing', 'lamp', 'bench', 'water', 'scale_figure', 'site_building']);
/** Give up on flattening under objects with more triangles than this in total (it would stall the tiles). */
const MAX_FOOTPRINT_TRIANGLES = 40000;

/** A flat triangle list [x,y,z...] for an outline (and holes), at the ground under each corner. */
function ringTriangles(outer: Ring, holes: Ring[], groundAt: (x: number, z: number) => number, out: number[]): void {
  const to2 = (p: [number, number]) => new THREE.Vector2(p[0], p[1]);
  const tri = THREE.ShapeUtils.triangulateShape(outer.map(to2), holes.map(h => h.map(to2)));
  const verts = [...outer, ...holes.flat()];
  for (const t of tri) for (const k of t) {
    const v = verts[k]!;
    out.push(v[0], groundAt(v[0], v[1]), v[1]);
  }
}

/** The plan outline of an imported building (edited or vanished), with a little margin. */
function buildingTriangles(pos: [number, number, number], quat: [number, number, number, number] | undefined, scale: [number, number, number] | undefined,
  footprint: [number, number][], holes: [number, number][][] | undefined, groundAt: (x: number, z: number) => number, out: number[]): void {
  const outer = growRing(worldRing(footprint, pos, quat, scale), 0.4);
  const inner = (holes ?? []).filter(h => h.length >= 3).map(h => growRing(worldRing(h, pos, quat, scale), -0.2));
  ringTriangles(outer, inner, groundAt, out);
}

/** Everything the user has drawn or edited that Google's mesh should give way to, as flat triangles at ground level. */
function collectFootprints(scene: THREE.Scene, shapes: Shape[], existing: SiteBuildingSnapshot[] | undefined, groundAt: (x: number, z: number) => number): Float32Array {
  const out: number[] = [];
  const { edited, vacated } = siteEditSets(shapes, existing);
  for (const snap of vacated) buildingTriangles(snap.position, undefined, undefined, snap.data.footprint, snap.data.holes, groundAt, out);
  for (const b of edited) {
    const d = b.siteBuildingData;
    if (d) buildingTriangles(b.position, b.quaternion, b.scale, d.footprint, d.holes, groundAt, out);
  }
  // Everything else, from what is actually on screen: walls, slabs, roofs and drawn faces.
  const byId = new Map(shapes.map(s => [s.id, s]));
  let budget = MAX_FOOTPRINT_TRIANGLES;
  const v = new THREE.Vector3();
  scene.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry || budget <= 0) return;
    if (mesh.userData.isGoogleTile || mesh.userData.isHelper || mesh.userData.isPreview || mesh.userData.isGizmo) return;
    let owner: THREE.Object3D | null = mesh;
    let shapeId: string | undefined;
    let kernel = false;
    while (owner) {
      if (owner.userData?.isKernelGeometry) kernel = true;
      if (typeof owner.userData?.id === 'string' && byId.has(owner.userData.id)) { shapeId = owner.userData.id; break; }
      owner = owner.parent;
    }
    if (!kernel) {
      const sh = shapeId ? byId.get(shapeId) : undefined;
      if (!sh || SKIP_TYPES.has(sh.type) || sh.hidden || sh.tags?.includes('world-site')) return;
    }
    const g = mesh.geometry;
    const pos = g.getAttribute('position');
    if (!pos) return;
    const index = g.getIndex();
    const count = index ? index.count : pos.count;
    if (count / 3 > budget) return;
    mesh.updateWorldMatrix(true, false);
    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld);
      out.push(v.x, groundAt(v.x, v.z), v.z);
    }
    budget -= count / 3;
  });
  return new Float32Array(out);
}

export function GoogleTilesLayer({ site, apiKey, shapes, existing, kernelRevision, groundAt }: Props) {
  const { camera, gl, scene, invalidate } = useThree();
  const [tiles, setTiles] = useState<TilesRenderer | null>(null);
  const [autoLift, setAutoLift] = useState(0);
  const [aligned, setAligned] = useState(false);
  const [credits, setCredits] = useState<{ type: string; value: unknown }[]>([]);
  const flattenRef = useRef<TileFlatteningPlugin | null>(null);
  const flatShapes = useRef<THREE.Mesh[]>([]);
  const siteSizeRef = useRef(site.size);
  siteSizeRef.current = site.size;
  const groundAtRef = useRef(groundAt);
  groundAtRef.current = groundAt;
  const liftRef = useRef(0);

  const cut = site.googleGround !== 'google';
  const lift = autoLift + (site.googleNudge ?? 0);
  liftRef.current = lift;
  const planes = useMemo(() => (cut ? cutoutPlanes(site.size, 1).map(p => new THREE.Plane(new THREE.Vector3(...p.normal), p.constant)) : []), [cut, site.size]);
  const planesRef = useRef(planes);
  planesRef.current = planes;
  const cutRef = useRef(cut);
  cutRef.current = cut;

  // The renderer: one per site, while the layer is on.
  useEffect(() => {
    if (!apiKey) return;
    const t = new TilesRenderer(TILES_URL);
    t.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: apiKey, autoRefreshToken: true }));
    // Google's tiles are Draco-compressed; without a decoder none of them can be read.
    const draco = new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL ?? '/'}draco/`);
    t.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco }));
    setGoogleTilesStatus({ state: 'connecting', message: 'Connecting to Google…', tiles: 0 });
    const flatten = new TileFlatteningPlugin();
    t.registerPlugin(flatten);
    flattenRef.current = flatten;
    t.group.matrixAutoUpdate = false;
    gl.localClippingEnabled = true;
    t.setCamera(camera);
    t.setResolutionFromRenderer(camera, gl);

    const prepare = (root: THREE.Object3D) => {
      root.traverse(o => {
        const mesh = o as TileMesh;
        if (!mesh.isMesh) return;
        // Never picked, snapped to or measured: the layer is for looking at.
        if (!mesh.userData.pfRaycast) mesh.userData.pfRaycast = mesh.raycast;
        mesh.raycast = noRaycast;
        mesh.userData.isHelper = true;
        mesh.userData.isGoogleTile = true;
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          m.clippingPlanes = cutRef.current ? planesRef.current : null;
          m.clipIntersection = true;
          // Where it meets the editable ground, the editable ground wins.
          m.polygonOffset = true;
          m.polygonOffsetFactor = 2;
          m.polygonOffsetUnits = 2;
          m.needsUpdate = true;
        }
      });
    };
    const onModel = (e: { scene: THREE.Object3D }) => prepare(e.scene);
    t.addEventListener('load-model', onModel as never);

    let queued = false;
    const refreshCredits = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        setCredits([...t.getAttributions()]);
        const n = t.visibleTiles.size;
        setGoogleTilesStatus(n > 0 ? { state: 'showing', message: '', tiles: n } : { state: 'loading', message: 'Loading tiles…', tiles: 0 });
        invalidate();
      });
    };
    let failures = 0;
    const onError = (e: { error?: unknown; url?: unknown }) => {
      failures++;
      console.error('[Google 3D tiles]', e.error, e.url);
      // A few failed tiles are normal; the root failing, or nothing loading at all, is not.
      if (!t.root || t.visibleTiles.size === 0) setGoogleTilesStatus({ state: 'error', message: explainTileError(e.error), tiles: 0 });
    };
    t.addEventListener('load-error', onError as never);
    t.addEventListener('load-root-tileset', () => setGoogleTilesStatus({ state: 'loading', message: 'Loading tiles…' }));
    t.addEventListener('tile-visibility-change', refreshCredits);
    t.addEventListener('load-tileset', refreshCredits);
    const wake = () => invalidate();
    t.addEventListener('needs-update', wake);
    t.addEventListener('tiles-load-end', wake);

    // Match the tiles' ground to the site's. Google measures heights from the reference ellipsoid
    // and the site from sea level, which differ by tens of metres, so the height is read off the
    // tiles themselves: how high their lowest surface sits over the site's ground, at a grid of
    // points. It repeats while more detailed tiles arrive, until two readings agree.
    const ray = new THREE.Raycaster();
    let lastReading: number | null = null;
    let steady = 0;
    let readings = 0;
    const align = () => {
      const meshes: TileMesh[] = [];
      t.forEachLoadedModel((root, tile) => {
        if (!t.visibleTiles.has(tile)) return;
        root.traverse(o => { if ((o as TileMesh).isMesh) meshes.push(o as TileMesh); });
      });
      if (!meshes.length) return;
      t.group.updateMatrixWorld(true);
      const samples: { tiles: number; ground: number }[] = [];
      const half = siteSizeRef.current * 0.4;
      for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
        const x = (i / 3) * half, z = (j / 3) * half;
        ray.set(new THREE.Vector3(x, 5000, z), new THREE.Vector3(0, -1, 0));
        let lowest = Infinity;
        for (const mesh of meshes) {
          const hits: THREE.Intersection[] = [];
          (mesh.userData.pfRaycast ?? THREE.Mesh.prototype.raycast).call(mesh, ray, hits);
          for (const h of hits) if (h.point.y < lowest) lowest = h.point.y;
        }
        // What the tiles read with no lifting at all: where they are now, less the lift now applied.
        if (Number.isFinite(lowest)) samples.push({ tiles: lowest - liftRef.current, ground: groundAtRef.current(x, z) });
      }
      if (samples.length < 6) return;
      const auto = estimateLift(samples);
      readings++;
      steady = lastReading !== null && Math.abs(auto - lastReading) < 0.3 ? steady + 1 : 0;
      lastReading = auto;
      setAutoLift(auto);
      setAligned(true);
      setGoogleTilesStatus({ lift: auto });
    };
    // Every second until steady (or 60 readings), and whenever a batch of tiles finishes loading.
    const interval = setInterval(() => { if (steady >= 2 || readings >= 60) return; align(); }, 1000);
    const onLoadEnd = () => { steady = 0; };
    t.addEventListener('tiles-load-end', onLoadEnd);
    const giveUp = setTimeout(() => setAligned(true), 12000);

    scene.add(t.group);
    setTiles(t);
    return () => {
      clearTimeout(giveUp);
      clearInterval(interval);
      setGoogleTilesStatus({ state: 'off', message: '', tiles: 0, lift: null });
      scene.remove(t.group);
      flattenRef.current = null;
      flatShapes.current = [];
      t.dispose();
      setTiles(null);
      setAligned(false);
      setCredits([]);
    };
  }, [apiKey, site.lat, site.lng, site.elevation, camera, gl, scene, invalidate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Where the tiles sit, and whether they show yet.
  useEffect(() => {
    if (!tiles) return;
    tiles.group.matrix.fromArray(tilesToSiteMatrix(site.lat, site.lng, site.elevation, lift));
    tiles.group.matrixWorldNeedsUpdate = true;
    tiles.group.updateMatrixWorld(true);
    tiles.group.visible = true;
    invalidate();
  }, [tiles, site.lat, site.lng, site.elevation, lift, aligned, invalidate]);

  // The cut-out follows the mode and the site's size.
  useEffect(() => {
    if (!tiles) return;
    tiles.forEachLoadedModel(root => {
      root.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          m.clippingPlanes = cut ? planes : null;
          m.clipIntersection = true;
          m.needsUpdate = true;
        }
      });
    });
    invalidate();
  }, [tiles, cut, planes, invalidate]);

  // In Google-site mode, press Google's mesh flat wherever the designer has taken over: edited or
  // deleted imported buildings (where they stood and where they stand now) and anything new.
  const shapesRef = useRef(shapes);
  shapesRef.current = shapes;
  const existingRef = useRef(existing);
  existingRef.current = existing;
  useEffect(() => {
    const flatten = flattenRef.current;
    if (!tiles || !flatten) return;
    const clear = () => {
      for (const m of flatShapes.current) { if (flatten.hasShape(m)) flatten.deleteShape(m); m.geometry.dispose(); }
      flatShapes.current = [];
    };
    if (cut) { clear(); invalidate(); return; }
    // Let the scene catch up with the edit first, and don't redo it on every frame of a drag.
    const timer = setTimeout(() => {
      try {
        clear();
        const positions = collectFootprints(scene, shapesRef.current, existingRef.current, groundAtRef.current);
        if (positions.length >= 9) {
          const toLocal = new THREE.Matrix4().fromArray(tilesToSiteMatrix(site.lat, site.lng, site.elevation, liftRef.current)).invert();
          const up = new THREE.Vector3(0, 1, 0).transformDirection(toLocal).normalize();
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
          geometry.applyMatrix4(toLocal);
          const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
          // (The package's typings still show the old numeric signature.)
          (flatten as unknown as { addShape(m: THREE.Mesh, d: THREE.Vector3, o: { threshold: number }): void }).addShape(mesh, up, { threshold: Infinity });
          flatShapes.current.push(mesh);
        }
      } catch (err) {
        console.error('[Google 3D tiles] could not press the tiles flat under the edited buildings', err);
      }
      invalidate();
    }, 250);
    return () => clearTimeout(timer);
  }, [tiles, cut, shapes, kernelRevision, lift, site.lat, site.lng, site.elevation, scene, invalidate]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame(() => {
    if (!tiles) return;
    tiles.setResolutionFromRenderer(camera, gl);
    camera.updateMatrixWorld();
    tiles.update();
  });

  if (!tiles) return null;
  const notes = credits.filter(c => c.type === 'string' && typeof c.value === 'string').map(c => c.value as string);
  return (
    <Html fullscreen zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
      <div className="absolute left-2 bottom-2 max-w-[60%] text-[10px] leading-tight text-white/90 pointer-events-none select-none" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.9)' }}>
        <span className="font-semibold text-xs">Google</span>
        {notes.length > 0 && <span className="ml-2">{notes.join(' · ')}</span>}
      </div>
    </Html>
  );
}
