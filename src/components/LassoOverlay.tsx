/**
 * PolyForm — Lasso & Marquee Selection Overlay Component
 *
 * Renders high-performance 2D SVG lasso paths, marquee rectangles,
 * real-time candidate HUD indicators, and manages pointer interactions.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useApp } from '../AppContext';
import {
  evaluateLassoSelection,
  Point2D,
  SelectionShapeMode,
  SelectionFilter,
  SelectionCriteria,
  LassoSelectionOptions,
} from '../tools/lassoSelection';

interface LassoOverlayProps {
  getSceneObjectById: (id: string | null) => THREE.Object3D | null;
}

/**
 * Generates an SVG path data string from an array of 2D points.
 */
function pointsToPathD(points: readonly Point2D[], closePath: boolean = true): string {
  if (points.length === 0) return '';
  const first = points[0];
  let d = `M ${first.x.toFixed(1)} ${first.y.toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    d += ` L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  }
  if (closePath && points.length > 2) {
    d += ' Z';
  }
  return d;
}

export const LassoOverlay: React.FC<LassoOverlayProps> = ({ getSceneObjectById }) => {
  const { camera, gl, size } = useThree();
  const {
    activeTool,
    shapes,
    kernelHost,
    selectedIds,
    setSelectedIds,
    setSelectedId,
    selectedFaceIds,
    setSelectedFaceIds,
    setMeasurements,
    selectionShapeMode,
    setSelectionShapeMode,
    selectionFilter,
    selectionCriteria,
    theme,
  } = useApp();

  const [isDrawing, setIsDrawing] = useState(false);
  const [points, setPoints] = useState<Point2D[]>([]);
  const [keyModifiers, setKeyModifiers] = useState<{ shift: boolean; alt: boolean }>({
    shift: false,
    alt: false,
  });
  const [candidateCounts, setCandidateCounts] = useState<{ shapes: number; surfaces: number }>({
    shapes: 0,
    surfaces: 0,
  });

  const isTrackingRef = useRef(false);
  const hasMovedRef = useRef(false);
  const startPointRef = useRef<Point2D | null>(null);
  const pointsRef = useRef<Point2D[]>([]);
  const activePointerIdRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const isSelectActive = activeTool === 'select' || activeTool === 'lasso';

  // Real-time candidate evaluation throttled by animation frame
  const scheduleCandidateEvaluation = useCallback(
    (currentPoints: Point2D[], shift: boolean, alt: boolean) => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }

      rafIdRef.current = requestAnimationFrame(() => {
        if (!currentPoints || currentPoints.length < 2) {
          setCandidateCounts({ shapes: 0, surfaces: 0 });
          return;
        }

        const opts: LassoSelectionOptions = {
          mode: selectionShapeMode,
          filter: selectionFilter,
          criteria: selectionCriteria,
          isAdditive: shift,
          isSubtractive: alt,
        };

        const result = evaluateLassoSelection({
          rawPoints: currentPoints,
          options: opts,
          camera,
          viewportWidth: size.width,
          viewportHeight: size.height,
          shapes,
          getSceneObjectById,
          kernelGraph: kernelHost?.graph,
          currentSelectedIds: selectedIds,
          currentSelectedFaceIds: selectedFaceIds,
        });

        setCandidateCounts({
          shapes: result.matchedShapeCount,
          surfaces: result.matchedFaceCount,
        });
      });
    },
    [
      selectionShapeMode,
      selectionFilter,
      selectionCriteria,
      camera,
      size.width,
      size.height,
      shapes,
      getSceneObjectById,
      kernelHost?.graph,
      selectedIds,
      selectedFaceIds,
    ]
  );

  // Keyboard modifiers listener for Shift (add) and Alt (subtract)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isSelectActive) return;

      if (e.key === 'Shift' || e.key === 'Alt') {
        setKeyModifiers({ shift: e.shiftKey, alt: e.altKey });
        if (isTrackingRef.current && hasMovedRef.current) {
          scheduleCandidateEvaluation(pointsRef.current, e.shiftKey, e.altKey);
        }
      }

      // 'Escape' cancels current lasso drag
      if (e.key === 'Escape' && isTrackingRef.current) {
        isTrackingRef.current = false;
        hasMovedRef.current = false;
        pointsRef.current = [];
        setPoints([]);
        setIsDrawing(false);
        setCandidateCounts({ shapes: 0, surfaces: 0 });
        if (activePointerIdRef.current !== null) {
          try {
            gl.domElement.releasePointerCapture(activePointerIdRef.current);
          } catch {
            // ignore
          }
          activePointerIdRef.current = null;
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!isSelectActive) return;
      if (e.key === 'Shift' || e.key === 'Alt') {
        setKeyModifiers({ shift: e.shiftKey, alt: e.altKey });
        if (isTrackingRef.current && hasMovedRef.current) {
          scheduleCandidateEvaluation(pointsRef.current, e.shiftKey, e.altKey);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isSelectActive, gl.domElement, scheduleCandidateEvaluation]);

  // Pointer event listeners on canvas domElement
  useEffect(() => {
    const canvas = gl.domElement;
    if (!canvas || !isSelectActive) return;

    const onPointerDown = (e: PointerEvent) => {
      // Only handle primary left mouse button
      if (e.button !== 0) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      startPointRef.current = { x, y };
      pointsRef.current = [{ x, y }];
      isTrackingRef.current = true;
      hasMovedRef.current = false;
      activePointerIdRef.current = e.pointerId;

      setKeyModifiers({ shift: e.shiftKey, alt: e.altKey });

      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isTrackingRef.current || !startPointRef.current) return;

      const rect = canvas.getBoundingClientRect();
      const currentPoint: Point2D = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };

      const dist = Math.hypot(
        currentPoint.x - startPointRef.current.x,
        currentPoint.y - startPointRef.current.y
      );

      // Require a minimum 4px movement to distinguish click from drag
      if (!hasMovedRef.current && dist > 4) {
        hasMovedRef.current = true;
        setIsDrawing(true);
      }

      if (!hasMovedRef.current) return;

      let nextPoints: Point2D[];
      if (selectionShapeMode === 'marquee') {
        nextPoints = [startPointRef.current, currentPoint];
      } else {
        // Lasso mode: append points with minimum distance to prevent redundant points
        const last = pointsRef.current[pointsRef.current.length - 1];
        if (!last || Math.hypot(currentPoint.x - last.x, currentPoint.y - last.y) >= 3) {
          nextPoints = [...pointsRef.current, currentPoint];
        } else {
          nextPoints = pointsRef.current;
        }
      }

      pointsRef.current = nextPoints;
      setPoints(nextPoints);
      scheduleCandidateEvaluation(nextPoints, e.shiftKey, e.altKey);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!isTrackingRef.current) return;

      const wasDrawing = hasMovedRef.current && pointsRef.current.length >= 2;
      const finalPoints = [...pointsRef.current];

      if (activePointerIdRef.current !== null) {
        try {
          canvas.releasePointerCapture(activePointerIdRef.current);
        } catch {
          // ignore
        }
        activePointerIdRef.current = null;
      }

      isTrackingRef.current = false;
      hasMovedRef.current = false;
      startPointRef.current = null;
      pointsRef.current = [];
      setPoints([]);
      setIsDrawing(false);
      setCandidateCounts({ shapes: 0, surfaces: 0 });

      if (wasDrawing) {
        // Execute final selection calculation
        const opts: LassoSelectionOptions = {
          mode: selectionShapeMode,
          filter: selectionFilter,
          criteria: selectionCriteria,
          isAdditive: e.shiftKey,
          isSubtractive: e.altKey,
        };

        const result = evaluateLassoSelection({
          rawPoints: finalPoints,
          options: opts,
          camera,
          viewportWidth: size.width,
          viewportHeight: size.height,
          shapes,
          getSceneObjectById,
          kernelGraph: kernelHost?.graph,
          currentSelectedIds: selectedIds,
          currentSelectedFaceIds: selectedFaceIds,
        });

        // Apply updated selection to context
        setSelectedIds(result.selectedShapeIds);
        setSelectedId(result.selectedShapeIds[0] || null);
        setSelectedFaceIds(result.selectedFaceIds);

        // Feedback readout
        const shapesText = `${result.selectedShapeIds.length} shape${result.selectedShapeIds.length === 1 ? '' : 's'}`;
        const surfacesText = `${result.selectedFaceIds.length} surface${result.selectedFaceIds.length === 1 ? '' : 's'}`;
        const modeLabel = selectionShapeMode === 'marquee' ? 'Marquee' : 'Lasso';

        setMeasurements(
          `${modeLabel} selection: ${shapesText}, ${surfacesText}`
        );

        // Set global flag to suppress trailing click event from clearing the selection
        (window as any).__polyformLassoIgnoreClickUntil = Date.now() + 250;
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
    };
  }, [
    gl.domElement,
    isSelectActive,
    selectionShapeMode,
    selectionFilter,
    selectionCriteria,
    camera,
    size.width,
    size.height,
    shapes,
    getSceneObjectById,
    kernelHost?.graph,
    selectedIds,
    setSelectedIds,
    setSelectedId,
    selectedFaceIds,
    setSelectedFaceIds,
    setMeasurements,
    scheduleCandidateEvaluation,
  ]);

  // Reference to the SVG DOM element attached to the canvas container
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Mount/unmount the selection SVG directly in the canvas parent DOM element.
  // This avoids passing DOM/SVG JSX to React Three Fiber's custom reconciler,
  // preventing R3F namespace lookup errors (e.g. 'FeDropShadow is not part of the THREE namespace').
  useEffect(() => {
    const parent = gl.domElement?.parentElement;
    if (!parent) return;

    let svg = parent.querySelector<SVGSVGElement>('#polyform-lasso-selection-svg');
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.id = 'polyform-lasso-selection-svg';
      svg.setAttribute('class', 'absolute inset-0 pointer-events-none z-20 overflow-hidden select-none');
      svg.style.display = 'none';
      parent.appendChild(svg);
    }
    svgRef.current = svg;

    return () => {
      if (svg && svg.parentElement) {
        svg.parentElement.removeChild(svg);
      }
      svgRef.current = null;
    };
  }, [gl.domElement]);

  // Synchronize the SVG contents whenever drawing state, points, or candidates change
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    if (!isDrawing || points.length < 2) {
      svg.style.display = 'none';
      svg.innerHTML = '';
      return;
    }

    svg.style.display = 'block';
    svg.setAttribute('width', String(size.width));
    svg.setAttribute('height', String(size.height));
    svg.setAttribute('viewBox', `0 0 ${size.width} ${size.height}`);

    const isWindowMode = selectionCriteria === 'window';
    const strokeColor = isWindowMode ? '#3b82f6' : '#10b981';
    const fillColor = isWindowMode ? 'rgba(59, 130, 246, 0.14)' : 'rgba(16, 185, 129, 0.14)';
    const strokeDash = isWindowMode ? 'none' : '5 4';

    const startPt = points[0];
    const lastPt = points[points.length - 1];

    let shapeHtml = '';
    if (selectionShapeMode === 'marquee') {
      const marqueeX = Math.min(startPt.x, lastPt.x);
      const marqueeY = Math.min(startPt.y, lastPt.y);
      const marqueeWidth = Math.abs(lastPt.x - startPt.x);
      const marqueeHeight = Math.abs(lastPt.y - startPt.y);
      shapeHtml = `<rect
        x="${marqueeX}"
        y="${marqueeY}"
        width="${marqueeWidth}"
        height="${marqueeHeight}"
        rx="2"
        ry="2"
        fill="${fillColor}"
        stroke="${strokeColor}"
        stroke-width="1.5"
        stroke-dasharray="${strokeDash}"
        style="filter: drop-shadow(0 0 2px ${strokeColor});"
      />`;
    } else {
      shapeHtml = `
        <path
          d="${pointsToPathD(points, true)}"
          fill="${fillColor}"
          stroke="${strokeColor}"
          stroke-width="1.5"
          stroke-dasharray="${strokeDash}"
          style="filter: drop-shadow(0 0 2px ${strokeColor});"
        />
        <line
          x1="${lastPt.x}"
          y1="${lastPt.y}"
          x2="${startPt.x}"
          y2="${startPt.y}"
          stroke="${strokeColor}"
          stroke-width="1"
          stroke-dasharray="3 3"
          opacity="0.65"
        />
        <circle
          cx="${startPt.x}"
          cy="${startPt.y}"
          r="3.5"
          fill="#ffffff"
          stroke="${strokeColor}"
          stroke-width="1.5"
        />
      `;
    }

    const hudX = Math.max(16, Math.min(size.width - 160, lastPt.x + 14));
    const hudY = Math.max(24, Math.min(size.height - 40, lastPt.y - 28));

    const hudModifierText = keyModifiers.shift
      ? '+ Add'
      : keyModifiers.alt
      ? '- Remove'
      : '';

    const hudHtml = `
      <g transform="translate(${hudX}, ${hudY})" style="transition: transform 75ms ease-out;">
        <rect
          x="0"
          y="-18"
          width="130"
          height="26"
          rx="6"
          ry="6"
          fill="rgba(15, 23, 42, 0.92)"
          stroke="rgba(255, 255, 255, 0.15)"
          stroke-width="1"
        />
        <text
          x="8"
          y="-2"
          fill="#f8fafc"
          font-size="10"
          font-family="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont"
          font-weight="600"
          letter-spacing="0.02em"
        >
          ${candidateCounts.shapes} shape${candidateCounts.shapes === 1 ? '' : 's'}, ${candidateCounts.surfaces} surf
        </text>
        ${hudModifierText ? `
          <text
            x="118"
            y="-2"
            text-anchor="end"
            fill="${keyModifiers.shift ? '#38bdf8' : '#f87171'}"
            font-size="9"
            font-weight="bold"
          >
            ${hudModifierText}
          </text>
        ` : ''}
      </g>
    `;

    svg.innerHTML = `${shapeHtml}${hudHtml}`;
  }, [
    isDrawing,
    points,
    size.width,
    size.height,
    selectionCriteria,
    selectionShapeMode,
    candidateCounts,
    keyModifiers,
  ]);

  return null;
};
