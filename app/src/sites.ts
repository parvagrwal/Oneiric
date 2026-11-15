import { wrap360 } from '../../engine/index.ts';
import type { SiteDefinition } from './scenario.ts';

export type SiteGroupKey = 'polar-reference' | 'artemis' | 'clps' | 'international' | 'apollo' | 'custom';

export interface SiteGroup {
  key: SiteGroupKey;
  title: string;
  note?: string;
  sites: SiteDefinition[];
}

const POLAR_REFERENCE_IDS = new Set(['connecting-ridge', 'shackleton-rim', 'nobile-rim-2']);
const CLPS_IDS = new Set(['im-2-athena', 'im-1-odysseus', 'blue-ghost-m1']);
const INTERNATIONAL_IDS = new Set(['chandrayaan-3', 'chang-e-6', 'slim']);

function roundCoord(value: number): number {
  const rounded = Math.round(value * 100000) / 100000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function formatCoordinates(lat: number, eLon: number, digits = 2): string {
  const ns = lat < 0 ? 'S' : 'N';
  return `${Math.abs(lat).toFixed(digits)}° ${ns} · ${eLon.toFixed(digits)}° E`;
}

export function customSiteId(lat: number, eLon: number): string {
  return `custom:${roundCoord(lat)},${roundCoord(eLon)}`;
}

export function isCustomSite(site: Pick<SiteDefinition, 'id' | 'isCustom'>): boolean {
  return Boolean(site.isCustom || site.id.startsWith('custom:'));
}

export type ParseCustomResult =
  | { ok: true; site: SiteDefinition }
  | { ok: false; error: string };

/**
 * Parse and validate user-entered lunar coordinates in MOON_ME (latitude -90..90, longitude -180..360 converted to east-positive).
 * Custom coordinates always use the smooth sphere at Grade D.
 */
export function parseCustomSite(
  latInput: string | number,
  lonInput: string | number,
  nameInput = '',
): ParseCustomResult {
  const latStr = String(latInput).trim();
  const lonStr = String(lonInput).trim();
  if (!latStr || !lonStr) {
    return { ok: false, error: 'Enter both latitude and longitude in degrees.' };
  }
  const rawLat = Number(latStr);
  const rawLon = Number(lonStr);
  if (!Number.isFinite(rawLat) || !Number.isFinite(rawLon)) {
    return { ok: false, error: 'Latitude and longitude must be finite numbers.' };
  }
  if (rawLat < -90 || rawLat > 90) {
    return { ok: false, error: 'Latitude must be between −90° and +90°.' };
  }
  if (rawLon < -180 || rawLon > 360) {
    return { ok: false, error: 'Longitude must be between −180° and +360° (west longitudes as negative or 360 − W).' };
  }
  const lat = roundCoord(rawLat);
  const eLon = roundCoord(rawLon === 360 ? 0 : wrap360(rawLon));
  const cleanName = nameInput.trim().slice(0, 48);
  const name = cleanName || `Custom (${formatCoordinates(lat, eLon, 3)})`;
  return {
    ok: true,
    site: {
      id: customSiteId(lat, eLon),
      name,
      label: 'Custom coordinate · smooth sphere, no terrain (Grade D)',
      lat,
      eLon,
      source: 'User-entered MOON_ME coordinate (smooth sphere, no terrain)',
      sourceUrl: 'https://quickmap.lroc.im-ldi.com/',
      isCustom: true,
    },
  };
}

export function customSiteFromId(id: string): SiteDefinition | null {
  if (!id.startsWith('custom:')) return null;
  const parts = id.slice('custom:'.length).split(',');
  if (parts.length !== 2) return null;
  const parsed = parseCustomSite(parts[0], parts[1]);
  return parsed.ok ? parsed.site : null;
}

export function classifySiteGroup(site: SiteDefinition): SiteGroupKey {
  if (isCustomSite(site)) return 'custom';
  if (site.id.startsWith('artemis-')) return 'artemis';
  if (POLAR_REFERENCE_IDS.has(site.id)) return 'polar-reference';
  if (CLPS_IDS.has(site.id)) return 'clps';
  if (INTERNATIONAL_IDS.has(site.id)) return 'international';
  if (site.id.startsWith('apollo-')) return 'apollo';
  return 'international';
}

const GROUP_META: Array<{ key: SiteGroupKey; title: string; note?: string }> = [
  {
    key: 'custom',
    title: 'Custom coordinates',
    note: 'Smooth sphere, no terrain · Grade D',
  },
  {
    key: 'polar-reference',
    title: 'South-pole study points',
    note: 'Published polar reference locations',
  },
  {
    key: 'artemis',
    title: 'Artemis III candidate regions (Oct 2024 list)',
    note: 'No landing date is set · illustrative points, not NASA-selected sites',
  },
  {
    key: 'clps',
    title: 'CLPS and commercial',
  },
  {
    key: 'international',
    title: 'International missions',
  },
  {
    key: 'apollo',
    title: 'Apollo',
  },
];

export function groupSites(sites: SiteDefinition[]): SiteGroup[] {
  const buckets = new Map<SiteGroupKey, SiteDefinition[]>();
  for (const meta of GROUP_META) buckets.set(meta.key, []);
  for (const site of sites) {
    const key = classifySiteGroup(site);
    buckets.get(key)!.push(site);
  }
  return GROUP_META
    .map((meta) => ({ ...meta, sites: buckets.get(meta.key)! }))
    .filter((group) => group.sites.length > 0);
}
