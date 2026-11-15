import { describe, expect, it } from 'vitest';
import { groupSites, parseCustomSite } from '../app/src/sites.ts';
import {
  DEFAULT_DATE_UTC,
  DEFAULT_PRESET_ID,
  MAX_COMPARE_CARDS,
  parseUrlState,
  serializeUrlState,
  type AppUrlState,
} from '../app/src/url-state.ts';
import type { SiteDefinition } from '../app/src/scenario.ts';

const sampleSites: SiteDefinition[] = [
  {
    id: 'connecting-ridge',
    name: 'Connecting Ridge',
    label: 'Connecting Ridge reference point',
    lat: -89.45,
    eLon: 222.69,
    source: 'Mazarico et al. 2011',
    sourceUrl: 'https://quickmap.lroc.im-ldi.com/',
  },
  {
    id: 'artemis-haworth-highest',
    name: 'Haworth highest point',
    label: 'Haworth highest point, illustrative point, not a NASA-selected site',
    lat: -86.36376,
    eLon: 336.81232,
    source: 'USGS Artemis III candidate regions (Oct 2024 list)',
    sourceUrl: 'https://www.usgs.gov/data/down-selected-artemis-iii-candidate-landing-site-navigational-grids',
  },
  {
    id: 'im-2-athena',
    name: 'IM-2 Athena',
    label: 'IM-2 Athena',
    lat: -84.7906,
    eLon: 29.1957,
    source: 'LRO-derived position',
    sourceUrl: 'https://quickmap.lroc.im-ldi.com/',
  },
  {
    id: 'chandrayaan-3',
    name: 'Chandrayaan-3',
    label: 'Chandrayaan-3',
    lat: -69.3741,
    eLon: 32.32,
    source: 'LROC',
    sourceUrl: 'https://quickmap.lroc.im-ldi.com/',
  },
  {
    id: 'apollo-11',
    name: 'Apollo 11',
    label: 'Apollo 11',
    lat: 0.67416,
    eLon: 23.47314,
    source: 'NASA NSSDC',
    sourceUrl: 'https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_sites.html',
  },
];

describe('custom coordinates and site grouping', () => {
  it('converts west-negative longitudes into MOON_ME east-positive longitudes and marks custom points grade D', () => {
    const parsed = parseCustomSite('-41.6384', '-153.9854', 'Far-side test');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.site.lat).toBeCloseTo(-41.6384, 5);
    expect(parsed.site.eLon).toBeCloseTo(206.0146, 4);
    expect(parsed.site.isCustom).toBe(true);
    expect(parsed.site.id).toBe('custom:-41.6384,206.0146');
    expect(parsed.site.label).toMatch(/smooth sphere, no terrain/i);
  });

  it('rejects out-of-range or non-numeric coordinates instead of inventing a location', () => {
    expect(parseCustomSite('95', '20').ok).toBe(false);
    expect(parseCustomSite('-91', '20').ok).toBe(false);
    expect(parseCustomSite('-85', '380').ok).toBe(false);
    expect(parseCustomSite('-85', '-190').ok).toBe(false);
    expect(parseCustomSite('', '20').ok).toBe(false);
    expect(parseCustomSite('abc', '20').ok).toBe(false);
  });

  it('groups sites with the required Artemis III candidate regions (Oct 2024 list) heading and no-landing-date note', () => {
    const custom = parseCustomSite('-85.5', '31.2');
    if (!custom.ok) throw new Error('expected valid custom site');
    const groups = groupSites([...sampleSites, custom.site]);
    const artemis = groups.find((g) => g.key === 'artemis');
    expect(artemis).toBeDefined();
    expect(artemis!.title).toBe('Artemis III candidate regions (Oct 2024 list)');
    expect(artemis!.note).toMatch(/no landing date/i);
    expect(artemis!.note).toMatch(/illustrative/i);
    expect(groups.map((g) => g.sites.length).reduce((a, b) => a + b, 0)).toBe(6);
  });
});

