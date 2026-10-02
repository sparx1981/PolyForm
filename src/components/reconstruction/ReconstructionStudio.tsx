import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, Box, Check, ImagePlus, Loader2, Ruler, ScanLine, Sparkles, X } from 'lucide-react';
import { useApp } from '../../AppContext';
import { cn } from '../../lib/utils';
import { useModalA11y } from '../ui/useModalA11y';
import {
  calibrateReferencePlan,
  createReferencePlanShape,
  DEFAULT_REFERENCE_OPACITY,
  type ReferencePlanCalibration,
} from '../../lib/reconstruction/referencePlan';
import { recogniseOrthogonalFloorPlan } from '../../lib/reconstruction/localPlanRecognizer';
import { imageObservationToDraft, type ImageReconstructionObservation } from '../../lib/reconstruction/imageAdapter';
import { recogniseFloorPlanWithAi } from '../../lib/reconstruction/aiPlanRecognizer';
import type { ScaleCheck } from '../../lib/reconstruction/planScale';
import { createGeminiPlanGenerator, hasGeminiPlanKey } from '../../lib/reconstruction/geminiPlanClient';
import type { AiPlanGenerator } from '../../lib/reconstruction/aiPlanRecognizer';
import {
  applyReconstructionReview,
  buildReconstructionReview,
  type ReconstructionReview,
} from '../../lib/reconstruction/review';
import {
  commitReconstructionDraft,
  roomHintId,
  type ReconstructionDraft,
} from '../../lib/reconstruction/draft';
import { checkModelHealth } from '../../lib/reconstruction/modelHealth';
import { HuggingFaceService } from '../../services/skpService';
import {
  createExternalAssetShape,
  generatedGeometryFromObject3D,
} from '../../lib/assets/externalAsset';

type PixelPoint = [number, number];

