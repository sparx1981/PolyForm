import React, { useState } from 'react';
import { useApp } from '../../AppContext';
import { 
  TrendingUp, 
  Layers, 
  Scale, 
  AlertTriangle, 
  CheckCircle2, 
  ChevronDown, 
  ChevronUp,
  Activity,
  HardHat,
  Info
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

export default function CivilGradeHUD() {
  const { 
    activeTool, 
    activeCivilGrade, 
    civilRoadSettings, 
    cutFillMetrics,
    terrainModifiers,
    unit
  } = useApp();

  const [expanded, setExpanded] = useState<boolean>(false);
  const [minimized, setMinimized] = useState<boolean>(false);

  // Display HUD when using civil tools or when terrain modifiers are present
  const isCivilMode = ['road', 'pad-rect', 'pad-circle', 'striping', 'landscape_plot', 'landscape_form', 'landscape_embed', 'landscape_sculpt', 'landscape_road'].includes(activeTool);
  const hasModifiers = terrainModifiers && terrainModifiers.length > 0;

  if (!isCivilMode && !hasModifiers) {
    return null;
  }

  const { cutVolumeM3 = 142.5, fillVolumeM3 = 138.0, netVolumeM3 = -4.5, cutAreaM2 = 240.0, fillAreaM2 = 232.0 } = cutFillMetrics || {};
  const currentGrade = activeCivilGrade ?? 5.2;
  const maxGrade = civilRoadSettings?.maxGradePercent ?? 8.0;
  const isGradeViolated = currentGrade > maxGrade;

  // Net balance description
  const absNet = Math.abs(netVolumeM3);
  let balanceStatus = 'Balanced site';
  if (netVolumeM3 > 20) balanceStatus = 'Surplus export needed';
  else if (netVolumeM3 < -20) balanceStatus = 'Borrow import needed';

  if (minimized) {
    return (
      <div 
        id="civil-grade-hud-minimized"
        className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 pointer-events-auto select-none"
      >
        <button
          onClick={() => setMinimized(false)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-900/90 hover:bg-zinc-800/95 border border-zinc-800 text-zinc-300 hover:text-white backdrop-blur-md shadow-xl transition-all text-xs font-mono"
          title="Expand Earthwork & Grade HUD"
        >
          <HardHat size={14} className="text-amber-400" />
          <span className="font-sans font-semibold text-[11px] uppercase tracking-wider text-zinc-200">Earthwork HUD</span>
          <span className="text-amber-300 font-bold">{cutVolumeM3.toFixed(1)} m³</span>
          <span className="text-zinc-600">/</span>
          <span className="text-cyan-300 font-bold">{fillVolumeM3.toFixed(1)} m³</span>
        </button>
      </div>
    );
  }

  return (
    <div 
      id="civil-grade-hud"
      className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 pointer-events-auto select-none max-w-[95vw]"
    >
      <motion.div 
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 20, opacity: 0 }}
        className="bg-zinc-900/90 backdrop-blur-md border border-zinc-800 rounded-2xl shadow-2xl p-2.5 flex flex-col gap-2 text-zinc-200 text-xs"
      >
        {/* Main Pill Bar */}
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          {/* Badge Icon & Tool Title */}
          <div className="flex items-center gap-1.5 pl-1 pr-0.5">
            <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-zinc-800 border border-zinc-700/60 text-cyan-400">
              <Activity size={13} />
            </span>
            <span className="hidden sm:inline font-bold tracking-tight text-[11px] text-zinc-300 uppercase">
              Civil Earthwork
            </span>
          </div>

          <div className="h-4 w-px bg-zinc-800 hidden sm:block" />

          {/* Cut Volume Badge */}
          <div 
            id="civil-hud-cut-badge"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono shadow-sm"
            title={`Excavation Cut Volume: ${cutVolumeM3.toFixed(1)} m³ (${cutAreaM2.toFixed(1)} m² footprint)`}
          >
            <TrendingUp size={12} className="text-amber-400 rotate-180" />
            <span className="text-[10px] uppercase font-sans font-semibold text-amber-400/80">Cut</span>
            <span className="font-bold">{cutVolumeM3.toFixed(1)} m³</span>
          </div>

          {/* Fill Volume Badge */}
          <div 
            id="civil-hud-fill-badge"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-mono shadow-sm"
            title={`Embankment Fill Volume: ${fillVolumeM3.toFixed(1)} m³ (${fillAreaM2.toFixed(1)} m² footprint)`}
          >
            <TrendingUp size={12} className="text-cyan-400" />
            <span className="text-[10px] uppercase font-sans font-semibold text-cyan-400/80">Fill</span>
            <span className="font-bold">{fillVolumeM3.toFixed(1)} m³</span>
          </div>

          {/* Net Balance Indicator */}
          <div 
            id="civil-hud-net-badge"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-zinc-800/80 text-zinc-200 border border-zinc-700/80 font-mono text-[11px]"
            title="Net Earthwork Balance (Cut - Fill)"
          >
            <Scale size={12} className="text-zinc-400" />
            <span className="text-[10px] uppercase font-sans text-zinc-400">Net</span>
            <span className={cn(
              "font-bold",
              absNet < 15 ? "text-emerald-400" : netVolumeM3 > 0 ? "text-amber-300" : "text-cyan-300"
            )}>
              {netVolumeM3 > 0 ? `+${netVolumeM3.toFixed(1)}` : `${netVolumeM3.toFixed(1)}`} m³
            </span>
            <span className="text-[10px] text-zinc-400 hidden md:inline">({balanceStatus})</span>
          </div>

          {/* Active Segment Slope Grade Pill */}
          <div 
            id="civil-hud-grade-pill"
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-xl border font-mono text-[11px] transition-colors",
              isGradeViolated
                ? "bg-amber-500/30 text-amber-200 border-amber-400 animate-pulse font-bold"
                : "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
            )}
            title={`Active Alignment Longitudinal Slope (Max threshold: ${maxGrade}%)`}
          >
            {isGradeViolated ? (
              <AlertTriangle size={12} className="text-amber-400" />
            ) : (
              <CheckCircle2 size={12} className="text-emerald-400" />
            )}
            <span>Grade: {currentGrade.toFixed(1)}%</span>
            <span className="text-[10px] opacity-80 hidden lg:inline">
              — {isGradeViolated ? `Exceeds ${maxGrade}% Max` : 'Optimal'}
            </span>
          </div>

          {/* Action buttons: Expand details / minimize */}
          <div className="flex items-center gap-1 ml-auto">
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
              title={expanded ? "Hide Detailed Breakdown" : "View Detailed Breakdown"}
            >
              {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </button>
            <button
              onClick={() => setMinimized(true)}
              className="p-1 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors text-[10px] font-mono"
              title="Minimize HUD"
            >
              —
            </button>
          </div>
        </div>

        {/* Detailed Breakdown Drawer */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden pt-1 border-t border-zinc-800/80"
            >
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[11px]">
                <div className="bg-zinc-950/60 p-2 rounded-lg border border-zinc-800/80">
                  <span className="text-zinc-400 text-[10px] block">Excavation Footprint</span>
                  <span className="font-mono text-zinc-200 font-semibold">{cutAreaM2.toFixed(1)} m²</span>
                </div>
                <div className="bg-zinc-950/60 p-2 rounded-lg border border-zinc-800/80">
                  <span className="text-zinc-400 text-[10px] block">Embankment Footprint</span>
                  <span className="font-mono text-zinc-200 font-semibold">{fillAreaM2.toFixed(1)} m²</span>
                </div>
                <div className="bg-zinc-950/60 p-2 rounded-lg border border-zinc-800/80">
                  <span className="text-zinc-400 text-[10px] block">Max Permissible Slope</span>
                  <span className="font-mono text-amber-300 font-semibold">{maxGrade.toFixed(1)}%</span>
                </div>
                <div className="bg-zinc-950/60 p-2 rounded-lg border border-zinc-800/80">
                  <span className="text-zinc-400 text-[10px] block">Active Modifiers</span>
                  <span className="font-mono text-cyan-300 font-semibold">{terrainModifiers.filter(m => m.enabled).length} of {terrainModifiers.length} active</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
