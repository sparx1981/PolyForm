import type { CustomLight } from '../types';

/**
 * How many of the scene's lights the GPU can actually shade.
 *
 * Every light that is rendered adds uniforms to every lit material's shader, and every light that casts a
 * shadow also takes a texture unit. Past the GPU's limit the shader fails to compile and every lit surface
 * disappears, leaving only the unlit edge lines: a house furnished room by room, each room with a grid of
 * downlights, went from solid to a dark wireframe. So the lights are budgeted rather than all switched on.
 */
export interface LightBudgetLimits {
  /** `renderer.capabilities.maxTextures` (MAX_TEXTURE_IMAGE_UNITS). */
  maxTextureUnits: number;
  /** MAX_FRAGMENT_UNIFORM_VECTORS. */
  maxFragmentUniformVectors: number;
}

/** What a small, common GPU (16 texture units, 1024 uniform vectors) allows when nothing is known. */
export const DEFAULT_LIGHT_LIMITS: LightBudgetLimits = { maxTextureUnits: 16, maxFragmentUniformVectors: 1024 };

/** Texture units the sun's shadow, environment, and a material's own maps (colour, normal, roughness, ...) need. */
const RESERVED_TEXTURE_UNITS = 12;
/** Uniform vectors for everything but lights (matrices, material, fog, clipping). */
const RESERVED_UNIFORM_VECTORS = 160;
/** Roughly what one light costs in uniform vectors (a spot light is the largest). */
const UNIFORM_VECTORS_PER_LIGHT = 8;
const MAX_LIGHTS = 64;
const MAX_SHADOW_LIGHTS = 6;

export interface LightBudget {
  /** Lights that may be rendered; every other light is left out of the scene (its handle can still be shown). */
  lit: Set<string>;
  /** Lights that may cast a shadow. Always a subset of `lit`. */
  shadow: Set<string>;
  maxLights: number;
  maxShadowLights: number;
  /** True when some lights were switched off to stay within the limits. */
  trimmed: boolean;
}

export function lightBudgetLimits(limits: Partial<LightBudgetLimits> = {}): { maxLights: number; maxShadowLights: number } {
  const units = limits.maxTextureUnits ?? DEFAULT_LIGHT_LIMITS.maxTextureUnits;
  const vectors = limits.maxFragmentUniformVectors ?? DEFAULT_LIGHT_LIMITS.maxFragmentUniformVectors;
  const maxLights = Math.max(8, Math.min(MAX_LIGHTS, Math.floor((vectors - RESERVED_UNIFORM_VECTORS) / UNIFORM_VECTORS_PER_LIGHT)));
  const maxShadowLights = Math.max(0, Math.min(MAX_SHADOW_LIGHTS, units - RESERVED_TEXTURE_UNITS));
  return { maxLights, maxShadowLights };
}

/**
 * Chooses which lights are rendered and which of those cast shadows. The choice depends only on the list of lights
 * (and the selection), never on the camera: switching a light on or off recompiles every lit material's shader, so
 * it must not flicker as the view moves. The selected light always stays on, then lights in scene order.
 * Area lights cast no shadow, and projector lights are always given priority for a shadow as they are placed on purpose.
 */
export function planLightBudget(
  lights: readonly CustomLight[],
  limits: Partial<LightBudgetLimits> = {},
  options: { selectedId?: string | null } = {},
): LightBudget {
  const { maxLights, maxShadowLights } = lightBudgetLimits(limits);
  const ordered = [...lights].sort((a, b) => Number(b.id === options.selectedId) - Number(a.id === options.selectedId));
  const lit = new Set<string>();
  // Directional lights are few and cheap to keep: they light the whole scene, so they are never the ones dropped.
  for (const light of ordered) if (light.type === 'directional' && lit.size < maxLights) lit.add(light.id);
  for (const light of ordered) if (lit.size < maxLights) lit.add(light.id);

  const shadow = new Set<string>();
  const canCast = (light: CustomLight) => light.type !== 'rect' && lit.has(light.id);
  for (const light of ordered) if (shadow.size < maxShadowLights && canCast(light) && light.type === 'projector') shadow.add(light.id);
  for (const light of ordered) if (shadow.size < maxShadowLights && canCast(light)) shadow.add(light.id);
  return { lit, shadow, maxLights, maxShadowLights, trimmed: lit.size < lights.length };
}
