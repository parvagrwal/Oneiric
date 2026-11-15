// What blocks the Sun or the Earth: the point named on the ground must be the terrain the shipped skyline actually
// recorded, at the distance it recorded.
//
// The wrongness this file is written against, in order of how badly it would mislead:
//   1. a ridge named on the wrong side of the site (an azimuth convention error),
//   2. a distance invented for a smooth-sphere skyline that recorded no terrain,
//   3. a rise quoted without the distance it came from.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { blockingTerrain, centralAngle, decodeSkyline, destinationPoint, groundDistanceM, makeSkyline, R_MOON_KM, skylineAt, SKY_BINS, smoothSkyline } from '../engine/index.ts';

const SITE = { latDeg: -89.45, eLonDeg: 222.69 };

function shipped(id: string, heightM = 2) {
  const base = `app/public/data/skylines/${id}-${heightM}m`;
  const buf = readFileSync(`${base}.bin`);
  const side = JSON.parse(readFileSync(`${base}.json`, 'utf8')) as { grade: 'A' | 'B' | 'C' | 'D'; terrain: string };
  const { H, D } = decodeSkyline(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  return makeSkyline({ H, D, grade: side.grade, terrain: side.terrain, heightM });
}

describe('geometry helpers', () => {
  it('places a destination exactly the requested distance away on the sphere', () => {
    for (const theta of [1e-6, 100 / (R_MOON_KM * 1000), 0.05]) {
      for (const az of [0, 45, 137.5, 270, 359.9]) {
        const p = destinationPoint(SITE, az, theta);
        // Absolute tolerance of 1e-12 rad: the round trip through stored decimal degrees costs about 1e-15 rad, so
        // this bounds the geometry, not the printing. At 100 m the angle is 1.6e-5 rad.
        expect(Math.abs(centralAngle(SITE, p) - theta)).toBeLessThan(1e-12);
      }
    }
  });

  it('puts a bearing of 90 at a larger east-positive longitude, and 0 toward the pole', () => {
    const theta = 10_000 / (R_MOON_KM * 1000);
    const east = destinationPoint(SITE, 90, theta);
    const north = destinationPoint(SITE, 0, theta);
    expect(east.eLonDeg).toBeGreaterThan(SITE.eLonDeg);
    expect(north.eLonDeg).toBeCloseTo(SITE.eLonDeg, 9);
    // 89.45 S: due north walks toward the equator, due south toward the pole.
    expect(north.latDeg).toBeGreaterThan(SITE.latDeg);
    expect(destinationPoint(SITE, 180, theta).latDeg).toBeLessThan(SITE.latDeg);
  });

  it('refuses a run past the pole into a wrapped latitude', () => {
    // 200 km north from 100 m short of the pole crosses the pole; latitude must stay in range and longitude flip by 180.
    const near = { latDeg: 89.998, eLonDeg: 0 };
    const p = destinationPoint(near, 0, 200_000 / (R_MOON_KM * 1000));
    expect(p.latDeg).toBeLessThanOrEqual(90);
    expect(Math.abs(Math.abs(p.eLonDeg) - 180)).toBeLessThan(1e-6);
  });
});

describe('the blocking terrain is the one the skyline recorded', () => {
  const sky = shipped('connecting-ridge');

  it('reports a point at exactly the stored blocking distance, at the azimuth asked for', () => {
    for (const az of [0, 33.3, 128.85, 200, 359]) {
      const look = skylineAt(sky, az);
      const b = blockingTerrain(SITE, sky, az, look.H - 1);
      expect(b.distanceKm).not.toBeNull();
      expect(b.distanceKm!).toBeCloseTo(look.D / 100, 9);
      const groundM = groundDistanceM(SITE, b.point!);
      expect(groundM).toBeCloseTo(look.D * 10, 0);
      // The point's azimuth from the site must come back as the azimuth that was asked for.
      const back = Math.atan2(
        Math.sin((b.point!.eLonDeg - SITE.eLonDeg) * Math.PI / 180) * Math.cos(b.point!.latDeg * Math.PI / 180),
        Math.cos(SITE.latDeg * Math.PI / 180) * Math.sin(b.point!.latDeg * Math.PI / 180)
        - Math.sin(SITE.latDeg * Math.PI / 180) * Math.cos(b.point!.latDeg * Math.PI / 180) * Math.cos((b.point!.eLonDeg - SITE.eLonDeg) * Math.PI / 180),
      ) * 180 / Math.PI;
      expect(((back % 360) + 360) % 360).toBeCloseTo(az, 4);
    }
  });

  it('recovers the rise from the recorded horizon and distance, on a constructed case with a known answer', () => {
    // A ridge 4 km away subtending 1 degree is 4000 * tan(1 degree) = 69.8 m high. Constructed, so the answer is
    // known before the code runs; the shipped files cannot supply a ground truth for this.
    const H = new Float32Array(SKY_BINS).fill(0.5);
    const D = new Uint16Array(SKY_BINS).fill(400); // 400 ten-metre units = 4 km
    const made = makeSkyline({ H, D, grade: 'B', terrain: 'constructed ridge', heightM: 2 });
    const b = blockingTerrain(SITE, made, 90, 0.2);
    expect(b.distanceKm).toBeCloseTo(4, 9);
    expect(b.riseM!).toBeCloseTo(4000 * Math.tan(0.5 * Math.PI / 180), 6);
    expect(groundDistanceM(SITE, b.point!)).toBeCloseTo(4000, 0);
    expect(b.clearanceDeg).toBeCloseTo(-0.3, 9);
  });

  it('reports no point and no distance for a smooth sphere, instead of naming terrain that is not there', () => {
    const smooth = smoothSkyline(2);
    const b = blockingTerrain(SITE, smooth, 90, -0.1);
    expect(b.distanceKm).toBeNull();
    expect(b.point).toBeNull();
    expect(b.riseM).toBeNull();
    expect(b.horizonDeg).toBeCloseTo(-0.087, 3);
  });

  it('states the clearance as body elevation minus horizon, with its sign', () => {
    const look = skylineAt(sky, 128.85);
    const above = blockingTerrain(SITE, sky, 128.85, look.H + 0.5);
    const below = blockingTerrain(SITE, sky, 128.85, look.H - 0.5);
    expect(above.clearanceDeg).toBeCloseTo(0.5, 9);
    expect(below.clearanceDeg).toBeCloseTo(-0.5, 9);
  });
});
