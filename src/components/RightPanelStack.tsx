import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Box, BoxSelect, Building2, CheckCircle2, ChevronDown, ChevronRight, Circle as CircleIcon, Clapperboard, Copy as CopyIcon, Crown, Eye, EyeOff, Hammer, Home, ImageOff, Info, KeyRound, Layers, ListTree, MessageSquare, Palette, PenTool, Plus, Search, Send, Settings, Settings2, Sparkles, StickyNote, Sun, Trash2, Upload, Users, Wand2, X } from 'lucide-react';
import { cn, safelyToDate } from '../lib/utils';
import { HuggingFaceService } from '../services/sketchupService';
import { useApp } from '../AppContext';
import { faceSummaries, toggleFaceHidden, deleteFaceAndEdges, faceGroups, setGroupHidden, deleteGroupFacesAndEdges } from '../tools/kernelSelection';
import { tessellateFace, mergeBuffers } from '../lib/geometry/tessellate';
import { ToolModifierPalette } from './ToolModifierPalette';
import Messaging from './Messaging';
import { SceneAnimation, ChatMessage, Collaborator } from '../types';
import { LANDSCAPE_TEXTURES } from '../lib/landscapeTextures';
import { motion, AnimatePresence } from 'motion/react';
import { storage, db, handleFirestoreError, OperationType } from '../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { collection, addDoc, serverTimestamp, onSnapshot, query, where, doc, getDoc, deleteDoc, getDocs, setDoc } from 'firebase/firestore';

const COLORS = [
  '#ffffff', '#ef4444', '#f97316', '#f59e0b', 
  '#eab308', '#84cc16', '#22c55e', '#10b981',
  '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6',
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
  '#ec4899', '#f43f5e', '#71717a', '#18181b'
];

