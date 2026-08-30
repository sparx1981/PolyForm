/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from './firebase';
import { AppProvider, useApp, type ToolbarKey, type DockZone } from './AppContext';
import { handleFirestoreError, OperationType } from './firebase';
import { doc, getDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { cn } from './lib/utils';
import { PanelLeftClose, PanelRightClose, PanelRightOpen, HelpCircle, GripHorizontal } from 'lucide-react';
import TopBar from './components/TopBar';
import LeftToolbar from './components/LeftToolbar';
import ArchitectureToolbar from './components/ArchitectureToolbar';
import LandscapesToolbar from './components/LandscapesToolbar';
import UnifiedToolRail from './components/UnifiedToolRail';
import RightPanelStack from './components/RightPanelStack';
import StatusBar from './components/StatusBar';
import Viewport from './components/Viewport';
import AIRenderer from './components/AIRenderer';
import AIQuery from './components/AIQuery';
import WorldView from './components/WorldView';
import AIGenerate from './components/AIGenerate';
import Login from './components/Login';
import Help from './components/Help';
import Messaging from './components/Messaging';
import WebpageModal from './components/WebpageModal';
import AIDiagnosticLog from './components/AIDiagnosticLog';
import { DeveloperSuite } from './components/DeveloperSuite';
import { CodeRecorder } from './components/CodeRecorder';
import { ToolModifierPalette } from './components/ToolModifierPalette';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ShieldAlert, RefreshCw } from 'lucide-react';

/**
 * Lets a classic-layout toolbar be dragged to reposition — either among
 * its current dock-mates (reorder), or onto a different edge of the
 * window entirely (re-dock to top/bottom/left) — the same two moves a
 * desktop app like Word or Excel supports when you drag a toolbar. Uses
 * native HTML5 drag-and-drop (no new dependency needed for three fixed
 * items) and only the small grip handle is itself draggable, so it never
 * competes with the many ordinary buttons inside the toolbar below it.
 *
 * Orientation follows the dock: a left-docked toolbar keeps its original
 * vertical column with a horizontal grip bar on top; a top/bottom-docked
 * one becomes a horizontal strip with a vertical grip bar on its leading
 * edge — matching how a real docked toolbar changes shape when you move
 * it to a different edge, not just its position.
 */
function DraggableToolbarSlot({
  toolbarKey,
  dock,
  draggedKey,
  setDraggedKey,
  dragOverKey,
  setDragOverKey,
  toolbarOrder,
  setToolbarOrder,
  toolbarDocks,
  setToolbarDocks,
  theme,
  children,
}: {
  toolbarKey: ToolbarKey;
  dock: DockZone;
  draggedKey: ToolbarKey | null;
  setDraggedKey: (k: ToolbarKey | null) => void;
  dragOverKey: ToolbarKey | null;
  setDragOverKey: (k: ToolbarKey | null) => void;
  toolbarOrder: ToolbarKey[];
  setToolbarOrder: (next: ToolbarKey[] | ((prev: ToolbarKey[]) => ToolbarKey[])) => void;
  toolbarDocks: Record<ToolbarKey, DockZone>;
  setToolbarDocks: (next: Record<ToolbarKey, DockZone> | ((prev: Record<ToolbarKey, DockZone>) => Record<ToolbarKey, DockZone>)) => void;
  theme: string;
  children: ReactNode;
}) {
  const isDragging = draggedKey === toolbarKey;
  const isDragOver = dragOverKey === toolbarKey && draggedKey !== null && draggedKey !== toolbarKey;
  const horizontal = dock !== 'left';

  return (
    <div
      className={cn(
        horizontal ? "flex flex-row w-full shrink-0" : "flex flex-col h-full shrink-0",
        "transition-opacity",
        isDragging && "opacity-40",
      )}
      onDragOver={(e) => {
        if (!draggedKey || draggedKey === toolbarKey) return;
        e.preventDefault();
        setDragOverKey(toolbarKey);
      }}
      onDragLeave={() => {
        if (dragOverKey === toolbarKey) setDragOverKey(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation(); // dropped on a specific toolbar, not empty dock space
        if (!draggedKey || draggedKey === toolbarKey) return;
        // Re-dock to match whichever toolbar it was dropped onto, THEN
        // reorder relative to it — dropping toolbar A onto toolbar B
        // means "put A right where B is," in both zone and position.
        setToolbarDocks((prev) => ({ ...prev, [draggedKey]: dock }));
        setToolbarOrder((prev) => {
          const next = prev.filter((k) => k !== draggedKey);
          const targetIndex = next.indexOf(toolbarKey);
          next.splice(targetIndex, 0, draggedKey);
          return next;
        });
        setDraggedKey(null);
        setDragOverKey(null);
      }}
    >
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          setDraggedKey(toolbarKey);
        }}
        onDragEnd={() => {
          setDraggedKey(null);
          setDragOverKey(null);
        }}
        title="Drag to reorder or move to another edge"
        className={cn(
          "flex items-center justify-center cursor-grab active:cursor-grabbing transition-colors shrink-0",
          horizontal ? "h-full w-3.5 border-r" : "w-full h-3.5 border-b",
          isDragOver && "bg-trimble-blue/20",
          theme === 'dark'
            ? "bg-gray-850 border-gray-700 hover:bg-gray-800 text-gray-600"
            : "bg-slate-50 border-gray-200 hover:bg-gray-100 text-gray-400",
        )}
      >
        <GripHorizontal size={12} className={horizontal ? "rotate-90" : undefined} />
      </div>
      <div className="flex-1 min-h-0 min-w-0">
        {children}
      </div>
    </div>
  );
}

