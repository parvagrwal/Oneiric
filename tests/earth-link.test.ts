// The Earth end of the link: both halves must be clear, and a half that was not computed is said out loud.
//
// The wrongness: assuming a station is clear when its geometry was never computed, and reporting a link open on a
// lunar side that clears the horizon by nothing.
import { describe, expect, it } from 'vitest';
import { linkState, makeSkyline, SKY_BINS, smoothSkyline, type Station } from '../engine/index.ts';

const STATION: Station = {
  id: 'dsn-14',
  name: 'Goldstone DSS-14',
  network: 'NASA DSN',
  latDeg: 35.426,
  eLonDeg: 243.11,
  maskDeg: 10,
  antennaM: 70,
  source: 'constructed for this test',
};

/** A skyline whose horizon is 0 degrees at every azimuth: Earth must clear the level line to be visible. */
const level = makeSkyline({
  H: new Float32Array(SKY_BINS).fill(0),
  D: new Uint16Array(SKY_BINS).fill(500),
  grade: 'B',
  terrain: 'constructed level horizon',
  heightM: 2,
});

const base = { earthAzDeg: 90, sky: level, lunarMarginDeg: 0, station: STATION };

describe('both halves of the link', () => {
  it('is open only when the lunar side and the station side are both clear', () => {
    const open = linkState({ ...base, earthElDeg: 3, stationMoonElevationDeg: 25 });
    expect(open.lunarSideClear).toBe(true);
    expect(open.stationSideClear).toBe(true);
    expect(open.open).toBe(true);
    expect(open.basis).toBe('both');
    expect(open.reason).toMatch(/^Link open/);
  });

  it('is closed when the Moon is under the station mask, even with Earth well above the lunar horizon', () => {
    const s = linkState({ ...base, earthElDeg: 20, stationMoonElevationDeg: 4 });
    expect(s.lunarSideClear).toBe(true);
    expect(s.stationSideClear).toBe(false);
    expect(s.open).toBe(false);
    expect(s.reason).toMatch(/below its 10° mask/);
  });

  it('is closed when Earth is under the lunar horizon, even with the Moon high at the station', () => {
    const s = linkState({ ...base, earthElDeg: -0.2, stationMoonElevationDeg: 60 });
    expect(s.lunarSideClear).toBe(false);
    expect(s.stationSideClear).toBe(true);
    expect(s.open).toBe(false);
    expect(s.reason).toMatch(/below the terrain horizon/);
  });

  it('says out loud that only the lunar side was judged when the station geometry is missing', () => {
    const s = linkState({ ...base, earthElDeg: 3, stationMoonElevationDeg: null });
    expect(s.basis).toBe('lunar-only');
    expect(s.stationSideClear).toBeNull();
    expect(s.stationMoonElevationDeg).toBeNull();
    expect(s.open).toBe(true); // the lunar half is clear, and the sentence says the station was not judged
    expect(s.reason).toMatch(/only the lunar side is judged/);
  });

  it('with no station selected, reports the lunar side alone and names that fact', () => {
    const s = linkState({ ...base, earthElDeg: 3, station: null, stationMoonElevationDeg: null });
    expect(s.basis).toBe('lunar-only');
    expect(s.reason).toMatch(/no station selected/);
  });

  it('applies the Earth margin above the terrain horizon', () => {
    const strict = linkState({ ...base, earthElDeg: 0.5, lunarMarginDeg: 1, stationMoonElevationDeg: 30 });
    expect(strict.lunarSideClear).toBe(false);
    expect(strict.open).toBe(false);
  });

  it('a smooth sphere still yields a clearance, computed from its own dip, and never claims terrain', () => {
    const s = linkState({ ...base, sky: smoothSkyline(2), earthElDeg: -0.05, stationMoonElevationDeg: 30 });
    // The dip is -acos(1737.4 / 1737.402) = -0.0868 degrees, so the clearance is -0.05 - (-0.0868) = +0.0368.
    expect(s.lunarClearanceDeg).toBeCloseTo(-0.05 + 0.0868, 3);
    expect(s.lunarSideClear).toBe(true);
    expect(s.reason).not.toMatch(/ridge|terrain from/);
  });
});
