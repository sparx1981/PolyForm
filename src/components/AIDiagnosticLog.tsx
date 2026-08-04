import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useDragControls } from 'motion/react';
import { X, Copy, Terminal, CheckCircle2, Trash2, List, Settings, ChevronDown, ChevronRight, Filter } from 'lucide-react';
import { useApp } from '../AppContext';
import { cn } from '../lib/utils';
import { DiagLogEntry } from '../types';

export default function AIDiagnosticLog() {
  const { isDiagnosticLogOpen, setIsDiagnosticLogOpen, diagnosticLogs, clearDiagnosticLogs } = useApp();
  const [copied, setCopied] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string>('ALL');
  const [isStackExpanded, setIsStackExpanded] = useState(false);
  const [expandedEntries, setExpandedEntries] = useState<Set<number>>(new Set());
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragControls = useDragControls();

  const handleCopy = () => {
    if (diagnosticLogs.length === 0) return;
    
    let textToCopy = `=== AI DIAGNOSTIC LOG ===\n`;
    textToCopy += `App: DraftUp | Stack: Three.js, R3F, React 18, TypeScript, Vite, Firebase\n`;
    textToCopy += `Captured: ${new Date().toISOString()}\n`;
    textToCopy += `========================\n\n`;

    diagnosticLogs.forEach(log => {
      textToCopy += `[${log.time}] [${log.category}] ${log.message}\n`;
      if (log.values && Object.keys(log.values).length > 0) {
        textToCopy += `  values: ${JSON.stringify(log.values, null, 2).replace(/\n/g, '\n  ')}\n`;
      }
      textToCopy += `\n`;
    });

    textToCopy += `=== END LOG ===`;
    
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleEntry = (index: number) => {
    const next = new Set(expandedEntries);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setExpandedEntries(next);
  };

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [diagnosticLogs, autoScroll]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const isAtBottom = target.scrollHeight - target.scrollTop <= target.clientHeight + 10;
    setAutoScroll(isAtBottom);
  };

  const filteredLogs = activeFilter === 'ALL' 
    ? diagnosticLogs 
    : diagnosticLogs.filter(l => l.category === activeFilter);

  const categories = ['ALL', 'RENDER', 'FRAME', 'TEXTURE', 'EFFECT', 'EVENT', 'ERROR'];

  const getCategoryColor = (cat: string) => {
    switch(cat) {
      case 'TEXTURE': return 'bg-teal-500/20 text-teal-400 border-teal-500/30';
      case 'FRAME': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'RENDER': return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
      case 'EFFECT': return 'bg-yellow-500/20 text-yellow-500 border-yellow-500/30';
      case 'ERROR': return 'bg-red-500/20 text-red-400 border-red-500/30';
      default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  if (!isDiagnosticLogOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999] pointer-events-none flex items-end justify-end p-6">
        <motion.div
          drag
          dragControls={dragControls}
          dragListener={false}
          dragMomentum={false}
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          className="w-[480px] h-[320px] bg-[#141922]-/95 backdrop-blur-md rounded-xl shadow-2xl border border-gray-800 flex flex-col overflow-hidden pointer-events-auto"
          style={{ backgroundColor: '#141922', color: '#e2e8f0' }}
        >
          {/* Header */}
          <div 
            onPointerDown={(e) => dragControls.start(e)}
            className="h-12 border-b border-gray-800 flex items-center justify-between px-4 bg-black/20 cursor-grab active:cursor-grabbing select-none shrink-0"
          >
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-[#2dd4bf]" />
              <span className="font-bold text-sm tracking-tight">AI Diagnostic Log</span>
              <span className="bg-[#2dd4bf]/20 text-[#2dd4bf] text-[10px] px-1.5 py-0.5 rounded-full font-mono border border-[#2dd4bf]/30">
                {diagnosticLogs.length}
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              <button 
                onClick={clearDiagnosticLogs}
                className="p-1.5 hover:bg-white/5 rounded text-gray-400 hover:text-white transition-colors"
                title="Clear Logs"
              >
                <Trash2 size={14} />
              </button>
              <button 
                onClick={handleCopy}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-all",
                  copied ? "bg-green-600 text-white" : "bg-[#2dd4bf] text-black hover:bg-[#2dd4bf]/90"
                )}
              >
                {copied ? <CheckCircle2 size={12} /> : <Copy size={12} />}
                {copied ? 'Copied' : 'Copy All'}
              </button>
              <button 
                onClick={() => setIsDiagnosticLogOpen(false)}
                className="p-1.5 hover:bg-white/5 rounded text-gray-400 hover:text-white transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-hidden flex flex-col">
            {/* Tech Stack */}
            <div className="border-b border-gray-800">
              <button 
                onClick={() => setIsStackExpanded(!isStackExpanded)}
                className="w-full px-4 py-2 flex items-center justify-between hover:bg-white/5 transition-colors group"
              >
                <div className="flex items-center gap-2">
                  <Settings className="w-3 h-3 text-gray-500 group-hover:text-gray-300" />
                  <span className="text-[10px] uppercase font-bold tracking-widest text-gray-500 group-hover:text-gray-300">Tech Stack</span>
                </div>
                {isStackExpanded ? <ChevronDown size={12} className="text-gray-500" /> : <ChevronRight size={12} className="text-gray-500" />}
              </button>
              {isStackExpanded && (
                <div className="px-4 py-3 bg-black/20 grid grid-cols-3 gap-2 text-[10px] font-mono text-gray-400">
                  <div className="flex items-center gap-1.5"><div className="w-1 h-1 bg-[#2dd4bf] rounded-full" /> Three.js r183</div>
                  <div className="flex items-center gap-1.5"><div className="w-1 h-1 bg-[#2dd4bf] rounded-full" /> React 19</div>
                  <div className="flex items-center gap-1.5"><div className="w-1 h-1 bg-[#2dd4bf] rounded-full" /> R3F v9</div>
                  <div className="flex items-center gap-1.5"><div className="w-1 h-1 bg-[#2dd4bf] rounded-full" /> TypeScript 5</div>
                  <div className="flex items-center gap-1.5"><div className="w-1 h-1 bg-[#2dd4bf] rounded-full" /> Vite 6</div>
                  <div className="flex items-center gap-1.5"><div className="w-1 h-1 bg-[#2dd4bf] rounded-full" /> Firebase 10</div>
                </div>
              )}
            </div>

            {/* Filter Bar */}
            <div className="px-3 py-2 border-b border-gray-800 flex items-center gap-1.5 overflow-x-auto no-scrollbar bg-black/10">
              <Filter className="w-3 h-3 text-gray-500 flex-shrink-0 ml-1" />
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setActiveFilter(cat)}
                  className={cn(
                    "px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider transition-all whitespace-nowrap border",
                    activeFilter === cat 
                      ? "bg-[#2dd4bf] text-black border-[#2dd4bf]" 
                      : "bg-white/5 text-gray-500 border-transparent hover:border-gray-700"
                  )}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Log Feed */}
            <div 
              ref={scrollRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto p-2 space-y-1 font-mono text-[11px] relative no-scrollbar"
            >
              {filteredLogs.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center opacity-20 gap-2">
                  <List size={24} />
                  <span className="text-[10px] uppercase tracking-widest">No active logs</span>
                </div>
              ) : (
                filteredLogs.map((log, i) => (
                  <div key={i} className="group border border-transparent hover:border-white/5 hover:bg-white/[0.02] rounded px-2 py-1 transition-all">
                    <div className="flex items-start gap-3">
                      <span className="text-gray-600 shrink-0 mt-0.5">{log.time}</span>
                      <span className={cn(
                        "text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider border shrink-0 mt-0.5",
                        getCategoryColor(log.category)
                      )}>
                        {log.category}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-gray-300 break-words leading-relaxed">{log.message}</span>
                          {log.values && Object.keys(log.values).length > 0 && (
                            <button 
                              onClick={() => toggleEntry(i)}
                              className="mt-0.5 p-0.5 hover:bg-white/10 rounded transition-colors text-gray-500"
                            >
                              {expandedEntries.has(i) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                          )}
                        </div>
                        {expandedEntries.has(i) && log.values && (
                          <motion.pre 
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            className="mt-2 p-2 bg-black/40 rounded text-[10px] text-teal-400 overflow-x-auto border border-white/5"
                          >
                            {JSON.stringify(log.values, null, 2)}
                          </motion.pre>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}

              {!autoScroll && filteredLogs.length > 0 && (
                <button 
                  onClick={() => setAutoScroll(true)}
                  className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-[#2dd4bf] text-black px-3 py-1 rounded-full text-[10px] font-bold shadow-lg animate-bounce flex items-center gap-1"
                >
                  <ChevronDown size={12} />
                  New entries
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