/**
 * A dock edge itself, as a drop target — dropping a toolbar somewhere in
 * this strip that ISN'T directly on another toolbar (open space, or an
 * empty edge with nothing docked there yet) re-docks it here without
 * necessarily reordering it relative to anything, since there may be
 * nothing to order it relative to.
 */
function DockZoneContainer({
  zone,
  draggedKey,
  setDraggedKey,
  toolbarDocks,
  setToolbarDocks,
  theme,
  children,
}: {
  zone: DockZone;
  draggedKey: ToolbarKey | null;
  setDraggedKey: (k: ToolbarKey | null) => void;
  toolbarDocks: Record<ToolbarKey, DockZone>;
  setToolbarDocks: (next: Record<ToolbarKey, DockZone> | ((prev: Record<ToolbarKey, DockZone>) => Record<ToolbarKey, DockZone>)) => void;
  theme: string;
  children: ReactNode;
}) {
  const [isOver, setIsOver] = useState(false);
  const isEmpty = Object.values(toolbarDocks).filter((d) => d === zone).length === 0;
  const horizontal = zone !== 'left';

  return (
    <div
      className={cn(
        // The container arranges MULTIPLE docked toolbars PERPENDICULAR
        // to each toolbar's own orientation: several vertical-column
        // toolbars on the left need to sit side by side (a row), while
        // several horizontal-strip toolbars on top/bottom need to stack
        // (a column) so each is its own visible row — the opposite of
        // what was here before, which is why only one left-docked
        // toolbar was ever visible (the rest stacked vertically,
        // overflowing past the viewport) while multiple top/bottom-docked
        // ones got crammed into a single row instead of stacking.
        horizontal ? "flex flex-col w-full shrink-0" : "flex flex-row h-full shrink-0",
        draggedKey && isOver && "bg-trimble-blue/10",
        // An empty zone is otherwise invisible (zero size) and impossible
        // to drop onto — give it a thin, visible drop strip only while
        // something is actually being dragged, matching how most docking
        // UIs reveal an empty dock target only on demand.
        draggedKey && isEmpty && (horizontal ? "min-h-[10px]" : "min-w-[10px]"),
        draggedKey && isEmpty && (theme === 'dark' ? "bg-gray-800/40" : "bg-gray-100/60"),
      )}
      onDragOver={(e) => {
        if (!draggedKey) return;
        e.preventDefault();
        setIsOver(true);
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsOver(false);
        if (!draggedKey) return;
        setToolbarDocks((prev) => ({ ...prev, [draggedKey]: zone }));
        setDraggedKey(null);
      }}
    >
      {children}
    </div>
  );
}

