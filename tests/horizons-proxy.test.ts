// The live Horizons check proxy: an allow-list, not a relay.
//
// The wrongness: a proxy that forwards a caller's parameters to JPL, so the site becomes an open relay; and a proxy
// that answers with a number when upstream failed, so the app cannot tell a live figure from an old one.
import { describe, expect, it } from 'vitest';
import { buildUpstreamUrl, onRequestGet, onRequestOptions, parseHorizonsRow } from '../functions/api/horizons.ts';
import { liveCheckUrl } from '../app/src/live-check.ts';
import type { SiteDefinition } from '../app/src/scenario.ts';

const AT = '2027-03-01T00:00:00.000Z';

describe('the upstream query is built here, from numbers only', () => {
  it('pins the Horizons parameter set for a lunar surface observer at one epoch', () => {
    const url = new URL(buildUpstreamUrl('10', 222.69, -89.45, AT));
    expect(url.host).toBe('ssd.jpl.nasa.gov');
    const q = url.searchParams;
    expect(q.get('COMMAND')).toBe("'10'");
    expect(q.get('CENTER')).toBe("'coord@301'");
    expect(q.get('COORD_TYPE')).toBe("'GEODETIC'");
    expect(q.get('SITE_COORD')).toBe("'222.690000,-89.450000,0'");
    expect(q.get('QUANTITIES')).toBe("'4'");
    expect(q.get('APPARENT')).toBe("'AIRLESS'");
    expect(q.get('ANG_FORMAT')).toBe("'DEG'");
    // One epoch: TLIST, not START_TIME/STOP_TIME/STEP_SIZE.
    expect(q.get('TLIST')).toBe("'2027-03-01 00:00'");
    expect(q.has('START_TIME')).toBe(false);
    expect(q.has('STEP_SIZE')).toBe(false);
  });

  it('refuses a body outside the allow-list', () => {
    expect(() => buildUpstreamUrl('301', 0, 0, AT)).toThrow(/body must be/);
    expect(() => buildUpstreamUrl('', 0, 0, AT)).toThrow(/body must be/);
  });

  it('refuses an instant that is not a date', () => {
    expect(() => buildUpstreamUrl('10', 0, 0, 'yesterday')).toThrow(/ISO 8601/);
  });
});

describe('the row parser reads one data row and nothing else', () => {
  it('reads azimuth and elevation from the columns between the markers', () => {
    const text = [
      'Date__(UT)__HR:MN, S-brt, S-brt, Azimuth, Elevation',
      '$$SOE',
      ' 2027-Mar-01 00:00,  m,  m, 90.1234, 1.2345',
      '$$EOE',
    ].join('\n');
    const row = parseHorizonsRow(text);
    expect(row).not.toBeNull();
    expect(row!.azDeg).toBeCloseTo(90.1234, 6);
    expect(row!.elDeg).toBeCloseTo(1.2345, 6);
    expect(row!.utc).toBe('2027-Mar-01 00:00');
  });

  it('returns nothing for a reply with no data block, rather than a zero', () => {
    expect(parseHorizonsRow('No ephemeris matches.')).toBeNull();
    expect(parseHorizonsRow('$$SOE\n$$EOE')).toBeNull();
    expect(parseHorizonsRow('$$SOE\n 2027-Mar-01 00:00, m, m\n$$EOE')).toBeNull();
  });

  it('reads a real Horizons row, trailing comma and empty presence field included', () => {
    // Verbatim row from a live Horizons reply for the Sun at Connecting Ridge, 2027-03-01T00:00Z, fetched
    // 2026-11-15. The row ends with a comma, so the last field is empty — reading the last two columns would
    // return the elevation as the azimuth and zero as the elevation.
    const text = [
      '$$SOE',
      ' 2027-Mar-01 00:00:00.000,*, ,   42.819897977,      -0.166509372,',
      '$$EOE',
    ].join('\n');
    const row = parseHorizonsRow(text);
    expect(row).not.toBeNull();
    expect(row!.azDeg).toBeCloseTo(42.819897977, 6);
    expect(row!.elDeg).toBeCloseTo(-0.166509372, 6);
    expect(row!.utc).toBe('2027-Mar-01 00:00:00.000');
  });
});

