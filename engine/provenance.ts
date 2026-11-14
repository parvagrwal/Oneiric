import type { Grade } from './skyline.ts';

export const GRADE_MEANING: Record<Grade, string> = {
  A: 'terrain from a 5 m near-field raster',
  B: 'terrain from the 20 m near field',
  C: 'terrain from the 240 m product only',
  D: 'smooth sphere, no terrain',
};

/** Footer printed on every visual. Grade D never uses terrain wording. */
export function provenanceFooter(grade: Grade, terrain: string): string {
  const t = grade === 'D' ? 'none (smooth sphere)' : terrain;
  return `Ephemeris: JPL Horizons, MOON_ME · Terrain: ${t} · Grade ${grade}`;
}
