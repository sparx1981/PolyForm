const EPSILON = 1e-6;

export function simplifyPaintStroke(points, width = 0.72) {
  const result = [];
  let removedPoints = 0;
  for (const point of points) {
    if (result.length && distance(point, result.at(-1)) < Math.max(0.025, width * 0.045)) {
      removedPoints += 1;
      continue;
    }
    result.push({ x: point.x, z: point.z });
  }
  return { points: result, removedPoints };
}

export function simplifyPolylineRdp(points, tolerance = 0.04) {
  if (!Array.isArray(points) || points.length <= 2) return (points || []).map(point => ({ ...point }));
  let maximumDistance = 0;
  let splitIndex = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distanceToSegment = pointSegmentDistance(points[index], points[0], points[points.length - 1]);
    if (distanceToSegment > maximumDistance) {
      maximumDistance = distanceToSegment;
      splitIndex = index;
    }
  }
  if (maximumDistance <= tolerance) return [{ ...points[0] }, { ...points[points.length - 1] }];
  const left = simplifyPolylineRdp(points.slice(0, splitIndex + 1), tolerance);
  const right = simplifyPolylineRdp(points.slice(splitIndex), tolerance);
  return [...left.slice(0, -1), ...right];
}

export function adaptPathToProfile(points, options = {}) {
  const width = options.width ?? 0.72;
  const strength = clamp(options.strength ?? 0.78, 0, 1);
  const iterations = Math.round(2 + strength * 7);
  const targetRadius = width * (0.52 + strength * 0.34);
  const maxOffset = width * (0.28 + strength * 0.42);
  const original = points.map(point => ({ ...point }));
  let adapted = original.map(point => ({ ...point }));
  let adjustedSamples = 0;
  for (let pass = 0; pass < iterations; pass += 1) {
    const next = adapted.map(point => ({ ...point }));
    for (let index = 2; index < adapted.length - 2; index += 1) {
      const a = adapted[index - 2]; const b = adapted[index]; const c = adapted[index + 2];
      const radius = circumradius(a, b, c);
      if (radius >= targetRadius) continue;
      const average = mix(adapted[index - 1], adapted[index + 1], 0.5);
      const pressure = clamp(1 - radius / targetRadius, 0, 1) * strength * 0.62;
      let candidate = mix(adapted[index], average, pressure);
      const offset = subtract(candidate, original[index]);
      const offsetLength = Math.hypot(offset.x, offset.z);
      if (offsetLength > maxOffset) candidate = add(original[index], scale(offset, maxOffset / offsetLength));
      next[index] = candidate;
      adjustedSamples += 1;
    }
    adapted = next;
  }
  let maximumOffset = 0;
  for (let index = 0; index < adapted.length; index += 1) maximumOffset = Math.max(maximumOffset, distance(adapted[index], original[index]));
  return { points: adapted, original, diagnostics: { adjustedSamples, maximumOffset, targetRadius } };
}

// Kosinus des Winkels zwischen zwei Strecken, ohne Richtungssinn: Hin- und Rueckweg
// eines Striches gelten als parallel.
function cosBetween(a1, a2, b1, b2) {
  const ax = a2.x - a1.x;
  const az = a2.z - a1.z;
  const bx = b2.x - b1.x;
  const bz = b2.z - b1.z;
  const laengeA = Math.hypot(ax, az);
  const laengeB = Math.hypot(bx, bz);
  if (laengeA < EPSILON || laengeB < EPSILON) return 1;
  return (ax * bx + az * bz) / (laengeA * laengeB);
}

// 30 Grad. Darunter beruehren sich zwei Aeste, darueber kreuzen sie sich.
const TANGENT_COS = Math.cos(30 * Math.PI / 180);

