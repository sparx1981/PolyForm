import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Html, Line } from '@react-three/drei';
import { InferenceResult } from '../tools/inference/types';

interface InferenceOverlayProps {
  inference: InferenceResult | null;
  dwellProgress: number;
  enablePulsingReticle?: boolean;
}

export const InferenceOverlay: React.FC<InferenceOverlayProps> = ({
  inference,
  dwellProgress,
  enablePulsingReticle = true,
}) => {
  if (!inference) return null;

  const { activeReference, activeGuide, snappedPoint, isLocked } = inference;

  const guidePoints = useMemo(() => {
    if (!activeGuide) return null;
    const [p1, p2] = activeGuide.guideSegment;
    return [p1, p2] as [THREE.Vector3, THREE.Vector3];
  }, [activeGuide]);

  return (
    <group name="inference-overlay-group">
      {/* 1. Dashed Tracking Guide Line */}
      {activeGuide && guidePoints && (
        <Line
          points={guidePoints}
          color={activeGuide.color}
          lineWidth={2}
          dashed
          dashSize={0.25}
          gapSize={0.15}
          transparent
          opacity={0.9}
        />
      )}

      {/* 2. Active Tracking Guide Label (Tooltip) */}
      {activeGuide && (
        <Html
          position={[
            (activeGuide.guideSegment[0].x + activeGuide.guideSegment[1].x) / 2,
            (activeGuide.guideSegment[0].y + activeGuide.guideSegment[1].y) / 2 + 0.15,
            (activeGuide.guideSegment[0].z + activeGuide.guideSegment[1].z) / 2,
          ]}
          center
          distanceFactor={15}
        >
          <div className="px-2 py-0.5 rounded text-[10px] font-mono font-medium tracking-tight bg-slate-900/85 text-white backdrop-blur-sm border border-slate-700 shadow-md pointer-events-none whitespace-nowrap">
            {activeGuide.label}
          </div>
        </Html>
      )}

      {/* 3. Acquired Reference Lock Reticle (Gold #FBAD26) */}
      {activeReference && enablePulsingReticle && (
        <Html
          position={[activeReference.point.x, activeReference.point.y, activeReference.point.z]}
          center
          distanceFactor={18}
        >
          <div className="relative flex items-center justify-center pointer-events-none -translate-x-1/2 -translate-y-1/2 select-none">
            <div className="w-6 h-6 rounded-full border-2 border-[#FBAD26] animate-ping opacity-75" />
            <div className="absolute w-2.5 h-2.5 rounded-full bg-[#FBAD26] ring-2 ring-black/40 shadow-sm" />
            <span className="absolute -top-4 text-[9px] font-bold text-[#FBAD26] tracking-wider uppercase drop-shadow-md">
              REF
            </span>
          </div>
        </Html>
      )}

      {/* 4. Dwell Acquisition Progress Radial Indicator */}
      {dwellProgress > 0 && dwellProgress < 1 && (
        <Html
          position={[snappedPoint.x, snappedPoint.y, snappedPoint.z]}
          center
          distanceFactor={18}
        >
          <div className="relative flex items-center justify-center pointer-events-none -translate-x-1/2 -translate-y-1/2">
            <svg className="w-8 h-8 pointer-events-none transform -rotate-90">
              <circle
                cx="16"
                cy="16"
                r="12"
                stroke="#0063A3"
                strokeWidth="2.5"
                fill="transparent"
                strokeDasharray={75.4}
                strokeDashoffset={75.4 * (1 - dwellProgress)}
                className="transition-all duration-75"
              />
            </svg>
            <div className="absolute w-1.5 h-1.5 rounded-full bg-[#0063A3]" />
          </div>
        </Html>
      )}

      {/* 5. Snapped Target Reticle */}
      {isLocked && (
        <Html
          position={[snappedPoint.x, snappedPoint.y, snappedPoint.z]}
          center
          distanceFactor={22}
        >
          <div className="w-3 h-3 rounded-full border border-sky-400 bg-sky-400/30 pointer-events-none" />
        </Html>
      )}
    </group>
  );
};
