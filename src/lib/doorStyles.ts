import * as THREE from 'three';

/**
 * Door styles whose shape depends on their size: the patio doors and the garage and workshop doors.
 * Each builder returns the parts of the leaf only (the jambs and header are built by createDoorGeometry), split by
 * material: frame, glass and hardware. Every layout rule is a small exported function so it can be tested on its own.
 */
export interface DoorContext {
  width: number;
  height: number;
  /** How deep the frame is (the wall thickness the door sits in). */
  frameDepth: number;
  frameThick: number;
  panelThick: number;
  /** Clear width and height inside the frame. */
  panelWidth: number;
  panelHeight: number;
}
export interface DoorParts { frame: THREE.BufferGeometry[]; glass: THREE.BufferGeometry[]; hardware: THREE.BufferGeometry[] }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
  const g = new THREE.BoxGeometry(Math.max(w, 1e-3), Math.max(h, 1e-3), Math.max(d, 1e-3));
  g.translate(x, y, z);
  return g;
};
const cylinder = (r: number, length: number, axis: 'x' | 'y' | 'z', x: number, y: number, z: number, segments = 12) => {
  const g = new THREE.CylinderGeometry(r, r, length, segments);
  if (axis === 'x') g.rotateZ(Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
};
const empty = (): DoorParts => ({ frame: [], glass: [], hardware: [] });

// ---- Layout rules -----------------------------------------------------------------------------------------------

/** Bi-fold doors: leaves of 0.6 to 0.9 m, never fewer than two. */
export function bifoldLeafCount(width: number): number { return clamp(Math.ceil(width / 0.9), 2, 8); }

/** Sliding patio doors: panels of roughly 1.2 m; the first half stay fixed, the rest slide in front of them. */
export function patioPanelCount(width: number): number { return clamp(Math.round(width / 1.2), 2, 6); }

export interface ShutterLayout {
  /** Width of each shutter (one either side). */
  shutterWidth: number;
  /** Doors between the shutters: one leaf when narrow, a pair, or two pairs when wide. */
  leaves: 1 | 2 | 4;
  leafWidth: number;
  /** Panes across and down each leaf. */
  columns: number;
  rows: number;
}
/** French doors flanked by louvered shutters: shutters take about a sixth of the width, the glazed doors the rest. */
export function shutterLayout(width: number, height: number): ShutterLayout {
  const shutterWidth = clamp(width * 0.17, 0.28, 0.65);
  const doorArea = Math.max(0.3, width - 2 * (shutterWidth + 0.02));
  const leaves: 1 | 2 | 4 = doorArea < 0.95 ? 1 : doorArea < 2.6 ? 2 : 4;
  const leafWidth = doorArea / leaves;
  return {
    shutterWidth, leaves, leafWidth,
    columns: leafWidth < 0.55 ? 1 : leafWidth < 0.9 ? 2 : 3,
    rows: clamp(Math.round((height - 0.4) / 0.5), 3, 6),
  };
}

/** Sectional garage doors: horizontal sections of about half a metre, three at least. */
export function garageSectionCount(height: number): number { return clamp(Math.round(height / 0.5), 3, 6); }
/** Raised panels (or glazing lights) across each section. */
export function garagePanelColumns(width: number): number { return clamp(Math.round(width / 0.75), 2, 10); }
/** Carriage doors: a pair, or two pairs for a wide opening. */
export function carriageLeafCount(width: number): 2 | 4 { return width > 3.6 ? 4 : 2; }

// ---- Patio doors ------------------------------------------------------------------------------------------------

/** Concertina folding patio doors with as many leaves as the width needs. */
function bifold(c: DoorContext): DoorParts {
  const p = empty();
  const n = bifoldLeafCount(c.width);
  const gap = 0.008, leafW = (c.panelWidth - (n - 1) * gap) / n;
  const stileW = clamp(leafW * 0.12, 0.04, 0.07), topRailH = 0.08, botRailH = 0.12;
  const h = c.panelHeight - 0.06, cy = -c.frameThick / 2;

  p.hardware.push(box(c.panelWidth, 0.035, c.frameDepth * 0.9, 0, c.height / 2 - c.frameThick / 2 - 0.015, 0));
  p.hardware.push(box(c.panelWidth, 0.015, c.frameDepth * 0.9, 0, -c.height / 2 + 0.01, 0));

  for (let i = 0; i < n; i++) {
    const fold = i % 2 === 0 ? 0.18 : -0.18, z = i % 2 === 0 ? 0.02 : -0.02;
    const x = -c.panelWidth / 2 + leafW / 2 + i * (leafW + gap);
    const part = (g: THREE.BufferGeometry) => { g.rotateY(fold); return g; };
    const place = (w: number, hh: number, d: number, dx: number, dy: number) => part(box(w, hh, d, 0, 0, 0)).translate(x + dx, cy + dy, z);
    p.frame.push(place(stileW, h, c.panelThick * 0.85, -leafW / 2 + stileW / 2, 0));
    p.frame.push(place(stileW, h, c.panelThick * 0.85, leafW / 2 - stileW / 2, 0));
    p.frame.push(place(leafW - stileW * 2, topRailH, c.panelThick * 0.85, 0, h / 2 - topRailH / 2));
    p.frame.push(place(leafW - stileW * 2, botRailH, c.panelThick * 0.85, 0, -h / 2 + botRailH / 2));
    const glassH = h - topRailH - botRailH, glassY = (topRailH - botRailH) / 2;
    // A tall leaf gets a transom bar so the panes stay a sensible size.
    if (glassH > 1.9) p.frame.push(place(leafW - stileW * 2, 0.04, c.panelThick * 0.7, 0, glassY + glassH * 0.25));
    p.glass.push(place(leafW - stileW * 2, glassH, 0.008, 0, glassY));
    if (i < n - 1) for (const y of [0.5, -0.5]) p.hardware.push(box(0.02, 0.08, 0.02, x + leafW / 2 + gap / 2, y, z + 0.02));
  }
  // The master leaf's handle, on the leaf that closes against the jamb.
  p.hardware.push(cylinder(0.012, 0.12, 'x', c.panelWidth / 2 - leafW + 0.06, -0.05, c.panelThick / 2 + 0.04));
  return p;
}

/** Sliding patio door: the first half of the panels fixed at the back, the rest sliding in front, overlapping a little. */
function patioSliding(c: DoorContext): DoorParts {
  const p = empty();
  const n = patioPanelCount(c.width), overlap = 0.04;
  const leafW = (c.panelWidth + (n - 1) * overlap) / n;
  const fixed = Math.ceil(n / 2);
  const stileW = clamp(leafW * 0.07, 0.05, 0.09), topRailH = 0.09, botRailH = 0.14;
  const h = c.panelHeight - 0.05, cy = -c.frameThick / 2;

  p.hardware.push(box(c.panelWidth, 0.035, c.frameDepth * 0.95, 0, c.height / 2 - c.frameThick / 2 - 0.015, 0));
  p.hardware.push(box(c.panelWidth, 0.025, c.frameDepth * 0.95, 0, -c.height / 2 + 0.012, 0));

  for (let i = 0; i < n; i++) {
    const slider = i >= fixed, z = slider ? 0.025 : -0.025;
    const x = -c.panelWidth / 2 + leafW / 2 + i * (leafW - overlap);
    p.frame.push(box(stileW, h, c.panelThick * 0.85, x - leafW / 2 + stileW / 2, cy, z));
    p.frame.push(box(stileW, h, c.panelThick * 0.85, x + leafW / 2 - stileW / 2, cy, z));
    p.frame.push(box(leafW - stileW * 2, topRailH, c.panelThick * 0.85, x, cy + h / 2 - topRailH / 2, z));
    p.frame.push(box(leafW - stileW * 2, botRailH, c.panelThick * 0.85, x, cy - h / 2 + botRailH / 2, z));
    const glassH = h - topRailH - botRailH, glassY = cy + (topRailH - botRailH) / 2;
    p.glass.push(box(leafW - stileW * 2, glassH, 0.008, x, glassY, z));
    if (slider) {
      // D handle and thumb lock on the meeting stile.
      const meet = x - leafW / 2 + stileW + 0.03;
      p.hardware.push(box(0.025, 0.22, 0.04, meet, -0.05, z + c.panelThick / 2 + 0.02));
      p.hardware.push(cylinder(0.012, 0.03, 'z', meet, 0.1, z + c.panelThick / 2 + 0.02));
    }
  }
  return p;
}

/** French doors (one leaf, a pair or two pairs) flanked by louvered shutters. */
function shutters(c: DoorContext): DoorParts {
  const p = empty();
  const layout = shutterLayout(c.width, c.height);
  const { shutterWidth, leaves, leafWidth, columns, rows } = layout;
  const doorArea = leaves * leafWidth, stileW = clamp(leafWidth * 0.1, 0.045, 0.075), cy = -c.frameThick / 2;

  for (let i = 0; i < leaves; i++) {
    const x = -doorArea / 2 + leafWidth / 2 + i * leafWidth;
    const w = leafWidth - 0.01;
    p.frame.push(box(stileW, c.panelHeight, c.panelThick * 0.85, x - w / 2 + stileW / 2, cy, 0));
    p.frame.push(box(stileW, c.panelHeight, c.panelThick * 0.85, x + w / 2 - stileW / 2, cy, 0));
    p.frame.push(box(w - stileW * 2, 0.1, c.panelThick * 0.85, x, cy + c.panelHeight / 2 - 0.05, 0));
    p.frame.push(box(w - stileW * 2, 0.14, c.panelThick * 0.85, x, cy - c.panelHeight / 2 + 0.07, 0));
    const gw = w - stileW * 2, gh = c.panelHeight - 0.24, gy = cy - 0.02;
    // Muntins: columns and rows of panes sized to the leaf.
    for (let k = 1; k < columns; k++) p.frame.push(box(0.018, gh, c.panelThick * 0.7, x - gw / 2 + (gw / columns) * k, gy, 0));
    for (let k = 1; k < rows; k++) p.frame.push(box(gw, 0.018, c.panelThick * 0.7, x, gy - gh / 2 + (gh / rows) * k, 0));
    p.glass.push(box(gw, gh, 0.008, x, gy, 0));
    // Knobs on the leaf edges that meet (or on the one leaf's free edge).
    const meets = leaves === 1 ? [x + w / 2 - stileW - 0.03] : i % 2 === 0 ? [x + w / 2 - stileW - 0.03] : [x - w / 2 + stileW + 0.03];
    for (const kx of meets) p.hardware.push(cylinder(0.014, 0.04, 'z', kx, -0.05, c.panelThick / 2 + 0.03, 16));
  }

  const z = c.frameDepth / 2 + 0.02, sh = c.panelHeight * 0.98, rail = 0.05;
  const louverW = shutterWidth - rail * 2, louvers = clamp(Math.round((sh / 2 - 0.07) / 0.055), 4, 16), sub = sh / 2 - 0.07;
  [-c.panelWidth / 2 + shutterWidth / 2, c.panelWidth / 2 - shutterWidth / 2].forEach((x, side) => {
    p.frame.push(box(rail, sh, 0.028, x - shutterWidth / 2 + rail / 2, cy, z));
    p.frame.push(box(rail, sh, 0.028, x + shutterWidth / 2 - rail / 2, cy, z));
    p.frame.push(box(louverW, 0.06, 0.028, x, cy + sh / 2 - 0.03, z));
    p.frame.push(box(louverW, 0.05, 0.028, x, cy, z));
    p.frame.push(box(louverW, 0.08, 0.028, x, cy - sh / 2 + 0.04, z));
    for (let l = 1; l <= louvers; l++) {
      for (const base of [cy + 0.03, cy - sh / 2 + 0.05]) {
        const slat = box(louverW, 0.03, 0.006, 0, 0, 0);
        slat.rotateX(0.45);
        slat.translate(x, base + (sub / (louvers + 1)) * l, z);
        p.frame.push(slat);
      }
    }
    for (const y of [cy + sh / 2 - 0.08, cy - sh / 2 + 0.08]) p.hardware.push(box(shutterWidth * 0.75, 0.02, 0.008, x + (side === 0 ? 0.02 : -0.02), y, z + 0.016));
  });
  return p;
}

// ---- Garage and workshop doors ----------------------------------------------------------------------------------

/** Horizontal sections with raised panels (or, for the glazed version, a row of lights in the top section). */
function sectional(c: DoorContext, glazedTop: boolean): DoorParts {
  const p = empty();
  const n = garageSectionCount(c.panelHeight), gap = 0.012, secH = c.panelHeight / n, cols = garagePanelColumns(c.panelWidth);
  const top = -c.frameThick / 2 + c.panelHeight / 2, t = c.panelThick;
  for (let i = 0; i < n; i++) {
    const y = top - secH * (i + 0.5), glazed = glazedTop && i === 0;
    p.frame.push(box(c.panelWidth, secH - gap, t, 0, y, 0));
    const cw = c.panelWidth / cols;
    for (let k = 0; k < cols; k++) {
      const x = -c.panelWidth / 2 + cw * (k + 0.5);
      if (glazed) {
        // A glazed light with a slim frame around it.
        const gw = cw - 0.1, gh = secH * 0.55;
        p.glass.push(box(gw, gh, 0.01, x, y, t / 2 - 0.004));
        p.frame.push(box(gw + 0.04, 0.02, t + 0.016, x, y + gh / 2 + 0.01, 0));
        p.frame.push(box(gw + 0.04, 0.02, t + 0.016, x, y - gh / 2 - 0.01, 0));
        p.frame.push(box(0.02, gh + 0.04, t + 0.016, x - gw / 2 - 0.01, y, 0));
        p.frame.push(box(0.02, gh + 0.04, t + 0.016, x + gw / 2 + 0.01, y, 0));
      } else {
        p.frame.push(box(cw - 0.12, secH * 0.62, t + 0.014, x, y, 0));
      }
    }
    // Hinge plates at the joint under this section.
    if (i < n - 1) for (const hx of [-c.panelWidth / 2 + 0.12, 0, c.panelWidth / 2 - 0.12]) p.hardware.push(box(0.06, 0.04, 0.012, hx, y - secH / 2, t / 2 + 0.006));
  }
  // Pull handle on the second section, and the weather seal along the bottom.
  p.hardware.push(box(0.3, 0.025, 0.03, 0, top - secH * 1.5, t / 2 + 0.02));
  p.hardware.push(box(c.panelWidth, 0.03, t + 0.02, 0, -c.frameThick / 2 - c.panelHeight / 2 + 0.015, 0));
  return p;
}

/** Up-and-over canopy door: one flat leaf boarded with vertical ribs, rails top and bottom, and a central lock. */
function canopy(c: DoorContext): DoorParts {
  const p = empty();
  const cy = -c.frameThick / 2, t = c.panelThick + 0.006;
  p.frame.push(box(c.panelWidth, c.panelHeight, t, 0, cy, 0));
  const ribs = Math.max(6, Math.round(c.panelWidth / 0.14));
  for (let i = 0; i < ribs; i++) p.frame.push(box(0.012, c.panelHeight - 0.24, 0.01, -c.panelWidth / 2 + (c.panelWidth / ribs) * (i + 0.5), cy, t / 2 + 0.004));
  p.frame.push(box(c.panelWidth, 0.1, 0.016, 0, cy + c.panelHeight / 2 - 0.06, t / 2 + 0.006));
  p.frame.push(box(c.panelWidth, 0.1, 0.016, 0, cy - c.panelHeight / 2 + 0.06, t / 2 + 0.006));
  p.hardware.push(box(0.12, 0.04, 0.02, 0, cy + 0.02, t / 2 + 0.018));
  p.hardware.push(cylinder(0.02, 0.02, 'z', 0, cy + 0.02, t / 2 + 0.03, 16));
  return p;
}

/** Roller shutter: many narrow slats, a shutter box over the top, guide rails down both sides, and a bottom bar. */
function rollerShutter(c: DoorContext): DoorParts {
  const p = empty();
  const boxH = clamp(c.height * 0.12, 0.22, 0.4), slatPitch = 0.08, rail = 0.05;
  const topY = c.height / 2 - c.frameThick - boxH, bottomY = -c.height / 2 + 0.05;
  const count = Math.max(4, Math.floor((topY - bottomY) / slatPitch));
  const slatH = (topY - bottomY) / count;
  p.frame.push(box(c.width, boxH, c.frameDepth * 0.95, 0, c.height / 2 - c.frameThick - boxH / 2, 0));
  // The guide rails run right to the jambs, so they stay put as part of the frame while the slats move.
  p.frame.push(box(rail, c.height - boxH, c.frameDepth * 0.95, -c.width / 2 + rail / 2 + 0.005, -boxH / 2, 0));
  p.frame.push(box(rail, c.height - boxH, c.frameDepth * 0.95, c.width / 2 - rail / 2 - 0.005, -boxH / 2, 0));
  for (let i = 0; i < count; i++) p.frame.push(box(c.panelWidth - rail * 2 - 0.01, slatH - 0.008, 0.03, 0, topY - slatH * (i + 0.5), 0));
  p.hardware.push(box(c.panelWidth - rail * 2, 0.05, 0.045, 0, bottomY + 0.025, 0));
  p.hardware.push(box(0.14, 0.03, 0.02, 0, bottomY + 0.07, 0.03));
  return p;
}

/** Side-hinged carriage doors: framed leaves with an X-braced lower panel, a glazed upper panel, strap hinges and ring pulls. */
function carriage(c: DoorContext): DoorParts {
  const p = empty();
  const n = carriageLeafCount(c.width), leafW = c.panelWidth / n - 0.006, stile = 0.12, midRail = 0.12, botRail = 0.2, topRail = 0.14, cy = -c.frameThick / 2, t = c.panelThick;
  const innerH = c.panelHeight - topRail - botRail - midRail;
  const upperH = innerH * 0.4, lowerH = innerH - upperH;
  for (let i = 0; i < n; i++) {
    const x = -c.panelWidth / 2 + (c.panelWidth / n) * (i + 0.5);
    p.frame.push(box(stile, c.panelHeight, t, x - leafW / 2 + stile / 2, cy, 0));
    p.frame.push(box(stile, c.panelHeight, t, x + leafW / 2 - stile / 2, cy, 0));
    p.frame.push(box(leafW - stile * 2, topRail, t, x, cy + c.panelHeight / 2 - topRail / 2, 0));
    p.frame.push(box(leafW - stile * 2, botRail, t, x, cy - c.panelHeight / 2 + botRail / 2, 0));
    const lowerTop = cy - c.panelHeight / 2 + botRail + lowerH;
    p.frame.push(box(leafW - stile * 2, midRail, t, x, lowerTop + midRail / 2, 0));
    const upperBottom = lowerTop + midRail, innerW = leafW - stile * 2;
    // Lower panel with an X brace.
    const lowerY = lowerTop - lowerH / 2;
    p.frame.push(box(innerW, lowerH, t * 0.6, x, lowerY, 0));
    const diagonal = Math.hypot(innerW, lowerH) - 0.04, angle = Math.atan2(lowerH, innerW);
    for (const sign of [1, -1]) { const d = box(diagonal, 0.07, 0.014, 0, 0, 0); d.rotateZ(sign * angle); d.translate(x, lowerY, t * 0.3 + 0.007); p.frame.push(d); }
    // Glazed upper panel with one vertical and one horizontal bar.
    const upperY = upperBottom + upperH / 2;
    p.glass.push(box(innerW, upperH, 0.008, x, upperY, 0));
    p.frame.push(box(0.025, upperH, t * 0.7, x, upperY, 0));
    p.frame.push(box(innerW, 0.025, t * 0.7, x, upperY, 0));
    // Strap hinges at the outer edge of each outer leaf, and a ring pull on the meeting stile.
    const outer = i === 0 ? -1 : i === n - 1 ? 1 : 0;
    if (outer) for (const y of [cy + c.panelHeight / 2 - 0.25, cy, cy - c.panelHeight / 2 + 0.3]) p.hardware.push(box(Math.min(0.5, leafW * 0.7), 0.04, 0.012, x + outer * (leafW / 2 - Math.min(0.5, leafW * 0.7) / 2), y, t / 2 + 0.008));
    const meeting = i % 2 === 0 ? 1 : -1;
    p.hardware.push(cylinder(0.035, 0.012, 'z', x + meeting * (leafW / 2 - stile / 2), cy, t / 2 + 0.012, 20));
  }
  return p;
}

/** Industrial sliding door: a ribbed steel leaf with a heavy frame, overhead rail with trolleys, and a floor guide. */
function industrialSliding(c: DoorContext): DoorParts {
  const p = empty();
  const cy = -c.frameThick / 2, t = c.panelThick + 0.01, edge = 0.08;
  p.frame.push(box(c.panelWidth, c.panelHeight, t, 0, cy, 0));
  p.frame.push(box(edge, c.panelHeight, t + 0.012, -c.panelWidth / 2 + edge / 2, cy, 0));
  p.frame.push(box(edge, c.panelHeight, t + 0.012, c.panelWidth / 2 - edge / 2, cy, 0));
  p.frame.push(box(c.panelWidth, edge, t + 0.012, 0, cy + c.panelHeight / 2 - edge / 2, 0));
  p.frame.push(box(c.panelWidth, edge, t + 0.012, 0, cy - c.panelHeight / 2 + edge / 2, 0));
  const ribs = Math.max(4, Math.round(c.panelHeight / 0.25));
  for (let i = 1; i < ribs; i++) p.frame.push(box(c.panelWidth - edge * 2, 0.02, 0.012, 0, cy - c.panelHeight / 2 + (c.panelHeight / ribs) * i, t / 2 + 0.005));
  p.hardware.push(box(c.width + 0.3, 0.04, 0.06, 0, c.height / 2 + 0.04, c.frameDepth / 2 + 0.04));
  for (const x of [-c.panelWidth / 3, c.panelWidth / 3]) {
    p.hardware.push(cylinder(0.03, 0.03, 'x', x, c.height / 2 + 0.03, c.frameDepth / 2 + 0.04, 16));
    p.hardware.push(box(0.04, 0.12, 0.012, x, c.height / 2 - 0.04, t / 2 + 0.014));
  }
  p.hardware.push(box(0.1, 0.18, 0.03, c.panelWidth / 2 - 0.2, -0.05, t / 2 + 0.03));
  p.hardware.push(box(0.04, 0.02, c.frameDepth, c.panelWidth / 2 - 0.1, -c.height / 2 + 0.01, 0));
  return p;
}

/** Steel personnel door: a flush insulated leaf with a vision panel, kick plate, push bar and a door closer. */
function steelPersonnel(c: DoorContext): DoorParts {
  const p = empty();
  const cy = -c.frameThick / 2, t = c.panelThick;
  p.frame.push(box(c.panelWidth, c.panelHeight, t, 0, cy, 0));
  const visionW = Math.min(0.4, c.panelWidth * 0.5), visionH = 0.6, visionY = cy + c.panelHeight * 0.18;
  p.glass.push(box(visionW, visionH, 0.01, 0, visionY, t / 2 - 0.004));
  p.frame.push(box(visionW + 0.05, 0.03, t + 0.01, 0, visionY + visionH / 2 + 0.015, 0));
  p.frame.push(box(visionW + 0.05, 0.03, t + 0.01, 0, visionY - visionH / 2 - 0.015, 0));
  p.frame.push(box(0.03, visionH + 0.06, t + 0.01, -visionW / 2 - 0.015, visionY, 0));
  p.frame.push(box(0.03, visionH + 0.06, t + 0.01, visionW / 2 + 0.015, visionY, 0));
  p.frame.push(box(c.panelWidth - 0.06, 0.25, t + 0.01, 0, cy - c.panelHeight / 2 + 0.145, 0));
  p.hardware.push(cylinder(0.014, c.panelWidth * 0.7, 'x', 0, cy - 0.05, t / 2 + 0.05));
  for (const x of [-c.panelWidth * 0.3, c.panelWidth * 0.3]) p.hardware.push(box(0.03, 0.03, 0.05, x, cy - 0.05, t / 2 + 0.025));
  p.hardware.push(box(0.28, 0.07, 0.07, -c.panelWidth / 2 + 0.2, c.height / 2 - c.frameThick - 0.05, t / 2 + 0.04));
  return p;
}

const BUILDERS: Record<string, (c: DoorContext) => DoorParts> = {
  bifold,
  'patio-sliding': patioSliding,
  shutters,
  'garage-sectional': c => sectional(c, false),
  'garage-sectional-glazed': c => sectional(c, true),
  'garage-canopy': canopy,
  'garage-roller': rollerShutter,
  'garage-carriage': carriage,
  'workshop-sliding': industrialSliding,
  'workshop-personnel': steelPersonnel,
};

/** The leaf parts for a size-dependent door style, or null for any other style. */
export function buildSizedDoor(style: string, context: DoorContext): DoorParts | null {
  const builder = BUILDERS[style];
  return builder ? builder(context) : null;
}
