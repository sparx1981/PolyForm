import React, { useState, useEffect, useRef, useMemo } from 'react';
import { LAYER } from './ui/Surface';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { X, Play, Trash2, Save, FolderOpen, BookOpen, Terminal, Library as LibraryIcon, ChevronRight, Download, Upload, Plus, AlertCircle, Globe, User, Users, Settings, Circle as CircleIcon, Square as SquareIcon, Box as BoxIcon, Triangle as TriangleIcon, Cone as ConeIcon, Pyramid as PyramidIcon, Torus as TorusIcon, CircleDot, MousePointer2, Eraser, PaintBucket, Move, ArrowUpFromLine, RotateCw, Maximize, CornerUpRight, Orbit, Hand, ZoomIn, Sparkles, Search, MoreHorizontal, Video, Image, Palette, Layers, Box, PenLine, Radio, Zap, Disc, Hexagon, FileCode, FileText, Scissors } from 'lucide-react';
import Editor from '@monaco-editor/react';
import { useApp } from '../AppContext';
import { cn } from '../lib/utils';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, addDoc, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import SpecPage from './DeveloperPanel/SpecPage';

import { DeveloperSDK } from '../services/developerService';

export function DeveloperSuite() {
  const { 
    isDeveloperConsoleOpen, 
    setIsDeveloperConsoleOpen, 
    activeDeveloperTab, 
    setActiveDeveloperTab,
    consoleOutput,
    setConsoleOutput,
    theme,
    shapes,
    setShapes,
    updateShapeColor,
    selectedId,
    developerSuiteWidth,
    setDeveloperSuiteWidth,
    developerScripts,
    setDeveloperScripts,
    user,
    setScenes,
    setSkybox,
    setSkyboxBlur,
    setSkyboxRotation,
    setEnvironmentIntensity,
    setFogSettings,
    setCustomLights,
    setActiveBevelType,
    setZoom,
    setDefaultCameraPosition,
    setDefaultCameraTarget,
    isDeveloperSuiteCollapsed,
    setIsDeveloperSuiteCollapsed,
    syncStatus,
    collaborators,
    diagLog,
    setContactFrictionEnabled,
    setIsAIGenerateOpen,
    setAutoOrbitEnabled,
    setEmbeddedWebpageUrl,
    setIsWorldViewActive,
    setWorldViewLocation,
    setWorldViewAltitude,
    setWorldViewRadius,
    triggerFocusOnMap,
    developerCode,
    setDeveloperCode,
    refreshScripts
  } = useApp();

  const dragControls = useDragControls();
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const isResizing = useRef(false);

  const startResizing = (e: React.MouseEvent) => {
    isResizing.current = true;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', stopResizing);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isResizing.current) return;
    const newWidth = window.innerWidth - e.clientX;
    setDeveloperSuiteWidth(Math.max(400, Math.min(newWidth, window.innerWidth - 100)));
  };

  const stopResizing = () => {
    isResizing.current = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', stopResizing);
  };

  const sdkInstance = useMemo(() => {
    return new DeveloperSDK(
      shapes,
      setShapes,
      updateShapeColor,
      selectedId,
      {
        setScenes,
        setSkybox,
        setSkyboxBlur,
        setSkyboxRotation,
        setEnvironmentIntensity,
        setFogSettings,
        setCustomLights,
        setActiveBevelType,
        setZoom,
        setDefaultCameraPosition,
        setDefaultCameraTarget,
        syncStatus,
        collaborators,
        diagLog,
        setContactFrictionEnabled,
        setIsAIGenerateOpen,
        setAutoOrbitEnabled,
        setEmbeddedWebpageUrl,
        setIsWorldViewActive,
        setWorldViewLocation,
        setWorldViewAltitude,
        setWorldViewRadius,
        triggerFocusOnMap,
        onLog: (msg: string) => setConsoleOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`])
      }
    );
  }, [
    shapes, setShapes, updateShapeColor, selectedId, setScenes, setSkybox, 
    setSkyboxBlur, setSkyboxRotation, setEnvironmentIntensity, setFogSettings, 
    setCustomLights, setActiveBevelType, setZoom, setDefaultCameraPosition, 
    setDefaultCameraTarget, syncStatus, collaborators, diagLog, 
    setContactFrictionEnabled, setIsAIGenerateOpen, setAutoOrbitEnabled, 
    setEmbeddedWebpageUrl, setConsoleOutput, setIsWorldViewActive,
    setWorldViewLocation, setWorldViewAltitude, setWorldViewRadius,
    triggerFocusOnMap
  ]);

  useEffect(() => {
    (window as any).sdk = sdkInstance;
  }, [sdkInstance]);

  if (!isDeveloperConsoleOpen) return null;

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ 
        opacity: 1, 
        x: position.x, 
        y: position.y,
        height: isDeveloperSuiteCollapsed ? '48px' : 'calc(100vh - 32px)'
      }}
      exit={{ opacity: 0, x: 20 }}
      drag
      dragControls={dragControls}
      dragListener={false}
      dragMomentum={false}
      onDragEnd={(_, info) => setPosition(prev => ({ x: prev.x + info.offset.x, y: prev.y + info.offset.y }))}
      className="fixed top-4 right-4 z-[100] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800 flex flex-col overflow-hidden"
      style={{ width: developerSuiteWidth }}
    >
      {/* Resize Handle (only show when not collapsed) */}
      {!isDeveloperSuiteCollapsed && (
        <div 
          className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-trimble-blue/50 transition-colors z-10"
          onMouseDown={startResizing}
        />
      )}

      {/* Header */}
      <div 
        onPointerDown={(e) => dragControls.start(e)}
        className="h-12 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between px-4 bg-gray-50 dark:bg-gray-800/50 cursor-grab active:cursor-grabbing"
      >
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-trimble-blue" />
            <span className="font-bold text-sm text-gray-900 dark:text-white whitespace-nowrap">Developer Extensibility Suite</span>
          </div>
          {!isDeveloperSuiteCollapsed && (
            <div className="flex items-center bg-gray-200 dark:bg-gray-800 rounded-lg p-0.5">
              {[
                { id: 'console', label: 'Console' },
                { id: 'library', label: 'Library' },
                { id: 'docs', label: 'Getting Started' },
                { id: 'fullDocs', label: 'Full Documentation' },
                { id: 'spec', label: 'Spec' },
                { id: 'settings', label: 'Settings' }
              ].map(tab => (
                <button 
                  key={tab.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveDeveloperTab(tab.id as any);
                  }}
                  className={cn(
                    "px-3 py-1 text-[10px] font-bold rounded-md transition-all whitespace-nowrap",
                    activeDeveloperTab === tab.id 
                      ? "bg-white dark:bg-gray-700 shadow-sm text-trimble-blue" 
                      : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white"
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button 
            onClick={(e) => {
              e.stopPropagation();
              setIsDeveloperSuiteCollapsed(!isDeveloperSuiteCollapsed);
            }}
            className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors"
            title={isDeveloperSuiteCollapsed ? "Expand" : "Collapse"}
          >
            {isDeveloperSuiteCollapsed ? <Maximize size={16} className="text-gray-500" /> : <MoreHorizontal size={16} className="text-gray-500" />}
          </button>
          <button 
            onClick={(e) => {
              e.stopPropagation();
              setIsDeveloperConsoleOpen(false);
            }}
            className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>
      </div>

      {/* Content */}
      {!isDeveloperSuiteCollapsed && (
        <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {activeDeveloperTab === 'console' && (
            <DeveloperConsole 
              key="console" 
              sdkProps={{ 
                shapes, 
                setShapes, 
                updateShapeColor, 
                selectedId,
                extraSetters: {
                  setScenes,
                  setSkybox,
                  setSkyboxBlur,
                  setSkyboxRotation,
                  setEnvironmentIntensity,
                  setFogSettings,
                  setCustomLights,
                  setActiveBevelType,
                  setZoom,
                  setDefaultCameraPosition,
                  setDefaultCameraTarget,
                  syncStatus,
                  collaborators,
                  diagLog,
                  setContactFrictionEnabled,
                  setIsAIGenerateOpen,
                  setAutoOrbitEnabled,
                  setEmbeddedWebpageUrl
                }
              }} 
            />
          )}
          {activeDeveloperTab === 'library' && <DeveloperLibrary key="library" />}
          {activeDeveloperTab === 'docs' && <GettingStarted key="docs" />}
          {activeDeveloperTab === 'fullDocs' && <FullDocumentation key="fullDocs" />}
          {activeDeveloperTab === 'spec' && <ProductSpecification key="spec" />}
          {activeDeveloperTab === 'settings' && <DeveloperSettings key="settings" />}
        </AnimatePresence>
      </div>
      )}
    </motion.div>
  );
}

function ProductSpecification() {
  return <SpecPage />;
}

function DeveloperConsole({ sdkProps }: { sdkProps: any }) {
  const { 
    consoleOutput, 
    setConsoleOutput, 
    theme, 
    developerCode, 
    setDeveloperCode,
    developerScripts,
    setDeveloperScripts,
    setActiveDeveloperTab,
    user,
    refreshScripts
  } = useApp();
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [consoleOutput]);

  const handleLoadFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.js,.txt';
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (re) => {
        setDeveloperCode(re.target?.result as string);
        setConsoleOutput(prev => [...prev, `[SYSTEM] Loaded script from ${file.name}`]);
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const handleSaveFile = () => {
    const blob = new Blob([developerCode], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'script.js';
    a.click();
    URL.revokeObjectURL(url);
    setConsoleOutput(prev => [...prev, `[SYSTEM] Script saved to local file.`]);
  };

  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [newScriptName, setNewScriptName] = useState('New Script');

  const handleSaveToLibrary = () => {
    setIsSaveModalOpen(true);
  };

  const confirmSaveToLibrary = async () => {
    const scriptName = newScriptName.trim() || `Script ${new Date().toLocaleDateString()}`;

    const newScript = {
      userId: user?.uid || 'anonymous',
      userName: user?.displayName || 'Anonymous User',
      name: scriptName,
      code: developerCode,
      createdAt: new Date().toISOString(),
      pinned: false,
      isPublic: false
    };

    try {
      await addDoc(collection(db, 'scripts'), newScript);
      refreshScripts();
      setConsoleOutput(prev => [...prev, `[SYSTEM] Script "${scriptName}" saved to library.`]);
      setIsSaveModalOpen(false);
      
      // Switch to library tab to show success
      setTimeout(() => setActiveDeveloperTab('library'), 500);
    } catch (err: any) {
      handleFirestoreError(err, OperationType.CREATE, 'scripts');
    }
  };

  const runScript = async () => {
    setIsRunning(true);
    setProgress(0);
    setConsoleOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] Starting execution...`]);

    try {
      const customConsole = {
        log: (...args: any[]) => {
          setConsoleOutput(prev => [...prev, `[LOG] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}`]);
        },
        error: (...args: any[]) => {
          setConsoleOutput(prev => [...prev, `[ERROR] ${args.join(' ')}`]);
        }
      };

      // Simple execution for now (not in worker yet)
      const fn = new Function('sdk', 'scene', 'console', `
        return (async () => {
          try {
            ${developerCode}
          } catch (e) {
            console.error(e.message);
          }
        })();
      `);

      await fn((window as any).sdk, (window as any).sdk, customConsole);
      setConsoleOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] Execution completed successfully.`]);
    } catch (err: any) {
      setConsoleOutput(prev => [...prev, `[ERROR] ${err.message}`]);
    } finally {
      setIsRunning(false);
      setProgress(100);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Output Window */}
      <div className="h-1/3 border-b border-gray-200 dark:border-gray-800 flex flex-col">
        <div className="h-8 px-4 flex items-center justify-between bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Output</span>
          <button 
            onClick={() => setConsoleOutput([])}
            className="text-[10px] font-bold text-trimble-blue hover:underline uppercase"
          >
            Clear History
          </button>
        </div>
        <div 
          ref={outputRef}
          className="flex-1 p-4 font-mono text-xs overflow-y-auto bg-gray-900 text-gray-300"
        >
          {consoleOutput.length === 0 ? (
            <span className="text-gray-600 italic">No output yet...</span>
          ) : (
            consoleOutput.map((line, i) => (
              <div key={i} className={cn(
                "mb-1",
                line.includes('[ERROR]') ? "text-red-400" : 
                line.includes('[LOG]') ? "text-blue-400" : "text-gray-400"
              )}>
                {line}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 relative flex flex-col">
        <div className="h-8 px-4 flex items-center justify-between bg-[#252526] border-b border-gray-800 text-white">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Editor</span>
          <div className="flex items-center gap-2">
            <button 
              onClick={handleLoadFile}
              className="p-1 hover:bg-white/10 rounded transition-colors text-white" 
              title="Load File"
            >
              <FolderOpen className="w-3.5 h-3.5" />
            </button>
            <button 
              onClick={handleSaveFile}
              className="p-1 hover:bg-white/10 rounded transition-colors text-white" 
              title="Save File"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
            <button 
              onClick={handleSaveToLibrary}
              className="p-1 hover:bg-white/10 rounded transition-colors text-white" 
              title="Save to Library"
            >
              <Save className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <Editor
            height="100%"
            defaultLanguage="javascript"
            theme={theme === 'dark' ? 'vs-dark' : 'light'}
            value={developerCode}
            onChange={(val) => setDeveloperCode(val || '')}
            options={{
              minimap: { enabled: false },
              fontSize: 12,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              automaticLayout: true,
            }}
          />
        </div>

        {/* Controls */}
        <div className="h-12 px-4 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between bg-white dark:bg-gray-900">
          <div className="flex-1 max-w-xs h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              className="h-full bg-trimble-blue"
            />
          </div>
          <button 
            onClick={runScript}
            disabled={isRunning}
            className={cn(
              "flex items-center gap-2 px-6 py-1.5 rounded-lg text-sm font-bold transition-all",
              isRunning 
                ? "bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed" 
                : "bg-trimble-blue text-white hover:bg-trimble-blue/90 shadow-lg shadow-trimble-blue/20"
            )}
          >
            {isRunning ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Play className="w-4 h-4 fill-current" />
            )}
            {isRunning ? "Running..." : "Run Script"}
          </button>
        </div>
      </div>

      {/* Save Modal */}
      <AnimatePresence>
        {isSaveModalOpen && (
          <div className="fixed inset-0 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm" style={{ zIndex: LAYER.nested }}>
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-[0_24px_60px_-12px_rgba(15,23,42,0.35)] overflow-hidden"
            >
              <header className="px-6 pt-5 pb-4 border-b border-gray-200 dark:border-gray-800">
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">Save to library</h2>
                <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
                  Saved scripts are available from the library in every model.
                </p>
              </header>
              <div className="px-6 py-5">
                <div>
                  <label htmlFor="polyform-script-name" className="block text-[11px] font-medium text-gray-600 dark:text-gray-400">
                    Script name
                  </label>
                  <input 
                    id="polyform-script-name"
                    type="text"
                    value={newScriptName}
                    onChange={(e) => setNewScriptName(e.target.value)}
                    className="mt-1 w-full h-9 px-3 rounded-lg text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white outline-none focus:border-trimble-blue focus:ring-1 focus:ring-trimble-blue/30"
                    autoFocus
                  />
                </div>
              </div>
                <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-950/30">
                  <button 
                    onClick={() => setIsSaveModalOpen(false)}
                    className="inline-flex items-center justify-center h-9 px-4 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-trimble-blue"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={confirmSaveToLibrary}
                    className="inline-flex items-center justify-center h-9 px-4 rounded-lg bg-trimble-blue text-white text-sm font-medium hover:bg-trimble-blue/90 transition-colors shadow-sm shadow-trimble-blue/20 outline-none focus-visible:ring-2 focus-visible:ring-trimble-blue focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"
                  >
                    Save Script
                  </button>
                </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DeveloperLibrary() {
  const { developerScripts, setDeveloperScripts, setDeveloperCode, setActiveDeveloperTab, setPinnedScripts, user, refreshScripts } = useApp();
  const [filter, setFilter] = useState<'all' | 'me' | 'shared'>('all');
  const [editingScriptId, setEditingScriptId] = useState<string | null>(null);
  const [editingScriptName, setEditingScriptName] = useState('');

  const filteredScripts = useMemo(() => {
    return developerScripts.filter(s => {
      if (filter === 'me') return s.userId === (user?.uid || 'anonymous');
      if (filter === 'shared') return s.isPublic;
      return true;
    });
  }, [developerScripts, filter, user]);

  const copyScript = async (script: any) => {
    if (!user) return;
    
    const newScript = {
      userId: user.uid,
      userName: user.displayName || 'Anonymous User',
      name: `${script.name} (Copy)`,
      code: script.code,
      createdAt: new Date().toISOString(),
      pinned: false,
      isPublic: false
    };

    try {
      await addDoc(collection(db, 'scripts'), newScript);
      refreshScripts();
      alert('Script copied to your library!');
    } catch (err: any) {
      handleFirestoreError(err, OperationType.CREATE, 'scripts');
    }
  };

  const togglePin = async (id: string) => {
    const script = developerScripts.find(s => s.id === id);
    if (!script) return;
    
    const newPinned = !script.pinned;
    try {
      await updateDoc(doc(db, 'scripts', id), { pinned: newPinned });
      refreshScripts();
      if (newPinned) {
        setPinnedScripts(p => p.includes(id) ? p : [...p, id]);
      } else {
        setPinnedScripts(p => p.filter(pid => pid !== id));
      }
    } catch (err: any) {
      handleFirestoreError(err, OperationType.UPDATE, `scripts/${id}`);
    }
  };

  const togglePublic = async (id: string) => {
    const script = developerScripts.find(s => s.id === id);
    if (!script) return;

    if (!script.isPublic) {
      if (window.confirm('Are you sure you want to make this script publicly available to other users?')) {
        try {
          await updateDoc(doc(db, 'scripts', id), { isPublic: true });
          refreshScripts();
        } catch (err: any) {
          handleFirestoreError(err, OperationType.UPDATE, `scripts/${id}`);
        }
      }
    } else {
      try {
        await updateDoc(doc(db, 'scripts', id), { isPublic: false });
        refreshScripts();
      } catch (err: any) {
        handleFirestoreError(err, OperationType.UPDATE, `scripts/${id}`);
      }
    }
  };

  const deleteScript = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this script?')) {
      try {
        await deleteDoc(doc(db, 'scripts', id));
        refreshScripts();
        setPinnedScripts(p => p.filter(pid => pid !== id));
      } catch (err: any) {
        handleFirestoreError(err, OperationType.DELETE, `scripts/${id}`);
      }
    }
  };

  const handleRename = async (id: string) => {
    if (!editingScriptName.trim()) {
      setEditingScriptId(null);
      return;
    }

    try {
      await updateDoc(doc(db, 'scripts', id), { name: editingScriptName.trim() });
      setEditingScriptId(null);
    } catch (err: any) {
      handleFirestoreError(err, OperationType.UPDATE, `scripts/${id}`);
    }
  };

  return (
    <div className="h-full p-6 bg-gray-50 dark:bg-gray-900/50 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-xl font-bold mb-1 text-gray-900 dark:text-white">Script Library</h2>
            <p className="text-sm text-gray-500">Manage your saved automation scripts.</p>
          </div>
          <div className="flex bg-gray-200 dark:bg-gray-800 rounded-lg p-1">
            {[
              { id: 'all', label: 'All Scripts', icon: <Globe size={12} /> },
              { id: 'me', label: 'Made By Me', icon: <User size={12} /> },
              { id: 'shared', label: 'Shared Scripts', icon: <Users size={12} /> }
            ].map(f => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id as any)}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all",
                  filter === f.id ? "bg-white dark:bg-gray-700 shadow-sm text-trimble-blue" : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                )}
              >
                {f.icon}
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {filteredScripts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 bg-white dark:bg-gray-800 rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700">
            <LibraryIcon className="w-12 h-12 text-gray-300 mb-4" />
            <p className="text-gray-500 font-medium">No scripts found</p>
            <p className="text-xs text-gray-400 mt-1">Try changing your filter or saving a new script.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredScripts.map(script => (
              <div key={script.id} className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md transition-all group">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div className="flex-1 min-w-0">
                      {editingScriptId === script.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={editingScriptName}
                            onChange={(e) => setEditingScriptName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRename(script.id);
                              if (e.key === 'Escape') setEditingScriptId(null);
                            }}
                            className="flex-1 px-2 py-1 text-sm bg-gray-50 dark:bg-gray-900 border border-trimble-blue rounded focus:outline-none text-gray-900 dark:text-white"
                            autoFocus
                            onBlur={() => handleRename(script.id)}
                          />
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 group/title">
                          <h3 className="font-bold text-sm text-gray-900 dark:text-white truncate">{script.name}</h3>
                          {script.userId === user?.uid && (
                            <button
                              onClick={() => {
                                setEditingScriptId(script.id);
                                setEditingScriptName(script.name);
                              }}
                              className="opacity-0 group-hover/title:opacity-100 p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-all text-gray-400 hover:text-trimble-blue"
                              title="Rename Script"
                            >
                              <PenLine size={12} />
                            </button>
                          )}
                        </div>
                      )}
                      <p className="text-[10px] text-gray-400">Created By: {script.userName || 'Unknown'}</p>
                    </div>
                    {script.isPublic && <span title="Public Script"><Globe size={12} className="text-trimble-blue shrink-0" /></span>}
                  </div>
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={() => togglePublic(script.id)}
                      className={cn(
                        "p-1.5 rounded-lg transition-colors",
                        script.isPublic
                          ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                          : "text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400"
                      )}
                      title={script.isPublic ? "Make Private" : "Make Public"}
                    >
                      <Globe className="w-3.5 h-3.5" />
                    </button>
                    {script.userId === user?.uid ? (
                      <button 
                        onClick={() => togglePin(script.id)}
                        className={cn(
                          "p-1.5 rounded-lg transition-colors",
                          script.pinned ? "text-trimble-blue bg-trimble-blue/10" : "text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                        )}
                        title={script.pinned ? "Unpin from Toolbar" : "Pin to Toolbar"}
                      >
                        <Plus className={cn("w-3.5 h-3.5 transition-transform", script.pinned && "rotate-45")} />
                      </button>
                    ) : (
                      <button 
                        onClick={() => copyScript(script)}
                        className="p-1.5 text-trimble-blue hover:bg-trimble-blue/10 rounded-lg transition-colors"
                        title="Copy to My Library"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button 
                      onClick={() => deleteScript(script.id)}
                      className="p-1.5 text-red-400/80 dark:text-red-400/70 hover:text-red-700 dark:hover:text-red-300 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <p className="text-[10px] text-gray-400 mb-4 font-mono truncate bg-gray-50 dark:bg-gray-900/50 p-2 rounded">
                  {script.code.substring(0, 100)}...
                </p>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => {
                      setDeveloperCode(script.code);
                      setActiveDeveloperTab('console');
                    }}
                    className="flex-1 py-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg text-xs font-bold transition-colors"
                  >
                    Open in Console
                  </button>
                  <button 
                    onClick={() => {
                      // Shared run logic
                    }}
                    className="px-3 py-1.5 bg-trimble-blue text-white rounded-lg text-xs font-bold hover:bg-trimble-blue/90 transition-colors"
                  >
                    <Play className="w-3 h-3 fill-current" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GettingStarted() {
  const { setActiveDeveloperTab, setDeveloperCode } = useApp();

  const examples = [
    {
      title: "Add a Rectangle",
      description: "Adds a 2D rectangle to the origin",
      code: `const myRect = sdk.createRectangle({
  width: 5,
  height: 3,
  position: [0, 0, 0]
});`
    },
    {
      title: "Push-Pull (Extrusion)",
      description: "Create a rectangle and extrude it by 2 units",
      code: `const base = sdk.createRectangle({ width: 2, height: 2 });
const box = sdk.pushPull(base, 2);`
    },
    {
      title: "Styling (Hex Colors)",
      description: "Target an object and apply a specific hex color",
      code: `const myObj = sdk.getSelectedObject();
if (myObj) {
  sdk.applyColor(myObj, "#FF5733");
} else {
  console.log("Select an object first!");
}`
    },
    {
      title: "Find Object Info",
      description: "Get the name and ID of the currently selected object",
      code: `const obj = sdk.getSelectedObject();
if (obj) {
  console.log("Object Name:", obj.name || "Untitled");
  console.log("Object ID:", obj.id);
} else {
  console.log("No object selected!");
}`
    }
  ];

  return (
    <div className="h-full p-6 bg-gray-50 dark:bg-gray-900/50 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h2 className="text-xl font-bold mb-1 text-gray-900 dark:text-white">Getting Started</h2>
          <p className="text-sm text-gray-500">Learn how to automate your 3D workflow with the SDK.</p>
        </div>

        <div className="space-y-6">
          <section className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-gray-900 dark:text-white">
              <BookOpen className="w-5 h-5 text-trimble-blue" />
              Quick Start
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6 leading-relaxed">
              The SDK provides an imperative API to manipulate the 3D scene. You can create shapes, modify their properties, and perform geometric operations like extrusion.
            </p>

            <div className="space-y-4">
              {examples.map((example, i) => (
                <div key={i} className="group p-4 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-100 dark:border-gray-800 hover:border-trimble-blue/30 transition-all">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-bold text-sm text-gray-900 dark:text-white">{example.title}</h4>
                    <button 
                      onClick={() => {
                        setDeveloperCode(example.code);
                        setActiveDeveloperTab('console');
                      }}
                      className="text-[10px] font-bold text-trimble-blue hover:underline uppercase flex items-center gap-1"
                    >
                      Try It Now
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mb-3">{example.description}</p>
                  <pre className="p-3 bg-gray-900 text-gray-300 rounded-lg text-[10px] font-mono overflow-x-auto">
                    {example.code}
                  </pre>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function FullDocumentation() {
  const { setActiveDeveloperTab, setDeveloperCode } = useApp();

  const categories = [
    {
      title: "Shape Creation",
      icon: <BoxIcon className="w-4 h-4" />,
      items: [
        { name: "Create Box", code: `// width/height/depth: 0.1 to 100. Higher values create larger structures.
sdk.createBox({ width: 2, height: 2, depth: 2, position: [0, 1, 0] });` },
        { name: "Create Sphere", code: `// radius: 0.1 to 50. Larger radius increases surface area significantly.
sdk.createSphere({ radius: 1, position: [3, 1, 0] });` },
        { name: "Create Cone", code: `// radius/height: 0.1 to 50. High height with low radius creates a needle shape.
sdk.createCone({ radius: 1, height: 2, position: [-3, 1, 0] });` },
        { name: "Create Pyramid", code: `// radius/height: 0.1 to 50.
sdk.createPyramid({ radius: 1, height: 2, position: [0, 1, 3] });` },
        { name: "Create Donut", code: `// radius: 0.5 to 50, tube: 0.1 to 10. Tube must be smaller than radius.
sdk.createDonut({ radius: 1, tube: 0.4, position: [0, 1, -3] });` },
        { name: "Create Dome", code: `// radius: 0.1 to 50.
sdk.createDome({ radius: 1, position: [3, 0, 3] });` }
      ]
    },
    {
      title: "Geometric Operations",
      icon: <Maximize className="w-4 h-4" />,
      items: [
        { name: "Push Pull", code: `// distance: -50 to 50. Positive values extrude, negative values intrude.
const base = sdk.createRectangle({ width: 2, height: 2 });
sdk.pushPull(base, 3);` },
        { name: "Delete Object", code: `// Removes the object from the scene permanently.
const obj = sdk.getSelectedObject();
if (obj && obj.id) sdk.deleteObject(obj.id);` },
        { name: "Divide Surface", code: `// divisions: [1-20, 1-20]. Higher numbers increase geometric complexity.
const obj = sdk.getSelectedObject();
if (obj && obj.id) sdk.divideSurface(obj.id, 0, [4, 2]);` },
        { name: "Set Bevel", code: `// amount: 0 to 1, segments: 1 to 20. High segments create smoother curves.
const obj = sdk.getSelectedObject();
if (obj && obj.id) sdk.setBevel(obj, { amount: 0.2, type: 'radius', segments: 10 });` },
        { name: "Set Bevel Type", code: `// 'radius' for rounded, 'chamfer' for flat angled edges.
sdk.setBevelType('radius');` }
      ]
    },
    {
      title: "Advanced Geometry",
      icon: <Scissors className="w-4 h-4" />,
      items: [
        { name: "Perform CSG (Subtract)", code: `// Subtract cutterId from targetId. Both must exist.
const target = sdk.createBox({ width: 2, height: 2, depth: 2 });
const cutter = sdk.createSphere({ radius: 1, position: [1, 1, 1] });
// Wait for meshes to instantiate in scene if running rapidly
setTimeout(() => {
  sdk.performCSG(target.id, cutter.id, "SUBTRACTION");
}, 100);` },
        { name: "Deform Object", code: `// direction: 'outward'|'inward'|'both', strength: 0 to 1.
const obj = sdk.createBox({ width: 4, height: 4, depth: 4 });
sdk.deformObject(obj.id, { radius: 2, strength: 0.8, direction: 'outward' });` },
        { name: "AI Generate", code: `// Open the AI Designer UI.
sdk.generateModel("A row of 5 colorful beach huts on a sand platform.");` },
        { name: "Contact Friction", code: `// Enable physical resistance when moving objects.
sdk.setContactFriction(true);` }
      ]
    },
    {
      title: "Collaboration & Sync",
      icon: <Users className="w-4 h-4" />,
      items: [
        { name: "Get Sync Status", code: `// Possible values: 'synced', 'syncing', 'error', 'offline'
console.log("Status:", sdk.getSyncStatus());` },
        { name: "List Collaborators", code: `// Get an array of active collaborators in this session
const users = sdk.getCollaborators();
console.log(\`Active users: \${users.length}\`);` }
      ]
    },
    {
      title: "Environment & Scene",
      icon: <Sparkles className="w-4 h-4" />,
      items: [
        { name: "Save Scene", code: `// Saves current state. Name should be descriptive.
sdk.saveScene("My Scene");` },
        { name: "Set Skybox", code: `// intensity: 0 to 5, blur: 0 to 1, rotation: 0 to 360.
sdk.setSkybox("golden-hour", { intensity: 1.5, blur: 0.1, rotation: 45 });` },
        { name: "Set Fog", code: `// density: 0 to 0.1. High density obscures objects quickly.
sdk.setFog({ enabled: true, density: 0.05, colors: ["#ffffff", "#888888"] });` },
        { name: "Set Shadows", code: `// true/false. Enabling shadows impacts rendering performance.
sdk.setShadows(true);` },
        { name: "Set Grid", code: `// true/false. Helpful for spatial alignment.
sdk.setGrid(true);` },
        { name: "Set Floor", code: `// true/false. Provides a ground plane.
sdk.setFloor(true, "#333333");` },
        { name: "Set Ambient Occlusion", code: `// true/false. Adds soft shadows in corners/crevices.
sdk.setAmbientOcclusion(true);` },
        { name: "Set Sun Settings", code: `// intensity: 0 to 10, speed: 0 to 5.
sdk.setSunSettings({ intensity: 2, animate: true, speed: 1 });` }
      ]
    },
    {
      title: "Lighting",
      icon: <Zap className="w-4 h-4" />,
      items: [
        { name: "Add Custom Light", code: `// intensity: 0 to 20. Point lights emit in all directions.
sdk.addLight({ type: 'point', color: '#ff0000', intensity: 2, position: [0, 5, 0] });` },
        { name: "Add Projector (Texture)", code: `// Scale: 1-100. Intensity: 0-50.
// Projectors default to 'texture' mode when a map URL is provided.
sdk.addLight({
  type: 'projector',
  intensity: 10,
  position: [0, 20, 0],
  scale: 5,
  rotateTexture: true,
  textureRotationSpeed: 0.5,
  map: 'https://images.unsplash.com/photo-1518005020251-58296b8646f1?q=80&w=2000'
});` }
      ]
    },
    {
      title: "Styling & Metadata",
      icon: <Palette className="w-4 h-4" />,
      items: [
        { name: "Apply Color", code: `// color: Hex string. Changes the base material color.
const obj = sdk.getSelectedObject();
if (obj && obj.id) sdk.applyColor(obj, "#FF0000");` },
        { name: "Set Name", code: `// name: string. Used for identification in scripts and UI.
const obj = sdk.getSelectedObject();
if (obj) sdk.setName(obj, "My Custom Part");` },
        { name: "Set Tag", code: `// key/value: strings. Used for metadata filtering and logic.
const obj = sdk.getSelectedObject();
if (obj && obj.id) sdk.setTag(obj, "Status", "In Progress");` }
      ]
    },
    {
      title: "Camera & Navigation",
      icon: <ZoomIn className="w-4 h-4" />,
      items: [
        { name: "Set Zoom", code: `// Set camera zoom factor where 1.0 is standard.
sdk.setZoom(1.5);` },
        { name: "Reset View", code: `// Reset to default perspective or specific view ('plan', 'front', etc).
sdk.resetView('perspective');` },
        { name: "Focus Object", code: `// Orbit camera around target object.
const obj = sdk.getSelectedObject();
if (obj) sdk.focusObject(obj.id);` },
        { name: "Set Camera Defaults", code: `// Set persistent starting position and target.
sdk.setCameraDefaults([10, 10, 10], [0, 0, 0]);` }
      ]
    },
    {
      title: "Map & WorldView",
      icon: <Globe size={18} className="text-blue-500" />,
      items: [
        { name: "Global Map Overlay", code: `// Lat, Lng, Zoom, Altitude, Radius.
sdk.worldView.importMap({
  lat: 51.154449,
  lng: 0.841756,
  zoom: 18,
  altitude: -0.1,
  radius: 500
});` },
        { name: "Update Location", code: `sdk.worldView.setLocation(51.5074, -0.1278);` },
        { name: "Set Map Coverage", code: `// Set discovery radius in meters.
sdk.worldView.setRadius(750);` },
        { name: "Set Zoom", code: `sdk.worldView.setZoom(19);` }
      ]
    },
    {
      title: "Notes & Annotations",
      icon: <FileText size={18} className="text-yellow-500" />,
      items: [
        { name: "Add Note", code: `// content: string, pos: [x,y,z].
sdk.addNote("Base reinforcement required", [0, 2, 0]);` },
        { name: "Set Note Visibility", code: `sdk.setNoteVisibility("note-id", false);` },
        { name: "Toggle All Notes", code: `sdk.toggleAllNotes(false);` }
      ]
    },
    {
      title: "Visuals & Lighting",
      icon: <Zap size={18} className="text-purple-500" />,
      items: [
        { name: "Rect Light", code: `// color, intensity, pos, scale.
sdk.addRectLight("#0000FF", 5, [2, 5, 2], [5, 5]);` },
        { name: "Animate Sun", code: `// Animate sun position over time.
sdk.animateSun(30); // 30s cycle` },
        { name: "Add Triangle", code: `sdk.addObject("triangle", { position: [0, 0, 0], args: [2, 2, 2] });` },
        { name: "Toggle Floor", code: `sdk.toggleFloor(false);` },
        { name: "Toggle Grid", code: `sdk.toggleGrid(false);` }
      ]
    },
    {
      title: "Diagnostics & Debugging",
      icon: <Terminal className="w-4 h-4 text-orange-500" />,
      items: [
        { name: "Live Diagnostic Log", code: `// category: 'SDK'|'RENDER'|'ERROR', message: string, values?: object.
// Log entries appear in the AI Diagnostic Log panel (Ctrl+Shift+L).
sdk.diagLog("SDK", "Script execution started", { timestamp: Date.now() });` },
        { name: "Log Texture State", code: `// Log custom telemetry to track async asset loading.
sdk.diagLog("TEXTURE", "Starting manual texture preload", { url: "..." });` }
      ]
    },
    {
      title: "Embedded Browser",
      icon: <Globe size={18} className="text-teal-500" />,
      items: [
        { 
          name: "Open Asset Library", 
          code: `// Opens the example interactive asset library.
sdk.openWebpage("/example-assets.html");` 
        },
        {
          name: "Web-to-SDK Communication",
          code: `// Instructions for hosted pages:
// Access the SDK from within your hosted iframe using 'parent.sdk'.
// Example JS on your page:
// parent.sdk.addObject('box', { color: '#ff0000' });`
        }
      ]
    },
    {
      title: "Advanced Scripting (scene.*)",
      icon: <FileCode size={18} className="text-indigo-500" />,
      items: [
        { 
          name: "Import SketchUp (.skp)", 
          code: `// Programmatically import a bridge file.
// In a real script, 'file' would be a Blob or URL.
scene.importSKP("path/to/model.skp");` 
        },
        { 
          name: "Custom Mesh Creation", 
          code: `// Create complex geometry from raw arrays.
const vertices = new Float32Array([0,0,0, 1,0,0, 0,1,0]);
const indices = new Uint32Array([0,1,2]);
scene.addCustomMesh(vertices, indices, "GeneratedPart");` 
        },
        { 
          name: "Scene Traversal", 
          code: `// Iterate over all objects and update metadata.
const objects = scene.getObjects();
objects.forEach(obj => scene.log(\`Found \${obj.type} at \${obj.position}\`));` 
        },
        { 
          name: "Async Delay", 
          code: `// Precise timing for sequential operations.
scene.log("Step 1");
await scene.wait(1000);
scene.log("Step 2 (1s later)");` 
        }
      ]
    }
  ];

  return (
    <div className="h-full p-6 bg-gray-50 dark:bg-gray-900/50 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h2 className="text-xl font-bold mb-1 text-gray-900 dark:text-white">Full API Documentation</h2>
          <p className="text-sm text-gray-500">Comprehensive reference for all SDK capabilities.</p>
        </div>

        <div className="grid grid-cols-1 gap-6">
          {categories.map((cat, i) => (
            <section key={i} className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
              <h3 className="text-md font-bold mb-4 flex items-center gap-2 text-gray-900 dark:text-white border-b pb-2">
                {cat.icon}
                {cat.title}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {cat.items.map((item, j) => (
                  <div key={j} className="p-3 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-100 dark:border-gray-800">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-gray-700 dark:text-gray-300">{item.name}</span>
                      <button 
                        onClick={() => {
                          setDeveloperCode(item.code);
                          setActiveDeveloperTab('console');
                        }}
                        className="text-[9px] font-bold text-trimble-blue hover:underline uppercase"
                      >
                        Try Now
                      </button>
                    </div>
                    <pre className="p-2 bg-gray-900 text-gray-400 rounded text-[9px] font-mono overflow-x-auto">
                      {item.code}
                    </pre>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* Deprecated Examples */}
        <div className="mt-12 opacity-60">
          <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-6 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            Deprecated Examples
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
             <div className="p-3 bg-gray-200 dark:bg-gray-800/30 rounded-xl border border-gray-300 dark:border-gray-800">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold text-gray-500 line-through">Legacy Projector Spin</span>
              </div>
              <p className="text-[9px] text-gray-400 mb-2 italic">Reason: Rotating texture matrix does not affect shadow-mapped projections. Use up-vector roll instead.</p>
              <pre className="p-2 bg-gray-900 text-gray-600 rounded text-[9px] font-mono overflow-x-auto">
                {`// Deprecated (has no visual effect)
texture.rotation += delta * speed;
texture.updateMatrix();`}
              </pre>
            </div>
             <div className="p-3 bg-gray-200 dark:bg-gray-800/30 rounded-xl border border-gray-300 dark:border-gray-800">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold text-gray-500 line-through">Legacy Note Prompt</span>
              </div>
              <p className="text-[9px] text-gray-400 mb-2 italic">Reason: Prompt dialogs are blocked in iframe. Use sdk.addNote instead.</p>
              <pre className="p-2 bg-gray-900 text-gray-600 rounded text-[9px] font-mono overflow-x-auto">
                {`// Old way (now removed)
const text = prompt("Enter note");
sdk.addNote(text, [0,0,0]);`}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DeveloperSettings() {
  const { codeRecorderEnabled, setCodeRecorderEnabled } = useApp();

  return (
    <div className="h-full p-6 bg-gray-50 dark:bg-gray-900/50 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h2 className="text-xl font-bold mb-1 text-gray-900 dark:text-white">Developer Settings</h2>
          <p className="text-sm text-gray-500">Configure your development environment and experimental features.</p>
        </div>

        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-200 dark:border-gray-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-trimble-blue/10 rounded-xl flex items-center justify-center text-trimble-blue">
                  <Radio className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white">Code Recorder</h3>
                  <p className="text-xs text-gray-500">Record your actions in the 3D space and generate SDK code automatically.</p>
                </div>
              </div>
              <button 
                onClick={() => setCodeRecorderEnabled(!codeRecorderEnabled)}
                className={cn(
                  "w-10 h-5 rounded-full relative transition-colors",
                  codeRecorderEnabled ? "bg-trimble-blue" : "bg-gray-300"
                )}
              >
                <div className={cn(
                  "absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-all",
                  codeRecorderEnabled ? "left-5.5" : "left-0.5"
                )} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
