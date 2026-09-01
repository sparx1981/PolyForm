import React, { useState } from 'react';
import { X, Check, Layers, Sparkles, Sliders, ArrowRight, ShieldCheck, Box, HelpCircle } from 'lucide-react';
import { 
  DOOR_STYLES, 
  WINDOW_STYLES, 
  STAIR_STYLES, 
  WALL_STYLES,
  STAIR_STRUCTURE_OPTIONS, 
  RAILING_OPTIONS, 
  ArchStyleDef 
} from '../lib/archStyles';
import { Shape } from '../types';
import { cn } from '../lib/utils';

interface StyleLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetShape: Shape | null;
  onApplyStyle: (
    styleId: string, 
    dimensions?: [number, number, number],
    extraOptions?: {
      stairStructure?: 'closed' | 'open' | 'floating' | 'mono-stringer';
      railingMode?: 'none' | 'left' | 'right' | 'both';
    }
  ) => void;
  theme?: 'light' | 'dark';
}

function StyleDiagram({ style }: { style: ArchStyleDef }) {
  if (style.type === 'wall') {
    switch (style.id) {
      case 'feather-edge':
        return (
          <svg viewBox="0 0 140 120" className="w-full h-32 text-gray-700 dark:text-gray-300">
            {/* Horizontal tapered overlapping weatherboards */}
            <path d="M 15,20 L 125,20 L 125,36 L 15,38 Z" fill="#f8fafc" stroke="currentColor" strokeWidth="1.5" />
            <line x1="15" y1="38" x2="125" y2="36" stroke="#b45309" strokeWidth="2" />
            <path d="M 15,34 L 125,32 L 125,50 L 15,52 Z" fill="#f1f5f9" stroke="currentColor" strokeWidth="1.5" />
            <line x1="15" y1="52" x2="125" y2="50" stroke="#b45309" strokeWidth="2" />
            <path d="M 15,48 L 125,46 L 125,64 L 15,66 Z" fill="#f8fafc" stroke="currentColor" strokeWidth="1.5" />
            <line x1="15" y1="66" x2="125" y2="64" stroke="#b45309" strokeWidth="2" />
            <path d="M 15,62 L 125,60 L 125,78 L 15,80 Z" fill="#f1f5f9" stroke="currentColor" strokeWidth="1.5" />
            <line x1="15" y1="80" x2="125" y2="78" stroke="#b45309" strokeWidth="2" />
            <path d="M 15,76 L 125,74 L 125,94 L 15,96 Z" fill="#f8fafc" stroke="currentColor" strokeWidth="1.5" />
            <line x1="15" y1="96" x2="125" y2="94" stroke="#b45309" strokeWidth="2" />
            <rect x="10" y="100" width="120" height="6" fill="#cbd5e1" stroke="currentColor" strokeWidth="1.5" rx="1" />
          </svg>
        );
      case 'standard-overlap':
        return (
          <svg viewBox="0 0 140 120" className="w-full h-32 text-gray-700 dark:text-gray-300">
            {/* Horizontal stepped rectangular overlap boards */}
            <rect x="15" y="15" width="110" height="18" fill="#f8fafc" stroke="currentColor" strokeWidth="1.5" />
            <line x1="15" y1="33" x2="125" y2="33" stroke="#0063A3" strokeWidth="2.5" />
            <rect x="15" y="30" width="110" height="18" fill="#f1f5f9" stroke="currentColor" strokeWidth="1.5" />
            <line x1="15" y1="48" x2="125" y2="48" stroke="#0063A3" strokeWidth="2.5" />
            <rect x="15" y="45" width="110" height="18" fill="#f8fafc" stroke="currentColor" strokeWidth="1.5" />
            <line x1="15" y1="63" x2="125" y2="63" stroke="#0063A3" strokeWidth="2.5" />
            <rect x="15" y="60" width="110" height="18" fill="#f1f5f9" stroke="currentColor" strokeWidth="1.5" />
            <line x1="15" y1="78" x2="125" y2="78" stroke="#0063A3" strokeWidth="2.5" />
            <rect x="15" y="75" width="110" height="18" fill="#f8fafc" stroke="currentColor" strokeWidth="1.5" />
            <line x1="15" y1="93" x2="125" y2="93" stroke="#0063A3" strokeWidth="2.5" />
            <rect x="10" y="100" width="120" height="6" fill="#cbd5e1" stroke="currentColor" strokeWidth="1.5" rx="1" />
          </svg>
        );
      case 'tongue-groove':
        return (
          <svg viewBox="0 0 140 120" className="w-full h-32 text-gray-700 dark:text-gray-300">
            {/* Flush interlocking boards with micro V-joints */}
            <rect x="15" y="15" width="110" height="85" fill="#f8fafc" stroke="currentColor" strokeWidth="2" />
            <line x1="15" y1="32" x2="125" y2="32" stroke="#475569" strokeWidth="1.5" strokeDasharray="1 1" />
            <line x1="15" y1="49" x2="125" y2="49" stroke="#475569" strokeWidth="1.5" strokeDasharray="1 1" />
            <line x1="15" y1="66" x2="125" y2="66" stroke="#475569" strokeWidth="1.5" strokeDasharray="1 1" />
            <line x1="15" y1="83" x2="125" y2="83" stroke="#475569" strokeWidth="1.5" strokeDasharray="1 1" />
            <rect x="10" y="100" width="120" height="6" fill="#cbd5e1" stroke="currentColor" strokeWidth="1.5" rx="1" />
          </svg>
        );
      case 'shiplap':
        return (
          <svg viewBox="0 0 140 120" className="w-full h-32 text-gray-700 dark:text-gray-300">
            {/* Rebated boards with scooped shadow curve */}
            <rect x="15" y="15" width="110" height="85" fill="#f8fafc" stroke="currentColor" strokeWidth="2" />
            <path d="M 15,35 Q 70,39 125,35" fill="none" stroke="#0063A3" strokeWidth="2.5" />
            <path d="M 15,55 Q 70,59 125,55" fill="none" stroke="#0063A3" strokeWidth="2.5" />
            <path d="M 15,75 Q 70,79 125,75" fill="none" stroke="#0063A3" strokeWidth="2.5" />
            <rect x="10" y="100" width="120" height="6" fill="#cbd5e1" stroke="currentColor" strokeWidth="1.5" rx="1" />
          </svg>
        );
      case 'loglap':
        return (
          <svg viewBox="0 0 140 120" className="w-full h-32 text-gray-700 dark:text-gray-300">
            {/* Convex rounded log curves */}
            <path d="M 15,16 Q 15,26 125,26 L 125,16 Z" fill="#fed7aa" stroke="currentColor" strokeWidth="1.5" />
            <path d="M 15,28 Q 15,38 125,38 L 125,28 Z" fill="#fed7aa" stroke="currentColor" strokeWidth="1.5" />
            <path d="M 15,40 Q 15,50 125,50 L 125,40 Z" fill="#fed7aa" stroke="currentColor" strokeWidth="1.5" />
            <path d="M 15,52 Q 15,62 125,62 L 125,52 Z" fill="#fed7aa" stroke="currentColor" strokeWidth="1.5" />
            <path d="M 15,64 Q 15,74 125,74 L 125,64 Z" fill="#fed7aa" stroke="currentColor" strokeWidth="1.5" />
            <path d="M 15,76 Q 15,86 125,86 L 125,76 Z" fill="#fed7aa" stroke="currentColor" strokeWidth="1.5" />
            <rect x="10" y="100" width="120" height="6" fill="#cbd5e1" stroke="currentColor" strokeWidth="1.5" rx="1" />
          </svg>
        );
      case 'shadow-gap':
        return (
          <svg viewBox="0 0 140 120" className="w-full h-32 text-gray-700 dark:text-gray-300">
            {/* Crisp 12mm recessed shadow reveals */}
            <rect x="15" y="15" width="110" height="14" fill="#f8fafc" stroke="currentColor" strokeWidth="1.5" />
            <rect x="15" y="29" width="110" height="3" fill="#0f172a" />
            <rect x="15" y="32" width="110" height="14" fill="#f8fafc" stroke="currentColor" strokeWidth="1.5" />
            <rect x="15" y="46" width="110" height="3" fill="#0f172a" />
            <rect x="15" y="49" width="110" height="14" fill="#f8fafc" stroke="currentColor" strokeWidth="1.5" />
            <rect x="15" y="63" width="110" height="3" fill="#0f172a" />
            <rect x="15" y="66" width="110" height="14" fill="#f8fafc" stroke="currentColor" strokeWidth="1.5" />
            <rect x="15" y="80" width="110" height="3" fill="#0f172a" />
            <rect x="15" y="83" width="110" height="14" fill="#f8fafc" stroke="currentColor" strokeWidth="1.5" />
            <rect x="10" y="100" width="120" height="6" fill="#cbd5e1" stroke="currentColor" strokeWidth="1.5" rx="1" />
          </svg>
        );
      case 'rainscreen':
        return (
          <svg viewBox="0 0 140 120" className="w-full h-32 text-gray-700 dark:text-gray-300">
            {/* Open-joint slatted rhomboid battens over dark membrane */}
            <rect x="15" y="15" width="110" height="85" fill="#1e293b" />
            <polygon points="18,18 122,18 120,28 20,28" fill="#f59e0b" stroke="#78350f" strokeWidth="1" />
            <polygon points="18,33 122,33 120,43 20,43" fill="#f59e0b" stroke="#78350f" strokeWidth="1" />
            <polygon points="18,48 122,48 120,58 20,58" fill="#f59e0b" stroke="#78350f" strokeWidth="1" />
            <polygon points="18,63 122,63 120,73 20,73" fill="#f59e0b" stroke="#78350f" strokeWidth="1" />
            <polygon points="18,78 122,78 120,88 20,88" fill="#f59e0b" stroke="#78350f" strokeWidth="1" />
            <rect x="10" y="100" width="120" height="6" fill="#cbd5e1" stroke="currentColor" strokeWidth="1.5" rx="1" />
          </svg>
        );
      case 'board-on-board':
        return (
          <svg viewBox="0 0 140 120" className="w-full h-32 text-gray-700 dark:text-gray-300">
            {/* Vertical alternating board on board with deep 3D relief */}
            <rect x="15" y="15" width="110" height="85" fill="#e2e8f0" stroke="currentColor" strokeWidth="1.5" />
            <rect x="22" y="15" width="14" height="85" fill="#f8fafc" stroke="currentColor" strokeWidth="1" />
            <rect x="44" y="15" width="14" height="85" fill="#f8fafc" stroke="currentColor" strokeWidth="1" />
            <rect x="66" y="15" width="14" height="85" fill="#f8fafc" stroke="currentColor" strokeWidth="1" />
            <rect x="88" y="15" width="14" height="85" fill="#f8fafc" stroke="currentColor" strokeWidth="1" />
            <rect x="110" y="15" width="14" height="85" fill="#f8fafc" stroke="currentColor" strokeWidth="1" />
            {/* Front staggered capping battens */}
            <rect x="32" y="15" width="12" height="85" fill="#d97706" stroke="#78350f" strokeWidth="1" />
            <rect x="54" y="15" width="12" height="85" fill="#d97706" stroke="#78350f" strokeWidth="1" />
            <rect x="76" y="15" width="12" height="85" fill="#d97706" stroke="#78350f" strokeWidth="1" />
            <rect x="98" y="15" width="12" height="85" fill="#d97706" stroke="#78350f" strokeWidth="1" />
            <rect x="10" y="100" width="120" height="6" fill="#cbd5e1" stroke="currentColor" strokeWidth="1.5" rx="1" />
          </svg>
        );
      case 'brick-running':
        return (
          <svg viewBox="0 0 140 120" className="w-full h-32 text-gray-700 dark:text-gray-300">
            {/* Running bond red brick pattern */}
            <rect x="15" y="15" width="110" height="85" fill="#b91c1c" stroke="#7f1d1d" strokeWidth="2" />
            <line x1="15" y1="32" x2="125" y2="32" stroke="#e2e8f0" strokeWidth="1.5" />
            <line x1="15" y1="49" x2="125" y2="49" stroke="#e2e8f0" strokeWidth="1.5" />
            <line x1="15" y1="66" x2="125" y2="66" stroke="#e2e8f0" strokeWidth="1.5" />
            <line x1="15" y1="83" x2="125" y2="83" stroke="#e2e8f0" strokeWidth="1.5" />
            <line x1="45" y1="15" x2="45" y2="32" stroke="#e2e8f0" strokeWidth="1.5" />
            <line x1="85" y1="15" x2="85" y2="32" stroke="#e2e8f0" strokeWidth="1.5" />
            <line x1="25" y1="32" x2="25" y2="49" stroke="#e2e8f0" strokeWidth="1.5" />
            <line x1="65" y1="32" x2="65" y2="49" stroke="#e2e8f0" strokeWidth="1.5" />
            <line x1="105" y1="32" x2="105" y2="49" stroke="#e2e8f0" strokeWidth="1.5" />
            <line x1="45" y1="49" x2="45" y2="66" stroke="#e2e8f0" strokeWidth="1.5" />
            <line x1="85" y1="49" x2="85" y2="66" stroke="#e2e8f0" strokeWidth="1.5" />
            <line x1="25" y1="66" x2="25" y2="83" stroke="#e2e8f0" strokeWidth="1.5" />
            <line x1="65" y1="66" x2="65" y2="83" stroke="#e2e8f0" strokeWidth="1.5" />
            <line x1="105" y1="66" x2="105" y2="83" stroke="#e2e8f0" strokeWidth="1.5" />
            <rect x="10" y="100" width="120" height="6" fill="#cbd5e1" stroke="currentColor" strokeWidth="1.5" rx="1" />
          </svg>
        );
      case 'ashlar-stone':
        return (
          <svg viewBox="0 0 140 120" className="w-full h-32 text-gray-700 dark:text-gray-300">
            {/* Dressed ashlar stone blocks */}
            <rect x="15" y="15" width="110" height="85" fill="#e2e8f0" stroke="#64748b" strokeWidth="2" />
            <line x1="15" y1="43" x2="125" y2="43" stroke="#94a3b8" strokeWidth="1.5" />
            <line x1="15" y1="71" x2="125" y2="71" stroke="#94a3b8" strokeWidth="1.5" />
            <line x1="55" y1="15" x2="55" y2="43" stroke="#94a3b8" strokeWidth="1.5" />
            <line x1="95" y1="15" x2="95" y2="43" stroke="#94a3b8" strokeWidth="1.5" />
            <line x1="35" y1="43" x2="35" y2="71" stroke="#94a3b8" strokeWidth="1.5" />
            <line x1="75" y1="43" x2="75" y2="71" stroke="#94a3b8" strokeWidth="1.5" />
            <line x1="115" y1="43" x2="115" y2="71" stroke="#94a3b8" strokeWidth="1.5" />
            <line x1="55" y1="71" x2="55" y2="100" stroke="#94a3b8" strokeWidth="1.5" />
            <line x1="95" y1="71" x2="95" y2="100" stroke="#94a3b8" strokeWidth="1.5" />
            <rect x="10" y="100" width="120" height="6" fill="#cbd5e1" stroke="currentColor" strokeWidth="1.5" rx="1" />
          </svg>
        );
      case 'smooth-render':
      default:
        return (
          <svg viewBox="0 0 140 120" className="w-full h-32 text-gray-700 dark:text-gray-300">
            {/* Smooth monolithic rendered stucco */}
            <rect x="15" y="15" width="110" height="85" fill="#f8fafc" stroke="currentColor" strokeWidth="2" rx="1" />
            <circle cx="45" cy="40" r="1.5" fill="#94a3b8" opacity="0.6" />
            <circle cx="85" cy="45" r="1.5" fill="#94a3b8" opacity="0.6" />
            <circle cx="65" cy="70" r="1.5" fill="#94a3b8" opacity="0.6" />
            <circle cx="35" cy="75" r="1.5" fill="#94a3b8" opacity="0.6" />
            <circle cx="105" cy="65" r="1.5" fill="#94a3b8" opacity="0.6" />
            <rect x="10" y="100" width="120" height="6" fill="#cbd5e1" stroke="currentColor" strokeWidth="1.5" rx="1" />
          </svg>
        );
    }
  }

  if (style.type === 'door') {
    switch (style.id) {
      case '4panel':
        return (
          <svg viewBox="0 0 100 160" className="w-full h-32 text-gray-700 dark:text-gray-300">
            <rect x="10" y="5" width="80" height="150" fill="#f8fafc" stroke="currentColor" strokeWidth="3" rx="2" />
            <rect x="20" y="18" width="26" height="52" fill="#e2e8f0" stroke="currentColor" strokeWidth="1.5" rx="1" />
            <rect x="54" y="18" width="26" height="52" fill="#e2e8f0" stroke="currentColor" strokeWidth="1.5" rx="1" />
            <rect x="20" y="82" width="26" height="60" fill="#e2e8f0" stroke="currentColor" strokeWidth="1.5" rx="1" />
            <rect x="54" y="82" width="26" height="60" fill="#e2e8f0" stroke="currentColor" strokeWidth="1.5" rx="1" />
            <circle cx="78" cy="80" r="3.5" fill="#f59e0b" stroke="#78350f" strokeWidth="1" />
          </svg>
        );
      case 'french':
        return (
          <svg viewBox="0 0 100 160" className="w-full h-32 text-gray-700 dark:text-gray-300">
            <rect x="10" y="5" width="80" height="150" fill="#ffffff" stroke="currentColor" strokeWidth="3" rx="2" />
            <rect x="18" y="15" width="64" height="120" fill="#bae6fd" fillOpacity="0.4" stroke="currentColor" strokeWidth="2" />
            <line x1="50" y1="15" x2="50" y2="135" stroke="currentColor" strokeWidth="2" />
            <line x1="18" y1="55" x2="82" y2="55" stroke="currentColor" strokeWidth="2" />
            <line x1="18" y1="95" x2="82" y2="95" stroke="currentColor" strokeWidth="2" />
            <rect x="74" y="80" width="10" height="3" fill="#64748b" rx="1" />
          </svg>
        );
      case 'half-glass':
        return (
          <svg viewBox="0 0 100 160" className="w-full h-32 text-gray-700 dark:text-gray-300">
            <rect x="10" y="5" width="80" height="150" fill="#f8fafc" stroke="currentColor" strokeWidth="3" rx="2" />
            <rect x="18" y="16" width="64" height="55" fill="#bae6fd" fillOpacity="0.4" stroke="currentColor" strokeWidth="2" />
            <line x1="50" y1="16" x2="50" y2="71" stroke="currentColor" strokeWidth="2" />
            <rect x="18" y="84" width="64" height="58" fill="#e2e8f0" stroke="currentColor" strokeWidth="1.5" rx="1" />
            <circle cx="76" cy="78" r="3" fill="#64748b" />
          </svg>
        );
      case 'double-french':
        return (
          <svg viewBox="0 0 100 160" className="w-full h-32 text-gray-700 dark:text-gray-300">
            <rect x="5" y="5" width="90" height="150" fill="#ffffff" stroke="currentColor" strokeWidth="3" rx="2" />
            <line x1="50" y1="5" x2="50" y2="155" stroke="currentColor" strokeWidth="2" />
            <rect x="10" y="15" width="35" height="120" fill="#bae6fd" fillOpacity="0.4" stroke="currentColor" strokeWidth="1.5" />
            <line x1="27.5" y1="15" x2="27.5" y2="135" stroke="currentColor" strokeWidth="1" />
            <line x1="10" y1="55" x2="45" y2="55" stroke="currentColor" strokeWidth="1" />
            <line x1="10" y1="95" x2="45" y2="95" stroke="currentColor" strokeWidth="1" />
            <rect x="55" y="15" width="35" height="120" fill="#bae6fd" fillOpacity="0.4" stroke="currentColor" strokeWidth="1.5" />
            <line x1="72.5" y1="15" x2="72.5" y2="135" stroke="currentColor" strokeWidth="1" />
            <line x1="55" y1="55" x2="90" y2="55" stroke="currentColor" strokeWidth="1" />
            <line x1="55" y1="95" x2="90" y2="95" stroke="currentColor" strokeWidth="1" />
          </svg>
        );
      case 'barn':
        return (
          <svg viewBox="0 0 100 160" className="w-full h-32 text-gray-700 dark:text-gray-300">
            <rect x="2" y="4" width="96" height="5" fill="#1e293b" />
            <circle cx="28" cy="6" r="3" fill="#475569" />
            <circle cx="72" cy="6" r="3" fill="#475569" />
            <rect x="12" y="12" width="76" height="142" fill="#f8fafc" stroke="currentColor" strokeWidth="3" rx="1" />
            <rect x="18" y="20" width="64" height="12" fill="#e2e8f0" stroke="currentColor" strokeWidth="1" />
            <rect x="18" y="130" width="64" height="12" fill="#e2e8f0" stroke="currentColor" strokeWidth="1" />
            <line x1="20" y1="32" x2="80" y2="130" stroke="currentColor" strokeWidth="4" />
            <rect x="76" y="70" width="3" height="24" fill="#0f172a" rx="1" />
          </svg>
        );
      case 'horizontal-slat':
        return (
          <svg viewBox="0 0 100 160" className="w-full h-32 text-gray-700 dark:text-gray-300">
            <rect x="10" y="5" width="80" height="150" fill="#f8fafc" stroke="currentColor" strokeWidth="3" rx="2" />
            <line x1="15" y1="35" x2="85" y2="35" stroke="currentColor" strokeWidth="2" />
            <line x1="15" y1="65" x2="85" y2="65" stroke="currentColor" strokeWidth="2" />
            <line x1="15" y1="95" x2="85" y2="95" stroke="currentColor" strokeWidth="2" />
            <line x1="15" y1="125" x2="85" y2="125" stroke="currentColor" strokeWidth="2" />
            <rect x="76" y="50" width="3" height="50" fill="#64748b" rx="1" />
          </svg>
        );
      case 'pivot':
        return (
          <svg viewBox="0 0 100 160" className="w-full h-32 text-gray-700 dark:text-gray-300">
            <rect x="6" y="5" width="88" height="150" fill="#f8fafc" stroke="currentColor" strokeWidth="3" rx="2" />
            <circle cx="20" cy="8" r="3" fill="#0284c7" />
            <circle cx="20" cy="152" r="3" fill="#0284c7" />
            <line x1="20" y1="8" x2="20" y2="152" stroke="#0284c7" strokeWidth="1" strokeDasharray="3 3" />
            <rect x="78" y="25" width="3" height="105" fill="#64748b" rx="1" />
          </svg>
        );
      case 'flush':
      default:
        return (
          <svg viewBox="0 0 100 160" className="w-full h-32 text-gray-700 dark:text-gray-300">
            <rect x="10" y="5" width="80" height="150" fill="#f8fafc" stroke="currentColor" strokeWidth="3" rx="2" />
            <rect x="72" y="72" width="6" height="18" fill="#94a3b8" rx="1" />
            <rect x="70" y="78" width="14" height="3" fill="#475569" rx="1" />
          </svg>
        );
    }
  }

  if (style.type === 'window') {
    switch (style.id) {
      case 'picture':
        return (
          <svg viewBox="0 0 140 120" className="w-full h-32 text-gray-700 dark:text-gray-300">
            <rect x="10" y="10" width="120" height="90" fill="#bae6fd" fillOpacity="0.4" stroke="currentColor" strokeWidth="3" rx="1" />
            <rect x="5" y="100" width="130" height="6" fill="#cbd5e1" stroke="currentColor" strokeWidth="1.5" rx="1" />
          </svg>
        );
      case 'georgian':
        return (
          <svg viewBox="0 0 140 120" className="w-full h-32 text-gray-700 dark:text-gray-300">
            <rect x="10" y="10" width="120" height="90" fill="#bae6fd" fillOpacity="0.4" stroke="currentColor" strokeWidth="3" rx="1" />
            <line x1="50" y1="10" x2="50" y2="100" stroke="currentColor" strokeWidth="2" />
            <line x1="90" y1="10" x2="90" y2="100" stroke="currentColor" strokeWidth="2" />
            <line x1="10" y1="55" x2="130" y2="55" stroke="currentColor" strokeWidth="2" />
            <rect x="5" y="100" width="130" height="6" fill="#cbd5e1" stroke="currentColor" strokeWidth="1.5" rx="1" />
          </svg>
        );
      case 'slider':
        return (
          <svg viewBox="0 0 140 120" className="w-full h-32 text-gray-700 dark:text-gray-300">
            <rect x="10" y="10" width="120" height="90" fill="#bae6fd" fillOpacity="0.4" stroke="currentColor" strokeWidth="3" rx="1" />
            <rect x="10" y="10" width="60" height="90" fill="none" stroke="currentColor" strokeWidth="2" />
            <rect x="68" y="10" width="62" height="90" fill="none" stroke="currentColor" strokeWidth="2" />
            <rect x="66" y="50" width="6" height="10" fill="#64748b" rx="1" />
            <rect x="5" y="100" width="130" height="6" fill="#cbd5e1" stroke="currentColor" strokeWidth="1.5" rx="1" />
          </svg>
        );
      case 'ribbon':
        return (
          <svg viewBox="0 0 140 120" className="w-full h-32 text-gray-700 dark:text-gray-300">
            <rect x="5" y="25" width="130" height="60" fill="#bae6fd" fillOpacity="0.4" stroke="currentColor" strokeWidth="3" rx="1" />
            <line x1="48" y1="25" x2="48" y2="85" stroke="currentColor" strokeWidth="2.5" />
            <line x1="92" y1="25" x2="92" y2="85" stroke="currentColor" strokeWidth="2.5" />
            <rect x="2" y="85" width="136" height="6" fill="#cbd5e1" stroke="currentColor" strokeWidth="1.5" rx="1" />
          </svg>
        );
      case 'arch':
        return (
          <svg viewBox="0 0 140 120" className="w-full h-32 text-gray-700 dark:text-gray-300">
            <path d="M 20,100 L 20,45 A 50,35 0 0,1 120,45 L 120,100 Z" fill="#bae6fd" fillOpacity="0.4" stroke="currentColor" strokeWidth="3" />
            <line x1="20" y1="50" x2="120" y2="50" stroke="currentColor" strokeWidth="2" />
            <line x1="70" y1="50" x2="70" y2="100" stroke="currentColor" strokeWidth="2" />
            <line x1="70" y1="50" x2="45" y2="25" stroke="currentColor" strokeWidth="1.5" />
            <line x1="70" y1="50" x2="95" y2="25" stroke="currentColor" strokeWidth="1.5" />
            <rect x="15" y="100" width="110" height="6" fill="#cbd5e1" stroke="currentColor" strokeWidth="1.5" rx="1" />
          </svg>
        );
      case 'double-hung':
        return (
          <svg viewBox="0 0 140 120" className="w-full h-32 text-gray-700 dark:text-gray-300">
            <rect x="15" y="10" width="110" height="90" fill="#bae6fd" fillOpacity="0.4" stroke="currentColor" strokeWidth="3" rx="1" />
            <rect x="18" y="12" width="104" height="42" fill="none" stroke="currentColor" strokeWidth="2" />
            <line x1="70" y1="12" x2="70" y2="54" stroke="currentColor" strokeWidth="1.5" />
            <rect x="18" y="54" width="104" height="44" fill="none" stroke="currentColor" strokeWidth="2" />
            <line x1="70" y1="54" x2="70" y2="98" stroke="currentColor" strokeWidth="1.5" />
            <rect x="66" y="52" width="8" height="4" fill="#f59e0b" rx="1" />
            <rect x="10" y="100" width="120" height="6" fill="#cbd5e1" stroke="currentColor" strokeWidth="1.5" rx="1" />
          </svg>
        );
      case 'transom':
        return (
          <svg viewBox="0 0 140 120" className="w-full h-32 text-gray-700 dark:text-gray-300">
            <rect x="15" y="10" width="110" height="90" fill="#bae6fd" fillOpacity="0.4" stroke="currentColor" strokeWidth="3" rx="1" />
            <rect x="17" y="12" width="106" height="25" fill="none" stroke="currentColor" strokeWidth="2" />
            <rect x="17" y="37" width="106" height="61" fill="none" stroke="currentColor" strokeWidth="2" />
            <rect x="10" y="100" width="120" height="6" fill="#cbd5e1" stroke="currentColor" strokeWidth="1.5" rx="1" />
          </svg>
        );
      case 'cross':
      default:
        return (
          <svg viewBox="0 0 140 120" className="w-full h-32 text-gray-700 dark:text-gray-300">
            <rect x="15" y="10" width="110" height="90" fill="#bae6fd" fillOpacity="0.4" stroke="currentColor" strokeWidth="3" rx="1" />
            <line x1="70" y1="10" x2="70" y2="100" stroke="currentColor" strokeWidth="2.5" />
            <line x1="15" y1="55" x2="125" y2="55" stroke="currentColor" strokeWidth="2.5" />
            <rect x="10" y="100" width="120" height="6" fill="#cbd5e1" stroke="currentColor" strokeWidth="1.5" rx="1" />
          </svg>
        );
    }
  }

  // Staircase Diagrams
  switch (style.id) {
    case 'straight':
      return (
        <svg viewBox="0 0 140 120" className="w-full h-32 text-gray-700 dark:text-gray-300">
          <path d="M 20,100 L 35,100 L 35,85 L 50,85 L 50,70 L 65,70 L 65,55 L 80,55 L 80,40 L 95,40 L 95,25 L 115,25" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
          {/* Railing line */}
          <line x1="20" y1="75" x2="115" y2="5" stroke="#0063A3" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="20" y1="100" x2="20" y2="75" stroke="#0063A3" strokeWidth="2" />
          <line x1="65" y1="55" x2="65" y2="35" stroke="#0063A3" strokeWidth="1.5" />
          <line x1="115" y1="25" x2="115" y2="5" stroke="#0063A3" strokeWidth="2" />
        </svg>
      );
    case 'l-shape':
      return (
        <svg viewBox="0 0 140 120" className="w-full h-32 text-gray-700 dark:text-gray-300">
          {/* Bottom flight */}
          <path d="M 20,105 L 35,105 L 35,90 L 50,90 L 50,75 L 65,75 L 65,60" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
          {/* Landing */}
          <rect x="65" y="45" width="28" height="28" fill="#e2e8f0" stroke="currentColor" strokeWidth="2" rx="2" />
          {/* Top flight turning right */}
          <path d="M 93,52 L 105,52 L 105,38 L 118,38 L 118,24 L 130,24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
          <circle cx="79" cy="59" r="3" fill="#0063A3" />
        </svg>
      );
    case 'u-shape':
      return (
        <svg viewBox="0 0 140 120" className="w-full h-32 text-gray-700 dark:text-gray-300">
          {/* Flight 1 up */}
          <path d="M 25,105 L 25,50" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeDasharray="2 10" />
          {/* Switchback Landing */}
          <rect x="20" y="15" width="100" height="30" fill="#e2e8f0" stroke="currentColor" strokeWidth="2.5" rx="3" />
          {/* Flight 2 down/up */}
          <path d="M 115,50 L 115,105" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeDasharray="2 10" />
          {/* Turn Arrow */}
          <path d="M 40,40 C 40,25 100,25 100,40" fill="none" stroke="#0063A3" strokeWidth="3" strokeLinecap="round" markerEnd="url(#arrow)" />
        </svg>
      );
    case 'c-shape':
      return (
        <svg viewBox="0 0 140 120" className="w-full h-32 text-gray-700 dark:text-gray-300">
          {/* Smooth 180° radial arc */}
          <path d="M 30,100 A 50,50 0 0,1 30,20" fill="none" stroke="currentColor" strokeWidth="12" strokeLinecap="round" strokeDasharray="4 6" />
          <path d="M 30,100 A 50,50 0 0,1 30,20" fill="none" stroke="#0063A3" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="30" cy="100" r="4" fill="#0063A3" />
          <circle cx="30" cy="20" r="4" fill="#0063A3" />
        </svg>
      );
    case 'winder':
      return (
        <svg viewBox="0 0 140 120" className="w-full h-32 text-gray-700 dark:text-gray-300">
          {/* Straight flight into pie winders */}
          <path d="M 25,105 L 25,70" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeDasharray="2 8" />
          {/* Pie wedge corner */}
          <path d="M 25,70 L 65,70 L 65,30 L 25,30 Z" fill="#e2e8f0" stroke="currentColor" strokeWidth="2" />
          <line x1="25" y1="70" x2="65" y2="30" stroke="currentColor" strokeWidth="2" />
          <line x1="25" y1="70" x2="65" y2="50" stroke="currentColor" strokeWidth="1.5" />
          {/* Upper flight */}
          <path d="M 65,30 L 115,30" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeDasharray="2 8" />
        </svg>
      );
    case 'spiral':
      return (
        <svg viewBox="0 0 140 120" className="w-full h-32 text-gray-700 dark:text-gray-300">
          {/* Central post */}
          <circle cx="70" cy="60" r="8" fill="#1e293b" stroke="currentColor" strokeWidth="2" />
          {/* Radiating treads */}
          <line x1="70" y1="52" x2="70" y2="15" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          <line x1="76" y1="54" x2="105" y2="25" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          <line x1="78" y1="60" x2="118" y2="60" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          <line x1="76" y1="66" x2="105" y2="95" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          <line x1="70" y1="68" x2="70" y2="105" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          <line x1="64" y1="66" x2="35" y2="95" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          <line x1="62" y1="60" x2="22" y2="60" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          <line x1="64" y1="54" x2="35" y2="25" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          {/* Outer circle railing */}
          <circle cx="70" cy="60" r="48" fill="none" stroke="#0063A3" strokeWidth="2" strokeDasharray="6 4" />
        </svg>
      );
    case 'curved':
      return (
        <svg viewBox="0 0 140 120" className="w-full h-32 text-gray-700 dark:text-gray-300">
          {/* Open center grand curve */}
          <path d="M 25,100 C 35,40 105,40 115,100" fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="round" strokeDasharray="3 7" />
          <path d="M 25,100 C 35,40 105,40 115,100" fill="none" stroke="#0063A3" strokeWidth="2" />
        </svg>
      );
    case 'bifurcated':
      return (
        <svg viewBox="0 0 140 120" className="w-full h-32 text-gray-700 dark:text-gray-300">
          {/* Wide master flight */}
          <rect x="50" y="70" width="40" height="40" fill="#e2e8f0" stroke="currentColor" strokeWidth="2" rx="2" />
          <line x1="50" y1="83" x2="90" y2="83" stroke="currentColor" strokeWidth="1.5" />
          <line x1="50" y1="96" x2="90" y2="96" stroke="currentColor" strokeWidth="1.5" />
          {/* Central grand landing */}
          <rect x="35" y="45" width="70" height="25" fill="#bae6fd" fillOpacity="0.5" stroke="currentColor" strokeWidth="2" rx="2" />
          {/* Left flight */}
          <path d="M 35,50 L 15,20" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
          {/* Right flight */}
          <path d="M 105,50 L 125,20" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 140 120" className="w-full h-32 text-gray-700 dark:text-gray-300">
          <path d="M 20,100 L 120,20" stroke="currentColor" strokeWidth="4" />
        </svg>
      );
  }
}

