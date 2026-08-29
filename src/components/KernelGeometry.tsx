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

import { useMemo } from 'react';
import * as THREE from 'three';
// Importing from fiber also loads its JSX augmentation, which is what makes
// <mesh>, <group> and <lineSegments> type-check. Without an import from the
// package the intrinsics are not registered.
import type { ThreeEvent } from '@react-three/fiber';
import type { EdgeId, FaceId, Graph } from '../lib/geometry/types';
import { tessellateFace, tessellateGraph, mergeBuffers, edgeBuffer } from '../lib/geometry/tessellate';
import { facesByMaterial } from '../tools/kernelSelection';

export interface KernelGeometryProps {
  graph: Graph;
  /** Bump this whenever the graph mutates, so the mesh rebuilds. */
  revision?: number;
  selectedFaces?: ReadonlySet<FaceId>;
  onFaceClick?: (faceId: FaceId, event: ThreeEvent<MouseEvent>) => void;
  /**
   * Fires on pointer DOWN, for tools that drag.
   *
   * `onFaceClick` fires on release, which is too late to start a drag: the
   * gesture is already over. Push/pull needs the press.
   *
   * Returns whether it actually consumed the press. Only push/pull wants
   * one; every other tool (drawing a rectangle on a wall, for instance)
   * needs the SAME press to keep travelling down to the invisible ground
   * plane where Viewport's own pointer-down logic lives. Stopping
   * propagation unconditionally here — regardless of what the handler did
   * with it — silently swallowed every one of those presses: nothing beneath
   * a kernel face could ever be reached by a click starting on it, because
   * the event never left this mesh.
   */
  onFacePointerDown?: (faceId: FaceId, event: ThreeEvent<PointerEvent>) => boolean | void;
  onEdgeClick?: (edgeId: EdgeId, event: ThreeEvent<MouseEvent>) => void;
  /**
   * These four mirror the app's own edge-line settings exactly
   * (edgeLinesEnabled/Color/Opacity/Thickness in AppContext) — Shape edges
   * already read them; kernel edges rendered their own hardcoded look
   * regardless, which is why the settings panel had no visible effect on
   * anything kernel-derived.
   */
  showEdges?: boolean;
  edgeColor?: string;
  edgeOpacity?: number;
  edgeLineWidth?: number;
  /** Fallback for faces with no material of their own. */
  defaultColor?: string;
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
  onFaceClick,
  onFacePointerDown,
  onEdgeClick,
  showEdges = true,
  edgeColor = DEFAULT_EDGE,
  edgeOpacity = 1,
  edgeLineWidth = 1,
  defaultColor = DEFAULT_FACE,
  selectedColor = DEFAULT_SELECTED,
  opacity = 1,
}: KernelGeometryProps) {

  /**
   * One mesh per material.
   *
   * A single merged mesh can only carry one material, so painting a face
   * would have no visible effect. Grouping by colour is what makes the paint
   * tool work on kernel geometry at all. Hidden faces are excluded here.
   */
  const groups = useMemo(() => {
    const out: { color: string; geometry: THREE.BufferGeometry; faceOfTriangle: FaceId[] }[] = [];
    for (const [color, faceIds] of facesByMaterial(graph)) {
      const meshes = faceIds
        .map((id) => tessellateFace(graph, id))
        .filter((m): m is NonNullable<typeof m> => m !== null);
      if (meshes.length === 0) continue;

      const merged = mergeBuffers(meshes);
      const geo = new THREE.BufferGeometry();
      // The f64 -> f32 boundary, and the only correct place for it.
      geo.setAttribute('position', new THREE.BufferAttribute(merged.position, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(merged.normal, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(merged.uv, 2));
      geo.setIndex(new THREE.BufferAttribute(merged.index, 1));
      geo.computeBoundingSphere();
      out.push({ color, geometry: geo, faceOfTriangle: merged.faceOfTriangle });
    }
    return out;
  }, [graph, revision]);

  const { lineGeometry, edgeOfSegment, boundaryGeometry } = useMemo(() => {
    const data = tessellateGraph(graph);
    const hiddenFaces = new Set(
      [...graph.faces.values()].filter((f) => f.attributes.hidden).map((f) => f.id),
    );
    // An edge stays drawn unless every face using it is hidden.
    const visible = data.edges.filter((e) => {
      if (e.hidden) return false;
      const edge = graph.edges.get(e.edgeId);
      if (!edge || edge.uses.length === 0) return true;
      return edge.uses.some((u) => {
        const loop = graph.loops.get(u.loop);
        return loop ? !hiddenFaces.has(loop.face) : true;
      });
    });

    const { position, edgeOfSegment: segMap } = edgeBuffer(visible);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(position, 3));

    const heavy = visible.filter((e) => e.classification !== 'manifold');
    const heavyPos = new Float32Array(heavy.length * 6);
    heavy.forEach((e, i) => {
      heavyPos.set([e.a.x, e.a.y, e.a.z, e.b.x, e.b.y, e.b.z], i * 6);
    });
    const boundaryGeo = new THREE.BufferGeometry();
    boundaryGeo.setAttribute('position', new THREE.BufferAttribute(heavyPos, 3));

    return { lineGeometry: lineGeo, edgeOfSegment: segMap, boundaryGeometry: boundaryGeo };
  }, [graph, revision]);

  const hasSelection = (selectedFaces?.size ?? 0) > 0;

  return (
    <group name="kernel-geometry">
      {groups.map((g) => (
        <mesh
          key={g.color}
          geometry={g.geometry}
          castShadow
          receiveShadow
          userData={{ isKernelGeometry: true, faceOfTriangle: g.faceOfTriangle }}
          onPointerDown={(event) => {
            if (!onFacePointerDown) return;
            const triangle = event.faceIndex;
            if (triangle === undefined || triangle === null) return;
            const faceId = g.faceOfTriangle[triangle];
            if (faceId === undefined) return;
            // Only claim the press if the handler actually wants it. See the
            // prop's doc comment: stopping unconditionally here is what
            // silently broke every OTHER tool's ability to start on a
            // kernel face at all.
            if (onFacePointerDown(faceId, event)) event.stopPropagation();
          }}
          onClick={(event) => {
            if (!onFaceClick) return;
            const triangle = event.faceIndex;
            if (triangle === undefined || triangle === null) return;
            // A raycast returns a TRIANGLE; the user selected a FACE.
            const faceId = g.faceOfTriangle[triangle];
            if (faceId === undefined) return;
            event.stopPropagation();
            onFaceClick(faceId, event);
          }}
        >
          <meshStandardMaterial
            color={g.color === DEFAULT_FACE ? defaultColor : g.color}
            side={THREE.DoubleSide}
            transparent={opacity < 1}
            opacity={opacity}
            roughness={0.85}
            metalness={0}
          />
        </mesh>
      ))}

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
          {/*
            `linewidth` on a raw lineBasicMaterial is mostly ignored by
            WebGL regardless of platform — a three.js limitation, not
            something specific to kernel edges. Passed through for parity
            with the Shape-edge rendering anyway, which has the same ceiling.
          */}
          <lineSegments geometry={lineGeometry} frustumCulled={false}>
            <lineBasicMaterial
              color={edgeColor}
              transparent
              opacity={edgeOpacity * 0.55}
              linewidth={edgeLineWidth}
            />
          </lineSegments>
          <lineSegments geometry={boundaryGeometry} frustumCulled={false}>
            <lineBasicMaterial
              color={edgeColor}
              transparent={edgeOpacity < 1}
              opacity={edgeOpacity}
              linewidth={edgeLineWidth}
            />
          </lineSegments>
        </>
      )}

      {onEdgeClick && (
        <EdgePickTargets
          graph={graph}
          revision={revision}
          edgeOfSegment={edgeOfSegment}
          onEdgeClick={onEdgeClick}
        />
      )}

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
  onEdgeClick,
}: {
  graph: Graph;
  revision: number;
  edgeOfSegment: EdgeId[];
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
    </group>
  );
}

export default KernelGeometry;
