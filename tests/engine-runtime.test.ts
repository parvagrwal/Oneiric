import { readdirSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildSync } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { buildSkyline, encodeSkyline, HOUR_MS, metrics, prepareRolling, PRESETS, series, smoothSiteFrame, smoothSkyline, verdictSeries } from '../engine/index.ts';
import { syntheticDem } from '../pipeline/synthetic-terrain.ts';
import { loadTable } from '../pipeline/direction-check.ts';

describe('the engine is pure', () => {
  it('imports nothing from Node or the browser, and touches no DOM, process or file globals', () => {
    const banned = /from\s+['"](node:|fs|path|os|child_process|crypto|worker_threads)|require\(|\b(window|document|process|localStorage|XMLHttpRequest|fetch)\b/;
    for (const f of readdirSync('engine').filter((n) => n.endsWith('.ts'))) {
      const code = readFileSync(`engine/${f}`, 'utf8').split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/**')).map((l) => l.replace(/'[^']*'|`[^`]*`|"[^"]*"/g, "''"));
      expect(code.filter((l) => banned.test(l)), `engine/${f}`).toEqual([]);
    }
  });
});

describe('the same engine code gives identical numbers in a sandbox with no Node globals', () => {
  it('series and metrics match exactly between Node and a bare JavaScript context (the Worker stand-in)', () => {
    const bundle = buildSync({ entryPoints: ['engine/index.ts'], bundle: true, write: false, format: 'iife', globalName: 'Engine', platform: 'neutral', target: 'es2022' });
    const table = loadTable();
    const t0 = Date.UTC(2027, 2, 1);
    const t1 = t0 + 7 * 24 * HOUR_MS;
    const direct = metrics(series(table, { frame: smoothSiteFrame(-89.45, 222.69, 2), sky: smoothSkyline(2) }, t0, t1, 10), t0, t1);

    const ctx = vm.createContext({ table, t0, t1 }); // only data is passed in; no require, process, fs, window
    vm.runInContext(bundle.outputFiles[0].text, ctx);
    const inside = vm.runInContext(
      `const E = Engine;
       const ser = E.series(table, { frame: E.smoothSiteFrame(-89.45, 222.69, 2), sky: E.smoothSkyline(2) }, t0, t1, 10);
       JSON.stringify(E.metrics(ser, t0, t1));`, ctx);
    expect(typeof vm.runInContext('typeof process + typeof require + typeof window', ctx)).toBe('string');
    expect(vm.runInContext('typeof process + typeof require + typeof window', ctx)).toBe('undefinedundefinedundefined');
    expect(inside).toBe(JSON.stringify(direct));
  });
  it('a terrain skyline built in the bare context is byte-for-byte the one built in Node', () => {
    const bundle = buildSync({ entryPoints: ['engine/index.ts'], bundle: true, write: false, format: 'iife', globalName: 'Engine', platform: 'neutral', target: 'es2022' });
    const dem = syntheticDem('synthetic test terrain', 20, 3_000, -85, 30, (rel) => 200 * Math.sin(rel.eastM / 400) * Math.cos(rel.northM / 300) + 250);
    const direct = buildSkyline([{ dem, maxDistM: 15_000 }], -85, 30, 2);
    const ctx = vm.createContext({ dem });
    vm.runInContext(bundle.outputFiles[0].text, ctx);
    const inside = vm.runInContext(
      `const b = Engine.buildSkyline([{ dem, maxDistM: 15000 }], -85, 30, 2);
       Array.from(new Uint8Array(Engine.encodeSkyline(b.H, b.D))).join(',');`, ctx);
    expect(inside).toBe(Array.from(new Uint8Array(encodeSkyline(direct.H, direct.D))).join(','));
    expect(Math.max(...direct.H) - Math.min(...direct.H)).toBeGreaterThan(1); // real relief, not a flat line
  }, 15000); // the esbuild bundle + skyline build exceeds the 5 s default under full-suite load
  it('rolling prefix-sum window verdicts match exactly between Node and the bare Worker stand-in', () => {
    const bundle = buildSync({ entryPoints: ['engine/index.ts'], bundle: true, write: false, format: 'iife', globalName: 'Engine', platform: 'neutral', target: 'es2022' });
    const table = loadTable();
    const t0 = Date.UTC(2027, 2, 1);
    const t1 = t0 + 30 * 24 * HOUR_MS;
    const cols = Array.from({ length: 14 }, (_, d) => t0 + d * 24 * HOUR_MS);
    const direct = verdictSeries(
      prepareRolling(series(table, { frame: smoothSiteFrame(-89.45, 222.69, 2), sky: smoothSkyline(2) }, t0, t1, 10)),
      PRESETS.sortie,
      t0,
      cols,
    );
    const ctx = vm.createContext({ table, t0, t1, cols });
    vm.runInContext(bundle.outputFiles[0].text, ctx);
    const inside = vm.runInContext(
      `const E = Engine;
       const ser = E.series(table, { frame: E.smoothSiteFrame(-89.45, 222.69, 2), sky: E.smoothSkyline(2) }, t0, t1, 10);
       JSON.stringify(E.verdictSeries(E.prepareRolling(ser), E.PRESETS.sortie, t0, cols));`,
      ctx,
    );
    expect(inside).toBe(JSON.stringify(direct));
  });
});
