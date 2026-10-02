import type { FileStub } from './skpArchive';

/** What PolyForm needs to know about a SketchUp material to colour a face. */
export interface SkpMaterial {
  name: string;
  color: { r: number; g: number; b: number; a: number };
  /** 1 is opaque. */
  transparency: number;
  texture: { filename: string; width: number; height: number; data: FileStub | null } | null;
}

function decodeXmlEntities(value: string): string {
  return value.replace(/&(lt|gt|amp|apos|quot|#\d+|#x[0-9a-fA-F]+);/g, (whole, entity: string) => {
    switch (entity) {
      case 'lt': return '<';
      case 'gt': return '>';
      case 'amp': return '&';
      case 'apos': return "'";
      case 'quot': return '"';
      default:
        if (entity[0] === '#') {
          const codePoint = entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
          return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : whole;
        }
        return whole;
    }
  });
}

interface ParsedMaterialXml {
  name: string;
  r: number;
  g: number;
  b: number;
  trans: number;
  hasTexture: boolean;
  textureFilename: string;
  xScale: number;
  yScale: number;
  imagePath: string;
}

const attribute = (attrs: string, name: string): string | null => {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`));
  const raw = m ? (m[1] !== undefined ? m[1] : m[2]) : null;
  return raw === null ? null : decodeXmlEntities(raw);
};

export function parseMaterialXml(xmlText: string): ParsedMaterialXml | null {
  const match = xmlText.match(/<(?:[a-zA-Z0-9_]+:)?material\b([^>]*)\/?>/);
  if (!match) return null;
  const attrs = match[1];
  const name = attribute(attrs, 'name') || 'unknown';
  const r = parseInt(attribute(attrs, 'colorRed') || '128', 10);
  const g = parseInt(attribute(attrs, 'colorGreen') || '128', 10);
  const b = parseInt(attribute(attrs, 'colorBlue') || '128', 10);
  let trans = 1;
  if (attribute(attrs, 'useTrans') === '1') trans = Math.min(Math.max(1 - parseFloat(attribute(attrs, 'trans') || '0'), 0), 1);
  const textureMatch = xmlText.match(/<(?:[a-zA-Z0-9_]+:)?texture\b([^>]*)\/?>/);
  let hasTexture = false;
  let textureFilename = '';
  let xScale = 0;
  let yScale = 0;
  if (textureMatch) {
    hasTexture = true;
    const texAttrs = textureMatch[1];
    textureFilename = attribute(texAttrs, 'textureFilename') || '';
    const xs = parseFloat(attribute(texAttrs, 'xScale') || '0');
    xScale = Number.isNaN(xs) ? 0 : xs;
    const ys = parseFloat(attribute(texAttrs, 'yScale') || '0');
    yScale = Number.isNaN(ys) ? 0 : ys;
  }
  const imageMatch = xmlText.match(/<(?:[a-zA-Z0-9_]+:)?image\b[^>]*\bpath\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*\/?>/);
  const imagePath = imageMatch ? decodeXmlEntities(imageMatch[1] !== undefined ? imageMatch[1] : imageMatch[2]) : '';
  return { name, r, g, b, trans, hasTexture, textureFilename, xScale, yScale, imagePath };
}

function lstripChars(s: string, chars: string): string {
  let i = 0;
  while (i < s.length && chars.includes(s[i])) i++;
  return s.slice(i);
}

function resolveTexture(files: Map<string, FileStub>, xmlName: string, filename: string, imagePath: string): { data: FileStub | null; filename: string } {
  const names = [...files.keys()];
  const slash = xmlName.lastIndexOf('/');
  const folder = slash >= 0 ? xmlName.slice(0, slash) : '';
  let data: FileStub | null = null;
  let resolved = filename;
  const candidate = filename ? `${folder}/${filename}` : null;
  if (candidate && files.has(candidate)) {
    data = files.get(candidate)!;
  } else {
    for (const entry of names) {
      if (entry.startsWith(folder + '/') && entry !== xmlName && !entry.toLowerCase().endsWith('.xml')) {
        data = files.get(entry)!;
        if (!resolved) resolved = entry.split('/').pop() || '';
        break;
      }
    }
  }
  if (data === null) {
    const imgPath = lstripChars(imagePath, './');
    for (const cand of [imgPath, folder ? `${folder}/${imgPath}` : imgPath]) {
      if (cand && files.has(cand)) {
        data = files.get(cand)!;
        if (!resolved) resolved = cand.split('/').pop() || '';
        break;
      }
    }
  }
  return { data, filename: resolved };
}

export interface MaterialTables {
  materialsMap: Map<string, SkpMaterial>;
  materialsByFolder: Map<string, SkpMaterial>;
  layerColors: Map<string, [number, number, number]>;
}

/** Builds the material tables from the material.xml files of the archive. */
export function buildMaterialTables(xmlFiles: Map<string, Uint8Array>, otherFiles: Map<string, FileStub>): MaterialTables {
  const materialsMap = new Map<string, SkpMaterial>();
  const materialsByFolder = new Map<string, SkpMaterial>();
  const layerColors = new Map<string, [number, number, number]>();
  const decoder = new TextDecoder('utf-8');
  for (const [name, xmlBytes] of xmlFiles) {
    try {
      const parsed = parseMaterialXml(decoder.decode(xmlBytes));
      if (!parsed) continue;
      let texture: SkpMaterial['texture'] = null;
      if (parsed.hasTexture) {
        const resolved = resolveTexture(otherFiles, name, parsed.textureFilename, parsed.imagePath);
        texture = { filename: resolved.filename, width: parsed.xScale, height: parsed.yScale, data: resolved.data };
      }
      const material: SkpMaterial = { name: parsed.name, color: { r: parsed.r, g: parsed.g, b: parsed.b, a: 255 }, transparency: parsed.trans, texture };
      materialsMap.set(parsed.name, material);
      const folder = name.split('/')[1] || '';
      if (folder) materialsByFolder.set(folder, material);
      if (parsed.name.startsWith('Layer_')) layerColors.set(parsed.name.slice(6), [parsed.r, parsed.g, parsed.b]);
    } catch {
      // A material file that cannot be read leaves that material at its default colour.
    }
  }
  return { materialsMap, materialsByFolder, layerColors };
}
