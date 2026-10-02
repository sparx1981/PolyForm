import * as THREE from 'three';
// @ts-ignore
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import type { SkpWorkerMessage } from './skpImport.worker';
import { readSkpToGlb as readSkpToGlbBytes } from '../lib/skp/skpRead';
import { isOutOfMemoryError } from '../lib/skp/outOfMemory';

/** Largest .skp the browser can be asked to read: a single ArrayBuffer tops out near 2 GB. */
const MAX_SKP_BYTES = 1.5 * 1024 * 1024 * 1024;

export interface SkpImportProgress {
  /** Plain-language description of what is happening now. */
  message: string;
  /** 0 to 1 when known. */
  fraction?: number;
}

const STAGE_LABELS: Record<string, string> = {
  tlv_walk: 'Reading the file',
  legacy_defs: 'Reading components',
  build_scene: 'Building the model',
  scan_placements: 'Checking which components the model uses',
  retry_used_only: 'Memory is tight: reading only the components the model uses',
};

const OUT_OF_MEMORY_HINT = 'The browser ran out of memory reading this model. Try closing other tabs, or in SketchUp use Window > Model Info > Statistics > Purge Unused, then save a smaller copy, or export to glTF/GLB and import that instead.';

/** Turns whatever a reader threw into a message that says what to do about it. */
export function describeSkpError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? '');
  if (isOutOfMemoryError(err)) return OUT_OF_MEMORY_HINT;
  return `Could not read this SKP file (${message || 'unknown error'}). It may use an SKP version or feature that isn't supported yet. Exporting it from SketchUp as glTF/GLB or DAE is a reliable alternative.`;
}

/** Reads a .skp into a GLB on the main thread: used only where web workers are unavailable. */
function readSkpToGlbHere(buffer: ArrayBuffer, onProgress?: (p: SkpImportProgress) => void): ArrayBuffer {
  const options = {
    respectEdgeVisibility: true,
    appearance: 'polyform' as const,
    onProgress: (info: { stage: string; current: number; total: number }) =>
      onProgress?.({ message: STAGE_LABELS[info.stage] ?? 'Reading the file', fraction: info.total ? info.current / info.total : undefined }),
  };
  const glb = readSkpToGlbBytes(buffer, options);
  return (glb.byteOffset === 0 && glb.byteLength === glb.buffer.byteLength ? glb.buffer : glb.slice().buffer) as ArrayBuffer;
}

/** Reads a .skp into a GLB in a worker, so the page stays responsive and can show progress. */
function readSkpToGlb(buffer: ArrayBuffer, onProgress?: (p: SkpImportProgress) => void): Promise<ArrayBuffer> {
  let worker: Worker;
  try {
    worker = new Worker(new URL('./skpImport.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return Promise.resolve(readSkpToGlbHere(buffer, onProgress));
  }
  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<SkpWorkerMessage>) => {
      const data = event.data;
      if (data.type === 'progress') {
        onProgress?.({ message: STAGE_LABELS[data.stage] ?? 'Reading the file', fraction: data.total ? data.current / data.total : undefined });
        return;
      }
      worker.terminate();
      if (data.type === 'done') resolve(data.glb);
      else reject(new Error(data.message));
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new RangeError('The SKP reader stopped unexpectedly'));
    };
    worker.postMessage({ buffer }, [buffer]);
  });
}

const parseGlb = (glbBuffer: ArrayBuffer): Promise<THREE.Group> => new Promise((resolve, reject) => {
  new GLTFLoader().parse(
    glbBuffer,
    '',
    (gltf: any) => resolve(gltf.scene),
    (error: any) => {
      console.error('[SkpService] GLB build error:', error);
      reject(new Error('Read the SKP file but could not build a viewable model from it.'));
    }
  );
});

/** Largest imported mesh that keeps its texture coordinates. Past this they are dropped, since nothing here draws the textures. */
const MAX_UV_VERTICES = 400_000;

/**
 * Joins every mesh in an imported model into one geometry in world space (what a custom shape holds), keeping
 * each material's colour as a vertex colour. Vertices stay shared as the source meshes share them, and everything is
 * written straight into typed arrays sized up front, so a model with millions of triangles does not build
 * millions-long JavaScript arrays or a clone of every mesh on the way.
 */
