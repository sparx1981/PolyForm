import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { TilesRenderer } from '3d-tiles-renderer/three';
import { GoogleCloudAuthPlugin, TileFlatteningPlugin } from '3d-tiles-renderer/plugins';
import type { Shape, WorldSiteInfo } from '../types';
import { cutoutPlanes, estimateLift, tilesToSiteMatrix } from '../lib/worldSite/googleTiles';

// Google's Photorealistic 3D Tiles around an imported World View site (see
// lib/worldSite/googleTiles.ts). A viewing layer only: it can't be picked, measured or exported.
// Over the site it is either cut away (the editable satellite ground shows there) or, in
// 'google' ground mode, kept, with Google's buildings flattened under the editable ones.

const TILES_URL = 'https://tile.googleapis.com/v1/3dtiles/root.json';
const noRaycast = () => {};

interface Props {
  site: WorldSiteInfo;
  apiKey: string;
  buildings: Shape[];
  /** The editable ground's height (model y) at a plan point. */
  groundAt: (x: number, z: number) => number;
}

type TileMesh = THREE.Mesh & { userData: { pfRaycast?: THREE.Mesh['raycast'] } };

/** Footprint of a site building as a flat triangle mesh at its base, in world coordinates. */
function footprintGeometry(shape: Shape): THREE.BufferGeometry | null {
  const data = shape.siteBuildingData;
  if (!data || data.footprint.length < 3) return null;
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...shape.position),
    new THREE.Quaternion(...(shape.quaternion ?? [0, 0, 0, 1])),
    new THREE.Vector3(...(shape.scale ?? [1, 1, 1])),
  );
  const world = (p: [number, number]) => new THREE.Vector3(p[0], 0, p[1]).applyMatrix4(m);
  const outer = data.footprint.map(world);
  const holes = (data.holes ?? []).filter(h => h.length >= 3).map(h => h.map(world));
  const to2 = (v: THREE.Vector3) => new THREE.Vector2(v.x, v.z);
  const tri = THREE.ShapeUtils.triangulateShape(outer.map(to2), holes.map(h => h.map(to2)));
  const verts = [...outer, ...holes.flat()];
  const position = new Float32Array(verts.length * 3);
  verts.forEach((v, i) => position.set([v.x, v.y, v.z], i * 3));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setIndex(tri.flat());
  return geometry;
}

export function GoogleTilesLayer({ site, apiKey, buildings, groundAt }: Props) {
  const { camera, gl, scene, invalidate } = useThree();
  const [tiles, setTiles] = useState<TilesRenderer | null>(null);
  const [autoLift, setAutoLift] = useState(0);
  const [aligned, setAligned] = useState(false);
  const [credits, setCredits] = useState<{ type: string; value: unknown }[]>([]);
  const flattenRef = useRef<TileFlatteningPlugin | null>(null);
  const flatShapes = useRef<THREE.Mesh[]>([]);
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
    const flatten = new TileFlatteningPlugin();
    t.registerPlugin(flatten);
    flattenRef.current = flatten;
    t.group.matrixAutoUpdate = false;
    t.group.visible = false;
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
      queueMicrotask(() => { queued = false; setCredits([...t.getAttributions()]); invalidate(); });
    };
    t.addEventListener('tile-visibility-change', refreshCredits);
    t.addEventListener('load-tileset', refreshCredits);
    const wake = () => invalidate();
    t.addEventListener('needs-update', wake);
    t.addEventListener('tiles-load-end', wake);

    // Match the tiles' ground to the site's once they have loaded.
    let timer: ReturnType<typeof setTimeout> | null = null;
    let passes = 0;
    const align = () => {
      timer = null;
      const ray = new THREE.Raycaster();
      const samples: { tiles: number; ground: number }[] = [];
      const half = site.size * 0.4;
      const meshes: TileMesh[] = [];
      t.activeTiles.forEach(tile => (tile as { engineData?: { scene?: THREE.Object3D } }).engineData?.scene?.traverse(o => { if ((o as TileMesh).isMesh) meshes.push(o as TileMesh); }));
      if (!meshes.length) return;
      t.group.updateMatrixWorld(true);
      for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
        const x = (i / 3) * half, z = (j / 3) * half;
        ray.set(new THREE.Vector3(x, 3000, z), new THREE.Vector3(0, -1, 0));
        let lowest = Infinity;
        for (const mesh of meshes) {
          const hits: THREE.Intersection[] = [];
          (mesh.userData.pfRaycast ?? THREE.Mesh.prototype.raycast).call(mesh, ray, hits);
          for (const h of hits) if (h.point.y < lowest) lowest = h.point.y;
        }
        if (Number.isFinite(lowest)) samples.push({ tiles: lowest - liftRef.current + (site.googleNudge ?? 0), ground: groundAtRef.current(x, z) });
      }
      if (samples.length >= 8) {
        setAutoLift(estimateLift(samples));
        setAligned(true);
      }
      passes++;
    };
    const scheduleAlign = () => {
      if (passes >= 4 || timer) return;
      timer = setTimeout(align, 700);
    };
    t.addEventListener('tiles-load-end', scheduleAlign);
    // If it never settles, show the layer anyway.
    const giveUp = setTimeout(() => setAligned(true), 12000);

    scene.add(t.group);
    setTiles(t);
    return () => {
      clearTimeout(giveUp);
      if (timer) clearTimeout(timer);
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
    tiles.group.visible = aligned;
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

  // In Google-ground mode, press Google's buildings flat under the editable ones.
  const footprintKey = useMemo(
    () => (cut ? '' : JSON.stringify([buildings.map(b => [b.id, b.position, b.quaternion, b.scale, b.siteBuildingData?.footprint, b.siteBuildingData?.holes]), lift, site.lat, site.lng, site.elevation])),
    [cut, buildings, lift, site.lat, site.lng, site.elevation],
  );
  useEffect(() => {
    const flatten = flattenRef.current;
    if (!tiles || !flatten) return;
    for (const m of flatShapes.current) { if (flatten.hasShape(m)) flatten.deleteShape(m); m.geometry.dispose(); }
    flatShapes.current = [];
    if (cut) { invalidate(); return; }
    const toLocal = new THREE.Matrix4().fromArray(tilesToSiteMatrix(site.lat, site.lng, site.elevation, lift)).invert();
    const up = new THREE.Vector3(0, 1, 0).transformDirection(toLocal).normalize();
    for (const b of buildings) {
      const geometry = footprintGeometry(b);
      if (!geometry) continue;
      geometry.applyMatrix4(toLocal);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      // (The package's typings still show the old numeric signature.)
      (flatten as unknown as { addShape(m: THREE.Mesh, d: THREE.Vector3, o: { threshold: number }): void }).addShape(mesh, up, { threshold: Infinity });
      flatShapes.current.push(mesh);
    }
    invalidate();
  }, [tiles, footprintKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
