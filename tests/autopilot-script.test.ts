import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AUTOPILOT_SCENARIO,
  AUTOPILOT_STEPS,
  AUTOPILOT_TOTAL_S,
  autopilotStepAt,
} from '../app/src/autopilot-script.ts';
import { EPHEMERIS_FIRST_YEAR, EPHEMERIS_LAST_YEAR } from '../app/src/coverage.ts';
import { MAX_DATE_UTC, MIN_DATE_UTC } from '../app/src/url-state.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('scripted tour', () => {
  it('runs for 30 seconds, starts at zero, and its steps are in time order', () => {
    expect(AUTOPILOT_TOTAL_S).toBe(30);
    expect(AUTOPILOT_STEPS[0].atS).toBe(0);
    for (let i = 1; i < AUTOPILOT_STEPS.length; i++) {
      expect(AUTOPILOT_STEPS[i].atS).toBeGreaterThan(AUTOPILOT_STEPS[i - 1].atS);
    }
    expect(AUTOPILOT_STEPS[AUTOPILOT_STEPS.length - 1].atS).toBeLessThan(AUTOPILOT_TOTAL_S);
  });

  it('visits the globe, a site, the skyline, and the verdict, in that order', () => {
    const ids = AUTOPILOT_STEPS.map((step) => step.id);
    expect(ids.indexOf('globe')).toBe(0);
    expect(ids.indexOf('site')).toBeGreaterThan(ids.indexOf('globe'));
    expect(ids.indexOf('skyline')).toBeGreaterThan(ids.indexOf('site'));
    expect(ids.indexOf('verdict')).toBeGreaterThan(ids.indexOf('skyline'));
  });

  it('picks the step for the elapsed time and ends at 30 seconds', () => {
    expect(autopilotStepAt(0)).toBe(0);
    expect(autopilotStepAt(AUTOPILOT_STEPS[1].atS - 0.01)).toBe(0);
    expect(autopilotStepAt(AUTOPILOT_STEPS[1].atS)).toBe(1);
    expect(autopilotStepAt(AUTOPILOT_TOTAL_S - 0.01)).toBe(AUTOPILOT_STEPS.length - 1);
    expect(autopilotStepAt(AUTOPILOT_TOTAL_S)).toBe(-1);
    expect(autopilotStepAt(-1)).toBe(-1);
    expect(autopilotStepAt(Number.NaN)).toBe(-1);
  });

  it('uses a site that is in the library and a date the date picker accepts, before and after the slip', () => {
    const parsed = JSON.parse(read('../app/public/data/sites.json')) as { sites?: Array<{ id: string }> } | Array<{ id: string }>;
    const sites = Array.isArray(parsed) ? parsed : (parsed.sites ?? []);
    expect(sites.some((site) => site.id === AUTOPILOT_SCENARIO.siteId)).toBe(true);
    const startMs = Date.parse(`${AUTOPILOT_SCENARIO.dateTime}:00Z`);
    const slippedMs = startMs + AUTOPILOT_SCENARIO.slipDays * 86_400_000;
    expect(startMs).toBeGreaterThanOrEqual(Date.parse(`${MIN_DATE_UTC}:00Z`));
    expect(slippedMs).toBeLessThanOrEqual(Date.parse(`${MAX_DATE_UTC}:00Z`));
    const slipStep = AUTOPILOT_STEPS.find((step) => step.slipDays !== undefined);
    expect(slipStep?.slipDays).toBe(AUTOPILOT_SCENARIO.slipDays);
  });

  it('never states a verdict or a figure in a caption: the engine supplies those on screen', () => {
    for (const step of AUTOPILOT_STEPS) {
      expect(step.caption).not.toMatch(/\bGO\b|NO-GO|MARGINAL/);
      expect(step.caption).not.toMatch(/%|\breal-time\b|\blive\b/i);
      expect(step.caption.length).toBeLessThanOrEqual(150);
    }
  });
});

describe('figures on the first screen', () => {
  it('names exactly the yearly Sun and Earth tables that ship with the app', () => {
    const years = readdirSync(new URL('../app/public/data/ephem/', import.meta.url))
      .filter((name) => /^\d{4}\.bin$/.test(name))
      .map((name) => Number(name.slice(0, 4)))
      .sort((a, b) => a - b);
    expect(years[0]).toBe(EPHEMERIS_FIRST_YEAR);
    expect(years[years.length - 1]).toBe(EPHEMERIS_LAST_YEAR);
    expect(years).toHaveLength(EPHEMERIS_LAST_YEAR - EPHEMERIS_FIRST_YEAR + 1);
  });

  it('credits the Moon picture in the README with the same address the globe loads', () => {
    const source = read('../app/src/moon-texture.ts');
    const url = /MOON_TEXTURE_URL = '([^']+)'/.exec(source)?.[1];
    const page = /MOON_TEXTURE_PAGE = '([^']+)'/.exec(source)?.[1];
    expect(url).toMatch(/^https:\/\/svs\.gsfc\.nasa\.gov\/.+\.jpg$/);
    const readme = read('../README.md');
    expect(readme).toContain(url as string);
    expect(readme).toContain(page as string);
  });
});
