import { PRESETS } from '../../engine/index.ts';
import type { SiteDefinition } from './scenario.ts';
import { customSiteFromId, isCustomSite, parseCustomSite } from './sites.ts';

export const MAX_COMPARE_CARDS = 4;
export const DEFAULT_SITE_ID = 'connecting-ridge';
export const DEFAULT_DATE_UTC = '2027-03-01T00:00';
export const MIN_DATE_UTC = '2024-01-15T00:00';
export const MAX_DATE_UTC = '2039-12-15T00:00';
export const DEFAULT_PRESET_ID = 'sortie' as const;
export const DEFAULT_HEIGHT_M = 2;

export type PresetId = 'sortie' | 'lander' | 'year';
export type WindowFinderSpan = 'daily' | 'weekly';

export interface CompareCardSpec {
  siteId: string;
  /** Optional per-card UTC date-time override ('YYYY-MM-DDTHH:mm'). Undefined follows the scenario bar date. */
  dateTime?: string;
}

export interface RuleOverrides {
  sunlitMinPct?: number;
  darkGapMaxH?: number;
  earthVisibleMinPct?: number;
  linkGapMaxH?: number;
}

export interface AppUrlState {
  dateTime: string;
  presetId: PresetId;
  stayDays: number;
  heightM: number;
  marginDeg: number;
  ruleOverrides: RuleOverrides;
  cards: CompareCardSpec[];
  activeCardIndex: number;
  customSites: SiteDefinition[];
  windowSpan: WindowFinderSpan;
  /** 'YYYY-MM-DD' UTC start of the Window Finder; defaults to dateTime.slice(0, 10). */
  windowStartDate: string;
}

const VALID_PRESETS = new Set<PresetId>(['sortie', 'lander', 'year']);
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const SITE_ID_RE = /^[a-z0-9-]+$/;

function isValidDateTime(value: string | null): value is string {
  if (!value || !DATE_TIME_RE.test(value)) return false;
  return Number.isFinite(Date.parse(`${value}:00Z`));
}

function isValidDateOnly(value: string | null): value is string {
  if (!value || !DATE_ONLY_RE.test(value)) return false;
  return Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}

