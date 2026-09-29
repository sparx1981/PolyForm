import { useEffect, useMemo, useRef } from 'react';
import type * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { clippingPlaneOf, sectionLayerOfShape, setSectionPickPlane, type SectionArgs } from '../tools/sectionPlanes';
import { SectionCut } from '../lib/sectionCut';
import type { Shape } from '../types';

/**
 * Applies the active section plane to the scene (lib/sectionCut.ts) and makes picking ignore
 * what it cuts away. Re-applied every few frames, so objects added or redrawn while a section
 * is active are cut too; everything is put back when the section goes. Layers the plane is set
 * to leave alone (ground, map overlay, existing buildings of a kind, your design) are not cut.
 */
const SWEEP_EVERY_FRAMES = 10;

export function SectionCutter({ section, shapes }: { section: SectionArgs | null; shapes: readonly Shape[] }) {
  const { scene, gl } = useThree();
  const key = section ? JSON.stringify([section.point, section.normal, section.exempt ?? []]) : '';
  const plane = useMemo<THREE.Plane | null>(() => (section ? clippingPlaneOf(section) : null), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const exempt = useMemo(() => new Set(section?.exempt ?? []), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const cut = useMemo(() => new SectionCut(), []);
  const frame = useRef(0);

  // Which layer a mesh is in: the shape it belongs to, else drawn geometry ("design").
  const byId = useMemo(() => new Map(shapes.map(s => [s.id, s])), [shapes]);
  const byIdRef = useRef(byId);
  byIdRef.current = byId;
  const layerOf = useMemo(() => (mesh: THREE.Mesh): string | null => {
    for (let p: THREE.Object3D | null = mesh; p; p = p.parent) {
      const id = p.userData?.id;
      if (typeof id === 'string') {
        const shape = byIdRef.current.get(id);
        if (shape) return sectionLayerOfShape(shape);
      }
    }
    return 'design';
  }, []);

  useEffect(() => {
    cut.clear();
    setSectionPickPlane(plane);
    if (plane) {
      gl.localClippingEnabled = true;
      cut.apply(scene, plane, layerOf, exempt);
    }
    return () => {
      cut.clear();
      setSectionPickPlane(null);
    };
  }, [plane, exempt, cut, scene, gl, layerOf]);

  useFrame(() => {
    if (!plane) return;
    frame.current = (frame.current + 1) % SWEEP_EVERY_FRAMES;
    if (frame.current === 0) cut.apply(scene, plane, layerOf, exempt);
  });

  return null;
}
