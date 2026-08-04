import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MessageSquare, X, Send, Minus, Maximize2, User, PanelRightClose } from 'lucide-react';
import { useApp } from '../AppContext';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { cn } from '../lib/utils';

export default function Messaging() {
  const { 
    isMessagingOpen, 
    setIsMessagingOpen, 
    isMessagingCollapsed, 
    setIsMessagingCollapsed,
    isMessagingDocked,
    setIsMessagingDocked,
    chatMessages,
    user,
    currentModelId,
    theme,
    diagLog
  } = useApp();

  const [inputText, setInputText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages, isMessagingOpen, isMessagingCollapsed]);

  useEffect(() => {
    if (isMessagingOpen) {
      diagLog('UI', 'Messaging Component Mounted', { currentModelId });
    }
  }, [isMessagingOpen, currentModelId]);

  if (!currentModelId) return null;

  const handleSend = async () => {
    if (!inputText.trim() || !user) return;

    try {
      diagLog('UI', 'Sending project message', { text: inputText.trim().slice(0, 20) + '...' });
      const path = `models/${currentModelId}/messages`;
      await addDoc(collection(db, 'models', currentModelId, 'messages'), {
        uid: user.uid,
        displayName: user.displayName || 'Anonymous',
        text: inputText.trim(),
        timestamp: Date.now()
      });
      setInputText('');
    } catch (err) {
      console.error('Failed to send message:', err);
      handleFirestoreError(err, OperationType.CREATE, `models/${currentModelId}/messages`);
    }
  };

  return (
    <motion.div
      drag={!isMessagingDocked}
      dragMomentum={false}
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ 
        opacity: 1, 
        y: 0, 
        scale: 1,
        height: isMessagingCollapsed ? '48px' : '400px',
        width: '320px'
      }}
      exit={{ opacity: 0, y: 20, scale: 0.95 }}
      className={cn(
        "fixed bottom-20 right-4 z-[200] border shadow-floating overflow-hidden flex flex-col transition-all duration-300",
        theme === 'dark' ? "bg-gray-900 border-gray-700 shadow-black/50" : "bg-white border-gray-200 shadow-xl",
        "rounded-2xl",
        isMessagingDocked ? "relative bottom-0 right-0 w-full h-full shadow-none border-none rounded-none" : "fixed"
      )}
    >
      {/* Header */}
      <div className={cn(
        "px-4 h-12 flex items-center justify-between shrink-0 border-b cursor-pointer select-none",
        theme === 'dark' ? "border-gray-800 bg-gray-800" : "border-gray-100 bg-gray-50",
        !isMessagingDocked ? "cursor-move active:cursor-grabbing" : "cursor-default"
      )} onClick={() => !isMessagingDocked && setIsMessagingCollapsed(!isMessagingCollapsed)}>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-trimble-blue animate-pulse" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Project Messaging</span>
        </div>
        <div className="flex items-center gap-1">
          <button 
            onClick={(e) => { e.stopPropagation(); setIsMessagingDocked(!isMessagingDocked); }}
            className={cn(
              "p-1.5 hover:bg-black/5 rounded-lg transition-colors",
              isMessagingDocked ? "text-trimble-blue bg-trimble-blue/10" : "text-gray-400"
            )}
            title={isMessagingDocked ? "Undock Messaging" : "Dock Messaging"}
          >
            <PanelRightClose size={14} />
          </button>
          {!isMessagingDocked && (
            <>
              <button 
                onClick={(e) => { e.stopPropagation(); setIsMessagingCollapsed(!isMessagingCollapsed); }}
                className="p-1.5 hover:bg-black/5 rounded-lg transition-colors text-gray-400"
              >
                {isMessagingCollapsed ? <Maximize2 size={14} /> : <Minus size={14} />}
              </button>
              <button 
                onClick={(e) => { e.stopPropagation(); setIsMessagingOpen(false); }}
                className="p-1.5 hover:bg-black/5 rounded-lg transition-colors text-red-500"
              >
                <X size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      <AnimatePresence>
        {!isMessagingCollapsed && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col min-h-0"
          >
            {/* Messages Area */}
            <div 
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide"
            >
              {chatMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-2 opacity-50">
                  <MessageSquare size={32} strokeWidth={1.5} />
                  <span className="text-[10px] uppercase font-bold tracking-widest">No messages yet</span>
                </div>
              ) : (
                chatMessages.map((msg) => {
                  const isMine = msg.uid === user?.uid;
                  return (
                    <div 
                      key={msg.id} 
                      className={cn(
                        "flex flex-col gap-1",
                        isMine ? "items-end" : "items-start"
                      )}
                    >
                      <div className="flex items-center gap-1.5 px-1">
                        {!isMine && <User size={10} className="text-gray-400" />}
                        <span className="text-[8px] font-bold text-gray-500 uppercase">{msg.displayName}</span>
                      </div>
                      <div className={cn(
                        "max-w-[85%] px-3 py-2 rounded-2xl text-xs shadow-sm",
                        isMine 
                          ? "bg-trimble-blue text-white rounded-tr-none" 
                          : "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-tl-none"
                      )}>
                        {msg.text}
                      </div>
                      <span className="text-[7px] text-gray-400 px-1 italic">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            {/* Input Area */}
            <div className={cn(
              "p-3 border-t",
              theme === 'dark' ? "border-gray-800" : "border-gray-100"
            )}>
              <div className="relative flex items-center">
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                  placeholder="Type a message..."
                  className={cn(
                    "w-full pl-4 pr-12 py-2.5 rounded-full text-xs transition-all outline-none border focus:ring-2 focus:ring-trimble-blue/20",
                    theme === 'dark' ? "bg-gray-950 border-gray-700 text-white" : "bg-gray-50 border-gray-200 text-gray-900"
                  )}
                />
                <button
                  onClick={handleSend}
                  disabled={!inputText.trim()}
                  className={cn(
                    "absolute right-1 p-2 rounded-full transition-all",
                    inputText.trim() 
                      ? "bg-trimble-blue text-white shadow-lg hover:scale-105 active:scale-95" 
                      : "text-gray-300"
                  )}
                >
                  <Send size={14} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
