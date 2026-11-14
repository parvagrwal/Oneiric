export type Vec3 = [number, number, number];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
/** Unit vector. Refuses a zero vector instead of silently returning NaNs. */
export function unit(a: Vec3): Vec3 {
  const n = norm(a);
  if (n === 0) throw new Error('cannot take the unit vector of a zero vector');
  return scale(a, 1 / n);
}
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
/** Angle between two vectors in degrees, stable for tiny angles. */
export function angleDeg(a: Vec3, b: Vec3): number {
  return (Math.atan2(norm(cross(a, b)), dot(a, b)) * 180) / Math.PI;
}
export const wrap360 = (deg: number) => ((deg % 360) + 360) % 360;
