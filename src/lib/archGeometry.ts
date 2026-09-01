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

  // Generate 3D Cladding Battens / Boards / Grooves on exterior and facade faces
  const claddingGeoms: THREE.BufferGeometry[] = [baseGeom];
  const zOffsets = [
    { z: thickness / 2 + 0.010, rotSign: 1 },
    { z: -thickness / 2 - 0.010, rotSign: -1 }
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
      // Palladian / Arch Top Window
      const archH = innerH * 0.35;
      const lowerH = innerH - archH;

      // Lower horizontal meeting bar
      const meetingBar = new THREE.BoxGeometry(innerW, 0.03, mullionDepth);
      meetingBar.translate(0, innerH / 2 - archH, 0);
      frameParts.push(meetingBar);

      // Lower center mullion
      const lowerMullion = new THREE.BoxGeometry(0.025, lowerH, mullionDepth);
      lowerMullion.translate(0, -archH / 2, 0);
      frameParts.push(lowerMullion);

      // Radial sunburst upper muntins
      const radial1 = new THREE.BoxGeometry(0.02, archH, mullionDepth * 0.8);
      radial1.rotateZ(Math.PI / 4);
      radial1.translate(-innerW / 6, innerH / 2 - archH / 2, 0);
      frameParts.push(radial1);

      const radial2 = new THREE.BoxGeometry(0.02, archH, mullionDepth * 0.8);
      radial2.rotateZ(-Math.PI / 4);
      radial2.translate(innerW / 6, innerH / 2 - archH / 2, 0);
      frameParts.push(radial2);

      const glass = new THREE.BoxGeometry(innerW, innerH, 0.008);
      glassParts.push(glass);
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

