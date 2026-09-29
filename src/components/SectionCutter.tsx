import { useEffect, useMemo, useRef } from 'react';
import type * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { clippingPlaneOf, setSectionPickPlane, type SectionArgs } from '../tools/sectionPlanes';
import { SectionCut, type SectionXray } from '../lib/sectionCut';

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
  // The look of the lines on the cut-away side; read on every sweep, so changing it doesn't rebuild the cut.
  const xray = useRef<SectionXray>({});
  xray.current = { color: section?.xrayColor, opacity: section?.xrayOpacity };

  useEffect(() => {
    cut.clear();
    setSectionPickPlane(plane);
    if (plane) {
      gl.localClippingEnabled = true;
      cut.apply(scene, plane, xray.current);
    }
    return () => {
      cut.clear();
      setSectionPickPlane(null);
    };
  }, [plane, cut, scene, gl]);

  useEffect(() => {
    if (plane) cut.apply(scene, plane, xray.current);
  }, [section?.xrayColor, section?.xrayOpacity, plane, cut, scene]);

  useFrame(() => {
    if (!plane) return;
    frame.current = (frame.current + 1) % SWEEP_EVERY_FRAMES;
    if (frame.current === 0) cut.apply(scene, plane, xray.current);
  });

  return null;
}