// Generates a small, fully client-side procedural preview texture for a
// Pre-Made PBR material, based on its base colour, roughness and metalness,
// plus simple keyword-based category detection (metal / wood / fabric /
// stone / glossy). Replaces the old approach of trying to load a photo from
// an external site (which usually 404'd) and falling back to a random,
// unrelated stock photo from picsum.photos - which is why materials looked
// like flat colour swatches (or, worse, an unrelated photo) instead of an
// actual texture. Runs once per material and is cached on the object, so it
// never touches the network.
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full || '888888', 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function shadeRgb(rgb: [number, number, number], amt: number): [number, number, number] {
  return rgb.map(c => Math.max(0, Math.min(255, Math.round(c + amt)))) as [number, number, number];
}
function rgbCss(rgb: [number, number, number], a: number = 1): string {
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
}
function generateMaterialTexture(mat: { name?: string; color?: string; roughness?: number; metalness?: number }): string {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const base = hexToRgb(mat.color || '#888888');
  ctx.fillStyle = rgbCss(base);
  ctx.fillRect(0, 0, size, size);

  const name = (mat.name || '').toLowerCase();
  const metalness = mat.metalness ?? 0;
  const roughness = mat.roughness ?? 0.5;

  if (metalness > 0.5) {
    // Brushed metal: horizontal streaks of varying tone.
    for (let y = 0; y < size; y++) {
      const n = (Math.sin(y * 0.7) + Math.sin(y * 3.1 + 2)) * 0.5;
      ctx.fillStyle = rgbCss(shadeRgb(base, n * 22), 0.5);
      ctx.fillRect(0, y, size, 1);
    }
  } else if (/wood|oak|pine|walnut|mahogany|ebony|cork/.test(name)) {
    // Wood grain: wavy vertical lines.
    for (let x = 0; x < size; x += 3) {
      ctx.strokeStyle = rgbCss(shadeRgb(base, -20 - (x % 9)));
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let y = 0; y <= size; y += 8) {
        const wob = Math.sin((y + x) * 0.15) * 4;
        ctx.lineTo(x + wob, y);
      }
      ctx.stroke();
    }
  } else if (/denim|velvet|felt|canvas|leather|fabric/.test(name)) {
    // Woven fabric: crosshatch.
    ctx.strokeStyle = rgbCss(shadeRgb(base, -25), 0.5);
    for (let i = -size; i < size; i += 6) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + size, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(i + size, 0); ctx.lineTo(i, size); ctx.stroke();
    }
  } else if (/concrete|stone|granite|marble|slate|sandstone|limestone|asphalt|brick|chalk|sand|ceramic|porcelain|snow|moss/.test(name)) {
    // Speckled / mottled surface.
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * size, y = Math.random() * size;
      ctx.fillStyle = rgbCss(shadeRgb(base, (Math.random() - 0.5) * 50), 0.5);
      ctx.fillRect(x, y, 1.5, 1.5);
    }
  } else if (roughness < 0.15) {
    // Glossy / glass: soft diagonal sheen.
    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, rgbCss(shadeRgb(base, 40)));
    grad.addColorStop(0.5, rgbCss(base));
    grad.addColorStop(1, rgbCss(shadeRgb(base, -30)));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  } else {
    // Default: subtle grain noise so it never reads as a flat swatch.
    for (let i = 0; i < 500; i++) {
      const x = Math.random() * size, y = Math.random() * size;
      ctx.fillStyle = rgbCss(shadeRgb(base, (Math.random() - 0.5) * 18), 0.4);
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return canvas.toDataURL('image/png');
}

interface PanelProps {
  id: string;
  title: string;
  icon: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function Panel({ title, icon, isOpen, onToggle, children }: PanelProps) {
  const { theme } = useApp();
  return (
    <div className={cn("border-b", theme === 'dark' ? "border-gray-700" : "border-gray-200")}>
      <button
        onClick={onToggle}
        className={cn(
          "w-full h-10 flex items-center justify-between px-3 transition-colors",
          theme === 'dark' ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-200 text-trimble-gray"
        )}
      >
        <div className="flex items-center gap-2">
          <span className={theme === 'dark' ? "text-gray-400" : "text-gray-500"}>{icon}</span>
          <span className="text-xs font-semibold uppercase tracking-wider">{title}</span>
        </div>
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {isOpen && (
        <div className={cn(
          "p-4 text-xs animate-in fade-in slide-in-from-top-1 duration-200",
          theme === 'dark' ? "bg-gray-800 text-gray-300" : "bg-white"
        )}>
          {children}
        </div>
      )}
    </div>
  );
}

function SubSection({ title, children, defaultOpen = false }: { title: string, children: React.ReactNode, defaultOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const { theme } = useApp();
  
  return (
    <div className={cn(
      "border rounded-lg overflow-hidden mb-2",
      theme === 'dark' ? "border-gray-700 bg-gray-900/30" : "border-gray-100 bg-gray-50/50"
    )}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-full flex items-center justify-between px-3 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors",
          theme === 'dark' ? "text-gray-400 hover:bg-gray-700" : "text-gray-500 hover:bg-gray-100"
        )}
      >
        <span>{title}</span>
        {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {isOpen && <div className="px-3 pb-3 space-y-3">{children}</div>}
    </div>
  );
}

export default function RightPanelStack() {
  const { 
    activeMaterial, 
    setActiveMaterial, 
    activePBR,
    setActivePBR,
    shapes,
    kernelHost,
    kernelRevision,
    bumpKernel,
    selectedFaceIds,
    setSelectedFaceIds, 
    setShapes,
    removeShape,
    addShape,
    commitHistory,
    selectedId, 
    setSelectedId, 
    selectedIds,
    setSelectedIds,
    updateShapeDimensions,
    updateShapeColor,
    user,
    customMaterials,
    setCustomMaterials,
    tags,
    setTags,
    scenes,
    setScenes,
    shadowsEnabled,
    setShadowsEnabled,
    showLightsource,
    setShowLightsource,
    edgeLinesEnabled,
    setEdgeLinesEnabled,
    edgeLinesColor,
    setEdgeLinesColor,
    edgeLinesOpacity,
    setEdgeLinesOpacity,
    edgeLinesThickness,
    setEdgeLinesThickness,
    lightPosition,
    setLightPosition,
    sunOrbitCenter,
    setSunOrbitCenter,
    pickingSunCenter,
    setPickingSunCenter,
    animateSun,
    setAnimateSun,
    sunSpeed,
    setSunSpeed,
    theme,
    isMessagingDocked,
    isToolModifierDocked,
    panelVisibility,
    activeTagId,
    setActiveTagId,
    allTagsVisible,
    setAllTagsVisible,
    skybox,
    setSkybox,
    sunIntensity,
    setSunIntensity,
    shadowOpacity,
    setShadowOpacity,
    ambientOcclusionEnabled,
    setAmbientOcclusionEnabled,
    customLights,
    setCustomLights,
    fogSettings,
    setFogSettings,
    selectedLightId,
    setSelectedLightId,
    activeTool,
    setActiveTool,
    gridEnabled,
    setGridEnabled,
    floorEnabled,
    setFloorEnabled,
    floorColor,
    setFloorColor,
    skyboxBlur,
    setSkyboxBlur,
    environmentIntensity,
    setEnvironmentIntensity,
    skyboxRotation,
    setSkyboxRotation,
    placingLightId,
    setPlacingLightId,
    animations,
    setAnimations,
    placingAnimationId,
    setPlacingAnimationId,
    unit,
    setUnit,
    setShapesSilent,
    recordAction,
    notes,
    setNotes,
    placingNoteId,
    setPlacingNoteId,
    isCollaborationOpen,
    setIsCollaborationOpen,
    collaborators,
    setCollaborators,
    chatMessages,
    setChatMessages,
    currentModelId,
    setCurrentModelId,
    deformationSettings,
    setDeformationSettings,
    subtractCutterId,
    setSubtractCutterId,
    subtractTargetId,
    setSubtractTargetId,
    allNotesVisible,
    setAllNotesVisible,
    isMessagingOpen,
    setIsMessagingOpen,
    showCollaboratorCursors,
    setShowCollaboratorCursors,
    diagLog,
    openMaterialsSignal,
  refreshMaterials
  } = useApp();

  useEffect(() => {
    if (!fogSettings.enabled && fogSettings.animate) {
      setFogSettings(prev => ({ ...prev, animate: false }));
    }
  }, [fogSettings.enabled, fogSettings.animate, setFogSettings]);
  
  /**
   * Duplicates a set of kernel-graph faces (drawn geometry — lines,
   * rectangles, arcs, subtract results — not Shape[] primitives) as a
   * new, independent 'custom' Shape, offset slightly from the
   * original. Needed because kernel faces have no single Shape object
   * to spread-clone the way every other duplicate button here does —
   * tessellating them into a real mesh and adding that as a new Shape
   * is the only way to give them an independent copy at all. This is
   * what was actually missing for "all object types" to have a
   * working duplicate action, since every non-kernel row already had
   * a plain Shape to clone directly.
   */
  const duplicateKernelFaces = (faces: any[], label: string) => {
    const meshes = faces
      .map((id) => tessellateFace(kernelHost.graph, id))
      .filter((m): m is NonNullable<typeof m> => m !== null);
    if (meshes.length === 0) return;
    const merged = mergeBuffers(meshes);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(merged.position, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(merged.normal, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(merged.uv, 2));
    geo.setIndex(new THREE.BufferAttribute(merged.index, 1));
    // The tessellated vertices are already in world space (same as
    // every kernel-based 'custom' Shape delivered this session), so
    // the visible offset has to be baked into the geometry itself —
    // setting the Shape's own position here instead would ADD to
    // those already-absolute coordinates rather than shifting them
    // from where the original actually sits.
    geo.translate(0.3, 0, 0.3);
    const geometryData = geo.toJSON();
    addShape({
      id: Math.random().toString(36).substr(2, 9),
      name: `${label} Copy`,
      type: 'custom',
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      color: activeMaterial,
      args: [],
      geometryData,
    });
    commitHistory();
  };

  const [openPanels, setOpenPanels] = useState<string[]>(['entity', 'toolModifiers']);

  useEffect(() => {
    if (['wall', 'fence', 'railing', 'move', 'bevel', 'deform', 'orbit'].includes(activeTool)) {
      setOpenPanels(prev => prev.includes('toolModifiers') ? prev : [...prev, 'toolModifiers']);
    }
  }, [activeTool]);

  useEffect(() => {
    if (openMaterialsSignal > 0) {
      setOpenPanels(prev => prev.includes('materials') ? prev : [...prev, 'materials']);
    }
  }, [openMaterialsSignal]);
  const [isAddMaterialOpen, setIsAddMaterialOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'color' | 'texture' | 'premade' | 'ai'>('color');
  const [hfToken, setHfTokenState] = useState<string>(() => HuggingFaceService.getToken());
  const setHfToken = (t: string) => { setHfTokenState(t); HuggingFaceService.setToken(t); };
  useEffect(() => { if (activeTab === 'ai') setHfTokenState(HuggingFaceService.getToken()); }, [activeTab]);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiPreviewUrl, setAiPreviewUrl] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [removeBgEnabled, setRemoveBgEnabled] = useState(false);
  const [removingBg, setRemovingBg] = useState(false);
  const [newColor, setNewColor] = useState('#ffffff');
  const [uploading, setUploading] = useState(false);
  const [pbrSettings, setPbrSettings] = useState({
    roughness: 0.5,
    metalness: 0,
    opacity: 1
  });
  const [premadeMaterials, setPremadeMaterials] = useState<any[]>([]);
  const [tagSearch, setTagSearch] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#3b82f6');

  useEffect(() => {
    if (isAddMaterialOpen && premadeMaterials.length === 0) {
      // Curated standard PBR materials
      const standardList = [
        { name: 'Aluminum', roughness: 0.1, metalness: 1.0, color: '#EBEDEE' }, 
        { name: 'Aluminum (Anodized Red)', roughness: 0.2, metalness: 1.0, color: '#990000' }, 
        { name: 'Amber', roughness: 0.05, metalness: 0.0, color: '#D44A09' }, 
        { name: 'Asphalt (Fresh)', roughness: 0.8, metalness: 0.0, color: '#0B0A0A' }, 
        { name: 'Banana', roughness: 0.6, metalness: 0.0, color: '#F2C94C' }, 
        { name: 'Beryllium', roughness: 0.1, metalness: 1.0, color: '#898788' }, 
        { name: 'Blackboard', roughness: 0.9, metalness: 0.0, color: '#0A0A0A' }, 
        { name: 'Blood', roughness: 0.3, metalness: 0.0, color: '#A40101' }, 
        { name: 'Polished Steel', roughness: 0.05, metalness: 1.0, color: '#c0c0c0' }, 
        { name: 'Gold', roughness: 0.1, metalness: 1.0, color: '#ffd700' }, 
        { name: 'Copper', roughness: 0.2, metalness: 1.0, color: '#b87333' }, 
        { name: 'Rubber', roughness: 0.9, metalness: 0.0, color: '#222222' }, 
        { name: 'Plastic', roughness: 0.3, metalness: 0.0, color: '#ffffff' }, 
        { name: 'Glass', roughness: 0.01, metalness: 0.0, color: '#ffffff', opacity: 0.3 }, 
        { name: 'Wood (Oak)', roughness: 0.7, metalness: 0.0, color: '#7b5c3d' }, 
        { name: 'Concrete', roughness: 0.85, metalness: 0.0, color: '#9ca3af' }, 
        { name: 'Brass', roughness: 0.25, metalness: 1.0, color: '#B5A642' }, 
        { name: 'Bronze', roughness: 0.3, metalness: 1.0, color: '#CD7F32' }, 
        { name: 'Chrome', roughness: 0.05, metalness: 1.0, color: '#C4C4C4' }, 
        { name: 'Titanium', roughness: 0.35, metalness: 1.0, color: '#878681' }, 
        { name: 'Silver', roughness: 0.1, metalness: 1.0, color: '#C0C0C0' }, 
        { name: 'Tin', roughness: 0.4, metalness: 1.0, color: '#D9D9D9' }, 
        { name: 'Rusted Iron', roughness: 0.85, metalness: 0.6, color: '#8B4513' }, 
        { name: 'Stainless Steel', roughness: 0.2, metalness: 1.0, color: '#B7C3C9' }, 
        { name: 'Walnut', roughness: 0.65, metalness: 0.0, color: '#5C4033' }, 
        { name: 'Pine', roughness: 0.7, metalness: 0.0, color: '#DEB887' }, 
        { name: 'Mahogany', roughness: 0.6, metalness: 0.0, color: '#4E2A1E' }, 
        { name: 'Oak (Light)', roughness: 0.7, metalness: 0.0, color: '#C19A6B' }, 
        { name: 'Ebony', roughness: 0.5, metalness: 0.0, color: '#3D2B1F' }, 
        { name: 'Marble (White)', roughness: 0.15, metalness: 0.0, color: '#F5F5F0' }, 
        { name: 'Granite', roughness: 0.5, metalness: 0.0, color: '#736F6E' }, 
        { name: 'Sandstone', roughness: 0.8, metalness: 0.0, color: '#C2A878' }, 
        { name: 'Slate', roughness: 0.6, metalness: 0.0, color: '#2F4F4F' }, 
        { name: 'Limestone', roughness: 0.75, metalness: 0.0, color: '#E8DCC5' }, 
        { name: 'Denim', roughness: 0.9, metalness: 0.0, color: '#3B5998' }, 
        { name: 'Velvet', roughness: 0.95, metalness: 0.0, color: '#4B0082' }, 
        { name: 'Leather (Brown)', roughness: 0.55, metalness: 0.0, color: '#5C3317' }, 
        { name: 'Canvas', roughness: 0.85, metalness: 0.0, color: '#E8E4C9' }, 
        { name: 'Felt', roughness: 0.95, metalness: 0.0, color: '#7A7A7A' }, 
        { name: 'Plastic (Glossy Red)', roughness: 0.1, metalness: 0.0, color: '#FF3B30' }, 
        { name: 'Plastic (Matte Green)', roughness: 0.7, metalness: 0.0, color: '#34C759' }, 
        { name: 'ABS (Black)', roughness: 0.4, metalness: 0.0, color: '#1C1C1E' }, 
        { name: 'PVC (White)', roughness: 0.35, metalness: 0.0, color: '#F2F2F7' }, 
        { name: 'Frosted Glass', roughness: 0.4, metalness: 0.0, color: '#FFFFFF', opacity: 0.5 }, 
        { name: 'Tinted Glass (Blue)', roughness: 0.05, metalness: 0.0, color: '#4A90D9', opacity: 0.35 }, 
        { name: 'Ice', roughness: 0.1, metalness: 0.0, color: '#D6ECF0', opacity: 0.6 }, 
        { name: 'Porcelain', roughness: 0.2, metalness: 0.0, color: '#FFFFF0' }, 
        { name: 'Ceramic Tile (White)', roughness: 0.25, metalness: 0.0, color: '#FAFAFA' }, 
        { name: 'Brick (Red)', roughness: 0.85, metalness: 0.0, color: '#B22222' }, 
        { name: 'Cardboard', roughness: 0.9, metalness: 0.0, color: '#C19A6B' }, 
        { name: 'Chalk', roughness: 0.95, metalness: 0.0, color: '#FFFFFF' }, 
        { name: 'Cork', roughness: 0.8, metalness: 0.0, color: '#9B6B43' }, 
        { name: 'Charcoal', roughness: 0.9, metalness: 0.0, color: '#1C1C1C' }, 
        { name: 'Snow', roughness: 0.85, metalness: 0.0, color: '#FFFAFA' }, 
        { name: 'Sand', roughness: 0.85, metalness: 0.0, color: '#EDC9AF' }, 
        { name: 'Moss', roughness: 0.9, metalness: 0.0, color: '#4A6741' },
      ].map(m => ({ ...m, texture: generateMaterialTexture(m) }));

      // Photorealistic landscape textures
      const landscapeList = LANDSCAPE_TEXTURES.map(t => ({
        id: t.id,
        name: `${t.name} (Landscape)`,
        roughness: t.roughness,
        metalness: t.metalness,
        color: t.previewColor,
        texture: t.generate()
      }));

      setPremadeMaterials([...landscapeList, ...standardList]);
    }
  }, [isAddMaterialOpen, premadeMaterials.length]);

  const [currentModelOwnerDraft, setCurrentModelOwnerDraft] = useState<string | null>(null);

  useEffect(() => {
    if (!currentModelId) {
      setCurrentModelOwnerDraft(user?.uid || null);
      return;
    }
    const fetchOwner = async () => {
      try {
        const d = await getDoc(doc(db, 'models', currentModelId));
        if (d.exists()) {
          setCurrentModelOwnerDraft(d.data().userId);
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, `models/${currentModelId}`);
      }
    };
    fetchOwner();
  }, [currentModelId, user?.uid]);

  const isModelOwner = !currentModelId || (user && currentModelOwnerDraft === user.uid);

  const handleRevokeCollab = async (collabDocId: string) => {
    if (!isModelOwner) return;
    if (!window.confirm('Are you sure you want to revoke collaboration from this user?')) return;
    try {
      await deleteDoc(doc(db, 'collaborations', collabDocId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'collaborations');
    }
  };

  const handleInvite = async (email: string) => {
    if (!email || !email.includes('@') || !user) return;
    if (!currentModelId) {
      alert('Please save your design first before inviting collaborators.');
      return;
    }

    try {
      const inviteId = `${currentModelId}_${email.toLowerCase()}`;
      await setDoc(doc(db, 'collaborations', inviteId), {
        modelId: currentModelId,
        email: email.toLowerCase(),
        uid: null, 
        displayName: email.split('@')[0],
        role: 'collaborator',
        status: 'invited',
        lastSeen: Date.now(),
        invitedBy: user.uid,
        invitedByEmail: user.email,
        createdAt: serverTimestamp()
      });
      alert(`Invitation sent to ${email}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'collaborations');
    }
  };

  const togglePanel = (id: string) => {
    setOpenPanels(prev => 
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  };

  if (panelVisibility['entity'] === false && panelVisibility['outliner'] === false && panelVisibility['materials'] === false && panelVisibility['styles'] === false && panelVisibility['tags'] === false && panelVisibility['scenes'] === false && panelVisibility['shadows'] === false && panelVisibility['components'] === false) {
    return null;
  }

  const handleAddColor = async () => {
    const materialId = Math.random().toString(36).substr(2, 9);
    const material = {
      id: materialId,
      name: `Color ${newColor}`,
      userId: user?.uid || 'local',
      type: 'color',
      value: newColor,
      pbr: pbrSettings,
      createdAt: new Date()
    };
    setCustomMaterials(prev => [...prev.filter(m => m.id !== materialId), material]);
    setActiveMaterial(newColor);
    setActivePBR(pbrSettings);
    setActiveTool('paint');
    setIsAddMaterialOpen(false);

    if (user?.uid) {
      try {
        await addDoc(collection(db, 'materials'), { ...material, createdAt: serverTimestamp() });
        refreshMaterials();
      } catch (err) {
        console.warn('[AddColor] Firestore write error:', err);
      }
    }
  };

  const handleGenerateAIMaterial = async () => {
    if (!aiPrompt.trim()) return;
    setAiGenerating(true);
    setAiError(null);
    try {
      const dataUrl = await HuggingFaceService.generateMaterialImage(aiPrompt.trim());
      setAiPreviewUrl(dataUrl);
    } catch (err: any) {
      setAiError(err?.message || 'Failed to generate material.');
    } finally {
      setAiGenerating(false);
    }
  };

  const handleAddAIMaterial = async () => {
    if (!aiPreviewUrl) return;
    const materialId = Math.random().toString(36).substr(2, 9);
    const cleanName = `AI: ${aiPrompt.trim().slice(0, 40) || 'Custom Material'}`;
    const material = {
      id: materialId,
      name: cleanName,
      userId: user?.uid || 'local',
      type: 'texture',
      value: aiPreviewUrl,
      pbr: pbrSettings,
      createdAt: new Date()
    };
    setCustomMaterials(prev => [...prev.filter(m => m.id !== materialId), material]);
    setActiveMaterial(aiPreviewUrl);
    setActivePBR(pbrSettings);
    setActiveTool('paint');
    setIsAddMaterialOpen(false);
    setAiPreviewUrl(null);
    setAiPrompt('');

    if (user?.uid) {
      try {
        await addDoc(collection(db, 'materials'), { ...material, createdAt: serverTimestamp() });
        refreshMaterials();
      } catch (err) {
        console.warn('[AddAIMaterial] Firestore write error:', err);
      }
    }
  };

  const handleTextureUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);

    try {
      let uploadBlob: Blob = file;
      if (removeBgEnabled) {
        try {
          setRemovingBg(true);
          uploadBlob = await HuggingFaceService.removeBackground(file);
        } catch (bgErr: any) {
          console.warn('[TextureUpload] AI background removal failed, using original image:', bgErr);
          uploadBlob = file;
        } finally {
          setRemovingBg(false);
        }
      }

      // Convert image blob to base64 DataURL
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(uploadBlob);
      });

      const materialId = Math.random().toString(36).substr(2, 9);
      const cleanName = file.name.replace(/\.[^/.]+$/, "");
      const newMaterial = {
        id: materialId,
        name: cleanName,
        userId: user?.uid || 'local',
        type: 'texture',
        value: dataUrl,
        pbr: pbrSettings,
        createdAt: new Date()
      };

      // Instantly add to custom materials in state & activate paint tool with this material
      setCustomMaterials(prev => [...prev.filter(m => m.id !== materialId), newMaterial]);
      setActiveMaterial(dataUrl);
      setActivePBR(pbrSettings);
      setActiveTool('paint');
      setIsAddMaterialOpen(false);

      // If user is authenticated, persist to Firebase Storage and Firestore in background
      if (user?.uid) {
        try {
          let finalUrl = dataUrl;
          try {
            const storageRef = ref(storage, `textures/${user.uid}/${Date.now()}_${file.name}`);
            await uploadBytes(storageRef, uploadBlob);
            finalUrl = await getDownloadURL(storageRef);
          } catch (storageErr) {
            console.warn('[TextureUpload] Storage upload fallback to DataURL:', storageErr);
          }
          await addDoc(collection(db, 'materials'), {
            id: materialId,
            name: cleanName,
            userId: user.uid,
            type: 'texture',
            value: finalUrl,
            pbr: pbrSettings,
            createdAt: serverTimestamp()
          });
          refreshMaterials();
        } catch (dbErr) {
          console.warn('[TextureUpload] Firestore write skipped:', dbErr);
        }
      }
    } catch (err: any) {
      console.error('[TextureUpload] Upload failed:', err);
      alert(err?.message || 'Failed to process texture image.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleDeleteMaterial = async (matToDelete: any) => {
    // Remove from local customMaterials state
    setCustomMaterials(prev => prev.filter(m => {
      if (matToDelete.id && m.id) return m.id !== matToDelete.id;
      return m.value !== matToDelete.value;
    }));

    // If activeMaterial is the deleted one, fallback to standard neutral
    if (activeMaterial === matToDelete.value) {
      setActiveMaterial('#e2e8f0');
    }

    // Persist deletion to Firestore if logged in
    if (user?.uid) {
      try {
        if (matToDelete.id) {
          await deleteDoc(doc(db, 'materials', matToDelete.id));
        }
        const q = query(
          collection(db, 'materials'),
          where('userId', '==', user.uid)
        );
        const snap = await getDocs(q);
        snap.forEach(d => {
          const data = d.data();
          if (data.id === matToDelete.id || data.value === matToDelete.value) {
            deleteDoc(d.ref).catch(() => {});
          }
        });
      } catch (err) {
        console.warn('[Materials] Firestore delete warning:', err);
      }
    }
  };

  const handleAddTag = () => {
    if (!newTagName.trim()) return;
    const newTag = {
      id: Math.random().toString(36).substr(2, 9),
      name: newTagName,
      color: newTagColor,
      visible: true
    };
    setTags(prev => [...prev, newTag]);
    setNewTagName('');
  };

  const toggleTagVisibility = (id: string) => {
    setTags(prev => prev.map(t => t.id === id ? { ...t, visible: !t.visible } : t));
  };

  const toggleAllTags = () => {
    const next = !allTagsVisible;
    setAllTagsVisible(next);
    setTags(prev => prev.map(t => ({ ...t, visible: next })));
  };

  const handleSaveScene = () => {
    // Dispatch event to Viewport to get snapshot
    window.dispatchEvent(new CustomEvent('request-scene-save', { 
      detail: { name: `Scene ${scenes.length + 1}` } 
    }));
  };

  const handleRenameScene = (id: string) => {
    const scene = scenes.find(s => s.id === id);
    if (!scene) return;
    const newName = prompt('Enter new scene name:', scene.name);
    if (newName && newName.trim()) {
      setScenes(prev => prev.map(s => s.id === id ? { ...s, name: newName } : s));
    }
  };

  const selectedShape = shapes.find(s => s.id === selectedId);

  // Kernel faces are a separate representation from Shape[], so the Outliner
  // lists them in their own section rather than pretending they are Shapes.
  const kernelFaceRows = React.useMemo(
    () => faceSummaries(kernelHost.graph),
    [kernelHost, kernelRevision],
  );

  /**
   * Faces grouped into connected solids.
   *
   * A flat list is fine for a handful of surfaces and unreadable at a
   * hundred: after two push/pulls there is no way to tell which six rows are
   * one box. Faces joined along an edge belong to the same object, so the
   * grouping comes straight from the topology and cannot go stale.
   */
  const kernelGroups = React.useMemo(
    () => faceGroups(kernelHost.graph),
    [kernelHost, kernelRevision],
  );
  const kernelRowById = React.useMemo(
    () => new Map(kernelFaceRows.map(r => [r.id, r])),
    [kernelFaceRows],
  );
  // Opt-IN expand, not opt-in collapse: a group the user has never touched
  // is never in this set, so it reads as collapsed by default without
  // needing to know about it in advance — including groups created later,
  // as the user keeps drawing.
  const [expandedGroups, setExpandedGroups] = React.useState<Set<string>>(new Set());
  const [expandedOutlinerLevels, setExpandedOutlinerLevels] = React.useState<Set<string>>(new Set(['level-1', 'level-2', 'level-3', 'level-4']));
  const [expandedOutlinerRoofs, setExpandedOutlinerRoofs] = React.useState<Set<string>>(new Set(['all-roofs']));
  const [expandedOutlinerTimber, setExpandedOutlinerTimber] = React.useState<boolean>(true);
  const [expandedTimberSubgroups, setExpandedTimberSubgroups] = React.useState<Set<string>>(new Set(['walls', 'floors', 'roofs']));
  const selectedLight = customLights.find(l => l.id === selectedLightId);
  
  // Local state for editing in real-time
  const [editingDimIndex, setEditingDimIndex] = useState<number | null>(null);
  const [editingPosIndex, setEditingPosIndex] = useState<number | null>(null);
  const [editingRotIndex, setEditingRotIndex] = useState<number | null>(null);
  const [dimValue, setDimValue] = useState('');
  const [posValue, setPosValue] = useState('');
  const [rotValue, setRotValue] = useState('');
  const [isMatPickerOpen, setIsMatPickerOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [warehouseSearch, setWarehouseSearch] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const chatScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const handleSendMessage = async () => {
    if (!chatInput.trim() || !user || !currentModelId) return;
    try {
      const path = `models/${currentModelId}/messages`;
      await addDoc(collection(db, 'models', currentModelId, 'messages'), {
        uid: user.uid,
        displayName: user.displayName || 'Anonymous',
        text: chatInput,
        timestamp: Date.now()
      });
      setChatInput('');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `models/${currentModelId}/messages`);
    }
  };

  const formatDistance = (m: number) => {
    switch(unit) {
      case 'mm': return (m * 1000).toFixed(0);
      case 'cm': return (m * 100).toFixed(1);
      default: return m.toFixed(3);
    }
  };

  const parseDistance = (val: string) => {
    const num = parseFloat(val);
    if (isNaN(num)) return null;
    switch(unit) {
      case 'mm': return num / 1000;
      case 'cm': return num / 100;
      default: return num;
    }
  };

  const hasSettings = [
    'move', 
    'bevel', 
    'deform', 
    'orbit',
    'wall',
    'fence',
    'railing'
  ].includes(activeTool);

  return (
    <aside className={cn(
      "w-72 flex flex-col h-full z-40 transition-colors duration-300",
      theme === 'dark' ? "bg-gray-800 border-l border-gray-700" : "panel-bg"
    )}>
      <div className="flex-1 overflow-y-auto">
        {panelVisibility['entity'] !== false && (
          <Panel 
            id="entity" 
            title="Entity Info" 
            icon={<Info size={16} />} 
            isOpen={openPanels.includes('entity')}
            onToggle={() => togglePanel('entity')}
          >
            {!selectedShape && !selectedLight && (
              <div className="py-4 text-center text-gray-400 italic">
                Select an entity to view details
              </div>
            )}

            {selectedShape && (
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Name</label>
                  <input 
                    type="text"
                    value={selectedShape.name || selectedShape.id.slice(0, 8)}
                    onChange={(e) => {
                      const newName = e.target.value;
                      setShapes(prev => prev.map(s => s.id === selectedShape.id ? { ...s, name: newName } : s));
                    }}
                    className={cn(
                      "w-full px-2 py-1.5 rounded bg-transparent border-none outline-none focus:ring-1 focus:ring-trimble-blue transition-all font-medium",
                      theme === 'dark' ? "text-gray-100" : "text-gray-900"
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Type</label>
                    <div className="font-medium text-trimble-blue uppercase">{selectedShape.type}</div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Volume</label>
                    <div className="font-medium text-gray-700 dark:text-gray-300">
                      {(() => {
                        const args = selectedShape.args;
                        let volume = 0;
                        switch (selectedShape.type) {
                          case 'box':
                          case 'rect':
                            volume = Array.isArray(args) ? (args[0] * args[1] * args[2] || 0) : 0;
                            break;
                          case 'sphere':
                          case 'dome':
                            volume = (4/3) * Math.PI * Math.pow(Array.isArray(args) ? args[0] : 0, 3);
                            if (selectedShape.type === 'dome') volume /= 2;
                            break;
                          case 'prism':
                          case 'triangle':
                            volume = Math.PI * Math.pow(Array.isArray(args) ? args[1] : 0, 2) * (Array.isArray(args) ? args[0] : 0); // approximation for radius/height
                            if (selectedShape.type === 'triangle') volume /= 2;
                            break;
                          case 'cone':
                          case 'pyramid':
                            volume = (1/3) * Math.PI * Math.pow(Array.isArray(args) ? args[1] : 0, 2) * (Array.isArray(args) ? args[0] : 0);
                            break;
                          case 'poly':
                            // height-based volume for polygon
                            volume = ((args as any).height || 0) * 1; // Simplification: we'd need area calculation for true volume
                            break;
                          default:
                            volume = Array.isArray(args) ? (args[0] * args[1] * args[2] || 0) : 0;
                        }
                        if (volume >= 1e9) return `${(volume / 1e9).toLocaleString(undefined, { maximumFractionDigits: 2 })} km³`; if (volume >= 1) return `${volume.toLocaleString(undefined, { maximumFractionDigits: 2 })} m³`; if (volume >= 1e-6) return `${(volume * 1e6).toLocaleString(undefined, { maximumFractionDigits: 0 })} cm³`; return `${(volume * 1e9).toLocaleString(undefined, { maximumFractionDigits: 0 })} mm³`;
                      })()}
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Tags</label>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {selectedShape.tags && selectedShape.tags.length > 0 ? (
                      selectedShape.tags.map(tagId => {
                        const tag = tags.find(t => t.id === tagId);
                        if (!tag) return null;
                        return (
                          <div 
                            key={tag.id}
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold text-white uppercase"
                            style={{ backgroundColor: tag.color }}
                          >
                            <span>{tag.name}</span>
                            <button 
                              onClick={() => {
                                setShapes(prev => prev.map(s => s.id === selectedShape.id ? {
                                  ...s,
                                  tags: s.tags?.filter(t => t !== tagId)
                                } : s));
                              }}
                              className="hover:bg-white/20 rounded"
                            >
                              <X size={8} />
                            </button>
                          </div>
                        );
                      })
                    ) : (
                      <span className="text-[10px] text-gray-400 italic">No tags assigned</span>
                    )}
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Dimensions ({unit})</label>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {Array.isArray(selectedShape.args) && selectedShape.args.slice(0, 3).map((arg: number, idx: number) => (
                      <div key={idx} className="flex items-center gap-1">
                        {editingDimIndex === idx ? (
                          <input 
                            autoFocus
                            type="text"
                            value={dimValue}
                            onChange={(e) => setDimValue(e.target.value)}
                            onBlur={() => {
                              const meters = parseDistance(dimValue);
                              if (meters !== null) {
                                const newArgs = [...selectedShape.args];
                                newArgs[idx] = meters;
                                setShapes(prev => prev.map(s => s.id === selectedShape.id ? { ...s, args: newArgs } : s));
                                recordAction(`sdk.updateObject("${selectedShape.id}", { args: [${newArgs.join(', ')}] });`);
                              }
                              setEditingDimIndex(null);
                            }}
                            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                            className="w-16 px-1.5 py-1 border rounded text-[10px] outline-none focus:border-trimble-blue"
                          />
                        ) : (
                          <button 
                            onClick={() => {
                              setEditingDimIndex(idx);
                              setDimValue(formatDistance(arg));
                            }}
                            className={cn(
                              "px-2 py-1 rounded border text-[10px] font-mono transition-all",
                              theme === 'dark' ? "bg-gray-700/50 border-gray-600 hover:bg-gray-600" : "bg-gray-50 border-gray-200 hover:bg-gray-100"
                            )}
                          >
                            {formatDistance(arg)}
                          </button>
                        )}
                        {idx < 2 && idx < selectedShape.args.length - 1 && <span className="text-gray-400">×</span>}
                      </div>
                    ))}
                    {selectedShape.type === 'poly' && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-500">Height:</span>
                        <div className="flex items-center gap-1">
                          {editingDimIndex === 99 ? (
                            <input 
                              autoFocus
                              type="text"
                              value={dimValue}
                              onChange={(e) => setDimValue(e.target.value)}
                              onBlur={() => {
                                const meters = parseDistance(dimValue);
                                if (meters !== null) {
                                  setShapes(prev => prev.map(s => s.id === selectedShape.id ? {
                                    ...s,
                                    args: { ...s.args, height: meters }
                                  } : s));
                                  recordAction(`sdk.updateObject("${selectedShape.id}", { args: { height: ${meters} } });`);
                                }
                                setEditingDimIndex(null);
                              }}
                              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                              className="w-16 px-1.5 py-1 border rounded text-[10px] outline-none focus:border-trimble-blue"
                            />
                          ) : (
                            <button 
                              onClick={() => {
                                setEditingDimIndex(99);
                                setDimValue(formatDistance(selectedShape.args.height || 0));
                              }}
                              className={cn(
                                "px-2 py-1 rounded border text-[10px] font-mono transition-all",
                                theme === 'dark' ? "bg-gray-700/50 border-gray-600 hover:bg-gray-600" : "bg-gray-50 border-gray-200 hover:bg-gray-100"
                              )}
                            >
                              {formatDistance(selectedShape.args.height || 0)}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Position ({unit})</label>
                  <div className="grid grid-cols-3 gap-1.5 mt-1">
                    {selectedShape.position.map((pos: number, idx: number) => (
                      <div key={idx} className="flex flex-col gap-1">
                        <span className="text-[8px] text-gray-400 uppercase font-bold text-center">{['X', 'Y', 'Z'][idx]}</span>
                        {editingPosIndex === idx ? (
                          <input 
                            autoFocus
                            type="text"
                            value={posValue}
                            onChange={(e) => setPosValue(e.target.value)}
                            onBlur={() => {
                              const meters = parseDistance(posValue);
                              if (meters !== null) {
                                const newPos = [...selectedShape.position];
                                newPos[idx] = meters;
                                setShapes(prev => prev.map(s => s.id === selectedShape.id ? { ...s, position: newPos as [number, number, number] } : s));
                                recordAction(`sdk.updateObject("${selectedShape.id}", { position: [${newPos.join(', ')}] });`);
                              }
                              setEditingPosIndex(null);
                            }}
                            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                            className="w-full px-1 py-1 border rounded text-[10px] outline-none focus:border-trimble-blue"
                          />
                        ) : (
                          <button 
                            onClick={() => {
                              setEditingPosIndex(idx);
                              setPosValue(formatDistance(pos));
                            }}
                            className={cn(
                              "text-[10px] font-mono px-1 py-1 rounded border text-center transition-all truncate",
                              theme === 'dark' ? "bg-gray-700/50 border-gray-600 hover:bg-gray-600" : "bg-gray-50 border-gray-200 hover:bg-gray-100"
                            )}
                          >
                            {formatDistance(pos)}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Rotation (Degrees)</label>
                  <div className="grid grid-cols-3 gap-1.5 mt-1">
                    {['X', 'Y', 'Z'].map((axis, idx) => {
                      const rotArr = selectedShape.rotation || [0, 0, 0];
                      const deg = rotArr[idx] * (180 / Math.PI);
                      return (
                        <div key={axis} className="flex flex-col gap-1">
                          <span className="text-[8px] text-gray-400 uppercase font-bold text-center">{axis}</span>
                          {editingRotIndex === idx ? (
                            <input 
                              autoFocus
                              type="text"
                              value={rotValue}
                              onChange={(e) => setRotValue(e.target.value)}
                              onBlur={() => {
                                const val = parseFloat(rotValue);
                                if (!isNaN(val)) {
                                  const newRot = [...(selectedShape.rotation || [0, 0, 0])] as [number, number, number];
                                  newRot[idx] = val * (Math.PI / 180);
                                  setShapes(prev => prev.map(s => s.id === selectedShape.id ? { ...s, rotation: newRot, quaternion: undefined } : s));
                                  recordAction(`sdk.updateObject("${selectedShape.id}", { rotation: [${newRot.join(', ')}] });`);
                                }
                                setEditingRotIndex(null);
                              }}
                              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                              className="w-full px-1 py-1 border rounded text-[10px] outline-none focus:border-trimble-blue"
                            />
                          ) : (
                            <button 
                              onClick={() => {
                                setEditingRotIndex(idx);
                                setRotValue(deg.toFixed(1));
                              }}
                              className={cn(
                                "text-[10px] font-mono px-1 py-1 rounded border text-center transition-all truncate",
                                theme === 'dark' ? "bg-amber-500/5 border-amber-500/10 text-amber-500 hover:bg-amber-500/10" : "bg-amber-50 border-amber-200 text-amber-600 hover:bg-amber-100"
                              )}
                            >
                              {deg.toFixed(1)}°
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Material</label>
                  <div className="relative">
                    <button 
                      onClick={() => setIsMatPickerOpen(!isMatPickerOpen)}
                      className={cn(
                        "w-full flex items-center justify-between px-3 py-2 rounded-lg border transition-all",
                        theme === 'dark' ? "bg-gray-700/50 border-gray-600" : "bg-gray-50 border-gray-200"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded shadow-sm" style={{ backgroundColor: selectedShape.color }} />
                        <span className="font-mono">{selectedShape.color.toUpperCase()}</span>
                      </div>
                      <ChevronDown size={14} className="text-gray-400" />
                    </button>
                    {isMatPickerOpen && (
                      <div className={cn(
                        "absolute top-full left-0 right-0 mt-1 p-2 rounded-lg border shadow-xl grid grid-cols-5 gap-1.5 z-[150]",
                        theme === 'dark' ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"
                      )}>
                        {COLORS.map(c => (
                          <button 
                            key={c}
                            onClick={() => {
                              setShapes(prev => prev.map(s => s.id === selectedShape.id ? { ...s, color: c } : s));
                              setIsMatPickerOpen(false);
                            }}
                            className="aspect-square rounded border border-gray-100 hover:scale-110 transition-transform"
                            style={{ backgroundColor: c }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-4 border-t border-gray-100 dark:border-gray-700 flex justify-end gap-3">
                  <button
                    onClick={() => {
                      const clone = {
                        ...selectedShape,
                        id: Math.random().toString(36).substr(2, 9),
                        name: `${selectedShape.name || 'Object'} Copy`,
                        position: [selectedShape.position[0] + 0.3, selectedShape.position[1], selectedShape.position[2] + 0.3] as [number, number, number],
                      };
                      setShapes(prev => [...prev, clone]);
                      commitHistory();
                      setSelectedId(clone.id);
                      setSelectedIds([clone.id]);
                    }}
                    className="flex items-center gap-1 text-[10px] font-bold text-trimble-blue hover:underline" title="Duplicate Entity"
                  >
                    <CopyIcon size={13} />
                  </button>
                  <button 
                    onClick={() => removeShape(selectedShape.id)}
                    className="flex items-center gap-1 text-[10px] font-bold text-red-500 hover:underline" title="Delete Entity"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            )}

            {activeTool === 'deform' && (
              <div className="space-y-4 pt-2">
                <div className="text-[10px] font-bold text-trimble-blue uppercase border-b border-trimble-blue/20 pb-1">Deformation Brush</div>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[8px] font-bold text-gray-400 uppercase">Brush Radius</label>
                    <input 
                      type="range" min="0.1" max="10" step="0.1"
                      value={deformationSettings.radius}
                      onChange={(e) => setDeformationSettings(prev => ({ ...prev, radius: parseFloat(e.target.value) }))}
                      className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[8px] font-bold text-gray-400 uppercase">Strength</label>
                    <input 
                      type="range" min="0" max="1" step="0.05"
                      value={deformationSettings.strength}
                      onChange={(e) => setDeformationSettings(prev => ({ ...prev, strength: parseFloat(e.target.value) }))}
                      className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[8px] font-bold text-gray-400 uppercase">Direction</label>
                    <div className="flex gap-1.5 mt-1">
                      {['outward', 'inward', 'both'].map(dir => (
                        <button
                          key={dir}
                          onClick={() => setDeformationSettings(prev => ({ ...prev, direction: dir }))}
                          className={cn(
                            "flex-1 py-1 text-[8px] font-bold uppercase rounded border transition-colors",
                            deformationSettings.direction === dir 
                              ? "bg-trimble-blue text-white border-trimble-blue" 
                              : "bg-gray-50 text-gray-400 border-gray-100 hover:bg-gray-100"
                          )}
                        >
                          {dir}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {selectedLight && (
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Light Type</label>
                  <div className="font-medium text-amber-500 uppercase">{selectedLight.type}</div>
                </div>
                
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Intensity</label>
                  <div className="flex items-center gap-3">
                    <input 
                      type="range" min="0" max="50" step="0.5"
                      value={selectedLight.intensity}
                      onChange={(e) => setCustomLights(prev => prev.map(l => l.id === selectedLight.id ? { ...l, intensity: parseFloat(e.target.value) } : l))}
                      className="flex-1 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-amber-500"
                    />
                    <span className="text-[10px] font-mono text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                      {selectedLight.intensity.toFixed(1)}
                    </span>
                  </div>
                </div>

                <div className="pt-4 border-t border-gray-100 dark:border-gray-700">
                  <button 
                    onClick={() => {
                      setCustomLights(prev => prev.filter(l => l.id !== selectedLight.id));
                      setSelectedLightId(null);
                    }}
                    className="text-[10px] font-bold text-red-500 uppercase tracking-wider hover:underline"
                  >
                    Delete Light
                  </button>
                </div>
              </div>
            )}
          </Panel>
        )}

        {panelVisibility['outliner'] !== false && (
          <Panel 
            id="outliner" 
            title="Outliner" 
            icon={<ListTree size={16} />} 
            isOpen={openPanels.includes('outliner')}
            onToggle={() => togglePanel('outliner')}
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2 py-1 px-2 bg-trimble-blue/10 rounded text-trimble-blue">
                <BoxSelect size={12} />
                <span>Model Root</span>
              </div>
              
              {/* Hierarchical Outliner Section */}
              {(() => {
                // 1. Group walls by Story/Level
                const wallShapes = shapes.filter(s => s.type === 'wall' || s.tags?.includes('wall-assembly'));
                const wallIds = new Set(wallShapes.map(w => w.id));

                // Determine levels present
                const levelGroupsMap = new Map<number, { levelNum: number; walls: typeof shapes; slabs: typeof shapes }>();
                
                wallShapes.forEach(wall => {
                  let levelNum = 1;
                  const storyTag = wall.tags?.find(t => t.startsWith('story-') || t.startsWith('level-'));
                  if (storyTag) {
                    const match = storyTag.match(/\d+/);
                    if (match) levelNum = parseInt(match[0], 10);
                  } else {
                    const h = Array.isArray(wall.args) ? (wall.args[1] || 2.8) : 2.8;
                    const baseY = wall.position[1] - (h / 2);
                    levelNum = Math.max(1, Math.floor((baseY + 0.4) / 2.8) + 1);
                  }

                  if (!levelGroupsMap.has(levelNum)) {
                    levelGroupsMap.set(levelNum, { levelNum, walls: [], slabs: [] });
                  }
                  levelGroupsMap.get(levelNum)!.walls.push(wall);
                });

                // Story Floor Slabs
                const slabShapes = shapes.filter(s => (s.tags?.includes('floor-slab') || s.name?.toLowerCase().includes('floor slab')));
                const slabIds = new Set<string>();
                slabShapes.forEach(slab => {
                  let slabLevel = 1;
                  const storyTag = slab.tags?.find(t => t.startsWith('story-') || t.startsWith('level-'));
                  if (storyTag) {
                    const match = storyTag.match(/\d+/);
                    if (match) slabLevel = parseInt(match[0], 10);
                  } else {
                    slabLevel = Math.max(1, Math.floor((slab.position[1] + 0.2) / 2.8) + 1);
                  }
                  if (levelGroupsMap.has(slabLevel)) {
                    levelGroupsMap.get(slabLevel)!.slabs.push(slab);
                    slabIds.add(slab.id);
                  }
                });

                const sortedLevels = Array.from(levelGroupsMap.values()).sort((a, b) => a.levelNum - b.levelNum);

                // 2. Identify Roofs and their child components (Fascias) - Strictly exclude timber framing
                const roofShapes = shapes.filter(s => 
                  (s.tags?.includes('roof-structure') || (!s.parentShapeId && (s.name?.toLowerCase().includes('roof') || s.name?.toLowerCase().includes('gable') || s.name?.toLowerCase().includes('hip'))))
                  && !s.tags?.includes('roof-fascia') && !s.tags?.includes('timber-frame') && !s.tags?.includes('timber-framing') && !s.name?.toLowerCase().startsWith('timber ')
                );
                const roofIds = new Set(roofShapes.map(r => r.id));

                // Child shapes parented to roofs or with roof-fascia tag (strictly exclude timber)
                const roofChildren = shapes.filter(s => s.parentShapeId && roofIds.has(s.parentShapeId) && !s.tags?.includes('timber-frame') && !s.tags?.includes('timber-framing') && !s.name?.toLowerCase().startsWith('timber '));
                const roofChildIds = new Set(roofChildren.map(c => c.id));

                // 3. Identify Timber Framing shapes
                const timberShapes = shapes.filter(s => s.tags?.includes('timber-frame') || s.tags?.includes('timber-framing') || s.name?.startsWith('Timber ') || s.name?.includes(' - Common Rafter') || s.name?.includes(' - Jack Rafter') || s.name?.includes(' - Ridge Beam') || s.name?.includes(' - Hip Rafter') || s.name?.includes(' - Valley Rafter') || s.name?.includes(' - Ceiling Joist') || s.name?.includes(' - Collar Tie'));
                const timberIds = new Set(timberShapes.map(t => t.id));

                // 4. Other standalone shapes
                const handledIds = new Set([...wallIds, ...slabIds, ...roofIds, ...roofChildIds, ...timberIds]);
                const otherShapes = shapes.filter(s => !handledIds.has(s.id));

                return (
                  <>
                    {/* 1. LEVELS & WALLS GROUPED BY LEVEL */}
                    {sortedLevels.length > 0 && (
                      <div className="space-y-1 mt-1">
                        <div className="px-2 pt-2 pb-0.5 text-[10px] uppercase font-bold tracking-wider text-gray-400 dark:text-gray-500 flex items-center justify-between">
                          <span>Levels & Architectural Walls</span>
                          <span className="text-[9px] font-mono text-gray-400">{wallShapes.length} walls</span>
                        </div>

                        {sortedLevels.map(({ levelNum, walls, slabs }) => {
                          const levelKey = `level-${levelNum}`;
                          const isLevelExpanded = expandedOutlinerLevels.has(levelKey);
                          const levelAllShapes = [...walls, ...slabs];
                          const levelShapeIds = levelAllShapes.map(s => s.id);
                          const allSelected = levelShapeIds.length > 0 && levelShapeIds.every(id => selectedIds.includes(id));
                          const allHidden = levelAllShapes.every(s => s.hidden);
                          const anyVisible = levelAllShapes.some(s => !s.hidden);

                          return (
                            <div key={levelKey} className="rounded-lg overflow-hidden border border-gray-100 dark:border-gray-800/80 bg-gray-50/40 dark:bg-gray-800/20">
                              {/* Level Group Header */}
                              <div
                                onClick={() => {
                                  setSelectedId(null);
                                  setSelectedIds(levelShapeIds);
                                }}
                                className={cn(
                                  "flex items-center gap-1.5 py-1.5 px-2 rounded cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors group select-none",
                                  allSelected && "bg-trimble-blue/10 text-trimble-blue font-semibold"
                                )}
                                title={`Level ${levelNum} — ${walls.length} wall(s), ${slabs.length} slab(s)`}
                              >
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedOutlinerLevels(prev => {
                                      const next = new Set(prev);
                                      if (next.has(levelKey)) next.delete(levelKey);
                                      else next.add(levelKey);
                                      return next;
                                    });
                                  }}
                                  className="p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                                  title={isLevelExpanded ? "Collapse Level" : "Expand Level"}
                                >
                                  <ChevronRight size={13} className={cn("transition-transform duration-200", isLevelExpanded && "rotate-90")} />
                                </button>

                                <Layers size={13} className="text-trimble-blue shrink-0" />
                                <span className="flex-1 truncate text-xs font-semibold text-gray-700 dark:text-gray-200">
                                  Level {levelNum} {levelNum === 1 ? '(Ground)' : `(Story ${levelNum})`}
                                </span>

                                <span className="text-[10px] font-mono px-1.5 py-0.2 bg-gray-200/60 dark:bg-gray-700/60 text-gray-600 dark:text-gray-300 rounded shrink-0">
                                  {walls.length} w
                                </span>

                                {/* Level-wide Hide/Show Toggle */}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShapes(prev => prev.map(s => levelShapeIds.includes(s.id) ? { ...s, hidden: anyVisible } : s));
                                  }}
                                  className="opacity-0 group-hover:opacity-100 hover:text-trimble-blue p-0.5 shrink-0 transition-opacity"
                                  title={allHidden ? `Show Level ${levelNum}` : `Hide Level ${levelNum}`}
                                >
                                  {allHidden ? <EyeOff size={13} className="text-gray-400" /> : <Eye size={13} />}
                                </button>

                                {/* Level-wide Delete */}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    levelShapeIds.forEach(id => removeShape(id));
                                  }}
                                  className="opacity-0 group-hover:opacity-100 hover:text-red-500 p-0.5 shrink-0 transition-opacity"
                                  title={`Delete Level ${levelNum} (${walls.length} walls)`}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>

                              {/* Level Children (Walls & Slabs) */}
                              {isLevelExpanded && (
                                <div className="pl-5 pr-1 py-1 space-y-0.5 border-t border-gray-100 dark:border-gray-800">
                                  {/* Walls List */}
                                  {walls.map((wall, wIdx) => {
                                    const isSelected = selectedId === wall.id || selectedIds.includes(wall.id);
                                    const lengthM = Array.isArray(wall.args) ? wall.args[0] : 0;
                                    const heightM = Array.isArray(wall.args) ? wall.args[1] : 0;
                                    const thicknessM = Array.isArray(wall.args) ? wall.args[2] || 0.2 : 0.2;
                                    const dimLabel = lengthM ? `${lengthM.toFixed(1)}m × ${heightM.toFixed(1)}m` : '';

                                    // Determine Wall Classification (Interior, Exterior, Center)
                                    const tags = wall.tags || [];
                                    const rawName = wall.name || '';
                                    let wallTypeLabel = 'Exterior Wall';
                                    let wallBadgeColor = 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300';
                                    let wallTypeTag = 'Exterior';

                                    if (tags.includes('interior-wall') || tags.includes('wall-interior') || rawName.toLowerCase().includes('interior') || (wall as any).wallCategory === 'interior' || (wall as any).wallJustification === 'interior' || thicknessM <= 0.12) {
                                      wallTypeLabel = rawName && !rawName.match(/^Wall \d+$/) ? rawName : `Interior Wall ${wIdx + 1}`;
                                      wallBadgeColor = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300';
                                      wallTypeTag = 'Interior';
                                    } else if (tags.includes('center-wall') || tags.includes('wall-center') || rawName.toLowerCase().includes('center') || (wall as any).wallCategory === 'center' || (wall as any).wallJustification === 'center') {
                                      wallTypeLabel = rawName && !rawName.match(/^Wall \d+$/) ? rawName : `Center Wall ${wIdx + 1}`;
                                      wallBadgeColor = 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300';
                                      wallTypeTag = 'Center';
                                    } else {
                                      wallTypeLabel = rawName && !rawName.match(/^Wall \d+$/) ? rawName : `Exterior Wall ${wIdx + 1}`;
                                      wallBadgeColor = 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300';
                                      wallTypeTag = 'Exterior';
                                    }

                                    return (
                                      <div
                                        key={wall.id}
                                        onClick={() => {
                                          setSelectedId(wall.id);
                                          setSelectedIds([wall.id]);
                                        }}
                                        className={cn(
                                          "flex items-center gap-1.5 py-1 px-2 rounded cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 group transition-colors text-xs",
                                          isSelected && "bg-trimble-blue/10 text-trimble-blue font-medium",
                                          wall.hidden && "opacity-40"
                                        )}
                                        title={`${wallTypeLabel} (${dimLabel})`}
                                      >
                                        <Building2 size={11} className="text-gray-400 dark:text-gray-500 shrink-0" />
                                        <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: wall.color || '#f1f5f9' }} />
                                        <span className="flex-1 truncate font-medium">
                                          {wallTypeLabel}
                                        </span>
                                        <span className={cn("text-[9px] px-1 py-0.2 rounded font-mono shrink-0", wallBadgeColor)}>
                                          {wallTypeTag}
                                        </span>
                                        {dimLabel && (
                                          <span className="text-[9px] font-mono text-gray-400 shrink-0">
                                            {dimLabel}
                                          </span>
                                        )}

                                        {/* Individual Wall Hide/Show */}
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setShapes(prev => prev.map(s => s.id === wall.id ? { ...s, hidden: !s.hidden } : s));
                                          }}
                                          className="opacity-0 group-hover:opacity-100 hover:text-trimble-blue p-0.5 shrink-0"
                                          title={wall.hidden ? "Show Wall" : "Hide Wall"}
                                        >
                                          {wall.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                                        </button>

                                        {/* Individual Wall Duplicate */}
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const clone = {
                                              ...wall,
                                              id: Math.random().toString(36).substr(2, 9),
                                              name: `${wall.name || 'Wall'} Copy`,
                                              position: [wall.position[0] + 0.3, wall.position[1], wall.position[2] + 0.3] as [number, number, number],
                                            };
                                            setShapes(prev => [...prev, clone]);
                                            commitHistory();
                                          }}
                                          className="opacity-0 group-hover:opacity-100 hover:text-trimble-blue p-0.5 shrink-0"
                                          title="Duplicate Wall"
                                        >
                                          <CopyIcon size={12} />
                                        </button>

                                        {/* Individual Wall Delete */}
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            removeShape(wall.id);
                                          }}
                                          className="opacity-0 group-hover:opacity-100 hover:text-red-500 p-0.5 shrink-0"
                                          title="Delete Wall"
                                        >
                                          <Trash2 size={12} />
                                        </button>
                                      </div>
                                    );
                                  })}

                                  {/* Slabs List */}
                                  {slabs.map(slab => {
                                    const isSelected = selectedId === slab.id || selectedIds.includes(slab.id);
                                    return (
                                      <div
                                        key={slab.id}
                                        onClick={() => {
                                          setSelectedId(slab.id);
                                          setSelectedIds([slab.id]);
                                        }}
                                        className={cn(
                                          "flex items-center gap-2 py-1 px-2 rounded cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 group transition-colors text-xs",
                                          isSelected && "bg-trimble-blue/10 text-trimble-blue font-medium",
                                          slab.hidden && "opacity-40"
                                        )}
                                      >
                                        <Box size={11} className="text-gray-400 shrink-0" />
                                        <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: slab.color || '#cbd5e1' }} />
                                        <span className="flex-1 truncate">{slab.name || 'Floor Slab'}</span>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setShapes(prev => prev.map(s => s.id === slab.id ? { ...s, hidden: !s.hidden } : s));
                                          }}
                                          className="opacity-0 group-hover:opacity-100 hover:text-trimble-blue p-0.5 shrink-0"
                                          title={slab.hidden ? "Show" : "Hide"}
                                        >
                                          {slab.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                                        </button>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const clone = {
                                              ...slab,
                                              id: Math.random().toString(36).substr(2, 9),
                                              name: `${slab.name || 'Floor Slab'} Copy`,
                                              position: [slab.position[0] + 0.3, slab.position[1], slab.position[2] + 0.3] as [number, number, number],
                                            };
                                            setShapes(prev => [...prev, clone]);
                                            commitHistory();
                                          }}
                                          className="opacity-0 group-hover:opacity-100 hover:text-trimble-blue p-0.5 shrink-0"
                                          title="Duplicate"
                                        >
                                          <CopyIcon size={12} />
                                        </button>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            removeShape(slab.id);
                                          }}
                                          className="opacity-0 group-hover:opacity-100 hover:text-red-500 p-0.5 shrink-0"
                                          title="Delete"
                                        >
                                          <Trash2 size={12} />
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* 2. ROOFS & NESTED FASCIAS */}
                    {roofShapes.length > 0 && (
                      <div className="space-y-1 mt-1.5">
                        <div className="px-2 pt-2 pb-0.5 text-[10px] uppercase font-bold tracking-wider text-gray-400 dark:text-gray-500 flex items-center justify-between">
                          <span>Roofs & Fascia Assemblies</span>
                          <span className="text-[9px] font-mono text-gray-400">{roofShapes.length} roof</span>
                        </div>

                        {roofShapes.map(roof => {
                          const isRoofExpanded = expandedOutlinerRoofs.has(roof.id) || expandedOutlinerRoofs.has('all-roofs');
                          const isSelected = selectedId === roof.id || selectedIds.includes(roof.id);
                          const children = shapes.filter(s => s.parentShapeId === roof.id || (s.tags?.includes('roof-fascia') && !s.parentShapeId && s.id !== roof.id));
                          const allRoofShapeIds = [roof.id, ...children.map(c => c.id)];
                          const anyVisible = [roof, ...children].some(s => !s.hidden);
                          const allHidden = [roof, ...children].every(s => s.hidden);

                          const getChildBadge = (child: Shape) => {
                            if (child.tags?.includes('roof-slopes') || child.name?.toLowerCase().includes('slope') || child.name?.toLowerCase().includes('tile')) {
                              return { label: 'Roof Pitch', bg: 'bg-red-500/10 text-red-600 dark:text-red-400' };
                            }
                            if (child.tags?.includes('roof-pediment') || child.name?.toLowerCase().includes('pediment') || child.name?.toLowerCase().includes('infill')) {
                              return { label: 'Gable Infill', bg: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' };
                            }
                            if (child.tags?.includes('roof-ridge-cap') || child.name?.toLowerCase().includes('ridge')) {
                              return { label: 'Ridge Cap', bg: 'bg-slate-500/10 text-slate-600 dark:text-slate-400' };
                            }
                            if (child.tags?.includes('roof-soffit') || child.name?.toLowerCase().includes('soffit')) {
                              return { label: 'Soffit', bg: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' };
                            }
                            return { label: 'Fascia Trim', bg: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' };
                          };

                          return (
                            <div key={roof.id} className="rounded-lg overflow-hidden border border-gray-100 dark:border-gray-800/80 bg-gray-50/40 dark:bg-gray-800/20">
                              {/* Roof Parent Item */}
                              <div
                                onClick={() => {
                                  setSelectedId(roof.id);
                                  setSelectedIds([roof.id]);
                                }}
                                className={cn(
                                  "flex items-center gap-1.5 py-1.5 px-2 rounded cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors group select-none text-xs",
                                  isSelected && "bg-trimble-blue/10 text-trimble-blue font-semibold",
                                  roof.hidden && "opacity-40"
                                )}
                                title={roof.name}
                              >
                                {children.length > 0 ? (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExpandedOutlinerRoofs(prev => {
                                        const next = new Set(prev);
                                        if (next.has(roof.id)) {
                                          next.delete(roof.id);
                                          next.delete('all-roofs');
                                        } else {
                                          next.add(roof.id);
                                        }
                                        return next;
                                      });
                                    }}
                                    className="p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                                    title={isRoofExpanded ? "Collapse Roof Parts" : "Expand Roof Parts"}
                                  >
                                    <ChevronRight size={13} className={cn("transition-transform duration-200", isRoofExpanded && "rotate-90")} />
                                  </button>
                                ) : (
                                  <div className="w-4" />
                                )}

                                <Home size={13} className="text-amber-700 dark:text-amber-500 shrink-0" />
                                <div className="w-2 h-2 rounded-full shrink-0 border border-black/20" style={{ backgroundColor: roof.color || '#991b1b' }} />
                                <span className="flex-1 truncate font-medium">{roof.name || 'Roof Assembly'}</span>

                                {children.length > 0 && (
                                  <span className="text-[9px] font-mono px-1 py-0.2 bg-gray-200/50 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 rounded shrink-0">
                                    {children.length} parts
                                  </span>
                                )}

                                {/* Roof Hide/Show */}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShapes(prev => prev.map(s => allRoofShapeIds.includes(s.id) ? { ...s, hidden: anyVisible } : s));
                                  }}
                                  className="opacity-0 group-hover:opacity-100 hover:text-trimble-blue p-0.5 shrink-0"
                                  title={allHidden ? "Show Roof & Parts" : "Hide Roof & Parts"}
                                >
                                  {allHidden ? <EyeOff size={13} className="text-gray-400" /> : <Eye size={13} />}
                                </button>

                                {/* Roof Delete */}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    allRoofShapeIds.forEach(id => removeShape(id));
                                  }}
                                  className="opacity-0 group-hover:opacity-100 hover:text-red-500 p-0.5 shrink-0"
                                  title="Delete Roof & Parts"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>

                              {/* Roof Subcomponents (Indented Children) */}
                              {isRoofExpanded && children.length > 0 && (
                                <div className="pl-6 pr-1 py-1 space-y-0.5 border-t border-gray-100 dark:border-gray-800 bg-white/50 dark:bg-gray-900/30">
                                  {children.map(child => {
                                    const isChildSelected = selectedId === child.id || selectedIds.includes(child.id);
                                    const badge = getChildBadge(child);
                                    return (
                                      <div
                                        key={child.id}
                                        onClick={() => {
                                          setSelectedId(child.id);
                                          setSelectedIds([child.id]);
                                        }}
                                        className={cn(
                                          "flex items-center gap-2 py-1 px-2 rounded cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 group transition-colors text-xs",
                                          isChildSelected && "bg-trimble-blue/10 text-trimble-blue font-medium",
                                          child.hidden && "opacity-40"
                                        )}
                                        title={child.name}
                                      >
                                        <div className="w-2 h-2 rounded-full shrink-0 border border-gray-300 dark:border-gray-600 shadow-sm" style={{ backgroundColor: child.color || '#ffffff' }} />
                                        <span className="flex-1 truncate text-gray-700 dark:text-gray-300 font-medium">
                                          {child.name || 'Roof Component'}
                                        </span>
                                        <span className={cn("text-[9px] px-1 py-0.2 rounded font-mono shrink-0", badge.bg)}>
                                          {badge.label}
                                        </span>

                                        {/* Child Independent Hide/Show */}
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setShapes(prev => prev.map(s => s.id === child.id ? { ...s, hidden: !s.hidden } : s));
                                          }}
                                          className="opacity-0 group-hover:opacity-100 hover:text-trimble-blue p-0.5 shrink-0"
                                          title={child.hidden ? "Show Component" : "Hide Component"}
                                        >
                                          {child.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                                        </button>

                                        {/* Child Independent Delete */}
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            removeShape(child.id);
                                          }}
                                          className="opacity-0 group-hover:opacity-100 hover:text-red-500 p-0.5 shrink-0"
                                          title="Delete Component"
                                        >
                                          <Trash2 size={12} />
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* 3. TIMBER FRAME CONSTRUCTION SUBGROUP */}
                    {timberShapes.length > 0 && (() => {
                      const allTimberIds = timberShapes.map(s => s.id);
                      const allTimberHidden = timberShapes.every(s => s.hidden);
                      const anyTimberVisible = timberShapes.some(s => !s.hidden);
                      const allTimberSelected = allTimberIds.length > 0 && allTimberIds.every(id => selectedIds.includes(id));

                      const wallMembers = timberShapes.filter(s => s.tags?.includes('timber-wall') || s.name?.includes('Stud') || s.name?.includes('Plate') || s.name?.includes('Header'));
                      const floorMembers = timberShapes.filter(s => s.tags?.includes('timber-floor') || s.name?.includes('Joist') || s.name?.includes('Sill'));
                      const roofMembers = timberShapes.filter(s => s.tags?.includes('timber-roof') || s.name?.includes('Rafter') || s.name?.includes('Ridge') || s.name?.includes('Tie'));

                      const categories = [
                        { key: 'walls', label: 'Wall Framing (Studs, Plates, Headers)', members: wallMembers, color: 'bg-amber-600' },
                        { key: 'floors', label: 'Floor Framing (Joists & Rims)', members: floorMembers, color: 'bg-amber-700' },
                        { key: 'roofs', label: 'Roof Framing (Rafters, Ridges & Ties)', members: roofMembers, color: 'bg-amber-800' }
                      ].filter(c => c.members.length > 0);

                      return (
                        <div className="space-y-1 mt-1.5">
                          <div className="px-2 pt-2 pb-0.5 text-[10px] uppercase font-bold tracking-wider text-gray-400 dark:text-gray-500 flex items-center justify-between">
                            <span>Timber Frame Construction</span>
                            <span className="text-[9px] font-mono text-amber-600 dark:text-amber-400 font-semibold">{timberShapes.length} members</span>
                          </div>

                          <div className="rounded-lg overflow-hidden border border-amber-200/70 dark:border-amber-900/50 bg-amber-50/30 dark:bg-amber-950/20">
                            {/* Main Timber Frame Header */}
                            <div
                              onClick={() => {
                                setSelectedId(null);
                                setSelectedIds(allTimberIds);
                              }}
                              className={cn(
                                "flex items-center gap-1.5 py-1.5 px-2 rounded cursor-pointer hover:bg-amber-100/50 dark:hover:bg-amber-900/30 transition-colors group select-none text-xs",
                                allTimberSelected && "bg-amber-200/50 dark:bg-amber-900/50 text-amber-900 dark:text-amber-200 font-semibold"
                              )}
                              title={`Timber Frame Construction (${timberShapes.length} structural members)`}
                            >
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedOutlinerTimber(!expandedOutlinerTimber);
                                }}
                                className="p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                                title={expandedOutlinerTimber ? "Collapse Timber Framing" : "Expand Timber Framing"}
                              >
                                <ChevronRight size={13} className={cn("transition-transform duration-200", expandedOutlinerTimber && "rotate-90")} />
                              </button>

                              <Hammer size={13} className="text-amber-700 dark:text-amber-400 shrink-0" />
                              <span className="flex-1 truncate font-semibold text-gray-800 dark:text-gray-200">
                                Timber Framing Group
                              </span>

                              <span className="text-[9px] font-mono px-1.5 py-0.2 bg-amber-200/60 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300 rounded shrink-0">
                                {timberShapes.length} pcs
                              </span>

                              {/* Bulk Hide/Show Toggle */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShapes(prev => prev.map(s => allTimberIds.includes(s.id) ? { ...s, hidden: anyTimberVisible } : s));
                                }}
                                className="opacity-0 group-hover:opacity-100 hover:text-amber-700 dark:hover:text-amber-300 p-0.5 shrink-0 transition-opacity"
                                title={allTimberHidden ? "Show All Timber Members" : "Hide All Timber Members"}
                              >
                                {allTimberHidden ? <EyeOff size={13} className="text-gray-400" /> : <Eye size={13} />}
                              </button>

                              {/* Bulk Delete */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShapes(prev => prev.filter(s => !allTimberIds.includes(s.id)));
                                  setSelectedIds(prev => prev.filter(id => !allTimberIds.includes(id)));
                                  if (selectedId && allTimberIds.includes(selectedId)) setSelectedId(null);
                                }}
                                className="opacity-0 group-hover:opacity-100 hover:text-red-500 p-0.5 shrink-0 transition-opacity"
                                title={`Delete All Timber Framing (${timberShapes.length} members)`}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>

                            {/* Subcategories (Walls, Floors, Roof) */}
                            {expandedOutlinerTimber && (
                              <div className="pl-4 pr-1 py-1 space-y-1.5 border-t border-amber-100 dark:border-amber-900/40 bg-white/40 dark:bg-gray-900/30">
                                {categories.map(cat => {
                                  const isCatExpanded = expandedTimberSubgroups.has(cat.key);
                                  const catIds = cat.members.map(m => m.id);
                                  const catAllHidden = cat.members.every(m => m.hidden);
                                  const catAnyVisible = cat.members.some(m => !m.hidden);
                                  const catAllSelected = catIds.length > 0 && catIds.every(id => selectedIds.includes(id));

                                  return (
                                    <div key={cat.key} className="rounded border border-amber-200/40 dark:border-amber-900/30 overflow-hidden bg-amber-50/20 dark:bg-amber-950/10">
                                      {/* Subgroup Header */}
                                      <div
                                        onClick={() => {
                                          setSelectedId(null);
                                          setSelectedIds(catIds);
                                        }}
                                        className={cn(
                                          "flex items-center gap-1.5 py-1 px-1.5 rounded cursor-pointer hover:bg-amber-100/40 dark:hover:bg-amber-900/30 group text-[11px] select-none",
                                          catAllSelected && "bg-amber-200/40 text-amber-900 dark:text-amber-200 font-semibold"
                                        )}
                                      >
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setExpandedTimberSubgroups(prev => {
                                              const next = new Set(prev);
                                              if (next.has(cat.key)) next.delete(cat.key);
                                              else next.add(cat.key);
                                              return next;
                                            });
                                          }}
                                          className="p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                                        >
                                          <ChevronRight size={11} className={cn("transition-transform duration-200", isCatExpanded && "rotate-90")} />
                                        </button>
                                        <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", cat.color)} />
                                        <span className="flex-1 truncate font-medium text-gray-700 dark:text-gray-300">
                                          {cat.label}
                                        </span>
                                        <span className="text-[9px] font-mono text-gray-400 shrink-0">
                                          {cat.members.length}
                                        </span>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setShapes(prev => prev.map(s => catIds.includes(s.id) ? { ...s, hidden: catAnyVisible } : s));
                                          }}
                                          className="opacity-0 group-hover:opacity-100 hover:text-amber-700 p-0.5 shrink-0"
                                          title={catAllHidden ? "Show Subgroup" : "Hide Subgroup"}
                                        >
                                          {catAllHidden ? <EyeOff size={11} className="text-gray-400" /> : <Eye size={11} />}
                                        </button>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setShapes(prev => prev.filter(s => !catIds.includes(s.id)));
                                            setSelectedIds(prev => prev.filter(id => !catIds.includes(id)));
                                          }}
                                          className="opacity-0 group-hover:opacity-100 hover:text-red-500 p-0.5 shrink-0"
                                          title={`Delete ${cat.label}`}
                                        >
                                          <Trash2 size={11} />
                                        </button>
                                      </div>

                                      {/* Member list */}
                                      {isCatExpanded && (
                                        <div className="pl-4 pr-1 py-0.5 space-y-0.5 border-t border-amber-100/50 dark:border-amber-900/20 max-h-48 overflow-y-auto">
                                          {cat.members.map(member => {
                                            const isSelected = selectedId === member.id || selectedIds.includes(member.id);
                                            const args = member.args as [number, number, number];
                                            const dimStr = Array.isArray(args) ? `${(args[0] * 1000).toFixed(0)}×${(args[2] * 1000).toFixed(0)}mm (L:${args[1].toFixed(2)}m)` : '';

                                            return (
                                              <div
                                                key={member.id}
                                                onClick={() => {
                                                  setSelectedId(member.id);
                                                  setSelectedIds([member.id]);
                                                }}
                                                className={cn(
                                                  "flex items-center gap-1.5 py-0.5 px-1.5 rounded cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 group text-[10px]",
                                                  isSelected && "bg-trimble-blue/10 text-trimble-blue font-medium",
                                                  member.hidden && "opacity-40"
                                                )}
                                                title={`${member.name} — ${dimStr}`}
                                              >
                                                <div className="w-1.5 h-1.5 rounded-full shrink-0 border border-amber-700/50" style={{ backgroundColor: member.color || '#b45309' }} />
                                                <span className="flex-1 truncate text-gray-700 dark:text-gray-300">
                                                  {member.name}
                                                </span>
                                                {dimStr && (
                                                  <span className="text-[8px] font-mono text-gray-400 shrink-0">
                                                    {dimStr}
                                                  </span>
                                                )}
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setShapes(prev => prev.map(s => s.id === member.id ? { ...s, hidden: !s.hidden } : s));
                                                  }}
                                                  className="opacity-0 group-hover:opacity-100 hover:text-amber-700 p-0.5 shrink-0"
                                                  title={member.hidden ? "Show" : "Hide"}
                                                >
                                                  {member.hidden ? <EyeOff size={10} /> : <Eye size={10} />}
                                                </button>
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    const clone = {
                                                      ...member,
                                                      id: Math.random().toString(36).substr(2, 9),
                                                      name: `${member.name || 'Timber'} Copy`,
                                                      position: [member.position[0] + 0.3, member.position[1], member.position[2] + 0.3] as [number, number, number],
                                                    };
                                                    setShapes(prev => [...prev, clone]);
                                                    commitHistory();
                                                  }}
                                                  className="opacity-0 group-hover:opacity-100 hover:text-trimble-blue p-0.5 shrink-0"
                                                  title="Duplicate"
                                                >
                                                  <CopyIcon size={10} />
                                                </button>
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setShapes(prev => prev.filter(s => s.id !== member.id));
                                                    setSelectedIds(prev => prev.filter(id => id !== member.id));
                                                    if (selectedId === member.id) setSelectedId(null);
                                                  }}
                                                  className="opacity-0 group-hover:opacity-100 hover:text-red-500 p-0.5 shrink-0"
                                                  title="Delete"
                                                >
                                                  <Trash2 size={10} />
                                                </button>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* 4. OTHER MODEL SHAPES & COMPONENTS */}
                    {otherShapes.length > 0 && (
                      <div className="space-y-0.5 mt-1.5">
                        {(sortedLevels.length > 0 || roofShapes.length > 0 || timberShapes.length > 0) && (
                          <div className="px-2 pt-2 pb-0.5 text-[10px] uppercase font-bold tracking-wider text-gray-400 dark:text-gray-500">
                            Objects & Components ({otherShapes.length})
                          </div>
                        )}
                        {otherShapes.map(shape => {
                          const isSelected = selectedId === shape.id || selectedIds.includes(shape.id);
                          return (
                            <div
                              key={shape.id}
                              onClick={() => {
                                setSelectedId(shape.id);
                                setSelectedIds([shape.id]);
                              }}
                              className={cn(
                                "flex items-center gap-2 py-1 px-4 rounded cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 group text-xs",
                                isSelected && "bg-trimble-blue/10 text-trimble-blue font-medium",
                                shape.hidden && "opacity-40"
                              )}
                            >
                              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: shape.color || '#94a3b8' }} />
                              <span className="flex-1 truncate">{shape.name || `${shape.type} (${shape.id.slice(0, 4)})`}</span>

                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShapes(prev => prev.map(s => s.id === shape.id ? { ...s, hidden: !s.hidden } : s));
                                }}
                                className="opacity-0 group-hover:opacity-100 hover:text-trimble-blue p-0.5 shrink-0"
                                title={shape.hidden ? "Show" : "Hide"}
                              >
                                {shape.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                              </button>

                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const clone = {
                                    ...shape,
                                    id: Math.random().toString(36).substr(2, 9),
                                    name: `${shape.name || 'Object'} Copy`,
                                    position: [shape.position[0] + 0.3, shape.position[1], shape.position[2] + 0.3] as [number, number, number],
                                  };
                                  setShapes(prev => [...prev, clone]);
                                  commitHistory();
                                }}
                                className="opacity-0 group-hover:opacity-100 hover:text-trimble-blue p-0.5 shrink-0"
                                title="Duplicate"
                              >
                                <CopyIcon size={13} />
                              </button>

                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeShape(shape.id);
                                }}
                                className="opacity-0 group-hover:opacity-100 hover:text-red-500 p-0.5 shrink-0"
                                title="Delete"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                );
              })()}
              {kernelGroups.length > 0 && (
                <>
                  <div className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-wide text-gray-400">
                    Geometry
                  </div>
                  {kernelGroups.map(group => {
                    const collapsed = !expandedGroups.has(group.id);
                    const rows = group.faces.map(f => kernelRowById.get(f)).filter(Boolean) as typeof kernelFaceRows;
                    const allSelected = group.faces.every(f => selectedFaceIds.includes(f));
                    // A single loose surface needs no group wrapper — it would
                    // be a heading over one row.
                    const single = group.faces.length === 1;
                    return (
                      <div key={group.id}>
                        {!single && (
                          <div
                            onClick={() => { setSelectedId(null); setSelectedIds([]); setSelectedFaceIds(group.faces); }}
                            className={cn(
                              "flex items-center gap-1.5 py-1 px-4 rounded cursor-pointer hover:bg-gray-100 group",
                              allSelected && "bg-trimble-blue/10 text-trimble-blue"
                            )}
                            title={`${group.faces.length} surfaces · area ${group.area.toFixed(2)}`}
                          >
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedGroups(prev => {
                                  const next = new Set(prev);
                                  if (next.has(group.id)) next.delete(group.id); else next.add(group.id);
                                  return next;
                                });
                              }}
                              className="p-0.5 -ml-1 shrink-0 text-gray-400 hover:text-gray-700"
                              title={collapsed ? "Expand" : "Collapse"}
                            >
                              <ChevronRight size={12} className={cn("transition-transform", !collapsed && "rotate-90")} />
                            </button>
                            <Box size={13} className="shrink-0 text-gray-400" />
                            <span className="flex-1 truncate font-medium">{group.label}</span>
                            <span className="text-[10px] text-gray-400 shrink-0">{group.faces.length}</span>
                            {/*
                              Hide/delete at the GROUP level, not just per
                              surface — a six-face box previously had no way
                              to hide or delete it as one thing; you had to
                              find and act on every individual wall.
                            */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const anyVisible = rows.some(r => !r.hidden);
                                setGroupHidden(kernelHost.graph, group.faces, anyVisible);
                                bumpKernel();
                              }}
                              className="opacity-0 group-hover:opacity-100 hover:text-trimble-blue p-0.5 shrink-0"
                              title={rows.some(r => !r.hidden) ? "Hide group" : "Show group"}
                            >
                              {rows.every(r => r.hidden) ? <EyeOff size={13} /> : <Eye size={13} />}
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                duplicateKernelFaces(group.faces, group.label);
                              }}
                              className="opacity-0 group-hover:opacity-100 hover:text-trimble-blue p-0.5 shrink-0"
                              title={`Duplicate ${group.label.toLowerCase()}`}
                            >
                              <CopyIcon size={13} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteGroupFacesAndEdges(kernelHost.graph, group.faces);
                                setSelectedFaceIds(prev => prev.filter(f => !group.faces.includes(f)));
                                bumpKernel();
                              }}
                              className="opacity-0 group-hover:opacity-100 hover:text-red-500 p-0.5 shrink-0"
                              title={`Delete ${group.label.toLowerCase()} and its edges`}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        )}
                        {(!collapsed || single) && rows.map(row => (
                          <div
                            key={`kf-${row.id}`}
                            onClick={() => { setSelectedId(null); setSelectedIds([]); setSelectedFaceIds([row.id]); }}
                            className={cn(
                              "flex items-center gap-2 py-1 rounded cursor-pointer hover:bg-gray-100 group",
                              single ? "px-4" : "pl-10 pr-4",
                              selectedFaceIds.includes(row.id) && "bg-trimble-blue/10 text-trimble-blue",
                              row.hidden && "opacity-40"
                            )}
                            title={`Area ${row.area.toFixed(2)}${row.holes ? ` · ${row.holes} hole(s)` : ''}`}
                          >
                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: row.color || '#d8d4cc' }} />
                            {/*
                              A single-face group's header is skipped above
                              (a heading over one row would be redundant),
                              so this is the only place its name can come
                              from. `group.label` carries the shape
                              classification ("Rectangle", "Circle",
                              "Triangle"); `row.label` does not — it falls
                              back to a generic "Surface N" whenever the
                              face has no user-given name. Using row.label
                              unconditionally here was why a lone rectangle
                              or circle showed as "Surface" instead of its
                              real name.
                            */}
                            <span className="flex-1 truncate">{single ? group.label : row.label}</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleFaceHidden(kernelHost.graph, row.id); bumpKernel(); }}
                              className="opacity-0 group-hover:opacity-100 hover:text-trimble-blue p-0.5 shrink-0"
                              title={row.hidden ? "Show" : "Hide"}
                            >{row.hidden ? <EyeOff size={13} /> : <Eye size={13} />}</button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                duplicateKernelFaces([row.id], row.label);
                              }}
                              className="opacity-0 group-hover:opacity-100 hover:text-trimble-blue p-0.5 shrink-0"
                              title="Duplicate surface"
                            ><CopyIcon size={13} /></button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteFaceAndEdges(kernelHost.graph, row.id);
                                setSelectedFaceIds(prev => prev.filter(f => f !== row.id));
                                bumpKernel();
                              }}
                              className="opacity-0 group-hover:opacity-100 hover:text-red-500 p-0.5 shrink-0"
                              title="Delete surface and its edges"
                            ><Trash2 size={13} /></button>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </>
              )}

            </div>
          </Panel>
        )}

        {panelVisibility['materials'] !== false && (
          <Panel 
            id="materials" 
            title="Materials" 
            icon={<Palette size={16} />} 
            isOpen={openPanels.includes('materials')}
            onToggle={() => togglePanel('materials')}
          >
            <div className="space-y-4">
              <div className="grid grid-cols-5 gap-2">
                {COLORS.map((color, idx) => (
                  <div 
                    key={`palette-preset-${color}-${idx}`} 
                    onClick={() => {
                      setActiveMaterial(color);
                      setActivePBR({ roughness: 0.5, metalness: 0, opacity: 1 });
                      setActiveTool('paint');
                    }}
                    className={cn(
                      "aspect-square rounded-sm border cursor-pointer transition-transform hover:scale-110",
                      activeMaterial === color ? "border-trimble-blue ring-1 ring-trimble-blue" : "border-gray-300"
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
                {customMaterials.filter(m => m.type === 'color').map((m, i) => (
                  <div 
                    key={m.id || `custom-col-${m.value}-${i}`} 
                    onClick={() => {
                      setActiveMaterial(m.value);
                      if (m.pbr) setActivePBR(m.pbr);
                      setActiveTool('paint');
                    }}
                    className={cn(
                      "group relative aspect-square rounded-sm border cursor-pointer transition-transform hover:scale-105",
                      activeMaterial === m.value ? "border-trimble-blue ring-1 ring-trimble-blue" : "border-gray-300"
                    )}
                    style={{ backgroundColor: m.value }}
                    title={m.name || m.value}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteMaterial(m);
                      }}
                      className="absolute -top-1 -right-1 w-4 h-4 bg-black/70 hover:bg-red-600 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-10 shadow-xs"
                      title="Delete material"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
                <button 
                  onClick={() => setIsAddMaterialOpen(true)}
                  className="aspect-square rounded-sm border border-dashed border-gray-300 flex items-center justify-center hover:border-trimble-blue hover:bg-gray-50 transition-colors"
                >
                  <Plus size={16} className="text-gray-400" />
                </button>
              </div>

              {customMaterials.filter(m => m.type === 'texture').length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Textures</span>
                    <span className="text-[9px] text-gray-400">{customMaterials.filter(m => m.type === 'texture').length} custom</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {customMaterials.filter(m => m.type === 'texture').map((m, i) => (
                      <div 
                        key={m.id || `custom-tex-${i}`}
                        onClick={() => {
                          setActiveMaterial(m.value);
                          if (m.pbr) setActivePBR(m.pbr);
                          setActiveTool('paint');
                        }}
                        className={cn(
                          "group relative aspect-square rounded-sm border cursor-pointer overflow-hidden transition-transform hover:scale-105 bg-gray-100 dark:bg-gray-800",
                          activeMaterial === m.value ? "border-trimble-blue ring-1 ring-trimble-blue" : "border-gray-300 dark:border-gray-700"
                        )}
                        title={m.name || 'Custom Texture'}
                      >
                        <img 
                          src={m.value} 
                          alt={m.name || 'Texture'} 
                          className="w-full h-full object-cover" 
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            (e.currentTarget as HTMLElement).style.display = 'none';
                          }}
                        />
                        {/* Fallback placeholder if image is broken or failed to load */}
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 dark:text-gray-500 p-1 text-center pointer-events-none -z-0">
                          <ImageOff size={14} className="opacity-70 mb-0.5" />
                          <span className="text-[7px] truncate max-w-full font-mono leading-none">{m.name || 'Broken'}</span>
                        </div>
                        {/* Remove texture action button */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteMaterial(m);
                          }}
                          className="absolute top-0.5 right-0.5 p-1 bg-black/70 hover:bg-red-600 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity z-10 shadow-xs cursor-pointer"
                          title="Remove texture"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                <span className="text-gray-500">Active:</span>
                {activeMaterial.startsWith('#') ? (
                  <div className="w-6 h-6 rounded-sm border border-gray-300 shadow-sm" style={{ backgroundColor: activeMaterial }} />
                ) : (
                  <div className="w-6 h-6 rounded-sm border border-gray-300 shadow-sm overflow-hidden">
                    <img src={activeMaterial} alt="Active" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  </div>
                )}
                <span className="font-mono text-[10px] truncate max-w-[100px]">
                  {activeMaterial.startsWith('#') ? activeMaterial.toUpperCase() : 'TEXTURE'}
                </span>
              </div>
            </div>
          </Panel>
        )}

        {panelVisibility['styles'] !== false && (
          <Panel 
            id="styles" 
            title="Styles" 
            icon={<PenTool size={16} />} 
            isOpen={openPanels.includes('styles')}
            onToggle={() => togglePanel('styles')}
          >
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2 border border-trimble-blue rounded bg-trimble-blue/5 text-center">
                <div className="aspect-video bg-white border border-gray-200 mb-1" />
                <span>Default</span>
              </div>
              <div className="p-2 border border-gray-200 rounded hover:border-gray-300 text-center">
                <div className="aspect-video bg-gray-50 border border-gray-200 mb-1" />
                <span>Architectural</span>
              </div>
            </div>
          </Panel>
        )}

        {panelVisibility['tags'] !== false && (
          <Panel 
            id="tags" 
            title="Tags" 
            icon={<Layers size={16} />} 
            isOpen={openPanels.includes('tags')}
            onToggle={() => togglePanel('tags')}
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold text-gray-400 uppercase">Visibility</span>
                <button 
                  onClick={toggleAllTags}
                  className="text-[10px] text-trimble-blue hover:underline"
                >
                  {allTagsVisible ? 'Hide All' : 'Show All'}
                </button>
              </div>

              <div className="flex gap-2">
                <input 
                  type="text" 
                  placeholder="New tag..." 
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  className="flex-1 px-2 py-1 border border-gray-200 rounded text-[10px] outline-none focus:border-trimble-blue"
                />
                <input 
                  type="color" 
                  value={newTagColor}
                  onChange={(e) => setNewTagColor(e.target.value)}
                  className="w-6 h-6 rounded cursor-pointer border-none p-0"
                />
                <button 
                  onClick={handleAddTag}
                  className="p-1 bg-trimble-blue text-white rounded hover:bg-trimble-dark-blue"
                >
                  <Plus size={14} />
                </button>
              </div>

              <div className="relative">
                <input 
                  type="text" 
                  placeholder="Search tags..." 
                  value={tagSearch}
                  onChange={(e) => setTagSearch(e.target.value)}
                  className="w-full pl-7 pr-2 py-1 border border-gray-100 rounded text-[10px] outline-none"
                />
                <Search size={12} className="absolute left-2 top-1.5 text-gray-400" />
              </div>

              <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                {tags.filter(t => t.name.toLowerCase().includes(tagSearch.toLowerCase())).map(tag => (
                  <div 
                    key={tag.id} 
                    className={cn(
                      "flex items-center justify-between p-1.5 hover:bg-gray-50 rounded group cursor-pointer",
                      activeTagId === tag.id && "bg-trimble-blue/10 ring-1 ring-trimble-blue"
                    )}
                    onClick={() => setActiveTagId(activeTagId === tag.id ? null : tag.id)}
                  >
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={(e) => { e.stopPropagation(); toggleTagVisibility(tag.id); }}
                        className={cn("w-3 h-3 rounded-full", !tag.visible && "opacity-30")}
                        style={{ backgroundColor: tag.color }}
                      />
                      <span className={cn("text-[10px] font-medium", !tag.visible && "text-gray-400 line-through")}>
                        {tag.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                      <button 
                        onClick={(e) => { e.stopPropagation(); setTags(tags.filter(t => t.id !== tag.id)); }}
                        className="p-0.5 hover:text-red-500 transition-all"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                ))}
                {tags.length === 0 && <p className="text-center text-gray-400 italic py-2">No tags added</p>}
              </div>
              {activeTagId && (
                <div className="p-2 bg-yellow-50 border border-yellow-200 rounded text-[9px] text-yellow-700 animate-pulse">
                  Tag Allocation Mode: Click objects in viewport to assign "{tags.find(t => t.id === activeTagId)?.name}"
                </div>
              )}
            </div>
          </Panel>
        )}

        {panelVisibility['scenes'] !== false && (
          <Panel 
            id="scenes" 
            title="Scenes" 
            icon={<Clapperboard size={16} />} 
            isOpen={openPanels.includes('scenes')}
            onToggle={() => togglePanel('scenes')}
          >
            <div className="space-y-3">
              <button 
                onClick={handleSaveScene}
                className="w-full py-1.5 border border-dashed border-gray-300 rounded text-[10px] font-bold text-gray-500 hover:border-trimble-blue hover:text-trimble-blue transition-all flex items-center justify-center gap-2"
              >
                <Plus size={14} />
                Save Scene
              </button>

              <div className="grid grid-cols-2 gap-2">
                {scenes.map(scene => (
                  <div 
                    key={scene.id} 
                    className="group relative rounded border border-gray-100 overflow-hidden cursor-pointer hover:border-trimble-blue transition-all"
                    onClick={() => window.dispatchEvent(new CustomEvent('set-camera', { detail: { position: scene.cameraPosition, target: scene.cameraTarget } }))}
                    onContextMenu={(e) => { e.preventDefault(); handleRenameScene(scene.id); }}
                  >
                    <img src={scene.previewUrl} alt={scene.name} className="w-full h-12 object-cover" />
                    <div className="p-1 bg-white text-[9px] font-medium truncate">{scene.name}</div>
                    <button 
                      onClick={(e) => { e.stopPropagation(); setScenes(scenes.filter(s => s.id !== scene.id)); }}
                      className="absolute top-0.5 right-0.5 p-0.5 bg-white/80 rounded-full opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
              {scenes.length === 0 && <p className="text-center text-gray-400 italic py-2">No scenes saved</p>}
            </div>
          </Panel>
        )}

        {panelVisibility['shadows'] !== false && (
          <Panel 
            id="shadows" 
            title="Visualisation" 
            icon={<Sun size={16} />} 
            isOpen={openPanels.includes('shadows')}
            onToggle={() => togglePanel('shadows')}
          >
            <div className="space-y-2">
              <div className="space-y-3 px-1 py-1 border-b border-gray-100 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-gray-400 uppercase">Display Shadows</span>
                  <button 
                    onClick={() => setShadowsEnabled(!shadowsEnabled)}
                    className={cn(
                      "w-8 h-4 rounded-full relative transition-colors",
                      shadowsEnabled ? "bg-trimble-blue" : "bg-gray-300"
                    )}
                  >
                    <div className={cn(
                      "absolute top-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-all",
                      shadowsEnabled ? "left-4.5" : "left-0.5"
                    )} />
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-gray-400 uppercase">See Lightsource</span>
                  <button 
                    onClick={() => setShowLightsource(!showLightsource)}
                    className={cn(
                      "w-8 h-4 rounded-full relative transition-colors",
                      showLightsource ? "bg-trimble-blue" : "bg-gray-300"
                    )}
                  >
                    <div className={cn(
                      "absolute top-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-all",
                      showLightsource ? "left-4.5" : "left-0.5"
                    )} />
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-gray-400 uppercase">Ambient Occlusion</span>
                  <button 
                    onClick={() => setAmbientOcclusionEnabled(!ambientOcclusionEnabled)}
                    className={cn(
                      "w-8 h-4 rounded-full transition-colors relative",
                      ambientOcclusionEnabled ? "bg-trimble-blue" : "bg-gray-300"
                    )}
                  >
                    <div className={cn(
                      "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all",
                      ambientOcclusionEnabled ? "left-4" : "left-0.5"
                    )} />
                  </button>
                </div>
              </div>

              <div className="space-y-3 px-2 py-1 border-b border-gray-100 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-gray-400 uppercase">Edge Lines</span>
                  <button
                    onClick={() => setEdgeLinesEnabled(!edgeLinesEnabled)}
                    className={cn(
                      "w-8 h-4 rounded-full relative transition-colors",
                      edgeLinesEnabled ? "bg-trimble-blue" : "bg-gray-300"
                    )}
                  >
                    <div className={cn(
                      "absolute top-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-all",
                      edgeLinesEnabled ? "left-4.5" : "left-0.5"
                    )} />
                  </button>
                </div>
                {edgeLinesEnabled && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-gray-400 uppercase">Line Color</span>
                      <input
                        type="color"
                        value={edgeLinesColor}
                        onChange={(e) => setEdgeLinesColor(e.target.value)}
                        className="w-6 h-6 rounded cursor-pointer border-none p-0"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <label className="text-[8px] font-bold text-gray-400 uppercase">Opacity</label>
                        <span className="text-[8px] text-gray-400">{Math.round(edgeLinesOpacity * 100)}%</span>
                      </div>
                      <input
                        type="range" min="0.1" max="1" step="0.05"
                        value={edgeLinesOpacity}
                        onChange={(e) => setEdgeLinesOpacity(parseFloat(e.target.value))}
                        className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <label className="text-[8px] font-bold text-gray-400 uppercase">Thickness</label>
                        <span className="text-[8px] text-gray-400">{edgeLinesThickness}px</span>
                      </div>
                      <input
                        type="range" min="1" max="5" step="0.5"
                        value={edgeLinesThickness}
                        onChange={(e) => setEdgeLinesThickness(parseFloat(e.target.value))}
                        className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                      />
                    </div>
                  </>
                )}
              </div>
              <SubSection title="Skybox">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Environment</label>
                  <select 
                    value={skybox}
                    onChange={(e) => setSkybox(e.target.value as any)}
                    className={cn(
                      "w-full px-2 py-1.5 border rounded text-xs outline-none focus:border-trimble-blue",
                      theme === 'dark' ? "bg-gray-700 border-gray-600 text-gray-200" : "bg-white border-gray-200 text-gray-700"
                    )}
                  >
                    <option value="none">None (Default)</option>
                    <option value="golden-hour">Golden Hour</option>
                    <option value="sunrise">Sunrise</option>
                    <option value="twilight">Twilight</option>
                    <option value="woodland">Woodland</option>
                    <option value="cyberspace-neon">Cyberspace Neon</option>
                    <option value="studio">Studio</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-gray-500 uppercase font-bold">
                    <span>Env Intensity</span>
                    <span>{environmentIntensity.toFixed(2)}</span>
                  </div>
                  <input 
                    type="range" min="0" max="2" step="0.01"
                    value={environmentIntensity}
                    onChange={(e) => setEnvironmentIntensity(parseFloat(e.target.value))}
                    className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-trimble-blue" 
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-gray-500 uppercase font-bold">
                    <span>Skybox Rotation</span>
                    <span>{skyboxRotation.toFixed(0)}°</span>
                  </div>
                  <input 
                    type="range" min="0" max="360" step="1"
                    value={skyboxRotation}
                    onChange={(e) => setSkyboxRotation(parseFloat(e.target.value))}
                    className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-trimble-blue" 
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-gray-500 uppercase font-bold">
                    <span>Skybox Blur</span>
                    <span>{skyboxBlur.toFixed(2)}</span>
                  </div>
                  <input 
                    type="range" min="0" max="1" step="0.01"
                    value={skyboxBlur}
                    onChange={(e) => setSkyboxBlur(parseFloat(e.target.value))}
                    className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-trimble-blue" 
                  />
                </div>
              </SubSection>

              <SubSection title="Sunlight">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-gray-400 uppercase">Animate Sun Rotation</span>
                    <button 
                      onClick={() => setAnimateSun(!animateSun)}
                      className={cn(
                        "w-8 h-4 rounded-full relative transition-colors",
                        animateSun ? "bg-trimble-blue" : "bg-gray-300"
                      )}
                    >
                      <div className={cn(
                        "absolute top-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-all",
                        animateSun ? "left-4.5" : "left-0.5"
                      )} />
                    </button>
                  </div>

                  {animateSun && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] text-gray-500 uppercase font-bold">
                        <span>Rotation Speed</span>
                        <span>{sunSpeed.toFixed(1)}</span>
                      </div>
                      <input 
                        type="range" min="0.1" max="5" step="0.1"
                        value={sunSpeed}
                        onChange={(e) => setSunSpeed(parseFloat(e.target.value))}
                        className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-trimble-blue" 
                      />
                    </div>
                  )}

                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-gray-500 uppercase font-bold">
                      <span>Sun Position X</span>
                      <span>{lightPosition[0].toFixed(1)}</span>
                    </div>
                    <input 
                      type="range" min="-100" max="100" step="0.5"
                      value={lightPosition[0]}
                      onChange={(e) => setLightPosition([parseFloat(e.target.value), lightPosition[1], lightPosition[2]])}
                      className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-trimble-blue" 
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-gray-500 uppercase font-bold">
                      <span>Sun Position Y</span>
                      <span>{lightPosition[1].toFixed(1)}</span>
                    </div>
                    <input 
                      type="range" min="0" max="100" step="0.5"
                      value={lightPosition[1]}
                      onChange={(e) => setLightPosition([lightPosition[0], parseFloat(e.target.value), lightPosition[2]])}
                      className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-trimble-blue" 
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-gray-500 uppercase font-bold">
                      <span>Sun Position Z</span>
                      <span>{lightPosition[2].toFixed(1)}</span>
                    </div>
                    <input 
                      type="range" min="-100" max="100" step="0.5"
                      value={lightPosition[2]}
                      onChange={(e) => setLightPosition([lightPosition[0], lightPosition[1], parseFloat(e.target.value)])}
                      className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-trimble-blue" 
                    />
                  </div>
                  <button
                    onClick={() => setPickingSunCenter(true)}
                    className={cn(
                      "w-full text-[10px] font-bold uppercase tracking-wider py-1.5 rounded border transition-colors flex items-center justify-center gap-1.5",
                      pickingSunCenter
                        ? "bg-trimble-blue text-white border-trimble-blue"
                        : (theme === 'dark' ? "border-gray-700 hover:bg-gray-700 text-gray-300" : "border-gray-200 hover:bg-gray-50 text-gray-600")
                    )}
                  >
                    {pickingSunCenter ? 'Click anywhere in the viewport…' : 'Pick Sun Centre'}
                  </button>
                  <div className="text-[9px] text-gray-400 text-center -mt-1">
                    Orbit centre: {sunOrbitCenter[0].toFixed(1)}, {sunOrbitCenter[2].toFixed(1)}
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-gray-500 uppercase font-bold">
                      <span>Sun Intensity</span>
                      <span>{sunIntensity.toFixed(1)}</span>
                    </div>
                    <input 
                      type="range" min="0" max="50" step="0.1"
                      value={sunIntensity}
                      onChange={(e) => setSunIntensity(parseFloat(e.target.value))}
                      className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-trimble-blue" 
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-gray-500 uppercase font-bold">
                      <span>Shadow Opacity</span>
                      <span>{Math.round(shadowOpacity * 100)}%</span>
                    </div>
                    <input 
                      type="range" min="0" max="1" step="0.05"
                      value={shadowOpacity}
                      onChange={(e) => setShadowOpacity(parseFloat(e.target.value))}
                      className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-trimble-blue" 
                    />
                  </div>
                </div>
              </SubSection>

              <SubSection title="Custom Lights">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold text-gray-400 uppercase">Lights List</span>
                  <button 
                    onClick={() => {
                      const newLight: any = {
                        id: Math.random().toString(36).substr(2, 9),
                        type: 'point',
                        color: '#ffffff',
                        intensity: 1,
                        position: [5, 5, 5]
                      };
                      setCustomLights((prev: any[]) => [...prev, newLight]);
                    }}
                    className="text-trimble-blue hover:text-trimble-dark-blue flex items-center gap-1"
                  >
                    <Plus size={12} />
                    <span className="text-[10px]">Add</span>
                  </button>
                </div>

                <div className="space-y-3">
                  {customLights.map(light => (
                    <div key={light.id} className={cn(
                      "p-2 rounded border space-y-2",
                      theme === 'dark' ? "bg-gray-700/50 border-gray-600" : "bg-gray-50 border-gray-200"
                    )}>
                      <div className="flex items-center justify-between">
                        <select 
                          value={light.type}
                          onChange={(e) => setCustomLights(prev => prev.map(l => l.id === light.id ? { ...l, type: e.target.value as any } : l))}
                          className="bg-transparent text-[9px] font-bold uppercase outline-none"
                        >
                          <option value="point">Point</option>
                          <option value="directional">Directional</option>
                          <option value="spot">Spot</option>
                          <option value="projector">Projector</option>
                          <option value="rect">Rect</option>
                        </select>
                        <button 
                          onClick={() => setCustomLights(prev => prev.filter(l => l.id !== light.id))}
                          className="text-red-500 hover:text-red-600"
                        >
                          <X size={10} />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        {light.type !== 'projector' && (
                          <div className="space-y-1">
                            <label className="text-[8px] text-gray-400 uppercase font-bold">Color</label>
                            <input 
                              type="color" 
                              value={light.color}
                              onChange={(e) => setCustomLights(prev => prev.map(l => l.id === light.id ? { ...l, color: e.target.value } : l))}
                              className="w-full h-5 rounded cursor-pointer border-none p-0"
                            />
                          </div>
                        )}
                        <div className="space-y-1">
                          <div className="flex justify-between text-[8px] text-gray-400 uppercase font-bold">
                            <span>Intensity</span>
                            <span>{light.intensity.toFixed(1)}</span>
                          </div>
                          <input 
                            type="range" min="0" max="100" step="0.5"
                            value={light.intensity}
                            onChange={(e) => setCustomLights(prev => prev.map(l => l.id === light.id ? { ...l, intensity: parseFloat(e.target.value) } : l))}
                            className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                          />
                        </div>
                        {(light.type === 'point' || light.type === 'directional' || light.type === 'spot' || light.type === 'projector') && (
                          <div className="space-y-1">
                            <div className="flex justify-between text-[8px] text-gray-400 uppercase font-bold">
                              <span>Scale (Size)</span>
                              <span>{(light.scale || 1).toFixed(2)}</span>
                            </div>
                            <input 
                              type="range" min="0.1" max="50" step="0.1"
                              value={light.scale || 1}
                              onChange={(e) => setCustomLights(prev => prev.map(l => l.id === light.id ? { ...l, scale: parseFloat(e.target.value) } : l))}
                              className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                            />
                          </div>
                        )}
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-[8px] text-gray-400 uppercase font-bold">Position (X, Y, Z)</label>
                          <button 
                            onClick={() => setPlacingLightId(placingLightId === light.id ? null : light.id)}
                            className={cn(
                              "px-2 py-0.5 rounded text-[8px] font-bold transition-colors",
                              placingLightId === light.id ? "bg-trimble-blue text-white" : "bg-gray-200 text-gray-600 hover:bg-gray-300"
                            )}
                          >
                            {placingLightId === light.id ? 'Click in Scene' : 'Set Position'}
                          </button>
                        </div>
                        {['X', 'Y', 'Z'].map((axis, i) => (
                          <div key={axis} className="space-y-1">
                            <div className="flex justify-between text-[8px] text-gray-500">
                              <span>{axis}</span>
                              <span>{light.position[i].toFixed(1)}</span>
                            </div>
                            <input 
                              type="range" min="-20" max="20" step="0.5"
                              value={light.position[i]}
                              onChange={(e) => {
                                const newPos = [...light.position] as [number, number, number];
                                newPos[i] = parseFloat(e.target.value);
                                setCustomLights(prev => prev.map(l => l.id === light.id ? { ...l, position: newPos } : l));
                              }}
                              className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                            />
                          </div>
                        ))}
                      </div>

                      {(light.type === 'spot' || light.type === 'projector' || light.type === 'directional') && (
                        <div className="space-y-2">
                          <label className="text-[8px] text-gray-400 uppercase font-bold">Target (X, Y, Z)</label>
                          {['X', 'Y', 'Z'].map((axis, i) => (
                            <div key={axis} className="space-y-1">
                              <div className="flex justify-between text-[8px] text-gray-500">
                                <span>{axis}</span>
                                <span>{(light.target?.[i] || 0).toFixed(1)}</span>
                              </div>
                              <input 
                                type="range" min="-20" max="20" step="0.5"
                                value={light.target?.[i] || 0}
                                onChange={(e) => {
                                  const newTarget = [...(light.target || [0, 0, 0])] as [number, number, number];
                                  newTarget[i] = parseFloat(e.target.value);
                                  setCustomLights(prev => prev.map(l => l.id === light.id ? { ...l, target: newTarget } : l));
                                }}
                                className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                              />
                            </div>
                          ))}
                        </div>
                      )}

                      {(light.type === 'spot' || light.type === 'projector') && (
                        <div className="space-y-2 border-t border-gray-200 dark:border-gray-600 pt-2">
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <div className="flex justify-between text-[8px] text-gray-400 uppercase font-bold">
                                <span>Angle</span>
                                <span>{(light.angle || Math.PI / 3).toFixed(2)}</span>
                              </div>
                              <input 
                                type="range" min="0" max={Math.PI / 2} step="0.01"
                                value={light.angle || Math.PI / 3}
                                onChange={(e) => setCustomLights(prev => prev.map(l => l.id === light.id ? { ...l, angle: parseFloat(e.target.value) } : l))}
                                className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                              />
                            </div>
                            <div className="space-y-1">
                              <div className="flex justify-between text-[8px] text-gray-400 uppercase font-bold">
                                <span>Penumbra</span>
                                <span>{(light.penumbra || 0).toFixed(1)}</span>
                              </div>
                              <input 
                                type="range" min="0" max="1" step="0.1"
                                value={light.penumbra || 0}
                                onChange={(e) => setCustomLights(prev => prev.map(l => l.id === light.id ? { ...l, penumbra: parseFloat(e.target.value) } : l))}
                                className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <div className="flex justify-between text-[8px] text-gray-400 uppercase font-bold">
                                <span>Distance</span>
                                <span>{(light.distance || 0).toFixed(0)}</span>
                              </div>
                              <input 
                                type="range" min="0" max="100" step="1"
                                value={light.distance || 0}
                                onChange={(e) => setCustomLights(prev => prev.map(l => l.id === light.id ? { ...l, distance: parseFloat(e.target.value) } : l))}
                                className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                              />
                            </div>
                            <div className="space-y-1">
                              <div className="flex justify-between text-[8px] text-gray-400 uppercase font-bold">
                                <span>Decay</span>
                                <span>{(light.decay || 2).toFixed(1)}</span>
                              </div>
                              <input 
                                type="range" min="0" max="10" step="0.1"
                                value={light.decay || 2}
                                onChange={(e) => setCustomLights(prev => prev.map(l => l.id === light.id ? { ...l, decay: parseFloat(e.target.value) } : l))}
                                className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                              />
                            </div>
                          </div>
                          {light.type === 'projector' && (
                            <div className="space-y-4">
                              <div className="space-y-1">
                                <label className="text-[8px] text-gray-400 uppercase font-bold">
                                  Projector Map (URL)
                                </label>
                                <input 
                                  type="text"
                                  placeholder="https://..."
                                  value={light.map || ''}
                                  onChange={(e) => setCustomLights(prev => {
                                    return prev.map(l => l.id === light.id ? { ...l, map: e.target.value, projectorMode: 'texture' } : l);
                                  })}
                                  className={cn(
                                    "w-full px-2 py-1 text-[9px] rounded border outline-none",
                                    theme === 'dark' ? "bg-gray-800 border-gray-600 text-white" : "bg-white border-gray-300"
                                  )}
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[8px] text-gray-400 uppercase font-bold text-center block mb-2">Texture Rotation</label>
                                <div className="flex items-center justify-center gap-6">
                                  <label className="flex items-center gap-2 cursor-pointer group">
                                    <div className="relative flex items-center justify-center">
                                      <input 
                                        type="radio"
                                        name={`spin-${light.id}`}
                                        checked={!light.rotateTexture}
                                        onChange={() => setCustomLights(prev => prev.map(l => l.id === light.id ? { ...l, rotateTexture: false } : l))}
                                        className="sr-only"
                                      />
                                      <div className={cn(
                                        "w-4 h-4 rounded-full border-2 transition-all",
                                        !light.rotateTexture ? "border-trimble-blue bg-trimble-blue shadow-[0_0_10px_rgba(0,126,255,0.4)]" : "border-gray-500 group-hover:border-gray-400"
                                      )} />
                                      {!light.rotateTexture && <div className="absolute w-1.5 h-1.5 bg-white rounded-full" />}
                                    </div>
                                    <span className={cn("text-[10px] font-bold uppercase tracking-wider", !light.rotateTexture ? "text-white" : "text-gray-500")}>Static</span>
                                  </label>
                                  <label className="flex items-center gap-2 cursor-pointer group">
                                    <div className="relative flex items-center justify-center">
                                      <input 
                                        type="radio"
                                        name={`spin-${light.id}`}
                                        checked={light.rotateTexture}
                                        onChange={() => setCustomLights(prev => prev.map(l => l.id === light.id ? { ...l, rotateTexture: true } : l))}
                                        className="sr-only"
                                      />
                                      <div className={cn(
                                        "w-4 h-4 rounded-full border-2 transition-all",
                                        light.rotateTexture ? "border-trimble-blue bg-trimble-blue shadow-[0_0_10px_rgba(0,126,255,0.4)]" : "border-gray-500 group-hover:border-gray-400"
                                      )} />
                                      {light.rotateTexture && <div className="absolute w-1.5 h-1.5 bg-white rounded-full" />}
                                    </div>
                                    <span className={cn("text-[10px] font-bold uppercase tracking-wider", light.rotateTexture ? "text-white" : "text-gray-500")}>Spin</span>
                                  </label>
                                </div>
                              </div>
                              {light.rotateTexture && (
                                <div className="space-y-1">
                                  <div className="flex justify-between text-[8px] text-gray-400 uppercase font-bold">
                                    <span>Rotation Speed</span>
                                    <span>{(light.textureRotationSpeed || 1).toFixed(1)}</span>
                                  </div>
                                  <input 
                                    type="range" min="0.1" max="10" step="0.1"
                                    value={light.textureRotationSpeed || 1}
                                    onChange={(e) => setCustomLights(prev => prev.map(l => l.id === light.id ? { ...l, textureRotationSpeed: parseFloat(e.target.value) } : l))}
                                    className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                                  />
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {light.type === 'rect' && (
                        <div className="space-y-2 border-t border-gray-200 dark:border-gray-600 pt-2">
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <div className="flex justify-between text-[8px] text-gray-400 uppercase font-bold">
                                <span>Width</span>
                                <span>{(light.width || 1).toFixed(1)}</span>
                              </div>
                              <input 
                                type="range" min="0.1" max="20" step="0.1"
                                value={light.width || 1}
                                onChange={(e) => setCustomLights(prev => prev.map(l => l.id === light.id ? { ...l, width: parseFloat(e.target.value) } : l))}
                                className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                              />
                            </div>
                            <div className="space-y-1">
                              <div className="flex justify-between text-[8px] text-gray-400 uppercase font-bold">
                                <span>Height</span>
                                <span>{(light.height || 1).toFixed(1)}</span>
                              </div>
                              <input 
                                type="range" min="0.1" max="20" step="0.1"
                                value={light.height || 1}
                                onChange={(e) => setCustomLights(prev => prev.map(l => l.id === light.id ? { ...l, height: parseFloat(e.target.value) } : l))}
                                className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                              />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <div className="flex justify-between text-[8px] text-gray-400 uppercase font-bold">
                              <span>Rotation Y</span>
                              <span>{(light.rotationY || light.rectRotation || 0).toFixed(0)}°</span>
                            </div>
                            <input 
                              type="range" min="0" max="360" step="1"
                              value={light.rotationY || light.rectRotation || 0}
                              onChange={(e) => setCustomLights(prev => prev.map(l => l.id === light.id ? { ...l, rotationY: parseFloat(e.target.value), rectRotation: parseFloat(e.target.value) } : l))}
                              className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                            />
                          </div>

                          <div className="space-y-2 pt-1">
                            <div className="flex items-center justify-between">
                              <span className="text-[8px] font-bold text-gray-400 uppercase">Animate Rotation</span>
                              <button 
                                onClick={() => setCustomLights(prev => prev.map(l => l.id === light.id ? { ...l, animateRotationY: !l.animateRotationY } : l))}
                                className={cn(
                                  "w-6 h-3 rounded-full relative transition-colors",
                                  light.animateRotationY ? "bg-trimble-blue" : "bg-gray-300"
                                )}
                              >
                                <div className={cn(
                                  "absolute top-0.5 w-2 h-2 bg-white rounded-full shadow-sm transition-all",
                                  light.animateRotationY ? "left-3.5" : "left-0.5"
                                )} />
                              </button>
                            </div>
                            {light.animateRotationY && (
                              <div className="space-y-1">
                                <div className="flex justify-between text-[8px] text-gray-400 uppercase font-bold">
                                  <span>Rotation Speed</span>
                                  <span>{(light.rotationYSpeed || 1).toFixed(1)}</span>
                                </div>
                                <input 
                                  type="range" min="0.1" max="10" step="0.1"
                                  value={light.rotationYSpeed || 1}
                                  onChange={(e) => setCustomLights(prev => prev.map(l => l.id === light.id ? { ...l, rotationYSpeed: parseFloat(e.target.value) } : l))}
                                  className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </SubSection>

              <SubSection title="Fog">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-gray-400 uppercase">Enabled</span>
                  <button 
                    onClick={() => setFogSettings({ ...fogSettings, enabled: !fogSettings.enabled })}
                    className={cn(
                      "w-8 h-4 rounded-full relative transition-colors",
                      fogSettings.enabled ? "bg-trimble-blue" : "bg-gray-300"
                    )}
                  >
                    <div className={cn(
                      "absolute top-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-all",
                      fogSettings.enabled ? "left-4.5" : "left-0.5"
                    )} />
                  </button>
                </div>

                {fogSettings.enabled && (
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[10px] font-bold text-gray-400 uppercase">Animate Fog</span>
                    <button 
                      onClick={() => setFogSettings({ ...fogSettings, animate: !fogSettings.animate })}
                      className={cn(
                        "w-8 h-4 rounded-full relative transition-colors",
                        fogSettings.animate ? "bg-trimble-blue" : "bg-gray-300"
                      )}
                    >
                      <div className={cn(
                        "absolute top-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-all",
                        fogSettings.animate ? "left-4.5" : "left-0.5"
                      )} />
                    </button>
                  </div>
                )}

                {fogSettings.enabled && fogSettings.animate && (
                  <div className="space-y-1 pt-1">
                    <div className="flex justify-between text-[10px] text-gray-500 uppercase font-bold">
                      <span>Animation Speed</span>
                      <span>{fogSettings.speed}</span>
                    </div>
                    <input 
                      type="range" min="0" max="100" step="1"
                      value={fogSettings.speed}
                      onChange={(e) => setFogSettings({ ...fogSettings, speed: parseInt(e.target.value) })}
                      className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-trimble-blue" 
                    />
                  </div>
                )}

                {fogSettings.enabled && (
                  <div className="space-y-4 pt-2">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Fog Type</label>
                      <div className="flex bg-gray-100 rounded p-0.5">
                        {['standard', 'super-mega'].map((type) => (
                          <button
                            key={type}
                            onClick={() => setFogSettings({ ...fogSettings, type: type as 'standard' | 'super-mega' })}
                            className={cn(
                              "flex-1 py-1 text-[10px] font-bold rounded transition-all",
                              fogSettings.type === type ? "bg-white shadow-sm text-trimble-blue" : "text-gray-500 hover:text-gray-700"
                            )}
                          >
                            {type === 'standard' ? 'Standard' : 'Super Mega'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {fogSettings.type === 'super-mega' ? (
                      <div className="space-y-4">
                        <div className="space-y-1">
                          <div className="flex justify-between text-[10px] text-gray-500 uppercase font-bold">
                            <span>Mega Density</span>
                            <span>{fogSettings.superMegaDensity.toFixed(3)}</span>
                          </div>
                          <input 
                            type="range" min="0.001" max="0.1" step="0.001"
                            value={fogSettings.superMegaDensity}
                            onChange={(e) => setFogSettings({ ...fogSettings, superMegaDensity: parseFloat(e.target.value) })}
                            className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-trimble-blue" 
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Fog Color</label>
                          <div className="space-y-1">
                            <input 
                              type="color" 
                              value={fogSettings.colors[0]}
                              onChange={(e) => {
                                const newColors = [...fogSettings.colors];
                                newColors[0] = e.target.value;
                                setFogSettings({ ...fogSettings, colors: newColors });
                              }}
                              className="w-full h-8 rounded cursor-pointer border border-gray-200 p-0.5"
                            />
                            <div className="text-[8px] text-gray-400 text-center font-mono">{fogSettings.colors[0].toUpperCase()}</div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Complexity</label>
                          <div className="flex bg-gray-100 rounded p-0.5">
                            {[1, 2, 3].map((count) => (
                              <button
                                key={count}
                                onClick={() => setFogSettings({ ...fogSettings, colorCount: count as 1 | 2 | 3 })}
                                className={cn(
                                  "flex-1 py-1 text-[10px] font-bold rounded transition-all",
                                  fogSettings.colorCount === count ? "bg-white shadow-sm text-trimble-blue" : "text-gray-500 hover:text-gray-700"
                                )}
                              >
                                {count} Color{count > 1 ? 's' : ''}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Styling</label>
                          <div className="grid grid-cols-3 gap-2">
                            {Array.from({ length: fogSettings.colorCount }).map((_, i) => (
                              <div key={i} className="space-y-1">
                                <input 
                                  type="color" 
                                  value={fogSettings.colors[i]}
                                  onChange={(e) => {
                                    const newColors = [...fogSettings.colors];
                                    newColors[i] = e.target.value;
                                    setFogSettings({ ...fogSettings, colors: newColors });
                                  }}
                                  className="w-full h-8 rounded cursor-pointer border border-gray-200 p-0.5"
                                />
                                <div className="text-[8px] text-gray-400 text-center font-mono">{fogSettings.colors[i].toUpperCase()}</div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-3">
                          <div className="space-y-1">
                            <div className="flex justify-between text-[10px] text-gray-500 uppercase font-bold">
                              <span>Density</span>
                              <span>{fogSettings.density.toFixed(3)}</span>
                            </div>
                            <input 
                              type="range" min="0.001" max="0.1" step="0.001"
                              value={fogSettings.density}
                              onChange={(e) => setFogSettings({ ...fogSettings, density: parseFloat(e.target.value) })}
                              className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-trimble-blue" 
                            />
                          </div>
                          <div className="space-y-1">
                            <div className="flex justify-between text-[10px] text-gray-500 uppercase font-bold">
                              <span>Height (Start)</span>
                              <span>{fogSettings.height.toFixed(1)}</span>
                            </div>
                            <input 
                              type="range" min="-10" max="10" step="0.5"
                              value={fogSettings.height}
                              onChange={(e) => setFogSettings({ ...fogSettings, height: parseFloat(e.target.value) })}
                              className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-trimble-blue" 
                            />
                          </div>
                          <div className="space-y-1">
                            <div className="flex justify-between text-[10px] text-gray-500 uppercase font-bold">
                              <span>Height (End)</span>
                              <span>{fogSettings.heightEnd.toFixed(1)}</span>
                            </div>
                            <input 
                              type="range" min="-10" max="50" step="0.5"
                              value={fogSettings.heightEnd}
                              onChange={(e) => setFogSettings({ ...fogSettings, heightEnd: parseFloat(e.target.value) })}
                              className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-trimble-blue" 
                            />
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </SubSection>

              <SubSection title="Animations">
                <div className="space-y-4">
                  <button 
                    onClick={() => {
                      const id = Math.random().toString(36).substr(2, 9);
                      const newAnim: SceneAnimation = {
                        id,
                        type: 'confetti',
                        position: [0, 0, 0],
                        density: 1000,
                        scale: 1,
                        looping: true,
                        playing: true
                      };
                      setAnimations([...animations, newAnim]);
                      setPlacingAnimationId(id);
                      setActiveTool('select');
                    }}
                    className="w-full flex items-center justify-center gap-2 py-2 bg-trimble-blue text-white rounded-md text-[10px] font-bold uppercase transition-all hover:bg-trimble-dark-blue shadow-sm"
                  >
                    <Plus size={14} />
                    Add Animation
                  </button>

                  <div className="space-y-3">
                    {animations.map((anim) => (
                      <div 
                        key={anim.id}
                        className={cn(
                          "p-3 rounded-lg border space-y-3 transition-all",
                          theme === 'dark' ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200 shadow-sm"
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-gray-500 uppercase">{anim.type.replace('_', ' ')}</span>
                          <button 
                            onClick={() => setAnimations(prev => prev.filter(a => a.id !== anim.id))}
                            className="p-1 hover:bg-red-50 text-red-400 hover:text-red-500 rounded transition-colors"
                          >
                            <X size={12} />
                          </button>
                        </div>

                        <div className="space-y-2">
                          <label className="text-[8px] text-gray-400 uppercase font-bold">Effect Type</label>
                          <div className="grid grid-cols-2 gap-1 px-1">
                            {['confetti', 'fire', 'smoke', 'sparks', 'magic_aura'].map((type) => (
                              <button
                                key={type}
                                onClick={() => setAnimations(prev => prev.map(a => a.id === anim.id ? { ...a, type: type as any } : a))}
                                className={cn(
                                  "py-1 text-[8px] font-bold rounded border transition-all truncate px-1",
                                  anim.type === type 
                                    ? "bg-trimble-blue text-white border-trimble-blue" 
                                    : "bg-transparent text-gray-500 border-gray-200 hover:border-gray-300 dark:border-gray-600"
                                )}
                              >
                                {type.split('_').join(' ').toUpperCase()}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between text-[8px] text-gray-400 uppercase font-bold">
                            <span>Density</span>
                            <span>{anim.density}</span>
                          </div>
                          <input 
                            type="range" min="100" max="5000" step="100"
                            value={anim.density}
                            onChange={(e) => setAnimations(prev => prev.map(a => a.id === anim.id ? { ...a, density: parseInt(e.target.value) } : a))}
                            className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                          />
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between text-[8px] text-gray-400 uppercase font-bold">
                            <span>Scale (Size)</span>
                            <span>{(anim.scale || 1).toFixed(1)}</span>
                          </div>
                          <input 
                            type="range" min="0.1" max="100" step="0.1"
                            value={anim.scale || 1}
                            onChange={(e) => setAnimations(prev => prev.map(a => a.id === anim.id ? { ...a, scale: parseFloat(e.target.value) } : a))}
                            className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                          />
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-[8px] font-bold text-gray-400 uppercase">Loop Effect</span>
                            <button 
                              onClick={() => setAnimations(prev => prev.map(a => a.id === anim.id ? { ...a, looping: !a.looping } : a))}
                              className={cn(
                                "w-6 h-3 rounded-full relative transition-colors",
                                anim.looping ? "bg-trimble-blue" : "bg-gray-300"
                              )}
                            >
                              <div className={cn(
                                "absolute top-0.5 w-2 h-2 bg-white rounded-full shadow-sm transition-all",
                                anim.looping ? "left-3.5" : "left-0.5"
                              )} />
                            </button>
                          </div>
                          <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700 rounded p-0.5">
                            <button
                              onClick={() => setAnimations(prev => prev.map(a => a.id === anim.id ? { ...a, playing: true } : a))}
                              className={cn(
                                "px-2 py-0.5 text-[8px] font-bold rounded transition-all",
                                anim.playing ? "bg-white dark:bg-gray-600 text-green-500 shadow-sm" : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                              )}
                            >
                              PLAY
                            </button>
                            <button
                              onClick={() => setAnimations(prev => prev.map(a => a.id === anim.id ? { ...a, playing: false } : a))}
                              className={cn(
                                "px-2 py-0.5 text-[8px] font-bold rounded transition-all",
                                !anim.playing ? "bg-white dark:bg-gray-600 text-red-500 shadow-sm" : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                              )}
                            >
                              STOP
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-1">
                          <span className="text-[8px] text-gray-400 font-bold uppercase">Position</span>
                          <button 
                            onClick={() => setPlacingAnimationId(placingAnimationId === anim.id ? null : anim.id)}
                            className={cn(
                              "px-2 py-0.5 rounded text-[8px] font-bold transition-colors",
                              placingAnimationId === anim.id ? "bg-trimble-blue text-white" : "bg-gray-200 text-gray-600 hover:bg-gray-300"
                            )}
                          >
                            {placingAnimationId === anim.id ? 'Click in Scene' : 'Set Position'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </SubSection>

              <SubSection title="Scene Helpers">
                <div className="flex items-center justify-between">
                  <span>3D Space Grid</span>
                  <button 
                    onClick={() => setGridEnabled(!gridEnabled)}
                    className={cn(
                      "w-8 h-4 rounded-full relative transition-colors",
                      gridEnabled ? "bg-trimble-blue" : "bg-gray-300"
                    )}
                  >
                    <div className={cn(
                      "absolute top-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-all",
                      gridEnabled ? "left-4.5" : "left-0.5"
                    )} />
                  </button>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span>Scene Floor</span>
                    <button 
                      onClick={() => {
                        const nextEnabled = !floorEnabled;
                        setFloorEnabled(nextEnabled);
                        if (nextEnabled && (!floorColor || floorColor === '#ffffff')) {
                          setFloorColor('#000000');
                        }
                      }}
                      className={cn(
                        "w-8 h-4 rounded-full relative transition-colors",
                        floorEnabled ? "bg-trimble-blue" : "bg-gray-300"
                      )}
                    >
                      <div className={cn(
                        "absolute top-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-all",
                        floorEnabled ? "left-4.5" : "left-0.5"
                      )} />
                    </button>
                  </div>
                  {floorEnabled && (
                    <div className="flex items-center justify-between pl-2">
                      <span className="text-[10px] text-gray-500 uppercase font-bold">Floor Color</span>
                      <input 
                        type="color" 
                        value={floorColor}
                        onChange={(e) => setFloorColor(e.target.value)}
                        className="w-6 h-6 rounded cursor-pointer border border-gray-200 p-0.5"
                      />
                    </div>
                  )}
                </div>
              </SubSection>
            </div>
          </Panel>
        )}

        {panelVisibility['components'] !== false && (
          <Panel 
            id="components" 
            title="Components" 
            icon={<BoxSelect size={16} />} 
            isOpen={openPanels.includes('components')}
            onToggle={() => togglePanel('components')}
          >
            <div className="relative">
              <input 
                type="text" 
                placeholder="Search 3D Warehouse..." 
                value={warehouseSearch}
                onChange={(e) => setWarehouseSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-trimble-blue focus:border-trimble-blue outline-none"
              />
              <Search size={14} className="absolute left-2.5 top-2 text-gray-400" />
            </div>
          </Panel>
        )}

        {panelVisibility['collaboration'] !== false && (
          <Panel 
            id="collaboration" 
            title="Collaboration" 
            icon={<Users size={16} />} 
            isOpen={openPanels.includes('collaboration')}
            onToggle={() => togglePanel('collaboration')}
          >
            <div className="space-y-4">
              {collaborators.length > 0 && (
                <button 
                  onClick={() => {
                    const newState = !isMessagingOpen;
                    setIsMessagingOpen(newState);
                    diagLog('UI', `Messaging ${newState ? 'opened' : 'closed'}`);
                    if (!currentModelId && newState) {
                      alert('Messaging requires a saved project. Please save your design first.');
                      setIsMessagingOpen(false);
                    }
                    if (isMessagingDocked && newState && !openPanels.includes('messaging')) {
                      togglePanel('messaging');
                    }
                  }}
                  className={cn(
                    "w-full py-2 border rounded-lg text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all",
                    isMessagingOpen 
                      ? "bg-trimble-blue text-white border-trimble-blue shadow-md" 
                      : (theme === 'dark' ? "bg-gray-900 border-gray-700 text-gray-300 hover:bg-gray-800" : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50")
                  )}
                >
                  <MessageSquare size={14} />
                  {isMessagingOpen ? 'Close' : 'Open'} Project Messaging
                </button>
              )}

              <div className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-100 dark:border-gray-800">
                <div className="flex items-center gap-2">
                  <Eye size={14} className="text-gray-400" />
                  <span className="text-[10px] font-bold text-gray-400 uppercase">Show Cursors</span>
                </div>
                <button 
                  onClick={() => setShowCollaboratorCursors(!showCollaboratorCursors)}
                  className={cn(
                    "w-8 h-4 rounded-full relative transition-colors",
                    showCollaboratorCursors ? "bg-trimble-blue" : "bg-gray-300"
                  )}
                >
                  <div className={cn(
                    "absolute top-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-all",
                    showCollaboratorCursors ? "left-4.5" : "left-0.5"
                  )} />
                </button>
              </div>

              <button 
                onClick={() => {
                  if (!currentModelId) {
                    alert('Please save your design first before generating an invite link.');
                    return;
                  }
                  const url = `${window.location.origin}${window.location.pathname}?join=${currentModelId}`;
                  navigator.clipboard.writeText(url);
                  alert('Invite link copied to clipboard!');
                }}
                className="w-full py-1.5 bg-trimble-blue text-white rounded text-[10px] font-bold uppercase tracking-wider hover:bg-trimble-blue-dark transition-colors flex items-center justify-center gap-2"
              >
                <Plus size={14} />
                Generate Invite Link
              </button>

              <div className="flex gap-1">
                <input 
                  type="email"
                  id="invite-email"
                  placeholder="Invite by email..."
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="flex-1 px-2 py-1.5 bg-white border border-gray-200 rounded text-[10px] outline-none focus:border-trimble-blue shadow-inner"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleInvite(inviteEmail);
                      setInviteEmail('');
                    }
                  }}
                />
                <button 
                  onClick={() => {
                    if (inviteEmail) {
                      handleInvite(inviteEmail);
                      setInviteEmail('');
                    }
                  }}
                  className="px-2 py-1 bg-trimble-blue text-white rounded text-[9px] font-bold uppercase hover:bg-trimble-blue-dark transition-colors"
                >
                  Invite
                </button>
              </div>

              <div className="space-y-2 pb-2">
                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100 pb-1">Active Users</div>
                <div className="space-y-1.5 max-h-[120px] overflow-y-auto pr-1">
                  <div className="flex items-center justify-between p-1.5 hover:bg-gray-50 rounded transition-all">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-trimble-blue/10 flex items-center justify-center text-[10px] font-bold text-trimble-blue border border-trimble-blue/20">
                        {user?.displayName?.[0] || user?.email?.[0] || 'U'}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] font-medium leading-none">{user?.displayName || 'You'}</span>
                        <span className="text-[8px] text-gray-400">Owner</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                      <Crown size={12} className="text-amber-500" />
                    </div>
                  </div>
                  {collaborators.map((collab: any, idx: number) => (
                    <div key={collab.id || collab.uid || `collab-${idx}`} className="flex items-center justify-between p-1.5 hover:bg-gray-50 rounded transition-all group">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-[10px] font-bold text-gray-500 border border-gray-200 overflow-hidden">
                          {collab.photoURL ? <img src={collab.photoURL} alt="" /> : (collab.displayName?.[0] || collab.email?.[0])}
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[10px] font-medium leading-none">{collab.displayName || collab.email.split('@')[0]}</span>
                          <span className="text-[8px] text-gray-400 capitalize">{collab.role}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {isModelOwner && collab.role !== 'owner' && (
                          <button 
                            onClick={() => handleRevokeCollab(collab.id)}
                            className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700 transition-all"
                            title="Revoke access"
                          >
                            <X size={12} />
                          </button>
                        )}
                        <div className={cn(
                          "w-1.5 h-1.5 rounded-full",
                          collab.status === 'active' ? 'bg-green-500' : 'bg-gray-300'
                        )} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </Panel>
        )}

        {isToolModifierDocked && hasSettings && (
          <Panel 
            id="toolModifiers" 
            title="Tool Modifiers" 
            icon={<Settings size={16} />} 
            isOpen={openPanels.includes('toolModifiers')}
            onToggle={() => togglePanel('toolModifiers')}
          >
            <ToolModifierPalette />
          </Panel>
        )}

        {isMessagingDocked && isMessagingOpen && (
          <Panel 
            id="messaging" 
            title="Project Messaging" 
            icon={<MessageSquare size={16} />} 
            isOpen={openPanels.includes('messaging')}
            onToggle={() => togglePanel('messaging')}
          >
            <div className="h-[400px]">
              <Messaging />
            </div>
          </Panel>
        )}

        {panelVisibility['notes'] !== false && (
          <Panel 
            id="notes" 
            title="Notes" 
            icon={<StickyNote size={16} />} 
            isOpen={openPanels.includes('notes')}
            onToggle={() => togglePanel('notes')}
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between mb-1">
                <button 
                  onClick={() => setActiveTool('note')}
                  className={cn(
                    "flex-1 mr-2 py-1.5 border border-dashed rounded text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2",
                    activeTool === 'note' 
                      ? "bg-trimble-blue text-white border-trimble-blue shadow-md" 
                      : "border-gray-300 text-gray-500 hover:border-trimble-blue hover:text-trimble-blue hover:bg-gray-50"
                  )}
                >
                  <Plus size={14} />
                  Add New Note
                </button>
                <button 
                  onClick={() => setAllNotesVisible(!allNotesVisible)}
                  className={cn(
                    "p-1.5 rounded border transition-all flex items-center justify-center",
                    allNotesVisible 
                      ? "bg-trimble-blue/10 border-trimble-blue text-trimble-blue" 
                      : "bg-gray-50 border-gray-200 text-gray-400"
                  )}
                  title={allNotesVisible ? "Hide All Notes in 3D" : "Show All Notes in 3D"}
                >
                  {allNotesVisible ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
              </div>

              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                {notes.map(note => (
                  <div 
                    key={note.id} 
                    className={cn(
                      "p-2.5 rounded-lg border flex flex-col gap-2 transition-all hover:shadow-sm",
                      note.completed 
                        ? "bg-gray-50 border-gray-100 opacity-70" 
                        : "bg-white border-gray-200"
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="text-[8px] font-bold text-trimble-blue uppercase truncate">{note.authorName}</span>
                        <p className={cn(
                          "text-[10px] leading-relaxed",
                          note.completed && "line-through text-gray-400"
                        )}>{note.text}</p>
                      </div>
                      <div className="flex gap-1 shrink-0 ml-2">
                        <button 
                          onClick={() => setNotes(prev => prev.map(n => n.id === note.id ? { ...n, visible: n.visible === false ? true : false } : n))}
                          className={cn(
                            "p-1 rounded transition-colors",
                            note.visible !== false ? "text-trimble-blue hover:bg-trimble-blue/5" : "text-gray-300 hover:text-trimble-blue hover:bg-gray-50"
                          )}
                          title={note.visible !== false ? "Hide in 3D" : "Show in 3D"}
                        >
                          {note.visible !== false ? <Eye size={14} /> : <EyeOff size={14} />}
                        </button>
                        <button 
                          onClick={() => setNotes(prev => prev.map(n => n.id === note.id ? { ...n, completed: !n.completed, completedAt: !n.completed ? Date.now() : undefined, completedBy: !n.completed ? user?.displayName : undefined } : n))}
                          className={cn(
                            "p-1 rounded transition-colors",
                            note.completed
                              ? "text-emerald-600 bg-emerald-50"
                              : "text-emerald-600/50 hover:text-emerald-700"
                          )}
                        >
                          <CheckCircle2 size={14} />
                        </button>
                        <button 
                          onClick={() => setNotes(prev => prev.filter(n => n.id !== note.id))}
                          className="p-1 text-red-400/70 hover:text-red-700 rounded transition-colors"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between pt-1 border-t border-gray-50">
                       <span className="text-[8px] text-gray-400">
                        {safelyToDate(note.createdAt).toLocaleDateString()}
                       </span>
                       <button 
                        onClick={() => window.dispatchEvent(new CustomEvent('set-camera', { detail: { position: [note.position.x + 10, note.position.y + 8, note.position.z + 10], target: [note.position.x, note.position.y, note.position.z] } }))}
                        className="text-[8px] font-bold text-trimble-blue hover:underline uppercase"
                       >
                        Go to Entity
                       </button>
                    </div>
                  </div>
                ))}
                {notes.length === 0 && (
                  <div className="text-center py-8 px-4 text-gray-400 text-[10px] bg-gray-50 rounded-lg border border-dashed border-gray-200 flex flex-col items-center gap-2">
                    <StickyNote size={16} className="text-gray-300" />
                    <span>No notes yet. Click <span className="font-bold text-gray-500">Add New Note</span>, then click a spot on the model.</span>
                  </div>
                )}
              </div>
            </div>
          </Panel>
        )}
      </div>

      {/* Add Material Modal */}
      <AnimatePresence>
        {isAddMaterialOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-xl shadow-modus-4 w-full max-w-md overflow-hidden flex flex-col"
            >
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <h2 className="text-lg font-bold text-gray-800">Add Material</h2>
                <button onClick={() => setIsAddMaterialOpen(false)} className="p-1 hover:bg-gray-100 rounded-full transition-colors">
                  <X size={20} className="text-gray-500" />
                </button>
              </div>

              <div className="flex border-b border-gray-100">
                <button 
                  onClick={() => setActiveTab('color')}
                  className={cn(
                    "flex-1 py-3 text-sm font-medium transition-colors",
                    activeTab === 'color' ? "text-trimble-blue border-b-2 border-trimble-blue" : "text-gray-500 hover:text-gray-700"
                  )}
                >
                  Color Picker
                </button>
                <button 
                  onClick={() => setActiveTab('texture')}
                  className={cn(
                    "flex-1 py-3 text-sm font-medium transition-colors",
                    activeTab === 'texture' ? "text-trimble-blue border-b-2 border-trimble-blue" : "text-gray-500 hover:text-gray-700"
                  )}
                >
                  Upload Texture
                </button>
                <button 
                  onClick={() => setActiveTab('premade')}
                  className={cn(
                    "flex-1 py-3 text-sm font-medium transition-colors",
                    activeTab === 'premade' ? "text-trimble-blue border-b-2 border-trimble-blue" : "text-gray-500 hover:text-gray-700"
                  )}
                >
                  Pre-Made PBRs
                </button>
                <button 
                  onClick={() => setActiveTab('ai')}
                  className={cn(
                    "flex-1 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-1",
                    activeTab === 'ai' ? "text-trimble-blue border-b-2 border-trimble-blue" : "text-gray-500 hover:text-gray-700"
                  )}
                >
                  <Wand2 size={14} />
                  AI Generate
                </button>
              </div>

              <div className="p-6 overflow-y-auto max-h-[60vh]">
                {activeTab === 'color' ? (
                  <div className="space-y-6">
                    <div className="flex flex-col items-center gap-4">
                      <input 
                        type="color" 
                        value={newColor}
                        onChange={(e) => setNewColor(e.target.value)}
                        className="w-32 h-32 rounded-lg cursor-pointer border-4 border-gray-100 shadow-inner"
                      />
                      <div className="text-xl font-mono font-bold text-gray-700">{newColor.toUpperCase()}</div>
                    </div>

                    <div className="space-y-4 pt-4 border-t border-gray-100">
                      <div className="flex items-center gap-2">
                        <Settings2 size={16} className="text-gray-400" />
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">PBR Settings</label>
                      </div>
                      <PBRControls settings={pbrSettings} onChange={setPbrSettings} />
                    </div>

                    <button 
                      onClick={handleAddColor}
                      className="w-full py-3 bg-trimble-blue text-white rounded-lg font-semibold hover:bg-trimble-dark-blue transition-all"
                    >
                      Add to Palette
                    </button>
                  </div>
                ) : activeTab === 'texture' ? (
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Texture File</label>
                      <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                        <div className="flex flex-col items-center justify-center pt-5 pb-6">
                          <Upload className="w-8 h-8 mb-3 text-gray-400" />
                          <p className="mb-2 text-sm text-gray-500 font-medium">Click to upload texture</p>
                          <p className="text-xs text-gray-400">PNG, JPG or WEBP</p>
                        </div>
                        <input type="file" className="hidden" accept="image/*" onChange={handleTextureUpload} disabled={uploading} />
                      </label>
                      <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer pt-1">
                        <input
                          type="checkbox"
                          checked={removeBgEnabled}
                          onChange={(e) => setRemoveBgEnabled(e.target.checked)}
                          className="rounded border-gray-300"
                        />
                        <ImageOff size={14} className="text-gray-400" />
                        <span>Remove background with AI (Hugging Face)</span>
                      </label>
                      {removingBg && (
                        <div className="flex items-center gap-2 text-trimble-blue text-xs">
                          <Loader2 className="animate-spin" size={14} />
                          <span>Removing background&hellip;</span>
                        </div>
                      )}
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <Settings2 size={16} className="text-gray-400" />
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">PBR Settings</label>
                      </div>
                      <PBRControls settings={pbrSettings} onChange={setPbrSettings} />
                    </div>

                    {uploading && (
                      <div className="flex items-center justify-center gap-2 text-trimble-blue">
                        <Loader2 className="animate-spin" size={18} />
                        <span className="text-sm font-medium">Uploading...</span>
                      </div>
                    )}
                  </div>
                ) : activeTab === 'premade' ? (
                  <div className="grid grid-cols-2 gap-4">
                    {premadeMaterials.map((mat: any, i: number) => (
                      <div 
                        key={mat.id || `premade-${mat.name || i}-${i}`}
                        onClick={() => {
                          setActiveMaterial(mat.texture || mat.color);
                          if (mat.color) setNewColor(mat.color);
                          setActiveTool('paint');
                          const newPbr = {
                            roughness: mat.roughness !== undefined ? mat.roughness : 0.5,
                            metalness: mat.metalness !== undefined ? mat.metalness : 0,
                            opacity: mat.opacity !== undefined ? mat.opacity : 1
                          };
                          setActivePBR(newPbr);
                          setPbrSettings(newPbr);
                          setIsAddMaterialOpen(false);
                        }}
                        className="group border border-gray-100 rounded-lg overflow-hidden cursor-pointer hover:border-trimble-blue transition-all"
                      >
                        <div className="aspect-square bg-gray-100 relative">
                          <img
                            src={mat.texture}
                            alt={mat.name}
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <Plus size={24} className="text-white" />
                          </div>
                        </div>
                        <div className="p-2">
                          <div className="text-[10px] font-bold truncate">{mat.name}</div>
                          <div className="text-[8px] text-gray-400">PBR Ready</div>
                        </div>
                      </div>
                    ))}
                    {premadeMaterials.length === 0 && (
                      <div className="col-span-2 py-12 text-center text-gray-400">
                        <Loader2 size={24} className="animate-spin mx-auto mb-2" />
                        <span>Loading PBR library...</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                        <KeyRound size={12} />
                        Hugging Face API Token
                      </label>
                      <input
                        type="password"
                        value={hfToken}
                        onChange={(e) => setHfToken(e.target.value)}
                        placeholder="hf_..."
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-trimble-blue/30"
                      />
                      <p className="text-[11px] text-gray-400">
                        Free at huggingface.co/settings/tokens. Used for AI material generation, background removal, and Photo to 3D. Stored only in your browser.
                      </p>
                    </div>

                    <div className="space-y-2 pt-2 border-t border-gray-100">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Describe the material</label>
                      <textarea
                        value={aiPrompt}
                        onChange={(e) => setAiPrompt(e.target.value)}
                        placeholder="e.g. weathered oak planks, brushed titanium, cracked red brick"
                        rows={3}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-trimble-blue/30"
                      />
                    </div>

                    <button
                      onClick={handleGenerateAIMaterial}
                      disabled={aiGenerating || !aiPrompt.trim()}
                      className="w-full py-3 bg-trimble-blue text-white rounded-lg font-semibold hover:bg-trimble-dark-blue transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {aiGenerating ? (
                        <>
                          <Loader2 className="animate-spin" size={18} />
                          Generating&hellip;
                        </>
                      ) : (
                        <>
                          <Sparkles size={18} />
                          Generate Material
                        </>
                      )}
                    </button>

                    {aiError && (
                      <div className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg p-2">{aiError}</div>
                    )}

                    {aiPreviewUrl && (
                      <div className="space-y-4 pt-2 border-t border-gray-100">
                        <div className="aspect-square w-32 mx-auto rounded-lg overflow-hidden border-4 border-gray-100 shadow-inner">
                          <img src={aiPreviewUrl} alt="AI generated material" className="w-full h-full object-cover" />
                        </div>
                        <div className="space-y-4">
                          <div className="flex items-center gap-2">
                            <Settings2 size={16} className="text-gray-400" />
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">PBR Settings</label>
                          </div>
                          <PBRControls settings={pbrSettings} onChange={setPbrSettings} />
                        </div>
                        <button
                          onClick={handleAddAIMaterial}
                          className="w-full py-3 bg-trimble-blue text-white rounded-lg font-semibold hover:bg-trimble-dark-blue transition-all"
                        >
                          Add to Palette
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
        <Panel 
          id="shortcuts" 
          title="Keyboard Shortcuts" 
          icon={<PenTool size={16} />} 
          isOpen={openPanels.includes('shortcuts')}
          onToggle={() => togglePanel('shortcuts')}
        >
          <div className="space-y-2">
            <div className="flex justify-between items-center py-1 border-b border-gray-100 last:border-0">
              <span className="text-gray-500">Select</span>
              <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[10px] font-mono">Space</kbd>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-gray-100 last:border-0">
              <span className="text-gray-500">Eraser</span>
              <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[10px] font-mono">E</kbd>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-gray-100 last:border-0">
              <span className="text-gray-500">Paint</span>
              <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[10px] font-mono">B</kbd>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-gray-100 last:border-0">
              <span className="text-gray-500">Rectangle</span>
              <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[10px] font-mono">R</kbd>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-gray-100 last:border-0">
              <span className="text-gray-500">Circle</span>
              <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[10px] font-mono">C</kbd>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-gray-100 last:border-0">
              <span className="text-gray-500">Line</span>
              <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[10px] font-mono">L</kbd>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-gray-100 last:border-0">
              <span className="text-gray-500">Push/Pull</span>
              <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[10px] font-mono">P</kbd>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-gray-100 last:border-0">
              <span className="text-gray-500">Move</span>
              <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[10px] font-mono">M</kbd>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-gray-100 last:border-0">
              <span className="text-gray-500">Rotate</span>
              <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[10px] font-mono">Q</kbd>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-gray-100 last:border-0">
              <span className="text-gray-500">Scale</span>
              <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[10px] font-mono">S</kbd>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-gray-100 last:border-0">
              <span className="text-gray-500">Orbit</span>
              <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[10px] font-mono">O</kbd>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-gray-100 last:border-0">
              <span className="text-gray-500">Pan</span>
              <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[10px] font-mono">H</kbd>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-gray-100 last:border-0">
              <span className="text-gray-500">Note Tool</span>
              <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[10px] font-mono">N</kbd>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-gray-100 last:border-0">
              <span className="text-gray-500">Deform</span>
              <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[10px] font-mono">D</kbd>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-gray-100 last:border-0">
              <span className="text-gray-500">Subtract</span>
              <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[10px] font-mono">X</kbd>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-gray-100 last:border-0">
              <span className="text-gray-500">Zoom</span>
              <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[10px] font-mono">Z</kbd>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-gray-100 last:border-0">
              <span className="text-gray-500">Undo</span>
              <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[10px] font-mono">Ctrl+Z</kbd>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-gray-100 last:border-0">
              <span className="text-gray-500">Redo</span>
              <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[10px] font-mono">Ctrl+Y</kbd>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-gray-100 last:border-0">
              <span className="text-gray-500">Axis Lock</span>
              <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[10px] font-mono">X / Y / Z</kbd>
            </div>
          </div>
        </Panel>
      </AnimatePresence>
    </aside>
  );
}

function PBRControls({ settings, onChange }: { settings: any, onChange: (s: any) => void }) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="flex justify-between text-[10px] text-gray-500">
          <span>Roughness</span>
          <span>{settings.roughness}</span>
        </div>
        <input 
          type="range" min="0" max="1" step="0.01" 
          value={settings.roughness}
          onChange={(e) => onChange({...settings, roughness: parseFloat(e.target.value)})}
          className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-trimble-blue" 
        />
      </div>
      <div className="space-y-1">
        <div className="flex justify-between text-[10px] text-gray-500">
          <span>Metalness</span>
          <span>{settings.metalness}</span>
        </div>
        <input 
          type="range" min="0" max="1" step="0.01" 
          value={settings.metalness}
          onChange={(e) => onChange({...settings, metalness: parseFloat(e.target.value)})}
          className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-trimble-blue" 
        />
      </div>
      <div className="space-y-1">
        <div className="flex justify-between text-[10px] text-gray-500">
          <span>Opacity</span>
          <span>{settings.opacity}</span>
        </div>
        <input 
          type="range" min="0" max="1" step="0.01" 
          value={settings.opacity}
          onChange={(e) => onChange({...settings, opacity: parseFloat(e.target.value)})}
          className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-trimble-blue" 
        />
      </div>
    </div>
  );
}

function Loader2({ className, size }: { className?: string, size?: number }) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      width={size || 24} 
      height={size || 24} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
    </svg>
  );
}

function SearchIcon({ size, className }: { size: number, className?: string }) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
    >
      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
    </svg>
  );
}


