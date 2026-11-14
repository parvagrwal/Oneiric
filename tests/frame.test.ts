import { describe, expect, it } from 'vitest';
import { azEl, meanEarthAzimuth, siteFrame, smoothSiteFrame } from '../engine/index.ts';

describe('site frame and azimuth convention', () => {
  const far = 1.5e8;
  it('a body due east of the site has azimuth 90 and a body due north has azimuth 0', () => {
    const f = smoothSiteFrame(0, 0, 0);
    const east = azEl(f, [f.r0[0], far, 0]);
    const north = azEl(f, [f.r0[0], 0, far]);
    expect(east.az).toBeCloseTo(90, 3);
    expect(east.el).toBeCloseTo(0, 3);
    expect(north.az).toBeCloseTo(0, 3);
  });
  it('east longitude is positive: the +Y direction is overhead at 90 E, underfoot at 270 E, on the horizon at 0', () => {
    const sun: [number, number, number] = [0, far, 0];
    expect(azEl(smoothSiteFrame(0, 90, 0), sun).el).toBeCloseTo(90, 3);
    expect(azEl(smoothSiteFrame(0, 270, 0), sun).el).toBeCloseTo(-90, 3);
    expect(azEl(smoothSiteFrame(0, 0, 0), sun).el).toBeCloseTo(0, 2); // -0.0007 degrees of parallax
  });
  it('direction is taken from the site, not from the Moon centre (about 0.26 degrees for Earth)', () => {
    const f = smoothSiteFrame(0, 90, 0);
    const earth: [number, number, number] = [384400, 0, 0];
    expect(azEl(f, earth).el).toBeCloseTo(-0.259, 2);
  });
  it('the mean Earth direction is due north-ish or south-ish from a polar site and east from the equator at 270 E', () => {
    expect(meanEarthAzimuth(smoothSiteFrame(0, 270, 0))).toBeCloseTo(90, 3);
    expect(meanEarthAzimuth(smoothSiteFrame(0, 90, 0))).toBeCloseTo(270, 3);
  });
  it('rejects a radius given in kilometres and a latitude beyond the pole', () => {
    expect(() => siteFrame(0, 0, 1737.4)).toThrow();
    expect(() => siteFrame(91, 0, 1737400)).toThrow();
  });
  it('works exactly at the poles', () => {
    const f = smoothSiteFrame(-90, 0, 0);
    const r = azEl(f, [far, 0, -far * 0.0001]);
    expect(Number.isFinite(r.az)).toBe(true);
    expect(azEl(f, [0, 0, -far]).el).toBeCloseTo(90, 3);
  });
});
