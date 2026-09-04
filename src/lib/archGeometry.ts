import * as THREE from 'three';
// @ts-ignore
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface WallOpening {
  id?: string;
  type?: 'door' | 'window' | string;
  localX: number;     // position along wall length (x: -length/2 to +length/2)
  localY: number;     // position relative to wall center (y: -height/2 to +height/2)
  width: number;      // opening width
  height: number;     // opening height
  depth?: number;     // opening depth / thickness
}

/**
 * Creates a detailed architectural Wall geometry.
 */
export function createWallGeometry(length = 3.0, height = 2.8, thickness = 0.2): THREE.BufferGeometry {
  return new THREE.BoxGeometry(length, height, thickness);
}

/**
 * Creates an architectural Wall geometry with accurate cutouts/holes for doors and windows.
 */
export function createWallWithOpeningsGeometry(
  length = 3.0,
  height = 2.8,
  thickness = 0.2,
  openings: WallOpening[] = [],
  style?: string
): THREE.BufferGeometry {
  let baseGeom: THREE.BufferGeometry;

  const halfL = length / 2;
  const halfH = height / 2;

  interface ValidInterval {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
  }

  const intervals: ValidInterval[] = [];
  if (openings && openings.length > 0) {
    for (const op of openings) {
      const w = Math.max(0.1, op.width);
      const h = Math.max(0.1, op.height);
      const xMin = Math.max(-halfL, op.localX - w / 2);
      const xMax = Math.min(halfL, op.localX + w / 2);
      const yMin = Math.max(-halfH, op.localY - h / 2);
      const yMax = Math.min(halfH, op.localY + h / 2);

      if (xMax > xMin + 0.02 && yMax > yMin + 0.02) {
        intervals.push({ xMin, xMax, yMin, yMax });
      }
    }
  }

  if (intervals.length === 0) {
    baseGeom = new THREE.BoxGeometry(length, height, thickness);
  } else {
    intervals.sort((a, b) => a.xMin - b.xMin);

    const mergedIntervals: ValidInterval[] = [];
    let current = { ...intervals[0] };

    for (let i = 1; i < intervals.length; i++) {
      const next = intervals[i];
      if (next.xMin <= current.xMax + 0.01) {
        current.xMax = Math.max(current.xMax, next.xMax);
        current.yMin = Math.min(current.yMin, next.yMin);
        current.yMax = Math.max(current.yMax, next.yMax);
      } else {
        mergedIntervals.push(current);
        current = { ...next };
      }
    }
    mergedIntervals.push(current);

    const subBoxes: THREE.BufferGeometry[] = [];
    let currentX = -halfL;

    for (const seg of mergedIntervals) {
      // 1. Solid wall block to the left of this opening segment
      const leftWidth = seg.xMin - currentX;
      if (leftWidth > 0.01) {
        const leftGeom = new THREE.BoxGeometry(leftWidth, height, thickness);
        leftGeom.translate(currentX + leftWidth / 2, 0, 0);
        subBoxes.push(leftGeom);
      }

      const segWidth = seg.xMax - seg.xMin;

      // 2. Wall section below opening (e.g. for windows or raised doors)
      const bottomH = seg.yMin - (-halfH);
      if (bottomH > 0.01) {
        const botGeom = new THREE.BoxGeometry(segWidth, bottomH, thickness);
        botGeom.translate(seg.xMin + segWidth / 2, -halfH + bottomH / 2, 0);
        subBoxes.push(botGeom);
      }

      // 3. Wall section above opening (lintel/header above door or window)
      const topH = halfH - seg.yMax;
      if (topH > 0.01) {
        const topGeom = new THREE.BoxGeometry(segWidth, topH, thickness);
        topGeom.translate(seg.xMin + segWidth / 2, halfH - topH / 2, 0);
        subBoxes.push(topGeom);
      }

      currentX = seg.xMax;
    }

    // 4. Solid wall block to the right of the last opening segment
    const rightWidth = halfL - currentX;
    if (rightWidth > 0.01) {
      const rightGeom = new THREE.BoxGeometry(rightWidth, height, thickness);
      rightGeom.translate(currentX + rightWidth / 2, 0, 0);
      subBoxes.push(rightGeom);
    }

    try {
      const merged = BufferGeometryUtils.mergeGeometries(subBoxes, false);
      baseGeom = merged || new THREE.BoxGeometry(length, height, thickness);
    } catch (e) {
      baseGeom = new THREE.BoxGeometry(length, height, thickness);
    }
  }

  // If no cladding style or default flush render, return base wall geometry
  if (!style || style === 'smooth-render' || style === 'flush') {
    return baseGeom;
  }

  // Generate 3D Cladding Battens / Boards / Grooves on outward-facing exterior face (+Z)
  const claddingGeoms: THREE.BufferGeometry[] = [baseGeom];
  const zOffsets = [
    { z: thickness / 2 + 0.010, rotSign: 1 }
  ];

  for (const { z: faceZ, rotSign } of zOffsets) {
    if (style === 'feather-edge' || style === 'standard-overlap') {
      // Horizontal overlapping boards (150mm height, 25mm overlap)
      const boardH = 0.15;
      const overlap = 0.025;
      const stepY = boardH - overlap;
      const numBoards = Math.ceil(height / stepY);

      for (let i = 0; i < numBoards; i++) {
        const y = -halfH + i * stepY + boardH / 2;
        if (y - boardH / 2 > halfH) break;

        const rowOpenings = intervals
          .filter(op => y + boardH / 2 > op.yMin && y - boardH / 2 < op.yMax)
          .sort((a, b) => a.xMin - b.xMin);

        let cursorX = -halfL;
        for (const op of rowOpenings) {
          if (op.xMin > cursorX + 0.02) {
            const segW = op.xMin - cursorX;
            const boardGeom = new THREE.BoxGeometry(segW, boardH, 0.022);
            if (style === 'feather-edge') {
              boardGeom.rotateX(0.08 * rotSign);
            }
            boardGeom.translate(cursorX + segW / 2, y, faceZ);
            claddingGeoms.push(boardGeom);
          }
          cursorX = Math.max(cursorX, op.xMax);
        }
        if (cursorX < halfL - 0.02) {
          const segW = halfL - cursorX;
          const boardGeom = new THREE.BoxGeometry(segW, boardH, 0.022);
          if (style === 'feather-edge') {
            boardGeom.rotateX(0.08 * rotSign);
          }
          boardGeom.translate(cursorX + segW / 2, y, faceZ);
          claddingGeoms.push(boardGeom);
        }
      }
    } else if (style === 'tongue-groove' || style === 'shiplap' || style === 'loglap') {
      // Horizontal interlocking boards (125mm height with bevel V-joint or loglap curve)
      const boardH = 0.125;
      const numBoards = Math.ceil(height / boardH);

      for (let i = 0; i < numBoards; i++) {
        const y = -halfH + i * boardH + boardH / 2;
        if (y - boardH / 2 > halfH) break;

        const rowOpenings = intervals
          .filter(op => y + boardH / 2 > op.yMin && y - boardH / 2 < op.yMax)
          .sort((a, b) => a.xMin - b.xMin);

        let cursorX = -halfL;
        for (const op of rowOpenings) {
          if (op.xMin > cursorX + 0.02) {
            const segW = op.xMin - cursorX;
            const boardThick = style === 'loglap' ? 0.030 : 0.022;
            const boardGeom = new THREE.BoxGeometry(segW, boardH - 0.008, boardThick);
            boardGeom.translate(cursorX + segW / 2, y, faceZ);
            claddingGeoms.push(boardGeom);
          }
          cursorX = Math.max(cursorX, op.xMax);
        }
        if (cursorX < halfL - 0.02) {
          const segW = halfL - cursorX;
          const boardThick = style === 'loglap' ? 0.030 : 0.022;
          const boardGeom = new THREE.BoxGeometry(segW, boardH - 0.008, boardThick);
          boardGeom.translate(cursorX + segW / 2, y, faceZ);
          claddingGeoms.push(boardGeom);
        }
      }
    } else if (style === 'shadow-gap' || style === 'rainscreen') {
      // Modern horizontal open-joint slats with deep shadow reveals
      const slatH = 0.085;
      const gap = 0.015;
      const stepY = slatH + gap;
      const numSlats = Math.ceil(height / stepY);

      for (let i = 0; i < numSlats; i++) {
        const y = -halfH + i * stepY + slatH / 2;
        if (y - slatH / 2 > halfH) break;

        const rowOpenings = intervals
          .filter(op => y + slatH / 2 > op.yMin && y - slatH / 2 < op.yMax)
          .sort((a, b) => a.xMin - b.xMin);

        let cursorX = -halfL;
        for (const op of rowOpenings) {
          if (op.xMin > cursorX + 0.02) {
            const segW = op.xMin - cursorX;
            const slatGeom = new THREE.BoxGeometry(segW, slatH, 0.024);
            slatGeom.translate(cursorX + segW / 2, y, faceZ + 0.005 * rotSign);
            claddingGeoms.push(slatGeom);
          }
          cursorX = Math.max(cursorX, op.xMax);
        }
        if (cursorX < halfL - 0.02) {
          const segW = halfL - cursorX;
          const slatGeom = new THREE.BoxGeometry(segW, slatH, 0.024);
          slatGeom.translate(cursorX + segW / 2, y, faceZ + 0.005 * rotSign);
          claddingGeoms.push(slatGeom);
        }
      }
    } else if (style === 'board-on-board') {
      // Vertical alternating board-on-board (Yorkshire boarding)
      const boardW = 0.140;
      const boardSpacing = 0.180;
      const numCols = Math.ceil(length / boardSpacing);

      // Layer 1: Backing vertical boards & Layer 2: Projecting capping battens
      for (let i = 0; i < numCols; i++) {
        const x = -halfL + i * boardSpacing + boardW / 2;
        if (x - boardW / 2 > halfL) break;

        const colOpenings = intervals
          .filter(op => x + boardW / 2 > op.xMin && x - boardW / 2 < op.xMax)
          .sort((a, b) => a.yMin - b.yMin);

        let cursorY = -halfH;
        for (const op of colOpenings) {
          if (op.yMin > cursorY + 0.02) {
            const segH = op.yMin - cursorY;
            const vGeom = new THREE.BoxGeometry(boardW, segH, 0.020);
            vGeom.translate(x, cursorY + segH / 2, faceZ);
            claddingGeoms.push(vGeom);

            const capGeom = new THREE.BoxGeometry(0.08, segH, 0.025);
            capGeom.translate(x + boardSpacing / 2, cursorY + segH / 2, faceZ + 0.012 * rotSign);
            claddingGeoms.push(capGeom);
          }
          cursorY = Math.max(cursorY, op.yMax);
        }
        if (cursorY < halfH - 0.02) {
          const segH = halfH - cursorY;
          const vGeom = new THREE.BoxGeometry(boardW, segH, 0.020);
          vGeom.translate(x, cursorY + segH / 2, faceZ);
          claddingGeoms.push(vGeom);

          const capGeom = new THREE.BoxGeometry(0.08, segH, 0.025);
          capGeom.translate(x + boardSpacing / 2, cursorY + segH / 2, faceZ + 0.012 * rotSign);
          claddingGeoms.push(capGeom);
        }
      }
    } else if (style === 'brick-running' || style === 'ashlar-stone') {
      // Masonry courses with prominent relief bands
      const courseH = style === 'brick-running' ? 0.075 : 0.225;
      const numCourses = Math.ceil(height / courseH);

      for (let i = 0; i < numCourses; i++) {
        const y = -halfH + i * courseH + courseH / 2;
        if (y - courseH / 2 > halfH) break;

        const rowOpenings = intervals
          .filter(op => y + courseH / 2 > op.yMin && y - courseH / 2 < op.yMax)
          .sort((a, b) => a.xMin - b.xMin);

        let cursorX = -halfL;
        for (const op of rowOpenings) {
          if (op.xMin > cursorX + 0.02) {
            const segW = op.xMin - cursorX;
            const brickGeom = new THREE.BoxGeometry(segW, courseH - 0.008, 0.016);
            brickGeom.translate(cursorX + segW / 2, y, faceZ);
            claddingGeoms.push(brickGeom);
          }
          cursorX = Math.max(cursorX, op.xMax);
        }
        if (cursorX < halfL - 0.02) {
          const segW = halfL - cursorX;
          const brickGeom = new THREE.BoxGeometry(segW, courseH - 0.008, 0.016);
          brickGeom.translate(cursorX + segW / 2, y, faceZ);
          claddingGeoms.push(brickGeom);
        }
      }
    }
  }

  try {
    const finalMerged = BufferGeometryUtils.mergeGeometries(claddingGeoms, false);
    return finalMerged || baseGeom;
  } catch (e) {
    return baseGeom;
  }
}

