/**
 * PolyForm — kernel render bridge. Phase 9b.
 *
 * Draws kernel-derived faces and edges alongside the existing `Shape[]`
 * primitives. Read-only: this component never mutates the graph.
 *
 * Coexistence, as decided in the Phase 0a audit: the kernel owns DRAWN
 * geometry (lines, arcs, rectangles, polygons, and later push/pull), while
 * `Shape[]` keeps primitives, plants and terrain. A given object lives in
 * exactly one of the two. Nothing here touches `Shape` rendering.
 *
 * Drop into src/components/. Mount inside your existing <Canvas>.
 */

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
// Importing from fiber also loads its JSX augmentation, which is what makes
// <mesh>, <group> and <lineSegments> type-check. Without an import from the
// package the intrinsics are not registered.
import type { ThreeEvent } from '@react-three/fiber';
import type { EdgeId, FaceId, Graph } from '../lib/geometry/types';
import { tessellateGraph, mergeBuffers, edgeBuffer } from '../lib/geometry/tessellate';

export interface KernelGeometryProps {
  graph: Graph;
  /** Bump this whenever the graph mutates, so the mesh rebuilds. */
  revision?: number;
  selectedFaces?: ReadonlySet<FaceId>;
  selectedEdges?: ReadonlySet<EdgeId>;
  onFaceClick?: (faceId: FaceId, event: ThreeEvent<MouseEvent>) => void;
  onEdgeClick?: (edgeId: EdgeId, event: ThreeEvent<MouseEvent>) => void;
  /** Resolves a kernel material name to a three material. */
  resolveMaterial?: (name: string | null) => THREE.Material | null;
  showEdges?: boolean;
  edgeColor?: string;
  faceColor?: string;
  backFaceColor?: string;
  selectedColor?: string;
  opacity?: number;
}

const DEFAULT_FACE = '#d8d4cc';
const DEFAULT_BACK = '#8f9ba8';
const DEFAULT_EDGE = '#2b2b2b';
const DEFAULT_SELECTED = '#3b82f6';

export function KernelGeometry({
  graph,
  revision = 0,
  selectedFaces,
  selectedEdges,
  onFaceClick,
  onEdgeClick,
  resolveMaterial,
  showEdges = true,
  edgeColor = DEFAULT_EDGE,
  faceColor = DEFAULT_FACE,
  backFaceColor = DEFAULT_BACK,
  selectedColor = DEFAULT_SELECTED,
  opacity = 1,
}: KernelGeometryProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  const { geometry, faceOfTriangle, lineGeometry, edgeOfSegment, boundaryGeometry } =
    useMemo(() => {
      const data = tessellateGraph(graph);
      const merged = mergeBuffers(data.faces);

      const geo = new THREE.BufferGeometry();
      // The f64 -> f32 boundary, and the only correct place for it. Kernel
      // coordinates stay double precision; at 10^6 units f32 resolves to
      // ~0.06, far coarser than COPLANARITY_TOLERANCE.
      geo.setAttribute('position', new THREE.BufferAttribute(merged.position, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(merged.normal, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(merged.uv, 2));
      geo.setIndex(new THREE.BufferAttribute(merged.index, 1));
      geo.computeBoundingSphere();

      const visible = data.edges.filter((e) => !e.hidden);
      const { position, edgeOfSegment: segMap } = edgeBuffer(data.edges);
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.BufferAttribute(position, 3));

      // Boundary and non-manifold edges are drawn heavier, so holes and stray
      // geometry are visible without running a diagnostic. §2.4
      const heavy = visible.filter((e) => e.classification !== 'manifold');
      const heavyPos = new Float32Array(heavy.length * 6);
      heavy.forEach((e, i) => {
        heavyPos.set([e.a.x, e.a.y, e.a.z, e.b.x, e.b.y, e.b.z], i * 6);
      });
      const boundaryGeo = new THREE.BufferGeometry();
      boundaryGeo.setAttribute('position', new THREE.BufferAttribute(heavyPos, 3));

      return {
        geometry: geo,
        faceOfTriangle: merged.faceOfTriangle,
        lineGeometry: lineGeo,
        edgeOfSegment: segMap,
        boundaryGeometry: boundaryGeo,
      };
      // `revision` is the invalidation signal: Graph is mutated in place, so
      // an identity check on it would never fire.
    }, [graph, revision]);

  const material = useMemo(() => {
    const custom = resolveMaterial?.(null);
    if (custom) return custom;
    return new THREE.MeshStandardMaterial({
      color: faceColor,
      side: THREE.DoubleSide,
      transparent: opacity < 1,
      opacity,
      roughness: 0.85,
      metalness: 0.0,
      flatShading: false,
    });
  }, [resolveMaterial, faceColor, opacity]);

  const hasSelection = (selectedFaces?.size ?? 0) > 0;

  return (
    <group name="kernel-geometry">
      <mesh
        ref={meshRef}
        geometry={geometry}
        material={material}
        castShadow
        receiveShadow
        onClick={(event) => {
          if (!onFaceClick) return;
          const triangle = event.faceIndex;
          if (triangle === undefined || triangle === null) return;
          const faceId = faceOfTriangle[triangle];
          // A raycast returns a TRIANGLE; the user selected a FACE. The
          // triangle -> face map is what makes selection mean the right thing.
          if (faceId !== undefined) {
            event.stopPropagation();
            onFaceClick(faceId, event);
          }
        }}
      />

      {hasSelection && (
        <SelectionOverlay
          graph={graph}
          revision={revision}
          faces={selectedFaces!}
          color={selectedColor}
        />
      )}

      {showEdges && (
        <>
          <lineSegments geometry={lineGeometry} frustumCulled={false}>
            <lineBasicMaterial color={edgeColor} transparent opacity={0.55} />
          </lineSegments>
          <lineSegments geometry={boundaryGeometry} frustumCulled={false}>
            <lineBasicMaterial color={edgeColor} />
          </lineSegments>
        </>
      )}

      {onEdgeClick && (
        <EdgePickTargets
          graph={graph}
          revision={revision}
          edgeOfSegment={edgeOfSegment}
          selected={selectedEdges}
          onEdgeClick={onEdgeClick}
        />
      )}

      {/* backFaceColor is reserved for a front/back shading pass. */}
      <group visible={false} name={`back-${backFaceColor}`} />
    </group>
  );
}

/** Highlights selected faces without rebuilding the main mesh. */
function SelectionOverlay({
  graph,
  revision,
  faces,
  color,
}: {
  graph: Graph;
  revision: number;
  faces: ReadonlySet<FaceId>;
  color: string;
}) {
  const geometry = useMemo(() => {
    const data = tessellateGraph(graph);
    const chosen = data.faces.filter((f) => faces.has(f.faceId));
    const merged = mergeBuffers(chosen);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(merged.position, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(merged.normal, 3));
    geo.setIndex(new THREE.BufferAttribute(merged.index, 1));
    return geo;
  }, [graph, revision, faces]);

  return (
    <mesh geometry={geometry} renderOrder={2}>
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.35}
        side={THREE.DoubleSide}
        depthTest={false}
      />
    </mesh>
  );
}

