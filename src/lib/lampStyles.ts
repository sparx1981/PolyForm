export interface LampStyleDef {
  id: string;
  name: string;
  description: string;
}

export const LAMP_STYLES: LampStyleDef[] = [
  { id: 'classic', name: 'Classic Post Lamp', description: 'Traditional round lantern on a tapered pole - the timeless park & driveway look.' },
  { id: 'cobra', name: 'Cobra Head', description: 'Modern municipal street light with an angled arm casting light down over the roadway.' },
  { id: 'cobra-double', name: 'Cobra Double Arm', description: 'Twin cobra heads reaching both ways from one pole, for medians and dual carriageways.' },
  { id: 'victorian', name: 'Victorian Ornate', description: 'Decorative cast-iron pole with banded scrollwork and a boxy four-sided lantern.' },
  { id: 'post-top', name: 'Post-Top Acorn', description: 'Plain pole topped with a round acorn-shaped luminaire - common on residential and commercial streets.' },
  { id: 'modern-led', name: 'Modern LED Cutoff', description: 'Slim rectangular shoebox fixture on a straight arm - a contemporary full-cutoff roadway light.' },
  { id: 'high-mast', name: 'High Mast Floodlight', description: 'Tall mast with a cluster of floodlights, for highway interchanges and large junctions.' },
  { id: 'bollard', name: 'Bollard Path Light', description: 'Short, sturdy pathway light for walkways, gardens and low-level accent lighting.' },
  { id: 'solar-path', name: 'Solar Path Light', description: 'Self-contained solar-powered light for footways and cycle paths, no wiring needed.' },
];

export function findLampStyle(id: string | undefined): LampStyleDef {
  return LAMP_STYLES.find(s => s.id === id) || LAMP_STYLES[0];
}
