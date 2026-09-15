// Firestore rejects any array whose elements are themselves arrays (e.g.
// the [number, number][] point-list fields - localWallPoly, localEavePoly,
// worldWallPoly - that archRoofGenerator.ts attaches to roofData/customData
// on L-shaped and general-polygon roofs) with "Nested arrays are not
// supported". cleanFirestoreDataForSave wraps such an array into a plain
// object (tagged with NESTED_ARRAY_MARKER) right before writing, and
// restoreFirestoreArraysAfterLoad reverses that on the way back out, so a
// roof shape's polygon data survives a Firestore round-trip instead of the
// whole save silently failing (previously, the ONLY sanitization was
// stripping `undefined` values - nested arrays were never handled, so any
// model containing such a roof failed to save with no nested-array handling
// at all).
const NESTED_ARRAY_MARKER = '__nestedArray';

export const cleanFirestoreDataForSave = (obj: any): any => {
  if (Array.isArray(obj)) {
    const cleaned = obj.map(cleanFirestoreDataForSave);
    if (cleaned.some(v => Array.isArray(v))) {
      const wrapped: Record<string, any> = { [NESTED_ARRAY_MARKER]: true };
      cleaned.forEach((v, i) => { wrapped[i] = v; });
      return wrapped;
    }
    return cleaned;
  }
  if (obj !== null && typeof obj === 'object') {
    return Object.entries(obj).reduce((acc: any, [key, value]) => {
      if (value !== undefined) acc[key] = cleanFirestoreDataForSave(value);
      return acc;
    }, {});
  }
  return obj;
};

export const restoreFirestoreArraysAfterLoad = (obj: any): any => {
  if (Array.isArray(obj)) return obj.map(restoreFirestoreArraysAfterLoad);
  if (obj !== null && typeof obj === 'object') {
    if (obj[NESTED_ARRAY_MARKER]) {
      const indices = Object.keys(obj)
        .filter(k => k !== NESTED_ARRAY_MARKER)
        .map(Number)
        .sort((a, b) => a - b);
      return indices.map(i => restoreFirestoreArraysAfterLoad(obj[i]));
    }
    return Object.entries(obj).reduce((acc: any, [key, value]) => {
      acc[key] = restoreFirestoreArraysAfterLoad(value);
      return acc;
    }, {});
  }
  return obj;
};
