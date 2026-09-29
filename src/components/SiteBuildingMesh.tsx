import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import type { Shape, SiteBuildingData, SiteBuildingSnapshot } from '../types';
import { pitchedBuildingGeometry } from '../lib/worldSite/roofGeometry';
import { buildingProfile } from '../lib/worldSite/buildingStyle';
import { styledBuildingGeometry } from '../lib/worldSite/styledGeometry';
import { createStyleKit, type StyleKit } from '../lib/worldSite/styleKit';
import { sampleRoofColour } from '../lib/worldSite/roofSample';

// Existing buildings on an imported World View site: white-model blocks from their map outline
// and height (see lib/worldSite/buildings.ts). They are drawn as simply as possible, as a site
// can have hundreds: one plain solid and its outline edges each, all sharing the same materials.

/** A building's solid, in its own frame (origin on its lowest ground, footprint in x/z). */
export function siteBuildingGeometry(data: SiteBuildingData): THREE.BufferGeometry | null {
  if (data.footprint.length < 3) return null;
  // A LiDAR-fitted pitched roof; otherwise a flat-topped block.
  const pitched = pitchedBuildingGeometry(data);
  if (pitched) return pitched;
  // Drawn in x / -z, then stood up: extruding along +z and turning -90° about x makes +z the height.
  const outline = new THREE.Shape(data.footprint.map(([x, z]) => new THREE.Vector2(x, -z)));
  for (const hole of data.holes ?? []) {
    if (hole.length >= 3) outline.holes.push(new THREE.Path(hole.map(([x, z]) => new THREE.Vector2(x, -z))));
  }
  const bottom = Math.max(0, data.minHeight ?? 0);
  const depth = Math.max(0.1, data.height - bottom);
  const geometry = new THREE.ExtrudeGeometry(outline, { depth, bevelEnabled: false, curveSegments: 1 });
  geometry.rotateX(-Math.PI / 2);
  if (bottom) geometry.translate(0, bottom, 0);
  geometry.computeVertexNormals();
  return geometry;
}