function AppContent() {
    const { 
      user, 
      setUser, 
      theme, 
      rightPanelVisible, 
      setRightPanelVisible, 
      setIsChangelogOpen,
      setCurrentModelId: updateModelId,
      setShapesSilent,
      setTagsSilent,
      setScenesSilent,
      setCustomMaterialsSilent,
      setAnimationsSilent,
      setCustomLightsSilent,
      setNotesSilent,
      setCurrentModelName,
      setIsDiagnosticLogOpen,
      isMessagingOpen,
      isMessagingDocked,
      isToolModifierDocked,
      quotaLockdownTime,
      isQuotaLocked,
      totalReads,
      layoutMode,
      toolbarOrder,
      setToolbarOrder,
      toolbarDocks,
      setToolbarDocks
    } = useApp();
  
    const quotaLocked = isQuotaLocked();
    const [draggedToolbarKey, setDraggedToolbarKey] = useState<ToolbarKey | null>(null);
    const [dragOverToolbarKey, setDragOverToolbarKey] = useState<ToolbarKey | null>(null);
    // A function, not a static map: each toolbar needs to know which edge
    // it's CURRENTLY rendered against (its `dock` prop), so it can render
    // as a horizontal strip instead of its original vertical column —
    // and that can be different every time this is called, since the
    // same toolbar might render in the top strip, the left column, or
    // the bottom strip depending on where the user last dragged it.
    const renderToolbar = (key: ToolbarKey, dock: DockZone): ReactNode => {
      switch (key) {
        case 'left': return <LeftToolbar layoutMode={layoutMode} dock={dock} />;
        case 'architecture': return <ArchitectureToolbar dock={dock} />;
        case 'landscapes': return <LandscapesToolbar dock={dock} />;
      }
    };
    // toolbarOrder governs relative order everywhere; filtering it per
    // zone keeps that one order meaningful within each dock rather than
    // needing a separate order per zone.
    const toolbarsInZone = (zone: DockZone) => toolbarOrder.filter((k) => toolbarDocks[k] === zone);
    const remainingSeconds = Math.max(0, Math.ceil((quotaLockdownTime - Date.now()) / 1000));
    const remainingMinutes = Math.floor(remainingSeconds / 60);
    const remainingSecs = remainingSeconds % 60;
  
    const showRedBanner = quotaLocked;
    const showOrangeBanner = !quotaLocked && totalReads >= 40000;
    const showYellowBanner = !quotaLocked && totalReads >= 25000 && totalReads < 40000;
  
    useEffect(() => {
      const handleJoin = async () => {
        if (!user?.email) return;
        const params = new URLSearchParams(window.location.search);
        const joinId = params.get('join');
        if (!joinId) return;
  
        console.log(`[Join] Attempting to join design: ${joinId}`);
        try {
          // 1. Check if user is invited
          const q = query(
            collection(db, 'collaborations'), 
            where('modelId', '==', joinId),
            where('email', '==', user.email.toLowerCase())
          );
          let snapshot;
          try {
            snapshot = await getDocs(q);
          } catch (err) {
            handleFirestoreError(err, OperationType.GET, 'collaborations');
            return;
          }
          
          if (snapshot.empty) {
            // Check if user is the owner (owners can always join their own link)
            let modelDoc;
            try {
              modelDoc = await getDoc(doc(db, 'models', joinId));
            } catch (err) {
              handleFirestoreError(err, OperationType.GET, `models/${joinId}`);
              return;
            }
            if (modelDoc.exists() && modelDoc.data().userId === user.uid) {
              console.log("[Join] Loading own design...");
            } else {
              alert("You haven't been invited to this design session.");
              window.history.replaceState({}, document.title, window.location.pathname);
              return;
            }
          } else {
            // Update status to active
            const collabDoc = snapshot.docs[0];
            try {
              await updateDoc(doc(db, 'collaborations', collabDoc.id), {
                uid: user.uid,
                status: 'active',
                lastSeen: Date.now()
              });
            } catch (err) {
              handleFirestoreError(err, OperationType.UPDATE, `collaborations/${collabDoc.id}`);
              return;
            }
          }
  
          // 2. Load model
          let modelDoc;
          try {
            modelDoc = await getDoc(doc(db, 'models', joinId));
          } catch (err) {
            handleFirestoreError(err, OperationType.GET, `models/${joinId}`);
            return;
          }
          if (modelDoc.exists()) {
            const data = modelDoc.data();
            setShapesSilent(data.shapes || []);
            setTagsSilent(data.tags || []);
            setScenesSilent(data.scenes || []);
            setCustomMaterialsSilent(data.customMaterials || []);
            setAnimationsSilent(data.animations || []);
            if (setCustomLightsSilent) setCustomLightsSilent(data.customLights || []);
            if (setNotesSilent) setNotesSilent(data.notes || []);
            updateModelId(joinId);
            setCurrentModelName(data.name);
            console.log("[Join] Design loaded successfully.");
            // Clear query param
            window.history.replaceState({}, document.title, window.location.pathname);
          } else {
            alert("This design no longer exists.");
          }
        } catch (err) {
          console.error('[Join] Error:', err);
          // Only alert if it's not a quota error which is already handled globally
          if (!err.message.includes('Quota exceeded')) {
            alert("Failed to join design session.");
          }
        }
      };
  
      if (user) {
        handleJoin();
      }
    }, [user, updateModelId, setShapesSilent, setTagsSilent, setScenesSilent, setCustomMaterialsSilent, setAnimationsSilent, setCustomLightsSilent, setNotesSilent, setCurrentModelName]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, [setUser]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Shift+L to toggle Diagnostic Log
      if (e.ctrlKey && e.shiftKey && e.key === 'L') {
        e.preventDefault();
        setIsDiagnosticLogOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setIsDiagnosticLogOpen]);

  if (!user) {
    return <Login />;
  }

  return (
    <div className={`h-screen flex flex-col overflow-hidden transition-colors duration-300 ${theme === 'dark' ? 'dark bg-gray-900 text-white' : 'bg-white'}`}>
      <TopBar />
      
      <AnimatePresence>
        {showRedBanner && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-red-600 text-white px-4 py-2 flex items-center justify-between text-sm font-medium z-[100] shadow-lg sticky top-0"
          >
            <div className="flex items-center gap-3">
              <ShieldAlert size={18} />
              <span>
                <strong>Firestore Quota Exceeded.</strong> Auto-sync is paused for the next {remainingMinutes}:{remainingSecs.toString().padStart(2, '0')} to protect your account.
              </span>
            </div>
            <button 
              onClick={() => window.location.reload()}
              className="bg-white/20 hover:bg-white/30 px-3 py-1 rounded transition-colors flex items-center gap-2"
            >
              <RefreshCw size={14} />
              Retry Now
            </button>
          </motion.div>
        )}

        {showOrangeBanner && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-orange-500 text-black px-4 py-2 flex items-center gap-3 text-sm font-medium z-[90] shadow-md sticky top-0"
          >
            <ShieldAlert size={18} />
            <span>
              <strong>Warning:</strong> High Firestore Usage (40,000+ reads). Approaching daily limits. Performance may be throttled soon.
            </span>
          </motion.div>
        )}

        {showYellowBanner && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-yellow-400 text-black px-4 py-2 flex items-center gap-3 text-sm font-medium z-[80] shadow-md sticky top-0"
          >
            <ShieldAlert size={18} />
            <span>
              <strong>Notice:</strong> Firestore Usage at 25,000+ reads. Consider saving work or reducing collaborator count.
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="flex-1 flex flex-col overflow-hidden relative">
        {layoutMode === 'classic' && (
          <DockZoneContainer
            zone="top"
            draggedKey={draggedToolbarKey}
            setDraggedKey={setDraggedToolbarKey}
            toolbarDocks={toolbarDocks}
            setToolbarDocks={setToolbarDocks}
            theme={theme}
          >
            {toolbarsInZone('top').map((key) => (
              <DraggableToolbarSlot
                key={key}
                toolbarKey={key}
                dock="top"
                draggedKey={draggedToolbarKey}
                setDraggedKey={setDraggedToolbarKey}
                dragOverKey={dragOverToolbarKey}
                setDragOverKey={setDragOverToolbarKey}
                toolbarOrder={toolbarOrder}
                setToolbarOrder={setToolbarOrder}
                toolbarDocks={toolbarDocks}
                setToolbarDocks={setToolbarDocks}
                theme={theme}
              >
                {renderToolbar(key, 'top')}
              </DraggableToolbarSlot>
            ))}
          </DockZoneContainer>
        )}

        {/*
          Viewport, ToolModifierPalette and the right panel are ALL shared
          between both layout modes — they used to be direct siblings in a
          single-row <main>, which is what made them "just appear on the
          right" for free. Restructuring <main> into a column (for the
          top/bottom dock strips) meant they needed an explicit shared row
          wrapper instead, or they would stack vertically below everything
          rather than sit beside the viewport — confirmed as the actual
          cause of the right panel appearing on the left, twice now: once
          when this restructuring first happened, and a second time when a
          later round was accidentally built from a stale clone that
          predated this exact fix, silently reintroducing the bug this
          comment is now guarding against. If this needs touching again,
          count how many times the Viewport component is actually
          rendered in this file first — it must always be exactly one.
        */}
        <div className="flex-1 flex overflow-hidden">
          {layoutMode === 'unified' ? (
            <UnifiedToolRail />
          ) : (
            <DockZoneContainer
              zone="left"
              draggedKey={draggedToolbarKey}
              setDraggedKey={setDraggedToolbarKey}
              toolbarDocks={toolbarDocks}
              setToolbarDocks={setToolbarDocks}
              theme={theme}
            >
              {toolbarsInZone('left').map((key) => (
                <DraggableToolbarSlot
                  key={key}
                  toolbarKey={key}
                  dock="left"
                  draggedKey={draggedToolbarKey}
                  setDraggedKey={setDraggedToolbarKey}
                  dragOverKey={dragOverToolbarKey}
                  setDragOverKey={setDragOverToolbarKey}
                  toolbarOrder={toolbarOrder}
                  setToolbarOrder={setToolbarOrder}
                  toolbarDocks={toolbarDocks}
                  setToolbarDocks={setToolbarDocks}
                  theme={theme}
                >
                  {renderToolbar(key, 'left')}
                </DraggableToolbarSlot>
              ))}
            </DockZoneContainer>
          )}

          <Viewport />

          {!isToolModifierDocked && <ToolModifierPalette />}

          {/* Right Panel Toggle Button - Always visible and obvious */}
          <button
            onClick={() => setRightPanelVisible(!rightPanelVisible)}
            className={`absolute top-4 z-30 p-2.5 rounded-lg shadow-xl border transition-all transform hover:scale-105 active:scale-95 flex items-center gap-2 ${
              rightPanelVisible ? 'right-[300px]' : 'right-4'
            } ${
              theme === 'dark' 
                ? 'bg-gray-800 text-gray-200 border-gray-700 hover:bg-gray-700' 
                : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
            }`}
            title={rightPanelVisible ? "Collapse Panel" : "Expand Panel"}
          >
            {rightPanelVisible ? (
              <>
                <PanelRightClose size={18} />
                <span className="text-[10px] font-bold uppercase tracking-wider">Collapse</span>
              </>
            ) : (
              <>
                <PanelRightOpen size={18} />
                <span className="text-[10px] font-bold uppercase tracking-wider">Tools & Info</span>
              </>
            )}
          </button>

          <AnimatePresence>
            {rightPanelVisible && (
              <motion.div
                initial={{ x: 300, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 300, opacity: 0 }}
                transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                className="h-full relative z-40"
              >
                <ErrorBoundary>
                  <RightPanelStack />
                </ErrorBoundary>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {layoutMode === 'classic' && (
          <DockZoneContainer
            zone="bottom"
            draggedKey={draggedToolbarKey}
            setDraggedKey={setDraggedToolbarKey}
            toolbarDocks={toolbarDocks}
            setToolbarDocks={setToolbarDocks}
            theme={theme}
          >
            {toolbarsInZone('bottom').map((key) => (
              <DraggableToolbarSlot
                key={key}
                toolbarKey={key}
                dock="bottom"
                draggedKey={draggedToolbarKey}
                setDraggedKey={setDraggedToolbarKey}
                dragOverKey={dragOverToolbarKey}
                setDragOverKey={setDragOverToolbarKey}
                toolbarOrder={toolbarOrder}
                setToolbarOrder={setToolbarOrder}
                toolbarDocks={toolbarDocks}
                setToolbarDocks={setToolbarDocks}
                theme={theme}
              >
                {renderToolbar(key, 'bottom')}
              </DraggableToolbarSlot>
            ))}
          </DockZoneContainer>
        )}
      </main>

      <StatusBar />
      
      <AIRenderer />
      <AIGenerate />
      <AIQuery />
      <WorldView />
      <Help />
      <AnimatePresence>
        {isMessagingOpen && !isMessagingDocked && <Messaging />}
      </AnimatePresence>
      <AIDiagnosticLog />
      <WebpageModal />
      <DeveloperSuite />
      <CodeRecorder />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}