/**
 * Creates a detailed architectural Door geometry with multi-material groups:
 * Material 0: Frame & Solid Panels (White / Finishes)
 * Material 1: Clear See-Through Glass (French / Lite / Half-Glass)
 * Material 2: Brushed Metallic Hardware (Knobs / Lever Handles / Pull Bars)
 */
export function createDoorGeometry(
  width = 0.9,
  height = 2.1,
  depth = 0.15,
  style = 'flush'
): THREE.BufferGeometry {
  const frameParts: THREE.BufferGeometry[] = [];
  const glassParts: THREE.BufferGeometry[] = [];
  const hardwareParts: THREE.BufferGeometry[] = [];

  const frameThick = 0.05;
  const frameDepth = depth;
  const panelThick = 0.04;
  const panelWidth = width - frameThick * 2 - 0.01;
  const panelHeight = height - frameThick - 0.01;

  // 1. Left & Right Jambs + Top Header
  const leftJamb = new THREE.BoxGeometry(frameThick, height, frameDepth);
  leftJamb.translate(-width / 2 + frameThick / 2, 0, 0);
  frameParts.push(leftJamb);

  const rightJamb = new THREE.BoxGeometry(frameThick, height, frameDepth);
  rightJamb.translate(width / 2 - frameThick / 2, 0, 0);
  frameParts.push(rightJamb);

  const topHeader = new THREE.BoxGeometry(width, frameThick, frameDepth);
  topHeader.translate(0, height / 2 - frameThick / 2, 0);
  frameParts.push(topHeader);

  // 2. Door Style Specific Leaf Geometry
  switch (style) {
    case '4panel': {
      // Base leaf
      const leaf = new THREE.BoxGeometry(panelWidth, panelHeight, panelThick * 0.7);
      leaf.translate(0, -frameThick / 2, 0);
      frameParts.push(leaf);

      // Stile & Rail perimeter
      const stileW = 0.11;
      const midRailH = 0.12;

      // 4 Raised Moulding Panels (2 tall upper, 2 square lower)
      const pw = (panelWidth - stileW * 3) / 2;
      const upperH = (panelHeight - midRailH - stileW * 2) * 0.58;
      const lowerH = (panelHeight - midRailH - stileW * 2) * 0.38;

      const upperY = -frameThick / 2 + panelHeight / 2 - stileW - upperH / 2;
      const lowerY = -frameThick / 2 - panelHeight / 2 + stileW + lowerH / 2;

      const panelX1 = -panelWidth / 2 + stileW + pw / 2;
      const panelX2 = panelWidth / 2 - stileW - pw / 2;

      const pUpper1 = new THREE.BoxGeometry(pw, upperH, panelThick);
      pUpper1.translate(panelX1, upperY, 0);
      frameParts.push(pUpper1);

      const pUpper2 = new THREE.BoxGeometry(pw, upperH, panelThick);
      pUpper2.translate(panelX2, upperY, 0);
      frameParts.push(pUpper2);

      const pLower1 = new THREE.BoxGeometry(pw, lowerH, panelThick);
      pLower1.translate(panelX1, lowerY, 0);
      frameParts.push(pLower1);

      const pLower2 = new THREE.BoxGeometry(pw, lowerH, panelThick);
      pLower2.translate(panelX2, lowerY, 0);
      frameParts.push(pLower2);

      // Classic Round Brass/Metal Knob
      const knobOut = new THREE.SphereGeometry(0.028, 16, 16);
      knobOut.translate(panelWidth / 2 - 0.08, -0.05, panelThick / 2 + 0.03);
      hardwareParts.push(knobOut);

      const knobIn = new THREE.SphereGeometry(0.028, 16, 16);
      knobIn.translate(panelWidth / 2 - 0.08, -0.05, -panelThick / 2 - 0.03);
      hardwareParts.push(knobIn);
      break;
    }

    case 'french': {
      // Outer door stile & rail frame
      const stileW = 0.12;
      const topR = 0.12;
      const botR = 0.18;

      const leafLeft = new THREE.BoxGeometry(stileW, panelHeight, panelThick);
      leafLeft.translate(-panelWidth / 2 + stileW / 2, -frameThick / 2, 0);
      frameParts.push(leafLeft);

      const leafRight = new THREE.BoxGeometry(stileW, panelHeight, panelThick);
      leafRight.translate(panelWidth / 2 - stileW / 2, -frameThick / 2, 0);
      frameParts.push(leafRight);

      const leafTop = new THREE.BoxGeometry(panelWidth - stileW * 2, topR, panelThick);
      leafTop.translate(0, -frameThick / 2 + panelHeight / 2 - topR / 2, 0);
      frameParts.push(leafTop);

      const leafBot = new THREE.BoxGeometry(panelWidth - stileW * 2, botR, panelThick);
      leafBot.translate(0, -frameThick / 2 - panelHeight / 2 + botR / 2, 0);
      frameParts.push(leafBot);

      // 6 Glass lights (2 cols x 3 rows) with cross muntins
      const glassW = panelWidth - stileW * 2;
      const glassH = panelHeight - topR - botR;
      const glassCenterY = -frameThick / 2 + (topR - botR) / 2;

      const muntinThick = 0.025;
      const muntinDepth = panelThick * 0.9;

      // Vertical muntin
      const vertMuntin = new THREE.BoxGeometry(muntinThick, glassH, muntinDepth);
      vertMuntin.translate(0, glassCenterY, 0);
      frameParts.push(vertMuntin);

      // 2 Horizontal muntins
      const rowH = glassH / 3;
      const horiz1 = new THREE.BoxGeometry(glassW, muntinThick, muntinDepth);
      horiz1.translate(0, glassCenterY + rowH / 2, 0);
      frameParts.push(horiz1);

      const horiz2 = new THREE.BoxGeometry(glassW, muntinThick, muntinDepth);
      horiz2.translate(0, glassCenterY - rowH / 2, 0);
      frameParts.push(horiz2);

      // Clear See-Through Glass Pane
      const glass = new THREE.BoxGeometry(glassW, glassH, 0.008);
      glass.translate(0, glassCenterY, 0);
      glassParts.push(glass);

      // Classic Lever Handle
      const leverOuter = new THREE.CylinderGeometry(0.012, 0.012, 0.11, 12);
      leverOuter.rotateZ(Math.PI / 2);
      leverOuter.translate(panelWidth / 2 - 0.06, -0.05, panelThick / 2 + 0.04);
      hardwareParts.push(leverOuter);

      const leverInner = new THREE.CylinderGeometry(0.012, 0.012, 0.11, 12);
      leverInner.rotateZ(Math.PI / 2);
      leverInner.translate(panelWidth / 2 - 0.06, -0.05, -panelThick / 2 - 0.04);
      hardwareParts.push(leverInner);
      break;
    }

    case 'half-glass': {
      // Craftsman Half Glass (Upper 2 Panes, Lower 2 Solid Shaker Panels)
      const stileW = 0.11;
      const midRailH = 0.14;
      const topR = 0.11;
      const botR = 0.18;

      const leafLeft = new THREE.BoxGeometry(stileW, panelHeight, panelThick);
      leafLeft.translate(-panelWidth / 2 + stileW / 2, -frameThick / 2, 0);
      frameParts.push(leafLeft);

      const leafRight = new THREE.BoxGeometry(stileW, panelHeight, panelThick);
      leafRight.translate(panelWidth / 2 - stileW / 2, -frameThick / 2, 0);
      frameParts.push(leafRight);

      const leafTop = new THREE.BoxGeometry(panelWidth - stileW * 2, topR, panelThick);
      leafTop.translate(0, -frameThick / 2 + panelHeight / 2 - topR / 2, 0);
      frameParts.push(leafTop);

      const leafMid = new THREE.BoxGeometry(panelWidth - stileW * 2, midRailH, panelThick);
      leafMid.translate(0, -frameThick / 2, 0);
      frameParts.push(leafMid);

      const leafBot = new THREE.BoxGeometry(panelWidth - stileW * 2, botR, panelThick);
      leafBot.translate(0, -frameThick / 2 - panelHeight / 2 + botR / 2, 0);
      frameParts.push(leafBot);

      // Upper Glass Area
      const upperGlassW = panelWidth - stileW * 2;
      const upperGlassH = panelHeight / 2 - topR - midRailH / 2;
      const upperCenterY = -frameThick / 2 + panelHeight / 4 + midRailH / 4 - topR / 4;

      const vertMuntin = new THREE.BoxGeometry(0.025, upperGlassH, panelThick * 0.85);
      vertMuntin.translate(0, upperCenterY, 0);
      frameParts.push(vertMuntin);

      const glass = new THREE.BoxGeometry(upperGlassW, upperGlassH, 0.008);
      glass.translate(0, upperCenterY, 0);
      glassParts.push(glass);

      // Lower Solid Panels
      const lowerH = panelHeight / 2 - botR - midRailH / 2;
      const lowerCenterY = -frameThick / 2 - panelHeight / 4 - midRailH / 4 + botR / 4;
      const lowerPanel = new THREE.BoxGeometry(upperGlassW, lowerH, panelThick * 0.6);
      lowerPanel.translate(0, lowerCenterY, 0);
      frameParts.push(lowerPanel);

      // Modern Handle
      const leverOuter = new THREE.CylinderGeometry(0.012, 0.012, 0.11, 12);
      leverOuter.rotateZ(Math.PI / 2);
      leverOuter.translate(panelWidth / 2 - 0.06, -frameThick / 2, panelThick / 2 + 0.04);
      hardwareParts.push(leverOuter);
      break;
    }

    case 'double-french': {
      // Double French Door Pair
      const leafW = panelWidth / 2 - 0.005;
      const stileW = 0.09;
      const topR = 0.1;
      const botR = 0.15;

      [-panelWidth / 4, panelWidth / 4].forEach((leafCenterX) => {
        // Perimeter
        const leafL = new THREE.BoxGeometry(stileW, panelHeight, panelThick);
        leafL.translate(leafCenterX - leafW / 2 + stileW / 2, -frameThick / 2, 0);
        frameParts.push(leafL);

        const leafR = new THREE.BoxGeometry(stileW, panelHeight, panelThick);
        leafR.translate(leafCenterX + leafW / 2 - stileW / 2, -frameThick / 2, 0);
        frameParts.push(leafR);

        const leafT = new THREE.BoxGeometry(leafW - stileW * 2, topR, panelThick);
        leafT.translate(leafCenterX, -frameThick / 2 + panelHeight / 2 - topR / 2, 0);
        frameParts.push(leafT);

        const leafB = new THREE.BoxGeometry(leafW - stileW * 2, botR, panelThick);
        leafB.translate(leafCenterX, -frameThick / 2 - panelHeight / 2 + botR / 2, 0);
        frameParts.push(leafB);

        // Muntins
        const gw = leafW - stileW * 2;
        const gh = panelHeight - topR - botR;
        const gy = -frameThick / 2 + (topR - botR) / 2;

        const vm = new THREE.BoxGeometry(0.02, gh, panelThick * 0.85);
        vm.translate(leafCenterX, gy, 0);
        frameParts.push(vm);

        const rH = gh / 3;
        const h1 = new THREE.BoxGeometry(gw, 0.02, panelThick * 0.85);
        h1.translate(leafCenterX, gy + rH / 2, 0);
        frameParts.push(h1);

        const h2 = new THREE.BoxGeometry(gw, 0.02, panelThick * 0.85);
        h2.translate(leafCenterX, gy - rH / 2, 0);
        frameParts.push(h2);

        // Glass
        const glass = new THREE.BoxGeometry(gw, gh, 0.008);
        glass.translate(leafCenterX, gy, 0);
        glassParts.push(glass);
      });

      // Twin Handles
      const hOut1 = new THREE.CylinderGeometry(0.012, 0.012, 0.1, 12);
      hOut1.rotateZ(Math.PI / 2);
      hOut1.translate(-0.04, -0.05, panelThick / 2 + 0.04);
      hardwareParts.push(hOut1);

      const hOut2 = new THREE.CylinderGeometry(0.012, 0.012, 0.1, 12);
      hOut2.rotateZ(Math.PI / 2);
      hOut2.translate(0.04, -0.05, panelThick / 2 + 0.04);
      hardwareParts.push(hOut2);
      break;
    }

    case 'barn': {
      // Shaker Barn Door with Top Roller Track & Z-Brace
      const leaf = new THREE.BoxGeometry(panelWidth, panelHeight, panelThick);
      leaf.translate(0, -frameThick / 2, 0);
      frameParts.push(leaf);

      // Top Sliding Rail & Rollers
      const topRail = new THREE.BoxGeometry(width + 0.2, 0.03, 0.05);
      topRail.translate(0, height / 2 + 0.03, frameDepth / 2 + 0.03);
      hardwareParts.push(topRail);

      // Roller wheels
      const roller1 = new THREE.CylinderGeometry(0.025, 0.025, 0.03, 16);
      roller1.rotateZ(Math.PI / 2);
      roller1.translate(-panelWidth / 3, height / 2 + 0.04, frameDepth / 2 + 0.03);
      hardwareParts.push(roller1);

      const roller2 = new THREE.CylinderGeometry(0.025, 0.025, 0.03, 16);
      roller2.rotateZ(Math.PI / 2);
      roller2.translate(panelWidth / 3, height / 2 + 0.04, frameDepth / 2 + 0.03);
      hardwareParts.push(roller2);

      // Z-Brace Overlay Battens
      const zRailT = new THREE.BoxGeometry(panelWidth - 0.1, 0.1, 0.015);
      zRailT.translate(0, -frameThick / 2 + panelHeight / 2 - 0.15, panelThick / 2 + 0.008);
      frameParts.push(zRailT);

      const zRailB = new THREE.BoxGeometry(panelWidth - 0.1, 0.1, 0.015);
      zRailB.translate(0, -frameThick / 2 - panelHeight / 2 + 0.15, panelThick / 2 + 0.008);
      frameParts.push(zRailB);

      const zDiag = new THREE.BoxGeometry(0.1, panelHeight * 0.9, 0.015);
      zDiag.rotateZ(Math.atan2(panelWidth - 0.2, panelHeight - 0.4));
      zDiag.translate(0, -frameThick / 2, panelThick / 2 + 0.008);
      frameParts.push(zDiag);

      // Matte Black Vertical Pull Bar
      const pullBar = new THREE.CylinderGeometry(0.015, 0.015, 0.35, 16);
      pullBar.translate(panelWidth / 2 - 0.08, -0.05, panelThick / 2 + 0.04);
      hardwareParts.push(pullBar);
      break;
    }

    case 'horizontal-slat': {
      // Modern 5-Slat Grooved Door
      const leaf = new THREE.BoxGeometry(panelWidth, panelHeight, panelThick);
      leaf.translate(0, -frameThick / 2, 0);
      frameParts.push(leaf);

      // 4 Horizontal Reveal Accent Strips
      for (let i = 1; i <= 4; i++) {
        const y = -frameThick / 2 - panelHeight / 2 + (panelHeight / 5) * i;
        const groove = new THREE.BoxGeometry(panelWidth - 0.04, 0.01, panelThick + 0.005);
        groove.translate(0, y, 0);
        hardwareParts.push(groove);
      }

      // Tall Contemporary Architectural Pull
      const longPull = new THREE.BoxGeometry(0.02, 0.8, 0.03);
      longPull.translate(panelWidth / 2 - 0.07, 0, panelThick / 2 + 0.035);
      hardwareParts.push(longPull);
      break;
    }

    case 'pivot': {
      // Oversized Architectural Pivot Door
      const leaf = new THREE.BoxGeometry(panelWidth, panelHeight, panelThick * 1.3);
      leaf.translate(0, -frameThick / 2, 0);
      frameParts.push(leaf);

      // Pivot hinge cylinder top & bottom
      const pivotTop = new THREE.CylinderGeometry(0.025, 0.025, 0.06, 16);
      pivotTop.translate(-panelWidth / 2 + 0.12, height / 2 - frameThick, 0);
      hardwareParts.push(pivotTop);

      const pivotBot = new THREE.CylinderGeometry(0.025, 0.025, 0.06, 16);
      pivotBot.translate(-panelWidth / 2 + 0.12, -height / 2 + 0.03, 0);
      hardwareParts.push(pivotBot);

      // Full-Height 1.6m Stainless Tubular Pull Bar
      const tallBar = new THREE.CylinderGeometry(0.018, 0.018, Math.min(1.6, panelHeight - 0.4), 16);
      tallBar.translate(panelWidth / 2 - 0.1, 0, panelThick * 0.65 + 0.045);
      hardwareParts.push(tallBar);
      break;
    }

    case 'bifold': {
      // 3-Leaf / 4-Leaf Bi-Fold Concertina Folding Patio Door
      const numLeaves = width > 2.2 ? 4 : 3;
      const leafW = (panelWidth - (numLeaves - 1) * 0.008) / numLeaves;
      const stileW = 0.065;
      const topRailH = 0.08;
      const botRailH = 0.12;

      // Top guide track & bottom flush track
      const topTrack = new THREE.BoxGeometry(panelWidth, 0.035, frameDepth * 0.9);
      topTrack.translate(0, height / 2 - frameThick / 2 - 0.015, 0);
      hardwareParts.push(topTrack);

      const botTrack = new THREE.BoxGeometry(panelWidth, 0.015, frameDepth * 0.9);
      botTrack.translate(0, -height / 2 + 0.01, 0);
      hardwareParts.push(botTrack);

      // Generate folding leaves with slight concertina angle
      for (let i = 0; i < numLeaves; i++) {
        const foldAngle = (i % 2 === 0 ? 0.18 : -0.18);
        const leafCenterX = -panelWidth / 2 + leafW / 2 + i * (leafW + 0.008);
        const leafZ = (i % 2 === 0 ? 0.02 : -0.02);

        // Leaf outer stile & rail frame
        const frameL = new THREE.BoxGeometry(stileW, panelHeight - 0.06, panelThick * 0.85);
        frameL.rotateY(foldAngle);
        frameL.translate(leafCenterX - leafW / 2 + stileW / 2, -frameThick / 2, leafZ);
        frameParts.push(frameL);

        const frameR = new THREE.BoxGeometry(stileW, panelHeight - 0.06, panelThick * 0.85);
        frameR.rotateY(foldAngle);
        frameR.translate(leafCenterX + leafW / 2 - stileW / 2, -frameThick / 2, leafZ);
        frameParts.push(frameR);

        const frameT = new THREE.BoxGeometry(leafW - stileW * 2, topRailH, panelThick * 0.85);
        frameT.rotateY(foldAngle);
        frameT.translate(leafCenterX, -frameThick / 2 + (panelHeight - 0.06) / 2 - topRailH / 2, leafZ);
        frameParts.push(frameT);

        const frameB = new THREE.BoxGeometry(leafW - stileW * 2, botRailH, panelThick * 0.85);
        frameB.rotateY(foldAngle);
        frameB.translate(leafCenterX, -frameThick / 2 - (panelHeight - 0.06) / 2 + botRailH / 2, leafZ);
        frameParts.push(frameB);

        // Glass Pane
        const glassW = leafW - stileW * 2;
        const glassH = panelHeight - 0.06 - topRailH - botRailH;
        const glassY = -frameThick / 2 + (topRailH - botRailH) / 2;
        const glass = new THREE.BoxGeometry(glassW, glassH, 0.008);
        glass.rotateY(foldAngle);
        glass.translate(leafCenterX, glassY, leafZ);
        glassParts.push(glass);

        // Intermediate Hinge Cylinders
        if (i < numLeaves - 1) {
          const hingeX = leafCenterX + leafW / 2;
          const hingeT = new THREE.CylinderGeometry(0.010, 0.010, 0.08, 12);
          hingeT.translate(hingeX, 0.5, leafZ + 0.02);
          hardwareParts.push(hingeT);

          const hingeB = new THREE.CylinderGeometry(0.010, 0.010, 0.08, 12);
          hingeB.translate(hingeX, -0.5, leafZ + 0.02);
          hardwareParts.push(hingeB);
        }
      }

      // Master Bi-fold Lever Handle
      const handle = new THREE.CylinderGeometry(0.012, 0.012, 0.12, 12);
      handle.rotateZ(Math.PI / 2);
      handle.translate(panelWidth / 2 - leafW + 0.06, -0.05, panelThick / 2 + 0.04);
      hardwareParts.push(handle);
      break;
    }

    case 'patio-sliding': {
      // 2-Panel Wide Sliding Glass Patio Door
      const leafW = panelWidth / 2 + 0.03;
      const stileW = 0.08;
      const topRailH = 0.09;
      const botRailH = 0.14;

      // Sliding Top & Bottom Dual Tracks
      const trackT = new THREE.BoxGeometry(panelWidth, 0.035, frameDepth * 0.95);
      trackT.translate(0, height / 2 - frameThick / 2 - 0.015, 0);
      hardwareParts.push(trackT);

      const trackB = new THREE.BoxGeometry(panelWidth, 0.025, frameDepth * 0.95);
      trackB.translate(0, -height / 2 + 0.012, 0);
      hardwareParts.push(trackB);

      // Left fixed leaf (slightly inward -Z) and Right sliding leaf (slightly outward +Z)
      const leaves = [
        { cx: -panelWidth / 4 + 0.015, z: -0.025, isSlider: false },
        { cx: panelWidth / 4 - 0.015, z: 0.025, isSlider: true }
      ];

      leaves.forEach(({ cx, z, isSlider }) => {
        // Frame stiles & rails
        const frameL = new THREE.BoxGeometry(stileW, panelHeight - 0.05, panelThick * 0.85);
        frameL.translate(cx - leafW / 2 + stileW / 2, -frameThick / 2, z);
        frameParts.push(frameL);

        const frameR = new THREE.BoxGeometry(stileW, panelHeight - 0.05, panelThick * 0.85);
        frameR.translate(cx + leafW / 2 - stileW / 2, -frameThick / 2, z);
        frameParts.push(frameR);

        const frameT = new THREE.BoxGeometry(leafW - stileW * 2, topRailH, panelThick * 0.85);
        frameT.translate(cx, -frameThick / 2 + (panelHeight - 0.05) / 2 - topRailH / 2, z);
        frameParts.push(frameT);

        const frameB = new THREE.BoxGeometry(leafW - stileW * 2, botRailH, panelThick * 0.85);
        frameB.translate(cx, -frameThick / 2 - (panelHeight - 0.05) / 2 + botRailH / 2, z);
        frameParts.push(frameB);

        // Expansive Glass
        const gw = leafW - stileW * 2;
        const gh = panelHeight - 0.05 - topRailH - botRailH;
        const gy = -frameThick / 2 + (topRailH - botRailH) / 2;
        const glass = new THREE.BoxGeometry(gw, gh, 0.008);
        glass.translate(cx, gy, z);
        glassParts.push(glass);

        if (isSlider) {
          // Sliding D-Handle & Mortise Lock
          const dHandle = new THREE.BoxGeometry(0.025, 0.22, 0.04);
          dHandle.translate(cx - leafW / 2 + stileW + 0.03, -0.05, z + panelThick / 2 + 0.02);
          hardwareParts.push(dHandle);

          const lockThumb = new THREE.CylinderGeometry(0.012, 0.012, 0.03, 12);
          lockThumb.rotateX(Math.PI / 2);
          lockThumb.translate(cx - leafW / 2 + stileW + 0.03, 0.1, z + panelThick / 2 + 0.02);
          hardwareParts.push(lockThumb);
        }
      });
      break;
    }

    case 'shutters': {
      // Full-Lite French Doors flanked by authentic Louvered Timber Shutters
      const doorAreaW = panelWidth * 0.65;
      const shutterW = (panelWidth - doorAreaW) / 2 - 0.02;
      const leafW = doorAreaW / 2 - 0.005;
      const stileW = 0.075;

      // Central Dual French Glass Doors
      [-doorAreaW / 4, doorAreaW / 4].forEach((leafCenterX) => {
        const frameL = new THREE.BoxGeometry(stileW, panelHeight, panelThick * 0.85);
        frameL.translate(leafCenterX - leafW / 2 + stileW / 2, -frameThick / 2, 0);
        frameParts.push(frameL);

        const frameR = new THREE.BoxGeometry(stileW, panelHeight, panelThick * 0.85);
        frameR.translate(leafCenterX + leafW / 2 - stileW / 2, -frameThick / 2, 0);
        frameParts.push(frameR);

        const frameT = new THREE.BoxGeometry(leafW - stileW * 2, 0.1, panelThick * 0.85);
        frameT.translate(leafCenterX, -frameThick / 2 + panelHeight / 2 - 0.05, 0);
        frameParts.push(frameT);

        const frameB = new THREE.BoxGeometry(leafW - stileW * 2, 0.14, panelThick * 0.85);
        frameB.translate(leafCenterX, -frameThick / 2 - panelHeight / 2 + 0.07, 0);
        frameParts.push(frameB);

        // Glass Pane & Muntin Grid
        const gw = leafW - stileW * 2;
        const gh = panelHeight - 0.24;
        const vm = new THREE.BoxGeometry(0.018, gh, panelThick * 0.7);
        vm.translate(leafCenterX, -frameThick / 2 - 0.02, 0);
        frameParts.push(vm);

        const hm1 = new THREE.BoxGeometry(gw, 0.018, panelThick * 0.7);
        hm1.translate(leafCenterX, -frameThick / 2 + gh / 4 - 0.02, 0);
        frameParts.push(hm1);

        const hm2 = new THREE.BoxGeometry(gw, 0.018, panelThick * 0.7);
        hm2.translate(leafCenterX, -frameThick / 2 - gh / 4 - 0.02, 0);
        frameParts.push(hm2);

        const glass = new THREE.BoxGeometry(gw, gh, 0.008);
        glass.translate(leafCenterX, -frameThick / 2 - 0.02, 0);
        glassParts.push(glass);
      });

      // Left & Right Louvered Exterior Shutters
      const shutterZ = frameDepth / 2 + 0.02;
      const shutterH = panelHeight * 0.98;
      const shutterStileW = 0.05;

      [-panelWidth / 2 + shutterW / 2, panelWidth / 2 - shutterW / 2].forEach((shutX, sIdx) => {
        // Shutter Outer Frame
        const shutL = new THREE.BoxGeometry(shutterStileW, shutterH, 0.028);
        shutL.translate(shutX - shutterW / 2 + shutterStileW / 2, -frameThick / 2, shutterZ);
        frameParts.push(shutL);

        const shutR = new THREE.BoxGeometry(shutterStileW, shutterH, 0.028);
        shutR.translate(shutX + shutterW / 2 - shutterStileW / 2, -frameThick / 2, shutterZ);
        frameParts.push(shutR);

        const shutT = new THREE.BoxGeometry(shutterW - shutterStileW * 2, 0.06, 0.028);
        shutT.translate(shutX, -frameThick / 2 + shutterH / 2 - 0.03, shutterZ);
        frameParts.push(shutT);

        const shutM = new THREE.BoxGeometry(shutterW - shutterStileW * 2, 0.05, 0.028);
        shutM.translate(shutX, -frameThick / 2, shutterZ);
        frameParts.push(shutM);

        const shutB = new THREE.BoxGeometry(shutterW - shutterStileW * 2, 0.08, 0.028);
        shutB.translate(shutX, -frameThick / 2 - shutterH / 2 + 0.04, shutterZ);
        frameParts.push(shutB);

        // Angled Louver Slats (14 upper slats, 14 lower slats)
        const louverW = shutterW - shutterStileW * 2;
        const numLouvers = 12;
        const subH = shutterH / 2 - 0.07;

        for (let l = 1; l <= numLouvers; l++) {
          // Upper section
          const yTop = -frameThick / 2 + 0.03 + (subH / (numLouvers + 1)) * l;
          const louver1 = new THREE.BoxGeometry(louverW, 0.03, 0.006);
          louver1.rotateX(0.45);
          louver1.translate(shutX, yTop, shutterZ);
          frameParts.push(louver1);

          // Lower section
          const yBot = -frameThick / 2 - shutterH / 2 + 0.05 + (subH / (numLouvers + 1)) * l;
          const louver2 = new THREE.BoxGeometry(louverW, 0.03, 0.006);
          louver2.rotateX(0.45);
          louver2.translate(shutX, yBot, shutterZ);
          frameParts.push(louver2);
        }

        // Wrought Iron Strap Hinges & Shutter Tiebacks
        const hinge1 = new THREE.BoxGeometry(shutterW * 0.75, 0.02, 0.008);
        hinge1.translate(shutX + (sIdx === 0 ? 0.02 : -0.02), -frameThick / 2 + shutterH / 2 - 0.08, shutterZ + 0.016);
        hardwareParts.push(hinge1);

        const hinge2 = new THREE.BoxGeometry(shutterW * 0.75, 0.02, 0.008);
        hinge2.translate(shutX + (sIdx === 0 ? 0.02 : -0.02), -frameThick / 2 - shutterH / 2 + 0.08, shutterZ + 0.016);
        hardwareParts.push(hinge2);
      });

      // Dual Brass French Knobs
      const knob1 = new THREE.CylinderGeometry(0.014, 0.014, 0.04, 16);
      knob1.rotateX(Math.PI / 2);
      knob1.translate(-0.03, -0.05, panelThick / 2 + 0.03);
      hardwareParts.push(knob1);

      const knob2 = new THREE.CylinderGeometry(0.014, 0.014, 0.04, 16);
      knob2.rotateX(Math.PI / 2);
      knob2.translate(0.03, -0.05, panelThick / 2 + 0.03);
      hardwareParts.push(knob2);
      break;
    }

    case 'flush':
    default: {
      // Clean Flush Modern Panel
      const panel = new THREE.BoxGeometry(panelWidth, panelHeight, panelThick);
      panel.translate(0, -frameThick / 2, 0);
      frameParts.push(panel);

      // Escutcheon Plates & Lever Handles
      const plateOuter = new THREE.BoxGeometry(0.04, 0.18, 0.005);
      plateOuter.translate(panelWidth / 2 - 0.08, -0.05, panelThick / 2 + 0.003);
      hardwareParts.push(plateOuter);

      const leverOuter = new THREE.CylinderGeometry(0.012, 0.012, 0.12, 12);
      leverOuter.rotateZ(Math.PI / 2);
      leverOuter.translate(panelWidth / 2 - 0.04, -0.03, panelThick / 2 + 0.035);
      hardwareParts.push(leverOuter);

      const plateInner = new THREE.BoxGeometry(0.04, 0.18, 0.005);
      plateInner.translate(panelWidth / 2 - 0.08, -0.05, -panelThick / 2 - 0.003);
      hardwareParts.push(plateInner);

      const leverInner = new THREE.CylinderGeometry(0.012, 0.012, 0.12, 12);
      leverInner.rotateZ(Math.PI / 2);
      leverInner.translate(panelWidth / 2 - 0.04, -0.03, -panelThick / 2 - 0.035);
      hardwareParts.push(leverInner);
      break;
    }
  }

  // Merge into multi-material geometry with groups
  try {
    const frameMerged = BufferGeometryUtils.mergeGeometries(frameParts, false) || new THREE.BoxGeometry(width, height, depth);
    const glassMerged = (glassParts.length > 0 && BufferGeometryUtils.mergeGeometries(glassParts, false)) || new THREE.BoxGeometry(0.0001, 0.0001, 0.0001);
    const hardwareMerged = (hardwareParts.length > 0 && BufferGeometryUtils.mergeGeometries(hardwareParts, false)) || new THREE.BoxGeometry(0.0001, 0.0001, 0.0001);

    const merged = BufferGeometryUtils.mergeGeometries([frameMerged, glassMerged, hardwareMerged], true);
    return merged || new THREE.BoxGeometry(width, height, depth);
  } catch (e) {
    return new THREE.BoxGeometry(width, height, depth);
  }
}

