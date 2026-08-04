import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Send, Sparkles, Loader2 } from 'lucide-react';
import { useApp } from '../AppContext';
import { GoogleGenAI } from "@google/genai";

export default function AIQuery() {
  const { isAIQueryOpen, setIsAIQueryOpen, shapes, tags } = useApp();
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);

  const handleQuery = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setResponse('');

    try {
      const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

      const modelMetadata = JSON.stringify(shapes.map(s => ({
        type: s.type,
        position: s.position,
        args: s.args,
        color: s.color,
        tags: (s.tags || []).map(tagId => tags.find(t => t.id === tagId)?.name).filter(Boolean)
      })));

      const systemPrompt = `You are an expert 3D model assistant. You have access to the metadata of a 3D model in JSON format.
      Answer the user's question about the model based on this data.
      
      CRITICAL: Distinguish between "tags" (also known as labels) and "color" (also known as materials). 
      A shape might be colored "blue" but tagged as "green". If the user asks for items with a specific tag, ONLY look at the "tags" array.
      
      Model Data: ${modelMetadata}
      
      Common questions:
      - How tall is it? (Check Y position + height in args)
      - How many items? (Count items in array)
      - Volume? (Calculate based on args)
      - Tags/Labels? (Check the "tags" array for each item)
      
      Be concise, accurate, and helpful.`;

      const result = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: systemPrompt }, { text: prompt }] }]
      });
      
      setResponse(result.candidates?.[0]?.content?.parts?.[0]?.text || 'No response from AI.');
    } catch (err) {
      console.error('AI Query error:', err);
      setResponse('Sorry, I couldn\'t analyze the model right now.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isAIQueryOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800 w-full max-w-lg overflow-hidden flex flex-col"
          >
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between bg-gray-50 dark:bg-gray-800/50">
              <div className="flex items-center gap-2 text-trimble-blue">
                <Sparkles size={20} />
                <h2 className="text-lg font-bold">AI Model Query</h2>
              </div>
              <button 
                onClick={() => setIsAIQueryOpen(false)} 
                className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                <X size={20} className="text-gray-500" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 min-h-[100px] max-h-[300px] overflow-y-auto text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap border border-gray-100 dark:border-gray-700">
                {loading ? (
                  <div className="flex flex-col items-center justify-center h-full gap-2 text-trimble-blue py-8">
                    <Loader2 size={24} className="animate-spin" />
                    <span className="font-bold">Analyzing model...</span>
                  </div>
                ) : response ? (
                  response
                ) : (
                  <span className="text-gray-400 italic">Ask me anything about your model! e.g., "How many red items are there?" or "What is the total volume?"</span>
                )}
              </div>

              <div className="relative">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Type your question..."
                  className="w-full pl-4 pr-12 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-trimble-blue focus:border-transparent outline-none resize-none h-24 text-gray-900 dark:text-white"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleQuery();
                    }
                  }}
                />
                <button
                  onClick={handleQuery}
                  disabled={loading || !prompt.trim()}
                  className="absolute right-3 bottom-3 p-2 bg-trimble-blue text-white rounded-lg hover:bg-trimble-blue/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-trimble-blue/20"
                >
                  <Send size={18} />
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
