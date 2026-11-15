// The scripted 30-second tour: globe, site, skyline, verdict. Data only; the player lives in App.tsx.
// Captions describe what is on screen and never state a result: the engine computes the verdicts shown while the tour runs.

export type AutopilotCamera = 'near-side' | 'south-pole' | 'site';

export interface AutopilotStep {
  id: 'globe' | 'pole' | 'site' | 'skyline' | 'verdict';
  /** Seconds from the start of the tour. */
  atS: number;
  title: string;
  caption: string;
  camera?: AutopilotCamera;
  /** Where the page should be scrolled for this step. */
  scrollTo: 'hero' | 'board';
  /** Run the time-lapse through the stay during this step. */
  playTime: boolean;
  /** Days added to the landing date when the step starts. */
  slipDays?: number;
}

export const AUTOPILOT_TOTAL_S = 30;

/** The tour's scenario is the worked case in docs/worked-case.md: a point where a 21-day slip matters. */
export const AUTOPILOT_SCENARIO = {
  siteId: 'artemis-de-gerlache-rim-2-centroid',
  dateTime: '2028-09-05T00:00',
  presetId: 'sortie' as const,
  slipDays: 21,
};

export const AUTOPILOT_STEPS: AutopilotStep[] = [
  {
    id: 'globe',
    atS: 0,
    title: 'Globe',
    caption: 'Every site in the library on one Moon. Sun and Earth directions come from the cached JPL Horizons table.',
    camera: 'near-side',
    scrollTo: 'hero',
    playTime: true,
  },
  {
    id: 'pole',
    atS: 6,
    title: 'South pole',
    caption: 'At the south pole the Sun skims the horizon, so terrain decides. These sites carry skylines built from LOLA elevation data.',
    camera: 'south-pole',
    scrollTo: 'hero',
    playTime: true,
  },
  {
    id: 'site',
    atS: 12,
    title: 'Site',
    caption: 'Pick a site and a landing date. This is an illustrative point in an Artemis III candidate region, not a NASA-selected site.',
    camera: 'site',
    scrollTo: 'hero',
    playTime: false,
  },
  {
    id: 'skyline',
    atS: 17,
    title: 'Skyline',
    caption: 'The skyline view: Sun and Earth against the terrain horizon, hour by hour through the stay.',
    scrollTo: 'board',
    playTime: true,
  },
  {
    id: 'verdict',
    atS: 23,
    title: 'Verdict',
    caption: 'Now slip the landing by 21 days and read the verdict and the deciding rule again.',
    scrollTo: 'board',
    playTime: false,
    slipDays: 21,
  },
];

/** Index of the step that is active `elapsedS` seconds into the tour, or -1 once the tour is over. */
export function autopilotStepAt(elapsedS: number): number {
  if (!(elapsedS >= 0) || elapsedS >= AUTOPILOT_TOTAL_S) return -1;
  let index = 0;
  for (let i = 0; i < AUTOPILOT_STEPS.length; i++) {
    if (elapsedS >= AUTOPILOT_STEPS[i].atS) index = i;
  }
  return index;
}
