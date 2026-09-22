import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const require = createRequire(import.meta.url);
const exec = promisify(execFile);
const cli = join(dirname(require.resolve('@gltf-transform/cli')), '..', 'bin', 'cli.js');
const directory = join('public', 'polyhaven-models-decimated');
const catalogPath = join('src', 'lib', 'graphics', 'polyhavenModelCatalog.json');
const trees = ['tree_small_02', 'island_tree_01', 'jacaranda_tree', 'fir_sapling_medium', 'fir_tree_01', 'pine_tree_01'];
const verifyOnly = process.argv.includes('--verify-only');
const catalogOnly = process.argv.includes('--catalog-only');

async function metadata(path) {
  const buffer = await readFile(path);
  if (buffer.toString('ascii', 0, 4) !== 'glTF') throw new Error(`Invalid GLB: ${path}`);
  const json = JSON.parse(buffer.toString('utf8', 20, 20 + buffer.readUInt32LE(12)));
  const primitives = json.meshes.flatMap(mesh => mesh.primitives);
  return {
    triangles: primitives.reduce((sum, primitive) => sum + Math.floor(json.accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3), 0),
    materials: json.materials?.length ?? 0,
    textures: json.textures?.length ?? 0,
    images: json.images?.length ?? 0,
    uvSets: primitives.map(primitive => Object.keys(primitive.attributes).filter(key => key.startsWith('TEXCOORD_')).sort().join(',')),
    materialBindings: (json.materials ?? []).map(material => ({
      alphaMode: material.alphaMode ?? 'OPAQUE',
      alphaCutoff: material.alphaCutoff ?? 0.5,
      doubleSided: material.doubleSided ?? false,
      textureTransforms: JSON.stringify(material).match(/KHR_texture_transform/g)?.length ?? 0,
    })),
  };
}

const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
for (const id of trees) {
  const source = join(directory, `${id}.glb`);
  const original = await metadata(source);
  const urls = [];
  for (const [tier, ratio] of [[1, 0.25], [2, 0.05]]) {
    const output = join(directory, `${id}_lod${tier}.glb`);
    if (!verifyOnly && !catalogOnly) {
      const { stdout, stderr } = await exec(process.execPath, [cli, 'optimize', source, output,
        '--compress', 'meshopt', '--simplify-ratio', String(ratio), '--simplify-error', '0.01',
        '--prune', 'false', '--palette', 'false', '--instance', 'false', '--flatten', 'false',
        '--join', 'false', '--texture-compress', 'false'], { maxBuffer: 64 * 1024 * 1024 });
      process.stdout.write(stdout); process.stderr.write(stderr);
    }
    const result = await metadata(output);
    const fraction = result.triangles / original.triangles;
    if (fraction > (tier === 1 ? 0.32 : 0.12) || fraction < ratio * 0.5) throw new Error(`${id} LOD${tier} triangle ratio ${fraction.toFixed(3)} is unexpected`);
    for (const property of ['materials', 'textures', 'images', 'uvSets', 'materialBindings']) {
      if (JSON.stringify(result[property]) !== JSON.stringify(original[property])) throw new Error(`${id} LOD${tier} changed ${property}`);
    }
    console.log(`${id} LOD${tier}: ${result.triangles.toLocaleString()} / ${original.triangles.toLocaleString()} triangles (${(fraction * 100).toFixed(1)}%)`);
    urls.push(`/polyhaven-models-decimated/${id}_lod${tier}.glb`);
  }
  const entry = catalog.assets.find(asset => asset.sourceId === id);
  if (!entry) throw new Error(`Missing catalog entry for ${id}`);
  entry.lodUrls = urls;
}
if (!verifyOnly) await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
