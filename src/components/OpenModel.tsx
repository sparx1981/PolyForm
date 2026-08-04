import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, 
  Search, 
  LayoutGrid, 
  List, 
  Globe, 
  User, 
  Users, 
  Trash2, 
  Copy, 
  Lock, 
  Unlock, 
  ChevronRight,
  Download,
  FolderOpen,
  AlertCircle,
  Shield,
  ShieldAlert,
  Key,
  Clock,
  Loader2
} from 'lucide-react';
import { useApp } from '../AppContext';
import { db, handleFirestoreError, OperationType, isQuotaLocked } from '../firebase';
import { collection, query, where, getDocs, deleteDoc, doc, updateDoc, addDoc, serverTimestamp, or, orderBy } from 'firebase/firestore';
import { cn, safelyToDate } from '../lib/utils';
import { SavedModel } from '../types';

interface OpenModelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function OpenModel({ isOpen, onClose }: OpenModelProps) {
  const { 
    user, 
    setShapes, 
    setTags, 
    setScenes, 
    setCustomMaterials, 
    setCurrentModelId, 
    setCurrentModelName,
    currentModelId,
    animations,
    setAnimations,
    theme,
    incrementReads
  } = useApp();

  const [models, setModels] = useState<SavedModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [filter, setFilter] = useState<'recent' | 'all' | 'me' | 'shared'>('recent');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Password protection states
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [passwordToTry, setPasswordToTry] = useState('');
  const [modelToOpen, setModelToOpen] = useState<SavedModel | null>(null);
  const [passwordError, setPasswordError] = useState(false);

  // Sharing states
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [modelToShare, setModelToShare] = useState<SavedModel | null>(null);
  const [sharePassword, setSharePassword] = useState('');
  const [usePassword, setUsePassword] = useState(false);

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [lastFetched, setLastFetched] = useState<Record<string, number>>({});
  const CACHE_TIME = 600000; // 10 minutes cache for model listing

  useEffect(() => {
    if (isOpen) {
      const now = Date.now();
      const lastFetchTime = lastFetched[filter] || 0;
      if (now - lastFetchTime > CACHE_TIME) {
        fetchModels();
      }
    }
  }, [isOpen, filter, user?.uid]);

  const fetchModels = async (force = false) => {
    if (!user) return;
    
    const now = Date.now();
    const lastFetchTime = lastFetched[filter] || 0;
    
    // Use cache if fresh, or if quota is locked and we have data
    if (!force && lastFetchTime && now - lastFetchTime < CACHE_TIME) {
      return;
    }

    if (isQuotaLocked() && models.length > 0) {
      console.warn('[QUOTA] Using existing model cache during lockdown');
      return;
    }

    if (isQuotaLocked()) {
      console.error('[QUOTA] Cannot fetch models - Quota Locked');
      return;
    }

    setLoading(true);
    try {
      let q;
      const modelsRef = collection(db, 'models');

      if (filter === 'recent') {
        // Your models
        q = query(
          modelsRef, 
          where('userId', '==', user.uid)
        );
      } else if (filter === 'me') {
        q = query(
          modelsRef, 
          where('userId', '==', user.uid)
        );
      } else if (filter === 'shared') {
        q = query(
          modelsRef, 
          where('isPublic', '==', true)
        );
      } else {
        // All models (mine + public)
        q = query(
          modelsRef, 
          or(
            where('userId', '==', user.uid),
            where('isPublic', '==', true)
          )
        );
      }

      const querySnapshot = await getDocs(q);
      incrementReads(querySnapshot.size || 1);
      const fetchedModels = querySnapshot.docs.map(doc => {
        const data = doc.data();
        return { 
          id: doc.id, 
          ...data as any
        } as SavedModel;
      });
      
      // Secondary client-side sort
      fetchedModels.sort((a, b) => {
        const dateA = safelyToDate(a.updatedAt);
        const dateB = safelyToDate(b.updatedAt);
        const timeA = isNaN(dateA.getTime()) ? 0 : dateA.getTime();
        const timeB = isNaN(dateB.getTime()) ? 0 : dateB.getTime();
        return timeB - timeA;
      });

      setModels(fetchedModels);
      setLastFetched(prev => ({ ...prev, [filter]: now }));
    } catch (err) {
      console.error('Fetch models error:', err);
      handleFirestoreError(err, OperationType.LIST, 'models');
    } finally {
      setLoading(false);
    }
  };

