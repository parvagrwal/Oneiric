// The words the observer-height selector shows, kept out of the component so they can be tested directly.
//
// Two rules are fixed here. A height with no stored skyline is offered and labelled as such; it is never hidden
// and never described as terrain. And the help line states, for the height on screen, whether any site will show
// a terrain horizon at all, so a user cannot read a smooth-sphere result as a terrain one.
import type { HeightOption } from '../../engine/index.ts';

/** One line in the height selector, for example "10 m — terrain at 24 sites". */
export function heightOptionLabel(option: HeightOption): string {
  if (!option.available) return `${option.heightM} m — no terrain skyline yet`;
  const noun = option.skylineCount === 1 ? 'site' : 'sites';
  return `${option.heightM} m — terrain at ${option.skylineCount} ${noun}`;
}

/** The note under the selector. Says what this height will do, before the user picks a site. */
export function heightHelpText(option: HeightOption | undefined, ready: boolean, heightM: number): string {
  if (!ready) return 'Listing heights…';
  if (option?.available) return 'Terrain horizon at this height; sites without one run at grade D';
  return `No skyline was built at ${heightM} m: every site runs the smooth sphere at grade D`;
}
