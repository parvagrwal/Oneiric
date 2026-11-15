// The three P1 interfaces that are words rather than pixels: what blocks a span, the Earth end of the link, and the
// Explorer scenes. Each is tested through the same functions the components call.
import { describe, expect, it } from 'vitest';
import { blockedSpans, blockedSpanLabel, explainBlocked, spanMidUtc } from '../app/src/blocking-ui.ts';
import { earthLinkSentence, earthLinkSummary, STATIONS, STATION_CHOICES, stationById } from '../app/src/earth-link-ui.ts';
import { applyScene, EXPLORER_SCENES, nextScene, sceneAt } from '../app/src/explorer.ts';
import { DEFAULT_DATE_UTC, DEFAULT_HEIGHT_M, DEFAULT_PRESET_ID, DEFAULT_SITE_ID, parseUrlState, type AppUrlState } from '../app/src/url-state.ts';
import { makeSkyline, SKY_BINS, smoothSkyline, type Station } from '../engine/index.ts';
import { calculateScenario } from '../app/src/scenario.ts';
import { loadTable } from '../pipeline/direction-check.ts';
import { readFileSync } from 'node:fs';
import type { SiteDefinition, TerrainPayload } from '../app/src/scenario.ts';

const TABLE = loadTable();
const SITE: SiteDefinition = {
  id: 'connecting-ridge', name: 'Connecting Ridge', label: 'Connecting Ridge reference point',
  lat: -89.45, eLon: 222.69, source: 'Mazarico et al. 2011, via Gläser et al. 2018 Table 1', sourceUrl: 'https://quickmap.lroc.im-ldi.com/',
};
const START_MS = Date.parse('2027-03-01T00:00:00Z');
// The shipped 2 m skyline, so the card under test has terrain and a real recorded blocking distance.
const BYTES = readFileSync('app/public/data/skylines/connecting-ridge-2m.bin');
const SIDECAR = JSON.parse(readFileSync('app/public/data/skylines/connecting-ridge-2m.json', 'utf8')) as { grade: 'B'; terrain: string; siteElevationM?: number };
const TERRAIN: TerrainPayload = {
  buffer: BYTES.buffer.slice(BYTES.byteOffset, BYTES.byteOffset + BYTES.byteLength) as ArrayBuffer,
  grade: SIDECAR.grade,
  terrain: SIDECAR.terrain,
  siteElevationM: SIDECAR.siteElevationM ?? 0,
  heightM: 2,
};
const RESULT = calculateScenario(TABLE, SITE, START_MS, 'sortie', 2, TERRAIN, { slipEarlyDays: 0, slipLateDays: 0 });
const LEVEL = makeSkyline({
  H: new Float32Array(SKY_BINS).fill(0),
  D: new Uint16Array(SKY_BINS).fill(500),
  grade: 'B', terrain: 'constructed level horizon', heightM: 2,
});

