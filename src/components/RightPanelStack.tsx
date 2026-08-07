import React, { useState, useEffect, useRef } from 'react';
import { 
  Info, 
  Layers, 
  Palette, 
  Clapperboard, 
  Sun, 
  BoxSelect,
  ChevronRight,
  ChevronDown,
  ListTree,
  PenTool,
  Plus,
  Upload,
  X,
  Settings2,
  Search,
  Users,
  MessageSquare,
  StickyNote,
  Send,
  CheckCircle2,
  Circle as CircleIcon,
  Crown,
  Sparkles,
  Eye,
  EyeOff,  Trash2,
  Settings
} from 'lucide-react';
import { cn, safelyToDate } from '../lib/utils';
import { useApp } from '../AppContext';
import { ToolModifierPalette } from './ToolModifierPalette';
import Messaging from './Messaging';
import { SceneAnimation, ChatMessage, Collaborator } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { storage, db, handleFirestoreError, OperationType } from '../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { collection, addDoc, serverTimestamp, onSnapshot, query, where, doc, getDoc, deleteDoc, setDoc } from 'firebase/firestore';

const COLORS = [
  '#ffffff', '#ef4444', '#f97316', '#f59e0b', 
  '#eab308', '#84cc16', '#22c55e', '#10b981',
  '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6',
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
  '#ec4899', '#f43f5e', '#71717a', '#18181b'
];

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
    setShapes,
    removeShape,
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
    lightPosition,
    setLightPosition,
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
    refreshMaterials
  } = useApp();

  useEffect(() => {
    if (!fogSettings.enabled && fogSettings.animate) {
      setFogSettings(prev => ({ ...prev, animate: false }));
    }
  }, [fogSettings.enabled, fogSettings.animate, setFogSettings]);
  
  const [openPanels, setOpenPanels] = useState<string[]>([]);
  const [isAddMaterialOpen, setIsAddMaterialOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'color' | 'texture' | 'premade'>('color');
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
      // Use local curated list to avoid CORS/reliability issues with external APIs
      setPremadeMaterials([{ name: 'Aluminum', roughness: 0.1, metalness: 1.0, color: '#EBEDEE' }, { name: 'Aluminum (Anodized Red)', roughness: 0.2, metalness: 1.0, color: '#990000' }, { name: 'Amber', roughness: 0.05, metalness: 0.0, color: '#D44A09' }, { name: 'Asphalt (Fresh)', roughness: 0.8, metalness: 0.0, color: '#0B0A0A' }, { name: 'Banana', roughness: 0.6, metalness: 0.0, color: '#A28B1C' }, { name: 'Beryllium', roughness: 0.1, metalness: 1.0, color: '#898788' }, { name: 'Blackboard', roughness: 0.9, metalness: 0.0, color: '#0A0A0A' }, { name: 'Blood', roughness: 0.3, metalness: 0.0, color: '#A40101' }, { name: 'Polished Steel', roughness: 0.05, metalness: 1.0, color: '#c0c0c0' }, { name: 'Gold', roughness: 0.1, metalness: 1.0, color: '#ffd700' }, { name: 'Copper', roughness: 0.2, metalness: 1.0, color: '#b87333' }, { name: 'Rubber', roughness: 0.9, metalness: 0.0, color: '#222222' }, { name: 'Plastic', roughness: 0.3, metalness: 0.0, color: '#ffffff' }, { name: 'Glass', roughness: 0.01, metalness: 0.0, color: '#ffffff', opacity: 0.3 }, { name: 'Wood (Oak)', roughness: 0.7, metalness: 0.0, color: '#7b5c3d' }, { name: 'Concrete', roughness: 0.85, metalness: 0.0, color: '#9ca3af' }, { name: 'Brass', roughness: 0.25, metalness: 1.0, color: '#B5A642' }, { name: 'Bronze', roughness: 0.3, metalness: 1.0, color: '#CD7F32' }, { name: 'Chrome', roughness: 0.05, metalness: 1.0, color: '#C4C4C4' }, { name: 'Titanium', roughness: 0.35, metalness: 1.0, color: '#878681' }, { name: 'Silver', roughness: 0.1, metalness: 1.0, color: '#C0C0C0' }, { name: 'Tin', roughness: 0.4, metalness: 1.0, color: '#D9D9D9' }, { name: 'Rusted Iron', roughness: 0.85, metalness: 0.6, color: '#8B4513' }, { name: 'Stainless Steel', roughness: 0.2, metalness: 1.0, color: '#B7C3C9' }, { name: 'Walnut', roughness: 0.65, metalness: 0.0, color: '#5C4033' }, { name: 'Pine', roughness: 0.7, metalness: 0.0, color: '#DEB887' }, { name: 'Mahogany', roughness: 0.6, metalness: 0.0, color: '#4E2A1E' }, { name: 'Oak (Light)', roughness: 0.7, metalness: 0.0, color: '#C19A6B' }, { name: 'Ebony', roughness: 0.5, metalness: 0.0, color: '#3D2B1F' }, { name: 'Marble (White)', roughness: 0.15, metalness: 0.0, color: '#F5F5F0' }, { name: 'Granite', roughness: 0.5, metalness: 0.0, color: '#736F6E' }, { name: 'Sandstone', roughness: 0.8, metalness: 0.0, color: '#C2A878' }, { name: 'Slate', roughness: 0.6, metalness: 0.0, color: '#2F4F4F' }, { name: 'Limestone', roughness: 0.75, metalness: 0.0, color: '#E8DCC5' }, { name: 'Denim', roughness: 0.9, metalness: 0.0, color: '#3B5998' }, { name: 'Velvet', roughness: 0.95, metalness: 0.0, color: '#4B0082' }, { name: 'Leather (Brown)', roughness: 0.55, metalness: 0.0, color: '#5C3317' }, { name: 'Canvas', roughness: 0.85, metalness: 0.0, color: '#E8E4C9' }, { name: 'Felt', roughness: 0.95, metalness: 0.0, color: '#7A7A7A' }, { name: 'Plastic (Glossy Red)', roughness: 0.1, metalness: 0.0, color: '#FF3B30' }, { name: 'Plastic (Matte Green)', roughness: 0.7, metalness: 0.0, color: '#34C759' }, { name: 'ABS (Black)', roughness: 0.4, metalness: 0.0, color: '#1C1C1E' }, { name: 'PVC (White)', roughness: 0.35, metalness: 0.0, color: '#F2F2F7' }, { name: 'Frosted Glass', roughness: 0.4, metalness: 0.0, color: '#FFFFFF', opacity: 0.5 }, { name: 'Tinted Glass (Blue)', roughness: 0.05, metalness: 0.0, color: '#4A90D9', opacity: 0.35 }, { name: 'Ice', roughness: 0.1, metalness: 0.0, color: '#D6ECF0', opacity: 0.6 }, { name: 'Porcelain', roughness: 0.2, metalness: 0.0, color: '#FFFFF0' }, { name: 'Ceramic Tile (White)', roughness: 0.25, metalness: 0.0, color: '#FAFAFA' }, { name: 'Brick (Red)', roughness: 0.85, metalness: 0.0, color: '#B22222' }, { name: 'Cardboard', roughness: 0.9, metalness: 0.0, color: '#C19A6B' }, { name: 'Chalk', roughness: 0.95, metalness: 0.0, color: '#FFFFFF' }, { name: 'Cork', roughness: 0.8, metalness: 0.0, color: '#9B6B43' }, { name: 'Charcoal', roughness: 0.9, metalness: 0.0, color: '#1C1C1C' }, { name: 'Snow', roughness: 0.85, metalness: 0.0, color: '#FFFAFA' }, { name: 'Sand', roughness: 0.85, metalness: 0.0, color: '#EDC9AF' }, { name: 'Moss', roughness: 0.9, metalness: 0.0, color: '#4A6741' },
      ]);
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
    if (!user) return;
    try {
      const materialId = Math.random().toString(36).substr(2, 9);
      const material = {
        id: materialId,
        name: `Color ${newColor}`,
        userId: user.uid,
        type: 'color',
        value: newColor,
        pbr: pbrSettings,
        createdAt: new Date()
      };
      await addDoc(collection(db, 'materials'), { ...material, createdAt: serverTimestamp() });
      refreshMaterials();
      setIsAddMaterialOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'materials');
    }
  };

  const handleTextureUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setUploading(true);
    
    // 60 second timeout
    const timeoutId = setTimeout(() => {
      if (uploading) {
        setUploading(false);
        alert('Upload timed out. Please try again.');
      }
    }, 60000);

      try {
        const storageRef = ref(storage, `textures/${user.uid}/${Date.now()}_${file.name}`);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);
        
        const materialId = Math.random().toString(36).substr(2, 9);
        const material = {
          id: materialId,
          name: file.name,
          userId: user.uid,
          type: 'texture',
          value: url,
          pbr: pbrSettings,
          createdAt: new Date()
        };
        
        await addDoc(collection(db, 'materials'), { ...material, createdAt: serverTimestamp() });
        refreshMaterials();
        clearTimeout(timeoutId);
        setIsAddMaterialOpen(false);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, 'materials');
      } finally {
        setUploading(false);
        clearTimeout(timeoutId);
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
    'orbit'
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
                        "absolute top-full left-0 right-0 mt-1 p-2 rounded-lg border shadow-xl grid grid-cols-5 gap-1.5 z-[60]",
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

                <div className="pt-4 border-t border-gray-100 dark:border-gray-700 flex justify-end">
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
              </div>{shapes.map(shape => (<div key={shape.id} onClick={() => { setSelectedId(shape.id); setSelectedIds([shape.id]); }} className={cn("flex items-center gap-2 py-1 px-4 rounded cursor-pointer hover:bg-gray-100 group", selectedId === shape.id && "bg-trimble-blue/10 text-trimble-blue", shape.hidden && "opacity-40")}><div className="w-2 h-2 rounded-full" style={{ backgroundColor: shape.color }} /><span className="flex-1 truncate">{shape.name || `${shape.type} (${shape.id.slice(0, 4)})`}</span><button onClick={(e) => { e.stopPropagation(); setShapes(prev => prev.map(s => s.id === shape.id ? { ...s, hidden: !s.hidden } : s)); }} className="opacity-0 group-hover:opacity-100 hover:text-trimble-blue p-0.5 shrink-0" title={shape.hidden ? "Show" : "Hide"}>{shape.hidden ? <EyeOff size={13} /> : <Eye size={13} />}</button><button onClick={(e) => { e.stopPropagation(); removeShape(shape.id); }} className="opacity-0 group-hover:opacity-100 hover:text-red-500 p-0.5 shrink-0" title="Delete"><Trash2 size={13} /></button></div>))}
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
                {COLORS.map((color) => (
                  <div 
                    key={color} 
                    onClick={() => {
                      setActiveMaterial(color);
                      setActivePBR({ roughness: 0.5, metalness: 0, opacity: 1 });
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
                    key={i} 
                    onClick={() => {
                      setActiveMaterial(m.value);
                      if (m.pbr) setActivePBR(m.pbr);
                    }}
                    className={cn(
                      "aspect-square rounded-sm border cursor-pointer transition-transform hover:scale-110",
                      activeMaterial === m.value ? "border-trimble-blue ring-1 ring-trimble-blue" : "border-gray-300"
                    )}
                    style={{ backgroundColor: m.value }}
                  />
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
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Textures</span>
                  <div className="grid grid-cols-4 gap-2">
                    {customMaterials.filter(m => m.type === 'texture').map((m, i) => (
                      <div 
                        key={i}
                        onClick={() => {
                          setActiveMaterial(m.value);
                          if (m.pbr) setActivePBR(m.pbr);
                        }}
                        className={cn(
                          "aspect-square rounded-sm border cursor-pointer overflow-hidden transition-transform hover:scale-110",
                          activeMaterial === m.value ? "border-trimble-blue ring-1 ring-trimble-blue" : "border-gray-300"
                        )}
                      >
                        <img src={m.value} alt={m.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
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
                    onClick={() => setShowLightsource(!shadowsEnabled)}
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
                  {collaborators.map((collab: any) => (
                    <div key={collab.id || collab.uid} className="flex items-center justify-between p-1.5 hover:bg-gray-50 rounded transition-all group">
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
                            note.completed ? "text-green-500 hover:bg-green-50" : "text-gray-300 hover:text-green-500 hover:bg-green-50"
                          )}
                        >
                          <CheckCircle2 size={14} />
                        </button>
                        <button 
                          onClick={() => setNotes(prev => prev.filter(n => n.id !== note.id))}
                          className="p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
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
                  <div className="text-center py-8 text-gray-400 italic text-[10px] bg-gray-50 rounded-lg border border-dashed border-gray-200">
                    No notes found
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
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    {premadeMaterials.map((mat: any, i: number) => (
                      <div 
                        key={i}
                        onClick={() => {
                          if (mat.color) {
                            setActiveMaterial(mat.color);
                            setNewColor(mat.color);
                          } else {
                            setActiveMaterial(mat.preview_url || mat.url);
                          }
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
                          {mat.color ? (
                            <div className="w-full h-full" style={{ backgroundColor: mat.color }} />
                          ) : (
                            <img 
                              src={mat.preview_url || `https://physicallybased.info/images/materials/${mat.name.toLowerCase().replace(/ /g, '-')}.jpg`} 
                              alt={mat.name} 
                              className="w-full h-full object-cover" 
                              referrerPolicy="no-referrer"
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = `https://picsum.photos/seed/${mat.name}/200/200`;
                              }}
                            />
                          )}
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


