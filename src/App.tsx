/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from './firebase';
import { AppProvider, useApp } from './AppContext';
import { handleFirestoreError, OperationType } from './firebase';
import { doc, getDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { cn } from './lib/utils';
import { PanelLeftClose, PanelRightClose, PanelRightOpen, HelpCircle } from 'lucide-react';
import TopBar from './components/TopBar';
import LeftToolbar from './components/LeftToolbar';
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
      totalReads
    } = useApp();
  
    const quotaLocked = isQuotaLocked();
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

      <main className="flex-1 flex overflow-hidden relative">
        <LeftToolbar />
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

