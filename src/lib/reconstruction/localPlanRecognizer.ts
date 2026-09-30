import type { ImageReconstructionObservation } from './imageAdapter';

export interface RasterImageData {
  width: number;
  height: number;
  data: Uint8ClampedArray | number[];
}

export interface LocalPlanRecognitionOptions {
  metresPerPixel: number;
  fileName?: string;
  darkThreshold?: number;
  minCoverage?: number;
  minRunPx?: number;
  rotationY?: number;
}

interface Stripe {
  start: number;
  end: number;
  centre: number;
}

function luminance(data: RasterImageData['data'], index: number): number {
  const r = Number(data[index] ?? 255);
  const g = Number(data[index + 1] ?? 255);
  const b = Number(data[index + 2] ?? 255);
  const a = Number(data[index + 3] ?? 255) / 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) * a + 255 * (1 - a);
}

function groupIndices(indices: number[]): Stripe[] {
  const out: Stripe[] = [];
  if (!indices.length) return out;
  let start = indices[0], end = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const value = indices[i];
    if (value <= end + 1) {
      end = value;
    } else {
      out.push({ start, end, centre: (start + end) / 2 });
      start = end = value;
    }
  }
  out.push({ start, end, centre: (start + end) / 2 });
  return out;
}

function darkAt(image: RasterImageData, x: number, y: number, threshold: number): boolean {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return false;
  return luminance(image.data, (y * image.width + x) * 4) <= threshold;
}

function darkRuns(length: number, isDark: (i: number) => boolean, minRun: number): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i <= length; i++) {
    const dark = i < length && isDark(i);
    if (dark && start < 0) start = i;
    if (!dark && start >= 0) {
      const end = i - 1;
      if (end - start + 1 >= minRun) runs.push([start, end]);
      start = -1;
    }
  }
  return runs;
}

function confidence(runPx: number, dimension: number): number {
  const coverage = dimension > 0 ? runPx / dimension : 0;
  return Math.max(0.68, Math.min(0.98, 0.68 + coverage * 0.5));
}

/**
 * Fast local recogniser for high-contrast orthogonal floor plans. It detects
 * thick horizontal/vertical dark line bands, merges their thickness into a
 * centreline, then emits wall candidates for the normal reconstruction
 * review pipeline. It intentionally does not guess doors/windows.
 */
export function recogniseOrthogonalFloorPlan(
  image: RasterImageData,
  options: LocalPlanRecognitionOptions,
): ImageReconstructionObservation {
  if (!(image.width > 1) || !(image.height > 1) || image.data.length < image.width * image.height * 4) {
    throw new Error('Raster image data is invalid.');
  }
  if (!(options.metresPerPixel > 0) || !Number.isFinite(options.metresPerPixel)) {
    throw new Error('A positive calibration scale is required before recognising a plan.');
  }

  const threshold = Math.max(0, Math.min(255, options.darkThreshold ?? 145));
  const minCoverage = Math.max(0.02, Math.min(0.8, options.minCoverage ?? 0.12));
  const minRun = Math.max(6, Math.round(options.minRunPx ?? Math.min(image.width, image.height) * 0.08));

  const horizontalRows: number[] = [];
  for (let y = 0; y < image.height; y++) {
    let dark = 0;
    for (let x = 0; x < image.width; x++) if (darkAt(image, x, y, threshold)) dark++;
    if (dark / image.width >= minCoverage) horizontalRows.push(y);
  }

  const verticalCols: number[] = [];
  for (let x = 0; x < image.width; x++) {
    let dark = 0;
    for (let y = 0; y < image.height; y++) if (darkAt(image, x, y, threshold)) dark++;
    if (dark / image.height >= minCoverage) verticalCols.push(x);
  }

  const walls: ImageReconstructionObservation['walls'] = [];
  let index = 1;

  for (const stripe of groupIndices(horizontalRows)) {
    const y = Math.round(stripe.centre);
    const runs = darkRuns(
      image.width,
      x => {
        let hits = 0;
        const samples = Math.max(1, stripe.end - stripe.start + 1);
        for (let sy = stripe.start; sy <= stripe.end; sy++) if (darkAt(image, x, sy, threshold)) hits++;
        return hits / samples >= 0.5;
      },
      minRun,
    );
    for (const [x0, x1] of runs) {
      walls.push({
        id: `local-wall-${index++}`,
        start: [x0, y],
        end: [x1, y],
        confidence: confidence(x1 - x0 + 1, image.width),
      });
    }
  }

  for (const stripe of groupIndices(verticalCols)) {
    const x = Math.round(stripe.centre);
    const runs = darkRuns(
      image.height,
      y => {
        let hits = 0;
        const samples = Math.max(1, stripe.end - stripe.start + 1);
        for (let sx = stripe.start; sx <= stripe.end; sx++) if (darkAt(image, sx, y, threshold)) hits++;
        return hits / samples >= 0.5;
      },
      minRun,
    );
    for (const [y0, y1] of runs) {
      walls.push({
        id: `local-wall-${index++}`,
        start: [x, y0],
        end: [x, y1],
        confidence: confidence(y1 - y0 + 1, image.height),
      });
    }
  }

  return {
    source: { kind: 'image', fileName: options.fileName },
    imageSize: [image.width, image.height],
    transform: {
      coordinateSpace: 'pixels',
      metresPerPixel: options.metresPerPixel,
      rotationY: options.rotationY,
    },
    walls,
    uncertainties: walls.length
      ? ['Local recognition detects orthogonal wall lines only; review all candidates before committing.']
      : ['No strong orthogonal wall lines were detected.'],
  };
}