export function mergeImportedGroup(group: THREE.Object3D): THREE.BufferGeometry {
  group.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  let vertexTotal = 0;
  let indexTotal = 0;
  let allUv = true;
  group.traverse((child: any) => {
    const position = child.isMesh && child.geometry?.attributes?.position;
    if (!position) return;
    meshes.push(child);
    vertexTotal += position.count;
    indexTotal += child.geometry.index ? child.geometry.index.count : position.count;
    if (!child.geometry.attributes.uv) allUv = false;
  });
  if (meshes.length === 0) throw new Error('No mesh geometry found in the file.');

  const positions = new Float32Array(vertexTotal * 3);
  const normals = new Float32Array(vertexTotal * 3);
  const colors = new Float32Array(vertexTotal * 3).fill(1);
  const keepUv = allUv && vertexTotal <= MAX_UV_VERTICES;
  const uvs = keepUv ? new Float32Array(vertexTotal * 2) : null;
  const indices = vertexTotal > 65535 ? new Uint32Array(indexTotal) : new Uint16Array(indexTotal);
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  let vertexAt = 0;
  let indexAt = 0;
  for (const mesh of meshes) {
    const geometry = mesh.geometry as THREE.BufferGeometry;
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    const { position, normal: normalAttr, uv } = geometry.attributes;
    const index = geometry.index;
    normalMatrix.getNormalMatrix(mesh.matrixWorld);
    // A mirrored placement turns its triangles inside out, so swap two corners of each to keep them facing outwards.
    const mirrored = mesh.matrixWorld.determinant() < 0;
    const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial | undefined;
    const color = material?.color;
    for (let v = 0; v < position.count; v++) {
      const o = (vertexAt + v) * 3;
      point.fromBufferAttribute(position, v).applyMatrix4(mesh.matrixWorld);
      normal.fromBufferAttribute(normalAttr, v).applyMatrix3(normalMatrix).normalize();
      if (mirrored) normal.negate();
      positions[o] = point.x; positions[o + 1] = point.y; positions[o + 2] = point.z;
      normals[o] = normal.x; normals[o + 1] = normal.y; normals[o + 2] = normal.z;
      if (color) { colors[o] = color.r; colors[o + 1] = color.g; colors[o + 2] = color.b; }
      if (uvs) { uvs[(vertexAt + v) * 2] = uv.getX(v); uvs[(vertexAt + v) * 2 + 1] = uv.getY(v); }
    }
    const count = index ? index.count : position.count;
    for (let k = 0; k < count; k += 3) {
      const a = index ? index.getX(k) : k;
      const b = index ? index.getX(k + 1) : k + 1;
      const c = index ? index.getX(k + 2) : k + 2;
      indices[indexAt++] = vertexAt + a;
      indices[indexAt++] = vertexAt + (mirrored ? c : b);
      indices[indexAt++] = vertexAt + (mirrored ? b : c);
    }
    vertexAt += position.count;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (uvs) merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  return merged;
}

/**
 * Opening SketchUp (.skp) files. Real .skp files are read natively with OpenSKP; older PolyForm
 * "bridge" files (glTF saved with a .skp name) still open. Saving as .skp lives in
 * lib/export/skpExport.ts.
 */
export const SkpService = {
  /**
   * Imports an SKP file.
   * Real .skp files are read with OpenSKP in a worker (with progress and a memory-aware error message);
   * glTF text saved with a .skp name is the older "bridge" format and still opens.
   */
  importSKP: async (file: File, onProgress?: (p: SkpImportProgress) => void): Promise<THREE.Group> => {
    const lowerName = file.name.toLowerCase();

    // Real binary .skp files: parse natively with OpenSKP (an open-source,
    // reverse-engineered reader for the .skp binary format that runs
    // entirely client-side - no proprietary SDK, no server round-trip), then
    // bridge the result through GLTFLoader so it renders like any other
    // imported model.
    if (lowerName.endsWith('.skp')) {
      if (file.size > MAX_SKP_BYTES) {
        throw new Error(`This file is ${(file.size / 1024 / 1024 / 1024).toFixed(1)} GB, which is more than the browser can read at once. In SketchUp, purge unused items and save a smaller copy, or export to glTF/GLB and import that instead.`);
      }
      onProgress?.({ message: 'Loading the file' });
      let buffer: ArrayBuffer;
      try {
        buffer = await file.arrayBuffer();
      } catch (err) {
        throw new Error(describeSkpError(err instanceof Error ? err : new RangeError('allocation failed')));
      }
      const head = new Uint8Array(buffer.slice(0, 4));
      // Our legacy "bridge" .skp files are just GLTF JSON text saved with a
      // .skp extension - they start with '{' (0x7b) or whitespace. Real
      // .skp binaries start with a VFF/MFC binary header and won't.
      const looksLikeTextBridge = head[0] === 0x7b || head[0] === 0x20 || head[0] === 0x0a || head[0] === 0x09;

      if (!looksLikeTextBridge) {
        try {
          const glb = await readSkpToGlb(buffer, onProgress);
          onProgress?.({ message: 'Preparing the model', fraction: 1 });
          const group = await parseGlb(glb);
          console.log('[SkpService] Parsed native .skp via OpenSKP');
          return group;
        } catch (err: any) {
          console.error('[SkpService] OpenSKP parse failed:', err);
          throw new Error(describeSkpError(err));
        }
      }
      // Falls through to the legacy text/GLTF-bridge path below for old
      // bridge-exported files.
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const contents = e.target?.result;
        if (typeof contents !== 'string') {
          reject(new Error('Invalid file format. Please use a text-based GLTF file.'));
          return;
        }

        const loader = new GLTFLoader();
        try {
          loader.parse(
            contents,
            '',
            (gltf: any) => {
              resolve(gltf.scene);
            },
            (error: any) => {
              console.error('[SkpService] GLTF parse error:', error);
              reject(new Error('Failed to parse model data. Ensure you are importing a valid GLTF/GLB bridge file.'));
            }
          );
        } catch (err) {
          reject(new Error('Corrupt or incompatible model file.'));
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file.'));
      reader.readAsText(file);
    });
  }
};


const HF_TOKEN_KEY = 'polyform_hf_token';

export const HuggingFaceService = {
  getToken: (): string => {
    try { return localStorage.getItem(HF_TOKEN_KEY) || ''; } catch { return ''; }
  },
  setToken: (token: string) => {
    try { localStorage.setItem(HF_TOKEN_KEY, token); } catch {}
  },

  /**
   * Removes the background from an uploaded texture image using the
   * briaai/RMBG-1.4 model via the Hugging Face Inference API.
   * Returns a PNG Blob with a transparent background.
   */
  removeBackground: async (file: File): Promise<Blob> => {
    const token = HuggingFaceService.getToken();
    if (!token) {
      throw new Error('Add a Hugging Face API token to use AI background removal.');
    }
    const res = await fetch('https://api-inference.huggingface.co/models/briaai/RMBG-1.4', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': file.type || 'application/octet-stream'
      },
      body: file
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 503) {
        throw new Error('The background removal model is warming up on Hugging Face. Please try again in about 20 seconds.');
      }
      throw new Error(`Background removal failed (${res.status}): ${text.slice(0, 200) || res.statusText}`);
    }
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) {
      throw new Error('Background removal did not return an image. Check that your Hugging Face token is valid.');
    }
    return blob;
  },

  /**
   * Generates a base-color material image from a text prompt using a
   * Hugging Face text-to-image model, as a lightweight stand-in for a
   * full PBR generator (StableMaterials). Roughness/metalness are still
   * controlled via the app's normal PBR sliders.
   */
  generateMaterialImage: async (prompt: string): Promise<string> => {
    const token = HuggingFaceService.getToken();
    if (!token) {
      throw new Error('Add a Hugging Face API token to use AI material generation.');
    }
    const fullPrompt = `seamless tileable PBR material texture, flat top-down lighting, no shadows, ${prompt}, high detail, photorealistic`;
    const res = await fetch('https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-2-1', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ inputs: fullPrompt })
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 503) {
        throw new Error('The material generator model is warming up on Hugging Face. Please try again in about 20-30 seconds.');
      }
      throw new Error(`Material generation failed (${res.status}): ${text.slice(0, 200) || res.statusText}`);
    }
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) {
      throw new Error('Material generation did not return an image. Check that your Hugging Face token is valid.');
    }

    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    const size = 512;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0, size, size);
    return canvas.toDataURL('image/jpeg', 0.85);
  },

  /**
   * Converts a GLB (binary glTF) ArrayBuffer into a THREE.Group, for use
   * with model-generation results (e.g. photo-to-3D).
   */
  importGLBBuffer: (buffer: ArrayBuffer): Promise<THREE.Group> => {
    return new Promise((resolve, reject) => {
      const loader = new GLTFLoader();
      loader.parse(
        buffer,
        '',
        (gltf: any) => resolve(gltf.scene),
        (error: any) => {
          console.error('[HuggingFaceService] GLB parse error:', error);
          reject(new Error('Received a 3D model but could not read it.'));
        }
      );
    });
  },

  /**
   * Converts a single photo into a 3D model using stabilityai/TripoSR via
   * the Hugging Face Inference API, returning a ready-to-add THREE.Group.
   */
  photoTo3D: async (file: File): Promise<THREE.Group> => {
    const token = HuggingFaceService.getToken();
    if (!token) {
      throw new Error('Add a Hugging Face API token to use Photo to 3D.');
    }
    const res = await fetch('https://api-inference.huggingface.co/models/stabilityai/TripoSR', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': file.type || 'application/octet-stream'
      },
      body: file
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 503) {
        throw new Error('The Photo to 3D model is warming up on Hugging Face. Please try again in about 30-60 seconds.');
      }
      if (res.status === 404) {
        throw new Error("Photo to 3D isn't available via your Hugging Face account's free Inference API right now. Try again later or use a Hugging Face Pro token.");
      }
      throw new Error(`Photo to 3D failed (${res.status}): ${text.slice(0, 200) || res.statusText}`);
    }
    const buffer = await res.arrayBuffer();
    return HuggingFaceService.importGLBBuffer(buffer);
  }
};