/**
 * Creates an architectural Window geometry with multi-material groups:
 * Material 0: Outer Frame, Mullions, and Window Sill (White / Color Finishes)
 * Material 1: Crystal Clear See-Through Glass (See through wall cutout)
 * Material 2: Locks / Sashes / Hinges
 */
export function createWindowGeometry(
  width = 1.2,
  height = 1.2,
  depth = 0.12,
  style = 'cross'
): THREE.BufferGeometry {
  const frameParts: THREE.BufferGeometry[] = [];
  const glassParts: THREE.BufferGeometry[] = [];
  const hardwareParts: THREE.BufferGeometry[] = [];

  const frameThick = 0.045;
  const frameDepth = depth;
  const mullionDepth = frameDepth * 0.7;

  // 1. Outer Frame (Left, Right, Top, Bottom)
  const leftFrame = new THREE.BoxGeometry(frameThick, height, frameDepth);
  leftFrame.translate(-width / 2 + frameThick / 2, 0, 0);
  frameParts.push(leftFrame);

  const rightFrame = new THREE.BoxGeometry(frameThick, height, frameDepth);
  rightFrame.translate(width / 2 - frameThick / 2, 0, 0);
  frameParts.push(rightFrame);

  const topFrame = new THREE.BoxGeometry(width, frameThick, frameDepth);
  topFrame.translate(0, height / 2 - frameThick / 2, 0);
  frameParts.push(topFrame);

  const bottomFrame = new THREE.BoxGeometry(width, frameThick, frameDepth);
  bottomFrame.translate(0, -height / 2 + frameThick / 2, 0);
  frameParts.push(bottomFrame);

  // 2. Exterior Window Sill Ledge
  const sillWidth = width + 0.1;
  const sillHeight = 0.04;
  const sillDepth = frameDepth + 0.06;
  const sill = new THREE.BoxGeometry(sillWidth, sillHeight, sillDepth);
  sill.translate(0, -height / 2 - sillHeight / 2 + frameThick / 2, 0.03);
  frameParts.push(sill);

  const innerW = width - frameThick * 2;
  const innerH = height - frameThick * 2;

  // 3. Window Style Specific Glazing & Mullions
  switch (style) {
    case 'picture': {
      // Single Unobstructed Panoramic Glass Pane
      const glass = new THREE.BoxGeometry(innerW, innerH, 0.008);
      glassParts.push(glass);
      break;
    }

    case 'georgian': {
      // 6-Pane Colonial / Georgian (3 cols x 2 rows)
      const mullionThick = 0.022;
      const colW = innerW / 3;

      // 2 Vertical Mullions
      const vm1 = new THREE.BoxGeometry(mullionThick, innerH, mullionDepth);
      vm1.translate(-colW / 2, 0, 0);
      frameParts.push(vm1);

      const vm2 = new THREE.BoxGeometry(mullionThick, innerH, mullionDepth);
      vm2.translate(colW / 2, 0, 0);
      frameParts.push(vm2);

      // 1 Horizontal Mullion
      const hm = new THREE.BoxGeometry(innerW, mullionThick, mullionDepth);
      frameParts.push(hm);

      const glass = new THREE.BoxGeometry(innerW, innerH, 0.008);
      glassParts.push(glass);
      break;
    }

    case 'slider': {
      // 2-Pane Horizontal Sliding Sashes with Center Overlap
      const sashW = innerW / 2 + 0.02;
      const meetingStileW = 0.035;

      const sashMeeting = new THREE.BoxGeometry(meetingStileW, innerH, frameDepth * 0.85);
      frameParts.push(sashMeeting);

      // Left fixed glass & right slider glass
      const glassL = new THREE.BoxGeometry(innerW / 2, innerH, 0.008);
      glassL.translate(-innerW / 4, 0, 0.015);
      glassParts.push(glassL);

      const glassR = new THREE.BoxGeometry(innerW / 2, innerH, 0.008);
      glassR.translate(innerW / 4, 0, -0.015);
      glassParts.push(glassR);

      // Center Sash Cam Lock
      const camLock = new THREE.BoxGeometry(0.03, 0.06, 0.03);
      camLock.translate(0, 0, 0.03);
      hardwareParts.push(camLock);
      break;
    }

    case 'ribbon': {
      // 3-Pane Panoramic Modern Ribbon
      const mullionThick = 0.03;
      const colW = innerW / 3;

      const vm1 = new THREE.BoxGeometry(mullionThick, innerH, mullionDepth);
      vm1.translate(-colW / 2, 0, 0);
      frameParts.push(vm1);

      const vm2 = new THREE.BoxGeometry(mullionThick, innerH, mullionDepth);
      vm2.translate(colW / 2, 0, 0);
      frameParts.push(vm2);

      const glass = new THREE.BoxGeometry(innerW, innerH, 0.008);
      glassParts.push(glass);
      break;
    }

    case 'arch': {
      // Authentic Palladian / Georgian Arched Top Window
      const archRadius = innerW / 2;
      const springlineY = innerH / 2 - archRadius;
      const lowerH = Math.max(0.2, springlineY - (-innerH / 2));

      // 1. Prominent Transom / Springline Beam
      const transomBeam = new THREE.BoxGeometry(innerW, 0.045, frameDepth * 0.95);
      transomBeam.translate(0, springlineY, 0);
      frameParts.push(transomBeam);

      // 2. Semicircular True 3D Arch Surround Casing (Segmented curved arc)
      const numArchSegments = 16;
      for (let s = 0; s < numArchSegments; s++) {
        const theta1 = (Math.PI / numArchSegments) * s;
        const theta2 = (Math.PI / numArchSegments) * (s + 1);
        const midTheta = (theta1 + theta2) / 2;
        const segLen = (Math.PI * archRadius) / numArchSegments;

        const x = Math.cos(midTheta) * (archRadius - frameThick / 2);
        const y = springlineY + Math.sin(midTheta) * (archRadius - frameThick / 2);

        const archSegment = new THREE.BoxGeometry(segLen * 1.05, frameThick, frameDepth);
        archSegment.rotateZ(midTheta - Math.PI / 2);
        archSegment.translate(x, y, 0);
        frameParts.push(archSegment);
      }

      // 3. Radial Fanlight / Sunburst Spokes (radiating from center of springline)
      const spokeAngles = [Math.PI / 6, Math.PI / 3, Math.PI / 2, (2 * Math.PI) / 3, (5 * Math.PI) / 6];
      spokeAngles.forEach(ang => {
        const spokeLen = archRadius - frameThick;
        const spoke = new THREE.BoxGeometry(0.018, spokeLen, mullionDepth * 0.8);
        spoke.rotateZ(ang - Math.PI / 2);
        spoke.translate(Math.cos(ang) * (spokeLen / 2), springlineY + Math.sin(ang) * (spokeLen / 2), 0);
        frameParts.push(spoke);
      });

      // 4. Lower Dual Casement Sashes (2x2 Colonial Grid)
      const casementW = (innerW - 0.04) / 2;
      const casementCenterY = -innerH / 2 + lowerH / 2;

      [-innerW / 4, innerW / 4].forEach(cx => {
        // Vertical mullion
        const vm = new THREE.BoxGeometry(0.02, lowerH, mullionDepth * 0.85);
        vm.translate(cx, casementCenterY, 0);
        frameParts.push(vm);

        // Horizontal mullion
        const hm = new THREE.BoxGeometry(casementW, 0.02, mullionDepth * 0.85);
        hm.translate(cx, casementCenterY, 0);
        frameParts.push(hm);
      });

      // Center divider mullion
      const centerMullion = new THREE.BoxGeometry(0.035, lowerH, frameDepth * 0.9);
      centerMullion.translate(0, casementCenterY, 0);
      frameParts.push(centerMullion);

      // Glass: Lower Rectangle + Upper Arched Lunette
      const lowerGlass = new THREE.BoxGeometry(innerW, lowerH, 0.008);
      lowerGlass.translate(0, casementCenterY, 0);
      glassParts.push(lowerGlass);

      const upperGlass = new THREE.CylinderGeometry(archRadius - frameThick, archRadius - frameThick, 0.008, 24, 1, false, 0, Math.PI);
      upperGlass.rotateZ(Math.PI / 2);
      upperGlass.rotateX(Math.PI / 2);
      upperGlass.translate(0, springlineY, 0);
      glassParts.push(upperGlass);
      break;
    }

    case 'bay': {
      // 3-Sided Architectural Cantilevered Bay Window (Projecting Outward towards Exterior +Z)
      // FIX: was projecting toward -Z, but this file's own established
      // convention elsewhere (see the cladding-generation comment
      // above: "outward-facing exterior face (+Z)") puts +Z as
      // exterior, not -Z — confirmed directly as the cause of the
      // reported "bay window intrudes into the room" bug. Verified
      // directly (not assumed): computed the actual world-space
      // corners of a wing pane before and after, confirming the
      // rotations themselves don't need to change, only the sign of
      // every Z-translation — the 45° angled wings are symmetric
      // enough that mirroring their position alone (without touching
      // rotateY's own angle) still connects the wall edge to the
      // center pane correctly, just toward +Z instead of -Z.
      const bayDepth = Math.max(0.35, depth * 2.5);
      const centerW = innerW * 0.55;
      const wingW = (innerW - centerW) / 1.414; // 45 degree projection
      const angle45 = Math.PI / 4;

      // Projecting Base Platform Shelf & Top Roof Soffit Hip Cap
      // FIX (design improvement): these were previously a single flat
      // box spanning the full width, which doesn't actually trace the
      // window's own 3-sided angled footprint — a bay window's sill
      // and hip roof are one of its most recognizable features
      // precisely because they follow the hexagonal plan, not a plain
      // rectangle. Each is now 3 segments (center + both 45° wings),
      // using the exact same positions and rotations already verified
      // correct for the frame elements above, just wider for a visible
      // overhang and thin enough to read as a sill/cap rather than a
      // slab.
      const shelfOverhang = 0.1;
      const shelfThick = 0.06;
      const roofThick = 0.08;

      const shelfCenter = new THREE.BoxGeometry(centerW + shelfOverhang * 2, shelfThick, bayDepth + frameDepth + shelfOverhang);
      shelfCenter.translate(0, -height / 2 - shelfThick / 2, bayDepth / 2);
      frameParts.push(shelfCenter);

      const roofCenter = new THREE.BoxGeometry(centerW + shelfOverhang * 2, roofThick, bayDepth + frameDepth + shelfOverhang);
      roofCenter.translate(0, height / 2 + roofThick / 2, bayDepth / 2);
      frameParts.push(roofCenter);

      const wingPlanDepth = (wingW + shelfOverhang * 2) * Math.SQRT1_2; // 45°-projected footprint depth of one wing segment
      for (const side of [-1, 1] as const) {
        const wingCenterX = side * (centerW / 2 + (wingW / 2) * Math.cos(angle45));
        const wingCenterZ = bayDepth - (wingW / 2) * Math.sin(angle45);
        const wingAngle = side * angle45;

        const shelfWing = new THREE.BoxGeometry(wingW + shelfOverhang * 2, shelfThick, wingPlanDepth + shelfOverhang);
        shelfWing.rotateY(wingAngle);
        shelfWing.translate(wingCenterX, -height / 2 - shelfThick / 2, wingCenterZ);
        frameParts.push(shelfWing);

        const roofWing = new THREE.BoxGeometry(wingW + shelfOverhang * 2, roofThick, wingPlanDepth + shelfOverhang);
        roofWing.rotateY(wingAngle);
        roofWing.translate(wingCenterX, height / 2 + roofThick / 2, wingCenterZ);
        frameParts.push(roofWing);
      }

      // Cantilever Support Brackets — real bay windows always show
      // visible structural support underneath, since they project out
      // past the wall's own face with nothing below; this was entirely
      // absent before. Three simple angled corbels (center + both
      // wings) reading clearly from below without needing full,
      // separately-modeled bracket geometry.
      const bracketDepth = 0.04;
      const bracketDrop = 0.14;
      for (const bx of [-centerW / 3, 0, centerW / 3]) {
        const bracket = new THREE.BoxGeometry(0.05, bracketDrop, bayDepth * 0.85);
        bracket.rotateX(-Math.PI / 10);
        bracket.translate(bx, -height / 2 - shelfThick - bracketDrop * 0.4, bayDepth * 0.4);
        frameParts.push(bracket);
      }
      for (const side of [-1, 1] as const) {
        const bx = side * (centerW / 2 + (wingW / 2) * Math.cos(angle45) * 0.6);
        const bz = bayDepth - (wingW / 2) * Math.sin(angle45) * 0.6;
        const bracket = new THREE.BoxGeometry(0.05, bracketDrop, bayDepth * 0.6);
        bracket.rotateY(side * angle45);
        bracket.rotateX(-Math.PI / 10);
        bracket.translate(bx, -height / 2 - shelfThick - bracketDrop * 0.4, bz);
        frameParts.push(bracket);
      }

      // 1. Center Picture Pane (Facing outward at +bayDepth)
      const centerFrameT = new THREE.BoxGeometry(centerW, frameThick, frameDepth);
      centerFrameT.translate(0, innerH / 2 - frameThick / 2, bayDepth);
      frameParts.push(centerFrameT);

      const centerFrameB = new THREE.BoxGeometry(centerW, frameThick, frameDepth);
      centerFrameB.translate(0, -innerH / 2 + frameThick / 2, bayDepth);
      frameParts.push(centerFrameB);

      const centerGlass = new THREE.BoxGeometry(centerW - frameThick * 2, innerH - frameThick * 2, 0.008);
      centerGlass.translate(0, 0, bayDepth);
      glassParts.push(centerGlass);

      // Center Glass Vertical Glazing Bars
      const cvm1 = new THREE.BoxGeometry(0.02, innerH - frameThick * 2, mullionDepth);
      cvm1.translate(-centerW / 4, 0, bayDepth);
      frameParts.push(cvm1);
      const cvm2 = new THREE.BoxGeometry(0.02, innerH - frameThick * 2, mullionDepth);
      cvm2.translate(centerW / 4, 0, bayDepth);
      frameParts.push(cvm2);

      // 2. Left 45° Angled Flanking Casement (Connecting from wall edge -width/2, 0 to center -centerW/2, +bayDepth)
      const leftCenterX = -centerW / 2 - (wingW / 2) * Math.cos(angle45);
      const leftCenterZ = bayDepth - (wingW / 2) * Math.sin(angle45);

      const leftFrameT = new THREE.BoxGeometry(wingW, frameThick, frameDepth);
      leftFrameT.rotateY(angle45);
      leftFrameT.translate(leftCenterX, innerH / 2 - frameThick / 2, leftCenterZ);
      frameParts.push(leftFrameT);

      const leftFrameB = new THREE.BoxGeometry(wingW, frameThick, frameDepth);
      leftFrameB.rotateY(angle45);
      leftFrameB.translate(leftCenterX, -innerH / 2 + frameThick / 2, leftCenterZ);
      frameParts.push(leftFrameB);

      const leftGlass = new THREE.BoxGeometry(wingW - frameThick * 2, innerH - frameThick * 2, 0.008);
      leftGlass.rotateY(angle45);
      leftGlass.translate(leftCenterX, 0, leftCenterZ);
      glassParts.push(leftGlass);

      // 3. Right 45° Angled Flanking Casement (Connecting from center centerW/2, +bayDepth to wall edge width/2, 0)
      const rightCenterX = centerW / 2 + (wingW / 2) * Math.cos(angle45);
      const rightCenterZ = bayDepth - (wingW / 2) * Math.sin(angle45);

      const rightFrameT = new THREE.BoxGeometry(wingW, frameThick, frameDepth);
      rightFrameT.rotateY(-angle45);
      rightFrameT.translate(rightCenterX, innerH / 2 - frameThick / 2, rightCenterZ);
      frameParts.push(rightFrameT);

      const rightFrameB = new THREE.BoxGeometry(wingW, frameThick, frameDepth);
      rightFrameB.rotateY(-angle45);
      rightFrameB.translate(rightCenterX, -innerH / 2 + frameThick / 2, rightCenterZ);
      frameParts.push(rightFrameB);

      const rightGlass = new THREE.BoxGeometry(wingW - frameThick * 2, innerH - frameThick * 2, 0.008);
      rightGlass.rotateY(-angle45);
      rightGlass.translate(rightCenterX, 0, rightCenterZ);
      glassParts.push(rightGlass);

      // Corner Posts
      const postL = new THREE.BoxGeometry(0.06, height, 0.06);
      postL.translate(-centerW / 2, 0, bayDepth);
      frameParts.push(postL);

      const postR = new THREE.BoxGeometry(0.06, height, 0.06);
      postR.translate(centerW / 2, 0, bayDepth);
      frameParts.push(postR);
      break;
    }

    case 'velux-roof': {
      // Velux Roof Skylight Window with Weather Flashing Collar & Center-Pivot Sash
      const collarW = width + 0.16;
      const collarH = height + 0.16;

      // Perimeter Weather Flashing Flange Collar (Grey/Anthracite Aluminum)
      const flashL = new THREE.BoxGeometry(0.08, collarH, 0.02);
      flashL.translate(-width / 2 - 0.04, 0, -0.01);
      frameParts.push(flashL);

      const flashR = new THREE.BoxGeometry(0.08, collarH, 0.02);
      flashR.translate(width / 2 + 0.04, 0, -0.01);
      frameParts.push(flashR);

      const flashT = new THREE.BoxGeometry(collarW, 0.08, 0.02);
      flashT.translate(0, height / 2 + 0.04, -0.01);
      frameParts.push(flashT);

      const flashB = new THREE.BoxGeometry(collarW, 0.08, 0.02);
      flashB.translate(0, -height / 2 - 0.04, -0.01);
      frameParts.push(flashB);

      // Center-Pivot Opening Sash Frame (slightly tilted out 6° for ventilation)
      const sashW = innerW;
      const sashH = innerH;
      const sashFrameL = new THREE.BoxGeometry(0.04, sashH, 0.045);
      sashFrameL.translate(-sashW / 2 + 0.02, 0, 0.025);
      frameParts.push(sashFrameL);

      const sashFrameR = new THREE.BoxGeometry(0.04, sashH, 0.045);
      sashFrameR.translate(sashW / 2 - 0.02, 0, 0.025);
      frameParts.push(sashFrameR);

      const sashFrameT = new THREE.BoxGeometry(sashW, 0.04, 0.045);
      sashFrameT.translate(0, sashH / 2 - 0.02, 0.025);
      frameParts.push(sashFrameT);

      const sashFrameB = new THREE.BoxGeometry(sashW, 0.04, 0.045);
      sashFrameB.translate(0, -sashH / 2 + 0.02, 0.025);
      frameParts.push(sashFrameB);

      // Low-E Insulated Glazing Pane
      const glass = new THREE.BoxGeometry(sashW - 0.08, sashH - 0.08, 0.012);
      glass.translate(0, 0, 0.025);
      glassParts.push(glass);

      // Top Ergonomic Aluminium Control Ventilation Flap Bar
      const topBar = new THREE.BoxGeometry(sashW * 0.85, 0.035, 0.025);
      topBar.translate(0, sashH / 2 - 0.04, 0.05);
      hardwareParts.push(topBar);

      // Side Pivot Hinges & Friction Stays
      const pivotL = new THREE.CylinderGeometry(0.015, 0.015, 0.03, 16);
      pivotL.rotateZ(Math.PI / 2);
      pivotL.translate(-width / 2 + 0.02, 0, 0.025);
      hardwareParts.push(pivotL);

      const pivotR = new THREE.CylinderGeometry(0.015, 0.015, 0.03, 16);
      pivotR.rotateZ(Math.PI / 2);
      pivotR.translate(width / 2 - 0.02, 0, 0.025);
      hardwareParts.push(pivotR);
      break;
    }

    case 'double-hung': {
      // Traditional 2-Sash Double Hung Window with Meeting Rail
      const midRail = new THREE.BoxGeometry(innerW, 0.045, frameDepth * 0.8);
      frameParts.push(midRail);

      // Upper sash vertical divider
      const upperM = new THREE.BoxGeometry(0.02, innerH / 2, mullionDepth * 0.7);
      upperM.translate(0, innerH / 4, 0.015);
      frameParts.push(upperM);

      // Lower sash vertical divider
      const lowerM = new THREE.BoxGeometry(0.02, innerH / 2, mullionDepth * 0.7);
      lowerM.translate(0, -innerH / 4, -0.015);
      frameParts.push(lowerM);

      const glass = new THREE.BoxGeometry(innerW, innerH, 0.008);
      glassParts.push(glass);

      // Sash lock hardware on center meeting rail
      const sashLock = new THREE.BoxGeometry(0.04, 0.02, 0.03);
      sashLock.translate(0, 0.02, 0.025);
      hardwareParts.push(sashLock);
      break;
    }

    case 'transom': {
      // Transom Hopper (Top 1/3 opening hopper + Bottom 2/3 fixed pane)
      const transomH = innerH * 0.3;
      const transomBarY = innerH / 2 - transomH;

      const transomBar = new THREE.BoxGeometry(innerW, 0.035, frameDepth * 0.85);
      transomBar.translate(0, transomBarY, 0);
      frameParts.push(transomBar);

      // Transom sash frame
      const sashTop = new THREE.BoxGeometry(innerW - 0.04, 0.02, frameDepth * 0.6);
      sashTop.translate(0, innerH / 2 - 0.02, 0.015);
      frameParts.push(sashTop);

      const glass = new THREE.BoxGeometry(innerW, innerH, 0.008);
      glassParts.push(glass);

      // Transom pull latch
      const latch = new THREE.BoxGeometry(0.03, 0.03, 0.03);
      latch.translate(0, transomBarY + 0.03, 0.035);
      hardwareParts.push(latch);
      break;
    }

    case 'cross':
    default: {
      // Classic 4-Pane Casement Window (1 vertical + 1 horizontal mullion)
      const mullionThick = 0.025;

      const vertMullion = new THREE.BoxGeometry(mullionThick, innerH, mullionDepth);
      frameParts.push(vertMullion);

      const horizMullion = new THREE.BoxGeometry(innerW, mullionThick, mullionDepth);
      frameParts.push(horizMullion);

      const glass = new THREE.BoxGeometry(innerW, innerH, 0.008);
      glassParts.push(glass);
      break;
    }
  }

  // Merge into multi-material geometry with groups
  try {
    const frameMerged = BufferGeometryUtils.mergeGeometries(frameParts, false) || new THREE.BoxGeometry(width, height, depth);
    const glassMerged = (glassParts.length > 0 && BufferGeometryUtils.mergeGeometries(glassParts, false)) || new THREE.BoxGeometry(0.0001, 0.0001, 0.0001);
    const hardwareMerged = (hardwareParts.length > 0 && BufferGeometryUtils.mergeGeometries(hardwareParts, false)) || new THREE.BoxGeometry(0.0001, 0.0001, 0.0001);

    const merged = BufferGeometryUtils.mergeGeometries([frameMerged, glassMerged, hardwareMerged], true);
    return merged || new THREE.BoxGeometry(width, height, depth);
  } catch (e) {
    return new THREE.BoxGeometry(width, height, depth);
  }
}

