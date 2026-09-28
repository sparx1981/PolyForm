// Random parts of new object ids, from one place, so a step can be replayed with the same ids.
//
// A builder that makes several objects (a roof: its slopes, fascia, soffit, ridge cap...) asks
// for one random part per object. The action recorder captures the parts a tool used
// (captureShapeIds); the SDK command it writes runs the same builder with those parts
// (withShapeIds), so the replayed objects carry the same ids and later steps still find them.

const randomPart = () => Math.random().toString(36).substr(2, 9);

let supplied: string[] | null = null;
let captured: string[] | null = null;

/** A new random id part (9 base-36 characters), or the next supplied one while replaying. */
export function newShapeIdPart(): string {
  const part = supplied && supplied.length > 0 ? supplied.shift()! : randomPart();
  captured?.push(part);
  return part;
}

/** Runs `build` and returns what it made along with the id parts it used, in order. */
export function captureShapeIds<T>(build: () => T): { result: T; ids: string[] } {
  const outer = captured;
  const ids: string[] = [];
  captured = ids;
  try {
    return { result: build(), ids };
  } finally {
    captured = outer;
    outer?.push(...ids);
  }
}

/** Runs `build` giving it these id parts, in order (random ones once they run out). */
export function withShapeIds<T>(ids: readonly string[], build: () => T): T {
  const outer = supplied;
  supplied = [...ids];
  try {
    return build();
  } finally {
    supplied = outer;
  }
}
