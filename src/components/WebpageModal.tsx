import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ExternalLink, Globe } from 'lucide-react';
import { useApp } from '../AppContext';

export default function WebpageModal() {
  const { embeddedWebpageUrl, setEmbeddedWebpageUrl, theme } = useApp();

  if (!embeddedWebpageUrl) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[1001] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className="w-full max-w-6xl h-[90vh] bg-white dark:bg-[#172030] rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800 flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="h-14 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between px-6 bg-gray-50 dark:bg-black/20">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-trimble-blue/10 flex items-center justify-center">
                <Globe className="w-5 h-5 text-trimble-blue" />
              </div>
              <div className="flex flex-col">
                <span className="font-bold text-gray-900 dark:text-white text-sm leading-tight">Embedded Webpage</span>
                <span className="text-[10px] text-gray-500 dark:text-gray-400 font-medium truncate max-w-md">{embeddedWebpageUrl}</span>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <a 
                href={embeddedWebpageUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                className="p-2 hover:bg-gray-200 dark:hover:bg-white/10 rounded-full transition-all text-gray-500 hover:text-gray-900 dark:hover:text-white"
                title="Open in new tab"
              >
                <ExternalLink size={18} />
              </a>
              <button 
                onClick={() => setEmbeddedWebpageUrl(null)}
                className="p-2 hover:bg-gray-200 dark:hover:bg-white/10 rounded-full transition-all group"
              >
                <X size={20} className="text-gray-500 group-hover:text-gray-900 dark:group-hover:text-white transition-colors" />
              </button>
            </div>
          </div>

          {/* Iframe Content */}
          <div className="flex-1 bg-white relative">
            <iframe 
              src={embeddedWebpageUrl}
              className="w-full h-full border-none"
              title="Embedded Resource"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          </div>
          
          {/* Footer Warning */}
          <div className="px-4 py-2 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-black/30 flex items-center justify-center">
            <p className="text-[10px] text-gray-400 font-medium italic">
              Note: Some websites may restrict being displayed in an iframe for security reasons.
            </p>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