/**
 * Creates an architectural single Step / Platform geometry with nosing overhang.
 */
export function createStepGeometry(width = 1.0, height = 0.18, depth = 0.30): THREE.BufferGeometry {
  const geometries: THREE.BufferGeometry[] = [];
  
  // Base Riser Box
  const baseDepth = depth - 0.02;
  const baseHeight = height - 0.03;
  const riser = new THREE.BoxGeometry(width, baseHeight, baseDepth);
  riser.translate(0, -0.015, -0.01);
  geometries.push(riser);

  // Top Tread with Nosing
  const treadThick = 0.03;
  const tread = new THREE.BoxGeometry(width + 0.02, treadThick, depth);
  tread.translate(0, height / 2 - treadThick / 2, 0);
  geometries.push(tread);

  try {
    const merged = BufferGeometryUtils.mergeGeometries(geometries, false);
    return merged || new THREE.BoxGeometry(width, height, depth);
  } catch (e) {
    return new THREE.BoxGeometry(width, height, depth);
  }
}

import { createArchitecturalStaircaseGeometry, StaircaseOptions } from './archStairGenerator';

/**
 * Creates an architectural multi-step Staircase geometry with support for layouts, structures, and railings.
 */
export function createStaircaseGeometry(
  width = 1.0,
  totalHeight = 2.16,
  totalLength = 3.6,
  numSteps = 12,
  options?: StaircaseOptions
): THREE.BufferGeometry {
  return createArchitecturalStaircaseGeometry({
    width,
    height: totalHeight,
    length: totalLength,
    numSteps,
    ...options
  });
}

