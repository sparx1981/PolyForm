/**
 * Working out a plan's scale from the numbers printed on it.
 *
 * Most plans label their rooms with a size ("16' x 20'", "4.5 x 3.2 m") and many print overall dimensions.
 * A room's printed size against the size it measures on the image gives the scale, and the median over
 * several rooms is steady even when the odd label or outline is wrong. The result is only ever offered
 * as a suggestion; the user's own calibration stays in charge.
 */

const FEET = 0.3048;
const INCH = 0.0254;

type Unit = 'ft' | 'in' | 'm' | 'cm' | 'mm';

const normalise = (text: string) => text
  .replace(/[′’‘`´]/g, "'")
  .replace(/[″”“]/g, '"')
  .replace(/''/g, '"')
  .replace(/[×✕]/g, 'x')
  .replace(/\s+by\s+/gi, ' x ')
  .replace(/\s+/g, ' ')
  .trim();

/** One length such as 16', 13'-6", 30", 4.5 m or 3200 mm, in metres; the unit it carried is returned too. */
function parseLength(part: string, fallback?: Unit): { metres: number; unit: Unit | undefined } | null {
  const p = part.trim().toLowerCase();
  const feetInches = /^(\d+(?:\.\d+)?)\s*'\s*[- ]?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in)?)?$/.exec(p);
  if (feetInches) {
    return { metres: Number(feetInches[1]) * FEET + (feetInches[2] ? Number(feetInches[2]) * INCH : 0), unit: 'ft' };
  }
  const inches = /^(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)$/.exec(p);
  if (inches) return { metres: Number(inches[1]) * INCH, unit: 'in' };
  const metric = /^(\d+(?:\.\d+)?)\s*(mm|cm|m)$/.exec(p);
  if (metric) {
    const unit = metric[2] as Unit;
    return { metres: Number(metric[1]) * (unit === 'mm' ? 0.001 : unit === 'cm' ? 0.01 : 1), unit };
  }
  const bare = /^(\d+(?:\.\d+)?)$/.exec(p);
  if (bare && fallback) {
    const v = Number(bare[1]);
    const factor = fallback === 'ft' ? FEET : fallback === 'in' ? INCH : fallback === 'mm' ? 0.001 : fallback === 'cm' ? 0.01 : 1;
    return { metres: v * factor, unit: undefined };
  }
  return null;
}

/**
 * Reads a printed room size such as `16' x 20'`, `13'-6" x 12'-0"` or `4.5 x 3.2 m` into two lengths in metres.
 * Returns null when it is not a two-part size or the unit cannot be told (a bare "16 x 20").
 */
export function parsePrintedSize(text: string): [number, number] | null {
  const parts = normalise(text).split(/\s*x\s*/i);
  if (parts.length !== 2) return null;
  const first = parseLength(parts[0]);
  const second = parseLength(parts[1]);
  // "4.5 x 3.2 m": the unit is printed once, at the end.
  const a = first ?? (second?.unit ? parseLength(parts[0], second.unit) : null);
  const b = second ?? (first?.unit ? parseLength(parts[1], first.unit) : null);
  if (!a || !b) return null;
  const pair: [number, number] = [a.metres, b.metres];
  return pair.every(v => Number.isFinite(v) && v >= 0.5 && v <= 60) ? pair : null;
}

/** A single overall dimension such as `82'` or `25 m`. */
export function parsePrintedLength(text: string): number | null {
  const parsed = parseLength(normalise(text).replace(/^(?:width|depth|length|overall)\s*[-:=]?\s*/i, ''));
  return parsed && parsed.metres >= 2 && parsed.metres <= 200 ? parsed.metres : null;
}

export interface ScaleRoomSample {
  /** Printed size, in metres (either order). */
  printed: [number, number];
  /** Measured size of the room on the image, in pixels (either order). */
  measuredPx: [number, number];
}

export interface PlanScaleEstimate {
  /** Metres per pixel the plan's own numbers point to. */
  metresPerPixel: number;
  /** How many labelled rooms agreed enough to be used. */
  samples: number;
  /** Median relative deviation of those rooms: small means they agree. */
  spread: number;
  basis: 'room sizes' | 'overall dimensions';
  confidence: 'high' | 'medium' | 'low';
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** The scale implied by labelled rooms, or null with fewer than three usable rooms. */
export function estimateScaleFromRooms(rooms: ScaleRoomSample[]): PlanScaleEstimate | null {
  const ratios: number[] = [];
  for (const room of rooms) {
    const [ps, pl] = [Math.min(...room.printed), Math.max(...room.printed)];
    const [ms, ml] = [Math.min(...room.measuredPx), Math.max(...room.measuredPx)];
    if (!(ms > 2) || !(ps > 0)) continue;
    const short = ps / ms, long = pl / ml;
    // A room whose two sides disagree has a wrong outline (or label): leave it out.
    if (Math.abs(short / long - 1) > 0.3) continue;
    ratios.push(Math.sqrt(short * long));
  }
  if (ratios.length < 3) return null;
  const mid = median(ratios);
  const spread = median(ratios.map(r => Math.abs(r - mid) / mid));
  // Keep only the rooms that agree with the median, then take their median again.
  const agreeing = ratios.filter(r => Math.abs(r - mid) / mid <= 0.25);
  if (agreeing.length < 3) return null;
  const metresPerPixel = median(agreeing);
  const confidence = agreeing.length >= 5 && spread < 0.08 ? 'high' : spread < 0.18 ? 'medium' : 'low';
  return { metresPerPixel, samples: agreeing.length, spread, basis: 'room sizes', confidence };
}

/** The scale implied by the printed overall width and depth against the walls' extent, when both axes agree. */
export function estimateScaleFromOverall(overallM: { width?: number; depth?: number }, wallsPx: [number, number]): PlanScaleEstimate | null {
  const ratios: number[] = [];
  if (overallM.width && wallsPx[0] > 10) ratios.push(overallM.width / wallsPx[0]);
  if (overallM.depth && wallsPx[1] > 10) ratios.push(overallM.depth / wallsPx[1]);
  if (!ratios.length) return null;
  if (ratios.length === 2 && Math.abs(ratios[0] / ratios[1] - 1) > 0.25) return null;
  // The printed overall size can include porches and eaves the walls do not, so this is only ever a rough guide.
  return { metresPerPixel: ratios.reduce((s, r) => s + r, 0) / ratios.length, samples: ratios.length, spread: 0, basis: 'overall dimensions', confidence: 'low' };
}

export interface ScaleCheck {
  warnings: string[];
  /** Present when the plan's own numbers disagree with the calibration enough to be worth offering. */
  suggestion?: PlanScaleEstimate & {
    /** Suggested scale divided by the current one: multiply the calibration's known distance by this. */
    ratio: number;
    /** The building's wall extent at the suggested scale, in metres. */
    buildingM: [number, number];
  };
}

const metres = (n: number) => `${n.toFixed(n >= 10 ? 0 : 1)} m`;

/**
 * Compares the calibration with what the plan itself says and with how big houses and doors normally are.
 * `doorWidthsPx` are the doors as the AI measured them, before any size limits are applied.
 */
export function checkPlanScale(input: {
  metresPerPixel: number;
  wallsPx: [number, number];
  doorWidthsPx: number[];
  estimate: PlanScaleEstimate | null;
}): ScaleCheck {
  const { metresPerPixel: mpp, wallsPx, doorWidthsPx, estimate } = input;
  const warnings: string[] = [];
  const building: [number, number] = [wallsPx[0] * mpp, wallsPx[1] * mpp];
  const longSide = Math.max(...building);
  let suggestion: ScaleCheck['suggestion'];

  if (estimate) {
    const ratio = estimate.metresPerPixel / mpp;
    if (Math.abs(ratio - 1) > 0.12 && estimate.confidence !== 'low') {
      const at: [number, number] = [wallsPx[0] * estimate.metresPerPixel, wallsPx[1] * estimate.metresPerPixel];
      suggestion = { ...estimate, ratio, buildingM: at };
      warnings.push(`The ${estimate.basis} printed on the plan point to a building about ${metres(at[0])} by ${metres(at[1])}, but your scale makes it ${metres(building[0])} by ${metres(building[1])}. Check the calibration, or use the detected scale.`);
    } else if (Math.abs(ratio - 1) > 0.12) {
      warnings.push(`The ${estimate.basis} printed on the plan suggest a different scale (building about ${metres(wallsPx[0] * estimate.metresPerPixel)} by ${metres(wallsPx[1] * estimate.metresPerPixel)}, not ${metres(building[0])} by ${metres(building[1])}), but they are not consistent enough to apply automatically. Check the calibration.`);
    }
  }

  if (!suggestion) {
    if (doorWidthsPx.length >= 3) {
      const door = median(doorWidthsPx) * mpp;
      if (door > 1.35) warnings.push(`Doors in this plan come out about ${door.toFixed(1)} m wide (single doors are usually 0.8 to 1.0 m), which suggests the scale is too large.`);
      else if (door < 0.55) warnings.push(`Doors in this plan come out about ${door.toFixed(2)} m wide (single doors are usually 0.8 to 1.0 m), which suggests the scale is too small.`);
    }
    if (longSide > 55) warnings.push(`The building comes out ${metres(longSide)} long, which is unusually large for a house. Check the calibration.`);
    else if (longSide < 3.5 && wallsPx[0] > 0) warnings.push(`The building comes out only ${metres(longSide)} long. Check the calibration.`);
  }
  return { warnings, suggestion };
}
