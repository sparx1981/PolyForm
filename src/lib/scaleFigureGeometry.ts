import * as THREE from 'three';
// @ts-ignore
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface ScaleFigureCharacter {
  id: string;
  name: string;
  category: 'Professional' | 'Site & Construction' | 'Casual & Public';
  height: number; // in meters (e.g. 1.78)
  width: number;
  depth: number;
  description: string;
  features: string[];
  primaryColor: string;
  secondaryColor: string;
  skinColor: string;
  hairColor: string;
  pantColor: string;
  shoeColor: string;
  hatColor?: string;
  propName: string;
}

export const SCALE_FIGURE_CHARACTERS: ScaleFigureCharacter[] = [
  {
    id: 'architect-alex',
    name: 'Architect Alex',
    category: 'Professional',
    height: 1.78,
    width: 0.55,
    depth: 0.35,
    description: 'Modern architect wearing charcoal tailored blazer, dark trousers, designer glasses, holding rolled A1 drawing set.',
    features: ['1.78m Standard Eye-Level', 'A1 Drawing Scroll', 'Charcoal Tailored Blazer', 'Modern Eyewear'],
    primaryColor: '#334155', // Charcoal blazer
    secondaryColor: '#f8fafc', // White shirt
    skinColor: '#f5d0b0',
    hairColor: '#292524',
    pantColor: '#1e293b',
    shoeColor: '#0f172a',
    propName: 'A1 Drawing Tube'
  },
  {
    id: 'engineer-sam',
    name: 'Site Engineer Sam',
    category: 'Site & Construction',
    height: 1.82,
    width: 0.60,
    depth: 0.40,
    description: 'Field civil engineer equipped with safety yellow hardhat, fluorescent hi-vis vest, heavy-duty work boots, and digital tablet.',
    features: ['1.82m Structural Height', 'Safety Yellow Hardhat', 'Hi-Vis Fluorescent Vest', 'Rugged Steel-Toe Boots'],
    primaryColor: '#eab308', // Safety hi-vis yellow vest
    secondaryColor: '#1e3a8a', // Dark blue work shirt
    skinColor: '#e8be96',
    hairColor: '#451a03',
    pantColor: '#374151',
    shoeColor: '#78350f', // Tan work boots
    hatColor: '#facc15', // Yellow hard hat
    propName: 'Digital Site Tablet'
  },
  {
    id: 'designer-maya',
    name: 'Landscape Architect Maya',
    category: 'Professional',
    height: 1.68,
    width: 0.50,
    depth: 0.32,
    description: 'Site designer in olive utility jacket with cross-body messenger bag, clipboard, and field planting notes.',
    features: ['1.68m Human Scale', 'Olive Utility Jacket', 'Field Clipboard', 'Cross-Body Messenger Bag'],
    primaryColor: '#15803d', // Olive botanical green
    secondaryColor: '#fef08a', // Cream shirt
    skinColor: '#fbcfe8',
    hairColor: '#713f12',
    pantColor: '#1f2937',
    shoeColor: '#475569',
    propName: 'Field Clipboard'
  },
  {
    id: 'surveyor-liam',
    name: 'Land Surveyor Liam',
    category: 'Site & Construction',
    height: 1.76,
    width: 0.58,
    depth: 0.36,
    description: 'Geomatics surveyor in bright orange safety gear holding an electronic laser disto rangefinder and field survey book.',
    features: ['1.76m Elevation Datum', 'Hi-Vis Safety Gear', 'Laser Disto Rangefinder', 'Field Logbook'],
    primaryColor: '#ea580c', // Bright orange safety jacket
    secondaryColor: '#ffffff',
    skinColor: '#fed7aa',
    hairColor: '#1c1917',
    pantColor: '#334155',
    shoeColor: '#451a03',
    hatColor: '#f97316', // Orange safety helmet
    propName: 'Laser Rangefinder'
  },
  {
    id: 'executive-elena',
    name: 'Project Director Elena',
    category: 'Professional',
    height: 1.72,
    width: 0.52,
    depth: 0.30,
    description: 'Design executive in tailored camel coat carrying a slim portfolio briefcase and smartphone.',
    features: ['1.72m Design Stature', 'Tailored Long Coat', 'Slim Executive Briefcase', 'Minimalist Silhouette'],
    primaryColor: '#b45309', // Warm camel coat
    secondaryColor: '#111827', // Black turtleneck
    skinColor: '#fecdd3',
    hairColor: '#18181b',
    pantColor: '#09090b',
    shoeColor: '#09090b',
    propName: 'Executive Briefcase'
  },
  {
    id: 'commuter-leo',
    name: 'Urban Commuter Leo',
    category: 'Casual & Public',
    height: 1.80,
    width: 0.54,
    depth: 0.38,
    description: 'City pedestrian wearing casual denim jacket, carrying an everyday commuter backpack and coffee tumbler.',
    features: ['1.80m Public Scale', 'Commuter Daypack', 'Casual Jacket & Sneakers', 'Travel Tumbler'],
    primaryColor: '#2563eb', // Denim blue jacket
    secondaryColor: '#e2e8f0', // Heather grey tee
    skinColor: '#fde047',
    hairColor: '#3f3f46',
    pantColor: '#475569',
    shoeColor: '#e2e8f0', // White sneakers
    propName: 'Urban Backpack'
  },
  {
    id: 'cyclist-emma',
    name: 'Urban Cyclist Emma',
    category: 'Casual & Public',
    height: 1.65,
    width: 0.52,
    depth: 0.34,
    description: 'Active urban commuter in sporty cyan windbreaker with cycling helmet and shoulder courier bag.',
    features: ['1.65m Athletic Proportion', 'Aerodynamic Helmet', 'High-Vis Cycling Windbreaker', 'Messenger Bag'],
    primaryColor: '#0891b2', // Cyan windbreaker
    secondaryColor: '#0f172a',
    skinColor: '#fecaca',
    hairColor: '#b45309',
    pantColor: '#1e293b',
    shoeColor: '#0284c7', // Sport trainers
    hatColor: '#06b6d4', // Aero helmet
    propName: 'Cycling Helmet & Bag'
  },
  {
    id: 'resident-arthur',
    name: 'Elderly Resident Arthur',
    category: 'Casual & Public',
    height: 1.70,
    width: 0.52,
    depth: 0.35,
    description: 'Senior community resident wearing wool overcoat, classic flat cap, and holding a polished wooden walking cane.',
    features: ['1.70m Community Scale', 'Classic Wool Overcoat', 'Traditional Flat Cap', 'Wooden Walking Cane'],
    primaryColor: '#475569', // Slate wool overcoat
    secondaryColor: '#94a3b8',
    skinColor: '#fed7aa',
    hairColor: '#e2e8f0', // Silver grey hair
    pantColor: '#334155',
    shoeColor: '#1c1917',
    hatColor: '#334155', // Flat cap
    propName: 'Walking Cane'
  }
];