describe('the handler refuses anything it did not promise', () => {
  const call = async (query: string, init: { status?: number; text?: string } = {}) => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(init.text ?? '$$SOE\n 2027-Mar-01 00:00, m, m, 90.0, 1.0\n$$EOE', { status: init.status ?? 200 })) as typeof fetch;
    try {
      const request = new Request(`https://example.test/api/horizons?${query}`);
      const res = await onRequestGet({ request, env: {}, waitUntil: () => {} });
      return { status: res.status, body: await res.json() as Record<string, unknown> };
    } finally {
      globalThis.fetch = original;
    }
  };

  it('answers a valid request with one epoch and its provenance', async () => {
    const r = await call('body=10&lon=222.69&lat=-89.45&at=2027-03-01T00:00:00.000Z');
    expect(r.status).toBe(200);
    expect(r.body.azDeg).toBe(90);
    expect(r.body.elDeg).toBe(1);
    expect(String(r.body.source)).toMatch(/coord@301/);
    expect(String(r.body.note)).toMatch(/no verdict is computed/);
  });

  it('refuses a parameter it does not own', async () => {
    const r = await call('body=10&lon=0&lat=0&at=2027-03-01T00:00:00.000Z&COMMAND=399');
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/parameter not allowed/);
  });

  it('refuses a missing coordinate and an out-of-range one', async () => {
    expect((await call('body=10&lon=0&at=2027-03-01T00:00:00.000Z')).status).toBe(400);
    expect((await call('body=10&lon=400&lat=0&at=2027-03-01T00:00:00.000Z')).status).toBe(400);
    expect((await call('body=10&lon=0&lat=-95&at=2027-03-01T00:00:00.000Z')).status).toBe(400);
  });

  it('refuses a body outside the allow-list with a 400, not a query to JPL', async () => {
    const r = await call('body=301&lon=0&lat=0&at=2027-03-01T00:00:00.000Z');
    expect(r.status).toBe(400);
  });

  it('returns 502 with a message when upstream fails, and never a number', async () => {
    const failed = await call('body=10&lon=0&lat=0&at=2027-03-01T00:00:00.000Z', { status: 500, text: 'server busy' });
    expect(failed.status).toBe(502);
    expect(failed.body.azDeg).toBeUndefined();
    const empty = await call('body=10&lon=0&lat=0&at=2027-03-01T00:00:00.000Z', { text: 'nothing here' });
    expect(empty.status).toBe(502);
    expect(empty.body.azDeg).toBeUndefined();
  });

  it('answers the URL the app itself builds, with the direction at the top level', async () => {
    // End to end across the client and the proxy: the body the client sends must be one the proxy accepts,
    // and the direction the proxy returns must be where the client reads it. Either side drifting breaks the
    // live check without any single-side test failing.
    const site: SiteDefinition = {
      id: 'connecting-ridge', name: 'Connecting Ridge', label: 'Connecting Ridge reference point',
      lat: -89.45, eLon: 222.69, source: 'test', sourceUrl: 'test',
    };
    const url = liveCheckUrl(site, Date.parse(AT), 'https://example.test');
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('$$SOE\n 2027-Mar-01 00:00:00.000,*, ,   42.819897977,      -0.166509372,\n$$EOE', { status: 200 })) as typeof fetch;
    try {
      const res = await onRequestGet({ request: new Request(url), env: {}, waitUntil: () => {} });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.azDeg as number).toBeCloseTo(42.8199, 4);
      expect(body.elDeg as number).toBeCloseTo(-0.1665, 4);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('answers a preflight without opening any other method', async () => {
    const res = await onRequestOptions();
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS');
  });
});
