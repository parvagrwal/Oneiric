import { describe, expect, it } from 'vitest'
import {
  CAMERA_MAX_LAT_DEG,
  SOUTH_POLE_POSE,
  buildMoonSphere,
  hiddenByMoon,
  latLonToMoon,
  latLonToScene,
  moonToScene,
  polarChartPoint,
  poseForSite,
} from '../app/src/globe-math.ts'
import { cross, dot, siteFrame, sub, type Vec3 } from '../engine/index.ts'

const close = (a: Vec3, b: Vec3, eps = 1e-9) => a.every((value, i) => Math.abs(value - b[i]) < eps)

describe('3D Moon view geometry', () => {
  it('places latitude and longitude with the same convention as the engine site frame', () => {
    for (const [lat, lon] of [[0, 0], [-89.45, 222.69], [26.13, 3.63], [-41.64, 206.01], [90, 0], [-90, 0]]) {
      const up = siteFrame(lat, lon, 1_737_400).up
      expect(close(latLonToMoon(lat, lon), up)).toBe(true)
    }
  })

  it('maps Moon axes to scene axes without mirroring', () => {
    const x = moonToScene([1, 0, 0])
    const y = moonToScene([0, 1, 0])
    const z = moonToScene([0, 0, 1])
    expect(z).toEqual([0, 1, 0]) // north pole is up
    expect(x).toEqual([0, 0, 1]) // the mean Earth direction faces the default camera
    expect(y).toEqual([1, 0, 0]) // 90 degrees east is to the right
    expect(close(cross(x, y), z)).toBe(true) // still right-handed
  })

  it('ties texture coordinates to longitude and latitude for a map centred on 0 degrees', () => {
    const lonSeg = 8
    const latSeg = 4
    const mesh = buildMoonSphere(lonSeg, latSeg)
    const cols = lonSeg + 1
    for (let j = 0; j <= latSeg; j++) {
      for (let i = 0; i <= lonSeg; i++) {
        const k = j * cols + i
        const u = mesh.uvs[k * 2]
        const v = mesh.uvs[k * 2 + 1]
        const expected = latLonToScene(v * 180 - 90, u * 360 - 180)
        const got: Vec3 = [mesh.positions[k * 3], mesh.positions[k * 3 + 1], mesh.positions[k * 3 + 2]]
        expect(close(got, expected, 1e-6)).toBe(true)
      }
    }
    // The middle of the map (u = 0.5, v = 0.5) is 0 N, 0 E: the sub-Earth point.
    const centre = (latSeg / 2) * cols + lonSeg / 2
    expect(close([mesh.positions[centre * 3], mesh.positions[centre * 3 + 1], mesh.positions[centre * 3 + 2]], [0, 0, 1])).toBe(true)
  })

  it('winds every triangle so its outer face is the front face', () => {
    const mesh = buildMoonSphere(12, 6)
    const vertex = (index: number): Vec3 => [mesh.positions[index * 3], mesh.positions[index * 3 + 1], mesh.positions[index * 3 + 2]]
    let checked = 0
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const a = vertex(mesh.indices[t])
      const b = vertex(mesh.indices[t + 1])
      const c = vertex(mesh.indices[t + 2])
      const normal = cross(sub(b, a), sub(c, a))
      const area = Math.hypot(...normal)
      if (area < 1e-9) continue // collapsed triangles at the poles
      const centroid: Vec3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]
      expect(dot(normal, centroid)).toBeGreaterThan(0)
      checked++
    }
    expect(checked).toBeGreaterThan(100)
  })

  it('keeps the camera off the poles and frames polar sites in the polar-map orientation', () => {
    expect(Math.abs(SOUTH_POLE_POSE.latDeg)).toBe(CAMERA_MAX_LAT_DEG)
    const shackleton = poseForSite(-89.78, 204.27)
    expect(shackleton.latDeg).toBe(-CAMERA_MAX_LAT_DEG)
    expect(shackleton.lonDeg).toBe(0)
    const apollo = poseForSite(0.67416, 23.47314)
    expect(apollo.latDeg).toBeCloseTo(0.67416)
    expect(apollo.lonDeg).toBeCloseTo(23.47314)
  })

  it('reports points behind the Moon as hidden and points in front as visible', () => {
    const camera: Vec3 = [0, 0, 3]
    expect(hiddenByMoon([0, 0, 1.02], camera)).toBe(false)
    expect(hiddenByMoon([0, 0, -1.02], camera)).toBe(true)
    expect(hiddenByMoon([1.3, 0, 0], camera)).toBe(false)
  })

  it('draws the static chart with the south pole at the centre and 0 degrees longitude up', () => {
    const pole = polarChartPoint(-90, 123)
    expect(Math.hypot(pole.x, pole.y)).toBe(0)
    const zero = polarChartPoint(-80, 0)
    expect(zero.x).toBeCloseTo(0)
    expect(zero.y).toBeLessThan(0) // up on screen
    const east = polarChartPoint(-80, 90)
    expect(east.x).toBeGreaterThan(0)
    expect(east.y).toBeCloseTo(0)
    const north = polarChartPoint(90, 0)
    expect(Math.hypot(north.x, north.y)).toBeCloseTo(1)
  })
})
