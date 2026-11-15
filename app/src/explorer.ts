// Explorer mode: five guided scenes, each one a preset URL state on the same views the planner uses.
//
// A scene carries no result. It sets a site, a date and a preset, and the engine computes whatever the screen then
// shows. A caption describes what to look at and never states a verdict, because the verdict belongs to the engine
// and to the date on screen, not to a caption written by hand.
import type { AppUrlState } from './url-state.ts';

export interface ExplorerScene {
  id: 'sun-goes-sideways' | 'skyline-is-a-calendar' | 'earth-nods' | 'move-100-m' | 'your-turn';
  title: string;
  /** What to look at, in two sentences at most. Never a result. */
  caption: string;
  /** The URL state the scene applies. A partial state is merged over the current one. */
  state: Partial<AppUrlState>;
  /** Section of the page the scene scrolls to. */
  scrollTo: 'board' | 'windows' | 'map';
  /** Where the reader can read more, when a partner or dataset page is relevant. */
  link?: { href: string; text: string };
}

export const EXPLORER_SCENES: ExplorerScene[] = [
  {
    id: 'sun-goes-sideways',
    title: 'The Sun goes sideways',
    caption:
      'Near the south pole the Sun does not rise and set. It slides around the horizon, so the terrain in one direction decides a whole day: watch the Sun ribbon in the skyline view stay low while its azimuth sweeps across the stay.',
    state: { presetId: 'sortie', stayDays: 6.5, heightM: 2, dateTime: '2027-03-01T00:00', cards: [{ siteId: 'connecting-ridge' }] },
    scrollTo: 'board',
  },
  {
    id: 'skyline-is-a-calendar',
    title: 'The skyline is a calendar',
    caption:
      'Read the terrain horizon as a calendar. Where a ridge stands above the Sun\'s path, those hours are dark; the same ridge with the Sun at a different date may not block it at all.',
    state: { presetId: 'sortie', stayDays: 6.5, heightM: 10, dateTime: '2027-03-01T00:00', cards: [{ siteId: 'connecting-ridge' }] },
    scrollTo: 'board',
  },
  {
    id: 'earth-nods',
    title: 'Earth nods',
    caption:
      'Earth never sets at the pole the way the Sun does, but libration walks it around a small box in the sky, roughly 16° wide and 13° tall. Its true-size disc has to clear the terrain horizon in that direction for the link to be open.',
    state: { presetId: 'lander', stayDays: 14, heightM: 2, dateTime: '2027-09-01T00:00', cards: [{ siteId: 'shackleton-rim' }] },
    scrollTo: 'board',
  },
  {
    id: 'move-100-m',
    title: 'Move 100 m, or wait three weeks',
    caption:
      'Two levers move the answer: where you land by a hundred metres, and when you land by three weeks. Use the landing-error and slip readouts on the card, then open the Window Finder to see the same site across a year of landing dates.',
    state: { presetId: 'sortie', stayDays: 6.5, heightM: 10, dateTime: '2028-09-05T00:00', cards: [{ siteId: 'artemis-de-gerlache-rim-2-centroid' }, { siteId: 'artemis-de-gerlache-rim-2-highest' }] },
    scrollTo: 'windows',
  },
  {
    id: 'your-turn',
    title: 'Your turn',
    caption:
      'Pick a site and a date and try to find a 6.5-day sortie with a high sunlit share and an unbroken link. The rules are editable and every preset is illustrative, not an agency requirement.',
    state: { presetId: 'sortie', stayDays: 6.5, heightM: 2, dateTime: '2028-03-01T00:00' },
    scrollTo: 'windows',
    link: { href: 'https://www.asc-csa.gc.ca/eng/astronomy/moon-exploration/', text: 'Canadian Space Agency: Moon exploration' },
  },
];

/** The next scene in the list, wrapping to the first. */
export const nextScene = (id: ExplorerScene['id']): ExplorerScene => {
  const i = EXPLORER_SCENES.findIndex((s) => s.id === id);
  return EXPLORER_SCENES[(i + 1) % EXPLORER_SCENES.length];
};

/** The scene at an index, for arrow-key navigation. Clamped, never wrapped, so the ends are visible. */
export const sceneAt = (index: number): ExplorerScene =>
  EXPLORER_SCENES[Math.max(0, Math.min(EXPLORER_SCENES.length - 1, index))];

/** Merge a scene's state over the current state, keeping every field the scene does not set. */
export function applyScene(current: AppUrlState, scene: ExplorerScene): AppUrlState {
  return { ...current, ...scene.state };
}
