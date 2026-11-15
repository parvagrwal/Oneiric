// The selector's words are the user's only warning that a height has no terrain. These tests fix both halves of
// that warning: a missing height is offered and named, and the help line never calls a smooth sphere terrain.
import { describe, expect, it } from 'vitest';
import { heightHelpText, heightOptionLabel } from '../app/src/heights-ui.ts';

describe('observer height selector wording', () => {
  it('names a height that has terrain, with the site count and correct singular', () => {
    expect(heightOptionLabel({ heightM: 2, available: true, skylineCount: 24 })).toBe('2 m — terrain at 24 sites');
    expect(heightOptionLabel({ heightM: 10, available: true, skylineCount: 1 })).toBe('10 m — terrain at 1 site');
  });

  it('offers a height with no skyline and says it has none, instead of hiding it', () => {
    expect(heightOptionLabel({ heightM: 20, available: false, skylineCount: 0 })).toBe('20 m — no terrain skyline yet');
  });

  it('says the smooth sphere is what runs when the chosen height has no skyline', () => {
    expect(heightHelpText({ heightM: 10, available: false, skylineCount: 0 }, true, 10))
      .toBe('No skyline was built at 10 m: every site runs the smooth sphere at grade D');
  });

  it('never says terrain on its own for a height with no skyline', () => {
    const text = heightHelpText({ heightM: 0, available: false, skylineCount: 0 }, true, 0);
    expect(text).toMatch(/smooth sphere/);
    expect(text).toMatch(/grade D/);
  });

  it('says it is still listing heights before the index has loaded', () => {
    expect(heightHelpText(undefined, false, 2)).toBe('Listing heights…');
  });

  it('explains a height that has terrain but where some sites do not', () => {
    expect(heightHelpText({ heightM: 2, available: true, skylineCount: 24 }, true, 2))
      .toBe('Terrain horizon at this height; sites without one run at grade D');
  });
});