export function buildSemanticNetwork(points, options = {}) {
  const snap = options.snap ?? 0.035;
  const width = options.width ?? 0.72;
  const clean = simplifyPaintStroke(points, options.width ?? 0.72).points;
  if (clean.length < 2) return { nodes: [], edges: [], intersections: [], diagnostics: { crossings: 0 } };
  const cuts = Array.from({ length: clean.length - 1 }, () => []);
  const intersections = [];
  for (let i = 0; i < clean.length - 1; i += 1) {
    for (let j = i + 2; j < clean.length - 1; j += 1) {
      if (i === 0 && j === clean.length - 2 && distance(clean[0], clean.at(-1)) < snap) continue;
      const hit = segmentIntersection(clean[i], clean[i + 1], clean[j], clean[j + 1]);
      if (!hit || hit.t < 0.015 || hit.t > 0.985 || hit.u < 0.015 || hit.u > 0.985) continue;
      const id = `junction-${intersections.length}`;
      cuts[i].push({ t: hit.t, point: hit.point, id });
      cuts[j].push({ t: hit.u, point: hit.point, id });
      intersections.push({ ...hit.point, id, segments: [i, j] });
    }
  }

  if (options.proximityJunctions !== false) {
    const arc = createArcTable(clean).lengths;
    const candidates = [];
    for (let i = 0; i < clean.length - 1; i += 1) {
      for (let j = i + 2; j < clean.length - 1; j += 1) {
        const hit = closestSegmentApproach(clean[i], clean[i + 1], clean[j], clean[j + 1]);
        if (!(hit.distance < width * 0.58 && hit.t > 0.03 && hit.t < 0.97 && hit.u > 0.03 && hit.u < 0.97)) continue;
        // NAH IST NICHT GLEICH KREUZEND.
        //
        // Der Abstand allein sagt nur, dass sich zwei Stellen des Striches beruehren -
        // nicht, ob sie sich kreuzen. Zwei fast parallel nebeneinander herlaufende Aeste
        // sind ueber ihre ganze Laenge nah beieinander, und der Reihe nach entstand hier
        // an jedem zweiten Stuetzpunkt eine Knotenplatte. Gemessen an einer U-Wende mit
        // 0,34 m Abstand: drei Knoten auf drei Metern, dazu die weiter uebereinander
        // liegenden Platten - der Knoten hat die Ueberdeckung nicht aufgeloest, sondern
        // nur einen Klotz daraufgesetzt.
        //
        // Ein Knoten ergibt nur Sinn, wo die beiden Aeste WEGGEHEN, also bei einem
        // deutlichen Winkel. Unter 30 Grad ist es keine Kreuzung, sondern eine Faltung -
        // die wird eine Ebene hoeher durch Kuerzen des spaeteren Astes aufgeloest.
        if (Math.abs(cosBetween(clean[i], clean[i + 1], clean[j], clean[j + 1])) > TANGENT_COS) continue;
        candidates.push({ ...hit, i, j });
      }
    }
    candidates.sort((a,b) => a.distance - b.distance);
    for (const candidate of candidates) {
      const point = mix(candidate.a, candidate.b, 0.5);
      if (intersections.some(existing => distance(existing, point) < width * 1.35)) continue;
      const id = `junction-${intersections.length}`;
      cuts[candidate.i].push({ t: candidate.t, point, id });
      cuts[candidate.j].push({ t: candidate.u, point, id });
      intersections.push({ ...point, id, segments: [candidate.i,candidate.j], kind: 'proximity', gap: candidate.distance });
    }
  }

  const augmented = [];
  for (let index = 0; index < clean.length - 1; index += 1) {
    if (index === 0) augmented.push({ point: clean[0], marker: 'start' });
    for (const cut of cuts[index].sort((a, b) => a.t - b.t)) augmented.push({ point: cut.point, marker: cut.id });
    augmented.push({ point: clean[index + 1], marker: index === clean.length - 2 ? 'end' : null });
  }

  const nodeMap = new Map();
  const nodeFor = (entry) => {
    const marker = entry.marker || `point-${entry.point.x.toFixed(4)}-${entry.point.z.toFixed(4)}`;
    const key = marker.startsWith('junction') ? marker : `${Math.round(entry.point.x / snap)}:${Math.round(entry.point.z / snap)}`;
    if (!nodeMap.has(key)) nodeMap.set(key, { id: key, x: entry.point.x, z: entry.point.z, kind: marker.startsWith('junction') ? 'junction' : 'endpoint', degree: 0 });
    return nodeMap.get(key);
  };

  const edges = [];
  let edgePoints = [augmented[0].point];
  let startNode = nodeFor(augmented[0]);
  for (let index = 1; index < augmented.length; index += 1) {
    const entry = augmented[index];
    if (distance(edgePoints.at(-1), entry.point) > EPSILON) edgePoints.push(entry.point);
    if (!entry.marker) continue;
    const endNode = nodeFor(entry);
    if (edgePoints.length > 1 && polylineLength(edgePoints) > snap) {
      edges.push({ id: `edge-${edges.length}`, startNode: startNode.id, endNode: endNode.id, points: edgePoints.map(point => ({ ...point })), length: polylineLength(edgePoints) });
      startNode.degree += 1;
      endNode.degree += 1;
    }
    startNode = endNode;
    edgePoints = [entry.point];
  }
  const nodes = [...nodeMap.values()];
  return { nodes, edges, intersections, diagnostics: { crossings: intersections.filter(item => item.kind !== 'proximity').length, proximityJunctions: intersections.filter(item => item.kind === 'proximity').length, nodes: nodes.length, edges: edges.length } };
}

