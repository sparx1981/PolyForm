import { useState, useEffect } from 'react';
import { Eye } from 'lucide-react';
import { useApp } from '../../AppContext';

export default function LookModeOverlay() {
  const { activeTool, setActiveTool } = useApp();
  const [hintDismissed, setHintDismissed] = useState(false);

  useEffect(() => {
    if (activeTool === 'look') {
      setHintDismissed(false);
      const timer = window.setTimeout(() => {
        setHintDismissed(true);
      }, 5000);
      return () => window.clearTimeout(timer);
    }
  }, [activeTool]);

  if (activeTool !== 'look') return null;

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[800] pointer-events-none transition-opacity duration-300">
      <div className="bg-gray-900/90 dark:bg-gray-950/90 text-white text-xs px-3.5 py-2 rounded-xl shadow-2xl border border-gray-700/80 backdrop-blur-md flex items-center gap-2.5 pointer-events-auto">
        <div className="w-5 h-5 rounded-md bg-blue-500/20 text-blue-400 flex items-center justify-center shrink-0">
          <Eye size={13} />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-gray-200">Look Tool:</span>
          <span className="text-gray-300">Click to lock mouse or drag to look</span>
          <span className="text-gray-500 font-mono text-[10px]">· Esc to unlock</span>
        </div>
        <button
          type="button"
          onClick={() => setActiveTool('select')}
          className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-white/10 hover:bg-white/20 text-gray-300 hover:text-white transition-colors cursor-pointer"
        >
          Exit
        </button>
      </div>
    </div>
  );
}
