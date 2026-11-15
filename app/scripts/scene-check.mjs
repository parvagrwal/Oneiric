// 3D scene check without a browser or a GPU: mounts the Moon scene in a test renderer under jsdom, advances frames,
// flies the camera, and fires marker clicks. Nothing is drawn, and the Moon picture never loads here.
// Needs two packages that are not project dependencies:
//   npm install --no-save @react-three/test-renderer@9 jsdom
// Run from app/:  node scripts/scene-check.mjs
// It proves the scene builds, every site has a clickable marker, a click selects that site, and a drag does not.
// It does not prove what the view looks like or how smoothly it runs.
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'HTMLElement', 'HTMLCanvasElement', 'Image', 'navigator', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  try { globalThis[k] = dom.window[k]; } catch { Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true }); }
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createServer } = await import('vite');
const { createElement } = await import('react');
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
let failed = false;
const errors = [];
const origError = console.error;
console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 300)); };
try {
  const ReactThreeTestRenderer = (await import('@react-three/test-renderer')).default;
  const { MoonScene } = await vite.ssrLoadModule('/src/MoonGlobe.tsx');
  const eng = await vite.ssrLoadModule('/../engine/index.ts');
  const { readFileSync } = await import('node:fs');
  const raw = JSON.parse(readFileSync('public/data/sites.json', 'utf8'));
  const sites = Array.isArray(raw) ? raw : raw.sites;
  const idx = JSON.parse(readFileSync('public/data/skylines/index.json', 'utf8')).skylines;
  const grades = new Map(idx.map((x) => [x.siteId, x.grade]));
  const ab = (p) => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
  const table = eng.tableFromBuffers(new Map([[2028, ab('public/data/ephem/2028.bin')]]));
  const d = eng.ephemAt(table, Date.parse('2028-09-05T00:00:00Z'));
  const picked = []; const surface = [];
  const props = (over = {}) => ({ sites, grades, activeSiteId: sites[0].id, comparedSiteIds: new Set([sites[0].id, sites[1].id]), sunDir: eng.unit(d.sun), earthDir: eng.unit(d.earth),
    poseRequest: { pose: { latDeg: 8, lonDeg: 0, distance: 3.9 }, nonce: 0 }, zoomRequest: { factor: 1, nonce: 0 }, autoRotate: true, wheelZoom: false, running: true,
    onPickSite: (id) => picked.push(id), onHoverSite() {}, onUserInteract() {}, onSurface: (s) => surface.push(s), onReady() {}, onContextLost() {}, ...over });
  const renderer = await ReactThreeTestRenderer.create(createElement(MoonScene, props()));
  await renderer.advanceFrames(5, 0.016);
  const count = (o) => 1 + o.children.reduce((n, c) => n + count(c), 0);
  const scene = renderer.scene;
  console.log('mounted; scene objects:', count(scene.instance), '| top-level children:', scene.children.length);
  const meshes = scene.findAll((n) => n.instance.isMesh);
  const sprites = scene.findAll((n) => n.instance.isSprite);
  console.log('meshes:', meshes.length, 'sprites:', sprites.length, 'surface states:', surface.join(','));
  // camera flight to the south pole, then a zoom, then null directions (ephemeris not loaded yet)
  await renderer.update(createElement(MoonScene, props({ poseRequest: { pose: { latDeg: -84, lonDeg: 0, distance: 1.75 }, nonce: 1 }, autoRotate: false })));
  await renderer.advanceFrames(240, 0.016);
  await renderer.update(createElement(MoonScene, props({ poseRequest: { pose: { latDeg: -84, lonDeg: 0, distance: 1.75 }, nonce: 1 }, zoomRequest: { factor: 0.78, nonce: 1 }, sunDir: null, earthDir: null, activeSiteId: sites[5].id })));
  await renderer.advanceFrames(60, 0.016);
  // click the first site's hit sphere
  const hit = scene.findAll((n) => n.instance.isMesh && n.instance.geometry?.type === 'SphereGeometry' && n.instance.material?.opacity === 0);
  console.log('marker hit targets:', hit.length, '(sites:', sites.length + ')');
  if (hit.length !== sites.length) throw new Error('every site needs exactly one clickable marker');
  await renderer.fireEvent(hit[3], 'click', { delta: 0, stopPropagation() {} });
  console.log('picked after click:', picked.join(','), '| expected:', sites[3].id);
  if (picked.length !== 1 || picked[0] !== sites[3].id) throw new Error('a click must select the clicked site');
  await renderer.fireEvent(hit[4], 'click', { delta: 40, stopPropagation() {} });
  console.log('picked after a drag-release (should be unchanged):', picked.join(','));
  if (picked.length !== 1) throw new Error('releasing a drag over a marker must not select a site');
  await renderer.unmount();
  console.log('unmounted cleanly');
} catch (err) {
  failed = true;
  origError('SCENE CHECK FAILED', err);
} finally {
  console.error = origError;
  console.log('console.error calls during run:', errors.length);
  for (const e of errors.slice(0, 8)) console.log('  -', e);
  await vite.close();
  process.exit(failed ? 1 : 0);
}