  const filteredModels = useMemo(() => {
    return models.filter(m => 
      m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.userName?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [models, searchQuery]);

  const handleDelete = async (id: string) => {
    setIsDeleting(true);
    try {
      await deleteDoc(doc(db, 'models', id));
      setModels(prev => prev.filter(m => m.id !== id));
      
      // If the deleted model was the current one, reset state
      if (currentModelId === id) {
        setCurrentModelId(null);
        setCurrentModelName('Untitled Model');
        setShapes([]);
        setTags([]);
        setScenes([]);
        setAnimations([]);
        setCustomMaterials([]);
      }
      
      setDeleteConfirmId(null);
    } catch (err) {
      console.error('Delete error:', err);
      handleFirestoreError(err, OperationType.DELETE, `models/${id}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleOpenRequest = (model: SavedModel) => {
    if (model.userId !== user?.uid && model.hasPassword) {
      setModelToOpen(model);
      setIsPasswordModalOpen(true);
      setPasswordToTry('');
      setPasswordError(false);
    } else {
      loadModel(model);
    }
  };

  const handlePasswordSubmit = () => {
    if (!modelToOpen) return;
    
    if (passwordToTry === modelToOpen.password) {
      loadModel(modelToOpen);
      setIsPasswordModalOpen(false);
      setModelToOpen(null);
    } else {
      setPasswordError(true);
    }
  };

  const loadModel = (model: SavedModel) => {
    setShapes(model.shapes || []);
    setTags(model.tags || []);
    setScenes(model.scenes || []);
    setAnimations(model.animations || []);
    if (model.customMaterials) setCustomMaterials(model.customMaterials);
    setCurrentModelId(model.id);
    setCurrentModelName(model.name);
    onClose();
  };

  const handleCopy = async (e: React.MouseEvent, model: SavedModel) => {
    e.stopPropagation();
    if (!user) return;

    // Check password if needed
    if (model.userId !== user.uid && model.hasPassword) {
      const pwd = window.prompt('This model is password protected. Enter password to copy:');
      if (pwd !== model.password) {
        alert('Incorrect password.');
        return;
      }
    }

    try {
      const newModel = {
        ...model,
        id: undefined, // Let Firestore generate new ID
        userId: user.uid,
        userName: user.displayName || 'Anonymous User',
        name: `${model.name} (Copy)`,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        isPublic: false,
        password: '',
        hasPassword: false
      };
      delete (newModel as any).id;

      await addDoc(collection(db, 'models'), newModel);
      alert('Model copied to your library!');
      fetchModels();
    } catch (err) {
      console.error('Copy error:', err);
      handleFirestoreError(err, OperationType.CREATE, 'models');
    }
  };

  const openShareModal = (e: React.MouseEvent, model: SavedModel) => {
    e.stopPropagation();
    setModelToShare(model);
    setUsePassword(model.hasPassword || false);
    setSharePassword(model.password || '');
    setIsShareModalOpen(true);
  };

  const handleShareSubmit = async () => {
    if (!modelToShare) return;

    try {
      await updateDoc(doc(db, 'models', modelToShare.id), {
        isPublic: true,
        hasPassword: usePassword,
        password: usePassword ? sharePassword : '',
        updatedAt: serverTimestamp()
      });
      setIsShareModalOpen(false);
      fetchModels();
      alert('Model is now public!');
    } catch (err) {
      console.error('Share error:', err);
      handleFirestoreError(err, OperationType.UPDATE, `models/${modelToShare.id}`);
    }
  };

  const togglePublicStatus = async (e: React.MouseEvent, model: SavedModel) => {
    e.stopPropagation();
    if (model.isPublic) {
      if (window.confirm('Make this model private?')) {
        try {
          await updateDoc(doc(db, 'models', model.id), { 
            isPublic: false,
            updatedAt: serverTimestamp()
          });
          fetchModels();
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `models/${model.id}`);
        }
      }
    } else {
      openShareModal(e, model);
    }
  };

  const handlePasswordLabelClick = (e: React.MouseEvent, model: SavedModel) => {
    e.stopPropagation();
    if (model.userId === user?.uid) {
      openShareModal(e, model);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800 w-full max-w-5xl overflow-hidden flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="h-14 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between px-6 bg-gray-50 dark:bg-gray-800/50">
            <div className="flex items-center gap-3">
              <FolderOpen className="w-5 h-5 text-trimble-blue" />
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Open Model</h2>
            </div>
            <div className="flex items-center gap-4">
              {/* View Toggle */}
              <div className="flex bg-gray-200 dark:bg-gray-800 rounded-lg p-1">
                <button 
                  onClick={() => setViewMode('grid')}
                  className={cn(
                    "p-1.5 rounded-md transition-all",
                    viewMode === 'grid' ? "bg-white dark:bg-gray-700 shadow-sm text-trimble-blue" : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                  )}
                >
                  <LayoutGrid size={16} />
                </button>
                <button 
                  onClick={() => setViewMode('list')}
                  className={cn(
                    "p-1.5 rounded-md transition-all",
                    viewMode === 'list' ? "bg-white dark:bg-gray-700 shadow-sm text-trimble-blue" : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                  )}
                >
                  <List size={16} />
                </button>
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors"
              >
                <X size={20} className="text-gray-500" />
              </button>
            </div>
          </div>

          {/* Toolbar */}
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-gray-900">
            <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-xl px-3 py-2 flex-1 max-w-md">
              <Search size={18} className="text-gray-400" />
              <input 
                type="text"
                placeholder="Search models..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-transparent border-none outline-none text-sm text-gray-900 dark:text-white w-full"
              />
            </div>
            
            <div className="flex bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
              {[
                { id: 'recent', label: 'Recent', icon: <Clock size={14} /> },
                { id: 'all', label: 'All Models', icon: <Globe size={14} /> },
                { id: 'me', label: 'Made By Me', icon: <User size={14} /> },
                { id: 'shared', label: 'Shared Models', icon: <Users size={14} /> }
              ].map(f => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id as any)}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all",
                    filter === f.id ? "bg-white dark:bg-gray-700 shadow-sm text-trimble-blue" : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                  )}
                >
                  {f.icon}
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 bg-gray-50 dark:bg-gray-900/50">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-64 gap-4">
                <Loader2 className="w-8 h-8 text-trimble-blue animate-spin" />
                <p className="text-gray-500 font-medium">Loading models...</p>
              </div>
            ) : filteredModels.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 gap-4 border-2 border-dashed border-gray-200 dark:border-gray-800 rounded-2xl">
                <FolderOpen className="w-12 h-12 text-gray-300" />
                <p className="text-gray-500 font-medium">No models found</p>
                <button 
                  onClick={() => setSearchQuery('')}
                  className="text-trimble-blue text-sm font-bold hover:underline"
                >
                  Clear search
                </button>
              </div>
            ) : viewMode === 'grid' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredModels.map(model => (
                  <ModelCard 
                    key={model.id} 
                    model={model} 
                    currentUserId={user?.uid}
                    onOpen={() => handleOpenRequest(model)}
                    onDelete={(e: any) => {
                      e.stopPropagation();
                      setDeleteConfirmId(model.id);
                    }}
                    onCopy={(e) => handleCopy(e, model)}
                    onTogglePublic={(e) => togglePublicStatus(e, model)}
                    onPasswordLabelClick={(e) => handlePasswordLabelClick(e, model)}
                  />
                ))}
              </div>
            ) : (
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
                    <tr>
                      <th className="px-6 py-3 font-bold text-gray-500 uppercase text-[10px]">Name</th>
                      <th className="px-6 py-3 font-bold text-gray-500 uppercase text-[10px]">Creator</th>
                      <th className="px-6 py-3 font-bold text-gray-500 uppercase text-[10px]">Last Modified</th>
                      <th className="px-6 py-3 font-bold text-gray-500 uppercase text-[10px]">Status</th>
                      <th className="px-6 py-3 font-bold text-gray-500 uppercase text-[10px] text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {filteredModels.map(model => (
                      <ModelRow 
                        key={model.id} 
                        model={model} 
                        currentUserId={user?.uid}
                        onOpen={() => handleOpenRequest(model)}
                      onDelete={(e: any) => {
                        e.stopPropagation();
                        setDeleteConfirmId(model.id);
                      }}
                        onCopy={(e) => handleCopy(e, model)}
                        onTogglePublic={(e) => togglePublicStatus(e, model)}
                        onPasswordLabelClick={(e) => handlePasswordLabelClick(e, model)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </motion.div>

        {/* Password Modal */}
        <AnimatePresence>
          {isPasswordModalOpen && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white dark:bg-gray-900 rounded-2xl p-6 shadow-2xl border border-gray-200 dark:border-gray-800 w-full max-w-sm"
              >
                <div className="flex items-center gap-3 mb-4 text-trimble-blue">
                  <Lock size={24} />
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">Protected Model</h3>
                </div>
                <p className="text-sm text-gray-500 mb-6">This model is password protected. Please enter the password to open it.</p>
                <div className="space-y-4">
                  <div className="relative">
                    <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                    <input 
                      type="password"
                      placeholder="Enter password"
                      value={passwordToTry}
                      onChange={(e) => setPasswordToTry(e.target.value)}
                      className={cn(
                        "w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-gray-800 border rounded-xl outline-none transition-all text-gray-900 dark:text-white",
                        passwordError ? "border-red-500 ring-2 ring-red-500/20" : "border-gray-200 dark:border-gray-700 focus:border-trimble-blue"
                      )}
                      autoFocus
                    />
                  </div>
                  {passwordError && <p className="text-xs text-red-500 font-medium">Incorrect password. Please try again.</p>}
                  <div className="flex gap-3 pt-2">
                    <button 
                      onClick={() => setIsPasswordModalOpen(false)}
                      className="flex-1 py-2 text-sm font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={handlePasswordSubmit}
                      className="flex-1 py-2 bg-trimble-blue text-white text-sm font-bold rounded-xl hover:bg-trimble-blue/90 shadow-lg shadow-trimble-blue/20 transition-all"
                    >
                      Open Model
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Delete Confirmation Modal */}
        <AnimatePresence>
          {deleteConfirmId && (
            <div className="fixed inset-0 z-[250] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white dark:bg-gray-900 rounded-2xl p-6 shadow-2xl border border-gray-200 dark:border-gray-800 w-full max-w-sm"
              >
                <div className="flex items-center gap-3 mb-4 text-red-500">
                  <Trash2 size={24} />
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">Delete Model?</h3>
                </div>
                <p className="text-sm text-gray-500 mb-6">
                  Are you sure you want to delete this model? This action cannot be undone.
                </p>
                <div className="flex gap-3 pt-2">
                  <button 
                    onClick={() => setDeleteConfirmId(null)}
                    disabled={isDeleting}
                    className="flex-1 py-2.5 text-sm font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={() => handleDelete(deleteConfirmId)}
                    disabled={isDeleting}
                    className="flex-1 py-2.5 bg-red-500 text-white text-sm font-bold rounded-xl hover:bg-red-600 shadow-lg shadow-red-500/20 transition-all disabled:opacity-50"
                  >
                    {isDeleting ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Share Modal */}
        <AnimatePresence>
          {isShareModalOpen && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white dark:bg-gray-900 rounded-2xl p-6 shadow-2xl border border-gray-200 dark:border-gray-800 w-full max-w-md"
              >
                <div className="flex items-center gap-3 mb-4 text-trimble-blue">
                  <Globe size={24} />
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">Share Model</h3>
                </div>
                <p className="text-sm text-gray-500 mb-6">Making this model public allows other users to view and copy it.</p>
                
                <div className="space-y-6">
                  <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
                    <div className="flex items-center gap-3">
                      <div className={cn("p-2 rounded-lg", usePassword ? "bg-orange-100 text-orange-600" : "bg-green-100 text-green-600")}>
                        {usePassword ? <ShieldAlert size={20} /> : <Shield size={20} />}
                      </div>
                      <div>
                        <div className="text-sm font-bold text-gray-900 dark:text-white">Password Protection</div>
                        <div className="text-xs text-gray-500">{usePassword ? 'Only users with password can open' : 'Anyone can open this model'}</div>
                      </div>
                    </div>
                    <button 
                      onClick={() => setUsePassword(!usePassword)}
                      className={cn(
                        "w-10 h-5 rounded-full relative transition-colors",
                        usePassword ? "bg-trimble-blue" : "bg-gray-300 dark:bg-gray-700"
                      )}
                    >
                      <div className={cn(
                        "absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-all",
                        usePassword ? "left-5.5" : "left-0.5"
                      )} />
                    </button>
                  </div>

                  {usePassword && (
                    <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Set Password</label>
                      <div className="relative">
                        <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                        <input 
                          type="text"
                          placeholder="Enter sharing password"
                          value={sharePassword}
                          onChange={(e) => setSharePassword(e.target.value)}
                          className="w-full pl-10 pr-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl outline-none focus:border-trimble-blue text-gray-900 dark:text-white"
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex gap-3 pt-2">
                    <button 
                      onClick={() => setIsShareModalOpen(false)}
                      className="flex-1 py-2.5 text-sm font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={handleShareSubmit}
                      className="flex-1 py-2.5 bg-trimble-blue text-white text-sm font-bold rounded-xl hover:bg-trimble-blue/90 shadow-lg shadow-trimble-blue/20 transition-all"
                    >
                      Make Public
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </AnimatePresence>
  );
}

function ModelCard({ model, currentUserId, onOpen, onDelete, onCopy, onTogglePublic, onPasswordLabelClick }: any) {
  const isOwner = model.userId === currentUserId;
  
  return (
    <div 
      onClick={onOpen}
      className="group relative bg-white dark:bg-gray-800 rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700 hover:border-trimble-blue dark:hover:border-trimble-blue shadow-sm hover:shadow-xl transition-all cursor-pointer flex flex-col"
    >
      <div className="relative aspect-video bg-gray-100 dark:bg-gray-900 overflow-hidden">
        <img 
          src={model.previewUrl || 'https://picsum.photos/seed/model/400/225'} 
          alt={model.name} 
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" 
          referrerPolicy="no-referrer" 
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
          <button className="w-full py-2 bg-white text-gray-900 rounded-xl text-xs font-bold shadow-lg flex items-center justify-center gap-2">
            <FolderOpen size={14} />
            Open Model
          </button>
        </div>
        
        {/* Badges */}
        <div className="absolute top-3 left-3 flex flex-col gap-2">
          {model.isPublic && (
            <div className="px-2 py-1 bg-trimble-blue/90 text-white rounded-lg text-[10px] font-bold flex items-center gap-1.5 backdrop-blur-sm">
              <Globe size={10} />
              Public
            </div>
          )}
          {model.hasPassword && (
            <div 
              onClick={(e) => onPasswordLabelClick(e, model)}
              className={cn(
                "px-2 py-1 bg-orange-500/90 text-white rounded-lg text-[10px] font-bold flex items-center gap-1.5 backdrop-blur-sm",
                isOwner && "hover:bg-orange-600 cursor-pointer"
              )}
            >
              <Lock size={10} />
              Protected
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="absolute top-3 right-3 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          {isOwner ? (
            <>
              <button 
                onClick={onTogglePublic}
                className={cn(
                  "p-2 rounded-xl shadow-lg backdrop-blur-md transition-all",
                  model.isPublic ? "bg-trimble-blue text-white" : "bg-white/90 text-gray-600 hover:bg-white"
                )}
                title={model.isPublic ? "Make Private" : "Make Public"}
              >
                <Globe size={16} />
              </button>
              <button 
                onClick={onDelete}
                className="p-2 bg-white/90 text-gray-600 hover:bg-red-500 hover:text-white rounded-xl shadow-lg backdrop-blur-md transition-all"
                title="Delete Model"
              >
                <Trash2 size={16} />
              </button>
            </>
          ) : (
            <button 
              onClick={onCopy}
              className="p-2 bg-white/90 text-trimble-blue hover:bg-trimble-blue hover:text-white rounded-xl shadow-lg backdrop-blur-md transition-all"
              title="Copy to My Library"
            >
              <Copy size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="p-4">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-bold text-sm text-gray-900 dark:text-white truncate">{model.name}</h3>
        </div>
        <div className="flex items-center justify-between">
          <div className="text-[10px] text-gray-400">
            {isOwner ? 'You created this' : `By ${model.userName || 'Unknown'}`}
          </div>
          <div className="text-[10px] text-gray-400">
            {safelyToDate(model.updatedAt).toLocaleDateString()}
          </div>
        </div>
      </div>
    </div>
  );
}

function ModelRow({ model, currentUserId, onOpen, onDelete, onCopy, onTogglePublic, onPasswordLabelClick }: any) {
  const isOwner = model.userId === currentUserId;

  return (
    <tr 
      onClick={onOpen}
      className="hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition-colors group"
    >
      <td className="px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-900 shrink-0">
            <img 
              src={model.previewUrl || 'https://picsum.photos/seed/model/100/100'} 
              alt={model.name} 
              className="w-full h-full object-cover" 
              referrerPolicy="no-referrer" 
            />
          </div>
          <span className="font-bold text-gray-900 dark:text-white truncate">{model.name}</span>
        </div>
      </td>
      <td className="px-6 py-4 text-gray-500 dark:text-gray-400">
        {isOwner ? <span className="text-trimble-blue font-medium">You</span> : model.userName || 'Unknown'}
      </td>
      <td className="px-6 py-4 text-gray-500 dark:text-gray-400">
        {safelyToDate(model.updatedAt).toLocaleDateString()}
      </td>
      <td className="px-6 py-4">
        <div className="flex items-center gap-2">
          {model.isPublic ? (
            <span className="px-2 py-0.5 bg-trimble-blue/10 text-trimble-blue rounded text-[10px] font-bold flex items-center gap-1">
              <Globe size={10} /> Public
            </span>
          ) : (
            <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-400 rounded text-[10px] font-bold flex items-center gap-1">
              <Lock size={10} /> Private
            </span>
          )}
          {model.hasPassword && (
            <span 
              onClick={(e) => onPasswordLabelClick(e, model)}
              className={cn(
                "px-2 py-0.5 bg-orange-100 dark:bg-orange-900/20 text-orange-600 rounded text-[10px] font-bold flex items-center gap-1",
                isOwner && "hover:bg-orange-200 dark:hover:bg-orange-800/40 cursor-pointer"
              )}
            >
              <Key size={10} /> Protected
            </span>
          )}
        </div>
      </td>
      <td className="px-6 py-4 text-right">
        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {isOwner ? (
            <>
              <button 
                onClick={onTogglePublic}
                className="p-2 text-gray-400 hover:text-trimble-blue hover:bg-trimble-blue/10 rounded-lg transition-all"
                title={model.isPublic ? "Make Private" : "Make Public"}
              >
                <Globe size={16} />
              </button>
              <button 
                onClick={onDelete}
                className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
                title="Delete Model"
              >
                <Trash2 size={16} />
              </button>
            </>
          ) : (
            <button 
              onClick={onCopy}
              className="p-2 text-trimble-blue hover:bg-trimble-blue/10 rounded-lg transition-all"
              title="Copy to My Library"
            >
              <Copy size={16} />
            </button>
          )}
          <button className="p-2 text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-all">
            <ChevronRight size={16} />
          </button>
        </div>
      </td>
    </tr>
  );
}

function LoaderIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