/**
 * Invisible thickened cylinders for edge picking.
 *
 * Raw lines are close to unclickable at any sensible zoom, so picking gets its
 * own proxy geometry. Kept separate from the visible lines so render weight
 * and hit radius can be tuned independently — the hit radius should track
 * SNAP_RADIUS_PX, and needs to roughly double on touch.
 */
function EdgePickTargets({
  graph,
  revision,
  edgeOfSegment,
  selected,
  onEdgeClick,
}: {
  graph: Graph;
  revision: number;
  edgeOfSegment: EdgeId[];
  selected?: ReadonlySet<EdgeId>;
  onEdgeClick: (edgeId: EdgeId, event: ThreeEvent<MouseEvent>) => void;
}) {
  const segments = useMemo(() => {
    const data = tessellateGraph(graph);
    return data.edges
      .filter((e) => !e.hidden)
      .map((e) => {
        const a = new THREE.Vector3(e.a.x, e.a.y, e.a.z);
        const b = new THREE.Vector3(e.b.x, e.b.y, e.b.z);
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const dir = b.clone().sub(a);
        const len = dir.length();
        const quat = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          dir.clone().normalize(),
        );
        return { id: e.edgeId, mid, quat, len };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, revision]);

  void edgeOfSegment;

  return (
    <group name="edge-pick-targets">
      {segments.map((s) => (
        <mesh
          key={s.id}
          position={s.mid}
          quaternion={s.quat}
          visible={false}
          onClick={(event) => {
            event.stopPropagation();
            onEdgeClick(s.id, event);
          }}
        >
          <cylinderGeometry args={[0.05, 0.05, s.len, 6, 1]} />
          <meshBasicMaterial />
        </mesh>
      ))}
      {selected && selected.size > 0 && (
        <group name="selected-edges">
          {segments
            .filter((s) => selected.has(s.id))
            .map((s) => (
              <mesh key={`sel-${s.id}`} position={s.mid} quaternion={s.quat}>
                <cylinderGeometry args={[0.02, 0.02, s.len, 6, 1]} />
                <meshBasicMaterial color={DEFAULT_SELECTED} depthTest={false} />
              </mesh>
            ))}
        </group>
      )}
    </group>
  );
}

export default KernelGeometry;