function parseBoundedNumber(raw: string | null, min: number, max: number): number | undefined {
  if (raw === null || raw.trim() === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return undefined;
  return Math.round(n * 100) / 100;
}

function parseCustomSiteToken(token: string): SiteDefinition | null {
  const sepIdx = token.indexOf(':');
  const coordPart = sepIdx >= 0 ? token.slice(0, sepIdx) : token;
  const namePart = sepIdx >= 0 ? token.slice(sepIdx + 1) : '';
  const parts = coordPart.split(',');
  if (parts.length !== 2) return null;
  const parsed = parseCustomSite(parts[0], parts[1], namePart);
  return parsed.ok ? parsed.site : null;
}

function parseCardToken(token: string, customMap: Map<string, SiteDefinition>): CompareCardSpec | null {
  const atIdx = token.indexOf('@');
  const rawSiteId = atIdx >= 0 ? token.slice(0, atIdx) : token;
  const rawDate = atIdx >= 0 ? token.slice(atIdx + 1) : null;
  let validSite = false;
  if (rawSiteId.startsWith('custom:')) {
    const existing = customMap.get(rawSiteId) ?? customSiteFromId(rawSiteId);
    if (existing) {
      if (!customMap.has(existing.id)) customMap.set(existing.id, existing);
      validSite = true;
    }
  } else if (SITE_ID_RE.test(rawSiteId)) {
    validSite = true;
  }
  if (!validSite) return null;
  const spec: CompareCardSpec = { siteId: rawSiteId };
  if (isValidDateTime(rawDate)) spec.dateTime = rawDate;
  return spec;
}

export function parseUrlState(search: string): AppUrlState {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const rawPreset = params.get('p');
  const presetId: PresetId = rawPreset && VALID_PRESETS.has(rawPreset as PresetId)
    ? (rawPreset as PresetId)
    : DEFAULT_PRESET_ID;
  const presetBase = PRESETS[presetId];

  const rawDate = params.get('d');
  const dateTime = isValidDateTime(rawDate) ? rawDate : DEFAULT_DATE_UTC;

  const stayDays = parseBoundedNumber(params.get('stay'), 0.5, 365) ?? presetBase.stayDays;
  const heightM = parseBoundedNumber(params.get('h'), 0, 50) ?? DEFAULT_HEIGHT_M;
  const marginDeg = parseBoundedNumber(params.get('margin'), -5, 45) ?? 0;

  const ruleOverrides: RuleOverrides = {};
  if (presetBase.rules) {
    const sun = parseBoundedNumber(params.get('sun'), 0, 100);
    const dark = parseBoundedNumber(params.get('dark'), 0, 1000);
    const earth = parseBoundedNumber(params.get('earth'), 0, 1000);
    const link = parseBoundedNumber(params.get('link'), 0, 1000);
    if (sun !== undefined) ruleOverrides.sunlitMinPct = sun;
    if (dark !== undefined) ruleOverrides.darkGapMaxH = dark;
    if (earth !== undefined && earth <= 100) ruleOverrides.earthVisibleMinPct = earth;
    if (link !== undefined) ruleOverrides.linkGapMaxH = link;
  }

  const customMap = new Map<string, SiteDefinition>();
  for (const cs of params.getAll('cs')) {
    const parsed = parseCustomSiteToken(cs);
    if (parsed) customMap.set(parsed.id, parsed);
  }

  const cardTokens = params.getAll('c');
  const fallbackSite = params.get('site');
  if (cardTokens.length === 0 && fallbackSite) cardTokens.push(fallbackSite);

  const cards: CompareCardSpec[] = [];
  for (const token of cardTokens) {
    if (cards.length >= MAX_COMPARE_CARDS) break;
    const spec = parseCardToken(token, customMap);
    if (spec) cards.push(spec);
  }
  if (cards.length === 0) cards.push({ siteId: DEFAULT_SITE_ID });

  const rawActive = Number(params.get('active'));
  const activeCardIndex = Number.isInteger(rawActive) && rawActive >= 0
    ? Math.min(cards.length - 1, rawActive)
    : 0;

  const windowSpan: WindowFinderSpan = params.get('wf') === 'weekly' ? 'weekly' : 'daily';
  const rawWfd = params.get('wfd');
  const windowStartDate = isValidDateOnly(rawWfd) ? rawWfd : dateTime.slice(0, 10);

  return {
    dateTime,
    presetId,
    stayDays,
    heightM,
    marginDeg,
    ruleOverrides,
    cards,
    activeCardIndex,
    customSites: Array.from(customMap.values()),
    windowSpan,
    windowStartDate,
  };
}

export function serializeUrlState(state: AppUrlState): string {
  const params = new URLSearchParams();
  const presetBase = PRESETS[state.presetId];

  if (state.dateTime !== DEFAULT_DATE_UTC) params.set('d', state.dateTime);
  if (state.presetId !== DEFAULT_PRESET_ID) params.set('p', state.presetId);
  if (state.stayDays !== presetBase.stayDays) params.set('stay', String(state.stayDays));
  if (state.heightM !== DEFAULT_HEIGHT_M) params.set('h', String(state.heightM));
  if (state.marginDeg !== 0) params.set('margin', String(state.marginDeg));

  if (presetBase.rules) {
    const { sunlitMinPct, darkGapMaxH, earthVisibleMinPct, linkGapMaxH } = state.ruleOverrides;
    if (sunlitMinPct !== undefined && sunlitMinPct !== presetBase.rules.sunlitMinPct) {
      params.set('sun', String(sunlitMinPct));
    }
    if (darkGapMaxH !== undefined && darkGapMaxH !== presetBase.rules.darkGapMaxH) {
      params.set('dark', String(darkGapMaxH));
    }
    if (earthVisibleMinPct !== undefined && earthVisibleMinPct !== presetBase.rules.earthVisibleMinPct) {
      params.set('earth', String(earthVisibleMinPct));
    }
    if (linkGapMaxH !== undefined && linkGapMaxH !== presetBase.rules.linkGapMaxH) {
      params.set('link', String(linkGapMaxH));
    }
  }

  for (const custom of state.customSites) {
    if (!isCustomSite(custom)) continue;
    const defaultLabelPrefix = 'Custom (';
    const hasCustomName = !custom.name.startsWith(defaultLabelPrefix);
    const token = hasCustomName
      ? `${custom.lat},${custom.eLon}:${custom.name}`
      : `${custom.lat},${custom.eLon}`;
    params.append('cs', token);
  }

  const isDefaultSingleCard =
    state.cards.length === 1
    && state.cards[0].siteId === DEFAULT_SITE_ID
    && !state.cards[0].dateTime;

  if (!isDefaultSingleCard) {
    for (const card of state.cards.slice(0, MAX_COMPARE_CARDS)) {
      params.append('c', card.dateTime ? `${card.siteId}@${card.dateTime}` : card.siteId);
    }
  }

  if (state.activeCardIndex > 0 && state.activeCardIndex < state.cards.length) {
    params.set('active', String(state.activeCardIndex));
  }

  if (state.windowSpan !== 'daily') params.set('wf', state.windowSpan);
  if (state.windowStartDate !== state.dateTime.slice(0, 10)) {
    params.set('wfd', state.windowStartDate);
  }

  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}
