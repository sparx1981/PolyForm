import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Sparkles, Loader2, Wand2, AlertCircle, Box, Info } from 'lucide-react';
import { useApp } from '../AppContext';
import { GoogleGenAI, Type } from "@google/genai";
import { cn } from '../lib/utils';
import { Shape } from '../types';

export default function AIGenerate() {
  const { isAIGenerateOpen, setIsAIGenerateOpen, theme, addShape, recordAction, shapes } = useApp();
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    setIsGenerating(true);
    setError(null);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
      
      const systemInstruction = `You are a 3D architectural design assistant. Your task is to generate 3D models based on user prompts.
      You must return a JSON array of Shape objects that will be added to the scene.
      
      Each Shape object MUST have:
      - type: 'box', 'prism', 'sphere', 'cone', 'pyramid', 'donut', 'dome'
      - position: [x, y, z] (keep within [-20, 20] range for all axes)
      - rotation: [x, y, z] (in radians)
      - scale: [1, 1, 1] (usually just use scale 1 and define size in args)
      - color: hex string (e.g. '#ff0000')
      - args: array of numbers based on type:
        - box: [width, height, depth]
        - prism: [radius, radius, height, segments (e.g. 32)]
        - sphere: [radius, widthSegments, heightSegments]
        - cone: [radius, height, radialSegments]
        - pyramid: [radius, height, 4]
        - donut: [radius, tubeRadius, radialSegments, tubularSegments]
        - dome: [radius, widthSegments, heightSegments, 0, Math.PI * 2, 0, Math.PI / 2]
      
      The current scene already contains ${shapes.length} objects. Try to place new objects so they make sense relative to the center (0,0,0) or requested layout.
      
      Output ONLY the JSON array. Do not include markdown code blocks or explanations.`;

      const result = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING },
                position: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                rotation: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                scale: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                color: { type: Type.STRING },
                args: { type: Type.ARRAY, items: { type: Type.NUMBER } }
              },
              required: ['type', 'position', 'color', 'args']
            }
          }
        }
      });

      const text = result.text;
      if (!text) throw new Error("No response from AI");

      const generatedShapes = JSON.parse(text);
      if (!Array.isArray(generatedShapes)) throw new Error("AI did not return a valid list of shapes");

      console.log(`[AIGenerate] Generated ${generatedShapes.length} shapes`);
      
      generatedShapes.forEach((s: any) => {
        const id = Math.random().toString(36).substr(2, 9);
        const newShape: Shape = {
          id,
          name: `AI ${s.type}`,
          type: s.type,
          position: s.position || [0, 0, 0],
          rotation: s.rotation || [0, 0, 0],
          scale: s.scale || [1, 1, 1],
          color: s.color || '#ffffff',
          args: s.args || [1, 1, 1],
          roughness: 0.5,
          metalness: 0,
          opacity: 1
        };
        addShape(newShape);
      });

      recordAction(`// AI Generated model from prompt: "${prompt}"\n// Created ${generatedShapes.length} objects.`);
      setIsAIGenerateOpen(false);
      setPrompt('');
    } catch (err: any) {
      console.error('AI Generation Error:', err);
      setError(err.message || 'Failed to generate 3D model. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  if (!isAIGenerateOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800 w-full max-w-xl overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between bg-gray-50 dark:bg-gray-800/50">
            <div className="flex items-center gap-2">
              <Wand2 className="text-purple-500" size={20} />
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">AI 3D Designer</h2>
            </div>
            <button 
              onClick={() => setIsAIGenerateOpen(false)}
              className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              <X size={20} className="text-gray-500" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-3 p-4 bg-purple-50 dark:bg-purple-900/20 rounded-xl border border-purple-100 dark:border-purple-800">
              <Box className="text-purple-500 shrink-0" size={24} />
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Describe a 3D model or structure, and the AI will build it directly in your workspace.
              </p>
            </div>
            
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Model Description</label>
              <div className="relative">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g., A circular amphitheater with 10 rows of seating and a central stage..."
                  className="w-full h-32 p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none resize-none text-sm text-gray-900 dark:text-white transition-all shadow-sm"
                  disabled={isGenerating}
                  autoFocus
                />
                {!prompt && (
                  <div className="absolute top-4 left-4 pointer-events-none text-gray-400 text-sm">
                    {/* Placeholder hint is visible when empty */}
                  </div>
                )}
              </div>
            </div>

            {error && (
              <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 rounded-xl flex items-start gap-3 text-red-600 dark:text-red-400 animate-in fade-in slide-in-from-top-1">
                <AlertCircle size={18} className="shrink-0 mt-0.5" />
                <div className="text-xs font-medium">{error}</div>
              </div>
            )}

            <div className="flex items-center gap-2 pt-2">
               <div className="flex -space-x-2">
                 {[1,2,3,4].map(i => (
                   <div key={i} className="w-6 h-6 rounded-full border-2 border-white dark:border-gray-900 bg-gray-200 dark:bg-gray-800 flex items-center justify-center">
                     <Box size={10} className="text-gray-400" />
                   </div>
                 ))}
               </div>
               <span className="text-[10px] text-gray-400">Join thousands of users building with AI</span>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 flex justify-end items-center gap-3">
            <button
              onClick={() => setIsAIGenerateOpen(false)}
              className="px-6 py-2 text-sm font-bold text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
            <button
              onClick={handleGenerate}
              disabled={isGenerating || !prompt.trim()}
              className="flex items-center gap-2 px-8 py-2.5 bg-gradient-to-r from-purple-600 to-purple-500 text-white rounded-xl hover:from-purple-700 hover:to-purple-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-bold shadow-lg shadow-purple-500/20"
            >
              {isGenerating ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Building...
                </>
              ) : (
                <>
                  <Sparkles size={18} />
                  Generate Model
                </>
              )}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
