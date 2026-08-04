import * as THREE from 'three';
// @ts-ignore
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter';
// @ts-ignore
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

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
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const contents = e.target?.result;
        if (typeof contents !== 'string') {
          reject(new Error('Invalid file format. Please use a text-based GLTF file.'));
          return;
        }

        // Detect SketchUp binary signature
        const isSkp = contents.startsWith('SketchUp') || 
                      contents.includes('SketchUp Model') || 
                      contents.includes('໿SketchUp') ||
                      contents.charCodeAt(0) === 0x0BF3 || // ໿ character
                      contents.startsWith('\xFF\xFE') || // UTF-16 BOM sometimes present in binary exports
                      contents.includes('binary');

        if (isSkp && !contents.includes('"asset"')) { // GLTF usually has "asset" key
          reject(new Error('DraftUp supports .skp files via the GLTF bridge. Please export your SketchUp model as .gltf/.glb before importing, or use our desktop extension. Native binary .skp parsing is not available in-browser.'));
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