export function trimPolyline(points, startDistance = 0, endDistance = 0) {
  const table = createArcTable(points);
  if (table.totalLength <= startDistance + endDistance + 0.04) return [];
  const result = [sampleArc(table, startDistance)];
  for (let i = 1; i < table.points.length - 1; i += 1) {
    if (table.lengths[i] > startDistance && table.lengths[i] < table.totalLength - endDistance) result.push(table.points[i]);
  }
  result.push(sampleArc(table, table.totalLength - endDistance));
  return result;
}

export function createArcTable(points) {
  const clean = points.filter((point, index) => index === 0 || distance(point, points[index - 1]) > EPSILON);
  const lengths = [0];
  for (let index = 1; index < clean.length; index += 1) lengths.push(lengths[index - 1] + distance(clean[index], clean[index - 1]));
  return { points: clean, lengths, totalLength: lengths.at(-1) || 0 };
}

export function sampleArc(table, distanceAlong) {
  if (table.points.length === 1) return table.points[0];
  const s = clamp(distanceAlong, 0, table.totalLength);
  let high = table.lengths.findIndex(length => length >= s);
  if (high <= 0) high = 1;
  const low = high - 1;
  const span = Math.max(EPSILON, table.lengths[high] - table.lengths[low]);
  return mix(table.points[low], table.points[high], (s - table.lengths[low]) / span);
}

export function tangentArc(table, distanceAlong, probe = 0.035) {
  return normalize(subtract(sampleArc(table, distanceAlong + probe), sampleArc(table, distanceAlong - probe)));
}

export function resamplePolyline(points, spacing = 0.25) {
  const table = createArcTable(points);
  const count = Math.max(1, Math.ceil(table.totalLength / spacing));
  return Array.from({ length: count + 1 }, (_, index) => sampleArc(table, table.totalLength * index / count));
}

export function layoutPavers(points, options = {}) {
  const settings = { width: options.width ?? 0.72, targetLength: options.targetLength ?? 1.05, minLength: options.minLength ?? 0.24, gap: options.gap ?? 0.025, maxTurnDeg: options.maxTurnDeg ?? 11 };
  const table = createArcTable(points);
  const pavers = [];
  let cursor = 0;
  let guard = 0;
  while (cursor < table.totalLength - settings.gap && guard++ < 4000) {
    let span = Math.min(settings.targetLength, table.totalLength - cursor);
    while (span > settings.minLength + EPSILON && headingDelta(table, cursor, cursor + span) > settings.maxTurnDeg) span = Math.max(settings.minLength, span * 0.78);
    const start = cursor + settings.gap * 0.5;
    const end = Math.min(table.totalLength, cursor + span - settings.gap * 0.5);
    if (end - start < settings.gap) break;
    const a = crossSection(table, start, settings.width);
    const b = crossSection(table, end, settings.width);
    let corners = [a.left, b.left, b.right, a.right];
    const signedArea = polygonArea(corners);
    if (signedArea < 0) corners = corners.reverse();
    const turnDeg = headingDelta(table, start, end);
    pavers.push({ corners, length: end - start, turnDeg, area: Math.abs(signedArea), start, end, kind: turnDeg > 2 ? 'cut' : 'straight' });
    cursor += span;
  }
  return { pavers, table, diagnostics: { adjacentOverlaps: countAdjacentOverlaps(pavers), degenerateCount: pavers.filter(p => p.area < settings.width * 0.05).length, maxTurnDeg: pavers.reduce((m, p) => Math.max(m, p.turnDeg), 0), straightCount: pavers.filter(p => p.kind === 'straight').length, cutCount: pavers.filter(p => p.kind === 'cut').length } };
}

export function planProfiles(network, options = {}) {
  const width = options.width ?? 0.72;
  const junctionRadius = width * (options.junctionScale ?? 0.72);
  const nodes = new Map(network.nodes.map(node => [node.id, node]));
  const edges = network.edges.map(edge => {
    const start = nodes.get(edge.startNode);
    const end = nodes.get(edge.endNode);
    const points = trimPolyline(edge.points, start?.degree > 2 ? junctionRadius : 0, end?.degree > 2 ? junctionRadius : 0);
    return { ...edge, points, trimmed: points.length > 1 };
  }).filter(edge => edge.trimmed);
  const junctions = network.nodes.filter(node => node.degree > 2).map(node => ({ ...node, radius: junctionRadius }));
  return { nodes: network.nodes, edges, junctions, diagnostics: { ...network.diagnostics, junctions: junctions.length } };
}


