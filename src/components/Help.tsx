import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, History, BookOpen, Search, ChevronRight, ExternalLink } from 'lucide-react';
import { useApp } from '../AppContext';
import { CHANGELOG_DATA } from '../constants/changelog';
import { HELP_DOCS } from '../constants/helpDocs';
import { cn } from '../lib/utils';

export default function Help() {
  const { isChangelogOpen, setIsChangelogOpen } = useApp();
  const [activeTab, setActiveTab] = useState<'docs' | 'changelog'>('docs');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTopicId, setSelectedTopicId] = useState<string>(HELP_DOCS[0].id);

  const filteredDocs = useMemo(() => {
    if (!searchQuery.trim()) return HELP_DOCS;
    return HELP_DOCS.filter(doc => 
      doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.content.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [searchQuery]);

  const selectedTopic = useMemo(() => 
    HELP_DOCS.find(t => t.id === selectedTopicId) || HELP_DOCS[0]
  , [selectedTopicId]);

  if (!isChangelogOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="w-full max-w-5xl h-[85vh] bg-[#172030] rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.5)] border border-gray-800 flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="h-16 border-b border-gray-800 flex items-center justify-between px-6 bg-black/20">
            <div className="flex items-center gap-8">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-trimble-blue/20 flex items-center justify-center border border-trimble-blue/30">
                  <BookOpen className="w-5 h-5 text-trimble-blue" />
                </div>
                <span className="font-bold text-white text-lg tracking-tight">Support Center</span>
              </div>
              
              <div className="flex items-center bg-black/40 rounded-xl p-1 border border-gray-700/50">
                {[
                  { id: 'docs', label: 'Documentation', icon: <BookOpen size={14} /> },
                  { id: 'changelog', label: 'Changelog', icon: <History size={14} /> }
                ].map(tab => (
                  <button 
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={cn(
                      "px-5 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-2",
                      activeTab === tab.id 
                        ? "bg-trimble-blue text-white shadow-lg shadow-trimble-blue/20 scale-105" 
                        : "text-gray-400 hover:text-white hover:bg-white/5"
                    )}
                  >
                    {tab.icon}
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
            
            <button 
              onClick={() => setIsChangelogOpen(false)}
              className="p-2 hover:bg-white/10 rounded-full transition-all group"
            >
              <X size={20} className="text-gray-500 group-hover:text-white group-hover:rotate-90 transition-transform duration-300" />
            </button>
          </div>

          {/* Main Content Area */}
          <div className="flex-1 flex overflow-hidden">
            {activeTab === 'docs' ? (
              <>
                {/* Sidebar Navigation */}
                <div className="w-64 border-r border-gray-800 flex flex-col bg-black/10">
                  <div className="p-4">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input 
                        type="text"
                        placeholder="Search topics..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-gray-800/50 border border-gray-700 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-trimble-blue focus:ring-1 focus:ring-trimble-blue/50 transition-all"
                      />
                    </div>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto px-2 pb-4">
                    {['getting-started', 'tools', 'features', 'advanced'].map(category => {
                      const topics = filteredDocs.filter(t => t.category === category);
                      if (topics.length === 0) return null;
                      
                      return (
                        <div key={category} className="mb-4">
                          <h4 className="px-3 mb-2 text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                            {category.replace('-', ' ')}
                          </h4>
                          <div className="space-y-1">
                            {topics.map(topic => (
                              <button
                                key={topic.id}
                                onClick={() => setSelectedTopicId(topic.id)}
                                className={cn(
                                  "w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center justify-between group",
                                  selectedTopicId === topic.id 
                                    ? "bg-trimble-blue text-white shadow-lg shadow-trimble-blue/20" 
                                    : "text-gray-400 hover:bg-white/5 hover:text-white"
                                )}
                              >
                                {topic.title}
                                <ChevronRight className={cn(
                                  "w-3.5 h-3.5 transition-transform",
                                  selectedTopicId === topic.id ? "translate-x-0 opacity-100" : "-translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-100"
                                )} />
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Content Side */}
                <div className="flex-1 overflow-y-auto p-10 bg-transparent">
                  <motion.div
                    key={selectedTopic.id}
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3 }}
                    className="max-w-3xl"
                  >
                    <div className="mb-8">
                      <div className="flex items-center gap-2 mb-4">
                        <span className="text-[10px] font-bold text-trimble-blue uppercase tracking-widest px-2.5 py-1 bg-trimble-blue/10 rounded-lg border border-trimble-blue/20">
                          {selectedTopic.category.replace('-', ' ')}
                        </span>
                      </div>
                      <h2 className="text-4xl font-extrabold text-white tracking-tight mb-4">
                        {selectedTopic.title}
                      </h2>
                      <div className="h-1 w-20 bg-trimble-blue rounded-full mb-8" />
                    </div>

                    <div className="prose prose-invert max-w-none">
                      <p className="text-gray-300 text-lg leading-relaxed mb-10">
                        {selectedTopic.content}
                      </p>

                      {selectedTopic.steps && (
                        <div className="space-y-8">
                          <h3 className="text-lg font-bold text-white flex items-center gap-3">
                            <span className="w-1.5 h-8 bg-trimble-blue rounded-full" />
                            Guide
                          </h3>
                          <div className="grid gap-4">
                            {selectedTopic.steps.map((step, i) => (
                              <div key={i} className="flex gap-5 p-6 bg-white/5 rounded-3xl border border-gray-700/50 backdrop-blur-sm group hover:border-trimble-blue/50 transition-colors">
                                <span className="flex-shrink-0 w-8 h-8 rounded-full bg-trimble-blue text-white flex items-center justify-center text-sm font-bold shadow-lg shadow-trimble-blue/20 group-hover:scale-110 transition-transform">
                                  {i + 1}
                                </span>
                                <p className="text-base text-gray-200 leading-relaxed font-medium pt-0.5">
                                  {step}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {/* Visual Guide Box */}
                      <div className="mt-16 p-12 border-2 border-dashed border-gray-700/50 rounded-[2rem] flex flex-col items-center justify-center text-center bg-black/20">
                        <div className="w-16 h-16 bg-trimble-blue/10 rounded-2xl flex items-center justify-center mb-6 border border-trimble-blue/20">
                          <BookOpen className="w-8 h-8 text-trimble-blue" />
                        </div>
                        <h4 className="text-lg font-bold text-white mb-2">Detailed Visual Instructions</h4>
                        <p className="text-gray-400 max-w-md mx-auto">
                          Most controls feature contextual tooltips. Hover over interface elements in the 3D viewport for help.
                        </p>
                      </div>
                    </div>
                  </motion.div>
                </div>
              </>
            ) : (
              <div className="flex-1 overflow-y-auto p-10 bg-transparent">
                <div className="max-w-2xl mx-auto space-y-16">
                  {CHANGELOG_DATA.map((release, i) => (
                    <div key={i} className="relative pl-12">
                      {/* Timeline Line */}
                      <div className="absolute left-[15px] top-3 bottom-[-4rem] w-0.5 bg-gray-800" />
                      
                      {/* Timeline Dot */}
                      <div className="absolute left-0 top-1 w-8 h-8 rounded-full border-4 border-[#172030] bg-trimble-blue flex items-center justify-center shadow-[0_0_20px_rgba(0,126,255,0.4)] z-10" />

                      <div className="mb-6">
                        <div className="flex items-center gap-4 mb-2">
                          <h3 className="text-2xl font-black text-white tracking-tight">
                            Latest Updates
                          </h3>
                          <span className="text-xs font-bold text-gray-400 bg-gray-800/50 px-3 py-1 rounded-full border border-gray-700">
                            {release.date}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-4">
                        {release.items.map((item, j) => (
                          <div key={j} className="p-5 bg-white/5 rounded-[1.5rem] border border-gray-700/50 backdrop-blur-sm flex gap-4 group hover:bg-white/10 transition-colors">
                            <div className="w-1.5 h-1.5 rounded-full bg-trimble-blue mt-2.5 shrink-0 animate-pulse" />
                            <p className="text-base text-gray-200 leading-relaxed">
                              {item}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="h-12 px-6 border-t border-gray-800 flex items-center justify-between text-[11px] text-gray-500 font-bold uppercase tracking-[0.2em] bg-black/30">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span>System Operational</span>
            </div>
            <div className="flex items-center gap-8">
              <a href="#" className="hover:text-trimble-blue transition-colors flex items-center gap-2 group">
                Support Hub <ExternalLink size={12} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </a>
              <a href="#" className="hover:text-trimble-blue transition-colors flex items-center gap-2 group">
                Community <ExternalLink size={12} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </a>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
