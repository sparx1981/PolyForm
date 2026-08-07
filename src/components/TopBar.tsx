import { 
  Menu, 
  User, 
  ChevronDown, 
  ChevronRight,
  FilePlus, 
  FolderOpen, 
  Save, 
  Share2, 
  Download,
  Settings, 
  LogOut,
  Moon,
  Sun,
  Palette,
  X,
  Undo2,
  Redo2,
  Terminal,
  BookOpen,
  FileText,
  Layers,
  HelpCircle,
  Camera
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { auth, db, storage, handleFirestoreError, OperationType } from '../firebase';
import { signOut } from 'firebase/auth';
import { collection, addDoc, query, where, getDocs, deleteDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import { useApp } from '../AppContext';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
// @ts-ignore
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter';
// @ts-ignore
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter';
import { SketchupService, HuggingFaceService } from '../services/sketchupService';
import * as THREE from 'three';
import OpenModel from './OpenModel';

export default function TopBar() {
    const { 
      user, 
      shapes, 
      setShapes,
      clearShapes, 
      theme, 
      setTheme, 
      bannerColor, 
      setBannerColor,
      currentModelId,
      setCurrentModelId,
      currentModelName,
      setCurrentModelName,
      toolbarVisibility,
      setToolbarVisibility,
      panelVisibility,
      setPanelVisibility,
      tags,
      setTags,
      scenes,
      setScenes,
      customMaterials,
      setCustomMaterials,
      animations,
      setAnimations,
      notes,
      customLights,
      undo,
      redo,
      setIsDeveloperConsoleOpen,
      setIsChangelogOpen,
      setActiveDeveloperTab,
      unit,
      setUnit,
      swReady,
      defaultCameraPosition,
      setDefaultCameraPosition,
      defaultCameraTarget,
      setDefaultCameraTarget,
      isDiagnosticLogOpen,
      setIsDiagnosticLogOpen,
      diagLog
    } = useApp();
  
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isSavedModelsOpen, setIsSavedModelsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSaveAsOpen, setIsSaveAsOpen] = useState(false);
  const [newModelName, setNewModelName] = useState('Untitled Model');
  const [savedModels, setSavedModels] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setIsProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleNew = () => {
    if (shapes.length > 0) {
      if (window.confirm('Do you want to save your current design before starting a new one?')) {
        handleSave();
      }
    }
    clearShapes();
    setIsMenuOpen(false);
  };

  const handleSave = async () => {
    if (!user) return;
    
    if (!currentModelId) {
      setIsSaveAsOpen(true);
      setIsMenuOpen(false);
      return;
    }

    setLoading(true);
    diagLog('Save', 'Initiating save for model', { modelId: currentModelId });
    try {
      // Request snapshot
      window.dispatchEvent(new CustomEvent('request-snapshot', { 
        detail: { 
          callback: async (dataUrl: string) => {
            diagLog('Save', 'Snapshot received, starting storage upload');
            try {
              // Upload to storage with fallback and timeout
              let previewUrl = '';
              const uploadWithTimeout = async () => {
                try {
                  const storageRef = ref(storage, `previews/${user.uid}/${currentModelId}.jpg`);
                  diagLog('Save', 'Attempting storage upload...', { path: `previews/${user.uid}/${currentModelId}.jpg` });
                  
                  // Create a 30s timeout for storage upload
                  const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Storage upload timed out')), 30000)
                  );
                  
                  await Promise.race([
                    uploadString(storageRef, dataUrl, 'data_url'),
                    timeoutPromise
                  ]);
                  
                  previewUrl = await getDownloadURL(storageRef);
                  diagLog('Save', 'Preview uploaded successfully', { url: previewUrl });
                  return previewUrl;
                } catch (err) {
                  throw err;
                }
              };

              try {
                previewUrl = await uploadWithTimeout();
              } catch (storageErr) {
                diagLog('Save', 'Storage upload skipped or failed', { error: storageErr instanceof Error ? storageErr.message : String(storageErr) });
                console.warn("[Save] Storage upload failed, updating without preview:", storageErr);
              }

              try {
                diagLog('Save', 'Updating Firestore document');
                await updateDoc(doc(db, 'models', currentModelId), {
                  id: currentModelId,
                  shapes: shapes,
                  tags: tags,
                  scenes: scenes,
                  customMaterials: customMaterials,
                  animations: animations,
                  notes: notes,
                  customLights: customLights,
                  ...(previewUrl ? { previewUrl } : {}),
                  updatedAt: serverTimestamp()
                });
              } catch (error) {
                handleFirestoreError(error, OperationType.UPDATE, `models/${currentModelId}`);
              }
              diagLog('Save', 'Model saved successfully', { modelId: currentModelId });
              
              // Update local state so the UI reflects the save
              setSavedModels(prev => prev.map(m => m.id === currentModelId ? {
                ...m,
                shapes,
                tags,
                scenes,
                customMaterials,
                notes,
                customLights,
                previewUrl,
                updatedAt: new Date() // Approximate for local UI
              } : m));

              setIsMenuOpen(false);
              setTimeout(() => {
                alert('Model saved successfully!');
              }, 100);
            } catch (err) {
              console.error('Save error:', err);
              alert('Failed to save model.');
            } finally {
              setLoading(false);
              setIsMenuOpen(false);
            }
          }
        } 
      }));
    } catch (err) {
      console.error('Save error:', err);
      alert('Failed to save model.');
      setLoading(false);
    }
  };

  const handleSaveAs = async () => {
    if (!user || !newModelName.trim()) return;

    setLoading(true);
    console.log(`[SaveAs] Creating new model: ${newModelName}`);
    diagLog('SaveAs', 'Started', { name: newModelName });
    try {
      // Request snapshot
      window.dispatchEvent(new CustomEvent('request-snapshot', { 
        detail: { 
          callback: async (dataUrl: string) => {
            diagLog('SaveAs', 'Snapshot received, starting storage upload');
            try {
              let previewUrl = '';
              const uploadWithTimeout = async () => {
                try {
                  const tempId = Math.random().toString(36).substr(2, 9);
                  const storageRef = ref(storage, `previews/${user.uid}/${tempId}.jpg`);
                  diagLog('SaveAs', 'Attempting storage upload...', { path: `previews/${user.uid}/${tempId}.jpg` });

                  // Create a 30s timeout for storage upload
                  const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Storage upload timed out')), 30000)
                  );

                  await Promise.race([
                    uploadString(storageRef, dataUrl, 'data_url'),
                    timeoutPromise
                  ]);

                  previewUrl = await getDownloadURL(storageRef);
                  diagLog('SaveAs', 'Preview uploaded', { url: previewUrl });
                  return previewUrl;
                } catch (err) {
                  throw err;
                }
              };

              try {
                previewUrl = await uploadWithTimeout();
              } catch (storageErr) {
                diagLog('SaveAs', 'Storage upload skipped or failed', { error: storageErr instanceof Error ? storageErr.message : String(storageErr) });
                console.warn("[SaveAs] Storage upload failed, saving without preview:", storageErr);
              }

              let docRef;
              try {
                diagLog('SaveAs', 'Creating Firestore document');
                docRef = await addDoc(collection(db, 'models'), {
                  id: '', // Will update after creation
                  name: newModelName || 'Untitled Model',
                  userId: user.uid,
                  userName: user.displayName || 'Anonymous User',
                  shapes: shapes || [],
                  tags: tags || [],
                  scenes: scenes || [],
                  customMaterials: customMaterials || [],
                  animations: animations || [],
                  notes: notes || [],
                  customLights: customLights || [],
                  updatedAt: serverTimestamp(),
                  createdAt: serverTimestamp(),
                  previewUrl: previewUrl || '',
                  isPublic: false,
                  hasPassword: false,
                  password: ''
                });
                console.log("[SaveAs] Firestore document created:", docRef.id);
                
                // Update with real ID for data consistency
                await updateDoc(doc(db, 'models', docRef.id), { id: docRef.id });
              } catch (error) {
                handleFirestoreError(error, OperationType.WRITE, 'models');
              }
              diagLog('SaveAs', 'Model created and synced successfully', { modelId: docRef.id });

              setCurrentModelId(docRef.id);
              setCurrentModelName(newModelName);
              fetchModels(); 
              
              // Close modal BEFORE showing alert to avoid blocking the state transition
              setIsSaveAsOpen(false);
              setTimeout(() => {
                alert('Model saved successfully!');
              }, 100);
            } catch (err) {
              console.error('Save As error:', err);
              alert('Failed to save model.');
            } finally {
              setLoading(false);
            }
          }
        } 
      }));
    } catch (err) {
      console.error('Save As error:', err);
      alert('Failed to save model.');
      setLoading(false);
    }
  };

  const fetchModels = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const q = query(collection(db, 'models'), where('userId', '==', user.uid));
      const querySnapshot = await getDocs(q);
      const models = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setSavedModels(models);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'models');
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = () => {
    fetchModels();
    setIsSavedModelsOpen(true);
    setIsMenuOpen(false);
  };

  const deleteModel = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this model?')) return;
    try {
      await deleteDoc(doc(db, 'models', id));
      setSavedModels(prev => prev.filter(m => m.id !== id));
      if (currentModelId === id) {
        setCurrentModelId(null);
        setCurrentModelName(null);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `models/${id}`);
    }
  };

  const loadModel = (model: any) => {
    setShapes(model.shapes || []);
    setTags(model.tags || []);
    setScenes(model.scenes || []);
    if (model.customMaterials) setCustomMaterials(model.customMaterials);
    setCurrentModelId(model.id);
    setCurrentModelName(model.name);
    setIsSavedModelsOpen(false);
  };

  const handleExport = (format: 'gltf' | 'stl' | 'skp') => {
    if (format === 'skp') {
      window.dispatchEvent(new CustomEvent('request-scene-raw', {
        detail: {
          callback: (scene: THREE.Scene) => {
            SketchupService.exportAsSKP(scene, currentModelName || 'Model');
            diagLog('Export', 'Exported as SKP (via bridge)');
          }
        }
      }));
    } else {
      window.dispatchEvent(new CustomEvent('export-scene-advanced', { detail: { format } }));
    }
    setIsMenuOpen(false);
  };

  const handleImportSKP = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.skp,.gltf,.json';
    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (!file) return;
      
      diagLog('Import', 'Importing SketchUp file', { name: file.name });
      try {
        const group = await SketchupService.importSKP(file);
        // Add as a custom shape
        const id = Math.random().toString(36).substr(2, 9);
        const newShape: any = {
          id,
          name: file.name.split('.')[0],
          type: 'custom',
          position: [0, 0, 0],
          args: {},
          color: '#ffffff',
          geometryData: group.toJSON() // Simplified for demo
        };
        setShapes(prev => [...prev, newShape]);
        alert('Imported SketchUp model successfully!');
      } catch (err) {
        console.error('Import error:', err);
        alert('Failed to import SketchUp file. Ensure it is a valid bridge format.');
      }
    };
    input.click();
    setIsMenuOpen(false);
  };

  const handlePhotoTo3D = () => {
    const token = HuggingFaceService.getToken();
    if (!token) {
      alert('Add a Hugging Face API token first: open Materials \u2192 Add Material \u2192 AI Generate tab to set it, then try Photo to 3D again.');
      setIsMenuOpen(false);
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (!file) return;

      diagLog('Import', 'Converting photo to 3D model', { name: file.name });
      try {
        const group = await HuggingFaceService.photoTo3D(file);
        const id = Math.random().toString(36).substr(2, 9);
        const newShape: any = {
          id,
          name: file.name.split('.')[0] + ' (AI 3D)',
          type: 'custom',
          position: [0, 0, 0],
          args: {},
          color: '#ffffff',
          geometryData: group.toJSON()
        };
        setShapes(prev => [...prev, newShape]);
        alert('Generated a 3D model from your photo!');
      } catch (err: any) {
        console.error('Photo to 3D error:', err);
        alert(err?.message || 'Failed to generate a 3D model from this photo.');
      }
    };
    input.click();
    setIsMenuOpen(false);
  };

  return (
    <header 
      className="h-12 text-white flex items-center justify-between px-4 z-50 transition-colors duration-300"
      style={{ backgroundColor: bannerColor }}
    >
      <div className="flex items-center gap-4">
        <div className="relative" ref={menuRef}>
          <button 
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="p-1 hover:bg-white/10 rounded transition-colors"
          >
            <Menu size={20} />
          </button>
          
          <AnimatePresence>
            {isMenuOpen && (
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="absolute left-0 top-full mt-2 w-56 bg-white rounded-lg shadow-modus-4 border border-gray-200 py-2 text-gray-700"
              >
                <MenuButton icon={<FilePlus size={16} />} label="New" onClick={handleNew} />
                <MenuButton icon={<FolderOpen size={16} />} label="Open" onClick={handleOpen} />
                <MenuButton icon={<Save size={16} />} label="Save" onClick={handleSave} />
                
                <div className="h-px bg-gray-100 my-1" />
                
                <div className="px-4 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Project</div>
                
                <div className="relative group/export">
                  <div className="flex items-center justify-between px-4 py-2 text-sm hover:bg-gray-50 cursor-pointer transition-colors">
                    <div className="flex items-center gap-3">
                      <Download size={16} className="text-gray-500" />
                      <span>Import / Export</span>
                    </div>
                    <ChevronRight size={14} className="text-gray-400" />
                  </div>
                  
                  <div className="absolute left-full top-0 w-52 bg-white rounded-lg shadow-xl border border-gray-200 py-2 hidden group-hover/export:block z-[60]">
                    <div className="absolute -left-2 top-0 w-2 h-full" />
                    <MenuButton icon={<Download size={14} />} label="Import SKP" onClick={handleImportSKP} />
              <MenuButton icon={<Camera size={14} />} label="Photo to 3D (AI)" onClick={handlePhotoTo3D} />
                    <div className="h-px bg-gray-100 my-1" />
                    <MenuButton icon={<Share2 size={14} />} label="Export GLTF" onClick={() => handleExport('gltf')} />
                    <MenuButton icon={<Share2 size={14} />} label="Export STL" onClick={() => handleExport('stl')} />
                    <MenuButton icon={<Share2 size={14} />} label="Export SKP" onClick={() => handleExport('skp')} />
                  </div>
                </div>
                
                <div className="h-px bg-gray-100 my-1" />
                
                <MenuButton icon={<Settings size={16} />} label="Settings" onClick={() => { setIsSettingsOpen(true); setIsMenuOpen(false); }} />
                <MenuButton icon={<HelpCircle size={16} />} label="Help" onClick={() => { setIsChangelogOpen(true); setIsMenuOpen(false); }} />
                
                <div className="h-px bg-gray-100 my-1" />
                
                <div className="relative group/dev">
                  <div className="flex items-center justify-between px-4 py-2 text-sm hover:bg-gray-50 cursor-pointer transition-colors">
                    <div className="flex items-center gap-3">
                      <Terminal size={16} className="text-gray-500" />
                      <span>Developer</span>
                    </div>
                    <ChevronRight size={14} className="text-gray-400" />
                  </div>
                  
                  <div className="absolute left-full top-0 w-52 bg-white rounded-lg shadow-xl border border-gray-200 py-2 hidden group-hover/dev:block z-[60]">
                    <div className="absolute -left-2 top-0 w-2 h-full" /> {/* Bridge the gap for hover */}
                    <MenuButton icon={<Terminal size={14} />} label="Console" onClick={() => { setIsDeveloperConsoleOpen(true); setActiveDeveloperTab('console'); setIsMenuOpen(false); }} />
                    <MenuButton icon={<BookOpen size={14} />} label="Library" onClick={() => { setIsDeveloperConsoleOpen(true); setActiveDeveloperTab('library'); setIsMenuOpen(false); }} />
                    <MenuButton icon={<FileText size={14} />} label="Documentation" onClick={() => { setIsDeveloperConsoleOpen(true); setActiveDeveloperTab('docs'); setIsMenuOpen(false); }} />
                    <MenuButton icon={<Layers size={14} />} label="Product Spec" onClick={() => { setIsDeveloperConsoleOpen(true); setActiveDeveloperTab('spec'); setIsMenuOpen(false); }} />
                    <div className="h-px bg-gray-100 my-1" />
                    <MenuButton icon={<Terminal size={14} />} label="AI Diagnostic Log" onClick={() => { setIsDiagnosticLogOpen(true); setIsMenuOpen(false); }} />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-2 py-1 rounded">
            <span className="font-bold text-lg tracking-tight">PolyForm</span>
          </div>
          <div className="h-4 w-px bg-white/20 mx-1" />
          <div className="flex items-center gap-0.5">
            <button 
              onClick={undo}
              className="p-1.5 hover:bg-white/10 rounded transition-colors text-white/80 hover:text-white"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 size={16} />
            </button>
            <button 
              onClick={redo}
              className="p-1.5 hover:bg-white/10 rounded transition-colors text-white/80 hover:text-white"
              title="Redo (Ctrl+Y)"
            >
              <Redo2 size={16} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative" ref={profileRef}>
          <button 
            onClick={() => setIsProfileOpen(!isProfileOpen)}
            className="flex items-center gap-2 p-1 hover:bg-white/10 rounded-full transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center overflow-hidden border border-white/20">
              {user?.photoURL ? (
                <img src={user.photoURL} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <User size={18} />
              )}
            </div>
            <ChevronDown size={14} className={cn("transition-transform", isProfileOpen && "rotate-180")} />
          </button>

          <AnimatePresence>
            {isProfileOpen && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="absolute right-0 top-full mt-2 w-64 bg-white rounded-lg shadow-modus-4 border border-gray-200 py-3 text-gray-700"
              >
                <div className="px-4 pb-3 border-b border-gray-100">
                  <div className="font-semibold truncate">{user?.displayName || 'User'}</div>
                  <div className="text-xs text-gray-500 truncate">{user?.email}</div>
                </div>
                <div className="py-1">
                  <MenuButton 
                    icon={<LogOut size={16} className="text-red-500" />} 
                    label="Logout" 
                    onClick={() => signOut(auth)} 
                    className="text-red-600 hover:bg-red-50"
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <OpenModel 
        isOpen={isSavedModelsOpen} 
        onClose={() => setIsSavedModelsOpen(false)} 
      />

      {/* Save As Modal */}
      <Modal isOpen={isSaveAsOpen} onClose={() => setIsSaveAsOpen(false)} title="Save Model">
        <div className="space-y-6">
          <div className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
            <Save className="text-trimble-blue shrink-0" size={24} />
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Give your model a name to save it to your library.
            </p>
          </div>
          
          <div className="space-y-2">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Model Name</label>
            <input 
              type="text" 
              value={newModelName || ''}
              onChange={(e) => setNewModelName(e.target.value)}
              placeholder="Enter model name..."
              className="w-full px-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-trimble-blue focus:border-transparent outline-none transition-all text-gray-900 dark:text-white"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button 
              onClick={() => setIsSaveAsOpen(false)}
              className="px-6 py-2.5 text-sm font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button 
              onClick={handleSaveAs}
              disabled={loading || !newModelName.trim()}
              className="px-8 py-2.5 bg-trimble-blue text-white text-sm font-bold rounded-xl hover:bg-trimble-blue/90 disabled:opacity-50 transition-all shadow-lg shadow-trimble-blue/20"
            >
              {loading ? 'Saving...' : 'Save Model'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Settings Modal */}
      <Modal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} title="Settings">
        <div className="space-y-6">
          <div className="space-y-3">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Measurement Unit</label>
            <div className="grid grid-cols-3 gap-2 p-1 bg-gray-50 dark:bg-gray-800 rounded-lg">
              {['mm', 'cm', 'm'].map((u) => (
                <button
                  key={u}
                  onClick={() => setUnit(u as any)}
                  className={cn(
                    "py-2 text-xs font-bold rounded-md transition-all",
                    unit === u 
                      ? "bg-white dark:bg-gray-700 text-trimble-blue shadow-sm ring-1 ring-gray-200 dark:ring-gray-600" 
                      : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                  )}
                >
                  {u.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Appearance</label>
            <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <div className="flex items-center gap-3">
                {theme === 'light' ? <Sun size={18} className="text-orange-500" /> : <Moon size={18} className="text-indigo-500" />}
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{theme === 'light' ? 'Light Mode' : 'Dark Mode'}</span>
              </div>
              <button 
                onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
                className={cn(
                  "w-10 h-5 rounded-full relative transition-colors",
                  theme === 'light' ? "bg-gray-300" : "bg-trimble-blue"
                )}
              >
                <div className={cn(
                  "absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-all",
                  theme === 'light' ? "left-0.5" : "left-5.5"
                )} />
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Default Camera Position</label>
                <button 
                  onClick={() => setDefaultCameraPosition([80, 80, 80])}
                  className="text-[10px] text-trimble-blue font-bold hover:underline"
                >
                  Revert Camera
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(['X', 'Y', 'Z'] as const).map((axis, i) => (
                  <div key={axis} className="flex flex-col">
                    <span className="text-[10px] text-gray-400 font-mono mb-1">{axis}</span>
                    <input 
                      type="number" 
                      step="0.1"
                      value={defaultCameraPosition[i]}
                      onChange={(e) => {
                        const newPos = [...defaultCameraPosition] as [number, number, number];
                        newPos[i] = parseFloat(e.target.value) || 0;
                        setDefaultCameraPosition(newPos);
                      }}
                      className="w-full px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-1 focus:ring-trimble-blue outline-none"
                    />
                  </div>
                ))}
              </div>
            </div>

            <p className="text-[10px] text-gray-400 italic">These settings define the starting view for new models and perspective resets.</p>
          </div>

          <div className="space-y-3">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Interface Visibility</label>
            <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
              <CollapsibleSection title="Toolbar Icons" className="bg-blue-50/50 rounded-lg px-2">
                {['select', 'eraser', 'paint', 'rectangle', 'circle', 'line', 'move', 'rotate', 'scale', 'pushpull', 'orbit', 'pan', 'zoom', 'component'].map(tool => (
                  <VisibilityToggle 
                    key={tool}
                    label={tool === 'component' ? 'Make Component' : tool.charAt(0).toUpperCase() + tool.slice(1)}
                    isVisible={toolbarVisibility[tool] !== false}
                    onToggle={() => setToolbarVisibility({ ...toolbarVisibility, [tool]: toolbarVisibility[tool] === false })}
                  />
                ))}
              </CollapsibleSection>
              
              <CollapsibleSection title="Right Panels" className="bg-orange-50/50 rounded-lg px-2">
                {['entity', 'outliner', 'materials', 'styles', 'tags', 'scenes', 'shadows', 'components'].map(panel => (
                  <VisibilityToggle 
                    key={panel}
                    label={panel === 'shadows' ? 'Visualisation' : panel.charAt(0).toUpperCase() + panel.slice(1)}
                    isVisible={panelVisibility[panel] !== false}
                    onToggle={() => setPanelVisibility({ ...panelVisibility, [panel]: panelVisibility[panel] === false })}
                  />
                ))}
              </CollapsibleSection>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Banner Color</label>
            <div className="flex flex-wrap gap-2">
              {['#0063A3', '#18181b', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6'].map(color => (
                <button 
                  key={color}
                  onClick={() => setBannerColor(color)}
                  className={cn(
                    "w-8 h-8 rounded-full border-2 transition-transform hover:scale-110",
                    bannerColor === color ? "border-white ring-2 ring-trimble-blue" : "border-transparent"
                  )}
                  style={{ backgroundColor: color }}
                />
              ))}
              <div className="relative">
                <input 
                  type="color" 
                  value={bannerColor} 
                  onChange={(e) => setBannerColor(e.target.value)}
                  className="w-8 h-8 rounded-full border-2 border-transparent cursor-pointer opacity-0 absolute inset-0"
                />
                <div className="w-8 h-8 rounded-full border-2 border-gray-200 flex items-center justify-center bg-white">
                  <Palette size={14} className="text-gray-400" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </Modal>
    </header>
  );
}

function MenuButton({ icon, label, onClick, className }: { icon: React.ReactNode, label: string, onClick: () => void, className?: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-gray-50 transition-colors",
        className
      )}
    >
      <span className="text-gray-400">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function VisibilityToggle({ label, isVisible, onToggle }: { label: string, isVisible: boolean, onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-gray-600">{label}</span>
      <button 
        onClick={onToggle}
        className={cn(
          "w-8 h-4 rounded-full relative transition-colors",
          isVisible ? "bg-trimble-blue" : "bg-gray-300"
        )}
      >
        <div className={cn(
          "absolute top-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-all",
          isVisible ? "left-4.5" : "left-0.5"
        )} />
      </button>
    </div>
  );
}

function CollapsibleSection({ title, children, className }: { title: string, children: React.ReactNode, className?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className={cn("border-b border-gray-100 pb-2 transition-all", className)}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between py-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider hover:text-gray-600 transition-colors"
      >
        <span>{title}</span>
        {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {isOpen && <div className="pl-2 space-y-1 pb-2">{children}</div>}
    </div>
  );
}

function Modal({ isOpen, onClose, title, children }: { isOpen: boolean, onClose: () => void, title: string, children: React.ReactNode }) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800 w-full max-w-2xl overflow-hidden flex flex-col max-h-[80vh]"
          >
            <div className="h-14 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between px-6 bg-gray-50 dark:bg-gray-800/50">
              <div className="flex items-center gap-3">
                <FolderOpen className="w-5 h-5 text-trimble-blue" />
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h2>
              </div>
              <button onClick={onClose} className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors">
                <X size={20} className="text-gray-500" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto bg-gray-50 dark:bg-gray-900/50">
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