/** Longest image side used for AI recognition and wall alignment. */
const AI_MAX_DIMENSION = 2400;

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
  const [opacity, setOpacity] = useState(DEFAULT_REFERENCE_OPACITY);
  const [rotationDeg, setRotationDeg] = useState(0);
  const [draft, setDraft] = useState<ReconstructionDraft | null>(null);
  const [review, setReview] = useState<ReconstructionReview | null>(null);
  const [decisions, setDecisions] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [scaleCheck, setScaleCheck] = useState<ScaleCheck | null>(null);
  // The model's last answer for this image, so applying a corrected scale does not need another Gemini call.
  const aiAnswer = useRef<{ imageUrl: string; text: string } | null>(null);
  const [rerunWithCachedAnswer, setRerunWithCachedAnswer] = useState(false);

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
    setScaleCheck(null);
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
      setMessage(`Floor plan surface added (${calibrated?.widthM.toFixed(2)} × ${calibrated?.heightM.toFixed(2)} m). Find it in the Outliner to hide or delete it.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not add reference plan.');
    }
  };

  const showObservation = (observation: ImageReconstructionObservation, emptyMessage: string) => {
    const nextDraft = imageObservationToDraft(observation);
    const nextReview = buildReconstructionReview(nextDraft);
    const initial: Record<string, boolean> = {};
    for (const item of nextReview.items) initial[item.id] = item.status !== 'error';
    setScaleCheck(observation.scaleCheck?.warnings.length ? observation.scaleCheck : null);
    setDraft(nextDraft);
    setReview(nextReview);
    setDecisions(initial);
    const count = (kind: string) => nextReview.items.filter(item => item.kind === kind).length;
    const parts = [`${count('wall')} walls`];
    if (count('opening')) parts.push(`${count('opening')} doors/windows`);
    if (count('room')) parts.push(`${count('room')} room labels`);
    setMessage(
      count('wall')
        ? `Detected ${parts.join(', ')}. Review them before adding geometry.`
        : emptyMessage,
    );
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
      showObservation(observation, 'No strong orthogonal walls were detected. Try AI recognition, a cleaner plan image, or trace manually over the calibrated underlay.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Plan recognition failed.');
    } finally {
      setBusy(false);
    }
  };

  const recogniseWithAi = async (reuseAnswer = false) => {
    if (!imageUrl || !pixelSize || !calibrated) return;
    setBusy(true);
    setMessage(reuseAnswer ? 'Rebuilding the plan at the new scale…' : 'Asking Gemini to read the plan…');
    try {
      const gemini = reuseAnswer && aiAnswer.current?.imageUrl === imageUrl ? null : createGeminiPlanGenerator();
      const generate: AiPlanGenerator = async request => {
        if (!gemini) return aiAnswer.current!.text;
        const text = await gemini(request);
        aiAnswer.current = { imageUrl, text };
        return text;
      };
      const image = await loadImage(imageUrl);
      // Work at a capped resolution: plenty for wall alignment, and a sensible upload size.
      const scale = Math.min(1, AI_MAX_DIMENSION / Math.max(pixelSize[0], pixelSize[1]));
      const width = Math.max(2, Math.round(pixelSize[0] * scale));
      const height = Math.max(2, Math.round(pixelSize[1] * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Browser image analysis is unavailable.');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0, width, height);
      const observation = await recogniseFloorPlanWithAi({
        imageDataUrl: canvas.toDataURL('image/jpeg', 0.92),
        imageSize: [width, height],
        metresPerPixel: calibrated.metresPerPixel / scale,
        generate,
        raster: ctx.getImageData(0, 0, width, height),
        fileName,
        rotationY: rotationDeg * Math.PI / 180,
      });
      showObservation(observation, 'The AI did not find any walls in this image. Check the image is a floor plan, or trace manually over the calibrated underlay.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'AI plan recognition failed.');
    } finally {
      setBusy(false);
    }
  };

  /** Sets the calibration's known distance so the plan comes out at the scale its own numbers point to, then rebuilds. */
  const useDetectedScale = () => {
    const ratio = scaleCheck?.suggestion?.ratio;
    const distance = Number(knownDistance);
    if (!ratio || !(distance > 0)) return;
    setKnownDistance(String(Number((distance * ratio).toPrecision(4))));
    resetRecognition();
    setRerunWithCachedAnswer(true);
  };

  useEffect(() => {
    if (!rerunWithCachedAnswer || !calibrated || busy) return;
    setRerunWithCachedAnswer(false);
    void recogniseWithAi(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rerunWithCachedAnswer, calibrated]);

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

  const reviewLabel = (id: string, kind: string) => {
    if (kind === 'room') {
      const room = draft?.rooms?.find((r, i) => roomHintId(r, i) === id);
      return `Room: ${room?.name ?? id}`;
    }
    const opening = draft?.openings?.find(o => o.id === id);
    if (opening) return `${opening.kind === 'door' ? 'Door' : 'Window'} ${id.replace(/^\D+-\D+-?/, '')}`.trim();
    return id;
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
              <p className="text-xs text-gray-500 mt-0.5">Calibrate a plan, recognise walls, doors and rooms, review, then commit native PolyForm geometry.</p>
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
                        <span className="font-medium flex-1 truncate">
                          {reviewLabel(item.id, item.kind)}
                        </span>
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
                <div className="font-bold text-sm">2. Show the floor plan in 3D</div>
                <p className="text-xs text-gray-500">
                  Lays your uploaded plan flat on the ground at the scale set above. Walls, doors and windows are built on top of it, so you can check they line up. It shows in the Outliner as “Floor plan surface”, where you can hide or delete it.
                </p>
                <label className="block text-xs">Plan visibility: {Math.round(opacity * 100)}%
                  <input type="range" min="0.1" max="1" step="0.05" value={opacity} onChange={e => setOpacity(Number(e.target.value))} className="w-full mt-1" />
                </label>
                <label className="block text-xs">Rotate plan (degrees)
                  <input type="number" value={rotationDeg} onChange={e => setRotationDeg(Number(e.target.value) || 0)}
                    className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2" />
                </label>
                <button onClick={addReference} disabled={!calibrated || !imageUrl}
                  className="w-full px-3 py-2 rounded-lg border border-polyform-blue text-polyform-blue text-xs font-bold disabled:opacity-40">
                  Add floor plan surface
                </button>
              </div>

              <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                <div className="flex items-center gap-2 font-bold text-sm"><ScanLine size={16} /> 3. Recognise plan</div>
                <p className="text-xs text-gray-500">
                  <strong>AI recognise</strong> reads walls at any angle, doors, windows and room names. It uploads the plan image to Google Gemini.
                </p>
                <button onClick={() => recogniseWithAi()} disabled={!calibrated || !imageUrl || busy || !hasGeminiPlanKey()}
                  className="w-full px-3 py-2 rounded-lg bg-polyform-blue text-white text-xs font-bold disabled:opacity-40 flex items-center justify-center gap-2">
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} AI recognise and review
                </button>
                {!hasGeminiPlanKey() && (
                  <div className="text-[10px] text-amber-600 dark:text-amber-400">No Gemini API key is configured. Add one in Settings → API to use AI recognition.</div>
                )}
                <p className="text-xs text-gray-500">
                  Local detection works offline on clean, high-contrast, right-angled plans only. No image is uploaded.
                </p>
                <button onClick={recognise} disabled={!calibrated || !imageUrl || busy}
                  className="w-full px-3 py-2 rounded-lg border border-polyform-blue text-polyform-blue text-xs font-bold disabled:opacity-40 flex items-center justify-center gap-2">
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <ScanLine size={14} />} Local detect and review
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
                  Requires a Hugging Face API token.
                </div>
              </div>

              {scaleCheck && scaleCheck.warnings.length > 0 && (
                <div role="alert" className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs space-y-2 text-amber-900 dark:text-amber-200">
                  <div className="flex gap-2">
                    <AlertCircle size={15} className="shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <div className="font-bold">Check the scale</div>
                      {scaleCheck.warnings.map(warning => <p key={warning}>{warning}</p>)}
                    </div>
                  </div>
                  {scaleCheck.suggestion && (
                    <button onClick={useDetectedScale} disabled={busy}
                      className="w-full px-3 py-2 rounded-lg bg-amber-600 text-white font-bold disabled:opacity-40">
                      Use detected scale ({scaleCheck.suggestion.buildingM[0].toFixed(1)} × {scaleCheck.suggestion.buildingM[1].toFixed(1)} m)
                    </button>
                  )}
                </div>
              )}

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
