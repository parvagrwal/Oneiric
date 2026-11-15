// Geometry for the 3D Moon view. Pure functions, no DOM and no rendering library, so they are unit-tested.
// The view is navigation and presentation only: nothing here feeds a verdict, a metric, or a grade.
import { DEG, type Vec3 } from '../../engine/index.ts';

/**
 * Scene axes are a cyclic relabelling of the MOON_ME axes, so handedness is kept:
 *   scene X = Moon +Y (90° E), scene Y = Moon +Z (north pole), scene Z = Moon +X (mean Earth direction).
 * With Y up, north is up and east is to the right when the near side faces the viewer.
 */
export function moonToScene(v: Vec3): Vec3 {
  return [v[1], v[2], v[0]];
}

/** Unit vector in MOON_ME for a latitude and an east-positive longitude, in degrees. */
export function latLonToMoon(latDeg: number, eLonDeg: number): Vec3 {
  const p = latDeg * DEG;
  const l = eLonDeg * DEG;
  return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
}

/** Scene position of a point on the unit sphere scaled to `radius`. */
export function latLonToScene(latDeg: number, eLonDeg: number, radius = 1): Vec3 {
  const s = moonToScene(latLonToMoon(latDeg, eLonDeg));
  return [s[0] * radius, s[1] * radius, s[2] * radius];
}

export interface SphereMesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

/**
 * Unit sphere whose texture coordinates are tied to latitude and longitude by construction:
 * u = (lon + 180) / 360 and v = (lat + 90) / 180, for an equirectangular map centred on 0° longitude
 * with north at the top. Site markers use the same `latLonToScene`, so markers and map cannot drift apart.
 */
export function buildMoonSphere(lonSegments = 96, latSegments = 48): SphereMesh {
  const cols = lonSegments + 1;
  const rows = latSegments + 1;
  const positions = new Float32Array(cols * rows * 3);
  const normals = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  for (let j = 0; j < rows; j++) {
    const lat = 90 - (j / latSegments) * 180;
    for (let i = 0; i < cols; i++) {
      const lon = -180 + (i / lonSegments) * 360;
      const p = latLonToScene(lat, lon);
      const k = j * cols + i;
      positions.set(p, k * 3);
      normals.set(p, k * 3);
      uvs[k * 2] = i / lonSegments;
      uvs[k * 2 + 1] = 1 - j / latSegments;
    }
  }
  const indices = new Uint32Array(lonSegments * latSegments * 6);
  let n = 0;
  for (let j = 0; j < latSegments; j++) {
    for (let i = 0; i < lonSegments; i++) {
      const a = j * cols + i;
      const b = a + cols;
      const c = a + 1;
      const d = b + 1;
      // Counter-clockwise seen from outside, so the outer face is the front face.
      indices[n++] = a; indices[n++] = b; indices[n++] = c;
      indices[n++] = c; indices[n++] = b; indices[n++] = d;
    }
  }
  return { positions, normals, uvs, indices };
}

export interface CameraPose {
  /** Camera latitude and east longitude over the Moon, degrees; the camera always looks at the Moon's centre. */
  latDeg: number;
  lonDeg: number;
  /** Distance from the Moon's centre in Moon radii. */
  distance: number;
}

/** Closest the camera may sit to either pole, so "up" on screen never becomes undefined. */
export const CAMERA_MAX_LAT_DEG = 84;

export const NEAR_SIDE_POSE: CameraPose = { latDeg: 8, lonDeg: 0, distance: 3.9 };
/** From below the south pole, 0° longitude (the Earth-facing side) at the top of the screen, as on polar maps. */
export const SOUTH_POLE_POSE: CameraPose = { latDeg: -CAMERA_MAX_LAT_DEG, lonDeg: 0, distance: 1.75 };

/** Camera pose that frames one site. Polar sites keep the polar-map orientation; others are viewed from overhead. */
export function poseForSite(latDeg: number, eLonDeg: number): CameraPose {
  if (Math.abs(latDeg) > 78) {
    return { latDeg: Math.sign(latDeg) * CAMERA_MAX_LAT_DEG, lonDeg: latDeg < 0 ? 0 : 180, distance: 1.55 };
  }
  return { latDeg: Math.max(-CAMERA_MAX_LAT_DEG, Math.min(CAMERA_MAX_LAT_DEG, latDeg)), lonDeg: eLonDeg, distance: 2.1 };
}

export function poseToScene(pose: CameraPose): Vec3 {
  return latLonToScene(pose.latDeg, pose.lonDeg, pose.distance);
}

/** True when a point at `point` (scene units, Moon radius 1) is hidden behind the Moon for a camera at `camera`. */
export function hiddenByMoon(point: Vec3, camera: Vec3): boolean {
  const d: Vec3 = [point[0] - camera[0], point[1] - camera[1], point[2] - camera[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len === 0) return false;
  const u: Vec3 = [d[0] / len, d[1] / len, d[2] / len];
  // Closest approach of the camera-to-point segment to the Moon's centre.
  const t = -(camera[0] * u[0] + camera[1] * u[1] + camera[2] * u[2]);
  if (t <= 0 || t >= len) return false;
  const cx = camera[0] + u[0] * t;
  const cy = camera[1] + u[1] * t;
  const cz = camera[2] + u[2] * t;
  return Math.hypot(cx, cy, cz) < 0.995;
}

/**
 * Flat chart position for the static (no WebGL) Moon visual: centred on the south pole, 0° longitude up and
 * 90° E to the right, the same orientation as the south-polar map. The radial scale is compressed with a square root
 * so the polar cluster stays readable; the chart is a schematic and is labelled as not to scale.
 * Returns x and y in the range -1..1.
 */
export function polarChartPoint(latDeg: number, eLonDeg: number): { x: number; y: number } {
  const r = Math.sqrt(Math.max(0, Math.min(180, latDeg + 90)) / 180);
  const l = eLonDeg * DEG;
  return { x: r * Math.sin(l), y: -r * Math.cos(l) };
}
