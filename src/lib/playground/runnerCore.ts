/**
 * The browser preview of the PolyForm `sdk` used by the Developers page.
 *
 * `RUNNER_CORE` is plain JavaScript kept as a string because it runs inside a Web Worker inside a
 * sandboxed iframe (see sandbox.ts): visitors' code never runs next to the page or its sign-in.
 * It draws with a small set of shapes (boxes, cylinders, spheres, roofs) and mirrors the signatures
 * of the real `sdk` for the calls it supports; anything else explains that it needs PolyForm itself.
 */

export type PlaygroundKind = 'box' | 'cylinder' | 'sphere' | 'roof';

export interface PlaygroundObject {
  id: string;
  kind: PlaygroundKind;
  position: [number, number, number];
  /** box/roof: [width, height, depth]; cylinder: [radius, height, radiusTop]; sphere: [radius, radius, radius]. */
  size: [number, number, number];
  rotationY: number;
  color: string;
  /** roofs only */
  roofType?: 'gable' | 'hip' | 'parapet';
}

export interface PlaygroundResult {
  ok: boolean;
  error?: string;
  logs: { level: 'log' | 'info' | 'warn' | 'error'; text: string }[];
  objects: PlaygroundObject[];
}

export const MAX_OBJECTS = 1500;

export const RUNNER_CORE = String.raw`
async function run(code) {
  var MAX_OBJECTS = ${MAX_OBJECTS}, MAX_LOGS = 200;
  var objects = [], logs = [], counter = 0;
  var num = function (v, d) { return typeof v === 'number' && isFinite(v) ? v : d; };
  var pos = function (v, d) { return Array.isArray(v) && v.length === 3 ? [num(v[0], d[0]), num(v[1], d[1]), num(v[2], d[2])] : d.slice(); };
  var color = function (v, d) { return typeof v === 'string' && /^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i.test(v.trim()) ? v.trim() : d; };
  var add = function (o) {
    if (objects.length >= MAX_OBJECTS) throw new Error('This preview draws up to ' + MAX_OBJECTS + ' objects.');
    var shape = Object.assign({ id: 'shape-' + (++counter), color: '#cbd5e1', rotationY: 0 }, o);
    objects.push(shape);
    return shape;
  };
  var find = function (target) {
    var id = target && typeof target === 'object' ? target.id : target;
    for (var i = 0; i < objects.length; i++) if (objects[i].id === id) return objects[i];
    throw new Error('No shape with id ' + id + ' in this preview.');
  };
  var box = function (w, h, d, p, c, rot) { return add({ kind: 'box', size: [Math.max(0.001, w), Math.max(0.001, h), Math.max(0.001, d)], position: p, color: c, rotationY: rot || 0 }); };

  var architecture = {
    createRoom: function (a) {
      a = a || {};
      var width = Math.max(1, num(a.width, 4)), length = Math.max(1, num(a.length, 4)), height = num(a.height, 2.8), t = num(a.wallThickness, 0.2);
      var p = pos(a.position, [0, 0, 0]), wc = color(a.wallColor, '#f1f5f9'), fc = color(a.floorColor, '#94a3b8');
      var roomId = 'room-' + (++counter), midY = p[1] + height / 2, hw = width / 2, hl = length / 2;
      var walls = [
        box(width, height, t, [p[0], midY, p[2] + hl], wc),
        box(width, height, t, [p[0], midY, p[2] - hl], wc),
        box(t, height, length - t * 2, [p[0] + hw, midY, p[2]], wc),
        box(t, height, length - t * 2, [p[0] - hw, midY, p[2]], wc)
      ];
      var out = { roomId: roomId, wallShapes: walls };
      if (a.includeFloor !== false) out.floorShape = box(width + 0.4, 0.2, length + 0.4, [p[0], p[1] - 0.1, p[2]], fc);
      if (a.includeCeiling) out.ceilingShape = box(width, 0.2, length, [p[0], p[1] + height + 0.1, p[2]], color(a.ceilingColor, '#e2e8f0'));
      return out;
    },
    createWall: function (a) {
      a = a || {};
      var height = num(a.height, 2.8), t = num(a.thickness, 0.2), c = color(a.color, '#f1f5f9');
      if (Array.isArray(a.start) && Array.isArray(a.end)) {
        var s = pos(a.start, [0, 0, 0]), e = pos(a.end, [1, 0, 0]);
        var dx = e[0] - s[0], dz = e[2] - s[2], len = Math.sqrt(dx * dx + dz * dz) || 0.1;
        return box(len, height, t, [(s[0] + e[0]) / 2, s[1] + height / 2, (s[2] + e[2]) / 2], c, -Math.atan2(dz, dx));
      }
      var p = pos(a.position, [0, height / 2, 0]);
      return box(num(a.length, 3), height, t, p, c, Array.isArray(a.rotation) ? num(a.rotation[1], 0) : 0);
    },
    createRoof: function (a) {
      a = a || {};
      var overhang = 0.3, width = num(a.width, 4) + overhang * 2, depth = num(a.depth, 4) + overhang * 2, type = a.roofType === 'hip' || a.roofType === 'parapet' ? a.roofType : 'gable';
      var ridge = typeof a.pitchAngleDeg === 'number' ? Math.tan(a.pitchAngleDeg * Math.PI / 180) * Math.min(width, depth) / 2 : num(a.ridgeHeight, 1.6);
      if (type === 'parapet') ridge = 0.3;
      var p = pos(a.position, [0, 2.8, 0]);
      return add({ kind: 'roof', roofType: type, size: [width, Math.max(0.05, ridge), depth], position: [p[0], p[1] + Math.max(0.05, ridge) / 2, p[2]], color: color(a.color, '#b45309') });
    },
    createStairs: function (a) {
      a = a || {};
      var width = num(a.width, 1), height = num(a.height, 2.8), length = num(a.length, 3.6), n = Math.max(2, Math.min(60, Math.round(num(a.numSteps, 14))));
      var p = pos(a.position, [0, 0, 0]), c = color(a.color, '#d6d3d1'), rise = height / n, run = length / n, steps = [];
      for (var i = 0; i < n; i++) steps.push(box(width, rise * (i + 1), run, [p[0], p[1] + rise * (i + 1) / 2, p[2] + run * (i + 0.5)], c));
      return { id: 'stairs-' + (++counter), steps: steps };
    },
    createDoor: function () { throw new Error('Doors and windows cut openings, which needs PolyForm itself. Try them in the app.'); },
    createWindow: function () { throw new Error('Doors and windows cut openings, which needs PolyForm itself. Try them in the app.'); }
  };

  var api = {
    createBox: function (a) { a = a || {}; return box(num(a.width, 1), num(a.height, 1), num(a.depth, 1), pos(a.position, [0, 0, 0]), color(a.color, '#ffffff')); },
    createCylinder: function (a) {
      a = a || {}; var r = Math.max(0.01, num(a.radius, 0.5)), h = Math.max(0.01, num(a.height, 1));
      return add({ kind: 'cylinder', size: [r, h, Math.max(0, num(a.radiusTop, r))], position: pos(a.position, [0, 0, 0]), color: '#ffffff' });
    },
    createSphere: function (a) { a = a || {}; var r = Math.max(0.01, num(a.radius, 0.5)); return add({ kind: 'sphere', size: [r, r, r], position: pos(a.position, [0, 0, 0]), color: '#ffffff' }); },
    applyColor: function (shape, c) { find(shape).color = color(c, '#cbd5e1'); },
    pushPull: function (shape, distance) { var s = find(shape); var d = num(distance, 0); s.size[1] = d; s.position[1] += d / 2; },
    clearScene: function () { objects.length = 0; },
    scene: { getStats: function () { return { shapeCount: objects.length }; } },
    architecture: architecture
  };
  api.createRoom = architecture.createRoom;
  api.createWall = architecture.createWall;

  var missing = function (path) {
    return new Proxy(function () {}, {
      apply: function () { throw new Error(path + ' is not available in this browser preview. It works in PolyForm itself.'); },
      get: function (t, key) { return typeof key === 'symbol' || key === 'then' ? undefined : missing(path + '.' + String(key)); }
    });
  };
  var guard = function (target, path) {
    return new Proxy(target, { get: function (t, key) {
      if (typeof key === 'symbol' || key === 'then') return t[key];
      if (key in t) return t[key];
      return missing(path + '.' + String(key));
    } });
  };
  api.architecture = guard(architecture, 'sdk.architecture');
  var sdk = guard(api, 'sdk');

  var text = function (args) {
    return Array.prototype.map.call(args, function (v) {
      if (typeof v === 'string') return v;
      try { return JSON.stringify(v, null, typeof v === 'object' && v && JSON.stringify(v).length > 60 ? 2 : 0); } catch (e) { return String(v); }
    }).join(' ');
  };
  var logger = function (level) { return function () { if (logs.length < MAX_LOGS) logs.push({ level: level, text: text(arguments) }); }; };
  var fakeConsole = { log: logger('log'), info: logger('info'), warn: logger('warn'), error: logger('error') };

  try {
    var AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    await new AsyncFunction('sdk', 'console', String(code))(sdk, fakeConsole);
    return { ok: true, logs: logs, objects: objects };
  } catch (err) {
    return { ok: false, error: err && err.message ? String(err.message) : String(err), logs: logs, objects: objects };
  }
}
`;

/** Runs code with the preview sdk in this thread. For tests and tooling only: pages use sandbox.ts. */
export function createLocalRunner(): (code: string) => Promise<PlaygroundResult> {
  return new Function(`${RUNNER_CORE}; return run;`)() as (code: string) => Promise<PlaygroundResult>;
}
