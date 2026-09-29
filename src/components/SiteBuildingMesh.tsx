import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { Shape, SiteBuildingData, SiteBuildingSnapshot } from '../types';
import { pitchedBuildingGeometry } from '../lib/worldSite/roofGeometry';
import type { BuildingLook } from '../lib/worldSite/googleTiles';

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
const edges = new THREE.LineBasicMaterial({ color: '#8d8b85', transparent: true, opacity: 0.55 });
const ghostSolid = new THREE.MeshBasicMaterial({ color: '#7aa7d6', transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide });
const ghostEdges = new THREE.LineBasicMaterial({ color: '#3b82f6', transparent: true, opacity: 0.8 });

function useSiteGeometry(data: SiteBuildingData | undefined) {
  const key = data ? JSON.stringify([data.footprint, data.holes, data.height, data.minHeight, data.roof?.planes]) : '';
  const solidGeo = useMemo(() => (data ? siteBuildingGeometry(data) : null), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const edgeGeo = useMemo(() => (solidGeo ? new THREE.EdgesGeometry(solidGeo, 25) : null), [solidGeo]);
  useEffect(() => () => { solidGeo?.dispose(); edgeGeo?.dispose(); }, [solidGeo, edgeGeo]);
  return { solidGeo, edgeGeo };
}

/** How styled buildings look: walls and roof colours, and the satellite picture the roofs are cut from. */
export interface SiteStyle {
  look: BuildingLook;
  /** The site's satellite picture (north up, covering `size` metres square centred on the origin). */
  satelliteUrl: string | null;
  size: number;
}

const satelliteTextures = new Map<string, THREE.Texture>();
/** The satellite picture as a texture, once loaded (null until then, and when there is none). */
function useSatelliteTexture(url: string | null): THREE.Texture | null {
  const [tex, setTex] = React.useState<THREE.Texture | null>(() => (url ? satelliteTextures.get(url) ?? null : null));
  useEffect(() => {
    if (!url) { setTex(null); return; }
    const cached = satelliteTextures.get(url);
    if (cached) { setTex(cached); return; }
    let alive = true;
    new THREE.TextureLoader().setCrossOrigin('anonymous').load(url, t => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      satelliteTextures.set(url, t);
      if (alive) setTex(t);
    }, undefined, () => { /* no picture: roofs use their plain colour */ });
    return () => { alive = false; };
  }, [url]);
  return tex;
}

/**
 * A building's material when styled: walls in one colour, and anything facing up (the roof) cut
 * from the satellite picture at its own place, else in the roof colour.
 */
function makeStyledMaterial(look: BuildingLook, size: number): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, metalness: 0 });
  const uniforms = {
    uWall: { value: new THREE.Color(look.wall) },
    uRoof: { value: new THREE.Color(look.roof) },
    uSat: { value: null as THREE.Texture | null },
    uHasSat: { value: 0 },
    uSize: { value: size },
  };
  material.userData.styled = uniforms;
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSbPos;\nvarying vec3 vSbNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSbPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvSbNormal = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSbPos;\nvarying vec3 vSbNormal;\nuniform vec3 uWall;\nuniform vec3 uRoof;\nuniform sampler2D uSat;\nuniform float uHasSat;\nuniform float uSize;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float sbRoof = smoothstep(0.35, 0.6, vSbNormal.y);
        vec3 sbRoofColour = uRoof;
        if (uHasSat > 0.5) {
          vec2 sbUv = vec2((vSbPos.x + uSize * 0.5) / uSize, (uSize * 0.5 - vSbPos.z) / uSize);
          sbRoofColour = texture2D(uSat, sbUv).rgb;
        }
        diffuseColor.rgb = mix(uWall, sbRoofColour, sbRoof);`);
  };
  material.customProgramCacheKey = () => 'pf-styled-building';
  return material;
}

interface Props {
  shape: Shape;
  meshProps: Record<string, unknown>;
  selected: boolean;
  showEdges?: boolean;
  /** Set when the site's buildings are styled. */
  style?: SiteStyle | undefined;
}

/** Has the building been given a plain colour of its own (so styling leaves it alone)? */
const isPainted = (color: string | undefined) => !!color && color.toLowerCase() !== '#f1f0ec' && /^#[0-9a-f]{6}$/i.test(color);

export function SiteBuildingMesh({ shape, meshProps, selected, showEdges = true, style }: Props) {
  const { solidGeo, edgeGeo } = useSiteGeometry(shape.siteBuildingData);
  const satellite = useSatelliteTexture(style && !isPainted(shape.color) ? style.satelliteUrl : null);
  const styled = useMemo(() => (style && !isPainted(shape.color) ? makeStyledMaterial(style.look, style.size) : null), [style?.look.wall, style?.look.roof, style?.size, shape.color]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => styled?.dispose(), [styled]);
  if (styled) {
    const u = styled.userData.styled as { uSat: { value: THREE.Texture | null }; uHasSat: { value: number } };
    u.uSat.value = satellite;
    u.uHasSat.value = satellite ? 1 : 0;
    styled.emissive.set(selected ? '#0063A3' : '#000000');
    styled.emissiveIntensity = selected ? 0.45 : 0;
  }
  // White unless it has been given another plain colour.
  const painted = shape.color && shape.color.toLowerCase() !== '#f1f0ec' && /^#[0-9a-f]{6}$/i.test(shape.color);
  const material = useMemo(() => {
    if (!painted) return null;
    return new THREE.MeshStandardMaterial({ color: shape.color, roughness: 0.9, metalness: 0 });
  }, [painted, shape.color]);
  useEffect(() => () => material?.dispose(), [material]);
  if (!solidGeo) return null;
  if (material) {
    material.emissive.set(selected ? '#0063A3' : '#000000');
    material.emissiveIntensity = selected ? 0.45 : 0;
  }
  return (
    <mesh {...meshProps} geometry={solidGeo} material={styled ?? material ?? (selected ? selectedSolid : solid)}>
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