describe('what blocks it', () => {
  it('finds the dark spans inside the stay from the engine track, not from a threshold of its own', () => {
    const spans = blockedSpans(RESULT, 'sun');
    expect(spans.length).toBeGreaterThan(0);
    for (const s of spans) {
      expect(s.endMs).toBeGreaterThan(s.startMs);
      expect(s.hours).toBeGreaterThan(0);
      expect(s.midMs).toBeGreaterThanOrEqual(s.startMs);
      expect(s.midMs).toBeLessThanOrEqual(s.endMs);
    }
    // The longest span found cannot exceed the stay, and cannot exceed what the engine reported either.
    const longestH = Math.max(...spans.map((s) => s.hours));
    expect(longestH).toBeLessThanOrEqual(RESULT.stayMs / 3_600_000 + 1e-9);
  });

  it('names the ridge from the skyline, with its distance and azimuth, when terrain is present', () => {
    const span = blockedSpans(RESULT, 'sun')[0];
    const e = explainBlocked(RESULT, LEVEL, { latDeg: SITE.lat, eLonDeg: SITE.eLon }, 'sun', span);
    expect(e.blocking.distanceKm).toBeCloseTo(5, 9); // the constructed skyline records 5 km at every azimuth
    expect(e.mapPoint).not.toBeNull();
    expect(e.sentence).toMatch(/stands 5\.00 km away/);
    expect(e.sentence).toMatch(/dark stretch from/);
    expect(e.sentence).toMatch(/azimuth \d/);
  });

  it('on a smooth sphere it says there is no ridge to name, and draws no point', () => {
    const span = blockedSpans(RESULT, 'sun')[0];
    const e = explainBlocked(RESULT, smoothSkyline(2), { latDeg: SITE.lat, eLonDeg: SITE.eLon }, 'sun', span);
    expect(e.blocking.distanceKm).toBeNull();
    expect(e.mapPoint).toBeNull();
    expect(e.sentence).toMatch(/smooth sphere/);
    expect(e.sentence).toMatch(/no ridge to name/);
    expect(e.sentence).not.toMatch(/km away/);
  });

  it('labels the button with the body, the length and the terrain, or its absence', () => {
    const span = blockedSpans(RESULT, 'sun')[0];
    const withTerrain = explainBlocked(RESULT, LEVEL, { latDeg: SITE.lat, eLonDeg: SITE.eLon }, 'sun', span);
    expect(blockedSpanLabel(withTerrain)).toMatch(/^Sun .* terrain 5\.00 km$/);
    const smooth = explainBlocked(RESULT, smoothSkyline(2), { latDeg: SITE.lat, eLonDeg: SITE.eLon }, 'sun', span);
    expect(blockedSpanLabel(smooth)).toMatch(/no terrain recorded/);
  });

  it('finds closed-link spans for Earth with the same code path', () => {
    const spans = blockedSpans(RESULT, 'earth');
    expect(spans.length).toBeGreaterThan(0);
    expect(spanMidUtc(spans[0])).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('reports no span when the stay has no blocked samples at all', () => {
    const empty = { ...RESULT, track: RESULT.track.map((p) => ({ ...p, sunF: 1, earthVis: true })) };
    expect(blockedSpans(empty, 'sun')).toHaveLength(0);
    expect(blockedSpans(empty, 'earth')).toHaveLength(0);
  });
});

describe('the Earth end of the link', () => {
  const station: Station = STATIONS[0];

  it('lists stations with a published source and a stated mask', () => {
    expect(STATIONS.length).toBeGreaterThanOrEqual(3);
    for (const s of STATIONS) {
      expect(s.source.length).toBeGreaterThan(10);
      expect(s.maskDeg).toBeGreaterThan(0);
      expect(Math.abs(s.latDeg)).toBeLessThanOrEqual(90);
      expect(s.eLonDeg).toBeGreaterThanOrEqual(0);
      expect(s.eLonDeg).toBeLessThan(360);
    }
    expect(STATION_CHOICES[0].id).toBe('none');
    expect(STATION_CHOICES.at(-1)!.id).toBe('custom');
    expect(stationById('dsn-14')?.name).toMatch(/Goldstone/);
  });

  it('judges the lunar side alone when no station is chosen, and says so', () => {
    const s = earthLinkSummary(RESULT.track, LEVEL, 0, null, null);
    expect(s.now.basis).toBe('lunar-only');
    const sentence = earthLinkSentence(s, null);
    expect(sentence).toMatch(/^Lunar side only, no station selected/);
    expect(sentence).toMatch(/Earth is above the terrain horizon for [\d.]+% of the stay/);
  });

  it('judges both halves when the station geometry is supplied', () => {
    const alwaysUp = () => 45;
    const s = earthLinkSummary(RESULT.track, LEVEL, 0, station, alwaysUp);
    expect(s.now.basis).toBe('both');
    expect(s.mixedBasis).toBe(false);
    expect(earthLinkSentence(s, station)).toMatch(/^Both halves/);
  });

  it('closes the link when the Moon is under the mask, even with Earth above the lunar horizon', () => {
    const alwaysDown = () => 2;
    const s = earthLinkSummary(RESULT.track, LEVEL, 0, station, alwaysDown);
    expect(s.now.basis).toBe('both');
    expect(s.now.open).toBe(false);
    expect(earthLinkSentence(s, station)).toMatch(/Both halves/);
    expect(s.openPct).toBe(0);
  });

  it('reports a mixed basis when only some samples had station geometry', () => {
    // Deterministic on the timestamp, so the mix does not depend on call order.
    const sometimes = (tMs: number) => (Math.floor(tMs / 3_600_000) % 2 === 0 ? 45 : null);
    const s = earthLinkSummary(RESULT.track, LEVEL, 0, station, sometimes);
    expect(s.mixedBasis).toBe(true);
    expect(earthLinkSentence(s, station)).toMatch(/mixes both-halves and lunar-only samples/);
  });

  it('with no track, reports an idle summary rather than a made-up share', () => {
    const s = earthLinkSummary([], LEVEL, 0, station, () => 45);
    expect(s.openPct).toBe(0);
    expect(s.longestClosedH).toBe(0);
  });
});

describe('Explorer mode', () => {
  it('has five scenes, each with a title, a caption and a state', () => {
    expect(EXPLORER_SCENES).toHaveLength(5);
    for (const s of EXPLORER_SCENES) {
      expect(s.title.length).toBeGreaterThan(3);
      expect(s.caption.length).toBeGreaterThan(40);
      expect(Object.keys(s.state).length).toBeGreaterThan(0);
    }
  });

  it('a caption never states a verdict', () => {
    for (const s of EXPLORER_SCENES) {
      expect(s.caption).not.toMatch(/\bGO\b|\bNO-GO\b|\bMARGINAL\b/);
    }
  });

  it('every scene state round-trips through the URL parser', () => {
    for (const s of EXPLORER_SCENES) {
      const query = new URLSearchParams();
      if (s.state.dateTime) query.set('d', s.state.dateTime);
      if (s.state.presetId) query.set('p', s.state.presetId);
      if (s.state.heightM !== undefined) query.set('h', String(s.state.heightM));
      for (const card of s.state.cards ?? []) query.append('c', card.siteId);
      const parsed = parseUrlState(`?${query.toString()}`);
      expect(parsed.dateTime).toBe(s.state.dateTime);
      expect(parsed.presetId).toBe(s.state.presetId);
      expect(parsed.heightM).toBe(s.state.heightM);
      // A scene that sets no cards keeps the parser's default card, which is the intended behaviour.
      const expected = (s.state.cards ?? [{ siteId: DEFAULT_SITE_ID }]).map((c) => c.siteId);
      expect(parsed.cards.map((c) => c.siteId)).toEqual(expected);
    }
  });

  it('applies a scene over the current state, keeping fields the scene does not set', () => {
    const current: AppUrlState = { ...parseUrlState(''), marginDeg: 2.5, windowSpan: 'weekly' };
    const next = applyScene(current, EXPLORER_SCENES[0]);
    expect(next.marginDeg).toBe(2.5);
    expect(next.windowSpan).toBe('weekly');
    expect(next.heightM).toBe(EXPLORER_SCENES[0].state.heightM);
  });

  it('navigates forward and wraps, and clamps an out-of-range index', () => {
    expect(nextScene('your-turn').id).toBe(EXPLORER_SCENES[0].id);
    expect(nextScene('sun-goes-sideways').id).toBe('skyline-is-a-calendar');
    expect(sceneAt(-5).id).toBe(EXPLORER_SCENES[0].id);
    expect(sceneAt(99).id).toBe(EXPLORER_SCENES[4].id);
  });

  it('every scene names a real library site or a real custom point', () => {
    const ids = new Set(['connecting-ridge', 'shackleton-rim', 'artemis-de-gerlache-rim-2-centroid', 'artemis-de-gerlache-rim-2-highest']);
    for (const s of EXPLORER_SCENES) {
      for (const card of s.state.cards ?? []) expect(ids.has(card.siteId)).toBe(true);
    }
  });
});

describe('the default state is unchanged by these modules', () => {
  it('still defaults to Connecting Ridge, 2027-03-01, the sortie preset, 2 m', () => {
    const s = parseUrlState('');
    expect(s.cards[0].siteId).toBe(DEFAULT_SITE_ID);
    expect(s.dateTime).toBe(DEFAULT_DATE_UTC);
    expect(s.presetId).toBe(DEFAULT_PRESET_ID);
    expect(s.heightM).toBe(DEFAULT_HEIGHT_M);
  });
});
