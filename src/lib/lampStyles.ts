/** What CustomLight this style attaches, and with what defaults - see
 * LampLightBinding.tsx, which reads this instead of one hardcoded light for every
 * style. 'point' suits an omnidirectional bulb/glass fixture; 'spot' suits anything
 * that's genuinely directional in real life (a cutoff roadway head, a downlight,
 * a floodlight) and gets aimed via getLampLightAimOffset; 'rect' suits a flat diffused
 * panel (an office troffer) and is oriented via a fixed rotation, not a target. */
export interface LampLightDefaults {
  type: 'point' | 'spot' | 'rect';
  color: string;
  intensity: number;
  distance?: number;
  decay?: number;
  angle?: number;
  penumbra?: number;
  width?: number;
  height?: number;
}

export interface LampStyleDef {
  id: string;
  name: string;
  description: string;
  category: 'interior' | 'exterior';
  light: LampLightDefaults;
}

export const LAMP_STYLES: LampStyleDef[] = [
  // ---- Exterior ----
  { id: 'classic', name: 'Classic Post Lamp', category: 'exterior',
    description: 'Traditional round lantern on a tapered pole - the timeless park & driveway look.',
    light: { type: 'point', color: '#ffd8a8', intensity: 1.4, distance: 8, decay: 2 } },
  { id: 'cobra', name: 'Cobra Head', category: 'exterior',
    description: 'Municipal street light with an angled arm casting a directional sodium-amber glow down over the roadway.',
    light: { type: 'spot', color: '#ffb347', intensity: 2.2, distance: 14, decay: 2, angle: Math.PI / 3.6, penumbra: 0.3 } },
  { id: 'cobra-double', name: 'Cobra Double Arm', category: 'exterior',
    description: 'Twin cobra heads reaching both ways from one pole, for medians and dual carriageways.',
    light: { type: 'spot', color: '#ffb347', intensity: 2.6, distance: 16, decay: 2, angle: Math.PI / 2.6, penumbra: 0.35 } },
  { id: 'victorian', name: 'Victorian Ornate', category: 'exterior',
    description: 'Decorative cast-iron pole with banded scrollwork and a boxy four-sided lantern.',
    light: { type: 'point', color: '#ffd8a8', intensity: 1.2, distance: 7, decay: 2 } },
  { id: 'post-top', name: 'Post-Top Acorn', category: 'exterior',
    description: 'Plain pole topped with a round acorn-shaped luminaire - common on residential and commercial streets.',
    light: { type: 'point', color: '#fff0d8', intensity: 1.3, distance: 8, decay: 2 } },
  { id: 'modern-led', name: 'Modern LED Cutoff', category: 'exterior',
    description: 'Slim rectangular shoebox fixture on a straight arm - a contemporary full-cutoff roadway light with a crisp, controlled beam.',
    light: { type: 'spot', color: '#eaf4ff', intensity: 2.8, distance: 16, decay: 2, angle: Math.PI / 4.5, penumbra: 0.15 } },
  { id: 'high-mast', name: 'High Mast Floodlight', category: 'exterior',
    description: 'Tall mast with a cluster of floodlights, for highway interchanges and large junctions.',
    light: { type: 'spot', color: '#eef6ff', intensity: 4.5, distance: 30, decay: 2, angle: Math.PI / 2.2, penumbra: 0.4 } },
  { id: 'bollard', name: 'Bollard Path Light', category: 'exterior',
    description: 'Short, sturdy pathway light for walkways, gardens and low-level accent lighting.',
    light: { type: 'point', color: '#ffd8a8', intensity: 0.5, distance: 3, decay: 2 } },
  { id: 'solar-path', name: 'Solar Path Light', category: 'exterior',
    description: 'Self-contained solar-powered light for footways and cycle paths, no wiring needed.',
    light: { type: 'point', color: '#eaf6ef', intensity: 0.45, distance: 3, decay: 2 } },

  // ---- Interior ----
  { id: 'pendant', name: 'Pendant Light', category: 'interior',
    description: 'Single dome shade hanging from a cord - the classic kitchen-island or dining-table drop light.',
    light: { type: 'point', color: '#ffdca8', intensity: 1.0, distance: 5, decay: 2 } },
  { id: 'chandelier', name: 'Chandelier', category: 'interior',
    description: 'Branching multi-arm fixture with several bulbs, for dining rooms and entryways.',
    light: { type: 'point', color: '#ffe4b8', intensity: 1.6, distance: 6, decay: 2 } },
  { id: 'recessed', name: 'Recessed Downlight', category: 'interior',
    description: 'Flush ceiling can light - unobtrusive, even illumination for any room.',
    light: { type: 'spot', color: '#fff8ec', intensity: 1.1, distance: 4.5, decay: 2, angle: Math.PI / 3.6, penumbra: 0.5 } },
  { id: 'track', name: 'Track Light', category: 'interior',
    description: 'Ceiling-mounted rail with adjustable angled heads, for galleries, retail and kitchens.',
    light: { type: 'spot', color: '#fff2e0', intensity: 1.2, distance: 5, decay: 2, angle: Math.PI / 5.1, penumbra: 0.25 } },
  { id: 'floor-lamp', name: 'Floor Lamp', category: 'interior',
    description: 'Freestanding living-room lamp on a slim pole, with a fabric drum shade.',
    light: { type: 'point', color: '#ffd8a8', intensity: 0.9, distance: 4.5, decay: 2 } },
  { id: 'desk-lamp', name: 'Desk Lamp', category: 'interior',
    description: 'Articulated task lamp for a desk or workbench, office or study.',
    light: { type: 'point', color: '#ffd8a8', intensity: 0.55, distance: 2.5, decay: 2 } },
  { id: 'wall-sconce', name: 'Wall Sconce', category: 'interior',
    description: 'Half-shade fixture mounted flush to a wall, for hallways, bedrooms and stairwells.',
    light: { type: 'point', color: '#ffdcb0', intensity: 0.6, distance: 3, decay: 2 } },
  { id: 'high-bay', name: 'Warehouse High-Bay', category: 'interior',
    description: 'Industrial UFO-style fixture for warehouses and workshops with high ceilings.',
    light: { type: 'point', color: '#eef6ff', intensity: 3.2, distance: 14, decay: 2 } },
  { id: 'troffer', name: 'Office Panel Light', category: 'interior',
    description: 'Flat recessed ceiling panel giving even, diffused light - the standard office troffer.',
    light: { type: 'rect', color: '#f5f8ff', intensity: 1.8, width: 1.2, height: 0.6 } },
  { id: 'nightstand', name: 'Nightstand Lamp', category: 'interior',
    description: 'Small bedside table lamp for a soft, low-level bedroom glow.',
    light: { type: 'point', color: '#ffd8a8', intensity: 0.35, distance: 2, decay: 2 } },
];

export function findLampStyle(id: string | undefined): LampStyleDef {
  return LAMP_STYLES.find(s => s.id === id) || LAMP_STYLES[0];
}
