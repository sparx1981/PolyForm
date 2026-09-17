import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { heightCanvasToNormalCanvas, type SurfaceDepthPreset, type SurfaceDepthPresetParams } from '../../lib/graphics/proceduralSurface';

function RotatingRelief({ height, normal }: { height: THREE.Texture; normal: THREE.Texture }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => { if (ref.current) ref.current.rotation.y += delta * 0.5; });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[1, 48, 48]} />
      <meshStandardMaterial
        color="#c7ccd2" roughness={0.75} metalness={0.05}
        displacementMap={height} displacementScale={0.16} displacementBias={-0.07}
        normalMap={normal}
      />
    </mesh>
  );
}

/** Small live-rendered preview: a slowly-rotating sphere carrying the preset's own
 * generated height + normal maps, so a user can see the pattern before applying it. */
export function SurfaceDepthPresetThumbnail({ preset, params, size = 56 }: {
  preset: SurfaceDepthPreset; params: SurfaceDepthPresetParams; size?: number;
}) {
  const { height, normal } = useMemo(() => {
    const heightCanvas = preset.generateHeight(params, 128);
    const normalCanvas = heightCanvasToNormalCanvas(heightCanvas, 2.2);
    const heightTexture = new THREE.CanvasTexture(heightCanvas);
    heightTexture.colorSpace = THREE.NoColorSpace; heightTexture.wrapS = heightTexture.wrapT = THREE.RepeatWrapping;
    const normalTexture = new THREE.CanvasTexture(normalCanvas);
    normalTexture.colorSpace = THREE.NoColorSpace; normalTexture.wrapS = normalTexture.wrapT = THREE.RepeatWrapping;
    return { height: heightTexture, normal: normalTexture };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset.id, params.scale, params.strength, params.seed]);

  useEffect(() => () => { height.dispose(); normal.dispose(); }, [height, normal]);

  return (
    <Canvas
      className="rounded pointer-events-none"
      style={{ width: size, height: size }}
      gl={{ antialias: true, alpha: true }}
      camera={{ position: [0, 1, 3.6], fov: 38 }}
    >
      <ambientLight intensity={0.85} />
      <directionalLight position={[2, 3, 2]} intensity={1.1} />
      <RotatingRelief height={height} normal={normal} />
    </Canvas>
  );
}