export default function StyleLibraryModal({
  isOpen,
  onClose,
  targetShape,
  onApplyStyle,
  theme = 'light'
}: StyleLibraryModalProps) {
  if (!isOpen || !targetShape) return null;

  const isDoor = targetShape.type === 'door';
  const isStair = targetShape.type === 'staircase' || targetShape.type === 'step';
  const isWall = targetShape.type === 'wall';
  const isWindow = !isDoor && !isStair && !isWall;

  let styles: ArchStyleDef[] = [];
  let defaultStyleId = 'flush';
  let title = 'Architectural Styles';

  if (isDoor) {
    styles = DOOR_STYLES;
    defaultStyleId = 'flush';
    title = 'Architectural Door Styles';
  } else if (isStair) {
    styles = STAIR_STYLES;
    defaultStyleId = 'straight';
    title = 'Architectural Staircase Styles';
  } else if (isWall) {
    styles = WALL_STYLES;
    defaultStyleId = 'feather-edge';
    title = 'Exterior Wall Styles & Claddings';
  } else {
    styles = WINDOW_STYLES;
    defaultStyleId = 'cross';
    title = 'Architectural Window Styles';
  }

  const currentStyleId = targetShape.wallStyle || targetShape.stairStyle || targetShape.archStyle || defaultStyleId;
  const [selectedStyleId, setSelectedStyleId] = useState<string>(currentStyleId);
  const [activeCategory, setActiveCategory] = useState<string>('All');

  // Staircase specific structural & railing state
  const [stairStructure, setStairStructure] = useState<'closed' | 'open' | 'floating' | 'mono-stringer'>(
    targetShape.stairStructure || 'closed'
  );
  const [railingMode, setRailingMode] = useState<'none' | 'left' | 'right' | 'both'>(
    targetShape.railingMode || 'both'
  );

  // Dimensions
  const defaultWidth = isDoor ? 0.9 : isStair ? 1.0 : isWall ? 3.0 : 1.2;
  const defaultHeight = isDoor ? 2.1 : isStair ? 2.7 : isWall ? 2.8 : 1.2;
  const defaultDepth = isDoor ? 0.15 : isStair ? 3.6 : isWall ? 0.2 : 0.12;

  const [width, setWidth] = useState<number>(
    Array.isArray(targetShape.args) ? targetShape.args[0] || defaultWidth : defaultWidth
  );
  const [height, setHeight] = useState<number>(
    Array.isArray(targetShape.args) ? targetShape.args[1] || defaultHeight : defaultHeight
  );
  const [depth, setDepth] = useState<number>(
    Array.isArray(targetShape.args) ? targetShape.args[2] || defaultDepth : defaultDepth
  );

  const categories = ['All', 'Layout', 'Modern', 'Classic', 'Specialty', 'Commercial'].filter(cat => 
    cat === 'All' || styles.some(s => s.category === cat)
  );

  const filteredStyles = activeCategory === 'All'
    ? styles
    : styles.filter(s => s.category === activeCategory);

  const handleSelectStyle = (style: ArchStyleDef) => {
    setSelectedStyleId(style.id);
    // Only update default dimensions for door/window if the shape didn't already have custom dimensions
    if (!isWall && !isStair && style.defaultDimensions) {
      setWidth(style.defaultDimensions[0]);
      setHeight(style.defaultDimensions[1]);
      setDepth(style.defaultDimensions[2]);
    }
  };

  const handleConfirm = () => {
    const finalDims = isStair 
      ? [width, height, depth, Array.isArray(targetShape.args) && targetShape.args[3] ? targetShape.args[3] : 12]
      : [width, height, depth];
    onApplyStyle(
      selectedStyleId, 
      finalDims, 
      isStair ? { stairStructure, railingMode } : undefined
    );
    onClose();
  };

  return (
    <div 
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div 
        className={cn(
          "w-full max-w-4xl max-h-[92vh] flex flex-col rounded-xl shadow-2xl border overflow-hidden",
          theme === 'dark' ? "bg-gray-900 border-gray-700 text-gray-100" : "bg-white border-gray-200 text-gray-900"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={cn(
          "px-6 py-4 flex items-center justify-between border-b",
          theme === 'dark' ? "border-gray-800 bg-gray-900/50" : "border-gray-100 bg-gray-50/70"
        )}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-trimble-blue/10 text-trimble-blue flex items-center justify-center font-bold">
              <Layers size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold flex items-center gap-2">
                {title}
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-trimble-blue/10 text-trimble-blue">
                  {styles.length} Styles Available
                </span>
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {isStair 
                  ? 'Configure staircase flight layout, structural riser system, balustrade railings, and dimensions.' 
                  : 'Choose a CAD-accurate architectural profile. Changes apply immediately to the 3D model and wall cutouts.'}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-800 text-gray-500 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Categories Bar */}
        {categories.length > 2 && (
          <div className="px-6 py-2.5 border-b border-gray-200 dark:border-gray-800 flex items-center gap-2 overflow-x-auto">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-all",
                  activeCategory === cat
                    ? "bg-trimble-blue text-white shadow-sm"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                )}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Style Grid */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3">
              {isStair ? 'Flight Geometry & Turn Layout' : 'Profile Variations'}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {filteredStyles.map((style) => {
                const isSelected = selectedStyleId === style.id;
                const isCurrent = currentStyleId === style.id;

                return (
                  <div
                    key={style.id}
                    onClick={() => handleSelectStyle(style)}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelectStyle(style); }
                    }}
                    className={cn(
                      "group relative flex flex-col rounded-xl border p-4 cursor-pointer transition-all duration-200",
                      "outline-none focus-visible:ring-2 focus-visible:ring-trimble-blue focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900",
                      isSelected
                        ? "border-trimble-blue ring-2 ring-trimble-blue/20 bg-trimble-blue/[0.03] shadow-md"
                        : "border-gray-200 dark:border-gray-800 hover:border-trimble-blue/50 hover:bg-gray-50/50 dark:hover:bg-gray-800/40"
                    )}
                  >
                    <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 p-3 flex items-center justify-center">
                      <StyleDiagram style={style} />
                    </div>

                    <h3 className={cn("mt-3 font-semibold text-sm leading-snug", theme === 'dark' ? "text-white" : "text-gray-900")}>
                      {style.name}
                    </h3>

                    <p className={cn("mt-1 text-xs leading-relaxed line-clamp-2 min-h-[2.5rem]", theme === 'dark' ? "text-gray-400" : "text-gray-600")}>
                      {style.description}
                    </p>

                    <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 flex flex-wrap gap-1.5">
                      <span className="text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-trimble-blue/10 text-trimble-blue">
                        {style.category}
                      </span>
                      {style.features.slice(0, 2).map((feat, idx) => (
                        <span key={idx} className={cn("text-[11px] px-2 py-0.5 rounded-full", theme === 'dark' ? "bg-gray-800/80 text-gray-300" : "bg-gray-100 text-gray-700")}>
                          {feat}
                        </span>
                      ))}
                    </div>

                    {isSelected && (
                      <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-trimble-blue text-white flex items-center justify-center shadow-sm shadow-trimble-blue/30">
                        <Check size={12} strokeWidth={3} />
                      </div>
                    )}
                    {isCurrent && !isSelected && (
                      <span className="absolute top-3 right-3 text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                        Applied
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Staircase Specific Configuration Section */}
          {isStair && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-gray-200 dark:border-gray-800">
              {/* Structural / Architectural Style */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3 flex items-center gap-2">
                  <Box size={14} className="text-trimble-blue" />
                  <span>Architectural & Structural Style</span>
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {STAIR_STRUCTURE_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setStairStructure(opt.id)}
                      className={cn(
                        "p-3 text-left rounded-lg border transition-all text-xs flex flex-col justify-between",
                        stairStructure === opt.id
                          ? "border-trimble-blue bg-trimble-blue/5 text-trimble-blue ring-1 ring-trimble-blue"
                          : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-800/50"
                      )}
                    >
                      <div className="font-semibold flex items-center justify-between w-full">
                        <span>{opt.name}</span>
                        {stairStructure === opt.id && <Check size={14} />}
                      </div>
                      <p className="mt-1 text-[11px] opacity-75 leading-tight">
                        {opt.description}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Railing & Balustrade Options */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3 flex items-center gap-2">
                  <ShieldCheck size={14} className="text-trimble-blue" />
                  <span>Balustrade & Handrail Placement</span>
                </h4>
                <div className="grid grid-cols-2 gap-2.5">
                  {RAILING_OPTIONS.map((rail) => (
                    <button
                      key={rail.id}
                      type="button"
                      onClick={() => setRailingMode(rail.id)}
                      className={cn(
                        "p-3 text-left rounded-lg border transition-all text-xs flex flex-col justify-between",
                        railingMode === rail.id
                          ? "border-trimble-blue bg-trimble-blue/5 text-trimble-blue ring-1 ring-trimble-blue"
                          : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-800/50"
                      )}
                    >
                      <div className="font-semibold flex items-center justify-between w-full">
                        <span>{rail.name}</span>
                        {railingMode === rail.id && <Check size={14} />}
                      </div>
                      <p className="mt-1 text-[11px] opacity-75 leading-tight">
                        {rail.description}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Dimensions & Actions */}
        <div className={cn(
          "px-6 py-4 border-t flex flex-col sm:flex-row items-center justify-between gap-4",
          theme === 'dark' ? "border-gray-800 bg-gray-900/80" : "border-gray-100 bg-gray-50/80"
        )}>
          {/* Quick Dimensions */}
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <Sliders size={16} className="text-gray-400" />
            <div className="flex items-center gap-2 text-xs flex-wrap">
              <span className="font-medium text-gray-500">Width:</span>
              <input 
                type="number" 
                step="0.05"
                min="0.4"
                max="10.0"
                value={width}
                onChange={(e) => setWidth(parseFloat(e.target.value) || width)}
                className="w-16 px-2 py-1 text-xs font-mono rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 outline-none focus:border-trimble-blue"
              />
              <span className="text-gray-400">m</span>

              <span className="font-medium text-gray-500 ml-2">{isStair ? 'Height (Rise):' : 'Height:'}</span>
              <input 
                type="number" 
                step="0.05"
                min="0.2"
                max="10.0"
                value={height}
                onChange={(e) => setHeight(parseFloat(e.target.value) || height)}
                className="w-16 px-2 py-1 text-xs font-mono rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 outline-none focus:border-trimble-blue"
              />
              <span className="text-gray-400">m</span>

              <span className="font-medium text-gray-500 ml-2">{isStair ? 'Length (Run):' : 'Depth:'}</span>
              <input 
                type="number" 
                step="0.05"
                min="0.05"
                max="15.0"
                value={depth}
                onChange={(e) => setDepth(parseFloat(e.target.value) || depth)}
                className="w-16 px-2 py-1 text-xs font-mono rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 outline-none focus:border-trimble-blue"
              />
              <span className="text-gray-400">m</span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium rounded-lg hover:bg-gray-200 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              className="px-5 py-2 text-xs font-bold rounded-lg bg-trimble-blue hover:bg-trimble-blue/90 text-white shadow-sm flex items-center gap-2 transition-transform active:scale-95"
            >
              <span>Apply Style</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
