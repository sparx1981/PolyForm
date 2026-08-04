import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Sparkles, Loader2, Download, AlertCircle, Image as ImageIcon } from 'lucide-react';
import { useApp } from '../AppContext';
import { functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import { cn } from '../lib/utils';

/**
 * BACKEND SPECIFICATION (Firebase Cloud Function)
 * 
 * File: functions/src/index.ts
 * 
 * import * as functions from "firebase-functions";
 * import * as admin from "firebase-admin";
 * import { GoogleGenAI } from "@google/genai";
 * 
 * admin.initializeApp();
 * 
 * export const generateImageTask = functions.https.onCall(async (data, context) => {
 *   if (!context.auth) {
 *     throw new functions.https.HttpsError("unauthenticated", "User must be logged in.");
 *   }
 * 
 *   const uid = context.auth.uid;
 *   const { image, prompt } = data;
 * 
 *   // Rate Limiting: 20 requests per 24 hours
 *   const counterRef = admin.firestore().doc(`users/${uid}/counters/image_generation`);
 *   const counterDoc = await counterRef.get();
 *   const now = Date.now();
 *   const dayInMs = 24 * 60 * 60 * 1000;
 * 
 *   let count = 0;
 *   let lastReset = now;
 * 
 *   if (counterDoc.exists) {
 *     const data = counterDoc.data();
 *     count = data?.count || 0;
 *     lastReset = data?.lastReset || now;
 * 
 *     if (now - lastReset > dayInMs) {
 *       count = 0;
 *       lastReset = now;
 *     }
 *   }
 * 
 *   if (count >= 20) {
 *     return { error: "Daily generation limit (20) reached. Try again tomorrow." };
 *   }
 * 
 *   try {
 *     const genAI = new GoogleGenAI(process.env.GEMINI_API_KEY || "");
 *     const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
 * 
 *     const result = await model.generateContent([
 *       {
 *         inlineData: {
 *           data: image,
 *           mimeType: "image/png",
 *         },
 *       },
 *       { text: `Reimagine this 3D model as a high-quality, professional architectural render. Style: ${prompt}` },
 *     ]);
 * 
 *     const response = await result.response;
 *     const generatedImage = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
 * 
 *     if (!generatedImage) throw new Error("No image generated");
 * 
 *     // Increment counter
 *     await counterRef.set({ count: count + 1, lastReset }, { merge: true });
 * 
 *     return { image: generatedImage };
 *   } catch (error) {
 *     console.error(error);
 *     return { error: "Failed to generate image" };
 *   }
 * });
 */

export default function AIRenderer() {
  const { isAIRendererOpen, setIsAIRendererOpen, theme } = useApp();
  const [prompt, setPrompt] = useState('');
  const [isRendering, setIsRendering] = useState(false);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRender = async () => {
    if (!prompt.trim()) return;

    setIsRendering(true);
    setError(null);

    try {
      const canvas = document.querySelector('canvas');
      if (!canvas) throw new Error('Canvas not found');
      
      const screenshot = canvas.toDataURL('image/png');
      const base64Data = screenshot.split(',')[1];

      const generateImageTask = httpsCallable(functions, 'generateImageTask');
      const result = await generateImageTask({
        image: base64Data,
        prompt: prompt
      });

      const data = result.data as any;

      if (data.error) {
        throw new Error(data.error);
      }

      if (data.image) {
        setResultImage(`data:image/png;base64,${data.image}`);
      } else {
        throw new Error('AI did not return an image. Please try a different prompt.');
      }

    } catch (err: any) {
      console.error('AI Rendering Full Error:', err);
      // Handle specific Firebase HttpsError codes
      if (err.code === 'unauthenticated') {
        setError('Please log in to use the AI Renderer.');
      } else if (err.code === 'resource-exhausted' || err.message?.includes('limit (20) reached')) {
        setError('Daily generation limit (20) reached. Try again tomorrow.');
      } else if (err.code === 'not-found') {
        setError('AI Service not found. Please check function deployment and region.');
      } else if (err.code === 'internal') {
        setError('Internal Server Error. This usually means the Cloud Function crashed. Please check your Google Cloud Logs for "generateImageTask" to see the specific error (e.g., missing API key or dependency).');
      } else {
        setError(err.message || 'Failed to generate AI render');
      }
    } finally {
      setIsRendering(false);
    }
  };

  const handleDownload = () => {
    if (!resultImage) return;
    const link = document.createElement('a');
    link.href = resultImage;
    link.download = `ai-render-${Date.now()}.png`;
    link.click();
  };

  if (!isAIRendererOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800 w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between bg-gray-50 dark:bg-gray-800/50">
            <div className="flex items-center gap-2">
              <Sparkles className="text-trimble-blue" size={20} />
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">AI Renderer</h2>
            </div>
            <button 
              onClick={() => setIsAIRendererOpen(false)}
              className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              <X size={20} className="text-gray-500" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-6">
            {!resultImage ? (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
                  <ImageIcon className="text-trimble-blue shrink-0" size={24} />
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    Reimagine your 3D model. The AI will transform your current viewport into a professional render.
                  </p>
                </div>
                
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Style Prompt</label>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="e.g., A modern glass villa at sunset with realistic lighting and lush gardens..."
                    className="w-full h-32 p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-trimble-blue focus:border-transparent outline-none resize-none text-sm text-gray-900 dark:text-white transition-all"
                    disabled={isRendering}
                  />
                </div>

                {error && (
                  <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 rounded-xl flex items-start gap-3 text-red-600 dark:text-red-400">
                    <AlertCircle size={18} className="shrink-0 mt-0.5" />
                    <div className="text-xs font-medium">{error}</div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="relative aspect-video bg-gray-100 dark:bg-gray-800 rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700 shadow-inner">
                  <img 
                    src={resultImage} 
                    alt="AI Render Result" 
                    className="w-full h-full object-contain"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div className="flex justify-between items-center">
                  <button 
                    onClick={() => setResultImage(null)}
                    className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 font-bold flex items-center gap-2"
                  >
                    ← Back to Prompt
                  </button>
                  <button 
                    onClick={handleDownload}
                    className="flex items-center gap-2 px-6 py-2.5 bg-trimble-blue text-white rounded-xl hover:bg-trimble-blue/90 transition-colors text-sm font-bold shadow-lg shadow-trimble-blue/20"
                  >
                    <Download size={16} />
                    Download Render
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          {!resultImage && (
            <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 flex justify-between items-center">
              <div className="text-[10px] text-gray-400 font-medium">
                Limit: 20 renders / 24h
              </div>
              <button
                onClick={handleRender}
                disabled={isRendering || !prompt.trim()}
                className="flex items-center gap-2 px-8 py-2.5 bg-trimble-blue text-white rounded-xl hover:bg-trimble-blue/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-bold shadow-lg shadow-trimble-blue/20"
              >
                {isRendering ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles size={18} />
                    Generate Render
                  </>
                )}
              </button>
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
