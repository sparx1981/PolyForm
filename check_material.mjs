import { NodeIO } from '@gltf-transform/core';
import { KHRTextureTransform, EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions([KHRTextureTransform, EXTMeshoptCompression, KHRMeshQuantization])
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

const path = process.argv[2] || 'public/polyhaven-models-decimated/tree_small_02.glb';
const doc = await io.read(path);

for (const mat of doc.getRoot().listMaterials()) {
  const ti = mat.getBaseColorTextureInfo();
  const ext = ti && ti.getExtension('KHR_texture_transform');
  console.log(mat.getName(), {
    alphaMode: mat.getAlphaMode(),
    texCoord: ti && ti.getTexCoord(),
    hasTransform: !!ext,
    transform: ext ? { offset: ext.getOffset(), scale: ext.getScale() } : null,
  });
}

for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    console.log('primitive attributes:', prim.listSemantics(), '-> material:', prim.getMaterial()?.getName());
  }
}
