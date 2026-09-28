/**
 * PolyForm — World View: national map grids the LiDAR services use.
 *
 *  - British National Grid (EPSG:27700), for England's Environment Agency LiDAR: WGS84 to OSGB36
 *    by the standard 7-parameter Helmert shift, then OS Transverse Mercator. Good to a few metres
 *    (the exact OSTN15 grid would need a large data file); the small offset left is removed when
 *    the LiDAR is lined up with the building outlines (see lidarSite.ts).
 *  - Dutch RD New (EPSG:28992), for AHN: the published approximation formulas (Schreutelkamp &
 *    Strang van Hees), good to about a metre.
 */

import type { LatLng } from './geo';

const DEG = Math.PI / 180;

interface Ellipsoid { a: number; b: number }
const WGS84: Ellipsoid = { a: 6378137, b: 6356752.314245 };
const AIRY1830: Ellipsoid = { a: 6377563.396, b: 6356256.909 };

function toCartesian(lat: number, lng: number, e: Ellipsoid): [number, number, number] {
  const e2 = 1 - (e.b * e.b) / (e.a * e.a);
  const phi = lat * DEG, lam = lng * DEG;
  const nu = e.a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  return [nu * Math.cos(phi) * Math.cos(lam), nu * Math.cos(phi) * Math.sin(lam), (1 - e2) * nu * Math.sin(phi)];
}

function fromCartesian([x, y, z]: [number, number, number], e: Ellipsoid): LatLng {
  const e2 = 1 - (e.b * e.b) / (e.a * e.a);
  const p = Math.hypot(x, y);
  let phi = Math.atan2(z, p * (1 - e2));
  for (let i = 0; i < 10; i++) {
    const nu = e.a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
    phi = Math.atan2(z + e2 * nu * Math.sin(phi), p);
  }
  return { lat: phi / DEG, lng: Math.atan2(y, x) / DEG };
}

/** WGS84 to OSGB36 latitude/longitude (Helmert, as the Ordnance Survey publishes it). */
export function wgs84ToOsgb36(p: LatLng): LatLng {
  const [x, y, z] = toCartesian(p.lat, p.lng, WGS84);
  const tx = -446.448, ty = 125.157, tz = -542.06;
  const s = 20.4894e-6;
  const sec = DEG / 3600;
  const rx = -0.1502 * sec, ry = -0.247 * sec, rz = -0.8421 * sec;
  const x2 = tx + (1 + s) * x - rz * y + ry * z;
  const y2 = ty + rz * x + (1 + s) * y - rx * z;
  const z2 = tz - ry * x + rx * y + (1 + s) * z;
  return fromCartesian([x2, y2, z2], AIRY1830);
}

/** OSGB36 latitude/longitude to National Grid easting and northing (OS Transverse Mercator). */
export function osgb36ToGrid(p: LatLng): { e: number; n: number } {
  const { a, b } = AIRY1830;
  const F0 = 0.9996012717, phi0 = 49 * DEG, lam0 = -2 * DEG, N0 = -100000, E0 = 400000;
  const e2 = 1 - (b * b) / (a * a), n = (a - b) / (a + b);
  const phi = p.lat * DEG, lam = p.lng * DEG;
  const sin = Math.sin(phi), cos = Math.cos(phi), tan = Math.tan(phi);
  const nu = (a * F0) / Math.sqrt(1 - e2 * sin * sin);
  const rho = (a * F0 * (1 - e2)) / Math.pow(1 - e2 * sin * sin, 1.5);
  const eta2 = nu / rho - 1;
  const dp = phi - phi0, sp = phi + phi0;
  const M = b * F0 * (
    (1 + n + (5 / 4) * n * n + (5 / 4) * n ** 3) * dp
    - (3 * n + 3 * n * n + (21 / 8) * n ** 3) * Math.sin(dp) * Math.cos(sp)
    + ((15 / 8) * n * n + (15 / 8) * n ** 3) * Math.sin(2 * dp) * Math.cos(2 * sp)
    - (35 / 24) * n ** 3 * Math.sin(3 * dp) * Math.cos(3 * sp));
  const I = M + N0;
  const II = (nu / 2) * sin * cos;
  const III = (nu / 24) * sin * cos ** 3 * (5 - tan * tan + 9 * eta2);
  const IIIA = (nu / 720) * sin * cos ** 5 * (61 - 58 * tan * tan + tan ** 4);
  const IV = nu * cos;
  const V = (nu / 6) * cos ** 3 * (nu / rho - tan * tan);
  const VI = (nu / 120) * cos ** 5 * (5 - 18 * tan * tan + tan ** 4 + 14 * eta2 - 58 * tan * tan * eta2);
  const dl = lam - lam0;
  return {
    n: I + II * dl ** 2 + III * dl ** 4 + IIIA * dl ** 6,
    e: E0 + IV * dl + V * dl ** 3 + VI * dl ** 5,
  };
}

/** WGS84 to British National Grid easting/northing (metres). */
export function toBritishGrid(p: LatLng): { e: number; n: number } {
  return osgb36ToGrid(wgs84ToOsgb36(p));
}

/** WGS84 to Dutch RD New x/y (metres). */
export function toDutchGrid(p: LatLng): { e: number; n: number } {
  const dp = 0.36 * (p.lat - 52.1551744);
  const dl = 0.36 * (p.lng - 5.38720621);
  const e = 155000
    + 190094.945 * dl + -11832.228 * dp * dl + -114.221 * dp * dp * dl + -32.391 * dl ** 3
    + -0.705 * dp + -2.34 * dp ** 3 * dl + -0.608 * dp * dl ** 3 + -0.008 * dl * dl + 0.148 * dp * dp * dl ** 3;
  const n = 463000
    + 309056.544 * dp + 3638.893 * dl * dl + 73.077 * dp * dp + -157.984 * dp * dl * dl + 59.788 * dp ** 3
    + 0.433 * dl + -6.439 * dp * dp * dl * dl + -0.032 * dp * dl + 0.092 * dl ** 4 + -0.054 * dp * dl ** 4;
  return { e, n };
}
