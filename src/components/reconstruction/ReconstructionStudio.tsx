import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, Box, Check, ImagePlus, Loader2, Ruler, ScanLine, X } from 'lucide-react';
import { useApp } from '../../AppContext';
import { cn } from '../../lib/utils';
import { useModalA11y } from '../ui/useModalA11y';
import { createReferencePlanShape } from '../../lib/reconstruction/referencePlan';
import { analyseFloorPlan, planGeometryToObservation, type PlanAnalysis } from '../../lib/reconstruction/localPlanRecognizer';
import { parseDimension } from '../../lib/reconstruction/dimensionScale';
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

/** Plans are analysed at up to this many pixels on the long side: enough for thin lines, quick to scan. */
const ANALYSIS_LIMIT = 2000;

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

const formatMetres = (m: number) => `${m.toFixed(2)} m`;
const KIND_LABEL = { wall: 'Walls', opening: 'Doors and windows', furniture: 'Furniture' } as const;

export default function ReconstructionStudio() {
  const { shapes, setShapes } = useApp();
  const [open, setOpen] = useState(false);
  const dialogRef = useModalA11y<HTMLDivElement>(open, () => setOpen(false));
  const imageRef = useRef<HTMLImageElement>(null);

  const [fileName, setFileName] = useState('');
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [pixelSize, setPixelSize] = useState<[number, number] | null>(null);
  /** The scan of the plan. Its pixels are the analysis picture's, which may be a shrunk copy of the file. */
  const [analysis, setAnalysis] = useState<PlanAnalysis | null>(null);
  const [analysisScale, setAnalysisScale] = useState(1);
  /** Metres per pixel of the ORIGINAL picture, whoever set it (the scan, or you). */
  const [metresPerPixel, setMetresPerPixel] = useState<number | null>(null);
  const [scaleNote, setScaleNote] = useState<string>('');
  const [calibrating, setCalibrating] = useState(false);
  const [points, setPoints] = useState<PixelPoint[]>([]);
  const [knownDistance, setKnownDistance] = useState('');
  const [wallHeight, setWallHeight] = useState('2.7');
  const [placeUnderlay, setPlaceUnderlay] = useState(true);
  const [opacity, setOpacity] = useState(0.5);
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

  /** Turns the scan plus a scale into reviewable walls, doors and windows. */
  const buildDraft = (scan: PlanAnalysis, mpp: number, scanScale: number, height: number, name = fileName) => {
    const observation = planGeometryToObservation(scan.geometry, mpp / scanScale, { fileName: name, wallHeightM: height });
    const nextDraft = imageObservationToDraft(observation);
    const nextReview = buildReconstructionReview(nextDraft);
    const initial: Record<string, boolean> = {};
    for (const item of nextReview.items) initial[item.id] = item.status !== 'error';
    setDraft(nextDraft);
    setReview(nextReview);
    setDecisions(initial);
    return nextDraft;
  };

  const heightM = () => {
    const h = Number(wallHeight);
    return h > 0.5 && h < 20 ? h : 2.7;
  };

  const scanPlan = async (url: string, size: [number, number], name: string) => {
    setBusy(true);
    setMessage(null);
    setDraft(null); setReview(null); setDecisions({}); setAnalysis(null);
    try {
      const image = await loadImage(url);
      const factor = Math.min(1, ANALYSIS_LIMIT / Math.max(size[0], size[1]));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(2, Math.round(size[0] * factor));
      canvas.height = Math.max(2, Math.round(size[1] * factor));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Browser image analysis is unavailable.');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const raster = ctx.getImageData(0, 0, canvas.width, canvas.height);
      // Let the browser paint the "scanning" state before the (synchronous) analysis starts.
      await new Promise(resolve => setTimeout(resolve, 30));
      const scan = analyseFloorPlan(raster, { fileName: name, wallHeightM: heightM() });
      const scanScale = canvas.width / size[0];
      const mpp = scan.scale.metresPerPixel * scanScale;
      setAnalysis(scan);
      setAnalysisScale(scanScale);
      setMetresPerPixel(mpp);
      setScaleNote(scan.scale.evidence);
      if (scan.scale.pointA && scan.scale.pointB && scan.scale.knownDistanceM) {
        setPoints([[scan.scale.pointA[0] / scanScale, scan.scale.pointA[1] / scanScale], [scan.scale.pointB[0] / scanScale, scan.scale.pointB[1] / scanScale]]);
        setKnownDistance(scan.scale.knownDistanceM.toFixed(3));
      } else {
        setPoints([]);
        setKnownDistance('');
      }
      buildDraft(scan, mpp, scanScale, heightM(), name);
      const walls = scan.geometry.walls.length;
      const doors = scan.geometry.openings.filter(o => o.kind === 'door').length;
      const windows = scan.geometry.openings.filter(o => o.kind === 'window').length;
      setMessage(walls
        ? `Found ${walls} walls, ${doors} doors and ${windows} windows. Click any item on the plan to include or leave it out.`
        : 'No strong wall lines were found. Try a cleaner, higher-contrast plan image.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Plan recognition failed.');
    } finally {
      setBusy(false);
    }
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
      const size: [number, number] = [image.naturalWidth, image.naturalHeight];
      setFileName(file.name);
      setSourceFile(file);
      setImageUrl(url);
      setPixelSize(size);
      setCalibrating(false);
      await scanPlan(url, size, file.name);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load image.');
      setBusy(false);
    }
  };

  // Manual scale: two points a known distance apart.
  const manualScale = useMemo(() => {
    if (points.length !== 2) return null;
    const distance = parseDimension(knownDistance.trim()) ?? (Number(knownDistance) > 0 ? Number(knownDistance) : null);
    if (!distance || !(distance > 0)) return null;
    const pixels = Math.hypot(points[1]![0] - points[0]![0], points[1]![1] - points[0]![1]);
    return pixels > 0 ? { distance, mpp: distance / pixels, pixels } : null;
  }, [points, knownDistance]);

  const handlePlanClick = (event: React.MouseEvent<Element>) => {
    if (!calibrating || !pixelSize || !imageRef.current) return;
    const rect = imageRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(pixelSize[0], (event.clientX - rect.left) / rect.width * pixelSize[0]));
    const y = Math.max(0, Math.min(pixelSize[1], (event.clientY - rect.top) / rect.height * pixelSize[1]));
    setPoints(previous => previous.length >= 2 ? [[x, y]] : [...previous, [x, y]]);
  };

  const applyManualScale = () => {
    if (!analysis || !manualScale) return;
    setMetresPerPixel(manualScale.mpp);
    setScaleNote(`Set by you: ${formatMetres(manualScale.distance)} between the two points.`);
    buildDraft(analysis, manualScale.mpp, analysisScale, heightM());
    setCalibrating(false);
    setMessage('Scale updated; the walls, doors and windows have been re-measured.');
  };

  const changeWallHeight = (value: string) => {
    setWallHeight(value);
    const h = Number(value);
    if (analysis && metresPerPixel && h > 0.5 && h < 20) buildDraft(analysis, metresPerPixel, analysisScale, h);
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
    if (!draft || !imageUrl || !pixelSize || !metresPerPixel) return;
    const reviewed = applyReconstructionReview(draft, decisions);
    const result = commitReconstructionDraft(reviewed, { includeFurniture: true });
    const added = [...result.shapes];
    if (placeUnderlay) {
      try {
        added.unshift(createReferencePlanShape(
          { kind: 'image', name: fileName || 'Floor plan', imageUrl, pixelWidth: pixelSize[0], pixelHeight: pixelSize[1] },
          { pixelA: [0, 0], pixelB: [pixelSize[0], 0], knownDistanceM: pixelSize[0] * metresPerPixel },
          { opacity, locked: true },
        ));
      } catch { /* the model is still added without the picture */ }
    }
    const health = checkModelHealth([...shapes, ...result.shapes]);
    setShapes(previous => [...previous, ...added]);
    const walls = result.shapes.filter(s => s.type === 'wall').length;
    const doors = result.shapes.filter(s => s.type === 'door').length;
    const windows = result.shapes.filter(s => s.type === 'window').length;
    setMessage(`Added ${walls} walls, ${doors} doors and ${windows} windows${placeUnderlay ? ' and the plan picture underneath' : ''}. Model health: ${health.errors} errors, ${health.warnings} warnings.`);
    setDraft(null);
    setReview(null);
    setDecisions({});
  };

  if (!open) return null;

  const geometry = analysis?.geometry;
  const itemStatus = (id: string) => review?.items.find(item => item.id === id)?.status;
  const toggle = (id: string) => {
    if (itemStatus(id) === 'error') return;
    setDecisions(previous => ({ ...previous, [id]: !(previous[id] ?? false) }));
  };
  const counts = review ? {
    kept: Object.values(decisions).filter(Boolean).length,
    total: review.items.length,
  } : null;

  // Overlay rectangles in analysis pixels.
  const wallRects = geometry?.walls.map(w => ({
    id: w.id,
    x: w.o === 'h' ? w.a0 : w.c0, y: w.o === 'h' ? w.c0 : w.a0,
    w: w.o === 'h' ? w.a1 - w.a0 : w.c1 - w.c0, h: w.o === 'h' ? w.c1 - w.c0 : w.a1 - w.a0,
  })) ?? [];
  const openingRects = geometry?.openings.map(o => ({
    id: `${o.kind}-${o.id.replace('opening-', '')}`, kind: o.kind,
    x: o.o === 'h' ? o.a0 : o.c - 7, y: o.o === 'h' ? o.c - 7 : o.a0,
    w: o.o === 'h' ? o.a1 - o.a0 : 14, h: o.o === 'h' ? 14 : o.a1 - o.a0,
  })) ?? [];
  const readings = analysis?.scale.readings ?? [];

  return (
    <AnimatePresence>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Reconstruct from plan or image"
        className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 14 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 14 }}
          className="w-full max-w-6xl max-h-[94vh] overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl flex flex-col"
        >
          <header className="px-5 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-gray-900 dark:text-white">Reconstruction Studio</h2>
              <p className="text-xs text-gray-500 mt-0.5">Add a floor plan. PolyForm finds the walls, doors and windows, reads the scale from the plan's own dimensions, and lets you check everything before it is added.</p>
            </div>
            <button onClick={() => setOpen(false)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Close">
              <X size={18} />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto p-5 grid lg:grid-cols-[1.5fr_0.8fr] gap-5">
            <section className="space-y-4 min-w-0">
              {!imageUrl ? (
                <label className="min-h-80 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-2xl flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-polyform-blue">
                  {busy ? <Loader2 className="animate-spin" /> : <ImagePlus size={34} className="text-polyform-blue" />}
                  <div className="text-center">
                    <div className="font-semibold text-sm">Choose a floor-plan image</div>
                    <div className="text-xs text-gray-500 mt-1">PNG, JPG, WebP or SVG. It stays on your computer.</div>
                  </div>
                  <input type="file" accept="image/*" className="hidden" data-testid="plan-file" onChange={e => handleFile(e.target.files?.[0])} />
                </label>
              ) : (
                <div className="rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden bg-gray-50 dark:bg-gray-950">
                  <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between text-xs gap-3">
                    <span className="font-medium truncate">{fileName}</span>
                    <span className="flex items-center gap-3 shrink-0">
                      {busy && <span className="flex items-center gap-1.5 text-gray-500"><Loader2 size={13} className="animate-spin" /> Scanning the plan…</span>}
                      <label className="text-polyform-blue font-semibold cursor-pointer">
                        Replace
                        <input type="file" accept="image/*" className="hidden" onChange={e => handleFile(e.target.files?.[0])} />
                      </label>
                    </span>
                  </div>
                  <div className="p-3 overflow-auto">
                    <div className="relative inline-block max-w-full">
                      <img
                        ref={imageRef}
                        src={imageUrl}
                        alt="Plan to reconstruct"
                        onClick={handlePlanClick}
                        className={cn('max-w-full max-h-[60vh] object-contain select-none', calibrating && 'cursor-crosshair')}
                        draggable={false}
                      />
                      {geometry && pixelSize && (
                        <svg
                          viewBox={`0 0 ${geometry.width} ${geometry.height}`}
                          className="absolute inset-0 w-full h-full"
                          onClick={handlePlanClick}
                          aria-label="Detected walls, doors and windows"
                        >
                          {wallRects.map(r => {
                            const on = decisions[r.id] ?? false;
                            return (
                              <rect key={r.id} x={r.x} y={r.y} width={r.w} height={r.h} data-item={r.id}
                                fill={on ? 'rgba(37,99,235,0.55)' : 'rgba(107,114,128,0.25)'} stroke={on ? '#1d4ed8' : '#6b7280'} strokeWidth={0.8}
                                strokeDasharray={on ? undefined : '3 2'}
                                className={calibrating ? undefined : 'cursor-pointer'}
                                onClick={e => { if (!calibrating) { e.stopPropagation(); toggle(r.id); } }}>
                                <title>{`${r.id} - click to ${on ? 'leave out' : 'include'}`}</title>
                              </rect>
                            );
                          })}
                          {openingRects.map(r => {
                            const on = decisions[r.id] ?? false;
                            const col = r.kind === 'door' ? '#16a34a' : '#0891b2';
                            return (
                              <g key={r.id} className={calibrating ? undefined : 'cursor-pointer'} data-item={r.id}
                                onClick={e => { if (!calibrating) { e.stopPropagation(); toggle(r.id); } }}>
                                <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={on ? col : '#9ca3af'} fillOpacity={on ? 0.6 : 0.3} stroke={on ? col : '#6b7280'} strokeWidth={1.2} strokeDasharray={on ? undefined : '3 2'}>
                                  <title>{`${r.kind} - click to ${on ? 'leave out' : 'include'}`}</title>
                                </rect>
                              </g>
                            );
                          })}
                          {readings.map((reading, i) => (
                            <g key={i} pointerEvents="none">
                              <line x1={reading.a[0]} y1={reading.a[1]} x2={reading.b[0]} y2={reading.b[1]} stroke="#f59e0b" strokeWidth={2.5} strokeLinecap="round" opacity={0.85} />
                            </g>
                          ))}
                        </svg>
                      )}
                      {points.map((point, index) => {
                        if (!pixelSize || !calibrating) return null;
                        return (
                          <span key={index} className="absolute w-4 h-4 -ml-2 -mt-2 rounded-full bg-polyform-blue border-2 border-white shadow pointer-events-none"
                            style={{ left: `${point[0] / pixelSize[0] * 100}%`, top: `${point[1] / pixelSize[1] * 100}%` }}>
                            <span className="sr-only">Scale point {index + 1}</span>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  {geometry && (
                    <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-800 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
                      <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-600 align-middle mr-1" />Walls</span>
                      <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-green-600 align-middle mr-1" />Doors</span>
                      <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-cyan-600 align-middle mr-1" />Windows</span>
                      <span><span className="inline-block w-2.5 h-0.5 bg-amber-500 align-middle mr-1" />Dimensions used for the scale</span>
                      <span className="ml-auto">Click an item to include or leave it out</span>
                    </div>
                  )}
                </div>
              )}

              {review && review.items.length > 0 && (
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                    <div className="text-sm font-bold">Check what was found</div>
                    <div className="text-[11px] text-gray-500">{counts?.kept} of {counts?.total} included · {review.review} to look at · {review.errors} unusable</div>
                  </div>
                  <div className="max-h-56 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
                    {(['wall', 'opening', 'furniture'] as const).map(kind => {
                      const items = review.items.filter(item => item.kind === kind);
                      if (!items.length) return null;
                      return (
                        <div key={kind}>
                          <div className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500 bg-gray-50/60 dark:bg-gray-800/40">{KIND_LABEL[kind]} ({items.length})</div>
                          {items.map(item => (
                            <label key={item.id} className="px-4 py-2 flex items-center gap-3 text-xs">
                              <input type="checkbox" checked={decisions[item.id] ?? false} disabled={item.status === 'error'}
                                onChange={e => setDecisions(previous => ({ ...previous, [item.id]: e.target.checked }))} />
                              <span className={cn('w-2 h-2 rounded-full', item.status === 'accepted' ? 'bg-emerald-500' : item.status === 'review' ? 'bg-amber-500' : 'bg-red-500')} />
                              <span className="font-medium flex-1">{item.id}</span>
                              <span className="text-gray-500">{Math.round(item.confidence * 100)}%</span>
                              <span className="capitalize text-gray-500">{item.status}</span>
                            </label>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>

            <aside className="space-y-4">
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                <div className="flex items-center gap-2 font-bold text-sm"><Ruler size={16} /> Scale</div>
                {metresPerPixel && pixelSize ? (
                  <>
                    <div className="text-xs text-emerald-700 dark:text-emerald-400">
                      The plan is {formatMetres(pixelSize[0] * metresPerPixel)} × {formatMetres(pixelSize[1] * metresPerPixel)}
                    </div>
                    <p className="text-xs text-gray-500">{scaleNote}</p>
                    {analysis && analysis.scale.confidence < 0.6 && (
                      <p className="text-xs text-amber-700 dark:text-amber-400">This is only a guess. If you know one length on the plan, set it below.</p>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-gray-500">The scale is read from the dimensions printed on the plan once it is scanned.</p>
                )}
                {imageUrl && (
                  <>
                    <button onClick={() => { setCalibrating(c => !c); setMessage(null); }}
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-xs font-semibold hover:bg-gray-50 dark:hover:bg-gray-800">
                      {calibrating ? 'Cancel setting the scale' : 'Set the scale myself'}
                    </button>
                    {calibrating && (
                      <div className="space-y-2 text-xs">
                        <p className="text-gray-500">Click two points on the plan whose real distance you know, then enter it (metres like 4.2, or 13'6").</p>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-2">A: {points[0] ? `${Math.round(points[0][0])}, ${Math.round(points[0][1])}` : 'not set'}</div>
                          <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-2">B: {points[1] ? `${Math.round(points[1][0])}, ${Math.round(points[1][1])}` : 'not set'}</div>
                        </div>
                        <label className="block font-medium">Real distance
                          <input value={knownDistance} onChange={e => setKnownDistance(e.target.value)} placeholder="4.2 or 13'6&quot;"
                            className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2" />
                        </label>
                        <button onClick={applyManualScale} disabled={!manualScale}
                          className="w-full px-3 py-2 rounded-lg bg-polyform-blue text-white font-bold disabled:opacity-40">
                          Use this scale{manualScale ? ` (${formatMetres(manualScale.distance)})` : ''}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                <div className="flex items-center gap-2 font-bold text-sm"><ScanLine size={16} /> Add to the model</div>
                <label className="block text-xs font-medium">Wall height (metres)
                  <input type="number" min="1" max="10" step="0.1" value={wallHeight} onChange={e => changeWallHeight(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2" />
                </label>
                <label className="flex items-start gap-2 text-xs">
                  <input type="checkbox" checked={placeUnderlay} onChange={e => setPlaceUnderlay(e.target.checked)} className="mt-0.5" />
                  <span>
                    <span className="font-medium">Keep the plan picture under the model</span>
                    <span className="block text-gray-500 mt-0.5">A flat, locked, see-through copy of your plan at the same scale, so you can compare the 3D walls with the drawing or trace anything missed. It isn't part of the building; delete it any time.</span>
                  </span>
                </label>
                {placeUnderlay && (
                  <label className="block text-xs">Picture opacity: {Math.round(opacity * 100)}%
                    <input type="range" min="0.1" max="1" step="0.05" value={opacity} onChange={e => setOpacity(Number(e.target.value))} className="w-full mt-1" />
                  </label>
                )}
                <button onClick={commitReviewed} disabled={!draft || !counts?.kept || busy}
                  className="w-full px-4 py-2.5 rounded-lg bg-polyform-blue text-white text-xs font-bold flex items-center justify-center gap-2 disabled:opacity-40">
                  <Check size={14} /> Add {counts?.kept ?? 0} items to the model
                </button>
                <button onClick={() => imageUrl && pixelSize && scanPlan(imageUrl, pixelSize, fileName)} disabled={!imageUrl || busy}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-xs font-semibold hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40">
                  Scan the plan again
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
                  Requires a Hugging Face API token. Floor-plan scanning above stays entirely on your computer.
                </div>
              </div>

              {message && (
                <div className="rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 p-3 text-xs flex gap-2 text-blue-800 dark:text-blue-200" role="status">
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
