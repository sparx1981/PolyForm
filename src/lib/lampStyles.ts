export interface LampStyleDef {
  id: string;
  name: string;
  description: string;
}

export const LAMP_STYLES: LampStyleDef[] = [
  { id: 'classic', name: 'Classic Post Lamp', description: 'Traditional round lantern on a tapered pole - the timeless park & driveway look.' },
  { id: 'cobra', name: 'Cobra Head', description: 'Modern municipal street light with an angled arm casting light down over the roadway.' },
  { id: 'victorian', name: 'Victorian Ornate', description: 'Decorative cast-iron pole with banded scrollwork and a boxy four-sided lantern.' },
  { id: 'bollard', name: 'Bollard Path Light', description: 'Short, sturdy pathway light for walkways, gardens and low-level accent lighting.' },
];

export function findLampStyle(id: string | undefined): LampStyleDef {
  return LAMP_STYLES.find(s => s.id === id) || LAMP_STYLES[0];
}
