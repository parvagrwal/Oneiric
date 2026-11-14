import { describe, expect, it } from 'vitest';
import { calculateScenario } from '../app/src/scenario.ts';
import { T2030, spinningTable } from './helpers.ts';

const site = {
  id: 'connecting-ridge',
  name: 'Connecting Ridge',
  label: 'Connecting Ridge reference point',
  lat: -89.45,
  eLon: 222.69,
  source: 'Mazarico et al. 2011, via Gläser et al. 2018 Table 1',
  sourceUrl: 'https://quickmap.lroc.im-ldi.com/',
};

describe('scenario worker orchestration', () => {
  it('returns one grade-D scenario from the same engine used by the pipeline', () => {
    const result = calculateScenario(spinningTable(), site, T2030 + 6 * 60 * 60 * 1000, 'sortie');

    expect(result.preset.id).toBe('sortie');
    expect(result.verdict.grade).toBe('D');
    expect(result.verdict.terrain).toBe('none (smooth sphere)');
    expect(result.metrics.grade).toBe('D');
    expect(result.metrics.terrain).toBe('none (smooth sphere)');
    expect(result.track.length).toBeGreaterThan(100);
    expect(result.timeline.length).toBeGreaterThan(10);
    expect(result.skyline).toHaveLength(181);
    expect(result.verdict.presetLabel).toBe('illustrative, not agency requirements');
  });

  it('does not silently turn an unsupported stay into a verdict', () => {
    expect(() => calculateScenario(spinningTable(), site, T2030, 'year')).toThrow(/unsupported preview stay/);
  });
});
