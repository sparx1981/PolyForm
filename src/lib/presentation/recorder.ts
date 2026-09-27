/**
 * Records the 3D view to a video file with the browser's own MediaRecorder: no upload, no AI,
 * just the canvas's pixels. MP4 where the browser can make it (Safari, recent Chrome), otherwise
 * WebM.
 */
export const canvasRef: { current: HTMLCanvasElement | null } = { current: null };

const TYPES = [
  'video/mp4;codecs=avc1.640028',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

export function recordingSupported(): boolean {
  return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement !== 'undefined'
    && 'captureStream' in HTMLCanvasElement.prototype;
}

export function pickVideoType(isSupported: (t: string) => boolean = t => MediaRecorder.isTypeSupported(t)): string {
  return TYPES.find(t => isSupported(t)) ?? '';
}

export interface Recording {
  stop: () => Promise<Blob>;
  mimeType: string;
}

export function startRecording(fps = 60): Recording {
  const canvas = canvasRef.current;
  if (!canvas) throw new Error('The 3D view is not ready yet.');
  if (!recordingSupported()) throw new Error('This browser cannot record video.');
  const stream = canvas.captureStream(fps);
  const mimeType = pickVideoType();
  const recorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: 12_000_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  recorder.start(250);
  return {
    mimeType: recorder.mimeType || mimeType,
    stop: () => new Promise<Blob>(resolve => {
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || 'video/webm' }));
      };
      recorder.stop();
    }),
  };
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function videoFileName(model: string | null | undefined, mimeType: string) {
  const base = (model || 'polyform').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'polyform';
  return `${base}-presentation.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`;
}