function segmentIntersection(a, b, c, d) {
  const r = subtract(b, a); const s = subtract(d, c); const denominator = cross(r, s);
  if (Math.abs(denominator) < EPSILON) return null;
  const q = subtract(c, a); const t = cross(q, s) / denominator; const u = cross(q, r) / denominator;
  if (t <= EPSILON || t >= 1 - EPSILON || u <= EPSILON || u >= 1 - EPSILON) return null;
  return { t, u, point: { x: a.x + r.x * t, z: a.z + r.z * t } };
}
export function closestSegmentApproach(a,b,c,d){
  const ux=b.x-a.x, uz=b.z-a.z, vx=d.x-c.x, vz=d.z-c.z, wx=a.x-c.x, wz=a.z-c.z;
  const A=ux*ux+uz*uz, B=ux*vx+uz*vz, C=vx*vx+vz*vz, D=ux*wx+uz*wz, E=vx*wx+vz*wz;
  const denominator=A*C-B*B;
  if(denominator<EPSILON&&A>EPSILON&&C>EPSILON){
    const tc0=((c.x-a.x)*ux+(c.z-a.z)*uz)/A,tc1=((d.x-a.x)*ux+(d.z-a.z)*uz)/A;
    const overlapMin=Math.max(0,Math.min(tc0,tc1)),overlapMax=Math.min(1,Math.max(tc0,tc1));
    if(overlapMax>overlapMin+EPSILON){const t=(overlapMin+overlapMax)*.5;const pa={x:a.x+ux*t,z:a.z+uz*t};const u=clamp(((pa.x-c.x)*vx+(pa.z-c.z)*vz)/C,0,1);const pb={x:c.x+vx*u,z:c.z+vz*u};return{t,u,a:pa,b:pb,distance:distance(pa,pb)};}
  }
  let t=denominator<EPSILON?0:clamp((B*E-C*D)/denominator,0,1);
  let u=C<EPSILON?0:clamp((B*t+E)/C,0,1);
  t=A<EPSILON?0:clamp((B*u-D)/A,0,1);
  const pa={x:a.x+ux*t,z:a.z+uz*t}, pb={x:c.x+vx*u,z:c.z+vz*u};
  return {t,u,a:pa,b:pb,distance:distance(pa,pb)};
}
function crossSection(table, s, width) { const center = sampleArc(table, s); const tangent = tangentArc(table, s); const normal = { x: -tangent.z, z: tangent.x }; const half = width * 0.5; return { center, left: add(center, scale(normal, half)), right: add(center, scale(normal, -half)) }; }
function headingDelta(table, start, end) { const a = tangentArc(table, start); const b = tangentArc(table, end); return Math.acos(clamp(a.x * b.x + a.z * b.z, -1, 1)) * 180 / Math.PI; }
function circumradius(a,b,c){const ab=distance(a,b),bc=distance(b,c),ca=distance(c,a);const twice=Math.abs(cross(subtract(b,a),subtract(c,a)));return twice<EPSILON?Infinity:(ab*bc*ca)/(2*twice);}
function countAdjacentOverlaps(pavers) { let count = 0; for (let i = 1; i < pavers.length; i += 1) if (polygonsOverlap(pavers[i - 1].corners, pavers[i].corners)) count += 1; return count; }
function polygonsOverlap(a, b) { for (const polygon of [a, b]) for (let i = 0; i < polygon.length; i += 1) { const edge = subtract(polygon[(i + 1) % polygon.length], polygon[i]); const axis = normalize({ x: -edge.z, z: edge.x }); const ar = project(a, axis); const br = project(b, axis); if (ar.max <= br.min + EPSILON || br.max <= ar.min + EPSILON) return false; } return true; }
function project(points, axis) { const values = points.map(p => p.x * axis.x + p.z * axis.z); return { min: Math.min(...values), max: Math.max(...values) }; }
function pointSegmentDistance(point,a,b){const ab=subtract(b,a),lengthSquared=ab.x*ab.x+ab.z*ab.z;if(lengthSquared<EPSILON)return distance(point,a);const t=clamp(((point.x-a.x)*ab.x+(point.z-a.z)*ab.z)/lengthSquared,0,1);return distance(point,add(a,scale(ab,t)));}
function polygonArea(points) { return points.reduce((sum, p, i) => { const n = points[(i + 1) % points.length]; return sum + p.x * n.z - n.x * p.z; }, 0) * 0.5; }
function polylineLength(points) { let length = 0; for (let i = 1; i < points.length; i += 1) length += distance(points[i - 1], points[i]); return length; }
function distance(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
function add(a, b) { return { x: a.x + b.x, z: a.z + b.z }; }
function subtract(a, b) { return { x: a.x - b.x, z: a.z - b.z }; }
function scale(a, amount) { return { x: a.x * amount, z: a.z * amount }; }
function mix(a, b, t) { return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }; }
function normalize(v) { const length = Math.hypot(v.x, v.z) || 1; return { x: v.x / length, z: v.z / length }; }
function cross(a, b) { return a.x * b.z - a.z * b.x; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
