import React, { useState } from 'react';
import { useApp } from '../../AppContext';
import { 
  X, 
  Layers, 
  HardHat, 
  Download, 
  Check, 
  CheckSquare, 
  Square, 
  AlertCircle, 
  Sparkles, 
  FileCode2,
  Box,
  Cpu,
  HelpCircle,
  Mountain
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { Shape, TerrainModifier, PadModifier, RoadModifier } from '../../types';
import * as THREE from 'three';
import { exportTerrainToGLB, exportTerrainToOBJ, downloadBlob, downloadText } from '../../lib/terrain/terrainExporter';
import { applyPadGradingToTerrain } from '../../lib/terrain/padGeometry';
import { applyRoadGradingToTerrain } from '../../lib/terrain/roadGeometry';
import { flattenTerrainForFloorSlabs } from '../../lib/archRoomAssembly';
import { createTerrainShape } from '../../lib/terrain/terrainFactory';

function buildTerrainBufferGeometry(terrainShape: Shape | undefined): THREE.BufferGeometry {
  if (terrainShape && terrainShape.terrainData) {
    const td = terrainShape.terrainData;
    const gridX = td.gridX || 40;
    const gridY = td.gridY || 40;
    const width = td.width || 40;
    const depth = td.depth || 40;
    const geo = new THREE.PlaneGeometry(width, depth, gridX - 1, gridY - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position');
    if (td.heights && pos) {
      for (let i = 0; i < pos.count; i++) {
        if (td.heights[i] !== undefined) {
          pos.setY(i, td.heights[i]);
        }
      }
      pos.needsUpdate = true;
    }
    return geo;
  }
  const defaultGeo = new THREE.PlaneGeometry(40, 40, 39, 39);
  defaultGeo.rotateX(-Math.PI / 2);
  return defaultGeo;
}

export default function BakeModal() {
  const { 
    isBakeModalOpen, 
    setIsBakeModalOpen, 
    terrainModifiers, 
    shapes, 
    setShapes,
    addShape, 
    setConsoleOutput, 
    commitHistory,
    setViewportToast,
    cutFillMetrics
  } = useApp();

  const [includeInspectionVolumes, setIncludeInspectionVolumes] = useState<boolean>(false);
  const [exportFormat, setExportFormat] = useState<'mesh' | 'glb' | 'obj'>('mesh');
  const [bakingInProgress, setBakingInProgress] = useState<boolean>(false);
  const [bakeCompleted, setBakeCompleted] = useState<boolean>(false);

  if (!isBakeModalOpen) return null;

  const handleClose = () => {
    setIsBakeModalOpen(false);
    setBakingInProgress(false);
    setBakeCompleted(false);
  };

  const handleBakeOrExport = async () => {
    setBakingInProgress(true);

    setTimeout(() => {
      const activeMods = terrainModifiers.filter(m => m.enabled);

      if (exportFormat === 'mesh') {
        // Find existing terrain or create one if none exists
        let currentTerrain = shapes.find(s => s.type === 'terrain' && s.terrainData);
        let wasCreated = false;
        if (!currentTerrain) {
          currentTerrain = createTerrainShape({
            width: 40,
            depth: 40,
            resolution: 40,
            topography: 'flat'
          });
          wasCreated = true;
        }

        let updatedData = currentTerrain.terrainData;
        if (updatedData) {
          // 1. Grade all active building & grading pads into terrain heights
          const pads = activeMods.filter((m): m is PadModifier => m.type === 'pad');
          for (const pad of pads) {
            const nextData = applyPadGradingToTerrain({ ...currentTerrain, terrainData: updatedData }, pad);
            if (nextData) updatedData = nextData;
          }

          // 2. Grade all active roads & pathways into terrain heights
          const roads = activeMods.filter((m): m is RoadModifier => m.type === 'road');
          for (const road of roads) {
            const nextData = applyRoadGradingToTerrain({ ...currentTerrain, terrainData: updatedData }, road);
            if (nextData) updatedData = nextData;
          }

          // 3. Grade terrain around all floor slabs in the scene (1m perimeter apron)
          const slabGradedData = flattenTerrainForFloorSlabs(
            { ...currentTerrain, terrainData: updatedData },
            shapes
          );
          if (slabGradedData) updatedData = slabGradedData;
        }

        if (wasCreated) {
          addShape({ ...currentTerrain, terrainData: updatedData });
        } else {
          setShapes(prev => prev.map(s => s.id === currentTerrain!.id ? { ...s, terrainData: updatedData } : s));
        }

        commitHistory();

        setConsoleOutput(prev => [
          ...prev, 
          `[Terrain Studio] Successfully baked ${activeMods.length} civil modifiers directly into site terrain mesh elevations.`
        ]);
        setViewportToast(`Civil terrain baked: ${activeMods.length} modifiers embedded into site mesh.`);
      } else if (exportFormat === 'glb') {
        try {
          const terrainShape = shapes.find(s => s.type === 'terrain' && !s.hidden);
          const geo = buildTerrainBufferGeometry(terrainShape);
          exportTerrainToGLB(geo, terrainModifiers, {
            includeCutFill: includeInspectionVolumes
          }).then(blob => {
            downloadBlob(blob, `civil-terrain-${Date.now()}.glb`);
            setConsoleOutput(prev => [
              ...prev, 
              `[Terrain Studio] Exported civil surface and ${activeMods.length} modifiers as binary GLB.`
            ]);
            setViewportToast("Civil surface exported as GLB.");
          }).catch(err => {
            console.error('GLB export error:', err);
            setViewportToast("GLB export failed.");
          });
        } catch (err) {
          console.error('GLB preparation error:', err);
        }
      } else {
        try {
          const terrainShape = shapes.find(s => s.type === 'terrain' && !s.hidden);
          const geo = buildTerrainBufferGeometry(terrainShape);
          const objText = exportTerrainToOBJ(geo);
          downloadText(objText, `civil-terrain-${Date.now()}.obj`);
          setConsoleOutput(prev => [
            ...prev, 
            `[Terrain Studio] Exported civil surface as OBJ wavefront.`
          ]);
          setViewportToast("Civil surface exported as OBJ.");
        } catch (err) {
          console.error('OBJ export error:', err);
          setViewportToast("OBJ export failed.");
        }
      }

      setBakingInProgress(false);
      setBakeCompleted(true);
      setTimeout(() => {
        handleClose();
      }, 1000);
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div 
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-2xl p-5 text-gray-900 dark:text-gray-100 backdrop-blur-md"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-500">
              <HardHat size={18} />
            </span>
            <div>
              <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100 uppercase tracking-wide">Bake Civil Terrain</h2>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">Embed procedural pads & roads directly into the site terrain mesh</p>
            </div>
          </div>
          <button 
            onClick={handleClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Clear Explanation Card */}
        <div className="my-4 p-3.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 text-[11px] leading-relaxed text-blue-900 dark:text-blue-200 space-y-1.5">
          <div className="flex items-center gap-1.5 font-bold text-blue-800 dark:text-blue-300">
            <HelpCircle size={15} className="text-blue-600 dark:text-blue-400 shrink-0" />
            <span>What does Baking Civil Terrain do?</span>
          </div>
          <p>
            Procedural roads, pathways, and grading pads are dynamic parametric overlays. 
            <strong> Baking</strong> permanently sculpts their target elevations, subgrade cut/fill depths, and daylight batter slopes directly into the 3D site terrain vertex heights.
          </p>
          <p className="text-[10px] text-blue-700 dark:text-blue-300/80">
            ✓ Terrain beneath floor slabs is graded down with a 1m apron to eliminate foundation clipping.<br />
            ✓ Roads and pads become part of the true ground elevation mesh.<br />
            ✓ Ready for export to external BIM, CAD, or game engines.
          </p>
        </div>

        {/* Output Options */}
        <div className="space-y-2.5 mb-4">
          <label className="text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400 tracking-wider">Select Baking / Export Target</label>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => setExportFormat('mesh')}
              className={cn(
                "p-3 rounded-xl border text-left flex flex-col gap-1 transition-all cursor-pointer",
                exportFormat === 'mesh'
                  ? "bg-trimble-blue/10 border-trimble-blue text-trimble-blue shadow-sm font-semibold"
                  : "bg-white dark:bg-gray-800/80 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
              )}
            >
              <Mountain size={16} className={exportFormat === 'mesh' ? "text-trimble-blue" : "text-gray-400"} />
              <span className="text-xs font-semibold">Embed to Site</span>
              <span className="text-[10px] text-gray-400">Update terrain mesh</span>
            </button>

            <button
              onClick={() => setExportFormat('glb')}
              className={cn(
                "p-3 rounded-xl border text-left flex flex-col gap-1 transition-all cursor-pointer",
                exportFormat === 'glb'
                  ? "bg-trimble-blue/10 border-trimble-blue text-trimble-blue shadow-sm font-semibold"
                  : "bg-white dark:bg-gray-800/80 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
              )}
            >
              <Download size={16} className={exportFormat === 'glb' ? "text-trimble-blue" : "text-gray-400"} />
              <span className="text-xs font-semibold">Export GLB</span>
              <span className="text-[10px] text-gray-400">Standard 3D model</span>
            </button>

            <button
              onClick={() => setExportFormat('obj')}
              className={cn(
                "p-3 rounded-xl border text-left flex flex-col gap-1 transition-all cursor-pointer",
                exportFormat === 'obj'
                  ? "bg-trimble-blue/10 border-trimble-blue text-trimble-blue shadow-sm font-semibold"
                  : "bg-white dark:bg-gray-800/80 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
              )}
            >
              <FileCode2 size={16} className={exportFormat === 'obj' ? "text-trimble-blue" : "text-gray-400"} />
              <span className="text-xs font-semibold">Export OBJ</span>
              <span className="text-[10px] text-gray-400">Wavefront geometry</span>
            </button>
          </div>
        </div>

        {/* Checkbox Options */}
        {exportFormat !== 'mesh' && (
          <div className="mb-4 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={() => setIncludeInspectionVolumes(!includeInspectionVolumes)}
              className="flex items-center gap-2.5 text-xs text-gray-700 dark:text-gray-300 text-left w-full select-none cursor-pointer"
            >
              {includeInspectionVolumes ? (
                <CheckSquare size={16} className="text-amber-500 shrink-0" />
              ) : (
                <Square size={16} className="text-gray-400 shrink-0" />
              )}
              <div className="flex flex-col">
                <span className="font-semibold text-gray-900 dark:text-gray-100">Include Cut/Fill Differential Solids</span>
                <span className="text-[10px] text-gray-500 dark:text-gray-400">Generate inspection bodies for earthwork validation in CAD</span>
              </div>
            </button>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-800">
          <button
            onClick={handleClose}
            disabled={bakingInProgress}
            className="px-3.5 py-1.5 rounded-xl border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs font-semibold transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleBakeOrExport}
            disabled={bakingInProgress}
            className={cn(
              "px-4 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm cursor-pointer",
              bakeCompleted
                ? "bg-emerald-600 text-white"
                : "bg-trimble-blue hover:bg-trimble-blue/90 text-white"
            )}
          >
            {bakingInProgress ? (
              <>
                <Sparkles size={14} className="animate-spin" />
                <span>Baking Terrain Heights...</span>
              </>
            ) : bakeCompleted ? (
              <>
                <Check size={14} />
                <span>Baked Successfully!</span>
              </>
            ) : (
              <>
                <Layers size={14} />
                <span>{exportFormat === 'mesh' ? 'Bake into Active Terrain Mesh' : `Export ${exportFormat.toUpperCase()}`}</span>
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