describe('URL state round-trip and validation', () => {
  it('uses an empty query string for the default initial state', () => {
    const initial = parseUrlState('');
    expect(initial.dateTime).toBe(DEFAULT_DATE_UTC);
    expect(initial.presetId).toBe(DEFAULT_PRESET_ID);
    expect(initial.cards).toEqual([{ siteId: 'connecting-ridge' }]);
    expect(initial.windowSpan).toBe('daily');
    expect(serializeUrlState(initial)).toBe('');
  });

  it('round-trips four compare cards, per-card dates, custom coordinates, edited thresholds, margin and weekly Window Finder', () => {
    const custom = parseCustomSite('-85.25', '31.5', 'Ridge test');
    if (!custom.ok) throw new Error('expected valid custom site');
    const state: AppUrlState = {
      dateTime: '2027-06-15T12:30',
      presetId: 'lander',
      stayDays: 10.5,
      heightM: 2,
      marginDeg: 1.5,
      ruleOverrides: {
        sunlitMinPct: 88,
        darkGapMaxH: 18,
        earthVisibleMinPct: 75,
        linkGapMaxH: 12,
      },
      cards: [
        { siteId: 'connecting-ridge' },
        { siteId: 'im-2-athena', dateTime: '2027-07-06T12:30' },
        { siteId: custom.site.id },
        { siteId: 'apollo-11' },
      ],
      activeCardIndex: 2,
      customSites: [custom.site],
      windowSpan: 'weekly',
      windowStartDate: '2027-06-01',
    };
    const query = serializeUrlState(state);
    const restored = parseUrlState(query);
    expect(restored.dateTime).toBe(state.dateTime);
    expect(restored.presetId).toBe('lander');
    expect(restored.stayDays).toBe(10.5);
    expect(restored.marginDeg).toBe(1.5);
    expect(restored.ruleOverrides).toEqual(state.ruleOverrides);
    expect(restored.cards).toEqual(state.cards);
    expect(restored.activeCardIndex).toBe(2);
    expect(restored.windowSpan).toBe('weekly');
    expect(restored.windowStartDate).toBe('2027-06-01');
    expect(restored.customSites).toHaveLength(1);
    expect(restored.customSites[0].lat).toBeCloseTo(-85.25, 5);
    expect(restored.customSites[0].eLon).toBeCloseTo(31.5, 5);
    expect(restored.customSites[0].name).toBe('Ridge test');
  });

  it('carries the observer height in the link and brings it back unchanged', () => {
    const base = parseUrlState('');
    for (const heightM of [0, 10, 20]) {
      const query = serializeUrlState({ ...base, heightM });
      expect(query).toContain(`h=${heightM}`);
      expect(parseUrlState(query).heightM).toBe(heightM);
    }
    // 2 m is the default, so it stays out of the link.
    expect(serializeUrlState({ ...base, heightM: 2 })).toBe('');
  });

  it('ignores an observer height that is not a height, and keeps a 0 m mast rather than dropping it', () => {
    expect(parseUrlState('?h=abc').heightM).toBe(2);
    expect(parseUrlState('?h=-5').heightM).toBe(2);
    expect(parseUrlState('?h=900').heightM).toBe(2);
    expect(parseUrlState('?h=0').heightM).toBe(0);
  });

  it('caps cards at four, reconstructs custom sites from card IDs, and ignores malformed coordinates or thresholds', () => {
    const restored = parseUrlState(
      '?c=connecting-ridge&c=im-2-athena&c=apollo-11&c=chandrayaan-3&c=shackleton-rim&c=custom:999,10&sun=150&dark=-5&active=99',
    );
    expect(restored.cards).toHaveLength(MAX_COMPARE_CARDS);
    expect(restored.activeCardIndex).toBe(MAX_COMPARE_CARDS - 1);
    expect(restored.ruleOverrides.sunlitMinPct).toBeUndefined();
    expect(restored.ruleOverrides.darkGapMaxH).toBeUndefined();

    const fromCardOnly = parseUrlState('?c=custom:-84.5,40.25');
    expect(fromCardOnly.customSites).toHaveLength(1);
    expect(fromCardOnly.cards[0].siteId).toBe('custom:-84.5,40.25');
  });
});
