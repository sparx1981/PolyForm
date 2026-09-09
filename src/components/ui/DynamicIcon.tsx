import React from 'react';
import {
  Home, Hammer, Sparkles, Box, Boxes, TreePine, Ruler, Wrench, Settings,
  Code, Terminal, Sliders, SlidersHorizontal, Building2, DoorOpen, AppWindow,
  TrendingUp, Layers, Sun, Moon, Palette, Scissors, Circle, Play, Check,
  Zap, Compass, Eye, RefreshCw, FileCode, Folder, Save, Package, Wand2,
  Star, Flame, Lightbulb, PenTool, Layout, Grid, Shield, Activity, Move,
  RotateCw, Trash2, Edit, Plus, Minus, Info, Camera, Video, Bell, Music,
  Heart, Bookmark, Square, Triangle, Hexagon, Spline, Disc, Compass as CompassIcon
} from 'lucide-react';

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  home: Home,
  hammer: Hammer,
  sparkles: Sparkles,
  box: Box,
  boxes: Boxes,
  treepine: TreePine,
  tree: TreePine,
  ruler: Ruler,
  wrench: Wrench,
  settings: Settings,
  code: Code,
  terminal: Terminal,
  sliders: Sliders,
  slidershorizontal: SlidersHorizontal,
  building2: Building2,
  building: Building2,
  dooropen: DoorOpen,
  door: DoorOpen,
  appwindow: AppWindow,
  window: AppWindow,
  trendingup: TrendingUp,
  stairs: TrendingUp,
  layers: Layers,
  sun: Sun,
  moon: Moon,
  palette: Palette,
  scissors: Scissors,
  circle: Circle,
  play: Play,
  check: Check,
  zap: Zap,
  compass: Compass,
  eye: Eye,
  refreshcw: RefreshCw,
  filecode: FileCode,
  folder: Folder,
  save: Save,
  package: Package,
  wand2: Wand2,
  wand: Wand2,
  star: Star,
  flame: Flame,
  lightbulb: Lightbulb,
  pentool: PenTool,
  layout: Layout,
  grid: Grid,
  shield: Shield,
  activity: Activity,
  move: Move,
  rotatecw: RotateCw,
  trash2: Trash2,
  trash: Trash2,
  edit: Edit,
  plus: Plus,
  minus: Minus,
  info: Info,
  camera: Camera,
  video: Video,
  bell: Bell,
  music: Music,
  heart: Heart,
  bookmark: Bookmark,
  square: Square,
  triangle: Triangle,
  hexagon: Hexagon,
  spline: Spline,
  disc: Disc
};

// Simple regex or test to detect emojis
function isEmojiOrText(str: string): boolean {
  if (!str) return false;
  // If string contains non-ascii or is short (1-2 chars) or has emoji unicode
  const emojiRegex = /\p{Extended_Pictographic}/u;
  return emojiRegex.test(str) || (str.length <= 2 && str.charCodeAt(0) > 127);
}

interface DynamicIconProps {
  nameOrEmoji?: string;
  size?: number;
  className?: string;
}

export const DynamicIcon: React.FC<DynamicIconProps> = ({
  nameOrEmoji,
  size = 18,
  className = ''
}) => {
  if (!nameOrEmoji) {
    return <Sparkles size={size} className={className} />;
  }

  const trimmed = nameOrEmoji.trim();

  // If it's an emoji or unicode symbol
  if (isEmojiOrText(trimmed)) {
    return (
      <span 
        style={{ fontSize: `${Math.round(size * 0.95)}px`, lineHeight: 1 }} 
        className={`inline-flex items-center justify-center select-none ${className}`}
      >
        {trimmed}
      </span>
    );
  }

  // Lookup in icon map (case-insensitive)
  const normalizedKey = trimmed.toLowerCase().replace(/[^a-z0-9]/g, '');
  const IconComponent = ICON_MAP[normalizedKey];

  if (IconComponent) {
    return <IconComponent size={size} className={className} />;
  }

  // If short 1-3 letter text abbreviation
  if (trimmed.length <= 3) {
    return (
      <span 
        style={{ fontSize: `${Math.max(10, Math.round(size * 0.65))}px`, fontWeight: 700 }}
        className={`inline-flex items-center justify-center font-mono select-none uppercase ${className}`}
      >
        {trimmed}
      </span>
    );
  }

  // Fallback to Sparkles / Wand
  return <Sparkles size={size} className={className} />;
};
