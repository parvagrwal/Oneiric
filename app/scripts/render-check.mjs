// Render check without a browser: renders the page shell, the hero panel, and the top strip to HTML on the server
// (static south-pole chart path, no WebGL) and prints the text a reader would see for the two worked-case dates.
// Run from app/:  node scripts/render-check.mjs
// It proves the components render and what they say. It does not prove layout, colour, or the 3D view.
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { readFileSync } from 'node:fs';
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const text = (html) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '[svg]').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
try {
  const { default: App } = await vite.ssrLoadModule('/src/App.tsx');
  const html = renderToString(createElement(App));
  console.log('APP first render OK, chars:', html.length);
  console.log(text(html).slice(0, 900));

  const eng = await vite.ssrLoadModule('/../engine/index.ts');
  const sc = await vite.ssrLoadModule('/src/scenario.ts');
  const { Hero } = await vite.ssrLoadModule('/src/Hero.tsx');
  const { TopBar } = await vite.ssrLoadModule('/src/TopBar.tsx');
  const { statusLine, statusSentence } = await vite.ssrLoadModule('/src/status.ts');
  const ab = (p) => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
  const table = eng.tableFromBuffers(new Map([2028, 2029].map((y) => [y, ab(`public/data/ephem/${y}.bin`)])));
  const sites = JSON.parse(readFileSync('public/data/sites.json', 'utf8'));
  const list = Array.isArray(sites) ? sites : sites.sites;
  const site = list.find((s) => s.id === 'artemis-de-gerlache-rim-2-centroid');
  const idx = JSON.parse(readFileSync('public/data/skylines/index.json', 'utf8')).skylines;
  const e = idx.find((x) => x.siteId === site.id);
  const terrain = { buffer: ab(`public/data/skylines/${e.file}`), grade: e.grade, terrain: e.terrain, siteElevationM: e.siteElevationM, heightM: e.heightM };
  const grades = new Map(idx.map((x) => [x.siteId, x.grade]));
  for (const date of ['2028-09-05T00:00:00Z', '2028-09-26T00:00:00Z']) {
    const result = sc.calculateScenario(table, site, Date.parse(date), 'sortie', 2, terrain);
    const dirs = eng.ephemAt(table, result.startMs);
    console.log('\n==', date, result.verdict.verdict, 'grade', result.verdict.grade, '| sunlit', result.metrics.sunlitPct.toFixed(1), 'earth', result.metrics.earthVisiblePct.toFixed(1), 'late', result.slip.lateDays);
    console.log('STATUS:', statusSentence(statusLine(result, 0)));
    const props = { globeMode: 'static', onGlobeFailed() {}, sites: list, grades, activeSite: site, activeSiteId: site.id, comparedSiteIds: new Set([site.id]), result, statusMessage: null,
      scrubMinutes: 0, stayMinutes: 9360, scrubStep: 10, playing: false, onScrub() {}, onTogglePlay() {}, sunDir: eng.unit(dirs.sun), earthDir: eng.unit(dirs.earth),
      stats: { siteCount: list.length, skylineCount: grades.size, firstYear: 2023, lastYear: 2040, firstPickDate: '2024-01-15', lastPickDate: '2039-12-15', directionMaxDeg: 0.00606, directionLimitDeg: 0.02, skylineMaxDeg: 0.00293, skylineLimitDeg: 0.01 },
      poseRequest: { pose: { latDeg: 0, lonDeg: 0, distance: 3 }, nonce: 0 }, onCameraPreset() {}, tourRotates: false, tourRunning: false, onPickSite() {}, onOpenBoard() {}, onOpenMethod() {}, onStartTour() {} };
    console.log('HERO:', text(renderToString(createElement(Hero, props))));
    console.log('TOPBAR:', text(renderToString(createElement(TopBar, { site, result, scrubMinutes: 0, instantMs: result.startMs, onNavigate() {}, onOpenMethod() {} }))));
  }
} catch (err) {
  console.error('RENDER CHECK FAILED', err);
  process.exitCode = 1;
} finally {
  await vite.close();
}
