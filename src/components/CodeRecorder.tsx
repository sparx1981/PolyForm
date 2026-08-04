import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Radio, Square, Play, Save, X, Trash2, Copy, Check } from 'lucide-react';
import { useApp } from '../AppContext';
import { cn } from '../lib/utils';

export function CodeRecorder() {
  const { 
    codeRecorderEnabled, 
    setCodeRecorderEnabled, 
    isRecording, 
    setIsRecording, 
    recordedCode, 
    setRecordedCode,
    setDeveloperScripts,
    setConsoleOutput,
    user
  } = useApp();

  const [isExpanded, setIsExpanded] = useState(true);
  const [copied, setCopied] = useState(false);

  if (!codeRecorderEnabled) return null;

  const handleToggleRecording = () => {
    if (!isRecording) {
      setRecordedCode('// Recorded Actions\n');
    }
    setIsRecording(!isRecording);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(recordedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveToLibrary = () => {
    const scriptName = `Recorded Script ${new Date().toLocaleTimeString()}`;
    const newScript = {
      id: Math.random().toString(36).substr(2, 9),
      userId: user?.uid || 'anonymous',
      name: scriptName,
      code: recordedCode,
      createdAt: new Date().toISOString(),
      pinned: false,
      isPublic: false
    };

    setDeveloperScripts(prev => [...prev, newScript]);
    setConsoleOutput(prev => [...prev, `[SYSTEM] Recorded script saved to library.`]);
    setRecordedCode('');
    setIsRecording(false);
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "fixed bottom-24 left-1/2 -translate-x-1/2 z-[150] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800 flex flex-col overflow-hidden transition-all",
        isExpanded ? "w-80" : "w-12 h-12"
      )}
    >
      {!isExpanded ? (
        <button 
          onClick={() => setIsExpanded(true)}
          className="w-full h-full flex items-center justify-center text-trimble-blue hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          <Radio className={cn("w-6 h-6", isRecording && "animate-pulse text-red-500")} />
        </button>
      ) : (
        <>
          <div className="h-10 px-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gray-50 dark:bg-gray-800/50">
            <div className="flex items-center gap-2">
              <Radio className={cn("w-4 h-4", isRecording ? "text-red-500 animate-pulse" : "text-gray-400")} />
              <span className="text-xs font-bold text-gray-700 dark:text-gray-300">Code Recorder</span>
            </div>
            <div className="flex items-center gap-1">
              <button 
                onClick={() => setIsExpanded(false)}
                className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors text-gray-400"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="p-4 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <button 
                onClick={handleToggleRecording}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all",
                  isRecording 
                    ? "bg-red-500 text-white hover:bg-red-600 shadow-lg shadow-red-500/20" 
                    : "bg-trimble-blue text-white hover:bg-trimble-blue/90 shadow-lg shadow-trimble-blue/20"
                )}
              >
                {isRecording ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                {isRecording ? "Stop Recording" : "Start Recording"}
              </button>
              
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setRecordedCode('')}
                  disabled={!recordedCode || isRecording}
                  className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors disabled:opacity-30"
                  title="Clear"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <button 
                  onClick={handleCopy}
                  disabled={!recordedCode}
                  className="p-2 text-gray-400 hover:text-trimble-blue hover:bg-trimble-blue/10 rounded-xl transition-colors disabled:opacity-30"
                  title="Copy"
                >
                  {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="h-32 bg-gray-900 rounded-xl p-3 font-mono text-[10px] text-gray-400 overflow-y-auto border border-gray-800">
              {recordedCode ? (
                <pre className="whitespace-pre-wrap">{recordedCode}</pre>
              ) : (
                <span className="italic text-gray-600">No actions recorded yet...</span>
              )}
            </div>

            <button 
              onClick={handleSaveToLibrary}
              disabled={!recordedCode || isRecording}
              className="w-full py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-xl text-xs font-bold text-gray-700 dark:text-white transition-colors disabled:opacity-30 flex items-center justify-center gap-2"
            >
              <Save className="w-3.5 h-3.5" />
              Save to Library
            </button>
          </div>
        </>
      )}
    </motion.div>
  );
}
