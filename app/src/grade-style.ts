import type { Grade } from '../../engine/index.ts';

/** Marker colour per terrain fidelity grade, shared by the 3D view, the static chart, and their legend. */
export function gradeColor(grade: Grade | undefined): string {
  if (grade === 'B') return '#5fd4e6';
  if (grade === 'C') return '#f7c948';
  return '#b9c4d4';
}

export const GRADE_LEGEND: Array<{ grade: Grade; text: string }> = [
  { grade: 'B', text: 'terrain, LOLA 20 m near field' },
  { grade: 'C', text: 'terrain, LOLA 240 m only' },
  { grade: 'D', text: 'smooth sphere, no terrain' },
];
