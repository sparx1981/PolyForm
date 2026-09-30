import type { Shape } from '../../types';

export type GeneratedPrimitiveType = 'box' | 'prism' | 'sphere' | 'cone' | 'pyramid' | 'donut' | 'dome';

export interface GeneratedPrimitiveCandidate {
  type: string;
  position?: number[];
  rotation?: number[];
  scale?: number[];
  color?: string;
  args?: number[];
}

export interface GeneratedPrimitiveValidation {
  valid: boolean;
  issues: string[];
}

const ALLOWED = new Set<GeneratedPrimitiveType>(['box', 'prism', 'sphere', 'cone', 'pyramid', 'donut', 'dome']);

function finiteVector(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length >= length && value.slice(0, length).every(Number.isFinite);
}

export function validateGeneratedPrimitive(candidate: GeneratedPrimitiveCandidate): GeneratedPrimitiveValidation {
  const issues: string[] = [];
  if (!ALLOWED.has(candidate.type as GeneratedPrimitiveType)) issues.push('Unsupported generated shape type.');
  if (!finiteVector(candidate.position ?? [0, 0, 0], 3)) issues.push('Position must contain three finite numbers.');
  if (!finiteVector(candidate.rotation ?? [0, 0, 0], 3)) issues.push('Rotation must contain three finite numbers.');
  if (!finiteVector(candidate.scale ?? [1, 1, 1], 3)) issues.push('Scale must contain three finite numbers.');
  if (!Array.isArray(candidate.args) || !candidate.args.length || !candidate.args.every(Number.isFinite)) issues.push('Shape arguments must be finite numbers.');
  if ((candidate.args ?? []).some(value => Math.abs(value) > 1000)) issues.push('Generated shape dimensions are implausibly large.');
  if ((candidate.position ?? []).some(value => Math.abs(Number(value)) > 1000)) issues.push('Generated shape position is implausibly far from the model.');
  return { valid: issues.length === 0, issues };
}

export function createGeneratedPrimitiveShape(
  candidate: GeneratedPrimitiveCandidate,
  provenance: { provider: string; model: string; prompt: string; requestId?: string },
): Shape {
  const validation = validateGeneratedPrimitive(candidate);
  if (!validation.valid) throw new Error(validation.issues.join(' '));
  const position = (candidate.position ?? [0, 0, 0]).slice(0, 3) as [number, number, number];
  const rotation = (candidate.rotation ?? [0, 0, 0]).slice(0, 3) as [number, number, number];
  const scale = (candidate.scale ?? [1, 1, 1]).slice(0, 3) as [number, number, number];
  return {
    id: Math.random().toString(36).slice(2, 11),
    name: `AI ${candidate.type}`,
    type: candidate.type as Shape['type'],
    position,
    rotation,
    scale,
    color: /^#[0-9a-f]{6}$/i.test(candidate.color ?? '') ? candidate.color! : '#ffffff',
    args: [...(candidate.args ?? [])],
    roughness: 0.5,
    metalness: 0,
    opacity: 1,
    tags: ['generated'],
    customData: {
      assetProvenance: {
        source: 'generated',
        createdAt: Date.now(),
        provider: provenance.provider,
        model: provenance.model,
        prompt: provenance.prompt,
        requestId: provenance.requestId,
      },
    },
  };
}
