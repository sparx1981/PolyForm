import { useEffect, useMemo, useRef } from 'react';
import type * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { clippingPlaneOf, setSectionPickPlane, type SectionArgs } from '../tools/sectionPlanes';
import { SectionCut } from '../lib/sectionCut';

/**
 * Applies the active section plane to the scene (lib/sectionCut.ts) and makes picking ignore
 * what it cuts away. Re-applied every few frames, so objects added or redrawn while a section
 * is active are cut too; everything is put back when the section goes.
 */
const SWEEP_EVERY_FRAMES = 10;

export function SectionCutter({ section }: { section: SectionArgs | null }) {
  const { scene, gl } = useThree();
  const key = section ? JSON.stringify([section.point, section.normal]) : '';
  const plane = useMemo<THREE.Plane | null>(() => (section ? clippingPlaneOf(section) : null), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const cut = useMemo(() => new SectionCut(), []);
  const frame = useRef(0);

  useEffect(() => {
    cut.clear();
    setSectionPickPlane(plane);
    if (plane) {
      gl.localClippingEnabled = true;
      cut.apply(scene, plane);
    }
    return () => {
      cut.clear();
      setSectionPickPlane(null);
    };
  }, [plane, cut, scene, gl]);

  useFrame(() => {
    if (!plane) return;
    frame.current = (frame.current + 1) % SWEEP_EVERY_FRAMES;
    if (frame.current === 0) cut.apply(scene, plane);
  });

  return null;
}
