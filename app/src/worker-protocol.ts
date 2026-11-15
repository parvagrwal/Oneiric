import type {
  ScenarioOptions,
  ScenarioResult,
  SiteDefinition,
  TerrainPayload,
  WindowFinderRow,
} from './scenario.ts';

export interface CompareSlotRequest {
  slotKey: string;
  site: SiteDefinition;
  startMs: number;
}

export interface CompareSlotResult {
  slotKey: string;
  siteId: string;
  result: ScenarioResult;
}

export type WorkerRequest =
  | {
    type: 'set-ephem';
    tables: Array<{ year: number; buffer: ArrayBuffer }>;
  }
  | {
    type: 'set-skylines';
    skylines: Array<{ siteId: string; payload: TerrainPayload }>;
  }
  | {
    type: 'compare';
    requestId: number;
    slots: CompareSlotRequest[];
    presetId: string;
    heightM: number;
    options?: ScenarioOptions;
  }
  | {
    type: 'matrix';
    requestId: number;
    sites: SiteDefinition[];
    matrixStartDayMs: number;
    span: 'daily' | 'weekly';
    presetId: string;
    heightM: number;
    options?: ScenarioOptions;
  }
  | {
    type: 'export-series';
    requestId: number;
    site: SiteDefinition;
    startMs: number;
    presetId: string;
    heightM: number;
    options?: ScenarioOptions;
  }
  | {
    /** Read-only: where the Sun and Earth are, seen from the Moon's centre, for the 3D view. Feeds no verdict. */
    type: 'directions';
    requestId: number;
    tMs: number;
  }
  | {
    type: 'calculate';
    requestId: number;
    tables: Array<{ year: number; buffer: ArrayBuffer }>;
    site: SiteDefinition;
    startMs: number;
    presetId: string;
    heightM: number;
    terrain?: TerrainPayload | null;
    options?: ScenarioOptions;
  };

export type WorkerResponse =
  | {
    type: 'compare-result';
    requestId: number;
    cards: CompareSlotResult[];
  }
  | {
    type: 'compare-error';
    requestId: number;
    message: string;
  }
  | {
    type: 'matrix-chunk';
    requestId: number;
    rows: WindowFinderRow[];
    done: number;
    total: number;
  }
  | {
    type: 'matrix-done';
    requestId: number;
  }
  | {
    type: 'matrix-error';
    requestId: number;
    message: string;
  }
  | {
    type: 'export-series-result';
    requestId: number;
    csv: string;
  }
  | {
    type: 'export-series-error';
    requestId: number;
    message: string;
  }
  | {
    /** Unit vectors in MOON_ME from the engine's ephemeris; null when the table does not cover tMs. */
    type: 'directions-result';
    requestId: number;
    tMs: number;
    sun: [number, number, number] | null;
    earth: [number, number, number] | null;
  }
  | {
    type: 'result';
    requestId: number;
    result: ScenarioResult;
  }
  | {
    type: 'error';
    requestId: number;
    message: string;
  };
