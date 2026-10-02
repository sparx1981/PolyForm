import { GoogleGenAI, Type } from '@google/genai';
import { getGeminiApiKey } from '../utils';
import type { AiPlanGenerator } from './aiPlanRecognizer';

export const PLAN_RECOGNITION_MODEL = 'gemini-3-flash-preview';

const point = { type: Type.NUMBER };

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    walls: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          x1: point, y1: point, x2: point, y2: point,
          thickness: { type: Type.NUMBER },
          exterior: { type: Type.BOOLEAN },
          confidence: { type: Type.NUMBER },
        },
        required: ['x1', 'y1', 'x2', 'y2'],
      },
    },
    openings: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          kind: { type: Type.STRING, enum: ['door', 'window'] },
          x: point, y: point,
          width: { type: Type.NUMBER },
          confidence: { type: Type.NUMBER },
        },
        required: ['kind', 'x', 'y', 'width'],
      },
    },
    rooms: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          x: point, y: point,
          x1: point, y1: point, x2: point, y2: point,
          printedSize: { type: Type.STRING },
          confidence: { type: Type.NUMBER },
        },
        required: ['name', 'x', 'y'],
      },
    },
    overall: {
      type: Type.OBJECT,
      properties: { width: { type: Type.STRING }, depth: { type: Type.STRING } },
    },
    notes: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ['walls', 'openings', 'rooms'],
};

export function hasGeminiPlanKey(): boolean {
  return !!getGeminiApiKey();
}

/** Gemini-backed generator for {@link recogniseFloorPlanWithAi}. */
export function createGeminiPlanGenerator(apiKey: string = getGeminiApiKey()): AiPlanGenerator {
  if (!apiKey) {
    throw new Error('No Gemini API key is configured. Add one in Settings → API to use AI recognition.');
  }
  return async ({ imageDataUrl, prompt }) => {
    const match = /^data:([^;,]+);base64,(.+)$/.exec(imageDataUrl);
    if (!match) throw new Error('The plan image could not be prepared for AI recognition.');
    const ai = new GoogleGenAI({ apiKey });
    const result = await ai.models.generateContent({
      model: PLAN_RECOGNITION_MODEL,
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: match[1], data: match[2] } }, { text: prompt }] }],
      config: { responseMimeType: 'application/json', responseSchema, temperature: 0.1 },
    });
    if (!result.text) throw new Error('The AI returned no response.');
    return result.text;
  };
}