const solid = new THREE.MeshStandardMaterial({ color: '#f1f0ec', roughness: 0.9, metalness: 0 });
const selectedSolid = new THREE.MeshStandardMaterial({ color: '#f1f0ec', roughness: 0.9, metalness: 0, emissive: new THREE.Color('#0063A3'), emissiveIntensity: 0.45 });
const invisible = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
const edges = new THREE.LineBasicMaterial({ color: '#8d8b85', transparent: true, opacity: 0.55 });
const selectedGlow = new THREE.MeshBasicMaterial({ color: '#0063A3', transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
const ghostSolid = new THREE.MeshBasicMaterial({ color: '#7aa7d6', transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide });
const ghostEdges = new THREE.LineBasicMaterial({ color: '#3b82f6', transparent: true, opacity: 0.8 });

function useSiteGeometry(data: SiteBuildingData | undefined) {
  const key = data ? JSON.stringify([data.footprint, data.holes, data.height, data.minHeight, data.roof?.planes]) : '';
  const solidGeo = useMemo(() => (data ? siteBuildingGeometry(data) : null), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const edgeGeo = useMemo(() => (solidGeo ? new THREE.EdgesGeometry(solidGeo, 25) : null), [solidGeo]);
  useEffect(() => () => { solidGeo?.dispose(); edgeGeo?.dispose(); }, [solidGeo, edgeGeo]);
  return { solidGeo, edgeGeo };
}

/** How styled buildings are dressed: the satellite picture their roof colour is read from. */
export interface SiteStyle {
  /** The site's satellite picture (north up, covering `size` metres square centred on the origin). */
  satelliteUrl: string | null;
  size: number;
}

const kits = new WeakMap<THREE.WebGLRenderer, StyleKit>();
function useStyleKit(): StyleKit {
  const gl = useThree(s => s.gl);
  let kit = kits.get(gl);
  if (!kit) { kit = createStyleKit(gl); kits.set(gl, kit); }
  return kit;
}

/** The colour of this building's roof as seen from above (null until read, or when it can't be). */
function useRoofColour(style: SiteStyle | undefined, shape: Shape): string | null {
  const [colour, setColour] = useState<string | null>(null);
  const data = shape.siteBuildingData;
  const url = style?.satelliteUrl ?? null;
  useEffect(() => {
    setColour(null);
    if (!url || !data || !style) return;
    let alive = true;
    void sampleRoofColour(url, style.size, [shape.position[0], shape.position[2]], data.footprint).then(c => { if (alive) setColour(c); });
    return () => { alive = false; };
  }, [url, style?.size, shape.position[0], shape.position[2], data?.footprint]); // eslint-disable-line react-hooks/exhaustive-deps
  return colour;
}

interface Props {
  shape: Shape;
  meshProps: Record<string, unknown>;
  selected: boolean;
  showEdges?: boolean;
  /** Set when the site's buildings are styled. */
  style?: SiteStyle | undefined;
  /** Google's own version of this building is showing: keep this one invisible but clickable. */
  ghost?: boolean;
}

/** Has the building been given a plain colour of its own (so styling leaves it alone)? */
const isPainted = (color: string | undefined) => !!color && color.toLowerCase() !== '#f1f0ec' && /^#[0-9a-f]{6}$/i.test(color);

export function SiteBuildingMesh({ shape, meshProps, selected, showEdges = true, style, ghost = false }: Props) {
  const { solidGeo, edgeGeo } = useSiteGeometry(shape.siteBuildingData);
  const kit = useStyleKit();
  const dressed = !!style && !isPainted(shape.color);
  const sampledRoof = useRoofColour(dressed ? style : undefined, shape);
  const profile = useMemo(() => (dressed && shape.siteBuildingData ? buildingProfile(shape.siteBuildingData, sampledRoof) : null), [dressed, shape.siteBuildingData, sampledRoof]);
  const styledGeo = useMemo(() => (profile && solidGeo ? styledBuildingGeometry(solidGeo, profile) : null), [profile, solidGeo]);
  useEffect(() => () => styledGeo?.dispose(), [styledGeo]);
  const styledMaterials = useMemo(() => (profile ? [kit.wall(profile.wall), kit.roof(profile.roof)] : null), [kit, profile?.wall, profile?.roof]); // eslint-disable-line react-hooks/exhaustive-deps
  // White unless it has been given another plain colour.
  const painted = shape.color && shape.color.toLowerCase() !== '#f1f0ec' && /^#[0-9a-f]{6}$/i.test(shape.color);
  const material = useMemo(() => {
    if (!painted) return null;
    return new THREE.MeshStandardMaterial({ color: shape.color, roughness: 0.9, metalness: 0 });
  }, [painted, shape.color]);
  useEffect(() => () => material?.dispose(), [material]);
  if (!solidGeo) return null;
  // Google's version is showing: nothing is drawn, but the building can still be picked.
  if (ghost && !selected) return <mesh {...meshProps} castShadow={false} receiveShadow={false} geometry={solidGeo} material={invisible} />;
  if (material) {
    material.emissive.set(selected ? '#0063A3' : '#000000');
    material.emissiveIntensity = selected ? 0.45 : 0;
  }
  if (styledGeo && styledMaterials) {
    return (
      <mesh {...meshProps} geometry={styledGeo} material={styledMaterials}>
        {selected && <mesh geometry={styledGeo} material={selectedGlow} raycast={() => null} renderOrder={2} />}
      </mesh>
    );
  }
  return (
    <mesh {...meshProps} geometry={solidGeo} material={material ?? (selected ? selectedSolid : solid)}>
      {showEdges && edgeGeo && <lineSegments geometry={edgeGeo} material={edges} raycast={() => null} />}
    </mesh>
  );
}

/** A deleted building drawn see-through where it stood, for before-and-after. Can't be picked. */
function Ghost({ snapshot }: { snapshot: SiteBuildingSnapshot }) {
  const { solidGeo, edgeGeo } = useSiteGeometry(snapshot.data);
  if (!solidGeo) return null;
  return (
    <group position={snapshot.position}>
      <mesh geometry={solidGeo} material={ghostSolid} raycast={() => null} renderOrder={3} />
      {edgeGeo && <lineSegments geometry={edgeGeo} material={ghostEdges} raycast={() => null} renderOrder={4} />}
    </group>
  );
}

export function SiteGhosts({ removed }: { removed: SiteBuildingSnapshot[] }) {
  return <>{removed.map(r => <Ghost key={r.id} snapshot={r} />)}</>;
}