function applyVertexColor(geo: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const color = new THREE.Color(hex);
  const count = geo.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

export function createScaleFigureGeometry(
  characterId: string = 'architect-alex',
  customHeight?: number
): THREE.BufferGeometry {
  const character = SCALE_FIGURE_CHARACTERS.find(c => c.id === characterId) || SCALE_FIGURE_CHARACTERS[0];
  const targetH = customHeight && customHeight > 0.5 ? customHeight : character.height;
  const s = targetH / 1.78; // proportional scale factor

  const parts: THREE.BufferGeometry[] = [];

  // Head (Ellipsoid)
  const headR = 0.105 * s;
  const headY = (1.78 - 0.13) * s;
  const headGeo = new THREE.SphereGeometry(headR, 16, 12);
  headGeo.scale(0.9, 1.15, 0.95);
  headGeo.translate(0, headY, 0.01 * s);
  parts.push(applyVertexColor(headGeo, character.skinColor));

  // Hair or Hat
  if (character.hatColor) {
    if (character.id === 'engineer-sam' || character.id === 'surveyor-liam') {
      // Hardhat (dome + brim ring)
      const helmetDome = new THREE.SphereGeometry(headR * 1.08, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
      helmetDome.scale(0.95, 1.1, 1.0);
      helmetDome.translate(0, headY + 0.02 * s, 0.01 * s);
      parts.push(applyVertexColor(helmetDome, character.hatColor));

      const brim = new THREE.CylinderGeometry(headR * 1.35, headR * 1.35, 0.018 * s, 16);
      brim.translate(0, headY + 0.02 * s, 0.03 * s);
      parts.push(applyVertexColor(brim, character.hatColor));
    } else if (character.id === 'cyclist-emma') {
      // Aero cycling helmet
      const helmet = new THREE.SphereGeometry(headR * 1.15, 14, 10);
      helmet.scale(0.95, 0.9, 1.35);
      helmet.translate(0, headY + 0.04 * s, -0.02 * s);
      parts.push(applyVertexColor(helmet, character.hatColor));
    } else if (character.id === 'resident-arthur') {
      // Flat tweed cap
      const cap = new THREE.CylinderGeometry(headR * 1.15, headR * 1.05, 0.05 * s, 14);
      cap.rotateX(0.12);
      cap.translate(0, headY + 0.07 * s, 0.02 * s);
      parts.push(applyVertexColor(cap, character.hatColor));

      const capVisor = new THREE.BoxGeometry(0.14 * s, 0.015 * s, 0.08 * s);
      capVisor.translate(0, headY + 0.055 * s, 0.10 * s);
      parts.push(applyVertexColor(capVisor, character.hatColor));
    }
  } else {
    // Natural hairstyle
    const hair = new THREE.SphereGeometry(headR * 1.04, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.58);
    hair.scale(0.95, 1.15, 1.0);
    hair.translate(0, headY + 0.025 * s, -0.01 * s);
    parts.push(applyVertexColor(hair, character.hairColor));
  }

  // Glasses for Architect Alex
  if (character.id === 'architect-alex') {
    const glasses = new THREE.BoxGeometry(0.15 * s, 0.025 * s, 0.02 * s);
    glasses.translate(0, headY + 0.015 * s, 0.105 * s);
    parts.push(applyVertexColor(glasses, '#0f172a'));
  }

  // Neck
  const neck = new THREE.CylinderGeometry(0.045 * s, 0.052 * s, 0.07 * s, 10);
  neck.translate(0, (1.78 - 0.25) * s, 0.01 * s);
  parts.push(applyVertexColor(neck, character.skinColor));

  // Upper Torso / Chest / Jacket
  const chestH = 0.36 * s;
  const chestY = (1.78 - 0.46) * s;
  const chest = new THREE.BoxGeometry(0.40 * s, chestH, 0.22 * s);
  chest.translate(0, chestY, 0);
  parts.push(applyVertexColor(chest, character.primaryColor));

  // Shirt collar / tie accent
  const collar = new THREE.BoxGeometry(0.12 * s, 0.10 * s, 0.03 * s);
  collar.translate(0, (1.78 - 0.31) * s, 0.105 * s);
  parts.push(applyVertexColor(collar, character.secondaryColor));

  // Lower Torso / Hips
  const hipsH = 0.20 * s;
  const hipsY = (1.78 - 0.70) * s;
  const isLongCoat = character.id === 'executive-elena' || character.id === 'resident-arthur';
  const hipsColor = isLongCoat ? character.primaryColor : character.pantColor;

  if (isLongCoat) {
    // Trench / Wool coat extending lower
    const coatLower = new THREE.BoxGeometry(0.42 * s, 0.50 * s, 0.26 * s);
    coatLower.translate(0, (1.78 - 0.82) * s, 0);
    parts.push(applyVertexColor(coatLower, character.primaryColor));
  } else {
    const hips = new THREE.BoxGeometry(0.36 * s, hipsH, 0.20 * s);
    hips.translate(0, hipsY, 0);
    parts.push(applyVertexColor(hips, hipsColor));
  }

  // Legs
  const legH = 0.72 * s;
  const legY = 0.42 * s;
  const legR = 0.065 * s;

  // Left Leg (standing straight)
  const leftLeg = new THREE.CylinderGeometry(legR * 1.1, legR * 0.85, legH, 10);
  leftLeg.translate(-0.10 * s, legY, 0);
  parts.push(applyVertexColor(leftLeg, character.pantColor));

  // Right Leg (slight natural shift)
  const rightLeg = new THREE.CylinderGeometry(legR * 1.1, legR * 0.85, legH, 10);
  rightLeg.translate(0.10 * s, legY, 0.03 * s);
  parts.push(applyVertexColor(rightLeg, character.pantColor));

  // Shoes / Boots
  const shoeH = (character.id === 'engineer-sam' || character.id === 'surveyor-liam') ? 0.10 * s : 0.07 * s;
  const shoeL = 0.24 * s;
  const shoeW = 0.09 * s;
  const shoeY = (shoeH / 2);

  const leftShoe = new THREE.BoxGeometry(shoeW, shoeH, shoeL);
  leftShoe.translate(-0.10 * s, shoeY, 0.03 * s);
  parts.push(applyVertexColor(leftShoe, character.shoeColor));

  const rightShoe = new THREE.BoxGeometry(shoeW, shoeH, shoeL);
  rightShoe.translate(0.10 * s, shoeY, 0.06 * s);
  parts.push(applyVertexColor(rightShoe, character.shoeColor));

  // Arms
  const armR = 0.05 * s;
  const armH = 0.56 * s;

  // Left Arm (hanging naturally)
  const leftArm = new THREE.CylinderGeometry(armR * 1.05, armR * 0.85, armH, 8);
  leftArm.rotateZ(0.08);
  leftArm.translate(-0.24 * s, (1.78 - 0.55) * s, 0);
  parts.push(applyVertexColor(leftArm, character.primaryColor));

  // Left Hand
  const leftHand = new THREE.SphereGeometry(0.045 * s, 8, 8);
  leftHand.translate(-0.26 * s, (1.78 - 0.84) * s, 0);
  parts.push(applyVertexColor(leftHand, character.skinColor));

  // Right Arm (posed according to character prop)
  const rightArm = new THREE.CylinderGeometry(armR * 1.05, armR * 0.85, armH, 8);
  const rightHand = new THREE.SphereGeometry(0.045 * s, 8, 8);

  if (character.id === 'architect-alex') {
    // Right arm tucked holding A1 drawing tube
    rightArm.rotateX(-0.45);
    rightArm.rotateZ(-0.15);
    rightArm.translate(0.24 * s, (1.78 - 0.54) * s, 0.12 * s);
    rightHand.translate(0.24 * s, (1.78 - 0.72) * s, 0.25 * s);

    // Rolled A1 Drawing Tube
    const tube = new THREE.CylinderGeometry(0.04 * s, 0.04 * s, 0.65 * s, 12);
    tube.rotateX(Math.PI / 2.6);
    tube.rotateZ(-0.2);
    tube.translate(0.25 * s, (1.78 - 0.68) * s, 0.18 * s);
    parts.push(applyVertexColor(tube, '#f8fafc')); // White blueprint paper

    // Blueprint strap / cap
    const cap1 = new THREE.CylinderGeometry(0.042 * s, 0.042 * s, 0.06 * s, 12);
    cap1.rotateX(Math.PI / 2.6);
    cap1.rotateZ(-0.2);
    cap1.translate(0.25 * s, (1.78 - 0.45) * s, -0.05 * s);
    parts.push(applyVertexColor(cap1, '#0063A3'));
  } else if (character.id === 'engineer-sam') {
    // Right arm forward holding tablet
    rightArm.rotateX(-0.85);
    rightArm.translate(0.23 * s, (1.78 - 0.54) * s, 0.20 * s);
    rightHand.translate(0.23 * s, (1.78 - 0.65) * s, 0.38 * s);

    // Digital Tablet
    const tablet = new THREE.BoxGeometry(0.24 * s, 0.18 * s, 0.018 * s);
    tablet.rotateX(-0.55);
    tablet.translate(0.18 * s, (1.78 - 0.65) * s, 0.38 * s);
    parts.push(applyVertexColor(tablet, '#0284c7')); // Tablet with screen
  } else if (character.id === 'designer-maya') {
    // Right arm holding clipboard
    rightArm.rotateX(-0.70);
    rightArm.translate(0.23 * s, (1.78 - 0.54) * s, 0.18 * s);
    rightHand.translate(0.23 * s, (1.78 - 0.68) * s, 0.32 * s);

    // Clipboard
    const board = new THREE.BoxGeometry(0.22 * s, 0.30 * s, 0.015 * s);
    board.rotateX(-0.4);
    board.translate(0.20 * s, (1.78 - 0.66) * s, 0.32 * s);
    parts.push(applyVertexColor(board, '#b45309')); // Wood clipboard

    // Cross-body satchel
    const satchel = new THREE.BoxGeometry(0.28 * s, 0.22 * s, 0.08 * s);
    satchel.translate(-0.18 * s, (1.78 - 0.78) * s, 0.02 * s);
    parts.push(applyVertexColor(satchel, '#78350f'));
  } else if (character.id === 'surveyor-liam') {
    // Right arm holding laser disto
    rightArm.rotateX(-0.80);
    rightArm.translate(0.23 * s, (1.78 - 0.54) * s, 0.18 * s);
    rightHand.translate(0.23 * s, (1.78 - 0.68) * s, 0.34 * s);

    // Laser disto rangefinder
    const disto = new THREE.BoxGeometry(0.06 * s, 0.14 * s, 0.04 * s);
    disto.rotateX(-0.4);
    disto.translate(0.23 * s, (1.78 - 0.66) * s, 0.36 * s);
    parts.push(applyVertexColor(disto, '#dc2626')); // Red Leica/Trimble laser tool
  } else if (character.id === 'executive-elena') {
    // Right arm hanging holding briefcase
    rightArm.rotateZ(-0.06);
    rightArm.translate(0.24 * s, (1.78 - 0.55) * s, 0);
    rightHand.translate(0.25 * s, (1.78 - 0.84) * s, 0);

    // Executive Briefcase
    const briefcase = new THREE.BoxGeometry(0.08 * s, 0.28 * s, 0.38 * s);
    briefcase.translate(0.28 * s, (1.78 - 0.98) * s, 0);
    parts.push(applyVertexColor(briefcase, '#1c1917'));
  } else if (character.id === 'commuter-leo') {
    // Right arm holding coffee tumbler
    rightArm.rotateX(-0.55);
    rightArm.translate(0.23 * s, (1.78 - 0.55) * s, 0.12 * s);
    rightHand.translate(0.23 * s, (1.78 - 0.72) * s, 0.22 * s);

    // Coffee tumbler
    const tumbler = new THREE.CylinderGeometry(0.04 * s, 0.032 * s, 0.14 * s, 10);
    tumbler.translate(0.23 * s, (1.78 - 0.68) * s, 0.24 * s);
    parts.push(applyVertexColor(tumbler, '#059669'));

    // City Backpack on back
    const backpack = new THREE.BoxGeometry(0.28 * s, 0.38 * s, 0.14 * s);
    backpack.translate(0, (1.78 - 0.50) * s, -0.16 * s);
    parts.push(applyVertexColor(backpack, '#1e293b'));
  } else if (character.id === 'resident-arthur') {
    // Right arm holding walking cane
    rightArm.rotateX(-0.35);
    rightArm.translate(0.24 * s, (1.78 - 0.55) * s, 0.10 * s);
    rightHand.translate(0.24 * s, (1.78 - 0.78) * s, 0.18 * s);

    // Wooden walking cane
    const caneShaft = new THREE.CylinderGeometry(0.015 * s, 0.012 * s, 0.90 * s, 8);
    caneShaft.translate(0.24 * s, 0.45 * s, 0.20 * s);
    parts.push(applyVertexColor(caneShaft, '#78350f')); // Polished wood

    const caneHandle = new THREE.TorusGeometry(0.04 * s, 0.014 * s, 8, 12, Math.PI);
    caneHandle.rotateX(Math.PI / 2);
    caneHandle.translate(0.24 * s, 0.90 * s, 0.18 * s);
    parts.push(applyVertexColor(caneHandle, '#b45309'));
  } else {
    // Default right arm
    rightArm.rotateZ(-0.08);
    rightArm.translate(0.24 * s, (1.78 - 0.55) * s, 0);
    rightHand.translate(0.26 * s, (1.78 - 0.84) * s, 0);
  }

  parts.push(applyVertexColor(rightArm, character.primaryColor));
  parts.push(applyVertexColor(rightHand, character.skinColor));

  // Merge all parts into one unified BufferGeometry
  const merged = mergeGeometries(parts, false);
  parts.forEach(p => p.dispose());

  if (merged) {
    merged.computeVertexNormals();
    return merged;
  }

  return new THREE.BoxGeometry(0.5 * s, targetH, 0.3 * s);
}
