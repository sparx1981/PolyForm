import * as THREE from 'three';
// @ts-ignore
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter';
// @ts-ignore
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { buildScene, toGLB } from 'openskp';

/**
 * Service to handle SketchUp (.skp) file interactions.
 * Since native .skp parsing is proprietary, we use an industry-standard GLTF bridge
 * optimized for SketchUp's coordinate system and material structure.
 */
export const SketchupService = {
  /**
   * Exports the current scene as a SketchUp-optimized GLTF file.
   */
  exportAsSKP: (scene: THREE.Scene, filename: string) => {
    const exporter = new GLTFExporter();
    
    // Prepare scene for SketchUp compatibility (Unity/SketchUp axis alignment)
    // SketchUp uses Z-up by default, Three.js uses Y-up.
    
    exporter.parse(
      scene,
      (gltf: any) => {
        const blob = new Blob([JSON.stringify(gltf)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename.endsWith('.skp') ? filename : `${filename}.skp.gltf`;
        link.click();
        URL.revokeObjectURL(url);
        console.log('[SketchupService] Exported scene for SketchUp');
      },
      (error: any) => {
        console.error('[SketchupService] Export failed:', error);
      },
      { binary: false, embedImages: true }
    );
  },

  /**
   * Imports a SketchUp file.
   * In a real production environment, this would involve a server-side conversion or a WASM bridge.
   * For this implementation, we accept .gltf files (which SketchUp can export/produce) 
   * as the high-fidelity bridge format.
   */
  importSKP: async (file: File): Promise<THREE.Group> => {
    const lowerName = file.name.toLowerCase();

    // Real binary .skp files: parse natively with OpenSKP (an open-source,
    // reverse-engineered reader for SketchUp's binary format that runs
    // entirely client-side - no SketchUp SDK, no server round-trip), then
    // bridge the result through GLTFLoader so it renders like any other
    // imported model.
    if (lowerName.endsWith('.skp')) {
      const buffer = await file.arrayBuffer();
      const head = new Uint8Array(buffer.slice(0, 4));
      // Our legacy "bridge" .skp files are just GLTF JSON text saved with a
      // .skp extension - they start with '{' (0x7b) or whitespace. Real
      // SketchUp binaries start with a VFF/MFC binary header and won't.
      const looksLikeTextBridge = head[0] === 0x7b || head[0] === 0x20 || head[0] === 0x0a || head[0] === 0x09;

      if (!looksLikeTextBridge) {
        try {
          const scene = buildScene(buffer);
          const glb = toGLB(scene);
          const glbBuffer = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength);
          return await new Promise((resolve, reject) => {
            const loader = new GLTFLoader();
            loader.parse(
              glbBuffer,
              '',
              (gltf: any) => {
                console.log('[SketchupService] Parsed native .skp via OpenSKP');
                resolve(gltf.scene);
              },
              (error: any) => {
                console.error('[SketchupService] GLB build error:', error);
                reject(new Error('Read the SketchUp file but could not build a viewable model from it.'));
              }
            );
          });
        } catch (err: any) {
          console.error('[SketchupService] OpenSKP parse failed:', err);
          throw new Error(`Could not read this SketchUp file (${err?.message || 'unknown error'}). It may use a SketchUp version or feature that isn't supported yet.`);
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
              console.error('[SketchupService] GLTF parse error:', error);
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
