import { adaptPathToProfile, simplifyPaintStroke, simplifyPolylineRdp } from './path-layout.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot((b?.x ?? 0) - (a?.x ?? 0), (b?.z ?? 0) - (a?.z ?? 0));

function cleanPoints(points) {
  return (Array.isArray(points) ? points : []).flatMap(point => {
    const x = Number(point?.x), z = Number(point?.z);
    return Number.isFinite(x) && Number.isFinite(z) ? [{ x, z }] : [];
  });
}

function polylineLength(points) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) total += distance(points[index - 1], points[index]);
  return total;
}

function simplifyClosed(points, tolerance) {
  const ring = points.slice(0, -1);
  if (ring.length < 4) return points.map(point => ({ ...point }));
  let opposite = 1;
  for (let index = 2; index < ring.length; index += 1) {
    if (distance(ring[0], ring[index]) > distance(ring[0], ring[opposite])) opposite = index;
  }
  const first = simplifyPolylineRdp(ring.slice(0, opposite + 1), tolerance);
  const second = simplifyPolylineRdp([...ring.slice(opposite), ring[0]], tolerance);
  const simplified = [...first.slice(0, -1), ...second];
  simplified[simplified.length - 1] = { ...simplified[0] };
  return simplified;
}

/**
 * Uebersetzt eine gemalte Geste in eine Konstruktionslinie.
 *
 * Rohpunkte bleiben Eingabe, aber nicht jeder Pointer-Sample wird zu einem Spline-Knoten:
 * erst werden Jitter und redundante Samples entfernt, dann wird eine begrenzte
 * Kruemmungsanpassung auf der dichten Compilerlinie ausgefuehrt. Das verhindert die
 * typische Catmull-Rom-Schlangenlinie, ohne eine beabsichtigte breite Kurve geradezubuegeln.
 */
export function prepareConstructionCenterline(points, options = {}) {
  const widthM = Math.max(0.3, Number(options.widthM) || 1.1);
  const allowClosure = options.allowClosure === true;
  const raw = cleanPoints(points);
  if (raw.length < 2) {
    return { authoredPoints: raw, compilerReadyPoints: raw, closed: false, diagnostics: { raw: raw.length, anchors: raw.length, dense: raw.length, maximumOffsetM: 0 } };
  }

  const deduped = simplifyPaintStroke(raw, widthM).points;
  const total = polylineLength(deduped);
  const closureDistanceM = clamp(widthM * 0.28, 0.32, 0.72);
  const closed = allowClosure && total >= widthM * 5 && distance(deduped[0], deduped.at(-1)) <= closureDistanceM;
  const snapped = deduped.map(point => ({ ...point }));
  if (closed) snapped[snapped.length - 1] = { ...snapped[0] };

  // Rund zehn Prozent der Baubreite: gross genug gegen Handzittern, klein genug fuer
  // absichtlich gezogene Boegen. Die Obergrenze verhindert, dass sehr breite Bauten ihre
  // eigentliche Linienfuehrung verlieren.
  const toleranceM = clamp(widthM * 0.10, 0.08, 0.24);
  let authoredPoints = closed
    ? simplifyClosed(snapped, toleranceM)
    : simplifyPolylineRdp(snapped, toleranceM);
  if (authoredPoints.length < 2) authoredPoints = [snapped[0], snapped.at(-1)].map(point => ({ ...point }));

  const densify = typeof options.densify === 'function'
    ? options.densify
    : value => value.map(point => ({ ...point }));
  const intended = densify(authoredPoints);
  const adapted = intended.length >= 5
    ? adaptPathToProfile(intended, { width: widthM, strength: clamp(Number(options.assist) || 0.48, 0.25, 0.66) })
    : { points: intended.map(point => ({ ...point })), diagnostics: { maximumOffset: 0, adjustedSamples: 0, targetRadius: 0 } };
  const compilerReadyPoints = adapted.points.map(point => ({ x: point.x, z: point.z }));
  if (closed && compilerReadyPoints.length) compilerReadyPoints[compilerReadyPoints.length - 1] = { ...compilerReadyPoints[0] };

  return {
    authoredPoints: authoredPoints.map(point => ({ x: point.x, z: point.z })),
    compilerReadyPoints,
    closed,
    diagnostics: {
      raw: raw.length,
      deduped: deduped.length,
      anchors: authoredPoints.length,
      dense: compilerReadyPoints.length,
      toleranceM: Number(toleranceM.toFixed(3)),
      maximumOffsetM: Number((adapted.diagnostics?.maximumOffset || 0).toFixed(3)),
      adjustedSamples: adapted.diagnostics?.adjustedSamples || 0
    }
  };
}

export function constructionTangentRadiusM(widthM, targetBayM) {
  return clamp(Math.max(Number(widthM) * 0.34, Number(targetBayM) * 0.24), 0.55, 1.1);
}
