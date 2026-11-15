// The Horizons check chip: a cached figure is labelled cached, a live figure is labelled live, and a failed live
// query falls back to the cached figure rather than dressing an old number as a new one.
import { describe, expect, it } from 'vitest';
import {
  horizonsChipText,
  liveCheckUrl,
  liveFailureMessage,
  LIVE_CHECK_PARAMS,
  parseLiveCheckResponse,
  residualDeg,
  type LiveCheckState,
} from '../app/src/live-check.ts';
import type { SiteDefinition } from '../app/src/scenario.ts';

const SITE: SiteDefinition = {
  id: 'connecting-ridge', name: 'Connecting Ridge', label: 'Connecting Ridge reference point',
  lat: -89.45, eLon: 222.69, source: 'test', sourceUrl: 'test',
};
const CUSTOM: SiteDefinition = { ...SITE, id: 'custom:-80,10', isCustom: true };
const CACHED = { maxDeg: 0.00603, rmsDeg: 0.00284, n: 1000, cachedDate: '2026-11-15' };
const AT = Date.parse('2027-03-01T00:00:00Z');

describe('the chip always names its source', () => {
  it('says cached, with the date, when only a cached figure exists', () => {
    const text = horizonsChipText({ site: SITE, cached: CACHED, live: { kind: 'idle' }, loadingFile: false });
    expect(text).toMatch(/cached 2026-11-15/);
    expect(text).toMatch(/0\.0060°/);
    expect(text).not.toMatch(/\blive\b/);
  });

  it('says live, with the fetch time and the residual, when a live answer arrived', () => {
    const live: LiveCheckState = { kind: 'live', sunAzDeg: 90, sunElDeg: 1, residualDeg: 0.0061, fetchedMs: AT, url: '/api/horizons?x', cacheTtlS: 86400 };
    const text = horizonsChipText({ site: SITE, cached: CACHED, live, loadingFile: false });
    expect(text).toMatch(/live 2027-03-01 00:00:00 UTC/);
    expect(text).toMatch(/residual 0\.0061°/);
    expect(text).toMatch(/cached 2026-11-15/);
  });

  it('a failed live query keeps the cached figure and says the live query failed', () => {
    const live: LiveCheckState = { kind: 'failed', failedMs: AT, message: 'proxy error 502', url: '/api/horizons?x' };
    const text = horizonsChipText({ site: SITE, cached: CACHED, live, loadingFile: false });
    expect(text).toMatch(/live query failed \(proxy error 502\)/);
    expect(text).toMatch(/showing the cached figure/);
    expect(text).toMatch(/cached 2026-11-15/);
  });

  it('a failed live query with no cached figure says so, and invents nothing', () => {
    const live: LiveCheckState = { kind: 'failed', failedMs: AT, message: 'network error', url: '/api/horizons?x' };
    const text = horizonsChipText({ site: SITE, cached: null, live, loadingFile: false });
    expect(text).toMatch(/not cached for this site/);
    expect(text).not.toMatch(/max \d/);
  });

  it('never offers a live or cached check for a custom coordinate', () => {
    const text = horizonsChipText({ site: CUSTOM, cached: null, live: { kind: 'idle' }, loadingFile: false });
    expect(text).toBe('Horizons check: not cached for custom coordinates');
  });

  it('says a live query is in flight rather than showing the cached figure as if it were current', () => {
    const text = horizonsChipText({ site: SITE, cached: CACHED, live: { kind: 'loading', startedMs: AT }, loadingFile: false });
    expect(text).toMatch(/live query in flight/);
  });
});

describe('the live request is narrowly scoped', () => {
  it('sends numeric coordinates, one epoch and one body, to this deployment only', () => {
    const url = liveCheckUrl(SITE, AT);
    expect(url.startsWith('/api/horizons?')).toBe(true);
    const q = new URLSearchParams(url.split('?')[1]);
    expect([...q.keys()].sort()).toEqual([...LIVE_CHECK_PARAMS].sort());
    expect(q.get('body')).toBe('10');
    expect(q.get('lat')).toBe('-89.450000');
    expect(q.get('lon')).toBe('222.690000');
    expect(q.get('at')).toBe('2027-03-01T00:00:00.000Z');
    // No free-text field a caller could use to reach another target or another centre.
    expect(url).not.toMatch(/COMMAND|CENTER|SITE_COORD|MAKE_EPHEM/);
  });

  it('accepts a base path for the deployed origin, and never points at JPL directly', () => {
    const url = liveCheckUrl(SITE, AT, 'https://example.test');
    expect(url.startsWith('https://example.test/api/horizons?')).toBe(true);
    expect(url).not.toMatch(/ssd\.jpl\.nasa\.gov/);
  });

  it('refuses a custom coordinate and a non-finite instant', () => {
    expect(() => liveCheckUrl(CUSTOM, AT)).toThrow(/custom coordinate/);
    expect(() => liveCheckUrl(SITE, Number.NaN)).toThrow(/not a number/);
  });
});

describe('the proxy reply is read at the top level', () => {
  it('reads the azimuth and elevation the proxy returns next to its provenance fields', () => {
    const direction = parseLiveCheckResponse({
      body: '10',
      requestedUtc: '2027-03-01T00:00:00.000Z',
      reportedUtc: '2027-Mar-01 00:00:00.000',
      azDeg: 42.819897977,
      elDeg: -0.166509372,
      source: 'JPL Horizons, CENTER=coord@301, APPARENT=AIRLESS, QUANTITIES=4, one epoch',
      cacheTtlS: 86400,
    });
    expect(direction).not.toBeNull();
    expect(direction!.azDeg).toBeCloseTo(42.8199, 4);
    expect(direction!.elDeg).toBeCloseTo(-0.1665, 4);
    expect(direction!.cacheTtlS).toBe(86400);
  });

  it('returns nothing for a reply with no direction, rather than a zero', () => {
    expect(parseLiveCheckResponse({})).toBeNull();
    expect(parseLiveCheckResponse({ result: { azDeg: 42, elDeg: -1 } })).toBeNull();
    expect(parseLiveCheckResponse({ azDeg: '42', elDeg: -1 })).toBeNull();
    expect(parseLiveCheckResponse(null)).toBeNull();
  });
});

describe('the residual is an angle between directions', () => {
  it('is zero for an identical direction, and symmetric', () => {
    expect(residualDeg({ azDeg: 90, elDeg: 1 }, { azDeg: 90, elDeg: 1 })).toBeCloseTo(0, 12);
    const a = residualDeg({ azDeg: 88, elDeg: 1 }, { azDeg: 90, elDeg: 1 });
    const b = residualDeg({ azDeg: 90, elDeg: 1 }, { azDeg: 88, elDeg: 1 });
    expect(a).toBeCloseTo(b, 12);
  });

  it('does not blow up at the pole, where azimuth is undefined but direction is not', () => {
    // Two directions both 89.9 degrees up, 180 degrees apart in azimuth, are 0.2 degrees apart as directions.
    const r = residualDeg({ azDeg: 0, elDeg: 89.9 }, { azDeg: 180, elDeg: 89.9 });
    expect(r).toBeCloseTo(0.2, 6);
  });
});

describe('failure messages name what broke', () => {
  it('names rate limiting, allow-list refusal, server errors, and network failure', () => {
    expect(liveFailureMessage(429, null)).toBe('rate limited by the proxy');
    expect(liveFailureMessage(400, null)).toBe('request refused by the proxy allow-list');
    expect(liveFailureMessage(503, null)).toBe('proxy error 503');
    expect(liveFailureMessage(null, 'offline')).toBe('network error: offline');
  });
});
