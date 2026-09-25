/**
 * Plain PBR finishes: no textures, just a colour and how rough, metallic and see-through the
 * surface is. Values follow common physically based references (e.g. metals are fully metallic
 * with their own tinted reflectance colour; glass is dielectric, smooth and mostly transparent).
 */
export interface PlainFinish {
  id: string;
  name: string;
  color: string;
  roughness: number;
  metalness: number;
  opacity: number;
}

export type FinishFamily = 'plastic' | 'metal' | 'glass' | 'other';

export const FINISH_FAMILIES: { id: FinishFamily; label: string }[] = [
  { id: 'plastic', label: 'Plastic' },
  { id: 'metal', label: 'Metal' },
  { id: 'glass', label: 'Glass' },
  { id: 'other', label: 'Other' },
];

const plastic = (id: string, name: string, color: string, roughness: number): PlainFinish =>
  ({ id: `plastic-${id}`, name, color, roughness, metalness: 0, opacity: 1 });

export const PLAIN_FINISHES: Record<FinishFamily, PlainFinish[]> = {
  plastic: [
    plastic('white-gloss', 'Gloss white plastic', '#f4f4f2', 0.12),
    plastic('white-satin', 'Satin white plastic', '#eeeeea', 0.35),
    plastic('white-matte', 'Matte white plastic', '#e8e8e4', 0.7),
    plastic('black-gloss', 'Gloss black plastic', '#151517', 0.12),
    plastic('black-matte', 'Matte black plastic', '#1d1d20', 0.7),
    plastic('grey-satin', 'Satin grey plastic', '#8a8d91', 0.35),
    plastic('red-gloss', 'Gloss red plastic', '#c1272d', 0.15),
    plastic('blue-gloss', 'Gloss blue plastic', '#1f5fbf', 0.15),
    plastic('yellow-satin', 'Satin yellow plastic', '#f2c230', 0.35),
    plastic('green-satin', 'Satin green plastic', '#2f8f4e', 0.35),
    plastic('orange-matte', 'Matte orange plastic', '#e8742a', 0.6),
    plastic('rubber', 'Black rubber', '#232325', 0.92),
  ],
  metal: [
    { id: 'metal-steel-brushed', name: 'Brushed steel', color: '#b4b7ba', roughness: 0.38, metalness: 1, opacity: 1 },
    { id: 'metal-stainless', name: 'Polished stainless', color: '#c8cbcd', roughness: 0.15, metalness: 1, opacity: 1 },
    { id: 'metal-chrome', name: 'Chrome', color: '#e6e8ea', roughness: 0.04, metalness: 1, opacity: 1 },
    { id: 'metal-aluminium', name: 'Aluminium', color: '#d6d8da', roughness: 0.3, metalness: 1, opacity: 1 },
    { id: 'metal-brass', name: 'Brass', color: '#d8b35a', roughness: 0.25, metalness: 1, opacity: 1 },
    { id: 'metal-copper', name: 'Copper', color: '#d88a5e', roughness: 0.25, metalness: 1, opacity: 1 },
    { id: 'metal-gold', name: 'Gold', color: '#f0c65c', roughness: 0.18, metalness: 1, opacity: 1 },
    { id: 'metal-cast-iron', name: 'Cast iron', color: '#4d4f52', roughness: 0.75, metalness: 1, opacity: 1 },
    { id: 'metal-galvanised', name: 'Galvanised steel', color: '#a7acae', roughness: 0.55, metalness: 1, opacity: 1 },
    { id: 'metal-powder-black', name: 'Black powder-coat', color: '#1f2022', roughness: 0.55, metalness: 0.2, opacity: 1 },
    { id: 'metal-powder-anthracite', name: 'Anthracite powder-coat', color: '#383e42', roughness: 0.5, metalness: 0.2, opacity: 1 },
    { id: 'metal-corten', name: 'Weathering steel', color: '#8a4b2a', roughness: 0.85, metalness: 0.6, opacity: 1 },
  ],
  glass: [
    { id: 'glass-clear', name: 'Clear glass', color: '#e8f3f2', roughness: 0.03, metalness: 0, opacity: 0.2 },
    { id: 'glass-frosted', name: 'Frosted glass', color: '#eef3f3', roughness: 0.55, metalness: 0, opacity: 0.6 },
    { id: 'glass-grey', name: 'Grey tinted glass', color: '#6f7a7c', roughness: 0.04, metalness: 0, opacity: 0.45 },
    { id: 'glass-bronze', name: 'Bronze tinted glass', color: '#8a6a4a', roughness: 0.04, metalness: 0, opacity: 0.45 },
    { id: 'glass-blue', name: 'Blue tinted glass', color: '#5f8fb0', roughness: 0.04, metalness: 0, opacity: 0.4 },
    { id: 'glass-green', name: 'Green tinted glass', color: '#6fa592', roughness: 0.04, metalness: 0, opacity: 0.4 },
    { id: 'glass-reflective', name: 'Reflective glass', color: '#7e9aa6', roughness: 0.03, metalness: 0.9, opacity: 0.85 },
    { id: 'glass-mirror', name: 'Mirror', color: '#dfe3e5', roughness: 0.01, metalness: 1, opacity: 1 },
  ],
  other: [
    { id: 'paint-white-matte', name: 'Matte white paint', color: '#f2f1ec', roughness: 0.8, metalness: 0, opacity: 1 },
    { id: 'paint-eggshell', name: 'Eggshell paint', color: '#ebe6da', roughness: 0.55, metalness: 0, opacity: 1 },
    { id: 'paint-gloss-white', name: 'Gloss white paint', color: '#f6f6f3', roughness: 0.2, metalness: 0, opacity: 1 },
    { id: 'ceramic-white', name: 'Glazed white ceramic', color: '#f5f5f2', roughness: 0.08, metalness: 0, opacity: 1 },
    { id: 'ceramic-matte', name: 'Matte ceramic', color: '#d9d4cc', roughness: 0.6, metalness: 0, opacity: 1 },
    { id: 'concrete-smooth', name: 'Smooth concrete', color: '#a8a7a2', roughness: 0.85, metalness: 0, opacity: 1 },
    { id: 'fabric-grey', name: 'Grey fabric', color: '#7c7f84', roughness: 0.98, metalness: 0, opacity: 1 },
    { id: 'fabric-navy', name: 'Navy fabric', color: '#2b3550', roughness: 0.98, metalness: 0, opacity: 1 },
    { id: 'leather-brown', name: 'Brown leather', color: '#5a3522', roughness: 0.55, metalness: 0, opacity: 1 },
    { id: 'lacquer-black', name: 'Black lacquer', color: '#101012', roughness: 0.08, metalness: 0, opacity: 1 },
  ],
};
