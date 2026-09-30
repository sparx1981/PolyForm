import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, Box, Check, ImagePlus, Loader2, Ruler, ScanLine, X } from 'lucide-react';
import { useApp } from '../../AppContext';
import { cn } from '../../lib/utils';
import { useModalA11y } from '../ui/useModalA11y';
import {
  calibrateReferencePlan,
  createReferencePlanShape,
  type ReferencePlanCalibration,
} from '../../lib/reconstruction/referencePlan';
import { recogniseOrthogonalFloorPlan } from '../../lib/reconstruction/localPlanRecognizer';
import { imageObservationToDraft } from '../../lib/reconstruction/imageAdapter';
import {
  applyReconstructionReview,
  buildReconstructionReview,
  type ReconstructionReview,
} from '../../lib/reconstruction/review';
import {
  commitReconstructionDraft,
  type ReconstructionDraft,
} from '../../lib/reconstruction/draft';
import { checkModelHealth } from '../../lib/reconstruction/modelHealth';
import { HuggingFaceService } from '../../services/skpService';
import {
  createExternalAssetShape,
  generatedGeometryFromObject3D,
} from '../../lib/assets/externalAsset';

type PixelPoint = [number, number];

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not decode image.'));
    image.src = src;
  });
}

export default function ReconstructionStudio() {
  const { shapes, setShapes } = useApp();
  const [open, setOpen] = useState(false);
  const dialogRef = useModalA11y<HTMLDivElement>(open, () => setOpen(false));
  const imageRef = useRef<HTMLImageElement>(null);

  const [fileName, setFileName] = useState('');
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [pixelSize, setPixelSize] = useState<[number, number] | null>(null);
  const [points, setPoints] = useState<PixelPoint[]>([]);
  const [knownDistance, setKnownDistance] = useState('4');
  const [opacity, setOpacity] = useState(0.55);
  const [rotationDeg, setRotationDeg] = useState(0);
  const [draft, setDraft] = useState<ReconstructionDraft | null>(null);
  const [review, setReview] = useState<ReconstructionReview | null>(null);
  const [decisions, setDecisions] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('polyform:photo-to-3d', handler);
    window.addEventListener('polyform:reconstruction-studio', handler);
    return () => {
      window.removeEventListener('polyform:photo-to-3d', handler);
      window.removeEventListener('polyform:reconstruction-studio', handler);
    };
  }, []);

  const calibration = useMemo<ReferencePlanCalibration | null>(() => {
    if (points.length !== 2) return null;
    const distance = Number(knownDistance);
    if (!(distance > 0) || !Number.isFinite(distance)) return null;
    return { pixelA: points[0], pixelB: points[1], knownDistanceM: distance };
  }, [points, knownDistance]);

  const calibrated = useMemo(() => {
    if (!calibration || !pixelSize) return null;
    try {
      return calibrateReferencePlan(
        { pixelWidth: pixelSize[0], pixelHeight: pixelSize[1] },
        calibration,
      );
    } catch {
      return null;
    }
  }, [calibration, pixelSize]);

  const resetRecognition = () => {
    setDraft(null);
    setReview(null);
    setDecisions({});
  };

  const handleFile = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setMessage('This first release accepts PNG, JPG, WebP and SVG plans. PDF page import is the next adapter.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const url = await fileToDataUrl(file);
      const image = await loadImage(url);
      setFileName(file.name);
      setSourceFile(file);
      setImageUrl(url);
      setPixelSize([image.naturalWidth, image.naturalHeight]);
      setPoints([]);
      resetRecognition();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load image.');
    } finally {
      setBusy(false);
    }
  };

  const handlePlanClick = (event: React.MouseEvent<HTMLImageElement>) => {
    if (!pixelSize || !imageRef.current) return;
    const rect = imageRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(pixelSize[0], (event.clientX - rect.left) / rect.width * pixelSize[0]));
    const y = Math.max(0, Math.min(pixelSize[1], (event.clientY - rect.top) / rect.height * pixelSize[1]));
    setPoints(previous => previous.length >= 2 ? [[x, y]] : [...previous, [x, y]]);
    resetRecognition();
  };

  const addReference = () => {
    if (!imageUrl || !pixelSize || !calibration) return;
    try {
      const shape = createReferencePlanShape(
        {
          kind: 'image',
          name: fileName || 'Floor plan',
          imageUrl,
          pixelWidth: pixelSize[0],
          pixelHeight: pixelSize[1],
        },
        calibration,
        {
          opacity,
          rotationY: rotationDeg * Math.PI / 180,
          locked: true,
        },
      );
      setShapes(previous => [...previous, shape]);
      setMessage(`Reference underlay added at ${calibrated?.widthM.toFixed(2)} × ${calibrated?.heightM.toFixed(2)} m.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not add reference plan.');
    }
  };

  const recognise = async () => {
    if (!imageUrl || !pixelSize || !calibrated) return;
    setBusy(true);
    setMessage(null);
    try {
      const image = await loadImage(imageUrl);
      const canvas = document.createElement('canvas');
      canvas.width = pixelSize[0];
      canvas.height = pixelSize[1];
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Browser image analysis is unavailable.');
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const raster = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const observation = recogniseOrthogonalFloorPlan(raster, {
        metresPerPixel: calibrated.metresPerPixel,
        fileName,
        rotationY: rotationDeg * Math.PI / 180,
      });
      const nextDraft = imageObservationToDraft(observation);
      const nextReview = buildReconstructionReview(nextDraft);
      const initial: Record<string, boolean> = {};
      for (const item of nextReview.items) initial[item.id] = item.status !== 'error';
      setDraft(nextDraft);
      setReview(nextReview);
      setDecisions(initial);
      setMessage(
        nextReview.items.length
          ? `Detected ${nextReview.items.length} wall candidates. Review them before adding geometry.`
          : 'No strong orthogonal walls were detected. Try a cleaner/high-contrast plan image or trace manually over the calibrated underlay.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Plan recognition failed.');
    } finally {
      setBusy(false);
    }
  };

  const generatePhotoMesh = async () => {
    if (!sourceFile) return;
    if (!HuggingFaceService.getToken()) {
      setMessage('Add a Hugging Face API token in Settings → API before using AI Photo to 3D.');
      return;
    }
    setBusy(true);
    setMessage('Sending the selected photo to Hugging Face TripoSR…');
    try {
      const group = await HuggingFaceService.photoTo3D(sourceFile);
      const geometry = generatedGeometryFromObject3D(group);
      const shape = createExternalAssetShape({
        name: `${fileName.replace(/\.[^/.]+$/, '') || 'Photo'} (AI 3D)`,
        geometry,
        provenance: {
          source: 'generated',
          provider: 'huggingface',
          model: 'stabilityai/TripoSR',
          sourceFile: sourceFile.name,
        },
      });
      setShapes(previous => [...previous, shape]);
      const triangles = shape.customData?.assetValidation?.triangles ?? 0;
      setMessage(`Generated and inserted an AI 3D mesh from the photo (${Number(triangles).toLocaleString()} triangles). Source provenance has been retained.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'AI Photo to 3D failed.');
    } finally {
      setBusy(false);
    }
  };

  const commitReviewed = () => {
    if (!draft) return;
    const reviewed = applyReconstructionReview(draft, decisions);
    const result = commitReconstructionDraft(reviewed, { includeFurniture: true });
    const combined = [...shapes, ...result.shapes];
    const health = checkModelHealth(combined);
    setShapes(previous => [...previous, ...result.shapes]);
    setMessage(
      `Added ${result.shapes.length} reconstructed objects. Model health: ${health.errors} errors, ${health.warnings} warnings.`,
    );
    setDraft(null);
    setReview(null);
    setDecisions({});
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Reconstruct from plan or image"
        className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 14 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 14 }}
          className="w-full max-w-5xl max-h-[92vh] overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl flex flex-col"
        >
          <header className="px-5 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-gray-900 dark:text-white">Reconstruction Studio</h2>
              <p className="text-xs text-gray-500 mt-0.5">Calibrate a plan, recognise walls locally, review, then commit native PolyForm geometry.</p>
            </div>
            <button onClick={() => setOpen(false)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Close">
              <X size={18} />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto p-5 grid lg:grid-cols-[1.35fr_0.85fr] gap-5">
            <section className="space-y-4">
              {!imageUrl ? (
                <label className="min-h-80 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-2xl flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-polyform-blue">
                  {busy ? <Loader2 className="animate-spin" /> : <ImagePlus size={34} className="text-polyform-blue" />}
                  <div className="text-center">
                    <div className="font-semibold text-sm">Choose a floor-plan image</div>
                    <div className="text-xs text-gray-500 mt-1">PNG, JPG, WebP or SVG</div>
                  </div>
                  <input type="file" accept="image/*" className="hidden" onChange={e => handleFile(e.target.files?.[0])} />
                </label>
              ) : (
                <div className="rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden bg-gray-50 dark:bg-gray-950">
                  <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between text-xs">
                    <span className="font-medium truncate">{fileName}</span>
                    <label className="text-polyform-blue font-semibold cursor-pointer">
                      Replace
                      <input type="file" accept="image/*" className="hidden" onChange={e => handleFile(e.target.files?.[0])} />
                    </label>
                  </div>
                  <div className="p-3 overflow-auto">
                    <div className="relative inline-block max-w-full">
                      <img
                        ref={imageRef}
                        src={imageUrl}
                        alt="Plan to reconstruct"
                        onClick={handlePlanClick}
                        className="max-w-full max-h-[55vh] object-contain cursor-crosshair select-none"
                        draggable={false}
                      />
                      {points.map((point, index) => {
                        if (!pixelSize) return null;
                        return (
                          <span key={index} className="absolute w-4 h-4 -ml-2 -mt-2 rounded-full bg-polyform-blue border-2 border-white shadow"
                            style={{ left: `${point[0] / pixelSize[0] * 100}%`, top: `${point[1] / pixelSize[1] * 100}%` }}>
                            <span className="sr-only">Calibration point {index + 1}</span>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {review && review.items.length > 0 && (
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                    <div className="text-sm font-bold">Recognition review</div>
                    <div className="text-[11px] text-gray-500">{review.accepted} accepted · {review.review} review · {review.errors} errors</div>
                  </div>
                  <div className="max-h-56 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
                    {review.items.map(item => (
                      <label key={item.id} className="px-4 py-2.5 flex items-center gap-3 text-xs">
                        <input type="checkbox" checked={decisions[item.id] ?? false} disabled={item.status === 'error'}
                          onChange={e => setDecisions(previous => ({ ...previous, [item.id]: e.target.checked }))} />
                        <span className={cn(
                          'w-2 h-2 rounded-full',
                          item.status === 'accepted' ? 'bg-emerald-500' : item.status === 'review' ? 'bg-amber-500' : 'bg-red-500',
                        )} />
                        <span className="font-medium flex-1">{item.id}</span>
                        <span className="text-gray-500">{Math.round(item.confidence * 100)}%</span>
                        <span className="capitalize text-gray-500">{item.status}</span>
                      </label>
                    ))}
                  </div>
                  <div className="p-3 flex justify-end">
                    <button onClick={commitReviewed}
                      className="px-4 py-2 rounded-lg bg-polyform-blue text-white text-xs font-bold flex items-center gap-2">
                      <Check size={14} /> Add approved geometry
                    </button>
                  </div>
                </div>
              )}
            </section>

            <aside className="space-y-4">
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-4">
                <div className="flex items-center gap-2 font-bold text-sm"><Ruler size={16} /> 1. Calibrate scale</div>
                <p className="text-xs text-gray-500">Click two points on the plan whose real distance you know.</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-2">Point A: {points[0] ? `${Math.round(points[0][0])}, ${Math.round(points[0][1])}` : 'not set'}</div>
                  <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-2">Point B: {points[1] ? `${Math.round(points[1][0])}, ${Math.round(points[1][1])}` : 'not set'}</div>
                </div>
                <label className="block text-xs font-medium">
                  Known distance (metres)
                  <input type="number" min="0.01" step="0.01" value={knownDistance} onChange={e => setKnownDistance(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2" />
                </label>
                {calibrated && (
                  <div className="text-xs text-emerald-600 dark:text-emerald-400">
                    Scale: {calibrated.metresPerPixel.toFixed(5)} m/px · {calibrated.widthM.toFixed(2)} × {calibrated.heightM.toFixed(2)} m
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                <div className="font-bold text-sm">2. Reference underlay</div>
                <label className="block text-xs">Opacity: {Math.round(opacity * 100)}%
                  <input type="range" min="0.1" max="1" step="0.05" value={opacity} onChange={e => setOpacity(Number(e.target.value))} className="w-full mt-1" />
                </label>
                <label className="block text-xs">Rotation
                  <input type="number" value={rotationDeg} onChange={e => setRotationDeg(Number(e.target.value) || 0)}
                    className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2" />
                </label>
                <button onClick={addReference} disabled={!calibrated || !imageUrl}
                  className="w-full px-3 py-2 rounded-lg border border-polyform-blue text-polyform-blue text-xs font-bold disabled:opacity-40">
                  Add locked reference
                </button>
              </div>

              <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                <div className="flex items-center gap-2 font-bold text-sm"><ScanLine size={16} /> 3. Recognise walls</div>
                <p className="text-xs text-gray-500">Local recognition works best on clean, high-contrast orthogonal floor plans. No image is uploaded.</p>
                <button onClick={recognise} disabled={!calibrated || !imageUrl || busy}
                  className="w-full px-3 py-2 rounded-lg bg-polyform-blue text-white text-xs font-bold disabled:opacity-40 flex items-center justify-center gap-2">
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <ScanLine size={14} />} Detect and review
                </button>
              </div>

              <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                <div className="flex items-center gap-2 font-bold text-sm"><Box size={16} /> AI Photo to 3D mesh</div>
                <p className="text-xs text-gray-500">
                  For object photos rather than floor plans. This explicitly uploads the selected image to Hugging Face TripoSR and inserts the returned GLB through PolyForm's generated-asset validation pipeline.
                </p>
                <button onClick={generatePhotoMesh} disabled={!sourceFile || busy}
                  className="w-full px-3 py-2 rounded-lg border border-polyform-blue text-polyform-blue text-xs font-bold disabled:opacity-40 flex items-center justify-center gap-2">
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Box size={14} />} Generate 3D mesh
                </button>
                <div className="text-[10px] text-gray-400">
                  Requires a Hugging Face API token. Floor-plan wall detection above stays entirely local.
                </div>
              </div>

              {message && (
                <div className="rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 p-3 text-xs flex gap-2 text-blue-800 dark:text-blue-200">
                  <AlertCircle size={15} className="shrink-0 mt-0.5" />
                  <span>{message}</span>
                </div>
              )}
            </aside>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
